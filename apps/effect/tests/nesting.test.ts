import { afterAll, assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http";

import { appWith } from "#server/http.ts";
import { SECURE_HEADERS } from "#server/secure-headers.ts";
import { timeoutFor } from "#server/timeout.ts";

/*
 * What a short-circuited response carries.
 *
 * The chain in `src/server/http.ts` decides this, and until now it was decided
 * in a comment. Four middleware answer without ever reaching the router — the
 * cors preflight, the csrf 403, the timeout 504 and the 404 — and each one
 * carries exactly what the middleware *outside* it adds on the way back. So a
 * reorder in that chain changes the table below, and a reorder that nothing in
 * the table covers is a reorder that changes nothing.
 *
 * There is no 500 row. `onError` sits outside `notFound` and nothing else, so
 * the only thing its position decides is that a 404 passes through it, which
 * the 404 row asserts. A route that fails on purpose, merged in to make a 500,
 * would change what the app serves to make a point the chain does not need.
 *
 * Every request states `?lang=id`, and that is the sharpest column here. The
 * language cookie is written by `language`, which `cors` and `timeout` sit
 * outside of, so a response either of them answers cannot carry one — but only
 * a request that asks for a language can show that. A fallback is never cached
 * (see `language.ts`), so a request without `?lang=` would leave the column
 * empty for every row and assert nothing.
 */

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";
const FOREIGN_ORIGIN = "https://not-this-app.example";

// See `tests/app.test.ts`: the policy under test is stated here, not in the
// ambient process.
const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

// Long enough that no row but the 504 can reach it — a request through this
// chain answers in single-figure milliseconds — and short enough that the 504
// row costs half a second. The layer builds before any of this applies, so a
// cold start is not on the clock.
const TIMEOUT = Duration.millis(500);

// A route the timeout can give up on. A global middleware wraps the whole
// router, so a route merged in here goes through the real chain — which is what
// makes this a nesting assertion and not a test of `timeoutFor`.
const slow = HttpRouter.add(
  "GET",
  "/slow",
  Effect.as(Effect.sleep(Duration.minutes(1)), HttpServerResponse.text("done"))
);

const { dispose, handler } = HttpRouter.toWebHandler(
  Layer.mergeAll(appWith(timeoutFor(TIMEOUT)), slow).pipe(
    Layer.provide([HttpServer.layerServices, configProvider])
  ),
  { disableLogger: true }
);

// One column per header the chain owns. `x-content-type-options` stands for the
// eleven in `SECURE_HEADERS`, which `tests/app.test.ts` asserts in full against
// the record itself.
const COLUMNS = [
  "x-request-id",
  "server-timing",
  "x-content-type-options",
  "access-control-allow-origin",
  "set-cookie",
] as const;

interface Row {
  readonly carries: readonly (typeof COLUMNS)[number][];
  readonly name: string;
  readonly request: Request;
  readonly status: number;
  readonly why: string;
}

const ROWS: readonly Row[] = [
  {
    // `cors` answers the preflight itself, so everything from `timing` inwards
    // never runs: no timings, and no language cookie.
    carries: [
      "x-request-id",
      "x-content-type-options",
      "access-control-allow-origin",
    ],
    name: "the cors preflight",
    request: new Request("http://localhost/?lang=id", {
      headers: {
        "access-control-request-method": "POST",
        origin: ALLOWED_ORIGIN,
      },
      method: "OPTIONS",
    }),
    status: 204,
    why: "answered by cors, the fifth entry",
  },
  {
    // `csrf` is the innermost middleware, so a 403 carries everything the ten
    // outside it add — the language cookie included, and the allowed origin
    // too. Worth knowing why the origin is there: with exactly one entry in
    // `allowedOrigins`, Effect's cors sends that origin to every caller and
    // never compares the request's own (`HttpMiddleware.ts:349`), which is
    // correct — the browser is what refuses a response whose
    // `Access-Control-Allow-Origin` is not its own origin. So this column says
    // the response passed back out through `cors`, not that cors approved it.
    // It still discriminates: move `cors` inside `csrf` and this row loses it.
    carries: [
      "x-request-id",
      "server-timing",
      "x-content-type-options",
      "access-control-allow-origin",
      "set-cookie",
    ],
    name: "the csrf 403",
    request: new Request("http://localhost/?lang=id", {
      headers: { origin: FOREIGN_ORIGIN },
      method: "POST",
    }),
    status: 403,
    why: "answered by csrf, the innermost middleware",
  },
  {
    // `timeout` sits inside `timing` on purpose — a request given up on is one
    // worth timing — and outside `language`, so the cookie is out of reach.
    carries: [
      "x-request-id",
      "server-timing",
      "x-content-type-options",
      "access-control-allow-origin",
    ],
    name: "the timeout 504",
    request: new Request("http://localhost/slow?lang=id", {
      headers: { origin: ALLOWED_ORIGIN },
    }),
    status: 504,
    why: "answered by timeout, the seventh entry",
  },
  {
    // `notFound` is innermost of all, so a 404 carries every column. This is
    // the row that says a failure turned into a response early enough to be
    // dressed like a 200.
    carries: [
      "x-request-id",
      "server-timing",
      "x-content-type-options",
      "access-control-allow-origin",
      "set-cookie",
    ],
    name: "the 404",
    request: new Request("http://localhost/nope?lang=id", {
      headers: { origin: ALLOWED_ORIGIN },
    }),
    status: 404,
    why: "answered by notFound, inside every middleware",
  },
];

describe("what a short-circuited response carries", () => {
  afterAll(() => dispose());

  it.each(ROWS)("$name: $why", async (row) => {
    const response = await handler(row.request);

    assert.strictEqual(response.status, row.status, row.name);

    for (const column of COLUMNS) {
      const carried = row.carries.includes(column);

      assert.strictEqual(
        response.headers.get(column) !== null,
        carried,
        `${row.name} ${carried ? "must carry" : "must not carry"} ${column}`
      );
    }
  });

  // The columns above answer whether a header is there. These two say the
  // values are the real ones, so a row cannot pass on a header set to nothing.
  it("times the 504 it gave up on", async () => {
    const response = await handler(
      new Request("http://localhost/slow?lang=id")
    );

    assert.strictEqual(response.status, 504);
    assert.match(
      response.headers.get("server-timing") ?? "",
      /^total;dur=\d+\.\d;desc="Total Response Time"$/u
    );
  });

  it("dresses the 404 in the headers a 200 gets", async () => {
    const response = await handler(new Request("http://localhost/nope"));

    assert.match(
      response.headers.get("x-request-id") ?? "",
      /^[0-9a-f-]{36}$/u
    );

    for (const [header, value] of Object.entries(SECURE_HEADERS)) {
      assert.strictEqual(response.headers.get(header), value);
    }
  });
});

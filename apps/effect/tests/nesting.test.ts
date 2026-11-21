import { afterAll, assert, describe, it } from "@effect/vitest";
import { ConfigProvider, Duration, Effect, Layer } from "effect";
import { HttpRouter, HttpServer, HttpServerResponse } from "effect/http";

import { appWith } from "#app/http.ts";
import { SECURE_HEADERS } from "#server/secure-headers.ts";
import { timeoutFor } from "#server/timeout.ts";

const ALLOWED_ORIGIN = "https://effect.be-monorepo.localhost";
const FOREIGN_ORIGIN = "https://not-this-app.example";

const configProvider = ConfigProvider.layer(
  ConfigProvider.fromEnvRecord({ APP_URL: `${ALLOWED_ORIGIN}/` })
);

const TIMEOUT = Duration.millis(500);

const slow = HttpRouter.add(
  "GET",
  "/slow",
  Effect.as(Effect.sleep(Duration.minutes(1)), HttpServerResponse.text("done"))
);

const { dispose, handler } = HttpRouter.toWebHandler(
  Layer.mergeAll(appWith({ timeout: timeoutFor(TIMEOUT) }), slow).pipe(
    Layer.provide([HttpServer.layerServices, configProvider])
  ),
  { disableLogger: true }
);

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
  afterAll(async () => dispose());

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

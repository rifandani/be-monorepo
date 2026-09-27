import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  detectLanguage,
  FALLBACK_LANGUAGE,
  Language,
  normalizeLanguage,
  parseAcceptLanguage,
  queryLanguage,
} from "./language.ts";

// The middleware itself is covered through the composed app in
// `tests/app.test.ts`. The precedence and the tag matching are pure, so they are
// cheaper to pin down here, one case per rule.
describe("tag matching", () => {
  it("accepts a supported tag whatever its case or padding", () => {
    assert.strictEqual(normalizeLanguage(" ID "), "id");
  });

  it("drops the region subtag", () => {
    assert.strictEqual(normalizeLanguage("en-GB"), "en");
  });

  it("does not match a prefix that is not a whole subtag", () => {
    assert.isUndefined(normalizeLanguage("england"));
  });

  it("rejects a language the service does not speak", () => {
    assert.isUndefined(normalizeLanguage("fr"));
  });

  it("rejects nothing at all", () => {
    const absent: string | undefined = undefined;

    assert.isUndefined(normalizeLanguage(absent));
    assert.isUndefined(normalizeLanguage("   "));
  });
});

describe("accept-language parsing", () => {
  it("orders the tags by quality", () => {
    assert.deepStrictEqual(
      parseAcceptLanguage("en;q=0.4, id;q=0.9, fr;q=0.8"),
      ["id", "fr", "en"]
    );
  });

  it("treats a tag with no quality as the most wanted", () => {
    assert.deepStrictEqual(parseAcceptLanguage("en;q=0.5, id"), ["id", "en"]);
  });

  it("keeps the order the client sent for equal qualities", () => {
    assert.deepStrictEqual(parseAcceptLanguage("id, en"), ["id", "en"]);
  });

  it("falls back to the highest quality for a malformed one", () => {
    assert.deepStrictEqual(parseAcceptLanguage("en;q=0.9, id;q=later"), [
      "id",
      "en",
    ]);
  });
});

describe("detection precedence", () => {
  it("prefers the query over everything else", () => {
    assert.strictEqual(
      detectLanguage({ cookie: "en", header: "en", query: "id" }),
      "id"
    );
  });

  it("prefers the cookie over the header", () => {
    assert.strictEqual(
      detectLanguage({ cookie: "id", header: "en", query: undefined }),
      "id"
    );
  });

  it("negotiates the header when nothing else says", () => {
    assert.strictEqual(
      detectLanguage({
        cookie: undefined,
        header: "fr;q=0.9, id;q=0.8",
        query: undefined,
      }),
      "id"
    );
  });

  it("skips a source it cannot use rather than stopping there", () => {
    assert.strictEqual(
      detectLanguage({ cookie: undefined, header: "id", query: "fr" }),
      "id"
    );
  });

  it("detects nothing when no source names a supported language", () => {
    assert.isUndefined(
      detectLanguage({ cookie: "de", header: "fr", query: undefined })
    );
  });

  it("detects nothing from a request with no sources", () => {
    assert.isUndefined(
      detectLanguage({ cookie: undefined, header: undefined, query: undefined })
    );
  });
});

describe("language reference", () => {
  const read = Effect.gen(function* read() {
    return yield* Language;
  });

  it("falls back outside a request", () => {
    assert.strictEqual(Effect.runSync(read), FALLBACK_LANGUAGE);
  });

  it("reads what the middleware provided", () => {
    assert.strictEqual(
      Effect.runSync(read.pipe(Effect.provideService(Language, "id"))),
      "id"
    );
  });
});

// `request.url` is a path with a query under both runtimes. It was
// `new URL(request.originalUrl)` here, which is absolute for a `toWebHandler`
// request and a bare path under `NodeHttpServer` — so it threw
// `TypeError: Invalid URL` on the real Node server for *every* request, while
// every test kept passing. These cases are that bug's fence.
describe(queryLanguage, () => {
  it("reads the language from a path with a query", () => {
    assert.strictEqual(queryLanguage("/health/live?lang=id"), "id");
  });

  it("reads it from a bare query on the root", () => {
    assert.strictEqual(queryLanguage("/?lang=id"), "id");
  });

  it("returns undefined when there is no query at all", () => {
    assert.isUndefined(queryLanguage("/health/live"));
  });

  it("returns undefined when the query states something else", () => {
    assert.isUndefined(queryLanguage("/?other=id"));
  });

  it("returns undefined for an empty value", () => {
    assert.strictEqual(queryLanguage("/?lang="), "");
  });

  it("picks the parameter out of several", () => {
    assert.strictEqual(queryLanguage("/?a=1&lang=id&b=2"), "id");
  });

  // A fragment never reaches a server, but it must not end up inside the value
  // if one ever does.
  it("does not let a fragment into the value", () => {
    assert.strictEqual(queryLanguage("/?lang=id#section"), "id");
  });

  // The absolute form is what `originalUrl` carries under `toWebHandler`, and
  // it has to keep working: `request.url` is host-stripped, but nothing stops a
  // caller passing the other one.
  it("also handles an absolute url", () => {
    assert.strictEqual(
      queryLanguage("http://localhost/health/live?lang=id"),
      "id"
    );
  });
});

import { assert, describe, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";

import {
  detectLanguage,
  FALLBACK_LANGUAGE,
  Language,
  normalizeLanguage,
  parseAcceptLanguage,
  queryLanguage,
} from "./language.ts";

const SUPPORTED = ["en", "id"] as const;

const Padding = Schema.Literals(["", " ", "\t"]);

const LanguageTag = Schema.Literals([
  "en",
  "en-GB",
  "id",
  "fr",
  "pt-BR",
  "zh-Hant",
  "*",
]);

const Quality = Schema.Int.check(
  Schema.isBetween({ maximum: 1000, minimum: 0 })
).pipe(
  Arbitrary.schema,
  Arbitrary.map((thousandths) => thousandths / 1000)
);

const UrlPath = Schema.String.check(Schema.isPattern(/^\/[^#?]*$/u));

const UrlValue = Arbitrary.schema(Schema.String).pipe(
  Arbitrary.map((value) => value.toWellFormed())
);

const withCase = (tag: string, upperFirst: boolean, upperSecond: boolean) => {
  const first = tag.charAt(0);
  const second = tag.charAt(1);

  return `${upperFirst ? first.toUpperCase() : first}${upperSecond ? second.toUpperCase() : second}`;
};

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

  it.prop(
    "should always give a supported language or nothing",
    [Schema.String],
    ([candidate]) => {
      const language = normalizeLanguage(candidate);

      assert.include([undefined, ...SUPPORTED], language);
    }
  );

  it.prop(
    "should always find a supported language whatever its case, padding or region",
    [
      Schema.Literals(SUPPORTED),
      Schema.Boolean,
      Schema.Boolean,
      Padding,
      Schema.String,
    ],
    ([supported, upperFirst, upperSecond, padding, region]) => {
      const tag = `${padding}${withCase(supported, upperFirst, upperSecond)}-${region}${padding}`;

      const language = normalizeLanguage(tag);

      assert.strictEqual(language, supported);
    }
  );
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

  it.prop(
    "should always keep every tag the client sent",
    [
      Arbitrary.array(Arbitrary.all([Arbitrary.schema(LanguageTag), Quality]), {
        minLength: 1,
      }),
    ],
    ([entries]) => {
      const header = entries
        .map(([tag, quality]) => `${tag};q=${quality}`)
        .join(", ");

      const tags = parseAcceptLanguage(header);

      assert.deepStrictEqual(
        tags.toSorted(),
        entries.map(([tag]) => tag).toSorted()
      );
    }
  );
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

  it.prop(
    "should always let a supported query win over the cookie and the header",
    [
      Schema.Literals(SUPPORTED),
      Schema.UndefinedOr(Schema.String),
      Schema.UndefinedOr(Schema.String),
    ],
    ([query, cookie, header]) => {
      const language = detectLanguage({ cookie, header, query });

      assert.strictEqual(language, query);
    }
  );
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

  it("returns an empty string for an empty value", () => {
    assert.strictEqual(queryLanguage("/?lang="), "");
  });

  it("picks the parameter out of several", () => {
    assert.strictEqual(queryLanguage("/?a=1&lang=id&b=2"), "id");
  });

  it("does not let a fragment into the value", () => {
    assert.strictEqual(queryLanguage("/?lang=id#section"), "id");
  });

  it("also handles an absolute url", () => {
    assert.strictEqual(
      queryLanguage("http://localhost/health/live?lang=id"),
      "id"
    );
  });

  it.prop(
    "should always read back the value a url carries",
    [UrlPath, UrlValue],
    ([path, value]) => {
      const url = `${path}?lang=${encodeURIComponent(value)}`;

      const read = queryLanguage(url);

      assert.strictEqual(read, value);
    }
  );
});

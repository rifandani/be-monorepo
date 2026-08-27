import { Context, Duration, Effect } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

// `Language` names both the union of supported languages and the reference that
// carries one, which is the same deliberate pair as `HealthReport` in
// `domain/health.ts`. This rule reads it as a mistake.
// oxlint-disable no-redeclare

/**
 * The languages the service answers in, and the one it falls back to.
 *
 * The same pair `apps/hono` configures in
 * `src/core/constants/language.ts`. They live here and not in `domain/` because
 * nothing outside this middleware reads them yet; move them the moment a
 * handler needs to know the set. `SUPPORTED_LANGUAGES` is deliberately not
 * exported for the same reason — `Language` below is the exported surface, and
 * an unexported const still backs it.
 */
const SUPPORTED_LANGUAGES = ["en", "id"] as const;
export const FALLBACK_LANGUAGE = "en";

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// The lookup names and precedence `hono/language` defaults to: a `?lang=`
// query parameter wins over a `language` cookie, which wins over
// `Accept-Language`. Query first is what makes a link shareable in one
// language, cookie next is what makes a choice stick.
const QUERY_PARAM = "lang";
const COOKIE = "language";
const HEADER = "accept-language";
// `hono/language` caches a detected language in a cookie with exactly these
// options.
const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: Duration.days(365),
  sameSite: "strict",
  secure: true,
} as const;

/**
 * The language of the request being served, for a handler or a service to read.
 *
 * A `Context.Reference` for the same reason as `RequestId` in
 * `request-id.ts`: its default keeps it readable anywhere without becoming a
 * requirement. The default is the fallback language, which is what a request
 * that states no preference gets anyway.
 */
export const Language = Context.Reference<Language>(
  "@workspace/effect/Language",
  { defaultValue: (): Language => FALLBACK_LANGUAGE }
);

/**
 * Resolves one candidate tag to a supported language, or to `undefined`.
 *
 * Matching is case insensitive and accepts a region subtag: `en-US` and `EN-us`
 * both resolve to `en`. When several supported languages are a prefix of the
 * candidate the longest wins, so a future `zh-Hant` beats a `zh`.
 */
export const normalizeLanguage = (
  candidate: string | undefined
): Language | undefined => {
  const tag = candidate?.trim().toLowerCase();

  if (tag === undefined || tag === "") {
    return undefined;
  }

  let longest: Language | undefined;

  for (const supported of SUPPORTED_LANGUAGES) {
    if (supported === tag) {
      return supported;
    }

    // A prefix only counts at a subtag boundary: `en` matches `en-GB` but must
    // not match `england`.
    if (
      tag.startsWith(supported) &&
      tag[supported.length] === "-" &&
      supported.length > (longest?.length ?? 0)
    ) {
      longest = supported;
    }
  }

  return longest;
};

/**
 * The tags of an `Accept-Language` header, most wanted first.
 *
 * Deliberately not the tokenizer `hono/language` reaches for through
 * `parseAccept`. That one handles quoted strings and arbitrary parameters
 * because it also serves `Accept`; a language tag has neither, so splitting on
 * the separators is enough and is far easier to read. A malformed `q` falls
 * back to 1, as it does there.
 */
export const parseAcceptLanguage = (header: string): readonly string[] =>
  header
    .split(",")
    .map((entry) => {
      const [tag, ...parameters] = entry.split(";");
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="))
        ?.slice(2);
      const parsed = quality === undefined ? 1 : Number(quality);

      return {
        quality: parsed >= 0 && parsed <= 1 ? parsed : 1,
        tag: tag.trim(),
      };
    })
    // `sort` is stable, so tags that share a quality keep the order the client
    // sent them in — which is the order it meant.
    .toSorted((left, right) => right.quality - left.quality)
    .map((entry) => entry.tag);

/**
 * The language the request asked for, or `undefined` when it asked for nothing
 * this service speaks.
 *
 * Pure, and separate from the middleware below, so the precedence and the
 * matching can be tested without building a request.
 */
export const detectLanguage = (sources: {
  readonly query: string | undefined;
  readonly cookie: string | undefined;
  readonly header: string | undefined;
}): Language | undefined =>
  normalizeLanguage(sources.query) ??
  normalizeLanguage(sources.cookie) ??
  (sources.header === undefined
    ? undefined
    : parseAcceptLanguage(sources.header)
        .map(normalizeLanguage)
        .find((language) => language !== undefined));

/**
 * The `?lang=` value of a request url, if it states one.
 *
 * This reads `request.url` and parses the query itself, where the obvious
 * spelling is `new URL(request.originalUrl).searchParams`. That spelling is a
 * trap, and it is worth knowing why: `originalUrl` is the absolute url the
 * client sent for a `toWebHandler` request, and the raw `req.url` — a bare
 * path — under `NodeHttpServer`. So `new URL` on it succeeds under
 * `tests/app.test.ts` and throws `TypeError: Invalid URL` on the Node server,
 * turning every single request into a 500 that no test can see.
 *
 * `request.url` is `removeHost(originalUrl)` on the web side and `req.url` on
 * the node side, so it is a path with a query in both, and `URLSearchParams`
 * over the part after the `?` needs no host at all. A fragment is never sent to
 * a server, but it is stripped anyway so the value cannot pick one up.
 */
export const queryLanguage = (url: string): string | undefined => {
  const start = url.indexOf("?");

  if (start === -1) {
    return undefined;
  }

  // `split("#")[0]` would read the same and carry an unreachable `?? ""` to
  // satisfy `noUncheckedIndexedAccess`. ADR-0001 asks for code without the
  // branch rather than a branch nothing can cover; both sides of this one are
  // covered.
  const query = url.slice(start + 1);
  const fragment = query.indexOf("#");

  return (
    new URLSearchParams(fragment === -1 ? query : query.slice(0, fragment)).get(
      QUERY_PARAM
    ) ?? undefined
  );
};

/**
 * Language detection, with the same behaviour as `apps/hono` (`src/app.ts`).
 *
 * Effect has no language middleware, so this is a port of `hono/language` with
 * that app's options: `en` and `id` supported, `en` as the fallback, and the
 * default query/cookie/header precedence.
 *
 * A detected language is written back as a cookie so the next request from the
 * same client skips the negotiation. A fallback is not: caching it would turn a
 * request that stated no preference into a client pinned to `en`, which is
 * exactly the case that should keep negotiating. `hono/language` draws the line
 * in the same place.
 */
export const language = HttpRouter.middleware(
  (httpEffect) =>
    // See `cors.ts` for why these are `pipe` and not the two-argument forms.
    HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((request) => {
        const detected = detectLanguage({
          cookie: request.cookies[COOKIE],
          header: request.headers[HEADER],
          query: queryLanguage(request.url),
        });
        const resolved = detected ?? FALLBACK_LANGUAGE;
        const served = httpEffect.pipe(
          Effect.provideService(Language, resolved),
          Effect.annotateLogs("language", resolved)
        );

        return detected === undefined
          ? served
          : // `setCookieUnsafe` and not `setCookie`: the latter fails with a
            // `CookiesError` that would have to be handled or widened out to
            // whatever serves the app, and the value here is one of
            // `SUPPORTED_LANGUAGES` — a constant that cannot fail to encode.
            served.pipe(
              Effect.map(
                HttpServerResponse.setCookieUnsafe(
                  COOKIE,
                  detected,
                  COOKIE_OPTIONS
                )
              )
            );
      })
    ),
  { global: true }
);

import { Context, Duration, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

// oxlint-disable no-redeclare

const SUPPORTED_LANGUAGES = ["en", "id"] as const;
export const FALLBACK_LANGUAGE = "en";

export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const QUERY_PARAM = "lang";
const COOKIE = "language";
const HEADER = "accept-language";

const COOKIE_OPTIONS = {
  httpOnly: true,
  maxAge: Duration.days(365),
  sameSite: "strict",
  secure: true,
} as const;

export const Language = Context.Reference<Language>(
  "@workspace/effect/Language",
  { defaultValue: (): Language => FALLBACK_LANGUAGE }
);

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
    .toSorted((left, right) => right.quality - left.quality)
    .map((entry) => entry.tag);

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

export const queryLanguage = (url: string): string | undefined => {
  const start = url.indexOf("?");

  if (start === -1) {
    return undefined;
  }

  const query = url.slice(start + 1);
  const fragment = query.indexOf("#");

  return (
    new URLSearchParams(fragment === -1 ? query : query.slice(0, fragment)).get(
      QUERY_PARAM
    ) ?? undefined
  );
};

export const language = HttpRouter.middleware(
  (httpEffect) =>
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
          : served.pipe(
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

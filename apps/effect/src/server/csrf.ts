import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { ALLOWED_ORIGIN } from "./origin.ts";

const SAFE_METHOD = /^(?:GET|HEAD|OPTIONS)$/u;

const FORM_CONTENT_TYPE =
  /^\b(?:application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/iu;

const ASSUMED_CONTENT_TYPE = "text/plain";
const FORBIDDEN = HttpServerResponse.text("Forbidden", { status: 403 });

export interface CsrfRequest {
  readonly method: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export const isCrossSiteFormPost = (
  request: CsrfRequest,
  allowedOrigin: string
): boolean => {
  if (SAFE_METHOD.test(request.method)) {
    return false;
  }

  const contentType = request.headers["content-type"] ?? ASSUMED_CONTENT_TYPE;

  if (!FORM_CONTENT_TYPE.test(contentType)) {
    return false;
  }

  if (request.headers["sec-fetch-site"] === "same-origin") {
    return false;
  }

  return request.headers.origin !== allowedOrigin;
};

export const csrf = Layer.unwrap(
  Effect.map(ALLOWED_ORIGIN, (allowedOrigin) =>
    HttpRouter.middleware(
      (httpEffect) =>
        Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
          isCrossSiteFormPost(request, allowedOrigin)
            ? Effect.succeed(FORBIDDEN)
            : httpEffect
        ),
      { global: true }
    )
  )
);

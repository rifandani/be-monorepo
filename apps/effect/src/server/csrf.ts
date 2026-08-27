import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

import { APP_URL } from "#config.ts";

// The same tests `hono/csrf` applies, in the same order. A request is rejected
// only when every one of them agrees it looks like a cross-site form post.
const SAFE_METHOD = /^(?:GET|HEAD|OPTIONS)$/u;
// The content types an HTML form can send without a preflight. Anything else —
// `application/json`, for one — cannot leave a form element, so the same-origin
// policy already stops it and CORS governs the rest.
const FORM_CONTENT_TYPE =
  /^\b(?:application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)\b/iu;
// A request with no `Content-Type` is treated as `text/plain`, which is what a
// form sends when it omits the header. `hono/csrf` makes the same assumption.
const ASSUMED_CONTENT_TYPE = "text/plain";
const FORBIDDEN = HttpServerResponse.text("Forbidden", { status: 403 });

/**
 * CSRF, with the same policy as `apps/hono` (`src/app.ts`): one allowed origin,
 * read from the environment.
 *
 * Effect has no CSRF middleware, so this is a port of `hono/csrf`. It is a
 * header check, not a token: a state-changing request has to carry either
 * `Sec-Fetch-Site: same-origin` or an `Origin` matching `APP_URL`, and neither
 * header can be forged by a page from another site.
 *
 * `OPTIONS` counts as safe here, so a CORS preflight is never rejected — which
 * matters because `cors.ts` answers those before any handler runs.
 *
 * The 403 is returned as a response rather than raised as a failure. A failure
 * would need the error channel widened all the way to whatever serves the app;
 * the outcome the client sees is identical.
 */
export const csrf = Layer.unwrap(
  // See `cors.ts` for why this is `pipe` and not `Effect.map(APP_URL, ...)`.
  APP_URL.pipe(
    Effect.map((url) => {
      const allowedOrigin = url.origin;

      const isCrossSiteFormPost = (
        request: HttpServerRequest.HttpServerRequest
      ) => {
        if (SAFE_METHOD.test(request.method)) {
          return false;
        }

        const contentType =
          request.headers["content-type"] ?? ASSUMED_CONTENT_TYPE;

        if (!FORM_CONTENT_TYPE.test(contentType)) {
          return false;
        }

        if (request.headers["sec-fetch-site"] === "same-origin") {
          return false;
        }

        return request.headers.origin !== allowedOrigin;
      };

      return HttpRouter.middleware(
        (httpEffect) =>
          // `pipe` again, for the same oxlint reason as above.
          HttpServerRequest.HttpServerRequest.pipe(
            Effect.flatMap((request) =>
              isCrossSiteFormPost(request)
                ? Effect.succeed(FORBIDDEN)
                : httpEffect
            )
          ),
        { global: true }
      );
    })
  )
);

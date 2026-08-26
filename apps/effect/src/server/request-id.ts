import { Context, Effect } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";

// Lowercase because that is how Effect keys an incoming header. Header names are
// case insensitive, so the response carries the same name `apps/hono` sends.
const HEADER = "x-request-id";
// The bounds `hono/request-id` applies to an inbound id before it trusts it. An
// id is echoed into logs and into the response, so an unbounded or unescaped one
// from a client is a log injection waiting to happen.
const LIMIT_LENGTH = 255;
const VALID_ID = /^[\w\-=]+$/u;

/**
 * The id of the request being served, for a handler or a service to read.
 *
 * A `Context.Reference` and not a `Context.Service`, so its default makes it
 * readable anywhere without becoming a requirement that every caller — and
 * every test — has to satisfy. The default is empty: reading it outside a
 * request is not an error, it is just not a request.
 */
export const RequestId = Context.Reference<string>(
  "@workspace/effect/RequestId",
  { defaultValue: () => "" }
);

/**
 * Request id, with the same behaviour as `apps/hono` (`src/app.ts`): trust an
 * inbound `X-Request-Id` when it is well formed, generate a UUID otherwise, and
 * send it back on the response.
 *
 * Effect has no request id middleware, so this is a port of
 * `hono/request-id`. Trusting the inbound header is what makes an id survive a
 * hop, which is the only reason to have one — a proxy or an upstream service
 * assigns it once and every log line downstream can be joined on it.
 *
 * `globalThis.crypto.randomUUID` rather than Effect's `Crypto` service: the
 * service has no default, so taking it would push a `Crypto` requirement
 * through `app` and out into both entrypoints and every test, and a correlation
 * token is not a value that needs a swappable source. Use `Crypto.Crypto` with
 * `NodeCrypto.layer` and `BunCrypto.layer` if the id ever has to be pinned.
 *
 * Note what this does not reach: `HttpRouter.serve` and
 * `HttpRouter.toWebHandler` apply `HttpMiddleware.logger` *outside* the router,
 * so the framework's own per-request log line is emitted beyond the annotation
 * below and does not carry the id. Handler logs do. Passing this through the
 * `middleware` option of either function instead is what would change that.
 */
export const requestId = HttpRouter.middleware(
  (httpEffect) =>
    // See `cors.ts` for why these are `pipe` and not the two-argument forms.
    HttpServerRequest.HttpServerRequest.pipe(
      Effect.flatMap((request) => {
        const inbound = request.headers[HEADER];

        return inbound !== undefined &&
          inbound.length <= LIMIT_LENGTH &&
          VALID_ID.test(inbound)
          ? Effect.succeed(inbound)
          : Effect.sync(() => globalThis.crypto.randomUUID());
      }),
      Effect.flatMap((id) =>
        httpEffect.pipe(
          Effect.provideService(RequestId, id),
          Effect.annotateLogs("requestId", id),
          Effect.map(HttpServerResponse.setHeader(HEADER, id))
        )
      )
    ),
  { global: true }
);

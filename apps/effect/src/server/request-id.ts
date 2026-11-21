import { Context, Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

const HEADER = "x-request-id";

const LIMIT_LENGTH = 255;
const VALID_ID = /^[\w\-=]+$/u;

export const RequestId = Context.Reference<string>(
  "@workspace/effect/RequestId",
  { defaultValue: () => "" }
);

export const requestId = HttpRouter.middleware(
  (httpEffect) =>
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

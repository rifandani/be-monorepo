import { Duration, Effect } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";

const TIMEOUT = Duration.seconds(15);

const GATEWAY_TIMEOUT = HttpServerResponse.text("Gateway Timeout", {
  status: 504,
});

export const withTimeout =
  (duration: Duration.Duration) =>
  <E, R>(
    self: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
    self.pipe(
      Effect.timeoutOrElse({
        duration,
        orElse: () =>
          Effect.as(
            Effect.logWarning("Request timed out").pipe(
              Effect.annotateLogs("timeout", Duration.format(duration))
            ),
            GATEWAY_TIMEOUT
          ),
      })
    );

export const timeoutFor = (duration: Duration.Duration) =>
  HttpRouter.middleware(withTimeout(duration), { global: true });

export const timeout = timeoutFor(TIMEOUT);

import { Duration, Effect, Schema } from "effect";
import {
  HttpRouter,
  HttpServerRespondable,
  HttpServerResponse,
} from "effect/http";

export const INBOUND_TIMEOUT = Duration.seconds(15);

export const OUTBOUND_TIMEOUT = Duration.seconds(10);

const GATEWAY_TIMEOUT_STATUS = 504;

const GATEWAY_TIMEOUT = HttpServerResponse.text("Gateway Timeout", {
  status: GATEWAY_TIMEOUT_STATUS,
});

export class OutcomeUnknown extends Schema.TaggedError<OutcomeUnknown>()(
  "OutcomeUnknown",
  { operation: Schema.String },
  {
    description:
      "An outbound call did not answer in time, so its outcome is unknown",
    identifier: "OutcomeUnknown",
    httpApiStatus: GATEWAY_TIMEOUT_STATUS,
  }
) {
  readonly status = GATEWAY_TIMEOUT_STATUS;

  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.empty({ status: this.status }));
  }
}

export const withOutboundTimeout =
  (operation: string) =>
  <A, E, R>(
    self: Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | OutcomeUnknown, R> =>
    self.pipe(
      Effect.timeoutOrElse({
        duration: OUTBOUND_TIMEOUT,
        orElse: () => Effect.fail(new OutcomeUnknown({ operation })),
      })
    );

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

export const timeout = timeoutFor(INBOUND_TIMEOUT);

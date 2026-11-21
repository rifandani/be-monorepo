import {
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from "@opentelemetry/semantic-conventions";
import { Effect, Metric } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { now } from "./timing.ts";

const MILLISECONDS_PER_SECOND = 1000;

const DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

export const requestDuration = Metric.histogram(
  METRIC_HTTP_SERVER_REQUEST_DURATION,
  {
    description: "Duration of inbound HTTP requests, in seconds",
    boundaries: DURATION_BOUNDARIES,
  }
);

export const requestAttributes = (options: {
  readonly method: string;
  readonly status: number;
}) => ({
  [ATTR_HTTP_REQUEST_METHOD]: options.method,
  [ATTR_HTTP_RESPONSE_STATUS_CODE]: String(options.status),
});

const recordRequest = (options: {
  readonly method: string;
  readonly status: number;
  readonly duration: number;
}): Effect.Effect<void> =>
  Metric.update(
    Metric.withAttributes(requestDuration, requestAttributes(options)),
    options.duration / MILLISECONDS_PER_SECOND
  );

export const metrics = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const start = now();

      return Effect.gen(function* record() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* httpEffect;

        yield* recordRequest({
          duration: now() - start,
          method: request.method,
          status: response.status,
        });

        return response;
      });
    }),
  { global: true }
);

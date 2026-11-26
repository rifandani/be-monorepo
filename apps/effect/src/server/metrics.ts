import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
  ATTR_HTTP_RESPONSE_STATUS_CODE,
  METRIC_HTTP_SERVER_REQUEST_DURATION,
} from "@opentelemetry/semantic-conventions";
import { METRIC_HTTP_SERVER_ACTIVE_REQUESTS } from "@opentelemetry/semantic-conventions/incubating";
import { Effect, Metric } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { now } from "./timing.ts";

const MILLISECONDS_PER_SECOND = 1000;

const DURATION_BOUNDARIES = [
  0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10,
];

const METRIC_HTTP_SERVER_FAILED_REQUESTS = "http.server.failed_requests";

const METRIC_HTTP_SERVER_ADMISSION_REJECTIONS =
  "http.server.admission.rejections";

const ATTR_BULKHEAD = "bulkhead";

export const requestDuration = Metric.histogram(
  METRIC_HTTP_SERVER_REQUEST_DURATION,
  {
    description: "Duration of inbound HTTP requests, in seconds",
    boundaries: DURATION_BOUNDARIES,
  }
);

export const activeRequests = Metric.counter(
  METRIC_HTTP_SERVER_ACTIVE_REQUESTS,
  { description: "Number of inbound HTTP requests in flight" }
);

export const failedRequests = Metric.counter(
  METRIC_HTTP_SERVER_FAILED_REQUESTS,
  {
    description: "Number of inbound HTTP requests that failed on the server",
    incremental: true,
  }
);

export type Bulkhead = "requests" | "probes";

export const admissionRejections = Metric.counter(
  METRIC_HTTP_SERVER_ADMISSION_REJECTIONS,
  {
    description: "Number of inbound HTTP requests that admission rejected",
    incremental: true,
  }
);

export const bulkheadAttributes = (bulkhead: Bulkhead) => ({
  [ATTR_BULKHEAD]: bulkhead,
});

export type FailureKind = "timeout" | "rejected" | "upstream" | "defect";

const SERVER_ERROR_MIN = 500;

const FAILURE_KINDS: ReadonlyMap<number, FailureKind> = new Map([
  [502, "upstream"],
  [503, "rejected"],
  [504, "timeout"],
]);

export const failureKind = (status: number): FailureKind | undefined => {
  if (status < SERVER_ERROR_MIN) {
    return undefined;
  }

  return FAILURE_KINDS.get(status) ?? "defect";
};

export const requestAttributes = (options: {
  readonly method: string;
  readonly status: number;
}) => ({
  [ATTR_HTTP_REQUEST_METHOD]: options.method,
  [ATTR_HTTP_RESPONSE_STATUS_CODE]: String(options.status),
});

export const failureAttributes = (options: {
  readonly method: string;
  readonly kind: FailureKind;
}) => ({
  [ATTR_HTTP_REQUEST_METHOD]: options.method,
  [ATTR_ERROR_TYPE]: options.kind,
});

const recordFailure = (options: {
  readonly method: string;
  readonly status: number;
}): Effect.Effect<void> => {
  const kind = failureKind(options.status);

  return kind === undefined
    ? Effect.void
    : Metric.update(
        Metric.withAttributes(
          failedRequests,
          failureAttributes({ kind, method: options.method })
        ),
        1
      );
};

const recordRequest = (options: {
  readonly method: string;
  readonly status: number;
  readonly duration: number;
}): Effect.Effect<void> =>
  Effect.andThen(
    Metric.update(
      Metric.withAttributes(requestDuration, requestAttributes(options)),
      options.duration / MILLISECONDS_PER_SECOND
    ),
    recordFailure(options)
  );

const inFlight = <A, E, R>(
  self: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Metric.update(activeRequests, 1),
    () => self,
    () => Metric.update(activeRequests, -1)
  );

export const metrics = HttpRouter.middleware(
  (httpEffect) =>
    Effect.suspend(() => {
      const start = now();

      return Effect.gen(function* record() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const response = yield* inFlight(httpEffect);

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

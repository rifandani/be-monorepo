import type { Meter } from "@opentelemetry/api";
import {
  ATTR_ERROR_TYPE,
  ATTR_HTTP_REQUEST_METHOD,
} from "@opentelemetry/semantic-conventions";
import type { MiddlewareHandler } from "hono";

import { failureKind } from "#shared/utils/failure-class.ts";

export const METRIC_HTTP_SERVER_FAILED_REQUESTS = "http.server.failed_requests";

export const METRIC_HTTP_SERVER_ADMISSION_REJECTIONS =
  "http.server.admission.rejections";

export const ATTR_BULKHEAD = "bulkhead";

export const failedRequestsMiddleware = (meter: Meter): MiddlewareHandler => {
  const failedRequests = meter.createCounter(
    METRIC_HTTP_SERVER_FAILED_REQUESTS,
    {
      description: "Number of inbound HTTP requests that failed on the server",
    }
  );

  return async (c, next) =>
    next().finally(() => {
      const kind = failureKind(c.res.status);

      if (kind !== undefined) {
        failedRequests.add(1, {
          [ATTR_ERROR_TYPE]: kind,
          [ATTR_HTTP_REQUEST_METHOD]: c.req.method,
        });
      }
    });
};

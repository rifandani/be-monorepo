import type { Meter } from "@opentelemetry/api";
import type { MiddlewareHandler } from "hono";

import { HTTP_STATUS_CODES } from "#shared/constants/http.ts";

import {
  ATTR_BULKHEAD,
  METRIC_HTTP_SERVER_ADMISSION_REJECTIONS,
} from "./metrics.ts";

export const RETRY_AFTER_SECONDS = 1;

const SERVICE_UNAVAILABLE_MESSAGE = "Service Unavailable";

interface AdmissionOptions {
  readonly requests: number;
  readonly probes: number;
  readonly isProbePath: (path: string) => boolean;
  readonly meter: Meter;
}

const makeBulkhead = (capacity: number) => {
  let inFlight = 0;

  return {
    release: () => {
      inFlight -= 1;
    },
    tryEnter: (): boolean => {
      if (inFlight >= capacity) {
        return false;
      }

      inFlight += 1;

      return true;
    },
  };
};

export const admissionMiddleware = (
  options: AdmissionOptions
): MiddlewareHandler => {
  const requests = makeBulkhead(options.requests);
  const probes = makeBulkhead(options.probes);

  const rejections = options.meter.createCounter(
    METRIC_HTTP_SERVER_ADMISSION_REJECTIONS,
    { description: "Number of inbound HTTP requests that admission rejected" }
  );

  return async (c, next) => {
    const isProbe = options.isProbePath(c.req.path);
    const bulkhead = isProbe ? probes : requests;

    if (!bulkhead.tryEnter()) {
      rejections.add(1, { [ATTR_BULKHEAD]: isProbe ? "probes" : "requests" });

      return c.json(
        { message: SERVICE_UNAVAILABLE_MESSAGE },
        HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
        { "Retry-After": String(RETRY_AFTER_SECONDS) }
      );
    }

    return next().finally(bulkhead.release);
  };
};

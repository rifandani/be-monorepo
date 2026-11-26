import type { MiddlewareHandler } from "hono";

import { HTTP_STATUS_CODES } from "#shared/constants/http.ts";

export const RETRY_AFTER_SECONDS = 1;

const SERVICE_UNAVAILABLE_MESSAGE = "Service Unavailable";

interface AdmissionOptions {
  readonly requests: number;
  readonly probes: number;
  readonly isProbePath: (path: string) => boolean;
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

  return async (c, next) => {
    const bulkhead = options.isProbePath(c.req.path) ? probes : requests;

    if (!bulkhead.tryEnter()) {
      return c.json(
        { message: SERVICE_UNAVAILABLE_MESSAGE },
        HTTP_STATUS_CODES.SERVICE_UNAVAILABLE,
        { "Retry-After": String(RETRY_AFTER_SECONDS) }
      );
    }

    return next().finally(bulkhead.release);
  };
};

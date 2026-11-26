import { Effect, Layer, Metric, Option, Semaphore } from "effect";
import type { Config } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  MAX_IN_FLIGHT_PROBES,
  MAX_IN_FLIGHT_REQUESTS,
  readAll,
} from "#shared/config.ts";

import { admissionRejections, bulkheadAttributes } from "./metrics.ts";
import type { Bulkhead } from "./metrics.ts";
import { pathOf } from "./probes.ts";

export const RETRY_AFTER_SECONDS = 1;

const SERVICE_UNAVAILABLE_STATUS = 503;

const serviceUnavailable = () =>
  HttpServerResponse.jsonUnsafe(
    { message: "Service Unavailable" },
    {
      headers: { "retry-after": String(RETRY_AFTER_SECONDS) },
      status: SERVICE_UNAVAILABLE_STATUS,
    }
  );

const reject = (bulkhead: Bulkhead) =>
  Effect.as(
    Metric.update(
      Metric.withAttributes(admissionRejections, bulkheadAttributes(bulkhead)),
      1
    ),
    serviceUnavailable()
  );

export const withAdmission =
  (semaphore: Semaphore.Semaphore, bulkhead: Bulkhead) =>
  <E, R>(
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
    semaphore
      .withPermitsIfAvailable(1)(httpEffect)
      .pipe(
        Effect.flatMap(
          Option.match({
            onNone: () => reject(bulkhead),
            onSome: Effect.succeed,
          })
        )
      );

interface AdmissionOptions {
  readonly requests: number;
  readonly probes: number;
  readonly isProbePath: (path: string) => boolean;
}

const admissionFor = (options: AdmissionOptions) =>
  Layer.unwrap(
    Effect.gen(function* makeAdmission() {
      const requests = withAdmission(
        yield* Semaphore.make(options.requests),
        "requests"
      );

      const probes = withAdmission(
        yield* Semaphore.make(options.probes),
        "probes"
      );

      return HttpRouter.middleware(
        (httpEffect) =>
          Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
            options.isProbePath(pathOf(request.url))
              ? probes(httpEffect)
              : requests(httpEffect)
          ),
        { global: true }
      );
    })
  );

export const admission = (
  isProbePath: (path: string) => boolean
): Layer.Layer<never, Config.ConfigError, HttpRouter.HttpRouter> =>
  Layer.unwrap(
    Effect.gen(function* readCapacity() {
      const { probes, requests } = yield* readAll({
        probes: MAX_IN_FLIGHT_PROBES,
        requests: MAX_IN_FLIGHT_REQUESTS,
      });

      return admissionFor({ isProbePath, probes, requests });
    })
  );

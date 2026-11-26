import { Effect, Layer, Option, Semaphore } from "effect";
import type { Config } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  MAX_IN_FLIGHT_PROBES,
  MAX_IN_FLIGHT_REQUESTS,
} from "#shared/config.ts";

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

export const withAdmission =
  (semaphore: Semaphore.Semaphore) =>
  <E, R>(
    httpEffect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
  ): Effect.Effect<HttpServerResponse.HttpServerResponse, E, R> =>
    semaphore
      .withPermitsIfAvailable(1)(httpEffect)
      .pipe(Effect.map(Option.getOrElse(serviceUnavailable)));

interface AdmissionOptions {
  readonly requests: number;
  readonly probes: number;
  readonly isProbePath: (path: string) => boolean;
}

const admissionFor = (options: AdmissionOptions) =>
  Layer.unwrap(
    Effect.gen(function* makeAdmission() {
      const requests = withAdmission(yield* Semaphore.make(options.requests));
      const probes = withAdmission(yield* Semaphore.make(options.probes));

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
      const requests = yield* MAX_IN_FLIGHT_REQUESTS;
      const probes = yield* MAX_IN_FLIGHT_PROBES;

      return admissionFor({ isProbePath, probes, requests });
    })
  );

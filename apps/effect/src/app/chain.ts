import { Layer } from "effect";
import type { Config } from "effect";
import type { HttpRouter } from "effect/http";

import { cors } from "#server/cors.ts";
import { csrf } from "#server/csrf.ts";
import { onError } from "#server/error.ts";
import { language } from "#server/language.ts";
import { metrics } from "#server/metrics.ts";
import { notFound } from "#server/not-found.ts";
import { requestId } from "#server/request-id.ts";
import { secureHeaders } from "#server/secure-headers.ts";
import { timeout } from "#server/timeout.ts";
import { timing } from "#server/timing.ts";

import { quietProbes } from "./probes.ts";

type MiddlewareLayer = Layer.Layer<
  never,
  Config.ConfigError,
  HttpRouter.HttpRouter
>;

export const CHAIN = [
  { layer: requestId, name: "requestId" },
  { layer: metrics, name: "metrics" },
  { layer: quietProbes, name: "quietProbes" },
  { layer: secureHeaders, name: "secureHeaders" },
  { layer: cors, name: "cors" },
  { layer: timing, name: "timing" },
  { layer: timeout, name: "timeout" },
  { layer: language, name: "language" },
  { layer: csrf, name: "csrf" },
  { layer: onError, name: "onError" },
  { layer: notFound, name: "notFound" },
] as const satisfies readonly {
  readonly layer: MiddlewareLayer;
  readonly name: string;
}[];

type Middleware = (typeof CHAIN)[number];

export type Overrides = Partial<Record<Middleware["name"], MiddlewareLayer>>;

export const chain = (overrides: Overrides): MiddlewareLayer => {
  const layerOf = (entry: Middleware): MiddlewareLayer =>
    overrides[entry.name] ?? entry.layer;

  const [outermost, ...rest] = CHAIN;

  return rest.reduce<MiddlewareLayer>(
    (composed, entry) => composed.pipe(Layer.flatMap(() => layerOf(entry))),
    layerOf(outermost)
  );
};

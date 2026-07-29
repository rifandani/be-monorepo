import type { DrainContext, EnrichContext } from "evlog";
import {
  createRequestSizeEnricher,
  createTraceContextEnricher,
  createUserAgentEnricher,
} from "evlog/enrichers";
import type { EvlogHonoOptions } from "evlog/hono";
import { createOTLPDrain } from "evlog/otlp";
import { createDrainPipeline } from "evlog/pipeline";

import { ENV } from "@/core/constants/env.js";
import { SERVICE_NAME, SERVICE_VERSION } from "@/core/constants/global.js";

const enrichers = [
  createUserAgentEnricher(),
  createRequestSizeEnricher(),
  createTraceContextEnricher(),
];

const pipeline = createDrainPipeline<DrainContext>({
  batch: { intervalMs: 5000, size: 50 },
  retry: { maxAttempts: 3 },
});

const drain = pipeline(
  createOTLPDrain({
    endpoint: ENV.OTEL_EXPORTER_OTLP_ENDPOINT,
    resourceAttributes: {
      "deployment.environment": process.env.NODE_ENV ?? "development",
      "service.version": SERVICE_VERSION,
    },
    serviceName: SERVICE_NAME,
  })
);

export const flushEvlogDrain = () => drain.flush();

export const evlogMiddlewareOptions = {
  drain,
  exclude: ["/openapi", "/openapi/**"],
  enrich: (ctx: EnrichContext) => {
    for (const enricher of enrichers) {
      enricher(ctx);
    }
  },
  keep: (ctx) => {
    if (ctx.duration && ctx.duration > 2000) {
      ctx.shouldKeep = true;
    }
  },
} satisfies EvlogHonoOptions;

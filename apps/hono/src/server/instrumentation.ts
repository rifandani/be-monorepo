import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import {
  resourceFromAttributes,
  envDetector,
  hostDetector,
  osDetector,
  serviceInstanceIdDetector,
  processDetector,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { initLogger, log } from "evlog";

import { flushEvlogDrain } from "#server/observability/evlog.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/constants/global.ts";

initLogger({
  env: { service: SERVICE_NAME, version: SERVICE_VERSION },
  sampling: {
    rates: { info: 10 },
    keep: [{ status: 400 }, { status: 500 }, { duration: 1000 }],
  },
});

const sdk = new NodeSDK({
  serviceName: SERVICE_NAME,
  instrumentations: [
    new PgInstrumentation({
      addSqlCommenterCommentToQueries: true,
      enhancedDatabaseReporting: true,
    }),
  ],
  resourceDetectors: [
    envDetector,
    hostDetector,
    osDetector,
    serviceInstanceIdDetector,
    processDetector,
  ],
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
  ],
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  }),
  traceExporter: new OTLPTraceExporter(),
});

export const shutdownObservability = async () => {
  await flushEvlogDrain();
  await sdk.shutdown();
};

sdk.start();

log.info("instrumentation", "Instrumentation started");

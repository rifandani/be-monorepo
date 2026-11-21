import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Effect } from "effect";

import { OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_LOG_LEVEL } from "#shared/config.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/metadata.ts";

const signalBase = (endpoint: URL): string =>
  endpoint.toString().replace(/\/+$/u, "");

const setDiagLogger = (level: keyof typeof DiagLogLevel): void => {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel[level]);
};

export const observability = NodeSdk.layer(
  Effect.gen(function* telemetry() {
    const base = signalBase(yield* OTEL_EXPORTER_OTLP_ENDPOINT);

    setDiagLogger(yield* OTEL_LOG_LEVEL);

    return {
      resource: {
        serviceName: SERVICE_NAME,
        serviceVersion: SERVICE_VERSION,
      },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${base}/v1/traces` })
      ),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: `${base}/v1/metrics`,
        }),
      }),
      logRecordProcessor: new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
      }),
    };
  })
);

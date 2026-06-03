// import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
// import { DnsInstrumentation } from "@opentelemetry/instrumentation-dns";
// import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
// import { NetInstrumentation } from "@opentelemetry/instrumentation-net";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
// import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
// import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import {
  resourceFromAttributes,
  envDetector,
  hostDetector,
  osDetector,
  serviceInstanceIdDetector,
  processDetector,
} from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node"; // use @microlabs/otel-cf-workers instead in cloudflare workers
// import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import { initLogger, log } from "evlog";

import { SERVICE_NAME, SERVICE_VERSION } from "@/core/constants/global.js";
import { flushEvlogDrain } from "@/core/utils/evlog.js";

initLogger({
  env: { service: SERVICE_NAME, version: SERVICE_VERSION },
  // 4. Head sampling - keep 10% of info logs
  sampling: {
    rates: { info: 10 },
    keep: [
      { status: 400 }, // Always keep errors
      { status: 500 }, // Always keep errors
      { duration: 1000 }, // Always keep slow requests
      // { path: '/api/critical/**' }, // Always keep critical paths
    ],
  },
});

// Custom File Span Exporter
// class FileSpanExporter implements SpanExporter {
//   private traceFile: string;

//   constructor() {
//     const tracesDir = path.join(process.cwd(), '.traces');
//     if (!fs.existsSync(tracesDir)) {
//       fs.mkdirSync(tracesDir, { recursive: true });
//     }
//     this.traceFile = path.join(
//       tracesDir,
//       `trace-${new Date().toISOString().split('T')[0]}.json`
//     );

//     // Initialize file with empty array if it doesn't exist
//     if (!fs.existsSync(this.traceFile)) {
//       fs.writeFileSync(this.traceFile, '[]');
//     }
//   }

//   export(
//     spans: ReadableSpan[],
//     resultCallback: (result: ExportResult) => void
//   ): void {
//     try {
//       const spanData = spans.map((span) => ({
//         traceId: span.spanContext().traceId,
//         spanId: span.spanContext().spanId,
//         parentSpanId: span.spanContext().spanId,
//         name: span.name,
//         kind: span.kind,
//         startTime: span.startTime,
//         endTime: span.endTime,
//         duration: span.duration,
//         status: span.status,
//         attributes: span.attributes,
//         events: span.events,
//         resource: span.resource.attributes,
//       }));

//       const traceEntry = {
//         timestamp: new Date().toISOString(),
//         spans: spanData,
//       };

//       // Read existing JSON array, append new entry, and write back
//       const existingData = fs.readFileSync(this.traceFile, 'utf8');
//       const existingArray = JSON.parse(existingData) as (typeof traceEntry)[];
//       existingArray.push(traceEntry);

//       fs.writeFileSync(this.traceFile, JSON.stringify(existingArray, null, 2));
//       resultCallback({ code: ExportResultCode.SUCCESS });
//     } catch (error) {
//       resultCallback({ code: ExportResultCode.FAILED, error: error as Error });
//     }
//   }

//   async shutdown(): Promise<void> {
//     // No cleanup needed for file exporter
//   }
// }

// const openApiRegex = /^\/openapi(?:\/.*)?$/u;
// const wellKnownRegex = /^\/\.well-known\/.*/u;
// const imageRegex = /\.(?:png|jpg|jpeg|gif|svg|ico|webp)$/iu;

const sdk = new NodeSDK({
  serviceName: SERVICE_NAME,
  instrumentations: [
    // new DnsInstrumentation(), too verbose
    // new FsInstrumentation(), too verbose
    // new HttpInstrumentation({
    //   ignoreIncomingRequestHook: (request) =>
    //     openApiRegex.test(request.url ?? "") ||
    //     wellKnownRegex.test(request.url ?? "") ||
    //     imageRegex.test(request.url ?? ""),
    // }),
    // new NetInstrumentation(), too verbose
    new PgInstrumentation({
      addSqlCommenterCommentToQueries: true,
      enhancedDatabaseReporting: true,
    }),
    // new RuntimeNodeInstrumentation(), too verbose
    // new UndiciInstrumentation(), too verbose
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
  // already handled by evlog
  // logRecordProcessors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
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

// import * as fs from 'node:fs';
// import * as path from 'node:path';
import { DiagConsoleLogger, DiagLogLevel, diag } from '@opentelemetry/api';
// import { type ExportResult, ExportResultCode } from '@opentelemetry/core';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { DnsInstrumentation } from '@opentelemetry/instrumentation-dns';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { NetInstrumentation } from '@opentelemetry/instrumentation-net';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';
// import type { ReadableSpan, SpanExporter } from '@opentelemetry/sdk-trace-base';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { ENV } from '@/core/constants/env.js';
import { SERVICE_NAME, SERVICE_VERSION } from '@/core/constants/global.js';

const logLevelMap: Record<string, DiagLogLevel> = {
  ALL: DiagLogLevel.ALL,
  VERBOSE: DiagLogLevel.VERBOSE,
  DEBUG: DiagLogLevel.DEBUG,
  INFO: DiagLogLevel.INFO, // default
  WARN: DiagLogLevel.WARN,
  ERROR: DiagLogLevel.ERROR,
  NONE: DiagLogLevel.NONE,
};

// for troubleshooting, set the log level to DEBUG
diag.setLogger(new DiagConsoleLogger(), logLevelMap[ENV.OTEL_LOG_LEVEL]);

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

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
  }),
  // new ConsoleSpanExporter(), // or new FileSpanExporter()
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [
    new DnsInstrumentation(),
    // new FsInstrumentation(), too verbose
    new HttpInstrumentation({
      ignoreIncomingRequestHook: (request) => {
        const openApiRegex = /^\/openapi(?:\/.*)?$/;
        const wellKnownRegex = /^\/\.well-known\/.*/;
        const imageRegex = /\.(?:png|jpg|jpeg|gif|svg|ico|webp)$/i;

        return (
          openApiRegex.test(request.url ?? '') ||
          wellKnownRegex.test(request.url ?? '') ||
          imageRegex.test(request.url ?? '')
        );
      },
    }),
    new NetInstrumentation(),
    new PgInstrumentation({
      enhancedDatabaseReporting: true,
      addSqlCommenterCommentToQueries: true,
    }),
    new RuntimeNodeInstrumentation(),
    new UndiciInstrumentation(),
  ],
});

sdk.start();
console.log('Instrumentation started');

import { SeverityNumber } from "@opentelemetry/api-logs";
import type {
  AnyValue,
  AnyValueMap,
  Logger as ApiLogsLogger,
} from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchLogRecordProcessor,
  LoggerProvider,
  // ConsoleLogRecordExporter
} from "@opentelemetry/sdk-logs";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

import { SERVICE_NAME, SERVICE_VERSION } from "@/core/constants/global.js";

const COLOR = {
  BLUE: "\u001B[34m",
  GREEN: "\u001B[32m",
  RED: "\u001B[31m",
  WHITE: "\u001B[37m",
  YELLOW: "\u001B[33m",
};

const LEVEL_COLORS = {
  DEBUG: COLOR.GREEN,
  ERROR: COLOR.RED,
  FATAL: COLOR.RED,
  INFO: COLOR.BLUE,
  TRACE: COLOR.WHITE,
  WARN: COLOR.YELLOW,
};

const formatTime = (date: Date) =>
  date.toLocaleTimeString("en-US", {
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });

export class Logger {
  context: AnyValue;
  logger: ApiLogsLogger;

  /**
   * @param context - The context of the logger. It will be passed into the attributes of the log record.
   */
  constructor(context: AnyValue) {
    this.context = context;

    // To start a logger, you first need to initialize the Logger provider.
    const loggerProvider = new LoggerProvider({
      // you can use ConsoleLogRecordExporter to log to the console
      processors: [new BatchLogRecordProcessor(new OTLPLogExporter())],
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: SERVICE_NAME,
        [ATTR_SERVICE_VERSION]: SERVICE_VERSION,
      }),
    });

    this.logger = loggerProvider.getLogger("default", "1.0.0");
  }

  log(message: string, attributes?: AnyValueMap) {
    const severity = "INFO";
    const severityColor = LEVEL_COLORS[severity as keyof typeof LEVEL_COLORS];
    const timeFormatted = formatTime(new Date());

    this.logger.emit({
      attributes: {
        context: this.context,
        ...attributes,
      },
      body: message,
      severityNumber: SeverityNumber.INFO,
      severityText: severity,
    });

    console.log(
      `${severityColor}[${timeFormatted}] ${severityColor}[${this.context}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`
      // attributes
    );
  }

  warn(message: string, attributes?: AnyValueMap) {
    const severity = "WARN";
    const severityColor = LEVEL_COLORS[severity as keyof typeof LEVEL_COLORS];
    const timeFormatted = formatTime(new Date());

    this.logger.emit({
      attributes: {
        context: this.context,
        ...attributes,
      },
      body: message,
      severityNumber: SeverityNumber.WARN,
      severityText: severity,
    });

    console.warn(
      `${severityColor}[${timeFormatted}] ${severityColor}[${this.context}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`
      // attributes
    );
  }

  error(message: string, attributes?: AnyValueMap) {
    const severity = "ERROR";
    const severityColor = LEVEL_COLORS[severity as keyof typeof LEVEL_COLORS];
    const timeFormatted = formatTime(new Date());

    this.logger.emit({
      attributes: {
        context: this.context,
        ...attributes,
      },
      body: message,
      severityNumber: SeverityNumber.ERROR,
      severityText: severity,
    });

    console.error(
      `${severityColor}[${timeFormatted}] ${severityColor}[${this.context}] ${severityColor}${severity}: ${COLOR.WHITE}${message}`
      // attributes
    );
  }
}

/**
 * The default logger for the service.
 */
export const logger = new Logger(SERVICE_NAME);

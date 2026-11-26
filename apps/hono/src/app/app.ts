import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { metrics } from "@opentelemetry/api";
import { EvlogError, parseError } from "evlog";
import { evlog } from "evlog/hono";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { contextStorage } from "hono/context-storage";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { languageDetector } from "hono/language";
import { prettyJSON } from "hono/pretty-json";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { timeout } from "hono/timeout";
import { timing } from "hono/timing";
import { HTTPError, TimeoutError } from "ky";
import { shake } from "radashi";
import { match, P } from "ts-pattern";
import { prettifyError, ZodError } from "zod";

import { LLMS_INDEX_PATH } from "#features/docs/routes.ts";
import { admissionMiddleware } from "#server/middleware/admission.ts";
import { authContextMiddleware } from "#server/middleware/auth.ts";
import { identifyMiddleware } from "#server/middleware/identify.ts";
import { failedRequestsMiddleware } from "#server/middleware/metrics.ts";
import { evlogMiddlewareOptions } from "#server/observability/evlog.ts";
import type { Variables } from "#server/types/hono.ts";
import { ENV } from "#shared/constants/env.ts";
import type { AppConfig } from "#shared/constants/env.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/constants/global.ts";
import { HTTP_STATUS_CODES } from "#shared/constants/http.ts";
import { languageDetectorOptions } from "#shared/constants/language.ts";
import { failureClass } from "#shared/utils/failure-class.ts";
import type { FailureClass } from "#shared/utils/failure-class.ts";
import { isContentfulStatusCode } from "#shared/utils/http-status.ts";
import { absoluteUrl } from "#shared/utils/links.ts";

import { routes } from "./routes.ts";

const INBOUND_TIMEOUT = 15_000;
const PROBE_PATHS: ReadonlySet<string> = new Set();
const NOT_FOUND_MESSAGE = "404 Not found";
const meter = metrics.getMeter(SERVICE_NAME, SERVICE_VERSION);

const NOT_FOUND_FIX =
  "Check the method and the path against the OpenAPI document at /openapi.";

const INTERNAL_SERVER_ERROR_MESSAGE = "Internal Server Error";
const BAD_GATEWAY_MESSAGE = "Bad Gateway";
const GATEWAY_TIMEOUT_MESSAGE = "Gateway Timeout";
const ROOT_LOCATION = "(root)";

type RequestLog = Variables["log"];

const FAILURE_LOG_LEVELS = {
  defect: "error",
  fault: "warn",
  refusal: "info",
} as const satisfies Record<FailureClass, string>;

const logFailure = (log: RequestLog, status: number, error: Error) => {
  log.setLevel(FAILURE_LOG_LEVELS[failureClass(status)]);
  log.error(error);
};

const issueLocation = (zodError: ZodError): string => {
  const path = zodError.issues.slice(0, 1).flatMap((issue) => issue.path);

  return path.length === 0 ? ROOT_LOCATION : path.map(String).join(".");
};

const handleError =
  (refusalDocs: string): ErrorHandler<{ Variables: Variables }> =>
  (error, c) => {
    const log = c.get("log");

    return match(error)
      .with(P.instanceOf(ZodError), (zodError) => {
        logFailure(log, HTTP_STATUS_CODES.BAD_REQUEST, zodError);
        const location = issueLocation(zodError);

        return c.json(
          {
            docs: refusalDocs,
            fix: `Correct the value at "${location}" and send the request again.`,
            location,
            message: prettifyError(zodError),
          },
          HTTP_STATUS_CODES.BAD_REQUEST
        );
      })
      .with(P.instanceOf(HTTPError), (httpError) => {
        logFailure(log, HTTP_STATUS_CODES.BAD_GATEWAY, httpError);

        return c.json(
          { message: BAD_GATEWAY_MESSAGE },
          HTTP_STATUS_CODES.BAD_GATEWAY
        );
      })
      .with(P.instanceOf(TimeoutError), (timeoutError) => {
        logFailure(log, HTTP_STATUS_CODES.GATEWAY_TIMEOUT, timeoutError);

        return c.json(
          { message: GATEWAY_TIMEOUT_MESSAGE },
          HTTP_STATUS_CODES.GATEWAY_TIMEOUT
        );
      })
      .with(P.instanceOf(HTTPException), (httpException) => {
        logFailure(log, httpException.status, httpException);

        return httpException.getResponse();
      })
      .with(P.instanceOf(EvlogError), (evlogError) => {
        const parsed = parseError(evlogError);

        const status = isContentfulStatusCode(parsed.status)
          ? parsed.status
          : HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR;

        logFailure(log, status, evlogError);

        return c.json(
          shake({
            fix: parsed.fix,
            link: parsed.link,
            message: parsed.message,
            why: parsed.why,
          }),
          status
        );
      })
      .otherwise((unknownError) => {
        logFailure(log, HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR, unknownError);

        return c.json(
          { message: INTERNAL_SERVER_ERROR_MESSAGE },
          HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR
        );
      });
  };

const handleNotFound =
  (refusalDocs: string): NotFoundHandler<{ Variables: Variables }> =>
  (c) => {
    const log = c.get("log");

    log.setLevel(FAILURE_LOG_LEVELS.refusal);
    log.info(NOT_FOUND_MESSAGE);

    return c.json(
      {
        docs: refusalDocs,
        fix: NOT_FOUND_FIX,
        location: c.req.path,
        message: NOT_FOUND_MESSAGE,
      },
      HTTP_STATUS_CODES.NOT_FOUND
    );
  };

export const createApp = async (config: AppConfig = ENV) => {
  const refusalDocs = absoluteUrl(config.APP_URL, LLMS_INDEX_PATH);

  const app = new OpenAPIHono<{
    Variables: Variables;
  }>();

  app.use(
    "*",
    httpInstrumentationMiddleware({
      serviceName: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
    }),
    failedRequestsMiddleware(meter),
    contextStorage(),
    requestId(),
    evlog(evlogMiddlewareOptions),
    cors({
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      credentials: true,
      exposeHeaders: ["Content-Length"],
      origin: [config.APP_URL],
    }),
    admissionMiddleware({
      isProbePath: (path) => PROBE_PATHS.has(path),
      meter,
      probes: config.MAX_IN_FLIGHT_PROBES,
      requests: config.MAX_IN_FLIGHT_REQUESTS,
    }),
    identifyMiddleware(),
    authContextMiddleware(),
    timing(),
    timeout(INBOUND_TIMEOUT),
    languageDetector(languageDetectorOptions),
    csrf({
      origin: [config.APP_URL],
    }),
    secureHeaders(),
    prettyJSON()
  );

  await routes(app, config);

  app.onError(handleError(refusalDocs));
  app.notFound(handleNotFound(refusalDocs));

  return app;
};

export const app = await createApp();

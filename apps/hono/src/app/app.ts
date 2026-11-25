import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { EvlogError, parseError } from "evlog";
import { evlog } from "evlog/hono";
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

import { authContextMiddleware } from "#server/middleware/auth.ts";
import { identifyMiddleware } from "#server/middleware/identify.ts";
import { evlogMiddlewareOptions } from "#server/observability/evlog.ts";
import type { Variables } from "#server/types/hono.ts";
import { ENV } from "#shared/constants/env.ts";
import { SERVICE_NAME, SERVICE_VERSION } from "#shared/constants/global.ts";
import { HTTP_STATUS_CODES } from "#shared/constants/http.ts";
import { languageDetectorOptions } from "#shared/constants/language.ts";
import { failureClass } from "#shared/utils/failure-class.ts";
import { isContentfulStatusCode } from "#shared/utils/http-status.ts";

import { routes } from "./routes.ts";

const TIMEOUT = 15_000;
const NOT_FOUND_MESSAGE = "404 Not found";

const app = new OpenAPIHono<{
  Variables: Variables;
}>();

app.use(
  "*",
  httpInstrumentationMiddleware({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
  }),
  contextStorage(),
  requestId(),
  evlog(evlogMiddlewareOptions),
  identifyMiddleware(),
  cors({
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    credentials: true,
    exposeHeaders: ["Content-Length"],
    origin: [ENV.APP_URL],
  }),
  authContextMiddleware(),
  timing(),
  timeout(TIMEOUT),
  languageDetector(languageDetectorOptions),
  csrf({
    origin: [ENV.APP_URL],
  }),
  secureHeaders(),
  prettyJSON()
);

await routes(app);

const INTERNAL_SERVER_ERROR_MESSAGE = "Internal Server Error";
const BAD_GATEWAY_MESSAGE = "Bad Gateway";
const GATEWAY_TIMEOUT_MESSAGE = "Gateway Timeout";
const ROOT_LOCATION = "(root)";

type RequestLog = Variables["log"];

const logFailure = (log: RequestLog, status: number, error: Error) => {
  match(failureClass(status))
    .with("refusal", () => {
      log.info(error.message);
    })
    .with("fault", () => {
      log.warn(error.message);
    })
    .with("defect", () => {
      log.error(error);
    })
    .exhaustive();
};

const issueLocation = (zodError: ZodError): string => {
  const path = zodError.issues[0]?.path ?? [];

  return path.length === 0 ? ROOT_LOCATION : path.map(String).join(".");
};

app.onError((error, c) => {
  const log = c.get("log");

  return match(error)
    .with(P.instanceOf(ZodError), (zodError) => {
      logFailure(log, HTTP_STATUS_CODES.BAD_REQUEST, zodError);
      const location = issueLocation(zodError);

      return c.json(
        {
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
});

app.notFound((c) => {
  c.get("log").info(NOT_FOUND_MESSAGE);

  return c.text(NOT_FOUND_MESSAGE, HTTP_STATUS_CODES.NOT_FOUND);
});

export { app };

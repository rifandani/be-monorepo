import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { parseError } from "evlog";
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
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPError } from "ky";
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

app.onError(async (error, c) => {
  c.get("log")?.error(error);

  return match(error)
    .with(P.instanceOf(ZodError), (zodError) =>
      c.json(
        { message: prettifyError(zodError) },
        HTTP_STATUS_CODES.BAD_REQUEST
      )
    )
    .with(P.instanceOf(HTTPError), async (httpError) =>
      c.json(
        {
          error: await httpError.response.json(),
          message: httpError.message,
        },
        HTTP_STATUS_CODES.BAD_REQUEST
      )
    )
    .with(P.instanceOf(HTTPException), (httpException) =>
      httpException.getResponse()
    )
    .otherwise((unknownError) => {
      const parsed = parseError(unknownError);

      return c.json(
        shake({
          fix: parsed.fix,
          link: parsed.link,
          message: parsed.message,
          why: parsed.why,
        }),
        // SAFETY: `parseError` only ever reports an error status (>= 400), and
        // every such code carries a body, so none of the bodiless `StatusCode`s (101/204/205/304) that `ContentfulStatusCode` excludes can reach here.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- parseError emits only contentful error status codes.
        parsed.status as ContentfulStatusCode
      );
    });
});

app.notFound((c) => {
  c.get("log")?.warn(NOT_FOUND_MESSAGE);

  return c.text(NOT_FOUND_MESSAGE, HTTP_STATUS_CODES.NOT_FOUND);
});

export { app };

import { httpInstrumentationMiddleware } from "@hono/otel";
import { OpenAPIHono } from "@hono/zod-openapi";
import { parseError } from "evlog";
import { evlog } from "evlog/hono";
import { contextStorage } from "hono/context-storage";
import { cors } from "hono/cors";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { languageDetector } from "hono/language";
// import { logger as loggerMiddleware } from "hono/logger";
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

import { ENV } from "@/core/constants/env.js";
import { SERVICE_NAME, SERVICE_VERSION } from "@/core/constants/global.js";
import { HTTP_STATUS_CODES } from "@/core/constants/http.js";
import type { Variables } from "@/core/types/hono.js";
import { evlogMiddlewareOptions } from "@/core/utils/evlog.js";
import { routes } from "@/routes/index.js";
import { authContextMiddleware } from "@/routes/middlewares/auth.js";
import { identifyMiddleware } from "@/routes/middlewares/identify.js";

const TIMEOUT = 15_000; // 15 seconds
const app = new OpenAPIHono<{
  Variables: Variables;
}>(); // .basePath('/api/v1');

app.use(
  "*",
  /**
   * instruments the entire request-response lifecycle and metrics.
   * it doesn't provide fine-grained instrumentation for individual middleware.
   */
  httpInstrumentationMiddleware({
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
  }),
  /**
   * using `AsyncLocalStorage` under the hood
   */
  contextStorage(),
  requestId(),
  evlog(evlogMiddlewareOptions),
  identifyMiddleware(),
  // loggerMiddleware(),
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
  languageDetector({
    fallbackLanguage: "en",
    supportedLanguages: ["en", "id"],
  }),
  csrf({
    origin: [ENV.APP_URL],
  }),
  secureHeaders(),
  prettyJSON()
);

await routes(app);
// showRoutes(app, {
//   colorize: true,
// });

app.onError((error, c) => {
  c.get("log")?.error(error);

  // `otherwise` rather than `exhaustive`: hono hands us an open `Error`, so
  // there is no union for ts-pattern to close over.
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

      // `shake` drops the hints the parsed error did not supply, in place of
      // three conditional spreads.
      return c.json(
        shake({
          fix: parsed.fix,
          link: parsed.link,
          message: parsed.message,
          why: parsed.why,
        }),
        parsed.status as ContentfulStatusCode
      );
    });
});

app.notFound((c) => {
  c.get("log")?.warn("404 Not found");

  return c.text("404 Not found", HTTP_STATUS_CODES.NOT_FOUND);
});

export { app };

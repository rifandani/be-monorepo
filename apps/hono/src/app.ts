import { otel } from '@hono/otel';
import { OpenAPIHono } from '@hono/zod-openapi';
import { contextStorage } from 'hono/context-storage';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { HTTPException } from 'hono/http-exception';
import { languageDetector } from 'hono/language';
import { logger as loggerMiddleware } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { requestId } from 'hono/request-id';
import { secureHeaders } from 'hono/secure-headers';
import { timeout } from 'hono/timeout';
import { timing } from 'hono/timing';
import { HTTPError } from 'ky';
import { ZodError } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { ENV } from '@/core/constants/env.js';
import { HTTP_STATUS_CODES } from '@/core/constants/http.js';
import type { Variables } from '@/core/types/hono.js';
import { logger } from '@/core/utils/logger.js';
import { routes } from '@/routes/index.js';
import { authContextMiddleware } from '@/routes/middlewares/auth.js';

const TIMEOUT = 15_000; // 15 seconds
const app = new OpenAPIHono<{
  Variables: Variables;
}>(); // .basePath('/api/v1');

app.use(
  '*',
  /**
   * instruments the entire request-response lifecycle and metrics.
   * it doesn't provide fine-grained instrumentation for individual middleware.
   */
  otel(),
  /**
   * using `AsyncLocalStorage` under the hood
   */
  contextStorage(),
  loggerMiddleware(),
  // reqResLogger(),
  cors({
    origin: [ENV.APP_URL],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    credentials: true,
  }),
  requestId(),
  authContextMiddleware(),
  timing(),
  timeout(TIMEOUT),
  languageDetector({
    supportedLanguages: ['en', 'id'],
    fallbackLanguage: 'en',
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

app.onError(async (error, c) => {
  const reqId = c.get('requestId');

  if (error instanceof ZodError) {
    const errors = fromZodError(error);
    logger.error(`ZodError with requestId: ${reqId}`, {
      error: errors.message,
    });
    return c.json(errors, HTTP_STATUS_CODES.BAD_REQUEST);
  }
  if (error instanceof HTTPError) {
    const errors = await error.response.json();
    const response = { message: error.message, error: errors };
    logger.error(`HTTPError with requestId: ${reqId}`, response);
    return c.json(response, HTTP_STATUS_CODES.BAD_REQUEST);
  }
  if (error instanceof HTTPException) {
    logger.error(`HTTPException with requestId: ${reqId}`, {
      error: error.message,
    });
    // hono built-in http error
    return error.getResponse();
  }

  logger.error(`UnknownError with requestId: ${reqId}`, {
    error: error.message,
  });
  return c.json(
    { ...error, message: error.message },
    HTTP_STATUS_CODES.INTERNAL_SERVER_ERROR
  );
});

app.notFound((c) => {
  logger.warn('404 Not found');

  return c.text('404 Not found', HTTP_STATUS_CODES.NOT_FOUND);
});

export { app };

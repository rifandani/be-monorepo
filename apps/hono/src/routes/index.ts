import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { ENV } from "#core/constants/env.ts";
import { SERVICE_VERSION } from "#core/constants/global.ts";
import type { Variables } from "#core/types/hono.ts";
import { authRoutes } from "#routes/auth.ts";
import { llmsDocsRoutes } from "#routes/llms-docs.ts";

export const routes = async (
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) => {
  // OpenAPI docs
  app.doc("/openapi", {
    info: {
      description: "API documentation for the Hono app",
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    },
    openapi: "3.1.0",
    servers: [
      {
        description: "Local server",
        url: ENV.APP_URL,
      },
    ],
  });
  app.get(
    "/openapi/docs",
    Scalar({
      pageTitle: ENV.APP_TITLE,
      sources: [
        {
          title: ENV.APP_TITLE,
          url: "/openapi",
        },
        // Better Auth schema generation endpoint
        {
          title: `${ENV.APP_TITLE} (Auth)`,
          url: "/api/auth/open-api/generate-schema",
        },
      ],
      theme: "elysiajs",
    })
  );

  // betterauth routes
  authRoutes(app);

  // our routes
  await llmsDocsRoutes(app);
};

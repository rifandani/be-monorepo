import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { authRoutes } from "#features/auth/routes.ts";
import { llmsDocsRoutes } from "#features/docs/routes.ts";
import type { Variables } from "#server/types/hono.ts";
import { ENV } from "#shared/constants/env.ts";
import { SERVICE_VERSION } from "#shared/constants/global.ts";

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

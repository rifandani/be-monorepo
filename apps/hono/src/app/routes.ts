import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { authRoutes } from "#features/auth/routes.ts";
import { llmsDocsRoutes } from "#features/docs/routes.ts";
import type { Variables } from "#server/types/hono.ts";
import type { AppConfig } from "#shared/constants/env.ts";
import { SERVICE_VERSION } from "#shared/constants/global.ts";

export const routes = async (
  app: OpenAPIHono<{
    Variables: Variables;
  }>,
  config: AppConfig
) => {
  app.doc("/openapi", {
    info: {
      description: "API documentation for the Hono app",
      title: config.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    },
    openapi: "3.1.0",
    servers: [
      {
        description: "Local server",
        url: config.APP_URL,
      },
    ],
  });
  app.get(
    "/openapi/docs",
    Scalar({
      pageTitle: config.APP_TITLE,
      sources: [
        {
          title: config.APP_TITLE,
          url: "/openapi",
        },
        {
          title: `${config.APP_TITLE} (Auth)`,
          url: "/api/auth/open-api/generate-schema",
        },
      ],
      theme: "elysiajs",
    })
  );

  authRoutes(app);

  await llmsDocsRoutes(app, config);
};

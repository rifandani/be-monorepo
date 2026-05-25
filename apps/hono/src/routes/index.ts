import type { OpenAPIHono } from "@hono/zod-openapi";
import { Scalar } from "@scalar/hono-api-reference";

import { ENV } from "@/core/constants/env.js";
import { SERVICE_VERSION } from "@/core/constants/global.js";
import type { Variables } from "@/core/types/hono.js";
import { authRoutes } from "@/routes/auth.js";
import { llmsDocsRoutes } from "@/routes/llms-docs.js";

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
        url: "http://localhost:3333",
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

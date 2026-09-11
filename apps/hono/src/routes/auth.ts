import type { OpenAPIHono } from "@hono/zod-openapi";

import { auth } from "#auth/utils/index.ts";
import type { Variables } from "#core/types/hono.ts";

export const authRoutes = (
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) => {
  // betterauth handler
  app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));
};

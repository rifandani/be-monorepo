import type { OpenAPIHono } from "@hono/zod-openapi";

import { auth } from "#server/auth.ts";
import type { Variables } from "#server/types/hono.ts";

export const authRoutes = (
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) => {
  // betterauth handler
  app.on(["POST", "GET"], "/api/auth/**", async (c) => auth.handler(c.req.raw));
};

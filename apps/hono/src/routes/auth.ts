import type { OpenAPIHono } from "@hono/zod-openapi";

import { auth } from "@/auth/utils/index.js";
import type { Variables } from "@/core/types/hono.js";

export const authRoutes = (
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) => {
  // betterauth handler
  app.on(["POST", "GET"], "/api/auth/**", (c) => auth.handler(c.req.raw));
};

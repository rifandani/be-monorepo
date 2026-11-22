import { createAuthMiddleware } from "evlog/better-auth";
import type { MiddlewareHandler } from "hono";

import { auth } from "#server/auth.ts";
import type { Variables } from "#server/types/hono.ts";

const identify = createAuthMiddleware(auth, {
  exclude: ["/api/auth/**", "/api/public/**", "/api/health"],
  include: ["/api/**"],
});

export const identifyMiddleware =
  (): MiddlewareHandler<{
    Variables: Variables;
  }> =>
  async (c, next) => {
    const log = c.get("log");

    if (log !== undefined) {
      await identify(log, c.req.raw.headers, c.req.path);
    }

    return next();
  };

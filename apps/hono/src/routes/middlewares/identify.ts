import type { BetterAuthInstance } from "evlog/better-auth";
import { createAuthMiddleware } from "evlog/better-auth";
import type { MiddlewareHandler } from "hono";

import { auth } from "@/auth/utils/index.js";

// SAFETY: `auth` is a Better Auth instance; the assertion only erases the plugin-specific generics that `BetterAuthInstance` leaves open, so the middleware sees the same runtime object.
const identify = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**", "/api/public/**", "/api/health"],
  include: ["/api/**"],
  // extend: (session) => ({
  //   organization: session.user.activeOrganization,
  //   role: session.user.role,
  // }),
});

export const identifyMiddleware = (): MiddlewareHandler => async (c, next) => {
  const log = c.get("log");
  if (log) {
    await identify(log, c.req.raw.headers, c.req.path);
  }
  return next();
};

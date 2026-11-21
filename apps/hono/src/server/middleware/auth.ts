import type { MiddlewareHandler } from "hono";

import { auth } from "#server/auth.ts";

export const authContextMiddleware =
  (): MiddlewareHandler => async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    c.set("user", session ? session.user : null);
    c.set("session", session ? session.session : null);

    return next();
  };

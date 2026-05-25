import type { MiddlewareHandler } from "hono";

import { auth } from "@/auth/utils/index.js";

/**
 * a middleware to save the session and user in a context (if authenticated, or `null` if not).
 */
export const authContextMiddleware =
  (): MiddlewareHandler => async (c, next) => {
    // get the session from the request
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    // set the user and session in the context
    c.set("user", session ? session.user : null);
    c.set("session", session ? session.session : null);

    return next();
  };

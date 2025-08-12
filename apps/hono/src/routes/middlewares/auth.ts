import type { MiddlewareHandler } from 'hono';
import { auth } from '@/auth/libs/index.js';

/**
 * a middleware to save the session and user in a context (if authenticated, or `null` if not).
 */
export function authContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    // get the session from the request
    const session = await auth.api.getSession({ headers: c.req.raw.headers });

    // set the user and session in the context
    c.set('user', session ? session.user : null);
    c.set('session', session ? session.session : null);

    return next();
  };
}

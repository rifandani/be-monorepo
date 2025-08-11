import type { OpenAPIHono } from '@hono/zod-openapi';
import { auth } from '@/auth/libs/index.js';
import type { Variables } from '@/core/types/hono.js';

export function authRoutes(
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) {
  // betterauth handler
  app.on(['POST', 'GET'], '/api/auth/**', (c) => {
    return auth.handler(c.req.raw);
  });
}

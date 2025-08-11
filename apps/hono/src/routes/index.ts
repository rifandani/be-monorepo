import type { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { auth } from '@/auth/libs/index.js';
import { ENV } from '@/core/constants/env.js';
import { SERVICE_VERSION } from '@/core/constants/global.js';
import type { Variables } from '@/core/types/hono.js';
import { llmsDocsRoutes } from '@/routes/llms-docs.js';

export async function routes(
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) {
  // betterauth routes
  app.on(['POST', 'GET'], '/api/auth/**', (c) => {
    return auth.handler(c.req.raw);
  });

  // OpenAPI docs
  app.doc('/openapi', {
    openapi: '3.1.0',
    info: {
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
      description: 'API documentation for the Hono app',
    },
    servers: [
      {
        url: 'http://localhost:3333',
        description: 'Local server',
      },
    ],
  });
  app.get(
    '/openapi/docs',
    Scalar({
      theme: 'elysiajs',
      pageTitle: ENV.APP_TITLE,
      sources: [
        {
          title: ENV.APP_TITLE,
          url: '/openapi',
        },
        // {
        //   title: 'Scalar Galaxy',
        //   url: 'https://cdn.jsdelivr.net/npm/@scalar/galaxy/dist/latest.json',
        // },
      ],
    })
  );

  // our routes
  await llmsDocsRoutes(app);
}

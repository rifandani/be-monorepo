import type { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { createMarkdownFromOpenApi } from '@scalar/openapi-to-markdown';
import { auth } from '@/auth/libs/index.js';
import type { Variables } from '@/core/types/hono.js';
import { llmsDocsRoutes } from '@/routes/llms-docs.js';

export async function routes(
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) {
  llmsDocsRoutes(app);

  // betterauth routes
  app.on(['POST', 'GET'], '/api/auth/**', (c) => {
    return auth.handler(c.req.raw);
  });

  // OpenAPI docs
  app.doc('/openapi', {
    openapi: '3.1.0',
    info: {
      title: 'Hono',
      version: '1.0.0',
      description: 'Hono API',
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
      pageTitle: 'Hono',
      sources: [
        {
          title: 'Hono',
          url: '/openapi',
        },
        // {
        //   title: 'Scalar Galaxy',
        //   url: 'https://cdn.jsdelivr.net/npm/@scalar/galaxy/dist/latest.json',
        // },
      ],
    })
  );

  // markdown for LLMs. this should be placed after generating openapi docs
  const content = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Hono',
      version: 'v1.0.0',
    },
  });
  const markdown = await createMarkdownFromOpenApi(JSON.stringify(content));

  app.get('/llms.txt', (c) => {
    return c.text(markdown);
  });
}

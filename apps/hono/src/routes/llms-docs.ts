import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import { createMarkdownFromOpenApi } from '@scalar/openapi-to-markdown';
import { auth } from '@/auth/libs/index.js';
import { ENV } from '@/core/constants/env.js';
import { SERVICE_VERSION } from '@/core/constants/global.js';
import type { Variables } from '@/core/types/hono.js';

const TOKENS_PER_CHARACTER = 4;

/**
 * Get all files in a directory
 * @param dir - The directory to get the files from
 * @returns An array of file paths
 */
async function getAllFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  // read the directory
  const entries = await readdir(dir, { withFileTypes: true });

  // recursively get all files in the directory
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await getAllFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

export async function llmsDocsRoutes(
  app: OpenAPIHono<{
    Variables: Variables;
  }>
) {
  app.openapi(
    createRoute({
      method: 'get',
      path: '/llms-docs',
      summary: 'LLMs Docs',
      description: 'Get the combined content of the docs folder.',
      responses: {
        200: {
          description: 'Successful get the combined content of the docs',
          content: {
            'application/json': {
              schema: z.object({
                text: z.string().openapi({
                  description: 'The generated text',
                }),
                length: z.number().openapi({
                  description: 'The length of the generated text',
                }),
                tokens: z.number().openapi({
                  description: 'The number of tokens in the generated text',
                }),
              }),
            },
          },
        },
      },
    }),
    async (c) => {
      // get the content from the docs folder
      const contentDir = join(process.cwd(), './docs');
      const files = await getAllFiles(contentDir);

      // read all the files and combine them into a single string
      let fullContent = '';
      for (const file of files) {
        const fileContent = await readFile(file, 'utf-8');

        fullContent += fileContent;
        fullContent += '\n\n';
      }

      return c.json({
        text: fullContent,
        length: fullContent.length,
        tokens: fullContent.length / TOKENS_PER_CHARACTER,
      });
    }
  );

  /**
   * Register a route to serve the Markdown for LLMs
   *
   * Q: Why /llms.txt?
   * A: It's a proposal to standardise on using an /llms.txt file.
   *
   * @see https://llmstxt.org/
   */
  const betterauthOpenapiObject = await auth.api.generateOpenAPISchema();
  const betterauthMarkdown = await createMarkdownFromOpenApi(
    JSON.stringify(betterauthOpenapiObject)
  );

  // this route should be placed at the end to be able to index the better-auth routes OpenAPI docs
  app.openapi(
    createRoute({
      method: 'get',
      path: '/llms-auth.txt',
      summary: 'BetterAuth OpenAPI docs',
      description:
        'Markdown version of the BetterAuth OpenAPI docs, which can be used for LLMs.',
      responses: {
        200: {
          description:
            'Successful get the markdown version of the BetterAuth OpenAPI docs',
          content: {
            'text/plain': {
              schema: z.string().openapi({
                description:
                  'The markdown version of the BetterAuth OpenAPI docs',
              }),
            },
          },
        },
      },
    }),
    (c) => {
      return c.text(betterauthMarkdown);
    }
  );

  const openapiObject = app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    },
  });
  const markdown = await createMarkdownFromOpenApi(
    JSON.stringify(openapiObject)
  );

  // this route should be placed at the end to be able to index the other routes OpenAPI docs
  app.openapi(
    createRoute({
      method: 'get',
      path: '/llms.txt',
      summary: 'OpenAPI docs',
      description:
        'Markdown version of the OpenAPI docs, which can be used for LLMs.',
      responses: {
        200: {
          description:
            'Successful get the markdown version of the OpenAPI docs',
          content: {
            'text/plain': {
              schema: z.string().openapi({
                description: 'The markdown version of the OpenAPI docs',
              }),
            },
          },
        },
      },
    }),
    (c) => {
      return c.text(markdown);
    }
  );
}

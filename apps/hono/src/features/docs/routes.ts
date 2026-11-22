import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import type { MiddlewareHandler } from "hono";

import { auth } from "#server/auth.ts";
import { ENV } from "#shared/constants/env.ts";
import { SERVICE_VERSION } from "#shared/constants/global.ts";
import type { Variables } from "#server/types/hono.ts";

const TOKENS_PER_CHARACTER = 4;
const LLMS_CACHE_MAX_AGE_SECONDS = 3600;

const llmsCacheControl: MiddlewareHandler = async (c, next) => {
  c.header(
    "Cache-Control",
    `public, max-age=${LLMS_CACHE_MAX_AGE_SECONDS}, immutable`
  );

  return next();
};

export const getAllFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return getAllFiles(fullPath);
      }

      return entry.isFile() ? [fullPath] : [];
    })
  );

  return nested.flat();
};

type DocsApp = OpenAPIHono<{
  Variables: Variables;
}>;

const registerDocsFolderRoute = (app: DocsApp) => {
  app.openapi(
    createRoute({
      description: "Get the combined content of the docs folder.",
      method: "get",
      path: "/llms-docs",
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                length: z.number().openapi({
                  description: "The length of the generated text",
                }),
                text: z.string().openapi({
                  description: "The generated text",
                }),
                tokens: z.number().openapi({
                  description: "The number of tokens in the generated text",
                }),
              }),
            },
          },
          description: "Successful get the combined content of the docs",
        },
      },
      summary: "LLMs Docs",
    }),
    async (c) => {
      const contentDir = path.join(process.cwd(), "./docs");
      const files = await getAllFiles(contentDir);

      const contents = await Promise.all(
        files.map(async (file) => readFile(file, "utf-8"))
      );

      const fullContent = contents.map((content) => `${content}\n\n`).join("");

      return c.json({
        length: fullContent.length,
        text: fullContent,
        tokens: fullContent.length / TOKENS_PER_CHARACTER,
      });
    }
  );
};

const registerAuthMarkdownRoute = async (app: DocsApp) => {
  const betterauthOpenapiObject = await auth.api.generateOpenAPISchema();

  const betterauthMarkdown = await createMarkdownFromOpenApi(
    JSON.stringify(betterauthOpenapiObject)
  );

  app.openapi(
    createRoute({
      description:
        "Markdown version of the BetterAuth OpenAPI docs, which can be used for LLMs.",
      method: "get",
      path: "/llms-auth.txt",
      responses: {
        200: {
          content: {
            "text/plain": {
              schema: z.string().openapi({
                description:
                  "The markdown version of the BetterAuth OpenAPI docs",
              }),
            },
          },
          description:
            "Successful get the markdown version of the BetterAuth OpenAPI docs",
        },
      },
      summary: "BetterAuth OpenAPI docs",
    }),
    (c) => c.text(betterauthMarkdown)
  );
};

const registerOpenApiMarkdownRoute = async (app: DocsApp) => {
  const openapiObject = app.getOpenAPI31Document({
    info: {
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    },
    openapi: "3.1.0",
  });

  const markdown = await createMarkdownFromOpenApi(
    JSON.stringify(openapiObject)
  );

  app.openapi(
    createRoute({
      description:
        "Markdown version of the OpenAPI docs, which can be used for LLMs.",
      method: "get",
      path: "/llms.txt",
      responses: {
        200: {
          content: {
            "text/plain": {
              schema: z.string().openapi({
                description: "The markdown version of the OpenAPI docs",
              }),
            },
          },
          description:
            "Successful get the markdown version of the OpenAPI docs",
        },
      },
      summary: "OpenAPI docs",
    }),
    (c) => c.text(markdown)
  );
};

export const llmsDocsRoutes = async (app: DocsApp) => {
  app.use("/llms-docs", llmsCacheControl);
  app.use("/llms.txt", llmsCacheControl);
  app.use("/llms-auth.txt", llmsCacheControl);

  registerDocsFolderRoute(app);
  await registerAuthMarkdownRoute(app);
  await registerOpenApiMarkdownRoute(app);
};

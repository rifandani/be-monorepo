import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";

import { auth } from "@/auth/utils/index.js";
import { ENV } from "@/core/constants/env.js";
import { SERVICE_VERSION } from "@/core/constants/global.js";
import type { Variables } from "@/core/types/hono.js";

const TOKENS_PER_CHARACTER = 4;

/**
 * Get all files in a directory
 *
 * `readdir` reports link types without resolving them, so recursing on
 * `isDirectory()` and collecting on `isFile()` drops symlinks — the only way an
 * entry under `dir` could point outside of it.
 *
 * @param dir - The directory to get the files from
 * @returns An array of file paths, all contained within `dir`
 */
export const getAllFiles = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map((entry) => {
      // `entry.name` is a single path segment from the filesystem, never `..`
      // or absolute, so the join cannot escape `dir`.
      // fallow-ignore-next-line security-sink
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

/**
 * `GET /llms-docs` — the concatenated contents of the repo's `docs` folder.
 */
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
      // get the content from the docs folder. The route takes no parameters, so
      // both join operands are fixed — nothing request-controlled reaches here.
      // fallow-ignore-next-line security-sink
      const contentDir = path.join(process.cwd(), "./docs");
      const files = await getAllFiles(contentDir);

      // read all the files and combine them into a single string
      const contents = await Promise.all(
        files.map((file) => readFile(file, "utf-8"))
      );
      // Each file gets its own trailing separator, which makes the empty-docs
      // case fall out as `""` without a branch on `contents.length`.
      const fullContent = contents.map((content) => `${content}\n\n`).join("");

      return c.json({
        length: fullContent.length,
        text: fullContent,
        tokens: fullContent.length / TOKENS_PER_CHARACTER,
      });
    }
  );
};

/**
 * `GET /llms-auth.txt` — the BetterAuth OpenAPI docs as Markdown.
 *
 * Must be registered after the routes it documents so the BetterAuth routes are
 * already indexed.
 */
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

/**
 * `GET /llms.txt` — the app's own OpenAPI docs as Markdown.
 *
 * Q: Why /llms.txt?
 * A: It's a proposal to standardise on using an /llms.txt file.
 *
 * Must be registered last so every other route is already indexed.
 *
 * @see https://llmstxt.org/
 */
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

/**
 * Registers the LLM-facing documentation routes.
 *
 * Registration order matters: the Markdown routes snapshot the OpenAPI document
 * at registration time, so they go last.
 */
export const llmsDocsRoutes = async (app: DocsApp) => {
  registerDocsFolderRoute(app);
  await registerAuthMarkdownRoute(app);
  await registerOpenApiMarkdownRoute(app);
};

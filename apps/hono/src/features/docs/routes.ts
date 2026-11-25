import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { createRoute, z } from "@hono/zod-openapi";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createMarkdownFromOpenApi } from "@scalar/openapi-to-markdown";
import type { MiddlewareHandler } from "hono";

import { auth } from "#server/auth.ts";
import type { Variables } from "#server/types/hono.ts";
import { ENV } from "#shared/constants/env.ts";
import { SERVICE_VERSION } from "#shared/constants/global.ts";
import { nextActions, nextActionsMarkdown } from "#shared/utils/links.ts";
import type { NextAction } from "#shared/utils/links.ts";

export const LLMS_INDEX_PATH = "/llms.txt";
const LLMS_DOCS_PATH = "/llms-docs";
const LLMS_AUTH_PATH = "/llms-auth.txt";

const TOKENS_PER_CHARACTER = 4;
const LLMS_CACHE_MAX_AGE_SECONDS = 3600;
const APP_DOCS_DIR = path.join(import.meta.dirname, "../../../docs");

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

interface LlmsPages {
  readonly auth: string;
  readonly index: string;
  readonly links: readonly NextAction[];
}

const nextActionSchema = z.object({
  href: z.string().openapi({ description: "The absolute URL of the action" }),
  method: z.string().openapi({ description: "The HTTP method of the action" }),
  title: z.string().openapi({ description: "What the action does" }),
});

const withNextActions = (markdown: string, actions: readonly NextAction[]) =>
  `${markdown}\n\n${nextActionsMarkdown(actions)}`;

const buildLlmsPages = async (app: DocsApp): Promise<LlmsPages> => {
  const appContract = app.getOpenAPI31Document({
    info: {
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    },
    openapi: "3.1.0",
    servers: [{ url: ENV.APP_URL }],
  });

  const authContract = await auth.api.generateOpenAPISchema();

  const [appMarkdown, authMarkdown] = await Promise.all([
    createMarkdownFromOpenApi(JSON.stringify(appContract)),
    createMarkdownFromOpenApi(JSON.stringify(authContract)),
  ]);

  const appActions = nextActions(appContract, ENV.APP_URL);

  return {
    auth: withNextActions(
      authMarkdown,
      nextActions(authContract, ENV.APP_URL)
    ),
    index: withNextActions(appMarkdown, appActions),
    links: appActions,
  };
};

const registerDocsFolderRoute = (
  app: DocsApp,
  pages: Promise<LlmsPages>
) => {
  app.openapi(
    createRoute({
      description: "Get the combined content of the docs folder.",
      method: "get",
      path: LLMS_DOCS_PATH,
      responses: {
        200: {
          content: {
            "application/json": {
              schema: z.object({
                length: z.number().openapi({
                  description: "The length of the generated text",
                }),
                links: z.array(nextActionSchema).openapi({
                  description: "The next valid actions, as absolute links",
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
      const files = await getAllFiles(APP_DOCS_DIR);

      const contents = await Promise.all(
        files.map(async (file) => readFile(file, "utf-8"))
      );

      const fullContent = contents.map((content) => `${content}\n\n`).join("");
      const { links } = await pages;

      return c.json({
        length: fullContent.length,
        links: [...links],
        text: fullContent,
        tokens: fullContent.length / TOKENS_PER_CHARACTER,
      });
    }
  );
};

const registerAuthMarkdownRoute = (
  app: DocsApp,
  pages: Promise<LlmsPages>
) => {
  app.openapi(
    createRoute({
      description:
        "Markdown version of the BetterAuth OpenAPI docs, which can be used for LLMs.",
      method: "get",
      path: LLMS_AUTH_PATH,
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
    async (c) => {
      const { auth: authMarkdown } = await pages;

      return c.text(authMarkdown);
    }
  );
};

const registerOpenApiMarkdownRoute = (
  app: DocsApp,
  pages: Promise<LlmsPages>
) => {
  app.openapi(
    createRoute({
      description:
        "Markdown version of the OpenAPI docs, which can be used for LLMs.",
      method: "get",
      path: LLMS_INDEX_PATH,
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
    async (c) => {
      const { index } = await pages;

      return c.text(index);
    }
  );
};

export const llmsDocsRoutes = async (app: DocsApp) => {
  app.use(LLMS_DOCS_PATH, llmsCacheControl);
  app.use(LLMS_INDEX_PATH, llmsCacheControl);
  app.use(LLMS_AUTH_PATH, llmsCacheControl);

  const pages = Promise.withResolvers<LlmsPages>();

  registerDocsFolderRoute(app, pages.promise);
  registerAuthMarkdownRoute(app, pages.promise);
  registerOpenApiMarkdownRoute(app, pages.promise);

  pages.resolve(await buildLlmsPages(app));
};

import { describe, expect, it } from "vitest";

import { app } from "@/app.js";
import { ENV } from "@/core/constants/env.js";
import { SERVICE_VERSION } from "@/core/constants/global.js";

interface OpenApiDoc {
  info: { description: string; title: string; version: string };
  openapi: string;
  paths: Record<
    string,
    {
      get?: {
        description?: string;
        summary?: string;
        responses?: Record<
          string,
          {
            description?: string;
            content?: Record<
              string,
              {
                schema?: {
                  description?: string;
                  properties?: Record<
                    string,
                    { description?: string; type?: string }
                  >;
                };
              }
            >;
          }
        >;
      };
    }
  >;
  servers: { description: string; url: string }[];
}

const fetchOpenApi = async () => {
  const res = await app.request("/openapi");
  expect(res.status).toBe(200);
  return (await res.json()) as OpenApiDoc;
};

describe("/openapi document", () => {
  it("exposes openapi version, info, and servers", async () => {
    const doc = await fetchOpenApi();

    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toStrictEqual({
      description: "API documentation for the Hono app",
      title: ENV.APP_TITLE,
      version: `v${SERVICE_VERSION}`,
    });
    expect(doc.servers).toStrictEqual([
      {
        description: "Local server",
        url: ENV.APP_URL,
      },
    ]);
  });

  it("documents /llms-docs with its summary, description, and schema", async () => {
    const doc = await fetchOpenApi();
    const docs = doc.paths["/llms-docs"]?.get;

    expect(docs?.summary).toBe("LLMs Docs");
    expect(docs?.description).toBe(
      "Get the combined content of the docs folder."
    );
    expect(docs?.responses?.["200"]?.description).toBe(
      "Successful get the combined content of the docs"
    );
    expect(
      docs?.responses?.["200"]?.content?.["application/json"]?.schema
        ?.properties
    ).toStrictEqual(
      expect.objectContaining({
        length: expect.objectContaining({
          description: "The length of the generated text",
        }),
        text: expect.objectContaining({
          description: "The generated text",
        }),
        tokens: expect.objectContaining({
          description: "The number of tokens in the generated text",
        }),
      })
    );
  });

  it("documents /llms-auth.txt", async () => {
    const doc = await fetchOpenApi();
    const authDocs = doc.paths["/llms-auth.txt"]?.get;

    expect(authDocs?.summary).toBe("BetterAuth OpenAPI docs");
    expect(authDocs?.description).toBe(
      "Markdown version of the BetterAuth OpenAPI docs, which can be used for LLMs."
    );
    expect(authDocs?.responses?.["200"]?.description).toBe(
      "Successful get the markdown version of the BetterAuth OpenAPI docs"
    );
    expect(
      authDocs?.responses?.["200"]?.content?.["text/plain"]?.schema?.description
    ).toBe("The markdown version of the BetterAuth OpenAPI docs");
  });

  it("documents /llms.txt", async () => {
    const doc = await fetchOpenApi();
    const openapiDocs = doc.paths["/llms.txt"]?.get;

    expect(openapiDocs?.summary).toBe("OpenAPI docs");
    expect(openapiDocs?.description).toBe(
      "Markdown version of the OpenAPI docs, which can be used for LLMs."
    );
    expect(openapiDocs?.responses?.["200"]?.description).toBe(
      "Successful get the markdown version of the OpenAPI docs"
    );
    expect(
      openapiDocs?.responses?.["200"]?.content?.["text/plain"]?.schema
        ?.description
    ).toBe("The markdown version of the OpenAPI docs");
  });
});

describe("/openapi/docs scalar UI", () => {
  it("renders the configured page title and theme", async () => {
    const res = await app.request("/openapi/docs");
    const html = await res.text();

    expect(res.status).toBe(200);
    expect(html).toContain(ENV.APP_TITLE);
    expect(html).toContain("elysiajs");
  });

  it("embeds both OpenAPI source URLs", async () => {
    const res = await app.request("/openapi/docs");
    const html = await res.text();

    expect(html).toContain("/openapi");
    expect(html).toContain("/api/auth/open-api/generate-schema");
    expect(html).toContain(`${ENV.APP_TITLE} (Auth)`);
  });
});

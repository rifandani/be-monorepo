import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { app } from "#app/app.ts";
import { getAllFiles } from "#features/docs/routes.ts";
import { ENV } from "#shared/constants/env.ts";

import { parseServerTimingHeader } from "./util.ts";

describe("/llms-docs endpoint", () => {
  const appDatabaseDoc = `# Database

- Use \`snake_case\` for table and column names.
- On schema changes: \`bun hono db:gen\` then \`bun hono db:migrate\`; commit migration files.
`;

  const appObservabilityDoc = `# Observability

- Request handlers: \`c.get('log').set()\` / \`.error()\` (evlog middleware)
- Outside request scope: \`log\` from \`evlog\` (startup, shutdown, stores)
- Errors: \`throw createError({ message, status, why, fix })\`; handle with \`parseError()\` in \`app.onError\`
- Traces: \`@hono/otel\` + OTEL SDK in \`instrumentation.ts\`
`;

  it("returns the app docs folder, each file followed by a blank line", async () => {
    const res = await app.request("/llms-docs");

    expect(res.status).toBe(200);

    const bodyInEitherReaddirOrder = [
      `${appDatabaseDoc}\n\n${appObservabilityDoc}\n\n`,
      `${appObservabilityDoc}\n\n${appDatabaseDoc}\n\n`,
    ].map((text) => ({ length: 480, text, tokens: 120 }));

    const { links: _links, ...docs } = (await res.json()) as {
      links: unknown;
    };

    expect(bodyInEitherReaddirOrder).toContainEqual(docs);
  });

  it("links the next actions of the app contract as absolute links", async () => {
    const res = await app.request("/llms-docs");
    const { links } = (await res.json()) as { links: unknown[] };

    expect(links).toContainEqual({
      href: `${ENV.APP_URL}/llms.txt`,
      method: "GET",
      title: "OpenAPI docs",
    });
  });

  it("marks the docs response as cacheable for one hour", async () => {
    const res = await app.request("/llms-docs");

    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, immutable"
    );
  });

  it("never serves the repo-root docs folder, such as the ADR-0002 title", async () => {
    const res = await app.request("/llms-docs");
    const { text } = (await res.json()) as { text: string };

    expect(text).not.toContain("# Mutation testing is advisory");
  });

  it("includes Server-Timing under 1s", async () => {
    const res = await app.request("/llms-docs");
    const dur = parseServerTimingHeader(res.headers.get("Server-Timing"));

    expect(dur).not.toBeNull();
    expect(dur).toBeLessThan(1000);
  });
});

describe(getAllFiles, () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { force: true, recursive: true });
      root = undefined;
    }
  });

  it("should collect files from nested directories", async () => {
    root = await mkdtemp(path.join(tmpdir(), "llms-docs-"));
    await writeFile(path.join(root, "top.md"), "top");
    await mkdir(path.join(root, "nested", "deeper"), { recursive: true });
    await writeFile(path.join(root, "nested", "deeper", "leaf.md"), "leaf");

    const files = await getAllFiles(root);

    expect(files.toSorted()).toStrictEqual([
      path.join(root, "nested", "deeper", "leaf.md"),
      path.join(root, "top.md"),
    ]);
  });

  it("should skip symlinks, the only entry that could point outside the directory", async () => {
    root = await mkdtemp(path.join(tmpdir(), "llms-docs-"));
    const target = path.join(root, "real.md");
    await writeFile(target, "real");
    await symlink(target, path.join(root, "link.md"));
    await symlink(root, path.join(root, "loop"));

    const files = await getAllFiles(root);

    expect(files).toStrictEqual([target]);
  });

  it("should return an empty list for an empty directory", async () => {
    root = await mkdtemp(path.join(tmpdir(), "llms-docs-"));

    await expect(getAllFiles(root)).resolves.toStrictEqual([]);
  });
});

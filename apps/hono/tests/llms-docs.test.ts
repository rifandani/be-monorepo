import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { app } from "#app/app.ts";
import { getAllFiles } from "#features/docs/routes.ts";

import { parseServerTimingHeader } from "./util.ts";

describe("/llms-docs endpoint", () => {
  it("returns docs content with length, tokens, and separators", async () => {
    const res = await app.request("/llms-docs");

    const json = (await res.json()) as {
      length: number;
      text: string;
      tokens: number;
    };

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, max-age=3600, immutable"
    );
    const files = await getAllFiles(path.join(process.cwd(), "./docs"));

    const contents = await Promise.all(
      files.map(async (file) => readFile(file, "utf-8"))
    );

    const expectedText = contents.map((content) => `${content}\n\n`).join("");

    expect(files.length).toBeGreaterThan(0);
    expect(json).toStrictEqual({
      length: expectedText.length,
      text: expectedText,
      tokens: expectedText.length / 4,
    });
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

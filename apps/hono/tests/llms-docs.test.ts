import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { app } from "@/app.js";
import { getAllFiles } from "@/routes/llms-docs.js";

import { parseServerTimingHeader } from "./util.js";

describe("/llms-docs endpoint", () => {
  it("returns docs content with length, tokens, and separators", async () => {
    const res = await app.request("/llms-docs");
    const json = (await res.json()) as {
      length: number;
      text: string;
      tokens: number;
    };

    expect(res.status).toBe(200);
    expect(json.text).toHaveLength(json.length);
    // TOKENS_PER_CHARACTER is 4 — pin the ratio so a mutant flipping the
    // division cannot hide behind `expect.any(Number)`.
    expect(json.tokens).toBe(json.length / 4);
    // Each file is joined with a trailing `\n\n`, so ADR prose shows up and the
    // separator is not an empty string or a Stryker placeholder.
    expect(json.text).toContain("Mutation testing is advisory");
    expect(json.text).toContain("\n\n");
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
    if (root) {
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
    // `readdir` reports the link type without resolving it, so the link is
    // neither a file nor a directory and gets dropped.
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

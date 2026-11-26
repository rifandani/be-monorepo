import path from "node:path";

import type { Options, RuleOptionsSchema } from "@oxlint/plugins";
import { Schema } from "effect";

import { isTestFile } from "./effect-modules.ts";

export const allowOptionSchema: RuleOptionsSchema = [
  {
    type: "object",
    properties: { allow: { type: "array", items: { type: "string" } } },
    additionalProperties: false,
  },
];

const decodeOptions = Schema.decodeUnknownSync(
  Schema.Tuple([
    Schema.optionalKey(
      Schema.Struct({
        allow: Schema.optionalKey(Schema.Array(Schema.String)),
      })
    ),
  ])
);

export const decodeAllowOption = (
  options: Readonly<Options>
): readonly string[] | undefined => decodeOptions(options)[0]?.allow;

export const normalizePath = (file: string): string =>
  file.replaceAll("\\", "/");

export function isAllowed(filename: string, globs: readonly string[]): boolean {
  const segments = normalizePath(filename).split("/");
  const suffixes = segments.map((_, index) => segments.slice(index).join("/"));

  return globs.some((glob) =>
    suffixes.some((suffix) => path.matchesGlob(suffix, glob))
  );
}

const DEFAULT_TEST_FILES: readonly string[] = ["apps/*/tests/**"];

export const isTestPath = (
  filename: string,
  testFiles: readonly string[] = DEFAULT_TEST_FILES
): boolean => isTestFile(filename) || isAllowed(filename, testFiles);

import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";
import vitest from "ultracite/oxlint/vitest";

export default defineConfig({
  extends: [core, antiSlop, vitest],
  // Type-aware rules use TypeScript type information. Compiler diagnostics
  // also replace the separate `tsc --noEmit` checks in this monorepo.
  options: {
    typeAware: true,
    typeCheck: true,
  },
  rules: {
    // Keep type-aware checks that catch unsafe values, floating promises and
    // invalid await usage. These rules flag intentional truthiness checks and
    // promise-forwarding patterns throughout the existing codebase.
    "typescript/return-await": ["error", "in-try-catch"],
    "typescript/no-confusing-void-expression": "off",
    "typescript/consistent-return": "off",
    "typescript/no-unnecessary-type-parameters": "off",
    "typescript/no-unnecessary-type-conversion": "off",
    "typescript/no-unnecessary-template-expression": "off",
    "typescript/no-base-to-string": "off",
    // Oxlint's typed promise rule can require `async` without an `await`, which
    // conflicts with Ultracite's `require-await` rule. Keep the typed rule.
    "eslint/require-await": "off",
    // The no-op Span follows OTel's fluent Span interface, whose mutators
    // return Span even when the linter sees a void callback context.
    "typescript/strict-void-return": "off",
    "sort-keys": "off",
    "no-inline-comments": "off",
    "unicorn/no-array-reduce": "off",
    "promise/prefer-await-to-callbacks": "off",
  },
  overrides: [
    {
      // Tests deliberately model external JSON and request fixtures. Keep
      // compiler checks on, but do not lint those fixture assertions as
      // production data boundaries.
      files: ["**/*.test.ts", "**/*.test.tsx", "apps/*/tests/**"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-enum-assignment": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-return": "off",
        "typescript/no-unsafe-type-assertion": "off",
        "typescript/prefer-promise-reject-errors": "off",
        "typescript/unbound-method": "off",
        "eslint/prefer-promise-reject-errors": "off",
        "unicorn/no-useless-promise-resolve-reject": "off",
      },
    },
    {
      // These config files consume JSON/tool config shapes that their source
      // packages do not export as stable TypeScript interfaces.
      files: ["scripts/security/**", "stryker.config.mjs"],
      rules: {
        "typescript/no-unsafe-assignment": "off",
        "typescript/no-unsafe-call": "off",
        "typescript/no-unsafe-member-access": "off",
        "typescript/no-unsafe-type-assertion": "off",
      },
    },
    {
      // Test bodies fabricate values on purpose: response bodies are cast to the shape the assertions read, `as never` reaches a specific overload, and partial doubles stand in for real collaborators. anti-slop's type-modelling rules are aimed at production signatures, so they only generate noise here.
      files: ["**/*.test.ts", "**/*.test.tsx", "apps/*/tests/**"],
      rules: {
        "anti-slop/no-chained-type-assertions": "off",
        "anti-slop/no-unknown-parameters": "off",
        "anti-slop/no-unsafe-dictionary-type": "off",
        "anti-slop/require-safety-comment-for-type-assertion": "off",
      },
    },
  ],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    "**/.agents",
    "**/.claude",
    "**/.cursor",
    "**/.repos",
    "**/repos",
    "**/docs",
    "apps/hono/src/server/db/migrations/**",
  ],
});

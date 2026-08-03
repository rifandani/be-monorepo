import vitestConfig from "./vitest.config.ts";

/**
 * Mutation testing is **advisory and on-demand** — never a gate. The rationale,
 * the vocabulary, and the workflow for acting on a survivor live in
 * `docs/adr/0002-mutation-testing-is-advisory.md`.
 *
 * Imported from `vitest.config.ts` rather than restated here so the mutation
 * scope cannot drift from the coverage denominator. Node strips the types on
 * this import; the root config is safe to load because, unlike
 * `apps/hono/vitest.config.ts`, it has no side effects at config-eval time.
 */
const { include = [], exclude = [] } = vitestConfig.test.coverage;

export default {
  $schema: "./node_modules/@stryker-mutator/core/schema/stryker-schema.json",

  // The mutation scope is the *coverage denominator*: `include` minus
  // `exclude`, not `include` alone. Mutating the excluded layers would emit
  // guaranteed survivors — ADR-0001 leaves them untested on purpose — and a
  // report that is mostly noise is a report nobody reads. Deriving it also
  // makes ADR-0001's two conditional exclusions self-healing: the commit that
  // drops `middlewares/auth.ts` from `exclude` pulls it into scope here.
  mutate: [...include, ...exclude.map((pattern) => `!${pattern}`)],
  // Deliberately empty, recorded here rather than omitted so the choice is visible at
  // the site a reader would check. Excluding a whole mutator class is an empirical
  // claim; making it before reading a report blinds the tool to its own best findings.
  mutator: { excludedMutations: [] },

  testRunner: "vitest",
  // Named explicitly rather than left to the default `["@stryker-mutator/*"]`
  // glob. bun installs into `node_modules/.bun/**` and leaves symlinks behind
  // in `node_modules/@stryker-mutator/`, which that glob does not follow — the
  // runner silently fails to load and the run dies with "no TestRunner plugins
  // were loaded" plus a misleading "Unknown stryker config option vitest".
  plugins: ["@stryker-mutator/vitest-runner"],

  vitest: {
    configFile: "vitest.config.ts",
    // Vitest's module graph resolves `apps/hono`'s `@workspace/core` alias, so
    // a mutant in `packages/core/src` is still offered to the hono route tests
    // that reach it through the alias. Explicit because that cross-project
    // reach is the one thing this option could silently get wrong, and the
    // symptom would be a false survivor.
    related: true,
  },

  // Points at nothing on purpose, which disables Stryker's tsconfig
  // preprocessor. That preprocessor exists to rewrite `extends`/`references`
  // paths that would escape the sandbox, and this repo has none to rewrite:
  // the root tsconfig extends the bare specifier
  // `@workspace/typescript-config/base.json`, resolved through the symlinked
  // node_modules. It also cannot run here — it calls
  // `ts.parseConfigFileTextToJson`, which TypeScript 7's native port removed.
  // The tsconfig files are still copied into the sandbox; only the rewrite is
  // skipped. Revisit if a tsconfig ever gains a relative `extends`.
  tsconfigFile: "",

  // `coverageAnalysis` is not set: the vitest runner forces "perTest"
  // regardless. It also disables vitest coverage, so the `thresholds.perFile`
  // gate in `vitest.config.ts` never fires during a mutation run, and mutants
  // no test reaches are reported `NoCoverage` without invoking vitest at all.

  // Determinism over speed. `disableBail` runs a mutant against every covering
  // test instead of stopping at the first failure, so the report says which
  // tests catch it rather than merely that one does; `concurrency: 2` keeps
  // the machine from starving runs into spurious timeouts.
  concurrency: 2,
  disableBail: true,

  // Advisory means advisory: `break: null` is the default, set explicitly so
  // nobody "fixes" the exit code later. A non-null value would turn the
  // workflow_dispatch job into a gate in everything but name. `high`/`low`
  // only tint the HTML report — this repo states no mutation score target.
  thresholds: { high: 80, low: 60, break: null },

  // Off by default; opt in per invocation with `bun run test:mutate
  // --incremental` for local iteration only. Stryker keys the cache on source
  // and test file content and does **not** watch this config, so a change to
  // the coverage include/exclude leaves stale results for a scope that no
  // longer exists — delete the file after any such change.
  incremental: false,
  incrementalFile: "coverage/stryker/incremental.json",

  // Sibling of `coverage/vitest`, for the same reason ADR-0001 gives: the
  // `coverage` gitignore entry already covers it, and bare `coverage/` stays
  // reserved for fallow's runtime sidecar traces.
  reporters: ["html", "json", "clear-text", "progress"],
  htmlReporter: { fileName: "coverage/stryker/mutation.html" },
  jsonReporter: { fileName: "coverage/stryker/mutation.json" },

  // Stryker copies the working tree into `.stryker-tmp/sandbox-*` and consults
  // only this list — `.gitignore` is NOT honoured, which is why
  // `apps/hono/.env.dev` still reaches the sandbox, as it must. Beyond the
  // always-ignored `node_modules`, `.git`, `/reports` and `.stryker-tmp`,
  // nothing below participates in a test run.
  //
  // `/.claude` is not an optimisation: `.claude/skills` is a symlink to
  // `../.agents/skills`, and Node's `copyFile` fails with ENOTSUP on a
  // directory symlink, aborting the whole run. Any new top-level symlink needs
  // adding here too.
  //
  // Only add a directory here once it is *known* inert. `/docs` looked inert
  // and is not: `routes/llms-docs.ts` reads `path.join(process.cwd(), "./docs")`
  // at request time, so excluding it made that route 500 and failed the dry
  // run. Tool configuration is safe; anything a test may read from disk is not.
  ignorePatterns: [
    ".claude",
    ".agents",
    ".cursor",
    ".fallow",
    ".husky",
    ".vscode",
    ".changeset",
    ".github",
    "docker",
    "coverage",
    "**/docs/**",
    "**/dist/**",
    "**/build/**",
    "**/.evlog/**",
    "**/.vercel/**",
    "**/.repos/**",
  ],
};

---
status: accepted
---

# Mutation testing is advisory

ADR-0001 enforces a 90% per-file coverage gate, which proves lines **ran** — not that anything **asserted** on them. Mutation testing closes that gap by deliberately breaking the source and checking whether a test notices. It runs **on demand, from a human's keyboard**, and gates nothing: `bun run test:mutate`, plus a `workflow_dispatch`-only CI job for running it on someone else's hardware. There is no scheduled run, no PR check, and no score to defend.

## Vocabulary

> **Mutant** — one small deliberate change to the source (`>` becomes `>=`, `&&` becomes `||`, a string literal becomes `""`). Stryker generates them from the syntax tree; nothing is written to your working tree, the mutation happens inside a sandbox copy under `.stryker-tmp/`.
>
> **Killed** — at least one test failed while the mutant was active. The desired outcome: the behaviour is pinned down.
>
> **Survivor** — every covering test still passed. Either an assertion is missing, or the mutated behaviour genuinely does not matter.
>
> **NoCoverage** — no test reaches the mutant at all, so it was never run. Under ADR-0001's gate this should be rare inside the mutation scope.
>
> **Timeout** — the mutant made a test hang (a mutated loop condition, typically). Counted as killed: an infinite loop is a detected change.
>
> **Mutation score** — killed ÷ generated, as a percentage. A **diagnostic readout, not a target.** It moves under behaviour-preserving refactors, is not comparable between files of different shapes, and nothing in this repo tracks or compares it between runs.
>
> **Mutation scope** — the set of files Stryker mutates. Derived, never hand-written; see below.
>
> **Hand-confirmed** — a survivor that a person reproduced in isolation and then acted on. Until that happens a survivor is a *candidate*, not a finding.

## Why advisory and not a gate

A mutation score is not a stable quantity to gate on. It shifts when code is restructured without any behaviour change, and the cheapest way to raise it is always to write assertions that pin down accidents of the current implementation — which makes the suite worse at its actual job of permitting refactors. ADR-0001's coverage gate is safe to enforce precisely because it measures something coarse; a mutation gate would optimise for the metric.

Gating also mismatches the runtime. A full run takes minutes, not seconds, because `disableBail: true` runs every mutant against *all* its covering tests rather than stopping at the first failure — the report then says which tests catch a mutant, not merely that one does.

`thresholds.break` is `null`, set explicitly in `stryker.config.mjs` so nobody restores an exit code later. The dispatch job therefore always exits 0; its output is the uploaded HTML report, not a check mark.

## The mutation scope is derived, never written

`stryker.config.mjs` imports the root `vitest.config.ts` and computes:

```js
mutate: [...include, ...exclude.map((pattern) => `!${pattern}`)]
```

The scope is the **coverage denominator** — `coverage.include` *minus* `coverage.exclude` — and not `include` alone. Mutating the layers ADR-0001 excludes would emit survivors by construction, since those layers are untested on purpose; a report that is mostly expected noise is a report nobody reads.

Deriving it also makes ADR-0001's two **conditional** exclusions self-healing. When CI gains a database and `middlewares/auth.ts` leaves the exclude list, the same commit pulls it into the mutation scope. There is no second list to remember, and no way for the two to drift.

`apps/hono/tests/**` sits outside both `coverage.include` globs, so route tests are killers only, never targets. That is correct and deliberate.

## Suppressing a mutant

StrykerJS syntax, which differs from Stryker.NET's — there is no `once` keyword:

```ts
// getRuntimeKey() returns "node" under vitest and "bun" in production.
// Stryker disable next-line EqualityOperator: no test run reaches the bun side
if (getRuntimeKey() === "bun") {
```

The rules:

- **One line, always `next-line`.** `next-line` targets the line immediately following the comment, so the `// Stryker …` line must be the *last* line before the code. Prose goes above it — a wrapped reason silently retargets the directive at another comment and the mutant survives anyway.
- **Name the mutators, never `all`.** `EqualityOperator`, `ConditionalExpression`, `StringLiteral`. The name records which mutation was judged unkillable; `all` throws that away and also swallows future mutants the line has not seen yet.
- **A reason is mandatory.** It renders in the HTML report, which is the only place a future reader meets it.
- **No `restore`, no file-scope disables.** A `disable`/`restore` pair silently widens as code is added between them.
- **No `mutator.excludedMutations`.** Disabling a mutator class repo-wide is a claim that needs evidence from a real run, not a guess.

Sanctioned reasons, per Stryker's own guidance: the mutation always times out, the mutation is invalid in this specific case, or no reasonable test could kill it. **Anything wider than one line is not a suppression** — it is a scope decision, and belongs in ADR-0001's exclusion table where the whole set is reviewed together.

The goal is not 100%. A suppression is how a completed judgement is recorded so the next run does not re-surface it; without that, accepted survivors accumulate in the report until people stop opening it.

## Working with a survivor

A survivor is a candidate until reproduced on its own. Two things in this repo can manufacture false verdicts: `isolate: false` with `pool: "threads"` means test files in a worker share module state and one process-wide MSW `server`, and `related: true` varies which files load together per mutant; separately, a machine under load can push a test past `timeoutMS` and report a mutant killed by Timeout when it is not.

Stryker's `mutate` accepts a position range, so confirming one survivor costs seconds rather than the minutes a full run takes:

```sh
bunx stryker run --mutate "packages/core/src/utils/core.ts:42:11-42:19"
```

- **Still survives** → kill it with a test, or suppress it with a reason.
- **Killed when run alone** → not a coverage gap. It is a test-isolation problem, which is the more interesting bug.

## Running it

```sh
# full scope, authoritative
bun run test:mutate

# local iteration only, reuses cached results
bun run test:mutate --incremental

# mandatory after any change to coverage.include/exclude
rm coverage/stryker/incremental.json
```

Incremental is **off by default** and opted into per invocation, so the flag appears in the shell history of the run that used it. Stryker keys its cache on source and test file content and does **not** watch `stryker.config.mjs`, so a scope change leaves cached results for a scope that no longer exists — silently. Delete the file.

`apps/hono/.env.dev` is a hard precondition. `apps/hono/vitest.config.ts` loads it at config-eval time, so without it every hono test fails, the dry run aborts, and the run dies — including the `packages/core` mutants that have nothing to do with it. `cp apps/hono/.env.dev.example apps/hono/.env.dev` first.

Reports go to `coverage/stryker/`, sibling to `coverage/vitest` and for the same reason ADR-0001 gives: the `coverage` gitignore entry already covers it, and bare `coverage/` stays reserved for fallow's runtime sidecar traces.

## Consequences

- **The scope cannot drift, but it can be silently over-trimmed.** Stryker copies the working tree into `.stryker-tmp/sandbox-*` and consults only `ignorePatterns` — `.gitignore` is not honoured, which is what lets `apps/hono/.env.dev` reach the sandbox at all. Only add a directory to `ignorePatterns` once it is *known* inert: `/docs` looked inert and is not, because `routes/llms-docs.ts` reads `path.join(process.cwd(), "./docs")` at request time, and excluding it made that route 500 and failed the dry run.
- **`/.claude` must stay in `ignorePatterns`.** `.claude/skills` is a committed symlink to `../.agents/skills`, and Node's `copyFile` fails with `ENOTSUP` on a directory symlink, aborting the whole run. Any new top-level symlink needs adding there too.
- **`plugins` is set explicitly.** bun installs into `node_modules/.bun/**` and leaves symlinks in `node_modules/@stryker-mutator/`, which Stryker's default `["@stryker-mutator/*"]` discovery glob does not follow. Without `plugins: ["@stryker-mutator/vitest-runner"]` the runner never loads, and the failure presents as a misleading `Unknown stryker config option "vitest"` warning followed by `no TestRunner plugins were loaded`.
- **`tsconfigFile` points at nothing on purpose.** Stryker's sandbox preprocessor rewrites `extends`/`references` paths that escape the sandbox by calling `ts.parseConfigFileTextToJson`, which TypeScript 7's native port removed. There is nothing here to rewrite — the root tsconfig extends the bare specifier `@workspace/typescript-config/base.json`, resolved through symlinked `node_modules` — so the preprocessor is disabled rather than worked around. Revisit if a tsconfig ever gains a relative `extends`.
- **fallow:** `stryker.config.mjs` is discovered by name by the CLI, so no import edge reaches it and it needs `unused-files: "off"` in `.fallowrc.json`, exactly like `vitest.msw-setup.ts`. `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` need `ignoreDependencies` entries for the same reason — nothing imports them, the CLI and the plugin loader find them by name. The config carries no `@type` JSDoc annotation: it would only be worth a third devDependency (`@stryker-mutator/api`) for editor hints, and `$schema` already covers the same ground. `fallow` is a blocking CI job, so getting any of this wrong turns it red.
- **The vitest runner overrides parts of the test config, and that is fine.** It forces `coverageAnalysis: "perTest"` and disables vitest coverage, so ADR-0001's `thresholds.perFile` gate never fires during a mutation run and mutants no test reaches are reported `NoCoverage` without invoking vitest.
- **`related: true` was validated, not assumed.** Vitest's module graph resolves `apps/hono`'s `@workspace/core` alias, so a mutant in `packages/core/src` is still offered to hono tests that reach it. Verified on `packages/core/src/utils/logger.ts`: identical verdicts with `related` true and false, 4 seconds against 1 minute 16.

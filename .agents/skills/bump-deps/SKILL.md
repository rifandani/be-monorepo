---
name: bump-deps
description: Bump JS deps via ncu, read majors, green the gates, hand off to commit + /release.
disable-model-invocation: true
---

# Bump deps

Leading word: **bump**. Universe is the root `bump:deps` script.

## 1. Apply

`bun bump:deps`, then `bun i`.

**Done when:** install succeeded and git shows `package.json` / `bun.lock` version moves.

## 2. Classify

Diff old → new versions.

- **Major** — GitHub changelog. If the package ships an upgrade blog (Hono, Vite/Vitest, TypeScript, etc), read that too. Brief breaking changes that bite *this* repo, then continue.
- **Minor** — same, but only for the **popular** set, or a package that later fails a gate: Hono, TypeScript, Vitest, Ultracite/oxlint, Better Auth.
- **Patch** — skip notes.

**Done when:** every major and every popular-minor is accounted for — notes read, bites briefed, required code listed.

## 3. Adapt

Apply the required code/config from step 2.

**Replace, don’t decorate.** Adopt experimental APIs only when they retire a pattern this repo already has (workaround, TODO, or a config we already set). New knobs with no current use → mention in the report, leave off.

### Schema edits carry a migration

A touch to `apps/hono/src/db/schema.ts` is **migration debt** — drizzle and Better Auth majors both land there. Pay it in the same bump:

1. `bun hono db:gen` writes the `.sql`, the snapshot, and the journal entry. Only it edits those three.
2. **One migration per bump.** Already holding an uncommitted one from this bump? Delete its `.sql` and snapshot, drop its `_journal.json` entry, re-gen.
3. SQL drizzle cannot infer (a rename it reads as drop-plus-add) goes in the generated `.sql` behind `--> statement-breakpoint`. With no schema diff to append to, `bun hono db:gen --custom` opens an empty one.
4. Better Auth majors: `bun hono auth:gen` writes `src/db/auth-schema.ts`, which drizzle does not read here — treat it as reference, hand-reconcile into `schema.ts`, re-gen.

**Backfill** rows the move leaves wrong, as **expand → backfill → contract**: nullable column, fill, then tighten in the next migration. A set-based fill is a hand-written `UPDATE` in the migration itself — precedent: `0002_stiff_silvermane.sql`. When the fill needs app logic, an external call, or batching, pair the migration with `src/db/backfills/<migration-tag>.ts` shaped like `src/db/seed.ts`, re-runnable (`WHERE col IS NULL`) and batched, run with `cd apps/hono && bunx dotenvx run --env-file=.env.dev -- bun <path>` (`dotenvx` resolves only in that package).

**Done when:** every bite has an edit, or the report says it does not apply — and where `schema.ts` moved, a second `bun hono db:gen` reports no schema changes.

## 4. Gates

Loop until all green, in parallel/subagent:

1. `bun lint-typecheck`
2. `bun test:cov`
3. `bun hono node:build`
4. `bun audit:sca`
5. `bun check:all`

**Done when:** all commands pass.

## 5. Hand off

Report: majors + popular minors, breaking changes that bite, code/config edits, experimental adoptions (and skipped knobs), and any generated migration — name it, and give the run order the user still owes against a real database (`bun hono db:migrate`, then a backfill script, then the contracting migration).

Leave the diff uncommitted. Tell the user the next step is: **check the report → commit → `/release`**.

**Done when:** that report is delivered and that next-step line is spoken.

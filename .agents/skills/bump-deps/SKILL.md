---
name: bump-deps
description: Pull the vendored subtrees, bump JS deps via ncu, read majors, green the gates, hand off to commit + /release.
disable-model-invocation: true
---

# Bump deps

Leading word: **bump**. Universe is the root `bump:deps` script plus the vendored subtrees under `repos/`.

## 1. Sync

Pull each vendored upstream **first**: `git subtree pull` commits, so it needs the clean tree that step 2 destroys.

| prefix | remote | branch |
| --- | --- | --- |
| `repos/effect` | `https://github.com/Effect-TS/effect.git` | `main` |
| `repos/hono` | `https://github.com/honojs/hono.git` | `main` |

```bash
git subtree pull --prefix=<prefix> <remote> <branch> --squash
```

One row for each directory under `repos/`. A directory with no row means the table is stale — find the upstream, pull it, and add the row here.

A conflict here is upstream against a local edit of read-only reference files. Take upstream (`git checkout --theirs -- <prefix>`), then say so in the report.

**Done when:** each directory under `repos/` is pulled — every pull either reported already up to date or wrote a squash commit.

## 2. Apply

`bun bump:deps`, then `bun i`.

Then bump the node runtime: set `.node-version` to the newest release on the 26.x line (`curl -s https://nodejs.org/dist/index.json | head -c 200`). Leave `engines.node` alone — it is the support floor, not the pin.

**Done when:** install succeeded, git shows `package.json` / `bun.lock` version moves, and `.node-version` is current.

## 3. Classify

Diff old → new versions.

- **Vendored** (each `repos/` prefix) — read the source you just pulled: its changelog, migration guide, and the API this repo calls. It beats GitHub, and it is already on disk.
- **Major** — GitHub changelog. If the package ships an upgrade blog (Hono, Vite/Vitest, TypeScript, etc), read that too. Brief breaking changes that bite *this* repo, then continue.
- **Minor** — same, but only for the **popular** set, or a package that later fails a gate: Hono, TypeScript, Vitest, Ultracite/oxlint, Better Auth.
- **Patch** — skip notes.

**Done when:** every major and every popular-minor is accounted for — notes read, bites briefed, required code listed.

## 4. Adapt

Apply the required code/config from step 3.

**Replace, don’t decorate.** Adopt experimental APIs only when they retire a pattern this repo already has (workaround, TODO, or a config we already set). New knobs with no current use → mention in the report, leave off.

### Schema edits carry a migration

If you change `apps/hono/src/db/schema.ts`, you must also write a migration. Drizzle majors and Better Auth majors both change this file. Write the migration in the same bump.

1. Run `bun hono db:gen`. It writes the `.sql` file, the snapshot, and the journal entry. Do not edit these three files yourself.
2. Write only one migration for each bump. If this bump has a migration that you did not commit, delete its `.sql` file and its snapshot, remove its entry from `_journal.json`, then run `bun hono db:gen` again.
3. Drizzle cannot find a rename. It reads a rename as a drop and an add. Write this SQL yourself in the generated `.sql` file, after `--> statement-breakpoint`. If there is no schema difference, run `bun hono db:gen --custom` to make an empty migration.
4. For a Better Auth major, run `bun hono auth:gen`. It writes `src/db/auth-schema.ts`. Drizzle does not read that file here. Use it only as a reference: copy the changes into `schema.ts` yourself, then run `bun hono db:gen` again.

If the change makes rows incorrect, correct the data in three steps: expand, backfill, then contract. First add a column that permits null values. Then fill the column. Then make the column more strict in the next migration.

For a simple fill, write an `UPDATE` statement in the migration. If the fill needs app logic, an external call, or batches, write a script at `src/db/backfills/<migration-tag>.ts`. Use `src/db/seeds/seed-user.ts` as the model. Make the script batched, and make sure that you can run it more than one time (for example, with `WHERE col IS NULL`). Run it with `cd apps/hono && bunx dotenvx run --env-file=.env.dev -- bun <path>`, because `dotenvx` is available only in that package.

**Done when:** you did an edit for each bite, or the report tells that the bite does not apply. If you changed `schema.ts`, a second `bun hono db:gen` must report no schema changes.

## 5. Gates

Loop until all green, in parallel/subagent:

1. `bun lint-typecheck`
2. `bun test:cov`
3. Boot each app on Node and hit one route, then stop it: `bun effect node:start` → `curl localhost:$PORT/health/ready`, `bun hono node:start` → `curl localhost:$PORT/openapi`. Both must answer `200`. There is no build step to stand in for this any more — since ADR-0003 the apps run their own `.ts`, so a wrong import specifier fails at startup and gate 1 will not catch it.
4. `bun audit:sca`
5. `bun check:all`

**Done when:** all commands pass.

## 6. Hand off

Report: subtrees pulled (and any conflict you resolved toward upstream), majors + popular minors, breaking changes that bite, code/config edits, experimental adoptions (and skipped knobs), and any generated migration — name it, and give the run order the user still owes against a real database (`bun hono db:migrate`, then a backfill script, then the contracting migration).

The subtree pulls are already committed; leave the dep diff uncommitted. Tell the user the next step is: **check the report → commit → `/release`**.

**Done when:** that report is delivered and that next-step line is spoken.

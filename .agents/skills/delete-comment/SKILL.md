---
name: delete-comment
description: Classify the code comments that remain in the repo, delete them, move decisions to ADRs, file issues for workarounds, and lower the comment baseline.
disable-model-invocation: true
---

# Delete comments

The repo bans code comments ([ADR-0006](../../../docs/adr/0006-code-has-no-comments.md)). The `local/no-comments` lint rule holds a **ratchet**: `.oxlint-plugins/no-comments-baseline.ts` lists the files that may still keep comments and how many. This skill removes more of them and turns the ratchet down. Work on a branch, not on `main`.

## 1. Inventory

Scope: the files in the baseline, plus every JS/TS file that oxlint does not lint (its `ignorePatterns` skip `**/docs`, so `apps/hono/src/features/docs/` has comments the rule cannot see). Use the user's scope if one is given. Leave `repos/`, `.agents/skills/` and generated migrations alone.

List every comment with its file and line. Merge adjacent line comments into one **block**. Read the code around each block.

**Done when:** every comment in scope is in the list, and the list count matches the baseline total plus the unlinted files.

## 2. Classify

Give each block exactly one category:

- **Tautology** — it repeats what the code, a name, a test title, or an ADR already says. `Arrange`/`Act`/`Assert`, field labels, "15 seconds" beside `15_000`.
- **Stale** — it describes code that is gone or changed: commented-out code, a path that moved, a count that is wrong, "used to" history.
- **Excuse** — it justifies a workaround: a lint or tool suppression, a `SAFETY:` cast, a disabled rule, a defensive branch for a case that cannot happen, code bent around a tool bug.
- **Decision Record** — it records a non-obvious, hard-to-reverse choice and the reason. Check `docs/adr/` and `apps/*/docs/adr/` first: a decision that an ADR already holds is still a Decision Record, with nothing new to move.

A block that mixes categories takes the strongest one, in this order: Excuse, Decision Record, Stale, Tautology. Keep the other parts in mind for step 3.

**Done when:** every block has one category, and every Decision Record names its target ADR.

## 3. Act

- **Tautology, Stale:** delete. If the code is unclear without the comment, improve a name.
- **Decision Record:** write the decision into its ADR in short, active sentences, then delete the comment. Repo-wide and `apps/hono` decisions go in `docs/adr/`. `apps/hono/docs/` is served by `GET /llms-docs`, so it gets no ADRs. `apps/effect` decisions go in `apps/effect/docs/adr/`. Add to an ADR on the same topic before you make a new one. A new ADR follows `.agents/skills/domain-modeling/ADR-FORMAT.md`.
- **Excuse:** file a GitHub issue that names the workaround, every location, and the fix (`docs/agents/issue-tracker.md`; add the triage label from `docs/agents/triage-labels.md` only if the repo has it). One issue covers one workaround at all of its locations. Search open issues first and add to a match. Then remove the workaround so the comment can go. A directive that a tool reads (`oxlint-disable`, `SAFETY:` for `anti-slop`, `fallow-ignore`) stays until its fix lands: deleting it alone breaks lint. Run `/upkeep-lint-suppressions` for the fix when the user agrees.

Remove each comment with its whole line. Run `bunx oxfmt` on the changed files.

**Done when:** every block has its action done, and each kept directive has an issue number.

## 4. Lower the baseline

Run `bun run lint:comments`. It lowers each count to the real count and drops files that have none. It never raises a count. A count that must go up is a manual edit to the baseline file, and the user must approve it.

Run `bun run lint`, `bun run check:all`, and `bun run test`. The Hono tests read an env file, which the sandbox blocks: run them outside it.

**Done when:** all three pass, and the baseline total is lower than at the start, or every remaining comment has an issue that blocks its removal.

## 5. Report

Give the counts per category, the ADRs changed, the issues filed, the baseline before and after, and the lines removed (`git diff --shortstat`). List each remaining comment with its issue.

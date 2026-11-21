---
status: accepted
---

# Code has no comments

JavaScript and TypeScript files in this repository have no comments. The `local/no-comments` oxlint rule (`.oxlint-plugins/no-comments.ts`) enforces this. A comment can repeat the code, go stale, or excuse a workaround that other code then copies. None of these is visible to the compiler, to the tests or to review of a later change.

## What goes where instead

| The comment was | Do this instead |
| --- | --- |
| A **tautology**: it repeats what the code says | Delete it. Improve a name if the code is not clear. |
| **Stale**: it describes code that changed | Delete it. |
| An **excuse** for a workaround | Delete it and file a GitHub issue to remove the workaround. |
| A **decision record**: a non-obvious decision | Move it to an ADR: `docs/adr/` for the repository or for `apps/hono`, `apps/<app>/docs/adr/` for one app. |

Hono ADRs are in the root `docs/adr/`, not `apps/hono/docs/adr/`, because `GET /llms-docs` serves every file under `apps/hono/docs`.

Use the `/delete-comment` skill to repeat this process.

## Ratchet

`.oxlint-plugins/no-comments-baseline.ts` maps a file to the number of comments it may keep. A file that is not in the baseline may have no comments.

- **More comments than the baseline** fails lint on every comment in the file.
- **Fewer comments than the baseline** also fails lint. Run `bun run lint:comments` to lower the baseline. The script only lowers counts and removes entries for files that do not exist. It never raises a count.
- **A higher count is a manual edit** to the baseline file, which a reviewer sees in the diff.

The first baseline holds only comments that a tool reads: `oxlint-disable` directives and the `SAFETY:` comments that `anti-slop/require-safety-comment-for-type-assertion` requires. Each one has an issue that removes the workaround. A `#!` line is not a comment for this rule.

## Consequences

- **A new type assertion needs a baseline edit**, because `anti-slop` requires a `SAFETY:` comment for it. Parse the value or narrow it with a type guard instead.
- **A new lint suppression needs a baseline edit.** This makes each suppression a reviewed decision. The `/upkeep-lint-suppressions` skill removes them.
- **The rule covers what oxlint lints.** The oxlint `ignorePatterns` skip `**/docs`, so `apps/hono/src/features/docs/routes.ts` is not checked. It keeps two `fallow-ignore-next-line` directives. YAML, shell, Dockerfile and Markdown comments are out of scope.
- **`@public` JSDoc tags were Fallow input.** The unmounted rate-limit middleware is now a Fallow `entry` in `.fallowrc.json`.

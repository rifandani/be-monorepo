## Language

Always talk in ASD-STE100 Simplified Technical English.

## Vendored Repositories

This project vendors external repositories under @repos/ for coding-agent reference.

- Use vendored repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from vendored source code over generated guesses or web search results.
- Do not edit files under @repos/ unless explicitly asked.
- Do not import from @repos/; application code should continue importing from normal package dependencies.

When working with a related library, inspect its vendored repository for idiomatic usage, tests, module structure, API design, examples, and docs. If the vendored repository contains agent-oriented guidance such as LLMS.md, AGENTS.md, or AGENT.md, read that guidance before making changes.

## Agent skills

### Issue tracker

GitHub Issues via `gh` CLI (`rifandani/be-monorepo`). See `docs/agents/issue-tracker.md`.

### Triage labels

Defaults: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context — root `GLOSSARY-MAP.md` pointing at per-package `GLOSSARY.md` files. See `docs/agents/domain.md`.

## Property tests

Write a property test when a rule says "always" or "never". Put it after the example tests of the same function. Keep the example tests.

- `apps/hono`: `import * as fc from "fast-check"`, then `await fc.assert(fc.asyncProperty(...))` in a normal vitest `it`. A sync property is `fc.assert(fc.property(...))` without `await`. Do not use `@fast-check/vitest`: the vitest lint rules do not accept its `it`.
- `apps/effect`: `it.prop` / `it.effect.prop` from `@effect/vitest`, with `Schema` arbitraries (Effect `Arbitrary` engine, not fast-check).
- Runs: 25 locally, 100 in CI. Set `PBT_NUM_RUNS` to change it. Do not set a run count in a test.
- A failed test prints `Replay: PBT_SEED=… PBT_NUM_RUNS=… bun run test run <file> -t '<name>'`. Run that line to reproduce the failure. Do not weaken a property to make it pass: report the counterexample.
- Rules for writing tests: the `/javascript-testing-expert` skill. Reasons for the budget and seed: `docs/adr/0005-property-based-tests.md`.

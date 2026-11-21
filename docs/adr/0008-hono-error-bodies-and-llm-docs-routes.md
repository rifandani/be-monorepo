---
status: accepted
---

# Hono error bodies and LLM documentation routes

These records came from code comments in `apps/hono`. [ADR-0006](./0006-code-has-no-comments.md) moved them here.

## Error handler (`src/app/app.ts`)

- **`ts-pattern` uses `otherwise`, not `exhaustive`.** Hono gives `onError` an open `Error`, so there is no union to close.
- **The body holds exactly `message` and the evlog hints.** `parseError` lifts `why`, `fix` and `link` only for an `EvlogError`; `shake` drops the hints that it did not supply. `tests/error-handling.test.ts` uses `toStrictEqual`, so a change cannot leak `code` or `raw` into the response.
- **The test routes use `get`, not `openapi`.** Those routes then stay out of the OpenAPI document, so they cannot leak into the `/openapi` and `/llms.txt` assertions that share the app instance.

## LLM documentation routes (`src/features/docs/routes.ts`)

- **Registration order matters.** The Markdown routes snapshot the OpenAPI document when they register. `GET /llms-auth.txt` registers after the Better Auth routes, and `GET /llms.txt` registers last, so every route is already indexed. `/llms.txt` follows the proposal at <https://llmstxt.org/>.
- **`GET /llms-docs` drops symlinks.** `readdir` reports link types without resolving them. The walk recurses on `isDirectory()` and collects on `isFile()`, so a symlink, the only entry that can point outside the folder, is neither. Each file gets its own trailing separator, so an empty folder gives `""` without a branch.

## Telemetry (`src/server/instrumentation.ts`)

The `dns`, `fs`, `http`, `net`, `runtime-node` and `undici` instrumentations were evaluated and dropped as too verbose. HTTP server spans come from `@hono/otel`. evlog exports the logs, so the SDK has no log record processor.

## Types (`src/server/types/hono.ts`)

`Simplify` collapses the variables intersection into one object type, so hovers and type errors name the keys instead of `A & B & C & D`.

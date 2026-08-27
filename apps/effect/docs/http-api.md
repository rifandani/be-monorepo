# HTTP API

## Layers

`domain/` (schemas, typed errors) ← `api/` (the description) ← `server/` (the
implementation). A folder imports only from the ones before it.

- **`api/` must not import `server/`.** A client needs the description only; one that loaded handler code would load the database and the secrets with it. `HealthReport` lives in `domain/` for the same reason.
- **`api/` contains no `Config`.** Annotations are read at module load, so a title from the environment would make the description an `Effect`.
- Imports are relative, not aliased: `tsc` does not rewrite an alias when it emits, which is what makes `apps/hono`'s `node:build` output unusable.
- Test split (`vitest.config.ts`): `src/**` for pure modules, `tests/**` for endpoints.

## Conventions

- **A rejection is a response, not a failure.** The csrf 403 and timeout 504 are returned. A failure would add an error type to `app` and both entrypoints.
- **Per-request state is a `Context.Reference`, not a `Context.Service`.** The default value makes it readable without a requirement on every caller and test.
- **Response headers are set with `Effect.map`, which runs only on success.** Every response made on purpose is a success value, so the 404, the csrf 403 and the timeout 504 all carry the headers. A true failure carries none.
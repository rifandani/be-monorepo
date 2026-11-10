# HTTP API

## Source folders

The app follows the default Bulletproof boundaries. See [ADR-0004](../../../docs/adr/0004-follow-the-default-bulletproof-boundaries.md).

- `src/features/health/` owns the probe definitions, schemas, typed errors, and health service. Its API description does not import the service or server infrastructure, so a client can load the description alone.
- `src/app/` combines the API groups, binds their handlers, and composes the middleware and runtime layers. It supplies the probe definitions to the server's probe policy factory.
- `src/server/` owns HTTP middleware and observability. It imports no feature code.
- `src/shared/` owns common configuration and package metadata.
- API annotations use package metadata at module load. They contain no runtime `Config` values.
- Import siblings relatively (`./cors.ts`). Use Node's `#*` subpath imports across folders (`#features/health/schema.ts`). Node does not read TypeScript `paths` aliases. See ADR-0003.
- Test split (`vitest.config.ts`): `src/**` for pure modules, `tests/**` for endpoints.

## Conventions

- **A rejection is a response, not a failure.** The csrf 403 and timeout 504 are returned. A failure would add an error type to `app` and both entrypoints.
- **Per-request state is a `Context.Reference`, not a `Context.Service`.** The default value makes it readable without a requirement on every caller and test.
- **Response headers are set with `Effect.map`, which runs only on success.** Every response made on purpose is a success value, so the 404, the csrf 403 and the timeout 504 all carry the headers. A true failure carries none.

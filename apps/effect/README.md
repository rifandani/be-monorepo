# Effect

## 🚀 Getting Started

Do the [root Getting Started](../../README.md#-getting-started) steps first. The commands below run from the repository root.

### 1. Replace the template names

| File | Value to replace |
| --- | --- |
| `package.json` | `description` ("Effect v4 HTTP API template"), `author`. The `name` is also the OpenAPI title and the service name (`src/metadata.ts`). |
| `package.json` | The portless name `effect.be-monorepo` in the `dev`, `dev:prod`, `node:dev` and `node:dev:prod` scripts. It must be the same as in the root `portless.json`. |
| `.env.example` | `APP_TITLE` and `APP_URL` (`https://effect.<project>.localhost`) |
| `src/api/api.ts` | The API id (`"effect-api"`) and the OpenAPI `description` ("Effect v4 HTTP API template") |
| `src/server/origin.test.ts`, `tests/app.test.ts`, `tests/middleware.test.ts`, `tests/nesting.test.ts`, `tests/platform.test.ts` | `https://effect.be-monorepo.localhost`. The tests do not read the environment, so this change is optional. It keeps the names the same. |
| `README.md` | The local URLs below, and the **Todo** section |

### 2. Replace the example code

- The health probes (`src/api/health.ts`, `src/server/health.ts`) are ready to use. `READINESS_CHECKS` in `src/server/health.ts` is empty. Add a check for each dependency (for example, the database) that the app needs before it can serve traffic.
- Add your own endpoint groups to `src/api/api.ts`. Keep the folder order: `domain/` ← `api/` ← `server/` (see `docs/http-api.md`).
- `CONTEXT.md` and `docs/`: add your own domain terms and rules.

## OpenAPI

Using `HttpApiScalar` to generate OpenAPI docs. The OpenAPI generated schema is available at `https://effect.be-monorepo.localhost/openapi`, and the OpenAPI docs are available at `https://effect.be-monorepo.localhost/openapi/docs`.

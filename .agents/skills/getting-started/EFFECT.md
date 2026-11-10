# Effect app

The paths are relative to `apps/effect`.

## Placeholders

| File | Value to replace |
| --- | --- |
| `package.json` | `description` ("Effect v4 HTTP API template") and `author`. The `name` is also the OpenAPI title and the service name (`src/shared/metadata.ts`). Ask before you change it, because the workspace commands use it. |
| `package.json` | The portless name in the `dev` and `node:dev` scripts |
| `.env.example` | `APP_TITLE` and `APP_URL` (`https://effect.<project>.localhost`). Do the same in the other env files of the user. |
| `src/app/api.ts` | The API id (`"effect-api"`) and the OpenAPI `description` ("Effect v4 HTTP API template") |
| `src/server/origin.test.ts`, `tests/*.test.ts` | `https://effect.be-monorepo.localhost`. The tests do not read the environment, but the sweep finds these lines. |
| `README.md` | The local URLs |

## Decisions

- `READINESS_CHECKS` in `src/features/health/service.ts` is empty. Ask which dependencies (for example, the database) the app needs before it can serve traffic. Add a check for each one, or record this item as open.
- The first endpoint groups go in `src/app/api.ts`, in the folder order `domain/` ← `api/` ← `server/` (see `docs/http-api.md`). Tell the user. This is work for after this skill.

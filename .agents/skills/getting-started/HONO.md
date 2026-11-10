# Hono app

The paths are relative to `apps/hono`.

## Placeholders

| File | Value to replace |
| --- | --- |
| `package.json` | `description` ("Bulletproof Hono 4 template") and `author`. The `name` is also the OpenTelemetry service name (`src/shared/constants/global.ts`). Ask before you change it, because the workspace commands use it. |
| `package.json` | The portless name in the `dev` and `node:dev` scripts |
| `.env.example` | `APP_TITLE` and `APP_URL` (`https://hono.<project>.localhost`). Do the same in the other env files of the user. |
| `src/app/routes.ts` | The OpenAPI `description` ("API documentation for the Hono app") |
| `README.md` | The local URLs |

## Decisions

- `src/server/db/seeds/seed-user-data.ts`: the demo user (`vaandani@email.com`) and `SEED_BULK_PASSWORD`. The DAST scripts (`scripts/security/`) sign in as this user. If you change the user, change the scripts also.
- `src/shared/constants/language.ts`: `supportedLanguages` (`en`, `id`) and `fallbackLanguage`.
- `src/features/docs/routes.ts`: the `/llms.txt`, `/llms-auth.txt` and `/llms-docs` routes. `/llms-docs` sends the content of the `docs/` folder of this app to each caller. The user keeps the routes or removes them. If the user keeps them, make sure that `docs/` has only public text.
- `src/server/auth.ts`: the Better Auth options (email and password, rate limit, OpenAPI theme). Show the current options, and the user approves or changes each one.

# Hono

## 🚀 Getting Started

Do the [root Getting Started](../../README.md#-getting-started) steps first. The commands below run from the repository root.

### 1. Replace the template names

| File | Value to replace |
| --- | --- |
| `package.json` | `description` ("Bulletproof Hono 4 template"), `author`. The `name` is also the OpenTelemetry service name (`src/core/constants/global.ts`). |
| `package.json` | The portless name `hono.be-monorepo` in the `dev`, `dev:prod`, `node:dev` and `node:dev:prod` scripts. It must be the same as in the root `portless.json`. |
| `.env.example` | `APP_TITLE` and `APP_URL` (`https://hono.<project>.localhost`) |
| `src/routes/index.ts` | The OpenAPI `description` ("API documentation for the Hono app") |
| `src/db/seeds/seed-user-data.ts` | The demo user (`vaandani@email.com`) and `SEED_BULK_PASSWORD`. The DAST scripts also use this user. |
| `src/core/constants/language.ts` | `supportedLanguages` (`en`, `id`) and `fallbackLanguage` |
| `README.md` | The local URLs below, and the **Todo** section |
| `.vscode/launch.json` (root) | The launch configuration runs `bun hono dev`. Keep it or change it. |

### 2. Replace the example code

- `src/routes/llms-docs.ts`: the `/llms.txt`, `/llms-auth.txt` and `/llms-docs` routes. `/llms-docs` sends the content of the `docs/` folder of this app, so put only public text there.
- `src/auth/utils/index.ts`: the Better Auth options (email and password, rate limit, OpenAPI theme). Examine them for your project.
- `CONTEXT.md` and `docs/`: add your own domain terms and rules.

## OpenAPI

Using `@scalar/hono-api-reference` to generate OpenAPI docs. The OpenAPI generated schema is available at `https://hono.be-monorepo.localhost/openapi`, and the OpenAPI docs are available at `https://hono.be-monorepo.localhost/openapi/docs`.

## Auth

```bash
# everytime we add/remove/change auth schema or there's changes from BetterAuth, generate the new auth schema in `./src/db/auth-schema.ts`
bun hono auth:gen
```

The generated `./src/db/auth-schema.ts` file should be used ONLY to compare with the existing schema in `./src/db/schema.ts`. Compare manually and copy paste the new/updated schema to `./src/db/schema.ts` and then delete the generated `./src/db/auth-schema.ts` file. Make sure to also update the `auth.database.schema` in `./src/auth/utils/index.ts` with the new/updated schema.

After that, run:

```bash
# generate drizzle migrations
bun hono db:gen

# run drizzle migrations
bun hono db:migrate
```

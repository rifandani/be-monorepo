# Hono

## 🎯 Todo

- [ ] upgrade drizzle to v1.0 when it's stable
- [ ] consider load testing with `k6`

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

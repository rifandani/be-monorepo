# Effect

## OpenAPI

Using `HttpApiScalar` to generate OpenAPI docs. The OpenAPI generated schema is available at `https://effect.be-monorepo.localhost/openapi`, and the OpenAPI docs are available at `https://effect.be-monorepo.localhost/openapi/docs`.

## TODO

These features are in `apps/hono`, but not in this app.

### Authentication and data

- [ ] Better Auth: session auth with email and password, the `bearer` and `openAPI` plugins, and the routes at `/api/auth/**`.
- [ ] Auth context middleware: put `user` and `session` on each request.
- [ ] PostgreSQL with Drizzle: the `user`, `session`, `account`, `verification` and `rate_limit` tables, with migrations and seeds.
- [ ] Rate limiting: the Better Auth rate limit (stored in `rate_limit`), and a request rate limit with a Postgres or memory store. The key is the session id or the client IP. Note: in `apps/hono`, the `hono-rate-limiter` middleware is defined, but it is not mounted.
- [ ] Client address resolution: get the client IP for the rate-limit key.
- [ ] References for implementing better-auth: https://github.com/kitlangton/effect-better-auth-example, https://github.com/devx-op/effectify

### Docs for LLMs

- [ ] `GET /llms.txt`: the OpenAPI document of this app, as Markdown.
- [ ] `GET /llms-auth.txt`: the Better Auth OpenAPI document, as Markdown.
- [ ] `GET /llms-docs`: all files in the `docs/` folder as one text, with the length and a token estimate.
- [ ] Send a `Cache-Control` header on the three LLM docs routes.
- [ ] Show the Better Auth schema as a second source on the Scalar page.

### Observability and middleware

- [ ] evlog wide-event logs with head sampling: keep 10% of `info` logs, and always keep 400s, 500s and slow requests. Flush the drain at shutdown.
- [ ] Add the user to log events (`evlog/better-auth` identify middleware).
- [ ] Postgres auto-instrumentation (`PgInstrumentation` with SQL commenter comments).
- [ ] OTel resource detectors: `env`, `host`, `os`, `process` and `serviceInstanceId`.
- [ ] Pretty JSON output when the request asks for it (`prettyJSON()`).
- [ ] Error mapping: change validation errors and upstream HTTP client errors to 400. Add the `why`, `fix` and `link` hints to unknown errors (evlog `parseError`).

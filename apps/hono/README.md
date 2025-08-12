# Hono

## 🎯 Todo

- [ ] example of hono api route testing
- [ ] better-auth rate limit with postgresql

## 💾 How to Database

We use `postgres@17` as RDBMS, `drizzle` as ORM, and `node-postgres` as driver.

Config file for drizzle-kit is in `./drizzle.config.ts`. Entry file for drizzle-orm is in `./src/db/index.ts`. Migration files are in `./src/db/migrations` folder.

Follow below conventions:

- use `snake_case` for table and column names
- for every changes in database schema, create a new migration by running `bun hono db:gen` and apply it by running `bun hono db:migrate`
- commit migration files to git

### Database Migrations

You can directly apply changes to your database using the drizzle-kit push command. This is a convenient method for quickly testing new schema designs or modifications in a local development environment, allowing for rapid iterations without the need to manage migration files. This is designed to cover code first approach of Drizzle migrations.

```bash
# directly apply changes to your database
bun hono db:push
```

Alternatively, you can generate the migrations first, then run the migrations.

```bash
# generate the migrations
bun hono db:gen

# run the migrations
bun hono db:migrate
```

We could also pull(introspect) our existing database schema and generate `schema.ts` drizzle schema file from it. This is designed to cover database first approach of Drizzle migrations. This is a great approach if we need to manage database schema outside of our TypeScript project or we're using database, which is managed by somebody else.

```bash
# pull the latest schema from the database
bun hono db:pull
```

### Database Seeding

Coming soon...

### Database Studio

```bash
# run the drizzle studio at https://local.drizzle.studio?port=3003
bun hono db:studio
```

## 🔒 How to Auth

We use `better-auth` for authentication.

```bash
# everytime we add/remove/change auth schema, generate the new auth schema in `./src/db/auth-schema.ts`
bun hono auth:gen
```

The generated `./src/db/auth-schema.ts` file should be used ONLY to compare with the existing schema in `./src/db/schema.ts`.
Compare manually and copy paste the new/updated schema to `./src/db/schema.ts` and delete the generated `./src/db/auth-schema.ts` file.
Make sure to also update the `auth.database.schema` in `./src/auth/libs/index.ts` with the new/updated schema.

After that, run:

```bash
# generate drizzle migrations
bun hono db:gen

# run drizzle migrations
bun hono db:migrate
```

## 📊 How to Observability

Since we are using OpenTelemetry, it will emit standard OTLP HTTP (standard OpenTelemetry protocol), you can use any OpenTelemetry Collector, which gives you the flexibility to connect it to any backend that you want. Just change the `baseUrl` in the `./src/instrumentation.ts` file.

Use `span.setAttributes` and `span.addEvent` most of the time, use `logger` only in places where you don't care about measuring the timing (e.g. global app error handler), or when you want to emphasize and save some important information / state changes.

### Grafana

Run docker compose to start the [`grafana/otel-lgtm`](https://github.dev/grafana/docker-otel-lgtm/) container. This will spin up a OpenTelemetry backend including [Prometheus](https://grafana.com/docs/grafana/latest/datasources/prometheus/) (metrics database), [Tempo](https://grafana.com/docs/grafana/latest/datasources/tempo/) (traces database), [Loki](https://grafana.com/docs/grafana/latest/datasources/loki/) (logs database), and [Pyroscope](https://grafana.com/docs/grafana/latest/datasources/pyroscope/) (profiling database). It also spin up Grafana Dashboard for visualization at `http://localhost:3111`. If you haven't logged in, use the following credentials:

- Username: `admin`
- Password: `admin`

```bash
# cd into root of the workspace
cd ../..

# run the docker compose file
bun compose:up
```

Then, start the hono server to start sending the metrics, traces, and logs to the backend.

```bash
# running in port 3333
bun hono dev
```

## 🧪 How to Test

Coming soon...

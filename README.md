# be-monorepo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/rifandani/be-monorepo)

[![Mintlify Docs](https://img.shields.io/badge/mintlify-docs-green?logo=mintlify)](https://rifandani-be-monorepo.mintlify.app)

## 🏁 Getting Started

Open your agent and run: `Use /getting-started to set up this repo for my new app`

## Maintenance

- /improve-codebase-architecture

## 📝 Environment Variables

Source of truth is local env files. When changing them, update deployment/CI project env too.

Each app has its own env files. The `.env.example` file of each app shows the variables:

- [`@workspace/hono`](./apps/hono/README.md): needs a secret (`BETTER_AUTH_SECRET`). CI can read the env file from the `HONO_ENV_FILE` secret.
- [`@workspace/effect`](./apps/effect/README.md): needs no secret.

## 🗒️ Notes

- We have adjusted `/tdd` skills from original Matt Pocock's
- Our custom skills are: `/bump-deps`, `/delete-wt`, `/getting-started`, `/release`, `/settle-pr`, `/upkeep-implicit-state-machine`, `/upkeep-lint-suppressions`, `/upkeep-warning-logs`, `/wt`

## 📱 Apps

### @workspace/hono

[See here](./apps/hono/README.md)

### @workspace/effect

[See here](./apps/effect/README.md)

## 📦 Packages

### @workspace/typescript-config

[See here](./packages/typescript-config/README.md)

### @workspace/load

[See here](./packages/load/README.md)

## 📚 References

### Observability

- [`grafana/otel-lgtm` docker](https://github.dev/grafana/docker-otel-lgtm/)
- [Grafana Prometheus](https://grafana.com/docs/grafana/latest/datasources/prometheus/)
- [Grafana Tempo](https://grafana.com/docs/grafana/latest/datasources/tempo/)
- [Grafana Loki](https://grafana.com/docs/grafana/latest/datasources/loki/)
- [Grafana Pyroscope](https://grafana.com/docs/grafana/latest/datasources/pyroscope/)

To check the traces and metrics in the local Grafana dashboard, run the `grafana/otel-lgtm` container. This will spin up a OpenTelemetry backend including Prometheus (metrics database), Tempo (traces database), Loki (logs database), and Pyroscope (profiling database). Login to dashboard at `http://localhost:3111` with credentials:

- Username: `admin`
- Password: `admin`

### Security

- DAST OWASP ZAP [Tutorial](./docs/security/dast-tutorial.md) · [How-to](./docs/security/dast-how-to.md)

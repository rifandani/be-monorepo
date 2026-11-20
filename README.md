# be-monorepo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/rifandani/be-monorepo)

## 🏁 Getting Started

Open your agent and run: `/getting-started set up this repo`

## Maintenance

- /improve-codebase-architecture

## 🗒️ Notes

- We have adjusted `/tdd` skills from original Matt Pocock's
- Our custom skills are: `/bump-deps`, `/delete-wt`, `/getting-started`, `/release`, `/settle-pr`, `/upkeep-implicit-state-machine`, `/upkeep-lint-suppressions`, `/upkeep-storage-space`, `/upkeep-warning-logs`, `/wt`
- Don't forget to sync local env and CI env

## 📱 Apps

- [@workspace/hono](./apps/hono/README.md)
- [@workspace/effect](./apps/effect/README.md)

## 📦 Packages

- [@workspace/typescript-config](./apps/typescript-config/README.md)
- [@workspace/load](./apps/load/README.md)

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

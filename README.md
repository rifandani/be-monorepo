# be-monorepo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/rifandani/be-monorepo)

[![Mintlify Docs]](https://rifandani-be-monorepo.mintlify.app)

## 🎯 Todo

- [ ] always update `CLAUDE.md` file in root dir and subpackage inside monorepo and consider it as a living document
- [ ] add new apps for Effect v4 when it's stable. full use of effect ecosystem.
- [ ] portless

## 🛠️ Upgrading Dependencies

- Remember to always use EXACT version for each dependency
- Run `bun bump:deps` to check for outdated dependencies, then run `bun install` to install it
- Run `bun hono test` to run tests
- (Optional) run `bun hono node:build` to build with development env (if you use nodejs instead of bun)
- Run `bun lint-typecheck` for linting and type checking

After making sure all changes are checked, run `bun cs` to create a new changeset and `bun cs:v` to version the changeset.

## 📝 Environment Variables

For first timer, you need to create the 2 environments in your github repo.
First is `dev` environment, and second is `prod` environment (that's why in `.github/workflows/ci.yml` we stated `environment: dev`).
In both environments, name it `HONO_ENV_FILE` (that's why in `.github/workflows/ci.yml` we stated `secrets.HONO_ENV_FILE`).

The value for `HONO_ENV_FILE` in `dev` environment is `.env.dev`, and the value for `HONO_ENV_FILE` in `prod` environment is `.env.prod` for `@workspace/hono`.

Source of truth is local env files. When changing them, update deployment/CI project env too.

<!-- For first timer, you need to create 2 environments in your github repo.
Go to your Github repo -> `Settings` tabs -> `Environments` -> `New environment` -> `dev` and `prod` (that's why in `.github/workflows/ci.yml` we stated `environment: dev` and `environment: prod`).

To push our local env variables to the github repo, run:

```bash
# that's why in `.github/workflows/ci.yml` we stated `secrets.HONO_ENV_FILE` and `secrets.WEB_ENV_FILE`
gh secret set HONO_ENV_FILE -e dev -f ./apps/hono/.env.dev
gh secret set HONO_ENV_FILE -e prod -f ./apps/hono/.env.prod
```

Source of truth is local env files. When changing them, update deployment/CI project env too. -->

## 📱 Apps

### @workspace/hono

[See here](./apps/hono/README.md)

## 📦 Packages

### @workspace/core

[See here](./packages/core/README.md)

### @workspace/typescript-config

[See here](./packages/typescript-config/README.md)

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

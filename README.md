# be-monorepo

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/rifandani/be-monorepo)

[![Mintlify Docs]](https://rifandani-be-monorepo.mintlify.app)

## 🎯 Todo

- [ ] bump deps first, then add drizzle as git subtree into repos folder
- [ ] remove all "dev:prod", "start:prod", etc

## 🚀 Getting Started

This repository is a boilerplate. Many values in it are placeholders for this template. When you start a new project from it, do the steps below. Then do the steps for each app that you keep:

- [`@workspace/hono` Getting Started](./apps/hono/README.md#-getting-started)
- [`@workspace/effect` Getting Started](./apps/effect/README.md#-getting-started)

In the steps, `<project>` is the name of your new project (for example `acme-api`). `<owner>/<repo>` is your GitHub repository.

### 1. Find all the template names

Run this command to find the template names that you must replace:

```bash
grep -rn -E "be-monorepo|rifandani|Rifandani|vaandani" . \
  --exclude-dir={node_modules,repos,.git} --exclude=bun.lock
```

The table below shows the root files. The app READMEs show the app files.

| File | Value to replace |
| --- | --- |
| `README.md` | The title, the DeepWiki badge and the Mintlify badge. There is no Mintlify config in this repository, so remove that badge or add a docs site. Also clear the **Todo** and **Notes** sections. |
| `package.json` | `name`, `description`, `author`. Add a `license` if you need one. |
| `packages/typescript-config/package.json` | `author` |
| `portless.json` | `name`, and the `name` of each app (`hono.be-monorepo`, `effect.be-monorepo`) |
| `docker/docker-compose.yml` | `name` (the Compose project name) |
| `.gitleaks.toml` | `title` |
| `.github/codeql/codeql-config.yml` | `name` |
| `.codex/environments/environment.toml` | `name` |
| `.agents/skills/wt/scripts/setup-worktree-unix.sh` and `setup-worktree-windows.ps1` | The hono portless name (`hono.be-monorepo`). It must be the same as in `portless.json`. |
| `.github/ISSUE_TEMPLATE/*.yml` | The issue links (`rifandani/be-monorepo`) |
| `CLAUDE.md` | The issue tracker repository (`rifandani/be-monorepo`) |
| `.claude/settings.json` | The `Read(//Users/<user>/...)` paths. They are for one local user. |
| `docs/security/*.md`, `scripts/security/zap.ts` | The local URLs (`https://<app>.be-monorepo.localhost`) in the examples |

### 2. Set up the GitHub repository

1. Labels: `.github/settings.yml` holds the labels. The [Probot Settings app](https://github.com/apps/settings) applies them. Install the app, or make the labels by hand. The triage labels are also in `docs/agents/triage-labels.md`.
2. Environments and secrets: see the app READMEs. `@workspace/hono` can use a `HONO_ENV_FILE` secret. `@workspace/effect` needs no secret.
3. DAST: when an app is deployed, set the repository variable `PROD_HONO_URL` or `PROD_EFFECT_URL` (**Settings → Secrets and variables → Actions → Variables**). Until then, `dast.yml` skips the app.
4. Code scanning: CodeQL uploads SARIF only on a public repository or with GitHub Code Security. The severity gate works without the upload.

### 3. Update the project documents

- `.github/SECURITY.md`: write your own contacts and owners in place of "Application lead" and "Infrastructure".
- `.github/CONTRIBUTING.md` and `.github/CODE_OF_CONDUCT.md`: write your own contact. `CONTRIBUTING.md` refers to ESLint, but this repository uses oxlint and oxfmt (`bun lint`).
- `.github/security/sca-allowlist.json`: each entry has an `expires` date. When the date is past, the SCA gate fails. Remove the entries that you do not need, or examine them again.
- `CONTEXT-MAP.md`, `apps/*/CONTEXT.md` and the `docs/adr/` folders: they are about the template. Keep the decisions that you keep, and add the terms of your own domain.

## 📝 Environment Variables

Source of truth is local env files. When changing them, update deployment/CI project env too.

Each app has its own env files. See the Getting Started section of each app:

- [`@workspace/hono`](./apps/hono/README.md#-getting-started): needs a secret (`BETTER_AUTH_SECRET`). CI can read the env file from the `HONO_ENV_FILE` secret.
- [`@workspace/effect`](./apps/effect/README.md#-getting-started): needs no secret.

## 🗒️ Notes

- We have adjusted `/tdd` skills from original Matt Pocock's

## 📱 Apps

### @workspace/hono

[See here](./apps/hono/README.md)

### @workspace/effect

[See here](./apps/effect/README.md)

## 📦 Packages

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

### Security

- DAST OWASP ZAP [Tutorial](./docs/security/dast-tutorial.md) · [How-to](./docs/security/dast-how-to.md)

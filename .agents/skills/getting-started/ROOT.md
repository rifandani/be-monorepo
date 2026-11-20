# Root

The **portless name** of an app is `<app>.<project>` (for example `hono.acme-api`). It must be the same in each place that uses it: `portless.json`, the `dev` and `node:dev` scripts of the app, the `wt` scripts, and the local URLs `https://<app>.<project>.localhost`.

## Placeholders

| File | Value to replace |
| --- | --- |
| `README.md` | The title and the DeepWiki badge. The Mintlify badge: there is no Mintlify config in this repository, so remove the badge unless the user has a docs site. Clear the **Notes** section. |
| `package.json` | `name`, `description`, `author`. Add a `license` if the user wants one. |
| `LICENSE` | The copyright holder |
| `packages/typescript-config/package.json`, `packages/load/package.json` | `author` |
| `portless.json` | `name`, and the portless name of each app |
| `docker/docker-compose.yml` | `name` (the Compose project name) |
| `.gitleaks.toml` | `title` |
| `.github/codeql/codeql-config.yml` | `name` |
| `.codex/environments/environment.toml` | `name` |
| `.agents/skills/wt/scripts/setup-worktree-unix.sh`, `setup-worktree-windows.ps1` | The hono portless name |
| `.github/ISSUE_TEMPLATE/*.yml` | The issue links (`rifandani/be-monorepo` → `<owner>/<repo>`) |
| `AGENTS.md` | The issue tracker repository (`<owner>/<repo>`) |
| `docs/security/*.md`, `scripts/security/zap.ts` | The local URLs in the examples |
| `.vscode/launch.json` | The launch configuration runs `bun hono dev`. Change it if the user does not keep hono. |

`.claude/settings.json` has `Read(//Users/<user>/...)` paths for one local user. Tell the user to change these paths. The user must make this edit, because this file controls your permissions.

## Decisions

- `.github/SECURITY.md`: the contacts and owners that replace "Application lead" and "Infrastructure".
- `.github/CONTRIBUTING.md` and `.github/CODE_OF_CONDUCT.md`: the contact. `CONTRIBUTING.md` refers to ESLint, but this repository uses oxlint and oxfmt (`bun lint`). Correct this text.
- `.github/security/sca-allowlist.json`: each entry has an `expires` date. When the date is past, the SCA gate fails. Show each entry to the user. The user keeps the entry, or removes it.
- `GLOSSARY-MAP.md`, `apps/*/GLOSSARY.md` and the `docs/adr/` folders: they describe the template. For each ADR, the user keeps the decision or removes it. Then offer `/domain-modeling` to add the terms of the user's domain.

## GitHub

1. Labels: `.github/settings.yml` holds the labels, and the [Probot Settings app](https://github.com/apps/settings) applies them. The user installs the app, or you make each label with `gh label create`.
2. Env secrets: the local env files of each app are the source of truth, and `.env.example` lists the variables. Effect needs no secret. Hono needs `BETTER_AUTH_SECRET`: CI writes the `HONO_ENV_FILE` secret to `apps/hono/.env.dev`, and copies `.env.example` when the secret is not set. If the user keeps hono, the user runs `gh secret set HONO_ENV_FILE < apps/hono/.env.dev`. Tell the user to run this command again each time the env file changes, and to update the env of each deployment also.
3. DAST: `dast.yml` skips an app until its repository variable is set. When an app is deployed, set `PROD_HONO_URL` or `PROD_EFFECT_URL` with `gh variable set`. If no app is deployed, record this item as open.
4. Code scanning: CodeQL uploads SARIF only on a public repository or with GitHub Code Security. The severity gate works without the upload. Tell the user. There is no action.

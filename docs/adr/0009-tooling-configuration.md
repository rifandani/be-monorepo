---
status: accepted
---

# Tooling configuration

Records for the lint config, the Hono test config and the scripts under `scripts/`. [ADR-0006](./0006-code-has-no-comments.md) moved them here from code comments.

## Oxlint (`oxlint.config.ts`)

- **`typeAware` and `typeCheck` are on.** The compiler diagnostics replace the separate `tsc --noEmit` checks.
- **`eslint/require-await` is off.** The typed promise rule can require `async` with no `await`, which conflicts with `require-await`. The typed rule stays.
- **Tests and `apps/*/tests` turn off the unsafe-value rules and the anti-slop type-modelling rules.** Tests model external JSON and request fixtures on purpose: they cast response bodies to the shape that they read, use `as never` to reach an overload, and use partial doubles. Compiler checks stay on.

## Hono test environment (`apps/hono/vitest.config.ts`)

`src/shared/constants/env.ts` validates the environment at module load, so the values must exist before the first test import. The config loads them with `dotenvx`, not with Vite `.env` loading, so that test, dev and production share one loader. A `dotenvx`-encrypted `.env.dev` would otherwise give ciphertext that `z.string().min(1)` accepts. `processEnv: {}` keeps the values out of the config process, and `test.env` gives them to the workers. A missing file gives `{}`: the Hono tests fail and the other projects still run.

## Security gates (`scripts/security/`)

- **`sca-gate.ts`** runs Google OSV-Scanner and fails on high or critical findings. A high finding can be allowlisted for a time. A critical finding cannot. An advisory with no severity counts as high (fail closed). The allowlist expiry is a bare TOML date, because osv-scanner expects a `LocalDate`. Environment: `SCA_ALLOWLIST_PATH` (default `.github/security/sca-allowlist.json`), `SCA_AUDIT_LEVEL` (default `high`), `OSV_SCANNER_BIN`, `OSV_SCANNER_VERSION` (default `2.4.0`).
- **`sarif-severity-gate.ts`** fails when a CodeQL SARIF result has `security-severity` at or above `SAST_MIN_SECURITY_SEVERITY` (default 7.0, High). Usage: `bun scripts/security/sarif-severity-gate.ts <sarif-dir-or-file>`.
- **`zap.ts`** runs a ZAP Automation Framework plan in Docker. CI runs the same plans through `zaproxy/action-af`, which mounts the repository root at `/zap/wrk`, so this script mounts the root too and `reportDir` is one path for both.
  - There is no guard on `ZAP_TARGET`. The active plans must run against a local stack to develop the auth context and the Origin replacer. Only the baseline plan runs on a schedule.
  - The target uses the portless hostname. `localhost` in the container is the container, and Docker does not let `--add-host` replace its own `127.0.0.1 localhost`. The portless hostname is also `APP_URL`, so the Origin that the plans send is the one the app trusts.
  - On Linux the script uses `--network host`, like `action-af`. On Docker Desktop that flag does nothing, so the script maps `*.localhost` to the host gateway. Docker refuses both at once. A public target needs neither.
  - The image is amd64. The arm64 `:stable` image ships a zero-filled `/zap/zap.sh` that fails with "exec format error".
  - ZAP runs as uid 1000, which does not own a CI checkout, so the script widens permissions on the report folder only.

## Vendored repositories (`scripts/update-vendored-repos.ts`)

Each repository under `repos/` is a `git subtree --squash` copy. The script resolves the upstream commit with `git ls-remote` and fetches it by hash. It never reads `FETCH_HEAD`, because after a failed fetch `FETCH_HEAD` still holds the previous fetch. A squash-merged pull request drops the subtree commits, so a plain copy can follow a subtree in history. A folder that is not yet a subtree is removed in its own commit first, with its ignored files, because `git subtree add` refuses a prefix that exists.

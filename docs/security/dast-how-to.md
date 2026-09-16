# How-to: DAST with OWASP ZAP

One recipe per task. 
If you have not run a scan before, read the [tutorial](./dast-tutorial.md) first.

## Reference

### Commands

| Command | Plan | Attacks? |
| --- | --- | --- |
| `bun zap:hono:baseline` | `.github/security/zap/hono-baseline.yaml` | No |
| `bun zap:hono:active` | `.github/security/zap/hono-active.yaml` | Yes |
| `bun zap:effect:baseline` | `.github/security/zap/effect-baseline.yaml` | No |
| `bun zap:effect:active` | `.github/security/zap/effect-active.yaml` | Yes |

Every command needs `ZAP_TARGET`. It has no default.

### Environment variables

| Variable | Default | Used by |
| --- | --- | --- |
| `ZAP_TARGET` | none, required | every plan |
| `ZAP_USER_EMAIL` | the seed user | `hono-active` |
| `ZAP_USER_PASSWORD` | the seed user | `hono-active` |
| `ZAP_IMAGE` | `ghcr.io/zaproxy/zaproxy:stable` | the runner script |

### Files

| Path | What it is |
| --- | --- |
| `.github/security/zap/*.yaml` | the scan plans |
| `scripts/security/zap.ts` | the local runner |
| `.github/workflows/dast.yml` | the CI workflow |
| `.zap-reports/` | output, gitignored |

## Triage a finding

1. Open `.zap-reports/<plan>.html`, or the alert in GitHub code scanning.
2. Read the request and the response ZAP recorded. The report holds both.
3. Reproduce it with `curl`. A finding you cannot reproduce by hand is usually a scanner artefact.
4. Decide:
   - **Real** — fix the code. Add a unit test so the fix cannot regress.
   - **Not applicable** — add an alert filter. See the next recipe.

Check sign-in first. 
A scan that never signed in produces a report that proves nothing.

## Suppress a finding you have judged acceptable

Do not delete the alert. 
Record the judgement, so the next person does not repeat the work.

Add an entry to the `alertFilter` job in the plan:

```yaml
- type: alertFilter
  parameters:
    deleteGlobalAlerts: true
  alertFilters:
    - ruleId: 10038
      ruleName: "Content Security Policy (CSP) Header Not Set"
      newRisk: "False Positive"
      url: ".*/openapi/docs.*"
      urlRegex: true
```

Rules:

- Always give a `ruleName`, even though only `ruleId` is required. 
  The id alone means nothing to a reader.
- Always scope the filter with a `url`. 
  A global filter hides the same class of finding everywhere, including where it matters.
- Always write a reason in a comment above the entry, with a date.

This mirrors `.github/security/sca-allowlist.json`, where dependency findings get timed exceptions with reasons.
Rule ids are at <https://www.zaproxy.org/docs/alerts/>.

## Fix a failing sign-in

Symptom: the active scan finishes fast, and almost every request in the report returns `401` or `403`.

Check these in order:

1. **The user exists.** Run `bun hono db:seed` again.
2. **The credentials match.** The plan reads `ZAP_USER_EMAIL` and
   `ZAP_USER_PASSWORD`. Both default to `SEED_USER` in
   `apps/hono/src/db/seeds/seed-user-data.ts`.
3. **The sign-in response still matches the verification regex.** The plan decides it is logged in by finding `"token"` in the response:

   ```yaml
   verification:
     method: response
     loggedInRegex: '"token"'
   ```

   Check what better-auth actually returns:

   ```bash
   curl -k -X POST https://hono.be-monorepo.localhost/api/auth/sign-in/email \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://hono.be-monorepo.localhost' \
     -d '{"email":"<email>","password":"<password>"}'
   ```

   If the shape changed, update `loggedInRegex`.

4. **The `Origin` header matches.** Drop the `-H 'Origin: ...'` from the command above. 
   If the request now fails, the origin check is what rejects the scanner, and the `replacer` job is wrong. 
   Its `replacementString` must equal `APP_URL`.

## Adjust scan speed

The active plan uses `threadPerHost: 1` and `delayInMs: 200` so ZAP does not overwhelm a local dev server. 
In-scope routes have no rate limit today; auth routes are excluded, so better-auth's limiter does not apply to the scan.

If you mount `rateLimit` in `app.ts` and see many `429`s, raise the delay:

```yaml
- type: activeScan
  parameters:
    threadPerHost: 1
    delayInMs: 400 # was 200
```

If you raise the delay, raise `maxScanDurationInMins` too, or the scan stops before it finishes.

## Scan a production URL

Only a baseline plan may point at production. The active plans attack, and they write real data.

**Locally**, once:

```bash
ZAP_TARGET=https://api.example.com bun zap:hono:baseline
```

**In CI**, permanently: set a repository variable. Go to Settings → Secrets and variables → Actions → Variables, then add:

- `PROD_HONO_URL`
- `PROD_EFFECT_URL`

A variable, not a secret. A URL is not a credential, and this keeps the whole production env file off the runner.

An app with no variable is skipped, so the workflow stays green until you set one. Nothing else needs to change.

## Run a scan in CI by hand

Go to Actions → DAST → Run workflow. It runs the production baselines only. Active scans stay local.

## Add a scan for a new app

1. Copy `.github/security/zap/effect-baseline.yaml` to `<app>-baseline.yaml`. Change the context `name`.
2. Add a script to the root `package.json`:

   ```json
   "zap:<app>:baseline": "bun scripts/security/zap.ts <app>-baseline"
   ```

3. Add a row to the matrix in `.github/workflows/dast.yml`:

   ```yaml
   - app: <app>
     url: ${{ vars.PROD_<APP>_URL }}
   ```

4. Set the repository variable when the app is deployed. Until then the row is skipped.

## Add an active scan for the effect app

There is none today, and that is deliberate. `apps/effect` serves `/health` and two probes. 
No route takes a body, a query parameter or a path parameter.
Active scan rules work by mutating inputs, so with no inputs there is nothing to attack.

Write one when `apps/effect` has a route that accepts input and changes state.
At that point:

1. Copy `.github/security/zap/hono-active.yaml`.
2. Keep the `replacer` job unchanged. `apps/effect/src/server/csrf.ts` and `origin.ts` do the same origin check `apps/hono` does.
3. Replace the `authentication` block with whatever the effect app uses.
4. Point the `openapi` job at the effect app's own document.

## Change the failure threshold

Today a **High** finding fails the run. **Medium** and below are reported only.
That lives in the `exitStatus` job at the end of every plan:

```yaml
- type: exitStatus
  parameters:
    errorLevel: High
    warnLevel: Medium
    okExitValue: 0
    errorExitValue: 1
    warnExitValue: 0 # this is what makes a warning non-blocking
```

To make Medium fail too, set `errorLevel: Medium`.

Do this only after the Medium findings are triaged. 
Otherwise the job fails on day one, and people learn to ignore it.

## Troubleshoot the runner

**`ZAP_TARGET is required and has no default`**
Set it. The message prints the two common values.

**`a bare localhost target is not reachable from the ZAP container`**
Inside the container, `localhost` is the container. Use
`https://hono.be-monorepo.localhost` instead. That name also equals `APP_URL`,
so the origin check passes.

**`could not run docker`**
Start Docker Desktop.

**The scan runs but finds no URLs**
The app is not answering at `ZAP_TARGET`. Check with `curl -k <target>/openapi`.

**Reports are missing**
The plan failed before its `report` job. Read the ZAP output above the error.
`.zap-reports/` is only written at the end of a plan.

## Understand local and CI parity

Both run the same plan file, in the same container, with the repository root mounted at `/zap/wrk`.

- **Locally**: `scripts/security/zap.ts` issues the `docker run`.
- **In CI**: `zaproxy/action-af` issues an equivalent one.

One difference, and it is in the networking. 
Docker rejects `--add-host` together with `--network host`, so the script picks one:

- **Linux** — `--network host`, the same as the action.
- **macOS** — host networking does nothing on Docker Desktop, so a `*.localhost` name is mapped to the host gateway instead.

A public target needs neither.

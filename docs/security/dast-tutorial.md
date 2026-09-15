# Tutorial: your first DAST scan

DAST means dynamic application security testing. 
A scanner sends real HTTP requests to a running server and reports what comes back.

## Before you start

You need four things:

1. **Docker**, running. ZAP runs in a container. Nothing is installed on your machine.
2. **Postgres**, from `bun compose:up`.
3. **`apps/hono/.env.dev`**. Copy it from `apps/hono/.env.example`.
4. **A seeded database**. You will do this in step 2.

Check Docker first, because every command below fails without it:

```bash
docker version
```

If that prints an error about the daemon, start Docker Desktop and wait.

## Step 1 — start the app

Open a terminal and leave it running:

```bash
bun compose:up
```

Open a second terminal:

```bash
bun hono dev
```

The app is now at `https://hono.be-monorepo.localhost`. 
This is the portless proxy, not `localhost:3000`. 
Use this hostname for everything below. Step 5 explains why it matters.

Check it answers:

```bash
curl -k https://hono.be-monorepo.localhost/openapi
```

You should see an OpenAPI document.

## Step 2 — seed the database

The active scan in step 5 signs in as a user. Create it now:

```bash
bun hono db:push
bun hono db:seed
```

The seed prints the credentials. 
They are also in `apps/hono/src/db/seeds/seed-user-data.ts`, in the clear. 
That is on purpose: this database is disposable, so the credentials are not a secret.

## Step 3 — run the baseline scan

```bash
ZAP_TARGET=https://hono.be-monorepo.localhost bun zap:hono:baseline
```

The first run pulls the ZAP image, which is about 1 GB. 
Later runs skip that.

While it runs, ZAP does three things:

1. **Spiders.** It follows links from the target and builds a list of URLs.
2. **Scans passively.** It looks at each response that the spider already collected. It sends no extra requests.
3. **Reports.**

A baseline scan attacks nothing. It only reads. 
This is what makes it safe against a live service, and it is the only plan this repo permits near production.

## Step 4 — read the report

```bash
open .zap-reports/hono-baseline.html
```

There are two reports in that directory:

- **`.html`** — for a person. Start here.
- **`.sarif.json`** — for tooling. CI uploads this to GitHub code scanning, the same place CodeQL findings appear.

Most baseline findings are about response headers. 
Compare them against `apps/hono/src/app.ts`, where `secureHeaders()` is applied. 
A finding that contradicts that middleware is worth investigating. 
A finding about a header the middleware never sets is a real gap.

## Step 5 — run the active scan

This one attacks. 
It sends injection payloads, malformed bodies and unexpected methods at every route it knows about.

```bash
ZAP_TARGET=https://hono.be-monorepo.localhost bun zap:hono:active
```

Expect 15 to 30 minutes.

**Never point this at production.** It writes real data. 
Nothing automated can do so: the scheduled CI job only ever runs a baseline.

Two things in the app would stop this scan dead, and the plan handles each one. 
This is the part worth understanding, because it is what you will debug when a scan returns nothing.

### The app checks the request origin

`app.ts` applies `csrf({ origin: [ENV.APP_URL] })`, and better-auth applies its own `trustedOrigins`. 
Both reject a write whose `Origin` header does not match.
ZAP sends no `Origin` at all by default, so every attack would be rejected by the middleware before it reached a route.

The plan's `replacer` job adds the header:

```yaml
- type: replacer
  parameters:
    deleteAllRules: true
  rules:
    - description: "Origin the csrf() middleware and better-auth trustedOrigins accept"
      matchType: req_header
      matchString: Origin
      replacementString: ${ZAP_TARGET}
```

The app is not changed to let the scanner in. 
The scanner is configured to look like a browser on the allowed origin. 
That is what an attacker who found an XSS on that origin would have.

This is also why you use the portless hostname. 
It is the value of `APP_URL`, so the origin the plan sends is one the app already trusts.

### better-auth routes are out of scope

The active scan targets only our routes — `/llms-docs` and `/llms.txt`. 
OpenAPI viewers and every `/api/auth/**` path are excluded. 
They are third-party or generated surfaces, not code we own.

The plan still signs in through `/api/auth/sign-in/email` so the session cookie is set. 
That one login request is not an active-scan target.

```yaml
excludePaths:
  - ".*/openapi/?$"
  - ".*/openapi/docs.*"
  - ".*/api/auth/.*"
```

### The active scan is throttled

ZAP sends many payloads per URL. 
The plan limits concurrency so a local dev server is not overwhelmed:

```yaml
- type: activeScan
  parameters:
    threadPerHost: 1
    delayInMs: 200
```

That is the main reason the scan is slow. 
In-scope routes have no rate limit today. 
If you mount `rateLimit` in `app.ts`, raise `delayInMs` when you see `429`s.

## Step 6 — read the active report

```bash
open .zap-reports/hono-active.html
```

**Did the scan authenticate?** Search the report for a `401` or `403` on most requests. 
If you see that, sign-in failed and the whole scan is unauthenticated. 
See "Fix a failing sign-in" in the [how-to guides](./dast-how-to.md).

An unauthenticated scan produces a report that looks clean but proves nothing.

## What you learned

- A **baseline** scan reads. It is safe against anything.
- An **active** scan attacks. It needs a database you can throw away.
- The scanner is configured to satisfy the app's defences. 
  The app is never weakened to let the scanner through. 
  A CSRF kill switch in production code would be a worse defect than anything ZAP could find.
- Findings go to `.zap-reports/`, and in CI to GitHub code scanning.

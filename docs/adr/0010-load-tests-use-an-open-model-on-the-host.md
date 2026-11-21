---
status: accepted
---

# Load tests use an open model and run on the host

`packages/load` runs one k6 scenario per app with one of five load profiles. [ADR-0006](./0006-code-has-no-comments.md) moved these records here from code comments.

## Decisions

- **k6 runs on the host, never in Docker.** Docker Desktop routes every request through its VM network, so the latency it reports describes Docker, not the app.
- **Every profile except smoke uses an arrival-rate executor (an open model).** A VU executor sends less when the app slows down, which hides the latency that a load test must find. Each profile gets enough VUs to keep the rate when a request takes up to about one second; k6 counts `dropped_iterations` when it runs out.
- **The environment variables are `LOAD_*`, not `K6_*`.** k6 reads the `K6_` prefix as its own options, and `K6_DURATION` alone replaces every scenario.
- **stress, spike and breakpoint need `--allow-remote` for a target that is not this machine.** They can take a shared host down. smoke and load run anywhere.
- **A 429 has its own counter, held at zero.** It means the test hit a rate limiter, not the limit of the app, and the summary says so instead of folding it into `http_req_failed`.
- **A route's requests carry the route name in their `name` tag.** The per-route p95 threshold has no samples otherwise.
- **`handleSummary` rebuilds the text summary.** Exporting it turns off the k6 summary. It also writes JSON to `LOAD_SUMMARY_PATH` when `run.ts` gives one.
- **No live dashboard server**, because it keeps k6 alive after the run. **Exit code 99** is a failed threshold, which is a result, not a crash.

## Scenarios

- **Hono:** `get-session` with a bearer token is the only route that reaches Postgres on every call. Sign-in runs once in `setup()`, never in the loop: it is mostly password-hash CPU, and Better Auth allows 3 sign-ins per 10 seconds in production.
- **Effect:** the app has no database and no auth, so the scenario measures the Middleware Chain and the router. It calls the Readiness Probe, because that probe runs its Checks and keeps its span.

## Usage

`bun packages/load/src/app/run.ts <app> <profile> <url> [--allow-remote]`, or `bun load:<app>:<profile> <url>`. `app` is `hono` or `effect`. `profile` is `smoke`, `load`, `stress`, `spike` or `breakpoint`. The URL falls back to `LOAD_TARGET` and has no default. `LOAD_RATE` is the peak requests per second; smoke ignores it. `LOAD_HOLD` is how long the peak is held, or the ramp length for breakpoint. `LOAD_USER_EMAIL` and `LOAD_USER_PASSWORD` default to the committed seed user and apply to Hono only.

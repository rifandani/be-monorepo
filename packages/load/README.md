# @workspace/load

Install k6 first: `brew install k6`. It uses the local binary, not Docker, because the Docker Desktop network adds latency to each request.

Run it from the repository root:

```sh
bun load:<app>:<type> <url> [--allow-remote]
bun load:effect:smoke http://localhost:3000
LOAD_TARGET=http://localhost:3000 bun load:hono:load
```

| Type | Question it answers | Default load |
| --- | --- | --- |
| `smoke` | Does the script work, and does the app answer? | 1 VU for 30 s |
| `load` | Does the app meet its targets at normal traffic? | 100 rps for 5 m |
| `stress` | What happens above normal traffic? | 300 rps for 5 m |
| `spike` | Does the app survive a sudden burst? | 0 → 1000 rps in 10 s, for 1 m |
| `breakpoint` | Where is the limit? | 0 → 5000 rps over 10 m, stops at the first failed threshold |

- The URL is required and has no default. For numbers you can trust, use the direct `http://localhost:<PORT>` URL. The portless URL sends each request through one more proxy. It is good enough for `smoke`.
- `stress`, `spike` and `breakpoint` stop if the host is not this machine, unless you add `--allow-remote`.
- `LOAD_RATE` sets the peak requests per second. `LOAD_HOLD` sets how long the peak stays (for `breakpoint`, the length of the ramp). Do not use `K6_*` names: k6 reads them as its own options.
- Hono: the run signs in once as the seed user, so run `bun hono db:seed` first. Set `LOAD_USER_EMAIL` and `LOAD_USER_PASSWORD` to use a different user. Start the app with `NODE_ENV` unset. `production` turns on the better-auth rate limits, so the test measures the limiter. `development` turns on the query logger, which slows down each database call.
- Each run writes a JSON summary and an HTML report to `.k6-reports/`.
- A failed threshold makes k6 exit with code 99. The thresholds are in `src/profiles.ts`.

## Files

| File | What it does |
| --- | --- |
| `src/run.ts` | The wrapper, run by bun. It reads the arguments, applies the remote guard, and starts `k6 run`. |
| `src/profiles.ts` | The five test types, their thresholds, the 429 counter, and the end-of-test summary. k6 code. |
| `src/hono.ts`, `src/effect.ts` | One scenario for each app. k6 code. |

The k6 files run in the k6 runtime, not in Node. They import `k6/*` modules and read `__ENV`. `bun load:typecheck` checks them with `@types/k6`.

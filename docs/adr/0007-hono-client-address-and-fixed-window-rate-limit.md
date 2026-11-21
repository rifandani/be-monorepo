---
status: accepted
---

# Hono resolves one client address and rate limits it in a fixed window

`apps/hono` has one module that resolves the client address (`src/server/client-address.ts`) and one rate-limit store with a fixed window (`src/server/middleware/rate-limit/store.ts`). Better Auth and the global rate limiter both use them, so the two limiters see the same client.

These records came from code comments. [ADR-0006](./0006-code-has-no-comments.md) moved them here.

## Client address

- **One header order for all callers, and the first header with an address wins.** The order is an array, not the key order of an object. `cf-connecting-ip` is first, because Cloudflare sets it to one address and replaces the client value. `x-forwarded-for` is next, because it is the most common; its first hop is the client. `forwarded` (RFC 7239, the `for=` directive) is last, because it is rare.
- **Better Auth gets the same order without `forwarded`** (`advanced.ipAddress.ipAddressHeaders` in `src/server/auth.ts`). Better Auth reads the raw value as an address, and `for=...;proto=https` is not one, so it would always skip that header.
- **Fallback order:** request headers, then the connection, then `anonymous`.
- **Better Auth does not rate limit server-side `auth.api` calls.** Its limits apply only to client requests (<https://better-auth.com/docs/concepts/rate-limit>).

## Fixed-window store

- **The rule.** A window starts at its first hit and ends at `windowStart + windowMs`. At that time or later, the next hit starts a new window. Hits never move the start, so steady traffic does not extend a window. `get` and `increment` report the same reset time. `nextWindow` is the one statement of the rule. The in-memory adapter calls it, and the Postgres adapter writes the same rule in SQL.
- **The store fails open.** When the storage throws, the store logs the error and lets the request through with a count of one.
- **`windowMs` comes from `init`**, which `hono-rate-limiter` calls once. A call before `init` is a setup error.
- **Failures go to the evlog process logger** under one tag. `hono-rate-limiter` gives its `Store` only a key, not the Hono context, so `c.get("log")` is out of reach. These lines do not reach the OTLP drain.
- **Every key has a namespace prefix.** Better Auth keeps rows such as `1.2.3.4/sign-in/email` in the same `rate_limit` table. `resetAll` deletes only keys with the prefix.

## Storage adapters

`RateLimitStorage` is the seam. Every method gets a key that already has the prefix, and an adapter must not change a key. `hit` counts one hit as one atomic step, so two concurrent hits never lose a count, and returns what `nextWindow` gives. `decrement` never goes below zero, does not move the window start, and leaves a key without state unchanged. `get` can return a window that is already over; the caller checks.

- **Memory adapter.** The tests use it. `hit` has no `await` between the read and the write, so two concurrent calls cannot lose a hit.
- **Postgres adapter.** One atomic upsert. The `SET` expressions read the old row, so both `CASE` branches see the same window, and the row lock of `ON CONFLICT` serializes concurrent hits. `starts_with` is a plain prefix match, so `%` and `_` in the prefix are safe. For its own rows, the `last_request` column holds the window start. Issue [#97](https://github.com/rifandani/be-monorepo/issues/97) tracks the replacement of this reuse with a real column.

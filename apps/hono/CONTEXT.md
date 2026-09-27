# Hono App

The HTTP API served by `apps/hono` — Better Auth sessions, rate limiting, OpenAPI docs, and the Postgres schema behind them.

## Language

**core**: `src/core/` — this app's own shared internals: constants, types, utilities, and assets that more than one route or middleware reaches for. It is a location, not a layer, and it carries no architectural meaning beyond "not specific to one route". _Avoid_: shared, common

Until 2026-08-26 the word was overloaded: `@workspace/core` was also a workspace package that both apps could import. That package was dissolved into `src/core/` because only this app ever depended on it, so only the meaning above remains.

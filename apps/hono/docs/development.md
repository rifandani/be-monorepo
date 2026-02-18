# Development

- **Env**: Source of truth is local env files. When changing them, update deployment/CI project env too.
- **Port**: `3333`

```bash
# From repo root: spin up services
bun compose:up

# From apps/hono
bun dev               # bun runtime with development env
bun dev:prod          # bun runtime with production env
bun node:dev          # node runtime with development env
bun node:dev:prod     # node runtime with production env
```

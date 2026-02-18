# Agent instructions

Bun workspace monorepo: Hono (backend). Apps in `apps/`, shared code in `packages/`.

- **Package manager**: `bun` (not npm)
- **Lint** (all apps): `bun lint` or `bun lint:fix` to apply safe fix from root
- **Typecheck** (all apps): `bun typecheck` from root

Details by topic:

- [Architecture](docs/architecture.md)
- [Security](docs/security.md)

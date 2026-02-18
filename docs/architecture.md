# Architecture

- **Monorepo**: `bun` workspace; apps in `apps/`, packages in `packages/`
- **Apps**
  - `hono`: Backend (Hono 4)
- **Packages**
  - `core`: Shared business logic, types, services, constants, etc
  - `typescript-config`: Shared TypeScript config

Run app-specific commands from repo root: `bun --filter @workspace/<app>` or from the app directory.

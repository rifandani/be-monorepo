---
status: accepted
---

# One capability contract feeds HTTP, CLI and MCP

`apps/effect` has one HTTP API contract today, and only the HTTP surface uses it. If we add a CLI or an MCP server, each surface could get its own handlers and its own schemas. We decide that one schema-typed contract and one handler serve every surface. This keeps one definition of each action.

## The contract and its handler

Each `src/features/<name>/api.ts` owns the contract for that feature. The contract holds the endpoints, the payloads, the success schemas and the error schemas. The contract holds no handler. It does not import transport code. One handler implements each operation. `src/app/` binds that handler to the contract. A surface calls the handler through the binding.

## Surfaces are projections

`src/app/` projects each contract onto a surface:

- `src/app/http.ts` — the HTTP surface. It exists today.
- `src/app/mcp.ts` — the MCP surface. It is new.
- `src/app/cli.ts` — the CLI surface. It is new.

A projection adds no behaviour that the handler does not have. It decodes input, calls the handler and encodes the result for its transport. If an action is not in the contract, no surface can offer it. If a rule changes, we change the handler once.

OpenAPI is generated output. It is never input. The CLI and the MCP surface do not read the OpenAPI document. All three surfaces read the same schemas from the contract.

## Boundaries

This decision follows [ADR-0004](./0004-follow-the-default-bulletproof-boundaries.md). Features own contracts. `src/app/` composes surfaces. `src/server/` holds transport infrastructure. A surface folder in `src/app/` may import from features and server. A feature does not import a surface. New surface folders stay in `src/app/` so the existing zone rules keep their meaning.

## MCP tools

Use the checklist in "An MCP your users want" when we name and describe tools:

- Name a tool after the contract operation. Add the group as a prefix when names could clash, for example `healthReady`.
- Take the tool description from the contract's schema annotations. Do not write a second description for MCP.
- Expose the actions that the HTTP surface exposes. Do not add MCP-only behaviour.
- Keep code mode out of the default tool list. Let the client opt in.
- When the app has docs, expose a search tool. When an action has a product link, use a deep link. Scope toolsets and permissions to the caller's token. Let clients use OAuth when the app accepts it.

## References

- [One capability, every surface](https://ratstack.sh/lore/one-capability-every-surface)
- [One schema, three surfaces](https://ratstack.sh/lore/one-schema-three-surfaces)
- [MCP is another surface](https://ratstack.sh/lore/mcp-is-another-surface)
- [An MCP your users want](https://ratstack.sh/lore/an-mcp-your-users-want)

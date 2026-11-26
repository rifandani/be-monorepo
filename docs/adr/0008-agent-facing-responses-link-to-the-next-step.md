---
status: accepted
---

# Agent-facing responses link to the next step

An agent that reads an `llms` page or a refusal must find the next action in that response. If the response has no links, the agent must guess a path or read all of the OpenAPI document. We decide that agent-facing responses in `apps/hono` give the next valid actions as absolute links. The links come from the contract, not from hand-written strings.

## The `llms` pages

Each `llms` page ends with its next actions:

- `/llms.txt` is the index. It ends with a `## Next actions` section. The section lists each operation of the app contract.
- `/llms-auth.txt` ends with a `## Next actions` section. The section lists each Better Auth operation, for example sign up, verify the email and sign in.
- `/llms-docs` returns JSON. Its `links` field lists each operation of the app contract.

In Markdown, each action is one list item: `- METHOD [title](absolute URL)`. In JSON, each action is an object with `href`, `method` and `title`. The title is the summary of the operation. If there is no summary, the title is the description, then the operation ID, then `METHOD path`. A path template such as `/callback/{id}` stays as written.

## Refusals

A refusal body ([ADR-0007](./0007-failures-have-three-classes.md)) contains a `docs` field when `app.ts` writes the body. The `docs` field is the absolute URL of the `llms` index. This applies to the `ZodError` refusal and to the `notFound` refusal. An evlog error keeps its own `link`. An `HTTPException` keeps its own response.

An infrastructure fault and a defect do not get a `docs` link. The client cannot repair them with a change to the request.

## Links come from the contract

- The app links come from the OpenAPI document that `@hono/zod-openapi` generates from the routes that `app.openapi()` registers. The `llms` pages make this document after all of the `llms` routes are registered, so the index also lists itself and the other `llms` pages.
- The auth links come from the OpenAPI document that Better Auth generates (`auth.api.generateOpenAPISchema()`).
- The base URL of a link is the first `servers` URL of its document. If the document has no server, the base URL is `ENV.APP_URL`. If the server URL is relative, the link builder puts it below `ENV.APP_URL`.
- The `docs` link of a refusal uses `LLMS_INDEX_PATH`. The `/llms.txt` route definition uses the same constant. The link and the route cannot be different.

The route definitions are the contract. The OpenAPI document is generated output of these definitions, as [ADR-0006](./0006-one-capability-contract-feeds-http-cli-and-mcp.md) requires. The `llms` pages read the generated document only to write links. No route, handler or schema reads it as input.

The link builders list each operation in contract order. They do not select one step of a flow. The agent reads the titles to select the next step, for example sign up, then verify the email, then sign in.

Do not write a path of an operation by hand in a link. If an operation is not in a contract, no link points to it.

## Where the code goes

This decision follows [ADR-0004](./0004-follow-the-default-bulletproof-boundaries.md):

- `src/shared/utils/links.ts` holds the link builders. They are pure functions: `absoluteUrl`, `nextActions` (a contract to a list of actions) and `nextActionsMarkdown` (a list of actions to Markdown). They do not import from other zones.
- `src/features/docs/routes.ts` makes the contracts, calls the builders and serves the pages.
- `src/app/app.ts` adds the `docs` link to the refusals that it writes.

## Scope

This ADR applies to `apps/hono`, because it serves the `llms` pages. When `apps/effect` serves `llms` pages, it uses the same rules. Its links then come from its `HttpApi` contract ([ADR-0006](./0006-one-capability-contract-feeds-http-cli-and-mcp.md)).

The tests in `apps/hono/tests/llms*.test.ts` and `apps/hono/tests/error-handling.test.ts` check the links. The tests in `src/shared/utils/links.test.ts` check the builders.

## References

- [HATEOAS](https://ratstack.sh/lore/hateoas)
- [Two lines of curl is a front door](https://ratstack.sh/lore/two-lines-of-curl-is-a-front-door)

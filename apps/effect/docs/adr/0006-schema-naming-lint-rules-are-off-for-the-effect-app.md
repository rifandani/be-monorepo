---
status: accepted
---

# Schema-naming lint rules are off for the Effect app

The `apps/effect/**` override in the root `oxlint.config.ts` turns off four rules: `no-redeclare`, `typescript/no-empty-interface`, `typescript/no-empty-object-type` and `unicorn/throw-new-error`. The source of the Effect app has no inline `oxlint-disable` directive for them.

## Which conventions cause the false positives

**One name for a value and its type.** A schema constant and its decoded type have the same name:

```ts
export const HealthReport = Schema.Struct({ ... });
export interface HealthReport extends Schema.Schema.Type<typeof HealthReport> {}
```

A `Context.Reference` and the union type it holds (`Language` in `src/server/language.ts`) follow the same convention. `no-redeclare` reads the pair as a redeclaration. `no-empty-interface` and `no-empty-object-type` read the interface as empty, because all of its members come from `Schema.Schema.Type`. The interface is not a mistake: it gives the decoded type a name that editors and error messages show, in place of the expanded structure.

**`Schema.TaggedError` is a class factory.** `Schema.TaggedError<Unhealthy>()(...)` returns a class to extend. It does not throw. `throw-new-error` sees a call to a function whose name ends in `Error` and reads it as an error that is made without `new`.

## Why the scope is all of `apps/effect/**`

A file list becomes incorrect. The convention applies to every new schema, so each new feature module would need a new entry in the list. Inline `oxlint-disable` directives, the previous fix, have the same problem: each new schema module must repeat them, and the reason for them is not in the code.

`no-redeclare` has small value in `.ts` files. TypeScript itself reports a real redeclaration of a `let`, `const`, class or type alias, and the type-aware lint (`typeCheck: true` in the root config) runs that check on all of the app. The main case that the rule catches and TypeScript does not is a value and a type with the same name, which is the convention.

## Consequences

- `no-empty-interface`, `no-empty-object-type` and `throw-new-error` also stop working for code in the Effect app that is not a schema. An empty interface or a `SomethingError()` call without `new` in a service module is not reported. The maintainer accepted this cost. Code review and TypeScript must find these mistakes.
- The override applies only to `apps/effect/**`. `apps/hono`, `apps/load` and the packages keep the four rules.
- If the app stops using one name for a schema and its type, or oxlint can identify these patterns, turn the rules on again and remove them from the override.

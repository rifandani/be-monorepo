---
status: accepted
---

# Apps run TypeScript natively on Node

Both apps run their own `.ts` files. There is no build step: `node ./src/node.ts` is the whole of `node:start`, and `tsc` is now only ever a typechecker (`tsc --noEmit`). Node strips the types on load and executes what is left.

This replaces the previous arrangement, where `node:build` ran `tsc -p .` into `dist/` and `node:start` ran the emitted JavaScript. Nothing consumed `dist/` except `node:start` — there is no Dockerfile and no publish step — so removing the emit removed the only reason it existed.

## Vocabulary

> **Type stripping** — what Node does to a `.ts` file on load: it erases the type annotations and runs the rest. It is *erasure only*. Node never rewrites a specifier, resolves a tsconfig, or transforms a construct into different JavaScript.
>
> **Erasable syntax** — TypeScript that type stripping alone can remove. An annotation, an `interface`, a `type`, a `satisfies`, an `as` are all erasable. An `enum`, a `namespace` with a value, a constructor parameter property, and `import x = require(...)` are **not**: they need code generated for them, which Node will not do.

## Consequences

**Every relative specifier names the real file.** `./app.ts`, never `./app.js`. Node's ESM resolver performs no extension substitution — a `.js` specifier pointing at a `.ts` file is a hard `ERR_MODULE_NOT_FOUND` at startup, not a warning. The old `.js` specifiers existed only to be correct *after* a `tsc` emit that no longer happens. `allowImportingTsExtensions` in `@workspace/typescript-config/node.json` is what lets `tsc` accept this, and TypeScript permits that option only alongside `noEmit` — so the two settings stand or fall together.

**Cross-folder imports go through `#*`, not a tsconfig `paths` alias.** Each app declares `"imports": { "#*": "./src/*" }` in its `package.json`. Node, Bun, and Vitest all resolve that natively; a tsconfig `paths` alias would resolve for `tsc` and Vitest and then fail on Node, which reads no tsconfig at all. `apps/hono` previously used `@/*` and could only run from `dist/`, because `tsc` does not rewrite an alias when it emits. Siblings stay relative — `#` earns its keep only where it replaces a `../` chain.

**`erasableSyntaxOnly` is on in `base.json`, for every package.** Without it, an `enum` would typecheck cleanly and then crash the process. It is the option that keeps the source and the runtime in agreement, and it costs nothing: neither app contained a single non-erasable construct when it was turned on.

**`.tsx` cannot run.** Node raises `ERR_UNKNOWN_FILE_EXTENSION` for it — type stripping does not extend to JSX. `apps/hono` therefore no longer declares `jsx` or `jsxImportSource`; it had no `.tsx` file, and leaving the settings in place would have let someone write one that typechecked and could not start. Hono JSX remains possible, but only as a deliberately Bun-only file.

**`moduleResolution` is `nodenext` everywhere.** `node.json` used to override it to `bundler`, which was defensible while `tsc` emitted. Now that Node resolves the specifiers itself, `nodenext` is the truthful reading: it is what reports a wrong extension or a missing `imports` entry during typecheck rather than at startup.

**`tsx` is gone.** `node --watch` covers what `tsx watch` was for. `dotenvx run` is unchanged — it stays the env loader so that test, dev, and prod share one, and so that an encrypted `.env` is decrypted rather than read as ciphertext.

**Bun remains a first-class runtime.** Each app keeps `src/bun.ts`, `@types/bun`, and its Bun script family; `types` is `["bun", "node"]` so both are stated rather than one arriving transitively. This decision removed a build step; it did not pick a winner between the two runtimes.

## The version floor

`engines.node` is `>=26.0.0` in the root and in both apps. **This is a support policy, not a capability claim** — type stripping has been on by default since Node 22.18, and none of the above needs 26. We support the 26.x line, which enters LTS in October 2026.

`.node-version` pins `26.8.1`, the version we develop and test on, and all four CI workflows read it via `node-version-file`. The split is deliberate: the floor says what will run, the pin says what we check. One consequence to keep in mind — an exact pin means CI no longer picks up 26.x patch releases on its own, so `.node-version` is something `/bump-deps` should maintain.

Note also that Bun does not enforce `engines` on install. The floor is enforced by CI reading `.node-version`, not by the package manager.

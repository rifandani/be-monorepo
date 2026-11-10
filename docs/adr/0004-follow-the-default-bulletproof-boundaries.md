---
status: accepted
---

# Follow the default Bulletproof boundaries

Use Fallow's built-in `bulletproof` preset and move source files to its default folders. Keep its default zones and import rules. This requires changes to the source structure, but it lets the preset enforce the intended architecture without custom zones that preserve the old structure.

`app` composes features and server infrastructure. Each `features/<name>` folder owns one feature and can import from `server` and `shared`. `server` can import from `shared`. `shared` cannot import from the other zones. Features cannot import from each other.

Add checks that fail on boundary violations. Refactor invalid dependencies instead of adding rule exceptions to make the checks pass.

Apply this structure to both API apps and the load-test package. Require every analyzed source file to match a default zone. Only named config files and external test folders can remain unmatched. Run each workspace's boundary check from the root command and CI.

Hono's server infrastructure owns the Better Auth instance; its auth feature owns route registration. Effect's app composition binds health handlers and supplies probe policy to server infrastructure.

Reference: [Fallow architecture boundaries](https://fallow.tools/docs/analysis/boundaries/).

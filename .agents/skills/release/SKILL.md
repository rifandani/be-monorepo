---
name: release
description: Cut a monorepo release — version via Changesets, mirror root, tag, push, confirm GitHub Release.
disable-model-invocation: true
---

# Release

Cut a **release** on `main`: consume pending changesets, bump the fixed workspace group in lockstep, mirror the root version, commit, annotated-tag, push, confirm the GitHub Release.

Changeset *authoring* is out of scope — the human already ran `bun cs` (always selecting all three `@workspace/*` packages). This skill owns the mechanical cut only.

## Fixed group (hard gate)

`.changeset/config.json` must list exactly this `fixed` group (order irrelevant):

- `@workspace/hono`
- `@workspace/core`
- `@workspace/typescript-config`

Abort if missing or incomplete. Do not rewrite the config.

## Steps

### 1. Preflight

Abort unless every check passes:

- [ ] Current branch is `main`
- [ ] Working tree is clean
- [ ] `main` is up to date with `origin/main` (`git fetch` then compare)
- [ ] ≥1 pending changeset under `.changeset/` (`.md` files other than README; not only `config.json`)
- [ ] `fixed` hard gate above passes

**Done when:** every box above is checked.

### 2. Version

Run `bun cs:v`.

**Done when:** pending changeset files are consumed, each fixed package's `package.json` `version` equals the same `next`, and each of `apps/hono`, `packages/core`, `packages/typescript-config` has a `CHANGELOG.md` whose newest heading includes `next`.

### 3. Mirror root

Set root `package.json` `"version"` to `next`. Do not create a root `CHANGELOG.md`.

**Done when:** root `version === next` and matches the three fixed packages.

### 4. Re-check tag absence

Confirm `v{next}` does not exist locally or on `origin`.

**Done when:** tag is free.

### 5. Commit

Stage version bumps + CHANGELOGs + root `package.json`. Commit:

```text
chore: release v{next}
```

**Done when:** that commit is `HEAD` on `main` and contains only release artifacts.

### 6. Tag

```bash
git tag -a "v{next}" -m "v{next}"
```

**Done when:** annotated tag `v{next}` points at the release commit.

### 7. Push

```bash
git push origin HEAD --follow-tags
```

**Done when:** `origin/main` has the release commit and `origin` has annotated tag `v{next}`.

### 8. Confirm GitHub Release

Poll until `gh release view "v{next}"` succeeds, up to ~2 minutes.

**Done when:** the GitHub Release for `v{next}` exists. If the poll times out, report push+tag succeeded and Release still pending — do not claim the release finished.

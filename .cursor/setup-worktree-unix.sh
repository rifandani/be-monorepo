#!/usr/bin/env bash
# Shared worktree bootstrap for hono + portless.
# - Cursor: `.cursor/worktrees.json` → setup-worktree-unix.sh
# - Claude Code: `.claude/hooks/worktree-create.sh` (after git worktree add)
# Runs inside the new worktree. ROOT_WORKTREE_PATH = main checkout.
set -euo pipefail

ROOT="${ROOT_WORKTREE_PATH:?ROOT_WORKTREE_PATH is required}"

# Matches portless.json / `bun hono dev` (`portless run --name hono.be-monorepo`).
HONO_PORTLESS_NAME="hono.be-monorepo"

echo "==> Installing workspace dependencies"
bun install --frozen-lockfile

echo "==> Syncing hono env files from main checkout"
HONO_DIR="apps/hono"
mkdir -p "$HONO_DIR"

copied=0
for f in .env.dev .env.prod .env.local; do
  src="$ROOT/$HONO_DIR/$f"
  if [[ -f "$src" ]]; then
    cp "$src" "$HONO_DIR/$f"
    echo "    copied $f"
    copied=$((copied + 1))
  fi
done

for env_name in dev prod; do
  target="$HONO_DIR/.env.$env_name"
  example="$HONO_DIR/.env.$env_name.example"
  if [[ ! -f "$target" && -f "$example" ]]; then
    cp "$example" "$target"
    echo "    seeded .env.$env_name from example"
    copied=$((copied + 1))
  fi
done

if [[ "$copied" -eq 0 ]]; then
  echo "    warning: no hono env files found in $ROOT/$HONO_DIR (copy *.example manually)"
fi

echo "==> Checking portless (required for bun hono dev)"
if ! command -v portless >/dev/null 2>&1; then
  echo "error: portless not on PATH. Install once on the machine:"
  echo "  bun add -g portless"
  echo "  # or: npm install -g portless"
  exit 1
fi

# `portless run` prefixes linked worktrees: https://<branch>.hono.be-monorepo.localhost
# APP_URL / PORT follow PORTLESS_URL via env.ts.
hono_url="$(portless get "$HONO_PORTLESS_NAME" 2>/dev/null || true)"
if [[ -z "$hono_url" ]]; then
  hono_url="https://${HONO_PORTLESS_NAME}.localhost"
fi

echo ""
echo "Worktree setup complete."
echo "  Hono URL:  $hono_url"
echo "  Start:     bun hono dev"
echo ""

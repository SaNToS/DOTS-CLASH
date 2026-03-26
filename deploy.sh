#!/bin/sh
set -e

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

DEPLOY_FILE=".last_deploy_commit"

# ── Optional forced targets: ./deploy.sh [client|server|all] ────────────
FORCE="$1"

echo "Pulling latest changes..."
# Stash runtime files git tracks but shouldn't (botMemory.json accumulates learned data)
git stash push -m "deploy-autostash" -- server/botMemory.json 2>/dev/null || true
git pull
git stash pop 2>/dev/null || true

CURRENT=$(git rev-parse HEAD)
LAST=$(cat "$DEPLOY_FILE" 2>/dev/null || echo "")

if [ -n "$LAST" ] && [ "$LAST" != "$CURRENT" ]; then
  CHANGED=$(git diff "$LAST" "$CURRENT" --name-only 2>/dev/null || echo "all")
else
  CHANGED="all"
fi

echo "$CURRENT" > "$DEPLOY_FILE"

# ── Determine what to update ─────────────────────────────────────────────
DO_CLIENT=0
DO_SERVER=0

if [ "$FORCE" = "client" ] || [ "$FORCE" = "all" ]; then
  DO_CLIENT=1
fi
if [ "$FORCE" = "server" ] || [ "$FORCE" = "all" ]; then
  DO_SERVER=1
fi

if [ -z "$FORCE" ]; then
  echo "$CHANGED" | grep -q "^client/" && DO_CLIENT=1
  echo "$CHANGED" | grep -q "^server/" && DO_SERVER=1
  [ "$CHANGED" = "all" ] && DO_CLIENT=1 && DO_SERVER=1
fi

# ── CLIENT ───────────────────────────────────────────────────────────────
if [ "$DO_CLIENT" = "1" ]; then
  echo ">>> Rebuilding client (Vite build)..."
  docker compose up -d --build client
fi

# ── SERVER ───────────────────────────────────────────────────────────────
if [ "$DO_SERVER" = "1" ]; then
  if echo "$CHANGED" | grep -q "server/package" || [ "$FORCE" = "server" ] || [ "$FORCE" = "all" ]; then
    echo ">>> Rebuilding server image (package.json changed)..."
    docker compose up -d --build server
  else
    echo ">>> Restarting server (source is mounted)..."
    docker compose restart server
  fi
fi

echo ""
docker compose ps

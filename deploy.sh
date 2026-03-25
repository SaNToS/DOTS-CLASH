#!/bin/sh
set -e

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo "Pulling latest changes..."
git pull

CHANGED=$(git diff HEAD@{1} --name-only 2>/dev/null || echo "all")
echo "Changed files:"
echo "$CHANGED"
echo ""

# ── CLIENT ──────────────────────────────────────────────────────────────
if echo "$CHANGED" | grep -q "^client/" || echo "$CHANGED" | grep "all" > /dev/null 2>&1 && [ "$CHANGED" = "all" ]; then
  echo ">>> Rebuilding client (Vite build)..."
  docker compose up -d --build client
  echo "Client updated."
fi

# ── SERVER ──────────────────────────────────────────────────────────────
if echo "$CHANGED" | grep -q "^server/"; then

  # Full rebuild only if dependencies or Prisma schema changed
  NEEDS_REBUILD=0
  echo "$CHANGED" | grep -q "server/package"        && NEEDS_REBUILD=1
  echo "$CHANGED" | grep -q "server/prisma/schema"  && NEEDS_REBUILD=1

  if [ "$NEEDS_REBUILD" = "1" ]; then
    echo ">>> Rebuilding server image (package.json or schema changed)..."
    docker compose up -d --build server
  else
    echo ">>> Fast-updating server (copy files + restart)..."
    # Copy only source files, skip node_modules and generated files
    for f in index.js roomManager.js gameLogic.js botAI.js botMemory.json; do
      [ -f "server/$f" ] && docker cp "server/$f" dots_server:/app/ && echo "  copied $f"
    done
    if [ -d "server/routes" ]; then
      docker cp server/routes dots_server:/app/routes && echo "  copied routes/"
    fi
    docker restart dots_server
    echo "Server restarted."
  fi
fi

# If nothing matched (e.g. docker-compose.yml changed), rebuild everything
if ! echo "$CHANGED" | grep -qE "^(client|server)/"; then
  echo ">>> No client/server changes detected, rebuilding all..."
  docker compose up -d --build
fi

echo ""
docker compose ps

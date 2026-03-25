#!/bin/sh
set -e

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo "Pulling latest changes..."
git pull

CHANGED=$(git diff HEAD@{1} --name-only 2>/dev/null || echo "all")

# ── CLIENT — needs Vite rebuild ──────────────────────────────────────────
if echo "$CHANGED" | grep -q "^client/" || [ "$CHANGED" = "all" ]; then
  echo ">>> Rebuilding client..."
  docker compose up -d --build client
fi

# ── SERVER ───────────────────────────────────────────────────────────────
if echo "$CHANGED" | grep -q "^server/" || [ "$CHANGED" = "all" ]; then

  # Rebuild image only if node_modules need to change
  if echo "$CHANGED" | grep -q "server/package"; then
    echo ">>> Rebuilding server (package.json changed)..."
    docker compose up -d --build server
  else
    # Source files are mounted — just restart the container
    # prisma generate + db push run automatically on startup
    echo ">>> Restarting server (source is mounted, no rebuild needed)..."
    docker compose restart server
  fi
fi

echo ""
docker compose ps

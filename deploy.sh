#!/bin/sh
set -e

export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

echo "Pulling latest changes..."
git pull

# Detect which services have changed
CHANGED=$(git diff HEAD@{1} --name-only 2>/dev/null || echo "all")

BUILD_ARGS=""

if echo "$CHANGED" | grep -q "^server/"; then
  BUILD_ARGS="$BUILD_ARGS server"
fi

if echo "$CHANGED" | grep -q "^client/"; then
  BUILD_ARGS="$BUILD_ARGS client"
fi

# If nothing specific detected, rebuild all
if [ -z "$BUILD_ARGS" ]; then
  BUILD_ARGS="server client"
fi

echo "Rebuilding:$BUILD_ARGS"
docker compose up -d --build $BUILD_ARGS

echo ""
docker compose ps

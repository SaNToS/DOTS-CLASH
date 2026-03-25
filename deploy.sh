#!/bin/sh
set -e

echo "Pulling latest changes..."
git pull

echo "Rebuilding and restarting containers..."
docker compose up -d --build

echo "Done. Logs:"
docker compose ps

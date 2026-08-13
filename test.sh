#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/backend"

if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install
fi

echo "=== Backend tests ==="
npm test

# Frontend test step added once the frontend test setup exists.

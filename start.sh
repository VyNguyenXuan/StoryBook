#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/backend"

if [ ! -d node_modules ]; then
  echo "Installing backend dependencies..."
  npm install
fi

if [ ! -f ../.env ]; then
  echo "No .env found — copying .env.example. Defaults use the mock Gemini"
  echo "provider (free, no API key needed). Edit .env to switch to real calls."
  cp ../.env.example ../.env
fi

echo "Starting server on http://localhost:3001 ..."
node src/server.js

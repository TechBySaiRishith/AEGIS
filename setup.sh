#!/bin/bash
# AEGIS — one-command setup (works with npm or pnpm)
set -e

command -v pnpm >/dev/null 2>&1 || {
  echo "📦 pnpm not found — installing via npm…"
  npm install -g pnpm
}

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" != "18" && "$NODE_MAJOR" != "20" && "$NODE_MAJOR" != "22" ]]; then
  echo "⚠️  Node $NODE_MAJOR detected — better-sqlite3 prebuilds target Node 18/20/22."
  echo "   If install fails, use Docker: pnpm docker:up"
fi

pnpm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Created .env from .env.example — add your API keys there."
fi

echo ""
echo "✅ Ready! Run:  pnpm dev"

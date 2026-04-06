#!/bin/bash
# AEGIS — one-command setup (works with npm or pnpm)
set -e

command -v pnpm >/dev/null 2>&1 || {
  echo "📦 pnpm not found — installing via npm…"
  npm install -g pnpm
}

pnpm install

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Created .env from .env.example — add your API keys there."
fi

echo ""
echo "✅ Ready! Run:  pnpm dev"

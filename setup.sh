#!/bin/bash
# AEGIS — one-command setup (works with npm or pnpm)
set -e

command -v pnpm >/dev/null 2>&1 || {
  echo "📦 pnpm not found — installing via npm…"
  npm install -g pnpm
}

# ─── Node version check ────────────────────────────────────
# better-sqlite3 ships prebuilds for Node 18, 20, and 22.
# Node < 20 is approaching or past EOL — we recommend 22 LTS.
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo ""
  echo "❌ Node $NODE_MAJOR detected — AEGIS requires Node ≥ 20 (22 LTS recommended)."
  echo ""
  echo "   Upgrade with one of:"
  echo "     nvm install 22    # if using nvm"
  echo "     fnm use 22        # if using fnm"
  echo ""
  echo "   Or skip native setup entirely and use Docker:"
  echo "     docker compose up --build"
  echo ""
  exit 1
elif [[ "$NODE_MAJOR" != "20" && "$NODE_MAJOR" != "22" ]]; then
  echo "⚠️  Node $NODE_MAJOR detected — better-sqlite3 prebuilds target Node 20/22."
  echo "   If native install fails, fall back to Docker:"
  echo "     docker compose up --build"
fi

pnpm install || {
  echo ""
  echo "❌ pnpm install failed. This often happens with native modules (better-sqlite3)."
  echo ""
  echo "   Try one of:"
  echo "     1. Ensure you're on Node 20 or 22:  node -v"
  echo "     2. Use Docker instead:              docker compose up --build"
  echo ""
  exit 1
}

if [ ! -f .env ]; then
  cp .env.example .env
  echo "📝 Created .env from .env.example — add your API keys there."
fi

echo ""
echo "✅ Ready! Run:  pnpm dev"

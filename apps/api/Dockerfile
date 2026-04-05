# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build

# python3/make/g++ needed for native modules (better-sqlite3)
RUN apk add --no-cache git python3 make g++
RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace package manifests for dependency resolution
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Install all dependencies (includes compiling native modules)
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/

# Build shared package first, then API
RUN pnpm --filter @aegis/shared build
RUN pnpm --filter @aegis/api build

# ── Production stage ─────────────────────────────────────────
FROM node:22-alpine

# git is needed at runtime for cloning repositories
RUN apk add --no-cache git

ENV NODE_ENV=production
WORKDIR /app

# Copy entire workspace from build (includes compiled native modules + dist)
COPY --from=build /app/ ./

# Persistent data directory (SQLite DB + cloned repos)
RUN mkdir -p /app/data

EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

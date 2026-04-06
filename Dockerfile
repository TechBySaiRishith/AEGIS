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

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/api/ apps/api/
COPY apps/web/ apps/web/

# Build shared → API → Web
RUN pnpm --filter @aegis/shared build
RUN pnpm --filter @aegis/api build
RUN pnpm --filter @aegis/web build

# ── Production stage ─────────────────────────────────────────
FROM node:22-alpine

# git is needed at runtime for cloning repositories
RUN apk add --no-cache git

ENV NODE_ENV=production
WORKDIR /app

# ── API artifacts ────────────────────────────────────────────
# Copy API dist + its node_modules (includes native better-sqlite3)
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json

# ── Web artifacts (Next.js standalone) ───────────────────────
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

# Persistent data directory (SQLite DB + cloned repos)
RUN mkdir -p /app/data

# Entrypoint runs both API and Web
COPY docker/entrypoint.sh ./entrypoint.sh

ENV PORT=5555
ENV HOSTNAME="0.0.0.0"
ENV API_INTERNAL_URL="http://localhost:3001"

EXPOSE 5555

CMD ["sh", "entrypoint.sh"]

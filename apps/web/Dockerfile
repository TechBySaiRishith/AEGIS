# ── Build stage ──────────────────────────────────────────────
FROM node:22-alpine AS build

RUN npm install -g pnpm

WORKDIR /app

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./

# Copy all workspace package manifests
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# Install all dependencies
RUN pnpm install --no-frozen-lockfile

# Copy source code
COPY packages/shared/ packages/shared/
COPY apps/web/ apps/web/

# Build shared package first, then Next.js
RUN pnpm --filter @aegis/shared build
RUN pnpm --filter @aegis/web build

# ── Production stage ─────────────────────────────────────────
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Copy Next.js standalone output (includes node_modules and server)
COPY --from=build /app/apps/web/.next/standalone ./

# Copy static assets
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
CMD ["node", "apps/web/server.js"]

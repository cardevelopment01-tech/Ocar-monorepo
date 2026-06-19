# syntax=docker/dockerfile:1
FROM node:22.16-alpine AS base
RUN npm install -g pnpm@9

# ── Install all deps (incl. dev — needed for tsc) ───────────────────────────
FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY api/package.json ./api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @ocar/api

# ── Compile TypeScript ───────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY api/ ./api/
WORKDIR /app/api
RUN pnpm build
# dist/db/migrate.js resolves migrations via path.join(__dirname, 'migrations')
RUN cp -r src/db/migrations dist/db/migrations

# ── Production deps only ─────────────────────────────────────────────────────
FROM base AS prod-deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY api/package.json ./api/
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter @ocar/api

# ── Final production image ───────────────────────────────────────────────────
FROM node:22.16-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=prod-deps /app/api/node_modules ./node_modules
COPY --from=builder /app/api/dist ./dist
COPY api/entrypoint.sh ./entrypoint.sh

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1

USER node

ENTRYPOINT ["sh", "./entrypoint.sh"]

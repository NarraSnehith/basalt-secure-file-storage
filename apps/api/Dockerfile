# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo

# Install with the lockfile from the workspace root so versions are exact.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @basalt/api --include-workspace-root

COPY apps/api apps/api
RUN npm run build --workspace @basalt/api

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev --workspace @basalt/api --include-workspace-root \
 && npm cache clean --force

COPY --from=build /repo/apps/api/dist apps/api/dist
COPY apps/api/src/db/migrations apps/api/src/db/migrations

# Blobs live here when STORAGE_DRIVER=local. Mount a volume, or set
# STORAGE_DRIVER=s3 and this stays empty.
RUN mkdir -p apps/api/var/blobs && chown -R node:node apps/api/var
USER node

WORKDIR /repo/apps/api
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/server.js"]

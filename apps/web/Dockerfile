# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @basalt/web --include-workspace-root

COPY apps/web apps/web
# NEXT_PUBLIC_* is inlined at build time, so the API base has to be known here.
ARG NEXT_PUBLIC_API_BASE=/api
ENV NEXT_PUBLIC_API_BASE=$NEXT_PUBLIC_API_BASE
RUN npm run build --workspace @basalt/web

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /repo
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace @basalt/web --include-workspace-root \
 && npm cache clean --force

COPY --from=build /repo/apps/web/.next apps/web/.next
COPY --from=build /repo/apps/web/public apps/web/public
COPY apps/web/next.config.mjs apps/web/

USER node
WORKDIR /repo/apps/web
EXPOSE 3000
CMD ["npx", "next", "start", "--port", "3000"]

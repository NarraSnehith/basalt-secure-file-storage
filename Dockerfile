# ─────────────────────────────────────────────────────────────────────────────
# Both services in one image, behind one origin.
#
# Free tiers give you one always-on service, and this application wants to be
# reached through a single hostname anyway: the browser talks only to the web
# process, which forwards /api to the API on loopback. Session cookies stay
# first-party, CORS never enters the picture, and there is one URL to share.
#
#   docker build -t basalt . && docker run -p 3000:3000 --env-file .env basalt
# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci

COPY apps/api apps/api
COPY apps/web apps/web

# The browser must reach the API through the web process, and NEXT_PUBLIC_* is
# inlined at build time, so this is fixed here rather than at runtime.
ENV NEXT_PUBLIC_API_BASE=/api
RUN npm run build --workspace @basalt/api \
 && npm run build --workspace @basalt/web

# ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS run
WORKDIR /repo
ENV NODE_ENV=production

RUN apk add --no-cache tini

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev && npm cache clean --force

# dist already contains the .sql migrations (see build:sql).
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/web/.next apps/web/.next
COPY apps/web/public apps/web/public
COPY apps/web/next.config.mjs apps/web/
COPY scripts/start.sh scripts/start.sh

# Only used when STORAGE_DRIVER=local. On a host with an ephemeral disk, set
# STORAGE_DRIVER=s3 instead — uploads then outlive every redeploy.
RUN mkdir -p apps/api/var/blobs && chown -R node:node apps/api/var
USER node

# The platform tells us which port to serve on; the API stays on loopback.
ENV PORT=3000
ENV API_PORT=4000
ENV API_ORIGIN=http://127.0.0.1:4000
EXPOSE 3000

# tini reaps the two node processes properly, so a stopped container does not
# leave zombies and SIGTERM actually reaches them.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["sh", "scripts/start.sh"]

#!/bin/sh
# Run the migrations, then nginx and both Node services, in one container.
#
# nginx owns the public port; Next and Express are on loopback behind it. That
# arrangement is the point rather than an accident — see docker/nginx.conf.template
# for why Next must not be the thing proxying /api.
#
# No process manager: if any of the three dies the container dies with it and the
# platform restarts the whole thing. A container still listening with half the
# application missing is worse than one that restarts.
#
# Written for POSIX sh on purpose — the runtime image is Alpine, whose /bin/sh is
# BusyBox ash. `wait -n` would be the obvious way to do this and does not exist
# there, so the liveness check is an explicit poll.
set -eu

PORT="${PORT:-3000}"        # public; whatever the platform injects
API_PORT="${API_PORT:-4000}" # loopback
WEB_PORT="${WEB_PORT:-3100}" # loopback

if [ "$PORT" = "$API_PORT" ] || [ "$PORT" = "$WEB_PORT" ] || [ "$API_PORT" = "$WEB_PORT" ]; then
  echo "✖ PORT ($PORT), API_PORT ($API_PORT) and WEB_PORT ($WEB_PORT) must differ" >&2
  exit 1
fi

echo "→ migrating"
( cd apps/api && node dist/db/migrate.js up )

# Only these three, so nginx's own $variables are not eaten by envsubst.
mkdir -p /tmp/nginx-body /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi
envsubst '${PORT} ${API_PORT} ${WEB_PORT}' \
  < docker/nginx.conf.template > /tmp/nginx.conf
nginx -c /tmp/nginx.conf -t

echo "→ api on 127.0.0.1:${API_PORT}"
( cd apps/api && node dist/server.js ) &
API=$!

echo "→ web on 127.0.0.1:${WEB_PORT}"
( cd apps/web && npx next start --port "${WEB_PORT}" --hostname 127.0.0.1 ) &
WEB=$!

echo "→ nginx on 0.0.0.0:${PORT}"
nginx -c /tmp/nginx.conf -g 'daemon off;' &
PROXY=$!

stop() {
  # Forward the signal so a deploy is a graceful handover, not a hard kill.
  kill -TERM "$PROXY" "$API" "$WEB" 2>/dev/null || true
  wait "$PROXY" 2>/dev/null || true
  wait "$API" 2>/dev/null || true
  wait "$WEB" 2>/dev/null || true
  exit 0
}
trap stop TERM INT

echo "→ up"
while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null && kill -0 "$PROXY" 2>/dev/null; do
  sleep 2
done

echo "✖ a service exited — taking the container down so the platform restarts it"
kill -TERM "$PROXY" "$API" "$WEB" 2>/dev/null || true
exit 1

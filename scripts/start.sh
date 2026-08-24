#!/bin/sh
# Run the migrations, then both services, in one container.
#
# No process manager: if either half dies the container should die with it and
# let the platform restart the whole thing. A container still running with half
# the application missing is worse than one that restarts.
#
# Written for POSIX sh on purpose — the runtime image is Alpine, whose /bin/sh
# is BusyBox ash. `wait -n` would be the obvious way to do this and does not
# exist there, so the liveness check is an explicit poll.
set -eu

API_PORT="${API_PORT:-4000}"
PORT="${PORT:-3000}"

echo "→ migrating"
( cd apps/api && node dist/db/migrate.js up )

echo "→ api on 127.0.0.1:${API_PORT}"
( cd apps/api && node dist/server.js ) &
API=$!

echo "→ web on 0.0.0.0:${PORT}"
( cd apps/web && npx next start --port "${PORT}" --hostname 0.0.0.0 ) &
WEB=$!

stop() {
  # Forward the signal so a deploy is a graceful handover, not a hard kill.
  kill -TERM "$API" "$WEB" 2>/dev/null || true
  wait "$API" 2>/dev/null || true
  wait "$WEB" 2>/dev/null || true
  exit 0
}
trap stop TERM INT

echo "→ up"
while kill -0 "$API" 2>/dev/null && kill -0 "$WEB" 2>/dev/null; do
  sleep 2
done

echo "✖ a service exited — taking the container down so the platform restarts it"
kill -TERM "$API" "$WEB" 2>/dev/null || true
exit 1

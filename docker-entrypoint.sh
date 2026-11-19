#!/bin/sh
set -eu

# The container starts as root so bind-mounted directories created by the host
# can be adopted by the unprivileged runtime user. Application code runs as node.
if [ "$(id -u)" = "0" ]; then
  for dir in "${CONFIG_DIR:-/config}" "${STATE_DIR:-/data}" "${OUTPUT_DIR:-/strm}" "${LOG_DIR:-/logs}" "${IMPORT_DIR:-/import}" "${MEDIA_DIR:-/media}"; do
    case "$dir" in
      /config|/config/*|/data|/data/*|/strm|/strm/*|/logs|/logs/*|/import|/import/*|/media|/media/*)
        mkdir -p "$dir"
        chown node:node "$dir" 2>/dev/null || true
        ;;
      *)
        # Custom host mounts are the operator's responsibility; do not chown them.
        ;;
    esac
  done
  exec gosu node "$@"
fi

exec "$@"

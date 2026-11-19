#!/bin/sh
set -eu

# The container starts as root so bind-mounted data directories created by the
# host can be adopted by the unprivileged runtime user. All application code
# runs as node afterwards.
if [ "$(id -u)" = "0" ]; then
  data_dir="${DATA_DIR:-/data}"
  mkdir -p "$data_dir"
  chown node:node "$data_dir" 2>/dev/null || true
  exec gosu node "$@"
fi

exec "$@"

#!/bin/bash
# docker/entrypoint-worker.sh — the worker image's entrypoint (docs/workers.md).
#
# Runs as `worca` (uid 1000) under tini. For `worca worker` it checks the assignment the
# controller's backend put in the environment, makes sure the shared volumes are writable, gives
# the worker a HOME of its own on the shared volume, points the package caches at it, applies a
# corporate CA (docker/entrypoint-lib.sh), says which engine it carries, and `exec`s so SIGTERM
# reaches the worker itself (it stops its agents and exits; tini maps 143 to 0). Any other command
# (`worca worker --check`, `id -u`, a shell) runs straight through, after the CA step.
#
# Exit 78 (EX_CONFIG) names what is missing or unwritable. Nothing here is root, nothing changes
# user (the image has no way to), and the token is never printed.
set -euo pipefail

log() { printf 'worca-worker-entrypoint: %s\n' "$*" >&2; }

# shellcheck source=docker/entrypoint-lib.sh
. /usr/local/lib/worca-entrypoint-lib.sh

worker_cmd=0
if [ "${1:-}" = "worca" ] && [ "${2:-}" = "worker" ]; then
  worker_cmd=1
  for arg in "$@"; do [ "$arg" = "--check" ] && worker_cmd=0; done
fi

if [ "$worker_cmd" = 1 ]; then
  # 1. The assignment (src/worker/main.mjs reads the same variables).
  missing=""
  for v in WORCA_CONTROLLER_URL WORCA_WORKER_SCOPE WORCA_WORKER_ID; do
    [ -n "${!v:-}" ] || missing="$missing $v"
  done
  if [ -z "${WORCA_WORKER_TOKEN:-}" ] && [ -z "${WORCA_WORKER_TOKEN_FILE:-}" ]; then
    missing="$missing WORCA_WORKER_TOKEN (or WORCA_WORKER_TOKEN_FILE)"
  fi
  if [ -n "$missing" ]; then
    log "incomplete assignment: not set:${missing}"
    log "  a worker is started by the controller's backend, which sets these (docs/workers.md)"
    exit 78   # EX_CONFIG
  fi
  if [ -n "${WORCA_WORKER_TOKEN_FILE:-}" ] && [ ! -r "${WORCA_WORKER_TOKEN_FILE}" ]; then
    log "WORCA_WORKER_TOKEN_FILE=${WORCA_WORKER_TOKEN_FILE} is not readable by uid $(id -u)"
    exit 78   # EX_CONFIG
  fi

  # 2. The shared volumes, at the same paths as on the controller.
  for d in "${WORCA_HOME:-/worca}" "${WORCA_PROJECTS_ROOT:-/projects}"; do
    if [ ! -d "$d" ] || [ ! -w "$d" ]; then
      log "$d is not writable by uid $(id -u) (gid $(id -g)). The worker needs the controller's volumes at the same paths."
      log "  fsGroup is not applied on NFS volumes: export the share owned by uid 1000 or anonuid=1000"
      exit 78   # EX_CONFIG
    fi
  done

  # 3. HOME is the worker process's business (src/worker/main.mjs, the controller's rule in executor/index.mjs
  #    workerHomeDir: one folder per assignment on the shared volume, which the controller cleans up). The scope is
  #    checked here so a bad assignment exits 78 before anything starts.
  case "$WORCA_WORKER_SCOPE" in
    run:?*|chat:?*) ;;
    *) log "WORCA_WORKER_SCOPE must be run:<id> or chat:<id> (got '${WORCA_WORKER_SCOPE}')"; exit 78 ;;   # EX_CONFIG
  esac
  wh="${WORCA_HOME:-/worca}/.worca-cc"

  # 4. Package caches on the volume, so a second worker for the same install reuses what the first
  #    fetched (npx-run MCP servers, uv tools, Playwright's browser in -full).
  export npm_config_cache="$wh/worker-cache/npm" \
         UV_CACHE_DIR="$wh/worker-cache/uv" \
         PLAYWRIGHT_BROWSERS_PATH="$wh/worker-cache/playwright"
  mkdir -p "$npm_config_cache" "$UV_CACHE_DIR" "$PLAYWRIGHT_BROWSERS_PATH"
  cd "${WORCA_PROJECTS_ROOT:-/projects}"
fi

# 5. Corporate CA (shared with the controller's entrypoint).
worca_corporate_ca

# 6. Say what this worker is for (never the token, never the controller URL's credentials). Which engine binaries
#    it carries, and their versions, is the worker's own first log line: it probes them once for its hello.
if [ "$worker_cmd" = 1 ]; then
  log "engine ${WORCA_WORKER_ENGINE:-?}; scope ${WORCA_WORKER_SCOPE}; worker ${WORCA_WORKER_ID}"
fi

exec "$@"

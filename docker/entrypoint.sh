#!/bin/bash
# docker/entrypoint.sh — container entrypoint (plans/container-isolation-design.md §5.5).
#
# Runs as the `worca` user under tini. Three jobs, then `exec "$@"` so signals
# reach the server (it handles SIGTERM itself and exits 143 on the graceful path):
#   1. detect a named volume the runtime created as root (rootful Docker Engine
#      on first start) and print the one-line fix — it cannot chown as `worca`;
#   2. set up git for HTTPS GitHub remotes when GH_TOKEN is present;
#   3. say how Claude Code is (or is not) authenticated. Mock runs need nothing.
set -euo pipefail

log() { printf 'worca-entrypoint: %s\n' "$*" >&2; }

# 1. Volume ownership.
for d in "${WORCA_HOME:-/worca}" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; do
  if [ -d "$d" ] && [ ! -w "$d" ]; then
    log "$d is not writable by uid $(id -u). On rootful Docker Engine run once:"
    log "  docker compose run --rm --user root worca chown -R $(id -u):$(id -g) $d"
    exit 78   # EX_CONFIG
  fi
done
mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# 2. git over HTTPS to GitHub, when a token is given (PRs, metrics/policy branches, clone-in).
if [ -n "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  if gh auth setup-git >/dev/null 2>&1; then
    log "git credential helper: gh (GH_TOKEN)"
  else
    log "GH_TOKEN is set but 'gh auth setup-git' failed; git pushes over HTTPS will prompt"
  fi
fi
if [ -z "${GIT_AUTHOR_NAME:-}" ] && ! git config --global user.name >/dev/null 2>&1; then
  log "no git identity: set GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL in .env or agents cannot commit"
fi

# 3. Claude Code auth state (informational; never blocks).
auth="none"
if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then auth="CLAUDE_CODE_OAUTH_TOKEN"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then auth="ANTHROPIC_API_KEY"
elif [ -n "${ANTHROPIC_AUTH_TOKEN:-}" ]; then auth="ANTHROPIC_AUTH_TOKEN"
elif [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ]; then auth="Bedrock"
elif [ "${CLAUDE_CODE_USE_VERTEX:-}" = "1" ]; then auth="Vertex"
elif [ "${CLAUDE_CODE_USE_FOUNDRY:-}" = "1" ]; then auth="Foundry"
elif [ -f "/run/secrets/anthropic_api_key" ]; then auth="compose secret via apiKeyHelper"
elif [ -f "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/.credentials.json" ]; then auth="stored login"
fi
if [ "$auth" = "none" ]; then
  log "Claude Code is not logged in (mock runs still work). To log in once:"
  log "  docker compose run --rm worca claude"
else
  log "Claude Code auth: $auth"
fi

# The compose secret path: point Claude Code at the file without putting the
# key in any process environment.
if [ -f "/run/secrets/anthropic_api_key" ] && [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"
  if [ ! -f "$cfg" ]; then
    printf '{ "apiKeyHelper": "cat /run/secrets/anthropic_api_key" }\n' > "$cfg"
  elif ! grep -q apiKeyHelper "$cfg"; then
    log "$cfg exists without apiKeyHelper; add: \"apiKeyHelper\": \"cat /run/secrets/anthropic_api_key\""
  fi
fi

exec "$@"

#!/bin/bash
# docker/entrypoint.sh — container entrypoint (plans/container-isolation-design.md §5.5).
#
# Runs as the `worca` user under tini (in single-volume mode it may start as
# root to prepare the volume, see 0. below). Three jobs, then `exec "$@"` so signals
# reach the server (it handles SIGTERM itself and exits 143 on the graceful path):
#   1. detect a named volume the runtime created as root (rootful Docker Engine
#      on first start) and print the one-line fix — it cannot chown as `worca`;
#   2. report the GitHub credential mode (tokens are passed per call, never globally);
#   3. say how Claude Code is (or is not) authenticated. Mock runs need nothing.
set -euo pipefail

log() { printf 'worca-entrypoint: %s\n' "$*" >&2; }

# 0. Single-volume mode (WORCA_DATA_DIR, e.g. /data): for hosts that give a
#    service ONE volume, mounted root-owned (Railway; docs/deploy-railway.md).
#    Everything lives on it, HOME included, so Claude Code's ~/.claude.json
#    (saved by rename, which would replace a symlink) persists too. Started as
#    root, the entrypoint only prepares the volume, then re-runs itself as
#    `worca`; nothing else ever runs as root.
if [ -n "${WORCA_DATA_DIR:-}" ]; then
  data="$WORCA_DATA_DIR"
  if [ "$(id -u)" = 0 ]; then
    mkdir -p "$data/worca" "$data/projects" "$data/home/.claude"
    # First boot (a fresh root-owned volume): take the whole tree once. Later
    # boots skip the slow recursive walk, but still re-own the top-level dirs
    # (cheap) so a directory added by a newer image is never left root-owned.
    if [ "$(stat -c %U "$data")" != worca ]; then chown -R worca:worca "$data"; fi
    chown worca:worca "$data" "$data/worca" "$data/projects" "$data/home" "$data/home/.claude"
    # Agents under their own uid (src/core/agent-user.mjs), unless WORCA_AGENT_ISOLATION=0.
    # Shared with worca-agent through the worca-share group: the projects, the run checkouts
    # (runs/) and the run store (store/). Private to worca: everything else in its home (the
    # database, settings, plugin secrets), HOME with Claude Code's login, and its environment.
    if [ "${WORCA_AGENT_ISOLATION:-1}" != 0 ] && id worca-agent >/dev/null 2>&1; then
      wh="$data/worca/.worca-cc"; ah="$data/agent-home"
      mkdir -p "$wh/store" "$wh/runs" "$ah"
      chown worca:worca "$wh"
      chown worca:worca-share "$wh/store" "$wh/runs" "$data/projects"
      chown worca-agent:worca-share "$ah"
      chmod 0711 "$data" "$data/worca" "$wh"
      chmod 2770 "$wh/store" "$wh/runs" "$data/projects"
      chmod 0700 "$ah"
      # Once per volume: existing files join the boundary (new ones get it from umask + setgid).
      if [ ! -e "$wh/.agent-isolation" ]; then
        chmod -R o-rwx "$data/worca" "$data/projects" "$data/home"
        chmod 0711 "$data/worca" "$wh"
        for t in "$wh/store" "$wh/runs" "$data/projects"; do
          chgrp -R worca-share "$t"
          chmod -R g+rwX "$t"
          find "$t" -type d -exec chmod g+s {} +
        done
        touch "$wh/.agent-isolation"
        chown worca:worca "$wh/.agent-isolation"
      fi
      # The agent works in repositories worca owns, and writes objects both users share.
      printf '[safe]\n\tdirectory = *\n[core]\n\tsharedRepository = group\n' > "$ah/.gitconfig"
      chown worca-agent:worca-share "$ah/.gitconfig"
      export WORCA_AGENT_USER=worca-agent WORCA_AGENT_HOME="$ah"
      WORCA_AGENT_GID="$(getent group worca-share | cut -d: -f3)"
      export WORCA_AGENT_GID
      umask 0007
    fi
    exec setpriv --reuid=worca --regid=worca --init-groups -- "$0" "$@"
  fi
  if [ ! -w "$data" ]; then
    log "$data is not writable by uid $(id -u). Start the container as root (on Railway: RAILWAY_RUN_UID=0);"
    log "  the entrypoint prepares the volume and drops to the worca user itself."
    exit 78   # EX_CONFIG
  fi
  export HOME="$data/home" WORCA_HOME="$data/worca" WORCA_PROJECTS_ROOT="$data/projects"
  cd "$WORCA_PROJECTS_ROOT"
  if [ -n "${WORCA_AGENT_USER:-}" ]; then
    # Objects the server writes into shared repositories stay group-writable for the agent.
    git config --global core.sharedRepository group
    if sudo -n -u "$WORCA_AGENT_USER" -- true 2>/dev/null; then
      log "agents run as $WORCA_AGENT_USER; they cannot read worca's settings, database or environment"
    elif [ -n "${WORCA_ALLOWED_HOSTS:-}" ]; then
      log "cannot start commands as $WORCA_AGENT_USER (sudo refused). A hosted worca does not run agents"
      log "  as the server; fix the runtime, or set WORCA_AGENT_ISOLATION=0 to accept it explicitly."
      exit 78   # EX_CONFIG
    else
      log "cannot start commands as $WORCA_AGENT_USER (sudo refused); agents run as worca instead"
      unset WORCA_AGENT_USER WORCA_AGENT_HOME WORCA_AGENT_GID
    fi
  fi
fi

# 1. Volume ownership.
for d in "${WORCA_HOME:-/worca}" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"; do
  if [ -d "$d" ] && [ ! -w "$d" ]; then
    log "$d is not writable by uid $(id -u). On rootful Docker Engine run once:"
    log "  docker compose run --rm --user root worca chown -R $(id -u):$(id -g) $d"
    exit 78   # EX_CONFIG
  fi
done
mkdir -p "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

# 2. GitHub over HTTPS. No global credential helper: worca passes the token for each
# git/gh call's role in that call's env only (src/core/github-credentials.mjs), and
# agents never get one. A helper an older image wrote to a persistent HOME is removed.
if git config --global --get-all credential.https://github.com.helper 2>/dev/null | grep -q 'gh auth git-credential'; then
  git config --global --unset-all credential.https://github.com.helper >/dev/null 2>&1 || true
  git config --global --unset-all credential.https://gist.github.com.helper >/dev/null 2>&1 || true
  log "removed the global gh credential helper (worca now passes the token per call)"
fi
if [ -n "${WORCA_GH_READ_TOKEN:-}${WORCA_GH_WRITE_TOKEN:-}" ]; then
  log "GitHub: split read/write tokens, per call"
elif [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  log "GitHub: one token for clone, push and PRs, per call"
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
if [ -n "${WORCA_AGENT_USER:-}" ] && [ "$auth" = "stored login" ]; then
  log "agents run as $WORCA_AGENT_USER and cannot use worca's stored login;"
  log "  set CLAUDE_CODE_OAUTH_TOKEN (from 'claude setup-token') or ANTHROPIC_API_KEY instead"
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

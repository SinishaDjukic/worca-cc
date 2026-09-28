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

# The credential broker (`worca broker`, docs/credential-broker.md) is its own container
# from this same image. It needs none of the worca preparation below: only, on a host
# that gives it one root-owned volume (Railway), that volume made writable by `worca`
# before dropping to that user.
if [ "${1:-}" = "worca" ] && [ "${2:-}" = "broker" ]; then
  if [ -n "${WORCA_BROKER_DATA_DIR:-}" ] && [ "$(id -u)" = 0 ]; then
    mkdir -p "$WORCA_BROKER_DATA_DIR"
    chown worca:worca "$WORCA_BROKER_DATA_DIR"
    chmod 0700 "$WORCA_BROKER_DATA_DIR"
    exec setpriv --reuid=worca --regid=worca --init-groups -- "$0" "$@"
  fi
  exec "$@"
fi

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
      # One agent user per signed-in person (the pool, worca-agent-01..): their agents
      # can't read each other's processes. Each gets its own HOME (Claude Code's sessions).
      # Ask Worca runs as the person's agent user too, so its folders join the shared group.
      # WORCA_AGENT_POOL=0 keeps the single shared agent user.
      if [ "${WORCA_AGENT_POOL:-1}" != 0 ]; then
        homes="$data/agent-homes"
        mkdir -p "$homes" "$wh/ask" "$wh/tmp/ask"
        chown worca:worca-share "$homes"
        chmod 0711 "$homes"
        pool=""
        for u in $(getent passwd | cut -d: -f1 | grep -E '^worca-agent-[0-9]{2}$' | sort); do
          mkdir -p "$homes/$u"
          chown "$u:worca-share" "$homes/$u"
          chmod 0700 "$homes/$u"
          printf '[safe]\n\tdirectory = *\n[core]\n\tsharedRepository = group\n' > "$homes/$u/.gitconfig"
          chown "$u:worca-share" "$homes/$u/.gitconfig"
          pool="$pool${pool:+,}$u"
        done
        chown worca:worca-share "$wh/ask" "$wh/tmp" "$wh/tmp/ask"
        chmod 2770 "$wh/ask" "$wh/tmp/ask"
        chmod 0751 "$wh/tmp"
        if [ ! -e "$wh/.agent-pool" ]; then
          chgrp -R worca-share "$wh/ask" "$wh/tmp/ask"
          chmod -R g+rwX "$wh/ask" "$wh/tmp/ask"
          find "$wh/ask" "$wh/tmp/ask" -type d -exec chmod g+s {} +
          touch "$wh/.agent-pool"
          chown worca:worca "$wh/.agent-pool"
        fi
        if [ -n "$pool" ]; then export WORCA_AGENT_POOL="$pool" WORCA_AGENT_HOMES="$homes"; else unset WORCA_AGENT_POOL; fi
        # Without CAP_FSETID the kernel drops the setgid bit silently: new files then get worca's
        # own group and agent users can't read them (Ask's tool config, run checkouts).
        if [ ! -g "$wh/tmp/ask" ] || [ ! -g "$wh/runs" ]; then
          log "the shared folders did not keep their setgid bit (the container lacks CAP_FSETID?):"
          log "  agent users may not be able to read files worca writes for them. Add cap FSETID."
        fi
      else
        unset WORCA_AGENT_POOL
      fi
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
      if [ -n "${WORCA_AGENT_POOL:-}" ]; then
        first="${WORCA_AGENT_POOL%%,*}"
        if sudo -n -u "$first" -- true 2>/dev/null; then
          log "each signed-in person's agents run as their own user ($(printf '%s\n' "$WORCA_AGENT_POOL" | tr ',' '\n' | wc -l | tr -d ' ') in the pool)"
        else
          log "cannot start commands as $first (sudo refused); every person's agents share $WORCA_AGENT_USER"
          unset WORCA_AGENT_POOL WORCA_AGENT_HOMES
        fi
      fi
    elif [ -n "${WORCA_ALLOWED_HOSTS:-}" ]; then
      log "cannot start commands as $WORCA_AGENT_USER (sudo refused). A hosted worca does not run agents"
      log "  as the server; fix the runtime, or set WORCA_AGENT_ISOLATION=0 to accept it explicitly."
      exit 78   # EX_CONFIG
    else
      log "cannot start commands as $WORCA_AGENT_USER (sudo refused); agents run as worca instead"
      unset WORCA_AGENT_USER WORCA_AGENT_HOME WORCA_AGENT_GID WORCA_AGENT_POOL WORCA_AGENT_HOMES
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
if [ -n "${WORCA_GH_APP_ID:-}" ] && [ -n "${WORCA_GH_APP_KEY_FILE:-}${WORCA_GH_APP_KEY_B64:-}" ]; then
  log "GitHub: App ${WORCA_GH_APP_ID}, a short-lived token minted per call"
elif [ -n "${WORCA_GH_READ_TOKEN:-}${WORCA_GH_WRITE_TOKEN:-}" ]; then
  log "GitHub: split read/write tokens, per call"
elif [ -n "${GH_TOKEN:-}${GITHUB_TOKEN:-}" ]; then
  log "GitHub: one token for clone, push and PRs, per call"
fi
if [ -z "${GIT_AUTHOR_NAME:-}" ] && ! git config --global user.name >/dev/null 2>&1; then
  log "no git identity: set GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL in .env or agents cannot commit"
fi

# 3. Claude Code auth state (informational; never blocks).
auth="none"
if [ -n "${WORCA_BROKER_URL:-}" ]; then auth="credential broker (${WORCA_BROKER_URL}); worca holds no model key"
elif [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then auth="CLAUDE_CODE_OAUTH_TOKEN"
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

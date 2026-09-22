#!/bin/sh
# Worca container entrypoint — see plans/container-isolation-design.md §5.5.
# Runs as the unprivileged `worca` user: it can only detect problems, not chown.
set -e

for d in /worca "$HOME/.claude"; do
  if [ ! -w "$d" ]; then
    echo "worca: $d is not writable by uid $(id -u). Fix once with:" >&2
    echo "  docker compose run --rm --user root worca chown -R $(id -u):$(id -g) $d" >&2
  fi
done

# Claude Code stores its account file next to ~/.claude; keep it inside the volume.
if [ ! -e "$HOME/.claude.json" ] && [ -w "$HOME/.claude" ]; then
  [ -e "$HOME/.claude/.claude.json" ] || echo '{}' > "$HOME/.claude/.claude.json"
  ln -s "$HOME/.claude/.claude.json" "$HOME/.claude.json"
fi

if [ -n "$GH_TOKEN" ]; then gh auth setup-git >/dev/null 2>&1 || true; fi

if [ -z "$ANTHROPIC_API_KEY$CLAUDE_CODE_OAUTH_TOKEN$CLAUDE_CODE_USE_BEDROCK$CLAUDE_CODE_USE_VERTEX$CLAUDE_CODE_USE_FOUNDRY" ] \
   && [ ! -s "$HOME/.claude/.credentials.json" ]; then
  echo "worca: Claude Code is not logged in. Mock runs work; for real runs:" >&2
  echo "  docker compose run --rm worca claude    (then /login)" >&2
fi

exec "$@"

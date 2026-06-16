#!/usr/bin/env bash
# teardown-runs.sh — stop all worca-bench run processes and their descendants.
#
# Kills the process TREES rooted at a worca-bench run (the runner CLI, the
# run_pipeline subprocess, and the agent / claude / git children they spawned).
# It targets only descendants of a worca-bench run, so an interactive `claude`
# session and the dashboard server (`worca-bench-ui.js`) are left untouched.
#
# Usage: scripts/teardown-runs.sh [--dry-run]
set -euo pipefail

PATTERN='worca_bench\.cli run|worca\.scripts\.run_pipeline'
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

# Emit a pid and all of its descendants (depth-first).
descendants() {
  local pid=$1
  echo "$pid"
  local child
  for child in $(pgrep -P "$pid" 2>/dev/null || true); do
    descendants "$child"
  done
}

roots=$(pgrep -f "$PATTERN" 2>/dev/null || true)
if [ -z "$roots" ]; then
  echo "No worca-bench run processes found."
  exit 0
fi

all=$(for r in $roots; do descendants "$r"; done | sort -un)
echo "Run process trees:"
ps -o pid,command -p $(echo "$all" | tr '\n' ',' | sed 's/,$//') 2>/dev/null || true

if [ "$DRY" = 1 ]; then
  echo "(dry-run: nothing killed)"
  exit 0
fi

# Graceful, then force.
for p in $all; do kill -TERM "$p" 2>/dev/null || true; done
sleep 2
for p in $all; do kill -KILL "$p" 2>/dev/null || true; done
# Sweep stragglers that orphaned after their parent died.
pkill -KILL -f "$PATTERN" 2>/dev/null || true
sleep 1

remaining=$(pgrep -f "$PATTERN" 2>/dev/null || true)
if [ -n "$remaining" ]; then
  echo "WARNING: still running: $remaining" >&2
  exit 1
fi
echo "All worca-bench run processes stopped."
echo "(Note: a fully-orphaned agent/claude process — parent already gone — is"
echo " not a descendant of any run and will wind down on its own.)"

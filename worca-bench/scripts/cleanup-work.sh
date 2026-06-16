#!/usr/bin/env bash
# cleanup-work.sh — remove transient per-rep work trees from a worca-bench
# results dir. The `work/` checkouts (one git clone per rep) are large and safe
# to delete — the runner recreates them on the next run. Killed/interrupted runs
# leave them behind, where their stale status.json can also show up as phantom
# "active" runs in the dashboard.
#
# Usage:
#   scripts/cleanup-work.sh <results-dir>            # remove work/ only
#   scripts/cleanup-work.sh <results-dir> --runs     # also remove archived runs/
#   scripts/cleanup-work.sh <results-dir> --results  # also clear results.jsonl (DESTRUCTIVE)
set -euo pipefail

DIR=${1:-}
if [ -z "$DIR" ] || [ ! -d "$DIR" ]; then
  echo "usage: cleanup-work.sh <results-dir> [--runs] [--results]" >&2
  exit 2
fi
DIR=${DIR%/}
shift || true

# Safety: refuse anything that does not look like a worca-bench results dir.
case "$DIR" in
  "" | "/" | "$HOME")
    echo "refusing to operate on '$DIR'" >&2; exit 2 ;;
esac
if [ ! -d "$DIR/work" ] && [ ! -d "$DIR/profiles" ] && [ ! -f "$DIR/results.jsonl" ]; then
  echo "refusing: '$DIR' has no work/ | profiles/ | results.jsonl (not a results dir)" >&2
  exit 2
fi

if [ -d "$DIR/work" ]; then
  rm -rf "$DIR/work"
  echo "removed $DIR/work"
else
  echo "no $DIR/work to remove"
fi

for arg in "$@"; do
  case "$arg" in
    --runs)
      [ -d "$DIR/runs" ] && rm -rf "$DIR/runs" && echo "removed $DIR/runs" ;;
    --results)
      [ -f "$DIR/results.jsonl" ] && rm -f "$DIR/results.jsonl" && echo "cleared $DIR/results.jsonl" ;;
    *) echo "ignoring unknown arg: $arg" >&2 ;;
  esac
done
echo "done."

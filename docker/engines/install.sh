#!/usr/bin/env bash
# docker/engines/install.sh <engine|all> — install one engine CLI (or every one) into the worker
# image's `engines` stage (docker/Dockerfile), at the version the build args pin:
#   claude    npm @anthropic-ai/claude-code   CLAUDE_CODE_VERSION (docker/CLAUDE_CODE_VERSION)
#   codex     npm @openai/codex               CODEX_VERSION
#   copilot   npm @github/copilot             COPILOT_CLI_VERSION
#   cursor    https://cursor.com/install      CURSOR_AGENT_VERSION (informational, see engines.env)
#   gemini    npm @google/gemini-cli          GEMINI_CLI_VERSION
#   qwen      npm @qwen-code/qwen-code        QWEN_CODE_VERSION
#   goose     GitHub release tarball          GOOSE_VERSION, GOOSE_SHA256_AMD64 / _ARM64
#   opencode  npm opencode-ai (1.x)           OPENCODE_VERSION
# The ids are src/core/engines/cli-specs.mjs's ENGINE_CLIS keys, the binaries are
# src/worker/capabilities.mjs's DEFAULT_BINS. After each install the binary's `--version` runs:
# a release that does not execute on this architecture fails the build, not the first run.
# Exit 2 for an unknown id, 1 for an empty pin or a failed install. Runs as root at build time.
set -euo pipefail

say() { printf 'engines/install.sh: %s\n' "$*" >&2; }
die() { say "$*"; exit 1; }

# npm_engine <engine> <package> <version> <binary>: a global npm install at an exact version.
npm_engine() {
  local engine="$1" pkg="$2" ver="$3" bin="$4"
  [ -n "$ver" ] || die "$engine: no version pinned (set its build arg from docker/engines.env)"
  say "$engine: npm install -g $pkg@$ver"
  npm install -g "$pkg@$ver"
  npm cache clean --force
  check_bin "$engine" "$bin"
}

# check_bin <engine> <binary>: the binary is on PATH and runs on this architecture.
check_bin() {
  local engine="$1" bin="$2" out
  command -v "$bin" >/dev/null 2>&1 || die "$engine: $bin is not on PATH after the install"
  out="$("$bin" --version 2>&1)" || die "$engine: $bin --version failed on $(uname -m): $out"
  say "$engine: $bin --version -> ${out%%$'\n'*}"
}

install_goose() {
  local ver="${GOOSE_VERSION:-}" arch sha target url tmp
  [ -n "$ver" ] || die "goose: GOOSE_VERSION is not pinned (docker/engines.env)"
  case "$(dpkg --print-architecture)" in
    amd64) arch=x86_64;  sha="${GOOSE_SHA256_AMD64:-}" ;;
    arm64) arch=aarch64; sha="${GOOSE_SHA256_ARM64:-}" ;;
    *) die "goose: no release tarball for $(dpkg --print-architecture)" ;;
  esac
  target="goose-${arch}-unknown-linux-gnu.tar.bz2"
  url="https://github.com/aaif-goose/goose/releases/download/v${ver}/${target}"
  tmp="$(mktemp -d)"
  say "goose: downloading $url"
  curl -fsSL --retry 3 -o "$tmp/$target" "$url"
  if [ -n "$sha" ]; then
    echo "$sha  $tmp/$target" | sha256sum -c - >/dev/null || die "goose: $target does not match GOOSE_SHA256_$(echo "$arch" | tr a-z A-Z) (docker/engines.env)"
    say "goose: checksum verified"
  else
    say "WARNING: goose: no sha256 pinned for $arch (GOOSE_SHA256_AMD64/ARM64 in docker/engines.env is empty); installing $target UNVERIFIED"
  fi
  mkdir -p /opt/goose
  tar -xjf "$tmp/$target" -C /opt/goose --no-same-owner
  rm -rf "$tmp"
  [ -x /opt/goose/goose ] || die "goose: the tarball holds no goose binary (its layout changed?)"
  ln -sfn /opt/goose/goose /usr/local/bin/goose
  check_bin goose goose
}

# Cursor's installer has no prefix switch: it writes under $HOME/.local. Run it with HOME pointed
# at /opt/cursor-agent so the install lands in the image, world-readable, then link the binary.
install_cursor() {
  local ver="${CURSOR_AGENT_VERSION:-}" got
  say "cursor: https://cursor.com/install (pinned: ${ver:-none; the script decides})"
  mkdir -p /opt/cursor-agent
  curl -fsSL --retry 3 https://cursor.com/install -o /tmp/cursor-install.sh
  HOME=/opt/cursor-agent NO_COLOR=1 bash /tmp/cursor-install.sh
  rm -f /tmp/cursor-install.sh
  rm -rf /opt/cursor-agent/.cursor
  chmod -R a+rX /opt/cursor-agent
  [ -e /opt/cursor-agent/.local/bin/cursor-agent ] || die "cursor: the installer left no .local/bin/cursor-agent under /opt/cursor-agent"
  ln -sfn /opt/cursor-agent/.local/bin/cursor-agent /usr/local/bin/cursor-agent
  check_bin cursor cursor-agent
  if [ -n "$ver" ]; then
    # What the linked binary reports, not a directory listing (the installer may keep more than one version around).
    got="$(cursor-agent --version 2>/dev/null | head -n 1 | tr -d '\r' || true)"
    case "$got" in *"$ver"*) ;; *) say "WARNING: cursor: the installer shipped ${got:-?}, CURSOR_AGENT_VERSION says $ver (bump docker/engines.env)" ;; esac
  fi
}

install_one() {
  case "$1" in
    claude)   [ -n "${CLAUDE_CODE_VERSION:-}" ] || die "claude: CLAUDE_CODE_VERSION build arg is required"
              npm_engine claude @anthropic-ai/claude-code "${CLAUDE_CODE_VERSION}" claude ;;
    codex)    npm_engine codex @openai/codex "${CODEX_VERSION:-}" codex ;;
    copilot)  npm_engine copilot @github/copilot "${COPILOT_CLI_VERSION:-}" copilot ;;
    cursor)   install_cursor ;;
    gemini)   npm_engine gemini @google/gemini-cli "${GEMINI_CLI_VERSION:-}" gemini ;;
    qwen)     npm_engine qwen @qwen-code/qwen-code "${QWEN_CODE_VERSION:-}" qwen ;;
    goose)    install_goose ;;
    opencode) case "${OPENCODE_VERSION:-}" in
                1.*) ;;
                *) die "opencode: OPENCODE_VERSION must be 1.x (got '${OPENCODE_VERSION:-}'); worca refuses OpenCode 2" ;;
              esac
              npm_engine opencode opencode-ai "${OPENCODE_VERSION}" opencode ;;
    all)      for e in claude codex copilot cursor gemini qwen goose opencode; do install_one "$e"; done ;;
    *)        say "unknown engine '$1' (claude codex copilot cursor gemini qwen goose opencode, or all)"; exit 2 ;;
  esac
}

[ $# -eq 1 ] || { say "usage: install.sh <engine|all>"; exit 2; }
install_one "$1"
say "done: $1"

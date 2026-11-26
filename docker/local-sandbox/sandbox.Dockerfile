# docker/local-sandbox/sandbox.Dockerfile — the image of a "Local sandbox (Docker)" run (docs/local-sandbox.md).
# The agent's half of docker/Dockerfile, like docker/e2b/e2b.Dockerfile: the pinned Claude Code
# (docker/CLAUDE_CODE_VERSION), the codex, copilot and cursor-agent CLIs (docker/e2b/engine-clis.json), git, node,
# python and common build toolchains. No worca server: that stays on the developer's machine.
#
# Worca builds it on this machine the first time a run needs it (src/core/exec-env/backends/docker-image.mjs fills the
# placeholders and pipes the result to `docker build -`), so no COPY: the build has no context.
#
# Differences from the E2B template:
# - Worca creates the sandbox user here (E2B's builder does that for its template).
# - No sudo, and no passwordless sudo. A container shares the host's kernel: an agent that can become root in it is
#   one kernel bug away from the host. Tools come from the project environment spec instead.
# - A second account, `worca` (uid 990), runs the container's watchdog and the network relay, so the agents (uid 1000)
#   can neither stop nor extend them.
# Pinned by digest (the multi-arch index of node:22-bookworm), as the E2B template is.
FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq less procps ripgrep tar unzip xz-utils \
      python3 python3-pip python3-venv pipx build-essential pkg-config \
 && { apt-get purge -y --auto-remove sudo 2>/dev/null || true; } \
 && ! command -v sudo \
 && rm -rf /var/lib/apt/lists/*

# Claude Code, pinned; its updater is off (a newer CLI is a new image).
RUN npm install -g "@anthropic-ai/claude-code@__CLAUDE_CODE_VERSION__" \
 && npm cache clean --force

# The other engines' CLIs, pinned (docker/e2b/engine-clis.json).
RUN npm install -g "@openai/codex@__CODEX_VERSION__" "@github/copilot@__COPILOT_VERSION__" \
 && npm cache clean --force \
 && codex --version \
 && copilot --version --no-auto-update

# cursor-agent from Cursor's own download, at the pinned build, for this machine's arch.
RUN arch="$(uname -m)"; case "$arch" in x86_64|amd64) arch=x64;; aarch64|arm64) arch=arm64;; *) echo "unsupported arch $arch" >&2; exit 1;; esac \
 && mkdir -p /opt/cursor-agent \
 && curl -fsSL "https://downloads.cursor.com/lab/__CURSOR_AGENT_VERSION__/linux/${arch}/agent-cli-package.tar.gz" \
    | tar --strip-components=1 -xzf - -C /opt/cursor-agent \
 && ln -s /opt/cursor-agent/cursor-agent /usr/local/bin/cursor-agent \
 && cursor-agent --version

# graphify, pinned: worca builds the run worktree's code graph in the sandbox after the clone.
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install "graphifyy==0.9.32" \
 && graphify --version

# The sandbox user: the base image's `node` (uid 1000) renamed to `user`, home /home/user (worca's sandbox HOME).
# `worca` (uid 990, no login, no home) owns /run/worca: the watchdog's deadline and the network relay live there.
# No setuid program is needed by anything worca runs; the container also starts with no-new-privileges.
RUN usermod -l user -d /home/user -m node \
 && groupmod -n user node \
 && groupadd --system --gid 990 worca \
 && useradd --system --uid 990 --gid 990 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin worca \
 && install -d -o worca -g worca -m 0755 /run/worca \
 && git config --system user.name "worca agent" \
 && git config --system user.email "agent@worca.invalid" \
 && git config --system --add safe.directory '*'

ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    TZ=UTC

USER user
WORKDIR /home/user

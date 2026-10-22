# docker/e2b/e2b.Dockerfile — the E2B sandbox template for worca's e2b execution
# environment (plans/e2b-execution-design.md §13). The agent's half of docker/Dockerfile:
# the same pinned Claude Code (docker/CLAUDE_CODE_VERSION), plus git, node, python and
# common build toolchains — no worca server (that stays on the PC).
#
#   E2B_API_KEY=… E2B_API_URL=http://localhost:3000 npm run e2b:build
#
# build.mjs replaces __CLAUDE_CODE_VERSION__ (E2B's converter turns ARG into a persistent ENV and
# takes no build args). Single stage: Template.fromDockerfile refuses multi-stage files and
# COPY --from. No SHELL line: the converter ignores it (with a warning), so RUN lines stay POSIX sh.
# Pinned by digest (the multi-arch index of node:22-bookworm), so a rebuild gets the same base on amd64 and arm64.
# To move it: read the index digest of the new tag and replace both.
FROM node:22-bookworm@sha256:0e5f906573693feaa1e21057ebdcfdb5bd5021f050b2dc7c9deceb629c7da2a8

# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq less procps ripgrep sudo tar unzip xz-utils \
      python3 python3-pip python3-venv pipx build-essential pkg-config \
 && rm -rf /var/lib/apt/lists/*

# Claude Code, pinned; its updater is off (a newer CLI is a new template build).
RUN npm install -g "@anthropic-ai/claude-code@__CLAUDE_CODE_VERSION__" \
 && npm cache clean --force

# graphify, pinned (PyPI `graphifyy`): worca builds the run worktree's code graph in the sandbox after the clone
# (run-harness _buildSandboxGraph), so the host builds and uploads none. On PATH for the agents too.
RUN PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install "graphifyy==0.9.32" \
 && graphify --version

# E2B's convention: user `user`, home /home/user (worca's sandbox HOME; ~/.claude lives there).
# Verified on the self-hosted E2B (SDK 2.56.0, template id mtv76pdje3tjtytktte0): E2B's builder
# creates `user` itself, so renaming the base image's `node` user failed ("user 'user' already
# exists", exit 9). The built sandbox runs as `user` with HOME /home/user, Claude Code at the pinned
# version, git, node 22, python 3.11 and the passwordless sudo below.
# Agents may install packages in their own VM, hence passwordless sudo.
RUN printf 'user ALL=(ALL) NOPASSWD: ALL\n' > /etc/sudoers.d/user \
 && chmod 0440 /etc/sudoers.d/user \
 && git config --system user.name "worca agent" \
 && git config --system user.email "agent@worca.invalid" \
 && git config --system --add safe.directory '*'

ENV DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    TZ=UTC

USER user
WORKDIR /home/user

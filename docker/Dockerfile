# docker/Dockerfile — the Worca container image (plans/container-isolation-design.md §5).
#
# The image installs the SAME tarball `npm publish` ships (`npm pack` output),
# never a COPY of the source tree, so one Dockerfile serves PR builds and
# releases and the container can never drift from the npm package.
#
#   npm run docker:build                     # packs + builds ghcr.io/sinishadjukic/worca:dev
#   npm run docker:build -- --variant full   # the -full variant (python, build tools, chromium)
#
# Build args:
#   WORCA_TARBALL        path (relative to the build context) of worca-app-<v>.tgz  [required]
#   CLAUDE_CODE_VERSION  the @anthropic-ai/claude-code version to pin              [required]
#   VARIANT              slim | full                                               [slim]
#   NODE_IMAGE           base image                                                [node:22-bookworm-slim]
#   APT_REFRESH          any string; a new value rebuilds the OS layer (CI: Debian publish stamps)

ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}

ARG WORCA_TARBALL
ARG CLAUDE_CODE_VERSION
ARG VARIANT=slim
# Changes in CI whenever Debian publishes, so the cached OS layer picks up its fixes.
ARG APT_REFRESH=

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# OS layer: git is mandatory (worktrees); gh backs one-click PRs and the GitHub
# Issues source; tini reaps orphaned claude/MCP children; procps gives agents
# `ps` for the host guard's "look the PID up first" rule. The upgrade pulls in
# Debian security fixes the node base image has not picked up yet (it lags; the
# Trivy scan fails on fixed HIGH CVEs such as libexpat1's).
# hadolint ignore=DL3005,DL3008
RUN echo "apt refresh: ${APT_REFRESH:-none}" \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git gnupg jq less openssh-client procps ripgrep sudo tini \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# -full: python, native build tools and the OS libraries Playwright's Chromium
# needs (the manual web-UI-testing agent). The browser itself is fetched on
# first use by the Playwright MCP into the claude-config volume.
# hadolint ignore=DL3008
RUN if [ "${VARIANT}" = "full" ]; then \
      apt-get update \
   && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv pipx build-essential pkg-config \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
        libcairo2 libatspi2.0-0 libx11-xcb1 libxcursor1 libgtk-3-0 fonts-liberation \
   && rm -rf /var/lib/apt/lists/*; \
    fi

# Claude Code, pinned. The image is immutable, so the CLI's own updater is off
# (DISABLE_AUTOUPDATER below); a newer CLI is a newer image tag.
RUN test -n "${CLAUDE_CODE_VERSION}" || { echo "CLAUDE_CODE_VERSION build arg is required" >&2; exit 1; } \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force

# Worca, from the packed tarball.
COPY ${WORCA_TARBALL} /tmp/worca.tgz
# The egress overlay's sidecar runs the policy proxy from the package as one standalone
# file (docker/compose.egress.yml; src/core/egress-proxy.mjs imports node: modules only).
RUN npm install -g /tmp/worca.tgz \
 && rm /tmp/worca.tgz \
 && npm cache clean --force \
 && install -m 755 "$(npm root -g)/@worca/app/src/core/egress-proxy.mjs" /usr/local/lib/worca-egress-proxy.mjs

# Non-root user. uid/gid 1000 matches the default first user on Linux and in a
# WSL2 distro, so bind-mounted project files keep their owner. The node base
# image already owns 1000 as `node`; rename it rather than add a second user.
RUN usermod -l worca -d /home/worca -m node \
 && groupmod -n worca node \
 && mkdir -p /worca /projects /home/worca/.claude \
 && chown -R worca:worca /worca /projects /home/worca \
 && chmod 0777 /worca /projects /home/worca /home/worca/.claude

# Agents under their own uid (src/core/agent-user.mjs): `worca-agent` shares the
# `worca-share` group with the server (projects, run checkouts, the run store) but
# cannot read worca's settings, database or environment. The only sudo rule lets
# `worca` start commands as `worca-agent`, never as root. The entrypoint turns this
# on for single-volume hosts (WORCA_DATA_DIR); a bind-mount compose setup keeps one
# uid, so the files agents write on the host keep your uid.
#
# The agent POOL (credential broker, docs/credential-broker.md): worca-agent-01..16, one per
# signed-in person, so one person's agents cannot read another's processes (and the broker
# token in their environment). Same group, same rule: sudo to these users only, never root.
RUN groupadd -g 1001 worca-share \
 && useradd -l -u 1001 -g worca-share -M -d /nonexistent -s /bin/bash worca-agent \
 && for i in $(seq -w 1 16); do useradd -l -u "11$i" -g worca-share -M -d /nonexistent -s /bin/bash "worca-agent-$i"; done \
 && usermod -aG worca-share worca \
 && printf '%s\n' \
      'Defaults:worca !lecture, !syslog, !secure_path, umask=0007, umask_override' \
      "Runas_Alias WORCA_AGENTS = worca-agent, $(seq -w 1 16 | sed 's/^/worca-agent-/' | paste -sd, - | sed 's/,/, /g')" \
      'worca ALL=(WORCA_AGENTS) NOPASSWD:SETENV: ALL' \
      > /etc/sudoers.d/worca-agent \
 && chmod 0440 /etc/sudoers.d/worca-agent \
 && visudo -cf /etc/sudoers.d/worca-agent
# The volume mount points exist in the image and are world-writable: a fresh
# named volume copies mode and owner on first mount (Docker and Podman alike),
# so the box works whether it runs as the image's uid 1000 or as the host
# user's uid on Linux Engine (compose `user: ${WORCA_UID}:${WORCA_GID}`). The
# entrypoint's "not writable" branch only fires for a volume made by hand.

COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/worca-entrypoint

# HOME is pinned: a uid with no passwd entry (a Linux host user's id passed
# through `user:`) would otherwise get HOME=/ and Claude Code could not write
# its config.
ENV HOME=/home/worca \
    WORCA_HOST=0.0.0.0 \
    PORT=4317 \
    WORCA_HOME=/worca \
    WORCA_PROJECTS_ROOT=/projects \
    WORCA_NO_NATIVE_DIALOG=1 \
    WORCA_CONTAINER=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    TZ=UTC

LABEL org.opencontainers.image.title="Worca" \
      org.opencontainers.image.description="Worca — deterministic multi-agent pipeline that drives Claude Code, in a container" \
      org.opencontainers.image.source="https://github.com/SinishaDjukic/worca-cc" \
      org.opencontainers.image.licenses="MIT" \
      dev.worca.claude-code.version="${CLAUDE_CODE_VERSION}" \
      dev.worca.variant="${VARIANT}"

# hadolint ignore=DL3066
USER worca
WORKDIR /projects
VOLUME ["/worca", "/home/worca/.claude"]
EXPOSE 4317

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["curl", "-fsS", "-H", "Host: localhost", "http://127.0.0.1:4317/api/health"]

# -s: also work as a subreaper when the runtime puts its own init at PID 1
# (compose `init: true`, `docker run --init`) instead of warning about it.
# No -g: tini signals only `worca ui` (the entrypoint execs it), which forwards the stop to the
# server; the server pauses its runs (drain) and stops their agents itself. Signalling the whole
# group would kill the agents first and turn a clean pause into a failed step.
# -e 143: a stop is a clean exit. The server exits 143 after a SIGTERM (the shell convention, kept
# for `worca ui` outside a container), and tini passes that on as the container's exit code;
# Railway never marks a deployment stopped whose container exits non-zero after deploymentStop
# (the instance stays RUNNING, whatever the restart policy). Remapped to 0, it stops in seconds.
ENTRYPOINT ["tini", "-s", "-e", "143", "--", "worca-entrypoint"]
CMD ["worca", "ui"]

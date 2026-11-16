# docker/Dockerfile — the Worca container images (plans/container-isolation-design.md §5).
#
# One multi-stage file, two targets:
#   controller  (the LAST stage, so an untargeted build still yields it: CI's PR job and Railway
#               build without --target) — the Worca server: `worca ui`, a pinned Claude Code, the
#               agent users and the sudo rule that lets worca start agents as them.
#   worker      `worca worker` in its own container (docs/workers.md): the engine CLIs for ENGINE
#               (one engine id, or `all`), no sudo, no agent users, no database, no HEALTHCHECK.
#
# Both install the SAME tarball `npm publish` ships (`npm pack` output), never a
# COPY of the source tree, so one Dockerfile serves PR builds and releases and
# the containers can never drift from the npm package.
#
#   npm run docker:build                                   # packs + builds ghcr.io/sinishadjukic/worca:dev
#   npm run docker:build -- --variant full                 # the -full variant (python, build tools, chromium)
#   npm run docker:build -- --target worker --engine codex # ghcr.io/sinishadjukic/worca-worker:dev-codex
#
# Stages:  os ─┬─ pkg ──────────────────────┐
#              ├─ engines (ENGINE) ── worker (COPY --from=pkg)
#              └─ controller (COPY --from=pkg)
#
# Build args:
#   WORCA_TARBALL        path (relative to the build context) of worca-app-<v>.tgz  [required]
#   CLAUDE_CODE_VERSION  the @anthropic-ai/claude-code version to pin              [required]
#   VARIANT              slim | full                                               [slim]
#   ENGINE               worker only: claude | codex | copilot | cursor | gemini | qwen | goose |
#                        opencode | all                                            [claude]
#   <ENGINE>_VERSION …   the other engines' pins (docker/engines.env; tools/docker-build.mjs
#                        passes every line of it as a build arg)
#   APT_REFRESH          any string; a new value rebuilds the OS layer (CI: Debian publish stamps)

# The base image is pinned by its multi-arch index digest, so a re-pushed tag cannot change what
# the build starts from. A literal FROM (no build arg) so Dependabot can propose the bumps.
# Its Node major is .nvmrc's, like every single-version CI job (test/supply-chain.test.mjs).
FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS os

ARG VARIANT=slim
ARG RAILWAY_CLI_VERSION=
ARG UV_VERSION=
# Changes in CI whenever Debian publishes, so the cached OS layer picks up its fixes.
ARG APT_REFRESH=

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# OS layer: git is mandatory (worktrees); gh backs one-click PRs and the GitHub
# Issues source; tini reaps orphaned claude/MCP children; procps gives agents
# `ps` for the host guard's "look the PID up first" rule; bzip2 unpacks the goose
# release tarball (docker/engines/install.sh). No sudo here: only the controller
# needs it (its agent users), a worker must not have it at all. The upgrade pulls
# in Debian security fixes the node base image has not picked up yet (it lags; the
# Trivy scan fails on fixed HIGH CVEs such as libexpat1's).
# hadolint ignore=DL3005,DL3008
RUN echo "apt refresh: ${APT_REFRESH:-none}" \
 && apt-get update \
 && apt-get upgrade -y --no-install-recommends \
 && apt-get install -y --no-install-recommends \
      bzip2 ca-certificates curl git gnupg jq less openssh-client procps ripgrep tini \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

# -full: python (plus pipx and uv), native build tools and the OS libraries Playwright's
# Chromium needs (the manual web-UI-testing agent; Playwright fetches its own browser on
# first use into the claude-config volume). Plus Debian's chromium for the cards
# that drive a browser themselves: the C4 render's JPEG/PNG export, the deck PDF
# and the deck audit. They find it on PATH as `chromium`. And the Railway CLI, for
# agents that deploy (docs/deploy-railway.md).
# Chrome's sandbox needs user namespaces, which Docker's default seccomp profile
# refuses to an unprivileged user ("No usable sandbox!"), and /dev/shm is 64 MB in
# a container. Debian's /usr/bin/chromium wrapper sources /etc/chromium.d/*, so
# one file there gives every caller --no-sandbox and --disable-dev-shm-usage —
# the container is the isolation boundary, as Playwright's own Docker image assumes.
# hadolint ignore=DL3008,DL3013,SC2016
RUN if [ "${VARIANT}" = "full" ]; then \
      { test -n "${UV_VERSION}" || { echo "UV_VERSION build arg is required for VARIANT=full (docker/engines.env)" >&2; exit 1; }; } \
   && { test -n "${RAILWAY_CLI_VERSION}" || { echo "RAILWAY_CLI_VERSION build arg is required for VARIANT=full (docker/engines.env)" >&2; exit 1; }; } \
   && apt-get update \
   && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv pipx build-essential pkg-config \
        libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 \
        libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
        libcairo2 libatspi2.0-0 libx11-xcb1 libxcursor1 libgtk-3-0 fonts-liberation \
        chromium \
   && printf '%s\n' 'export CHROMIUM_FLAGS="$CHROMIUM_FLAGS --no-sandbox --disable-dev-shm-usage"' \
        > /etc/chromium.d/worca-container \
   && rm -rf /var/lib/apt/lists/* \
   && pip3 install --no-cache-dir --break-system-packages "uv==${UV_VERSION}" \
   && npm install -g "@railway/cli@${RAILWAY_CLI_VERSION}" \
   && npm cache clean --force; \
    fi

# Non-root user. uid/gid 1000 matches the default first user on Linux and in a
# WSL2 distro, so bind-mounted project files keep their owner. The node base
# image already owns 1000 as `node`; rename it rather than add a second user.
# The volume mount points exist in the image and are world-writable: a fresh
# named volume copies mode and owner on first mount (Docker and Podman alike),
# so the box works whether it runs as the image's uid 1000 or as the host
# user's uid on Linux Engine (compose `user: ${WORCA_UID}:${WORCA_GID}`). The
# entrypoint's "not writable" branch only fires for a volume made by hand.
RUN usermod -l worca -d /home/worca -m node \
 && groupmod -n worca node \
 && mkdir -p /worca /projects /home/worca/.claude \
 && chown -R worca:worca /worca /projects /home/worca \
 && chmod 0777 /worca /projects /home/worca /home/worca/.claude

# The corporate-CA bundle step, shared by both entrypoints.
COPY --chmod=644 docker/entrypoint-lib.sh /usr/local/lib/worca-entrypoint-lib.sh

# The CLIs' own updaters are off: the images are immutable, a newer CLI is a newer image tag.
# HOME is set in the two final stages, after every root-run npm install (else root's npm cache
# and logs would land in /home/worca).
ENV WORCA_HOME=/worca \
    WORCA_PROJECTS_ROOT=/projects \
    WORCA_NO_NATIVE_DIALOG=1 \
    WORCA_CONTAINER=1 \
    DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 \
    TZ=UTC

LABEL org.opencontainers.image.source="https://github.com/SinishaDjukic/worca-cc" \
      org.opencontainers.image.licenses="MIT" \
      dev.worca.variant="${VARIANT}"


# ---------------------------------------------------------------------------------------------
# pkg: Worca itself, from the packed tarball, at the versions its npm-shrinkwrap.json locks.
# `npm install -g` of a local tarball ignores the shrinkwrap (npm only honours it for a registry
# install), so the package is unpacked where a global install puts it and `npm ci` installs
# exactly the lockfile. Two optional dependencies run install scripts: node-pty (native build or
# prebuild) and ffmpeg-static (downloads its binary); see docs/docker.md.
# Built once, copied into both targets.
FROM os AS pkg

ARG WORCA_TARBALL

# COPY, not ADD (DL3010): ADD would unpack the tarball under its `package/` folder in a layer of
# its own; the RUN below unpacks it in place and installs it in the same layer.
# hadolint ignore=DL3010
COPY ${WORCA_TARBALL} /tmp/worca.tgz
RUN app="$(npm root -g)/@worca/app" \
 && mkdir -p "${app}" \
 && tar -xzf /tmp/worca.tgz -C "${app}" --strip-components=1 --no-same-owner \
 && npm ci --prefix "${app}" --omit=dev --no-audit --no-fund \
 && rm /tmp/worca.tgz \
 && npm cache clean --force


# ---------------------------------------------------------------------------------------------
# engines: the engine CLIs a worker runs, pinned (docker/engines.env; Claude Code's pin is
# docker/CLAUDE_CODE_VERSION). `all` installs every engine Worca knows. The install script
# runs each binary's --version, so an engine whose release does not run on this
# architecture fails the build rather than the first run.
FROM os AS engines

ARG ENGINE=claude
ARG CLAUDE_CODE_VERSION
ARG CODEX_VERSION=
ARG GEMINI_CLI_VERSION=
ARG QWEN_CODE_VERSION=
ARG COPILOT_CLI_VERSION=
ARG OPENCODE_VERSION=
ARG GOOSE_VERSION=
ARG GOOSE_SHA256_AMD64=
ARG GOOSE_SHA256_ARM64=
ARG CURSOR_AGENT_VERSION=

COPY --chmod=755 docker/engines/install.sh /usr/local/lib/worca-engines-install.sh
RUN /usr/local/lib/worca-engines-install.sh "${ENGINE}"


# ---------------------------------------------------------------------------------------------
# worker: `worca worker` (src/worker/main.mjs). It connects outbound to the controller, runs the
# engine CLIs it was built with, and never opens the database (WORCA_NO_DB). No sudo, no agent
# users, no sudoers file: one worker serves one run or one chat, the container is the boundary.
# /worca and /projects are mounted at the same paths as on the controller (docs/workers.md).
FROM engines AS worker

ARG ENGINE=claude
ARG CLAUDE_CODE_VERSION
ARG VARIANT=slim

COPY --from=pkg /usr/local/lib/node_modules/@worca/app /usr/local/lib/node_modules/@worca/app
RUN app="$(npm root -g)/@worca/app" \
 && ln -s "${app}/src/cli/worca-cc.mjs" /usr/local/bin/worca

COPY --chmod=755 docker/entrypoint-worker.sh /usr/local/bin/worca-worker-entrypoint

# HOME is pinned: a uid with no passwd entry (a Linux host user's id passed through `user:`)
# would otherwise get HOME=/. The entrypoint moves it per assignment for `worca worker`.
ENV HOME=/home/worca \
    WORCA_NO_DB=1 \
    WORCA_ROLE=worker \
    WORCA_WORKER_ENGINE=${ENGINE}

LABEL org.opencontainers.image.title="Worca worker" \
      org.opencontainers.image.description="Worca worker — runs one run's or one chat's agents for a Worca controller, in a container of its own" \
      dev.worca.role="worker" \
      dev.worca.engine="${ENGINE}" \
      dev.worca.claude-code.version="${CLAUDE_CODE_VERSION}" \
      dev.worca.variant="${VARIANT}"

# hadolint ignore=DL3066
USER worca
WORKDIR /projects

# As the controller's (below): -s subreaper, no -g (the worker stops its own children on SIGTERM),
# -e 143 so a stop is a clean exit on platforms that read the exit code.
ENTRYPOINT ["tini", "-s", "-e", "143", "--", "worca-worker-entrypoint"]
CMD ["worca", "worker"]


# ---------------------------------------------------------------------------------------------
# controller: the Worca server. LAST, so an untargeted build yields it.
FROM os AS controller

ARG CLAUDE_CODE_VERSION
ARG VARIANT=slim

# Inherited from `os` at build time; repeated for hadolint (DL4006), which reads stages one by one.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Claude Code, pinned. The image is immutable, so the CLI's own updater is off
# (DISABLE_AUTOUPDATER above); a newer CLI is a newer image tag.
RUN test -n "${CLAUDE_CODE_VERSION}" || { echo "CLAUDE_CODE_VERSION build arg is required" >&2; exit 1; } \
 && npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && npm cache clean --force \
 && claude --version   # the CLI's native binary is an OPTIONAL dependency: npm skips one it cannot fetch without failing

# The package from the pkg stage, `worca` on PATH. The egress overlay's sidecar runs the policy
# proxy from the package as one standalone file (docker/compose.egress.yml;
# src/core/egress-proxy.mjs imports node: modules only).
COPY --from=pkg /usr/local/lib/node_modules/@worca/app /usr/local/lib/node_modules/@worca/app
RUN app="$(npm root -g)/@worca/app" \
 && ln -s "${app}/src/cli/worca-cc.mjs" /usr/local/bin/worca \
 && install -m 755 "${app}/src/core/egress-proxy.mjs" /usr/local/lib/worca-egress-proxy.mjs

# Agents under their own uid (src/core/agent-user.mjs): `worca-agent` shares the
# `worca-share` group with the server (projects, run checkouts, the run store) but
# cannot read worca's settings, database or environment. The only sudo rule lets
# `worca` start commands as `worca-agent`, never as root. The entrypoint turns this
# on for single-volume hosts (WORCA_DATA_DIR); a bind-mount compose setup keeps one
# uid, so the files agents write on the host keep your uid. sudo is installed here,
# in the controller only: a worker has no second user to become.
#
# The agent POOL (credential broker, docs/credential-broker.md): worca-agent-01..16, one per
# signed-in person, so one person's agents cannot read another's processes (and the broker
# token in their environment). Same group, same rule: sudo to these users only, never root.
# Each pool user also has a group of its own that only it and `worca` are in: a run's folders
# (its store dir and runs/<id>) get that group, so one person's agent cannot edit another
# person's run (verdicts, outputs; agent-pool.mjs claimRunDir).
#
# `worca-plugin` runs plugin task-source connectors and chat-channel workers. Same group (it reads
# plugin code), its own HOME, and no read of worca's home, so one plugin cannot open another's
# secrets.json (plugin-shim.mjs pluginChildSpawn).
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends sudo \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 1001 worca-share \
 && useradd -l -u 1001 -g worca-share -M -d /nonexistent -s /bin/bash worca-agent \
 && useradd -l -u 1002 -g worca-share -M -d /nonexistent -s /bin/bash worca-plugin \
 && for i in $(seq -w 1 16); do groupadd -g "11$i" "worca-agent-$i" && useradd -l -u "11$i" -g worca-share -G "worca-agent-$i" -M -d /nonexistent -s /bin/bash "worca-agent-$i" && usermod -aG "worca-agent-$i" worca; done \
 && usermod -aG worca-share worca \
 && printf '%s\n' \
      'Defaults:worca !lecture, !syslog, !secure_path, umask=0007, umask_override' \
      "Runas_Alias WORCA_AGENTS = worca-agent, worca-plugin, $(seq -w 1 16 | sed 's/^/worca-agent-/' | paste -sd, - | sed 's/,/, /g')" \
      'worca ALL=(WORCA_AGENTS) NOPASSWD:SETENV: ALL' \
      > /etc/sudoers.d/worca-agent \
 && chmod 0440 /etc/sudoers.d/worca-agent \
 && visudo -cf /etc/sudoers.d/worca-agent

COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/worca-entrypoint

# HOME is pinned: a uid with no passwd entry (a Linux host user's id passed
# through `user:`) would otherwise get HOME=/ and Claude Code could not write
# its config.
ENV HOME=/home/worca \
    WORCA_HOST=0.0.0.0 \
    PORT=4317

LABEL org.opencontainers.image.title="Worca" \
      org.opencontainers.image.description="Worca — deterministic multi-agent pipeline that drives Claude Code, in a container" \
      dev.worca.role="controller" \
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

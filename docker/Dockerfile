# Worca in a container — see plans/container-isolation-design.md §5.
# Build context is this directory; `npm run docker:build` puts the `npm pack`
# tarball into .pack/ first, so the image runs exactly what npm ships.
ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
ARG CLAUDE_CODE_VERSION=2.1.278
ARG WORCA_TARBALL=.pack/worca-app.tgz

RUN apt-get update && apt-get install -y --no-install-recommends \
      git openssh-client ca-certificates curl tini ripgrep jq less procps gnupg \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force
COPY ${WORCA_TARBALL} /tmp/worca.tgz
RUN npm install -g /tmp/worca.tgz && rm /tmp/worca.tgz && npm cache clean --force

# The node image already has uid/gid 1000 as `node`; rename it rather than fight it.
RUN usermod -l worca -d /home/worca -m node && groupmod -n worca node \
 && mkdir -p /worca /projects /home/worca/.claude \
 && chown worca:worca /worca /projects /home/worca/.claude
COPY --chmod=755 entrypoint.sh /usr/local/bin/worca-entrypoint

ENV WORCA_HOST=0.0.0.0 PORT=4317 WORCA_HOME=/worca WORCA_PROJECTS_ROOT=/projects \
    WORCA_NO_NATIVE_DIALOG=1 DISABLE_AUTOUPDATER=1 \
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 TZ=UTC HOME=/home/worca
LABEL org.opencontainers.image.source="https://github.com/SinishaDjukic/worca-cc" \
      dev.worca.claude-code.version="${CLAUDE_CODE_VERSION}"
USER worca
WORKDIR /projects
VOLUME ["/worca", "/home/worca/.claude"]
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://127.0.0.1:4317/api/health || exit 1
ENTRYPOINT ["tini", "--", "worca-entrypoint"]
# The server directly rather than `worca ui`: that wrapper spawns the server as a
# child and does not forward SIGTERM, so `docker stop` would wait out its timeout.
CMD ["node", "--disable-warning=ExperimentalWarning", "/usr/local/lib/node_modules/@worca/app/ui/server.mjs"]

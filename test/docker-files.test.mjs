// test/docker-files.test.mjs
// The container packaging (docs/docker.md) without a docker daemon: the
// shipped files hold the security posture the design promises, the build
// script's pure parts work, and the egress proxy enforces its allowlist on a
// real socket. The image itself is proven by tools/docker-smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

import { DEFAULT_ALLOW, parseAllow, isAllowed, createProxy } from '../docker/egress-proxy.mjs';
import { pinnedClaudeCodeVersion, DEFAULT_IMAGE } from '../tools/docker-build.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('docker/: every file the docs and workflows name exists', () => {
  for (const f of [
    'docker/Dockerfile', 'docker/entrypoint.sh', 'docker/egress-proxy.mjs', 'docker/CLAUDE_CODE_VERSION',
    'docker/compose.yml', 'docker/compose.egress.yml', 'docker/compose.ssh.yml', 'docker/compose.teams.yml',
    'docker/compose.clonein.yml', 'docker/compose.dev.yml', 'docker/.env.example', 'docker/.trivyignore',
    '.dockerignore', '.devcontainer/devcontainer.json', 'docs/docker.md',
    '.github/workflows/docker-image.yml', '.github/workflows/docker-rebuild.yml',
  ]) assert.ok(existsSync(join(ROOT, f)), `${f} missing`);
});

test('Dockerfile: non-root, pinned CLI with its updater off, tini, healthcheck, tarball install', () => {
  const d = read('docker/Dockerfile');
  assert.match(d, /^USER worca$/m, 'runs as the worca user');
  assert.match(d, /DISABLE_AUTOUPDATER=1/, 'the image is immutable: no self-update');
  assert.match(d, /claude-code@\$\{CLAUDE_CODE_VERSION\}/, 'Claude Code is installed at the pinned version');
  assert.match(d, /test -n "\$\{CLAUDE_CODE_VERSION\}"/, 'a missing pin fails the build instead of installing latest');
  assert.match(d, /npm install -g \/tmp\/worca\.tgz/, 'installs the packed tarball, never COPY of the source');
  assert.doesNotMatch(d, /^COPY \. /m, 'no COPY of the whole tree');
  assert.match(d, /^ENTRYPOINT \["tini"/m, 'tini reaps orphaned children');
  assert.match(d, /^HEALTHCHECK/m);
  assert.match(d, /WORCA_NO_NATIVE_DIALOG=1/);
  assert.match(d, /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1/);
  assert.match(d, /dev\.worca\.claude-code\.version/, 'the pin is a label');
  assert.match(d, /chmod 0777 \/worca \/projects \/home\/worca \/home\/worca\/\.claude/, 'volume mount points are writable for any uid (Linux Engine WORCA_UID)');
  assert.match(d, /HOME=\/home\/worca/, 'HOME is pinned for uids with no passwd entry');
});

test('CLAUDE_CODE_VERSION: one semver line', () => {
  assert.match(pinnedClaudeCodeVersion(), /^\d+\.\d+\.\d+$/);
  assert.equal(read('docker/CLAUDE_CODE_VERSION').trim(), pinnedClaudeCodeVersion());
  assert.equal(DEFAULT_IMAGE, 'ghcr.io/sinishadjukic/worca');
});

test('entrypoint.sh: strict shell, execs the command, never blocks on auth', () => {
  const e = read('docker/entrypoint.sh');
  assert.match(e, /^set -euo pipefail$/m);
  assert.match(e, /^exec "\$@"$/m, 'signals must reach the server');
  assert.match(e, /apiKeyHelper/, 'compose-secret API key path');
  assert.doesNotMatch(e, /^\s*exit 1\s*$/m, 'auth state is informational; only an unwritable volume exits (78)');
});

test('compose.yml: loopback-only publish, least privilege, named volumes, no docker socket', () => {
  const c = read('docker/compose.yml');
  assert.match(c, /"127\.0\.0\.1:\$\{WORCA_PORT:-4317\}:4317"/, 'the UI is published on the host loopback only');
  assert.doesNotMatch(c, /"0\.0\.0\.0:|"\$\{WORCA_PORT:-4317\}:4317"/, 'never a wildcard bind');
  assert.match(c, /cap_drop:\s*\n\s*- ALL/);
  assert.match(c, /no-new-privileges:true/);
  assert.match(c, /pids_limit:/);
  assert.doesNotMatch(c, /docker\.sock|privileged/);
  assert.match(c, /worca-home:\/worca/);
  assert.match(c, /claude-config:\/home\/worca\/\.claude/);
  assert.doesNotMatch(c, /\$\{HOME\}\/\.claude|~\/\.worca-cc|\.worca-cc:\/worca/, 'the host Claude/Worca homes are never mounted');
  assert.match(c, /init: true/);
});

test('overlays: egress confines worca to an internal network; clone-in drops the bind mount; ssh mounts only the socket', () => {
  const eg = read('docker/compose.egress.yml');
  assert.match(eg, /internal:\s*true/);
  assert.match(eg, /HTTPS_PROXY: http:\/\/egress:3128/);
  assert.match(eg, /worca-egress-proxy\.mjs/);
  const ci = read('docker/compose.clonein.yml');
  assert.match(ci, /projects:\/projects/);
  assert.doesNotMatch(ci, /\$\{WORCA_PROJECTS/, 'no host path in clone-in mode');
  const ssh = read('docker/compose.ssh.yml');
  assert.doesNotMatch(ssh, /\.ssh:|\/\.ssh\//, 'the key directory is never mounted');
  assert.match(ssh, /SSH_AUTH_SOCK: \/ssh-agent\.sock/);
});

test('.dockerignore keeps the build context to docker/ and the packed tarball', () => {
  const lines = read('.dockerignore').split('\n').filter((l) => l && !l.startsWith('#'));
  assert.deepEqual(lines, ['*', '!docker/', 'docker/.pack/*', '!docker/.pack/worca-app-*.tgz']);
});

test('devcontainer.json is valid JSON on the published image with the two volumes', () => {
  const dc = JSON.parse(read('.devcontainer/devcontainer.json'));
  assert.match(dc.image, /^ghcr\.io\/sinishadjukic\/worca:/);
  assert.equal(dc.remoteUser, 'worca');
  assert.ok(dc.mounts.some((m) => m.includes('target=/worca')));
  assert.ok(dc.mounts.some((m) => m.includes('target=/home/worca/.claude')));
});

test('package.json wires docker:build and docker:smoke; the tarball ships the compose files (for `worca container`) but never the image build files', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['docker:build'], 'node tools/docker-build.mjs');
  assert.equal(pkg.scripts['docker:smoke'], 'node tools/docker-smoke.mjs');
  assert.deepEqual(pkg.files.filter((f) => f.startsWith('docker')), ['docker/compose*.yml', 'docker/.env.example']);
});

test('workflows: release publishes the image after npm; CI smokes the image; rebuild is weekly', () => {
  const rel = read('.github/workflows/release-npm-app.yml');
  assert.match(rel, /image:\s*\n\s*needs: build-and-publish\s*\n\s*uses: \.\/\.github\/workflows\/docker-image\.yml/);
  assert.match(rel, /release:\s*\n\s*needs: \[build-and-publish, image\]/, 'the GitHub Release waits for the image');
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /npm run docker:smoke -- --image/);
  assert.match(ci, /hadolint/);
  assert.match(ci, /trivy-action/);
  const img = read('.github/workflows/docker-image.yml');
  assert.match(img, /platforms: linux\/\$\{\{ matrix\.arch \}\}/);
  assert.match(img, /provenance: mode=max/);
  assert.match(img, /sbom: true/);
  assert.match(img, /cosign sign --yes/);
  assert.match(img, /push-by-digest=true/);
  const rb = read('.github/workflows/docker-rebuild.yml');
  assert.match(rb, /cron: "0 6 \* \* 1"/);
  assert.match(rb, /date_tag: true/);
});

test('egress allowlist: exact hosts, dot-prefixed subdomains, defaults', () => {
  assert.deepEqual(parseAllow(''), [...DEFAULT_ALLOW]);
  assert.deepEqual(parseAllow(' A.com, .B.org ,,'), ['a.com', '.b.org']);
  const allow = parseAllow('api.anthropic.com,.github.com');
  assert.equal(isAllowed('api.anthropic.com', allow), true);
  assert.equal(isAllowed('API.ANTHROPIC.COM.', allow), true, 'case and trailing dot are normalised');
  assert.equal(isAllowed('evil-api.anthropic.com', allow), false, 'exact entries do not match subdomains');
  assert.equal(isAllowed('github.com', allow), true, '.x matches x itself');
  assert.equal(isAllowed('api.github.com', allow), true);
  assert.equal(isAllowed('notgithub.com', allow), false, 'suffix match needs the dot boundary');
  assert.equal(isAllowed('', allow), false);
});

/** A local HTTP origin the proxy is (or is not) allowed to relay to. */
function origin() {
  return new Promise((res) => {
    const s = http.createServer((req, r) => r.end(`origin saw ${req.url}`));
    s.listen(0, '127.0.0.1', () => res({ server: s, port: s.address().port }));
  });
}
function rawRequest(port, text) {
  return new Promise((res, rej) => {
    const sock = net.connect(port, '127.0.0.1', () => sock.write(text));
    let out = '';
    sock.on('data', (d) => { out += d; });
    sock.on('end', () => res(out));
    sock.on('error', rej);
    setTimeout(() => { sock.destroy(); res(out); }, 1500).unref();
  });
}

test('egress proxy on a socket: relays plain HTTP to an allowed host, refuses CONNECT and HTTP to others', async () => {
  const o = await origin();
  const lines = [];
  const proxy = createProxy({ allow: ['127.0.0.1'], log: (l) => lines.push(l) });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const pport = proxy.address().port;
  try {
    const allowed = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/ok HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\nConnection: close\r\n\r\n`);
    assert.match(allowed, /^HTTP\/1\.1 200/);
    assert.match(allowed, /origin saw \/ok/);

    const deniedHttp = await rawRequest(pport, `GET http://example.com/ HTTP/1.1\r\nHost: example.com\r\nConnection: close\r\n\r\n`);
    assert.match(deniedHttp, /^HTTP\/1\.1 403/);
    assert.match(deniedHttp, /egress denied: example\.com/);

    const deniedConnect = await rawRequest(pport, `CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n`);
    assert.match(deniedConnect, /^HTTP\/1\.1 403/);

    const allowedConnect = await rawRequest(pport, `CONNECT 127.0.0.1:${o.port} HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\n\r\nGET /tunnel HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`);
    assert.match(allowedConnect, /^HTTP\/1\.1 200 Connection Established/);
    assert.match(allowedConnect, /origin saw \/tunnel/, 'bytes after the 200 are tunnelled to the origin');

    assert.deepEqual(lines.map((l) => l.split(' ').slice(1).join(' ')),
      [`ALLOW GET 127.0.0.1:${o.port}`, 'DENY GET example.com', 'DENY CONNECT example.com:443', `ALLOW CONNECT 127.0.0.1:${o.port}`]);
  } finally {
    proxy.close();
    o.server.close();
  }
});

test('egress proxy survives a client that resets a denied CONNECT (the sidecar used to die on ECONNRESET)', async () => {
  const o = await origin();
  const proxy = createProxy({ allow: ['127.0.0.1'] });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const pport = proxy.address().port;
  try {
    // curl's behaviour after a 403: read the status line, then RST the connection.
    await new Promise((res, rej) => {
      const sock = net.connect(pport, '127.0.0.1', () => sock.write('CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n'));
      sock.once('data', () => { sock.resetAndDestroy(); res(); });
      sock.on('error', rej);
    });
    await new Promise((r) => setTimeout(r, 50));
    // Still alive and still serving.
    const after = await rawRequest(pport, `GET http://127.0.0.1:${o.port}/still-up HTTP/1.1\r\nHost: 127.0.0.1:${o.port}\r\nConnection: close\r\n\r\n`);
    assert.match(after, /origin saw \/still-up/);
  } finally {
    proxy.close();
    o.server.close();
  }
});

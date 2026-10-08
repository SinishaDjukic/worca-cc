// test/docker-files.test.mjs
// The container packaging (docs/docker.md) without a docker daemon: the
// shipped files hold the security posture the design promises, and the egress
// proxy enforces its allowlist on a real socket. The image itself is proven by
// tools/docker-smoke.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import net from 'node:net';

import { DEFAULT_ALLOW, parseAllow, isAllowed, createProxy } from '../src/core/egress-proxy.mjs';
import { checkRows } from './helpers/rows.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('Dockerfile and .dockerignore: non-root, pinned CLI, tini, healthcheck, tarball-only context', async () => {
  await checkRows([
    { name: 'Dockerfile: non-root, pinned CLI with its updater off, tini, healthcheck, tarball install', run: () => {
      const d = read('docker/Dockerfile');
      assert.match(d, /^USER worca$/m, 'runs as the worca user');
      assert.match(d, /DISABLE_AUTOUPDATER=1/, 'the image is immutable: no self-update');
      assert.match(d, /claude-code@\$\{CLAUDE_CODE_VERSION\}/, 'Claude Code is installed at the pinned version');
      assert.match(d, /test -n "\$\{CLAUDE_CODE_VERSION\}"/, 'a missing pin fails the build instead of installing latest');
      assert.match(d, /npm install -g \/tmp\/worca\.tgz/, 'installs the packed tarball, never COPY of the source');
      assert.doesNotMatch(d, /^COPY \. /m, 'no COPY of the whole tree');
      assert.match(d, /^ENTRYPOINT \["tini"/m, 'tini reaps orphaned children');
      // Railway leaves a deployment RUNNING after deploymentStop when the container exits non-zero:
      // the server's 143 after SIGTERM must reach the platform as 0.
      assert.match(d, /^ENTRYPOINT \["tini", "-s", "-e", "143", "--", "worca-entrypoint"\]$/m, 'a stop (exit 143) is a clean container exit');
      assert.match(d, /^HEALTHCHECK/m);
      assert.match(d, /WORCA_NO_NATIVE_DIALOG=1/);
      assert.match(d, /WORCA_CONTAINER=1/, 'Ask Worca knows it runs in the image (src/core/deployment.mjs)');
      assert.match(d, /CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1/);
      assert.match(d, /dev\.worca\.claude-code\.version/, 'the pin is a label');
      assert.match(d, /chmod 0777 \/worca \/projects \/home\/worca \/home\/worca\/\.claude/, 'volume mount points are writable for any uid (Linux Engine WORCA_UID)');
      assert.match(d, /HOME=\/home\/worca/, 'HOME is pinned for uids with no passwd entry');
    } },
    { name: '.dockerignore keeps the build context to docker/ and the packed tarball', run: () => {
      const lines = read('.dockerignore').split('\n').filter((l) => l && !l.startsWith('#'));
      assert.deepEqual(lines, ['*', '!docker/', 'docker/.pack/*', '!docker/.pack/worca-app-*.tgz']);
    } },
  ]);
});

test('entrypoint.sh: strict shell, execs the command, never blocks on auth', () => {
  const e = read('docker/entrypoint.sh');
  assert.match(e, /^set -euo pipefail$/m);
  assert.match(e, /^exec "\$@"$/m, 'signals must reach the server');
  assert.match(e, /apiKeyHelper/, 'compose-secret API key path');
  assert.doesNotMatch(e, /^\s*exit 1\s*$/m, 'auth state is informational; only an unwritable volume exits (78)');
});

test('entrypoint.sh: single-volume mode prepares the volume as root, then drops to worca', () => {
  const e = read('docker/entrypoint.sh');
  const block = e.slice(e.indexOf('if [ -n "${WORCA_DATA_DIR:-}" ]'), e.indexOf('# 1. Volume ownership.'));
  assert.ok(block.length > 0, 'single-volume block runs before the ownership check');
  assert.match(block, /exec setpriv --reuid=worca --regid=worca --init-groups -- "\$0" "\$@"/, 'root only re-runs the entrypoint as worca');
  assert.match(block, /chown worca:worca "\$data" "\$data\/worca" "\$data\/projects" "\$data\/home" "\$data\/home\/\.claude"/,
    'top-level dirs are re-owned on every boot, not only the first');
  assert.match(block, /export HOME="\$data\/home"/, 'HOME lives on the volume (no ~/.claude.json symlink to lose)');
  assert.doesNotMatch(block, /ln -s/, 'no symlinks into the volume');
  assert.match(block, /exit 78/, 'non-root on an unwritable volume is a config error');
});

test('agent isolation: a worca-agent user, sudo only to it, set up on single-volume hosts', () => {
  const d = read('docker/Dockerfile');
  assert.match(d, /useradd -l -u 1001 -g worca-share .* worca-agent/);
  assert.match(d, /usermod -aG worca-share worca/);
  assert.match(d, /'worca ALL=\(WORCA_AGENTS\) NOPASSWD:SETENV: ALL'/, 'worca may become the agent users and nothing else');
  assert.match(d, /Runas_Alias WORCA_AGENTS = worca-agent, \$\(seq -w 1 16 \| sed 's\/\^\/worca-agent-\/'/, 'the alias names worca-agent and the pool, and only them');
  assert.match(d, /useradd -l -u "11\$i" -g worca-share -M -d \/nonexistent -s \/bin\/bash "worca-agent-\$i"/, 'the pool users share the agent group, no home, no password');
  assert.doesNotMatch(d, /\(root\)|\(ALL\)/, 'never root');
  assert.match(d, /umask=0007, umask_override/, 'agent files stay group-writable, never world-readable');
  assert.match(d, /visudo -cf \/etc\/sudoers\.d\/worca-agent/, 'a broken rule fails the build');

  const e = read('docker/entrypoint.sh');
  const block = e.slice(e.indexOf('if [ -n "${WORCA_DATA_DIR:-}" ]'), e.indexOf('# 1. Volume ownership.'));
  assert.match(block, /WORCA_AGENT_ISOLATION:-1/, 'on by default, with an explicit off switch');
  assert.match(block, /chmod 2770 "\$wh\/store" "\$wh\/runs" "\$data\/projects"/, 'shared dirs are setgid, not world-open');
  assert.match(block, /chmod 0711 "\$data" "\$data\/worca" "\$wh"/, 'the worca home is traverse-only');
  assert.match(block, /chmod 0700 "\$ah"/);
  assert.match(block, /sharedRepository = group/);
  assert.match(block, /export WORCA_AGENT_USER=worca-agent WORCA_AGENT_HOME="\$ah"/);
  assert.ok(block.indexOf('umask 0007') < block.indexOf('exec setpriv'), 'the server inherits the umask');
  assert.match(block, /WORCA_ALLOWED_HOSTS[\s\S]*exit 78/, 'a hosted worca refuses to run agents as the server when sudo fails');
  assert.doesNotMatch(e, /gh auth setup-git >/, 'no global credential helper');
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

test('Azure DevOps: compose passes the tokens, egress names the hosts, the entrypoint logs the mode', () => {
  const c = read('docker/compose.yml');
  for (const k of ['WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN']) {
    assert.match(c, new RegExp(`^\\s+${k}: \\$\\{${k}:-\\}$`, 'm'), `${k} reaches the container`);
  }
  assert.match(read('docker/compose.egress.yml'), /Azure DevOps: add dev\.azure\.com,\.visualstudio\.com,vssps\.dev\.azure\.com/,
    'the default allowlist is not widened, so the overlay tells Azure users what to add');
  const e = read('docker/entrypoint.sh');
  const gh = e.indexOf('log "GitHub: one token for clone, push and PRs, per call"');
  const ado = e.indexOf('if [ -n "${WORCA_ADO_READ_TOKEN:-}${WORCA_ADO_WRITE_TOKEN:-}" ]; then');
  assert.ok(gh > 0 && ado > gh, 'the Azure mode is logged after the GitHub mode');
  assert.match(e, /log "Azure DevOps: split read\/write tokens, per call"/);
  assert.match(e, /elif \[ -n "\$\{WORCA_ADO_TOKEN:-\}\$\{AZURE_DEVOPS_EXT_PAT:-\}" \]; then\n\s+log "Azure DevOps: one token for clone, push and PRs, per call"/);
});

test('overlays: egress confines worca to an internal network; clone-in drops the bind mount; ssh mounts only the socket', () => {
  const eg = read('docker/compose.egress.yml');
  assert.match(eg, /internal:\s*true/);
  assert.match(eg, /HTTPS_PROXY: http:\/\/egress:3128/);
  assert.match(eg, /NO_PROXY: .*\bbroker\b/, 'worca fetch() honors the proxy, so the broker sidecar must bypass it');
  assert.match(eg, /worca-egress-proxy\.mjs/);
  assert.match(read('docker/Dockerfile'), /install -m 755 "\$\(npm root -g\)\/@worca\/app\/src\/core\/egress-proxy\.mjs" \/usr\/local\/lib\/worca-egress-proxy\.mjs/,
    'the sidecar runs the proxy shipped in the package');
  const ci = read('docker/compose.clonein.yml');
  assert.match(ci, /projects:\/projects/);
  assert.doesNotMatch(ci, /\$\{WORCA_PROJECTS/, 'no host path in clone-in mode');
  const ssh = read('docker/compose.ssh.yml');
  assert.doesNotMatch(ssh, /\.ssh:|\/\.ssh\//, 'the key directory is never mounted');
  assert.match(ssh, /SSH_AUTH_SOCK: \/ssh-agent\.sock/);
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

test('compose.broker.yml: worca gets the broker address and no key; the broker publishes no port', () => {
  const b = read('docker/compose.broker.yml');
  assert.match(b, /WORCA_BROKER_URL: http:\/\/broker:8080/);
  assert.match(b, /NO_PROXY: .*\bbroker\b/, 'worca fetch() honors a proxy from .env, so the broker sidecar must bypass it');
  assert.match(b, /ANTHROPIC_API_KEY: ""/, 'the key is blanked in worca');
  assert.match(b, /CLAUDE_CODE_OAUTH_TOKEN: ""/);
  assert.match(b, /command: \["worca", "broker"\]/);
  assert.match(b, /WORCA_BROKER_KEY_ANTHROPIC/, 'the key goes to the broker under its own name');
  const broker = b.slice(b.indexOf('\n  broker:'));
  assert.doesNotMatch(broker, /^\s+ports:/m, 'no published ports: worca reaches it on the compose network');
  assert.match(broker, /cap_drop:\s*\n\s*- ALL/);
  assert.match(broker, /\/healthz/, 'its own healthcheck (the image\'s targets worca\'s port)');
});

test('compose.isolation.yml: one volume, root only to prepare it, sudo to agents without no-new-privileges, the capabilities it needs', () => {
  const c = read('docker/compose.isolation.yml');
  assert.match(c, /user: "0:0"/);
  assert.match(c, /WORCA_DATA_DIR: \/data/);
  assert.match(c, /security_opt: !reset \[\]/, 'no-new-privileges lifted: sudo is setuid');
  assert.match(c, /cap_drop:\s*\n\s*- ALL/);
  for (const cap of ['CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'FSETID', 'SETUID', 'SETGID']) assert.match(c, new RegExp(`- ${cap}\\b`), `${cap} kept`);
  assert.doesNotMatch(c, /SYS_ADMIN|SYS_PTRACE|NET_ADMIN|privileged/, 'nothing broader');
  const e = read('docker/entrypoint.sh');
  assert.match(e, /WORCA_AGENT_POOL:-1/, 'the pool is on by default, with an off switch');
  assert.match(e, /if \[ ! -g "\$wh\/tmp\/ask" \]/, 'a lost setgid bit is reported, not silent');
});

test('entrypoint.sh: `worca broker` skips worca\'s preparation and drops to worca after preparing its volume', () => {
  const e = read('docker/entrypoint.sh');
  const start = e.indexOf('if [ "${1:-}" = "worca" ] && [ "${2:-}" = "broker" ]');
  assert.ok(start > 0, 'the broker branch exists');
  assert.ok(start < e.indexOf('WORCA_DATA_DIR:-'), 'it runs before the single-volume block');
  const block = e.slice(start, e.indexOf('\nfi\n', start));
  assert.match(block, /chown worca:worca "\$WORCA_BROKER_DATA_DIR"/);
  assert.match(block, /exec setpriv --reuid=worca --regid=worca --init-groups -- "\$0" "\$@"/);
  assert.match(e, /credential broker \(\$\{WORCA_BROKER_URL\}\); worca holds no model key/);
});

test('entrypoint.sh: plugin code is shared read-only with the agent users, plugin data never (MCP registry §14)', () => {
  const e = read('docker/entrypoint.sh');
  const iso = e.indexOf('if [ "${WORCA_AGENT_ISOLATION:-1}" != 0 ]');
  const start = e.indexOf('# MCP registry (§14)');
  assert.ok(iso > 0 && start > iso && start < e.indexOf('exec setpriv --reuid=worca', iso), 'inside the agent-isolation preparation, as root');
  assert.ok(start < e.indexOf('      umask 0007\n    fi\n', iso), 'before the isolation block closes: $wh is set only inside it');
  const block = e.slice(start, e.indexOf('\n      done\n', start));
  assert.match(block, /for p in "\$wh\/plugins"\/\*\/; do/, 'each plugin dir with its trailing slash: ${p}versions is <p>/versions');
  assert.match(block, /chown worca:worca-share "\$wh\/plugins"/);
  assert.match(block, /chmod 0710 "\$wh\/plugins"/, 'plugins/: traverse only');
  assert.match(block, /chmod 0710 "\$p" && chgrp worca-share "\$p"/, 'plugins/<p>/: traverse only');
  assert.match(block, /chmod -R g-w,g\+rX "\$\{p\}versions" && chgrp -R worca-share "\$\{p\}versions"/, 'versions/**: read-only');
  assert.ok(block.indexOf('chmod 0710 "$wh/plugins"') < block.indexOf('chown worca:worca-share "$wh/plugins"'),
    'modes first, then the group (as P2 shareVersionDir): the agents\' group never holds write access, not even for a moment');
  assert.match(block, /chmod -R go-rwx "\$\{p\}data"/, 'plugin secrets stay owner-only');
  assert.match(block, /if \[ ! -L "\$wh\/plugins" \]; then chmod 0710/, 'root never follows a planted symlink: plugins/ itself');
  assert.match(block, /\[ ! -L "\$wh\/plugins" \] && \[ ! -L "\$\{p%\/\}" \] && \[ ! -L "\$\{p\}versions" \] && \[ -d "\$\{p\}versions" \] \|\| continue/,
    'nor a plugin dir or its versions/');
  assert.match(block, /if \[ -d "\$\{p\}data" \] && \[ ! -L "\$\{p\}data" \]; then chmod -R go-rwx/, 'nor its data/');
  assert.doesNotMatch(block, /g\+w|g\+s|2770|worca-share "\$\{p\}data"/, 'never group-writable, never setgid, data never shared');
  assert.doesNotMatch(block, /\.agent-isolation/, 'every boot, not once per volume: plugins installed since then join too');
});

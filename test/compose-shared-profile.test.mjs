// test/compose-shared-profile.test.mjs
// The shared-instance reference profile (docker/compose.shared.yml, docker/shared.env.example,
// docs/shared-instance.md): it parses, it keeps the hardening, its secrets are files, and the example env names
// are exactly what the compose files and the code read. The merge is checked with `docker compose config` where the
// CLI is installed (it needs no daemon); nothing here starts a container.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { readServerSource } from '../src/core/read-server-source.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKER = join(ROOT, 'docker');
const LIST = ['compose.yml', 'compose.broker.yml', 'compose.isolation.yml', 'compose.egress.yml', 'compose.proxy.yml', 'compose.shared.yml'];
const tags = [
  { tag: '!override', collection: 'seq', resolve: (v) => ({ override: v.toJSON ? v.toJSON() : v }) },
  { tag: '!reset', collection: 'seq', resolve: () => ({ reset: true }) },
];
const read = (f) => readFileSync(join(DOCKER, f), 'utf8');
const shared = () => parseYaml(read('compose.shared.yml'), { customTags: tags });
/** Every NAME=… in the example, commented or not. */
const exampleNames = () => [...read('shared.env.example').matchAll(/^#?([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]);

/** All the source the image runs: src/, ui/server.mjs and the entrypoint. */
function sourceText() {
  let text = read('entrypoint.sh') + readServerSource();
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.mjs')) text += readFileSync(p, 'utf8'); } };
  walk(join(ROOT, 'src'));
  return text;
}

test('compose.shared.yml parses and keeps the hardening: no host mount, nothing published, multi mode, secrets as files', () => {
  const c = shared();
  assert.equal(c.name, 'worca-shared');
  const w = c.services.worca;
  assert.deepEqual(w.volumes, { override: ['worca-data:/data'] });
  assert.deepEqual(w.ports, { reset: true });
  assert.equal(w.environment.WORCA_BROKER_REQUIRED, '1');
  assert.match(w.environment.WORCA_ALLOWED_HOSTS, /^\$\{WORCA_INSTANCE_HOST:\?/);
  for (const k of ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'GH_TOKEN', 'WORCA_BROKER_SECRET', 'WORCA_EGRESS_SECRET']) assert.equal(w.environment[k], '', `${k} stays empty in Worca`);
  assert.equal(c.services.broker.environment.WORCA_BROKER_MODE, 'multi');
  assert.equal(c.services.broker.environment.WORCA_BROKER_KEY_ANTHROPIC, '', 'no team key');
  assert.equal(c.services.broker.environment.HTTPS_PROXY, 'http://egress:3128');
  assert.match(c.services.egress.environment.WORCA_EGRESS_LOGIN_FILE, /\/run\/secrets\/worca_proxy_login/);
  assert.deepEqual(c.services.cloudflared.profiles, ['tunnel']);
  assert.deepEqual(c.services.cloudflared.networks, ['internal', 'default']);
  assert.ok(!c.services.cloudflared.environment, 'the tunnel token is a file, not a variable');
  assert.equal(c.services.cloudflared.user, '1000:1000', 'one owner for every secret file');
  // Every *_FILE variable a service sets points at a secret that service mounts.
  for (const [name, svc] of Object.entries(c.services)) {
    for (const [k, v] of Object.entries(svc.environment || {})) {
      const m = /\/run\/secrets\/([a-z_]+)/.exec(String(v));
      if (!m) continue;
      assert.ok((svc.secrets || []).includes(m[1]), `${name}.${k} names /run/secrets/${m[1]}, which ${name} mounts`);
      assert.ok(c.secrets[m[1]], `secret ${m[1]} is declared`);
    }
  }
  for (const [n, s] of Object.entries(c.secrets)) assert.match(s.file, /^\$\{(WORCA_SECRETS_DIR|WORCA_PROXY_LOGIN|WORCA_GH_APP_KEY|WORCA_BROKER_GITHUB_CLIENT_SECRET_PATH)/, `${n} comes from a file path`);
});

test('the docs and the example env state the owner and mode of every secret file, with the commands', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'shared-instance.md'), 'utf8');
  const ex = read('shared.env.example');
  for (const f of ['broker_secret', 'egress_secret', 'broker_vault_key', 'tunnel_token', 'proxy_login.json']) {
    assert.match(doc, new RegExp(`\\| \`${f.replace('.', '\\.')}\`[^\\n]*\\| \`1000:1000\`, \`0600\``), `${f}: owner and mode in the table`);
  }
  for (const t of [doc, ex]) assert.match(t, /chown 1000:1000 secrets\/\* && sudo chmod 600 secrets\/\*/);
  // Every secret file Worca's own container reads is one the boot check covers.
  const box = Object.entries(shared().services.worca.environment).filter(([k, v]) => k.endsWith('_FILE') && /\/run\/secrets\//.test(String(v))).map(([k]) => k);
  const checked = readFileSync(join(ROOT, 'src', 'core', 'secret-files.mjs'), 'utf8');
  for (const k of box) assert.ok(checked.includes(`'${k}'`), `${k} is in BOX_SECRET_FILES`);
});

test('the base overlays accept a secret file: no compose-time requirement of the literal variable', () => {
  for (const f of ['compose.broker.yml', 'compose.proxy.yml']) {
    assert.doesNotMatch(read(f), /_SECRET:\?/, `${f} would refuse a setup that gives the secret as a file`);
    assert.match(read(f), /_SECRET_FILE: \$\{WORCA_(BROKER|EGRESS)_SECRET_FILE:-\}/);
  }
});

test('shared.env.example: every name is read by the compose files or the code, and it holds no secret value', () => {
  const composeText = LIST.map(read).join('\n');
  const interpolated = new Set([...composeText.matchAll(/\$\{([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
  const names = exampleNames();
  assert.ok(names.length > 15);
  for (const n of names) assert.ok(interpolated.has(n), `${n} in shared.env.example is interpolated by the shared file list`);
  // Every value the overlay requires is in the example.
  for (const m of read('compose.shared.yml').matchAll(/\$\{([A-Z][A-Z0-9_]*):\?/g)) assert.ok(names.includes(m[1]), `${m[1]} is required and in the example`);
  // No literal secret: an uncommented line never sets a secret-looking name to a value.
  for (const m of read('shared.env.example').matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)) {
    if (/(SECRET|TOKEN|_KEY)$/.test(m[1])) assert.equal(m[2].trim(), '', `${m[1]} must not hold a value in the example`);
  }
});

test('the variables the overlay sets are ones the image reads', () => {
  const src = sourceText();
  const c = shared();
  const keys = new Set(Object.values(c.services).flatMap((s) => Object.keys(s.environment || {})).filter((k) => k.startsWith('WORCA_')));
  for (const k of keys) {
    const base = k.replace(/_FILE$/, '');
    assert.ok(src.includes(k) || (k.endsWith('_FILE') && src.includes(base)), `${k} is read by src/, ui/server.mjs or the entrypoint`);
  }
});

test('docs/shared-instance.md names the same file list, in the same order', () => {
  const doc = readFileSync(join(ROOT, 'docs', 'shared-instance.md'), 'utf8');
  const start = doc.indexOf('## Start it');
  const order = [...doc.slice(start).matchAll(/-f (compose[a-z.]*\.yml)/g)].map((m) => m[1]).slice(0, LIST.length);
  assert.deepEqual(order, LIST);
  assert.match(read('compose.shared.yml'), new RegExp(LIST.slice(1).map((f) => `-f ${f.replace(/\./g, '\\.')}`).join('[\\s\\\\#]*')));
});

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?_proxy|no_proxy|WORCA_|GH_TOKEN|ANTHROPIC_|CLAUDE_CODE_|TZ$)/i.test(k)));

test('docker compose config: the merged shared instance (skipped without the docker CLI; it needs no daemon)', (t) => {
  if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status !== 0) { t.skip('no docker compose CLI'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'worca-shared-'));
  try {
    for (const f of [...LIST, 'shared.env.example']) copyFileSync(join(DOCKER, f), join(dir, f));
    mkdirSync(join(dir, 'secrets'));
    for (const f of ['broker_secret', 'egress_secret', 'broker_vault_key', 'tunnel_token', 'proxy_login.json']) writeFileSync(join(dir, 'secrets', f), 'x');
    const r = spawnSync('docker', ['compose', '--env-file', 'shared.env.example', ...LIST.flatMap((f) => ['-f', f]), '--profile', 'tunnel', 'config', '--format', 'json'],
      { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout);
    const w = c.services.worca;
    assert.deepEqual(w.volumes.map((v) => `${v.type}:${v.target}`), ['volume:/data']);
    for (const [n, s] of Object.entries(c.services)) assert.ok(!s.ports || s.ports.length === 0, `${n} publishes nothing`);
    assert.deepEqual(Object.keys(w.networks), ['internal']);
    assert.equal(c.networks.internal.internal, true);
    assert.equal(w.environment.WORCA_BROKER_SECRET_FILE, '/run/secrets/worca_broker_secret');
    assert.equal(w.environment.WORCA_EGRESS_SECRET_FILE, '/run/secrets/worca_egress_secret', 'compose.shared.yml wins over compose.proxy.yml');
    assert.equal(c.services.egress.environment.WORCA_EGRESS_SECRET_FILE, '/run/secrets/worca_egress_secret');
    assert.equal(c.services.egress.environment.WORCA_EGRESS_LOGIN_FILE, '/run/secrets/worca_proxy_login');
    assert.equal(c.services.egress.environment.WORCA_EGRESS_ALLOWLIST, '1');
    assert.deepEqual(c.services.egress.command, ['worca', 'egress']);
    assert.equal(c.services.broker.environment.WORCA_BROKER_MODE, 'multi');
    assert.equal(c.services.broker.environment.WORCA_BROKER_PUBLIC_URL, 'https://worca-keys.acme.example');
    assert.equal(w.environment.WORCA_ALLOWED_HOSTS, 'worca.acme.example');
    assert.equal(w.user, '0:0', 'compose.isolation.yml: agent users');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

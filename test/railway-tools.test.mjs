// test/railway-tools.test.mjs — tools/railway/worca-railway.mjs: targets, redaction, image refs,
// argument parsing, and the secret rules (values never on a command line or in output; names-only
// listings; --service always explicit; --yes for every change). Railway, ssh and HTTP are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvFile, loadTarget, redact, imageRef, parseArgs, shellQuote, main,
} from '../tools/railway/worca-railway.mjs';

const SECRET = 'ghs_' + 'S'.repeat(36);
const DIR = mkdtempSync(join(tmpdir(), 'worca-targets-'));
const TARGET_TEXT = [
  '# a test target', 'RAILWAY_PROJECT_ID=proj-1', 'RAILWAY_ENVIRONMENT_ID=env-1', 'RAILWAY_WORCA_SERVICE=worca',
  'RAILWAY_WORCA_SERVICE_ID=svc-1', 'WORCA_URL=https://worca.example.com/', 'BRANCH_IMAGE_REPO=ghcr.io/me/worca-e2e',
  `ACCESS_SERVICE_TOKEN_FILE=${join(DIR, 'access.env')}`, 'SSH_KEY=~/.ssh/k',
].join('\n');
writeFileSync(join(DIR, 't1.env'), TARGET_TEXT);
writeFileSync(join(DIR, 'access.env'), 'CF_ACCESS_CLIENT_ID=id-1234567890\nCF_ACCESS_CLIENT_SECRET=secret-abcdefghijkl\n');

test('parseEnvFile: comments, quotes, malformed lines, no expansion', () => {
  assert.deepEqual(parseEnvFile('# c\nA=1\n B = "two" \nbad line\nlower=x\nC=$HOME\nD=\'q\''), { A: '1', B: 'two', C: '$HOME', D: 'q' });
});

test('loadTarget: validates the name, the file and the required keys', () => {
  const t = loadTarget('t1', { dir: DIR });
  assert.equal(t.url, 'https://worca.example.com');
  assert.equal(t.host, 'worca.example.com');
  assert.equal(t.imageRepo, 'ghcr.io/sinishadjukic/worca', 'released images by default');
  assert.ok(t.sshKey.endsWith('/.ssh/k') && !t.sshKey.startsWith('~'));
  assert.throws(() => loadTarget('../etc', { dir: DIR }), /target name is required/);
  assert.throws(() => loadTarget('nope', { dir: DIR }), /no target "nope"/);
  writeFileSync(join(DIR, 'half.env'), 'RAILWAY_PROJECT_ID=p\nWORCA_URL=http://x.example.com');
  assert.throws(() => loadTarget('half', { dir: DIR }), /missing RAILWAY_ENVIRONMENT_ID, RAILWAY_WORCA_SERVICE, RAILWAY_WORCA_SERVICE_ID/);
  writeFileSync(join(DIR, 'http.env'), TARGET_TEXT.replace('https://worca.example.com/', 'http://worca.example.com'));
  assert.throws(() => loadTarget('http', { dir: DIR }), /WORCA_URL must be https/);
});

test('redact: JWTs, GitHub and Anthropic tokens, PEM blocks, URL credentials, known values', () => {
  const s = redact(`a eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig b ${SECRET} github_pat_${'x'.repeat(30)} sk-ant-api03-abcdefghijk https://u:p@github.com/x -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY----- mysecretvalue`, ['mysecretvalue']);
  for (const leak of ['eyJhbGci', SECRET, 'github_pat_', 'sk-ant-', 'u:p@', 'MIIE', 'mysecretvalue']) assert.ok(!s.includes(leak), leak);
  assert.equal(redact('plain text 1.4.0'), 'plain text 1.4.0');
});

test('imageRef: versions expand, full refs validate, :latest is refused', () => {
  const t = loadTarget('t1', { dir: DIR });
  assert.equal(imageRef(t, '1.5.0'), 'ghcr.io/sinishadjukic/worca:1.5.0');
  assert.equal(imageRef(t, '1.5.0-rc.2'), 'ghcr.io/sinishadjukic/worca:1.5.0-rc.2');
  assert.equal(imageRef(t, 'ghcr.io/me/worca-e2e:pr-480'), 'ghcr.io/me/worca-e2e:pr-480');
  assert.throws(() => imageRef(t, 'ghcr.io/me/worca:latest'), /not :latest/);
  for (const bad of ['', 'worca', 'ghcr.io/me/worca', 'ghcr.io/me/worca:tag;rm -rf /', '$(id)']) assert.throws(() => imageRef(t, bad), /not an image reference/, bad);
});

test('parseArgs and shellQuote', () => {
  assert.deepEqual(parseArgs(['set', 't1', 'KEY', '--skip-deploys', '--yes']), { cmd: 'set', target: 't1', pos: ['KEY'], flags: { 'skip-deploys': true, yes: true }, rest: [] });
  assert.deepEqual(parseArgs(['ssh', 't1', '--', 'ls', '-la']).rest, ['ls', '-la']);
  assert.throws(() => parseArgs(['logs', 't1', '--lines']), /--lines needs a value/);
  assert.equal(shellQuote('abc-1.2/x'), 'abc-1.2/x');
  assert.equal(shellQuote("id -un; echo it's"), `'id -un; echo it'\\''s'`);
});

/** A fake world: railway (api + variable + ssh config), ssh, npm, docker; records every call. */
function world({ vars = { GH_TOKEN: SECRET, WORCA_MOCK: '1', SEALED: null, RAILWAY_X: 'y' }, image = 'ghcr.io/sinishadjukic/worca:1.4.0', stdin = '', fetchImpl } = {}) {
  const calls = [];
  const out = [];
  let img = image;
  let n = 0;
  const exec = async (cmd, args, opts = {}) => {
    calls.push({ cmd, args, input: opts.input ?? null });
    if (cmd === 'railway' && args[0] === 'api') {
      const q = args[1];
      const v = JSON.parse(args[3]);
      if (q.includes('serviceInstanceUpdate')) { img = v.i.source.image; return { code: 0, stdout: '{"data":{"serviceInstanceUpdate":true}}' }; }
      if (q.includes('serviceInstanceDeploy')) { n += 1; return { code: 0, stdout: '{"data":{"serviceInstanceDeploy":true}}' }; }
      if (q.includes('serviceInstance(')) return { code: 0, stdout: JSON.stringify({ data: { serviceInstance: { source: { image: img } } } }) };
      if (q.includes('deployments(')) return { code: 0, stdout: JSON.stringify({ data: { deployments: { edges: [{ node: { id: `d${n}`, status: 'SUCCESS', createdAt: new Date(Date.now() + 1000).toISOString() } }] } } }) };
      if (q.includes('deploymentLogs')) return { code: 0, stdout: JSON.stringify({ data: { deploymentLogs: [{ message: `worca-entrypoint: token ${SECRET}` }, { message: '[worca-ui] listening' }] } }) };
    }
    if (cmd === 'railway' && args[0] === 'variable' && args[1] === 'list') return { code: 0, stdout: JSON.stringify(vars) };
    if (cmd === 'railway') return { code: 0, stdout: '', stderr: '' };
    return { code: 0, stdout: 'ok\n', stderr: '' };
  };
  const ctx = {
    exec, out: (s) => out.push(String(s)), read: readFileSync, stdin: async () => stdin, sleep: async () => {},
    fetch: fetchImpl || (async () => ({ status: 200, json: async () => ({}) })), loadTarget: (name) => loadTarget(name, { dir: DIR }),
  };
  return { ctx, calls, out, text: () => out.join('\n') };
}

const allArgs = (calls) => calls.map((c) => c.args.join(' ')).join('\n');

test('status: variable NAMES only (sealed marked), Railway\'s own hidden, logs redacted', async () => {
  const w = world();
  assert.equal(await main(['status', 't1'], w.ctx), 0);
  const text = w.text();
  assert.match(text, /variables  GH_TOKEN, SEALED \(sealed\), WORCA_MOCK/);
  assert.ok(!text.includes(SECRET), 'no value printed');
  assert.ok(!text.includes('RAILWAY_X'));
  const list = w.calls.find((c) => c.args[0] === 'variable');
  assert.deepEqual(list.args.slice(2, 8), ['--service', 'worca', '--environment', 'env-1', '--project', 'proj-1'], '--service is explicit');
});

test('set: the value goes on stdin only, never argv or output; --yes, a valid key, not RAILWAY_*', async () => {
  let w = world({ stdin: `${SECRET}\n` });
  await assert.rejects(main(['set', 't1', 'GH_TOKEN'], w.ctx), /re-run with --yes/);
  assert.equal(w.calls.length, 0, 'nothing ran');
  assert.equal(await main(['set', 't1', 'GH_TOKEN', '--yes', '--skip-deploys'], w.ctx), 0);
  const set = w.calls.find((c) => c.args[0] === 'variable' && c.args[1] === 'set');
  assert.deepEqual(set.args, ['variable', 'set', 'GH_TOKEN', '--stdin', '--service', 'worca', '--environment', 'env-1', '--project', 'proj-1', '--skip-deploys']);
  assert.equal(set.input, SECRET, 'trailing newline trimmed');
  assert.ok(!allArgs(w.calls).includes(SECRET) && !w.text().includes(SECRET));
  w = world({ stdin: '' });
  await assert.rejects(main(['set', 't1', 'GH_TOKEN', '--yes'], w.ctx), /no value for GH_TOKEN/);
  await assert.rejects(main(['set', 't1', 'lower', '--yes'], w.ctx), /KEY must be/);
  await assert.rejects(main(['set', 't1', 'RAILWAY_RUN_UID', '--yes'], w.ctx), /Railway's own/);
  const f = join(DIR, 'value.txt');
  writeFileSync(f, SECRET);
  w = world();
  await main(['set', 't1', 'WORCA_GH_APP_KEY_B64', '--from-file', f, '--yes'], w.ctx);
  assert.equal(w.calls.find((c) => c.args[1] === 'set').input, SECRET);
});

test('mock on/off, unset', async () => {
  let w = world();
  await main(['mock', 't1', 'off', '--yes'], w.ctx);
  assert.deepEqual(w.calls[0].args.slice(0, 3), ['variable', 'delete', 'WORCA_MOCK']);
  w = world();
  await main(['mock', 't1', 'on', '--yes'], w.ctx);
  assert.deepEqual([w.calls[0].args.slice(0, 4), w.calls[0].input], [['variable', 'set', 'WORCA_MOCK', '--stdin'], '1']);
  await assert.rejects(main(['mock', 't1', 'maybe', '--yes'], world().ctx), /on\|off/);
  w = world();
  await main(['unset', 't1', 'WORCA_CLONE_ALLOW', '--yes', '--skip-deploys'], w.ctx);
  assert.ok(w.calls[0].args.includes('--skip-deploys') && w.calls[0].args.includes('--service'));
});

test('upgrade records history; rollback returns to the previous image', async () => {
  writeFileSync(join(DIR, 't1.history'), '');
  let w = world({ image: 'ghcr.io/sinishadjukic/worca:1.4.0' });
  await assert.rejects(main(['upgrade', 't1', '1.5.0'], w.ctx), /--yes/);
  assert.equal(await main(['upgrade', 't1', '1.5.0', '--yes'], w.ctx), 0);
  assert.match(w.text(), /image ghcr\.io\/sinishadjukic\/worca:1\.4\.0 -> ghcr\.io\/sinishadjukic\/worca:1\.5\.0/);
  assert.ok(!w.text().includes(SECRET), 'deploy logs redacted');
  const history = readFileSync(join(DIR, 't1.history'), 'utf8');
  assert.match(history, /worca:1\.4\.0\n.*worca:1\.5\.0\n$/);
  w = world({ image: 'ghcr.io/sinishadjukic/worca:1.5.0' });
  assert.equal(await main(['rollback', 't1', '--yes'], w.ctx), 0);
  assert.match(w.text(), /-> ghcr\.io\/sinishadjukic\/worca:1\.4\.0/);
});

test('deploy-branch: builds amd64, pushes to BRANCH_IMAGE_REPO, deploys', async () => {
  const w = world();
  await assert.rejects(main(['deploy-branch', 't1', '--yes'], w.ctx), /--tag <tag> is required/);
  assert.equal(await main(['deploy-branch', 't1', '--tag', 'pr-480-1', '--yes'], w.ctx), 0);
  const npm = w.calls.find((c) => c.cmd === 'npm');
  assert.deepEqual(npm.args, ['run', 'docker:build', '--', '--platform', 'linux/amd64', '--tag', 'ghcr.io/me/worca-e2e:pr-480-1']);
  assert.deepEqual(w.calls.find((c) => c.cmd === 'docker').args, ['push', 'ghcr.io/me/worca-e2e:pr-480-1']);
});

test('verify: anonymous goes to sign-in; the service token headers are used and never printed', async () => {
  const seen = [];
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, headers: init.headers || {} });
    if (!init.headers) return { status: 302, json: async () => ({}) };
    if (url.endsWith('/api/health')) return { status: 200, json: async () => ({ name: '@worca/app', version: '1.5.0' }) };
    if (url.endsWith('/api/whoami')) return { status: 200, json: async () => ({ name: null, source: 'local', shared: false }) };
    if (url.endsWith('/api/projects/clone')) return { status: 400, json: async () => ({ code: 'invalid' }) };
    return { status: 404, json: async () => ({}) };
  };
  const w = world({ fetchImpl });
  assert.equal(await main(['verify', 't1'], w.ctx), 0);
  assert.equal(seen[1].headers['CF-Access-Client-Id'], 'id-1234567890');
  assert.ok(!w.text().includes('secret-abcdefghijkl') && !w.text().includes('id-1234567890'));
  assert.match(w.text(), /verify: all checks passed/);
  const bad = world({ fetchImpl: async () => ({ status: 200, json: async () => ({}) }) });
  assert.equal(await main(['verify', 't1'], bad.ctx), 1, 'an open app (200 anonymous) fails');
});

test('ssh: a per-target config from `railway ssh config`, and quoted remote arguments', async () => {
  const w = world();
  await main(['ssh', 't1', '--', 'sh', '-c', 'id -un; ls'], w.ctx);
  const cfg = w.calls.find((c) => c.args[0] === 'ssh' && c.args[1] === 'config');
  assert.ok(cfg.args.includes('--identity-file') && cfg.args.includes('worca-t1'));
  const ssh = w.calls.find((c) => c.cmd === 'ssh');
  assert.equal(ssh.args[ssh.args.length - 1], `sh -c 'id -un; ls'`);
  assert.ok(existsSync(join(DIR, 't1.ssh')));
});

test('the repo carries no deployment detail: the example target is a template', () => {
  const ex = readFileSync(new URL('../tools/railway/targets.example.env', import.meta.url), 'utf8');
  const t = parseEnvFile(ex);
  for (const k of ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_WORCA_SERVICE_ID', 'BRANCH_IMAGE_REPO']) assert.equal(t[k], '', `${k} is blank`);
  assert.equal(t.WORCA_URL, 'https://worca.example.com');
  for (const f of ['tools/railway/targets.example.env', 'tools/railway/worca-railway.mjs', 'tools/railway/in-container-probe.sh', '.claude/skills/worca-railway/SKILL.md', 'docs/deploy-railway.md']) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.ok(!/worca-01|5fa6d30a|1cee1493|92410215/.test(s), `${f} names no real deployment`);
  }
});

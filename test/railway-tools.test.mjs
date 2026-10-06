// test/railway-tools.test.mjs — tools/railway/worca-railway.mjs: targets, redaction, image refs,
// argument parsing, and the secret rules (values never on a command line or in output; names-only
// listings; --service always explicit; --yes for every change). Railway, ssh and HTTP are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEnvFile, loadTarget, redact, imageRef, main,
} from '../tools/railway/worca-railway.mjs';
import { checkRows } from './helpers/rows.mjs';

const SECRET = 'ghs_' + 'S'.repeat(36);
const DIR = mkdtempSync(join(tmpdir(), 'worca-targets-'));
const TARGET_TEXT = [
  '# a test target', 'RAILWAY_PROJECT_ID=proj-1', 'RAILWAY_ENVIRONMENT_ID=env-1', 'RAILWAY_WORCA_SERVICE=worca',
  'RAILWAY_WORCA_SERVICE_ID=svc-1', 'WORCA_URL=https://worca.example.com/', 'BRANCH_IMAGE_REPO=ghcr.io/me/worca-e2e',
  `ACCESS_SERVICE_TOKEN_FILE=${join(DIR, 'access.env')}`, 'SSH_KEY=~/.ssh/k',
].join('\n');
writeFileSync(join(DIR, 't1.env'), TARGET_TEXT);
writeFileSync(join(DIR, 'access.env'), 'CF_ACCESS_CLIENT_ID=id-1234567890\nCF_ACCESS_CLIENT_SECRET=secret-abcdefghijkl\n');

test('redact: JWTs, GitHub/Anthropic/broker tokens, API keys, PEM, URL credentials, known values', async () => {
  await checkRows([
    { name: 'redact: JWTs, GitHub and Anthropic tokens, PEM blocks, URL credentials, known values', run: () => {
      const s = redact(`a eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig b ${SECRET} github_pat_${'x'.repeat(30)} sk-ant-api03-abcdefghijk https://u:p@github.com/x -----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY----- mysecretvalue`, ['mysecretvalue']);
      for (const leak of ['eyJhbGci', SECRET, 'github_pat_', 'sk-ant-', 'u:p@', 'MIIE', 'mysecretvalue']) assert.ok(!s.includes(leak), leak);
      assert.equal(redact('plain text 1.4.0'), 'plain text 1.4.0');
    } },
    { name: 'redact covers broker tokens and API keys', run: () => {
      assert.equal(redact(`x wbt_${'a'.repeat(43)} sk-proj-${'b'.repeat(30)}`), 'x <redacted broker token> <redacted api key>');
    } },
  ]);
});

test('imageRef: versions expand, full refs validate, :latest is refused', () => {
  const t = loadTarget('t1', { dir: DIR });
  assert.equal(imageRef(t, '1.5.0'), 'ghcr.io/sinishadjukic/worca:1.5.0');
  assert.equal(imageRef(t, '1.5.0-rc.2'), 'ghcr.io/sinishadjukic/worca:1.5.0-rc.2');
  assert.equal(imageRef(t, 'ghcr.io/me/worca-e2e:pr-480'), 'ghcr.io/me/worca-e2e:pr-480');
  assert.throws(() => imageRef(t, 'ghcr.io/me/worca:latest'), /not :latest/);
  for (const bad of ['', 'worca', 'ghcr.io/me/worca', 'ghcr.io/me/worca:tag;rm -rf /', '$(id)']) assert.throws(() => imageRef(t, bad), /not an image reference/, bad);
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
      if (q.includes('variableDelete')) return { code: 0, stdout: '{"data":{"variableDelete":true}}' };
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

test('Azure DevOps: the in-container probe reports and tests the token', () => {
  const p = readFileSync(new URL('../tools/railway/in-container-probe.sh', import.meta.url), 'utf8');
  assert.match(p, /broker=%s ado=%s"\}\\n'/, 'the agent prints whether it sees an Azure token');
  assert.match(p, /"\$\{WORCA_BROKER_SECRET:\+set\}" "\$\{WORCA_ADO_TOKEN:\+set\}\$\{WORCA_ADO_READ_TOKEN:\+set\}\$\{WORCA_ADO_WRITE_TOKEN:\+set\}\$\{AZURE_DEVOPS_EXT_PAT:\+set\}"$/m);
  assert.match(p, /"user=worca-agent environ=denied db=denied home=denied gh= app= broker= ado="/, 'the agent sees no Azure token');
  const agent = p.indexOf('console.log(`agent ${r.text}`);');
  const azure = p.indexOf('await import(`${root}/azure-credentials.mjs`)');
  const github = p.indexOf('await import(`${root}/github-credentials.mjs`)');
  assert.ok(agent > 0 && azure > agent && github > azure, 'the Azure check runs before the GitHub block can exit');
  assert.match(p, /azureAuthHeader\('read'\) \|\| azureAuthHeader\('write'\)/, 'a write-only split still authenticates');
  assert.match(p, /'X-TFS-FedAuthRedirect': 'Suppress'/);
  assert.match(p, /console\.log\(`ado FAILED /, 'a rejected fetch is printed, not thrown');
  assert.match(p, /want "Azure DevOps credential works" "\$ado" 200/);
  assert.match(p, /set WORCA_ADO_PROBE_ORG to test the Azure DevOps token/);
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

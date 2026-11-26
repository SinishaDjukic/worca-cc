// test/cli-container-hardened.test.mjs
// `worca container … --hardened` (src/cli/container-hardened.mjs, docs/hardened-box.md): the preflight, the guided
// setup that writes .env, the compose file order, the remembered choice, and the posture report. Docker is stubbed
// (an injected exec, as in cli-container.test.mjs): nothing here starts a container. The compose merge is checked
// by parsing the YAML, and with `docker compose config` where the CLI is installed (it needs no daemon).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { useTempHome } from './helpers/temp-home.mjs';
import { cmdContainer, initDir, COMPOSE_SRC_DIR } from '../src/cli/container.mjs';
import {
  parseHardenedFlags, selectBox, envValue, writeEnvValues, checkPlatform, checkDocker, checkComposeVersion, parseComposeVersion,
  planSetup, normalizeProxy, postureRows, HARDENED_OVERLAYS, SETUP_KEYS,
} from '../src/cli/container-hardened.mjs';
import { DEFAULT_ALLOW } from '../src/core/egress-proxy.mjs';

useTempHome(after);
const tmp = () => mkdtempSync(join(tmpdir(), 'worca-hardened-'));
const KEY = 'sk-ant-api03-SECRETSECRETSECRET';
const TOKEN = 'github_pat_SECRETTOKEN';
const FILES = ['-f', 'compose.yml', '-f', 'compose.broker.yml', '-f', 'compose.isolation.yml', '-f', 'compose.egress.yml', '-f', 'compose.hardened.yml', '-f', 'compose.proxy.yml'];

/** A fake Docker: rootful, Compose 2.39, an image with both labels, no volumes, nothing running, unless `over` says so. */
function fakeDocker(over = {}) {
  const calls = [];
  const exec = (cmd, args, opts = {}) => {
    calls.push({ cmd, args, env: opts.env, input: opts.input });
    const j = args.join(' ');
    const hit = Object.entries(over).find(([k]) => j.includes(k));
    if (hit) return typeof hit[1] === 'function' ? hit[1](args, opts) : { status: 0, stderr: '', ...hit[1] };
    if (cmd === 'git') return { status: 0, stdout: args[2] === 'user.name' ? 'Jane Doe\n' : 'jane@acme.example\n' };
    if (j === 'compose version') return { status: 0, stdout: '' };
    if (j === 'compose version --short') return { status: 0, stdout: '2.39.1-desktop.1\n' };
    if (j.startsWith('info')) return { status: 0, stdout: JSON.stringify({ ServerVersion: '28.3.2', OperatingSystem: 'Docker Desktop', SecurityOptions: ['name=seccomp,profile=builtin'] }) };
    if (j.startsWith('image inspect')) return { status: 0, stdout: '1\n' };
    if (j.startsWith('volume inspect')) return { status: 1, stdout: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls };
}
const io = () => { const lines = []; const fails = []; return { out: (s) => lines.push(s), c: (_n, s) => s, fail: (m) => fails.push(m), lines, fails }; };
const notTty = { isTTY: false };
const quiet = { settings: () => ({}), login: () => null };

test('flags: values, booleans, and no secret on the command line', () => {
  const r = parseHardenedFlags(['--git-host', 'azure', '--allow', 'pypi.org', '--yes', '--no-proxy', '--model-key-file', '/k', 'extra']);
  assert.deepEqual(r.flags, { gitHost: 'azure', allow: 'pypi.org', yes: true, noProxy: true, modelKeyFile: '/k' });
  assert.deepEqual(r.rest, ['extra']);
  for (const bad of ['--model-key', '--git-token=x', '--password', '--proxy-password']) assert.match(parseHardenedFlags([bad, 'v']).error, /ps shows it/, bad);
  assert.match(parseHardenedFlags(['--proxy']).error, /needs a value/);
  assert.match(parseHardenedFlags(['--proxy', 'p:1', '--no-proxy']).error, /contradict/);
  assert.equal(selectBox(null, {}), 'plain');
  assert.equal(selectBox(null, { hardened: true }), 'hardened');
  assert.equal(selectBox('plain', { hardened: true }), 'plain');
  assert.equal(selectBox('hardened', {}), 'hardened');
});

test('preflight: Windows needs WSL2, Docker must run rootful and not be Podman, Compose 2.24+', () => {
  assert.match(checkPlatform({ platform: 'win32' }), /WSL2 shell/);
  assert.equal(checkPlatform({ platform: 'darwin' }), null);
  assert.equal(checkPlatform({ platform: 'linux', readFile: () => 'Linux version 5.15.153.1-microsoft-standard-WSL2' }), null);
  assert.match(checkPlatform({ platform: 'linux', readFile: () => 'Linux version 4.4.0-19041-Microsoft' }), /WSL1/);
  assert.equal(checkPlatform({ platform: 'linux', readFile: () => 'Linux version 6.8.0-generic' }), null);

  assert.match(checkDocker({ exec: fakeDocker().exec, bin: 'podman' }), /Podman and rootless Docker are not/);
  assert.equal(checkDocker({ exec: fakeDocker().exec, bin: 'docker' }), null);
  assert.match(checkDocker({ exec: fakeDocker({ info: { status: 1, stdout: '' } }).exec, bin: 'docker' }), /Docker is not running/);
  assert.match(checkDocker({ exec: fakeDocker({ info: { stdout: JSON.stringify({ SecurityOptions: ['name=seccomp', 'name=rootless'] }) } }).exec, bin: 'docker' }), /rootless/);
  assert.match(checkDocker({ exec: fakeDocker({ info: { stdout: JSON.stringify({ host: { arch: 'amd64' }, version: { Version: '4.9.3', OsArch: 'podman' } }) } }).exec, bin: 'docker' }), /Podman/);

  assert.deepEqual(parseComposeVersion('v2.24.0'), [2, 24, 0]);
  assert.deepEqual(parseComposeVersion('2.39.1-desktop.1'), [2, 39, 1]);
  assert.equal(checkComposeVersion({ exec: fakeDocker().exec, bin: 'docker' }), null);
  assert.match(checkComposeVersion({ exec: fakeDocker({ 'compose version --short': { stdout: '2.23.3' } }).exec, bin: 'docker' }), /2\.23\.3 is too old/);
  assert.equal(checkComposeVersion({ exec: fakeDocker({ 'compose version --short': { stdout: 'v2.24.0' } }).exec, bin: 'docker' }), null);
  assert.match(checkComposeVersion({ exec: fakeDocker({ 'compose version --short': { status: 1, stdout: '' } }).exec, bin: 'docker' }), /cannot read/);
});

test('.env: values the user set stay, empty lines and the example placeholders are filled, mode 0600', () => {
  const dir = tmp();
  try {
    const f = join(dir, '.env');
    writeFileSync(f, 'GIT_AUTHOR_NAME=Your Name\nGH_TOKEN=\nWORCA_EGRESS_SECRET=mine-mine-mine-mine-mine-mine-mine-1\n#HTTPS_PROXY=http://proxy.corp:3128\n');
    assert.equal(envValue(readFileSync(f, 'utf8'), 'GIT_AUTHOR_NAME'), '', 'the placeholder is not a value');
    writeEnvValues(f, [{ key: 'GIT_AUTHOR_NAME', value: 'Jane Doe' }, { key: 'GH_TOKEN', value: TOKEN },
      { key: 'WORCA_EGRESS_SECRET', value: 'other' }, { key: 'HTTPS_PROXY', value: 'http://proxy.acme.example:8080' }]);
    const body = readFileSync(f, 'utf8');
    assert.match(body, /^GIT_AUTHOR_NAME=Jane Doe$/m);
    assert.match(body, /^GH_TOKEN=github_pat_SECRETTOKEN$/m);
    assert.match(body, /^WORCA_EGRESS_SECRET=mine-mine/m, 'a set value is never overwritten');
    assert.doesNotMatch(body, /WORCA_EGRESS_SECRET=other/);
    assert.match(body, /^#HTTPS_PROXY=http:\/\/proxy\.corp:3128$/m, 'a comment stays a comment');
    assert.match(body, /# Hardened box[^\n]*\nHTTPS_PROXY=http:\/\/proxy\.acme\.example:8080\n$/);
    if (process.platform !== 'win32') assert.equal(statSync(f).mode & 0o777, 0o600);
    assert.throws(() => writeEnvValues(f, [{ key: 'X', value: 'a\nb' }]), /line break/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setup without prompts: every answer from flags or the environment; a missing model credential is refused', async () => {
  const none = await planSetup({ body: '', env: {} });
  assert.match(none.error, /no model credential/);

  const dir = tmp();
  try {
    const keyFile = join(dir, 'key'); writeFileSync(keyFile, `${KEY}\n`);
    const tokFile = join(dir, 'tok'); writeFileSync(tokFile, TOKEN);
    const ca = join(dir, 'ca.pem'); writeFileSync(ca, '-----BEGIN CERTIFICATE-----\nMII\n-----END CERTIFICATE-----\n');
    let n = 0;
    const r = await planSetup({ body: 'GIT_AUTHOR_NAME=Your Name\n', env: {}, random: () => `r${++n}`.padEnd(40, 'x'),
      flags: { modelKeyFile: keyFile, gitTokenFile: tokFile, gitHost: 'azure', gitName: 'Jane Doe', gitEmail: 'jane@acme.example',
        allow: 'pypi.org,.files.pythonhosted.org', proxy: 'http://ACME%5Cjdoe:pw@proxy.acme.example:8080', caFile: ca } });
    assert.equal(r.error, undefined);
    const got = Object.fromEntries(r.entries.map((e) => [e.key, e.value]));
    assert.equal(got.WORCA_BROKER_KEY_ANTHROPIC, KEY, 'the key goes to the broker variable');
    assert.equal(got.ANTHROPIC_API_KEY, undefined, 'never to Worca\'s own variables');
    assert.equal(got.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    assert.ok(got.WORCA_BROKER_SECRET.length >= 32 && got.WORCA_EGRESS_SECRET.length >= 32);
    assert.notEqual(got.WORCA_BROKER_SECRET, got.WORCA_EGRESS_SECRET);
    assert.equal(got.WORCA_ADO_TOKEN, TOKEN, 'Azure DevOps: its own token variable');
    assert.equal(got.GIT_AUTHOR_NAME, 'Jane Doe');
    const allow = got.WORCA_EGRESS_ALLOW.split(',');
    for (const h of [...DEFAULT_ALLOW, 'dev.azure.com', '.visualstudio.com', 'vssps.dev.azure.com', 'pypi.org', '.files.pythonhosted.org']) assert.ok(allow.includes(h), h);
    assert.equal(got.HTTPS_PROXY, 'http://proxy.acme.example:8080', 'host and port only: the login never goes to .env');
    assert.ok(r.notes.some((x) => /login in that proxy URL was left out/.test(x)));
    assert.equal(got.WORCA_CA_CERT, ca);
    for (const k of Object.keys(got)) assert.ok(SETUP_KEYS.includes(k), `${k} is a documented setup key`);
    for (const e of r.entries) assert.ok(!String(e.note).includes(KEY) && !String(e.note).includes(TOKEN), 'notes never carry a secret');

    const env = await planSetup({ body: '', env: { WORCA_BROKER_KEY_ANTHROPIC: KEY, GH_TOKEN: TOKEN }, flags: { noProxy: true } });
    const e2 = Object.fromEntries(env.entries.map((e) => [e.key, e.value]));
    assert.equal(e2.WORCA_BROKER_KEY_ANTHROPIC, KEY);
    assert.equal(e2.GH_TOKEN, TOKEN, 'github.com by default, the token from the shell');
    assert.equal(e2.HTTPS_PROXY, undefined);
    assert.equal(e2.WORCA_EGRESS_ALLOW, DEFAULT_ALLOW.join(','));

    const set = await planSetup({ body: `WORCA_BROKER_KEY_ANTHROPIC=${KEY}\nWORCA_BROKER_SECRET=s\nWORCA_EGRESS_SECRET=e\nGH_TOKEN=t\nGIT_AUTHOR_NAME=A\nGIT_AUTHOR_EMAIL=a@b\nWORCA_EGRESS_ALLOW=github.com\nHTTPS_PROXY=http://p:1\nWORCA_CA_CERT=/c\n`,
      env: {}, flags: { allow: 'pypi.org' } });
    assert.deepEqual(set.entries, [], 'nothing to write when everything is set');
    assert.ok(set.notes.some((x) => /add pypi\.org to it yourself/.test(x)));

    assert.match((await planSetup({ body: '', env: { WORCA_BROKER_KEY_ANTHROPIC: KEY }, flags: { gitHost: 'gitlab.com' } })).error, /--git-host must be/);
    assert.match((await planSetup({ body: '', env: { WORCA_BROKER_KEY_ANTHROPIC: KEY }, flags: { noProxy: true, allow: 'bad host' } })).error, /not a host name/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('setup with prompts asks only for what is missing, and secrets on the hidden prompt', async () => {
  const asked = [];
  const answers = { 'Model credential': KEY, 'Git token': TOKEN, 'Extra hosts': 'registry.acme.example', 'Corporate proxy': '' };
  const ask = async (q, o = {}) => { asked.push({ q, hidden: !!o.hidden }); const k = Object.keys(answers).find((x) => q.startsWith(x)); return k ? answers[k] : ''; };
  const r = await planSetup({ body: 'GIT_AUTHOR_NAME=Jane\nGIT_AUTHOR_EMAIL=jane@acme.example\n', env: {}, ask, detectProxy: () => '' });
  assert.equal(r.error, undefined);
  assert.deepEqual(asked.map((x) => x.q.split(' (')[0].split(' [')[0].replace(/: $/, '')), ['Model credential for the broker', 'Git host', 'Git token for github.com', 'Extra hosts for the allow-list, comma-separated', 'Corporate proxy, host:port']);
  assert.equal(asked.find((x) => x.q.startsWith('Model')).hidden, true);
  assert.equal(asked.find((x) => x.q.startsWith('Git token')).hidden, true);
  assert.equal(asked.find((x) => x.q.startsWith('Git host')).hidden, false);
  const got = Object.fromEntries(r.entries.map((e) => [e.key, e.value]));
  assert.ok(got.WORCA_EGRESS_ALLOW.split(',').includes('registry.acme.example'));
  assert.equal(got.GIT_AUTHOR_NAME, undefined, 'set values are not asked again');

  const proxyAsk = async (q) => (q.startsWith('Corporate proxy') ? '' : '');
  const det = await planSetup({ body: `WORCA_BROKER_KEY_ANTHROPIC=${KEY}\nGH_TOKEN=t\nGIT_AUTHOR_NAME=A\nGIT_AUTHOR_EMAIL=a@b\nWORCA_EGRESS_ALLOW=github.com\n`, env: {},
    ask: proxyAsk, detectProxy: () => 'http://proxy.acme.example:8080' });
  assert.equal(det.entries.find((e) => e.key === 'HTTPS_PROXY').value, 'http://proxy.acme.example:8080', 'Enter keeps the detected proxy');
  assert.deepEqual(normalizeProxy('proxy.acme.example:8080'), { url: 'http://proxy.acme.example:8080', hadLogin: false });
  assert.equal(normalizeProxy(''), null);
});

/** A container dir with the setup's values preset, so `up --hardened --yes` needs nothing more. */
async function readyDir() {
  const dir = tmp();
  await initDir(dir, { projects: '/Users/me/dev', exec: fakeDocker().exec });
  return dir;
}

test('up --hardened: checks, writes .env, assembles the files in order, remembers the box; later verbs act on it', async () => {
  const dir = await readyDir();
  try {
    const { exec, calls } = fakeDocker();
    const o = io();
    const env = { WORCA_BROKER_KEY_ANTHROPIC: KEY, GH_TOKEN: TOKEN, PATH: '/usr/bin' };
    assert.equal(await cmdContainer(['up', '--hardened', '--yes', '--no-proxy'], { ...o, exec, dir, env, stdin: notTty, ...quiet }), 0, o.fails.join('\n'));
    const up = calls.find((k) => k.args.at(-2) === 'up' && k.args.at(-1) === '-d');
    assert.deepEqual(up.args, ['compose', ...FILES, 'up', '-d'], 'compose.proxy.yml last, compose.hardened.yml after the overlays it overrides');
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).hardened, true);
    const body = readFileSync(join(dir, '.env'), 'utf8');
    assert.match(body, /^WORCA_BROKER_KEY_ANTHROPIC=sk-ant-api03-SECRET/m);
    assert.match(body, /^WORCA_BROKER_SECRET=\S{32,}$/m);
    assert.match(body, /^WORCA_EGRESS_SECRET=\S{32,}$/m);
    assert.match(body, /^GH_TOKEN=github_pat_SECRETTOKEN$/m);
    if (process.platform !== 'win32') assert.equal(statSync(join(dir, '.env')).mode & 0o777, 0o600);
    const printed = [...o.lines, ...o.fails].join('\n');
    assert.ok(!printed.includes(KEY) && !printed.includes(TOKEN), 'no secret is echoed');
    for (const k of calls) assert.ok(!k.args.join(' ').includes(KEY) && !k.args.join(' ').includes(TOKEN), `no secret on a command line: ${k.args.join(' ')}`);
    assert.ok(calls.some((k) => k.args.join(' ').includes('image inspect --format {{ index .Config.Labels "dev.worca.hardened-box" }}')));
    assert.ok(o.lines.some((l) => /worca container status/.test(l)));

    calls.length = 0;
    assert.equal(await cmdContainer(['down'], { ...io(), exec, dir, env, ...quiet }), 0);
    assert.deepEqual(calls.at(-1).args, ['compose', ...FILES, 'down']);
    calls.length = 0;
    await cmdContainer(['logs'], { ...io(), exec, dir, env, ...quiet });
    assert.deepEqual(calls.at(-1).args, ['compose', ...FILES, 'logs', 'worca']);
    calls.length = 0;
    await cmdContainer(['down', '--plain'], { ...io(), exec, dir, env, ...quiet });
    assert.deepEqual(calls.at(-1).args, ['compose', '-f', 'compose.yml', 'down'], '--plain acts on the plain container this once');
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).hardened, true, '…without changing the remembered box');

    const lo = io();
    assert.equal(await cmdContainer(['login'], { ...lo, exec, dir, env, ...quiet }), 1);
    assert.match(lo.fails[0], /keeps no Claude sign-in/);

    calls.length = 0;
    assert.equal(await cmdContainer(['up', '--plain'], { ...io(), exec, dir, env, ...quiet }), 0);
    assert.equal(JSON.parse(readFileSync(join(dir, '.worca-container.json'), 'utf8')).hardened, false, 'up --plain is the undo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('up --hardened refuses: --with ssh, a missing key, Podman, an old image, a sign-in left on the volume, a running plain box', async () => {
  const env = { WORCA_BROKER_KEY_ANTHROPIC: KEY, PATH: '/usr/bin' };
  const run = async (argv, over = {}, e = env) => {
    const dir = await readyDir();
    const o = io();
    try { return { code: await cmdContainer(argv, { ...o, exec: fakeDocker(over).exec, dir, env: e, stdin: notTty, ...quiet }), ...o }; } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  let r = await run(['up', '--hardened', '--with', 'ssh', '--yes']);
  assert.equal(r.code, 2); assert.match(r.fails[0], /ssh-agent overlay is refused/);
  r = await run(['up', '--hardened', '--yes', '--no-proxy'], {}, { PATH: '/usr/bin' });
  assert.equal(r.code, 1); assert.match(r.fails[0], /no model credential/);
  r = await run(['up', '--hardened', '--yes', '--runtime', 'podman'], { 'compose version': (args) => ({ status: args[0] === 'compose' && args.length === 2 ? 0 : 0, stdout: '' }) });
  assert.equal(r.code, 1); assert.match(r.fails[0], /Podman/);
  r = await run(['up', '--hardened', '--yes', '--no-proxy'], { 'image inspect': { stdout: '\n' } });
  assert.equal(r.code, 1); assert.match(r.fails[0], /older than these compose files/);
  r = await run(['up', '--hardened', '--yes', '--no-proxy'], { 'volume inspect': { status: 0 }, '--entrypoint sh': { stdout: '/data/home/.claude/.credentials.json\n' } });
  assert.equal(r.code, 1); assert.match(r.fails[0], /sign-in is left on the box's volume.*: \/data\/home\/\.claude\/\.credentials\.json/);
  r = await run(['up', '--hardened', '--yes', '--no-proxy'], { 'ps -q --filter label=com.docker.compose.project=worca': (args) => ({ status: 0, stdout: args.at(-1).endsWith('=worca') ? 'abc\n' : '' }) });
  assert.equal(r.code, 1); assert.match(r.fails[0], /plain container is running/);
});

test('up --hardened from a plain install: says the data is not carried over, leaves the old volumes alone', async () => {
  const dir = await readyDir();
  try {
    const { exec, calls } = fakeDocker({ 'volume ls -q': { stdout: 'worca_worca-home\nworca_claude-config\n' } });
    const o = io();
    assert.equal(await cmdContainer(['up', '--hardened', '--yes', '--no-proxy'], { ...o, exec, dir, env: { WORCA_BROKER_KEY_ANTHROPIC: KEY }, stdin: notTty, ...quiet }), 0, o.fails.join('\n'));
    assert.ok(o.lines.some((l) => /worca_worca-home, worca_claude-config\) is not carried over/.test(l)));
    assert.ok(!calls.some((k) => /volume rm|down -v|--volumes/.test(k.args.join(' '))), 'nothing removes a volume');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('up --hardened with a proxy and --proxy-user: the login goes to the sidecar on stdin before Worca starts', async () => {
  const dir = await readyDir();
  try {
    const { exec, calls } = fakeDocker();
    const o = io();
    const { Readable } = await import('node:stream');
    const stdin = Readable.from(['Secr3t-pass\n']); stdin.isTTY = false;
    assert.equal(await cmdContainer(['up', '--hardened', '--yes', '--proxy', 'proxy.acme.example:8080', '--proxy-user', 'ACME\\jdoe'],
      { ...o, exec, dir, env: { WORCA_BROKER_KEY_ANTHROPIC: KEY }, stdin, ...quiet }), 0, o.fails.join('\n'));
    assert.doesNotMatch(readFileSync(join(dir, '.env'), 'utf8'), /^[^#\n]*jdoe|Secr3t/m, 'the proxy login never reaches .env');
    const login = calls.findIndex((k) => k.args.includes('egress') && k.args.includes('login'));
    const up = calls.findIndex((k) => k.args.at(-2) === 'up' && k.args.at(-1) === '-d');
    assert.ok(login >= 0 && login < up, 'login first, then the box');
    assert.equal(calls[login].input, 'ACME\\jdoe\nSecr3t-pass\n', 'piped on stdin');
    assert.ok(!calls.some((k) => k.args.join(' ').includes('Secr3t')), 'never an argument');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── Posture ──────────────────────────────────────────────────────────────────────────────────────

const running = { Running: true };
function box(over = {}) {
  const worcaEnv = { WORCA_DATA_DIR: '/data', WORCA_BROKER_URL: 'http://broker:8080', HTTPS_PROXY: 'http://egress:3128', HTTP_PROXY: 'http://egress:3128', ANTHROPIC_API_KEY: '', ...(over.worcaEnv || {}) };
  return {
    containers: {
      worca: { State: running, Config: { Env: Object.entries(worcaEnv).map(([k, v]) => `${k}=${v}`) }, NetworkSettings: { Networks: { 'worca-hardened_internal': {} , ...(over.nets || {}) } },
        Mounts: [{ Type: 'volume', Destination: '/data', RW: true }, ...(over.mounts || [])] },
      broker: { State: over.brokerDown ? { Running: false } : running, Config: { Env: ['WORCA_BROKER_MODE=single'] } },
      egress: { State: running, Config: { Env: ['WORCA_EGRESS_ALLOWLIST=1'] } },
      ui: { State: running, Config: { Env: [] } },
    },
    networks: [{ Name: 'worca-hardened_internal', Internal: true }, { Name: 'worca-hardened_default', Internal: false }],
    sidecar: 'sidecar' in over ? over.sidecar : { state: 'not-configured', policy: { mode: 'allowlist', allow: [...DEFAULT_ALLOW] } },
    logs: over.logs ?? "worca-entrypoint: agents run as worca-agent; they cannot read worca's settings, database or environment\n[worca-ui] credentials: broker single, slots anthropic\n",
  };
}

test('posture: every protection on, read from the running box', () => {
  const p = postureRows(box());
  assert.equal(p.running, true);
  assert.deepEqual(p.rows.map((r) => [r.id, r.status]), [['agents', 'on'], ['model-key', 'on'], ['proxy-login', 'on'], ['allowlist', 'on'], ['no-host-mount', 'on']]);
  assert.ok(p.rows.every((r) => !r.fix));
  const ca = postureRows(box({ mounts: [{ Type: 'bind', Destination: '/etc/worca/corporate-ca.pem', RW: false }] }));
  assert.equal(ca.rows.find((r) => r.id === 'no-host-mount').status, 'on', 'the read-only CA file is not a project mount');
  const login = postureRows(box({ sidecar: { state: 'ready', upstream: 'proxy.acme.example:8080', login: { label: 'ACME\\jdoe' }, policy: { mode: 'allowlist', allow: ['github.com'] } } }));
  assert.match(login.rows.find((r) => r.id === 'proxy-login').detail, /sidecar holds the login for proxy\.acme\.example:8080 \(ACME\\jdoe\)/);
});

test('posture: each protection that is off says so and how to fix it', () => {
  const off = (o, id) => { const r = postureRows(box(o)).rows.find((x) => x.id === id); assert.notEqual(r.status, 'on', id); assert.ok(r.fix, `${id} has a fix`); return r; };
  assert.match(off({ logs: 'worca-entrypoint: cannot start commands as worca-agent (sudo refused); agents run as worca instead\n[worca-ui] credentials: broker single' }, 'agents').detail, /as Worca itself/);
  assert.equal(off({ logs: '[worca-ui] credentials: broker single' }, 'agents').status, 'unknown');
  assert.match(off({ worcaEnv: { ANTHROPIC_API_KEY: 'sk-ant-x' } }, 'model-key').detail, /ANTHROPIC_API_KEY is set/);
  assert.match(off({ brokerDown: true }, 'model-key').detail, /broker is not running/);
  assert.match(off({ worcaEnv: { HTTPS_PROXY: 'http://ACME%5Cjdoe:pw@proxy:8080' } }, 'proxy-login').detail, /with a login in it/);
  assert.match(off({ sidecar: { state: 'needs-login', upstream: 'proxy:8080', policy: { mode: 'allowlist' } } }, 'proxy-login').fix, /worca container proxy login/);
  assert.match(off({ sidecar: { state: 'needs-login', managed: true, upstream: 'proxy:8080', policy: { mode: 'allowlist' } } }, 'proxy-login').fix, /operator manages this login: replace the login file/);
  assert.match(off({ nets: { 'worca-hardened_default': {} } }, 'allowlist').detail, /route out \(worca-hardened_default\)/);
  assert.match(off({ sidecar: { state: 'not-configured', policy: { mode: 'open' } } }, 'allowlist').detail, /open mode/);
  assert.match(off({ mounts: [{ Type: 'bind', Destination: '/Users/me/dev', RW: true }] }, 'no-host-mount').detail, /\/Users\/me\/dev/);
  const down = postureRows({ containers: { worca: { State: { Running: false } } }, logs: 'worca: the credential broker is on, but model credentials are still reachable by agents:\n' });
  assert.equal(down.running, false);
  assert.match(down.reason, /credential broker is on/);
});

test('status on the hardened box: the report, --json, and exit codes', async () => {
  const dir = await readyDir();
  try {
    writeFileSync(join(dir, '.worca-container.json'), JSON.stringify({ hardened: true }));
    const b = box();
    const inspect = Object.entries(b.containers).map(([svc, c]) => ({ ...c, Config: { ...c.Config, Labels: { 'com.docker.compose.service': svc } } }));
    const { exec, calls } = fakeDocker({
      'ps -a --format json': { stdout: ['worca', 'broker', 'egress', 'ui'].map((s) => JSON.stringify({ Name: `worca-hardened-${s}-1`, Service: s })).join('\n') },
      'network inspect': { stdout: JSON.stringify(b.networks) },
      'egress status --json': { stdout: JSON.stringify(b.sidecar) },
      'logs --no-log-prefix': { stdout: b.logs },
      'inspect worca-hardened': { stdout: JSON.stringify(inspect) },
    });
    const o = io();
    assert.equal(await cmdContainer(['status'], { ...o, exec, dir, env: {}, ...quiet }), 0, o.lines.join('\n'));
    assert.ok(o.lines.some((l) => /on\s+Agents run under their own users/.test(l)));
    assert.ok(calls.every((k) => !k.args.includes('ps') || k.args.includes('--format') || k.args.includes('-q')));
    const j = io();
    assert.equal(await cmdContainer(['status', '--json'], { ...j, exec, dir, env: {}, ...quiet }), 0);
    const doc = JSON.parse(j.lines.at(-1));
    assert.equal(doc.box, 'hardened'); assert.equal(doc.ok, true);
    assert.deepEqual(doc.protections.map((x) => x.id), ['agents', 'model-key', 'proxy-login', 'allowlist', 'no-host-mount']);
    const stopped = fakeDocker({ 'ps -a --format json': { stdout: '' } });
    assert.equal(await cmdContainer(['status'], { ...io(), exec: stopped.exec, dir, env: {}, ...quiet }), 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── The compose merge ────────────────────────────────────────────────────────────────────────────

const tags = [
  { tag: '!override', collection: 'seq', resolve: (v) => ({ override: v.toJSON ? v.toJSON() : v }) },
  { tag: '!reset', collection: 'seq', resolve: () => ({ reset: true }) },
];
const load = (f) => parseYaml(readFileSync(join(COMPOSE_SRC_DIR, f), 'utf8'), { customTags: tags });

test('compose.hardened.yml: its own project, the data volume only, the port on the relay, the broker through the sidecar', () => {
  const h = load('compose.hardened.yml');
  assert.equal(h.name, 'worca-hardened');
  assert.deepEqual(h.services.worca.volumes, { override: ['worca-data:/data'] }, 'every host mount from compose.yml is replaced');
  assert.deepEqual(h.services.worca.ports, { reset: true });
  assert.equal(h.services.worca.environment.WORCA_UI_RELAY, 'ui');
  assert.deepEqual(h.services.ui.ports, ['127.0.0.1:${WORCA_PORT:-4317}:4317'], 'loopback only');
  assert.deepEqual(h.services.ui.networks, ['internal', 'default']);
  assert.equal(h.services.ui.environment.WORCA_UI_RELAY_REFUSE, undefined, 'an allow-list in the relay, no refuse list');
  assert.match(h.services.ui.entrypoint.join(' '), /node \/usr\/local\/lib\/node_modules\/@worca\/app\/src\/core\/ui-relay\.mjs$/);
  assert.ok(h.services.ui.cap_drop.includes('ALL'));
  assert.equal(h.services.broker.environment.HTTPS_PROXY, 'http://egress:3128');
  assert.deepEqual(HARDENED_OVERLAYS, ['broker', 'isolation', 'egress', 'hardened', 'proxy']);
  for (const o of HARDENED_OVERLAYS) assert.ok(load(`compose.${o}.yml`), `compose.${o}.yml parses`);
  assert.equal(load('compose.isolation.yml').volumes['worca-data'], null, 'the volume it uses is declared');
  assert.equal(load('compose.egress.yml').networks.internal.internal, true);
});

/** The shell's env (HOME keeps the compose plugin findable) without what compose would interpolate over .env. */
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?_proxy|no_proxy|WORCA_|GH_TOKEN|ANTHROPIC_|CLAUDE_CODE_)/i.test(k)));

test('docker compose config: the merged hardened box (skipped without the docker CLI; it needs no daemon)', (t) => {
  if (spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status !== 0) { t.skip('no docker compose CLI'); return; }
  const dir = tmp();
  try {
    for (const f of readdirSync(COMPOSE_SRC_DIR)) if (/^compose(\.[a-z]+)?\.yml$/.test(f)) copyFileSync(join(COMPOSE_SRC_DIR, f), join(dir, f));
    writeFileSync(join(dir, '.env'), `WORCA_BROKER_SECRET=${'a'.repeat(40)}\nWORCA_EGRESS_SECRET=${'b'.repeat(40)}\nWORCA_BROKER_KEY_ANTHROPIC=sk-ant-x\n`);
    const r = spawnSync('docker', ['compose', ...FILES, 'config', '--format', 'json'], { cwd: dir, encoding: 'utf8', env: cleanEnv() });
    assert.equal(r.status, 0, r.stderr);
    const c = JSON.parse(r.stdout);
    assert.equal(c.name, 'worca-hardened');
    const w = c.services.worca;
    assert.deepEqual(w.volumes.map((v) => `${v.type}:${v.source}:${v.target}`), ['volume:worca-data:/data'], 'no host folder');
    assert.ok(!w.ports || w.ports.length === 0);
    assert.deepEqual(Object.keys(w.networks), ['internal']);
    assert.equal(c.networks.internal.internal, true);
    assert.equal(w.environment.WORCA_BROKER_URL, 'http://broker:8080');
    assert.equal(w.environment.ANTHROPIC_API_KEY, '');
    assert.equal(w.environment.CLAUDE_CODE_OAUTH_TOKEN, '');
    assert.equal(w.environment.HTTPS_PROXY, 'http://egress:3128');
    assert.equal(w.user, '0:0');
    assert.deepEqual(c.services.egress.command, ['worca', 'egress']);
    assert.equal(c.services.egress.environment.WORCA_EGRESS_ALLOWLIST, '1');
    assert.equal(c.services.ui.ports[0].host_ip, '127.0.0.1');
    assert.equal(c.services.broker.environment.WORCA_BROKER_KEY_ANTHROPIC, 'sk-ant-x');
    assert.equal(c.services.broker.environment.HTTPS_PROXY, 'http://egress:3128');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

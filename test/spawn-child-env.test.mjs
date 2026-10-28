// test/spawn-child-env.test.mjs
// One allowlist child env for every engine, local and remote (src/core/spawn.mjs childEnv,
// plans/core-protection-layer-design.md §4.1): exact names only, the sign-in a mode needs, the git ceiling and PWD,
// and the one run-log line that names what was withheld.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter } from 'node:path';
import { childEnv, formatDropped } from '../src/core/spawn.mjs';
import { ENGINES } from '../src/shared/engine-switch.mjs';
import { resolveModelRoute } from '../src/core/exec-env/credentials.mjs';
import { scriptBaseEnv } from '../src/core/graph/script-runner.mjs';
import { terminalEnv } from '../src/core/terminal/context.mjs';
import { actionBaseEnv } from '../src/core/actions/spawn.mjs';
import { scrubbedEnv } from '../src/core/plugin-shim.mjs';

const BASE = { PATH: 'p', HOME: 'h', COPILOT_ALLOW_ALL: '1', COPILOT_HOME: '/c', OPENAI_API_KEY: 'k' };

test('exact names only', () => {
  const { env, dropped } = childEnv({ kind: 'engine', engine: 'copilot', cwd: '/w', root: '/w', base: BASE });
  assert.equal(env.COPILOT_ALLOW_ALL, undefined);
  assert.equal(env.OPENAI_API_KEY, undefined, "another engine's credential");
  assert.equal(env.COPILOT_HOME, '/c', 'its own sign-in dir');
  assert.ok(dropped.includes('COPILOT_ALLOW_ALL') && dropped.includes('OPENAI_API_KEY'));
});

// ── guards that refuse or withhold (each fails with its guard reverted) ─────────────────────────────────────────────

test('an unknown child kind is refused, never given the engine allowlist', () => {
  for (const kind of ['bogus', 'toString']) assert.throws(() => childEnv({ kind, base: { PATH: 'p' } }), /childEnv: unknown kind/, kind);
});

test('an unknown engine is refused before any env is built, local and remote', () => {
  assert.throws(() => childEnv({ engine: 'nope', base: { PATH: 'p' } }), /unknown engine "nope"/);
  assert.throws(() => childEnv({ engine: 'nope', remote: true, base: { PATH: 'p' } }), /unknown engine "nope"/);
});

test('remote: an engine\'s own secret-named catalog name stays on the host', () => {
  const own = Object.entries(ENGINES).flatMap(([e, x]) => x.env.names.filter((n) => /_(TOKEN|SECRET|KEY)$/i.test(n)).map((n) => [e, n]));
  assert.ok(own.length, 'the catalog holds a secret-named engine name to test with');
  for (const [engine, k] of own) {
    const { env } = childEnv({ engine, remote: true, base: { [k]: 'v', LANG: 'C' } });
    assert.equal(env[k], undefined, `${engine}: ${k}`);
    assert.equal(env.LANG, 'C', `${engine}: a common name still passes`);
  }
});

test('remote: no broker name enters a sandbox, even a declared one', () => {
  const { env } = childEnv({ engine: 'claude', remote: true, declared: ['WORCA_BROKER_URL', 'WORCA_BROKER_SLOT'],
    base: { WORCA_BROKER_URL: 'http://127.0.0.1:9', WORCA_BROKER_SLOT: 's1' } });
  assert.equal(env.WORCA_BROKER_URL, undefined);
  assert.equal(env.WORCA_BROKER_SLOT, undefined);
});

test('remote: the run env and the overlay go through the sandbox filter too', () => {
  const { env } = childEnv({ engine: 'claude', remote: true, base: {},
    runEnv: { HOME: '/h', WORCA_HOME: '/wh', WORCA_BROKER_URL: 'http://127.0.0.1:9', MY_FLAG: '1' },
    overlay: { PATH: '/host/bin', GH_HOST: 'github.example' } });
  for (const k of ['HOME', 'WORCA_HOME', 'WORCA_BROKER_URL', 'PATH', 'GH_HOST']) assert.equal(env[k], undefined, k);
  assert.equal(env.MY_FLAG, '1', 'a declared run-env name that is no host name passes');
});

test('same answer remote', () => {
  const { env } = childEnv({ kind: 'engine', engine: 'copilot', remote: true, base: { ...BASE, COPILOT_AUTO_UPDATE: 'false' } });
  assert.equal(env.COPILOT_ALLOW_ALL, undefined);
  assert.equal(env.COPILOT_HOME, undefined, 'a host path never enters a sandbox');
  assert.equal(env.COPILOT_AUTO_UPDATE, 'false');
});

test('ceiling and PWD', () => {
  const a = childEnv({ engine: 'claude', cwd: '/runs/r1/work/sub', root: '/runs/r1/work', base: { PATH: 'p' } }).env;
  assert.equal(a.GIT_CEILING_DIRECTORIES, '/runs/r1');
  assert.equal(a.PWD, '/runs/r1/work/sub');
  const b = childEnv({ engine: 'claude', root: '/runs/r1/work', runEnv: { GIT_CEILING_DIRECTORIES: '/x' }, base: { PATH: 'p' } }).env;
  assert.equal(b.GIT_CEILING_DIRECTORIES, `/runs/r1${delimiter}/x`, 'an existing ceiling is kept');
  assert.equal(childEnv({ engine: 'claude', base: { PATH: 'p' } }).env.GIT_CEILING_DIRECTORIES, undefined, 'no root, no ceiling');
});

test('claude keeps HOME, USER, LOGNAME and PATH for every sign-in mode', () => {
  const base = { HOME: '/h', USER: 'u', LOGNAME: 'u', PATH: '/bin' };
  for (const { id } of ENGINES.claude.signIn.modes) {
    const { env } = childEnv({ engine: 'claude', signInMode: id, base });
    for (const k of Object.keys(base)) assert.ok(k in env, `${id}: ${k}`);
  }
  assert.ok('HOME' in childEnv({ engine: 'claude', signInMode: 'relayed', base }).env, 'a relayed spawn too');
});

test('subscription token survives only for its mode', () => {
  const base = { PATH: 'p', CLAUDE_CODE_OAUTH_TOKEN: 't', ANTHROPIC_API_KEY: 'k' };
  const oauth = childEnv({ engine: 'claude', signInMode: 'oauth-env', base }).env;
  assert.equal(oauth.CLAUDE_CODE_OAUTH_TOKEN, 't');
  assert.equal(oauth.ANTHROPIC_API_KEY, undefined, 'the unpicked credential');
  const relayed = childEnv({ engine: 'claude', signInMode: 'relayed', base }).env;
  assert.equal(relayed.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(childEnv({ engine: 'claude', base }).env.CLAUDE_CODE_OAUTH_TOKEN, 't', 'no mode named yet: every mode\'s names');
});

test('a key mode keeps the engine\'s session dir', () => {
  const codex = childEnv({ engine: 'codex', signInMode: 'api-key', base: { PATH: 'p', CODEX_HOME: '/c', CODEX_API_KEY: 'a', OPENAI_API_KEY: 'b' } }).env;
  assert.equal(codex.CODEX_HOME, '/c');
  assert.equal(codex.CODEX_API_KEY, 'a');
  assert.equal(codex.OPENAI_API_KEY, undefined, 'the other mode\'s credential');
  for (const [engine, mode, dir, key] of [['claude', 'oauth-env', 'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_OAUTH_TOKEN'],
    ['copilot', 'token', 'COPILOT_HOME', 'COPILOT_GITHUB_TOKEN'], ['cursor', 'api-key', 'CURSOR_CONFIG_DIR', 'CURSOR_API_KEY']]) {
    const env = childEnv({ engine, signInMode: mode, base: { PATH: 'p', [dir]: '/d', [key]: 'k' } }).env;
    assert.equal(env[dir], '/d', `${engine}/${mode}: ${dir}`);
    assert.equal(env[key], 'k', `${engine}/${mode}: ${key}`);
  }
});

test('undeclared credentials are dropped in every named mode', () => {
  const ids = (e) => [...ENGINES[e].signIn.modes.map((m) => m.id), 'relayed', 'brokered'];
  const copilotBase = { PATH: 'p', COPILOT_PROVIDER_API_KEY: 'pk', COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:1' };
  for (const id of ids('copilot')) {
    const env = childEnv({ engine: 'copilot', signInMode: id, base: copilotBase }).env;
    assert.equal('COPILOT_PROVIDER_API_KEY' in env, id === 'provider-key', `copilot/${id}: COPILOT_PROVIDER_API_KEY`);
    assert.equal(env.COPILOT_PROVIDER_BASE_URL, 'http://127.0.0.1:1', `copilot/${id}: config stays`);
    const bearer = childEnv({ engine: 'copilot', signInMode: id, allowlist: ['COPILOT_PROVIDER_BEARER_TOKEN'], base: { ...copilotBase, COPILOT_PROVIDER_BEARER_TOKEN: 'bt' } }).env;
    assert.equal(bearer.COPILOT_PROVIDER_BEARER_TOKEN, undefined, `copilot/${id}: COPILOT_PROVIDER_BEARER_TOKEN, even allowlisted`);
  }
  for (const id of ids('cursor')) {
    const env = childEnv({ engine: 'cursor', signInMode: id, base: { PATH: 'p', CURSOR_AUTH_TOKEN: 'at' } }).env;
    assert.equal(env.CURSOR_AUTH_TOKEN, undefined, `cursor/${id}: CURSOR_AUTH_TOKEN`);
  }
});

test('a run-env credential of another mode is dropped', () => {
  const { env, dropped } = childEnv({ engine: 'codex', signInMode: 'api-key', runEnv: { OPENAI_API_KEY: 'r' }, allowlist: ['OPENAI_API_KEY'],
    base: { PATH: 'p', CODEX_API_KEY: 'a', OPENAI_API_KEY: 'b' } });
  assert.equal(env.CODEX_API_KEY, 'a');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.ok(dropped.includes('OPENAI_API_KEY'), 'named in the run log');
});

test('a brokered mode keeps only the overlay\'s token', () => {
  const { env, dropped } = childEnv({ engine: 'claude', signInMode: 'brokered', runEnv: { ANTHROPIC_API_KEY: 'run', OPENAI_API_KEY: 'o' },
    allowlist: ['AWS_ACCESS_KEY_ID'], overlay: { ANTHROPIC_AUTH_TOKEN: 'wbt_x' },
    base: { PATH: 'p', CLAUDE_CODE_OAUTH_TOKEN: 't', AWS_ACCESS_KEY_ID: 'aws' } });
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, 'wbt_x');
  for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'AWS_ACCESS_KEY_ID']) assert.equal(env[k], undefined, k);
  assert.ok(dropped.includes('CLAUDE_CODE_OAUTH_TOKEN'));
  assert.ok(dropped.includes('AWS_ACCESS_KEY_ID'));
  // Every engine's credentials, not only the spawn's own (D10): a Copilot PAT or a Cursor key that a project allowlists
  // for its Copilot or Cursor runs never reaches a brokered Claude or Codex agent, from the allowlist or the run env.
  const others = ['COPILOT_GITHUB_TOKEN', 'COPILOT_PROVIDER_API_KEY', 'CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN', 'CODEX_API_KEY'];
  for (const [engine, overlay] of [['claude', { ANTHROPIC_AUTH_TOKEN: 'wbt_c' }], ['codex', { OPENAI_API_KEY: 'wbt_o' }]]) {
    const viaAllowlist = childEnv({ engine, signInMode: 'brokered', allowlist: others, overlay,
      base: { PATH: 'p', ...Object.fromEntries(others.map((k) => [k, `w-${k}`])) } });
    const viaRunEnv = childEnv({ engine, signInMode: 'brokered', overlay, base: { PATH: 'p' },
      runEnv: Object.fromEntries(others.map((k) => [k, `r-${k}`])) });
    for (const k of others) {
      if (Object.hasOwn(overlay, k)) continue;
      assert.equal(viaAllowlist.env[k], undefined, `${engine}: ${k} from the allowlist`);
      assert.equal(viaRunEnv.env[k], undefined, `${engine}: ${k} from the run env`);
      assert.ok(viaRunEnv.dropped.includes(k), `${engine}: ${k} from the run env is named in the run log`);
    }
    for (const [k, v] of Object.entries(overlay)) assert.equal(viaRunEnv.env[k], v, `${engine}: the broker token`);
  }
});

test('copilot with a token and a configured provider keeps the provider key', () => {
  const base = { PATH: 'p', COPILOT_GITHUB_TOKEN: 'g', COPILOT_PROVIDER_BASE_URL: 'http://127.0.0.1:1', COPILOT_PROVIDER_API_KEY: 'pk', COPILOT_PROVIDER_TYPE: 'openai' };
  const d = resolveModelRoute({ engine: 'copilot', serverEnv: base, broker: { on: false } });
  assert.equal(d.signInMode, 'provider-key');
  const env = childEnv({ engine: 'copilot', signInMode: d.signInMode, base }).env;
  for (const k of ['COPILOT_PROVIDER_BASE_URL', 'COPILOT_PROVIDER_API_KEY', 'COPILOT_PROVIDER_TYPE']) assert.equal(env[k], base[k], k);
  assert.equal(env.COPILOT_GITHUB_TOKEN, undefined);
  const { COPILOT_PROVIDER_BASE_URL: _url, ...noBase } = base;
  assert.equal(resolveModelRoute({ engine: 'copilot', serverEnv: noBase, broker: { on: false } }).signInMode, 'token');
});

test('drops cloud vars with a named run-log line', () => {
  assert.equal(formatDropped('claude', ['AWS_PROFILE']), 'env: 1 variable not passed to claude (allowlist): AWS_PROFILE');
  assert.equal(formatDropped('codex', ['A', 'B']), 'env: 2 variables not passed to codex (allowlist): A, B');
  assert.equal(formatDropped('codex', []), null);
  const base = { PATH: 'p', AWS_PROFILE: 'prod' };
  assert.deepEqual(childEnv({ engine: 'claude', base }).dropped, ['AWS_PROFILE']);
  assert.equal(childEnv({ engine: 'claude', allowlist: ['AWS_PROFILE'], base }).env.AWS_PROFILE, 'prod', 'an allowlist keeps it');
});

test('never a host credential or broker secret', () => {
  const base = { PATH: 'p', GH_TOKEN: 'ghp_x', WORCA_BROKER_SECRET: 'b', WORCA_BROKER_SECRET_FILE: '/s', E2B_API_KEY: 'e2b_k' };
  const { env } = childEnv({ engine: 'claude', allowlist: Object.keys(base), base, overlay: { GH_TOKEN: 'from-model' } });
  for (const k of ['GH_TOKEN', 'WORCA_BROKER_SECRET', 'WORCA_BROKER_SECRET_FILE', 'E2B_API_KEY']) assert.equal(env[k], undefined, k);
});

// ── the other child kinds (design §4.1: script, terminal, plugin, git) ──────────────────────────────────────────────

const HOSTY = { PATH: '/bin', HOME: '/h', GOPATH: '/go', GH_TOKEN: 'ghp_x', E2B_API_KEY: 'e2b_x', WORCA_BROKER_SECRET: 'b',
  WORCA_BROKER_SECRET_FILE: '/s', WORCA_HOME: '/wh', PORT: '4317' };

test('terminal: the whole env minus credentials, the broker secret and the names it strips; kept names come back', () => {
  const { env } = childEnv({ kind: 'terminal', base: HOSTY, strip: ['WORCA_HOME', 'PORT'], keep: ['E2B_API_KEY'],
    overlay: { TERM: 'dumb', PORT: '1' }, cwd: '/w', root: '/runs/r1/work' });
  assert.equal(env.GOPATH, '/go', 'a user var passes: the terminal is the person\'s shell');
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.WORCA_BROKER_SECRET, undefined);
  assert.equal(env.WORCA_BROKER_SECRET_FILE, undefined);
  assert.equal(env.WORCA_HOME, undefined);
  assert.equal(env.PORT, undefined, 'a stripped name stays out, even when the overlay sets it');
  assert.equal(env.E2B_API_KEY, 'e2b_x', 'a kept name survives the credential strip');
  assert.equal(env.TERM, 'dumb');
  assert.equal(env.PWD, '/w');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/runs/r1');
});

test('script: an allowlist with envScrub, the whole env (minus credentials) without', () => {
  assert.equal(childEnv({ kind: 'script', base: HOSTY }).env.GOPATH, undefined);
  const open = childEnv({ kind: 'script', inherit: true, base: HOSTY }).env;
  assert.equal(open.GOPATH, '/go');
  assert.equal(open.GH_TOKEN, undefined);
  assert.equal(open.WORCA_BROKER_SECRET, undefined);
  assert.throws(() => childEnv({ kind: 'engine', engine: 'claude', inherit: true, base: HOSTY }), /cannot inherit/);
  assert.throws(() => childEnv({ kind: 'plugin', inherit: true, base: HOSTY }), /cannot inherit/);
});

test('git: the whole env minus credentials and git\'s location variables, never above dirname(root)', () => {
  const { env } = childEnv({ kind: 'git', root: '/runs/r1/work', base: { ...HOSTY, GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/i' } });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_WORK_TREE, undefined);
  assert.equal(env.GIT_INDEX_FILE, undefined);
  assert.equal(env.GH_TOKEN, undefined);
  assert.equal(env.WORCA_BROKER_SECRET, undefined);
  assert.equal(env.GOPATH, '/go');
  assert.equal(env.GIT_CEILING_DIRECTORIES, '/runs/r1');
  assert.throws(() => childEnv({ kind: 'git', remote: true, base: HOSTY }), /no sandbox env/, 'only an allowlist kind runs in a sandbox');
});

test('terminal, actions and git: no secret-shaped name and none of worca\'s config; ssh, gpg and the proxy stay (audit 3.4)', () => {
  const secrets = { WORCA_HEARTBEAT_TOKEN: 'hb', WORCA_RELAY_KEY: 'rk', WORCA_CODEX_PROVIDER_KEY: 'pk', WORCA_SOME_SETTING: '1',
    ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', CLAUDE_CODE_OAUTH_TOKEN: 'c', COPILOT_GITHUB_TOKEN: 'g', CURSOR_API_KEY: 'cu',
    AWS_ACCESS_KEY_ID: 'id', AWS_SECRET_ACCESS_KEY: 's', AWS_SESSION_TOKEN: 't', NPM_TOKEN: 'n', DB_PASSWORD: 'pw',
    GOOGLE_APPLICATION_CREDENTIALS: '/g.json', gh_token: 'lower', worca_heartbeat_token: 'lower' };
  const machine = { SSH_AUTH_SOCK: '/s.sock', GIT_ASKPASS: '/askpass', GNUPGHOME: '/gpg', HTTPS_PROXY: 'http://p:3128',
    WORCA_CORPORATE_PROXY_URL: 'http://p:3128', MAX_OUTPUT_TOKENS: '9', GOPATH: '/go' };
  const base = { ...HOSTY, ...secrets, ...machine };
  for (const [name, env] of [
    ['git', childEnv({ kind: 'git', base }).env],
    ['terminal', childEnv({ kind: 'terminal', base }).env],
    ['terminal pane', terminalEnv({ base, sessionId: 's', mode: 'pty', cwd: '/w' })],
    ['action', actionBaseEnv(base)],
  ]) {
    for (const k of Object.keys(secrets)) assert.equal(env[k], undefined, `${name}: ${k}`);
    for (const [k, v] of Object.entries(machine)) assert.equal(env[k], v, `${name}: ${k}`);
  }
  const pane = terminalEnv({ base, sessionId: 's', mode: 'pty', cwd: '/w' });
  assert.equal(pane.E2B_API_KEY, 'e2b_x', 'the person\'s pane keeps the backend keys it names');
  assert.equal(pane.WORCA_TERMINAL_SESSION, 's', 'worca\'s own facts for the terminal still come through');
  const kept = childEnv({ kind: 'terminal', base, keep: ['NPM_TOKEN'], overlay: { WORCA_RUN_ID: 'r1' } }).env;
  assert.equal(kept.NPM_TOKEN, 'n', 'a kept name comes back');
  assert.equal(kept.WORCA_RUN_ID, 'r1', 'an overlay name is worca\'s own decision');
  assert.equal(childEnv({ kind: 'script', inherit: true, base }).env.ANTHROPIC_API_KEY, 'a', 'envScrub off: the script inherits as asked');
});

test('plugin: PATH, HOME, the proxy and CA names (no proxy URL that carries credentials), the Windows baseline', () => {
  assert.deepEqual(childEnv({ kind: 'plugin', base: { ...HOSTY, HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'l' } }).env,
    { PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'http://p:3128', NO_PROXY: 'l' });
  assert.deepEqual(childEnv({ kind: 'plugin', base: { PATH: '/bin', HTTPS_PROXY: 'http://u:pw@p:3128', NO_PROXY: 'l' } }).env,
    { PATH: '/bin', NO_PROXY: 'l' });
  assert.equal(childEnv({ kind: 'plugin', platform: 'win32', base: { PATH: '/bin', SYSTEMROOT: 'C:\\W' } }).env.SYSTEMROOT, 'C:\\W');
  assert.equal(childEnv({ kind: 'plugin', platform: 'linux', base: { PATH: '/bin', SYSTEMROOT: 'C:\\W' } }).env.SYSTEMROOT, undefined);
});

test('scripts, the terminal, actions and plugin children build their env through the owner', () => {
  const saved = { ...process.env };
  Object.assign(process.env, { WORCA_BROKER_SECRET: 'b', WORCA_BROKER_SECRET_FILE: '/s' });
  try {
    for (const [name, env] of [
      ['script (envScrub off)', scriptBaseEnv({})],
      ['script (envScrub on)', scriptBaseEnv({ envScrub: true })],
      ['terminal', terminalEnv({ base: process.env, sessionId: 's', mode: 'pty', cwd: '/w' })],
      ['action', actionBaseEnv(process.env)],
      ['plugin', scrubbedEnv(process.platform, process.env)],
    ]) {
      assert.equal(env.WORCA_BROKER_SECRET, undefined, `${name}: the broker's secret`);
      assert.equal(env.WORCA_BROKER_SECRET_FILE, undefined, `${name}: the broker's secret file`);
    }
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  assert.deepEqual(scrubbedEnv('linux', { PATH: '/bin', HOME: '/h', GOPATH: '/go' }),
    childEnv({ kind: 'plugin', platform: 'linux', base: { PATH: '/bin', HOME: '/h', GOPATH: '/go' } }).env);
});


test('remote: a kept name never brings a backend key back into a sandbox, even declared', () => {
  const { env } = childEnv({ engine: 'claude', remote: true, keep: ['E2B_API_KEY', 'E2B_API_URL'], declared: ['E2B_API_KEY', 'E2B_API_URL'],
    base: { E2B_API_KEY: 'e2b_k', E2B_API_URL: 'https://e2b.example' } });
  assert.equal(env.E2B_API_KEY, undefined);
  assert.equal(env.E2B_API_URL, undefined);
});

// ── proxy and CA connectivity names (proxy-vs-protection-stack report F3, F4, F8) ────────────────────────────────────

const CONNECTIVITY = { ALL_PROXY: 'socks5://p:1080', all_proxy: 'socks5://p:1080', GIT_SSL_CAINFO: '/ca/git.pem',
  CURL_CA_BUNDLE: '/ca/curl.pem', REQUESTS_CA_BUNDLE: '/ca/req.pem', PIP_CERT: '/ca/pip.pem', AWS_CA_BUNDLE: '/ca/aws.pem',
  npm_config_cafile: '/ca/npm.pem', NPM_CONFIG_CAFILE: '/ca/NPM.pem', CARGO_HTTP_CAINFO: '/ca/cargo.pem', DENO_CERT: '/ca/deno.pem',
  NODE_USE_ENV_PROXY: '1', npm_config_proxy: 'http://p:3128', npm_config_https_proxy: 'http://p:3128' };
const CODE_LOADERS = { NODE_OPTIONS: '--require /x.js', JAVA_TOOL_OPTIONS: '-javaagent:/x.jar' };

test('engine, script, preflight and plugin children keep every proxy and CA name; never NODE_OPTIONS or JAVA_TOOL_OPTIONS', () => {
  const base = { PATH: '/bin', HOME: '/h', HTTPS_PROXY: 'http://p:3128', ...CONNECTIVITY, ...CODE_LOADERS };
  for (const [name, env] of [
    ['engine', childEnv({ kind: 'engine', engine: 'claude', base }).env],
    ['script', childEnv({ kind: 'script', base }).env],
    ['preflight', childEnv({ kind: 'preflight', engine: 'codex', base }).env],
    ['plugin', childEnv({ kind: 'plugin', base }).env],
  ]) {
    for (const [k, v] of Object.entries(CONNECTIVITY)) assert.equal(env[k], v, `${name}: ${k}`);
    for (const k of Object.keys(CODE_LOADERS)) assert.equal(env[k], undefined, `${name}: ${k} can load code`);
  }
});

test('a proxy URL with a login: engine, script and preflight get no proxy URL at all and say so once; terminal and git keep it', () => {
  const login = 'http://ACME%5Cjdoe:s3cret@proxy.corp:8080';
  for (const k of ['HTTPS_PROXY', 'ALL_PROXY', 'npm_config_https_proxy']) {
    const base = { PATH: '/bin', HOME: '/h', HTTP_PROXY: 'http://proxy.corp:8080', [k]: login, NO_PROXY: 'localhost', CURL_CA_BUNDLE: '/ca.pem' };
    for (const [name, r] of [
      ['engine', childEnv({ kind: 'engine', engine: 'claude', base })],
      ['script', childEnv({ kind: 'script', base })],
      ['preflight', childEnv({ kind: 'preflight', engine: 'claude', base })],
    ]) {
      assert.equal(r.env[k], undefined, `${name}: ${k} carries the login`);
      assert.equal(r.env.HTTP_PROXY, undefined, `${name}: no proxy URL alone (it would half-route the child)`);
      assert.equal(r.env.NO_PROXY, 'localhost', `${name}: NO_PROXY is no secret`);
      assert.equal(r.env.CURL_CA_BUNDLE, '/ca.pem', `${name}: the CA paths stay`);
      assert.equal(r.proxyLogin, true, `${name}: the run log is told`);
      assert.ok(!JSON.stringify(r.env).includes('s3cret'), `${name}: no password anywhere`);
    }
    for (const kind of ['terminal', 'git']) assert.equal(childEnv({ kind, base }).env[k], login, `${kind}: the person's own`);
  }
  const plain = childEnv({ kind: 'engine', engine: 'claude', base: { PATH: '/bin', HTTPS_PROXY: 'http://proxy.corp:8080' } });
  assert.equal(plain.env.HTTPS_PROXY, 'http://proxy.corp:8080');
  assert.equal(plain.proxyLogin, false, 'no login, no notice');
  const opted = childEnv({ kind: 'engine', engine: 'claude', allowlist: ['HTTPS_PROXY'], base: { PATH: '/bin', HTTPS_PROXY: login } });
  assert.equal(opted.env.HTTPS_PROXY, login, 'the run\'s envAllowlist naming it is the person\'s explicit choice');
  assert.equal(opted.proxyLogin, false);
  // envScrub off: worca's env as asked, but never a proxy login (#1021: the Worca proxy is off then, so it goes direct).
  assert.equal(childEnv({ kind: 'script', inherit: true, base: { HTTPS_PROXY: login } }).env.HTTPS_PROXY, undefined, 'envScrub off: no proxy login either');
});

test('terminal, action and git children keep WORCA_EGRESS_PROXY_URL: a nested worca run reuses the local proxy', () => {
  const base = { PATH: '/bin', HOME: '/h', WORCA_EGRESS_PROXY_URL: 'http://127.0.0.1:41234', WORCA_EGRESS_MODE: 'policy' };
  for (const [name, env] of [
    ['git', childEnv({ kind: 'git', base }).env],
    ['terminal', childEnv({ kind: 'terminal', base }).env],
    ['action', actionBaseEnv(base)],
  ]) {
    assert.equal(env.WORCA_EGRESS_PROXY_URL, 'http://127.0.0.1:41234', name);
    assert.equal(env.WORCA_EGRESS_MODE, undefined, `${name}: the rest of worca's config stays out`);
  }
});

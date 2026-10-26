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

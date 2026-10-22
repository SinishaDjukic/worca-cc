// test/spawn-child-env.test.mjs
// One allowlist child env for every engine, local and remote (src/core/spawn.mjs childEnv,
// plans/core-protection-layer-design.md §4.1): exact names only, the sign-in a mode needs, the git ceiling and PWD,
// and the one run-log line that names what was withheld.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter } from 'node:path';
import { childEnv, formatDropped } from '../src/core/spawn.mjs';
import { ENGINES } from '../src/shared/engine-switch.mjs';

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

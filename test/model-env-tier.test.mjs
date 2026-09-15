// test/model-env-tier.test.mjs
// #422: an endpoint-routed model env carries Claude Code's internal tier keys
// (ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS,FABLE}_MODEL + ANTHROPIC_SMALL_FAST_MODEL)
// pointed at the entry's own wire id, so the CLI's session-title / alias /
// probe calls never fall back to a first-party id the endpoint does not serve.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withTierModelEnv, TIER_MODEL_ENV_KEYS, isReservedModelEnvKey } from '../src/core/model-env.mjs';
import { resolveModelEnv } from '../src/core/config.mjs';
import { addGlobalModel } from '../src/core/settings.mjs';
import { _resetForTests } from '../src/core/db.mjs';

const dirs = [];
const prevEnv = {
  HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_HOME: process.env.WORCA_HOME,
  WORCA_TEST_ALLOW_HOME_FALLBACK: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK,
};
before(async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-tier-home-'));
  const whome = await mkdtemp(join(tmpdir(), 'worca-cc-tier-whome-'));
  dirs.push(home, whome);
  _resetForTests();
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = whome;
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
});
after(async () => {
  _resetForTests();
  for (const k of ['HOME', 'USERPROFILE', 'WORCA_HOME', 'WORCA_TEST_ALLOW_HOME_FALLBACK']) {
    if (prevEnv[k] === undefined) delete process.env[k]; else process.env[k] = prevEnv[k];
  }
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
});

const allTier = (wire) => Object.fromEntries(TIER_MODEL_ENV_KEYS.map((k) => [k, wire]));

test('TIER_MODEL_ENV_KEYS: the four DEFAULT tiers + the legacy small-fast key, none reserved', () => {
  assert.deepEqual([...TIER_MODEL_ENV_KEYS], [
    'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
  ]);
  for (const k of TIER_MODEL_ENV_KEYS) assert.equal(isReservedModelEnvKey(k), false, k);
});

test('withTierModelEnv: routed env gets every unset tier key = the catalog id', () => {
  const env = { ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_AUTH_TOKEN: 't' };
  const out = withTierModelEnv(env, 'my-model');
  assert.deepEqual(out, { ...env, ...allTier('my-model') });
  assert.deepEqual(env, { ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_AUTH_TOKEN: 't' }, 'input untouched');
});

test('withTierModelEnv: ANTHROPIC_MODEL (the wire id, #374) outranks the catalog id', () => {
  const out = withTierModelEnv({ ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_MODEL: 'wire-7' }, 'catalog-id');
  assert.deepEqual(out, { ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_MODEL: 'wire-7', ...allTier('wire-7') });
});

test('withTierModelEnv: an explicit tier key is never overwritten', () => {
  const out = withTierModelEnv({ ANTHROPIC_BASE_URL: 'https://gw', ANTHROPIC_DEFAULT_HAIKU_MODEL: 'small-one' }, 'big-one');
  assert.equal(out.ANTHROPIC_DEFAULT_HAIKU_MODEL, 'small-one');
  assert.equal(out.ANTHROPIC_DEFAULT_OPUS_MODEL, 'big-one');
});

test('withTierModelEnv: non-routed env, undefined env, and no wire id all pass through untouched', () => {
  const plain = { ANTHROPIC_AUTH_TOKEN: 't' };
  assert.equal(withTierModelEnv(plain, 'x'), plain);
  assert.equal(withTierModelEnv(undefined, 'x'), undefined);
  const routedNoId = { ANTHROPIC_BASE_URL: 'https://gw' };
  assert.deepEqual(withTierModelEnv(routedNoId, ''), routedNoId);
  assert.deepEqual(withTierModelEnv(routedNoId, undefined), routedNoId);
});

test('resolveModelEnv: an endpoint-routed GLOBAL entry carries the tier keys; a plain one does not', async () => {
  await addGlobalModel({ id: 'Routed-Model', env: { ANTHROPIC_BASE_URL: 'https://gw/v1', ANTHROPIC_AUTH_TOKEN: 'tok' } });
  await addGlobalModel({ id: 'unrouted-model', env: { ANTHROPIC_AUTH_TOKEN: 'tok' } });
  await addGlobalModel({ id: 'wire-model', env: { ANTHROPIC_BASE_URL: 'https://gw/v1', ANTHROPIC_MODEL: 'gw-wire', ANTHROPIC_DEFAULT_SONNET_MODEL: 'gw-sonnet' } });
  // case-insensitive lookup, but the synthesized id is the entry's CANONICAL spelling
  assert.deepEqual(resolveModelEnv('routed-model'), {
    ANTHROPIC_BASE_URL: 'https://gw/v1', ANTHROPIC_AUTH_TOKEN: 'tok', ...allTier('Routed-Model'),
  });
  assert.deepEqual(resolveModelEnv('unrouted-model'), { ANTHROPIC_AUTH_TOKEN: 'tok' });
  assert.deepEqual(resolveModelEnv('wire-model'), {
    ANTHROPIC_BASE_URL: 'https://gw/v1', ANTHROPIC_MODEL: 'gw-wire', ...allTier('gw-wire'), ANTHROPIC_DEFAULT_SONNET_MODEL: 'gw-sonnet',
  });
});

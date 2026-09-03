// test/model-env.test.mjs
// The zero-import leaf shared by settings.mjs (write-time validation) and
// claude-runner.mjs (spawn-time filter): effort vocabulary, reserved-key
// policy, whole-value ${VAR} refs (configurable-models-design.md §4.1/§4.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORTS, RESERVED_MODEL_ENV_KEYS, isReservedModelEnvKey, modelEnvRef, prepareModelEnv,
  envFlag, maskModelEnvValue, isReadableModelEnvKey, describeModelEnvEntry, describeModelEnv,
} from '../src/core/model-env.mjs';
import { EFFORTS as CONFIG_EFFORTS } from '../src/core/config.mjs';

test('EFFORTS: canonical here, config.mjs re-export is the SAME array', () => {
  assert.deepEqual(EFFORTS, ['medium', 'high', 'xhigh', 'max']);
  assert.equal(CONFIG_EFFORTS, EFFORTS); // identity, not a drifting copy
});

test('isReservedModelEnvKey: exact keys, WORCA_ prefix, and the allowed rest', () => {
  for (const k of RESERVED_MODEL_ENV_KEYS) assert.equal(isReservedModelEnvKey(k), true, k);
  // The prefix protects every worca runtime knob, present and future.
  for (const k of ['WORCA_MOCK', 'WORCA_CLAUDE_BIN', 'WORCA_EFFORT_FLAG', 'WORCA_ANYTHING']) {
    assert.equal(isReservedModelEnvKey(k), true, k);
  }
  // Routing env is the point — ANTHROPIC_*/CLAUDE_* must NOT be reserved
  // (except the explicit scrub landmine, covered above via the exact list).
  for (const k of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL', 'CLAUDE_CODE_EXTRA']) {
    assert.equal(isReservedModelEnvKey(k), false, k);
  }
  assert.equal(isReservedModelEnvKey(''), false);
});

test('modelEnvRef: whole-value form only', () => {
  assert.equal(modelEnvRef('${MY_TOKEN}'), 'MY_TOKEN');
  assert.equal(modelEnvRef('${_x1}'), '_x1');
  assert.equal(modelEnvRef('prefix-${MY_TOKEN}'), null); // embedded = literal
  assert.equal(modelEnvRef('${1BAD}'), null);
  assert.equal(modelEnvRef('${}'), null);
  assert.equal(modelEnvRef('plain'), null);
  assert.equal(modelEnvRef(42), null);
  assert.equal(modelEnvRef(undefined), null);
});

test('prepareModelEnv: literals pass, reserved/non-string dropped, refs expand', () => {
  const source = { MY_TOKEN: 'sk-123', EMPTY: '' };
  const { env, dropped } = prepareModelEnv({
    ANTHROPIC_BASE_URL: 'https://proxy.example/v1', // literal
    ANTHROPIC_AUTH_TOKEN: '${MY_TOKEN}',            // ref, set
    X_UNSET: '${NOT_SET}',                          // ref, unset -> dropped
    X_EMPTY: '${EMPTY}',                            // ref, empty -> dropped
    PATH: '/evil',                                  // reserved -> dropped
    WORCA_MOCK: '1',                                // reserved prefix -> dropped
    X_NUM: 7,                                       // non-string -> dropped
  }, source);
  assert.deepEqual(env, {
    ANTHROPIC_BASE_URL: 'https://proxy.example/v1',
    ANTHROPIC_AUTH_TOKEN: 'sk-123',
  });
  assert.deepEqual(dropped.sort(), ['PATH', 'WORCA_MOCK', 'X_EMPTY', 'X_NUM', 'X_UNSET']);
});

test('prepareModelEnv: empty/absent input is a no-op', () => {
  assert.deepEqual(prepareModelEnv(undefined, {}), { env: {}, dropped: [] });
  assert.deepEqual(prepareModelEnv({}, {}), { env: {}, dropped: [] });
});

// ── envFlag / masking helpers (shared by claude-runner, plugin-shim, ui/server) ─

test('envFlag: unset/""/0/false are off, anything else on; first SET name wins', () => {
  const saved = { A: process.env.WORCA_T_A, B: process.env.WORCA_T_B };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[`WORCA_T_${k}`]; else process.env[`WORCA_T_${k}`] = v;
    }
  };
  try {
    delete process.env.WORCA_T_A; delete process.env.WORCA_T_B;
    assert.equal(envFlag('WORCA_T_A'), false);
    for (const off of ['', '0', 'false', 'FALSE', 'False']) { process.env.WORCA_T_A = off; assert.equal(envFlag('WORCA_T_A'), false, off); }
    for (const on of ['1', 'true', 'yes', 'on', '2', 'no']) { process.env.WORCA_T_A = on; assert.equal(envFlag('WORCA_T_A'), true, on); }
    delete process.env.WORCA_T_A; process.env.WORCA_T_B = '1';
    assert.equal(envFlag('WORCA_T_A', 'WORCA_T_B'), true, 'falls through to the fallback name');
    process.env.WORCA_T_A = '0';
    assert.equal(envFlag('WORCA_T_A', 'WORCA_T_B'), false, 'a SET primary (even "0") outranks the fallback');
  } finally { restore(); }
});

test('maskModelEnvValue: 6 bullets + last 4 when >8 chars, else 6 bullets (the UI echo contract)', () => {
  assert.equal(maskModelEnvValue('short'), '••••••');
  assert.equal(maskModelEnvValue('12345678'), '••••••');
  assert.equal(maskModelEnvValue('super-secret-token-value'), '••••••alue');
  assert.equal(maskModelEnvValue(''), '••••••');
  assert.equal(maskModelEnvValue(undefined), '••••••');
  assert.ok(maskModelEnvValue('anything').startsWith('••'), 'isMaskedEcho prefix');
});

test('isReadableModelEnvKey: routing ids/endpoints readable, credentials and everything else not', () => {
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_SMALL_FAST_MODEL',
    'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_BEDROCK']) {
    assert.equal(isReadableModelEnvKey(k), true, k);
  }
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS', 'AWS_SECRET_ACCESS_KEY',
    'CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', 'X_ANYTHING', '', undefined, 42]) {
    assert.equal(isReadableModelEnvKey(k), false, String(k));
  }
});

test('describeModelEnvEntry: readable keys verbatim, URLs lose userinfo, secrets become <set, N chars>', () => {
  assert.equal(describeModelEnvEntry('ANTHROPIC_MODEL', 'claude-opus-4-8'), 'ANTHROPIC_MODEL=claude-opus-4-8');
  assert.equal(describeModelEnvEntry('ANTHROPIC_BASE_URL', 'https://gw.example/v1'), 'ANTHROPIC_BASE_URL=https://gw.example/v1');
  assert.equal(describeModelEnvEntry('ANTHROPIC_BASE_URL', 'https://u:p@gw.example/v1'), 'ANTHROPIC_BASE_URL=https://gw.example/v1', 'userinfo stripped');
  assert.equal(describeModelEnvEntry('ANTHROPIC_BASE_URL', 'not a url'), 'ANTHROPIC_BASE_URL=<set, 9 chars>', 'unparsable URL treated as secret');
  assert.equal(describeModelEnvEntry('ANTHROPIC_AUTH_TOKEN', 'sk-a1b2c3d4'), 'ANTHROPIC_AUTH_TOKEN=<set, 11 chars>');
  assert.equal(describeModelEnvEntry('ANTHROPIC_AUTH_TOKEN', ''), 'ANTHROPIC_AUTH_TOKEN=<set, 0 chars>');
  const line = describeModelEnvEntry('ANTHROPIC_CUSTOM_HEADERS', 'x-key: abcdef');
  assert.ok(!line.includes('abcdef') && !line.includes('cdef'), 'no prefix or suffix of a secret');
});

test('describeModelEnv: sorted, comma-joined, empty for no env', () => {
  assert.equal(describeModelEnv({ ANTHROPIC_MODEL: 'm', ANTHROPIC_AUTH_TOKEN: 'tok-12345', ANTHROPIC_BASE_URL: 'https://a.example/' }),
    'ANTHROPIC_AUTH_TOKEN=<set, 9 chars>, ANTHROPIC_BASE_URL=https://a.example/, ANTHROPIC_MODEL=m');
  assert.equal(describeModelEnv({}), '');
  assert.equal(describeModelEnv(undefined), '');
});

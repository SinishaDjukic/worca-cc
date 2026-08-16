// test/model-env.test.mjs
// The zero-import leaf shared by settings.mjs (write-time validation) and
// claude-runner.mjs (spawn-time filter): effort vocabulary, reserved-key
// policy, whole-value ${VAR} refs (configurable-models-design.md §4.1/§4.4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFORTS, RESERVED_MODEL_ENV_KEYS, isReservedModelEnvKey, modelEnvRef, prepareModelEnv,
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

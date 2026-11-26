// test/model-guard.test.mjs — the premium-model guard (#1450): pause before a step that would run on a premium model
// nobody chose, and right after [init] when Claude Code started a premium-unchosen model or another model than asked for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UNCHOSEN_SOURCES, preStepVerdict, initVerdict, isAlias, checkConfirmModel } from '../src/core/model-guard.mjs';

const PREMIUM = new Set(['claude-fable-5-1', 'claude-fable-5-2']);
const premium = (id) => PREMIUM.has(id);
const routed = (id) => id === 'gw-routed';

test('UNCHOSEN_SOURCES: worca-default, factory, auto and null (a legacy undefined reads as null)', () => {
  assert.deepEqual([...UNCHOSEN_SOURCES].sort(), [null, 'auto', 'factory', 'worca-default'].sort());
  assert.equal(UNCHOSEN_SOURCES.has('care'), false, 'a care fill is a chosen model');
});

test('preStepVerdict: unchosen premium pauses; chosen, confirmed or non-premium passes', () => {
  const rows = [
    [{ model: 'claude-fable-5-2', source: 'auto' }, true],
    [{ model: 'claude-fable-5-2', source: 'factory' }, true],
    [{ model: 'claude-fable-5-2', source: undefined }, true],
    [{ model: 'claude-fable-5-2', source: null }, true],
    [{ model: 'claude-fable-5-2', source: 'project' }, false],
    [{ model: 'claude-fable-5-2', source: 'run' }, false],
    [{ model: 'claude-fable-5-2', source: 'role' }, false],
    [{ model: 'claude-fable-5-2', source: 'care' }, false],
    [{ model: 'claude-fable-5-2', source: 'auto', confirmed: ['claude-fable-5-2'] }, false],
    [{ model: 'claude-fable-5-2', source: 'auto', confirmed: ['claude-fable-5-1'] }, true],
    [{ model: 'claude-opus-5-5', source: 'auto' }, false],
    [{ model: undefined, source: null }, false],
  ];
  for (const [input, pause] of rows) {
    const v = preStepVerdict({ ...input, step: 'Plan', premium });
    assert.equal(!!v.pause, pause, JSON.stringify(input));
    if (pause) {
      assert.equal(v.model, input.model);
      assert.equal(v.detail, `Paused before Plan: it would run on ${input.model}, a premium model nobody chose.`);
    } else assert.deepEqual(v, { ok: true });
  }
});

test('initVerdict: the decision table', () => {
  const base = { step: 'Plan', premium, routed };
  const v = (o) => initVerdict({ ...base, ...o });
  assert.deepEqual(v({ init: undefined, requested: 'claude-opus-5-5' }), { ok: true });
  // No model requested and a premium init: nobody chose it.
  const a = v({ init: 'claude-fable-5-2', requested: undefined, source: null });
  assert.equal(a.pause, true); assert.equal(a.model, 'claude-fable-5-2');
  assert.equal(a.detail, 'Claude Code started Plan on claude-fable-5-2, a premium model nobody chose.');
  assert.deepEqual(v({ init: 'claude-fable-5-2', requested: undefined, source: null, confirmed: ['claude-fable-5-2'] }), { ok: true });
  assert.equal(v({ init: 'claude-fable-5-1', requested: undefined, source: null, confirmed: ['claude-fable-5-2'] }).pause, true, 'confirming X never passes Y');
  // cli-decides: consent, a note for a premium init.
  assert.deepEqual(v({ init: 'claude-fable-5-2', requested: undefined, source: 'cli-decides' }), { ok: true, note: 'Claude Code picked claude-fable-5-2 (premium).' });
  assert.deepEqual(v({ init: 'claude-sonnet-5-5', requested: undefined, source: 'cli-decides' }), { ok: true });
  // Differs.
  const d = v({ init: 'claude-sonnet-5-5', requested: 'claude-opus-5-5', source: 'project' });
  assert.equal(d.pause, true);
  assert.equal(d.detail, 'Plan asked for claude-opus-5-5 but Claude Code started claude-sonnet-5-5.');
  assert.deepEqual(v({ init: 'claude-opus-5-5-20261001', requested: 'claude-opus-5-5', source: 'project' }), { ok: true }, 'a dated init id is the same model');
  assert.deepEqual(v({ init: 'claude-opus-4-8', requested: 'claude-opus-4-8[1m]', source: 'project' }), { ok: true }, 'a [1m] twin is the same model');
  assert.deepEqual(v({ init: 'claude-fable-5-2', requested: 'opus', source: 'project' }), { ok: true }, 'an alias request is never compared');
  assert.deepEqual(v({ init: 'claude-sonnet-5-5', requested: 'gw-routed', source: 'project' }), { ok: true }, 'a routed request is never compared');
  // A premium init that matches an unchosen request (auto) still pauses; a chosen one does not.
  assert.equal(v({ init: 'claude-fable-5-2', requested: 'claude-fable-5-2', source: 'auto' }).pause, true);
  assert.deepEqual(v({ init: 'claude-fable-5-2', requested: 'claude-fable-5-2', source: 'project' }), { ok: true });
  assert.equal(v({ init: 'claude-fable-5-2', requested: 'claude-fable-5-2', source: undefined }).pause, true, 'undefined source is unchosen');
});

test('isAlias: the family words and any id without a dash', () => {
  for (const id of ['opus', 'Sonnet', 'haiku', 'fable', 'default']) assert.equal(isAlias(id), true, id);
  for (const id of ['claude-opus-5-5', 'gpt-6.1-sol']) assert.equal(isAlias(id), false, id);
});

test('checkConfirmModel: 409 when nothing waits, 400 on a mismatch or with a model, null when it matches', () => {
  const rp = { pauseReason: 'model_confirm', modelConfirm: { nodeId: 'n1', stepKey: 'planner', model: 'claude-fable-5-2', requested: null, at: 'init' } };
  assert.equal(checkConfirmModel(rp, {}), null, 'no confirmModel: nothing to check');
  assert.equal(checkConfirmModel(rp, { confirmModel: 'claude-fable-5-2' }), null);
  assert.deepEqual(checkConfirmModel({ pauseReason: 'usage_limit' }, { confirmModel: 'claude-fable-5-2' }),
    { status: 409, body: { code: 'confirm-not-pending', error: 'This run is not waiting for a model confirmation.' } });
  assert.deepEqual(checkConfirmModel(null, { confirmModel: 'x' }).status, 409);
  assert.deepEqual(checkConfirmModel(rp, { confirmModel: 'claude-fable-5-1' }),
    { status: 400, body: { code: 'confirm-mismatch', error: 'The run is waiting to confirm claude-fable-5-2, not claude-fable-5-1.' } });
  assert.deepEqual(checkConfirmModel(rp, { confirmModel: 'claude-fable-5-2', model: 'claude-opus-5-5' }),
    { status: 400, body: { code: 'confirm-and-switch', error: 'Confirm the model or switch it, not both.' } });
});

// test/ui-model-switch.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { diffChanges, reconcileEffort, renderModelSwitchPanel, switchNotice } from '../ui/public/model-switch.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const PAYLOAD = {
  pipelineId: 'p1', runDefault: '', pauseReason: 'error', pauseDetail: 'out of usage credits',
  models: [
    { id: 'claude-fable-5-1', label: 'Fable 5.1', efforts: ['medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
    { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  ],
  efforts: ['medium', 'high', 'xhigh', 'max'],
  subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'],
  stages: [
    { nodeId: 'n_plan', key: 'planner', label: 'Planner', state: 'completed', switchable: false, model: '', effort: '', subagentModel: '', subagentEffort: '', fanOut: true },
    { nodeId: 'n_refine', key: 'refiner', label: 'Refiner', state: 'paused', switchable: true, model: 'claude-fable-5-1', effort: 'xhigh', subagentModel: '', subagentEffort: '', fanOut: true },
    { nodeId: 'n_impl', key: 'implementer', label: 'Implementer', state: 'pending', switchable: true, model: '', effort: '', subagentModel: '', subagentEffort: '', fanOut: false },
  ],
};

test('reconcileEffort keeps a supported effort, clears an unsupported one', () => {
  assert.equal(reconcileEffort(PAYLOAD.models, 'claude-opus-5-5', 'xhigh'), 'xhigh');
  assert.equal(reconcileEffort(PAYLOAD.models, 'claude-haiku-4-5', 'xhigh'), '');
  assert.equal(reconcileEffort(PAYLOAD.models, '', 'high'), '');
});

test('diffChanges sends only touched fields of switchable stages, effort always with model', () => {
  const picks = {
    n_plan: { model: 'claude-opus-5-5', effort: '', subagentModel: '', subagentEffort: '' },
    n_refine: { model: 'claude-opus-5-5', effort: 'xhigh', subagentModel: '', subagentEffort: '' },
    n_impl: { model: '', effort: '', subagentModel: '', subagentEffort: '' },
  };
  assert.deepEqual(diffChanges(PAYLOAD.stages, picks), { n_refine: { model: 'claude-opus-5-5', effort: 'xhigh' } });
});

test('panel: completed rows are locked, sub-agent pickers only on fan-out stages, "all" row sets every remaining stage', () => {
  const panel = renderModelSwitchPanel(PAYLOAD, { doc });
  const row = (id) => panel.el.querySelector(`tr[data-node="${id}"]`);
  assert.ok(row('n_plan').querySelector('select[data-field="model"]').disabled);
  assert.ok(row('n_refine').querySelector('select[data-field="subagentModel"]'));
  assert.equal(row('n_impl').querySelector('select[data-field="subagentModel"]'), null);
  const all = panel.el.querySelector('select.msw-all');
  all.value = 'claude-haiku-4-5';
  all.dispatchEvent(new doc.defaultView.Event('change'));
  const p = panel.picks();
  assert.equal(p.n_refine.model, 'claude-haiku-4-5');
  assert.equal(p.n_refine.effort, '', 'xhigh is not offered by Haiku: cleared');
  assert.equal(p.n_impl.model, 'claude-haiku-4-5');
  assert.equal(p.n_plan.model, '', 'completed stage untouched');
});

test('Save / Save & resume call onSave with the diff and the resume flag', async () => {
  const calls = [];
  const panel = renderModelSwitchPanel(PAYLOAD, { doc, onSave: async (x) => { calls.push(x); } });
  const sel = panel.el.querySelector('tr[data-node="n_refine"] select[data-field="model"]');
  sel.value = 'claude-opus-5-5'; sel.dispatchEvent(new doc.defaultView.Event('change'));
  panel.el.querySelector('.msw-save-resume').click();
  await Promise.resolve();
  assert.deepEqual(calls, [{ changes: { n_refine: { model: 'claude-opus-5-5', effort: 'xhigh' } }, resume: true }]);
});

const RUNNING = {
  ...PAYLOAD, status: 'running', pauseReason: null, pauseDetail: null,
  stages: [
    { ...PAYLOAD.stages[0], state: 'running', switchable: false },
    { ...PAYLOAD.stages[1], state: 'may-rerun', switchable: true },
    { ...PAYLOAD.stages[2], state: 'pending', switchable: true },
  ],
};

test('a running payload: the running copy, Save as the primary action, no Save & resume', () => {
  const panel = renderModelSwitchPanel(RUNNING, { doc });
  assert.equal(panel.el.dataset.mode, 'running');
  assert.match(panel.el.querySelector('.msw-title').textContent, /have not started/);
  assert.match(panel.el.querySelector('.msw-sub').textContent, /a stage that is running keeps its model/);
  assert.equal(panel.el.querySelector('.msw-save-resume'), null);
  assert.ok(panel.el.querySelector('.msw-save').classList.contains('primary'));
  assert.equal(panel.el.querySelector('tr[data-node="n_plan"] .msw-state').textContent, 'running now');
  assert.ok(panel.el.querySelector('tr[data-node="n_plan"]').classList.contains('is-locked'));
  assert.equal(panel.el.querySelector('tr[data-node="n_refine"] .msw-state').textContent, 'ran · may run again');
});

test('switchNotice: changed, skipped and warnings', () => {
  assert.deepEqual(switchNotice({ changed: [{}, {}], skipped: [], warnings: ['w'] }), { tone: 'ok', title: 'Switched 2 stages', detail: 'w' });
  assert.deepEqual(switchNotice({ changed: [{}], skipped: [{ label: 'Plan', reason: 'running' }], warnings: [] }),
    { tone: 'ok', title: 'Switched 1 stage', detail: 'Plan had already started — kept its model.' });
  assert.equal(switchNotice({ changed: [], skipped: [{ label: 'Plan', reason: 'running' }] }).tone, 'warn');
});

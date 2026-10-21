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
  subagentEfforts: ['medium', 'high', 'xhigh', 'max'],
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
  assert.ok(panel.el.querySelector('.msw-save').classList.contains('btn-primary'));
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

test('every select has an accessible name', () => {
  const { el } = renderModelSwitchPanel(PAYLOAD, { doc });
  for (const sel of el.querySelectorAll('select')) assert.ok(sel.getAttribute('aria-label'), sel.outerHTML);
  const row = el.querySelector('tr[data-node="n_impl"] select[data-field="model"]');
  assert.match(row.getAttribute('aria-label'), /model$/i);
});

test('"All remaining stages" applies once and goes back to "keep each"', () => {
  const { el, picks } = renderModelSwitchPanel(PAYLOAD, { doc });
  const all = el.querySelector('select.msw-all');
  all.value = PAYLOAD.models[0].id;
  all.dispatchEvent(new doc.defaultView.Event('change'));
  assert.equal(all.value, '__keep');
  for (const s of PAYLOAD.stages.filter((x) => x.switchable)) assert.equal(picks()[s.nodeId].model, PAYLOAD.models[0].id);
});

test('an engine without sub-agents shows no sub-agent selects (Review Focus 3)', () => {
  const p = { ...PAYLOAD, engine: 'cursor', subagents: false, efforts: [], stages: PAYLOAD.stages.map((s) => ({ ...s, fanOut: true })) };
  const { el } = renderModelSwitchPanel(p, { doc });
  assert.equal(el.querySelectorAll('select[data-field="subagentModel"]').length, 0);
});

test('a modelForAll run: model and effort locked, a note says why and names the Resume menu item that did it', () => {
  const { el } = renderModelSwitchPanel({ ...PAYLOAD, modelForAll: 'claude-sonnet-5-5' }, { doc });
  assert.equal(el.querySelector('.msw-note').textContent,
    'This run was resumed with claude-sonnet-5-5 for every remaining stage (Resume › Switch model…) — per-stage models and efforts do not apply.');
  for (const sel of el.querySelectorAll('select[data-field="model"], select[data-field="effort"], select.msw-all')) assert.ok(sel.disabled);
});

test('a current model the run cannot run is labelled "(not offered on this run)"', () => {
  const p = { ...PAYLOAD, stages: PAYLOAD.stages.map((s) => (s.nodeId === 'n_impl' ? { ...s, model: 'gpt-x' } : s)) };
  const { el } = renderModelSwitchPanel(p, { doc });
  const opt = [...el.querySelectorAll('tr[data-node="n_impl"] select[data-field="model"] option')].find((o) => o.value === 'gpt-x');
  assert.equal(opt.textContent, 'gpt-x (not offered on this run)');
});

test('the primary actions use the dev primary button class, keeping the hook classes', () => {
  const paused = renderModelSwitchPanel(PAYLOAD, { doc }).el;
  assert.ok(paused.querySelector('.msw-save-resume').classList.contains('btn-primary'));
  assert.ok(paused.querySelector('.msw-save-resume').classList.contains('btn'));
  assert.ok(!paused.querySelector('.msw-save').classList.contains('btn-primary'));
  assert.ok(paused.querySelector('.msw-save').classList.contains('btn'));
});

const ev = () => new doc.defaultView.Event('change');
const withStage = (id, patch) => ({ ...PAYLOAD, stages: PAYLOAD.stages.map((s) => (s.nodeId === id ? { ...s, ...patch } : s)) });

test('modelForAll run: a sub-agent-only edit sends only subagentModel, never model/effort', () => {
  const p = { ...withStage('n_refine', { model: 'gpt-x', effort: 'high' }), modelForAll: 'claude-sonnet-5-5' };
  const panel = renderModelSwitchPanel(p, { doc });
  const sel = panel.el.querySelector('tr[data-node="n_refine"] select[data-field="subagentModel"]');
  sel.value = 'opus'; sel.dispatchEvent(ev());
  assert.deepEqual(diffChanges(p.stages, panel.picks()), { n_refine: { subagentModel: 'opus' } });
});

test('rendering never changes picks: a default-model stage keeps its stored effort', () => {
  const p = withStage('n_impl', { model: '', effort: 'high' });
  const panel = renderModelSwitchPanel(p, { doc });
  assert.deepEqual(diffChanges(p.stages, panel.picks()), {});
  assert.equal(panel.el.querySelector('tr[data-node="n_impl"] select[data-field="effort"]').value, 'high');
});

test('changing a row model still reconciles its effort', () => {
  const p = withStage('n_impl', { model: '', effort: 'high' });
  const panel = renderModelSwitchPanel(p, { doc });
  const sel = panel.el.querySelector('tr[data-node="n_impl"] select[data-field="model"]');
  sel.value = 'claude-fable-5-1'; sel.dispatchEvent(ev());
  assert.equal(panel.picks().n_impl.effort, 'high', 'Fable offers high');
  const p2 = withStage('n_impl', { model: '', effort: 'xhigh' });
  const panel2 = renderModelSwitchPanel(p2, { doc });
  const sel2 = panel2.el.querySelector('tr[data-node="n_impl"] select[data-field="model"]');
  sel2.value = 'claude-haiku-4-5'; sel2.dispatchEvent(ev());
  assert.equal(panel2.picks().n_impl.effort, '', 'Haiku does not offer xhigh');
});

const options = (el, id, field) => [...el.querySelectorAll(`tr[data-node="${id}"] select[data-field="${field}"] option`)]
  .map((o) => [o.value, o.textContent]);

test('sub-agent selects offer the engine\'s sub-agent lists, not the main efforts (I1)', () => {
  const codex = { ...PAYLOAD, engine: 'codex', subagents: true, efforts: ['minimal', 'low', 'medium', 'high'],
    subagentModels: [], subagentEfforts: ['medium', 'high'] };
  const { el } = renderModelSwitchPanel(codex, { doc });
  const row = el.querySelector('tr[data-node="n_refine"]');
  assert.equal(row.querySelector('select[data-field="subagentModel"]'), null, 'Codex takes no sub-agent model');
  assert.deepEqual([...row.querySelectorAll('td.msw-na')].map((t) => t.textContent), ['—']);
  assert.deepEqual(options(el, 'n_refine', 'subagentEffort'), [['', 'Default'], ['medium', 'medium'], ['high', 'high']]);
  // Copilot: neither field.
  const copilot = { ...codex, engine: 'copilot', subagentEfforts: [] };
  const c = renderModelSwitchPanel(copilot, { doc }).el.querySelector('tr[data-node="n_refine"]');
  assert.equal(c.querySelectorAll('select[data-field^="subagent"]').length, 0);
  assert.deepEqual([...c.querySelectorAll('td.msw-na')].map((t) => t.textContent), ['—', '—']);
});

test('a stored sub-agent value the run does not offer shows as itself and changes no pick (I1)', () => {
  const p = { ...withStage('n_refine', { subagentModel: 'fable', subagentEffort: 'xhigh' }),
    engine: 'codex', subagentModels: ['sonnet', 'opus'], subagentEfforts: ['medium', 'high'] };
  const panel = renderModelSwitchPanel(p, { doc });
  const sel = (f) => panel.el.querySelector(`tr[data-node="n_refine"] select[data-field="${f}"]`);
  assert.deepEqual(options(panel.el, 'n_refine', 'subagentModel').at(-1), ['fable', 'fable (not offered on this run)']);
  assert.deepEqual(options(panel.el, 'n_refine', 'subagentEffort').at(-1), ['xhigh', 'xhigh (not offered on this run)']);
  assert.deepEqual([sel('subagentModel').value, sel('subagentEffort').value], ['fable', 'xhigh']);
  assert.deepEqual(diffChanges(p.stages, panel.picks()), {}, 'rendering sends nothing');
  sel('subagentEffort').value = 'high'; sel('subagentEffort').dispatchEvent(ev());
  assert.deepEqual(diffChanges(p.stages, panel.picks()), { n_refine: { subagentEffort: 'high' } });
});

test('cursor: effort selects are disabled and sub-agent cells read em dashes', () => {
  const p = { ...PAYLOAD, engine: 'cursor', subagents: false, efforts: [], models: PAYLOAD.models.map((m) => ({ ...m, efforts: [] })),
    stages: PAYLOAD.stages.map((s) => ({ ...s, fanOut: true, model: s.switchable ? 'claude-opus-5-5' : s.model, effort: '' })) };
  const { el } = renderModelSwitchPanel(p, { doc });
  const row = el.querySelector('tr[data-node="n_refine"]');
  assert.ok(row.querySelector('select[data-field="effort"]').disabled);
  assert.deepEqual([...row.querySelectorAll('td.msw-na')].map((t) => t.textContent), ['—', '—']);
});

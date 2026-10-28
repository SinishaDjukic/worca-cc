// test/ui-run-presets-picker.test.mjs — New run's Preset picker pieces (ui/public/run-presets-picker.mjs): menu groups,
// the Simple-mode note items, the broken card, Reset, the Save dialog check and the preset-mode run config.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { presetMenuGroups, presetHiddenItems, presetNodePick, renderBrokenCard, resetItem, saveDialogError, configWithPreset,
  BROKEN_SCOPE_HINT, BROKEN_SCOPE_HINT_SIMPLE } from '../ui/public/run-presets-picker.mjs';

const P = (id, name, scope = { kind: 'global', ref: null }) => ({ id, name, scope, setup: {} });

test('presetMenuGroups: "Any project" first, then one group per pinned target; empty groups dropped', () => {
  const groups = presetMenuGroups([P('a', 'A', { kind: 'project', ref: 'api-1' }), P('b', 'B'), P('c', 'C', { kind: 'project', ref: 'api-1' })], { 'project:api-1': 'api' });
  assert.deepEqual(groups.map((g) => [g.label, g.items.map((p) => p.id)]), [['Any project', ['b']], ['api', ['a', 'c']]]);
  assert.deepEqual(presetMenuGroups([P('a', 'A', { kind: 'workspace', ref: 'wks-x' })]).map((g) => g.label), ['wks-x']);
});

test('presetHiddenItems names picks, loops, Away mark, opt-outs, engine and mock', () => {
  // `c` holds only its toggles (the stored full picks name every agent node, n_clarify included): not a model pick.
  const nodes = { a: { model: 'm1', effort: '' }, b: { model: 'm2', effort: 'high', fanOut: true }, c: { fanOut: false, askQuestions: true } };
  assert.deepEqual(presetHiddenItems({ overlay: { nodes, wires: { w: { maxCycles: 2 } } }, nightMode: true, mcpOptOut: ['x'], engine: 'codex', mock: true }),
    ['2 agent picks', '1 loop budget', 'Away mark', '1 Sets opt-out', 'Codex engine', 'Mock mode']);
  assert.deepEqual(presetHiddenItems({ engine: 'gemini-x' }), ['Unknown engine']);
  assert.deepEqual(presetHiddenItems({ engine: 'claude' }), []);
  assert.deepEqual(presetHiddenItems(null), []);
});

test('presetNodePick turns pruneNodeSelection\'s inherit values into the row default, never a null the overlay refuses', () => {
  const def = { model: 'claude-opus-5-5', effort: 'high', fanOut: true, askQuestions: false };
  assert.deepEqual(presetNodePick({ model: 'claude-fable-5-1', effort: '', fanOut: null, askQuestions: null, subagentModel: '' }, def),
    { model: 'claude-fable-5-1', effort: '', fanOut: true, askQuestions: false });
  assert.deepEqual(presetNodePick({ model: '', effort: '', fanOut: false, askQuestions: undefined, subagentModel: 'sonnet' }, def),
    { model: 'claude-opus-5-5', effort: 'high', fanOut: false, subagentModel: 'sonnet' }, 'no questions capability: the key stays out');
  assert.deepEqual(presetNodePick({ model: '', effort: '', fanOut: null, subagentModel: '' }, {}), { fanOut: false }, 'no default model: no model key');
});

test('renderBrokenCard: one row per item with the exact message; Reset only where allowed; names stay text', () => {
  const { document } = new JSDOM('').window;
  const seen = [];
  const card = renderBrokenCard(document, [
    { item: 'model', ref: 'n_plan', message: 'Planner: model <img src=x onerror=alert(1)> is no longer in the catalog', reset: true },
    { item: 'project', ref: 'api-1', message: 'Project api-1 is no longer registered in worca', reset: false },
  ], { onReset: (b) => seen.push(b.ref) });
  const rows = card.querySelectorAll('.preset-broken-row');
  assert.equal(rows.length, 2);
  assert.equal(card.querySelectorAll('img').length, 0);
  assert.equal(rows[0].querySelector('span').textContent, 'Planner: model <img src=x onerror=alert(1)> is no longer in the catalog');
  rows[0].querySelector('button').click();
  assert.deepEqual(seen, ['n_plan']);
  assert.equal(rows[1].querySelector('button'), null);
  assert.match(rows[1].textContent, /Edit the preset's scope in Settings › Presets/);
  assert.equal(renderBrokenCard(document, []).hidden, true);
});

test('resetItem drops the pick so the project default applies, never mutating the input', () => {
  const setup = { workflowId: 'wf_x', guardrailsId: 'gr_gone', engine: 'codex', overlay: { nodes: { n_plan: { model: 'm' }, n_impl: { model: 'n' } }, wires: { w: { maxCycles: 2 } } } };
  assert.equal('guardrailsId' in resetItem(setup, { item: 'guardrails' }), false);
  assert.equal(resetItem(setup, { item: 'engine' }).engine, 'claude');
  assert.deepEqual(Object.keys(resetItem(setup, { item: 'model', ref: 'n_plan' }).overlay.nodes), ['n_impl']);
  assert.deepEqual(resetItem(setup, { item: 'loop', ref: 'w' }).overlay.wires, {});
  const wf = resetItem(setup, { item: 'workflow' }, { projectWorkflowId: 'wf_default' });
  assert.deepEqual([wf.workflowId, wf.overlay], ['wf_default', undefined]);
  assert.equal(setup.guardrailsId, 'gr_gone');
  assert.ok(setup.overlay.nodes.n_plan);
});

test('saveDialogError: the name rules, then a case-insensitive duplicate', () => {
  assert.equal(saveDialogError(' ', []), 'name is required');
  assert.equal(saveDialogError('quick FIX', ['Quick fix']), 'A preset with this name already exists');
  assert.equal(saveDialogError('Nightly', ['Quick fix']), '');
});

test('configWithPreset: a preset pick wins over a per-node and a per-role value; the input config is not mutated', () => {
  const config = { humanInLoop: true, steps: { planner: { model: 'role-model' } },
    workflows: { wf_default: { nodes: { n_plan: { model: 'node-model', effort: 'low', fanOut: true } }, wires: { w5: { maxCycles: 4 } } } } };
  const before = structuredClone(config);
  const out = configWithPreset(config, 'wf_default', { humanInLoop: false,
    overlay: { nodes: { n_plan: { model: 'preset-model', effort: 'high' }, n_impl: { model: 'impl-model' } }, wires: { w5: { maxCycles: 1 } } } });
  assert.deepEqual(out.workflows.wf_default.nodes.n_plan, { model: 'preset-model', effort: 'high', fanOut: true });
  assert.deepEqual(out.workflows.wf_default.nodes.n_impl, { model: 'impl-model' }, 'a per-node value wins over the per-role one downstream');
  assert.deepEqual(out.workflows.wf_default.wires.w5, { maxCycles: 1 });
  assert.equal(out.humanInLoop, false);
  assert.deepEqual(config, before);
  assert.deepEqual(configWithPreset(null, 'wf_x', null).workflows.wf_x, { nodes: {}, feedbacks: {}, wires: {} });
});

test('renderBrokenCard: below Advanced the scope hint names the ⋯ menu and Advanced, never Settings › Presets', () => {
  const { document } = new JSDOM('').window;
  const item = { item: 'project', ref: 'api-1', message: 'Project api-1 is no longer registered in worca', reset: false };
  const adv = renderBrokenCard(document, [item]);
  assert.equal(adv.querySelector('.preset-broken-row .muted').textContent, BROKEN_SCOPE_HINT);
  assert.equal(BROKEN_SCOPE_HINT, 'Edit the preset\'s scope in Settings › Presets');
  const simple = renderBrokenCard(document, [item], { canEditScope: false });
  assert.equal(simple.querySelector('.preset-broken-row .muted').textContent, BROKEN_SCOPE_HINT_SIMPLE);
  assert.equal(BROKEN_SCOPE_HINT_SIMPLE, 'Delete the preset from the Preset menu, or switch to Advanced to edit its scope');
  assert.doesNotMatch(simple.textContent, /Settings › Presets/);
});

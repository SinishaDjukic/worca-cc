// test/run-setup-overlay.test.mjs — the requirements run setup overlay: its pure helpers, and its DOM in jsdom with fake loads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'window', 'Event']) Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
after(() => window.close());
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
const {
  computeOverlay, presetsFor, openRunSetupOverlay, LOAD_FAILED_TEXT, PRESETS_UNAVAILABLE_TEXT, V1_LOOPS_TEXT, defaultFetchers,
} = await import('../ui/public/run-setup-overlay.mjs');

// ---- pure helpers ----
test('computeOverlay: every agent row with a model, preset toggles and roles carried, v2 wires only, empty is null', () => {
  const rows = [{ nodeId: 'n_a', model: 'claude-opus-5-5', effort: 'high' }, { nodeId: 'n_b', model: '', effort: '' },
    { nodeId: 'n_c', model: 'claude-haiku-5-5', effort: '' }];
  const preset = { nodes: { n_a: { model: 'other', effort: 'low', fanOut: true, roles: { sec: { model: 'm' } } }, n_b: { askQuestions: false }, n_zzz: { fanOut: true } } };
  const loops = [{ fbId: 'w5', maxCycles: 4, editable: true }, { fbId: 'fb_0', maxCycles: 3, editable: false }];
  assert.deepEqual(computeOverlay(rows, loops, preset), {
    nodes: { n_a: { model: 'claude-opus-5-5', effort: 'high', fanOut: true, roles: { sec: { model: 'm' } } },
      n_b: { askQuestions: false }, n_c: { model: 'claude-haiku-5-5', effort: '' } },
    wires: { w5: { maxCycles: 4 } },
  });
  assert.deepEqual(computeOverlay(rows.slice(0, 1), [], null), { nodes: { n_a: { model: 'claude-opus-5-5', effort: 'high' } } });
  assert.equal(computeOverlay([{ nodeId: 'n_b', model: '' }], [{ fbId: 'fb_0', maxCycles: 3, editable: false }], null), null);
  assert.equal(computeOverlay([], [], null), null);
});

test('presetsFor: this workflow only; any-project presets and this scope\'s, never another project\'s pin', () => {
  const p = (id, workflowId, scope) => ({ id, name: id, scope, setup: { workflowId } });
  const all = [p('a', 'wf_x', { kind: 'global' }), p('b', 'wf_x', { kind: 'project', ref: 'shop-1' }), p('c', 'wf_x', { kind: 'project', ref: 'other-2' }),
    p('d', 'wf_y', { kind: 'global' }), p('e', 'wf_x', { kind: 'workspace', ref: 'ws1' })];
  assert.deepEqual(presetsFor(all, 'wf_x', { kind: 'project', ref: 'shop-1' }).map((x) => x.id), ['a', 'b']);
  assert.deepEqual(presetsFor(all, 'wf_x', { kind: 'workspace', ref: 'ws1' }).map((x) => x.id), ['a', 'e']);
  assert.deepEqual(presetsFor(null, 'wf_x', { kind: 'project', ref: 'shop-1' }), []);
});

// ---- DOM ----
const AGENTS = [
  { key: 'planner', displayName: 'Plan', inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'implementer', displayName: 'Implement', inputs: [{ id: 'fix', type: 'md', required: false, loop: true }, { id: 'plan', type: 'md', required: true }],
    outputs: [{ id: 'done', type: 'void', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review', inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const WF = {
  id: 'wf_g', name: 'Graph', version: 2,
  nodes: [
    { id: 'n_task', kind: 'task', config: {} },
    { id: 'n_plan', kind: 'agent', key: 'planner', config: {} },
    { id: 'n_impl', kind: 'agent', key: 'implementer', config: { model: 'claude-sonnet-5-5', effort: 'medium' } },
    { id: 'n_review', kind: 'agent', key: 'reviewer', config: {} },
    { id: 'n_end', kind: 'end', config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
    { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
    { id: 'w3', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_review', port: 'plan' } },
    { id: 'w4', from: { node: 'n_impl', port: 'done' }, to: { node: 'n_review', port: 'done' } },
    { id: 'w5', from: { node: 'n_review', port: 'review' }, to: { node: 'n_impl', port: 'fix' }, config: { maxCycles: 4 } },
    { id: 'w6', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ],
};
const WF_V1 = { id: 'wf_old', name: 'Old', steps: [[{ id: 's0_0', key: 'implementer' }], [{ id: 's1_0', key: 'reviewer' }]], feedbacks: [{ id: 'fb_0', from: 's1_0', to: 's0_0' }] };
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], connection: { kind: 'signin', engine: 'claude' } },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', efforts: ['medium', 'high'], connection: { kind: 'signin', engine: 'claude' } },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5', efforts: [], connection: { kind: 'signin', engine: 'claude' } },
];
const PRESET = { id: 'p1', name: 'Careful', scope: { kind: 'global' },
  setup: { workflowId: 'wf_g', overlay: { nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high', fanOut: true } }, wires: { w5: { maxCycles: 6 } } } } };
const OTHER_PRESET = { id: 'p2', name: 'Elsewhere', scope: { kind: 'global' }, setup: { workflowId: 'wf_other' } };

function fakeLoads(over = {}) {
  const calls = [];
  const wrap = (name, v) => async (...a) => { calls.push(name); if (over[name]) return over[name](...a); return v(...a); };
  return { calls, loads: {
    workflow: wrap('workflow', async () => WF), agents: wrap('agents', async () => AGENTS), scripts: wrap('scripts', async () => []),
    config: wrap('config', async () => ({ config: { workflows: { wf_g: { nodes: { n_review: { model: 'claude-opus-5-5', effort: 'high' } } } } }, models: MODELS })),
    runDefaults: wrap('runDefaults', async () => ({ engine: { value: 'claude' }, steps: { claude: {} } })),
    presets: wrap('presets', async () => [PRESET, OTHER_PRESET]),
  } };
}
function fakeModal() {
  const m = { opts: null, card: null, closes: [] };
  m.open = (card, opts) => { m.card = card; m.opts = opts; document.body.append(card); };
  m.close = (restore) => { m.closes.push(restore); m.card.remove(); m.opts.onClose(); };
  return m;
}
async function open(over = {}, args = {}) {
  const { loads, calls } = fakeLoads(over);
  const modal = fakeModal();
  const events = { confirms: [], cancels: 0 };
  const onConfirm = args.onConfirm || (async (o) => { events.confirms.push(o); return {}; });
  const handle = openRunSetupOverlay({ modal, workflowId: 'wf_g', workflowName: 'Graph', projectDir: '/p', scopeRef: { kind: 'project', ref: 'shop-1' },
    fetchers: loads, onConfirm, onCancel: () => { events.cancels += 1; }, ...args });
  await settle();
  return { modal, events, handle, calls, q: (s) => modal.card.querySelector(s), qa: (s) => [...modal.card.querySelectorAll(s)] };
}
const change = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); };
const typeInto = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

test('the workflow is a text label with no select; the rows show the project config over the workflow\'s own', async () => {
  const o = await open();
  assert.equal(o.q('[data-ui="runsetup-workflow"]').textContent, 'Graph');
  assert.equal(o.q('[data-ui="runsetup-workflow"]').tagName, 'B');
  assert.equal(o.qa('select[data-ui="build-workflow"], #req-build-wf').length, 0);
  assert.match(o.modal.card.textContent, /cancel and change it on the card/);
  assert.deepEqual(o.qa('.req-runsetup-row').map((r) => r.dataset.nodeId), ['n_plan', 'n_impl', 'n_review']);
  assert.equal(o.q('[data-ui="model-n_impl"]').value, 'claude-sonnet-5-5');
  assert.equal(o.q('[data-ui="effort-n_impl"]').value, 'medium');
  assert.equal(o.q('[data-ui="model-n_review"]').value, 'claude-opus-5-5');
  assert.equal(o.q('[data-ui="effort-n_review"]').value, 'high');
  assert.equal(o.q('[data-ui="model-n_plan"]').value, '');
  assert.equal(o.q('[data-ui="effort-n_plan"]').disabled, true, 'no model, no effort');
  assert.deepEqual(o.qa('.req-runsetup-cycles').map((i) => [i.dataset.fbId, i.value]), [['w5', '4']]);
  assert.equal(o.q('[data-ui="runsetup-go"]').textContent, 'Start run');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, false);
});

test('edits: a model change resets an effort the new model lacks; a loop input is bounded; confirm sends exactly what is shown', async () => {
  const o = await open();
  change(o.q('[data-ui="model-n_impl"]'), 'claude-haiku-5-5');
  assert.equal(o.q('[data-ui="effort-n_impl"]').value, '', 'Haiku lists no efforts: medium is dropped');
  change(o.q('[data-ui="model-n_plan"]'), 'claude-opus-5-5');
  change(o.q('[data-ui="effort-n_plan"]'), 'high');
  change(o.q('[data-ui="model-n_review"]'), 'claude-sonnet-5-5');
  assert.equal(o.q('[data-ui="effort-n_review"]').value, 'high', 'high is listed by Sonnet and stays');
  change(o.q('[data-ui="effort-n_review"]'), 'medium');
  const cycles = o.q('.req-runsetup-cycles');
  typeInto(cycles, '0');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, true, 'a cycle count below 1 blocks Start run');
  typeInto(cycles, '101');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, true);
  typeInto(cycles, '7');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, false);
  o.q('[data-ui="runsetup-go"]').click();
  await settle();
  assert.deepEqual(o.events.confirms, [{
    nodes: { n_plan: { model: 'claude-opus-5-5', effort: 'high' }, n_impl: { model: 'claude-haiku-5-5', effort: '' }, n_review: { model: 'claude-sonnet-5-5', effort: 'medium' } },
    wires: { w5: { maxCycles: 7 } } }]);
  assert.equal(o.modal.closes.length, 1, 'closed after a successful confirm');
  assert.equal(o.events.cancels, 0);
});

test('presets: only this workflow\'s are listed; applying re-derives the rows; No preset goes back to the project\'s', async () => {
  const o = await open();
  const sel = o.q('[data-ui="runsetup-preset"]');
  assert.deepEqual([...sel.options].map((x) => x.textContent), ['No preset', 'Careful'], 'the preset of another workflow is not offered');
  assert.match(o.modal.card.textContent, /Applies the preset's agent and loop settings only\./);
  change(sel, 'p1');
  assert.equal(o.q('[data-ui="model-n_plan"]').value, 'claude-opus-5-5');
  assert.equal(o.q('[data-ui="effort-n_plan"]').value, 'high');
  assert.equal(o.q('.req-runsetup-cycles').value, '6');
  o.q('[data-ui="runsetup-go"]').click();
  await settle();
  assert.deepEqual(o.events.confirms[0].nodes.n_plan, { model: 'claude-opus-5-5', effort: 'high', fanOut: true }, 'the preset\'s toggle rides along');
  assert.equal(o.events.confirms[0].wires.w5.maxCycles, 6);

  const p = await open();
  change(p.q('[data-ui="runsetup-preset"]'), 'p1');
  change(p.q('[data-ui="runsetup-preset"]'), '');
  assert.equal(p.q('[data-ui="model-n_plan"]').value, '');
  assert.equal(p.q('.req-runsetup-cycles').value, '4');
  p.q('[data-ui="runsetup-go"]').click();
  await settle();
  assert.equal('fanOut' in p.events.confirms[0].nodes.n_review, false, 'no preset applied, no preset toggles');
  assert.equal(p.events.confirms[0].nodes.n_plan, undefined);
});

test('a preset\'s model without an effort shows Default effort, not the project\'s saved effort for that node (m5)', async () => {
  const preset = { ...PRESET, setup: { workflowId: 'wf_g', overlay: { nodes: { n_review: { model: 'claude-sonnet-5-5' } } } } };
  const o = await open({ presets: async () => [preset] });
  assert.equal(o.q('[data-ui="effort-n_review"]').value, 'high', 'the saved effort before the preset');
  change(o.q('[data-ui="runsetup-preset"]'), 'p1');
  assert.equal(o.q('[data-ui="model-n_review"]').value, 'claude-sonnet-5-5');
  assert.equal(o.q('[data-ui="effort-n_review"]').value, '');
  o.q('[data-ui="runsetup-go"]').click();
  await settle();
  assert.deepEqual(o.events.confirms[0].nodes.n_review, { model: 'claude-sonnet-5-5', effort: '' });
});

test('a derived loop budget over the cap is flagged and holds Start run until edited; a model outside the list is marked (m1)', async () => {
  const o = await open({
    config: async () => ({ config: { workflows: { wf_g: { nodes: { n_impl: { model: 'gone-model-1' } }, wires: { w5: { maxCycles: 150 } } } } }, models: MODELS }),
  });
  const cycles = o.q('.req-runsetup-cycles');
  assert.equal(cycles.value, '150', 'shown as saved');
  assert.equal(cycles.getAttribute('aria-invalid'), 'true');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, true);
  assert.equal(o.q('[data-ui="model-n_impl"]').getAttribute('aria-invalid'), 'true');
  typeInto(cycles, '9');
  assert.equal(cycles.getAttribute('aria-invalid'), 'false');
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, false);
  change(o.q('[data-ui="model-n_impl"]'), 'claude-sonnet-5-5');
  assert.equal(o.q('[data-ui="model-n_impl"]').hasAttribute('aria-invalid'), false);
});

test('presets failing: the settings still show, with the note', async () => {
  const o = await open({ presets: async () => { throw new Error('down'); } });
  assert.equal(o.q('[data-ui="runsetup-preset"]'), null);
  assert.match(o.modal.card.textContent, new RegExp(PRESETS_UNAVAILABLE_TEXT));
  assert.equal(o.qa('.req-runsetup-row').length, 3);
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, false);
});

test('a v1 workflow shows its loops read-only and sends no wires', async () => {
  const o = await open({ workflow: async () => WF_V1 }, { workflowId: 'wf_old', workflowName: 'Old' });
  assert.match(o.modal.card.textContent, new RegExp(V1_LOOPS_TEXT.replace(/\./g, '\\.')));
  assert.equal(o.qa('.req-runsetup-cycles').length, 0);
  assert.equal(o.qa('.req-runsetup-loop.readonly').length, 1);
  change(o.q('[data-ui="model-s0_0"]'), 'claude-opus-5-5');
  o.q('[data-ui="runsetup-go"]').click();
  await settle();
  assert.equal('wires' in o.events.confirms[0], false);
  assert.equal(o.events.confirms[0].nodes.s0_0.model, 'claude-opus-5-5');
});

test('a settings load failure (a deleted workflow\'s 404 too) says so, with Cancel only', async () => {
  for (const over of [{ workflow: async () => { throw Object.assign(new Error('gone'), { status: 404 }); } }, { config: async () => { throw new Error('x'); } },
    { runDefaults: async () => { throw new Error('x'); } }, { agents: async () => { throw new Error('x'); } }]) {
    const o = await open(over);
    assert.match(o.modal.card.textContent, new RegExp(LOAD_FAILED_TEXT));
    assert.equal(o.q('[data-ui="runsetup-go"]').hidden, true);
    assert.equal(o.qa('.req-runsetup-row').length, 0);
    o.q('[data-ui="runsetup-cancel"]').click();
    assert.equal(o.events.cancels, 1);
  }
});

test('Start run waits for the loads; Cancel and Escape call onCancel and send nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const o = await open({ workflow: async () => { await gate; return WF; } });
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, true, 'loading');
  release(); await settle();
  assert.equal(o.q('[data-ui="runsetup-go"]').disabled, false);
  o.q('[data-ui="runsetup-cancel"]').click();
  assert.deepEqual([o.events.cancels, o.events.confirms.length, o.modal.closes], [1, 0, [true]]);

  const e = await open();
  e.modal.opts.onClose();   // the page's Escape closes its dialog, which reports here
  assert.deepEqual([e.events.cancels, e.events.confirms.length], [1, 0]);
});

test('a load that finishes after the overlay closed paints nothing', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const o = await open({ config: async () => { await gate; return { config: {}, models: MODELS }; } });
  o.q('[data-ui="runsetup-cancel"]').click();
  release(); await settle();
  assert.equal(o.qa('.req-runsetup-row').length, 0);
});

test('an error from onConfirm stays in the overlay, Start run is back, and the next confirm can succeed; in flight it is disabled', async () => {
  let n = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const sent = [];
  const o = await open({}, { onConfirm: async (overlay) => { sent.push(overlay); n += 1; await gate; return n === 1 ? { error: 'bad model for this engine' } : {}; } });
  const go = o.q('[data-ui="runsetup-go"]');
  go.click();
  await settle();
  assert.equal(go.disabled, true, 'in flight');
  assert.equal(o.modal.opts.canClose(), false, 'Escape is held while in flight');
  go.click();
  assert.equal(sent.length, 1, 'no second request');
  release(); await settle();
  assert.equal(o.q('.req-runsetup-msg').textContent, 'bad model for this engine');
  assert.equal(go.disabled, false);
  assert.equal(o.modal.closes.length, 0, 'the overlay stays');
  assert.equal(o.events.cancels, 0);
  go.click();
  await settle();
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1], sent[0]);
  assert.equal(o.modal.closes.length, 1);
});

test('the overlay never writes config or presets: its only requests are reads', async () => {
  const seen = [];
  const fetchFn = async (url, opts = {}) => {
    seen.push(`${opts.method || 'GET'} ${url}`);
    const body = url.startsWith('/api/workflows/') ? WF : url.startsWith('/api/agents') ? { agents: AGENTS } : url.startsWith('/api/scripts') ? { scripts: [] }
      : url.startsWith('/api/config') ? { config: {}, models: MODELS } : url.startsWith('/api/run-defaults') ? { engine: { value: 'claude' }, steps: {} }
        : { presets: [PRESET] };
    return { ok: true, status: 200, json: async () => body };
  };
  const modal = fakeModal();
  openRunSetupOverlay({ modal, workflowId: 'wf_g', workflowName: 'Graph', projectDir: '/p dir', scopeRef: { kind: 'project', ref: 'k' },
    fetchers: defaultFetchers(fetchFn), onConfirm: async () => ({}), onCancel() {} });
  await settle();
  modal.card.querySelector('[data-ui="runsetup-go"]').click();
  await settle();
  assert.ok(seen.every((s) => s.startsWith('GET ')), seen.join('\n'));
  assert.ok(seen.includes('GET /api/config?projectDir=%2Fp%20dir'));
  assert.ok(seen.includes('GET /api/run-defaults?projectDir=%2Fp%20dir'));
  assert.ok(seen.includes('GET /api/workflows/wf_g'));
  assert.equal(modal.card.querySelectorAll('.req-runsetup-row').length, 3);
});

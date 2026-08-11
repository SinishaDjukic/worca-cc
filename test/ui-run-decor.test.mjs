// test/ui-run-decor.test.mjs
//
// Run monitor v2 (spec §7): the live decor layer that turns an exec ledger into
// node status, per-node execution rows, loop badges, gate pips and ants on top of
// the SHARED graph renderer (ui/public/graph/graph-view.mjs). No app.js boot —
// run-decor is a pure module plus one DOM pass, so it is testable the same way
// graph-view is (jsdom + a hand-built manifest).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { createGraphView } from '../ui/public/graph/graph-view.mjs';
import { mergePalette } from '../ui/public/graph/agents-meta.mjs';
import { nodeSize } from '../ui/public/graph/graph-geometry.mjs';
import {
  QUIESCENCE_WARNING,
  manifestNodes,
  manifestWires,
  manifestTemplate,
  manifestPortsFn,
  manifestAgents,
  isGraphManifest,
  nodeStatusMap,
  executionRows,
  stripText,
  loopBadgeCounts,
  antWireIds,
  gateNodeId,
  endResult,
  runWarnings,
  nodeColor,
  legacyChipRows,
  decorate,
  subFanHtml,
  fmtDur,
  fmtUsd,
} from '../ui/public/graph/run-decor.mjs';

// --------------------------------------------------------------------------
// Fixtures — hand-built buildGraphManifest() output (src/core/workflows.mjs:567).
// Double-loop shape of the re-seeded templates: the two blocking reviews fan
// into an OR valve whose plain `out` feeds the implementer's loop input.
// --------------------------------------------------------------------------
const IN = (id, type, extra = {}) => ({ id, type, required: true, loop: false, expands: false, ...extra });
const AWAIT = { id: 'await', type: 'any', required: false, loop: false, expands: false };
const OUT = (id, type, when = 'always') => ({ id, type, when });

function manifest() {
  return {
    version: 2,
    graph: {
      nodes: [
        { id: 'n_task', kind: 'task', key: null, label: 'Task', color: '', sub: '', x: 60, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [], outputs: [OUT('task', 'md')] } },
        { id: 'n_impl', kind: 'agent', key: 'implementer', label: 'Implementation', color: 'peach', sub: '', x: 360, y: 200, model: 'Opus 4.8', effort: 'high', loop: true,
          ports: { inputs: [IN('plan', 'md'), IN('fix', 'md', { required: false, loop: true }), AWAIT], outputs: [OUT('code', 'md')] } },
        { id: 'n_review', kind: 'agent', key: 'reviewer', label: 'Review Implementation', color: 'blue', sub: '', x: 660, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [IN('code', 'md'), AWAIT], outputs: [OUT('pass', 'md', 'clean'), OUT('review', 'json', 'blocking')] } },
        { id: 'n_webui', kind: 'agent', key: 'manualWebUiTesting', label: 'Manual web UI testing', color: 'violet', sub: '', x: 960, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [IN('code', 'md'), AWAIT], outputs: [OUT('pass', 'md', 'clean'), OUT('review', 'json', 'blocking')] } },
        { id: 'n_or', kind: 'or', key: null, label: 'OR', color: '', sub: '', x: 660, y: 430, model: '', effort: '', loop: false,
          ports: { inputs: [IN('in1', 'json'), IN('in2', 'json')], outputs: [OUT('out', 'json')] } },
        { id: 'n_end', kind: 'end', key: null, label: 'End', color: '', sub: '', x: 1260, y: 200, model: '', effort: '', loop: false,
          ports: { inputs: [IN('result', 'any')], outputs: [] } },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'plan' }, loop: false },
        { id: 'w2', from: { node: 'n_impl', port: 'code' }, to: { node: 'n_review', port: 'code' }, loop: false },
        { id: 'w3', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in1' }, loop: true, maxCycles: 3 },
        { id: 'w4', from: { node: 'n_impl', port: 'code' }, to: { node: 'n_webui', port: 'code' }, loop: false },
        { id: 'w5', from: { node: 'n_webui', port: 'review' }, to: { node: 'n_or', port: 'in2' }, loop: true, maxCycles: 3 },
        { id: 'w6', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: false },
        { id: 'w7', from: { node: 'n_review', port: 'pass' }, to: { node: 'n_end', port: 'result' }, loop: false },
      ],
    },
    bookends: { preflight: true, done: true },
  };
}

// A template whose loop input is NOT the builtin `fix` — pins that the row label
// reads the port id off the manifest instead of a hardcoded name (genericity charter).
function customLoopManifest() {
  return {
    version: 2,
    graph: {
      nodes: [
        { id: 'n_a', kind: 'agent', key: 'custom', label: 'Custom', color: 'green', sub: '', x: 60, y: 60, model: '', effort: '', loop: true,
          ports: { inputs: [IN('spec', 'md'), IN('redo', 'md', { required: false, loop: true }), AWAIT], outputs: [OUT('out', 'md')] } },
      ],
      wires: [{ id: 'wr', from: { node: 'n_a', port: 'out' }, to: { node: 'n_a', port: 'redo' }, loop: true, maxCycles: 3 }],
    },
    bookends: { preflight: true, done: true },
  };
}

const exec = (o) => ({ kind: 'cycle', status: 'done', costUsd: 0, ...o });
const step = (executionId, o) => ({ key: executionId, executionId, status: 'done', activeMs: 0, runningSince: null, ...o });

/** A decor bag with the defaults every caller shares. */
function decor(o = {}) {
  return {
    live: true,
    runStatus: 'running',
    active: [],
    executions: [],
    steps: [],
    endReached: false,
    result: null,
    warnings: [],
    gateWireId: null,
    expanded: [],
    now: 0,
    ...o,
  };
}

function dom() {
  const d = new JSDOM('<!doctype html><body><div id="host"></div></body>');
  return { doc: d.window.document, window: d.window };
}

const palette = Object.fromEntries(mergePalette(null).map((a) => [a.key, a]));

function mount(m = manifest(), d = decor()) {
  const { doc, window } = dom();
  const host = doc.getElementById('host');
  const view = createGraphView(host, { doc, portsFn: manifestPortsFn(m), agents: manifestAgents(m, palette) });
  view.render(manifestTemplate(m));
  decorate(view, m, d);
  return { doc, window, host, view, m, d };
}

const card = (host, id) => host.querySelector(`.node[data-node-id="${id}"]`);
const wire = (host, id) => host.querySelector(`path[data-wire-id="${id}"]`);
const txt = (el) => (el ? el.textContent.trim() : null);

// --------------------------------------------------------------------------
// Manifest readers
// --------------------------------------------------------------------------

test('manifest readers flatten v2 graph nodes and wires', () => {
  const m = manifest();
  assert.equal(isGraphManifest(m), true);
  assert.deepEqual(manifestNodes(m).map((n) => n.id), ['n_task', 'n_impl', 'n_review', 'n_webui', 'n_or', 'n_end']);
  assert.deepEqual(manifestWires(m).map((w) => w.id), ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']);
});

test('manifestPortsFn marks the synthesized await input synthetic so the gate row renders', () => {
  const m = manifest();
  const ports = manifestPortsFn(m);
  const impl = ports({ id: 'n_impl', kind: 'agent' });
  assert.equal(impl.inputs.find((p) => p.id === 'await').synthetic, true);
  assert.equal(impl.inputs.find((p) => p.id === 'plan').synthetic, undefined);
  const { host } = mount();
  assert.ok(card(host, 'n_impl').querySelector('.prow.gate[data-port="await"]'));
});

test('manifestTemplate carries maxCycles into wire config so graph-view paints the budget badge', () => {
  const t = manifestTemplate(manifest());
  assert.equal(t.wires.find((w) => w.id === 'w3').config.maxCycles, 3);
  assert.equal(t.wires.find((w) => w.id === 'w6').config.maxCycles, undefined);
  const { host } = mount();
  assert.equal(txt(host.querySelector('.wbadge[data-wire-id="w3"]')), '≤3');
  assert.equal(host.querySelector('.wbadge[data-wire-id="w6"]'), null);
});

test('manifestAgents prefers the manifest label/colour over the palette entry', () => {
  const m = manifest();
  m.graph.nodes[1].label = 'Renamed Impl';
  m.graph.nodes[1].color = 'green';
  const agents = manifestAgents(m, palette);
  assert.equal(agents.implementer.displayName, 'Renamed Impl');
  assert.equal(agents.implementer.color, 'green');
  assert.equal(agents.implementer.icon, palette.implementer.icon);
});

// --------------------------------------------------------------------------
// Exec ledger -> node status map
// --------------------------------------------------------------------------

test('exec ledger maps to a node status map', () => {
  const m = manifest();
  const d = decor({
    active: [{ nodeId: 'n_review', executionId: 'x:n_review:1' }],
    executions: [
      exec({ executionId: 'x:n_task:1', nodeId: 'n_task', ordinal: 1, agentKey: null, status: 'done' }),
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', status: 'done' }),
      exec({ executionId: 'x:n_review:1', nodeId: 'n_review', ordinal: 1, agentKey: 'reviewer', status: 'start' }),
    ],
  });
  assert.deepEqual(nodeStatusMap(m, d), {
    n_task: 'done',
    n_impl: 'done',
    n_review: 'active',
    n_webui: 'pending',
    n_or: 'pending',
    n_end: 'pending',
  });
});

test('an errored execution puts its node in error; a paused step row wins over exec done', () => {
  const m = manifest();
  const errored = nodeStatusMap(m, decor({
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'error', error: 'boom' })],
  }));
  assert.equal(errored.n_impl, 'error');

  // The scheduler completes a paused execution as 'done' (orchestrator.mjs:2017);
  // only the step row knows it parked. The step row must win.
  const paused = nodeStatusMap(m, decor({
    runStatus: 'paused',
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'done' })],
    steps: [step('x:n_impl:1', { status: 'paused' })],
  }));
  assert.equal(paused.n_impl, 'paused');
});

test('node status classes land on the rendered cards', () => {
  const { host } = mount(manifest(), decor({
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }],
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, status: 'start' })],
  }));
  assert.ok(card(host, 'n_impl').classList.contains('is-active'));
  assert.ok(card(host, 'n_review').classList.contains('is-pending'));
  // The base graph-view classes survive the decor pass.
  assert.ok(card(host, 'n_impl').classList.contains('node-agent'));
  assert.ok(card(host, 'n_end').classList.contains('pinned'));
  // --c drives the glow: the node's own palette token, none for flow cards.
  assert.equal(card(host, 'n_impl').style.getPropertyValue('--c'), 'var(--peach)');
  assert.equal(card(host, 'n_or').style.getPropertyValue('--c'), '');
});

// --------------------------------------------------------------------------
// Executions footer
// --------------------------------------------------------------------------

test('execution rows read cycle + loop-input port from the trigger', () => {
  const m = manifest();
  const d = decor({
    live: false,
    executions: [
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', costUsd: 0.7, trigger: { wireIds: ['w1'], freshPorts: ['plan'] } }),
      exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', costUsd: 0.42, trigger: { wireIds: ['w6'], freshPorts: ['fix'] } }),
    ],
    steps: [step('x:n_impl:1', { activeMs: 60_000 }), step('x:n_impl:2', { activeMs: 130_000 })],
  });
  const rows = executionRows(m, d).n_impl;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, 'cycle 1');
  assert.equal(rows[1].label, 'cycle 2 · fix');
  assert.equal(rows[1].text, 'cycle 2 · fix · 2m 10s · $0.42');
});

test('a custom loop input renders its own port id, never a builtin name', () => {
  const m = customLoopManifest();
  const rows = executionRows(m, decor({
    live: false,
    executions: [
      exec({ executionId: 'x:n_a:1', nodeId: 'n_a', ordinal: 1, agentKey: 'custom', trigger: { wireIds: [], freshPorts: ['spec'] } }),
      exec({ executionId: 'x:n_a:2', nodeId: 'n_a', ordinal: 2, agentKey: 'custom', trigger: { wireIds: ['wr'], freshPorts: ['redo'] } }),
    ],
  })).n_a;
  assert.equal(rows[0].label, 'cycle 1');
  assert.equal(rows[1].label, 'cycle 2 · redo');
});

test('await is not a loop input, so a pure-await re-fire labels plainly', () => {
  const m = manifest();
  const rows = executionRows(m, decor({
    executions: [exec({ executionId: 'x:n_review:2', nodeId: 'n_review', ordinal: 2, agentKey: 'reviewer', trigger: { wireIds: [], freshPorts: ['await'] } })],
  })).n_review;
  assert.equal(rows[0].label, 'cycle 2');
});

test('a composite task execution row uses the truncated task title', () => {
  const m = manifest();
  const long = 'Port the run monitor onto the shared graph renderer and add executions';
  const rows = executionRows(m, decor({
    executions: [exec({ executionId: 'x:n_impl:1:p1t1', nodeId: 'n_impl', ordinal: 1, kind: 'task', title: long })],
  })).n_impl;
  assert.equal(rows[0].label.length <= 40, true);
  assert.ok(rows[0].label.startsWith('Port the run monitor'));
  assert.ok(rows[0].label.endsWith('…'));
});

test('flow executions are $0 instant engine rows — no cost pill', () => {
  const m = manifest();
  const rows = executionRows(m, decor({
    live: false,
    executions: [exec({ executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, agentKey: null, costUsd: 0 })],
    steps: [],
  })).n_or;
  assert.equal(rows[0].flow, true);
  assert.equal(rows[0].text, 'cycle 1');
  assert.ok(!rows[0].text.includes('$'));
  // An AGENT execution that cost nothing still says so — only flow rows go bare.
  const agent = executionRows(m, decor({
    live: false,
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', costUsd: 0 })],
  })).n_impl;
  assert.equal(agent[0].text, 'cycle 1 · $0.00');
});

test('collapsed strip sums runs and cost', () => {
  const rows = [{ costUsd: 0.7 }, { costUsd: 0.42 }, { costUsd: 0 }];
  assert.equal(stripText(rows), '3 runs · $1.12');
  assert.equal(stripText([{ costUsd: 0.5 }]), '1 run · $0.50');
  assert.equal(stripText([{ costUsd: 0 }]), '1 run');
  assert.equal(stripText([]), '');
});

test('the executions footer renders collapsed by default and expands to rows', () => {
  const m = manifest();
  const base = {
    live: false,
    executions: [
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', costUsd: 0.7, trigger: { wireIds: ['w1'], freshPorts: ['plan'] } }),
      exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', costUsd: 0.42, trigger: { wireIds: ['w6'], freshPorts: ['fix'] } }),
    ],
    steps: [step('x:n_impl:1', { activeMs: 60_000 }), step('x:n_impl:2', { activeMs: 130_000 })],
  };
  const collapsed = mount(m, decor(base));
  const foot = card(collapsed.host, 'n_impl').querySelector('.xfoot');
  assert.ok(foot);
  assert.equal(txt(foot.querySelector('.xsum')), '2 runs · $1.12');
  assert.equal(foot.querySelector('.xtoggle').getAttribute('aria-expanded'), 'false');
  assert.equal(foot.querySelectorAll('.xrow').length, 0);
  assert.equal(card(collapsed.host, 'n_review').querySelector('.xfoot'), null, 'no executions -> no footer');

  const open = mount(m, decor({ ...base, expanded: ['n_impl'] }));
  const rows = [...card(open.host, 'n_impl').querySelectorAll('.xrow')];
  assert.deepEqual(rows.map((r) => r.dataset.executionId), ['x:n_impl:1', 'x:n_impl:2']);
  assert.equal(txt(rows[1].querySelector('.xl')), 'cycle 2 · fix');
  assert.equal(txt(rows[1].querySelector('.xr')), '2m 10s · $0.42');
  assert.equal(card(open.host, 'n_impl').querySelector('.xtoggle').getAttribute('aria-expanded'), 'true');
});

test('expanding executions changes the card height through footerRows', () => {
  const m = manifest();
  const ports = manifestPortsFn(m)({ id: 'n_impl', kind: 'agent' });
  const base = {
    live: false,
    executions: [
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer' }),
      exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer' }),
    ],
  };
  const collapsed = mount(m, decor(base));
  const open = mount(m, decor({ ...base, expanded: ['n_impl'] }));
  assert.equal(card(collapsed.host, 'n_impl').style.height, `${nodeSize(ports, { footerRows: 1 }).h}px`);
  assert.equal(card(open.host, 'n_impl').style.height, `${nodeSize(ports, { footerRows: 3 }).h}px`);
});

test('node header shows duration and cost summed over its executions', () => {
  const { host } = mount(manifest(), decor({
    live: false,
    executions: [
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', costUsd: 0.7 }),
      exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', costUsd: 0.42 }),
    ],
    steps: [step('x:n_impl:1', { activeMs: 60_000 }), step('x:n_impl:2', { activeMs: 130_000 })],
  }));
  const run = card(host, 'n_impl').querySelector('.nrun');
  assert.equal(txt(run.querySelector('.dur')), '3m 10s');
  assert.equal(txt(run.querySelector('.cost')), '$1.12');
  // A node that never ran has no totals at all — blank vs $0.00 is the
  // never-ran / ran-for-free distinction.
  assert.equal(card(host, 'n_review').querySelector('.nrun'), null);
});

test('an executed-but-zero agent node reads $0.00; a flow node gets no cost pill', () => {
  const { host } = mount(manifest(), decor({
    live: false,
    executions: [
      exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer', costUsd: 0 }),
      exec({ executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, agentKey: null, costUsd: 0 }),
    ],
    steps: [step('x:n_impl:1', { activeMs: 0 })],
  }));
  assert.equal(txt(card(host, 'n_impl').querySelector('.nrun .cost')), '$0.00');
  assert.equal(txt(card(host, 'n_impl').querySelector('.nrun .dur')), '0s');
  assert.equal(txt(card(host, 'n_or').querySelector('.nrun .cost')), '');
});

// --------------------------------------------------------------------------
// End card, quiescence, drain
// --------------------------------------------------------------------------

test('End binds a md payload and renders it as an artifact link', () => {
  const m = manifest();
  const d = decor({
    live: false,
    runStatus: 'done',
    endReached: true,
    result: { type: 'md', path: '/tmp/pl/reviews/impl-review-cycle2.md' },
    executions: [exec({ executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, agentKey: null, result: { type: 'md', path: '/tmp/pl/reviews/impl-review-cycle2.md' } })],
  });
  assert.deepEqual(endResult(d), { nodeId: 'n_end', path: '/tmp/pl/reviews/impl-review-cycle2.md', text: 'impl-review-cycle2.md' });
  const { host } = mount(m, d);
  const end = card(host, 'n_end');
  assert.ok(end.classList.contains('is-done'));
  const link = end.querySelector('.xresult a');
  assert.equal(txt(link), 'impl-review-cycle2.md');
  assert.equal(link.dataset.path, '/tmp/pl/reviews/impl-review-cycle2.md');
});

test('a void End payload renders the em-dash completed treatment', () => {
  const d = decor({
    live: false, runStatus: 'done', endReached: true, result: { type: 'void' },
    executions: [exec({ executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, result: { type: 'void' } })],
  });
  assert.deepEqual(endResult(d), { nodeId: 'n_end', path: null, text: '— completed' });
  const { host } = mount(manifest(), d);
  assert.equal(txt(card(host, 'n_end').querySelector('.xresult')), '— completed');
  assert.equal(card(host, 'n_end').querySelector('.xresult a'), null);
});

test('a run that finished at quiescence skips End and raises the warning banner', () => {
  const d = decor({
    live: false,
    runStatus: 'done',
    endReached: false,
    warnings: [QUIESCENCE_WARNING],
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer' })],
  });
  assert.equal(QUIESCENCE_WARNING, 'finished at quiescence — End not reached');
  assert.deepEqual(runWarnings(d), [QUIESCENCE_WARNING]);
  assert.equal(nodeStatusMap(manifest(), d).n_end, 'skipped');
  const { host } = mount(manifest(), d);
  assert.ok(card(host, 'n_end').classList.contains('is-skipped'));
  assert.equal(card(host, 'n_end').querySelector('.xresult'), null);
  // A live run has not resolved yet — End stays pending, no banner.
  assert.deepEqual(runWarnings(decor({ warnings: [] })), []);
  assert.equal(nodeStatusMap(manifest(), decor()).n_end, 'pending');
});

test('a post-End publish is recorded, not routed: done row, no wire animates', () => {
  const m = manifest();
  const d = decor({
    live: true,
    runStatus: 'running',
    endReached: true,
    result: { type: 'md', path: '/tmp/p/final.md' },
    active: [],
    executions: [
      exec({ executionId: 'x:n_end:1', nodeId: 'n_end', ordinal: 1, result: { type: 'md', path: '/tmp/p/final.md' } }),
      // drained in-flight webui execution that published after End bound
      exec({ executionId: 'x:n_webui:1', nodeId: 'n_webui', ordinal: 1, agentKey: 'manualWebUiTesting', status: 'done', trigger: { wireIds: ['w4'], freshPorts: ['code'] } }),
    ],
    tokens: [{ seq: 9, from: { node: 'n_webui', port: 'review' }, type: 'json', path: '/tmp/p/webui.json' }],
  });
  assert.equal(nodeStatusMap(m, d).n_webui, 'done');
  assert.deepEqual([...antWireIds(d)], []);
  const { host } = mount(m, d);
  assert.equal(host.querySelectorAll('path.wire-live').length, 0);
  assert.ok(card(host, 'n_webui').classList.contains('is-done'));
});

// --------------------------------------------------------------------------
// Ants, loop badges, gate pip
// --------------------------------------------------------------------------

test('ants ride the active execution trigger wires', () => {
  const m = manifest();
  const d = decor({
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }],
    executions: [exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', status: 'start', trigger: { wireIds: ['w6'], freshPorts: ['fix'] } })],
  });
  assert.deepEqual([...antWireIds(d)], ['w6']);
  const { host } = mount(m, d);
  assert.ok(wire(host, 'w6').classList.contains('wire-live'));
  assert.ok(!wire(host, 'w2').classList.contains('wire-live'));
  // A finished run never marches.
  assert.deepEqual([...antWireIds({ ...d, live: false })], []);
});

test('loop badges count deliveries on the wires INTO the OR, never on or.out', () => {
  const m = manifest();
  const d = decor({
    live: false,
    executions: [
      exec({ executionId: 'x:n_or:1', nodeId: 'n_or', ordinal: 1, status: 'start', trigger: { wireIds: ['w3'], freshPorts: ['in1'] } }),
      exec({ executionId: 'x:n_or:2', nodeId: 'n_or', ordinal: 2, status: 'start', trigger: { wireIds: ['w5'], freshPorts: ['in2'] } }),
      exec({ executionId: 'x:n_or:3', nodeId: 'n_or', ordinal: 3, status: 'start', trigger: { wireIds: ['w3'], freshPorts: ['in1'] } }),
      exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, status: 'start', trigger: { wireIds: ['w6'], freshPorts: ['fix'] } }),
    ],
  });
  assert.deepEqual(loopBadgeCounts(m, d), { w3: 2, w5: 1 });
  const { host } = mount(m, d);
  assert.equal(txt(host.querySelector('.wbadge[data-wire-id="w3"] .wfired')), '2×');
  assert.equal(txt(host.querySelector('.wbadge[data-wire-id="w5"] .wfired')), '1×');
  assert.equal(host.querySelector('.wbadge[data-wire-id="w6"]'), null, 'or.out -> fix is a plain grey wire');
  assert.ok(!wire(host, 'w6').classList.contains('loop'));
});

test('a node holding a gate ask renders the amber ? pip, and loses it once answered', () => {
  const m = manifest();
  // The gate ask carries only wireId (orchestrator.mjs:1966) — resolve the node
  // through the manifest's wire source.
  assert.equal(gateNodeId(m, 'w3'), 'n_review');
  assert.equal(gateNodeId(m, 'nope'), null);
  const held = mount(m, decor({ gateWireId: 'w3' }));
  const pip = card(held.host, 'n_review').querySelector('.ngate');
  assert.equal(txt(pip), '?');
  assert.equal(pip.dataset.wireId, 'w3');
  assert.equal(card(held.host, 'n_impl').querySelector('.ngate'), null);

  const answered = mount(m, decor({ gateWireId: null }));
  assert.equal(card(answered.host, 'n_review').querySelector('.ngate'), null);
});

test('re-decorating an already-rendered view clears stale decor', () => {
  const m = manifest();
  const { host, view } = mount(m, decor({
    gateWireId: 'w3',
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }],
    executions: [exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', status: 'start', trigger: { wireIds: ['w6'], freshPorts: ['fix'] } })],
  }));
  assert.ok(card(host, 'n_impl').classList.contains('is-active'));
  view.render(manifestTemplate(m));
  decorate(view, m, decor({
    live: false,
    runStatus: 'done',
    executions: [exec({ executionId: 'x:n_impl:2', nodeId: 'n_impl', ordinal: 2, agentKey: 'implementer', status: 'done' })],
  }));
  assert.ok(card(host, 'n_impl').classList.contains('is-done'));
  assert.ok(!card(host, 'n_impl').classList.contains('is-active'));
  assert.equal(card(host, 'n_review').querySelector('.ngate'), null);
  assert.equal(host.querySelectorAll('path.wire-live').length, 0);
  assert.equal(host.querySelectorAll('.wfired').length, 0);
});

// --------------------------------------------------------------------------
// Sub-agent fan strip (moved here from the retired v1 painter)
// --------------------------------------------------------------------------

test('subFanHtml renders one square per sub-agent with an exact count', () => {
  assert.equal(subFanHtml([]), '');
  const html = subFanHtml([{ status: 'running' }, { status: 'finished' }]);
  assert.equal((html.match(/class="sq/g) || []).length, 2);
  assert.equal((html.match(/class="sq on"/g) || []).length, 1);
  assert.ok(html.includes('×2'));
});

test('decorate injects the sub-agent fan from decor.subsOf', () => {
  const { host } = mount(manifest(), decor({
    subsOf: (id) => (id === 'n_impl' ? [{ status: 'running' }, { status: 'finished' }] : []),
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer' })],
  }));
  assert.equal(card(host, 'n_impl').querySelectorAll('.fan .sq').length, 2);
  assert.equal(card(host, 'n_impl').querySelectorAll('.fan .sq.on').length, 1);
  assert.equal(card(host, 'n_review').querySelector('.fan'), null);
});

test('the fan and the executions strip stack inside ONE footer, and are counted together', () => {
  const m = manifest();
  const ports = manifestPortsFn(m)({ id: 'n_impl', kind: 'agent' });
  const base = {
    live: false,
    executions: [exec({ executionId: 'x:n_impl:1', nodeId: 'n_impl', ordinal: 1, agentKey: 'implementer' })],
    subsOf: (id) => (id === 'n_impl' ? [{ status: 'finished' }] : []),
  };
  const { host } = mount(m, decor(base));
  const impl = card(host, 'n_impl');
  // Both are absolutely-positioned bottom zones; one parent is what keeps them
  // from painting on top of each other.
  assert.equal(impl.querySelectorAll('.xfoot').length, 1);
  assert.ok(impl.querySelector('.xfoot > .fan'), 'the fan is the footer\'s first row');
  assert.ok(impl.querySelector('.xfoot > .xtoggle'), 'the executions strip follows it');
  assert.equal(impl.style.height, `${nodeSize(ports, { footerRows: 2 }).h}px`, 'both rows counted');

  // A fan with no executions still gets the footer zone (and no toggle).
  const fanOnly = mount(m, decor({ live: false, subsOf: (id) => (id === 'n_impl' ? [{ status: 'finished' }] : []) }));
  const only = card(fanOnly.host, 'n_impl');
  assert.ok(only.querySelector('.xfoot > .fan'));
  assert.equal(only.querySelector('.xtoggle'), null);
  assert.equal(only.style.height, `${nodeSize(ports, { footerRows: 1 }).h}px`);
});

// --------------------------------------------------------------------------
// Legacy v1 manifests
// --------------------------------------------------------------------------

test('a legacy v1 stepper degrades to a flat chip strip', () => {
  const v1 = {
    version: 1,
    steps: [
      { kind: 'preflight', nodes: [{ id: 'preflight', label: 'Preflight' }] },
      { kind: 'agents', nodes: [{ id: 'plan', uiPhase: 'plan', label: 'Plan', color: 'violet' }] },
      { kind: 'agents', nodes: [{ id: 'review', uiPhase: 'review', label: 'Review', color: 'blue' }] },
    ],
  };
  assert.equal(isGraphManifest(v1), false);
  assert.deepEqual(manifestNodes(v1).map((n) => n.id), ['preflight', 'plan', 'review']);
  const chips = legacyChipRows(v1, {
    steps: [
      { nodeId: 'plan', phase: 'plan', status: 'done', activeMs: 4000, costUsd: 0.03 },
      { nodeId: 'review', phase: 'review', status: 'error', activeMs: 1000, costUsd: 0 },
    ],
  });
  assert.deepEqual(chips.map((c) => c.id), ['preflight', 'plan', 'review']);
  assert.deepEqual(chips.map((c) => c.status), ['pending', 'done', 'error']);
  assert.equal(chips[1].text, 'Plan · 4s · $0.03');
  assert.equal(chips[2].text, 'Review · 1s');
});

// --------------------------------------------------------------------------
// runDotClass support + formatters
// --------------------------------------------------------------------------

test('nodeColor reads the manifest colour for the run status dot', () => {
  const m = manifest();
  assert.equal(nodeColor(m, 'n_impl'), 'peach');
  assert.equal(nodeColor(m, 'n_review'), 'blue');
  assert.equal(nodeColor(m, 'n_or'), '');
  assert.equal(nodeColor(m, 'nope'), '');
  assert.equal(nodeColor(null, 'n_impl'), '');
});

test('formatters match the run-card vocabulary', () => {
  assert.equal(fmtDur(0), '0s');
  assert.equal(fmtDur(4000), '4s');
  assert.equal(fmtDur(130_000), '2m 10s');
  assert.equal(fmtDur(3_700_000), '1h 1m');
  assert.equal(fmtUsd(0), '$0.00');
  assert.equal(fmtUsd(0.004), '<$0.01');
  assert.equal(fmtUsd(0.7 + 0.42), '$1.12');
});

// --------------------------------------------------------------------------
// Templates still host the graph mount (ported from the retired ui-stepper suite)
// --------------------------------------------------------------------------

test('run and history card templates host the graph mount and no v1 stepper markup', () => {
  const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
  const d = new JSDOM(html);
  const doc = d.window.document;
  assert.equal(doc.querySelectorAll('.stages.compact').length, 0);
  for (const id of ['run-card-tpl', 'hist-card-tpl']) {
    const tpl = doc.getElementById(id);
    assert.ok(tpl, `${id} exists`);
    assert.ok(tpl.content.querySelector('.run-flow'), `${id} hosts the graph mount`);
  }
  // The quiescence banner rides BOTH: a run usually only earns the warning as it
  // finishes, by which point the live card has already moved to History.
  for (const id of ['run-card-tpl', 'hist-card-tpl']) {
    assert.ok(doc.getElementById(id).content.querySelector('.run-warn'), `${id} has a warning banner slot`);
  }
});

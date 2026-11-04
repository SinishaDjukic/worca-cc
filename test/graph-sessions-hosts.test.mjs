// test/graph-sessions-hosts.test.mjs — thumbnails, chat flow cards and the Live view keep the tray.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailSvg } from '../src/shared/graph/thumbnail.mjs';
import { flowOrder } from '../src/shared/graph/flow-layout.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const portsFn = realPortsFn();
const seed = (id) => structuredClone(SEED_TEMPLATES.find((s) => s.id === id));

test('thumbnail: one tray rect per session, drawn before the wires', () => {
  const t = seed('wf_quick-fix');
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const svg = thumbnailSvg(t, portsFn);
  const at = svg.indexOf('data-session="s_aaaaaaaa"');
  assert.ok(at > 0 && at < svg.indexOf('<path'));
  assert.match(svg, /fill="#9A9AA1" fill-opacity="\.14"/);
  assert.equal(thumbnailSvg(seed('wf_quick-fix'), portsFn).includes('data-session'), false, 'no session, byte-identical');
});

test('sessionRowSegments: a session that wraps is two open-ended segments', async () => {
  const { sessionRowSegments } = await import('../src/shared/graph/sessions.mjs');
  const lay = { pos: { n_x: { r: 0, c: 0, x: 20, y: 40, h: 100 }, n_y: { r: 0, c: 1, x: 180, y: 40, h: 100 },
    n_a: { r: 0, c: 2, x: 340, y: 40, h: 100 }, n_b: { r: 1, c: 0, x: 20, y: 200, h: 100 } },
    rows: [{ top: 40, h: 100, ids: ['n_x', 'n_y', 'n_a'] }, { top: 200, h: 100, ids: ['n_b'] }], cardW: 150, scale: 1 };
  assert.deepEqual(sessionRowSegments([{ sid: 's_aaaaaaaa', members: ['n_a', 'n_b'] }], lay), [
    { sid: 's_aaaaaaaa', row: 0, x: 328, y: 6, w: 174, h: 146, open: 'right' },
    { sid: 's_aaaaaaaa', row: 1, x: 8, y: 166, w: 174, h: 146, open: 'left' }]);
  assert.deepEqual(sessionRowSegments([{ sid: 's_aaaaaaaa', members: ['n_x', 'n_y'] }], lay).map((s) => s.open), [null]);
  const three = { ...lay, pos: { ...lay.pos, n_c: { r: 2, c: 0, x: 20, y: 360, h: 100 } }, rows: [...lay.rows, { top: 360, h: 100, ids: ['n_c'] }] };
  assert.deepEqual(sessionRowSegments([{ sid: 's_aaaaaaaa', members: ['n_a', 'n_b', 'n_c'] }], three).map((s) => s.open), ['right', 'both', 'left'],
    'a middle row is open on both sides');
});

test('focusBoundsFor adds the header segment above the focus only when a member is in focus', async () => {
  const { focusBoundsFor } = await import('../ui/public/graph/run-hosts.mjs');
  const view = { bounds: () => ({ x: 0, y: 100, w: 500, h: 200 }),
    sessionRects: () => new Map([['s_aaaaaaaa', { x: -12, y: 46, w: 1200, h: 216, head: { x: -12, y: 46, w: 1200, h: 24 } }]]) };
  const specs = [{ sid: 's_aaaaaaaa', members: ['n_impl', 'n_review'] }];
  // Upward to the strip, never sideways: a 4-step strip is ~1,200 px, and its width would zoom the running step away.
  assert.deepEqual(focusBoundsFor(view, ['n_review'], specs), { x: 0, y: 46, w: 500, h: 254 });
  assert.deepEqual(focusBoundsFor(view, ['n_plan'], specs), { x: 0, y: 100, w: 500, h: 200 });
});

test('flow order keeps members adjacent', () => {
  // An illegal pair on purpose (Review sits between them): adjacency is a drawing rule, so the test bites.
  const t = seed('wf_no-clarify');
  for (const id of ['n_impl', 'n_check']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const order = flowOrder(t, portsFn);
  assert.equal(order.indexOf('n_check'), order.indexOf('n_impl') + 1);
});

// ── corrections: every branch the plan pins has its own case ──
const { boot, loopFixture, portsFn: viewPorts, AGENTS } = await import('./helpers/graph-view-fixture.mjs');
const { createGraphView } = await import('../ui/public/graph/view.mjs');
const grouped = () => {
  const t = loopFixture();
  for (const id of ['n_agent', 'n_rev']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  return t;
};

test('thumbnail: the tile is fitted around the tray, not only the cards and wires', () => {
  // Two members side by side: the width binds, and the tray's 12px sides pass the 8px tile pad.
  const t = { nodes: [{ id: 'n_a', kind: 'agent', key: 'planner', x: 0, y: 100, config: { session: 's_aaaaaaaa' } },
    { id: 'n_b', kind: 'agent', key: 'planner', x: 320, y: 100, config: { session: 's_aaaaaaaa' } }],
  wires: [{ id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_b', port: 'task' } }] };
  const svg = thumbnailSvg(t, portsFn);
  const [, tx, ty, z] = svg.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/).map(Number);
  const [, x, y, w, h] = svg.match(/data-session="s_aaaaaaaa" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/).map(Number);
  assert.ok(tx + x * z >= -0.05 && tx + (x + w) * z <= 120.05, `inside the 120 px width: ${tx + x * z}..${tx + (x + w) * z}`);
  assert.ok(ty + y * z >= -0.05 && ty + (y + h) * z <= 64.05, 'inside the 64 px height');
});

test('flowOrder keepSessions:false is the order without sessions', () => {
  const t = seed('wf_no-clarify');
  const before = flowOrder(t, portsFn);
  for (const id of ['n_impl', 'n_check']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  assert.deepEqual(flowOrder(t, portsFn, { keepSessions: false }), before);
});

test('a flow host draws one headerless segment per row, open where the session wraps, and no chip', () => {
  const { doc, host } = boot();
  const view = createGraphView(host, { doc, mode: 'static', layout: 'flow', portsFn: viewPorts, agents: AGENTS });
  view.render(grouped(), {});
  view.relayout(600);                                    // scale 1: two cards a row, [Task, Plan] [Plan, End]
  const segs = [...host.querySelectorAll('.gv-sess')];
  assert.deepEqual(segs.map((s) => [s.dataset.sessionId, s.classList.contains('open-right'), s.classList.contains('open-left')]),
    [['s_aaaaaaaa', true, false], ['s_aaaaaaaa', false, true]]);
  assert.ok(segs.every((s) => s.querySelector('.gv-sess-head').hidden));
  assert.deepEqual([...view.sessionRects().keys()], ['s_aaaaaaaa:0', 's_aaaaaaaa:1']);
  assert.equal(host.querySelector('.nsess'), null);
  // The gate decides on flow hosts too (C14): flag on with the gate shut is dashed, with it open solid.
  const flowView = (verified) => {
    const b = boot();
    const v = createGraphView(b.host, { doc: b.doc, mode: 'static', layout: 'flow', portsFn: viewPorts, agents: AGENTS, sessionsOn: true, sessionVerified: verified });
    v.render(grouped(), {});
    v.relayout(600);
    return { v, segs: [...b.host.querySelectorAll('.gv-sess')] };
  };
  assert.deepEqual(flowView({ claude: false }).segs.map((x) => x.classList.contains('fallback')), [true, true]);
  const lit = flowView({ claude: true });
  assert.deepEqual(lit.segs.map((x) => x.classList.contains('fallback')), [false, false]);
  // Run decor names the sid (Task 56's applyDecor): it reaches every row segment.
  lit.v.setSessionChrome('s_aaaaaaaa', { status: 'skipped' });
  assert.deepEqual(lit.segs.map((x) => x.classList.contains('is-skipped')), [true, true]);
});

test('focusBoundsFor without a focused member is view.bounds itself; the real view frames the strip', async () => {
  const { focusBoundsFor, FOCUS_PAD } = await import('../ui/public/graph/run-hosts.mjs');
  const { doc, host } = boot();
  const view = createGraphView(host, { doc, mode: 'static', portsFn: viewPorts, agents: AGENTS });
  view.render(grouped(), {});
  assert.deepEqual(focusBoundsFor(view, ['n_task'], view.sessionSpecs()), view.bounds(FOCUS_PAD, ['n_task']));
  const head = view.sessionRects().get('s_aaaaaaaa').head;
  const own = view.bounds(FOCUS_PAD, ['n_rev']);
  const b = focusBoundsFor(view, ['n_rev'], view.sessionSpecs());
  assert.ok(head.y < own.y, 'the test bites: the strip lies above the focused card\'s own frame');
  assert.deepEqual(b, { x: own.x, y: head.y, w: own.w, h: own.y + own.h - head.y }, 'the strip above Plan is in frame, the width is the card\'s');
});

test('flow order moves the whole closure: a combine between two members stays before the step it feeds', () => {
  // wf_quick-fix with Plan reaching Implementation only through a combine both of whose inputs Plan feeds (legal).
  const t = seed('wf_quick-fix');
  t.nodes.push({ id: 'n_comb', kind: 'combine', x: 500, y: 198, config: { arity: 2 } });
  t.wires.find((w) => w.id === 'w2').to = { node: 'n_comb', port: 'in1' };
  t.wires.push({ id: 'w7', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_comb', port: 'in2' } },
    { id: 'w8', from: { node: 'n_comb', port: 'out' }, to: { node: 'n_impl', port: 'plan' } });
  const today = flowOrder(t, portsFn);
  assert.ok(today.indexOf('n_plan') < today.indexOf('n_comb') && today.indexOf('n_comb') < today.indexOf('n_impl'));
  for (const id of ['n_plan', 'n_impl']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  assert.deepEqual(flowOrder(t, portsFn), today, 'the closure was already adjacent: nothing moves');
});

test('a monitor flow host (the Workflow popup) draws no member chip either', () => {
  const { doc, host } = boot();
  const view = createGraphView(host, { doc, mode: 'monitor', layout: 'flow', portsFn: viewPorts, agents: AGENTS, sessionsOn: true, sessionVerified: { claude: true } });
  view.render(grouped(), {});
  view.relayout(600);
  assert.ok(host.querySelector('.gv-sess'), 'the trays are drawn');
  assert.equal(host.querySelector('.nsess'), null, 'flow hosts carry no chip (05 §4.8)');
});

test('flow order: a branch into a later member moves before the block, so no wire runs backwards', () => {
  // wf_quick-fix with Review's plan coming from a two-step branch off Plan: {Implementation, Review} is legal, and
  // today the branch sits between them.
  const t = seed('wf_quick-fix');
  t.nodes.push({ id: 'n_x1', kind: 'agent', key: 'planner', x: 660, y: 400, config: {} },
    { id: 'n_x2', kind: 'agent', key: 'planner', x: 960, y: 400, config: {} });
  t.wires.find((w) => w.id === 'w3').from = { node: 'n_x2', port: 'plan' };
  t.wires.push({ id: 'w7', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_x1', port: 'task' } },
    { id: 'w8', from: { node: 'n_x1', port: 'plan' }, to: { node: 'n_x2', port: 'task' } });
  assert.deepEqual(flowOrder(t, portsFn), ['n_task', 'n_plan', 'n_impl', 'n_x1', 'n_x2', 'n_review', 'n_end'], 'today');
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  assert.deepEqual(flowOrder(t, portsFn), ['n_task', 'n_plan', 'n_x1', 'n_x2', 'n_impl', 'n_review', 'n_end']);
});

test('flow order with two sessions: a later session\'s pass moves an earlier block whole, so neither tray splits', async () => {
  const { sessionLegal } = await import('../src/shared/graph/sessions.mjs');
  // S1 = [a, b] and S2 = [c, d], both legal; c feeds b's answers, so today c sits between a and b.
  const agent = (id, x) => ({ id, kind: 'agent', key: 'planner', x, y: 100, config: {} });
  const t = { nodes: [{ id: 'n_t', kind: 'task', x: 0, y: 100, config: {} }, agent('n_a', 200), agent('n_b', 400),
    agent('n_c', 600), agent('n_d', 800), { id: 'n_e', kind: 'end', x: 1000, y: 100, config: {} }],
  wires: [['w1', 'n_t', 'task', 'n_a', 'task'], ['w2', 'n_t', 'task', 'n_c', 'task'], ['w3', 'n_a', 'plan', 'n_b', 'task'],
    ['w4', 'n_c', 'plan', 'n_b', 'answers'], ['w5', 'n_c', 'plan', 'n_d', 'task'], ['w6', 'n_b', 'plan', 'n_e', 'in'],
    ['w7', 'n_d', 'plan', 'n_e', 'in']].map(([id, a, ap, b, bp]) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp } })) };
  assert.deepEqual(flowOrder(t, portsFn), ['n_t', 'n_a', 'n_c', 'n_b', 'n_d', 'n_e'], 'today');
  for (const [sid, ids] of [['s_aaaaaaaa', ['n_a', 'n_b']], ['s_bbbbbbbb', ['n_c', 'n_d']]]) {
    assert.equal(sessionLegal(t, portsFn, ids).ok, true, `${ids} is legal`);
    for (const id of ids) t.nodes.find((n) => n.id === id).config.session = sid;
  }
  const order = flowOrder(t, portsFn);
  for (const [a, b] of [['n_a', 'n_b'], ['n_c', 'n_d']]) assert.equal(order.indexOf(b), order.indexOf(a) + 1, `${a} ${b} side by side: ${order}`);
  for (const w of t.wires) assert.ok(order.indexOf(w.from.node) < order.indexOf(w.to.node), `${w.id} runs forward: ${order}`);
  assert.deepEqual(order, ['n_t', 'n_c', 'n_d', 'n_a', 'n_b', 'n_e']);
});

test('flow order with two sessions: an earlier block moved after drags along what it feeds, so no wire runs backwards', async () => {
  const { sessionLegal } = await import('../src/shared/graph/sessions.mjs');
  // A = [a, d] and B = [b, e], both legal; b feeds d's answers and a also feeds the plain step c. B's pass moves A
  // after B, so c (fed by a, never reached from B) must follow A instead of staying before B.
  const agent = (id, x) => ({ id, kind: 'agent', key: 'planner', x, y: 100, config: {} });
  const t = { nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 100, config: {} }, agent('n_a', 200), agent('n_b', 400),
    agent('n_c', 600), agent('n_d', 800), agent('n_e', 1000), { id: 'n_end', kind: 'end', x: 1200, y: 100, config: {} }],
  wires: [['w1', 'n_task', 'task', 'n_a', 'task'], ['w2', 'n_task', 'task', 'n_b', 'task'], ['w3', 'n_a', 'plan', 'n_d', 'task'],
    ['w4', 'n_b', 'plan', 'n_e', 'task'], ['w5', 'n_b', 'plan', 'n_d', 'answers'], ['w6', 'n_a', 'plan', 'n_c', 'task'],
    ['w7', 'n_c', 'plan', 'n_end', 'in'], ['w8', 'n_d', 'plan', 'n_end', 'in'], ['w9', 'n_e', 'plan', 'n_end', 'in']]
    .map(([id, a, ap, b, bp]) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp } })) };
  assert.deepEqual(flowOrder(t, portsFn), ['n_task', 'n_a', 'n_b', 'n_c', 'n_d', 'n_e', 'n_end'], 'today');
  for (const [sid, ids] of [['s_aaaaaaaa', ['n_a', 'n_d']], ['s_bbbbbbbb', ['n_b', 'n_e']]]) {
    assert.equal(sessionLegal(t, portsFn, ids).ok, true, `${ids} is legal`);
    for (const id of ids) t.nodes.find((n) => n.id === id).config.session = sid;
  }
  const order = flowOrder(t, portsFn);
  for (const [a, b] of [['n_a', 'n_d'], ['n_b', 'n_e']]) assert.equal(order.indexOf(b), order.indexOf(a) + 1, `${a} ${b} side by side: ${order}`);
  for (const w of t.wires) assert.ok(order.indexOf(w.from.node) < order.indexOf(w.to.node), `${w.id} runs forward: ${order}`);
  assert.deepEqual(order, ['n_task', 'n_b', 'n_e', 'n_a', 'n_d', 'n_c', 'n_end']);
});

test('flow order with two crossed sessions: both trays stay whole, and the one wire no order can keep forward runs back', async () => {
  const { sessionLegal } = await import('../src/shared/graph/sessions.mjs');
  // [p, q] and [x, y], both legal; p feeds y's answers and x feeds q's answers. Either tray first sends one wire back.
  const agent = (id, x) => ({ id, kind: 'agent', key: 'planner', x, y: 100, config: {} });
  const t = { nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 100, config: {} }, agent('n_p', 200), agent('n_x', 400),
    agent('n_q', 600), agent('n_y', 800), { id: 'n_end', kind: 'end', x: 1000, y: 100, config: {} }],
  wires: [['w1', 'n_task', 'task', 'n_p', 'task'], ['w2', 'n_task', 'task', 'n_x', 'task'], ['w3', 'n_p', 'plan', 'n_q', 'task'],
    ['w4', 'n_x', 'plan', 'n_y', 'task'], ['w5', 'n_p', 'plan', 'n_y', 'answers'], ['w6', 'n_x', 'plan', 'n_q', 'answers'],
    ['w7', 'n_q', 'plan', 'n_end', 'in'], ['w8', 'n_y', 'plan', 'n_end', 'in']]
    .map(([id, a, ap, b, bp]) => ({ id, from: { node: a, port: ap }, to: { node: b, port: bp } })) };
  for (const [sid, ids] of [['s_aaaaaaaa', ['n_p', 'n_q']], ['s_bbbbbbbb', ['n_x', 'n_y']]]) {
    assert.equal(sessionLegal(t, portsFn, ids).ok, true, `${ids} is legal`);
    for (const id of ids) t.nodes.find((n) => n.id === id).config.session = sid;
  }
  const order = flowOrder(t, portsFn);
  for (const [a, b] of [['n_p', 'n_q'], ['n_x', 'n_y']]) assert.equal(order.indexOf(b), order.indexOf(a) + 1, `${a} ${b} side by side: ${order}`);
  assert.deepEqual(t.wires.filter((w) => order.indexOf(w.from.node) > order.indexOf(w.to.node)).map((w) => w.id), ['w5']);
  assert.deepEqual(order, ['n_task', 'n_x', 'n_y', 'n_p', 'n_q', 'n_end']);
});

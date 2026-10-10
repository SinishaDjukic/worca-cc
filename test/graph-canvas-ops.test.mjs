// test/graph-canvas-ops.test.mjs — the composer chat's edit vocabulary, simulated by the tools and replayed by the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasOps, buildGraph, newRealErrors } from '../src/shared/graph/canvas-ops.mjs';
import { portsFnFor, portsOf } from '../src/shared/graph/ports.mjs';
import { nodeSize, LABEL_H } from '../src/shared/graph/geometry.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';

// `required: true` matters: V9 ("required input not wired", incomplete) fires only on a truthy `required`, and
// portsFnFor passes these raw fixtures through — without it the 'layout resolves…' test would compare two identical reports.
const AGENTS = {
  planner: { key: 'planner', displayName: 'Plan', inputs: [{ id: 'task', type: 'md', required: true }], outputs: [{ id: 'plan', type: 'md' }] },
  implementer: { key: 'implementer', displayName: 'Implementation', inputs: [{ id: 'plan', type: 'md' }, { id: 'fix', type: 'md', required: false, loop: true }], outputs: [{ id: 'done', type: 'void' }] },
  reviewer: { key: 'reviewer', displayName: 'Review', runnerType: 'verifier', verdict: { filename: 'review-cycle{cycle}.json' },
    inputs: [{ id: 'done', type: 'void' }], outputs: [{ id: 'fix', type: 'md', when: 'blocking' }, { id: 'ok', type: 'void', when: 'clean' }] },
  clarify: { key: 'clarify', displayName: 'Clarify', asksQuestions: true, questionsLocked: true, questionsDefault: true, inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'answers', type: 'json' }] },
};
const portsFn = portsFnFor(AGENTS, {});
const base = () => ({ id: '', name: '', version: 2, domain: '', wires: [],
  nodes: [{ id: 'n_task', kind: 'task', x: 60, y: 200, config: {} }, { id: 'n_end', kind: 'end', x: 960, y: 200, config: {} }] });

test('add + connect with $refs: ids minted, positions resolved, the replay of `applied` is identical', () => {
  const r = applyCanvasOps(base(), [
    { op: 'add_node', ref: '$p', kind: 'agent', key: 'planner', near: 'n_task' },
    { op: 'connect', from: { node: 'n_task', port: 'task' }, to: { node: '$p', port: 'task' } },
  ], { portsFn });
  assert.equal(r.ok, true);
  const add = r.applied[0];
  assert.match(add.id, /^n_[a-z0-9]{8}$/);
  assert.deepEqual([add.x, add.y], [385, 198], 'near: one column right of Task (x+320 → snapped), same row');
  assert.match(r.applied[1].id, /^w_[a-z0-9]{8}$/);
  assert.deepEqual(r.applied[1].to, { node: add.id, port: 'task' });
  const replay = applyCanvasOps(base(), r.applied, { portsFn });
  assert.deepEqual(replay.tpl, r.tpl);
});

test('refusals name the op and the reason, and change nothing', () => {
  const t = base();
  const bad = applyCanvasOps(t, [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' },
    { op: 'connect', from: { node: '$p', port: 'plan' }, to: { node: 'n_task', port: 'task' } }], { portsFn });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /^op 2 \(connect\): unknown port$/);
  assert.equal(bad.index, 1);
  assert.deepEqual(t, base(), 'the input template is never mutated');
  assert.match(applyCanvasOps(base(), [{ op: 'add_node', kind: 'task' }], { portsFn }).error, /already has its task node/);
  assert.match(applyCanvasOps(base(), [{ op: 'add_node', kind: 'agent', key: 'ghost' }], { portsFn }).error, /no agent 'ghost' in the library/);
  assert.match(applyCanvasOps(base(), [{ op: 'remove_node', node: 'n_nope' }], { portsFn }).error, /'n_nope' is not on the canvas/);
  assert.match(applyCanvasOps(base(), [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' }, { op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' }], { portsFn }).error,
    /^op 2 \(add_node\): ref must be a new \$name$/);
  assert.match(applyCanvasOps(base(), [{ op: 'add_node', id: 'n_task', kind: 'agent', key: 'planner' }], { portsFn }).error, /node id 'n_task' is taken/);
  assert.match(applyCanvasOps(base(), Array.from({ length: 41 }, () => ({ op: 'layout' })), { portsFn }).error, /^at most 40 ops in one call$/);
  const wired = applyCanvasOps(base(), [{ op: 'connect', id: 'w_aaaaaaaa', from: { node: 'n_task', port: 'task' }, to: { node: 'n_end', port: 'result' } }], { portsFn }).tpl;
  assert.match(applyCanvasOps(wired, [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' },
    { op: 'connect', from: { node: '$p', port: 'plan' }, to: { node: 'n_end', port: 'result' } }], { portsFn }).error, /^op 2 \(connect\): already connected$/);
  assert.match(applyCanvasOps(wired, [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' },
    { op: 'connect', id: 'w_aaaaaaaa', from: { node: 'n_task', port: 'task' }, to: { node: '$p', port: 'task' } }], { portsFn }).error, /wire id 'w_aaaaaaaa' is taken or invalid$/);
});

test('placement, move snapping and remove_node dropping its wires', () => {
  const r = applyCanvasOps(base(), [
    { op: 'add_node', ref: '$a', kind: 'agent', key: 'planner', near: 'n_task' },
    { op: 'add_node', ref: '$b', kind: 'agent', key: 'planner', near: 'n_task' },
    { op: 'connect', from: { node: 'n_task', port: 'task' }, to: { node: '$a', port: 'task' } },
    { op: 'move_node', node: '$b', x: 700, y: 404 },
  ], { portsFn });
  assert.equal(r.ok, true);
  assert.deepEqual([r.applied[0].x, r.applied[0].y, r.applied[1].x, r.applied[1].y], [385, 198, 385, 385], 'the second steps down below the first card: 198 + 133 (body) + 24 (gap) + 26 (its label row) → 385');
  assert.deepEqual(r.applied[3], { op: 'move_node', node: r.added[1], x: 704, y: 407 });
  const gone = applyCanvasOps(r.tpl, [{ op: 'remove_node', node: r.added[0] }], { portsFn });
  assert.deepEqual(gone.tpl.wires, []);
});

test('add_node without x/y never stacks cards: four near one card get pairwise clear boxes, label rows included', () => {
  const r = applyCanvasOps(base(), [
    { op: 'add_node', ref: '$a', kind: 'agent', key: 'implementer', near: 'n_task' },
    { op: 'add_node', ref: '$b', kind: 'agent', key: 'reviewer', near: 'n_task' },
    { op: 'add_node', ref: '$c', kind: 'agent', key: 'planner', near: 'n_task' },
    { op: 'add_node', ref: '$d', kind: 'agent', key: 'clarify', near: 'n_task' },
  ], { portsFn });
  assert.equal(r.ok, true);
  // The box a card really takes on the open canvas (an edit host): its label row sits ABOVE n.y, and the body bills
  // the description footer — a real agent card is ≈150–200 px tall, not the 60 px the first placement guessed.
  const box = (n) => { const s = nodeSize(n, portsOf(portsFn, n), { describe: true }); return { x0: n.x, x1: n.x + s.w, y0: n.y - LABEL_H, y1: n.y + s.h }; };
  const boxes = r.tpl.nodes.map(box);
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const [p, q] = [boxes[i], boxes[j]];
      const clear = p.x1 + 24 <= q.x0 || q.x1 + 24 <= p.x0 || p.y1 + 24 <= q.y0 || q.y1 + 24 <= p.y0;
      assert.ok(clear, `${r.tpl.nodes[i].key || r.tpl.nodes[i].kind} and ${r.tpl.nodes[j].key || r.tpl.nodes[j].kind} overlap: ${JSON.stringify([p, q])}`);
    }
  }
  assert.deepEqual(r.applied.map((a) => a.x), [385, 385, 385, 385], 'all four stay in the column right of the Task');
  assert.equal(r.applied[0].y, 198, 'the first takes the Task\'s row');
  // Near misses: a card ending just above the spot (its GAP reaches the new label row), one whose label row starts
  // just below the new card — both must push the new card clear.
  for (const y of [35, 363]) {
    const t = base();
    t.nodes.push({ id: 'n_fixed001', kind: 'agent', key: 'planner', x: 385, y, config: {} });
    const s = applyCanvasOps(t, [{ op: 'add_node', kind: 'agent', key: 'planner', near: 'n_task' }], { portsFn });
    const [p, q] = [box(s.tpl.nodes.find((n) => n.id === 'n_fixed001')), box(s.tpl.nodes.find((n) => n.id === s.added[0]))];
    assert.ok(p.y1 + 24 <= q.y0 || q.y1 + 24 <= p.y0, `a card at y ${y}: ${JSON.stringify([p, q])}`);
  }
});

test('set_node: settings per kind, null removes, locked and absent capabilities refused', () => {
  const r = applyCanvasOps(base(), [{ op: 'add_node', ref: '$c', kind: 'agent', key: 'clarify' },
    { op: 'set_node', node: '$c', config: { model: 'claude-sonnet-5', awaitAll: true } },
    { op: 'set_node', node: '$c', config: { model: null } }], { portsFn });
  assert.equal(r.ok, true);
  assert.deepEqual(r.tpl.nodes.at(-1).config, { awaitAll: true });
  assert.match(applyCanvasOps(r.tpl, [{ op: 'set_node', node: r.added[0], config: { askQuestions: false } }], { portsFn }).error, /locked/);
  assert.match(applyCanvasOps(r.tpl, [{ op: 'set_node', node: r.added[0], config: { fanOut: true } }], { portsFn }).error, /no research fan-out/);
  assert.match(applyCanvasOps(r.tpl, [{ op: 'set_node', node: r.added[0], config: { arity: 3 } }], { portsFn }).error, /'arity' is not an agent setting/);
  assert.match(applyCanvasOps(base(), [{ op: 'set_node', node: 'n_task', config: { planStoreSeed: 'yes' } }], { portsFn }).error, /bad value for planStoreSeed/);
});

test('a text setting is one line: a control character or line break is refused, a real value still passes', () => {
  // The value rides every later [composer canvas] block (the browser applies it and sends it back with each message).
  for (const bad of ['a\nb', 'opus\r', 'x\ty', 'x\u0085y', 'x\u2028y', 'x\u2029y', 'x\u0000', 'x\u007f', '\u001b[31mred']) {
    for (const key of ['model', 'effort', 'subagentModel', 'subagentEffort']) {
      assert.equal(applyCanvasOps(base(), [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' }, { op: 'set_node', node: '$p', config: { [key]: bad } }], { portsFn }).error,
        `op 2 (set_node): bad value for ${key}`, JSON.stringify([key, bad]));
    }
  }
  const good = { model: 'claude-opus-5-5[1m]', effort: 'xhigh', subagentModel: 'auto', subagentEffort: 'low' };
  assert.deepEqual(applyCanvasOps(base(), [{ op: 'add_node', kind: 'agent', key: 'planner', config: good }], { portsFn }).tpl.nodes.at(-1).config, good);
});

test('a loop: connect with maxCycles, set_wire changes it, disconnect by endpoints', () => {
  const r = applyCanvasOps(base(), [
    { op: 'add_node', ref: '$i', kind: 'agent', key: 'implementer' },
    { op: 'add_node', ref: '$r', kind: 'agent', key: 'reviewer' },
    { op: 'connect', from: { node: '$i', port: 'done' }, to: { node: '$r', port: 'done' } },
    { op: 'connect', from: { node: '$r', port: 'fix' }, to: { node: '$i', port: 'fix' }, maxCycles: 2 },
  ], { portsFn });
  assert.equal(r.ok, true);
  const loop = r.tpl.wires.find((w) => w.from.port === 'fix');
  assert.deepEqual(loop.config, { maxCycles: 2 });
  const s = applyCanvasOps(r.tpl, [{ op: 'set_wire', wire: loop.id, maxCycles: 5 }], { portsFn });
  assert.equal(s.tpl.wires.find((w) => w.id === loop.id).config.maxCycles, 5);
  assert.match(applyCanvasOps(r.tpl, [{ op: 'set_wire', wire: loop.id, maxCycles: 99 }], { portsFn }).error, /maxCycles must be 1–20/);
  const d = applyCanvasOps(r.tpl, [{ op: 'disconnect', from: loop.from, to: loop.to }], { portsFn });
  assert.equal(d.tpl.wires.some((w) => w.id === loop.id), false);
  assert.deepEqual(d.applied, [{ op: 'disconnect', wire: loop.id }]);
  const cleared = applyCanvasOps(r.tpl, [{ op: 'set_wire', wire: loop.id, maxCycles: null }], { portsFn });
  assert.equal(cleared.tpl.wires.find((w) => w.id === loop.id).config, undefined, 'null removes the budget (and an empty config)');
  assert.match(applyCanvasOps(base(), [
    { op: 'add_node', ref: '$i', kind: 'agent', key: 'implementer' }, { op: 'add_node', ref: '$r', kind: 'agent', key: 'reviewer' },
    { op: 'connect', from: { node: '$r', port: 'fix' }, to: { node: '$i', port: 'fix' }, maxCycles: 0 }], { portsFn }).error,
  /^op 3 \(connect\): maxCycles must be 1–20$/);
});

test('layout resolves to explicit positions; newRealErrors ignores "to wire" items', () => {
  const r = applyCanvasOps(base(), [{ op: 'add_node', ref: '$p', kind: 'agent', key: 'planner' }, { op: 'layout' }], { portsFn });
  assert.equal(r.applied[1].op, 'layout');
  assert.ok(r.applied[1].positions.n_task && r.applied[1].positions[r.added[0]]);
  const before = validateGraph(base(), portsFn);
  const after = validateGraph(r.tpl, portsFn);
  assert.ok(after.errors.some((e) => e.code === 'V9' && e.incomplete), 'the new card IS unwired');
  assert.deepEqual(newRealErrors(before, after), [], 'an unwired new card is incomplete, not broken');
  const ghost = { ...base(), nodes: [...base().nodes, { id: 'n_ghost', kind: 'agent', key: 'ghost', x: 60, y: 600, config: {} }] };
  const g = applyCanvasOps(ghost, [{ op: 'add_node', kind: 'agent', key: 'planner' }], { portsFn });
  assert.deepEqual(newRealErrors(validateGraph(ghost, portsFn), validateGraph(g.tpl, portsFn)), [], 'an error the canvas already had is not new');
  const noEnd = applyCanvasOps(base(), [{ op: 'remove_node', node: 'n_end' }], { portsFn });
  assert.deepEqual(newRealErrors(before, validateGraph(noEnd.tpl, portsFn)).map((e) => e.code), ['V21'], 'a missing End is broken, not incomplete');
});

test('newRealErrors: an error the batch only SHRANK is not new (its message names the cycle members or counts the cards)', () => {
  const p = (id, y) => ({ id, kind: 'agent', key: 'planner', x: 400, y, config: {} });
  const w = (id, a, b, port = 'task') => ({ id, from: { node: a, port: 'plan' }, to: { node: b, port } });
  // One broken cycle over three cards: p1 → p2 → p3 → p2 (await) and p2 → p1 (await), no blocking edge.
  const cyc = { ...base(), nodes: [...base().nodes, p('n_p1', 200), p('n_p2', 400), p('n_p3', 600)],
    wires: [{ id: 'w_t', from: { node: 'n_task', port: 'task' }, to: { node: 'n_p1', port: 'task' } },
      w('w_12', 'n_p1', 'n_p2'), w('w_23', 'n_p2', 'n_p3'), w('w_32', 'n_p3', 'n_p2', 'await'), w('w_21', 'n_p2', 'n_p1', 'await')] };
  const was = validateGraph(cyc, portsFn);
  assert.ok(was.errors.some((e) => e.code === 'V10' && /n_p1, n_p2, n_p3/.test(e.message)), 'the canvas holds the 3-card cycle');
  const after = (ops) => validateGraph(applyCanvasOps(cyc, ops, { portsFn }).tpl, portsFn);
  for (const ops of [[{ op: 'remove_node', node: 'n_p3' }], [{ op: 'disconnect', wire: 'w_32' }], [{ op: 'disconnect', wire: 'w_23' }]]) {
    const now = after(ops);
    assert.ok(now.errors.some((e) => e.code === 'V10'), `a smaller cycle is left (${ops[0].op})`);
    assert.deepEqual(newRealErrors(was, now), [], `${JSON.stringify(ops)} shrank the cycle and broke nothing`);
  }
  // Removing the card the cycle starts from leaves it unable to start: a deadlock the canvas did not have.
  assert.deepEqual(newRealErrors(was, after([{ op: 'remove_node', node: 'n_p1' }])).map((e) => e.code), ['V11'], 'a new deadlock is new');
  // A cycle the canvas did not have IS new, even next to an old one.
  const fresh = applyCanvasOps(cyc, [{ op: 'add_node', ref: '$a', kind: 'agent', key: 'planner', x: 900, y: 900 },
    { op: 'add_node', ref: '$b', kind: 'agent', key: 'planner', x: 1200, y: 900 },
    { op: 'connect', from: { node: '$a', port: 'plan' }, to: { node: '$b', port: 'task' } },
    { op: 'connect', from: { node: '$b', port: 'plan' }, to: { node: '$a', port: 'await' } }], { portsFn });
  assert.equal(fresh.ok, true);
  assert.ok(newRealErrors(was, validateGraph(fresh.tpl, portsFn)).some((e) => e.code === 'V10' && /n_/.test(e.message) && !/n_p1/.test(e.message)), 'a second broken cycle is new');
  const merged = applyCanvasOps(cyc, [{ op: 'add_node', ref: '$a', kind: 'agent', key: 'planner', x: 900, y: 900 },
    { op: 'connect', from: { node: 'n_p3', port: 'plan' }, to: { node: '$a', port: 'task' } },
    { op: 'connect', from: { node: '$a', port: 'plan' }, to: { node: 'n_p3', port: 'await' } }], { portsFn });
  assert.equal(merged.ok, true);
  assert.ok(newRealErrors(was, validateGraph(merged.tpl, portsFn)).some((e) => e.code === 'V10'), 'growing the broken cycle is new');
  // Three task cards ("found 3") → remove one ("found 2"): still wrong, not newly wrong; one task → a second one is new.
  const tasks = { ...base(), nodes: [...base().nodes, { id: 'n_t2', kind: 'task', x: 60, y: 600, config: {} }, { id: 'n_t3', kind: 'task', x: 60, y: 900, config: {} }] };
  const fewer = applyCanvasOps(tasks, [{ op: 'remove_node', node: 'n_t3' }], { portsFn });
  assert.deepEqual(newRealErrors(validateGraph(tasks, portsFn), validateGraph(fewer.tpl, portsFn)), [], 'found 3 → found 2 broke nothing');
  const two = { ...base(), nodes: [...base().nodes, { id: 'n_t2', kind: 'task', x: 60, y: 600, config: {} }] };
  assert.deepEqual(newRealErrors(validateGraph(base(), portsFn), validateGraph(two, portsFn)).map((e) => e.code), ['V20'], 'a second task card is new');
});

test('buildGraph: refs without $, one task + one end, laid out', () => {
  const r = buildGraph({
    nodes: [{ ref: 'task', kind: 'task' }, { ref: 'plan', kind: 'agent', key: 'planner' }, { ref: 'end', kind: 'end' }],
    wires: [{ from: { node: 'task', port: 'task' }, to: { node: 'plan', port: 'task' } }, { from: { node: 'plan', port: 'plan' }, to: { node: 'end', port: 'result' } }],
  }, { portsFn });
  assert.equal(r.ok, true);
  assert.equal(r.tpl.nodes.length, 3);
  assert.equal(validateGraph(r.tpl, portsFn).errors.length, 0);
  assert.ok(r.tpl.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)));
  assert.equal(new Set(r.tpl.nodes.map((n) => `${n.x},${n.y}`)).size, 3, 'laid out, not stacked at (0,0)');
  const chain = Array.from({ length: 20 }, (_, i) => ({ ref: `p${i}`, kind: 'agent', key: 'planner' }));
  const long = buildGraph({
    nodes: [{ ref: 'task', kind: 'task' }, ...chain, { ref: 'end', kind: 'end' }],
    wires: [{ from: { node: 'task', port: 'task' }, to: { node: 'p0', port: 'task' } },
      ...chain.slice(1).map((n, i) => ({ from: { node: `p${i}`, port: 'plan' }, to: { node: n.ref, port: 'task' } })),
      { from: { node: 'p19', port: 'plan' }, to: { node: 'end', port: 'result' } }],
  }, { portsFn });
  assert.equal(long.ok, true, 'a 44-op build is past MAX_OPS but inside MAX_BUILD_OPS');
});

// Live composer turn (real CLI, 2026-10-10): build_workflow with the built-in Shell card answered "op 8 (connect): unknown
// port" — a config-ported script placed with no config.ports has no ports at all, not even `await`. The browser's spawn
// seeds the sidecar's defaultPorts (graph/composer.mjs); add_node must place the same card.
test('add_node: a config-ported script starts with the sidecar defaultPorts (as the browser spawn does); config.ports wins', () => {
  const SCRIPTS = { shell: { key: 'shell', runtime: 'shell', ports: 'config', verdict: { filename: 'shell-cycle{cycle}.json' },
    params: [{ id: 'command', type: 'command', required: true }],
    defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' },
      { id: 'fail', type: 'md', when: 'blocking', filename: 'shell-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] } } };
  const pf = portsFnFor(AGENTS, SCRIPTS);
  const r = applyCanvasOps(base(), [
    { op: 'add_node', ref: '$t', kind: 'script', key: 'shell', config: { params: { command: 'npm test' } } },
    { op: 'connect', from: { node: 'n_task', port: 'task' }, to: { node: '$t', port: 'in' } },
    { op: 'connect', from: { node: '$t', port: 'pass' }, to: { node: 'n_end', port: 'result' } },
  ], { portsFn: pf });
  assert.equal(r.ok, true, r.error);
  const node = r.tpl.nodes.find((n) => n.key === 'shell');
  assert.deepEqual(node.config.ports, SCRIPTS.shell.defaultPorts);
  assert.notEqual(node.config.ports, SCRIPTS.shell.defaultPorts, 'a deep copy: the card owns its ports');
  assert.deepEqual(r.applied[0].config.ports, SCRIPTS.shell.defaultPorts, 'the resolved op carries the ports, so the browser replays the same card');
  assert.deepEqual(validateGraph(r.tpl, pf).errors.filter((e) => !e.incomplete), []);
  const own = { inputs: [], outputs: [{ id: 'pass', type: 'void', when: 'clean' }] };
  const r2 = applyCanvasOps(base(), [{ op: 'add_node', kind: 'script', key: 'shell', config: { ports: own } }], { portsFn: pf });
  assert.deepEqual(r2.tpl.nodes.find((n) => n.key === 'shell').config.ports, own);
  const b = buildGraph({ nodes: [{ ref: 'task', kind: 'task' }, { ref: 'sh', kind: 'script', key: 'shell', config: { params: { command: 'npm test' } } }, { ref: 'end', kind: 'end' }],
    wires: [{ from: { node: 'task', port: 'task' }, to: { node: 'sh', port: 'in' } }, { from: { node: 'sh', port: 'pass' }, to: { node: 'end', port: 'result' } }] }, { portsFn: pf });
  assert.equal(b.ok, true, b.error);
});

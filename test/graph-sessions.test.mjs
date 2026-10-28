// test/graph-sessions.test.mjs — the ONE derivation the validator, canvas and runtime share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsOf, resolveSessions, sessionIdOf, loopWireSet, consecutiveIssue, SESSION_DEFAULT_LABEL } from '../src/shared/graph/sessions.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const portsFn = realPortsFn();
const seed = (id) => structuredClone(SEED_TEMPLATES.find((s) => s.id === id));
const join = (t, ids, sid = 's_aaaaaaaa') => { for (const id of ids) t.nodes.find((n) => n.id === id).config.session = sid; return t; };

test('no session ⇒ []', () => {
  assert.deepEqual(sessionsOf(seed('wf_quick-fix'), portsFn), []);
  assert.equal(resolveSessions, sessionsOf);
});

test('wf_quick-fix [plan, impl, review]: step order, internal/entry/exit wires, default settings', () => {
  const [s] = sessionsOf(join(seed('wf_quick-fix'), ['n_review', 'n_plan', 'n_impl']), portsFn);
  assert.equal(s.sid, 's_aaaaaaaa');
  assert.deepEqual(s.members, ['n_plan', 'n_impl', 'n_review']);
  assert.deepEqual(s.closure, ['n_plan', 'n_impl', 'n_review']);
  assert.deepEqual(s.flows, []);
  assert.deepEqual(s.internalWires, ['w2', 'w3', 'w4', 'w5']);
  assert.deepEqual(s.entryWires, ['w1']);
  assert.deepEqual(s.exitWires, ['w6']);
  assert.deepEqual(s.crossingLoops, []);
  assert.deepEqual(s.settings, { label: SESSION_DEFAULT_LABEL, mode: 'subagents', hostModel: null, hostEffort: null });
});

test('wf_no-clarify [decompose, impl, review]: the review→fix loop is internal; three entries from Refine', () => {
  const [s] = sessionsOf(join(seed('wf_no-clarify'), ['n_decompose', 'n_impl', 'n_review']), portsFn);
  assert.deepEqual(s.members, ['n_decompose', 'n_impl', 'n_review']);
  assert.deepEqual(s.internalWires, ['w8', 'w9', 'w10']);
  assert.deepEqual(s.entryWires, ['w4', 'w5', 'w6']);
  assert.deepEqual(s.exitWires, ['w11']);
});

test('wf_provided-plan [impl, review]: n_or is fed from outside (n_webui), so it is not in the closure and both its loop legs cross', () => {
  const [s] = sessionsOf(join(seed('wf_provided-plan'), ['n_impl', 'n_review']), portsFn);
  assert.deepEqual(s.flows, []);
  assert.equal(s.closure.includes('n_or'), false);
  assert.deepEqual(s.crossingLoops, ['w9', 'w14']);              // review.review → n_or.in1, and n_or.out → impl.fix
});

test('wf_provided-plan [impl, review, check, webui]: n_or is fed by members only, so it rides inside and both loop legs stay internal', () => {
  const [s] = sessionsOf(join(seed('wf_provided-plan'), ['n_impl', 'n_review', 'n_check', 'n_webui']), portsFn);
  assert.deepEqual(s.members, ['n_impl', 'n_review', 'n_check', 'n_webui']);
  assert.deepEqual(s.flows, ['n_or']);
  assert.deepEqual(s.closure, ['n_impl', 'n_or', 'n_review', 'n_check', 'n_webui']);
  assert.deepEqual(s.internalWires, ['w8', 'w9', 'w10', 'w11', 'w12', 'w14']);
  assert.deepEqual(s.crossingLoops, []);
});

test('correction 27: an or card joined to the members by loop wires only rides inside, and the session stays legal', () => {
  // wf_no-clarify's review→fix loop now runs through an or that only Review feeds: review.review → or.in1 / or.in2
  // (loop wires) and or.out → impl.fix (a loop:true input). No non-loop wire touches the or.
  const t = join(seed('wf_no-clarify'), ['n_impl', 'n_review']);
  t.nodes.push({ id: 'n_or', kind: 'or', x: 1300, y: 400, config: { arity: 2 } });
  t.wires.find((w) => w.id === 'w10').to = { node: 'n_or', port: 'in1' };
  t.wires.push({ id: 'w14', from: { node: 'n_review', port: 'review' }, to: { node: 'n_or', port: 'in2' }, config: { maxCycles: 3 } });
  t.wires.push({ id: 'w15', from: { node: 'n_or', port: 'out' }, to: { node: 'n_impl', port: 'fix' } });
  const [s] = sessionsOf(t, portsFn);
  assert.deepEqual(s.flows, ['n_or']);
  assert.deepEqual(s.closure, ['n_impl', 'n_or', 'n_review']);
  assert.deepEqual(s.crossingLoops, []);
  assert.equal(consecutiveIssue(t, portsFn, ['n_impl', 'n_review']), null);
  assert.deepEqual(validateGraph(t, portsFn).errors, [], 'no V27: a legal session never blocks the save');
});

test('closure step 3: flow cards wired only to each other survive step 2 but no member reaches them, so they stay out', () => {
  const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
  t.nodes.push({ id: 'n_or1', kind: 'or', x: 1300, y: 400, config: { arity: 2 } });
  t.nodes.push({ id: 'n_or2', kind: 'or', x: 1500, y: 400, config: { arity: 2 } });
  t.wires.push({ id: 'w20', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } });
  const [s] = sessionsOf(t, portsFn);
  assert.deepEqual(s.flows, []);
  assert.deepEqual(s.closure, ['n_impl', 'n_review']);
  assert.equal(s.internalWires.includes('w20'), false);
});

test('closure step 2 drops a flow card wired TO an outside card: n_or is fed by members but feeds n_impl', () => {
  const t = join(seed('wf_provided-plan'), ['n_review', 'n_check', 'n_webui']);
  assert.deepEqual(validateGraph(t, portsFn).errors, [], 'precondition: a legal session');
  const [s] = sessionsOf(t, portsFn);
  assert.deepEqual(s.flows, []);
  assert.deepEqual(s.closure, ['n_review', 'n_check', 'n_webui']);
  assert.deepEqual(s.crossingLoops, ['w9', 'w12']);
});

test('closure step 2 runs until stable: a flow card kept only by a card dropped later in the pass goes too', () => {
  // n_or2 is checked first (it comes first in nodes) and survives the first pass, because n_or1 is still in F; n_or1
  // is fed by n_plan, outside, and goes. Only a second pass drops n_or2.
  const t = join(seed('wf_quick-fix'), ['n_impl', 'n_review']);
  t.nodes.push({ id: 'n_or2', kind: 'or', x: 1500, y: 400, config: { arity: 2 } });
  t.nodes.push({ id: 'n_or1', kind: 'or', x: 1300, y: 400, config: { arity: 2 } });
  t.wires.find((w) => w.id === 'w2').to = { node: 'n_or1', port: 'in1' };
  t.wires.push({ id: 'w22', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_or1', port: 'in2' } });
  t.wires.push({ id: 'w20', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in1' } });
  t.wires.push({ id: 'w23', from: { node: 'n_or1', port: 'out' }, to: { node: 'n_or2', port: 'in2' } });
  t.wires.push({ id: 'w21', from: { node: 'n_or2', port: 'out' }, to: { node: 'n_impl', port: 'plan' } });
  const [s] = sessionsOf(t, portsFn);
  assert.deepEqual(s.flows, []);
  assert.deepEqual(s.closure, ['n_impl', 'n_review']);
  assert.deepEqual(s.entryWires, ['w3', 'w21'], 'w21 enters the session from outside');
});

test('members read in step order inside a loop, whatever the ids (composer ids are random)', () => {
  const t = seed('wf_quick-fix');
  const rename = (from, to) => {
    t.nodes.find((n) => n.id === from).id = to;
    for (const w of t.wires) for (const e of [w.from, w.to]) if (e.node === from) e.node = to;
  };
  rename('n_impl', 'n_x7k2m9q1');
  rename('n_review', 'n_a1b2c3d4');                              // the reviewer now sorts first by id
  const loops = classifyLoops(t, portsFn);
  assert.ok(loops.launchOrder.indexOf('n_a1b2c3d4') < loops.launchOrder.indexOf('n_x7k2m9q1'), 'precondition: launchOrder is alphabetical inside the loop');
  const [s] = sessionsOf(join(t, ['n_a1b2c3d4', 'n_x7k2m9q1']), portsFn);
  assert.deepEqual(s.members, ['n_x7k2m9q1', 'n_a1b2c3d4'], 'Implementation runs first, so it is step 1');
  assert.deepEqual(sessionsOf(t, portsFn, { loops }).map((x) => x.members), [s.members], 'a passed-in classification gives the same answer');
});

test('settings read from tpl.sessions; two sessions ordered by their first member', () => {
  const t = join(join(seed('wf_no-clarify'), ['n_impl', 'n_review'], 's_bbbbbbbb'), ['n_refine', 'n_decompose'], 's_aaaaaaaa');
  t.nodes.reverse();                                             // the later session's cards come first in nodes
  t.sessions = { s_bbbbbbbb: { label: 'Build', mode: 'shared', hostModel: 'claude-haiku-4-5' }, s_aaaaaaaa: { label: 7, mode: 'auto', hostModel: '  ', hostEffort: '' } };
  const out = sessionsOf(t, portsFn);
  assert.deepEqual(out.map((s) => s.sid), ['s_aaaaaaaa', 's_bbbbbbbb']);
  assert.deepEqual(out[1].settings, { label: 'Build', mode: 'shared', hostModel: 'claude-haiku-4-5', hostEffort: null });
  assert.deepEqual(out[0].settings, { label: SESSION_DEFAULT_LABEL, mode: 'subagents', hostModel: null, hostEffort: null }, 'bad values fall back (V30 reports them)');
  t.sessions.s_bbbbbbbb.label = '   ';
  assert.equal(sessionsOf(t, portsFn)[1].settings.label, SESSION_DEFAULT_LABEL, 'correction 28: a whitespace-only label reads as the default');
});

test('never throws on junk; non-agents and malformed ids form no session; sessionIdOf and loopWireSet', () => {
  assert.deepEqual(sessionsOf({ nodes: [null, { id: 'n_s', kind: 'script', config: { session: 's_aaaaaaaa' } }], wires: [{}] }, portsFn), []);
  assert.deepEqual(sessionsOf(null, portsFn), []);
  assert.deepEqual(sessionsOf(join(seed('wf_quick-fix'), ['n_impl', 'n_review'], 'S_BAD'), portsFn), [], 'V25 reports a malformed id');
  assert.equal(sessionIdOf({ config: { session: 's_aaaaaaaa' } }), 's_aaaaaaaa');
  assert.equal(sessionIdOf({ config: { session: 7 } }), null);
  assert.equal(sessionIdOf(null), null);
  assert.ok(loopWireSet(seed('wf_quick-fix'), portsFn).has('w5'));
  assert.deepEqual([...loopWireSet(seed('wf_provided-plan'), portsFn)].sort(), ['w12', 'w14', 'w2', 'w9'], 'w14 only through the loop:true input rule');
});

// test/graph-sessions.test.mjs — the ONE derivation the validator, canvas and runtime share.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionsOf, resolveSessions, sessionIdOf, loopWireSet, SESSION_DEFAULT_LABEL } from '../src/shared/graph/sessions.mjs';
import { classifyLoops } from '../src/shared/graph/loops.mjs';
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
  t.sessions = { s_bbbbbbbb: { label: 'Build', mode: 'shared', hostModel: 'claude-haiku-4-5' }, s_aaaaaaaa: { label: 7, mode: 'auto', hostEffort: '' } };
  const out = sessionsOf(t, portsFn);
  assert.deepEqual(out.map((s) => s.sid), ['s_aaaaaaaa', 's_bbbbbbbb']);
  assert.deepEqual(out[1].settings, { label: 'Build', mode: 'shared', hostModel: 'claude-haiku-4-5', hostEffort: null });
  assert.deepEqual(out[0].settings, { label: SESSION_DEFAULT_LABEL, mode: 'subagents', hostModel: null, hostEffort: null }, 'bad values fall back (V30 reports them)');
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

// test/graph-canvas-ops-sessions.test.mjs — chat can create, extend and dissolve a session; it can never break one silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCanvasOps, buildGraph, newRealErrors } from '../src/shared/graph/canvas-ops.mjs';
import { summarizeCanvas } from '../src/shared/graph/canvas-summary.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { SESSION_ID_RE } from '../src/shared/graph/constants.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';

const portsFn = realPortsFn();
const seed = (id) => structuredClone(SEED_TEMPLATES.find((s) => s.id === id));
const S = 's_aaaaaaaa';
const grouped = () => { const t = seed('wf_quick-fix'); for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = S; return t; };

test('two set_node ops create a session in one undoable batch; null takes a step out', () => {
  const r = applyCanvasOps(seed('wf_quick-fix'), [
    { op: 'set_node', node: 'n_impl', config: { session: S } },
    { op: 'set_node', node: 'n_review', config: { session: S } }], { portsFn });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(r.tpl.nodes.filter((n) => n.config.session === S).map((n) => n.id), ['n_impl', 'n_review']);
  const out = applyCanvasOps(r.tpl, [{ op: 'set_node', node: 'n_review', config: { session: null } }], { portsFn });
  assert.equal('session' in out.tpl.nodes.find((n) => n.id === 'n_review').config, false);
  assert.equal(out.tpl.nodes.find((n) => n.id === 'n_impl').config.session, S, 'no prune on set_node: V26 shows instead');
});

test('bad ids and non-agents are refused at the op', () => {
  assert.match(applyCanvasOps(seed('wf_quick-fix'), [{ op: 'set_node', node: 'n_impl', config: { session: 'S_BAD' } }], { portsFn }).error, /bad value for session/);
  assert.match(applyCanvasOps(seed('wf_quick-fix'), [{ op: 'set_node', node: 'n_task', config: { session: S } }], { portsFn }).error, /'session' is not a task setting/);
});

test('a non-consecutive pair is a NEW real error (the Ask layer refuses the batch)', () => {
  const before = validateGraph(seed('wf_no-clarify'), portsFn);
  const r = applyCanvasOps(seed('wf_no-clarify'), [
    { op: 'set_node', node: 'n_refine', config: { session: S } }, { op: 'set_node', node: 'n_impl', config: { session: S } }], { portsFn });
  assert.deepEqual(newRealErrors(before, validateGraph(r.tpl, portsFn)).map((e) => e.code), ['V27']);
});

test('remove_node prunes a session left with one step, settings included', () => {
  const t = grouped();
  t.sessions = { [S]: { label: 'Build' } };
  const r = applyCanvasOps(t, [{ op: 'remove_node', node: 'n_review' }], { portsFn });
  assert.equal('session' in r.tpl.nodes.find((n) => n.id === 'n_impl').config, false);
  assert.equal(r.tpl.sessions, undefined);
  const plain = applyCanvasOps(seed('wf_quick-fix'), [{ op: 'remove_node', node: 'n_review' }], { portsFn });
  assert.equal('sessions' in plain.tpl, false, 'an ungrouped canvas gains nothing');
});

test('build_workflow re-mints session ids: two agents sharing a label get one fresh, well-formed id', () => {
  const r = buildGraph({ nodes: [
    { ref: 'impl', kind: 'agent', key: 'implementer', config: { session: 'build' } },
    { ref: 'rev', kind: 'agent', key: 'reviewer', config: { session: 'build' } }], wires: [] }, { portsFn });
  assert.equal(r.ok, true, r.error);
  const sids = r.tpl.nodes.map((n) => n.config.session);
  assert.match(sids[0], SESSION_ID_RE);
  assert.equal(sids[0], sids[1]);
});

test('the summary names sessions only when there is one, and shows their warnings', () => {
  const s = summarizeCanvas(grouped(), portsFn);
  assert.match(s, /\nsessions \(1\):\n- session s_aaaaaaaa \(One session\): n_impl, n_review\nwires \(6\):/);
  assert.match(s, / · session=s_aaaaaaaa/);
  assert.doesNotMatch(summarizeCanvas(seed('wf_quick-fix'), portsFn), /sessions \(|session=/);
  const lone = seed('wf_quick-fix');
  lone.nodes.find((n) => n.id === 'n_impl').config.session = S;
  assert.match(summarizeCanvas(lone, portsFn), /\n- V26 session 's_aaaaaaaa' has one step \('n_impl'\) — it runs as its own session/);
});

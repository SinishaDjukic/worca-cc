// test/graph-sessions-legal.test.mjs — "consecutive", the candidates menu, prune and remint (04 §2.5 table), the notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionLegal, sessionCandidates, pruneSessions, remintSessions, consecutiveIssue, isMemberDispatch, sessionNotes, sessionsOf } from '../src/shared/graph/sessions.mjs';
import { SESSION_ID_RE } from '../src/shared/graph/constants.mjs';
import { SESSION_SUBAGENTS_VERIFIED } from '../src/shared/engine-switch.mjs';
import { SEED_TEMPLATES } from '../src/core/graph/seed-templates.mjs';
import { realPortsFn } from './helpers/graph-ports.mjs';
import { checkRows } from './helpers/rows.mjs';

const portsFn = realPortsFn();
const seed = (id) => structuredClone(SEED_TEMPLATES.find((s) => s.id === id));

test('04 §2.5 reference table on wf_no-clarify', async () => {
  const t = seed('wf_no-clarify');
  await checkRows([
    { name: '[refine, decompose] valid', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_refine', 'n_decompose']), { ok: true }) },
    { name: '[impl, review] valid', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_impl', 'n_review']), { ok: true }) },
    { name: '[decompose, impl, review] valid', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_decompose', 'n_impl', 'n_review']), { ok: true }) },
    { name: '[refine, decompose, impl, review] valid', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_refine', 'n_decompose', 'n_impl', 'n_review']), { ok: true }) },
    { name: '[refine, impl] V27 names Decompose', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_refine', 'n_impl']),
      { ok: false, code: 'V27', reason: 'n_decompose runs between n_refine and n_impl' }) },
    { name: '[task, refine] V25', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_task', 'n_refine']),
      { ok: false, code: 'V25', reason: 'flow cards ride along, they are never steps' }) },
    { name: '5 steps V26', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_plan', 'n_refine', 'n_decompose', 'n_impl', 'n_review']),
      { ok: false, code: 'V26', reason: '4 steps max' }) },
    { name: 'one step V26', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_impl', 'n_impl']), { ok: false, code: 'V26', reason: 'a session needs 2 steps' }) },
    { name: 'unknown id V25', run: () => assert.deepEqual(sessionLegal(t, portsFn, ['n_impl', 'n_gone']), { ok: false, code: 'V25', reason: 'not on the canvas' }) },
  ]);
});

test('consecutiveIssue: connectivity first, then convexity', () => {
  const t = seed('wf_no-clarify');
  assert.deepEqual(consecutiveIssue(t, portsFn, ['n_decompose', 'n_review']), { kind: 'disconnected', a: 'n_decompose', b: 'n_review' });
  assert.deepEqual(consecutiveIssue(t, portsFn, ['n_refine', 'n_impl']), { kind: 'between', via: 'n_decompose', a: 'n_refine', b: 'n_impl' });
  assert.equal(consecutiveIssue(t, portsFn, ['n_impl', 'n_review']), null);
  assert.equal(consecutiveIssue(t, portsFn, ['n_impl']), null);
});

test('sessionLegal: the ids may extend one session, never take a card from another (Task 23 join)', () => {
  const t = seed('wf_no-clarify');
  t.nodes.find((n) => n.id === 'n_decompose').config.session = 's_aaaaaaaa';
  t.nodes.find((n) => n.id === 'n_review').config.session = 's_bbbbbbbb';
  assert.deepEqual(sessionLegal(t, portsFn, ['n_decompose', 'n_impl']), { ok: true }, 'Implementation joins s_aaaaaaaa');
  assert.deepEqual(sessionLegal(t, portsFn, ['n_impl', 'n_review']), { ok: true }, 'Implementation joins s_bbbbbbbb');
  assert.deepEqual(sessionLegal(t, portsFn, ['n_decompose', 'n_impl', 'n_review']), { ok: false, code: 'V25', reason: 'in another session' });
  t.nodes.find((n) => n.id === 'n_review').config.session = 'S_BAD';
  assert.deepEqual(sessionLegal(t, portsFn, ['n_decompose', 'n_impl', 'n_review']), { ok: true }, 'a malformed sid is V25 on the card, not a second session');
});

test('sessionCandidates for Implementation: next first, then previous, each in step order, with labels', () => {
  const labels = { n_refine: 'Refine Plan', n_decompose: 'Decompose', n_impl: 'Implementation', n_review: 'Review Implementation' };
  assert.deepEqual(sessionCandidates(seed('wf_no-clarify'), portsFn, { nodeId: 'n_impl', labelOf: (id) => labels[id] }), [
    { nodeId: 'n_review', side: 'next', ok: true },
    { nodeId: 'n_refine', side: 'previous', ok: false, reason: 'Decompose runs between Refine Plan and Implementation' },
    { nodeId: 'n_decompose', side: 'previous', ok: true },
  ]);
});

test('a neighbour in another session is offered disabled; a full session offers nothing ok', () => {
  const t = seed('wf_no-clarify');
  t.nodes.find((n) => n.id === 'n_review').config.session = 's_bbbbbbbb';
  t.nodes.find((n) => n.id === 'n_check').config.session = 's_bbbbbbbb';
  const c = sessionCandidates(t, portsFn, { nodeId: 'n_impl' });
  assert.deepEqual(c.find((x) => x.nodeId === 'n_review'), { nodeId: 'n_review', side: 'next', ok: false, reason: 'in another session' });
  const full = seed('wf_no-clarify');
  for (const id of ['n_refine', 'n_decompose', 'n_impl', 'n_review']) full.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  assert.deepEqual(sessionCandidates(full, portsFn, { sid: 's_aaaaaaaa' }), [
    { nodeId: 'n_check', side: 'next', ok: false, reason: '4 steps max' },
    { nodeId: 'n_plan', side: 'previous', ok: false, reason: '4 steps max' },
  ]);
  assert.deepEqual(sessionCandidates(full, portsFn, { nodeId: 'n_impl' }), sessionCandidates(full, portsFn, { sid: 's_aaaaaaaa' }), 'a member asks for its own session');
  assert.deepEqual(sessionCandidates(full, portsFn, { nodeId: 'n_task' }), [], 'a non-agent has no candidates');
});

test('pruneSessions: a lone member leaves, orphan settings go; remint keeps members together with a fresh id', () => {
  const t = seed('wf_quick-fix');
  t.nodes.find((n) => n.id === 'n_impl').config.session = 's_aaaaaaaa';
  t.sessions = { s_aaaaaaaa: { label: 'x' }, s_zzzzzzzz: { label: 'y' } };
  const p = pruneSessions(t);
  assert.equal('session' in p.nodes.find((n) => n.id === 'n_impl').config, false);
  assert.equal(p.sessions, undefined);
  assert.equal(t.nodes.find((n) => n.id === 'n_impl').config.session, 's_aaaaaaaa', 'input not mutated');
  const kept = seed('wf_quick-fix');
  for (const id of ['n_impl', 'n_review']) kept.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  kept.sessions = { s_aaaaaaaa: { label: 'x' } };
  assert.deepEqual(pruneSessions(kept), kept, 'a two-step session is left alone');
  const nodes = [{ id: 'n_a', kind: 'agent', config: { session: 's_aaaaaaaa' } }, { id: 'n_b', kind: 'agent', config: { session: 's_aaaaaaaa' } },
    { id: 'n_c', kind: 'agent', config: { session: 'x' } }, null];
  const r = remintSessions(nodes, new Set(['s_aaaaaaaa']));
  assert.match(r[0].config.session, SESSION_ID_RE);
  assert.notEqual(r[0].config.session, 's_aaaaaaaa');
  assert.equal(r[0].config.session, r[1].config.session);
  assert.match(r[2].config.session, SESSION_ID_RE);
  assert.notEqual(r[2].config.session, r[0].config.session, 'one fresh id per distinct sid');
  assert.equal(r[3], null);
  assert.equal(nodes[0].config.session, 's_aaaaaaaa', 'input not mutated');
});

test('isMemberDispatch and the engine notes', () => {
  assert.equal(isMemberDispatch({ subagentType: 'worca-x-n_review-2-a1' }), true);
  assert.equal(isMemberDispatch({ subagentType: 'worca-investigator' }), false);
  assert.equal(isMemberDispatch({ memberOf: 's_aaaaaaaa' }), true);
  assert.equal(isMemberDispatch(null), false);
  const t = seed('wf_quick-fix');
  for (const id of ['n_impl', 'n_review']) t.nodes.find((n) => n.id === id).config.session = 's_aaaaaaaa';
  const [spec] = sessionsOf(t, portsFn);
  const notes = sessionNotes(spec, { engine: 'cursor', verified: {}, members: [], labelOf: (id) => id });
  assert.deepEqual(notes[0], { level: 'info', code: 'engine-none', text: 'Cursor has no sub-agents: these steps run as separate sessions there.' });
  const off = sessionNotes(spec, { engine: 'claude', verified: { claude: false }, members: [], labelOf: (id) => id });
  assert.equal(off[0].code, 'gate-off');
  assert.equal(off[0].text, 'Sub-agents are not available on Claude yet: these steps run as separate sessions.');
  assert.deepEqual(sessionNotes(spec), sessionNotes(spec, { engine: 'claude', verified: SESSION_SUBAGENTS_VERIFIED, members: [] }), 'defaults: Claude and the shipped gate');
});

test('sessionNotes past the gate: fan-out, asks, inherited main-agent model; shared names only the unused main-agent settings', () => {
  const spec = { sid: 's_aaaaaaaa', members: ['n_impl', 'n_review'], closure: ['n_impl', 'n_review'], flows: [], internalWires: [], entryWires: [], exitWires: [], crossingLoops: [],
    settings: { label: 'One session', mode: 'subagents', hostModel: 'claude-haiku-4-5', hostEffort: null } };
  const members = [{ nodeId: 'n_impl', label: 'Implementation', model: 'claude-opus-5-5', fanOut: true }, { nodeId: 'n_review', label: 'Review', asks: true }];
  const on = sessionNotes(spec, { engine: 'claude', verified: { claude: true }, members });
  assert.deepEqual(on.map((n) => n.code), ['fanout-nested', 'asks', 'inherits-host-model']);
  assert.deepEqual(on[2], { level: 'info', code: 'inherits-host-model', text: "Review has no model of its own, so it runs on the main agent's model (claude-haiku-4-5)." });
  const routed = sessionNotes(spec, { engine: 'claude', verified: { claude: true }, members: [{ nodeId: 'n_impl', label: 'Implementation', model: 'x', routed: true }] });
  assert.deepEqual(routed.find((n) => n.code === 'routed-model'), { level: 'warn', code: 'routed-model',
    text: "Implementation's model runs on a custom endpoint. When the steps use different endpoints, they run as separate sessions." });
  const shared = sessionNotes({ ...spec, settings: { ...spec.settings, mode: 'shared' } }, { engine: 'claude', verified: { claude: true }, members });
  assert.deepEqual(shared.map((n) => n.code), ['asks', 'shared-ignores']);
  assert.equal(shared[1].text, 'One conversation has no main agent: the main-agent model and effort are not used.');
  assert.equal(sessionNotes(spec, { engine: 'claude', verified: { claude: false }, members }).some((n) => n.code === 'inherits-host-model'), false,
    'nothing about the main agent while the steps run as separate sessions');
});

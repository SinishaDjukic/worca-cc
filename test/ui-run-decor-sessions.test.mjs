// test/ui-run-decor-sessions.test.mjs — the tray header tells the session's state in one glance (05 §6.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decorFromState, applyDecor } from '../ui/public/graph/run-decor.mjs';
import { checkRows } from './helpers/rows.mjs';

const SID = 's_aaaaaaaa';
const node = (id, label, session) => ({ id, kind: 'agent', key: label.toLowerCase(), x: 0, y: 0, label, color: '', config: session ? { session: SID } : {},
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }, { id: 'fix', type: 'md', loop: true }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const STEPPER = { version: 2, template: { id: 'wf', name: 'W' }, bookends: { preflight: true, done: true }, graph: {
  nodes: [node('n_plan', 'Plan'), node('n_impl', 'Implementation', true), node('n_review', 'Review', true)],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_impl', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_impl', port: 'out' }, to: { node: 'n_review', port: 'task' }, loop: false },
    { id: 'w_back', from: { node: 'n_review', port: 'out' }, to: { node: 'n_impl', port: 'fix' }, loop: true }] } };   // the fix loop
const row = (nodeId, status, ord = 1, extra = {}) => ({ key: `x:${nodeId}:${ord}`, executionId: `x:${nodeId}:${ord}`, nodeId, ordinal: ord, cycle: ord, status, activeMs: 60000, costUsd: 0.5, ...extra });
const host = (over = {}) => ({ [SID]: { sid: SID, label: 'One session', mode: 'subagents', modeReason: 'ok', engine: 'claude', transport: 'turns', hostEpoch: 1, hostSessionId: 'H',
  hostModel: null, status: 'idle', turns: 5, dispatches: 5, rotations: 0, restarts: 0, costUsd: 2.41, hostOverheadUsd: 0.06, members: ['n_impl', 'n_review'], reconciled: true, ...over } });
const OPEN = { claude: true };            // the sub-agent gate as the decor sees it (option `sessionVerified`, default SESSION_SUBAGENTS_VERIFIED)
const S = (over) => decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', steps: [], active: [], sessionHosts: host(), ...over },
  { live: true, now: 0, sessionVerified: OPEN }).sessions[SID];

test('the nine states', async () => {
  await checkRows([
    { name: '1 active', run: () => { const s = S({ steps: [row('n_impl', 'running', 2)], active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:2' }] });
      assert.deepEqual([s.status, s.text], ['active', 'One session · Claude · Implementation · cycle 2']); } },
    { name: '2 paused (usage limit)', run: () => { const s = S({ status: 'paused', pauseReason: 'usage_limit', limitResetAt: '2026-10-28T14:00:00', steps: [row('n_impl', 'paused')] });
      assert.match(s.text, /^One session · Claude · Paused · usage limit · resets \d\d:\d\d$/); } },
    { name: '3 error', run: () => assert.equal(S({ status: 'error', steps: [row('n_impl', 'error')] }).text, 'One session · Claude · Failed in Implementation') },
    { name: '4 stopped', run: () => assert.equal(S({ status: 'stopped', steps: [row('n_impl', 'stopped')] }).status, 'stopped') },
    { name: '5 interrupted', run: () => assert.equal(S({ status: 'interrupted', steps: [row('n_impl', 'running')] }).text, 'One session · Claude · Interrupted · resume continues this session') },
    { name: '6 done', run: () => assert.equal(S({ status: 'done', steps: [row('n_impl', 'done'), row('n_review', 'done')] }).text, 'One session · Claude · Done · 2 sub-agents · 5 turns') },
    { name: '7 skipped', run: () => assert.equal(S({ status: 'done', steps: [] }).status, 'skipped') },   // a done run that never reached them (ledger rows are never 'skipped')
    { name: '8 waiting for an outside step', run: () => { const s = S({ steps: [row('n_impl', 'done'), row('n_plan', 'running', 2)], active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:2' }] });
      assert.deepEqual([s.status, s.text], ['waiting', 'One session · Claude · waiting for Plan']); } },
    { name: '9 pending', run: () => assert.equal(S({ sessionHosts: undefined }).text, 'One session · Claude · 2 sub-agents') },
  ]);
});

test('fallback, right side, unpriced engines, tooltip', () => {
  assert.equal(S({ sessionHosts: host({ mode: 'separate', modeReason: 'Cursor has no sub-agents' }), runEngine: 'cursor' }).text, 'One session · Cursor · Separate sessions · Cursor has no sub-agents');
  const d = S({ status: 'done', steps: [row('n_impl', 'done', 1, { costUsd: 1.70 }), row('n_review', 'done', 1, { costUsd: 0.71 })] });   // the rows hold the summary's $2.41
  assert.equal(d.right, 'turn 5 · 2m 0s · $2.41');
  assert.match(d.title, /incl\. \$0\.06 hand-offs/);
  assert.match(d.title, /^5 turns · runs: Implementation ×1, Review ×1$/m, 'runs per member; the session counts host turns');
  assert.equal(S({ runEngine: 'copilot', sessionHosts: host({ costUsd: null }) }).right, 'turn 5 · 0s');
  // Task 66: one conversation has no main agent, so its tooltip names no hand-off (its summary's overhead is a booked 0).
  const shared = S({ status: 'done', steps: [row('n_impl', 'done', 1, { costUsd: 1.70 }), row('n_review', 'done', 1, { costUsd: 0.71 })],
    sessionHosts: host({ mode: 'shared', hostOverheadUsd: 0 }) });
  assert.match(shared.title, /^One Claude conversation$/m);
  assert.match(shared.title, /\$2\.41$/m);
  assert.doesNotMatch(shared.title, /hand-off|main agent/);
});

test('C39 — a member waiting for its host says "queued"', () => {
  const decor = decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', sessionHosts: host(),
    steps: [row('n_impl', 'running'), row('n_review', 'running', 1, { queued: true })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }, { nodeId: 'n_review', executionId: 'x:n_review:1' }] }, { live: true, now: 0, sessionVerified: OPEN });
  assert.equal(decor.footers.n_review.queued, true);
  assert.match(decor.footers.n_review.live || '', /^queued · waiting for Implementation$/);   // the footer's live-line field (run-decor.mjs:362)
  assert.equal(decor.footers.n_impl.queued, undefined);
});

test('a member\'s own dispatch is never a fan square; applyDecor writes the chrome (right side expert-only)', () => {
  const subs = [{ id: 'T1', nodeId: 'n_impl', stepKey: 'x:n_impl:1', subagentType: 'worca-x-n_impl-1-a1', status: 'finished' },
    { id: 'I1', nodeId: 'n_impl', stepKey: 'x:n_impl:1', subagentType: 'worca-investigator', status: 'finished' }];
  const decor = decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', steps: [row('n_impl', 'done')], active: [], sessionHosts: host() },
    { live: true, now: 0, sessionVerified: OPEN, subsOf: (id) => subs.filter((s) => s.nodeId === id) });
  assert.equal(decor.footers.n_impl.fan.count, 1);
  const calls = [];
  const view = { setStatus() {}, setNodeChrome() {}, setFooter() {}, setWireBadge() {}, setWireLive() {}, setSessionChrome: (sid, c) => calls.push([sid, c]) };
  applyDecor(view, { ...decor, detail: false });
  assert.equal(calls[0][1].right, null);
  applyDecor(view, { ...decor, detail: true });
  assert.equal(calls[1][1].right, decor.sessions[SID].right);
});

// ── v2: the rows the master leaves open ──
const plainStepper = { ...STEPPER, graph: { ...STEPPER.graph, nodes: STEPPER.graph.nodes.map((n) => ({ ...n, config: {} })) } };

test('v2 — interrupted wins live and frozen; a usage-limit reset is a local 24-hour clock; ×N slices wait', async () => {
  const at = new Date(2026, 9, 28, 14, 5).toISOString();      // 14:05 local, whatever the locale prints
  await checkRows([
    { name: 'interrupted, frozen (History reads the row as stopped)', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'interrupted', runEngine: 'claude', steps: [row('n_impl', 'running')], active: [], sessionHosts: host() }, { live: false, now: 0, sessionVerified: OPEN });
      assert.deepEqual([d.sessions[SID].status, d.sessions[SID].text], ['interrupted', 'One session · Claude · Interrupted · resume continues this session']);
    } },
    { name: 'interrupted part-done (an outside step was running), frozen', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'interrupted', runEngine: 'claude', steps: [row('n_impl', 'done'), row('n_plan', 'running', 2)], active: [], sessionHosts: host() }, { live: false, now: 0, sessionVerified: OPEN });
      assert.equal(d.sessions[SID].status, 'interrupted', 'resume continues this session');
    } },
    { name: 'an interrupted run whose session had finished', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'interrupted', runEngine: 'claude', steps: [row('n_impl', 'done'), row('n_review', 'done')], active: [], sessionHosts: host() }, { live: false, now: 0, sessionVerified: OPEN });
      assert.equal(d.sessions[SID].status, 'done');
    } },
    { name: 'usage limit', run: () => assert.equal(S({ status: 'paused', pauseReason: 'usage_limit', limitResetAt: at, steps: [row('n_impl', 'paused')] }).text, 'One session · Claude · Paused · usage limit · resets 14:05') },
    { name: 'a plain pause', run: () => assert.equal(S({ status: 'paused', steps: [row('n_impl', 'paused')] }).text, 'One session · Claude · Paused · resumes in this session') },
    { name: '×N slices of a member', run: () => {
      const slice = row('n_impl', 'running', 1, { kind: 'task', executionId: 'x:n_impl:1:t1', key: 'x:n_impl:1:t1', parentExecutionId: 'x:n_impl:1', title: 'Add schema' });
      const s = S({ steps: [slice], active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }] });
      assert.deepEqual([s.status, s.text], ['waiting', "One session · Claude · waiting · Implementation's tasks run on their own"]);
    } },
  ]);
});

test('v2 — the cases no row of the table names: paused elsewhere, stopped part-way, done and skipped', async () => {
  await checkRows([
    { name: 'the run paused at an outside step with the session part-done', run: () => assert.equal(S({ status: 'paused', steps: [row('n_impl', 'done'), row('n_plan', 'paused', 2)] }).status, 'paused') },
    { name: 'the run stopped with the session part-done', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'stopped', runEngine: 'claude', steps: [row('n_impl', 'done')], active: [], sessionHosts: host() }, { live: false, now: 0, sessionVerified: OPEN });
      assert.deepEqual([d.sessions[SID].status, d.sessions[SID].text], ['stopped', 'One session · Claude · Stopped']);
    } },
    { name: 'done, the second member skipped', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'done', runEngine: 'claude', steps: [row('n_impl', 'done')], active: [], sessionHosts: host() }, { live: false, now: 0, sessionVerified: OPEN });
      assert.equal(d.sessions[SID].text, 'One session · Claude · Done · 1 sub-agent · 5 turns');
    } },
    { name: 'waiting with nothing active', run: () => assert.equal(S({ steps: [row('n_impl', 'done')] }).text, 'One session · Claude · waiting') },
  ]);
});

test('v2 — no summary yet: the shipped gate, a finished run that never opened it, one step', () => {
  const d = decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', steps: [], active: [] }, { live: true, now: 0 });
  assert.deepEqual([d.sessions[SID].fallback, d.sessions[SID].text], [true, 'One session · Claude · Separate sessions · sub-agents are not available on Claude yet'], 'the default reads SESSION_SUBAGENTS_VERIFIED');
  const k = decorFromState({ stepper: STEPPER, status: 'done', runEngine: 'claude', steps: [row('n_impl', 'done'), row('n_review', 'done')], active: [] }, { live: false, now: 0, sessionVerified: OPEN });
  assert.deepEqual([k.sessions[SID].fallback, k.sessions[SID].text], [true, 'One session · Claude · Separate sessions'], 'the kill switch writes no trace');
  const undecided = decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', steps: [row('n_plan', 'running')], active: [] }, { live: true, now: 0, sessionVerified: OPEN });
  assert.equal(undecided.sessions[SID].fallback, null, 'gate open, nothing ran yet: the Labs flag decides, not the decor');
  const calls = [];
  applyDecor({ setStatus() {}, setNodeChrome() {}, setFooter() {}, setWireBadge() {}, setWireLive() {}, setSessionChrome: (...x) => calls.push(x) }, { ...undecided, detail: false });
  assert.deepEqual(calls, [[SID, { status: 'pending', right: null, text: null, title: null, aria: null }]], 'no fallback key: the view keeps its own words');
  const ranPlain = decorFromState({ stepper: STEPPER, status: 'running', runEngine: 'claude', steps: [row('n_impl', 'running')], active: [] }, { live: true, now: 0, sessionVerified: OPEN });
  assert.equal(ranPlain.sessions[SID].fallback, true, 'a member ran and no host opened: the kill switch');
  const lone = { ...STEPPER, graph: { ...STEPPER.graph, nodes: STEPPER.graph.nodes.map((n) => (n.id === 'n_review' ? { ...n, config: {} } : n)) } };
  const l = decorFromState({ stepper: lone, status: 'running', runEngine: 'claude', steps: [], active: [] }, { live: true, now: 0, sessionVerified: OPEN });
  assert.equal(l.sessions[SID].text, 'One session · Claude · Separate sessions · one step');
});

test('v2 — aria, the queued member is never "current", no cost without a figure, a session-free run is untouched', () => {
  const a = S({ steps: [row('n_impl', 'done'), row('n_review', 'running', 2)], active: [{ nodeId: 'n_review', executionId: 'x:n_review:2' }] });
  assert.equal(a.aria, 'One session: Implementation, Review. running Review, turn 5');
  assert.equal(S({ status: 'done', steps: [row('n_impl', 'done'), row('n_review', 'done')] }).aria, 'One session: Implementation, Review. done, 2 sub-agents, 5 turns');
  const q = S({ steps: [row('n_impl', 'running'), row('n_review', 'running', 1, { queued: true })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }, { nodeId: 'n_review', executionId: 'x:n_review:1' }] });
  assert.equal(q.current.nodeId, 'n_impl', 'the newest active member is queued; the one running is current');
  const both = S({ steps: [row('n_impl', 'running', 1, { startedAt: '2026-10-28T10:00:00.000Z' }), row('n_review', 'running', 1, { startedAt: '2026-10-28T10:05:00.000Z' })],
    active: [{ nodeId: 'n_impl', executionId: 'x:n_impl:1' }, { nodeId: 'n_review', executionId: 'x:n_review:1' }] });
  assert.equal(both.current.nodeId, 'n_review', 'neither queued: the one that started last');
  const n = S({ status: 'done', steps: [], sessionHosts: host({ costUsd: null, hostOverheadUsd: null }) });
  assert.deepEqual([n.cost, n.right], ['', 'turn 5 · 0s']);
  assert.doesNotMatch(n.title, /\$|incl\./);
  const plain = decorFromState({ stepper: plainStepper, status: 'running', runEngine: 'claude', steps: [row('n_impl', 'running')], active: [] }, { live: true, now: 0 });
  assert.deepEqual(plain.sessions, {});
  const calls = [];
  applyDecor({ setStatus() {}, setNodeChrome() {}, setFooter() {}, setWireBadge() {}, setWireLive() {}, setSessionChrome: (...x) => calls.push(x) }, { ...plain, detail: true });
  assert.deepEqual(calls, []);
  applyDecor({ setStatus() {}, setNodeChrome() {}, setFooter() {}, setWireBadge() {}, setWireLive() {} }, { ...decorFromState({ stepper: STEPPER, status: 'running', steps: [], active: [] }, { live: true, now: 0 }), detail: true });   // a view without trays
});

// ── v3: the review's rows (fix loops and gates, the cost on the cards, a pause before the hosts open, the words) ──
test('v3 — not "Done" while the run can come back: a fix loop between its members, a loop gate held on a member', async () => {
  const gate = { wireId: 'w_back', fromNode: 'n_review', toNode: 'n_impl', askId: 'gate-w_back-1' };
  await checkRows([
    { name: 'Implementation is a cycle ahead of Review', run: () => {
      const s = S({ steps: [row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2)] });
      assert.deepEqual([s.status, s.text], ['waiting', 'One session · Claude · waiting']);
    } },
    { name: 'a loop gate holds on Review for a person', run: () => {
      const s = S({ steps: [row('n_impl', 'done'), row('n_review', 'done')], gate });
      assert.deepEqual([s.status, s.text], ['waiting', 'One session · Claude · waiting for an answer']);
    } },
    { name: 'the same rows once the run is done', run: () => assert.equal(S({ status: 'done', steps: [row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2)], gate }).status, 'done') },
    { name: 'both members in the same cycle, no gate: done', run: () => assert.equal(S({ steps: [row('n_impl', 'done', 2), row('n_review', 'done', 2)] }).status, 'done') },
    { name: 'a gate on an outside step', run: () => assert.equal(S({ steps: [row('n_impl', 'done'), row('n_review', 'done')], gate: { ...gate, fromNode: 'n_plan' } }).status, 'done') },
  ]);
});

test('v3 — the session cost is its members\' totals; a pause before the hosts open is undecided; the tooltip leads with the words', () => {
  const degraded = S({ status: 'done', steps: [row('n_impl', 'done', 1, { costUsd: 1.20 }), row('n_review', 'done', 1, { costUsd: 0.72 })],
    sessionHosts: host({ mode: 'separate', modeReason: 'the main agent did not dispatch', costUsd: 0.12, hostOverheadUsd: 0.02 }) });
  assert.equal(degraded.costUsd, 1.92, 'the plain runs after a degrade book on the rows, not in the trace');
  assert.match(degraded.right, /\$1\.92$/);
  assert.equal(S({ steps: [], sessionHosts: host({ costUsd: 0.4 }) }).costUsd, 0.4, 'no row has a figure yet: the summary stands in');
  const pre = decorFromState({ stepper: STEPPER, status: 'paused', pauseReason: 'usage_limit', runEngine: 'claude', steps: [], active: [] }, { live: true, now: 0, sessionVerified: OPEN });
  assert.equal(pre.sessions[SID].fallback, null, 'paused in preflight: the resume opens the hosts');
  const frozenPre = decorFromState({ stepper: STEPPER, status: 'paused', runEngine: 'claude', steps: [], active: [] }, { live: false, now: 0, sessionVerified: OPEN });
  assert.equal(frozenPre.sessions[SID].fallback, null, 'and on History');
  const f = S({ status: 'error', steps: [row('n_impl', 'error')] });
  assert.equal(f.title.split('\n')[0], 'One session · Claude · Failed in Implementation', 'hosts that show only the dot');
  const k = decorFromState({ stepper: STEPPER, status: 'done', runEngine: 'claude', steps: [row('n_impl', 'done'), row('n_review', 'done')], active: [] }, { live: false, now: 0, sessionVerified: OPEN });
  assert.doesNotMatch(k.sessions[SID].right, /turn/, 'no summary: no host turn');
  assert.match(k.sessions[SID].title, /^runs: Implementation ×1, Review ×1$/m);
});

test('v3 — pending with a summary (the hosts opened, nothing ran); the flag reason in UI words', () => {
  const p = S({});
  assert.deepEqual([p.status, p.text, p.fallback], ['pending', 'One session · Claude · 2 sub-agents', false]);
  const off = S({ sessionHosts: host({ mode: 'separate', modeReason: 'the Labs flag sessionGroups is off' }) });
  assert.equal(off.text, 'One session · Claude · Separate sessions · the One session Labs flag is off');
  assert.doesNotMatch(`${off.text}\n${off.title}\n${off.aria}`, /group/i, 'never "group" (Global Constraints)');
});

// ── v4: the review's rows (a loop only when a loop wire joins two members; paused or interrupted mid-loop; the words) ──
test('v4 — members that ran a different number of times with no loop between them are done; a loop is followed through a flow card', async () => {
  const wire = (id, from, to, loop = false, port = 'task') => ({ id, from: { node: from, port: 'out' }, to: { node: to, port }, loop });
  const withWires = (wires, extra = []) => ({ ...STEPPER, graph: { nodes: [...STEPPER.graph.nodes, ...extra], wires } });
  const at = (stepper, over) => decorFromState({ stepper, status: 'running', runEngine: 'claude', active: [], sessionHosts: host(), ...over }, { live: true, now: 0, sessionVerified: OPEN }).sessions[SID];
  const orNode = { id: 'n_or', kind: 'or', x: 0, y: 0, label: 'OR', config: {}, ports: { inputs: [{ id: 'a', type: 'md' }, { id: 'b', type: 'md' }], outputs: [{ id: 'out', type: 'md', when: 'always' }] } };
  await checkRows([
    { name: 'a member\'s own loop (Refine\'s revise loop): the session is done once the other member ran', run: () => {
      const s = at(withWires([wire('w1', 'n_plan', 'n_impl'), wire('w2', 'n_impl', 'n_review'), wire('w_self', 'n_impl', 'n_impl', true, 'fix')]),
        { steps: [row('n_plan', 'done'), row('n_impl', 'done'), row('n_impl', 'done', 2), row('n_review', 'done')] });
      assert.deepEqual([s.status, s.text], ['done', 'One session · Claude · Done · 2 sub-agents · 5 turns']);
    } },
    { name: 'no loop wire at all: done', run: () => assert.equal(at(withWires([wire('w1', 'n_plan', 'n_impl'), wire('w2', 'n_impl', 'n_review')]),
      { steps: [row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2)] }).status, 'done') },
    { name: 'the loop runs through an OR valve: still a fix loop', run: () => {
      const s = at(withWires([wire('w1', 'n_plan', 'n_impl'), wire('w2', 'n_impl', 'n_review'), wire('w3', 'n_review', 'n_or', true, 'a'), wire('w4', 'n_or', 'n_impl', false, 'fix')], [orNode]),
        { steps: [row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2)] });
      assert.equal(s.status, 'waiting');
    } },
    { name: 'an outside flow card running is never the step it waits for', run: () => {
      const s = at(withWires([...STEPPER.graph.wires], [orNode]), { steps: [row('n_impl', 'done')], active: [{ nodeId: 'n_or', executionId: 'x:n_or:1' }] });
      assert.deepEqual([s.status, s.text], ['waiting', 'One session · Claude · waiting']);
    } },
    { name: 'a loop gate held on a member while the other has not run: waiting for an answer', run: () => {
      const s = at(STEPPER, { steps: [row('n_impl', 'done')], gate: { wireId: 'w_x', fromNode: 'n_impl', toNode: 'n_plan', askId: 'gate-w_x-1' } });
      assert.deepEqual([s.status, s.text], ['waiting', 'One session · Claude · waiting for an answer']);
    } },
  ]);
});

test('v4 — a run paused or interrupted in the middle of a fix loop is not "Done"; interrupted before the hosts opened is undecided', async () => {
  const mid = [row('n_impl', 'done'), row('n_review', 'done'), row('n_impl', 'done', 2)];
  const at = (status, live, over = {}) => decorFromState({ stepper: STEPPER, status, runEngine: 'claude', steps: mid, active: [], sessionHosts: host(), ...over }, { live, now: 0, sessionVerified: OPEN }).sessions[SID];
  await checkRows([
    { name: 'paused, live', run: () => assert.deepEqual([at('paused', true).status, at('paused', true).text], ['paused', 'One session · Claude · Paused · resumes in this session']) },
    { name: 'paused, frozen (History)', run: () => assert.equal(at('paused', false).status, 'paused') },
    { name: 'interrupted, frozen', run: () => assert.deepEqual([at('interrupted', false).status, at('interrupted', false).text], ['interrupted', 'One session · Claude · Interrupted · resume continues this session']) },
    { name: 'done: done', run: () => assert.equal(at('done', false).status, 'done') },
    { name: 'interrupted before the hosts opened: undecided (its resume opens them)', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'interrupted', runEngine: 'claude', steps: [], active: [] }, { live: false, now: 0, sessionVerified: OPEN });
      assert.equal(d.sessions[SID].fallback, null);
    } },
  ]);
});

// ── v5: the review's rows (branches no row held: a held gate on a paused run, a loop into a member from outside the
// session, Copilot with priced rows, a ×N member's runs, an interrupted run that never reached the session) ──
test('v5 — a held gate keeps a paused run paused; a loop into a member from outside is no fix loop; Copilot, ×N and interrupted pins', async () => {
  const wire = (id, from, to, loop = false, port = 'task') => ({ id, from: { node: from, port: 'out' }, to: { node: to, port }, loop });
  const gate = { wireId: 'w_back', fromNode: 'n_review', toNode: 'n_impl', askId: 'gate-w_back-1' };
  const outsideLoop = { ...STEPPER, graph: { nodes: [...STEPPER.graph.nodes, node('n_check', 'Check')],
    wires: [wire('w1', 'n_plan', 'n_impl'), wire('w2', 'n_impl', 'n_review'), wire('w3', 'n_review', 'n_check'), wire('w_chk', 'n_check', 'n_impl', true, 'fix')] } };
  await checkRows([
    { name: 'paused while a loop gate holds on a member (live): paused, not done', run: () => {
      const s = S({ status: 'paused', steps: [row('n_impl', 'done'), row('n_review', 'done')], gate });
      assert.deepEqual([s.status, s.text], ['paused', 'One session · Claude · Paused · resumes in this session']);
    } },
    { name: 'a loop wire into a member from outside the session (Check → Implementation): done once both members ran', run: () => {
      const s = decorFromState({ stepper: outsideLoop, status: 'running', runEngine: 'claude', active: [], sessionHosts: host(),
        steps: [row('n_plan', 'done'), row('n_impl', 'done'), row('n_review', 'done')] }, { live: true, now: 0, sessionVerified: OPEN }).sessions[SID];
      assert.equal(s.status, 'done');
    } },
    { name: 'Copilot with priced rows: no figure on the tray or in its tooltip', run: () => {
      const s = S({ runEngine: 'copilot', status: 'done', steps: [row('n_impl', 'done'), row('n_review', 'done')] });
      assert.deepEqual([s.cost, /\$/.test(s.right), /\$/.test(s.title)], ['', false, false]);
    } },
    { name: 'a ×N member\'s slices are one run of it', run: () => {
      const slices = [1, 2, 3].map((n) => row('n_impl', 'done', 1, { key: `x:n_impl:1:p1t${n}`, executionId: `x:n_impl:1:p1t${n}`, kind: 'task', parentExecutionId: 'x:n_impl:1' }));
      assert.match(S({ status: 'done', steps: [...slices, row('n_impl', 'done', 2), row('n_review', 'done')] }).title, /runs: Implementation ×2, Review ×1$/m);
    } },
    { name: 'interrupted before the session started: pending, not interrupted', run: () => {
      const d = decorFromState({ stepper: STEPPER, status: 'interrupted', runEngine: 'claude', steps: [row('n_plan', 'done')], active: [], sessionHosts: host() },
        { live: false, now: 0, sessionVerified: OPEN });
      assert.equal(d.sessions[SID].status, 'pending');
    } },
  ]);
});

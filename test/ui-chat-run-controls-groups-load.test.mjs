// test/ui-chat-run-controls-groups-load.test.mjs — the test of test/ui-chat-run-controls.test.mjs that needs the app's
// run groups load still in flight: a Chat card built before it becomes a group card once it lands, and its Stop stops the
// group. app.js loads the run groups when it loads, so this test lives in its own file, whose one shared app
// (test/helpers/shared-app-boot.mjs) gets the groups only when the test releases them.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { runPageOn } from './helpers/run-page-boot.mjs';
import { chatCardBuilder } from '../ui/public/chat/extensions.mjs';
import { useSharedApp } from './helpers/shared-app-boot.mjs';

const RUN_ID = 'run-chat-1';
const PID = 'abcd1234';
const agent = (id, key, color, over = {}) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color,
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true }, ...over });
const MANIFEST = { version: 2, template: { id: 'wf_review', name: 'Review only' }, graph: {
  nodes: [agent('n_plan', 'planner', 'violet', { model: 'claude-opus-5-5' }), agent('n_rev', 'reviewer', 'peach'),
    { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_rev', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_rev', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
const STATE = (over = {}) => ({ type: 'state', runId: RUN_ID, id: PID, title: 'Fix login', status: 'running', startedAt: '2026-10-11T10:00:00.000Z', stepper: MANIFEST,
  steps: [{ key: 'x:n_plan:2', executionId: 'x:n_plan:2', nodeId: 'n_plan', ordinal: 2, cycle: 2, status: 'running', activeMs: 3000, runningSince: null, costUsd: 0.2, startedAt: '2026-10-11T10:00:01.000Z' }],
  active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:2' }], totalCostUsd: 0.2, subAgents: [], ...over });

// The load-time answers: the run groups wait for the test's release.
const P = ['aaaa0001', 'aaaa0002', 'aaaa0003', 'aaaa0004'];
const st = ['done', 'running', 'running', 'stopped'];
const member = (i) => ({ position: i + 1, title: `Run ${i + 1}`, pipelineId: P[i], ticketId: null, status: st[i], pr: null, ticket: null, adhoc: true, after: null });
const GROUPS = { groups: [{ id: 'g_my', kind: 'user', title: 'My group', projectKey: null, planning: null, members: P.map((_, i) => member(i)), cost: { usd: 0, byPipeline: {} } }] };
const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));
let release = null;
const gated = new Promise((r) => { release = r; });
const hist = P.map((id, i) => ({ id, projectKey: 'acme', title: `Run ${i + 1}`, status: st[i], mtime: Date.now() }));
const app = useSharedApp({ before, beforeEach, after }, {
  fetchHandler: (url) => (url.startsWith('/api/ask/runs/')
    ? json({ state: { id: P[3], title: 'Run 4', status: 'stopped', stepper: null, steps: [], active: [] }, extras: null })
    : url.startsWith('/api/run-groups') ? gated.then(() => json(GROUPS))
      : url.startsWith('/api/history') ? json({ pipelines: hist }) : null),
});
const bootApp = runPageOn(app);

test('a Chat card built before the run groups load becomes a group card once they do, and its Stop stops the group (never "Stop this pipeline?")', async () => {
  const ctx = await bootApp();
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [1, 2].map((i) => ({ runId: `run-${i + 1}`, pipelineId: P[i], title: `Run ${i + 1}`, projectDir: '/tmp/p',
    status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' })) });
  for (const i of [1, 2]) ctx.dispatch(STATE({ runId: `run-${i + 1}`, id: P[i], title: `Run ${i + 1}` }));
  await ctx.settle(8);
  ctx.go('chat');
  await ctx.settle(8);
  const doc = ctx.window.document;
  const built = chatCardBuilder('progress')({ kind: 'card', id: 'card_stopped', state: 'tracked',
    card: { type: 'progress', pipelineId: P[3], runId: P[3], projectKey: 'acme', title: 'Run 4' } },
  { doc, win: ctx.window, fetch: (...a) => ctx.window.fetch(...a), openRunPanel: () => {}, openArtifact: () => {}, announce: () => {} });
  doc.body.appendChild(built.el);
  await ctx.settle(8);
  assert.equal(built.el.querySelector('.kind-chip').hidden, true, 'no groups yet');
  release();
  await ctx.settle(8);
  assert.equal(built.el.querySelector('.kind-chip').textContent, 'Group · 4 runs', 'the groups load repaints the card, with no run frame');
  assert.equal(built.el.querySelector('.kind-chip').hidden, false);
  // A stale paint hands act() no row: Stop still acts on the run's group.
  ctx.window.__np.chatRunControls.act({ pipelineId: P[1] }, 'stop', null, null);
  await ctx.settle(4);
  assert.match(doc.getElementById('confirm-title').textContent, /Stop 2 runs\?/);
  doc.getElementById('confirm-cancel').click();
  await ctx.settle(4);
  built.el.querySelector('.chat-rc-actions > [data-model-action="stop"]:not([hidden])').click();
  await ctx.settle(4);
  assert.ok(doc.getElementById('stop-modal').classList.contains('hidden'), 'never the single run\'s Stop');
  assert.match(doc.getElementById('confirm-modal').textContent, /Stop 2 runs\?/);
  built.dispose();
});

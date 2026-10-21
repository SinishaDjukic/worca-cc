// test/ui-answer-path.test.mjs — Known bug 7: a plan gate and a cycle gate can be approved from the chat card, the
// run page and the group page; each click sends exactly one answer POST.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { createChatRunCard } from '../ui/public/chat/run-card.mjs';
import { checkRows } from './helpers/rows.mjs';

const PLAN_Q = { id: 'plan-n_plan-1', kind: 'plan', nodeId: 'n_plan',
  plan: { port: 'plan', round: 1, revisable: true, nodeId: 'n_plan', file: '/x/plan.md', check: { ok: true, passed: 8, total: 8, items: [], grounding: [] } } };
const GATE_Q = { id: 'gate-n_review-2', kind: 'gate', nodeId: 'n_review', wireId: 'w1', deliveryNo: 2, issues: [{ severity: 'major', title: 'Missing test', detail: 'x' }] };
const GROUPS = { groups: [{ id: 'feat_1', kind: 'feature', title: 'Run tags', projectKey: null, planning: null,
  members: [{ position: 1, title: 'Slice 1', pipelineId: 'p1', ticketId: null, status: 'running', pr: null, ticket: null, adhoc: false, after: null }], cost: { usd: 0, byPipeline: {} } }] };
const json = (b) => Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }));

function recorder() {
  const posts = [];
  const fetchHandler = (url, opts = {}) => {
    if (url.startsWith('/api/run-groups')) return json(GROUPS);
    if (url.startsWith('/api/shape/features/feat_1')) return json({ id: 'feat_1', title: 'Run tags', projectKey: 'acme', status: 'active', total: 1, done: 0, slices: [], ship: { ready: false } });
    if (opts.method === 'POST' && (url === '/api/answer' || /^\/api\/runs\/[^/]+\/answer$/.test(url))) {
      posts.push({ url, body: JSON.parse(opts.body || '{}') });
      return json({ ok: true });
    }
    return null;
  };
  return { posts, fetchHandler };
}

async function host(kind, question) {
  const rec = recorder();
  const ctx = await bootApp({ fetchHandler: rec.fetchHandler });
  applyFlags({ shapeFirst: true }, ctx.window.document);   // a fresh document per boot: nothing to reset
  helloRun(ctx, { runId: 'r1', pipelineId: 'p1' });
  ctx.dispatch({ type: 'question', runId: 'r1', ...question });
  await ctx.settle();
  let root = null;
  if (kind === 'run page') { ctx.go('running/r1'); await ctx.settle(4); root = ctx.window.document.querySelector('#run-detail'); }
  if (kind === 'group page') { ctx.go('feature/feat_1'); await ctx.settle(6); root = ctx.window.document.querySelector('#group-detail .gpage'); }
  if (kind === 'chat card') {
    const doc = ctx.window.document;
    const card = createChatRunCard({ doc, win: ctx.window, ident: { cardId: 'c1', runId: 'r1', pipelineId: 'p1', title: 'Demo' }, snapshot: null,
      ctx: { announce: () => {} }, controls: ctx.window.__np.chatRunControls });
    doc.body.appendChild(card.el);
    card.update({ source: 'live', runId: 'r1', pipelineId: 'p1', status: 'running', pendingQuestion: question, run: { status: 'running', pendingQuestion: question } });
    await ctx.settle();
    root = card.el;
  }
  return { ctx, root, posts: rec.posts };
}

test('Known bug 7: plan gate and cycle gate are approvable from every host', async () => {
  const rows = [];
  for (const kind of ['chat card', 'run page', 'group page']) {
    rows.push({ name: `${kind}: plan gate`, run: async () => {
      const { ctx, root, posts } = await host(kind, PLAN_Q);
      const b = root.querySelector('.qpanel .plan-approve');
      assert.ok(b, 'the approve button is drawn');
      b.click();
      await ctx.settle();
      assert.equal(posts.length, 1, 'exactly one POST');
      assert.equal(posts[0].url, '/api/runs/r1/answer');
      assert.equal(posts[0].body.decision, 'approve');
      assert.equal(posts[0].body.id, PLAN_Q.id);
    } });
    rows.push({ name: `${kind}: cycle gate`, run: async () => {
      const { ctx, root, posts } = await host(kind, GATE_Q);
      const b = root.querySelector('.qpanel .gate-another');
      assert.ok(b, 'Approve another is drawn');
      b.click();
      await ctx.settle();
      assert.equal(posts.length, 1, 'exactly one POST (no double delegate)');
      assert.equal(posts[0].url, '/api/answer');
      assert.deepEqual(posts[0].body, { runId: 'r1', id: GATE_Q.id, payload: { decision: 'another' } });
    } });
  }
  await checkRows(rows);
});

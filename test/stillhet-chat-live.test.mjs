// test/stillhet-chat-live.test.mjs — the live chat's I/O (ui/public/stillhet/live/chat-live.mjs, D5, D9, D10): thread
// states, frames before the fetch, a failed reply and Try again, the two-call first send, refusals that write nothing, and
// the PR and Start bodies pinned to dev's routes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startChatLive, prBodyOf, startBodyOf, ACTIONS, FLOW, OPENS, openTab } from '../ui/public/stillhet/live/chat-live.mjs';
import { actionFlow } from '../ui/public/design-system/components/run-state.mjs';
import { THREAD } from './helpers/stillhet-live-fixture.mjs';

const tick = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
function rig({ answer = () => [200, {}], opened = [], went = [], clip = null, open = (u) => { opened.push(u); return {}; } } = {}) {
  const calls = [], sent = [], toasts = [], changes = [];
  const fetch = async (url, o = {}) => {
    calls.push({ url, method: o.method || 'GET', body: o.body ? JSON.parse(o.body) : undefined });
    const [status, body] = await answer(url, o.method || 'GET', calls.length);
    if (status === 'throw') throw new Error('offline');
    return { ok: status < 300, status, json: async () => { if (body === 'not json') throw new SyntaxError('Unexpected token'); return body; } };
  };
  const live = startChatLive({ fetch, send: (m) => sent.push(m), toast: (t) => toasts.push(t), now: () => 0, open, go: (h) => went.push(h), ...(clip ? { clipboard: clip } : {}) });
  live.onChange((id) => changes.push([id, live.state(id)]));
  return { live, calls, sent, toasts, changes };
}
const snap = (over = {}) => ({ ...THREAD, messages: THREAD.messages.slice(0, 1), ...over });

test('open: loading, then ready with turns; 500 is failed and Try again reopens; 404 is gone; two opens share one fetch', async () => {
  let status = 500;
  const r = rig({ answer: () => [status, status === 200 ? snap() : { error: 'boom' }] });
  const a = r.live.open('ask_1'), b = r.live.open('ask_1');
  assert.equal(a, b, 'the in-flight promise is reused');
  assert.equal(r.live.state('ask_1'), 'loading');
  assert.deepEqual(r.sent, [{ type: 'subscribe', threadId: 'ask_1' }]);
  await a;
  assert.equal(r.live.state('ask_1'), 'failed');
  assert.deepEqual(r.live.turns('ask_1'), []);
  status = 200;
  await r.live.open('ask_1');
  assert.equal(r.live.state('ask_1'), 'ready');
  assert.deepEqual(r.live.turns('ask_1').map((x) => x.t), ['you']);
  assert.equal(r.calls.filter((c) => c.url === '/api/ask/threads/ask_1').length, 2);
  status = 404;
  await r.live.open('ask_gone');
  assert.equal(r.live.state('ask_gone'), 'gone');
});

test('frames that come before the fetch lands are applied once; ask-error adds one failed turn; Try again re-sends once, one YouTurn', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ answer: async (url, method) => {
    if (url === '/api/ask/threads/ask_1' && method === 'GET') { await gate; return [200, snap()]; }
    if (url.endsWith('/messages')) return [202, { userMessageId: 'm5', assistantMessageId: 'm6' }];
    return [200, {}];
  } });
  const p = r.live.open('ask_1');
  const start = { type: 'ask-start', threadId: 'ask_1', messageId: 'm2', userMessageId: 'm1', seq: 1, startedAt: '2026-11-12T13:01:00Z' };
  r.live.frame(start); r.live.frame(start);
  release(); await p;
  r.live.frame({ type: 'ask-error', threadId: 'ask_1', messageId: 'm2', seq: 2, message: 'model overloaded', blocks: [] });
  let turns = r.live.turns('ask_1');
  assert.equal(turns.filter((x) => x.t === 'failed').length, 1);
  assert.equal(turns.find((x) => x.t === 'failed').detail, 'model overloaded');
  const res = await r.live.act('retry', { threadId: 'ask_1', messageId: 'm2' });
  assert.equal(res.ok, true);
  const posts = r.calls.filter((c) => c.url.endsWith('/messages'));
  assert.equal(posts.length, 1, 'sent once');
  assert.equal(posts[0].body.text, 'Add a CSV export');
  turns = r.live.turns('ask_1');
  assert.equal(turns.filter((x) => x.t === 'failed').length, 0, 'the failed turn is gone');
  assert.equal(turns.filter((x) => x.t === 'you' && x.text === 'Add a CSV export').length, 1, 'one YouTurn');
});

test('a send that names no model (Try again, Follow, the dock) runs on the chat\'s own model, else on dev\'s default', async () => {
  const r = rig({ answer: (url, method) => {
    if (url === '/api/ask/threads/ask_1' && method === 'GET') return [200, { ...THREAD, thread: { ...THREAD.thread, model: 'claude-sonnet', effort: 'low' } }];
    if (url === '/api/ask/models') return [200, { default: { model: 'claude-opus', effort: 'high' }, defaults: { codex: { model: 'gpt-5', effort: 'medium' } } }];
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (url.endsWith('/messages')) return [202, { userMessageId: 'u9' }];
    return [200, {}];
  } });
  await r.live.open('ask_1');
  assert.equal((await r.live.act('retry', { threadId: 'ask_1', messageId: 'm4' })).ok, true);
  let post = r.calls.filter((c) => c.url.endsWith('/messages')).at(-1);
  assert.deepEqual([post.body.model, post.body.effort], ['claude-sonnet', 'low'], 'Try again: the chat\'s own model');
  assert.equal((await r.live.act('send', { text: 'Follow the export task' })).ok, true);
  post = r.calls.filter((c) => c.url.endsWith('/messages')).at(-1);
  assert.equal(post.url, '/api/ask/threads/ask_new/messages');
  assert.deepEqual([post.body.model, post.body.effort], ['claude-opus', 'high'], 'a new chat: dev\'s default');
});

test('a refused send writes nothing and toasts once; create-ok then message-409 deletes the empty thread; a failed delete is reused', async () => {
  let del = 200, msg = 409;
  const r = rig({ answer: (url, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (url.endsWith('/messages')) return [msg, msg < 300 ? { userMessageId: 'u1' } : { error: 'turn in flight' }];
    if (method === 'DELETE') return [del, {}];
    return [200, {}];
  } });
  let res = await r.live.act('send', { text: 'hello', model: 'claude-opus', effort: 'high' });
  assert.equal(res.ok, false);
  assert.deepEqual(r.toasts, ['Could not send your message: turn in flight']);
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/ask/threads', 'POST /api/ask/threads/ask_new/messages', 'DELETE /api/ask/threads/ask_new']);
  assert.equal(r.live.state('ask_new'), '', 'nothing written');
  del = 500;
  await r.live.act('send', { text: 'hello', model: 'claude-opus', effort: 'high' });
  r.calls.length = 0; msg = 202;
  res = await r.live.act('send', { text: 'hello', model: 'claude-opus', effort: 'high' });
  assert.equal(res.ok, true);
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/ask/threads/ask_new/messages'], 'the kept empty thread is reused: at most one');
  assert.equal(res.data.threadId, 'ask_new');
  assert.ok(!r.changes.some(([id, st]) => id === 'ask_new' && st === 'loading'), 'a first send lands ready, no loading flash');
  assert.equal(r.live.state('ask_new'), 'ready');
  assert.deepEqual(r.live.turns('ask_new').map((x) => [x.t, x.text]), [['you', 'hello']]);
});

test('a route action: its route and body; refused, one toast with its words; pending while out', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ answer: async (url) => { if (url.includes('/stop')) { await gate; } return url.includes('pin') ? [200, {}] : [409, { error: 'chat is busy' }]; } });
  const res = await r.live.act('pin', { threadId: 'ask_1', on: true });
  assert.equal(res.ok, false);
  assert.deepEqual(r.calls.at(-1), { url: '/api/ask/threads/ask_1', method: 'PATCH', body: { pinned: true } });
  assert.deepEqual(r.toasts, ['Could not pin the chat: chat is busy']);
  const p = r.live.act('stop', { threadId: 'ask_1' });
  assert.equal(r.live.pending('stop:ask_1'), true, 'pending under its action and its chat');
  release(); await p; await tick();
  assert.equal(r.live.pending('stop:ask_1'), false);
});

test('copy: a clipboard that refuses toasts "Could not copy: …"', async () => {
  const live = startChatLive({ fetch: async () => ({ ok: true, json: async () => ({}) }), toast: (t) => live._t.push(t), clipboard: { writeText: async () => { throw new Error('denied'); } } });
  live._t = [];
  const res = await live.act('copy', { text: 'x' });
  assert.equal(res.ok, false);
  assert.deepEqual(live._t, ['Could not copy: denied']);
});

test('prBodyOf returns only keys POST /api/pr reads; startBodyOf only keys of dev\'s Start body', () => {
  const src = readFileSync('ui/routes/history/pull-requests.mjs', 'utf8');
  const read = new Set([...src.matchAll(/body\.([a-zA-Z]+)/g)].map((m) => m[1]));
  const pr = prBodyOf({ pipelineId: 'pa', title: 'T', body: 'B', draft: true, threadId: 'ask_1', cardId: 'card_1' });
  for (const k of Object.keys(pr)) assert.ok(read.has(k), `${k} is read by the route`);
  assert.deepEqual(pr, { id: 'pa', title: 'T', body: 'B', draft: true, askThreadId: 'ask_1', askCardId: 'card_1' });
  // POST /api/pr refuses a body with neither ("projectDir or projectKey is required"): the run's store key, else its folder
  const keyed = prBodyOf({ pipelineId: 'pa', projectKey: 'web-1a2b3c4d', projectDir: '/src/web' });
  assert.deepEqual([keyed.projectKey, keyed.projectDir], ['web-1a2b3c4d', undefined]);
  assert.equal(prBodyOf({ pipelineId: 'pa', projectDir: '/src/web' }).projectDir, '/src/web');
  for (const k of Object.keys(keyed)) assert.ok(read.has(k), `${k} is read by the route`);
  const card = { title: 'CSV', brief: 'Add CSV', workflowId: 'wf_default', guardrailsId: 'g', target: 'project', projectDir: '/src/web', featureBranch: 'feat/csv' };
  assert.deepEqual(startBodyOf(card), { prompt: 'Add CSV', workflowId: 'wf_default', guardrailsId: 'g', mock: false, title: 'CSV', featureBranch: 'feat/csv', projectDir: '/src/web' });
  assert.deepEqual(startBodyOf({ ...card, target: 'none' }).noProject, true);
  const [m, url, body] = ACTIONS.start[1]({ card, threadId: 'ask_1', cardId: 'card_1' });
  assert.deepEqual([m, url, body.askThreadId, body.askCardId], ['POST', '/api/run', 'ask_1', 'card_1']);
});

test('quiet is each call\'s own: a quiet bulk call in flight never silences another action\'s refusal', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ answer: async (url, method) => { if (method === 'PATCH') { await gate; return [409, { error: 'chat is busy' }]; } return [409, { error: 'turn in flight' }]; } });
  const bulk = r.live.act('archive', { threadId: 'ask_1', on: true, quiet: true });
  await r.live.act('send', { threadId: 'ask_2', text: 'hi' });
  release(); await bulk;
  assert.deepEqual(r.toasts, ['Could not send your message: turn in flight'], 'the send\'s refusal is said; the quiet one is not');
});

test('two chats never share a pending key: a send in one does not block a send in another', async () => {
  let release; const gate = new Promise((res) => { release = res; });
  const r = rig({ answer: async (url) => { if (url.includes('ask_1')) await gate; return [202, { userMessageId: 'u' }]; } });
  const a = r.live.act('send', { threadId: 'ask_1', text: 'one' });
  const b = await r.live.act('send', { threadId: 'ask_2', text: 'two' });
  assert.equal(b.ok, true);
  release(); assert.equal((await a).ok, true);
  const again = rig({ answer: async () => { await gate; return [202, {}]; } });
  again.live.act('send', { threadId: 'ask_1', text: 'x' });
  const dup = await again.live.act('send', { threadId: 'ask_1', text: 'x' });
  assert.equal(dup.ok, false);
  assert.deepEqual(again.toasts, ['Could not send your message: it is already on its way'], 'a second send of the same chat says so');
});

test('a forced re-read keeps frames that come while it is out and applies them to the new model', async () => {
  let n = 0, release; const gate = new Promise((res) => { release = res; });
  const r = rig({ answer: async (url, method) => { if (method === 'GET') { n += 1; if (n === 2) await gate; return [200, snap()]; } return [200, {}]; } });
  await r.live.open('ask_1');
  const p = r.live.open('ask_1', { force: true });
  r.live.frame({ type: 'ask-start', threadId: 'ask_1', messageId: 'm2', userMessageId: 'm1', seq: 1, startedAt: '2026-11-12T13:01:00Z' });
  release(); await p;
  assert.ok(r.live.model('ask_1').inFlight(), 'the frame that came during the re-read is applied');
  assert.equal(r.live.state('ask_1'), 'ready');
});

test('a thread whose body is not JSON is failed, not stuck on loading', async () => {
  const r = rig({ answer: () => [200, 'not json'] });
  await r.live.open('ask_1');
  assert.equal(r.live.state('ask_1'), 'failed');
});

test('a refused Try again toasts once', async () => {
  const r = rig();
  const res = await r.live.act('retry', { threadId: 'ask_none', messageId: 'm2' });
  assert.equal(res.ok, false);
  assert.equal(r.toasts.length, 1);
  assert.match(r.toasts[0], /^Could not send your message: /);
});

test('a new chat is subscribed before its first message goes; the frames meanwhile follow its YouTurn', async () => {
  let r;
  r = rig({ answer: (url, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (url.endsWith('/messages')) { r.live.frame({ type: 'ask-start', threadId: 'ask_new', messageId: 'a1', userMessageId: 'u1', seq: 1, startedAt: '2026-11-12T13:01:00Z' }); return [202, { userMessageId: 'u1' }]; }
    return [200, {}];
  } });
  const res = await r.live.act('send', { text: 'hello', model: 'opus', effort: 'high', scope: { pinned: true, projectKey: 'web' } });
  assert.equal(res.ok, true);
  assert.deepEqual(r.sent, [{ type: 'subscribe', threadId: 'ask_new' }]);
  assert.deepEqual(r.calls.map((c) => `${c.method} ${c.url}`), ['POST /api/ask/threads', 'PATCH /api/ask/threads/ask_new', 'POST /api/ask/threads/ask_new/messages']);
  assert.deepEqual(r.calls[1].body, { scope: { pinned: true, projectKey: 'web' } }, 'the chosen project is the new chat\'s scope');
  assert.deepEqual([r.calls[2].body.model, r.calls[2].body.effort], ['opus', 'high'], 'the chosen model and effort ride the message');
  assert.ok(r.live.model('ask_new').inFlight(), 'the reply that started meanwhile is shown');
});

test('read ids open dev\'s GET in a new tab (a visible effect); a blocked tab is the refusal', async () => {
  const opened = [];
  const r = rig({ opened });
  assert.equal((await r.live.act('file', { threadId: 'ask_1', attId: 'att_1' })).ok, true);
  assert.equal((await r.live.act('artifact', { pipelineId: 'p1', name: 'plan.md', download: true })).ok, true);
  assert.equal((await r.live.act('diff', { pipelineId: 'p1', folder: true })).ok, true);
  assert.deepEqual(opened, ['/api/ask/threads/ask_1/attachments/att_1', '/api/runs/p1/artifact-raw/plan.md?download=1', '/api/runs/p1/changes/patch']);
  assert.equal(r.calls.length, 0, 'nothing is fetched and dropped');
  const blocked = rig({ open: () => null });   // a real blocked tab: window.open answers null
  assert.equal((await blocked.live.act('file', { threadId: 'ask_1', attId: 'att_1' })).ok, false);
  assert.deepEqual(blocked.toasts, ['Could not open the file: the browser blocked the new tab']);
  assert.deepEqual(Object.keys(OPENS).sort(), ['artifact', 'diff', 'file', 'patch', 'url']);
});

test('Start carries the person\'s picks: a stricter guardrail set, the target and branches reach POST /api/run', () => {
  const card = { title: 'CSV', brief: 'Add CSV', workflowId: 'wf_default', guardrailsId: 'normal', target: 'project', projectDir: '/src/web', featureBranch: 'feat/csv', sameAsSource: true };
  const [, , body] = ACTIONS.start[1]({ card, picks: { guardrailsId: 'strict', sourceBranch: 'main', featureBranch: 'feat/x', sameAsSource: false }, threadId: 't', cardId: 'c' });
  assert.equal(body.guardrailsId, 'strict');
  assert.deepEqual([body.sourceBranch, body.featureBranch, body.sameAsSource], ['main', 'feat/x', undefined]);
  assert.equal(ACTIONS.start[1]({ card, picks: { target: 'none' } })[2].noProject, true);
});

// Step 7 flow-* cases, derived: every run-state label a live chat TaskCard reaches (live-map.mjs caseOf's cases, through
// run-card's state ids) that FLOW maps is carried out by its own target; a label FLOW does not map is not offered.
const LIVE_STATES = ['paused-reason', 'question', 'failed', 'failing', 'paused-limit', 'capped', 'paused-you', 'starting', 'working', 'stopped', 'merged'];
const ANY_LABELS = ['Pause', 'Pause now', 'Resume', 'Stop', 'Archive', 'Label…'];
const reached = [...new Set([...LIVE_STATES.flatMap((st) => Object.keys(actionFlow(st, { would: (p) => p }))), ...ANY_LABELS])];
for (const label of reached) {
  test(`flow · ${label}: ${FLOW[label] ? 'its own target, with a refusal that toasts once' : 'not offered on a live card'}`, async () => {
    const opened = [], went = [], copies = [];
    const pr = 'https://github.com/acme/web/pull/7';
    const ok = rig({ opened, went, clip: { writeText: async (t) => { copies.push(t); } } });
    const args = { runId: 'run-a', pipelineId: 'p1', threadId: 'ask_1', pr, labels: ['billing'], value: 'hotfix', title: 'CSV' };
    if (!FLOW[label]) { assert.equal(ok.live.canFlow(label, args), false); return; }
    const res = await ok.live.flow(label, args);
    assert.equal(res.ok, true, label);
    const f = FLOW[label];
    if (f.act) {
      const [m, url, body] = ACTIONS[f.act][1]({ ...args, ...(f.args || {}), ...(f.act === 'task-label' ? { labels: ['billing', 'hotfix'] } : {}) });
      assert.deepEqual(ok.calls.at(-1), { url, method: m, body }, label);
      const bad = rig({ answer: () => [409, { error: 'run is busy' }] });
      const r2 = await bad.live.flow(label, args);
      assert.equal(r2.ok, false);
      assert.deepEqual(bad.toasts, [`Could not ${ACTIONS[f.act][0]}: run is busy`]);
    } else if (f.open) assert.equal(opened.length, 1);
    else if (f.url) { assert.deepEqual(opened, [pr]); assert.equal(ok.live.canFlow(label, { ...args, pr: '' }), false, 'no PR, not offered'); }
    else if (f.copy) { assert.deepEqual(copies, [pr]); assert.equal(ok.live.canFlow(label, { ...args, pr: '' }), false); }
    else if (f.go) assert.deepEqual(went, [f.go]);
  });
}

test('flow: Resume posts dev\'s pipelineId (POST /api/resume reads it), Continue without cap adds ignoreCostCap; Label adds to the run\'s labels', async () => {
  const r = rig();
  await r.live.flow('Resume now', { runId: 'run-a', pipelineId: 'p1' });
  await r.live.flow('Continue without cap', { runId: 'run-a', pipelineId: 'p1' });
  await r.live.flow('Label…', { pipelineId: 'p1', labels: ['billing'], value: 'Hotfix' });
  assert.deepEqual(r.calls.map((c) => [c.method, c.url, c.body]), [['POST', '/api/resume', { pipelineId: 'p1' }], ['POST', '/api/resume', { pipelineId: 'p1', ignoreCostCap: true }], ['PUT', '/api/runs/p1/labels', { labels: ['billing', 'hotfix'] }]]);
});

test('flow: a card\'s Create PR and View changes carry the run\'s scope (the store\'s run, by its pipeline id): a branch run\'s changes are dev\'s recovery-patch', async () => {
  const opened = [], r = rig({ opened });
  const scopes = { p1: { pipelineId: 'p1', projectKey: 'web-1a2b3c4d', projectDir: '/src/web', folder: false }, p2: { pipelineId: 'p2', projectKey: 'workspaces/wks-1', projectDir: '/src/ws', folder: false }, p3: { pipelineId: 'p3', projectKey: 'docs-0a0b0c0d', projectDir: '/src/docs', folder: true } };
  r.live.runOf = (id) => scopes[id] || { pipelineId: id };
  await r.live.flow('Create PR', { runId: 'run-a', pipelineId: 'p1', title: 'CSV' });
  assert.deepEqual(r.calls.at(-1), { url: '/api/pr', method: 'POST', body: { id: 'p1', title: 'CSV', projectKey: 'web-1a2b3c4d' } });
  for (const pid of ['p1', 'p2', 'p3']) assert.equal((await r.live.flow('View changes', { runId: 'run-a', pipelineId: pid })).ok, true);
  await r.live.flow('Download patch', { runId: 'run-a', pipelineId: 'p1' });
  assert.deepEqual(opened, ['/api/runs/p1/recovery-patch?projectKey=web-1a2b3c4d', '/api/runs/p2/recovery-patch?workspaceId=wks-1', '/api/runs/p3/changes/patch', '/api/runs/p1/recovery-patch?projectKey=web-1a2b3c4d']);
});

test('a verb card posts dev\'s verb body (changes, route); the delete-all action is gone', async () => {
  const r = rig();
  await r.live.act('card-verb', { threadId: 'ask_1', cardId: 'card_r', body: { verb: 'add', where: 'next' } });
  assert.deepEqual(r.calls.at(-1), { url: '/api/ask/threads/ask_1/cards/card_r', method: 'POST', body: { verb: 'add', where: 'next' } });
  assert.equal(ACTIONS['delete-all'], undefined);
});

// R-qa-10, derived from the table: every route id refused with a 409 (a read id with a 500) toasts once, `Could not ACTION: REASON` with its own
// words, and writes nothing (the open thread stays as it was); `apply`'s read refused with a 500 does the same.
const ARGS = { threadId: 'ask_1', cardId: 'card_1', runId: 'run-a', pipelineId: 'pa', id: 'q1', payload: {}, text: 'x', title: 'T', on: true, groupId: 'g1', threadIds: ['ask_1'], name: 'n', token: 't', sessionId: 's1', attId: 'a1', worktreeId: 'w1', scope: { pinned: false }, model: 'opus', effort: 'high', engine: 'codex', pins: [], labels: [], card: {}, picks: {}, mcpOff: {}, body: { verb: 'start' }, watch: true };
for (const id of Object.keys(ACTIONS)) {
  test(`refused · ${id}: one toast with its words, nothing written`, async () => {
    const r = rig({ answer: (url, method) => (method === 'GET' && url === '/api/ask/threads/ask_1' ? [200, snap()] : [method === 'GET' ? 500 : 409, { error: 'not now' }]) });   // a read id is refused with a 500
    await r.live.open('ask_1');
    const before = JSON.stringify(r.live.turns('ask_1'));
    const res = await r.live.act(id, ARGS);
    assert.equal(res.ok, false);
    assert.deepEqual(r.toasts, [`Could not ${ACTIONS[id][0]}: not now`]);
    assert.equal(JSON.stringify(r.live.turns('ask_1')), before);
  });
}
test('refused · apply: a 500 on its read toasts once and posts nothing', async () => {
  const r = rig({ answer: () => [500, { error: 'boom' }] });
  const res = await r.live.act('apply', { pipelineId: 'pa' });
  assert.equal(res.ok, false);
  assert.deepEqual(r.toasts, ['Could not apply the files: boom']);
  assert.deepEqual(r.calls.map((c) => c.method), ['GET']);
});

test('the plan answers are the ones dev\'s validatePlanAnswer accepts: approve, revise (with feedback) and stop', async () => {
  const { validatePlanAnswer } = await import('../src/core/shape/run.mjs');
  for (const id of ['plan-approve', 'plan-changes', 'plan-stop']) {
    const [, , body] = ACTIONS[id][1]({ runId: 'r', id: 'q1', feedback: 'fewer slices' });
    const { id: _q, ...answer } = body;
    assert.equal(validatePlanAnswer(answer, { revisable: true }).ok, true, id);
  }
});

test('openTab: opens without noopener (which always answers null) and cuts the opener; null only when the browser blocked it', () => {
  const was = globalThis.open, seen = [];
  try {
    const tab = { opener: {} };
    globalThis.open = (...a) => { seen.push(a); return tab; };
    assert.equal(openTab('/api/x'), tab);
    assert.deepEqual(seen, [['/api/x', '_blank']]);
    assert.equal(tab.opener, null);
    globalThis.open = () => null;
    assert.equal(openTab('/api/x'), null);
  } finally { globalThis.open = was; }
});

test('refused · task-archive: dev answers 200 with the run in `skipped` and nothing done; that is the refusal, toasted once', async () => {
  const r = rig({ answer: () => [200, { ok: true, action: 'archive', done: [], cancelled: [], skipped: [{ id: 'pa', title: 'CSV', reason: 'it is still running' }] }] });
  const res = await r.live.act('task-archive', { pipelineId: 'pa' });
  assert.equal(res.ok, false);
  assert.deepEqual(r.toasts, ['Could not archive the task: it is still running']);
  const ok = rig({ answer: () => [200, { ok: true, done: [{ id: 'pa' }], cancelled: [], skipped: [] }] });
  assert.equal((await ok.live.act('task-archive', { pipelineId: 'pa' })).ok, true);
  assert.deepEqual(ok.toasts, []);
});

test('a forced re-read that fails keeps the open conversation ready; a first read that fails is failed', async () => {
  let n = 0;
  const r = rig({ answer: (url, method) => (method === 'GET' ? (++n === 1 ? [200, snap()] : [500, { error: 'boom' }]) : [200, {}]) });
  await r.live.open('ask_1');
  const before = JSON.stringify(r.live.turns('ask_1'));
  await r.live.open('ask_1', { force: true });
  assert.equal(r.live.state('ask_1'), 'ready');
  assert.equal(JSON.stringify(r.live.turns('ask_1')), before);
});

test('reconnect while a read is out: only the newest GET writes the model and drains the buffer', async () => {
  const gates = [];
  const r = rig({ answer: (url, method) => (method === 'GET' ? new Promise((res) => gates.push(res)) : [200, {}]) });
  const first = r.live.open('ask_1');
  r.live.reconnect();
  assert.equal(gates.length, 2, 'the reconnect read is its own GET');
  const start = { type: 'ask-start', threadId: 'ask_1', messageId: 'm2', userMessageId: 'm1', seq: 1, startedAt: '2026-11-12T13:01:00Z' };
  r.live.frame(start);
  gates[0]([200, snap({ messages: [] })]);   // the older read lands first: it is stale and writes nothing
  await tick();
  assert.equal(r.live.state('ask_1'), 'loading');
  gates[1]([200, snap()]);
  await first; await tick();
  assert.equal(r.live.state('ask_1'), 'ready');
  assert.deepEqual(r.live.turns('ask_1').map((x) => x.t)[0], 'you');
  assert.ok(r.live.model('ask_1').inFlight(), 'the buffered frame was applied by the newest read');
});

test('panel.answer-refs: refs are confirmed by dev\'s POST /api/ask/refs/resolve, batched, once each; a failed call leaves them unconfirmed', async () => {
  const r = rig({ answer: (url, method, n) => (url === '/api/ask/refs/resolve' ? [200, { refs: { 'run:0a1b2c3d': { ok: true, kind: 'run', id: '0a1b2c3d', runId: 'run-a', title: 'Ask me' }, 'chat:ask_0123abcd': { ok: false } } }] : [200, {}]) });
  assert.equal(r.live.ref('run:0a1b2c3d', 'ask_1'), null, 'not known yet');
  assert.equal(r.live.ref('chat:ask_0123abcd', 'ask_1'), null);
  r.live.ref('run:0a1b2c3d', 'ask_1');
  await tick();
  assert.deepEqual(r.calls.map((c) => [c.method, c.url, c.body]), [['POST', '/api/ask/refs/resolve', { refs: ['run:0a1b2c3d', 'chat:ask_0123abcd'] }]]);
  assert.equal(r.live.ref('run:0a1b2c3d').title, 'Ask me');
  assert.equal(r.live.ref('chat:ask_0123abcd').ok, false);
  assert.ok(r.changes.some(([id]) => id === 'ask_1'), 'the chat repaints');
  const bad = rig({ answer: () => [500, { error: 'boom' }] });
  bad.live.ref('run:0a1b2c3d'); await tick();
  assert.equal(bad.live.ref('run:0a1b2c3d').ok, false);
  assert.equal(bad.calls.length, 1, 'never asked again in a loop');
});

test('url: a PR chip opens its https address in a new tab; anything else is refused', async () => {
  const opened = [];
  const r = rig({ opened });
  assert.equal((await r.live.act('url', { url: 'https://github.com/a/b/pull/1' })).ok, true);
  assert.deepEqual(opened, ['https://github.com/a/b/pull/1']);
  assert.equal((await r.live.act('url', { url: 'javascript:alert(1)' })).ok, false);
  assert.equal(opened.length, 1);
});

test('Delete all chats (Settings): dev\'s counts, then dev\'s DELETE; a refusal toasts once; never an act() id', async () => {
  const r = rig({ answer: (url, method) => (url === '/api/ask/history' ? [200, { threads: 2, worktrees: 0, attachments: 0, inFlight: 0 }] : method === 'DELETE' ? [500, { error: 'disk full' }] : [200, {}]) });
  assert.equal((await r.live.chatHistory()).data.threads, 2);
  const res = await r.live.deleteAllChats();
  assert.equal(res.ok, false);
  assert.deepEqual(r.calls.map((c) => [c.method, c.url]), [['GET', '/api/ask/history'], ['DELETE', '/api/ask/threads']]);
  assert.deepEqual(r.toasts, ['Could not delete the chats: disk full']);
  assert.equal(ACTIONS['delete-all'], undefined);
  assert.ok(!Object.values(ACTIONS).some((a) => { try { return a[1]({})[1] === '/api/ask/threads' && a[1]({})[0] === 'DELETE'; } catch { return false; } }), 'no act() id reaches it');
});

test('D12 (b): a command\'s end is read from dev\'s block once; ended or gone (404) it is done with no Stop; an ask-command frame updates it', async () => {
  const cmd = (seq) => ({ kind: 'card', id: `c${seq}`, state: 'command', card: { type: 'command', blockId: `t-1:${seq}`, sessionId: 's1', seq, command: `ls ${seq}`, summary: `List ${seq}`, folder: '/src' } });
  const msg = { id: 'm9', role: 'assistant', status: 'done', text: '', createdAt: '2026-11-14T10:00:00Z', blocks: [cmd(1)] };
  const msg2 = { id: 'm10', role: 'assistant', status: 'done', text: 'and', createdAt: '2026-11-14T10:01:00Z', blocks: [cmd(2)] };
  const r = rig({ answer: (url) => (url === '/api/ask/threads/ask_1' ? [200, snap({ messages: [msg, msg2] })] : url.endsWith('/commands/t-1%3A1') ? [200, { blockId: 't-1:1', sessionId: 's1', seq: 1, command: 'ls 1', status: 'exited', exitCode: 0, startedAt: 1, endedAt: 2, durationMs: 1, stoppedBy: null, runBy: 'agent', tail: '', truncated: false }] : url.endsWith('/commands/t-1%3A3') ? [500, { error: 'busy' }] : [404, { error: 'block not found' }]) });
  await r.live.open('ask_1');
  assert.deepEqual(r.live.turns('ask_1').filter((x) => x.t === 'cmd').map((x) => !!x.done), [false, false], 'unknown until read');
  await tick();
  assert.deepEqual(r.live.turns('ask_1').filter((x) => x.t === 'cmd').map((x) => !!x.done), [true, true]);
  assert.equal(r.calls.filter((c) => c.url.includes('/commands/')).length, 2, 'read once each');
  r.live.frame({ type: 'ask-command', threadId: 'ask_1', command: { blockId: 't-1:1', status: 'running', exitCode: null } });
  assert.equal(r.live.turns('ask_1').find((x) => x.id === 'c1').done, undefined, 'a frame says it runs again');
});

test('D12 (b): a refused command read (neither ok nor 404) is not kept: the next paint asks again', async () => {
  const card = { kind: 'card', id: 'c3', state: 'command', card: { type: 'command', blockId: 't-1:3', sessionId: 's1', seq: 3, command: 'ls 3', summary: 'List 3', folder: '/src' } };
  const msg = { id: 'm11', role: 'assistant', status: 'done', text: '', createdAt: '2026-11-14T10:00:00Z', blocks: [card] };
  const r = rig({ answer: (url) => (url === '/api/ask/threads/ask_1' ? [200, snap({ messages: [msg] })] : [500, { error: 'busy' }]) });
  await r.live.open('ask_1');
  r.live.turns('ask_1');
  await tick();
  assert.equal(r.live.turns('ask_1').find((x) => x.id === 'c3').done, undefined, 'unknown, drawn as dev stored it');
  await tick();
  assert.equal(r.calls.filter((c) => c.url.includes('/commands/')).length, 2, 'asked again after the refusal');
});

test('card-apply saves a workflow or workflow-build card (dev answers 400 to applied) and applies every other card', () => {
  const body = (a) => ACTIONS['card-apply'][1](a)[2];
  assert.deepEqual(body({ threadId: 'ask_1', cardId: 'c1', cardType: 'workflow' }), { state: 'saved' });
  assert.deepEqual(body({ threadId: 'ask_1', cardId: 'c1', cardType: 'workflow-build' }), { state: 'saved' });
  assert.deepEqual(body({ threadId: 'ask_1', cardId: 'c1', cardType: 'model' }), { state: 'applied' });
  assert.deepEqual(body({ threadId: 'ask_1', cardId: 'c1', cardType: 'model', scope: 'project' }), { state: 'applied', scope: 'project' });
});

test('a created PR asks for the PR states again (afterPr), so its card reads the open PR without a reload; a refused one does not', async () => {
  let asked = 0;
  const mk = (status) => startChatLive({ fetch: async () => ({ ok: status < 300, status, json: async () => (status < 300 ? { url: 'https://github.com/o/r/pull/1' } : { error: 'no remote' }) }), now: () => 0, afterPr: () => { asked++; } });
  assert.equal((await mk(200).act('pr', { pipelineId: 'p1', projectKey: 'k' })).ok, true);
  assert.equal(asked, 1);
  assert.equal((await mk(409).act('pr', { pipelineId: 'p1', projectKey: 'k' })).ok, false);
  assert.equal(asked, 1);
});

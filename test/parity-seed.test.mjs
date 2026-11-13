// test/parity-seed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seed, finishRun, SEED_PROMPT, SEED_CHAT_TEXT, PLAN_ASK_KIND } from '../tools/parity/seed.mjs';
import { PLAN_ASK_KIND as SRC_PLAN_ASK_KIND } from '../src/core/shape/run.mjs';

function fakeServer() {
  const calls = []; const runs = new Map();
  let n = 0;
  const json = (b, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname; const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push(`${method} ${path}`);
    if (path === '/api/projects') return json({ projects: [{ key: 'other', name: 'x', path: '/x' }, { key: 'k1', name: 'sandbox', path: '/private/p' }] });
    if (path === '/api/ask/threads') return json({ thread: { id: 't1' } }, 201);
    if (path === '/api/ask/models') return json({ models: [{ id: 'm1', efforts: ['medium', 'high'] }] });
    if (path === '/api/ask/threads/t1/messages') { assert.deepEqual(body, { text: SEED_CHAT_TEXT, model: 'm1', effort: 'medium' }); return json({ assistantMessageId: 'a1' }, 202); }
    if (path === '/api/ask/threads/t1') return json({ messages: [{ role: 'user' }, { role: 'assistant' }], inFlight: null });
    if (path === '/api/run') { n += 1; const id = `r${n}`; runs.set(id, { status: 'running', pq: { id: 'clarify-1', kind: 'questions' }, pid: `p${n}` }); return json({ runId: id }); }
    if (path === '/api/answer') {
      const r = runs.get(body.runId);
      if (r.pq.kind === 'workflow') { assert.deepEqual(body.payload, { decision: 'accept', name: 'Auto plan', nodes: {} }); r.pq = { id: 'clarify-1', kind: 'clarify' }; return json({ ok: true }); }
      assert.deepEqual(body.payload, { answers: [] }); r.pq = null; r.status = 'done'; return json({ ok: true });
    }
    const m = /^\/api\/ask\/runs\/(.+)$/.exec(path);
    if (m) { const r = runs.get(m[1]); return json({ state: { id: r.pid, status: r.status }, live: { runId: m[1], status: r.status } }); }
    return json({ ok: true });
  };
  const helloImpl = async () => [...runs].map(([runId, r]) => ({ runId, status: r.status, pendingQuestion: r.pq }));
  return { calls, fetchImpl, helloImpl, runs };
}

test('seed: settings, onboarding, project, thread, one finished run and one run held at clarify', async () => {
  const f = fakeServer();
  const s = await seed({ base: 'http://x', projectPath: '/p' }, { fetchImpl: f.fetchImpl, helloImpl: f.helloImpl, pollMs: 1 });
  assert.deepEqual(s, { projectKey: 'k1', projectPath: '/p', runId: 'r1', pipelineId: 'p1', threadId: 't1', heldRunId: 'r2', heldPipelineId: 'p2' });
  assert.deepEqual(f.calls.slice(0, 4), ['POST /api/settings', 'POST /api/onboarding', 'POST /api/worca-level/ack', 'POST /api/projects']);
  assert.ok(f.calls.includes('POST /api/ask/threads/t1/messages'), 'the thread gets one message, so #chat/t1 renders a thread');
  assert.equal(f.runs.get('r2').status, 'running');
  assert.equal(f.runs.get('r2').pq.kind, 'questions');
  assert.equal(typeof SEED_PROMPT, 'string');
});

test('finishRun answers a planner clarify ask (kind clarify) like a questions ask', async () => {
  const f = fakeServer();
  f.runs.set('rc', { status: 'running', pq: { id: 'c', kind: 'clarify' }, pid: 'pc' });
  assert.deepEqual(await finishRun({ base: 'http://x' }, 'rc', { fetchImpl: f.fetchImpl, helloImpl: f.helloImpl, pollMs: 1 }),
    { status: 'done', pipelineId: 'pc' });
});

test('finishRun accepts an Auto workflow proposal (New run defaults to Auto), then answers its clarify stop', async () => {
  const f = fakeServer();
  f.runs.set('ra', { status: 'running', pq: { id: 'auto-1', kind: 'workflow', workflow: { name: 'Auto plan' } }, pid: 'pa' });
  assert.deepEqual(await finishRun({ base: 'http://x' }, 'ra', { fetchImpl: f.fetchImpl, helloImpl: f.helloImpl, pollMs: 1 }),
    { status: 'done', pipelineId: 'pa' });
});

test('finishRun throws on an ask kind it does not know', async () => {
  const f = fakeServer();
  f.runs.set('rx', { status: 'running', pq: { id: 'a', kind: 'form' }, pid: 'px' });
  await assert.rejects(finishRun({ base: 'http://x' }, 'rx', { fetchImpl: f.fetchImpl, helloImpl: f.helloImpl, pollMs: 1 }), /ask kind form/);
});

test('a failed seed call names method, path and status only (no response body)', async () => {
  const fetchImpl = async () => new Response('secret-body', { status: 500 });
  await assert.rejects(seed({ base: 'http://x', projectPath: '/p' }, { fetchImpl, helloImpl: async () => [] }),
    (e) => /POST \/api\/settings -> 500/.test(e.message) && !e.message.includes('secret-body'));
});

test('the seed\'s plan ask kind matches src, and the seed imports nothing from src/ (R-arch-3)', () => {
  assert.equal(PLAN_ASK_KIND, SRC_PLAN_ASK_KIND);
  assert.doesNotMatch(readFileSync(new URL('../tools/parity/seed.mjs', import.meta.url), 'utf8'), /from '[^']*\/src\//);
});

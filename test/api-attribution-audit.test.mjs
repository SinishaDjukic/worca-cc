// test/api-attribution-audit.test.mjs — attribution step 3 through the real server, with a
// trusted identity header standing in for a shared sign-in (identity.mjs): who did each human
// action lands in the run's audit timeline (text + the pipeline_events.actor column), who
// answered a question is stored with the answer, the audit markdown names the starter, and
// Ask frames reach only their thread owner's sockets. Mock runs, git/gh faked, no network.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);

const H = 'X-Forwarded-Email';
const as = (who) => (who ? { [H]: who } : {});
let homeDir, prevHome, srv, base, runs, mod, readPipeline, getDb, gitInfo;
const req = async (method, p, body, who) => {
  const r = await fetch(`${base}${p}`, { method, headers: { 'Content-Type': 'application/json', ...as(who) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
};
async function until(fn, ms = 30000, what = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`timed out waiting for ${what}`);
}
const events = (pid) => getDb().prepare('SELECT text, actor FROM pipeline_events WHERE pipeline_id = ? ORDER BY id').all(pid);
const eventWith = (pid, re) => events(pid).find((e) => re.test(e.text));

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-attrib-audit-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';
  process.env.WORCA_IDENTITY_HEADER = H;
  mod = await import('../ui/server.mjs');
  ({ runs } = mod);
  ({ readPipeline } = await import('../src/core/artifacts.mjs'));
  ({ getDb } = await import('../src/core/db.mjs'));
  ({ _testing: gitInfo } = await import('../src/core/git-info.mjs'));
  srv = http.createServer(mod.app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  gitInfo?.reset();
  for (const e of runs.values()) { try { e.orch?.stop?.(); } catch { /* over */ } }
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  delete process.env.WORCA_IDENTITY_HEADER;
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

/** Answer whatever the run is waiting on, as `who`. */
async function answerPending(entry, who) {
  const pq = await until(() => entry.pendingQuestion, 30000, 'a pending question');
  let payload;
  if (pq.kind === 'workflow') payload = { decision: 'accept' };
  else if (pq.kind === 'gate') payload = { decision: 'continue' };
  else payload = { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: (q.options && q.options[0]) || 'yes' })) };
  const r = await req('POST', '/api/answer', { runId: entry.id, id: pq.id, payload }, who);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return pq;
}

test('the audit timeline names who answered, paused, resumed (past the cost limit) and stopped; the actor column always', async () => {
  const dir = gitDir('attrib-audit');
  const { addProject } = await import('../src/core/projects.mjs');
  await addProject({ name: `attrib-audit-${Date.now()}`, path: dir });
  const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true }, 'ada@example.com');
  assert.equal(start.status, 200, JSON.stringify(start.body));
  const e = runs.get(start.body.runId);
  const pid = (await until(() => e.orch?.state?.id, 30000, 'a pipeline row')) && e.orch.state.id;

  // The markdown export names the starter in its header.
  const md = (await readPipeline(dir, pid)).auditMarkdown;
  assert.match(md, /- \*\*started by\*\*: ada@example\.com\n/);

  const pq = await answerPending(e, 'grace@example.com');
  await until(() => events(pid).some((x) => x.actor === 'grace@example.com'), 30000, 'the answer audit line').catch((err) => {
    throw new Error(`${err.message}: kind=${pq.kind} id=${pq.id} events=${JSON.stringify(events(pid).slice(-6))}`);
  });
  const ans = events(pid).find((x) => x.actor === 'grace@example.com');
  assert.match(ans.text, /by grace@example\.com/, `the line names the person: ${ans.text}`);
  if (pq.kind === 'questions' || pq.kind === 'clarify' || pq.kind === 'form') {
    const { readPipelineExtras } = await import('../src/core/artifacts.mjs');
    await until(() => {
      const x = readPipelineExtras(pid);
      return [x.clarify, ...x.stepQuestions].some((r) => r && r.answeredBy === 'grace@example.com');
    }, 30000, 'answeredBy stored with the answer');
  }

  await until(() => runs.get(start.body.runId)?.status === 'running', 30000, 'running again');
  assert.equal((await req('POST', '/api/pause', { runId: start.body.runId }, 'linus@example.com')).status, 200);
  await until(() => eventWith(pid, /^Pipeline \*\*paused\*\* by linus@example\.com\.$/), 30000, 'the pause line');
  assert.equal(eventWith(pid, /^Pipeline \*\*paused\*\*/).actor, 'linus@example.com');

  const res = await req('POST', '/api/resume', { pipelineId: pid, ignoreCostCap: true }, 'ada@example.com');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(eventWith(pid, /cost limit override set/).text, 'Pipeline cost limit override set by ada@example.com.');
  await until(() => eventWith(pid, /^Pipeline \*\*resumed\*\* .* by ada@example\.com\.$/), 30000, 'the resume line');

  const e2 = runs.get(res.body.runId);
  await until(() => ['running', 'paused'].includes(e2.status), 30000, 'the resumed run');
  assert.equal((await req('POST', '/api/stop', { runId: res.body.runId }, 'grace@example.com')).status, 200);
  await until(() => eventWith(pid, /^Pipeline \*\*stopped\*\* by grace@example\.com\.$/), 30000, 'the stop line');
});

test('a local action keeps the old wording and still stores its actor', async () => {
  const dir = gitDir('attrib-audit-local');
  const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'x', mock: true, humanInLoop: false });
  const e = runs.get(start.body.runId);
  const pid = await until(() => e.orch?.state?.id, 30000, 'a pipeline row');
  await until(() => runs.get(start.body.runId)?.status === 'running' || e.pendingQuestion, 30000, 'running');
  assert.equal((await req('POST', '/api/stop', { runId: start.body.runId })).status, 200);
  const line = await until(() => eventWith(pid, /^Pipeline \*\*stopped\*\*/), 30000, 'the stop line');
  assert.equal(line.text, 'Pipeline **stopped**.');
  assert.equal(line.actor, 'local');
  assert.doesNotMatch((await readPipeline(dir, pid)).auditMarkdown, /started by/, 'no "started by" for local');
});

test('PR created and run archived are audited with who did it', async () => {
  const dir = gitDir('attrib-audit-pr');
  const start = await req('POST', '/api/run', { projectDir: dir, prompt: 'z', mock: true }, 'ada@example.com');
  const e = runs.get(start.body.runId);
  const pid = await until(() => (e.orch?.state?.id && e.orch?.state?.branch?.feature ? e.orch.state.id : null), 30000, 'a branch');
  await until(async () => { const st = (await readPipeline(dir, pid))?.state; return st?.branch?.feature ? st : null; }, 30000, 'the persisted branch');
  if (!['stopped', 'done', 'error'].includes(String(e.status))) await req('POST', '/api/stop', { runId: start.body.runId }, 'ada@example.com');
  await until(() => ['stopped', 'done', 'error'].includes(String(runs.get(start.body.runId)?.status)), 30000, 'settled');
  gitInfo.setRunner(async (cmd, args) => {
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'create') return { ok: true, stdout: 'https://github.com/acme/api/pull/7\n', stderr: '', code: 0 };
    if (cmd === 'git' && args[0] === 'remote' && args[1] === '-v') return { ok: true, stdout: 'origin\thttps://github.com/acme/api.git (fetch)\norigin\thttps://github.com/acme/api.git (push)\n', stderr: '', code: 0 };
    return { ok: true, stdout: '', stderr: '', code: 0 };
  });
  try {
    const pr = await req('POST', '/api/pr', { id: pid, projectDir: dir }, 'grace@example.com');
    assert.equal(pr.status, 200, JSON.stringify(pr.body));
  } finally { gitInfo.reset(); }
  const prLine = eventWith(pid, /^Pull request opened/);
  assert.equal(prLine.text, 'Pull request opened by grace@example.com: https://github.com/acme/api/pull/7');
  assert.equal(prLine.actor, 'grace@example.com');

  await until(async () => ['stopped', 'done', 'error'].includes(String((await readPipeline(dir, pid))?.state?.status)), 30000, 'the persisted terminal status');
  const del = await req('DELETE', `/api/runs/${pid}?projectDir=${encodeURIComponent(dir)}`, null, 'linus@example.com');
  assert.equal(del.status, 200, JSON.stringify(del.body));
  assert.equal(eventWith(pid, /^Run archived/).text, 'Run archived by linus@example.com.');
});

test('Ask frames reach only the thread owner on a shared sign-in; others and the hello never see them', async () => {
  const t = await req('POST', '/api/ask/threads', {}, 'ada@example.com');
  assert.ok(t.status === 200 || t.status === 201, JSON.stringify(t.body));
  const threadId = t.body.thread?.id || t.body.id;
  // The WebSocket endpoint lives on the module's own server (srv is a bare app listener).
  if (!mod.server.listening) await new Promise((r) => mod.server.listen(0, '127.0.0.1', r));
  const wsPort = mod.server.address().port;
  const open = (who) => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/ws`, { headers: { ...as(who), host: '127.0.0.1', origin: 'http://127.0.0.1' } });
    const got = [];
    ws.on('message', (d) => got.push(JSON.parse(String(d))));
    ws.on('open', () => resolve({ ws, got }));
    ws.on('error', reject);
  });
  const ada = await open('ada@example.com');
  const grace = await open('grace@example.com');
  await new Promise((r) => setTimeout(r, 100));
  mod._testing.broadcast({ type: 'ask-message', threadId, message: { id: 'm1', text: 'private' } });
  mod._testing.broadcast({ type: 'projects-changed', action: 'x' });
  await new Promise((r) => setTimeout(r, 200));
  const askFor = (c) => c.got.filter((f) => f.type === 'ask-message' && f.threadId === threadId);
  assert.equal(askFor(ada).length, 1, 'the owner gets it');
  assert.equal(askFor(grace).length, 0, 'someone else does not');
  assert.ok(grace.got.some((f) => f.type === 'projects-changed'), 'non-Ask frames still reach everyone');
  ada.ws.close(); grace.ws.close();
  await new Promise((r) => mod.server.close(r));
});

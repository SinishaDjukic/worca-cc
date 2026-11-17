// tools/parity/seed.mjs — #919 slice 2: seed a target through its public API only (works for tree, package, docker).
export const SEED_PROMPT = 'parity: add a hello file';
export const SEED_CHAT_TEXT = 'parity: say hi';
const SETTLED = new Set(['done', 'stopped', 'error', 'interrupted']);
// The Shaper's plan stop (PLAN_ASK_KIND in src/core/shape/run.mjs). Kept local: the seed imports nothing from src/
// (R-arch-3); test/parity-seed.test.mjs pins it to src.
export const PLAN_ASK_KIND = 'plan';
const AUTO_ASK_KIND = 'workflow';      // the Auto workflow's proposal (_autoAsk in src/core/orchestrator.mjs); New run defaults to Auto
// A clarify stop: the planner's `clarify` and an agent's `questions` (src/core/orchestrator.mjs), answered alike
// (src/core/run-harness.mjs).
const CLARIFY_ASK_KINDS = new Set(['clarify', 'questions']);

async function call(t, fetchImpl, path, body, method = body === undefined ? 'GET' : 'POST') {
  const r = await fetchImpl(`${t.base}${path}`, { method, headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!r.ok) throw new Error(`seed: ${method} ${path} -> ${r.status}`);   // never the body (R-sec-4)
  return r.json();
}

/** The live runs from one WebSocket `hello` frame (pendingQuestion is only sent there, ui/server.mjs:1059). */
export function helloRuns(t, { ms = 10_000 } = {}) {
  return new Promise((ok, fail) => {
    const ws = new WebSocket(`${t.base.replace(/^http/, 'ws')}/ws`);
    const timer = setTimeout(() => { ws.close(); fail(new Error('seed: no hello frame on /ws')); }, ms);
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.type === 'hello') { clearTimeout(timer); ws.close(); ok(m.runs || []); }
    };
    ws.onerror = () => { clearTimeout(timer); fail(new Error('seed: /ws refused the connection')); };
  });
}

async function runState(t, fetchImpl, runId) {
  const r = await fetchImpl(`${t.base}/api/ask/runs/${encodeURIComponent(runId)}`);
  if (r.status === 404) return null;                                     // no pipeline row yet
  if (!r.ok) throw new Error(`seed: GET /api/ask/runs/:id -> ${r.status}`);
  const j = await r.json();
  return { status: j.live?.status || j.state?.status, pipelineId: j.state?.id };
}

/** Drive a mock run to a settled state: accept an Auto proposal, answer each clarify stop with the default answers,
 *  approve each plan stop. */
export async function finishRun(t, runId, { fetchImpl = fetch, helloImpl = helloRuns, ms = 120_000, pollMs = 200 } = {}) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const st = await runState(t, fetchImpl, runId);
    if (st && SETTLED.has(st.status)) return st;
    const q = (await helloImpl(t)).find((r) => r.runId === runId)?.pendingQuestion;
    if (q?.kind === PLAN_ASK_KIND) await call(t, fetchImpl, `/api/runs/${encodeURIComponent(runId)}/answer`, { id: q.id, decision: 'approve' });
    else if (q?.kind === AUTO_ASK_KIND) {   // accepted as the harness's own auto answer does (src/core/run-harness.mjs:734)
      await call(t, fetchImpl, '/api/answer', { runId, id: q.id, payload: { decision: 'accept', name: q.workflow?.name, nodes: {} } });
    } else if (CLARIFY_ASK_KINDS.has(q?.kind)) await call(t, fetchImpl, '/api/answer', { runId, id: q.id, payload: { answers: [] } });
    else if (q) throw new Error(`seed: run stopped on ask kind ${q.kind}`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`seed: run did not finish within ${ms} ms`);
}

/** Wait until a run is parked on its clarify stop, and leave it there (the live-run page, D5). */
export async function holdRun(t, runId, { helloImpl = helloRuns, ms = 60_000, pollMs = 200 } = {}) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    const r = (await helloImpl(t)).find((x) => x.runId === runId);
    if (CLARIFY_ASK_KINDS.has(r?.pendingQuestion?.kind)) return;
    await new Promise((res) => setTimeout(res, pollMs));
  }
  throw new Error(`seed: held run never reached its clarify stop within ${ms} ms`);
}

/** One chat turn on a thread (a thread with no message renders as Chat home), waited out until the mock reply lands. */
async function chatTurn(t, fetchImpl, threadId, { ms = 60_000, pollMs = 200 } = {}) {
  const { models } = await call(t, fetchImpl, '/api/ask/models');
  const path = `/api/ask/threads/${encodeURIComponent(threadId)}`;
  await call(t, fetchImpl, `${path}/messages`, { text: SEED_CHAT_TEXT, model: models[0].id, effort: models[0].efforts?.[0] });
  for (const end = Date.now() + ms; Date.now() < end;) {
    const th = await call(t, fetchImpl, path);
    if (!th.inFlight && th.messages.some((m) => m.role === 'assistant')) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`seed: the chat turn did not finish within ${ms} ms`);
}

export async function seed(t, { fetchImpl = fetch, helloImpl = helloRuns, pollMs } = {}) {
  await call(t, fetchImpl, '/api/settings', { uiLevel: 'expert', theme: 'light' });
  await call(t, fetchImpl, '/api/onboarding', { welcomeSeen: true });
  await call(t, fetchImpl, '/api/worca-level/ack', { what: 'welcome' });   // the level welcome is a boot-time modal too
  const { projects } = await call(t, fetchImpl, '/api/projects', { name: 'sandbox', path: t.projectPath });
  const project = projects.find((p) => p.name === 'sandbox');   // by name: macOS realpaths /var → /private/var
  const { thread } = await call(t, fetchImpl, '/api/ask/threads', { title: 'parity thread' });
  await chatTurn(t, fetchImpl, thread.id, pollMs ? { pollMs } : {});
  const { runId } = await call(t, fetchImpl, '/api/run', { projectDir: t.projectPath, prompt: SEED_PROMPT });
  const run = await finishRun(t, runId, { fetchImpl, helloImpl, ...(pollMs ? { pollMs } : {}) });
  if (run.status !== 'done') throw new Error(`seed: the mock run ended ${run.status}`);
  const { runId: heldRunId } = await call(t, fetchImpl, '/api/run', { projectDir: t.projectPath, prompt: `${SEED_PROMPT} (held)` });
  await holdRun(t, heldRunId, { helloImpl, ...(pollMs ? { pollMs } : {}) });
  const held = await runState(t, fetchImpl, heldRunId);   // its pipeline id names its branch: masked like the others
  return { projectKey: project.key, projectPath: t.projectPath, runId, pipelineId: run.pipelineId, threadId: thread.id, heldRunId,
    heldPipelineId: held?.pipelineId };
}

#!/usr/bin/env node
// tools/stillhet-seed-gate.mjs — leaves one mock run held at its review gate (`kind: 'gate'`) on a RUNNING mock Worca, so the
// gate walks O1 and O4 have a real question to answer. The run is Lean's (wf_lean_build) with a per-run loop budget of 1 on
// its review wire (w9): the plain mock reviewer returns one major finding on cycle 1, so the first blocking review holds at
// `gate-w9-1` and asks the person. Nothing in src/ or ui/ is changed: the run starts through POST /api/run, its Clarify
// questions and the gate are answered through dev's own POST /api/answer {runId, id, payload}.
//
// Run: node tools/stillhet-seed-gate.mjs http://127.0.0.1:4504 [--target D] [--project-root DIR]
//      (a mock instance from tools/stillhet-gate-instances.mjs; port 4317 and a non-mock server are refused)
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SETTLED = new Set(['done', 'stopped', 'error', 'interrupted']);

export const SEEDED_GATE = Object.freeze({
  workflowId: 'wf_lean_build',
  overlay: Object.freeze({ wires: Object.freeze({ w9: Object.freeze({ maxCycles: 1 }) }) }),
  prompt: 'Stillhet gate seed: a run held at its review gate',
  gateId: 'gate-w9-1',
});

export class SeedGateError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const refuse = (code, message) => { throw new SeedGateError(code, message); };

/** The seed's target: refuses the owner's port and any host that is not this machine. */
export function assertSeedTarget(base) {
  let url;
  try { url = new URL(base); } catch { refuse('bad-url', `${base} is not a URL`); }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (port === 4317) refuse('owner-port', 'port 4317 is the owner\'s live instance; seed a gate instance instead');
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(url.hostname)) refuse('not-local', `${url.hostname} is not this machine; the seed runs only against a local instance`);
  return url;
}

/** The server's WS `hello` frame (it carries serverMock and every live run's pendingQuestion). */
export function readHello(base, { WebSocketImpl = globalThis.WebSocket, timeoutMs = 5000 } = {}) {
  const url = new URL(base);
  const ws = new WebSocketImpl(`${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}/ws`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close(); } catch { /* closed */ } reject(new SeedGateError('no-hello', `no hello from ${base} within ${timeoutMs} ms`)); }, timeoutMs);
    ws.addEventListener('message', (ev) => {
      let frame;
      try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (frame?.type !== 'hello') return;
      clearTimeout(timer);
      try { ws.close(); } catch { /* closed */ }
      resolve(frame);
    });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new SeedGateError('no-hello', `cannot open ${url.host}/ws`)); });
  });
}

const runOf = (hello, runId) => (hello.runs || []).find((r) => r.id === runId || r.runId === runId) || null;

/** Polls the hello until the run waits on a question of `kind` (any kind when omitted). */
export async function waitForQuestion(base, runId, { kind = null, timeoutMs = 60000, WebSocketImpl } = {}) {
  const until = Date.now() + timeoutMs;
  let last = null;
  for (;;) {
    const run = runOf(await readHello(base, { WebSocketImpl }), runId);
    const pq = run?.pendingQuestion || null;
    if (pq && (!kind || pq.kind === kind)) return pq;
    last = pq?.kind || last;
    if (run && SETTLED.has(run.status)) refuse('run-settled', `run ${runId} settled (${run.status}) without a ${kind || 'question'}${last ? `; last question: ${last}` : ''}`);
    if (Date.now() > until) refuse('timeout', `run ${runId} has no ${kind || 'question'} after ${timeoutMs} ms${last ? `; last question: ${last}` : ''}`);
    await sleep(250);
  }
}

async function call(fetchImpl, base, method, p, body) {
  const r = await fetchImpl(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, json, text };
}

/** A git project with one commit (the runs need a repo). */
function makeScratchProject(root, name) {
  const dir = root ? path.join(root, name) : mkdtempSync(path.join(tmpdir(), `${name}-`));
  mkdirSync(dir, { recursive: true });
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seed@worca.local'], ['config', 'user.name', 'seed']]) execFileSync('git', a, { cwd: dir });
  writeFileSync(path.join(dir, 'README.md'), `# ${name}\n`);
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/** The answer each Clarify question gets: its first option. */
function clarifyPayload(pq) {
  const label = (o) => (o && typeof o === 'object' ? o.label ?? o.value ?? '' : o);
  return { answers: (pq.questions || []).map((q) => ({ id: q.id, choice: label((q.options || [])[0]) ?? '' })) };
}

/** Starts the seeded run on a mock server and answers Clarify until it holds at its review gate. The run is left waiting. */
export async function seedGate({ base, target = 'gate', projectRoot = null, fetch: fetchImpl = globalThis.fetch, WebSocketImpl } = {}) {
  assertSeedTarget(base);
  const hello = await readHello(base, { WebSocketImpl });
  if (hello.serverMock !== true) refuse('not-mock', `${base} is not a mock server (serverMock ${hello.serverMock}); the seed starts runs only on a mock instance`);

  const name = `stillhet-scratch-${target}`;
  const listed = await call(fetchImpl, base, 'GET', '/api/projects');
  let projectDir = (listed.json?.projects || []).find((p) => p.name === name)?.path || null;
  if (!projectDir) {
    projectDir = makeScratchProject(projectRoot, name);
    const added = await call(fetchImpl, base, 'POST', '/api/projects', { name, path: projectDir });
    if (added.status !== 200) refuse('project-refused', `POST /api/projects answered ${added.status}: ${added.text}`);
  }

  const started = await call(fetchImpl, base, 'POST', '/api/run', { projectDir, workflowId: SEEDED_GATE.workflowId, guardrailsId: 'normal',
    prompt: SEEDED_GATE.prompt, overlay: SEEDED_GATE.overlay });
  if (started.status !== 200 || !started.json?.runId) refuse('run-refused', `POST /api/run answered ${started.status}: ${started.text}`);
  const { runId } = started.json;

  for (;;) {
    const pq = await waitForQuestion(base, runId, { WebSocketImpl });
    if (pq.kind === 'gate') return { runId, projectDir, question: pq };
    if (pq.kind !== 'clarify') refuse('unexpected-question', `run ${runId} asks a ${pq.kind} question before its gate`);
    const a = await call(fetchImpl, base, 'POST', '/api/answer', { runId, id: pq.id, payload: clarifyPayload(pq) });
    if (a.status !== 200) refuse('answer-refused', `POST /api/answer answered ${a.status}: ${a.text}`);
    // wait for this question to be resolved before reading the next one
    const until = Date.now() + 30000;
    while (Date.now() < until && runOf(await readHello(base, { WebSocketImpl }), runId)?.pendingQuestion?.id === pq.id) await sleep(100);
  }
}

/** Answers the gate the way classic's gate card and Stillhet's task page do: POST /api/answer {runId, id, payload:{decision}}. */
export async function answerGate({ base, runId, id, decision, fetch: fetchImpl = globalThis.fetch }) {
  if (decision !== 'another' && decision !== 'continue') refuse('bad-decision', 'decision is another or continue');
  const r = await call(fetchImpl, base, 'POST', '/api/answer', { runId, id, payload: { decision } });
  if (r.status !== 200) refuse('answer-refused', `POST /api/answer answered ${r.status}: ${r.text}`);
  return r.json;
}

export async function main(argv = process.argv.slice(2)) {
  const args = [...argv];
  let base = null, target = 'gate', projectRoot = null;
  while (args.length) {
    const a = args.shift();
    if (a === '--target') target = args.shift();
    else if (a === '--project-root') projectRoot = args.shift();
    else if (!a.startsWith('--') && !base) base = a.replace(/\/+$/, '');
    else { console.error(`bad-arg: unknown argument ${a}`); return 2; }
  }
  if (!base || !target) { console.error('bad-arg: usage: node tools/stillhet-seed-gate.mjs URL [--target X] [--project-root DIR]'); return 2; }
  try {
    const { runId, projectDir, question } = await seedGate({ base, target, projectRoot });
    console.log(`Held at its review gate on ${base}`);
    console.log(`  run      ${runId}`);
    console.log(`  gate     ${question.id} (${(question.issues || []).length} open issue(s))`);
    console.log(`  project  ${projectDir}`);
    console.log(`  classic  ${base}/#running/${runId}`);
    console.log(`  Stillhet ${base}/#run/${runId}`);
    console.log(`Answer it in either page, or: POST ${base}/api/answer {"runId":"${runId}","id":"${question.id}","payload":{"decision":"another"|"continue"}}`);
    return 0;
  } catch (e) {
    if (e instanceof SeedGateError) { console.error(`${e.code}: ${e.message}`); return 2; }
    throw e;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });

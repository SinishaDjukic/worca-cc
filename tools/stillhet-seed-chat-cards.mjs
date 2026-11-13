#!/usr/bin/env node
// tools/stillhet-seed-chat-cards.mjs — a sandbox Worca whose chats hold one REAL record of every Stillhet chat card, for
// the browser walk (answer, approve, ask for changes, stop, open its task). Every record is the server's own: chats,
// cards and run links through dev's ask store, live runs through POST /api/run (WORCA_MOCK=1), a change proposal and a
// failed reply through real mock chat turns, saved runs as pipelines rows (tools/verify-feature-page-cdp.mjs's seed).
// Nothing is faked in the client. The server stays up (Ctrl-C ends it) and the live runs keep waiting for the walk.
//
// Run: PORT=4937 node tools/stillhet-seed-chat-cards.mjs
//   It makes a temp HOME (settings: Stillhet on, welcome seen) and WORCA_HOME, a git project, and prints each chat's
//   address. Pin a PORT: an agent inherits the host app's 4317 (sandbox-server-port-inherited).
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = 'claude-opus-5-5';
const SETTLED = new Set(['done', 'error', 'failed', 'stopped', 'cancelled']);

/** The card each seeded chat shows, in walk order (its key is the `cards` key the seed answers with). */
export const SEEDED_CARDS = Object.freeze([
  { key: 'question', title: 'Seed · task waiting on a question', card: 'TaskCard with its question (OptionList): answer, stop, open its task' },
  { key: 'plan', title: 'Seed · Shaper plan to approve', card: 'TaskCard with its PlanCard: approve, ask for changes, stop' },
  { key: 'change', title: 'Seed · proposed change', card: 'ChangeProposal (model): apply, not now' },
  { key: 'failed', title: 'Seed · failed task and reply', card: 'TaskCard of a failed run, and a reply that failed' },
  { key: 'pr', title: 'Seed · finished task with a PR', card: 'TaskCard of a finished run, and its pull-request card' },
]);

async function until(what, fn, { timeoutMs = 60000, every = 50 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what}: not within ${timeoutMs / 1000}s`);
    await sleep(every);
  }
}

/**
 * Seeds the five chats into the running server at `base` (this process's ui/server.mjs, so `runs` is its live map).
 * `projectDir` is a git repository with one commit. → { project, threads: {key → threadId}, runs: {question, plan},
 * pipelines: {failed, pr} } — the live run ids wait at their question and their plan until the walk answers.
 */
export async function seedChatCards({ base, runs, projectDir, projectName = 'Seed project' }) {
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey } = await import('../src/core/store.mjs');
  const { writeStoreMeta } = await import('../src/core/artifacts.mjs');
  const ask = await import('../src/core/ask/store.mjs');
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const key = projectKey(projectDir);
  writeStoreMeta(key, 'project', { key, name: projectName, path: projectDir });
  const titleOf = (k) => SEEDED_CARDS.find((c) => c.key === k).title;
  const chat = (k) => ask.createThread({ title: titleOf(k), model: MODEL, effort: 'high' }).id;
  const asked = (threadId, text) => ask.appendMessage(threadId, { role: 'user', text });
  const said = (threadId, text, blocks) => ask.appendMessage(threadId, { role: 'assistant', text, status: 'done', model: MODEL, blocks });
  const pinProject = (threadId) => ask.updateThread(threadId, { context: { pinned: true, projectKey: key } });
  // a run proposal as dev's propose_run makes it (src/core/ask/proposal.mjs), started by the chat's own Start route
  const startFromCard = async (threadId, { title, brief, workflowId, workflowName, extra = {} }) => {
    const cardId = ask.newAskId('card');
    said(threadId, 'Here is a task for it.', [{ kind: 'card', id: cardId, state: 'proposed', card: { target: 'project', projectKey: key, projectDir, projectName, workflowId, workflowName, brief, title, sourceBranch: 'main' } }]);
    const { runId } = await call('POST', '/api/run', { projectDir, prompt: brief, title, workflowId, sourceBranch: 'main', askThreadId: threadId, askCardId: cardId, ...extra });
    return { runId, cardId };
  };
  const threads = {}, live = {}, pipelines = {};

  // TaskCard + its question: a Default run parks at Clarify (two questions with options) until it is answered
  threads.question = chat('question'); pinProject(threads.question);
  asked(threads.question, 'Add input validation to the signup form');
  live.question = (await startFromCard(threads.question, { title: 'Validate the signup form', brief: 'Add input validation to the signup form', workflowId: 'wf_default', workflowName: 'Default' })).runId;
  await until('the task\'s question', () => { const q = runs.get(live.question)?.pendingQuestion; return q && q.kind !== 'plan' && (q.questions || []).length; });

  // TaskCard + PlanCard: a Shaper run whose clarify asks are answered (as test/api-shape-first.test.mjs does) up to its plan
  threads.plan = chat('plan'); pinProject(threads.plan);
  asked(threads.plan, 'Shape a CSV export for the billing page');
  live.plan = (await startFromCard(threads.plan, { title: 'CSV export for billing', brief: 'Shape a CSV export for the billing page', workflowId: 'wf_shape', workflowName: 'Shaper', extra: { shape: { slices: 'off' } } })).runId;
  await until('the Shaper plan', async () => {
    const e = runs.get(live.plan), q = e?.pendingQuestion;
    if (!e || SETTLED.has(String(e.status || ''))) throw new Error(`the Shaper run settled (${e?.status}) before its plan`);
    if (q && q.kind === 'plan') return q;
    if (q) await call('POST', '/api/answer', { runId: live.plan, id: q.id, payload: { answers: [] } });
    return null;
  }, { timeoutMs: 90000 });

  // ChangeProposal: the mock chat's real turn proposes a model (test/ask-model-card.test.mjs)
  const turn = async (threadId, text) => {
    await call('POST', `/api/ask/threads/${threadId}/messages`, { text, model: MODEL, effort: 'high', context: {} });
    await until(`the reply to "${text}"`, async () => { const t = await call('GET', `/api/ask/threads/${threadId}`); return !t.inFlight && t.messages.some((m) => m.role === 'assistant' && m.status) && t; });
  };
  threads.change = chat('change');
  await turn(threads.change, 'add a local llama model for my llama.cpp server');

  // saved runs, as pipelines rows: a failed one and a finished one with its PR, each started from its chat's card
  const now = new Date().toISOString();
  const pipeline = (id, status, title, extra = '') => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase,
    cycle, started_at, updated_at, total_cost_usd, total_active_ms, branch${extra ? ', pr_url, pr_state' : ''}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?${extra ? ',?,?' : ''})`)
    .run(id, key, 'project', title, status, status, 0, now, now, 0.42, 61000, JSON.stringify({ source: 'main', feature: `worca/${id}` }), ...(extra ? [extra, 'OPEN'] : []));
  const startedCard = (threadId, pid, title, brief) => {
    const cardId = ask.newAskId('card');
    said(threadId, 'Started it.', [{ kind: 'card', id: cardId, state: 'started', runId: pid, card: { target: 'project', projectKey: key, projectDir, projectName, workflowId: 'wf_default', workflowName: 'Default', brief, title, sourceBranch: 'main' } }]);
    ask.linkRun(threadId, { runId: pid, pipelineId: pid, cardId, status: null });
  };
  // 8-hex ids: ASK_RUN_REF_RE refuses others (cdp-proof-reload-trap)
  pipelines.failed = '5eed0001'; pipelines.pr = '5eed0002';
  threads.failed = chat('failed'); pinProject(threads.failed);
  asked(threads.failed, 'Upgrade the payment SDK');
  pipeline(pipelines.failed, 'error', 'Upgrade the payment SDK');
  startedCard(threads.failed, pipelines.failed, 'Upgrade the payment SDK', 'Upgrade the payment SDK');
  await turn(threads.failed, 'please MOCK_FAIL now');

  threads.pr = chat('pr'); pinProject(threads.pr);
  asked(threads.pr, 'Fix the date format on invoices');
  const prUrl = 'https://github.com/example/billing/pull/42';
  pipeline(pipelines.pr, 'done', 'Fix the invoice date format', prUrl);
  startedCard(threads.pr, pipelines.pr, 'Fix the invoice date format', 'Fix the date format on invoices');
  said(threads.pr, 'The pull request is open.', [{ kind: 'card', id: ask.newAskId('card'), state: 'applied', card: { type: 'pull-request', title: 'Fix the invoice date format', branch: `worca/${pipelines.pr}`, pipelineId: pipelines.pr, runId: pipelines.pr, result: { url: prUrl } } }]);

  return { project: key, threads, runs: live, pipelines };
}

async function main() {
  const port = Number(process.env.PORT_SEED || process.env.PORT);
  if (!port || port === 4317) { console.error('set PORT to a free port other than the host app\'s 4317, e.g. PORT=4937'); return 2; }
  const home = await mkdtemp(path.join(tmpdir(), 'worca-seed-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = path.join(home, '.worca-cc');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  await mkdir(path.join(home, '.worca-cc'), { recursive: true });
  await writeFile(path.join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true }, flags: { rail: true }, uiLevel: 'expert' }));
  const proj = await mkdtemp(path.join(tmpdir(), 'worca-seed-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seed@worca.local'], ['config', 'user.name', 'seed']]) execFileSync('git', a, { cwd: proj });
  await writeFile(path.join(proj, 'README.md'), '# seed project\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${port}`;
  const out = await seedChatCards({ base, runs, projectDir: proj });
  console.log(`Seeded ${base}  (HOME ${home}, project ${proj})`);
  for (const c of SEEDED_CARDS) console.log(`  ${base}/#chat/${out.threads[c.key]}  ${c.card}`);
  console.log(`  live runs: question ${out.runs.question}, plan ${out.runs.plan}; saved: failed ${out.pipelines.failed}, PR ${out.pipelines.pr}`);
  console.log('The server stays up for the walk; Ctrl-C ends it.');
  await new Promise(() => {});
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });

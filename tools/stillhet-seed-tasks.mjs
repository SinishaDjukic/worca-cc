#!/usr/bin/env node
// tools/stillhet-seed-tasks.mjs — a sandbox Worca whose Tasks hold one REAL record of every task state the Tasks walk acts
// on (Stillhet slice 5, D18): a run that failed for real (WORCA_MOCK_FAIL_STEP), a run paused at a low cap for real
// (WORCA_MOCK_STEP_COST_USD), a run at its plan, a stopped run with a saved plan and a kept branch, and two finished runs
// with open PRs (one approved, one with failing checks) whose host is a stub `gh` on the sandbox's PATH. Every record is the
// server's own: live runs through POST /api/run (WORCA_MOCK=1), each started from a chat card as Chat's seed does; saved
// runs as pipelines rows. STUB_GH_REFUSE=merge makes the stub refuse a merge, so the walk can prove it never fakes success;
// STUB_GH_LOG=FILE records every gh call the routes make.
//
// Run: PORT=4937 node tools/stillhet-seed-tasks.mjs   (pin a PORT: an agent inherits the host app's 4317)
import { execFileSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MODEL = 'claude-opus-5-5';
export const PR_APPROVED = 'https://github.com/example/billing/pull/42';
export const PR_FAILING = 'https://github.com/example/billing/pull/43';

/** The task each seeded record is, in walk order. */
export const SEEDED_TASKS = Object.freeze([
  { key: 'failed', what: 'a run whose Build failed for real (paused by dev\'s failure policy): Retry, Restart Build, Report' },
  { key: 'capped', what: 'a run paused at its cost cap for real: Raise the cap, Continue without cap' },
  { key: 'plan', what: 'a run at its plan: Approve and build' },
  { key: 'stopped', what: 'a stopped run with a saved plan and a kept branch: Restart Build, Start a new task' },
  { key: 'approved', what: 'a finished run with an approved PR whose checks pass: Merge PR (STUB_GH_REFUSE=merge refuses it)' },
  { key: 'failing', what: 'a finished run whose PR has failing checks: Fix checks, Re-run checks' },
  // the bell's other kinds, so its head reads the count and the breakdown (feature 1 audit fix pass, D7)
  { key: 'missed', what: 'a schedule whose start passed while Worca was off: Run now' },
  { key: 'project-need', what: 'a project whose folder was moved away (Moved folder): Needs you' },
  { key: 'question', what: 'a workspace link Worca is unsure of: a question' },
]);

/** The stub `gh` (a node script): answers the PR calls the Tasks routes make, from the PR's number. A PR's head is its
 *  seeded run's branch (`worca/5eed0012`, `worca/5eed0013`), so dev's Watch and Fix checks find the run behind it. */
export const STUB_GH = `#!/usr/bin/env node
const a = process.argv.slice(2), out = (v) => { process.stdout.write(typeof v === 'string' ? v : JSON.stringify(v)); process.exit(0); };
const no = (m) => { process.stderr.write(m); process.exit(1); };
const refuse = String(process.env.STUB_GH_REFUSE || '').split(',');
// STUB_GH_LOG: every call, one line each, so a walk reads back what reached the PR's host (a merge, a checks re-run)
if (process.env.STUB_GH_LOG) require('node:fs').appendFileSync(process.env.STUB_GH_LOG, a.join(' ') + '\\n');
const failing = a.some((x) => /\\/pull\\/43\\b/.test(x));
// a PR's head is its branch's real commit on the seed's origin (STUB_GH_HEADS, written by seedTasks), so dev's Fix checks
// finds the remote at the PR's head and starts; 'h1' without it
let heads = {}; try { heads = JSON.parse(require('node:fs').readFileSync(process.env.STUB_GH_HEADS, 'utf8')); } catch {}
const headOid = heads[failing ? '43' : '42'] || 'h1';
// a merged PR stays merged, as its host answers it afterwards: the merge is noted next to the heads file
const mergedFile = process.env.STUB_GH_HEADS ? process.env.STUB_GH_HEADS + '.merged' : '';
let mergedPrs = []; try { mergedPrs = require('node:fs').readFileSync(mergedFile, 'utf8').split('\\n'); } catch {}
const prState = mergedPrs.includes(failing ? '43' : '42') ? 'MERGED' : 'OPEN';
const check = (name, ok) => ({ __typename: 'CheckRun', name, status: 'COMPLETED', conclusion: ok ? 'SUCCESS' : 'FAILURE' });
if (a[0] === '--version') out('gh version 2.0.0 (stub)');
if (a[0] === 'auth') out('');
if (a[0] === 'repo' && a[1] === 'view') out({ squashMergeAllowed: true, mergeCommitAllowed: true, rebaseMergeAllowed: true });
if (a[0] === 'pr' && a[1] === 'merge') { if (refuse.includes('merge')) no('Pull request is not mergeable: the base branch policy prohibits the merge'); if (mergedFile) require('node:fs').appendFileSync(mergedFile, (failing ? '43' : '42') + '\\n'); out(''); }
if (a[0] === 'pr' && a[1] === 'edit') out('');
// a view answers the PR's own facts (History finds a run's PR by them: url, number, state) and \`-q .field\` reads one of them
if (a[0] === 'pr' && a[1] === 'view') { const url = failing ? '${PR_FAILING}' : '${PR_APPROVED}', q = a.indexOf('-q');
  const v = { url, number: Number(url.split('/').pop()), state: prState, title: 'Seeded PR', headRefName: failing ? 'worca/5eed0013' : 'worca/5eed0012', baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: failing ? 'UNSTABLE' : 'CLEAN', reviewDecision: failing ? '' : 'APPROVED', isDraft: false,
    statusCheckRollup: [check('unit', !failing), check('e2e', true), check('lint', true)], latestReviews: failing ? [] : [{ author: { login: 'maya' }, state: 'APPROVED' }], headRefOid: headOid, body: '' };
  if (q >= 0) out(String(v[String(a[q + 1]).replace(/^\./, '')] ?? '')); out(v); }
if (a[0] === 'pr' && a[1] === 'list') out([]);
if (a[0] === 'run' && a[1] === 'rerun') out('');
if (a[0] === 'api' && a[1] === 'graphql') out({ data: { repository: { pullRequest: { url: failing ? '${PR_FAILING}' : '${PR_APPROVED}', state: prState, headRefName: failing ? 'worca/5eed0013' : 'worca/5eed0012', headRefOid: headOid,
  baseRefName: 'main', baseRefOid: 'b1', mergeable: 'MERGEABLE', author: { login: 'seed' },
  statusCheckRollup: { contexts: { nodes: [{ ...check('unit', !failing), isRequired: false, databaseId: 7, checkSuite: { workflowRun: { databaseId: 77 } } }], pageInfo: { hasNextPage: false, endCursor: null } } },
  reviewThreads: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } }, reviews: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } } } });
no('stub gh: ' + a.join(' '));
`;

/** Writes the stub `gh` into `binDir` and puts it first on PATH (this process and the runs it starts). */
export async function installStubGh(binDir) {
  await mkdir(binDir, { recursive: true });
  const file = path.join(binDir, 'gh');
  await writeFile(file, STUB_GH);
  await chmod(file, 0o755);
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
  return file;
}

async function until(what, fn, { timeoutMs = 90000, every = 50 } = {}) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`${what}: not within ${timeoutMs / 1000}s`);
    await sleep(every);
  }
}

// a git repository with one commit on main, in a fresh temp folder
async function gitRepo(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seed@worca.local'], ['config', 'user.name', 'seed']]) execFileSync('git', a, { cwd: dir });
  await writeFile(path.join(dir, 'README.md'), '# seed\n');
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir });
  return dir;
}

/**
 * Seeds the six tasks into the running server at `base` (this process's ui/server.mjs, so `runs` is its live map).
 * `projectDir` is a git repository with one commit on `main`. → { project, threads: {key → threadId}, runs: {plan},
 * pipelines: {failed, capped, stopped, approved, failing} }.
 */
export async function seedTasks({ base, runs, projectDir, projectName = 'Seed project' }) {
  const { getDb } = await import('../src/core/db.mjs');
  const { projectKey, projectStorePath } = await import('../src/core/store.mjs');
  const { writeStoreMeta, recordArtifact, persistPrState } = await import('../src/core/artifacts.mjs');
  const ask = await import('../src/core/ask/store.mjs');
  const call = async (method, p, body) => {
    const r = await fetch(`${base}${p}`, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${p}: HTTP ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const key = projectKey(projectDir);
  // onboarded through dev's own route, as a person adds a project: resume, restart and New task refuse a project that is not
  await call('POST', '/api/projects', { name: projectName, path: projectDir });
  writeStoreMeta(key, 'project', { key, name: projectName, path: projectDir });
  const chat = (title) => { const id = ask.createThread({ title, model: MODEL, effort: 'high' }).id; ask.updateThread(id, { context: { pinned: true, projectKey: key } }); return id; };
  const startFromCard = async (threadId, { title, brief, workflowId = 'wf_default', extra = {} }) => {
    const cardId = ask.newAskId('card');
    ask.appendMessage(threadId, { role: 'user', text: brief });
    ask.appendMessage(threadId, { role: 'assistant', text: 'Here is a task for it.', status: 'done', model: MODEL, blocks: [{ kind: 'card', id: cardId, state: 'proposed', card: { target: 'project', projectKey: key, projectDir, projectName, workflowId, workflowName: workflowId, brief, title, sourceBranch: 'main' } }] });
    const { runId } = await call('POST', '/api/run', { projectDir, prompt: brief, title, workflowId, sourceBranch: 'main', askThreadId: threadId, askCardId: cardId, ...extra });
    return runId;
  };
  // a live run answered past its questions until `done(entry)` holds
  const drive = (runId, done, what) => until(what, async () => {
    const e = runs.get(runId), q = e?.pendingQuestion;
    if (done(e)) return e;
    if (q && q.kind !== 'plan') await call('POST', '/api/answer', { runId, id: q.id, payload: { answers: [] } }).catch(() => {});
    return null;
  });
  const threads = {}, live = {}, pipelines = {};

  // failed: a real Build failure (the mock implementer throws); dev's failure policy pauses the run on that step
  process.env.WORCA_MOCK_FAIL_STEP = 'implementer';
  threads.failed = chat('Seed · failed task');
  const failedRun = await startFromCard(threads.failed, { title: 'Update Node to 24', brief: 'Update Node to 24' });
  const fe = await drive(failedRun, (e) => e && ['paused', 'error'].includes(String(e.status)), 'the failed run');
  pipelines.failed = fe.pipelineId;
  delete process.env.WORCA_MOCK_FAIL_STEP;

  // plan: a Shaper run answered up to its plan, waiting for Approve and build
  threads.plan = chat('Seed · plan to approve');
  // with perspectives on, dev's role reviews write the plan's findings (state.roleReviews); its shape check and concern are
  // read too. None of them: the seed throws, never invents a finding (D10, D11)
  live.plan = await startFromCard(threads.plan, { title: 'CSV export for billing', brief: 'Shape a CSV export for the billing page', workflowId: 'wf_shape', extra: { shape: { slices: 'off', perspectives: ['product', 'qa'] } } });
  const pe = await drive(live.plan, (e) => e?.pendingQuestion?.kind === 'plan', 'the Shaper plan');
  const pq = pe.pendingQuestion, rr = pe.orch?.state?.roleReviews || pq?.plan?.roleReviews;
  const found = (rr?.rounds || []).some((r) => (r.roles || []).some((x) => (x.findings || []).length)) || (pq?.plan?.check?.items || []).some((i) => i && !i.pass) || !!pq?.concern;
  if (!found) throw new Error('the plan run has no role-review finding, plan check item or concern: dev\'s Shaper with perspectives product, qa wrote none');

  // stopped: a saved run with a plan artifact and its kept branch
  const now = new Date().toISOString();
  const row = (id, status, title, extra = {}) => getDb().prepare(`INSERT INTO pipelines (id, project_key, target, title, status, phase, cycle, started_at, updated_at,
    total_cost_usd, total_active_ms, branch, pr_url, pr_number, pr_state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, key, 'project', title, status, status, 0, now, now, 0.42, 61000, JSON.stringify({ source: 'main', feature: `worca/${id}`, branchKept: true }),
      extra.pr || null, extra.pr ? Number(extra.pr.split('/').pop()) : null, extra.pr ? 'OPEN' : null);
  const linked = (threadId, pid, title) => { const cardId = ask.newAskId('card'); ask.appendMessage(threadId, { role: 'assistant', text: 'Started it.', status: 'done', model: MODEL, blocks: [{ kind: 'card', id: cardId, state: 'started', runId: pid, card: { target: 'project', projectKey: key, projectDir, projectName, workflowId: 'wf_default', workflowName: 'Default', brief: title, title, sourceBranch: 'main' } }] }); ask.linkRun(threadId, { runId: pid, pipelineId: pid, cardId, status: null }); };
  // the steps the run went through, as dev's ledger writes them (artifacts.mjs writeState: x:<node>:<n> rows), with its
  // workflow's graph so each step is named as the workflow names it
  const insStep = getDb().prepare(`INSERT INTO pipeline_steps (pipeline_id, key, node_id, phase, cycle, status, started_at, updated_at, active_ms, cost_usd,
    execution_id, exec_kind, agent_key, ended_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const NODES = [['n_clarify', 'clarify', 'Clarify'], ['n_plan', 'planner', 'Plan'], ['n_refine', 'refiner', 'Refine plan'], ['n_impl', 'implementer', 'Implementation'], ['n_review', 'reviewer', 'Review implementation']];
  const steps = (pid, states) => {
    states.forEach((st, i) => { const [node, agent] = NODES[i]; insStep.run(pid, `x:${node}:1`, node, agent, 1, st, now, now, 20000, 0.05, `x:${node}:1`, 'cycle', agent, st === 'done' ? now : null); });
    getDb().prepare('UPDATE pipelines SET stepper = ? WHERE id = ?').run(JSON.stringify({ graph: { nodes: NODES.map(([id, key, label]) => ({ id, kind: 'agent', key, label })) } }), pid);
  };
  pipelines.stopped = '5eed0011';
  row(pipelines.stopped, 'stopped', 'Add pager to the audit log');
  steps(pipelines.stopped, ['done', 'done', 'done', 'stopped']);
  execFileSync('git', ['branch', `worca/${pipelines.stopped}`], { cwd: projectDir });
  const rel = `plans/${now.slice(0, 10)}-seed-pager.md`;
  await mkdir(path.join(projectStorePath(key), 'plans'), { recursive: true });
  await writeFile(path.join(projectStorePath(key), rel), '# Plan\n\nAdd a pager to the audit log.\n');
  recordArtifact(pipelines.stopped, 'plan', rel);
  threads.stopped = chat('Seed · stopped task'); linked(threads.stopped, pipelines.stopped, 'Add pager to the audit log');

  // approved and failing: finished runs with open PRs on the stub gh
  pipelines.approved = '5eed0012'; row(pipelines.approved, 'done', 'Add pager to the audit log', { pr: PR_APPROVED });
  pipelines.failing = '5eed0013'; row(pipelines.failing, 'done', 'Fix the invoice date format', { pr: PR_FAILING });
  for (const id of [pipelines.approved, pipelines.failing]) { execFileSync('git', ['branch', `worca/${id}`], { cwd: projectDir }); steps(id, ['done', 'done', 'done', 'done', 'done']); }   // the PRs' heads
  // the failing PR's verdict, as dev's PR lookup stores it (persistPrState): its failing checks make it need you
  persistPrState(pipelines.failing, { url: PR_FAILING, number: 43, state: 'OPEN', verdict: { mergeable: 'MERGEABLE', reviewDecision: '', checks: { state: 'failing', total: 3, failed: 1, pending: 0 } } });
  // a bare `origin` holding main and the runs' branches: dev's Fix checks and Watch fetch it before a round starts, and the
  // stub gh reports each PR's head as its branch's real commit there
  const originDir = await mkdtemp(path.join(tmpdir(), 'worca-seed-tasks-origin-'));
  execFileSync('git', ['init', '-q', '--bare', originDir]);
  execFileSync('git', ['remote', 'add', 'origin', originDir], { cwd: projectDir });
  execFileSync('git', ['push', '-q', 'origin', 'main', ...[pipelines.stopped, pipelines.approved, pipelines.failing].map((id) => `worca/${id}`)], { cwd: projectDir });
  const sha = (id) => execFileSync('git', ['rev-parse', `worca/${id}`], { cwd: projectDir, encoding: 'utf8' }).trim();
  const headsFile = path.join(originDir, 'stub-gh-heads.json');
  await writeFile(headsFile, JSON.stringify({ 42: sha(pipelines.approved), 43: sha(pipelines.failing) }));
  process.env.STUB_GH_HEADS = headsFile;
  threads.approved = chat('Seed · approved PR'); linked(threads.approved, pipelines.approved, 'Add pager to the audit log');
  threads.failing = chat('Seed · failing checks'); linked(threads.failing, pipelines.failing, 'Fix the invoice date format');

  // capped, last: each mock step reports $0.40 and the run's cap is $0.50, so the second step pauses it for real
  process.env.WORCA_MOCK_STEP_COST_USD = '0.4';
  await call('POST', '/api/settings', { pipelineCostLimitUsd: 0.5 });
  threads.capped = chat('Seed · capped task');
  const cappedRun = await startFromCard(threads.capped, { title: 'Big refactor', brief: 'Refactor the billing module' });
  const ce = await drive(cappedRun, (e) => e && String(e.status) === 'paused', 'the capped run');
  pipelines.capped = ce.pipelineId;
  delete process.env.WORCA_MOCK_STEP_COST_USD;

  // missed: a one-off start that passed while Worca was off; dev's scheduler marks it missed on its next tick
  const { createTicket } = await import('../src/core/scheduler.mjs');
  const { schedulerTick } = await import('../ui/server.mjs');
  const ticket = createTicket({ title: 'Nightly dependency bump', projectDir, runAtMs: Date.now() - 7 * 3600_000, request: { projectDir, prompt: 'Bump the dependencies' } });
  await schedulerTick();
  if ((await call('GET', '/api/schedules')).tickets?.find((t) => t.id === ticket.id)?.status !== 'missed') throw new Error('the seeded schedule was not marked missed by dev\'s scheduler');
  const other = {};
  other.missed = ticket.id;

  // question: a workspace of this project and a second one, whose one link Worca is unsure of (an auto, heuristic edge)
  const second = await gitRepo('worca-seed-tasks-api-');
  const { workspace } = await call('POST', '/api/workspaces', { name: 'Billing and API', projectPaths: [projectDir, second] });
  const { saveWorkspaceScanResult } = await import('../src/core/workspaces.mjs');
  const { edgeId } = await import('../src/shared/workspace-map/ids.mjs');
  const [from, to] = [key, projectKey(second)];
  const norm = 'http:GET /invoices/{}';
  const member = (k, name) => ({ key: k, name, role: `Serves ${name}`, roleSource: 'static', aliases: [], stack: ['node'],
    coverage: { level: 'rich', files: 1, scannedFiles: 1, truncated: false, factsStatic: 1, factsLlm: 0, unresolved: 0, rejected: 0, surveyed: 'skipped', usageStatus: 'investigated', graph: null } });
  const map = { version: 1, workspace: { name: 'Billing and API' }, scannedAt: now, runId: 'seed0001', members: [member(from, projectName), member(to, 'api')],
    edges: [{ id: edgeId(from, to, 'http', norm), from, to, kind: 'http', norm, display: 'GET /invoices/{id}', label: null, detail: '', confidence: 'heuristic', sources: ['static'],
      evidence: { from: [{ file: 'src/client.js', line: 3, match: 'GET /invoices/{id}' }], to: [{ file: 'src/server.js', line: 7, match: 'GET /invoices/{id}' }] } }],
    order: [[to], [from]], cycles: [], graph: { mode: 'none', file: null, nodes: 0, bridges: 0 }, stats: { edges: 1, byKind: { http: 1 }, byConfidence: {}, candidates: 0, candidatesConfirmed: 0, factsRejected: 0 }, errors: [] };
  await saveWorkspaceScanResult(workspace.id, { map, synthesis: { version: 1, overview: 'Billing calls the API for invoices.', roles: {}, coordination: [], orderNotes: '' } });
  other.question = workspace.id;

  // project-need: registered last (walks that pick the first project keep the seed project), then its folder moves away
  const moved = await gitRepo('worca-seed-tasks-moved-');
  await call('POST', '/api/projects', { name: 'Moved folder', path: moved });
  await rm(moved, { recursive: true, force: true });
  other['project-need'] = projectKey(moved);

  return { project: key, threads, runs: live, pipelines, other };
}

async function main() {
  const port = Number(process.env.PORT_SEED || process.env.PORT);
  if (!port || port === 4317) { console.error('set PORT to a free port other than the host app\'s 4317, e.g. PORT=4937'); return 2; }
  const home = await mkdtemp(path.join(tmpdir(), 'worca-seed-tasks-home-'));
  process.env.HOME = home; process.env.USERPROFILE = home;
  process.env.WORCA_HOME = path.join(home, '.worca-cc');
  process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
  process.env.WORCA_MOCK = '1';
  await mkdir(path.join(home, '.worca-cc'), { recursive: true });
  await writeFile(path.join(home, '.worca-cc', 'settings.json'), JSON.stringify({ onboarding: { welcomeSeen: true }, flags: { rail: true }, uiLevel: 'expert' }));
  await installStubGh(path.join(home, 'bin'));
  const proj = await mkdtemp(path.join(tmpdir(), 'worca-seed-tasks-proj-'));
  for (const a of [['init', '-q', '-b', 'main'], ['config', 'user.email', 'seed@worca.local'], ['config', 'user.name', 'seed']]) execFileSync('git', a, { cwd: proj });
  await writeFile(path.join(proj, 'README.md'), '# seed project\n');
  execFileSync('git', ['add', '-A'], { cwd: proj });
  execFileSync('git', ['commit', '-qm', 'init'], { cwd: proj });
  const { server, runs } = await import(new URL('../ui/server.mjs', import.meta.url).href);
  await new Promise((r, j) => { server.once('error', j); server.listen(port, '127.0.0.1', r); });
  const base = `http://127.0.0.1:${port}`;
  const out = await seedTasks({ base, runs, projectDir: proj });
  console.log(`Seeded ${base}  (HOME ${home}, project ${proj})`);
  for (const t of SEEDED_TASKS) console.log(`  ${out.other[t.key] ? `${t.key} ${out.other[t.key]}` : `${base}/#run/${out.pipelines[t.key] || out.runs[t.key]}`}  ${t.what}`);
  console.log('The server stays up for the walk; Ctrl-C ends it.');
  await new Promise(() => {});
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });

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
  // feature 1 audit fix pass: every other dev card kind, a live record each, grouped by what the thread holds
  { key: 'proposal', title: 'Coverage: proposals and workflows', card: 'TaskProposal from a real mock turn: Start, Not now' },
  { key: 'workflow', title: 'Coverage: proposals and workflows', card: 'ChangeProposal (workflow) from a real mock turn' },
  { key: 'workflow-build', title: 'Coverage: proposals and workflows', card: 'ChangeProposal (a workflow built in Chat)' },
  { key: 'run-stop', title: 'Coverage: run actions', card: 'Stop a task? Stop run, Keep running' },
  { key: 'ship', title: 'Coverage: run actions', card: 'Ship the feature: its requirements, Create PR' },
  { key: 'changes', title: 'Coverage: run actions', card: 'Changes on a finished task: Start, Not now' },
  { key: 'route', title: 'Coverage: run actions', card: 'Where does this go? its three choices' },
  { key: 'receipt', title: 'Coverage: run actions', card: 'A setting Worca changed, with Undo' },
  { key: 'script-approval', title: 'Coverage: run actions', card: 'Run the script? Run it, Not now' },
  { key: 'unknown', title: 'Coverage: run actions', card: 'A card type Stillhet does not know: a calm notice' },
  { key: 'command', title: 'Coverage: commands and files', card: 'One command that ran' },
  { key: 'commands', title: 'Coverage: commands and files', card: 'Two commands in one answer: one group' },
  { key: 'files', title: 'Coverage: commands and files', card: 'Files Worca showed (a real attachment)' },
  { key: 'pr-pending', title: 'Coverage: pull requests', card: 'Create a PR? Create PR, Not now' },
  { key: 'ready', title: 'Coverage: pull requests', card: 'A finished task whose PR is approved, passing and mergeable: Ready to merge, Merge PR' },
  { key: 'divider', title: 'Coverage: project switch', card: 'Switched to a project, after its scope-switch card was answered' },
  ...['scope-switch', 'schedule', 'away', 'proxy', 'web', 'clone', 'project', 'workspace', 'actions', 'metrics', 'policy']
    .map((key) => ({ key, title: 'Coverage: change proposals', card: `ChangeProposal (${key})` })),
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
  await call('POST', '/api/projects', { name: projectName, path: projectDir });
  writeStoreMeta(key, 'project', { key, name: projectName, path: projectDir });
  const titleOf = (k) => SEEDED_CARDS.find((c) => c.key === k).title;
  // one thread per title: the coverage kinds share the thread that says what it holds
  const byTitle = new Map();
  const chat = (k) => { const t = titleOf(k); if (!byTitle.has(t)) byTitle.set(t, ask.createThread({ title: t, model: MODEL, effort: 'high' }).id); return byTitle.get(t); };
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
  said(threads.pr, 'Opened the pull request.', [{ kind: 'card', id: ask.newAskId('card'), state: 'applied', card: { type: 'pull-request', title: 'Fix the invoice date format', branch: `worca/${pipelines.pr}`, pipelineId: pipelines.pr, result: { url: prUrl } } }]);

  await seedCoverage({ ask, call, turn, chat, asked, said, pinProject, pipeline, startedCard, threads, pipelines, key, projectDir, projectName, now });
  return { project: key, threads, runs: live, pipelines };
}

// The card payloads are the ones dev's creators write (the `type` strings and fields of src/core/ask/ and its proposal
// modules); a kind with a dev mock arm comes from a real mock turn. A kind that cannot be produced throws.
async function seedCoverage({ ask, call, turn, chat, asked, said, pinProject, pipeline, startedCard, threads, pipelines, key, projectDir, projectName, now }) {
  const card = (type, fields, state = 'proposed', o = {}) => ({ kind: 'card', id: ask.newAskId('card'), state, ...o, card: { type, ...fields } });
  const thread = (k) => { threads[k] = chat(k); pinProject(threads[k]); return threads[k]; };
  const t = async (url) => call('GET', url);
  const need = (ok, what) => { if (!ok) throw new Error(`the coverage seed could not make a real ${what}`); };

  // proposals and workflows: the mock Ask's own run proposal and workflow cards (src/core/engines/mock.mjs)
  const flows = thread('proposal'); threads.workflow = flows; threads['workflow-build'] = flows;
  await turn(flows, 'Please propose a run to add a dark theme to the settings page');
  await turn(flows, 'build me a workflow for a security review before each PR');
  const flowCards = (await t(`/api/ask/threads/${flows}`)).messages.flatMap((m) => m.blocks || []).filter((b) => b.kind === 'card');
  need(flowCards.some((b) => !b.card?.type), 'run proposal from the mock turn');
  need(flowCards.some((b) => b.card?.type === 'workflow'), 'workflow card from the mock turn');
  said(flows, 'Here is the workflow, as you built it on the canvas.', [card('workflow-build', { sessionId: 'wb-seed-1', docToken: 'seed', name: 'Security-first review', domain: 'code', reasoning: 'A security pass before each PR',
    workflow: { nodes: [{ id: 'n_plan', kind: 'agent', key: 'planner', label: 'Plan' }, { id: 'n_sec', kind: 'agent', key: 'reviewer', label: 'Security review' }], wires: [{ from: 'n_plan', to: 'n_sec' }] },
    counts: { nodes: 2, wires: 1 }, loops: 0, drafts: [], todo: [], warnings: [] })]);

  // run actions
  const acts = thread('run-stop'); for (const k of ['ship', 'changes', 'route', 'receipt', 'script-approval', 'unknown']) threads[k] = acts;
  pipelines.feature = '5eed0003';
  pipeline(pipelines.feature, 'done', 'Run tags · 1/1: Store tags');
  const { createSliceFeature } = await import('../src/core/shape/features.mjs');
  const feature = createSliceFeature({ pipelineId: pipelines.feature, projectDir, title: 'Run tags', perspectives: ['product'], workflowId: 'wf_shape',
    outline: { why: 'seed', slices: [{ id: 's1', title: 'Store tags', goal: 'Store a run\'s tags', inScope: [], outOfScope: [], acceptance: ['tags are stored'], dependsOn: [], estimate: 'M' }] } });
  asked(acts, 'Stop the pager task, and ship the run tags feature');
  said(acts, 'Here is what I can do.', [
    card('run-stop', { runId: pipelines.failed, pipelineId: pipelines.failed, title: 'Upgrade the payment SDK', branch: `worca/${pipelines.failed}`, status: 'running' }),
    card('ship', { featureId: feature.id, title: 'Run tags', runs: 1, files: 4, added: 120, deleted: 8, suggested: 'one', release: null,
      acceptance: { agreed: [{ id: 'R1', text: 'Tags are stored with each run' }, { id: 'R2', text: 'Tags show on the run page' }], entries: [{ id: 'R1', mark: 'met' }] } }),
    card('changes', { text: 'Keep the tags when a run is restarted', landing: { kind: 'follow-up', title: 'A follow-up on Run tags', start: 'Start the follow-up', target: pipelines.feature }, featureId: feature.id, pipelineId: pipelines.feature }),
    card('route', { text: 'Also export the tags as CSV', featureId: feature.id, featureTitle: 'Run tags', base: 'main', projectDir, tags: [], labels: [], guess: { choice: 'own', where: 'extra', reason: 'A new part' }, hasNext: false, primary: projectDir }),
    card('receipt', { kind: 'setting', label: 'Keep awake', target: 'keepAwake', before: 'Off', after: 'On', raw: { keepAwake: true }, revertible: true }, 'applied'),
    card('script-approval', { kind: 'run', key: 'count-lines', summary: 'Counts the lines of each file under src', displayName: 'Count lines', runtime: 'node', draft: { code: 'console.log(1)' }, values: {} }),
    card('seed-unknown-kind', { title: 'A card from a newer Worca' }),
  ]);

  // commands and files: one command, then two in one answer (a group), then a file Worca showed
  const cmds = thread('command'); threads.commands = cmds; threads.files = cmds;
  asked(cmds, 'What changed, and show me the readme');
  const command = (seq, cmd, summary) => card('command', { blockId: `t-5eed00c0de:${seq}`, sessionId: 'seed-session', seq, command: cmd, folder: projectName, cwd: projectDir, warning: null, summary }, 'command', { textAt: 0 });
  said(cmds, 'Checked the branch.', [command(1, 'git status --short', 'Checked what changed')]);
  said(cmds, 'Looked at the log and the diff.', [command(2, 'git log --oneline -5', 'Read the last commits'), command(3, 'git diff --stat', 'Counted the changed lines')]);
  const att = ask.addAttachment(cmds, null, { name: 'README.md', kind: 'text', mime: 'text/markdown', data: Buffer.from('# seed project\n') });
  need(att?.id, 'attachment');
  said(cmds, 'Here is the readme.', [card('files', { title: 'README.md', items: [{ attId: att.id, name: 'README.md', kind: 'text', mime: 'text/markdown', bytes: 15 }] }, 'shown', { textAt: 0 })]);

  // pull requests: one still to create; one opened, approved, passing and mergeable (the stub gh answers it), on its TaskCard
  const prs = thread('pr-pending'); threads.ready = prs;
  pipelines.pending = '5eed0004'; pipelines.ready = '5eed0005';
  pipeline(pipelines.pending, 'done', 'Add a pager to the audit log');
  asked(prs, 'Open a PR for the pager');
  said(prs, 'It is ready for a pull request.', [card('pull-request', { pipelineId: pipelines.pending, projectKey: key, title: 'Add a pager to the audit log', branch: `worca/${pipelines.pending}`, base: 'main' })]);
  const readyUrl = 'https://github.com/example/billing/pull/44';
  pipeline(pipelines.ready, 'done', 'Keep run tags on restart', readyUrl);
  const progress = card('progress', { pipelineId: pipelines.ready, runId: null, projectKey: key, title: 'Keep run tags on restart', label: 'Keep run tags on restart', status: 'done' }, 'tracked');
  said(prs, 'Following that task.', [progress]);
  ask.linkRun(prs, { runId: pipelines.ready, pipelineId: pipelines.ready, cardId: progress.id, status: null });
  // applied, as dev's PR receipt leaves it (receipt.mjs prCardResult): its result names the PR
  said(prs, 'Opened the pull request.', [card('pull-request', { pipelineId: pipelines.ready, projectKey: key, title: 'Keep run tags on restart', branch: `worca/${pipelines.ready}`, base: 'main', result: { url: readyUrl, draft: false, existed: false } }, 'applied')]);

  // change proposals: one of each kind, as their proposal modules write them
  const changes = thread('scope-switch');
  const KINDS = {
    'scope-switch': { reason: 'This sounds like one of your projects', summary: projectName, candidates: [{ projectKey: key, name: projectName, path: projectDir, vcs: 'git' }] },
    schedule: { action: 'move', id: 'tk_seed', itemKind: 'ticket', title: 'Nightly dependency bump', targetName: projectName, status: 'scheduled', note: 'You asked to start it an hour later', summary: 'Move Nightly dependency bump', before: { when: 'Today 02:00', at: '02:00' }, after: { when: 'Today 03:00', at: '03:00' }, patch: { runAt: '03:00' } },
    away: { level: 'user', set: { hours: ['18:00', '08:00'] }, unset: [], changes: [{ field: 'hours', label: 'Away hours', before: 'None', after: '18:00 to 08:00' }], summary: 'Away from 18:00 to 08:00', before: 'None', after: '18:00 to 08:00', note: 'Only what needs you reaches you then' },
    proxy: { kind: 'settings', patch: { upstream: 'http://proxy.corp.example:3128' }, changes: [{ field: 'upstream', label: 'Proxy', before: 'None', after: 'proxy.corp.example:3128' }], summary: 'Route tasks through the company proxy', restartNote: '', note: 'Downloads fail on the VPN' },
    web: { kind: 'web', summary: 'Read docs.example.com', host: 'docs.example.com', url: 'https://docs.example.com/api', reason: 'To read the API docs', change: { host: 'docs.example.com' } },
    clone: { kind: 'clone', summary: 'Clone example/billing', url: 'https://github.com/example/billing', branch: 'main', name: 'billing', dir: '~/src/billing', note: 'A new project', change: { url: 'https://github.com/example/billing' } },
    project: { kind: 'add', summary: 'Add the docs folder as a project', name: 'docs', path: projectDir, displayPath: projectDir, vcs: 'git', change: { path: projectDir } },
    workspace: { kind: 'create', summary: 'Make a workspace of billing and api', note: 'They change together', workspaceId: null, workspaceName: 'Billing and API', effects: [], warnings: [], followUps: [], name: 'Billing and API', members: [projectName, 'api'], change: { name: 'Billing and API' } },
    actions: { kind: 'project', summary: 'Add a dev server', note: '', changes: [{ op: 'add', label: 'Dev server', before: '', after: 'npm run dev' }], warnings: [], effects: [], projectKey: key, projectName, change: {} },
    metrics: { kind: 'enable', note: 'Team metrics for this project', projectKey: key, projectName, workspaceId: null, workspaceName: null, summary: 'Turn on team metrics', effects: [] },
    policy: { kind: 'enable', note: 'A shared team policy', projectKey: key, projectName, workspaceId: null, workspaceName: null, summary: 'Turn on a team policy', effects: [] },
  };
  asked(changes, 'Set up the rest for me');
  said(changes, 'Here is each change. Nothing changes until you apply it.', Object.entries(KINDS).map(([type, fields]) => { threads[type] = changes; return card(type, fields); }));

  // divider: a scope-switch answered through dev's own route switches the chat and writes the divider
  const sw = thread('divider');
  ask.updateThread(sw, { context: null });
  asked(sw, 'Who owns the cron parser?');
  const scope = card('scope-switch', KINDS['scope-switch']);
  said(sw, 'This sounds like one of your projects.', [scope]);
  await call('POST', `/api/ask/threads/${sw}/cards/${scope.id}`, { choice: key });
  const swMsgs = (await t(`/api/ask/threads/${sw}`)).messages;
  need(swMsgs.some((m) => (m.blocks || []).some((b) => b.kind === 'divider')), 'divider from answering the scope switch');
  return { threads, pipelines };
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
  // the PRs' host: the tasks seed's stub gh (passing, approved, mergeable), so the ready card reads Ready to merge
  const { installStubGh } = await import('./stillhet-seed-tasks.mjs');
  await installStubGh(path.join(home, 'bin'));
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
  for (const c of SEEDED_CARDS) console.log(`  ${base}/#chat/${out.threads[c.key]}  ${c.key}: ${c.card}`);
  console.log(`  live runs: question ${out.runs.question}, plan ${out.runs.plan}; saved: failed ${out.pipelines.failed}, PR ${out.pipelines.pr}`);
  console.log('The server stays up for the walk; Ctrl-C ends it.');
  await new Promise(() => {});
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });

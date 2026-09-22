// test/ui-ask-progress-card.test.mjs — the live run progress card driven from
// inside the real app shell: app.js's askRunStore seam (plan D1/D17/D23) feeding
// ask-panel's progress cards. Boot preamble copied from
// test/ui-ask-card.test.mjs:1-189 (the house convention: duplicated per suite,
// no shared harness), including the `runResponse` override, the `runBodies`
// recorder and the fetch arms feeding the card's option loaders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const TID = 'ask_00000001';
const MID = 'askm_00000001';

const WF_DEFAULT_TPL = { id: 'wf_default', name: 'Default', version: 2,
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
          { id: 'n_plan', kind: 'agent', key: 'planner', x: 300, y: 0, config: {} },
          { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: { model: 'claude-opus-5-5', effort: 'high' } },
          { id: 'n_rev', kind: 'agent', key: 'reviewer', x: 900, y: 0, config: {} },
          { id: 'n_end', kind: 'end', x: 1200, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_plan', port: 'task' } },
          { id: 'w2', from: { node: 'n_plan', port: 'plan' }, to: { node: 'n_impl', port: 'plan' } },
          { id: 'w3', from: { node: 'n_impl', port: 'diff' }, to: { node: 'n_rev', port: 'diff' } },
          { id: 'w4', from: { node: 'n_rev', port: 'review' }, to: { node: 'n_impl', port: 'revise' }, config: { maxCycles: 3 } },
          { id: 'w5', from: { node: 'n_rev', port: 'pass' }, to: { node: 'n_end', port: 'result' } }] };
// Ported metas (metaVersion 2), like the real /api/agents rows — the loop wire w4 is a
// loop only because the reviewer's `review` output is when:'blocking' (loops.mjs:90-91).
const AGENTS = [
  { key: 'planner', displayName: 'Plan', color: 'violet', metaVersion: 2, fanOut: false, asksQuestions: true, questionsLocked: false, questionsDefault: true,
    inputs: [{ id: 'task', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'plan', type: 'md', when: 'always' }] },
  { key: 'implementer', displayName: 'Implement', color: 'green', metaVersion: 2, fanOut: true, asksQuestions: true, questionsLocked: false, questionsDefault: false,
    inputs: [{ id: 'plan', type: 'md', required: true }, { id: 'revise', type: 'md', required: false, loop: true }],
    outputs: [{ id: 'diff', type: 'diff', when: 'always' }] },
  { key: 'reviewer', displayName: 'Review', color: 'peach', metaVersion: 2, fanOut: false, asksQuestions: false,
    verdict: { filename: 'review-cycle{cycle}.json' },
    inputs: [{ id: 'diff', type: 'diff', required: true }],
    outputs: [{ id: 'review', type: 'md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }] },
];
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-fable-5-1', label: 'Fable 5.1 (1M)', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false },
];
// The real GET /api/config envelope: {config, models, steps, efforts, subagentModels} (ui/server.mjs:3044-3050).
function configBody() {
  return { config: { steps: {}, customModels: [], workflows: {} }, models: MODELS, steps: [], efforts: ['medium', 'high', 'xhigh', 'max'],
    subagentModels: ['sonnet', 'opus', 'fable', 'auto', 'inherit'] };
}

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
  // FIRST: the thread-GET arm below matches with includes() and would swallow it.
  if (url.includes(`/api/ask/threads/${TID}/attachments/att_00000001`)) {
    return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('hello').buffer, json: async () => ({}) };
  }
  if (url.includes('/api/ask/models')) {
    return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false }], efforts: ['medium', 'high', 'xhigh', 'max'] }) };
  }
  if (url.includes(`/api/ask/threads/${TID}/messages`) && method === 'POST') {
    return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: MID }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`) && method === 'DELETE') {
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }
  if (url.includes(`/api/ask/threads/${TID}`)) {
    return { ok: true, status: 200, json: async () => ({ thread: { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} }, messages: [], attachments: [], runLinks: [], inFlight: null }) };
  }
  if (url.includes('/api/ask/threads') && method === 'POST') {
    return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
  }
  if (url.includes('/api/ask/threads')) {
    return { ok: true, status: 200, json: async () => ({ threads: [{ id: TID, title: 'T', updatedAt: 't', createdAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {}, runLinks: 0, inFlight: false }] }) };
  }
  return null;
}

// `workflows` is the LIVE list behind /api/workflows and /api/workflows/:id — a test
// mutates it between two card renders to model a row saved mid-chat.
async function boot({ url = 'http://localhost:4317/', runResponse = null, workflows = null } = {}) {
  const wfList = workflows || [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }];
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  const runBodies = [];
  window.fetch = (u, opts) => {
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    if (path.endsWith('/api/run') && method === 'POST') {
      runBodies.push(JSON.parse(opts.body));
      return Promise.resolve(runResponse || { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) });
    }
    // /api/workflows/:id serves the template for a LISTED id and 404s the rest, like the real route.
    const wfRow = path.match(/\/api\/workflows\/([^/]+)$/);
    if (wfRow) {
      return Promise.resolve(wfList.some((w) => w.id === wfRow[1])
        ? { ok: true, status: 200, json: async () => ({ ...WF_DEFAULT_TPL, id: wfRow[1] }) }
        : { ok: false, status: 404, json: async () => ({ error: 'workflow not found' }) });
    }
    if (path.endsWith('/api/agents')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: AGENTS, mockWriterRoles: [] }) });
    if (path.endsWith('/api/config') && method === 'GET') return Promise.resolve({ ok: true, status: 200, json: async () => configBody() });
    if (path.endsWith('/api/config') && (method === 'PATCH' || method === 'POST')) return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: configBody().config }) });
    // EXACT path match, not includes(): /api/workflows/:id is the per-workflow
    // config fetch — a substring test hands it the LIST envelope instead.
    if (path.endsWith('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [...wfList] }) });
    }
    if (path.endsWith('/api/guardrails')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ guardrails: [{ id: 'permissive', name: 'Permissive' }, { id: 'normal', name: 'Normal' }] }) });
    }
    if (path.endsWith('/api/workspaces')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workspaces: [{ id: 'wks-team-00000001', name: 'team', projectPaths: ['/repos/proj', '/repos/lib'], projectKeys: ['proj-00000001', 'lib-00000002'] }] }) });
    }
    if (path.endsWith('/api/branches')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ branches: ['main', 'dev'], current: 'main' }) });
    }
    if (url2.includes('/api/projects')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [{ name: 'proj', path: '/repos/proj', exists: true }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }) });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();
  // renderProjectOptions (app.js:5357-5386) restores the selection from
  // worca-cc.lastProject BY NAME and otherwise leaves the disabled placeholder
  // selected — with a cleared store selectedProjectPath() would be '' and the
  // page context would carry no projectDir. Seed the remembered name.
  window.localStorage.setItem('worca-cc.lastProject', 'proj');
  window.__worcaTestHooks = { askMarkdown: async () => { throw new Error('markdown disabled in integration'); } };

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv, runBodies };
}

async function settle(window, n = 4) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

async function openSheet(window) {
  window.document.querySelector('.ask-pill').click();
  await settle(window);
}
async function sendText(window, text) {
  const input = window.document.querySelector('textarea.ask-input');
  input.value = text;
  window.document.querySelector('[data-ask-send]').click();
  await settle(window, 6);
}

const CARD = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null, workflowId: 'wf_review', workflowName: 'Review only', guardrailsId: 'normal', brief: 'Fix the login bug', title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/fix-login', sourceBranchByKey: null, note: 'why', attachments: [] };
// The two exact-body pins above stay byte-identical: only these two tests carry a pill.
const ATT_CARD = { ...CARD, attachments: [{ id: 'att_00000001', name: 'notes.md', bytes: 5, kind: 'text' }] };
const WS_CARD ={ ...CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null, workspaceId: 'wks-team-00000001', workspaceName: 'team', members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }], sourceBranch: '', sourceBranchByKey: { 'lib-00000002': 'release' } };

async function openCard(ctx, card) {
  await openSheet(ctx.window);
  await sendText(ctx.window, 'please help');       // 202 wires the thread
  ctx.recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'proposed', card }, threadId: TID, messageId: MID, seq: 2 });
  await settle(ctx.window, 6); // options load
}

void ATT_CARD; void WS_CARD;   // copied with the harness; unused here

const agent = (id, key, color) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color,
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const MANIFEST = { version: 2, template: { id: 'wf_review', name: 'Review only' }, graph: { nodes: [agent('n_plan', 'planner', 'violet'), agent('n_rev', 'reviewer', 'peach'),
  { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_rev', port: 'task' }, loop: false }, { id: 'w2', from: { node: 'n_rev', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] }, bookends: { preflight: true, done: true } };
const STATE = (over = {}) => ({ runId: 'run-uuid-1', type: 'state', id: 'abcd1234', title: 'Fix login', status: 'running', startedAt: '2026-09-07T10:00:00.000Z', stepper: MANIFEST,
  steps: [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, cycle: 1, status: 'running', activeMs: 3000, runningSince: null, costUsd: 0.2, startedAt: '2026-09-07T10:00:01.000Z' }],
  active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }], totalCostUsd: 0.2, subAgents: [], ...over });

test('ui-ask-progress-card: a started card goes live from the run store, repaints on frames, freezes on done, and Open run closes the sheet', async () => {
  const ctx = await boot();
  const store = ctx.window.__np.askRunStore;
  assert.ok(store && typeof store.get === 'function', 'the store is on the test hook (assigned AFTER its declaration — never inside the 2183 literal)');
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  ctx.recv({ type: 'run-created', runId: 'run-uuid-1', title: 'Fix login', projectDir: '/repos/proj', kind: 'run', status: 'starting', startedAt: '2026-09-07T10:00:00.000Z' });
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'started', runId: 'run-uuid-1', card: CARD }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window);
  const el = ctx.window.document.querySelector('.ask-card.ask-rc');
  assert.ok(el);
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Starting');
  ctx.recv(STATE());
  await settle(ctx.window);
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Planner', 'the newest active agent, Running-list parity');
  assert.equal(el.querySelector('.ask-rc-pill').className, 'ask-rc-pill st-violet');
  assert.equal(el.querySelector('.ask-rc-prog').textContent, '0/2 agents');
  assert.equal(el.querySelector('.ask-rc-sub').textContent, 'proj · #abcd1234');
  const stage = el.querySelector('.ask-rc-graph .gv-stage');
  assert.ok(stage, 'the workflow graph is mounted from the live stepper');
  ctx.recv({ runId: 'run-uuid-1', type: 'done', status: 'done' });
  await settle(ctx.window);
  assert.equal(ctx.window.document.querySelector('.ask-card.ask-rc'), el, 'patched in place');
  assert.equal(el.querySelector('.ask-rc-graph .gv-stage'), stage, 'the mount survives the terminal frame');
  assert.equal(el.querySelector('.ask-rc-pill').textContent, 'Done');
  assert.equal(el.querySelector('a.ask-rc-open').getAttribute('href'), '#running/run-uuid-1', 'still in the live map');
  el.querySelector('a.ask-rc-open').click();
  await settle(ctx.window);
  assert.equal(ctx.window.document.querySelector('.ask-sheet').hidden, true, 'the sheet closed first');
  assert.equal(ctx.window.location.hash, '#running/run-uuid-1');
  assert.equal(store.byPipeline('abcd1234').runId, 'run-uuid-1');
  assert.equal(store.get('nope'), null);
});

test('ui-ask-progress-card: byPipeline prefers the live lineage when a superseded entry shares the pipeline id (D23)', async () => {
  const ctx = await boot();
  const store = ctx.window.__np.askRunStore;
  // The old lineage, paused — what another tab (or a History resume with no log lines to match) keeps in its Map.
  ctx.recv({ type: 'run-created', runId: 'run-old', title: 'Fix login', projectDir: '/repos/proj', kind: 'run', status: 'starting', startedAt: '2026-09-07T10:00:00.000Z' });
  ctx.recv(STATE({ runId: 'run-old', status: 'paused', active: [], steps: [] }));
  // The resume: a NEW run id for the SAME pipeline; run-created carries no pipeline id (server.mjs announceRun).
  ctx.recv({ type: 'run-created', runId: 'run-new', title: 'Fix login', projectDir: '/repos/proj', kind: 'run', status: 'starting', startedAt: '2026-09-07T10:05:00.000Z' });
  await settle(ctx.window);
  assert.equal(store.byPipeline('abcd1234').runId, 'run-old', 'before its first state the new lineage has no pipeline id yet');
  ctx.recv(STATE({ runId: 'run-new' }));
  await settle(ctx.window);
  assert.equal(store.byPipeline('abcd1234').runId, 'run-new', 'the live lineage wins over the superseded paused one that Map order lists first');
  assert.equal(store.get('run-old').status, 'paused', 'the old entry is still there (only the acting tab deletes it)');
  ctx.recv({ runId: 'run-new', type: 'done', status: 'done' });
  await settle(ctx.window);
  assert.equal(store.byPipeline('abcd1234').runId, 'run-new', 'both settled: the newest lineage wins');
});

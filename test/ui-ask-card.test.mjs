// test/ui-ask-card.test.mjs — the ask run-proposal card driven from inside the
// real app shell (spec §10.5 + §10.2 seam 7). Boot preamble copied from
// test/ui-ask-integration.test.mjs:1-115 (the house convention: duplicated per
// suite, no shared harness), with a `runResponse` override, a `runBodies`
// recorder and five extra fetch arms feeding the card's option loaders and the
// New-Pipeline form's workflow/guardrail/workspace/branch loaders.
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
          { id: 'n_impl', kind: 'agent', key: 'implementer', x: 600, y: 0, config: { model: 'claude-opus-5', effort: 'high' } },
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
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false },
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
    return { ok: true, status: 200, json: async () => ({ models: [{ id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'], custom: false }, { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], custom: false }], efforts: ['medium', 'high', 'xhigh', 'max'] }) };
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

test('ui-ask-card: Start posts the §9.4 body from inside the app; the page does not navigate', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  const before = ctx.window.location.hash;
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies.length, 1);
  assert.deepEqual(ctx.runBodies[0], {
    projectDir: '/repos/proj', prompt: 'Fix the login bug', workflowId: 'wf_review', guardrailsId: 'normal',
    title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/fix-login', mock: false,
    askThreadId: TID, askCardId: 'card_00000001',
  });
  assert.equal(ctx.window.location.hash, before, 'beginRun is never called — no navigation');
  // the flip frame renders the started link
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'started', runId: 'run-uuid-1', card: CARD }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window);
  assert.ok(ctx.window.document.querySelector('.ask-card a[href="#running/run-uuid-1"]'));
});

test('ui-ask-card: a 403 stays on the editable card with the error inline', async () => {
  const ctx = await boot({ runResponse: { ok: false, status: 403, json: async () => ({ error: 'total cost limit reached' }) } });
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.window.document.querySelector('.ask-card-err').textContent, 'total cost limit reached');
  assert.ok(ctx.window.document.querySelector('.ask-card-brief'), 'still editable');
});

test('ui-ask-card: Not now dismisses; the flip renders the stub', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('[data-ask-card-dismiss]').click();
  await settle(ctx.window, 4);
  assert.ok(ctx.calls.some((c) => c.url.includes(`/cards/card_00000001`) && c.opts.method === 'POST'));
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000001', state: 'dismissed', card: CARD }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window);
  assert.ok(ctx.window.document.querySelector('.ask-card-stub'));
});

test('ui-ask-card: Open in New Pipeline prefills the project form with the source forced to prompt', async () => {
  const ctx = await boot();
  await openCard(ctx, CARD);
  ctx.window.document.querySelector('.ask-card-brief').value = 'edited before handoff';
  ctx.window.document.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 8); // the async applier awaits workflows/guardrails/branches
  const doc = ctx.window.document;
  assert.equal(ctx.window.location.hash, '#new');
  assert.equal(doc.querySelector('.ask-sheet').hidden, true, 'the sheet closed');
  assert.equal(doc.querySelector('#prompt').value, 'edited before handoff');
  assert.equal(doc.querySelector('#title').value, 'Fix login');
  assert.equal(doc.querySelector('#workflowSelect').value, 'wf_review');
  assert.equal(doc.querySelector('#guardrailsSelect').value, 'normal');
  assert.equal(doc.querySelector('#featureBranch').value, 'worca/fix-login');
  assert.equal(doc.querySelector('#sourceBranch').value, 'dev');
  assert.equal(doc.querySelector('#advanced-config').open, true);
  assert.equal(doc.querySelector('#prompt-pane').classList.contains('hidden'), false, 'prompt source visible');
});

test('ui-ask-card: Open in New Pipeline for a workspace card selects the workspace and the member overrides', async () => {
  const ctx = await boot();
  await openCard(ctx, WS_CARD);
  ctx.window.document.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 10);
  const doc = ctx.window.document;
  assert.equal(ctx.window.location.hash, '#new');
  assert.equal(doc.querySelector('#workspaceSelect').value, 'wks-team-00000001');
  const member = [...doc.querySelectorAll('select.ws-src-select')].find((s) => s.dataset.projectKey === 'lib-00000002');
  assert.ok(member, 'per-member selects rebuilt');
  assert.equal(member.value, 'release');
});

test('ui-ask-card: a workspace card Start posts the workspace §9.4 body from inside the app', async () => {
  const ctx = await boot();
  await openCard(ctx, WS_CARD);
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.deepEqual(ctx.runBodies[0], {
    workspaceId: 'wks-team-00000001', prompt: 'Fix the login bug', workflowId: 'wf_review', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', sourceBranchByKey: { 'lib-00000002': 'release' },
    mock: false, askThreadId: TID, askCardId: 'card_00000001',
  });
  assert.notEqual(ctx.window.location.hash, '#running', 'no navigation');
});

test('ui-ask-card: Open in New Pipeline carries the attachment pills into the extras file list', async () => {
  const ctx = await boot();
  await openCard(ctx, ATT_CARD);
  await settle(ctx.window, 4);                       // the lane loaded
  ctx.window.document.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 12);                      // attachment fetch → prefill → view switch
  assert.equal(ctx.window.location.hash, '#new');
  const pills = [...ctx.window.document.querySelectorAll('#extrasPills .extra-pill .extra-pill-name')].map((p) => p.textContent);
  assert.deepEqual(pills, ['notes.md']);
  assert.equal(ctx.window.document.querySelector('#title').value, 'Fix login');
});

test('ui-ask-card: Start from inside the app writes the lane edits, then posts the §9.4 body + title + extras', async () => {
  const ctx = await boot();
  await openCard(ctx, ATT_CARD);
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  const before = ctx.window.location.hash;
  const sel = doc.querySelector('.ask-rp-tile[data-node-id="n_impl"] .ask-rp-model');
  assert.ok(sel, 'lane rendered inside the app');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  doc.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 10);
  const pathOf = (u) => u.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  const seq = ctx.calls
    .filter((c) => (c.opts.method || 'GET').toUpperCase() !== 'GET' && ['/api/config', '/api/run'].includes(pathOf(c.url)))
    .map((c) => `${c.opts.method.toUpperCase()} ${pathOf(c.url)}`);
  assert.deepEqual(seq, ['PATCH /api/config', 'POST /api/run']);
  assert.equal(ctx.runBodies[0].title, 'Fix login');
  assert.deepEqual(ctx.runBodies[0].extras, [{ name: 'notes.md', dataBase64: 'aGVsbG8=' }]);
  assert.equal(ctx.window.location.hash, before, 'the page does not navigate');
});

test('ui-ask-card: a handoff with no pills clears the extras the user picked earlier', async () => {
  const ctx = await boot();
  const doc = ctx.window.document;
  // Seed the New Pipeline form the way the OS picker does (the FileList is read-only).
  const input = doc.querySelector('#extras');
  Object.defineProperty(input, 'files', { value: [new ctx.window.File(['x'], 'stale.md', { type: 'text/plain' })], configurable: true });
  input.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  assert.deepEqual([...doc.querySelectorAll('#extrasPills .extra-pill-name')].map((p) => p.textContent), ['stale.md']);
  await openCard(ctx, CARD);                         // CARD carries no attachments
  await settle(ctx.window, 4);
  doc.querySelector('[data-ask-card-open-np]').click();
  await settle(ctx.window, 12);
  assert.equal(ctx.window.location.hash, '#new');
  assert.deepEqual([...doc.querySelectorAll('#extrasPills .extra-pill-name')].map((p) => p.textContent), [],
    'the handoff owns the extras list — the old pick must not upload into this run');
  assert.equal(doc.querySelector('#extrasPills').hidden, true);
  assert.equal(doc.querySelector('#extrasNote').textContent, 'Leave empty and the run gets no extra files.');
});

const listCalls = (ctx) => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/workflows')).length;

test('ui-ask-card: a card built after a workflow was saved refetches the lists — the select shows the new id and the lane loads it', async () => {
  const workflows = [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }];
  const ctx = await boot({ workflows });
  await openCard(ctx, CARD);
  const first = listCalls(ctx);
  assert.ok(first >= 1, 'the first card loaded the lists');
  // The workflow card saved a row seconds later; the panel-lifetime cache never saw it.
  workflows.push({ id: 'wf_implement-review', name: 'Implement + review' });
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: 'card_00000002', state: 'proposed', card: { ...CARD, workflowId: 'wf_implement-review', workflowName: 'Implement + review', title: 'Second' } }, threadId: TID, messageId: MID, seq: 3 });
  await settle(ctx.window, 6);
  assert.equal(listCalls(ctx), first + 1, 'the second card fetched /api/workflows again');
  const cards = [...ctx.window.document.querySelectorAll('.ask-card.ask-rp')];
  assert.equal(cards.length, 2);
  const second = cards[1];
  assert.equal(second.querySelector('.ask-card-workflow').value, 'wf_implement-review');
  assert.ok(ctx.calls.some((c) => c.url.split('?')[0].endsWith('/api/workflows/wf_implement-review')), 'the lane loaded the proposed workflow');
  assert.ok(second.querySelector('.ask-rp-agents'), 'the lane rendered its agents');
  assert.equal(second.querySelector('.ask-card-err').textContent, '');
  assert.equal(second.querySelector('[data-ask-card-start]').disabled, false);
  second.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies.length, 1);
  assert.equal(ctx.runBodies[0].workflowId, 'wf_implement-review');
});

test('ui-ask-card: a proposed workflowId no list serves fails loudly — inline error, no substitute selected, Start inert until the user picks', async () => {
  const ctx = await boot();
  await openCard(ctx, { ...CARD, workflowId: 'wf_ghost', workflowName: 'Ghost' });
  const card = ctx.window.document.querySelector('.ask-card.ask-rp');
  const sel = card.querySelector('.ask-card-workflow');
  const start = card.querySelector('[data-ask-card-start]');
  assert.equal(card.querySelector('.ask-card-err').textContent, 'Workflow wf_ghost is not available — pick one');
  assert.equal(sel.value, '', 'no other option is silently selected');
  assert.deepEqual([...sel.options].map((o) => o.value), ['wf_default', 'wf_review'], 'the served list is still offered');
  assert.equal(start.disabled, true);
  assert.equal(card.querySelector('.ask-rp-lane-msg').textContent, 'Could not load agent settings.', 'the lane never loads a substitute');
  start.click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies.length, 0, 'Start posts nothing while the proposed workflow is missing');
  sel.value = 'wf_review';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  await settle(ctx.window, 6);
  assert.equal(card.querySelector('.ask-card-err').textContent, '', 'the pick clears the error');
  assert.equal(start.disabled, false);
  assert.ok(card.querySelector('.ask-rp-agents'), 'the lane loaded the picked workflow');
  start.click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies.length, 1);
  assert.equal(ctx.runBodies[0].workflowId, 'wf_review', 'Start posts the id the USER picked, never a fallback');
});

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

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
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

async function boot({ url = 'http://localhost:4317/', runResponse = null } = {}) {
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
    // EXACT path match, not includes(): /api/workflows/:id is the per-workflow
    // config fetch — a substring test hands it the LIST envelope instead.
    if (path.endsWith('/api/workflows')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ workflows: [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }] }) });
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

const CARD = { target: 'project', projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj', workspaceId: null, workspaceName: null, members: null, workflowId: 'wf_review', workflowName: 'Review only', guardrailsId: 'normal', brief: 'Fix the login bug', title: 'Fix login', sourceBranch: 'dev', featureBranch: 'worca/fix-login', sourceBranchByKey: null };
const WS_CARD = { ...CARD, target: 'workspace', projectKey: null, projectName: null, projectDir: null, workspaceId: 'wks-team-00000001', workspaceName: 'team', members: [{ projectKey: 'proj-00000001', projectName: 'proj', projectDir: '/repos/proj' }, { projectKey: 'lib-00000002', projectName: 'lib', projectDir: '/repos/lib' }], sourceBranch: '', sourceBranchByKey: { 'lib-00000002': 'release' } };

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

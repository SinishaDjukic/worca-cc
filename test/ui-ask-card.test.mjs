// test/ui-ask-card.test.mjs — the ask run-proposal card driven from inside the
// real app shell (spec §10.5 + §10.2 seam 7). Boot preamble copied from
// test/ui-ask-integration.test.mjs:1-115 (the house convention: duplicated per
// suite, no shared harness), with a `runResponse` override, a `runBodies`
// recorder and five extra fetch arms feeding the card's option loaders and the
// New-Pipeline form's workflow/guardrail/workspace/branch loaders.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

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
async function boot({ url = 'http://localhost:4317/', runResponse = null, workflows = null, extra = null } = {}) {
  const wfList = workflows || [{ id: 'wf_default', name: 'Default' }, { id: 'wf_review', name: 'Review only' }];
  const dom = trackDom(new JSDOM(readFileSync(htmlPath, 'utf8'), { url }));
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
    const ex = extra ? extra(url2, opts) : null;
    if (ex) return Promise.resolve(ex);
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    if (path.endsWith('/api/run') && method === 'POST') {
      runBodies.push(JSON.parse(opts.body));
      const r = typeof runResponse === 'function' ? runResponse(runBodies.length) : runResponse;
      return Promise.resolve(r || { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) });
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
  // worca Chat: the chat is a page and the boot page; route there only when the test left it.
  if (!/^#chat(\/|$)/.test(window.location.hash)) window.location.hash = '#chat';
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

test('ui-ask-card: a 409 sync refusal asks once — the remote choice resends with syncPolicy, Cancel posts nothing more (#527)', async () => {
  await checkRows([
    { name: 'ui-ask-card: a 409 sync-diverged asks once, then resends with syncPolicy (no syncBeforeStart) (#527)', run: async () => {
      const refusal = { code: 'sync-diverged', error: 'dev diverged', options: ['origin', 'cancel'],
        members: [{ projectKey: 'proj-00000001', base: 'dev', remote: 'origin', ahead: 1, behind: 2 }] };
      const ctx = await boot({ runResponse: (n) => (n === 1 ? { ok: false, status: 409, json: async () => refusal } : null) });
      await openCard(ctx, CARD);
      ctx.window.document.querySelector('[data-ask-card-start]').click();
      await settle(ctx.window, 6);
      const go = [...ctx.window.document.querySelectorAll('.sync-modal button')].find((b) => b.textContent === 'Start from origin/dev');
      assert.ok(go, 'the refusal card offers the remote start');
      go.click();
      await settle(ctx.window, 6);
      assert.equal(ctx.runBodies.length, 2);
      assert.equal(ctx.runBodies[1].syncPolicy, 'origin');
      assert.equal('syncBeforeStart' in ctx.runBodies[1], false, 'the project default applies');
      assert.equal(ctx.window.document.querySelector('.ask-card-err').textContent, '');
    } },
    { name: 'ui-ask-card: cancelling the sync refusal posts nothing more and says so (#527)', run: async () => {
      const refusal = { code: 'sync-fetch-failed', error: 'offline', options: ['last-fetch', 'cancel'], fetchKind: 'network',
        members: [{ projectKey: 'proj-00000001', base: 'dev', remote: 'origin', fetchKind: 'network' }] };
      const ctx = await boot({ runResponse: () => ({ ok: false, status: 409, json: async () => refusal }) });
      await openCard(ctx, CARD);
      ctx.window.document.querySelector('[data-ask-card-start]').click();
      await settle(ctx.window, 6);
      const cancel = [...ctx.window.document.querySelectorAll('.sync-modal button')].find((b) => b.textContent === 'Cancel');
      cancel.click();
      await settle(ctx.window, 6);
      assert.equal(ctx.runBodies.length, 1);
      assert.equal(ctx.window.document.querySelector('.ask-card-err').textContent, 'Start cancelled.');
    } },
  ]);
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

test('ui-ask-card: Open in New Pipeline prefills the form — project fields, or the workspace + member source overrides', async () => {
  await checkRows([
    { name: 'ui-ask-card: Open in New Pipeline prefills the project form with the source forced to prompt', run: async () => {
      const ctx = await boot();
      await openCard(ctx, CARD);
      ctx.window.document.querySelector('.ask-card-brief').value = 'edited before handoff';
      ctx.window.document.querySelector('[data-ask-card-open-np]').click();
      await settle(ctx.window, 8); // the async applier awaits workflows/guardrails/branches
      const doc = ctx.window.document;
      assert.equal(ctx.window.location.hash, '#new');
      assert.equal(doc.querySelector('section[data-view="chat"]').classList.contains('hidden'), true, 'New run replaced the Chat page');
      assert.equal(doc.querySelector('#prompt').value, 'edited before handoff');
      assert.equal(doc.querySelector('#title').value, 'Fix login');
      assert.equal(doc.querySelector('#workflowSelect').value, 'wf_review');
      assert.equal(doc.querySelector('#guardrailsSelect').value, 'normal');
      assert.equal(doc.querySelector('#featureBranch').value, 'worca/fix-login');
      assert.equal(doc.querySelector('#sourceBranch').value, 'dev');
      assert.equal(doc.querySelector('#advanced-config').open, true);
      assert.equal(doc.querySelector('#prompt-pane').classList.contains('hidden'), false, 'prompt source visible');
    } },
    { name: 'ui-ask-card: Open in New Pipeline for a workspace card selects the workspace and the member overrides', run: async () => {
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
    } },
  ]);
});

test('ui-ask-card: a workspace card Start posts the workspace §9.4 body from inside the app', async () => {
  const ctx = await boot();
  await openCard(ctx, WS_CARD);
  // Captured before the click: a bare '#running' is normalized to '#runs' now, so comparing
  // against either literal would pass even if Start navigated somewhere.
  const before = ctx.window.location.hash;
  ctx.window.document.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.deepEqual(ctx.runBodies[0], {
    workspaceId: 'wks-team-00000001', prompt: 'Fix the login bug', workflowId: 'wf_review', guardrailsId: 'normal',
    title: 'Fix login', featureBranch: 'worca/fix-login', sourceBranchByKey: { 'lib-00000002': 'release' },
    mock: false, askThreadId: TID, askCardId: 'card_00000001',
  });
  assert.equal(ctx.window.location.hash, before, 'no navigation');
});

test('ui-ask-card: the handoff owns the extras list — card pills arrive, a stale earlier pick is cleared', async () => {
  await checkRows([
    { name: 'ui-ask-card: Open in New Pipeline carries the attachment pills into the extras file list', run: async () => {
      const ctx = await boot();
      await openCard(ctx, ATT_CARD);
      await settle(ctx.window, 4);                       // the lane loaded
      ctx.window.document.querySelector('[data-ask-card-open-np]').click();
      await settle(ctx.window, 12);                      // attachment fetch → prefill → view switch
      assert.equal(ctx.window.location.hash, '#new');
      const pills = [...ctx.window.document.querySelectorAll('#extrasPills .extra-pill .extra-pill-name')].map((p) => p.textContent);
      assert.deepEqual(pills, ['notes.md']);
      assert.equal(ctx.window.document.querySelector('#title').value, 'Fix login');
    } },
    { name: 'ui-ask-card: a handoff with no pills clears the extras the user picked earlier', run: async () => {
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
    } },
  ]);
});

test('ui-ask-card: with "Save as project defaults" on, Start from inside the app writes the lane edits, then posts the §9.4 body + title + extras', async () => {
  const ctx = await boot();
  await openCard(ctx, ATT_CARD);
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  const before = ctx.window.location.hash;
  const sel = doc.querySelector('.ask-rp-tile[data-node-id="n_impl"] .ask-rp-model');
  assert.ok(sel, 'lane rendered inside the app');
  const sw = doc.querySelector('.ask-rp-lane [data-ctl="saveDefaults"]');
  sw.checked = true;
  sw.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
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
  assert.equal(card.querySelector('.ask-card-err').textContent, 'Workflow wf_ghost is not available: pick one');
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

test('ui-ask-card: a sameAsSource card shows the checkbox on, disables the feature input, and Start posts the flag', async () => {
  const ctx = await boot();
  await openCard(ctx, { ...CARD, sameAsSource: true });
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('.ask-card-same-source').checked, true);
  assert.equal(doc.querySelector('.ask-card-feature').disabled, true);
  doc.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  assert.equal(ctx.runBodies[0].sameAsSource, true);
  assert.equal('featureBranch' in ctx.runBodies[0], false);
});

test('ui-ask-card: by default Start sends the lane edit as THIS run\'s overlay and writes no project config', async () => {
  const ctx = await boot();
  await openCard(ctx, ATT_CARD);
  await settle(ctx.window, 8);
  const doc = ctx.window.document;
  const sel = doc.querySelector('.ask-rp-tile[data-node-id="n_impl"] .ask-rp-model');
  sel.value = 'claude-haiku-4-5';
  sel.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  doc.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 10);
  const pathOf = (u) => u.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
  const seq = ctx.calls
    .filter((c) => (c.opts.method || 'GET').toUpperCase() !== 'GET' && ['/api/config', '/api/run'].includes(pathOf(c.url)))
    .map((c) => `${c.opts.method.toUpperCase()} ${pathOf(c.url)}`);
  assert.deepEqual(seq, ['POST /api/run']);
  assert.equal(ctx.runBodies[0].overlay.nodes.n_impl.model, 'claude-haiku-4-5');
});

const DRAFT_CARD = { type: 'agent-draft', sessionId: null, docToken: null, then: null,
  draft: { key: 'releaseNotes', markdown: '---\nname: releaseNotes\n---\n\nWrite notes.',
    meta: { metaVersion: 2, key: 'releaseNotes', displayName: 'Release Notes', description: 'Writes notes.', runnerType: 'producer', color: 'blue', domain: 'general',
      inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }] } } };

test('ui-ask-card: an agent draft in Ask saves through POST /api/agents (the Workflows chat\'s action) and records saved with its key — no event turn', async () => {
  const posts = [];
  const ctx = await boot({ extra: (url, opts) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    if (url.split('?')[0].endsWith('/api/agents') && method === 'POST') { posts.push(['agents', JSON.parse(opts.body)]); return { ok: true, status: 201, json: async () => ({ meta: { key: 'releaseNotes' } }) }; }
    if (/\/cards\/card_00000001$/.test(url) && method === 'POST') { posts.push(['card', JSON.parse(opts.body)]); return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: 'card_00000001', state: 'saved' } }) }; }
    return null;
  } });
  await openCard(ctx, DRAFT_CARD);
  const card = ctx.window.document.querySelector('.ask-ccard [aria-label="New agent"]');
  assert.ok(card, 'app.js mounts the draft card in the chat');
  [...card.querySelectorAll('button')].find((b) => b.textContent === 'Save agent').click();
  await settle(ctx.window, 8);
  assert.deepEqual(posts.map((p) => p[0]), ['agents', 'card']);
  assert.equal(posts[0][1].meta.key, 'releaseNotes');
  assert.equal(posts[0][1].markdown, DRAFT_CARD.draft.markdown);
  assert.deepEqual(posts[1][1], { state: 'saved', card: { savedKey: 'releaseNotes' } });
});

function cardsApi(posts, agents) {
  return (url, opts) => {
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url.split('?')[0];
    if (path.endsWith('/api/agents') && method === 'POST') { const b = JSON.parse(opts.body); posts.push(['agents', b]); agents.push(b.meta); return { ok: true, status: 201, json: async () => ({ meta: { key: b.meta.key } }) }; }
    if (path.endsWith('/api/agents') && method === 'GET') return { ok: true, status: 200, json: async () => ({ agents: [...agents], mockWriterRoles: [] }) };
    if (path.endsWith('/api/scripts') && method === 'POST') { const b = JSON.parse(opts.body); posts.push(['scripts', b]); return { ok: true, status: 201, json: async () => ({ meta: { key: b.meta.key } }) }; }
    if (/\/api\/scripts\/[^/]+\/cases$/.test(path) && method === 'PUT') { posts.push(['cases', JSON.parse(opts.body)]); return { ok: true, status: 200, json: async () => ({ cases: [] }) }; }
    const m = /\/cards\/([^/]+)$/.exec(path);
    if (m && method === 'POST') { posts.push(['card', m[1], JSON.parse(opts.body)]); return { ok: true, status: 200, json: async () => ({ block: { kind: 'card', id: m[1], state: 'saved' }, turn: null }) }; }
    return null;
  };
}
async function openCards(ctx, blocks) {
  await openSheet(ctx.window);
  await sendText(ctx.window, 'please help');
  ctx.recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  blocks.forEach((block, i) => ctx.recv({ type: 'ask-card', block, threadId: TID, messageId: MID, seq: i + 2 }));
  await settle(ctx.window, 8);
}
const pressIn = (w, id, text) => [...w.document.querySelector(`.ask-ccard[data-card-id="${id}"]`).querySelectorAll('button')].find((b) => b.textContent === text).click();
const BUILD_CARD = { type: 'workflow-build', sessionId: null, docToken: null, name: 'Notes flow', domain: 'coding', reasoning: 'r',
  workflow: { nodes: WF_DEFAULT_TPL.nodes, wires: WF_DEFAULT_TPL.wires }, counts: { agents: 3, scripts: 0, loops: 1 }, loops: [], drafts: [], todo: 0, warnings: [] };

test('ui-ask-card: Open in Workflows on a graph card saves its draft, then opens the graph as a NEW unsaved workflow — once', async () => {
  const posts = [];
  const ctx = await boot({ extra: cardsApi(posts, [...AGENTS]) });
  const w = ctx.window;
  await openCards(ctx, [{ kind: 'card', id: 'card_00000001', state: 'proposed', card: DRAFT_CARD },
    { kind: 'card', id: 'card_00000002', state: 'proposed', card: { ...BUILD_CARD, drafts: ['releaseNotes'] } }]);
  assert.equal(w.__gv(), null, 'the Workflows view was never mounted');
  pressIn(w, 'card_00000002', 'Open in Workflows');
  await settle(w, 24);
  assert.deepEqual(posts.map((p) => p[0] === 'card' ? `card ${p[1]}` : p[0]), ['agents', 'card card_00000001'], 'the draft first; the graph card is not recorded');
  assert.equal(w.location.hash, '#workflows');
  const t = w.__gv().c.template();
  assert.deepEqual([t.name, t.id, t.nodes.length, t.wires.length, w.__gv().c.isDirty()], ['Notes flow', '', WF_DEFAULT_TPL.nodes.length, WF_DEFAULT_TPL.wires.length, true]);
  w.location.hash = '#chat'; await settle(w, 8);
  w.location.hash = '#workflows'; await settle(w, 16);
  assert.ok(w.document.getElementById('confirm-modal').classList.contains('hidden'), 'a later visit does not open the graph again');
});

test('ui-ask-card: Open in Workflows over a canvas with unsaved edits asks first — Cancel keeps that canvas', async () => {
  const posts = [];
  const ctx = await boot({ extra: cardsApi(posts, [...AGENTS]) });
  const w = ctx.window;
  w.location.hash = '#workflows'; await settle(w, 16);
  w.__gv().c.loadDraft({ name: 'Mine unsaved', domain: 'coding', nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 300, y: 0, config: {} }], wires: [] });
  await openCards(ctx, [{ kind: 'card', id: 'card_00000003', state: 'proposed', card: BUILD_CARD }]);
  pressIn(w, 'card_00000003', 'Open in Workflows');
  await settle(w, 24);
  assert.equal(w.document.getElementById('confirm-modal').classList.contains('hidden'), false, 'the discard prompt');
  w.document.getElementById('confirm-cancel').click();
  await settle(w, 8);
  assert.equal(w.__gv().c.template().name, 'Mine unsaved');
});

test('ui-ask-card: a script draft saves through POST /api/scripts and its cases; Edit… opens each draft in its wizard', async () => {
  const posts = [];
  const SCRIPT_CARD = { type: 'script-draft', sessionId: null, docToken: null, then: null,
    draft: { key: 'lintIt', source: 'console.log(1)', cases: [{ id: 'c1', name: 'one', inputs: {} }],
      meta: { metaVersion: 2, key: 'lintIt', displayName: 'Lint it', runtime: 'node', inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always' }] } } };
  const ctx = await boot({ extra: cardsApi(posts, [...AGENTS]) });
  const w = ctx.window;
  await openCards(ctx, [{ kind: 'card', id: 'card_00000004', state: 'proposed', card: SCRIPT_CARD }, { kind: 'card', id: 'card_00000005', state: 'proposed', card: DRAFT_CARD }]);
  pressIn(w, 'card_00000004', 'Save script');
  await settle(w, 10);
  assert.deepEqual(posts.map((p) => p[0]), ['scripts', 'cases', 'card']);
  assert.equal(posts[0][1].source, 'console.log(1)');
  assert.deepEqual(posts[2][2], { state: 'saved', card: { savedKey: 'lintIt' } });
  pressIn(w, 'card_00000005', 'Edit…');
  await settle(w, 16);
  assert.equal(w.location.hash, '#workflows/agents/new');
  assert.equal(w.document.getElementById('agw-name').value, 'Release Notes');
  w.location.hash = '#chat'; await settle(w, 8);
  pressIn(w, 'card_00000004', 'Edit…');
  await settle(w, 20);
  assert.equal(w.location.hash, '#workflows/scripts/new/node');
  assert.deepEqual(w.__scripts.ctl().pendingCases(), SCRIPT_CARD.draft.cases);
});

test('ui-ask-card: a card from a preset says so, and Start posts presetId with the preset\'s hidden picks', async () => {
  const preset = { id: 'rp_aaaaaaaaaaaa', name: 'Quick fix', workflowId: 'wf_review',
    setup: { humanInLoop: false, nightMode: true, overlay: { wires: { w_review: { maxCycles: 2 } } } } };
  const ctx = await boot();
  await openCard(ctx, { ...CARD, preset });
  const doc = ctx.window.document;
  assert.match(doc.querySelector('.ask-card-preset').textContent, /From preset Quick fix/);
  doc.querySelector('[data-ask-card-start]').click();
  await settle(ctx.window, 6);
  const body = ctx.runBodies.at(-1);
  assert.equal(body.presetId, 'rp_aaaaaaaaaaaa');
  assert.equal(body.nightMode, true);
  assert.equal(body.humanInLoop, false);
  assert.deepEqual(body.overlay, { wires: { w_review: { maxCycles: 2 } } });
});

// test/ui-ask-workflow-card.test.mjs — the ask WORKFLOW card (building/proposed/saved/declined/failed), the chip picker and the synthetic notice row, in the app shell.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { proposalFor } from './helpers/auto-proposal-fixture.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { checkRows } from './helpers/rows.mjs';
import { flowPerRow } from '../src/shared/graph/flow-layout.mjs';

// Release each booted window after its test (see test/helpers/jsdom-release.mjs).
const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const TID = 'ask_00000001';
const MID = 'askm_00000001';

function askArms(url, opts) {
  const method = ((opts && opts.method) || 'GET').toUpperCase();
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

async function boot({ url = 'http://localhost:4317/', runResponse = null } = {}) {
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
  const cardPosts = [];
  const runBodies = [];
  window.fetch = (u, opts) => {
    const url2 = String(u);
    calls.push({ url: url2, opts: opts || {} });
    // P3: the workflow card's POSTs — BEFORE askArms, whose thread arm would otherwise swallow them (askArms :30).
    if (/\/api\/ask\/threads\/[^/]+\/cards\//.test(url2.split('?')[0]) && (((opts && opts.method) || 'GET').toUpperCase() === 'POST')) {
      cardPosts.push(JSON.parse(opts.body));
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ block: {}, turn: null }) });
    }
    const ask = askArms(url2, opts);
    if (ask) return Promise.resolve(ask);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const path = url2.split('?')[0];
    if (path.endsWith('/api/run') && method === 'POST') {
      runBodies.push(JSON.parse(opts.body));
      return Promise.resolve(runResponse || { ok: true, status: 200, json: async () => ({ runId: 'run-uuid-1' }) });
    }
    // The saved card's "Open in Workflows" reads the row it minted — an EMPTY graph on purpose.
    if (/\/api\/workflows\/wf_rename-fix$/.test(path)) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ id: 'wf_rename-fix', name: 'Rename fix', version: 2, domain: 'coding', origin: 'auto', nodes: [], wires: [] }) });
    }
    if (path.endsWith('/api/agents')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ agents: [] }) });
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
  return { window, calls, cardPosts, recv, runBodies };
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

const CID = 'card_0000ab01';
const wfCard = (over = {}) => ({ type: 'workflow', mode: 'task', projectKey: 'proj-00000001', projectName: 'proj', note: 'A note', thenRun: true, shape: { name: 'x', stages: [] }, summary: 's', ...proposalFor(), ...over });
async function openBuilding(ctx) {
  await openSheet(ctx.window);
  await sendText(ctx.window, 'please help');
  ctx.recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
  ctx.recv({ type: 'ask-card', block: { kind: 'card', id: CID, state: 'building', card: { type: 'workflow', mode: 'task', task: 'x', projectKey: 'proj-00000001', projectName: null, name: '', note: '', thenRun: true, trace: { step: 1, startedAt: 't' } } }, threadId: TID, messageId: MID, seq: 2 });
  await settle(ctx.window, 4);
}
const flip = (ctx, seq, block) => { ctx.recv({ type: 'ask-card', block: { kind: 'card', id: CID, ...block }, threadId: TID, messageId: MID, seq }); };
// The turn's terminal frame (test/ask-panel-live-meters.test.mjs's shape) — a saved card
// is asserted across it: its footer never grows a verb once the turn ends.
const DONE = { type: 'ask-done', text: 'ok', blocks: [], usage: { input: 1, output: 1, cacheRead: 0, cacheCreation: 0 }, costUsd: 0, durationMs: 5, model: 'm', status: 'done', threadTotals: { costUsd: 0, input: 1, output: 1, cacheRead: 0, cacheCreation: 0, turns: 1, agents: 0 } };

test('building → proposed: the trace renders first; the flip mounts the REAL graph in the same cached slot, chips are buttons, the primary reads "Save & propose run"; a later frame keeps the element and the edited name', async () => {
  const ctx = await boot();
  await openBuilding(ctx);
  const building = ctx.window.document.querySelector('[data-ask-wfcard="building"]');
  assert.ok(building); assert.equal(building.querySelectorAll('.ask-wfcard-step').length, 4);
  assert.equal(building.querySelector('.ask-wfcard-title').textContent, 'Proposed workflow');
  flip(ctx, 3, { state: 'proposed', card: wfCard() });
  await settle(ctx.window, 6);
  assert.equal(ctx.window.document.querySelector('[data-ask-wfcard="building"]'), null, 'the building element is gone');
  const el = ctx.window.document.querySelector('[data-ask-wfcard="proposed"]');
  assert.ok(el);
  const p = proposalFor();
  assert.equal(el.querySelectorAll('.ask-wfcard-graph .node').length, p.manifest.graph.nodes.length, 'the real manifest is mounted');
  assert.equal(el.__wf.handle.graph.flowLayout().perRow, flowPerRow(702), '702 default width in jsdom (clientWidth 0)');
  assert.equal(el.querySelector('.ask-wfcard-graph .bchip.model').tagName, 'BUTTON', 'chips are pickable on a NEW-row card');
  assert.equal(el.querySelector('[data-ask-wf-save]').textContent.trim(), 'Save & propose run');
  assert.ok(el.querySelector('[data-ask-wf-decline]'));
  assert.equal(el.querySelector('.ask-wfcard-reason').textContent, p.reasoning, 'the classifier reasoning wins over the note');
  el.querySelector('.ask-wfcard-edit').click();
  const field = el.querySelector('.ask-wfcard-field'); field.value = 'Renamed by me';
  field.dispatchEvent(new ctx.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  ctx.recv({ type: 'ask-delta', text: 'still typing', threadId: TID, messageId: MID, seq: 4 });
  await settle(ctx.window, 6);
  const again = ctx.window.document.querySelector('[data-ask-wfcard="proposed"]');
  assert.equal(again, el, 'streaming re-renders keep the cached element');
  assert.equal(again.querySelector('.ask-wfcard-name').textContent, 'Renamed by me');
  again.querySelector('[data-ask-wf-save]').click();
  await settle(ctx.window, 4);
  assert.deepEqual(ctx.cardPosts, [{ state: 'saved', name: 'Renamed by me', nodes: {} }]);
});

test('chip picker: the model chip opens a menu in the sheet; picking a model repaints the band and Save posts the DIFF; the effort pill too', async () => {
  const ctx = await boot();
  await openBuilding(ctx);
  flip(ctx, 3, { state: 'proposed', card: wfCard() });
  await settle(ctx.window, 6);
  const el = ctx.window.document.querySelector('[data-ask-wfcard="proposed"]');
  const p = proposalFor();
  const nodeId = p.order[0];                                    // proposal.order = AGENT ids (the fixture's clarify: claude-sonnet-5 · medium)
  const chip = el.querySelector(`[data-node-id="${nodeId}"] .bchip.model`);
  chip.click();
  await settle(ctx.window, 2);
  const pop = ctx.window.document.querySelector('.ask-sheet .ask-pop-chip');
  assert.ok(pop, 'the popover lives in the sheet'); assert.equal(chip.getAttribute('aria-expanded'), 'true');
  const items = [...pop.querySelectorAll('.ask-model-item')];
  assert.deepEqual(items.map((i) => i.textContent.replace('✓', '').trim()), p.models.map((m) => m.label));
  assert.ok(items.every((i) => i.getAttribute('role') === 'menuitem'), 'menuitem: the panel\'s arrow-key nav selects that role (PD28)');
  items.find((i) => i.textContent.includes('Opus 5.5')).click();
  await settle(ctx.window, 2);
  assert.equal(ctx.window.document.querySelector('.ask-pop-chip'), null, 'picking closes');
  assert.equal(el.querySelector(`[data-node-id="${nodeId}"] .bchip.model`).textContent, 'Opus 5.5');
  assert.equal(el.querySelector(`[data-node-id="${nodeId}"] .bchip.effort`).textContent, 'medium', 'the fixture\'s "medium" is offered by Opus 5.5 ⇒ kept (else the model\'s second effort)');
  el.querySelector('[data-ask-wf-save]').click();
  await settle(ctx.window, 4);
  assert.deepEqual(ctx.cardPosts.at(-1), { state: 'saved', name: p.name, nodes: { [nodeId]: { model: 'claude-opus-5-5' } } }, 'a DIFF: the unchanged effort is not posted');
  el.querySelector(`[data-node-id="${nodeId}"] .bchip.effort`).click();
  await settle(ctx.window, 2);
  [...ctx.window.document.querySelectorAll('.ask-pop-chip .ask-effort-pill')].find((b) => b.textContent === 'high').click();
  await settle(ctx.window, 2);
  el.querySelector('[data-ask-wf-save]').click();
  await settle(ctx.window, 4);
  assert.deepEqual(ctx.cardPosts.at(-1).nodes, { [nodeId]: { model: 'claude-opus-5-5', effort: 'high' } });
});

test('saved workflow card: graph stays with inert chips, footer is Open in Workflows alone (no paid-turn verb, also after ask-done), Open reads the row; declined/failed are stubs', async () => {
  await checkRows([
    { name: 'saved: head "Saved workflow" + Auto tag + the check line; Open in Workflows navigates to #composer and reads the row; declined/failed are stubs', run: async () => {
      const ctx = await boot();
      await openBuilding(ctx);
      flip(ctx, 3, { state: 'proposed', card: wfCard() });
      await settle(ctx.window, 6);
      flip(ctx, 4, { state: 'saved', workflowId: 'wf_rename-fix', card: wfCard({ name: 'Rename fix', adopted: false, match: { id: 'wf_rename-fix', name: 'Rename fix' } }) });
      await settle(ctx.window, 6);
      assert.equal(ctx.window.document.querySelector('[data-ask-wfcard="proposed"]'), null);
      const el = ctx.window.document.querySelector('[data-ask-wfcard="saved"]');
      assert.equal(el.querySelector('.ask-wfcard-title').textContent, 'Saved workflow');
      assert.equal(el.querySelector('.ask-wfcard-tag').textContent, 'Auto');
      assert.equal(el.querySelector('.ask-wfcard-saved span').textContent, 'Rename fix');
      assert.equal(el.querySelector('.ask-wfcard-savedline').textContent, 'Saved as a new workflow, tagged Auto');
      assert.ok(el.querySelector('.ask-wfcard-graph .node'), 'the graph stays'); assert.equal(el.querySelector('.ask-wfcard-graph .bchip.model').tagName, 'SPAN', 'chips inert');
      assert.equal(el.querySelector('.ask-wfcard-match'), null, 'no match line on a saved card');
      assert.equal(el.querySelector('[data-ask-wf-run]'), null, 'no "Run with this": the save already fired the event turn, which proposes (thenRun) or offers (chat) the run');
      el.querySelector('[data-ask-wf-open]').click();
      await settle(ctx.window, 8);
      assert.equal(ctx.window.location.hash, '#workflows', '#workflows/<id> opens the row and normalises the hash');
      assert.ok(ctx.calls.some((c) => /\/api\/workflows\/wf_rename-fix$/.test(c.url.split('?')[0])), 'the row is read for openTemplate');
      flip(ctx, 5, { state: 'declined', card: wfCard({ name: 'Nope' }) });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('.ask-card-stub').textContent, 'Declined — Nope');
      flip(ctx, 6, { state: 'failed', error: 'classifier returned an unknown agent "e2e-tester"', card: { type: 'workflow', mode: 'task' } });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('.ask-card-stub.ask-card-failed').textContent, 'Proposal failed: classifier returned an unknown agent "e2e-tester"');
    } },
    { name: 'saved card footer is "Open in Workflows" alone, while the turn streams and after ask-done — no card verb starts a paid turn, the event turn proposes or offers the run', run: async () => {
      const ctx = await boot();
      await openBuilding(ctx);
      flip(ctx, 3, { state: 'proposed', card: wfCard() });
      await settle(ctx.window, 6);
      const savedBlock = { kind: 'card', id: CID, state: 'saved', workflowId: 'wf_rename-fix', card: wfCard({ name: 'Rename fix', adopted: false, match: { id: 'wf_rename-fix', name: 'Rename fix' } }) };
      flip(ctx, 4, savedBlock);
      await settle(ctx.window, 6);
      const footer = () => [...ctx.window.document.querySelector('[data-ask-wfcard="saved"] .ask-wfcard-actions').children].map((c) => `${c.tagName}:${c.textContent}`);
      assert.deepEqual(footer(), ['BUTTON:Open in Workflows'], 'one button, no spacer, no "Run with this"');
      // ask-done replaces the row's blocks wholesale, so the terminal frame carries the card.
      ctx.recv({ ...DONE, blocks: [savedBlock], threadId: TID, messageId: MID, seq: 5 });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('[data-ask-wf-run]'), null, 'nothing comes back once the turn ends');
      assert.deepEqual(footer(), ['BUTTON:Open in Workflows']);
      assert.equal(ctx.cardPosts.length, 0, 'no card verb was posted');
    } },
  ]);
});

test('target line: a muted line under the card head names the workspace (or project) in building, proposed, saved, declined and failed; an old card with neither field shows none', async () => {
  const WS = { workspaceId: 'wks-team-00000001', workspaceName: 'Team' };
  const targetText = (sel) => { const el = ctx.window.document.querySelector(sel); return el ? (el.querySelector('[data-ask-wf-target]') || {}).textContent ?? null : undefined; };
  let ctx;
  await checkRows([
    { name: 'workspace card: "workspace · Team" while building, "· 2 projects" once proposed, and on through saved/declined/failed', run: async () => {
      ctx = await boot();
      await openSheet(ctx.window);
      await sendText(ctx.window, 'please help');
      ctx.recv({ type: 'ask-start', userMessageId: 'askm_u0000001', model: 'm', effort: 'high', startedAt: 't', threadId: TID, messageId: MID, seq: 1 });
      flip(ctx, 2, { state: 'building', card: { type: 'workflow', mode: 'task', task: 'x', ...WS, name: '', note: '', thenRun: true, trace: { step: 1, startedAt: 't' } } });
      await settle(ctx.window, 4);
      assert.equal(targetText('[data-ask-wfcard="building"]'), 'workspace · Team');
      // The proposed workspace card: the node's fanOutLocked shows the read-only "per project" band flag.
      const p = proposalFor();
      const locked = p.order[p.order.length - 1];
      const nodes = { ...p.nodes, [locked]: { ...p.nodes[locked], fanOutLocked: true } };
      const wsCard = (over = {}) => wfCard({ ...WS, members: ['proj', 'lib'], target: 'workspace', nodes, projectKey: undefined, projectName: undefined, ...over });
      flip(ctx, 3, { state: 'proposed', card: wsCard() });
      await settle(ctx.window, 6);
      assert.equal(targetText('[data-ask-wfcard="proposed"]'), 'workspace · Team · 2 projects');
      const el = ctx.window.document.querySelector('[data-ask-wfcard="proposed"]');
      assert.ok([...el.querySelectorAll('.ask-wfcard-graph *')].some((n) => n.children.length === 0 && n.textContent === 'per project'), 'the per-project band flag shows on the locked node');
      flip(ctx, 4, { state: 'saved', workflowId: 'wf_rename-fix', card: wsCard({ name: 'Rename fix', adopted: false }) });
      await settle(ctx.window, 6);
      assert.equal(targetText('[data-ask-wfcard="saved"]'), 'workspace · Team · 2 projects');
      flip(ctx, 5, { state: 'declined', card: { type: 'workflow', mode: 'task', name: 'Nope', ...WS } });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('.ask-card-stub').textContent, 'Declined — Nope', 'the stub text is unchanged');
      assert.equal(ctx.window.document.querySelector('[data-ask-wf-target]').textContent, 'workspace · Team');
      flip(ctx, 6, { state: 'failed', error: 'boom', card: { type: 'workflow', mode: 'task', ...WS } });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('.ask-card-stub.ask-card-failed').textContent, 'Proposal failed: boom');
      assert.equal(ctx.window.document.querySelector('[data-ask-wf-target]').textContent, 'workspace · Team');
    } },
    { name: 'project card: the project name, else the key; an old card with neither field has no line', run: async () => {
      ctx = await boot();
      await openBuilding(ctx);
      assert.equal(targetText('[data-ask-wfcard="building"]'), 'proj-00000001', 'no projectName ⇒ the key');
      flip(ctx, 3, { state: 'proposed', card: wfCard() });
      await settle(ctx.window, 6);
      assert.equal(targetText('[data-ask-wfcard="proposed"]'), 'proj');
      // A same-state frame reuses the cached element, so the old card arrives as a state change.
      flip(ctx, 4, { state: 'saved', workflowId: 'wf_rename-fix', card: wfCard({ projectKey: undefined, projectName: undefined, name: 'Old' }) });
      await settle(ctx.window, 6);
      assert.equal(targetText('[data-ask-wfcard="saved"]'), null, 'an old card shows no target line');
      flip(ctx, 5, { state: 'declined', card: { type: 'workflow', mode: 'task', name: 'Old' } });
      await settle(ctx.window, 4);
      assert.equal(ctx.window.document.querySelector('[data-ask-wf-target]'), null);
      assert.equal(ctx.window.document.querySelector('.ask-card-stub').textContent, 'Declined — Old');
      assert.equal(ctx.window.document.querySelector('.ask-wfcard-stubwrap'), null, 'an old stub stays a bare stub');
    } },
  ]);
});

test('a synthetic user row renders the notice and no bubble; a typed row still renders its bubble', async () => {
  const ctx = await boot();
  await openSheet(ctx.window);
  await sendText(ctx.window, 'please help');
  const row = (id, seq, text, blocks) => ({ id, threadId: TID, seq, role: 'user', text, blocks, status: null, createdAt: 't' });
  ctx.recv({ type: 'ask-message', threadId: TID, message: row('askm_t0000001', 3, 'typed by me', null) });
  ctx.recv({ type: 'ask-message', threadId: TID, message: row('askm_s0000001', 4, '[worca event] workflow card card_0000ab01 saved as wf_x "X"; thenRun=true; project=proj-00000001', [{ kind: 'notice', synthetic: true, text: 'Workflow "X" saved · Auto will propose a run next' }]) });
  await settle(ctx.window, 4);
  const rows = [...ctx.window.document.querySelectorAll('.ask-msg-user')];
  const typed = rows.find((r) => r.textContent.includes('typed by me'));
  const syn = rows.at(-1);
  assert.ok(typed && typed.querySelector('.ask-user-bubble'), 'a typed row keeps its bubble');
  assert.equal(syn.querySelector('.ask-user-bubble'), null, 'a synthetic row is never a bubble');
  assert.equal(syn.querySelector('.ask-notice').textContent, 'Workflow "X" saved · Auto will propose a run next');
  assert.ok(!syn.textContent.includes('[worca event]'), 'the model-facing event line is never shown');
});

test('saving the workflow card drops the cached option lists — the next cached consumer (scope popover) refetches them', async () => {
  const ctx = await boot();
  await openBuilding(ctx);
  flip(ctx, 3, { state: 'proposed', card: wfCard() });
  await settle(ctx.window, 6);
  const doc = ctx.window.document;
  const projectsCalls = () => ctx.calls.filter((c) => c.url.split('?')[0].endsWith('/api/projects')).length;
  const scopeBtn = doc.querySelector('[data-ask-scope-btn]');
  const openScope = async () => { if (!doc.querySelector('.ask-pop-scope')) scopeBtn.click(); await settle(ctx.window, 4); };
  const closeScope = async () => { if (doc.querySelector('.ask-pop-scope')) scopeBtn.click(); await settle(ctx.window, 2); };
  const base = projectsCalls();
  await openScope();
  assert.ok(doc.querySelector('.ask-pop-scope'), 'the popover opened');
  assert.equal(projectsCalls(), base + 1, 'the first open fetches the lists');
  await closeScope();
  await openScope();
  assert.equal(projectsCalls(), base + 1, 'a reopen reads the cache — the cheap path stays cheap');
  await closeScope();
  doc.querySelector('[data-ask-wf-save]').click();
  await settle(ctx.window, 4);
  assert.equal(ctx.cardPosts.at(-1).state, 'saved');
  await openScope();
  assert.equal(projectsCalls(), base + 2, 'the save invalidated the cache: the next consumer refetches');
});

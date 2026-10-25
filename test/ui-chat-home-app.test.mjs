// test/ui-chat-home-app.test.mjs — worca Chat P6 inside the booted app: the home mounts in P1's [data-chat-home], its
// intent add-on rides the composer (registered once, before the page is built), the switches are read from
// GET /api/settings and GET /api/sources, and the run tiles are the Running list's own run models: a waiting run is a
// Needs-you tile whose Answer opens the run on its Q&A tab, a live run is a Running tile drawn like the Workflows view,
// a paused History row stands in, and the pickers, workflow cards and "N more" read the same data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bootApp, helloRun } from './helpers/run-page-boot.mjs';
import { composerAddons, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { RUNS_COALESCE_MS, RUNS_TICK_MS } from '../ui/public/chat/home.mjs';

const ok = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const agent = (id, key, color) => ({ id, kind: 'agent', key, x: 0, y: 0, label: key[0].toUpperCase() + key.slice(1), color,
  ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'out', type: 'md', when: 'always' }], await: true } });
const MANIFEST = { version: 2, template: { id: 'wf_review', name: 'Review only' }, graph: {
  nodes: [agent('n_plan', 'planner', 'violet'), agent('n_rev', 'reviewer', 'peach'),
    { id: 'n_end', kind: 'end', key: null, x: 0, y: 0, label: 'End', color: '', ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } }],
  wires: [{ id: 'w1', from: { node: 'n_plan', port: 'out' }, to: { node: 'n_rev', port: 'task' }, loop: false },
    { id: 'w2', from: { node: 'n_rev', port: 'out' }, to: { node: 'n_end', port: 'result' }, loop: false }] } };
const STATE = (runId, id) => ({ type: 'state', runId, id, title: 'Fix login', status: 'running', startedAt: '2026-10-11T10:00:00.000Z', stepper: MANIFEST,
  steps: [{ key: 'x:n_plan:1', executionId: 'x:n_plan:1', nodeId: 'n_plan', ordinal: 1, cycle: 1, status: 'running', activeMs: 3000, runningSince: null, costUsd: 0.2, startedAt: '2026-10-11T10:00:01.000Z' }],
  active: [{ nodeId: 'n_plan', executionId: 'x:n_plan:1' }], totalCostUsd: 0.2, subAgents: [] });
// GET /api/history rows as src/core/artifacts.mjs listAllPipelines builds them (a workspace row has no workspaceId).
const HROW = (o) => ({ id: 'aaaa0001', title: 'T', status: 'done', startedAt: '2026-10-10T10:00:00.000Z', pauseReason: null, runEngine: 'claude',
  totalCostUsd: 0.5, totalActiveMs: 60000, mtime: Date.parse('2026-10-10T11:00:00.000Z'), projectKey: 'k1', projectName: 'Proj A', projectDir: '/tmp/p', ...o });
const WF = { id: 'wf_default', name: 'Default', version: 2, updatedAt: 't',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'task' } }] };
const QUESTION = { kind: 'clarify', questions: [{ id: 'q1', text: 'Which?' }] };

const SITE = { key: 'site-00000001', name: 'site', path: '/w/p/site', displayPath: '/w/p/site', exists: true, vcs: 'none' };
function arms({ history = [], threads = [], settings = { chat: { scriptTools: false } }, sources = [], workflows = [], create = false } = {}) {
  return (url, opts = {}) => {
    if (create && url === '/api/projects/create') {
      const b = JSON.parse(opts.body || '{}');
      if (b.dryRun) return ok({ ok: true, root: '/w/p', rootDisplay: '/w/p' });
      const p = { ...SITE, key: `${b.name}-00000001`, name: b.name, path: `/w/p/${b.name}`, displayPath: `/w/p/${b.name}` };
      return Promise.resolve({ ok: true, status: 201, json: async () => ({ project: p, projects: [p], root: '/w/p', rootDisplay: '/w/p' }) });
    }
    if (url === '/api/history') return ok({ pipelines: history, ghAvailable: false, prHosts: {} });
    if (url.startsWith('/api/ask/threads?limit=')) return ok({ threads, total: threads.length });
    if (url === '/api/settings') return ok(settings);
    if (url === '/api/sources') return ok({ sources });
    if (url === '/api/workflows') return ok({ workflows });
    return null;
  };
}
async function bootChat(o = {}) {
  _resetChatExtensions();                       // app.js re-registers every card and add-on per boot
  const ctx = await bootApp({ fetchHandler: arms(o) });
  ctx.go('chat/new');                           // P1: #chat/new is always the home (a bare #chat from another page reopens the last chat)
  await ctx.settle(6);
  return ctx;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** A new visit: leave Chat and come back (the visit re-reads every loader). */
async function revisit(ctx) {
  ctx.go('runs');
  await ctx.settle(3);
  ctx.go('chat/new');
  await ctx.settle(6);
}
const tab = (doc, t) => doc.querySelector(`.chat-home-tab[data-tab="${t}"]`);
const selected = (doc) => (doc.querySelector('.chat-home-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab || null;

test('the home mounts in [data-chat-home]; the intent add-on is registered once and arms the composer', async () => {
  const ctx = await bootChat();
  const doc = ctx.window.document;
  const home = doc.querySelector('[data-chat-page] [data-chat-home]');
  assert.ok(home, 'P1 page');
  assert.equal(home.querySelector('.chat-home-title').textContent, 'What should worca do?');
  assert.equal(home.querySelectorAll('.chat-home-act').length, 8, 'the flags are off: the default Shaper pin is absent');
  assert.equal(composerAddons().filter((a) => a.id === 'intent').length, 1);
  const lead = doc.querySelector('[data-chat-page] [data-chat-composer-lead]');
  assert.ok(lead, 'P1 lead row');
  assert.equal(lead.querySelector('.chat-intent'), null, 'no chip until an action arms one (the empty lead row stays hidden)');
  home.querySelector('.chat-home-act[data-intent="run"]').click();
  const chip = lead.querySelector('.chat-intent');
  assert.ok(chip, 'the chip lives in the composer lead row');
  assert.equal(chip.querySelector('.chat-intent-l').textContent, 'New run');
  assert.equal(doc.querySelector('[data-chat-page] .ask-input').placeholder, 'Describe the task…');
  assert.equal(home.querySelector('.chat-home-act[data-intent="script"]').hidden, true, 'GET /api/settings chat.scriptTools:false');
  assert.equal(home.querySelector('.chat-home-act[data-intent="shape"]'), null, 'Shaper pin: no hello turned the shapeFirst gate on');
  assert.ok(ctx.calls.some((c) => c.url === '/api/sources'), 'task sources were asked once per visit');
});

test('a waiting run is a Needs-you tile; with no chat following it, Answer opens the run on Q&A', async () => {
  const ctx = await bootChat();
  helloRun(ctx, { runId: 'r1', title: 'Fix flaky upload', pendingQuestion: QUESTION });
  await revisit(ctx);
  const doc = ctx.window.document;
  assert.equal(selected(doc), 'needs');
  const tile = doc.querySelector('.chat-run-tile');
  assert.ok(tile, 'one tile');
  assert.equal(tile.querySelector('.chat-run-tile-open').textContent, 'Fix flaky upload');
  assert.equal(tile.querySelector('.chat-run-tile-answer').hidden, false);
  tab(doc, 'running').click();
  assert.equal(doc.querySelector('.chat-home-panel .chat-home-empty').textContent, 'Nothing running', 'a waiting run is not also a Running tile');
  tab(doc, 'needs').click();
  doc.querySelector('.chat-run-tile .chat-run-tile-answer').click();
  await ctx.settle(8);
  // P4 (in the base): the run panel opens beside the home on the live screen's Q&A tab; the home stays under it.
  assert.equal(ctx.window.location.hash, '#chat/new/run/r1/qa');
  assert.equal(doc.querySelector('[data-chat-panel]').hidden, false);
  assert.equal(doc.querySelector('[data-chat-page]').dataset.view, 'home');
});

test('a cold boot onto Chat: the default tab waits for the run list, so a run that waits on you wins over the chats', async () => {
  const ctx = await bootChat({ threads: [{ id: 'ask_000000b1', title: 'Old chat', createdAt: 't', updatedAt: '2026-10-11T00:00:00Z', runLinks: 0 }] });
  const doc = ctx.window.document;
  assert.equal(selected(doc), null, 'the chats answered first; the runs are not known until the hello');
  helloRun(ctx, { runId: 'r9', title: 'Waits', pendingQuestion: QUESTION });
  await wait(RUNS_COALESCE_MS + 60);
  await ctx.settle(4);
  assert.equal(selected(doc), 'needs');
});

test('a run frame repaints the home within the coalesce window: a live v2 run is a Running tile with its project, workflow and graph', async () => {
  const ctx = await bootChat({ history: [HROW({ id: 'bbbb0002', status: 'running', title: 'Fix login' })] });
  helloRun(ctx, { runId: 'zz', pipelineId: 'ffff0000', title: 'Old', status: 'done' });   // first hello: History loads
  await revisit(ctx);                                                                     // the visit (and its 1 s tick) starts now
  const doc = ctx.window.document;
  tab(doc, 'running').click();
  ctx.dispatch({ type: 'run-created', runId: 'r1', pipelineId: 'bbbb0002', title: 'Fix login', projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-10-11T10:00:00.000Z' });
  ctx.dispatch(STATE('r1', 'bbbb0002'));
  await wait(RUNS_COALESCE_MS + 60);
  assert.ok(RUNS_COALESCE_MS + 60 < RUNS_TICK_MS, 'shown by the run-store poke, not by the once-a-second re-read');
  const tile = doc.querySelector('.chat-run-tile');
  assert.ok(tile, 'the run frame reached the home');
  assert.equal(tile.querySelector('.chat-run-tile-sub').textContent, 'Proj A · Review only', 'runsGroupFor(...).name · the template name');
  assert.ok(tile.querySelector('.run-flow.gv-host .gv-stage'), 'the graph is drawn');
  assert.equal(tile.querySelectorAll('.gv-world [data-node-id]').length, 3);
});

test('a paused History row with no live run stands in as a Needs-you tile; a click opens that saved run', async () => {
  const ctx = await bootChat({ history: [
    HROW({ id: 'dddd0004', status: 'paused', pauseReason: 'cost_pipeline', title: 'Paused proj' }),
    HROW({ id: 'eeee0005', status: 'paused', title: 'Paused ws', projectKey: 'workspaces/ws1', projectName: 'WS One', workspaceName: 'WS One', target: 'workspace', runEngine: 'cursor', totalCostUsd: 0 }),
  ] });
  helloRun(ctx, { runId: 'zz', pipelineId: 'ffff0000', title: 'Old', status: 'done' });
  await revisit(ctx);
  const doc = ctx.window.document;
  assert.equal(selected(doc), 'needs');
  const tiles = [...doc.querySelectorAll('.chat-run-tile')];
  assert.deepEqual(tiles.map((t) => t.dataset.tileKey), ['hist:k1/dddd0004', 'hist:workspaces/ws1/eeee0005']);
  assert.deepEqual(tiles.map((t) => t.querySelector('.chat-run-tile-sub').textContent), ['Proj A', 'WS One']);
  assert.equal(tiles[0].querySelector('.chat-run-tile-pill').textContent, 'Paused · cost limit');
  assert.deepEqual(tiles.map((t) => t.querySelector('.chat-run-tile-stats').textContent), ['1m 0s · $0.50', '1m 0s'], 'a Cursor run reports no cost: never $0.00');
  const seen = [];
  ctx.window.__np.chat.deps.openRunPanel = (ref, opts) => seen.push([ref, opts]);
  tiles[1].querySelector('.chat-run-tile-open').click();
  await ctx.settle(6);
  assert.deepEqual(seen, [[{ pipelineId: 'eeee0005', workspaceId: 'ws1' }, { tab: 'workflow' }]], 'a workspace row names its workspace (its projectKey is workspaces/<id>)');
});

test('Explain a diff lists finished runs (History, and one that finished here); workflow cards draw and prefill the newest project', async () => {
  const ctx = await bootChat({ workflows: [WF], history: [
    HROW({ id: 'aaaa0001', status: 'done', title: 'Older done', startedAt: '2026-10-01T00:00:00.000Z', projectName: 'Old Proj', projectKey: 'k0' }),
    HROW({ id: 'aaaa0002', status: 'error', title: 'Failed' }),
    HROW({ id: 'bbbb0002', status: 'running', title: 'Fix login', startedAt: '2026-10-11T10:00:00.000Z' }),
  ] });
  helloRun(ctx, { runId: 'r1', pipelineId: 'bbbb0002', title: 'Fix login' });
  await ctx.settle(4);
  ctx.dispatch({ type: 'done', runId: 'r1', status: 'done' });    // finishes while Chat shows: History does not reload here
  await revisit(ctx);
  const doc = ctx.window.document;
  doc.querySelector('.chat-home-act[data-intent="diff"]').click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item .wfv-menu-l')].map((n) => n.textContent);
  assert.deepEqual(items, ['Fix login', 'Older done'], 'done runs only, the one that just finished first');
  doc.querySelector('.wfv-menu .wfv-menu-item').click();
  const input = doc.querySelector('[data-chat-page] .ask-input');
  assert.equal(input.value, '“Fix login” (#bbbb0002)');
  input.value = '';
  let fired = 0;
  input.addEventListener('input', () => { fired += 1; });
  tab(doc, 'workflows').click();
  await ctx.settle(4);
  const card = doc.querySelector('.chat-home-wf');
  assert.ok(card.querySelector('.chat-home-wf-tb svg'), 'the Library thumbnail (portsFnFor over the agents and scripts)');
  card.click();
  assert.equal(input.value, 'Run Default on Proj A: ', 'the newest History row names the project');
  assert.equal(fired, 1, 'the prefill fires input (ask-panel autosize)');
  assert.equal(doc.activeElement, input);
});

test('switches: an installed plugin task source brings Find tasks into More', async () => {
  const ctx = await bootChat({ settings: { chat: { scriptTools: true } }, sources: [{ type: 'prompt' }, { type: 'plugin', plugin: 'jira', sourceId: 'issues' }] });
  const doc = ctx.window.document;
  assert.equal(doc.querySelector('.chat-home-act[data-intent="script"]').hidden, false);
  doc.querySelector('.chat-home-act.is-more').click();
  assert.ok([...doc.querySelectorAll('.wfv-menu .wfv-menu-l')].some((n) => n.textContent === 'Find tasks'));
});

test('"N more" opens the Runs list, never the run the Runs page remembers', async () => {
  const ctx = await bootChat();
  ctx.window.localStorage.setItem('worca-cc.runs.last', JSON.stringify({ runId: 'm0' }));
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: Array.from({ length: 7 }, (_, i) => ({ runId: `m${i}`, title: `R${i}`, projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' })) });
  await revisit(ctx);
  const doc = ctx.window.document;
  assert.equal(selected(doc), 'running');
  const more = doc.querySelector('.chat-home-panel > .chat-home-more-link');
  assert.equal(more.textContent, '1 more');
  more.click();
  await ctx.settle(6);
  assert.equal(ctx.window.location.hash, '#runs');
});

// A child that boots app.js onto the Chat home under jsdom and never closes its window — as several app-booting suites
// do (test/ui-history-workspace-pr.test.mjs). An interval created through the jsdom window is never unref'd, so the child
// (and `npm test`, which waits for every test file to exit) would hang for ever.
const CHILD = `
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
const root = process.cwd();
const dom = new JSDOM(readFileSync(root + '/ui/public/index.html', 'utf8'), { url: 'http://localhost:4317/' });
const { window } = dom;
window.Element.prototype.scrollIntoView = function () {};
window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
window.fetch = async () => ({ ok: true, status: 200, json: async () => ({ projects: [], config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
  try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
}
await import(pathToFileURL(root + '/ui/public/app.js').href);
await new Promise((r) => setTimeout(r, 1500));
console.log(window.document.querySelector('[data-chat-home] .chat-home-title') ? 'HOME' : 'NOHOME');
`;

test('a booted app keeps nothing alive: a child that boots onto the Chat home and never closes its window exits by itself', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', CHILD], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.equal(r.error && r.error.code, undefined, 'the child hung: a timer keeps its event loop alive (unref it, like app.js _timerTick)');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^HOME$/m, 'the home was mounted and visited (its tick and the intent rotation were running)');
});

test('a quick-action prefill never overwrites a draft: it goes on a new line under it', async () => {
  const ctx = await bootChat({ workflows: [WF] });
  const doc = ctx.window.document;
  const input = doc.querySelector('[data-chat-page] .ask-input');
  input.value = 'my draft';
  tab(doc, 'workflows').click();
  await ctx.settle(4);
  doc.querySelector('.chat-home-wf').click();
  assert.equal(input.value, 'my draft\nRun Default:', 'appendToComposer keeps what was typed');
});

test('an intent riding a send in flight never follows the logo to a new chat: the next message goes out as typed', async () => {
  _resetChatExtensions();
  let release;
  const held = new Promise((r) => { release = r; });
  const base = arms();
  const ids = ['ask_0000000a', 'ask_0000000b'];
  const THREAD = (id) => ({ id, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} });
  const res = (body, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body });
  const ctx = await bootApp({ fetchHandler: (url, opts) => {
    const method = String(opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') return res({ thread: THREAD(ids.shift()) }, 201);
    if (/^\/api\/ask\/threads\/ask_[0-9a-f]{8}\/messages$/.test(url) && method === 'POST') {
      return held.then(() => ({ ok: true, status: 202, json: async () => ({ userMessageId: 'askm_00000001', attachments: [], contexts: [] }) }));
    }
    const one = /^\/api\/ask\/threads\/(ask_[0-9a-f]{8})$/.exec(url);
    if (one) return res({ thread: THREAD(one[1]), messages: [], attachments: [], runLinks: [], inFlight: null });
    return base(url, opts);
  } });
  ctx.go('chat/new');
  await ctx.settle(6);
  const doc = ctx.window.document;
  doc.querySelector('.chat-home-act[data-intent="run"]').click();
  const input = doc.querySelector('[data-chat-page] .ask-input');
  input.value = 'fix the upload test';
  doc.querySelector('[data-chat-page] [data-ask-send]').click();
  await ctx.settle(8);
  assert.equal(ctx.window.location.hash, '#chat/ask_0000000a', 'the send made its chat; its message POST is still out');
  ctx.go('chat/new');                                               // the worca logo
  await ctx.settle(8);
  assert.equal(doc.querySelector('[data-chat-page] .chat-intent'), null, 'the intent stayed with the chat its send created');
  release();
  await ctx.settle(10);
  input.value = 'what time is it';
  doc.querySelector('[data-chat-page] [data-ask-send]').click();
  await ctx.settle(10);
  const sent = ctx.calls.filter((c) => /\/messages$/.test(c.url) && String(c.opts.method || '').toUpperCase() === 'POST')
    .map((c) => JSON.parse(c.opts.body).text);
  assert.deepEqual(sent, ['Propose a pipeline run for this task.\n\nfix the upload test', 'what time is it']);
});

test('the head\'s New chat + is a trip to a new chat: an intent set on the home is dropped', async () => {
  const ctx = await bootChat();
  const doc = ctx.window.document;
  doc.querySelector('.chat-home-act[data-intent="run"]').click();
  assert.ok(doc.querySelector('[data-chat-page] .chat-intent'), 'armed');
  doc.querySelector('[data-chat-page] .chat-head [data-ask-new-btn]').click();
  await ctx.settle(4);
  assert.equal(doc.querySelector('[data-chat-page] .chat-intent'), null, 'the intent add-on\'s capture listener saw [data-ask-new-btn]');
  assert.equal(ctx.window.location.hash, '#chat');
});

test('Answer opens the chat that follows the run when there is one (findFollowingThread over GET /api/ask/threads)', async () => {
  _resetChatExtensions();
  const row = { id: 'ask_000000f1', title: 'Fix it', createdAt: '2026-10-11T00:00:00Z', updatedAt: '2026-10-11T00:00:00Z', runLinks: 1, waiting: true };
  const base = arms({ threads: [row] });
  const ctx = await bootApp({ fetchHandler: (url, opts) => (url === '/api/ask/threads/ask_000000f1'
    ? ok({ thread: row, messages: [], attachments: [], runLinks: [{ threadId: row.id, runId: 'r1', pipelineId: null }] })
    : base(url, opts)) });
  ctx.go('chat/new');
  await ctx.settle(6);
  helloRun(ctx, { runId: 'r1', title: 'Fix flaky upload', pendingQuestion: QUESTION });
  await revisit(ctx);
  const doc = ctx.window.document;
  doc.querySelector('.chat-run-tile .chat-run-tile-answer').click();
  await ctx.settle(10);
  assert.ok(ctx.calls.some((c) => c.url === '/api/ask/threads/ask_000000f1'), 'the chat snapshot was read');
  assert.equal(ctx.window.location.hash, '#chat/ask_000000f1');
});

test('a cold boot: the hello alone does not settle the tab — a paused History row still on its way wins over the chats', async () => {
  _resetChatExtensions();
  const held = [];
  const base = arms({ threads: [{ id: 'ask_000000b1', title: 'Old chat', createdAt: 't', updatedAt: '2026-10-11T00:00:00Z', runLinks: 0 }],
    history: [HROW({ id: 'dddd0004', status: 'paused', pauseReason: 'cost_pipeline', title: 'Paused proj' })] });
  const ctx = await bootApp({ fetchHandler: (url, opts) => (url === '/api/history'
    ? new Promise((r) => { held.push(() => r(base(url, opts))); })
    : base(url, opts)) });
  ctx.go('chat/new');
  await ctx.settle(6);
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: [] });
  await wait(RUNS_TICK_MS + 150);                                   // the 1 s re-read ran: the hello is in, History is not
  const doc = ctx.window.document;
  assert.equal(selected(doc), null, 'until History answers, an empty Needs you is "not yet"');
  assert.ok(held.length > 0, 'the first hello asked History');
  for (const go of held) go();
  await ctx.settle(6);
  await wait(RUNS_TICK_MS + 150);
  assert.equal(selected(doc), 'needs');
});

test('Explain a diff: done runs only — never a live, failed or archived one, never twice — newest first, each with its project', async () => {
  const ctx = await bootChat({ history: [
    HROW({ id: 'aaaa0001', status: 'done', title: 'Archived done', archived: true }),
    HROW({ id: 'cccc0003', status: 'done', title: 'Done both', startedAt: '2026-10-09T00:00:00.000Z' }),
  ] });
  ctx.wsBox.ws.dispatch('open', {});
  const live = (runId, pipelineId, title) => ({ runId, pipelineId, title, projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-10-11T09:00:00Z' });
  ctx.dispatch({ type: 'hello', runs: [live('r1', 'bbbb0001', 'First done here'), live('r2', 'bbbb0002', 'Second done here'),
    live('r3', 'bbbb0003', 'Still running'), live('r4', 'bbbb0004', 'Failed here'), live('r5', 'cccc0003', 'Done both')] });
  await ctx.settle(4);
  for (const runId of ['r1', 'r2', 'r5']) ctx.dispatch({ type: 'done', runId, status: 'done' });
  ctx.dispatch({ type: 'done', runId: 'r4', status: 'error' });
  await revisit(ctx);
  const doc = ctx.window.document;
  doc.querySelector('.chat-home-act[data-intent="diff"]').click();
  const rows = [...doc.querySelectorAll('.wfv-menu .wfv-menu-item')]
    .map((b) => [b.querySelector('.wfv-menu-l').textContent, (b.querySelector('.wfv-menu-hint') || { textContent: '' }).textContent]);
  assert.deepEqual(rows, [['Second done here', 'Proj A'], ['First done here', 'Proj A'], ['Done both', 'Proj A']]);
});

test('the workflow prefill names the newest PROJECT run: a newer workspace run is no project', async () => {
  const ctx = await bootChat({ workflows: [WF], history: [
    HROW({ id: 'aaaa0001', status: 'done', startedAt: '2026-10-10T00:00:00.000Z' }),
    HROW({ id: 'eeee0005', status: 'done', title: 'WS run', startedAt: '2026-10-11T00:00:00.000Z', projectKey: 'workspaces/ws1', projectName: 'WS One', workspaceName: 'WS One', target: 'workspace' }),
  ] });
  helloRun(ctx, { runId: 'zz', pipelineId: 'ffff0000', title: 'Old', status: 'done' });
  await revisit(ctx);
  const doc = ctx.window.document;
  tab(doc, 'workflows').click();
  await ctx.settle(4);
  doc.querySelector('.chat-home-wf').click();
  assert.equal(doc.querySelector('[data-chat-page] .ask-input').value, 'Run Default on Proj A: ');
});

test('switches: a task source that is not a plugin brings no Find tasks', async () => {
  const ctx = await bootChat({ sources: [{ type: 'prompt' }] });
  const doc = ctx.window.document;
  doc.querySelector('.chat-home-act.is-more').click();
  const items = [...doc.querySelectorAll('.wfv-menu .wfv-menu-l')].map((n) => n.textContent);
  assert.ok(items.includes('Step away'), 'the menu is open');
  assert.equal(items.includes('Find tasks'), false);
});

test('More follows the interface mode: Simple lists Step away only', async () => {
  const ctx = await bootChat({ sources: [{ type: 'plugin', plugin: 'jira', sourceId: 'issues' }] });
  const doc = ctx.window.document;
  doc.documentElement.dataset.level = 'simple';
  doc.querySelector('.chat-home-act.is-more').click();
  assert.deepEqual([...doc.querySelectorAll('.wfv-menu .wfv-menu-l')].map((n) => n.textContent), ['Step away']);
});

test('Running lists the newest run first, as the Running list does', async () => {
  const ctx = await bootChat();
  ctx.wsBox.ws.dispatch('open', {});
  ctx.dispatch({ type: 'hello', runs: ['m0', 'm1', 'm2'].map((runId, i) => ({ runId, title: `R${i}`, projectDir: '/tmp/p', status: 'running', kind: 'run', startedAt: '2026-01-01T00:00:00Z' })) });
  await revisit(ctx);
  const doc = ctx.window.document;
  assert.equal(selected(doc), 'running');
  assert.deepEqual([...doc.querySelectorAll('.chat-run-tile')].map((t) => t.dataset.tileKey), ['live:m2', 'live:m1', 'live:m0']);
});

test('Add project: the tile and the scope menu\'s entry open the dialog on New; the created project becomes the chat\'s scope', async () => {
  const ctx = await bootChat({ create: true });
  const doc = ctx.window.document;
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  doc.querySelector('[data-chat-page] [data-chat-home] .chat-home-act[data-action="project"]').click(); await flush();
  assert.equal(doc.getElementById('project-add-modal').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('proj-add-tab-new').getAttribute('aria-selected'), 'true');
  const name = doc.getElementById('proj-add-name');
  name.value = 'site'; name.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  doc.getElementById('proj-add-save').click(); await flush();
  assert.equal(doc.getElementById('project-add-modal').classList.contains('hidden'), true);
  assert.equal(doc.querySelector('[data-chat-page] [data-ask-scope-btn] .ask-scope-label').textContent, 'site', 'askPanel.setScope (P4b)');
  ctx.window.__projects.openAddProject(); await flush();        // what the scope menu's Add project… calls
  assert.equal(doc.getElementById('project-add-modal').classList.contains('hidden'), false);
  assert.equal(doc.getElementById('proj-add-tab-new').getAttribute('aria-selected'), 'true');
  name.value = 'docs'; name.dispatchEvent(new ctx.window.Event('input', { bubbles: true }));
  doc.getElementById('proj-add-save').click(); await flush();
  assert.equal(doc.querySelector('[data-chat-page] [data-ask-scope-btn] .ask-scope-label').textContent, 'docs', 'the scope menu path scopes the chat too (S-P2-5)');
});

test('bundle QA 2: a History row in Needs you through its PR is a tile that says why, never "Done"', async () => {
  const ctx = await bootChat({ history: [
    HROW({ id: 'gggg0007', title: 'Red CI', pr: { url: 'https://github.com/o/r/pull/781', number: 781, state: 'OPEN', checks: { state: 'failing', total: 12, failed: 3, pending: 0 } } }),
    HROW({ id: 'hhhh0008', title: 'Clash', pr: { url: 'https://github.com/o/r/pull/782', number: 782, state: 'OPEN', mergeable: 'CONFLICTING' } }),
  ] });
  helloRun(ctx, { runId: 'zz', pipelineId: 'ffff0000', title: 'Old', status: 'done' });
  await revisit(ctx);
  const doc = ctx.window.document;
  assert.equal(selected(doc), 'needs');
  const tile = (id) => doc.querySelector(`.chat-run-tile[data-tile-key="hist:k1/${id}"]`);
  for (const [id, word] of [['gggg0007', 'Checks failing'], ['hhhh0008', 'Conflicts']]) {
    const pill = tile(id).querySelector('.chat-run-tile-pill');
    assert.equal(pill.querySelector('.chat-run-tile-pt').textContent, word);
    assert.ok(pill.classList.contains('st-amber'));
    const dot = pill.querySelector('.status-dot[data-state="needs-you"]');
    assert.ok(dot && !dot.querySelector('svg.status-sym'), 'a plain amber dot');
  }
  assert.equal([...doc.querySelectorAll('.chat-run-tile-pt')].filter((n) => n.textContent === 'Done').length, 0);
});

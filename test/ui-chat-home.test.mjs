// test/ui-chat-home.test.mjs — worca Chat P6 (CONTRACT §8): the Chat home over P1's [data-chat-home]. Hero around the
// hero slot, visits (only while the home shows), the default-tab rule chosen once per visit, the session pick, run
// tiles updated in place and destroyed on leave, routing (following chat, else the run on Q&A / Workflow), lists,
// promos, switches, and findFollowingThread.
import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { HOLD_MS, FADE_MS, HERO_VERBS } from '../ui/public/chat/home-verbs.mjs';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createChatHome, findFollowingThread, runRef, answerTab, PROMOS, FOLLOW_SCAN_MAX, RUNS_COALESCE_MS, RUN_TILES_MAX, RUNS_TICK_MS, RUNS_WAIT_MS,
} from '../ui/public/chat/home.mjs';
import { decorFromState } from '../ui/public/graph/run-decor.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const trackDom = useDomRelease(afterEach);

const MANIFEST = {
  version: 2, template: { id: 'wf_t', name: 'T' },
  graph: {
    nodes: [
      { id: 'n_a', kind: 'agent', key: 'planner', x: 0, y: 0, label: 'Planner', color: 'violet',
        ports: { inputs: [{ id: 'task', type: 'md', loop: false }], outputs: [{ id: 'plan', type: 'md', when: 'always' }], await: true } },
      { id: 'n_end', kind: 'end', key: null, x: 400, y: 0, label: 'End', color: '',
        ports: { inputs: [{ id: 'result', type: 'any' }], outputs: [], await: false } },
    ],
    wires: [{ id: 'w1', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } }],
  },
};
const decorOf = () => decorFromState({ stepper: MANIFEST, status: 'running', steps: [], active: [] }, { live: true, now: 0 });
function snap(over = {}) {
  return {
    source: 'live', key: 'live:r1', runId: 'r1', pipelineId: 'p1', projectKey: null, workspaceId: null,
    title: 'Fix the upload test', project: 'worca-cc', workflow: 'T', status: 'running', pauseReason: null,
    pendingQuestion: null, live: true, terminal: false, elapsedMs: 252000, costUsd: 1.2, progress: { done: 2, total: 5 },
    active: [], stepper: MANIFEST, decor: decorOf(), ...over,
  };
}
const WAITING = () => snap({ key: 'live:r2', runId: 'r2', pipelineId: 'p2', title: 'Offline sync banner', pendingQuestion: { kind: 'clarify', questions: [{ id: 'q1' }] } });
const RUNS = (o = {}) => ({ needs: [], running: [], finished: [], project: 'worca-cc', ...o });
const WF_DEFAULT = { id: 'wf_default', name: 'Default', version: 2, updatedAt: 't',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_impl', kind: 'agent', key: 'implementer', x: 300, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_impl', port: 'task' } }] };

const SHELL = (view) => `<!doctype html><html><body><section class="view" data-view="chat"><div class="chat-page" data-chat-page data-view="${view}">
  <div class="chat-convo"><header class="chat-head"><button type="button" data-ask-new-btn>+</button></header>
    <div class="chat-home" data-chat-home><div class="chat-hero-slot" data-chat-hero-slot>
      <div class="ask-composer"><div class="ask-composer-box"><div class="chat-composer-lead" data-chat-composer-lead></div><textarea class="ask-input"></textarea></div></div>
    </div></div>
    <div class="ask-transcript"></div><div class="chat-dock" data-chat-dock></div></div></div></section></body></html>`;

function setup({ view = 'home', runs = RUNS(), threads = [], workflows = null, flags = null, threadId = null, level = 'expert', holdThreads = false,
  pins = undefined, savePins = null, reducedMotion = false } = {}) {
  const dom = trackDom(new JSDOM(SHELL(view), { url: 'http://localhost:4317/' }));
  const { window } = dom;
  if (reducedMotion) window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  const doc = window.document;
  // a shown tab (jsdom reports hidden without pretendToBeVisual, and the hero's verb waits while the tab is hidden)
  let hidden = false;
  Object.defineProperty(doc, 'hidden', { configurable: true, get: () => hidden });
  const calls = [];
  let runsNow = runs;
  let release = null;
  const deps = {
    runs: () => runsNow,
    threads: () => (holdThreads ? new Promise((r) => { release = () => r(threads); }) : Promise.resolve(threads)),
    workflows: async () => workflows || { list: [], portsFn: null },
    flags: async () => flags || { scripts: true, tasks: false },
    threadForRun: async (ref) => { calls.push(['threadForRun', ref]); await Promise.resolve(); return threadId; },
    openThread: (id) => calls.push(['openThread', id]),
    openRunPanel: (ref, opts) => calls.push(['openRunPanel', ref, opts]),
    pins: async () => (pins === undefined ? ['wf_shape'] : pins),           // null = the GET failed
    savePins: async (list) => { calls.push(['savePins', list]); return savePins ? savePins(list) : list; },
    // a third element only when opts were passed: the two-element assertions elsewhere in this file stay
    setIntent: (id, opts) => calls.push(opts === undefined ? ['setIntent', id] : ['setIntent', id, opts]),
    prefill: (text) => calls.push(['prefill', text]),
    navigate: (hash) => calls.push(['navigate', hash]),
    level: () => level,
  };
  const host = doc.querySelector('[data-chat-home]');
  const home = createChatHome({ doc, host, heroSlot: doc.querySelector('[data-chat-hero-slot]'), deps });
  return {
    window, doc, host, home, calls, setHidden: (v) => { hidden = v; },
    page: doc.querySelector('[data-chat-page]'), section: doc.querySelector('section[data-view="chat"]'),
    setRuns: (r) => { runsNow = r; }, releaseThreads: () => { if (release) release(); },
  };
}
const settle = async (window, n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => window.setTimeout(r, 0)); };
const selected = (doc) => (doc.querySelector('.chat-home-tab[aria-selected="true"]') || { dataset: {} }).dataset.tab || null;
const tab = (doc, t) => doc.querySelector(`.chat-home-tab[data-tab="${t}"]`);

test('the hero wraps P1\'s hero slot: heading, the slot (composer untouched), then the home body — no aurora', async () => {
  const s = setup();
  await settle(s.window);
  assert.deepEqual([...s.host.children].map((c) => c.className), ['chat-home-title', 'chat-hero-slot', 'chat-home-body']);
  assert.equal(s.host.querySelector('h1.chat-home-title').getAttribute('aria-label'), 'What should worca do?');
  assert.equal(s.host.querySelector('.chat-home-aurora, .chat-aurora-orb, [class*="aurora"]'), null, 'a flat page: no aurora behind the hero');
  assert.ok(s.host.querySelector('[data-chat-hero-slot] > .ask-composer'), 'the composer stays where P1 put it');
  const body = s.host.querySelector('.chat-home-body');
  assert.deepEqual([...body.children].map((c) => c.className.split(' ')[0]), ['chat-home-actions', 'chat-home-presets', 'chat-home-tabs', 'chat-home-promos']);
  s.home.destroy();
  assert.deepEqual([...s.host.children].map((c) => c.className), ['chat-hero-slot'], 'destroy takes back everything it added');
});

test('default tab: Needs you, else Running, else Recent chats, else Workflows — and nothing until the chats are known', async () => {
  const a = setup({ runs: RUNS({ needs: [WAITING()], running: [snap()] }) });
  await settle(a.window);
  assert.equal(selected(a.doc), 'needs');
  assert.equal(a.doc.querySelector('.chat-home-tab-n').textContent, '1');
  const b = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(b.window);
  assert.equal(selected(b.doc), 'running');
  const c = setup({ holdThreads: true, threads: [{ id: 'ask_00000001', title: 'Hi', updatedAt: '2026-10-11T00:00:00Z' }] });
  assert.equal(selected(c.doc), null, 'no run decides it: wait for the chat list');
  assert.equal(c.doc.querySelector('.chat-home-panel').getAttribute('aria-busy'), 'true');
  c.releaseThreads();
  await settle(c.window);
  assert.equal(selected(c.doc), 'chats');
  assert.equal(c.doc.querySelectorAll('.chat-home-chat').length, 1);
  const d = setup({ threads: [] });
  await settle(d.window);
  assert.equal(selected(d.doc), 'workflows');
  assert.equal(d.doc.querySelector('.chat-home-empty').textContent, 'No workflows');
});

test('the default is chosen once per visit: a run that starts waiting changes the count, not the tab', async () => {
  const s = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(s.window);
  assert.equal(selected(s.doc), 'running');
  const next = RUNS({ needs: [WAITING()], running: [snap()] });
  s.setRuns(next);
  s.home.update({ runs: next });
  assert.equal(selected(s.doc), 'running', 'no jump under the user');
  const n = s.doc.querySelector('.chat-home-tab-n');
  assert.equal(n.hidden, false);
  assert.equal(n.textContent, '1');
});

test('a tab the user picks is remembered for the session and wins on the next visit', async () => {
  const s = setup({ runs: RUNS({ needs: [WAITING()] }) });
  await settle(s.window);
  assert.equal(selected(s.doc), 'needs');
  tab(s.doc, 'chats').click();
  assert.equal(selected(s.doc), 'chats');
  assert.equal(s.window.sessionStorage.getItem('worca-cc.chat.homeTab'), 'chats');
  s.page.dataset.view = 'thread';
  await settle(s.window);
  s.page.dataset.view = 'home';
  await settle(s.window);
  assert.equal(selected(s.doc), 'chats', 'the pick outranks Needs you on the next visit');
});

test('run tiles update in place and leave with their graph: a run dropping out, a tab switch, leaving the home', async () => {
  const first = snap();
  const s = setup({ runs: RUNS({ running: [first] }) });
  await settle(s.window);
  const tile = s.doc.querySelector('.chat-run-tile');
  const stage = tile.querySelector('.gv-stage');
  assert.ok(stage, 'a graph in the well');
  const renamed = RUNS({ running: [snap({ title: 'Renamed', decor: first.decor })] });
  s.setRuns(renamed);
  s.home.update({ runs: renamed });
  assert.equal(s.doc.querySelector('.chat-run-tile'), tile, 'same element');
  assert.equal(tile.querySelector('.gv-stage'), stage, 'same graph mount');
  assert.equal(tile.querySelector('.chat-run-tile-open').textContent, 'Renamed');
  const swapped = RUNS({ running: [snap({ key: 'live:r3', runId: 'r3', title: 'Second' })] });
  s.setRuns(swapped);
  s.home.update({ runs: swapped });
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 1);
  assert.equal(s.doc.querySelector('.chat-run-tile').dataset.tileKey, 'live:r3');
  assert.equal(tile.isConnected, false);
  assert.equal(tile.querySelector('.gv-host'), null, 'the dropped tile destroyed its graph mount');
  tab(s.doc, 'workflows').click();
  assert.equal(s.doc.querySelectorAll('.gv-host').length, 0, 'a tab switch destroys the tiles');
  tab(s.doc, 'running').click();
  assert.equal(s.doc.querySelectorAll('.gv-host').length, 1);
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.equal(s.doc.querySelectorAll('.gv-host').length, 0, 'leaving the home destroys them');
  assert.equal(s.doc.querySelector('.chat-home-panel').children.length, 0);
  const empty = RUNS();
  s.setRuns(empty);
  s.page.dataset.view = 'home';
  await settle(s.window);
  assert.equal(s.doc.querySelector('.chat-home-empty').textContent, 'Nothing running');
});

test('a hidden Chat section is not a visit: nothing mounts until it shows', async () => {
  const s = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(s.window);
  s.section.classList.add('hidden');
  await settle(s.window);
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 0);
  s.section.classList.remove('hidden');
  await settle(s.window);
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 1);
});

test('a tab shows at most RUN_TILES_MAX run tiles; "N more" goes to the Runs page', async () => {
  const many = Array.from({ length: 8 }, (_, i) => snap({ key: `live:m${i}`, runId: `m${i}`, title: `Run ${i}` }));
  const s = setup({ runs: RUNS({ running: many }) });
  await settle(s.window);
  assert.equal(RUN_TILES_MAX, 6);
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 6);
  assert.equal(s.doc.querySelectorAll('.gv-host').length, 6, 'no graph mount for a tile that is not shown');
  const more = s.doc.querySelector('.chat-home-panel > .chat-home-more-link');
  assert.equal(more.textContent, '2 more');
  more.click();
  assert.deepEqual(s.calls.at(-1), ['navigate', '#runs']);
  const fewer = RUNS({ running: many.slice(0, 3) });
  s.setRuns(fewer);
  s.home.update({ runs: fewer });
  assert.equal(s.doc.querySelector('.chat-home-panel > .chat-home-more-link'), null);
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 3);
});

test('routing: Answer opens the run on Q&A when no chat follows it, a tile opens it on Workflow, two clicks route once', async () => {
  const s = setup({ runs: RUNS({ needs: [WAITING()] }) });
  await settle(s.window);
  const answer = s.doc.querySelector('.chat-run-tile-answer');
  answer.click();
  answer.click();
  await settle(s.window);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'threadForRun'), [['threadForRun', { runId: 'r2', pipelineId: 'p2' }]]);
  assert.deepEqual(s.calls.at(-1), ['openRunPanel', { runId: 'r2', pipelineId: 'p2' }, { tab: 'qa' }]);
  s.doc.querySelector('.chat-run-tile-open').click();
  await settle(s.window);
  assert.deepEqual(s.calls.at(-1), ['openRunPanel', { runId: 'r2', pipelineId: 'p2' }, { tab: 'workflow' }]);
  const t = setup({ runs: RUNS({ needs: [WAITING()] }), threadId: 'ask_00000009' });
  await settle(t.window);
  t.doc.querySelector('.chat-run-tile-answer').click();
  await settle(t.window);
  assert.deepEqual(t.calls.at(-1), ['openThread', 'ask_00000009'], 'the chat that follows the run wins');
  const asked = t.calls.filter((c) => c[0] === 'threadForRun').length;
  t.doc.querySelector('.chat-run-tile-open').click();
  await settle(t.window);
  assert.deepEqual(t.calls.at(-1), ['openRunPanel', { runId: 'r2', pipelineId: 'p2' }, { tab: 'workflow' }],
    'the title opens the run\'s graph even when a chat follows it');
  assert.equal(t.calls.filter((c) => c[0] === 'threadForRun').length, asked, 'the title looks nothing up');
  assert.equal(answerTab({ source: 'live' }), 'qa');
  assert.equal(answerTab({ source: 'history' }), 'clarify');
  assert.deepEqual(runRef({ runId: null, pipelineId: 'p9', projectKey: 'k', workspaceId: '' }), { pipelineId: 'p9', projectKey: 'k' });
});

test('Recent chats and Workflows render from their loaders; a workflow arms New run with its prefill', async () => {
  const threads = Array.from({ length: 8 }, (_, i) => ({ id: `ask_0000000${i}`, title: `Chat ${i}`, updatedAt: '2026-10-11T00:00:00Z' }));
  const s = setup({ threads, workflows: { list: [WF_DEFAULT], portsFn: portsFnFor({}, {}) } });
  await settle(s.window);
  assert.equal(selected(s.doc), 'chats');
  const rows = s.doc.querySelectorAll('.chat-home-chat');
  assert.equal(rows.length, 6, 'at most six recent chats');
  rows[0].click();
  assert.deepEqual(s.calls.at(-1), ['openThread', 'ask_00000000']);
  tab(s.doc, 'workflows').click();
  const card = s.doc.querySelector('.chat-home-wf');
  assert.ok(card.querySelector('.chat-home-wf-tb svg'));
  card.click();
  assert.deepEqual(s.calls.slice(-2), [['setIntent', 'run'], ['prefill', 'Run Default on worca-cc: ']]);
});

test('promos arm their intents with real-feature prefills; Schedules is an Advanced promo', async () => {
  const s = setup();
  await settle(s.window);
  const cards = [...s.doc.querySelectorAll('.chat-home-promo')];
  assert.deepEqual(cards.map((c) => c.dataset.promo), ['workflows', 'away', 'schedules']);
  assert.deepEqual(cards.map((c) => c.dataset.minLevel), ['simple', 'simple', 'advanced']);
  assert.equal(s.doc.querySelector('.chat-home-promos h2').textContent, 'More you can do');
  assert.equal(cards[0].querySelector('.chat-home-promo-t').textContent, 'Workflows');
  assert.equal(cards[0].querySelector('.chat-home-promo-d').textContent, 'Describe a pipeline, get the graph');
  cards[0].querySelector('button').click();
  assert.deepEqual(s.calls.slice(-2), [['setIntent', 'workflow'], ['prefill', 'Build a workflow that plans, implements, runs the tests and reviews']]);
  cards[1].querySelector('button').click();
  assert.deepEqual(s.calls.slice(-2), [['setIntent', 'away'], ['prefill', "I'm away now"]], 'Step away arrives with its text');
  cards[2].querySelector('button').click();
  assert.deepEqual(s.calls.slice(-2), [['setIntent', 'schedule'], ['prefill', 'Run Memory defragment on worca-cc every night at 02:00']]);
  assert.equal(PROMOS[2].prefill(''), 'Run Memory defragment every night at 02:00');
});

test('switches from deps.flags: script tools off hides Write a script', async () => {
  const s = setup({ flags: { scripts: false, tasks: false } });
  await settle(s.window);
  assert.equal(s.doc.querySelector('.chat-home-act[data-intent="script"]').hidden, true);
  assert.equal(s.doc.querySelector('.chat-home-act[data-action="project"]').hidden, false);
});

test('update() with no data re-reads the runs, coalesced; armFlip arms only on the home', async () => {
  const s = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(s.window);
  const next = RUNS({ running: [snap(), snap({ key: 'live:r4', runId: 'r4', title: 'Fourth' })] });
  s.setRuns(next);
  s.home.update();
  s.home.update();
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 1, 'not yet: coalesced');
  await new Promise((r) => s.window.setTimeout(r, RUNS_COALESCE_MS + 60));
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 2);
  assert.equal(s.home.armFlip(), true);
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.equal(s.home.armFlip(), false, 'a send from a thread is no hero send');
});

test('findFollowingThread: chats that wait or follow a live run first, at most `max` snapshots, runId or pipelineId', async () => {
  const urls = [];
  const res = (body, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => body });
  const list = { threads: [
    { id: 'ask_00000001', runLinks: 0 },
    { id: 'ask_00000002', runLinks: 2, tracking: false },
    { id: 'ask_00000003', runLinks: 1, tracking: true },
    { id: 'ask_00000004', runLinks: 1, waiting: true },
  ] };
  const snaps = {
    ask_00000002: { runLinks: [{ runId: 'r1', pipelineId: 'p1' }] },
    ask_00000003: { runLinks: [{ runId: 'zz', pipelineId: 'other' }] },
    ask_00000004: { runLinks: [{ runId: 'yy', pipelineId: 'p7' }] },
  };
  const fetchFn = async (url) => {
    urls.push(url);
    if (url === '/api/ask/threads?limit=50') return res(list);
    const id = url.split('/').pop();
    return snaps[id] ? res(snaps[id]) : res({}, false);
  };
  assert.equal(await findFollowingThread(fetchFn, { runId: 'r1' }), 'ask_00000002');
  assert.deepEqual(urls, ['/api/ask/threads?limit=50', '/api/ask/threads/ask_00000004', '/api/ask/threads/ask_00000003', '/api/ask/threads/ask_00000002']);
  urls.length = 0;
  assert.equal(await findFollowingThread(fetchFn, { pipelineId: 'p7' }), 'ask_00000004');
  assert.equal(urls.length, 2);
  urls.length = 0;
  assert.equal(await findFollowingThread(fetchFn, { runId: 'nope' }, { max: 1 }), null);
  assert.equal(urls.length, 2, 'max caps the snapshot reads');
  assert.equal(await findFollowingThread(fetchFn, {}), null, 'no ids: no scan');
  assert.equal(await findFollowingThread(async () => { throw new Error('down'); }, { runId: 'r1' }), null);
  assert.equal(FOLLOW_SCAN_MAX, 8);
});

test('one route at a time across tiles: another tile pressed during the lookup routes nothing; the pressed tile shows busy', async () => {
  const other = snap({ key: 'live:r5', runId: 'r5', pipelineId: 'p5', title: 'Other', pendingQuestion: { kind: 'clarify', questions: [{ id: 'q9' }] } });
  const s = setup({ runs: RUNS({ needs: [WAITING(), other] }) });
  await settle(s.window);
  const tiles = [...s.doc.querySelectorAll('.chat-run-tile')];
  assert.equal(tiles.length, 2);
  tiles[0].querySelector('.chat-run-tile-answer').click();
  assert.equal(tiles[0].getAttribute('aria-busy'), 'true', 'the pressed tile says it is working');
  tiles[1].querySelector('.chat-run-tile-open').click();             // still inside the first lookup
  await settle(s.window);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'threadForRun').map((c) => c[1].runId), ['r2']);
  assert.deepEqual(s.calls.filter((c) => c[0] === 'openRunPanel').map((c) => [c[1].runId, c[2].tab]), [['r2', 'qa']]);
  assert.equal(tiles[0].getAttribute('aria-busy'), 'false');
});

test('a tile\'s graph mount dies with it: on leaving the home, and when the last run drops out', async () => {
  const s = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(s.window);
  const first = s.doc.querySelector('.chat-run-tile');
  assert.ok(first.querySelector('.gv-host'));
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.equal(first.querySelector('.gv-host'), null, 'leave() destroyed the mount (view + ResizeObserver), not only its DOM');
  s.page.dataset.view = 'home';
  await settle(s.window);
  const second = s.doc.querySelector('.chat-run-tile');
  assert.notEqual(second, first);
  assert.ok(second.querySelector('.gv-host'));
  const none = RUNS();
  s.setRuns(none);
  s.home.update({ runs: none });
  assert.equal(s.doc.querySelector('.chat-home-empty').textContent, 'Nothing running');
  assert.equal(second.querySelector('.gv-host'), null, 'the last run dropping out destroyed its mount');
});

test('a re-read never rebuilds Recent chats or the Workflows grid: the same nodes, the focus stays', async () => {
  const threads = [{ id: 'ask_00000001', title: 'Chat', updatedAt: '2026-10-11T00:00:00Z' }];
  const s = setup({ threads, workflows: { list: [WF_DEFAULT], portsFn: portsFnFor({}, {}) } });
  await settle(s.window);
  assert.equal(selected(s.doc), 'chats');
  const row = s.doc.querySelector('.chat-home-chat');
  row.focus();
  s.home.update({ runs: RUNS() });                                  // what the 1 s tick does
  assert.equal(s.doc.querySelector('.chat-home-chat'), row);
  assert.equal(s.doc.activeElement, row);
  tab(s.doc, 'workflows').click();
  const card = s.doc.querySelector('.chat-home-wf');
  s.home.update({ runs: RUNS() });
  assert.equal(s.doc.querySelector('.chat-home-wf'), card, 'no thumbnail rebuild every second');
});

test('a chat list that answers after the home was left paints nothing into it', async () => {
  const s = setup({ holdThreads: true, threads: [{ id: 'ask_00000001', title: 'Hi', updatedAt: '2026-10-11T00:00:00Z' }] });
  s.page.dataset.view = 'thread';
  await settle(s.window);
  s.releaseThreads();
  await settle(s.window);
  assert.equal(s.doc.querySelector('.chat-home-panel').children.length, 0);
  assert.equal(selected(s.doc), null);
});

test('update() bursts read the runs once per RUNS_COALESCE_MS', async () => {
  const s = setup({ runs: RUNS({ running: [snap()] }) });
  await settle(s.window);
  let reads = 0;
  const counted = { get needs() { reads += 1; return []; }, running: [snap()], finished: [], project: '' };
  s.setRuns(counted);
  s.home.update();
  s.home.update();
  s.home.update();
  await new Promise((r) => s.window.setTimeout(r, RUNS_COALESCE_MS + 60));
  assert.ok(reads >= 1 && reads <= 2, `one coalesced read (+ at most the 1 s tick), got ${reads}`);
});

test('routing outlives no visit: a lookup that resolves after the home was left routes nothing, and never blocks the next visit', async () => {
  const s = setup({ runs: RUNS({ needs: [WAITING()] }) });
  await settle(s.window);
  s.home.destroy();
  const held = [];
  const routed = [];
  const home = createChatHome({ doc: s.doc, host: s.host, heroSlot: s.doc.querySelector('[data-chat-hero-slot]'), deps: {
    runs: () => RUNS({ needs: [WAITING()] }), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }),
    threadForRun: () => new Promise((r) => { held.push(r); }),
    openThread: (id) => routed.push(['openThread', id]), openRunPanel: (ref, opts) => routed.push(['openRunPanel', opts.tab]),
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  await settle(s.window);
  s.doc.querySelector('.chat-run-tile-answer').click();
  s.page.dataset.view = 'thread';                                   // the user opened another chat during the lookup
  await settle(s.window);
  s.page.dataset.view = 'home';                                     // …and came back with the lookup still out
  await settle(s.window);
  s.doc.querySelector('.chat-run-tile-answer').click();
  assert.equal(held.length, 2, 'the hung lookup of the last visit does not block this one');
  held[0]('ask_00000042');
  await settle(s.window);
  assert.deepEqual(routed, [], 'the late answer of the left visit jumps nowhere');
  held[1](null);
  await settle(s.window);
  assert.deepEqual(routed, [['openRunPanel', 'qa']]);
  home.destroy();
});

test('boot: until the runs are known the chat list alone never picks the tab — Needs you wins once they are; the wait is capped', async () => {
  const s = setup({ runs: { ...RUNS(), ready: false }, threads: [{ id: 'ask_00000001', title: 'Hi', updatedAt: '2026-10-11T00:00:00Z' }] });
  await settle(s.window);
  assert.equal(selected(s.doc), null, 'the chats answered before the socket\'s hello: still undecided');
  assert.equal(s.doc.querySelector('.chat-home-panel').getAttribute('aria-busy'), 'true');
  const known = RUNS({ needs: [WAITING()] });
  s.setRuns(known);
  s.home.update({ runs: known });
  assert.equal(selected(s.doc), 'needs', 'the waiting run decides, as on any later visit');
  s.home.destroy();
  const t = setup({ runs: { ...RUNS(), ready: false }, threads: [] });
  t.home.destroy();
  const home = createChatHome({ doc: t.doc, host: t.host, heroSlot: t.doc.querySelector('[data-chat-hero-slot]'), runsWaitMs: 30, deps: {
    runs: () => ({ ...RUNS(), ready: false }), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }), threadForRun: async () => null, openThread() {}, openRunPanel() {},
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  await settle(t.window);
  assert.equal(selected(t.doc), null);
  await new Promise((r) => t.window.setTimeout(r, 60));
  assert.equal(selected(t.doc), 'workflows', 'no socket: after the cap the chats decide as before');
  home.destroy();
});

test('a scroll of the home closes the More menu and the run pickers (they are fixed, their tile moves)', async () => {
  const s = setup();
  await settle(s.window);
  s.doc.querySelector('.chat-home-act[data-action="more"]').click();
  assert.ok(s.doc.querySelector('.wfv-menu'));
  s.host.dispatchEvent(new s.window.Event('scroll'));
  assert.equal(s.doc.querySelector('.wfv-menu'), null);
  s.home.destroy();
  assert.equal(s.doc.querySelector('.chat-home-act'), null, 'gone with the home');
});

test('timers: the visit\'s tick, coalesce and boot wait run on the injected clock (app.js passes unref\'d timers)', async () => {
  const s = setup();
  await settle(s.window);
  s.home.destroy();
  const made = [];
  const cleared = [];
  const timers = {
    setInterval: (fn, ms) => { made.push(['interval', ms]); return made.length; },
    clearInterval: (id) => cleared.push(id),
    setTimeout: (fn, ms) => { made.push(['timeout', ms]); return made.length; },
    clearTimeout: (id) => cleared.push(id),
  };
  const home = createChatHome({ doc: s.doc, host: s.host, heroSlot: s.doc.querySelector('[data-chat-hero-slot]'), timers, deps: {
    runs: () => RUNS(), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }), threadForRun: async () => null, openThread() {}, openRunPanel() {},
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  assert.deepEqual(made, [['timeout', HOLD_MS], ['timeout', RUNS_WAIT_MS], ['interval', RUNS_TICK_MS]], 'the visit started on the injected clock (the hero\'s verb too)');
  home.update();
  assert.deepEqual(made.at(-1), ['timeout', RUNS_COALESCE_MS]);
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.deepEqual(cleared.sort(), [1, 2, 3, 4], 'leaving clears every one of them');
  home.destroy();
});

test('a late answer from a left visit never frees this visit\'s route: another tile pressed during the live lookup routes nothing', async () => {
  const s = setup();
  await settle(s.window);
  s.home.destroy();
  const other = snap({ key: 'live:r5', runId: 'r5', pipelineId: 'p5', title: 'Other', pendingQuestion: { kind: 'clarify', questions: [{ id: 'q9' }] } });
  const held = [];
  const routed = [];
  const home = createChatHome({ doc: s.doc, host: s.host, heroSlot: s.doc.querySelector('[data-chat-hero-slot]'), deps: {
    runs: () => RUNS({ needs: [WAITING(), other] }), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }),
    threadForRun: () => new Promise((r) => { held.push(r); }),
    openThread: (id) => routed.push(['openThread', id]), openRunPanel: (ref, opts) => routed.push(['openRunPanel', ref.runId, opts.tab]),
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  await settle(s.window);
  s.doc.querySelector('.chat-run-tile-answer').click();             // visit 1: its lookup hangs
  s.page.dataset.view = 'thread';
  await settle(s.window);
  s.page.dataset.view = 'home';
  await settle(s.window);
  const tiles = () => [...s.doc.querySelectorAll('.chat-run-tile')];
  tiles()[0].querySelector('.chat-run-tile-answer').click();        // visit 2: its own lookup
  held[0]('ask_00000042');                                          // visit 1's lookup answers late
  await settle(s.window);
  tiles()[1].querySelector('.chat-run-tile-open').click();          // still inside visit 2's lookup
  await settle(s.window);
  assert.deepEqual(routed, [], 'the late answer released nothing: visit 2 still routes once');
  held[1](null);
  await settle(s.window);
  assert.deepEqual(routed, [['openRunPanel', 'r2', 'qa']]);
  home.destroy();
});

test('boot: a run that already needs you decides the tab at once, before the runs are known and the chats answered', async () => {
  const s = setup({ runs: { ...RUNS({ needs: [WAITING()] }), ready: false }, holdThreads: true });
  assert.equal(selected(s.doc), 'needs');
  assert.equal(s.doc.querySelectorAll('.chat-run-tile').length, 1);
});

test('the capped boot wait paints the tab it picks at once, not on the next 1 s re-read', async () => {
  const t = setup({ runs: { ...RUNS(), ready: false } });
  t.home.destroy();
  const home = createChatHome({ doc: t.doc, host: t.host, heroSlot: t.doc.querySelector('[data-chat-hero-slot]'), runsWaitMs: 30, deps: {
    runs: () => ({ ...RUNS(), ready: false }), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }), threadForRun: async () => null, openThread() {}, openRunPanel() {},
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  await settle(t.window);
  await new Promise((r) => t.window.setTimeout(r, 60));
  assert.equal(selected(t.doc), 'workflows');
  const panel = t.doc.querySelector('.chat-home-panel');
  assert.equal(panel.getAttribute('aria-busy'), null);
  assert.equal(panel.querySelector('.chat-home-empty').textContent, 'No workflows');
  home.destroy();
});

test('Workflows shows at most 12 cards, then "All workflows" opens the Workflows page', async () => {
  const list = Array.from({ length: 14 }, (_, i) => ({ ...WF_DEFAULT, id: `wf_${i}`, name: `W${i}` }));
  const s = setup({ workflows: { list, portsFn: portsFnFor({}, {}) } });
  await settle(s.window);
  tab(s.doc, 'workflows').click();
  assert.equal(s.doc.querySelectorAll('.chat-home-wf').length, 12);
  const all = s.doc.querySelector('.chat-home-panel > .chat-home-more-link');
  assert.equal(all.textContent, 'All workflows');
  all.click();
  assert.deepEqual(s.calls.at(-1), ['navigate', '#workflows']);
});

test('a run that appears ahead of the shown tiles is painted in its place, and a reorder moves the tiles', async () => {
  const a = snap({ key: 'live:ra', runId: 'ra', title: 'A' });
  const s = setup({ runs: RUNS({ running: [a] }) });
  await settle(s.window);
  const keys = () => [...s.doc.querySelectorAll('.chat-run-tile')].map((t) => t.dataset.tileKey);
  const b = snap({ key: 'live:rb', runId: 'rb', title: 'B' });
  const next = RUNS({ running: [b, a] });
  s.setRuns(next);
  s.home.update({ runs: next });
  assert.deepEqual(keys(), ['live:rb', 'live:ra'], 'the newest run first, as the list says');
  const swapped = RUNS({ running: [a, b] });
  s.setRuns(swapped);
  s.home.update({ runs: swapped });
  assert.deepEqual(keys(), ['live:ra', 'live:rb']);
});

test('Track a run lists live runs only: a saved run that waits on you is not offered', async () => {
  const saved = { ...WAITING(), source: 'history', key: 'hist:k/p8', runId: null, pipelineId: 'p8', title: 'Saved paused', live: false,
    pendingQuestion: null, status: 'paused', stepper: null, decor: null };
  const s = setup({ runs: RUNS({ needs: [WAITING(), saved], running: [snap()] }) });
  await settle(s.window);
  s.doc.querySelector('.chat-home-act[data-intent="track"]').click();
  assert.deepEqual([...s.doc.querySelectorAll('.wfv-menu .wfv-menu-item .wfv-menu-l')].map((n) => n.textContent),
    ['Offline sync banner', 'Fix the upload test']);
});

test('leaving the home closes the More menu it opened (it is fixed: it would float over the chat)', async () => {
  const s = setup();
  await settle(s.window);
  s.doc.querySelector('.chat-home-act[data-action="more"]').click();
  assert.ok(s.doc.querySelector('.wfv-menu'));
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.equal(s.doc.querySelector('.wfv-menu'), null);
});

test('a promo or a workflow card below the fold scrolls the composer it filled back into the home', async () => {
  const s = setup({ workflows: { list: [WF_DEFAULT], portsFn: portsFnFor({}, {}) } });
  await settle(s.window);
  assert.equal(selected(s.doc), 'workflows');
  const slot = s.doc.querySelector('[data-chat-hero-slot]');
  let top = 627;
  Object.defineProperty(s.host, 'scrollTop', { get: () => top, set: (v) => { top = v; }, configurable: true });
  const rect = (t, h) => () => ({ top: t, bottom: t + h, left: 0, right: 390, width: 390, height: h, x: 0, y: t });
  s.host.getBoundingClientRect = rect(56, 744);                     // the home's own scroll box (390 px phone)
  slot.getBoundingClientRect = rect(-308, 56);                      // the hero composer, scrolled away above it
  s.doc.querySelector('.chat-home-promo[data-promo="schedules"] .chat-home-promo-b').click();
  assert.equal(top, 247, 'the composer sits 16px under the top of the home again');
  slot.getBoundingClientRect = rect(-118, 56);
  s.doc.querySelector('.chat-home-wf').click();
  assert.equal(top, 57);
  slot.getBoundingClientRect = rect(120, 56);                       // already in view: nothing moves
  s.doc.querySelector('.chat-home-promo[data-promo="away"] .chat-home-promo-b').click();
  assert.equal(top, 57);
});

test('a visit loads the pins with the workflows; a pinned workflow tile arms New run with it', async () => {
  const s = setup({ pins: ['wf_pay'], workflows: { list: [{ id: 'wf_pay', name: 'Payroll close', version: 2, nodes: [], wires: [] }], portsFn: null } });
  await settle(s.window);
  const t = s.host.querySelector('.chat-home-act[data-pin="wf_pay"]');
  assert.ok(t, 'the pin tile is in the row');
  t.click();
  assert.deepEqual(s.calls.filter((c) => c[0] === 'setIntent').at(-1),
    ['setIntent', 'run', { workflow: { id: 'wf_pay', name: 'Payroll close' } }]);
});

test('pins that fail to load fall back to the default (Shaper)', async () => {
  const s = setup({ pins: null });
  await settle(s.window);
  assert.ok(s.host.querySelector('.chat-home-act[data-pin="wf_shape"][data-intent="shape"]'));
});

test('update({ workflows }) hands the new list to the row', async () => {
  const s = setup({ pins: ['wf_pay'] });
  await settle(s.window);
  assert.equal(s.host.querySelector('.chat-home-act[data-pin="wf_pay"]'), null, 'not listed yet');
  s.home.update({ workflows: { list: [{ id: 'wf_pay', name: 'Payroll close', version: 2, nodes: [], wires: [] }], portsFn: null } });
  assert.ok(s.host.querySelector('.chat-home-act[data-pin="wf_pay"]'));
});

// The hero's verb on an injected clock: `due` holds the live timers (a cleared one leaves it), `composer` the slot's field.
function heroHome(s, { reduced = false } = {}) {
  s.home.destroy();
  if (reduced) s.window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  const due = new Map();
  let ids = 0;
  const timers = {
    setInterval: () => 0, clearInterval() {},
    setTimeout: (fn, ms) => { ids += 1; due.set(ids, { fn, ms }); return ids; },
    clearTimeout: (id) => { due.delete(id); },
  };
  const home = createChatHome({ doc: s.doc, host: s.host, heroSlot: s.doc.querySelector('[data-chat-hero-slot]'), timers, deps: {
    runs: () => RUNS(), threads: async () => [], workflows: async () => ({ list: [], portsFn: null }),
    flags: async () => ({ scripts: true, tasks: false }), threadForRun: async () => null, openThread() {}, openRunPanel() {},
    setIntent() {}, prefill() {}, navigate() {}, level: () => 'expert' } });
  const h1 = s.host.querySelector('h1.chat-home-title');
  const heroTimers = () => [...due.entries()].filter(([, t]) => t.ms === HOLD_MS || t.ms === FADE_MS + HOLD_MS);
  const fire = () => { const all = heroTimers(); assert.equal(all.length, 1, 'one hero timer at a time'); due.delete(all[0][0]); all[0][1].fn(); };
  const layers = () => [...h1.querySelectorAll('.chat-home-verb-layer')];
  const verbOf = (el) => el.textContent.replace(/\?$/, '');
  const shown = () => { const on = layers().filter((l) => l.classList.contains('is-on')); assert.equal(on.length, 1, 'exactly one layer shows'); return on[0]; };
  const composer = s.doc.querySelector('[data-chat-hero-slot] .ask-input');
  return {
    home, h1, due, heroTimers, fire, layers, verbOf, shown, composer,
    setHidden: (v) => { s.setHidden(v); s.doc.dispatchEvent(new s.window.Event('visibilitychange')); },
    setHiddenQuietly: (v) => { s.setHidden(v); },
    type: (text) => { composer.value = text; composer.dispatchEvent(new s.window.Event('input', { bubbles: true })); },
  };
}

test('the hero: one steady sentence for screen readers; the verb crossfades through create, design, research, fix, analyse, test and round again, in a slot that never changes width; no cursor', async () => {
  const s = setup();
  await settle(s.window);
  const x = heroHome(s);
  assert.equal(x.h1.getAttribute('aria-label'), 'What should worca do?');
  assert.equal(x.h1.querySelector('.chat-home-verb').getAttribute('aria-hidden'), 'true');
  assert.equal(x.h1.querySelector('.chat-home-verb-size').textContent, 'research?', 'the slot is sized by the widest verb: the sentence never moves');
  assert.equal(x.h1.querySelector('.chat-home-cursor'), null, 'no cursor');
  assert.equal(x.h1.querySelector('.chat-home-verb-typed'), null, 'nothing typed');
  assert.equal(x.layers().length, 2, 'two stacked layers');
  assert.equal(x.verbOf(x.shown()), HERO_VERBS[0], 'the first verb is shown whole on a visit');
  assert.equal(x.shown().querySelector('.chat-home-q').textContent, '?', 'the sentence\'s own mark, in the title\'s ink');
  assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [HOLD_MS], 'the first verb holds the full time');
  const seen = [x.verbOf(x.shown())];
  let before = x.shown();
  for (let n = 0; n < HERO_VERBS.length; n += 1) {
    x.fire();
    const on = x.shown();
    assert.notEqual(on, before, 'the other layer fades in');
    assert.equal(x.verbOf(before), seen.at(-1), 'while the leaving layer still holds the old verb (it fades out)');
    assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [FADE_MS + HOLD_MS], 'the fade, then the full hold');
    seen.push(x.verbOf(on));
    before = on;
  }
  assert.deepEqual(seen, [...HERO_VERBS, HERO_VERBS[0]], 'each verb in turn, then round again');
  x.home.destroy();
});

test('the hero waits while the tab is hidden or the composer is focused or holds text, then resumes with a full hold; one timer at a time', async () => {
  const s = setup();
  await settle(s.window);
  const x = heroHome(s);
  x.fire();
  assert.equal(x.verbOf(x.shown()), 'design');
  x.setHidden(true);
  assert.equal(x.heroTimers().length, 0, 'hidden: no timer');
  x.setHidden(false);
  assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [HOLD_MS], 'visible again: a full hold');
  x.setHidden(false);
  s.doc.dispatchEvent(new s.window.Event('visibilitychange'));
  assert.equal(x.heroTimers().length, 1, 'a repeated wake adds no second timer');
  x.composer.focus();
  assert.equal(x.heroTimers().length, 0, 'the composer focused: no timer');
  x.type('fix the');
  assert.equal(x.heroTimers().length, 0, 'typing: still waiting');
  x.composer.blur();
  assert.equal(x.heroTimers().length, 0, 'blurred but holding text: still waiting');
  x.type('');
  assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [HOLD_MS], 'emptied: a full hold');
  x.composer.focus();
  x.composer.blur();
  assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [HOLD_MS], 'blurred empty: a full hold');
  assert.equal(x.verbOf(x.shown()), 'design', 'no change while it waited');
  x.setHiddenQuietly(true);
  x.fire();
  assert.equal(x.verbOf(x.shown()), 'design', 'busy when the hold ends: no change');
  assert.equal(x.heroTimers().length, 0, 'and it waits for the wake');
  x.setHidden(false);
  x.fire();
  assert.equal(x.verbOf(x.shown()), 'research', 'then goes on from where it was');
  x.home.destroy();
});

test('the hero stops on a leave (timer cleared, listeners removed) and starts again whole on a visit', async () => {
  const s = setup();
  await settle(s.window);
  const x = heroHome(s);
  await settle(s.window);
  x.fire();
  s.page.dataset.view = 'thread';
  await settle(s.window);
  assert.equal(x.heroTimers().length, 0, 'leaving clears the timer');
  x.setHidden(true);
  x.setHidden(false);
  x.composer.focus();
  x.composer.blur();
  x.type('');
  assert.equal(x.heroTimers().length, 0, 'and no listener wakes it');
  s.page.dataset.view = 'home';
  await settle(s.window);
  assert.equal(x.verbOf(x.shown()), HERO_VERBS[0], 'a visit starts from the first verb, shown whole');
  assert.deepEqual(x.heroTimers().map(([, t]) => t.ms), [HOLD_MS]);
  x.fire();
  assert.equal(x.verbOf(x.shown()), HERO_VERBS[1], 'and goes round from there');
  x.home.destroy();
  assert.equal(x.heroTimers().length, 0, 'destroy leaves nothing running');
});

test('the hero with reduced motion: a static "do", no timer, no cursor, and no wake starts one', async () => {
  const s = setup();
  await settle(s.window);
  const x = heroHome(s, { reduced: true });
  assert.equal(x.verbOf(x.shown()), 'do', 'reduced motion: the plain sentence');
  assert.equal(x.h1.querySelector('.chat-home-cursor'), null, 'and no cursor');
  assert.equal(x.heroTimers().length, 0, 'no timer');
  x.setHidden(true);
  x.setHidden(false);
  x.composer.focus();
  x.composer.blur();
  assert.equal(x.heroTimers().length, 0, 'no wake starts one');
  x.home.destroy();
  const t = setup();
  await settle(t.window);
  const y = heroHome(t);
  y.fire();
  t.window.matchMedia = (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, removeEventListener() {} });
  y.fire();
  assert.equal(y.verbOf(y.shown()), 'do', 'reduced motion switched on mid-loop: "do" at the next change');
  assert.equal(y.heroTimers().length, 0, 'and nothing more is timed');
  y.home.destroy();
});

test('the hero CSS: two layers crossfade (opacity and a 2px blur, --verb-fade = FADE_MS, ease-in-out); no cursor or blink; reduced motion drops the transition', () => {
  const css = readFileSync(new URL('../ui/public/chat/chat-home.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (sel) => { const m = css.match(new RegExp('(?:^|[\\s}])' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\{([^}]*)\\}')); return m ? m[1] : null; };
  assert.doesNotMatch(css, /chat-home-cursor|chat-home-blink|chat-home-verb-typed/);
  assert.equal(body('.chat-home-verb'), `--verb-fade:${FADE_MS}ms;display:inline-grid;text-align:left;color:var(--ink-2);`);
  assert.equal(body('.chat-home-verb > span'), 'grid-area:1/1;white-space:nowrap;');
  assert.equal(body('.chat-home-verb-layer'), 'opacity:0;filter:blur(2px);transition:opacity var(--verb-fade) ease-in-out,filter var(--verb-fade) ease-in-out;');
  assert.equal(body('.chat-home-verb-layer.is-on'), 'opacity:1;filter:none;');
  assert.equal(body('.chat-home-q'), 'color:var(--ink);');
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{\.chat-home-verb-layer\{transition:none;filter:none;\}\}/);
});

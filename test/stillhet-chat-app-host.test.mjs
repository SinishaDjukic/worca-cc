// test/stillhet-chat-app-host.test.mjs — Chat in the app host, live kind (jsdom, the app's scripts in boot.js's order,
// data-adapter="live"): a task's chat is the one that started it; a conversation's loading, failed and gone looks; a send,
// a row action and a bulk archive call dev's routes, and a refusal toasts `Could not ACTION: REASON` and changes nothing;
// no control says "Not connected" or "Would".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { SOURCES, NOW, THREAD, RUN_STATE } from './helpers/stillhet-live-fixture.mjs';
import { SOURCES as URLS } from '../ui/public/stillhet/live/live-adapter.mjs';

const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const BY_URL = Object.fromEntries(Object.entries(URLS).map(([k, u]) => [u, k]));
const clone = (x) => JSON.parse(JSON.stringify(x));
const toastText = (d) => (d.defaultView.RailHost?.toastEl || d.querySelector('body > .rc-toast'))?.textContent || '';

// dev's GET lists a Chat control picks from (chat-live.mjs CATALOG)
const LISTS = {
  '/api/ask/models': { models: [{ id: 'opus', label: 'Opus 5.5', efforts: ['low', 'medium', 'high'] }, { id: 'sonnet', label: 'Sonnet 5.5', efforts: ['low', 'high'] }, { id: 'gpt', label: 'Codex 5', engine: 'codex', efforts: ['high'] }], default: { model: 'opus', effort: 'high' } },
  '/api/chat-home/pins': { pins: ['wf_shape'] },
  '/api/workflows': { workflows: [{ id: 'wf_shape', name: 'Shaper' }, { id: 'wf_lean', name: 'Lean' }] },
  '/api/guardrails': { guardrails: [{ id: 'normal', name: 'Normal' }, { id: 'strict', name: 'Strict' }, { id: 'permissive', name: 'Permissive' }] },
};
async function liveHost({ sources = SOURCES, thread = () => [200, THREAD], write = () => [200, {}], hash = '#chat', lists = LISTS, beforeScripts = () => {}, hold = () => null } = {}) {
  const calls = [], sockets = [];
  const fetch = async (u, o = {}) => {
    const url = String(u), method = o.method || 'GET', body = o.body ? JSON.parse(o.body) : undefined;
    if (url !== '/api/ask/mcp-preview' && url !== '/api/history/pr') calls.push({ url, method, body });   // the Sets preview and History's PR lookup are reads (POST by dev's design)
    await hold(url);   // a source held back: its answer lands when the test says
    const [status, data] = method !== 'GET' ? await write(url, body, method) : BY_URL[url] ? [200, clone(sources[BY_URL[url]] ?? {})] : lists[url] ? [200, lists[url]] : url.startsWith('/api/ask/threads/') ? await thread(url) : [404, {}];
    return { ok: status < 300, status, json: async () => clone(data) };
  };
  const w = stillhetHost({ adapter: 'live', hash, fetch, after, beforeScripts: (win) => {
    win.WebSocket = class { constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); } close() {} send() {} };
    win.Date.now = () => NOW;
    win.Element.prototype.scrollIntoView = function () {};
    win.Element.prototype.scrollTo = function () {};
    beforeScripts(win);
  } });
  w.RailAdapter.importLive = () => import('../ui/public/stillhet/live/live-adapter.mjs');
  await settle();
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: sources.hello.runs }) });
  await settle();
  return { w, d: w.document, calls, sockets };
}
const go = async (w, hash, ms = 60) => { w.location.hash = hash; await settle(ms); };
const store = (w) => clone({ data: w.RailWorld.data(), chats: w.RailWorld.part('chats') });

test('chatOfTask: the starting chat for a started run, none for a run a chat only follows (R-qa-9)', async () => {
  const { w } = await liveHost();
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-a' }), 'ask_1');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-b' }), '', 'ask_2 only follows run-b');
  assert.equal(typeof w.RailChatLive.act, 'function');
});

test('a conversation: loading until the thread answers, then its turns; a 404 is gone; a 500 failed with Try again', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  let answer = [200, THREAD];
  const { w, d } = await liveHost({ thread: async () => { await gate; return answer; } });
  await go(w, '#chat/ask_1', 10);
  assert.match(d.getElementById('route-chat').textContent, /Loading this chat…/);
  release(); await settle(60);
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Add a CSV export/);
  assert.match(text, /Worca could not answer this time\./);
  answer = [404, { error: 'thread not found' }];
  await go(w, '#chat/ask_2');
  assert.match(d.getElementById('route-chat').textContent, /This chat no longer exists/);
  assert.equal(d.querySelector('#route-chat [data-thread-retry]'), null, 'gone: no Try again');
});

test('a failed load says so with Try again, and Try again shows the turns', async () => {
  let answer = [500, { error: 'boom' }];
  const { w, d } = await liveHost({ thread: () => answer });
  await go(w, '#chat/ask_1');
  assert.match(d.getElementById('route-chat').textContent, /Could not load this chat/);
  answer = [200, THREAD];
  d.querySelector('#route-chat [data-thread-retry]').click();
  await settle(60);
  assert.match(d.getElementById('route-chat').textContent, /Add a CSV export/);
});

test('send: dev\'s message route; refused, one toast with its words, the text kept, nothing written', async () => {
  const { w, d, calls } = await liveHost({ write: (url) => (url.endsWith('/messages') ? [409, { error: 'turn in flight' }] : [200, {}]) });
  await go(w, '#chat/ask_1');
  const before = store(w);
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'And the dates?';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method === 'POST').map((c) => [c.url, c.body?.text]), [['/api/ask/threads/ask_1/messages', 'And the dates?']]);
  assert.equal(toastText(d), 'Could not send your message: turn in flight');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, 'And the dates?', 'the text is kept');
  assert.deepEqual(store(w), before);
});

test('a row action refused (pin): one toast naming it, the list and store unchanged', async () => {
  const { w, d, calls } = await liveHost({ write: () => [409, { error: 'chat is busy' }] });
  const before = store(w);
  d.querySelector('#bar-chat [data-menu="row:chat:ask_1"]').click();
  d.querySelector('#bar-chat [data-menu-pick="row:chat:ask_1|pin"]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]), [['PATCH', '/api/ask/threads/ask_1', { pinned: false }]], 'ask_1 is pinned: the action unpins it');
  assert.equal(toastText(d), 'Could not pin the chat: chat is busy');
  assert.deepEqual(store(w), before);
  assert.ok(!toastText(d).includes(w.RailAdapter.NOT_CONNECTED));
});

// Step 7's DISABLED_OK: the only controls the live kind may draw disabled, each for its runtime reason. At rest none of
// them holds, so the walk finds no disabled control at all; a pending one is checked in its own test above.
const DISABLED_OK = Object.freeze({
  '[data-cp-mic]': 'the browser gives the page no microphone (voiceSupport says no)',
  '[data-bulk]': 'a busy chat in the bulk bar (dev refuses CHAT_BUSY)',
  '[data-cp-send]': 'Send while the message is on its way',
  '[data-pp-start], [data-live], [data-act], [data-cp-apply], [data-changes-send], [data-direction-send], [data-wt-yes]': 'its action is pending (asserted in the pending test)',
});
const CONTROLS = 'button, a[href], [role="menuitem"], [role="option"], input, textarea';
async function walk(w, d, rootSel) {
  const seen = [], disabled = [];
  const all = () => [...d.querySelectorAll(`${rootSel} :is(${CONTROLS})`)];
  const n = all().length;
  for (let k = 0; k < n; k++) {
    const el = all()[k];
    if (!el) continue;
    if (el.disabled) { disabled.push(el.outerHTML.slice(0, 120)); continue; }
    if (el.matches('input, textarea')) { el.focus(); el.dispatchEvent(new w.Event('input', { bubbles: true })); continue; }
    if (el.matches('[data-dl-copy], [data-copy]')) continue;   // the clipboard: its own test (copy)
    el.click(); await settle(5);
    seen.push(toastText(d));
    if (d.querySelector('dialog[open], .discard-modal[open]')) d.querySelector('dialog[open] [data-dialog-no], dialog[open] .btn-quiet')?.click();
  }
  return { n, seen, disabled };
}
test('the walk over the Chat control set (conversation, Chat home, the bar\'s chat column and their open menus) never says "Not connected" or "Would", and no control is disabled outside DISABLED_OK (R-qa-11)', async () => {
  const { w, d } = await liveHost({ write: () => [200, {}] });
  for (const [hash, root] of [['#chat/ask_1', '#route-chat'], ['#chat', '#route-chat'], ['#chat', '#bar-chat']]) {
    await go(w, hash);
    const { n, seen, disabled } = await walk(w, d, root);
    assert.ok(n > 3, `${hash} ${root}: ${n} controls`);
    assert.ok(!seen.some((t) => t.includes(w.RailAdapter.NOT_CONNECTED)), `${hash} ${root}: no Not connected`);
    assert.ok(!seen.some((t) => /^Would/.test(t)), `${hash} ${root}: no Would`);
    const stray = disabled.filter((html) => !Object.keys(DISABLED_OK).some((sel) => { const box = d.createElement('div'); box.innerHTML = html.replace(/>.*$/s, '>') + '</button>'; return box.firstElementChild?.matches(sel); }));
    assert.deepEqual(stray, [], `${hash} ${root}: disabled outside DISABLED_OK`);
    assert.equal(d.querySelector(`${root} [data-say]`), null, `${root}: no demo sentence hook in the live kind`);
  }
});

test('a bulk archive with 2 of 5 chats refused: one toast with the count and the first reason; the rest are archived', async () => {
  const src = clone(SOURCES);
  src.threads.threads = ['a', 'b', 'c', 'd', 'e'].map((k, i) => ({ id: `ask_${k}`, title: `Chat ${k}`, waiting: false, inFlight: false, pinnedAt: null, archivedAt: null, updatedAt: SOURCES.threads.threads[1].updatedAt, startedRuns: 0, runLinks: 0, rank: i }));
  const busy = new Set(['/api/ask/threads/ask_b', '/api/ask/threads/ask_d']);
  const { w, d, calls } = await liveHost({ sources: src, write: (url) => (busy.has(url) ? [409, { error: 'chat is busy' }] : [200, {}]) });
  for (const k of ['a', 'b', 'c', 'd', 'e']) d.querySelector(`#bar-chat [data-open="chat:ask_${k}"]`).dispatchEvent(new w.MouseEvent('click', { bubbles: true, ctrlKey: true, metaKey: true }));
  const bar = d.querySelector('#bar-chat [data-bulk="archive"]');
  assert.ok(bar, 'the bulk bar is up');
  bar.click();
  await settle(80);
  assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => c.url).sort(), ['a', 'b', 'c', 'd', 'e'].map((k) => `/api/ask/threads/ask_${k}`));
  assert.ok(calls.filter((c) => c.method === 'PATCH').every((c) => c.body.archived === true));
  assert.equal(toastText(d), 'Could not archive 2 of 5 chats: chat is busy');
});

test('a task opened from the bar lands on its chat with its card focused, also when the thread is still loading', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d } = await liveHost({ thread: async () => { await gate; return [200, THREAD]; } });
  w.RailConversation.openTask('ask_1', 'run-a');
  await settle(20);
  assert.equal(w.location.hash, '#chat/ask_1');
  release(); await settle(80);
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card, 'the TaskCard is drawn');
  assert.ok(card.contains(d.activeElement), 'its head has the focus');
});

test('Chat home: a send makes the chat, posts the text and opens it with its YouTurn; a refused message deletes the empty chat', async () => {
  let msg = 202;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    if (url.endsWith('/messages')) return msg < 300 ? [202, { userMessageId: 'u1', assistantMessageId: 'a1' }] : [409, { error: 'turn in flight' }];
    return [200, {}];
  } });
  msg = 409;
  let t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(60);
  assert.deepEqual(calls.filter((c) => c.method !== 'GET').map((c) => `${c.method} ${c.url}`), ['POST /api/ask/threads', 'POST /api/ask/threads/ask_new/messages', 'DELETE /api/ask/threads/ask_new']);
  assert.equal(toastText(d), 'Could not send your message: turn in flight');
  assert.equal(w.location.hash, '#chat', 'the address stays');
  msg = 202; calls.length = 0;
  t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click();
  await settle(80);
  assert.equal(w.location.hash, '#chat/ask_new');
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Hello/);
  assert.doesNotMatch(text, /Loading this chat/);
});

const posts = (calls) => calls.filter((c) => c.method !== 'GET').map((c) => [c.method, c.url, c.body]);
const withRun = (over) => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.map((r) => (r.runId === 'run-a' ? { ...r, ...over } : r)); return src; };
// run-a ended: the store holds it as its saved row (pipeline pa), stopped, and ask_1's card is that task's
const stoppedRun = () => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.filter((r) => r.runId !== 'run-a'); src.history.pipelines = src.history.pipelines.map((r) => (r.id === 'pa' ? { ...r, status: 'stopped' } : r)); return src; };
// Chromium blurs a focused button the moment it is disabled; jsdom does not, so the test does (blur first, then set)
function blurOnDisable(win) {
  const proto = win.HTMLButtonElement.prototype, desc = Object.getOwnPropertyDescriptor(proto, 'disabled');
  Object.defineProperty(proto, 'disabled', { configurable: true, get() { return desc.get.call(this); }, set(v) { if (v) this.blur(); desc.set.call(this, v); } });
}
const menuPick = async (d, menuId, item) => { d.querySelector(`#route-chat [data-menu="${menuId}"]`).click(); await settle(5); d.querySelector(`#route-chat [data-menu-pick="${menuId}|${item}"]`).click(); await settle(40); };

test('a live TaskCard draws only its run\'s facts (no demo PR, branch, base or cap) and its step from the run\'s own stages (R-ux-12)', async () => {
  const { w, d, sockets } = await liveHost({ sources: withRun({ pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  let card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card, 'the TaskCard is drawn');
  for (const fake of ['#1180', 'feat/billing-csv-export', 'into dev', '$40', '17:00']) assert.ok(!card.textContent.includes(fake), `no demo fact ${fake}`);
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state', runId: 'run-a', ...RUN_STATE() }) });
  await settle(60);
  card = d.querySelector('#route-chat [data-anchor="card_run"]');
  const steps = [...card.querySelectorAll('.sl-step')];
  assert.equal(steps.length, 4, 'Plan, Build, Review, Ready');
  assert.equal(steps.findIndex((e) => e.classList.contains('is-now')), 1, 'on Build: step 2 of 4');
  assert.doesNotMatch(card.textContent, /agents?\b/i, 'never an agents ratio');
});

test('a live card\'s ⋯ offers only what dev can do; Archive asks, then posts dev\'s archive', async () => {
  const { w, d, calls } = await liveHost({ sources: stoppedRun() });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="card:pa"]').click(); await settle(5);
  const items = [...d.querySelectorAll('#route-chat [data-menu-pick^="card:pa|"]')].map((e) => e.dataset.menuPick.split('|')[1]);
  for (const no of ['Report this task', 'Save as preset', 'Run after…', 'Move to group…']) assert.ok(!items.includes(no), `${no} is not offered live`);
  assert.ok(items.includes('Archive') && items.includes('Label…') && items.includes('Start a follow-up'), items.join(', '));
  d.querySelector('#route-chat [data-menu-pick="card:pa|Archive"]').click(); await settle(10);
  d.querySelector('#route-chat [data-card-yes="pa"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'pa' }] }]]);
});

test('Ask for changes under a live card: dev\'s changes route; refused, one toast and the words stay', async () => {
  let status = 409;
  const { w, d, calls } = await liveHost({ sources: stoppedRun(), write: (url) => (url.endsWith('/changes') ? [status, status < 300 ? {} : { error: 'run is busy' }] : [200, {}]) });
  await go(w, '#chat/ask_1');
  await menuPick(d, 'card:pa', 'Start a follow-up');
  const field = d.querySelector('#route-chat [data-ask-changes="card_run"]');
  assert.ok(field, 'the field opens under the card');
  field.value = 'Use ISO dates'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(60);
  assert.deepEqual(posts(calls), [['POST', '/api/ask/threads/ask_1/changes', { pipelineId: 'pa', text: 'Use ISO dates' }]]);
  assert.equal(toastText(d), 'Could not send your changes: run is busy');
  assert.equal(d.querySelector('#route-chat [data-ask-changes="card_run"]').value, 'Use ISO dates', 'the words are kept');
  status = 200;
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(60);
  assert.equal(d.querySelector('#route-chat [data-ask-changes="card_run"]'), null, 'sent: the field closes');
});

test('a pending control is drawn disabled until dev answers, then enabled with its focus back (focus-after-disable)', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d, calls } = await liveHost({ beforeScripts: blurOnDisable, write: async (url) => { if (url === '/api/run') await gate; return [200, {}]; } });
  await go(w, '#chat/ask_1');
  const start = d.querySelector('#route-chat [data-pp-start="card_prop"]');
  start.focus(); start.click(); await settle(30);
  assert.equal(d.querySelector('#route-chat [data-pp-start="card_prop"]').disabled, true, 'disabled while out, also after a repaint');
  release(); await settle(40);
  const again = d.querySelector('#route-chat [data-pp-start="card_prop"]');
  assert.equal(again.disabled, false);
  assert.equal(d.activeElement, again, 'the focus comes back');
  assert.equal(calls.filter((c) => c.url === '/api/run').length, 1);
});

test('Start sends the person\'s picks: a stricter guardrail set reaches POST /api/run; permissive is never offered', async () => {
  const { w, d, calls } = await liveHost();
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-pp-more="card_prop"]').click(); await settle(30);
  d.querySelector('#route-chat [data-menu="pp-card_prop-guard"]').click(); await settle(5);
  assert.equal(d.querySelector('#route-chat [data-menu-pick="pp-card_prop-guard|permissive"]'), null);
  d.querySelector('#route-chat [data-menu-pick="pp-card_prop-guard|strict"]').click(); await settle(10);
  d.querySelector('#route-chat [data-pp-start="card_prop"]').click(); await settle(40);
  const run = calls.find((c) => c.url === '/api/run');
  assert.equal(run.body.guardrailsId, 'strict');
  assert.deepEqual([run.body.askThreadId, run.body.askCardId], ['ask_1', 'card_prop']);
});

test('the composer\'s model picker is dev\'s catalog; a pick in a chat is dev\'s PATCH, refused it changes nothing; a Chat home send carries the model and effort', async () => {
  let ok = false;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (method === 'PATCH') return ok ? [200, {}] : [409, { error: 'turn in flight' }];
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_new' } }];
    return [202, { userMessageId: 'u1' }];
  } });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  const labels = [...d.querySelectorAll('#route-chat [data-menu-pick^="cp-engine|"]')].map((e) => e.textContent.trim());
  assert.ok(labels.some((l) => l.includes('Opus 5.5')) && labels.some((l) => l.includes('Codex 5')), labels.join(', '));
  d.querySelector('#route-chat [data-menu-pick="cp-engine|sonnet"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { model: 'sonnet', effort: 'high' }]]);
  assert.equal(toastText(d), 'Could not switch the model: turn in flight');
  assert.ok(!d.querySelector('#route-chat [data-menu="cp-engine"]').textContent.includes('Sonnet'), 'refused: the picker still says the chat\'s own model');
  calls.length = 0;
  await go(w, '#chat');
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Hello';
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(80);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual([msg.body.model, msg.body.effort], ['opus', 'high']);
});

test('an engine switch dev refuses until the dropped turns are confirmed: the confirm names the count, Switch posts dropTurns; Cancel posts nothing', async () => {
  let n = 0;
  const { w, d, calls } = await liveHost({ write: (url, body) => (url.endsWith('/engine') ? (++n === 1 ? [409, { error: 'Codex will not see the 3 oldest turns of this chat: confirm that first', code: 'confirm-dropped-turns', droppedTurns: 3 }] : [200, { ok: true }]) : [200, {}]) });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-engine|gpt"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/ask/threads/ask_1/engine', { engine: 'codex', model: 'gpt', effort: 'high' }]], 'a chat that replied switches its engine; never a fallback PATCH');
  assert.match(d.getElementById('route-chat').textContent, /Switch to Codex 5\? It will not see the 3 oldest turns of this chat\./);
  assert.ok(!/Could not/.test(toastText(d)), 'the confirm is the answer, not a toast');
  d.querySelector('#route-chat [data-eng-yes]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/ask/threads/ask_1/engine', { engine: 'codex', model: 'gpt', effort: 'high', dropTurns: 3 }]);
  assert.equal(d.querySelector('#route-chat [data-eng-yes]'), null, 'switched: the confirm is gone');
});

test('a chat with no reply yet has no engine: a model on another engine is dev\'s PATCH {model}, not an engine switch', async () => {
  const one = { ...THREAD, messages: THREAD.messages.filter((m) => m.role === 'user') };
  const { w, d, calls } = await liveHost({ thread: () => [200, one] });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-menu="cp-engine"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-engine|gpt"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { model: 'gpt', effort: 'high' }]]);
});

test('the live composer\'s + menu has no demo ticket, reuse or presets; the starters draw no pin until dev\'s pins answer', async () => {
  const { '/api/chat-home/pins': _pins, ...noPins } = LISTS;   // dev's pins GET fails (404): the row draws none, never the demo's Shaper
  const { w, d } = await liveHost({ lists: noPins });
  await go(w, '#chat');
  assert.deepEqual([...d.querySelectorAll('#route-chat [data-pin]')].map((e) => e.dataset.pin), [], 'no demo Shaper without dev\'s pins');
  d.querySelector('#route-chat [data-menu="cp-plus"]').click(); await settle(5);
  const items = [...d.querySelectorAll('#route-chat [data-menu-pick^="cp-"]')].map((e) => e.dataset.menuPick);
  assert.ok(items.includes('cp-plus|Files'));
  assert.ok(!items.some((i) => /Ticket|Reuse|cp-preset/.test(i)), items.join(', '));
});

test('a send answered after you moved to another chat lands on the chat it was sent from: this composer keeps its own text', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d } = await liveHost({ write: async (url) => { if (url.endsWith('/messages')) { await gate; return [202, { userMessageId: 'u9' }]; } return [200, {}]; } });
  await go(w, '#chat/ask_1');
  d.querySelector('#route-chat [data-composer-t]').value = 'For ask_1';
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(10);
  await go(w, '#chat/ask_2');
  const t = d.querySelector('#route-chat [data-composer-t]'); t.value = 'Draft in ask_2';
  assert.ok(!d.querySelector('#route-chat [data-cp-send]')?.disabled, 'ask_2 is not sending');
  release(); await settle(60);
  assert.equal(w.location.hash, '#chat/ask_2', 'the page stays where you are');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, 'Draft in ask_2');
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-composer-t]').value, '', 'ask_1\'s sent text is cleared in its own composer');
});

test('Chat home pins are dev\'s: read from GET, a pin is dev\'s PUT, and a refused pin changes nothing (D19)', async () => {
  let ok = false;
  const { w, d, calls } = await liveHost({ write: (url) => (url === '/api/chat-home/pins' ? (ok ? [200, { pins: ['wf_shape', 'wf_lean'] }] : [409, { error: 'bad pins' }]) : [200, {}]) });
  await go(w, '#chat');
  const pinned = () => [...d.querySelectorAll('#route-chat [data-pin]')].map((e) => e.dataset.pin);
  assert.deepEqual(pinned(), ['Shaper']);
  const pick = async () => { d.querySelector('#route-chat [data-menu="starter-more"]').click(); await settle(5); d.querySelector('#route-chat [data-menu-pick="starter-more|starter-pin|Lean"]').click(); await settle(40); };
  await pick();
  assert.deepEqual(posts(calls), [['PUT', '/api/chat-home/pins', { pins: ['wf_shape', 'wf_lean'] }]]);
  assert.equal(toastText(d), 'Could not pin the starter: bad pins');
  assert.deepEqual(pinned(), ['Shaper'], 'refused: unchanged');
  ok = true; await pick();
  assert.deepEqual(pinned(), ['Shaper', 'Lean']);
});

test('a task row under a chat in the bar: Archive is dev\'s run archive, never "Not connected"', async () => {
  const { d, calls } = await liveHost();
  const row = d.querySelector('#bar-chat [data-menu^="row:task:"]');
  assert.ok(row, 'the task row has its menu');
  row.click(); await settle(5);
  d.querySelector(`#bar-chat [data-menu-pick="${row.dataset.menu}|archive"]`).click(); await settle(40);
  assert.deepEqual(posts(calls), [['POST', '/api/runs/bulk', { action: 'archive', targets: [{ pipelineId: 'run-a' }] }]]);
  assert.ok(!toastText(d).includes('Not connected'));
});

test('a task row with an open PR: Watch toggles from dev\'s own watch state, so a watched PR is unwatched (GET, then POST watch:false)', async () => {
  const src = clone(SOURCES);
  src.history.pipelines.find((p) => p.id === 'h2').pr = { url: 'https://github.com/acme/api/pull/9', state: 'OPEN' };
  src.runLinks.links.push({ threadId: 'ask_1', runId: 'h2', pipelineId: 'h2', started: true });
  const { d, calls } = await liveHost({ sources: src, lists: { ...LISTS, '/api/pr/watch?id=h2': { watching: true } }, write: () => [200, { watching: false }] });
  const row = d.querySelector('#bar-chat [data-menu="row:task:ask_1:h2"]') || [...d.querySelectorAll('#bar-chat [data-menu^="row:task:"]')].find((e) => e.dataset.menu.endsWith('h2'));
  assert.ok(row, 'the PR task row has its menu');
  row.click(); await settle(5);
  d.querySelector(`#bar-chat [data-menu-pick="${row.dataset.menu}|watch"]`).click(); await settle(40);
  assert.deepEqual(calls.filter((c) => c.url.startsWith('/api/pr/watch')).map((c) => [c.method, c.url, c.body]), [['GET', '/api/pr/watch?id=h2', undefined], ['POST', '/api/pr/watch', { watch: false, id: 'h2' }]]);
  assert.ok(!/Could not/.test(toastText(d)), toastText(d));
});

test('a page\'s dock hands over with the page as dev\'s context (D16)', async () => {
  const { w, d, calls } = await liveHost({ write: (url, body, method) => (url === '/api/ask/threads' && method === 'POST' ? [201, { thread: { id: 'ask_new' } }] : [202, { userMessageId: 'u1' }]) });
  const host = d.createElement('div'); d.body.appendChild(host);
  w.RailConversation.dock(host, { kind: 'project', title: 'web', chat: '', ref: { pageProjectKey: 'web-1' } });
  host.querySelector('[data-composer-t]').value = 'What is behind?';
  host.querySelector('[data-dock-send]').click(); await settle(60);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual(msg.body.context, { view: 'project', pageProjectKey: 'web-1' });
});

test('a real page hands over with its own id: a diverged project\'s page sends its project key as dev\'s context (R-req-2-8)', async () => {
  const { w, d, calls } = await liveHost({ write: (url, body, method) => (url === '/api/ask/threads' && method === 'POST' ? [201, { thread: { id: 'ask_new' } }] : [202, { userMessageId: 'u1' }]) });
  await go(w, '#projects/api-2');
  const btn = d.querySelector('[data-pj-act="api-2"]');
  assert.ok(btn, 'the diverged project offers its hand-over');
  btn.click(); await settle(80);
  const t = d.querySelector('#route-chat [data-composer-t]');
  assert.match(t.value, /diverged/);
  d.querySelector('#route-chat [data-cp-send]').click(); await settle(80);
  const msg = calls.find((c) => c.url.endsWith('/messages'));
  assert.deepEqual(msg.body.context, { view: 'project', pageProjectKey: 'api-2' });
});

test('panel.answer-refs: a run Worca names is a RefChip once dev confirms it, and it lands on the card in the chat that started it; an unconfirmed id stays words', async () => {
  const said = { thread: { id: 'ask_2', title: 'Writing' }, messages: [{ id: 'w1', role: 'assistant', status: 'done', text: 'It is the same as 0a1b2c3d, not 9f9f9f9f.', createdAt: THREAD.messages[0].createdAt, blocks: [] }], runLinks: [], inFlight: null };
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('ask_2') ? [200, said] : [200, THREAD]), write: (url) => (url === '/api/ask/refs/resolve' ? [200, { refs: { 'run:0a1b2c3d': { ok: true, kind: 'run', id: 'pa', runId: 'run-a', title: 'Ask me', status: 'running' }, 'run:9f9f9f9f': { ok: false } } }] : [200, {}]) });
  await go(w, '#chat/ask_2', 120);
  assert.ok(calls.some((c) => c.url === '/api/ask/refs/resolve'), 'dev\'s resolve is asked');
  const chip = d.querySelector('#route-chat .convo-words [data-ref-run]');
  assert.ok(chip, 'a RefChip in Worca\'s words');
  assert.equal(chip.textContent, 'Ask me');
  assert.match(d.querySelector('#route-chat .convo-words').textContent, /not 9f9f9f9f\./, 'an unconfirmed id stays words');
  chip.click(); await settle(60);
  assert.equal(w.location.hash, '#chat/ask_1', 'the chat that started it');
});

test('chatOfTask in the live kind: the starting chat by the run links, an archived one too; a run id never falls back to a title', async () => {
  const src = clone(SOURCES);
  src.threads.threads[0].archivedAt = src.threads.threads[0].updatedAt;
  const { w } = await liveHost({ sources: src });
  assert.equal(w.RailConversation.chatOfTask({ run: 'pa' }), 'ask_1', 'by pipeline id too');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-a' }), 'ask_1');
  assert.equal(w.RailConversation.chatOfTask({ run: 'run-zzz', title: 'Ask me' }), '');
});

test('a Shaper run\'s plan waiting for you is a live PlanCard under its TaskCard: Approve and Ask for changes are dev\'s plan answer (R-fit-5)', async () => {
  const plan = { id: 'q1', kind: 'plan', plan: { title: 'CSV plan', summary: 'Two slices, then one PR', perspectives: ['Product', 'Security'] } };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: plan }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="plan-card_run"]');
  assert.ok(card, 'the PlanCard is drawn');
  assert.match(card.textContent, /CSV plan/);
  assert.match(card.textContent, /Two slices, then one PR/);
  d.querySelector('#route-chat [data-lplan-changes="card_run"]').click(); await settle(10);
  const field = d.querySelector('#route-chat [data-ask-changes="card_run"]');
  field.value = 'Keep it to one slice'; field.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('#route-chat [data-changes-send="card_run"]').click(); await settle(40);
  d.querySelector('#route-chat [data-lplan-approve="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [
    ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'revise', feedback: 'Keep it to one slice' }],
    ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'approve' }],
  ]);
});

test('panel.plan-folds: the live PlanCard draws dev\'s role verdicts, coverage under Read the plan, Fix all in its ⋯ and its open decisions; the picks ride the answer', async () => {
  const roleReviews = { rounds: [{ pass: 1, target: 'plan', roles: [{ key: 'product', label: 'Product', findings: [] }, { key: 'qa', label: 'QA', findings: [{ id: 'f1', severity: 'major', status: 'open' }] }], conflicts: [{ id: 'conflict-1', question: 'One PR or two?', options: ['One PR', 'Two PRs'], roles: ['product', 'qa'] }] }] };
  const plan = { id: 'q1', kind: 'plan', plan: { title: 'CSV plan', summary: 'Two slices', revisable: true, roleReviews, check: { ok: false, items: [{ id: 'tests', label: 'Has a test plan', pass: false }] },
    coverage: { ok: false, passed: 1, total: 2, items: [{ id: 'R-1', label: 'R-1 · covered by Step 2', pass: true }, { id: 'R-2', label: 'R-2 · not covered by any step', pass: false, detail: 'Totals stay right' }] } } };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: plan }), write: (url) => (url.endsWith('/plan') ? [200, { text: '## Steps' }] : [200, {}]), lists: { ...LISTS, '/api/runs/run-a/plan': { text: '## Steps' } } });
  await go(w, '#chat/ask_1');
  const card = () => d.querySelector('#route-chat [data-anchor="plan-card_run"]');
  assert.match(card().textContent, /Reviewed by Product, QA · 1 open · 1 to fix/, 'the roles\' verdicts, not the perspective names');
  assert.doesNotMatch(card().textContent, /Totals stay right/, 'coverage is folded');
  d.querySelector('#route-chat [data-lplan-full="card_run"]').click(); await settle(40);
  assert.match(card().textContent, /Requirements 1 of 2 covered[\s\S]*R-2 · Totals stay right not covered by any step/);
  assert.match(d.getElementById('route-chat').textContent, /One PR or two\?/, 'the open decision is an OptionList under the card');
  d.querySelector('#route-chat [data-lplan-pick="card_run|conflict-1|1"]').click(); await settle(10);
  d.querySelector('#route-chat [data-menu="lplan:card_run"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="lplan:card_run|fix"]').click(); await settle(40);
  const fix = posts(calls).at(-1);
  assert.deepEqual([fix[0], fix[1], fix[2].decision, fix[2].source, fix[2].conflicts], ['POST', '/api/runs/run-a/answer', 'revise', 'check', [{ id: 'conflict-1', choice: 'Two PRs' }]]);
  assert.match(fix[2].feedback, /Has a test plan/); assert.match(fix[2].feedback, /R-2: Totals stay right/);
  d.querySelector('#route-chat [data-lplan-approve="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/runs/run-a/answer', { id: 'q1', decision: 'approve', conflicts: [{ id: 'conflict-1', choice: 'Two PRs' }] }]);
});

test('panel.plan-folds: a run in a feature shows the feature\'s total cost and time in its folded Figures, from dev\'s run-groups', async () => {
  const { w, d } = await liveHost({ lists: { ...LISTS, '/api/run-groups': { groups: [{ id: 'f1', kind: 'feature', title: 'CSV', planning: null, members: [{ pipelineId: 'pa', position: 1 }, { pipelineId: 'h1', position: 2 }], cost: { usd: 3.5, byPipeline: {} } }] } } });
  await go(w, '#chat/ask_1', 120);
  const figs = d.querySelector('#route-chat [data-figs]');
  assert.ok(figs, 'the Figures fold is offered');
  figs.click(); await settle(60);
  assert.match(d.getElementById('route-chat').textContent, /\$3\.50\s*the feature so far/);
  assert.match(d.getElementById('route-chat').textContent, /since its first task · 2 tasks/);
});

test('panel.ship-card: a feature\'s ship marks each requirement (dev\'s acceptance PUT), ships one PR or stacked (dev\'s feature ship), and Create PR waits for every mark', async () => {
  let marked = false;
  const shipBlock = () => ({ kind: 'card', id: 'card_ship', state: 'proposed', card: { type: 'ship', featureId: 'f1', title: 'CSV export', files: 7, suggested: 'one', acceptance: { agreed: [{ id: 'R-1', text: 'Totals' }, { id: 'R-2', text: 'ISO dates' }], entries: [{ id: 'R-1', mark: 'met' }, ...(marked ? [{ id: 'R-2', mark: 'dropped', reason: 'not needed' }] : [])] } } });
  const thread = () => ({ thread: { id: 'ask_2', title: 'Writing' }, messages: [{ id: 's1', role: 'assistant', status: 'done', text: '', createdAt: THREAD.messages[0].createdAt, blocks: [shipBlock()] }], runLinks: [], inFlight: null });
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('ask_2') ? [200, thread()] : [200, THREAD]), write: (url) => { if (url.endsWith('/acceptance')) marked = true; return [200, {}]; } });
  await go(w, '#chat/ask_2');
  const go1 = () => d.querySelector('#route-chat [data-ship]');
  assert.equal(go1().disabled, true, 'one requirement is not marked yet');
  assert.match(go1().title, /1 left/);
  d.querySelector('#route-chat [data-menu="ship-card_ship-1"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="ship-card_ship-1|dropped"]').click(); await settle(10);
  d.querySelector('#route-chat [data-ship-why="card_ship"]').value = 'not needed';
  d.querySelector('#route-chat [data-ship-why-save="card_ship"]').click(); await settle(60);
  assert.deepEqual(posts(calls).at(-1), ['PUT', '/api/shape/features/f1/acceptance', { entries: [{ id: 'R-2', mark: 'dropped', reason: 'not needed' }] }]);
  assert.equal(go1().disabled, false, 'every requirement is marked: Create PR is on');
  d.querySelector('#route-chat [data-menu="shiphow-card_ship"]').click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="shiphow-card_ship|as stacked PRs"]').click(); await settle(10);
  go1().click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/shape/features/f1/ship', { mode: 'stacked' }]);
  assert.ok(!calls.some((c) => c.url === '/api/pr'), 'never the single-run PR route');
});

test('Settings › Chat › Delete all chats: dev\'s counts read fresh, the confirm says them, Delete all is dev\'s DELETE /api/ask/threads', async () => {
  const { w, d, calls } = await liveHost({ lists: { ...LISTS, '/api/ask/history': { threads: 3, worktrees: 1, attachments: 2, inFlight: 1 } }, write: (url, body, method) => (method === 'DELETE' && url === '/api/ask/threads' ? [200, { ok: true, removed: { threads: 3, worktrees: 1 }, failed: [] }] : [200, {}]) });
  await go(w, '#settings/ask', 120);
  const btn = [...d.querySelectorAll('[data-svdo]')].find((b) => /Delete all chats/.test(b.textContent));
  assert.ok(btn, 'the row\'s action is drawn');
  assert.ok(!btn.disabled);
  btn.click(); await settle(80);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/history'), 'the counts are dev\'s, read now');
  assert.match(d.body.textContent, /Delete all 3 chats, with 1 worktree and 2 attachments\? 1 chat in progress will be stopped\./);
  const yes = d.querySelector('[data-confirm="yes"]');
  assert.ok(yes, 'its confirm');
  yes.click(); await settle(80);
  assert.deepEqual(posts(calls).filter((c) => c[1] === '/api/ask/threads'), [['DELETE', '/api/ask/threads', undefined]]);
  assert.match(toastText(d), /Deleted 3 chats and 1 worktree\./);
});

test('MCP off: the composer\'s Sets are dev\'s preview; a set switched off in a chat is dev\'s PATCH {mcpOff}', async () => {
  const { w, d, calls } = await liveHost({ write: (url) => (url === '/api/ask/mcp-preview' ? [200, { sets: [{ id: 'team-a', name: 'Team tools', members: 2, skills: 1 }, { id: 'empty', name: 'Empty', members: 0, skills: 0 }] }] : [200, {}]) });
  await go(w, '#chat/ask_1', 120);
  const picker = d.querySelector('#route-chat [data-menu="cp-sets"]');
  assert.ok(picker, 'the Sets picker is drawn');
  assert.match(picker.textContent, /Sets · 1/, 'only a set with a server or a skill counts');
  picker.click(); await settle(5);
  d.querySelector('#route-chat [data-menu-pick="cp-sets|team-a"]').click(); await settle(40);
  assert.deepEqual(posts(calls).filter((c) => c[0] === 'PATCH'), [['PATCH', '/api/ask/threads/ask_1', { mcpOff: { sets: ['team-a'], members: [] } }]]);
});

test('a live run\'s own question is answered under its TaskCard: a pick, your own words or Worca\'s picks, as dev\'s POST /api/answer', async () => {
  const ask = { id: 'q9', kind: 'questions', questions: [{ id: 'fmt', question: 'Which format?', options: ['CSV', 'XLSX'], recommended: 'XLSX' }] };
  const { w, d, calls } = await liveHost({ sources: withRun({ pendingQuestion: ask }) });
  await go(w, '#chat/ask_1');
  assert.match(d.querySelector('#route-chat [data-anchor="ask-card_run"]').textContent, /Which format\?/);
  d.querySelector('#route-chat [data-rq="card_run|0|0"]').click(); await settle(10);
  d.querySelector('#route-chat [data-rq-go="card_run"]').click(); await settle(40);
  d.querySelector('#route-chat [data-rq-picks="card_run"]').click(); await settle(40);
  assert.deepEqual(posts(calls), [
    ['POST', '/api/answer', { runId: 'run-a', id: 'q9', payload: { answers: [{ id: 'fmt', choice: 'CSV' }] } }],
    ['POST', '/api/answer', { runId: 'run-a', id: 'q9', payload: { answers: [{ id: 'fmt', choice: 'XLSX' }] } }],
  ]);
});

// a page's own sentence (RailPulse.say, the first `body > .rc-toast`) next to the host's refusal toast
const saidText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).join(' | ');
// ---- web UI review cycle 1: no fake success, deep links, ids dev can never hold, Undo, the chat's project ----
test('a chat opened by its address (a reload, a bookmark) is read and drawn, not Chat home', async () => {
  const { d, calls } = await liveHost({ hash: '#chat/ask_1' });
  await settle(60);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/threads/ask_1'), 'the thread is read');
  const text = d.getElementById('route-chat').textContent;
  assert.match(text, /Add a CSV export/);
  assert.equal(d.querySelector('#route-chat [data-home]'), null, 'not Chat home');
});

test('an id dev can never hold (400 invalid thread id) reads as gone, with no Try again; dev\'s #chat/new is Chat home', async () => {
  const { w, d, calls } = await liveHost({ thread: (url) => (url.endsWith('/ask_1') ? [200, THREAD] : [400, { error: 'invalid thread id' }]) });
  await go(w, '#chat/does-not-exist');
  assert.match(d.getElementById('route-chat').textContent, /This chat no longer exists/);
  assert.equal(d.querySelector('#route-chat [data-thread-retry]'), null);
  assert.doesNotMatch(d.querySelector('#route-chat .convo-head').textContent, /No project|\+ Label/, 'a gone chat has nothing to label or place');
  calls.length = 0;
  await go(w, '#chat/new');
  assert.equal(w.location.hash, '#chat');
  assert.ok(d.querySelector('#route-chat [data-home]'), 'Chat home');
  assert.ok(!calls.some((c) => c.url.includes('/threads/new')), 'thread "new" is never asked for');
});

test('live chat labels: the picker lists the labels in use (GET /api/ask/labels); a change is PUT /api/ask/threads/:id/labels and the head and toast follow the answer', async () => {
  const sources = clone(SOURCES);
  sources.threads.threads[0].labels = ['infra'];
  let answer = [400, { error: '"a label": a label is at most 32 characters' }];
  const { w, d, calls } = await liveHost({ sources, lists: { ...LISTS, '/api/ask/labels': { labels: [{ label: 'billing', count: 2 }, { label: 'infra', count: 1 }] } },
    write: (url, body, method) => {
      if (method !== 'PUT' || url !== '/api/ask/threads/ask_1/labels') return [200, {}];
      if (answer[0] >= 300) return answer;
      sources.threads.threads[0].labels = body.labels;   // the server keeps them: the list's re-read brings them back
      return [200, { labels: body.labels, changed: true }];
    } });
  await go(w, '#chat/ask_1');
  const head = () => [...d.querySelectorAll('#route-chat .convo-head > .kind-chip')].map((e) => e.textContent).join(' ');   // the chips, not the open picker's rows
  assert.equal(head(), 'infra', 'the chat\'s stored labels');
  d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30);
  assert.ok(calls.some((c) => c.method === 'GET' && c.url === '/api/ask/labels'), 'the picker reads the labels in use');
  const rows = () => [...d.querySelectorAll('#route-chat [data-listtoggle^="label|"]')].map((e) => `${e.dataset.listtoggle.slice(6)}:${e.getAttribute('aria-checked')}`);
  assert.deepEqual(rows(), ['billing:false', 'infra:true']);
  // refused: one toast with the server's reason, nothing labelled
  d.querySelector('#route-chat [data-listtoggle="label|billing"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['PUT', '/api/ask/threads/ask_1/labels', { labels: ['infra', 'billing'] }]);
  assert.equal(toastText(d), 'Could not label the chat: "a label": a label is at most 32 characters');
  assert.doesNotMatch(head(), /billing/);
  // ok: the head and the toast follow the answer
  answer = [200];
  d.querySelector('#route-chat [data-listtoggle="label|billing"]').click(); await settle(40);
  assert.match(head(), /billing/);
  assert.match(saidText(d), /Labelled billing/);
  // Enter makes a new one; taking one off is a PUT without it
  if (!d.querySelector('#route-chat #cl-label-q')) { d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30); }
  const q = d.querySelector('#route-chat #cl-label-q');
  q.value = 'Release'; q.dispatchEvent(new w.Event('input', { bubbles: true })); await settle(5);
  d.querySelector('#route-chat #cl-label-q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(40);
  assert.deepEqual(posts(calls).at(-1)[2], { labels: ['infra', 'billing', 'release'] });
  assert.match(saidText(d), /Labelled release/);
  if (!d.querySelector('#route-chat [data-listtoggle="label|infra"]')) { d.querySelector('#route-chat [data-menu="cl-label"]').click(); await settle(30); }
  d.querySelector('#route-chat [data-listtoggle="label|infra"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1)[2], { labels: ['billing', 'release'] });
  assert.match(saidText(d), /Removed the label infra/);
  await settle(300);
  assert.ok(calls.filter((c) => c.url === '/api/ask/threads?show=all').length >= 2, 'the list is read again after a change');
  assert.equal(head(), 'billing release', 'the re-read list keeps what the server stored');
});

test('Follow a task: a new chat asks Worca to follow the run by its id (dev\'s track_run); the toast and the chat wait for dev\'s ok', async () => {
  let msg = 409;
  const { w, d, calls } = await liveHost({ write: (url, body, method) => {
    if (url === '/api/ask/threads' && method === 'POST') return [201, { thread: { id: 'ask_fol' } }];
    if (url.endsWith('/messages')) return msg < 300 ? [202, { userMessageId: 'u1' }] : [409, { error: 'turn in flight' }];
    return [200, {}];
  } });
  const follow = async () => { d.querySelector('#route-chat [data-starter="track"]').click(); await settle(5); const item = d.querySelector('#route-chat [data-menu-pick^="starter-track|"]'); assert.ok(item, 'a running task to follow'); item.click(); await settle(80); return item; };
  await follow();
  assert.deepEqual(posts(calls).map(([m, u]) => `${m} ${u}`), ['POST /api/ask/threads', 'POST /api/ask/threads/ask_fol/messages', 'DELETE /api/ask/threads/ask_fol']);
  assert.equal(toastText(d), 'Could not send your message: turn in flight', 'refused: the send\'s one toast, no "Following"');
  assert.equal(w.location.hash, '#chat');
  assert.ok(!w.RailChats.data().chats.some((c) => /^Follow /.test(c.title)), 'no local-only chat');
  msg = 202; calls.length = 0;
  await follow();
  const sent = posts(calls).find(([, u]) => u.endsWith('/messages'));
  assert.equal(sent[2].text, 'Follow run run-a and tell me when it needs me.', 'the run id alone, never its title');
  assert.match(saidText(d), /Asked Worca to follow /);
  assert.equal(w.location.hash, '#chat/ask_fol');
});

test('Archive from a chat row: dev\'s PATCH, its toast has Undo, and Undo is dev\'s PATCH {archived:false}', async () => {
  const { w, d, calls } = await liveHost({ write: () => [200, {}] });
  d.querySelector('#bar-chat [data-menu="row:chat:ask_1"]').click();   // ask_2 is replying: dev refuses a busy chat
  d.querySelector('#bar-chat [data-menu-pick="row:chat:ask_1|archive"]').click();
  await settle(60);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { archived: true }]]);
  assert.match(saidText(d), /Archived 1 chat/);
  const undo = d.querySelector('body > .rc-toast [data-undo]');
  assert.ok(undo, 'the toast offers Undo');
  calls.length = 0;
  undo.click(); await settle(60);
  assert.deepEqual(posts(calls), [['PATCH', '/api/ask/threads/ask_1', { archived: false }]]);
});

test('a chat\'s project is dev\'s thread context: the composer and head name it once dev has it', async () => {
  const src = clone(SOURCES);
  src.threads.threads = src.threads.threads.map((t) => (t.id === 'ask_1' ? { ...t, context: { pinned: true, projectKey: 'web-1' } } : t));
  const th = clone(THREAD); th.thread.context = { pinned: true, projectKey: 'web-1' };
  const { w, d } = await liveHost({ sources: src, thread: () => [200, th] });
  const name = src.projects.projects.find((p) => p.key === 'web-1').name;
  assert.equal(w.RailChats.data().chats.find((c) => c.id === 'ask_1').project, name);
  await go(w, '#chat/ask_1');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, new RegExp(name));
  assert.match(d.querySelector('#route-chat [data-cp-project], #route-chat [data-menu="cp-project"]')?.textContent || d.querySelector('#route-chat .convo-dock').textContent, new RegExp(name));
});

const savedRun = (row) => { const src = clone(SOURCES); src.hello.runs = src.hello.runs.filter((r) => r.runId !== 'run-a'); src.history.pipelines = src.history.pipelines.map((r) => (r.id === 'pa' ? { ...r, ...row } : r)); return src; };
const cardItems = async (d, id) => { d.querySelector(`#route-chat [data-menu="card:${id}"]`).click(); await settle(5); return [...d.querySelectorAll(`#route-chat [data-menu-pick^="card:${id}|"]`)].map((e) => e.dataset.menuPick.split('|')[1]); };

test('a chat opened by its address draws its project and its cards once the store loads, with no hash change', async () => {
  // the thread is drawn first; the chat's project (threads) and its run link (run-links) reach the store after it
  const src = clone(SOURCES), links = src.runLinks.links;
  src.projects = { projects: [{ key: 'web', name: 'web', path: '/src/web' }] }; src.runLinks = { links: [] };
  const { w, d, sockets } = await liveHost({ hash: '#chat/ask_1', sources: src });
  await settle(60);
  assert.equal(d.querySelector('#route-chat [data-anchor="card_run"]'), null, 'the run links are not in yet');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, /No project/);
  src.runLinks = { links }; src.threads.threads = src.threads.threads.map((t) => (t.id === 'ask_1' ? { ...t, context: { projectKey: 'web' } } : t));
  for (const type of ['ask-run-status', 'ask-labels-changed']) sockets.at(-1).onmessage({ data: JSON.stringify({ type }) });
  await settle(400);
  assert.equal(w.location.hash, '#chat/ask_1');
  assert.ok(d.querySelector('#route-chat [data-anchor="card_run"]'), 'the TaskCard is drawn');
  assert.match(d.querySelector('#route-chat .convo-head').textContent, /^web/);
});

test('a live TaskCard says its state once: the line under the head never repeats the word', async () => {
  const { w, d } = await liveHost({ sources: withRun({ pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.equal(card.textContent.match(/Working/g)?.length, 1, card.textContent);
});

test('a paused task offers Stop and Resume, never the fixes of a failure; Resume posts dev\'s pipeline id', async () => {
  const { w, d, calls } = await liveHost({ sources: withRun({ status: 'paused', pendingQuestion: null }) });
  await go(w, '#chat/ask_1');
  const items = await cardItems(d, 'run-a');
  assert.ok(items.includes('Stop'), items.join(', '));
  for (const no of ['Ask Worca to fix it', 'Tell Worca how to fix it']) assert.ok(!items.includes(no), `${no} is for a failure`);
  d.querySelector('#route-chat [data-card-act="run-a|Resume now"]').click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/resume', { pipelineId: 'pa' }]);
});

test('a task waiting on its question can be stopped from its card', async () => {
  const { w, d, calls } = await liveHost();
  await go(w, '#chat/ask_1');
  assert.ok((await cardItems(d, 'run-a')).includes('Stop'));
  d.querySelector('#route-chat [data-menu-pick="card:run-a|Stop"]').click(); await settle(10);
  d.querySelector('#route-chat [data-card-yes="run-a"]')?.click(); await settle(40);
  assert.deepEqual(posts(calls).at(-1), ['POST', '/api/stop', { runId: 'run-a' }]);
});

test('a failed run reads Failed on its card, never Stopped', async () => {
  const { w, d } = await liveHost({ sources: savedRun({ status: 'error' }) });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.match(card.textContent, /Failed/);
  assert.doesNotMatch(card.textContent, /Stopped/);
});

test('a finished task with its branch is Ready: Create PR and View changes, and its stage bar stops at PR', async () => {
  const { w, d, calls } = await liveHost({ sources: savedRun({ status: 'done', branch: 'feat/x', survived: true, projectKey: 'web-1a2b3c4d', projectDir: '/src/web' }) });
  const opened = [], was = globalThis.open;
  globalThis.open = (u) => { opened.push(u); return {}; };   // chat-live.mjs openTab: the page's window.open (set once the host is up)
  after(() => { globalThis.open = was; });
  await go(w, '#chat/ask_1');
  const card = d.querySelector('#route-chat [data-anchor="card_run"]');
  assert.ok(card.querySelector('[data-card-act="pa|Create PR"]'), 'Create PR is its one action');
  assert.ok(!card.querySelectorAll('.sl-knot')[4].classList.contains('is-done'), 'Merged is not lit');
  assert.ok((await cardItems(d, 'pa')).includes('View changes'));
  d.querySelector('#route-chat [data-menu-pick="card:pa|View changes"]').click(); await settle(20);
  // a branch run's changes are dev's recovery-patch (changes/patch is folder-only and answers 409 NOT_FOLDER_RUN)
  assert.deepEqual(opened, ['/api/runs/pa/recovery-patch?projectKey=web-1a2b3c4d']);
  // Create PR carries the run's store key: POST /api/pr refuses a body with neither it nor the project folder
  d.querySelector('#route-chat [data-card-act="pa|Create PR"]').click(); await settle(5);
  d.querySelector('#route-chat [data-card-form="pa"] [data-confirm]')?.click(); await settle(20);
  const pr = calls.find((c) => c.url === '/api/pr');
  assert.ok(pr, 'Create PR reaches POST /api/pr');
  assert.equal(pr.body.id, 'pa');
  assert.equal(pr.body.projectKey, 'web-1a2b3c4d');
});

test('an applied change dev cannot undo has no Revert; a revertible receipt keeps it', async () => {
  const blocks = [{ kind: 'card', id: 'cm', state: 'applied', card: { type: 'model', summary: 'Use Sonnet' } }, { kind: 'card', id: 'cr', state: 'applied', card: { type: 'receipt', label: 'Theme', before: 'light', after: 'dark', revertible: true } }];
  const th = { ...THREAD, messages: [...THREAD.messages.slice(0, 1), { id: 'mx', role: 'assistant', text: '', status: 'done', createdAt: THREAD.messages[0].createdAt, blocks }] };
  const { w, d } = await liveHost({ thread: () => [200, th] });
  await go(w, '#chat/ask_1');
  assert.equal(d.querySelector('#route-chat [data-cp-revert="cm"]'), null);
  assert.ok(d.querySelector('#route-chat [data-cp-revert="cr"]'));
});

test('Pulse and search open a live task at its card in its starting chat; a task no chat started opens its page', async () => {
  const { w, d } = await liveHost();
  w.RailShell.openRun('run/question', 'A task', 'run-a');   // what a Pulse row does: its case, its title, its run id
  await settle(80);
  assert.equal(w.location.hash, '#chat/ask_1');
  assert.ok(d.querySelector('#route-chat [data-anchor="card_run"]'), 'the TaskCard is drawn');
  w.RailShell.openRun('run/question', 'B task', 'run-b');   // ask_2 only follows run-b: no starting chat
  await settle(40);
  assert.equal(w.location.hash, '#run/question');
});

test('Show its stages opens the live TaskCard in place, and Hide its stages folds it', async () => {
  const { w, d } = await liveHost();
  await go(w, '#chat/ask_1', 80);
  const btn = () => d.querySelector('#route-chat [data-anchor="card_run"] [data-open-task]');
  assert.equal(btn().getAttribute('aria-expanded'), 'false');
  btn().click(); await settle(20);
  assert.equal(btn().getAttribute('aria-expanded'), 'true', 'Show its stages opens it');
  assert.match(btn().textContent, /Hide its stages/);
  btn().click(); await settle(20);
  assert.equal(btn().getAttribute('aria-expanded'), 'false', 'Hide its stages folds it');
});

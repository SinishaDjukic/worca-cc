// test/ui-chat-direction.test.mjs — worca Chat P3 (R10): the composer's "→ <run title>" chip. It shows while the open
// thread follows a live run, swaps the placeholder when on, and turns the next send into
// POST /api/ask/threads/:id/directions; an error stays in the chip row and keeps the typed text.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { checkRows } from './helpers/rows.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { createDirectionAddon, registerDirectionAddon, followedRun, linksOf, DIRECTION_PLACEHOLDER, DIRECTION_MAX_CHARS, DIRECTION_ADDON_ID } from '../ui/public/chat/direction.mjs';
import { composerAddons, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { DIRECTION_MAX_CHARS as SERVER_MAX } from '../src/core/directions.mjs';

const trackDom = useDomRelease(afterEach);
const snap = (over = {}) => ({ source: 'live', runId: 'run-uuid-1', pipelineId: 'abcd1234', title: 'Fix login', status: 'running', startedAt: '2026-10-11T10:00:00Z', pendingQuestion: null, ...over });

function fakeStore() {
  const snaps = new Map();
  const subs = new Set();
  return { snaps, subs,
    get: (id) => snaps.get(id) || null,
    byPipeline: (pid) => [...snaps.values()].find((s) => s.pipelineId === pid) || null,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    poke(type = 'state') { for (const fn of [...subs]) fn('run-uuid-1', type); } };
}
// P1's composer: .ask-composer > .ask-composer-box > div.chat-composer-lead[data-chat-composer-lead] (the lead row);
// P1 hands add-ons thread.runLinks as an ARRAY of {runId, pipelineId, cardId, status, phase}.
function mount({ fetchHandler = null, links = [{ runId: 'run-uuid-1', pipelineId: 'abcd1234', cardId: 'card_1', status: 'running', phase: null }] } = {}) {
  const dom = trackDom(new JSDOM('<!doctype html><div class="ask-composer"><div class="ask-composer-box"><div class="chat-composer-lead" data-chat-composer-lead></div></div></div>'));
  const doc = dom.window.document;
  const lead = doc.querySelector('[data-chat-composer-lead]');
  const store = fakeStore();
  store.snaps.set('run-uuid-1', snap());
  const placeholders = [], said = [], fetches = [];
  let thread = { id: 'ask_00000001', runLinks: links };
  const ctx = { doc, threadId: () => 'ask_00000001', thread: () => thread, runStore: store,
    setPlaceholder: (t) => placeholders.push(t), focus: () => {}, announce: (t) => said.push(t),
    fetch: (u, o) => { fetches.push({ url: String(u), body: JSON.parse(o.body) }); return Promise.resolve(fetchHandler ? fetchHandler() : { ok: true, status: 201, json: async () => ({ id: 'd1' }) }); } };
  const handle = createDirectionAddon().mount(lead, ctx);
  handle.update(thread);
  return { doc, lead, store, handle, ctx, placeholders, said, fetches, setThread: (t) => { thread = t; },
    chip: () => lead.querySelector('.chat-dir-chip'), err: () => lead.querySelector('.chat-dir-err'), composer: doc.querySelector('.ask-composer') };
}

test('the chip shows for a followed live run, toggles direction mode, and a send goes to the run', async () => {
  await checkRows([
    { name: 'in the lead row with the run title; toggling swaps the placeholder and marks the composer', run: async () => {
      const m = mount();
      assert.ok(m.chip(), 'the chip is in the lead row');
      assert.equal(m.chip().closest('[data-chat-composer-lead]'), m.lead);
      assert.equal(m.chip().querySelector('.chat-dir-title').textContent, 'Fix login');
      assert.equal(m.chip().getAttribute('aria-pressed'), 'false');
      assert.equal(m.chip().title, 'Send to the run. The next step reads it');
      m.chip().click();
      assert.equal(m.chip().getAttribute('aria-pressed'), 'true');
      assert.deepEqual(m.placeholders, [DIRECTION_PLACEHOLDER]);
      assert.ok(m.composer.classList.contains('is-direction'));
      m.chip().click();
      assert.deepEqual(m.placeholders, [DIRECTION_PLACEHOLDER, null]);
      assert.equal(m.composer.classList.contains('is-direction'), false);
    } },
    { name: 'off: the send is Ask\'s', run: async () => {
      const m = mount();
      assert.equal(await m.handle.beforeSend('hello'), false);
      assert.deepEqual(m.fetches, []);
    } },
    { name: 'on: the trimmed text posts to the thread route by pipeline id; sent → handled, chip off, announced', run: async () => {
      const m = mount();
      m.chip().click();
      assert.equal(await m.handle.beforeSend('  Use the blue button '), true);
      assert.deepEqual(m.fetches, [{ url: '/api/ask/threads/ask_00000001/directions', body: { runId: 'abcd1234', text: 'Use the blue button' } }]);
      assert.equal(m.chip().getAttribute('aria-pressed'), 'false');
      assert.equal(m.placeholders.at(-1), null);
      assert.deepEqual(m.said, ['Direction sent to Fix login']);
    } },
    { name: 'a refusal keeps the text and says why in the chip row; too long never leaves the browser', run: async () => {
      const m = mount({ fetchHandler: () => ({ ok: false, status: 409, json: async () => ({ error: 'run is finished; a direction would never be read', code: 'RUN_FINISHED' }) }) });
      m.chip().click();
      assert.equal(await m.handle.beforeSend('x'), 'keep');
      assert.equal(m.err().hidden, false);
      assert.equal(m.err().textContent, 'Not sent: run is finished; a direction would never be read');
      assert.equal(m.chip().getAttribute('aria-pressed'), 'true', 'still on: fix and resend, or toggle off');
      assert.equal(await m.handle.beforeSend('y'.repeat(DIRECTION_MAX_CHARS + 1)), 'keep');
      assert.equal(m.err().textContent, `A direction can be at most ${DIRECTION_MAX_CHARS} characters`);
      assert.equal(m.fetches.length, 1);
    } },
  ]);
});

test('the chip follows the run: gone (lead row empty again) when the run ends and direction mode drops, back for a paused run; no thread yet = no chip; destroy cleans up', async () => {
  const m = mount();
  m.chip().click();
  m.store.snaps.set('run-uuid-1', snap({ status: 'done' }));
  m.store.poke('log');
  assert.ok(m.chip(), 'log lines change nothing');
  m.store.poke('done');
  assert.equal(m.chip(), null);
  assert.equal(m.lead.childNodes.length, 0, 'the lead row is :empty again (P1 hides it)');
  assert.equal(m.placeholders.at(-1), null, 'direction mode dropped with the run');
  assert.equal(m.composer.classList.contains('is-direction'), false);
  m.store.snaps.set('run-uuid-1', snap({ status: 'paused' }));
  m.store.poke('state');
  assert.ok(m.chip(), 'a paused run reads it on resume');
  m.setThread(null);
  m.handle.update(null);
  assert.equal(m.chip(), null, 'a new chat (no row yet) follows nothing');
  m.setThread({ id: 'ask_00000001', runLinks: [{ runId: 'run-uuid-1', pipelineId: 'abcd1234', cardId: null, status: 'paused', phase: null }] });
  m.handle.update(null);
  assert.ok(m.chip(), 'update(null) falls back to ctx.thread()');
  m.handle.destroy();
  assert.equal(m.lead.querySelector('.chat-dir-chip'), null);
  assert.equal(m.store.subs.size, 0);
});

test('linksOf / followedRun: P1\'s run-link array; the newest live run wins; finished runs never count', async () => {
  await checkRows([
    { name: 'the array P1 hands add-ons; anything else is no links', run: async () => {
      assert.deepEqual(linksOf({ runLinks: [{ runId: 'r1', pipelineId: 'p1', cardId: 'c', status: 'running', phase: null }, { runId: 'r2', pipelineId: null, cardId: null, status: null, phase: null }] }),
        [{ runId: 'r1', pipelineId: 'p1' }, { runId: 'r2', pipelineId: null }]);
      assert.deepEqual(linksOf({ runLinks: new Map([['r1', { pipelineId: 'p1' }]]) }), [], 'never the Map (P1 contract note 8)');
      assert.deepEqual(linksOf(null), []);
      assert.deepEqual(linksOf({}), []);
    } },
    { name: 'the newest live run; a finished one is skipped; a waiting one counts', run: async () => {
      const store = fakeStore();
      store.snaps.set('r-old', snap({ runId: 'r-old', pipelineId: 'aaaa0001', title: 'Old', startedAt: '2026-10-11T09:00:00Z' }));
      store.snaps.set('r-new', snap({ runId: 'r-new', pipelineId: 'bbbb0002', title: 'New', startedAt: '2026-10-11T11:00:00Z' }));
      store.snaps.set('r-done', snap({ runId: 'r-done', pipelineId: 'cccc0003', title: 'Done', status: 'done', startedAt: '2026-10-11T12:00:00Z' }));
      const thread = { runLinks: [{ runId: 'r-old', pipelineId: 'aaaa0001' }, { runId: 'r-new', pipelineId: 'bbbb0002' }, { runId: 'r-done', pipelineId: 'cccc0003' }] };
      assert.equal(followedRun(thread, store).title, 'New');
      store.snaps.set('r-new', snap({ runId: 'r-new', pipelineId: 'bbbb0002', title: 'New', status: 'stopped' }));
      assert.equal(followedRun(thread, store).title, 'Old');
      store.snaps.set('r-old', snap({ runId: 'r-old', pipelineId: 'aaaa0001', title: 'Old', status: 'running', pendingQuestion: { id: 'q' } }));
      assert.equal(followedRun(thread, store).title, 'Old');
      assert.equal(followedRun(thread, null), null);
    } },
    { name: 'the browser limit is the server limit; registration adds one `direction` add-on', run: async () => {
      assert.equal(DIRECTION_MAX_CHARS, SERVER_MAX);
      _resetChatExtensions();
      registerDirectionAddon();
      assert.deepEqual(composerAddons().map((a) => a.id), [DIRECTION_ADDON_ID]);
      _resetChatExtensions();
    } },
  ]);
});

test('direction mode is armed for one chat and one run: another chat or a newer run drops it; the same run\'s resume keeps it', async () => {
  const m = mount();
  m.store.snaps.set('run-uuid-2', snap({ runId: 'run-uuid-2', pipelineId: 'beef5678', title: 'Other run', startedAt: '2026-10-11T11:00:00Z' }));
  const link1 = { runId: 'run-uuid-1', pipelineId: 'abcd1234', cardId: 'card_1', status: 'running', phase: null };
  const link2 = { runId: 'run-uuid-2', pipelineId: 'beef5678', cardId: 'card_2', status: 'running', phase: null };
  const go = (t) => { m.setThread(t); m.handle.update(t); };
  m.chip().click();
  go({ id: 'ask_00000002', runLinks: [link2] });
  assert.equal(m.chip().querySelector('.chat-dir-title').textContent, 'Other run');
  assert.equal(m.chip().getAttribute('aria-pressed'), 'false', 'never carried into another chat');
  assert.equal(m.placeholders.at(-1), null);
  assert.equal(await m.handle.beforeSend('a question for Ask'), false);
  assert.deepEqual(m.fetches, []);
  go({ id: 'ask_00000001', runLinks: [link1] });
  m.chip().click();
  m.store.snaps.delete('run-uuid-1');
  m.store.snaps.set('run-uuid-1b', snap({ runId: 'run-uuid-1b' }));            // a resume: new lineage, same pipeline
  go({ id: 'ask_00000001', runLinks: [{ ...link1, runId: 'run-uuid-1b' }] });
  assert.equal(m.chip().getAttribute('aria-pressed'), 'true', 'the same run, resumed, stays armed');
  go({ id: 'ask_00000001', runLinks: [{ ...link1, runId: 'run-uuid-1b' }, link2] });
  assert.equal(m.chip().querySelector('.chat-dir-title').textContent, 'Other run');
  assert.equal(m.chip().getAttribute('aria-pressed'), 'false', 'a newer run never inherits the switch');
  assert.equal(await m.handle.beforeSend('meant for Fix login'), false);
  assert.deepEqual(m.fetches, []);
});

test('a second send while the first is in flight posts nothing and keeps the text', async () => {
  const waits = [];
  const m = mount({ fetchHandler: () => new Promise((r) => waits.push(r)) });
  m.chip().click();
  const first = m.handle.beforeSend('one');
  const second = m.handle.beforeSend('two');
  for (const r of waits) r({ ok: true, status: 201, json: async () => ({ id: 'd1' }) });
  assert.equal(await second, 'keep');
  assert.equal(await first, true);
  assert.equal(m.fetches.length, 1);
});

test('direction mode never follows the user into another chat, even one that follows the same run', async () => {
  const m = mount();
  const go = (t) => { m.setThread(t); m.ctx.threadId = () => t.id; m.handle.update(t); };   // P1: ctx.threadId() is the open chat
  m.chip().click();
  go({ id: 'ask_00000002', runLinks: [{ runId: 'run-uuid-1', pipelineId: 'abcd1234', cardId: 'card_9', status: 'running', phase: null }] });
  assert.equal(m.chip().querySelector('.chat-dir-title').textContent, 'Fix login', 'the same run');
  assert.equal(m.chip().getAttribute('aria-pressed'), 'false');
  assert.equal(await m.handle.beforeSend('meant for Ask'), false);
  assert.deepEqual(m.fetches, []);
});

test('direction mode on a run whose pipeline id is not known yet: armed by its live id, kept as the id arrives and across its resume; a newer such run never inherits it', async () => {
  const idless = (runId, over = {}) => snap({ runId, pipelineId: null, status: 'starting', ...over });
  const link = (runId, pipelineId = null) => ({ runId, pipelineId, cardId: `card_${runId}`, status: 'running', phase: null });
  // a newer run with no pipeline id yet is another run
  const a = mount({ links: [link('run-uuid-1')] });
  a.store.snaps.set('run-uuid-1', idless('run-uuid-1'));
  a.handle.update({ id: 'ask_00000001', runLinks: [link('run-uuid-1')] });
  a.chip().click();
  a.store.snaps.set('run-uuid-2', idless('run-uuid-2', { title: 'Other run', startedAt: '2026-10-11T12:00:00Z' }));
  a.handle.update({ id: 'ask_00000001', runLinks: [link('run-uuid-1'), link('run-uuid-2')] });
  assert.equal(a.chip().querySelector('.chat-dir-title').textContent, 'Other run');
  assert.equal(a.chip().getAttribute('aria-pressed'), 'false', 'a newer run never inherits the switch');
  // the same run: a frame, then its first `state` (the pipeline id), then a resume (new live id)
  const m = mount({ links: [link('run-uuid-1')] });
  m.store.snaps.set('run-uuid-1', idless('run-uuid-1'));
  m.handle.update({ id: 'ask_00000001', runLinks: [link('run-uuid-1')] });
  m.chip().click();
  m.store.poke();
  assert.equal(m.chip().getAttribute('aria-pressed'), 'true', 'armed by the live id while the pipeline id is unknown');
  m.store.snaps.set('run-uuid-1', snap());                                     // abcd1234
  m.store.poke();
  assert.equal(m.chip().getAttribute('aria-pressed'), 'true');
  m.store.snaps.delete('run-uuid-1');
  m.store.snaps.set('run-uuid-1b', snap({ runId: 'run-uuid-1b' }));
  m.handle.update({ id: 'ask_00000001', runLinks: [link('run-uuid-1b', 'abcd1234')] });
  assert.equal(m.chip().getAttribute('aria-pressed'), 'true', 'the same run, resumed');
});

test('a send the network drops says "Not sent — network error", never the browser\'s TypeError text', async () => {
  const m = mount({ fetchHandler: () => Promise.reject(new TypeError('Failed to fetch')) });
  m.chip().click();
  assert.equal(await m.handle.beforeSend('x'), 'keep');
  assert.equal(m.err().textContent, 'Not sent: network error');
  assert.deepEqual(m.said, ['Not sent: network error']);
  assert.equal(m.chip().getAttribute('aria-pressed'), 'true', 'still on: resend once the connection is back');
});

test('direction CSS: the direction placeholder stays on one line in a narrow composer (Chrome ignores text-overflow in ::placeholder)', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const p3 = css.slice(css.indexOf('/* ===== Chat P3: run card ===== */'));
  assert.ok(p3.includes('.ask-composer.is-direction textarea.ask-input::placeholder{white-space:nowrap;overflow:hidden;}'));
  assert.doesNotMatch(p3, /::placeholder\{[^}]*text-overflow/);
  // Chrome, 360 px: "Not sent — network error" squeezed into a 61 px column beside the chip (3 lines); it now drops under it.
  assert.ok(p3.includes('.chat-dir{display:inline-flex;flex-wrap:wrap;align-items:center;gap:6px;row-gap:4px;min-width:0;}'));
});

// test/stillhet-chat-prose-host.test.mjs — panel.rendered-prose in the Chat host (jsdom): a finished reply from dev is drawn
// by Prose (dev's markdown renderer and sanitiser, ui/public/ask-markdown.mjs), with dev's answer chips inside it; a
// streaming reply stays plain words. The host does not load components.js, so each window gets the real marked and
// dompurify through __worcaTestHooks.askMarkdown, the loader Prose asks first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marked } from 'marked';
import createDOMPurify from 'dompurify';
import { liveHost, go, settle, until, clone, posts, THREAD } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

const MODS = { marked, createDOMPurify };
const hook = (load = () => Promise.resolve(MODS)) => (win) => { win.__worcaTestHooks = { askMarkdown: load }; };
const reply = (text, status = 'done') => ({ id: 'r1', role: 'assistant', status, text, createdAt: THREAD.messages[0].createdAt, blocks: [] });
const threadOf = (messages) => { const th = clone(THREAD); th.messages = messages; th.runLinks = []; th.inFlight = null; return () => [200, th]; };
async function open(t, text, { status = 'done', load, refs = {} } = {}) {
  const h = await liveHost({ thread: threadOf([reply(text, status)]), beforeScripts: hook(load), write: (url) => (url === '/api/ask/refs/resolve' ? [200, { refs }] : [200, {}]) });
  t.after(() => h.w.close());
  await go(h.w, '#chat/ask_1', 120);
  await until(() => h.d.querySelector('#route-chat .convo-words'), 15000);   // the thread's read lands before the turn draws
  return { ...h, q: (s) => h.d.querySelector(`#route-chat ${s}`), qa: (s) => [...h.d.querySelectorAll(`#route-chat ${s}`)] };
}
// A chip lands only after the renderer has loaded, dev's POST /api/ask/refs/resolve has answered and the turn has redrawn;
// under CI's load that chain outruns any fixed wait, so a ref test waits for the confirmed chip itself (the CI flake)
const chipLands = (q, sel) => until(() => q(sel), 15000);
// the same for the render itself: Prose redraws the turn once the renderer has loaded, so a test waits for that redraw
const LOADED = '.convo-words .prose:not(.is-plain)';
const rendered = (q) => until(() => q(LOADED), 15000);
// a click on a link must not navigate jsdom away
const noFollow = (d) => d.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); }, true);

test('a finished reply renders: strong, a list, a code block and a new-tab link inside the words turn, its time last', async (t) => {
  const { q, qa } = await open(t, 'It is **done**.\n\n- one\n- two\n\n```\nnpm test\n```\n\n[docs](https://example.com/docs)');
  await rendered(q);
  const turn = q('div.convo-words[data-words-turn="r1:0"][tabindex="0"]');
  assert.ok(turn, 'the words turn is a div with its key and tab stop');
  assert.ok(turn.querySelector('.prose strong'));
  assert.equal(turn.querySelectorAll('.prose ul > li').length, 2);
  assert.ok(turn.querySelector('.prose pre'));
  assert.equal(turn.querySelector('.prose a').getAttribute('target'), '_blank');
  assert.ok(turn.lastElementChild.matches('time.turn-time'), 'TurnTime is its last child');
  assert.equal(qa('p.convo-words').length, 0);
});

test('a streaming reply stays plain words: its ** reads as typed, no .prose', async (t) => {
  const { q } = await open(t, 'It is **done**', { status: 'streaming' });
  const turn = q('.convo-words');
  assert.match(turn.textContent, /\*\*done\*\*/);
  assert.equal(turn.querySelectorAll('.prose, strong').length, 0);
});

test('an unsafe reply leaves nothing that runs: no planted data-* hook, and a click on its link acts on nothing', async (t) => {
  const { d, q, calls } = await open(t, 'Look <img src=x onerror="alert(1)"> <iframe src="https://e.com"></iframe> <script>alert(1)</script> [x](javascript:alert(1)) <a href="https://x" data-live=\'delete|{}\'>go</a> <span data-ref-url="https://evil">s</span>');
  await rendered(q);
  const root = d.querySelector('#route-chat');
  assert.equal(root.querySelectorAll('.convo-words :is(img, iframe, script)').length, 0);
  assert.ok(![...root.querySelectorAll('[href]')].some((a) => /^\s*javascript:/i.test(a.getAttribute('href'))));
  const prose = q(LOADED);
  assert.ok(prose, 'rendered');
  assert.ok(![...prose.querySelectorAll('*')].some((n) => [...n.attributes].some((a) => a.name.startsWith('data-'))), 'no data-* attribute from the reply');
  noFollow(d);
  const before = posts(calls).length;
  prose.querySelector('a[href="https://x"]').click(); await settle(20);
  assert.deepEqual(posts(calls).slice(before), [], 'the link calls no act()');
});

test('a confirmed run ref inside a list item is a RefChip in that li; an unconfirmed id stays words', async (t) => {
  const { q } = await open(t, '- the same as 0a1b2c3d\n- not 9f9f9f9f', { refs: { 'run:0a1b2c3d': { ok: true, kind: 'run', id: 'pa', runId: 'run-a', title: 'Ask me' }, 'run:9f9f9f9f': { ok: false } } });
  await chipLands(q, '.convo-words .prose li [data-ref-run]');
  const [a, b] = q('.convo-words .prose').querySelectorAll('li');
  assert.equal(a.querySelector('[data-ref-run]')?.textContent, 'Ask me');
  assert.equal(b.querySelectorAll('[data-ref-run]').length, 0);
  assert.equal(b.textContent, 'not 9f9f9f9f');
});

test('a tap on the rendered turn shows its time, a tap on its link does not; focus on the turn survives the redraw after the load', async (t) => {
  let release; const gate = new Promise((r) => { release = r; });
  const { w, d, q } = await open(t, 'See [the docs](https://example.com/docs) **now**', { load: () => gate.then(() => MODS) });
  assert.ok(q('.convo-words .prose.is-plain'), 'plain until the renderer is loaded');
  q('.convo-words').focus();
  release();
  assert.ok(await until(() => q(`${LOADED} strong`), 15000).catch(() => null), 'redrawn once loaded');
  assert.equal(d.activeElement?.dataset.wordsTurn, 'r1:0', 'focus kept on the turn');
  noFollow(d);
  q('.convo-words a').click(); await settle(5);
  assert.equal(q('.convo-words').classList.contains('is-time-shown'), false);
  q('.convo-words strong').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await until(() => q('.convo-words.is-time-shown'), 15000).catch(() => null);
  assert.equal(q('.convo-words').classList.contains('is-time-shown'), true);
});

test('a loader that fails leaves today\'s plain words', async (t) => {
  const { q } = await open(t, 'It is **done**\nnext', { load: () => Promise.reject(new Error('no')) });
  const p = q('.convo-words .prose.is-plain');
  assert.ok(p);
  assert.match(p.innerHTML, /^It is \*\*done\*\*<br>next$/);
});

test('a pipe table is the Rail Table', async (t) => {
  const { q } = await open(t, '| a | b |\n|---|---|\n| 1 | 2 |');
  await rendered(q);
  assert.ok(q('.convo-words .prose div.rt-wrap > table.rt td.rt-c'));
});

test('a ## heading is an h2 inside .prose, with no class of its own (calm by rail.css)', async (t) => {
  const { q } = await open(t, '## Heading\n\nBody');
  await rendered(q);
  const h = q('.convo-words .prose h2');
  assert.ok(h);
  assert.equal(h.getAttribute('class'), null);
});

test('a confirmed chat ref in a paragraph is a RefChip', async (t) => {
  const { q } = await open(t, 'We talked in ask_0123abcd about it.', { refs: { 'chat:ask_0123abcd': { ok: true, kind: 'chat', title: 'Billing questions' } } });
  assert.equal((await chipLands(q, '.convo-words .prose p [data-ref-chat]')).getAttribute('data-ref-chat'), 'ask_0123abcd');
});

test('a PR written as a markdown link that dev confirms is a RefChip in place of the link', async (t) => {
  const PR = 'https://github.com/acme/web/pull/9';
  const { q, qa } = await open(t, `Here is [the PR](${PR}).`, { refs: { 'gh:acme/web#9': { ok: true, kind: 'pr', title: 'Fix totals' } } });
  await chipLands(q, '.convo-words .prose [data-ref-url]');
  const chips = qa('.convo-words .prose [data-ref-url]');
  assert.equal(chips.length, 1, 'one chip, not a chip chipped again inside itself');
  const [chip] = chips;
  assert.equal(chip.getAttribute('data-ref-url'), PR);
  assert.equal(chip.textContent.trim(), 'acme/web#9 · Fix totals');
  assert.equal(q('.convo-words .prose a'), null, 'no link left beside it');
});

test('demo: the seeded markdown reply renders a list, a code block and a Rail table; other demo words keep their inline HTML', async (t) => {
  const w = stillhetHost({ adapter: 'demo', hash: '#chat/c11', after: (fn) => t.after(fn), beforeScripts: hook() });
  const d = w.document, p = await until(() => d.querySelector(`#route-chat ${LOADED}`), 15000).catch(() => null);
  assert.ok(p, 'the seeded reply is rendered');
  assert.ok(p.querySelector('ul > li') && p.querySelector('pre') && p.querySelector('table.rt'));
  const plain = [...d.querySelectorAll('#route-chat div.convo-words')].find((x) => !x.querySelector('.prose'));
  assert.ok(plain.querySelector('code'), 'an unseeded words turn keeps its inline HTML');
});

// test/ask-ref-chips.test.mjs — ui/public/ask-ref-chips.mjs, the Chat answer chips: how a rendered answer turns into
// chips (which refs: src/shared/chip-refs.mjs, test/chip-refs.test.mjs) and how the chips fill in, over the REAL
// marked + DOMPurify output the chat renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createMarkdownRenderer } from '../ui/public/ask-markdown.mjs';
import { createRefChips, workItemTone } from '../ui/public/ask-ref-chips.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const PR = 'https://github.com/SinishaDjukic/worca-cc/pull/777';
const UUID = '0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0';
const realLoad = async () => ({ marked: (await import('marked')).marked, createDOMPurify: (await import('dompurify')).default });

async function world({ results = {}, store = null, fail = false, visible, hold = false } = {}) {
  const { window } = new JSDOM('<!doctype html><body><div class="ask-transcript"></div></body>', { url: 'http://localhost:4317/' });
  const doc = window.document;
  const md = createMarkdownRenderer({ doc, load: realLoad, hljsLoader: { forLanguage: async () => null } });
  assert.equal(await md.ensure(), true);
  const calls = [];
  const gates = [];                        // hold: each lookup waits here until the test releases it
  const fetch = async (url, init = {}) => {
    const call = { url, body: init.body ? JSON.parse(init.body) : null };
    calls.push(call);
    if (fail) throw new Error('offline');
    if (hold) await new Promise((r) => gates.push(r));
    const asked = call.body.refs;
    return { ok: true, status: 200, json: async () => ({ refs: Object.fromEntries(asked.filter((k) => k in results).map((k) => [k, results[k]])) }) };
  };
  let t = 1_000_000;
  const scans = { n: 0 };                  // every pass over the transcript starts with root()
  const chips = createRefChips({ doc, fetch, runStore: store, now: () => t, root: () => { scans.n++; return doc.querySelector('.ask-transcript'); }, rehydrateMs: 0, visible });
  const host = doc.querySelector('.ask-transcript');
  const answer = (text, { live = false } = {}) => {
    const div = doc.createElement('div');
    div.className = 'ask-answer ask-md';
    host.appendChild(div);
    div.replaceChildren(md.render(text).frag);
    chips.decorate(div, { live });
    return div;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));
  return { doc, calls, gates, chips, answer, settle, scans, advance: (ms) => { t += ms; } };
}

test('ask-ref-chips: a rendered answer turns its refs into chips, never inside code', async () => {
  const w = await world();
  const div = w.answer([`I opened ${PR}, see SinishaDjukic/worca-cc#12 and [the run](#history/worca-cc-ace1a602/1a2b3c4d), [#13](https://github.com/o/r/pull/13).`,
    '', '`owner/repo#5` and', '', '```', 'acme/api#6 5c40dcc6', '```'].join('\n'));
  const chips = [...div.querySelectorAll('a.ask-ref-chip')];
  assert.deepEqual(chips.map((a) => a.querySelector('.ask-ref-label').textContent), ['SinishaDjukic/worca-cc#777', 'SinishaDjukic/worca-cc#12', '#1a2b3c4d', 'o/r#13']);
  assert.equal(chips[3].querySelector('.ask-ref-title').hidden, true, 'link words that only repeat the ref are no title');
  assert.equal(chips[0].getAttribute('href'), PR);
  assert.equal(chips[0].getAttribute('target'), '_blank');
  assert.equal(chips[0].getAttribute('rel'), 'noopener noreferrer');
  assert.equal(chips[2].getAttribute('href'), '#history/worca-cc-ace1a602/1a2b3c4d');
  assert.equal(chips[2].getAttribute('target'), null, 'a worca route stays in the app');
  assert.equal(chips[2].querySelector('.ask-ref-title').textContent, 'the run', "the link's own words hold the title slot");
  assert.equal(div.querySelector('p code').textContent, 'owner/repo#5');
  assert.equal(div.querySelector('pre code').textContent, 'acme/api#6 5c40dcc6\n');
  assert.equal(div.querySelectorAll('pre .ask-ref-chip, code .ask-ref-chip, pre .ask-ref-cand').length, 0);
});

test('ask-ref-chips: a link the model wrote inside raw <code> stays code, never a chip', async () => {
  const w = await world();
  const div = w.answer('see <code><a href="https://github.com/o/r/pull/1">x</a></code> here');
  assert.equal(div.querySelector('code a')?.getAttribute('href'), 'https://github.com/o/r/pull/1', 'DOMPurify keeps the raw link');
  assert.equal(div.querySelectorAll('.ask-ref-chip').length, 0);
});

test('ask-ref-chips: an autolink whose href marked percent-encoded is no title; an encoded Azure repo label reads decoded', async () => {
  const w = await world({ fail: true });
  const div = w.answer('<https://dev.azure.com/acme/Café/_git/api/pullrequest/8> and <https://dev.azure.com/acme/Shop/_git/My%20Repo/pullrequest/7> and [https://www.github.com/o/r/pull/9/files](https://github.com/o/r/pull/9)');
  await w.settle(); await w.settle();
  const [cafe, repo, other] = div.querySelectorAll('a.ask-ref-chip');
  assert.equal(other.querySelector('.ask-ref-title').hidden, true, 'words that are another spelling of a ref URL say nothing more');
  assert.equal(cafe.getAttribute('href'), 'https://dev.azure.com/acme/Caf%C3%A9/_git/api/pullrequest/8', 'marked encodes the href, not the text');
  assert.equal(cafe.querySelector('.ask-ref-title').hidden, true, 'the raw URL text says nothing more, even after a failed lookup');
  assert.equal(cafe.querySelector('.ask-ref-title').textContent, '');
  assert.equal(repo.querySelector('.ask-ref-label').textContent, 'My Repo!7');
  assert.equal(repo.querySelector('.ask-ref-title').hidden, true);
});

test('ask-ref-chips: a prototype-named state paints no pill and never throws', async () => {
  const w = await world({ results: { 'gh:o/r#7': { ok: true, kind: 'pr', title: 'Odd', state: 'constructor' }, 'gh:o/r#8': { ok: true, kind: 'pr', title: 'Odder', state: 'toString' } } });
  const div = w.answer('o/r#7 and o/r#8');
  await w.settle(); await w.settle();
  const chips = [...div.querySelectorAll('a.ask-ref-chip')];
  assert.deepEqual(chips.map((a) => a.querySelector('.ask-ref-title').textContent), ['Odd', 'Odder']);
  assert.deepEqual(chips.map((a) => a.querySelector('.ask-ref-pill').hidden), [true, true]);
});

test('ask-ref-chips: one batched lookup after the answer is done; titles, pills and confirmed run ids fill in', async () => {
  const w = await world({ results: {
    'gh:SinishaDjukic/worca-cc#777': { ok: true, kind: 'pr', title: 'fix(promo-kit): startApp.stop() waits for the process group to die', state: 'merged' },
    'adowi:acme#123': { ok: true, kind: 'workitem', title: 'Login loops', state: 'Active', type: 'Bug' },
    'run:5c40dcc6': { ok: true, kind: 'run', id: '5c40dcc6', runId: null, title: 'Chips plan', status: 'done', home: 'worca-cc-ace1a602' },
    'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'Release notes' },
  } });
  const text = `${PR} and https://dev.azure.com/acme/Shop/_workitems/edit/123, run 5c40dcc6, sha deadbeef, chat ask_1a2b3c4d`;
  const streaming = w.answer(text, { live: true });
  await w.settle();
  assert.equal(w.calls.length, 0, 'nothing is asked while the answer streams');
  assert.equal(streaming.querySelectorAll('.ask-ref-cand').length, 3, 'bare ids wait as plain text');
  streaming.remove();
  const div = w.answer(text);
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 2, 'worca refs and forge refs go in two requests');
  assert.deepEqual(w.calls.map((c) => c.body.refs.sort()), [
    ['chat:ask_1a2b3c4d', 'run:5c40dcc6', 'run:deadbeef'],
    ['adowi:acme#123', 'gh:SinishaDjukic/worca-cc#777'],
  ]);
  const [pr, wi, run, chat] = [...div.querySelectorAll('a.ask-ref-chip')];
  assert.equal(pr.querySelector('.ask-ref-title').textContent, 'fix(promo-kit): startApp.stop() waits for the process group to die');
  assert.equal(pr.querySelector('.ask-ref-pill').textContent, 'Merged');
  assert.ok(pr.querySelector('.ask-ref-pill').classList.contains('tone-slate'));
  assert.match(pr.title, /^GitHub pull request SinishaDjukic\/worca-cc#777 · fix\(promo-kit\)/);
  assert.deepEqual([wi.querySelector('.ask-ref-label').textContent, wi.querySelector('.ask-ref-pill').textContent], ['AB#123', 'Active']);
  assert.equal(run.getAttribute('href'), '#history/worca-cc-ace1a602/5c40dcc6', 'a confirmed bare id links to its run page');
  assert.equal(run.querySelector('.ask-ref-pill').textContent, 'Done');
  assert.equal(chat.getAttribute('href'), '#chat/ask_1a2b3c4d');
  assert.equal(chat.querySelector('.ask-ref-title').textContent, 'Release notes');
  assert.match(div.textContent, /sha deadbeef,/, 'an id the server does not know stays plain text');
  assert.equal(div.querySelectorAll('.ask-ref-cand').length, 0);
  const again = w.answer(text);
  await w.settle();
  assert.equal(w.calls.length, 2, 'a re-render inside the TTL asks nothing');
  assert.equal(again.querySelectorAll('.ask-ref-cand').length, 0, 'a known miss renders as plain text, not as a pending id');
  assert.equal(again.querySelectorAll('a.ask-ref-chip').length, 4);
  w.advance(60_001);
  w.answer(text);
  await w.settle();
  assert.equal(w.calls.length, 4, 'after the TTL the next render asks again');
});

test('ask-ref-chips: an answer of the wrong kind for its ref paints nothing', async () => {
  const w = await world({ results: { 'gh:o/r#7': { ok: true, kind: 'chat', title: 'Not a PR' }, 'run:5c40dcc6': { ok: true, kind: 'pr', title: 'x', state: 'open' } } });
  const div = w.answer('o/r#7 and run 5c40dcc6');
  await w.settle(); await w.settle();
  assert.equal(div.querySelector('.ask-ref-title').hidden, true);
  assert.equal(div.querySelectorAll('a.ask-ref-chip').length, 1, 'a run id the answer does not confirm stays text');
});

test('ask-ref-chips: a confirmed bare run id opens where the run is — Running while this server runs it, else History', async () => {
  const w = await world({ results: {
    'run:5c40dcc6': { ok: true, kind: 'run', id: '5c40dcc6', runId: UUID, title: 'Going', status: 'running', home: 'k-1234abcd' },
    'run:6d50edd7': { ok: true, kind: 'run', id: '6d50edd7', runId: UUID, title: 'Over', status: 'done', home: 'k-1234abcd' },
  } });
  const div = w.answer('runs 5c40dcc6 and 6d50edd7');
  await w.settle(); await w.settle();
  assert.deepEqual([...div.querySelectorAll('a.ask-ref-chip')].map((a) => a.getAttribute('href')),
    [`#running/${UUID}`, '#history/k-1234abcd/6d50edd7']);
  const w2 = await world({ results: { [`run:${UUID}`]: { ok: true, kind: 'run', id: '5c40dcc6', runId: UUID, title: 'Going', status: 'running', home: 'k-1234abcd' } } });
  const linked = w2.answer(`[it](#running/${UUID})`);
  assert.equal(linked.querySelector('.ask-ref-label').textContent, '#0b1c2d3e', 'an app run id shows its first 8 characters until the lookup answers');
  await w2.settle(); await w2.settle();
  assert.equal(linked.querySelector('.ask-ref-label').textContent, '#5c40dcc6', 'then the run\'s History id');
});

test('ask-ref-chips: a confirmed run with no page to open stays text, never a link that goes nowhere', async () => {
  const w = await world({ results: { 'run:7e60fee8': { ok: true, kind: 'run', id: '7e60fee8', runId: null, title: 'Orphan', status: 'done', home: null } } });
  const div = w.answer('run 7e60fee8 here');
  await w.settle(); await w.settle();
  assert.equal(div.querySelectorAll('.ask-ref-chip, .ask-ref-cand').length, 0);
  assert.equal(div.textContent.trim(), 'run 7e60fee8 here');
  const again = w.answer('run 7e60fee8 again');
  assert.equal(again.querySelectorAll('.ask-ref-chip, .ask-ref-cand').length, 0, 'a later render inside the TTL: text at once');
});

test('ask-ref-chips: a failed lookup leaves tidy plain chips and never throws', async () => {
  const w = await world({ fail: true });
  const div = w.answer(`${PR} and [the fix](https://github.com/o/r/pull/9) and run 5c40dcc6`);
  await w.settle(); await w.settle();
  const [a, b] = div.querySelectorAll('a.ask-ref-chip');
  assert.equal(a.querySelector('.ask-ref-title').hidden, true);
  assert.equal(a.querySelector('.ask-ref-pill').hidden, true);
  assert.equal(b.querySelector('.ask-ref-title').textContent, 'the fix', 'the link words survive a failed lookup');
  assert.equal(div.textContent.trim(), 'SinishaDjukic/worca-cc#777  and o/r#9 · the fix  and run 5c40dcc6', 'copy and Pinpoint read real words');
});

test('ask-ref-chips: run chips follow the run store; an unfinished REST run is re-read on tick', async () => {
  const listeners = new Set();
  let live = null;
  const store = { byPipeline: (pid) => (pid === '5c40dcc6' ? live : null), get: () => null, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const w = await world({ store, results: { 'run:5c40dcc6': { ok: true, kind: 'run', id: '5c40dcc6', runId: null, title: 'Chips plan', status: 'running', home: 'k-1234abcd' } } });
  const div = w.answer('[plan](#history/k-1234abcd/5c40dcc6)');
  await w.settle(); await w.settle();
  const pill = () => div.querySelector('.ask-ref-pill');
  assert.equal(pill().textContent, 'Running');
  const host = w.doc.querySelector('.ask-transcript');
  host.classList.add('hidden');            // app.js showView hides a page with the class
  w.chips.tick();
  host.classList.remove('hidden');
  host.hidden = true;
  w.chips.tick();
  await w.settle();
  assert.equal(w.calls.length, 1, 'a chip that is not on screen is not re-read');
  host.hidden = false;
  w.chips.tick();
  await w.settle();
  assert.equal(w.calls.length, 2, 'a run going on elsewhere is re-read');
  live = { source: 'live', status: 'paused', pauseReason: 'cost_pipeline', title: 'Chips plan', active: [], terminal: false };
  for (const fn of listeners) fn('run-uuid', 'state');
  await w.settle();
  assert.equal(pill().textContent, 'Paused · cost limit');
  assert.ok(pill().classList.contains('tone-amber'));
  const node = pill().firstChild;
  for (const fn of listeners) fn('run-uuid', 'state');
  await w.settle();
  assert.equal(pill().firstChild, node, 'an event that changes nothing rewrites nothing (a selection inside a chip survives)');
  w.chips.tick();
  await w.settle();
  assert.equal(w.calls.length, 2, 'a run the store holds is never re-read');
  w.chips.destroy();
  assert.equal(listeners.size, 0);
});

test('ask-ref-chips: run store events scan nothing while the Chat page is hidden; the next show repaints once', async () => {
  const listeners = new Set();
  let live = null;
  let open = true;
  const store = { byPipeline: (pid) => (pid === '5c40dcc6' ? live : null), get: () => null, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const w = await world({ store, visible: () => open, results: { 'run:5c40dcc6': { ok: true, kind: 'run', id: '5c40dcc6', runId: null, title: 'Chips plan', status: 'running', home: 'k-1234abcd' } } });
  const div = w.answer('[plan](#history/k-1234abcd/5c40dcc6)');
  await w.settle(); await w.settle();
  const pill = () => div.querySelector('.ask-ref-pill');
  assert.equal(pill().textContent, 'Running');
  open = false;
  const before = w.scans.n;
  live = { source: 'live', status: 'done', title: 'Chips plan', active: [], terminal: true };
  for (let i = 0; i < 3; i++) for (const fn of listeners) fn('run-uuid', 'state');
  await w.settle();
  assert.equal(w.scans.n, before, 'no transcript scan while hidden');
  assert.equal(pill().textContent, 'Running');
  w.chips.show();
  open = true;
  w.chips.show();
  await w.settle();
  assert.equal(w.scans.n, before + 1, 'one scan when the page shows again');
  assert.equal(pill().textContent, 'Done');
  w.chips.show();
  await w.settle();
  assert.equal(w.scans.n, before + 1, 'a show with no missed event scans nothing');
});

test('ask-ref-chips: a run store event while a bare id is being asked about never turns it into text', async () => {
  const listeners = new Set();
  const store = { byPipeline: () => null, get: () => null, subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); } };
  const results = {};
  const w = await world({ store, results });
  w.answer('run 5c40dcc6');
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 1, 'the first answer: not a run (yet)');
  results['run:5c40dcc6'] = { ok: true, kind: 'run', id: '5c40dcc6', runId: null, title: 'Now real', status: 'running', home: 'k-1234abcd' };
  w.advance(60_001);
  const div = w.answer('run 5c40dcc6 again');
  assert.equal(div.querySelectorAll('.ask-ref-cand').length, 1, 'an expired miss waits as a candidate and is asked again');
  await Promise.resolve();                 // send() goes out
  for (const fn of listeners) fn('other-run', 'state');   // a frame of some other run lands before the answer
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 2);
  assert.equal(div.querySelector('a.ask-ref-chip-run')?.getAttribute('href'), '#history/k-1234abcd/5c40dcc6', 'the answer still finds the candidate and promotes it');
});

test('ask-ref-chips: a run link the server does not know is never polled; its tooltip names the run', async () => {
  const w = await world({ results: {} });
  const div = w.answer('[gone](#history/k-1234abcd/5c40dcc6)');
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 1);
  const chip = div.querySelector('a.ask-ref-chip-run');
  assert.equal(chip.querySelector('.ask-ref-title').textContent, 'gone', 'the link words stay');
  assert.equal(chip.title, 'Run #5c40dcc6 · gone');
  w.chips.tick();
  await w.settle();
  assert.equal(w.calls.length, 1, 'a miss is asked again on a later render, never on the 30 s tick');
});

// A chat-message record's head (ask-panel.mjs buildChatRecord): plain id text, decorated with the id label.
const record = (w, text) => {
  const div = w.doc.createElement('div');
  div.className = 'ask-chat-msg-head';
  div.textContent = text;
  w.doc.querySelector('.ask-transcript').appendChild(div);
  w.chips.decorate(div, { chatIdLabel: true });
  return div;
};
const chatTitles = (el) => [...el.querySelectorAll('a.ask-ref-chip-chat .ask-ref-title')].map((n) => n.textContent);

test('ask-ref-chips: chatIdLabel: an untitled chat shows its id; a titled one its title; without the option an untitled chat still reads New chat', async () => {
  const w = await world({ results: { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: '' }, 'chat:ask_2b3c4d5e': { ok: true, kind: 'chat', title: 'Release notes' } } });
  const rec = record(w, 'ask_1a2b3c4d and ask_2b3c4d5e');
  assert.equal(rec.querySelectorAll('.ask-ref-cand').length, 2, 'ids wait as text until confirmed');
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['ask_1a2b3c4d', 'Release notes']);
  assert.doesNotMatch(rec.textContent, /New chat/);
  assert.equal(rec.querySelector('a.ask-ref-chip-chat').getAttribute('href'), '#chat/ask_1a2b3c4d');
  const ans = w.answer('chat ask_1a2b3c4d');
  assert.deepEqual(chatTitles(ans), ['New chat'], 'an answer chip keeps its label');
});

test('ask-ref-chips: chatIdLabel: a confirmed chip whose re-lookup misses shows its id, not Chat', async () => {
  const results = { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'Release notes' } };
  const w = await world({ results });
  const rec = record(w, 'ask_1a2b3c4d');
  const ans = w.answer('chat ask_1a2b3c4d');
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['Release notes']);
  assert.deepEqual(chatTitles(ans), ['Release notes']);
  delete results['chat:ask_1a2b3c4d'];
  w.chips.refresh(['chat:ask_1a2b3c4d']);
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['ask_1a2b3c4d']);
  assert.deepEqual(chatTitles(ans), ['Chat'], 'an answer chip keeps its old fallback');
});

test('ask-ref-chips: refresh re-asks only the keys with a chip on screen, in one POST, and repaints the new title', async () => {
  const results = { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'One' }, 'chat:ask_2b3c4d5e': { ok: true, kind: 'chat', title: 'Two' },
    'chat:ask_3c4d5e6f': { ok: true, kind: 'chat', title: 'Three' } };
  const w = await world({ results });
  const rec = record(w, 'ask_1a2b3c4d ask_2b3c4d5e');
  w.answer('chat ask_3c4d5e6f').remove();          // cached, then off screen
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['One', 'Two']);
  const before = w.calls.length;
  results['chat:ask_1a2b3c4d'] = { ok: true, kind: 'chat', title: 'Uno' };
  results['chat:ask_2b3c4d5e'] = { ok: true, kind: 'chat', title: 'Dos' };
  w.chips.refresh(['chat:ask_1a2b3c4d', 'chat:ask_2b3c4d5e', 'chat:ask_3c4d5e6f']);
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, before + 1, 'one POST');
  assert.deepEqual(w.calls.at(-1).body.refs.sort(), ['chat:ask_1a2b3c4d', 'chat:ask_2b3c4d5e']);
  assert.deepEqual(chatTitles(rec), ['Uno', 'Dos']);
  w.answer('chat ask_3c4d5e6f');
  await w.settle(); await w.settle();
  assert.deepEqual(w.calls.at(-1).body.refs, ['chat:ask_3c4d5e6f'], 'an off-screen key is only marked stale: the next render asks again');
});

test('ask-ref-chips: refresh during an in-flight lookup asks again after it and paints the newer answer', async () => {
  const results = { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'Old' } };
  const w = await world({ results, hold: true });
  const rec = record(w, 'ask_1a2b3c4d');
  await w.settle();
  assert.equal(w.calls.length, 1);
  w.chips.refresh(['chat:ask_1a2b3c4d']);
  await w.settle();
  assert.equal(w.calls.length, 1, 'nothing more while the first lookup is out');
  w.gates[0]();
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 2, 'asked again once the stale answer landed');
  assert.ok(![...rec.querySelectorAll('.ask-ref-title')].some((n) => n.textContent === 'Old'), 'the stale answer is never painted');
  const again = record(w, 'ask_1a2b3c4d');
  assert.equal(again.querySelectorAll('a.ask-ref-chip').length, 0, 'nor cached');
  results['chat:ask_1a2b3c4d'] = { ok: true, kind: 'chat', title: 'New' };
  w.gates[1]();
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['New']);
  assert.deepEqual(chatTitles(again), ['New']);
  assert.equal(w.calls.length, 2);
});

test('ask-ref-chips: refresh keeps the painted title until the new answer lands', async () => {
  const results = { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'Release notes' } };
  const w = await world({ results, hold: true });
  const rec = record(w, 'ask_1a2b3c4d');
  await w.settle();
  w.gates[0]();
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['Release notes']);
  results['chat:ask_1a2b3c4d'] = { ok: true, kind: 'chat', title: 'Renamed' };
  w.chips.refresh(['chat:ask_1a2b3c4d']);
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, 2);
  assert.deepEqual(chatTitles(rec), ['Release notes'], 'not Chat, not the id');
  const rebuilt = record(w, 'ask_1a2b3c4d');        // a row rebuilt while the lookup is out
  assert.deepEqual(chatTitles(rebuilt), ['Release notes']);
  await w.settle();
  assert.equal(w.calls.length, 2, 'the rebuild asks nothing more');
  w.gates[1]();
  await w.settle(); await w.settle();
  assert.deepEqual(chatTitles(rec), ['Renamed']);
  assert.deepEqual(chatTitles(rebuilt), ['Renamed']);
});

test('ask-ref-chips: refresh(null) re-asks every chat key on screen, never a run or PR key', async () => {
  const results = { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'One' }, 'chat:ask_2b3c4d5e': { ok: true, kind: 'chat', title: 'Two' },
    'chat:ask_3c4d5e6f': { ok: true, kind: 'chat', title: 'Three' },
    'run:5c40dcc6': { ok: true, kind: 'run', id: '5c40dcc6', runId: null, title: 'Plan', status: 'done', home: 'k-1234abcd' },
    'gh:o/r#7': { ok: true, kind: 'pr', title: 'Fix', state: 'open' } };
  const w = await world({ results });
  record(w, 'ask_1a2b3c4d');
  w.answer('[plan](#history/k-1234abcd/5c40dcc6), o/r#7 and chat ask_2b3c4d5e');
  w.answer('chat ask_3c4d5e6f').remove();
  await w.settle(); await w.settle();
  const before = w.calls.length;
  w.chips.refresh(null);
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, before + 1);
  assert.deepEqual(w.calls.at(-1).body.refs.sort(), ['chat:ask_1a2b3c4d', 'chat:ask_2b3c4d5e']);
});

test('ask-ref-chips: refresh after destroy does nothing and never fetches', async () => {
  const w = await world({ results: { 'chat:ask_1a2b3c4d': { ok: true, kind: 'chat', title: 'One' } } });
  record(w, 'ask_1a2b3c4d');
  await w.settle(); await w.settle();
  const before = w.calls.length;
  w.chips.destroy();
  assert.equal(w.chips.refresh(['chat:ask_1a2b3c4d']), undefined);
  assert.equal(w.chips.refresh(null), undefined);
  await w.settle(); await w.settle();
  assert.equal(w.calls.length, before);
});

test('workItemTone: process states map to tones; unknown states stay neutral', () => {
  assert.deepEqual(['New', 'Active', 'In Progress', 'Resolved', 'Closed', 'Done', 'Removed', 'Triage'].map(workItemTone),
    ['slate', 'blue', 'blue', 'amber', 'green', 'green', 'red', 'slate']);
});

test('style.css: a ref chip uses the token corner, a neutral fill and a coloured word, never a filled pill', () => {
  const css = readStyleCss();
  const rules = [...css.matchAll(/([^{}]*\.ask-ref-(?:chip|pill)[^{}]*)\{([^}]*)\}/g)].map((m) => [m[1].trim(), m[2]]);
  assert.ok(rules.length >= 8, `${rules.length} ref chip rules`);
  for (const [sel, body] of rules) {
    assert.doesNotMatch(body, /border-radius:\s*(?!var\(--r-xs\))/, `${sel}: radius only var(--r-xs)`);
    assert.doesNotMatch(body, /999px|box-shadow/, `${sel}: no pill, no shadow`);
    if (sel.includes('.ask-ref-pill')) assert.doesNotMatch(body, /background/, `${sel}: the word carries the colour, nothing fills behind it`);
  }
  assert.match(css, /\.ask-ref-pill\.tone-slate\{color:var\(--slate-ink\);\}/);
  assert.doesNotMatch(css, /\.ask-ref-pill\.tone-violet/);
});

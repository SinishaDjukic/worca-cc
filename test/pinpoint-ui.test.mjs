// Pinpoint (#669) in jsdom: the toolbar on a selection, its shortcuts, Explain's streamed popover, Disagree, the
// artifact tray (pending changes → one run direction), the diff's selection extract, and the chat's quote chip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPinpoint } from '../ui/public/pinpoint.mjs';
import { decorateArtifact, diffExtract } from '../ui/public/pinpoint-surfaces.mjs';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const RECT = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 };
const LINE = { left: 100, right: 220, width: 120, top: 300, bottom: 320, height: 20 };

function rig(html) {
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, { url: 'http://localhost:4317/', pretendToBeVisual: true });
  const { window } = dom;
  // jsdom lays nothing out: every box is the viewport, every range one line in its middle.
  window.Element.prototype.getBoundingClientRect = () => RECT;
  window.Range.prototype.getClientRects = () => [LINE];
  window.Range.prototype.getBoundingClientRect = () => LINE;
  window.navigator.clipboard = { writeText: async () => {} };
  return { window, doc: window.document };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function select(win, node, start, end, endNode = node) {
  const r = win.document.createRange();
  r.setStart(node, start);
  r.setEnd(endNode, end);
  const s = win.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  win.document.dispatchEvent(new win.Event('pointerup', { bubbles: true }));
}
const key = (win, k, o = {}) => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
/** A fetch answering /api/pinpoint with NDJSON lines. */
function ndjsonFetch(lines, calls = []) {
  return async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
  };
}

function chatRig(fetchFn) {
  const { window, doc } = rig('<div id="chat"><div class="ans">The middleware fails open when Redis is down.</div></div><p id="out">outside text here</p>');
  const pp = createPinpoint({ doc, win: window, fetch: fetchFn || (async () => new Response('', { status: 500 })) });
  const sent = [];
  const drafted = [];
  pp.addSurface(doc.getElementById('chat'), {
    kind: 'chat',
    unit: (el) => el.closest('.ans'),
    draft: (q, text) => drafted.push({ q, text }),
    send: (q, text) => sent.push({ q, text }),
  });
  return { window, doc, pp, sent, drafted, text: doc.querySelector('.ans').firstChild };
}

test('a selection in a surface shows the toolbar; one outside does not', async () => {
  const { window, doc, text, pp } = chatRig();
  select(window, doc.querySelector('#out').firstChild, 0, 7);
  await wait(150);
  assert.equal(doc.querySelector('.pp-bar'), null);
  select(window, text, 15, 25);   // "fails open"
  await wait(150);
  const bar = doc.querySelector('.pp-bar');
  assert.ok(bar);
  assert.deepEqual([...bar.querySelectorAll('.pp-b')].map((b) => b.dataset.k), ['copy', 'explain', 'alts', 'disagree', 'quote']);
  assert.equal(bar.style.top, `${LINE.top - bar.offsetHeight - 10}px`);
  key(window, 'Escape');
  assert.equal(doc.querySelector('.pp-bar'), null, 'Esc closes it');
  assert.equal(pp.holding(), false);
  pp.destroy();
});

test('Q quotes the span into the composer (draft, not sent)', async () => {
  const { window, doc, text, drafted, sent } = chatRig();
  select(window, text, 15, 25);
  await wait(150);
  key(window, 'q');
  assert.deepEqual(drafted, [{ q: { text: 'fails open' }, text: '' }]);
  assert.equal(sent.length, 0);
  assert.equal(doc.querySelector('.pp-bar'), null);
});

test('Explain streams an answer into a popover; "Go deeper in chat" sends with the quote', async () => {
  const calls = [];
  const { window, doc, text, sent } = chatRig(ndjsonFetch([{ type: 'delta', text: 'It lets `requests` ' }, { type: 'delta', text: 'through.' }, { type: 'done' }], calls));
  select(window, text, 15, 25);
  await wait(150);
  key(window, 'e');
  const pop = doc.querySelector('.pp-pop');
  assert.ok(pop);
  await wait(30);
  assert.equal(calls[0].url, '/api/pinpoint');
  assert.deepEqual({ ...calls[0].body, context: undefined }, { action: 'explain', quote: 'fails open', context: undefined, surface: 'chat', source: '' });
  assert.equal(pop.querySelector('.pp-eb').innerHTML, '<p>It lets <code>requests</code> through.</p>');
  pop.querySelector('[data-deeper]').click();
  assert.equal(doc.querySelector('.pp-pop'), null);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].q, { text: 'fails open' });
});

test('Explain shows the server\'s error', async () => {
  const { window, doc, text } = chatRig(ndjsonFetch([{ type: 'error', error: 'Claude is signed out' }]));
  select(window, text, 15, 25);
  await wait(150);
  key(window, 'e');
  await wait(30);
  assert.match(doc.querySelector('.pp-pop .pp-eb').textContent, /signed out/);
});

test('Disagree in the chat: a reason chip plus text sends at once', async () => {
  const { window, doc, text, sent } = chatRig();
  select(window, text, 15, 25);
  await wait(150);
  key(window, 'd');
  const pop = doc.querySelector('.pp-cmp');
  const send = pop.querySelector('[data-send]');
  assert.equal(send.disabled, true);
  pop.querySelector('[data-r="Too risky"]').click();
  assert.equal(send.disabled, false);
  const ta = pop.querySelector('textarea');
  ta.value = 'fail closed instead';
  ta.dispatchEvent(new window.Event('input'));
  ta.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
  await wait(0);
  assert.deepEqual(sent, [{ q: { text: 'fails open' }, text: 'I disagree (too risky): fail closed instead' }]);
});

test('the artifact tray collects Disagree / Note and sends them back as one direction', async () => {
  const { window, doc } = rig('<div class="apv"><div class="apv-body"><div class="apv-stage"><div class="artifact-markdown"><p>Retry a failed upload up to 5 times.</p><p>Show a red badge.</p></div></div></div></div>');
  const storage = new Map();
  const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
  const pp = createPinpoint({ doc, win: window, fetch: async () => new Response('') });
  const posted = [];
  let live = true;
  const undo = decorateArtifact({
    pinpoint: pp, doc, win: window, stage: doc.querySelector('.apv-stage'), body: doc.querySelector('.apv-body'), root: doc.querySelector('.apv'),
    file: 'plan.md', key: 'k', storage: store, live: () => live, plan: true,
    sendBack: async (t) => { posted.push(t); return null; }, draft: () => {},
  });
  const tray = doc.querySelector('.pp-tray');
  assert.match(tray.textContent, /No pending changes/);
  const p1 = doc.querySelector('.artifact-markdown p').firstChild;
  select(window, p1, 26, 35);   // "5 times"? -> "up to 5 t" region
  await wait(150);
  assert.deepEqual([...doc.querySelectorAll('.pp-bar .pp-b')].map((b) => b.dataset.k), ['copy', 'explain', 'alts', 'disagree', 'note', 'send']);
  assert.ok(doc.querySelector('.apv > .pp-bar'), 'mounted inside the viewer overlay (its focus trap)');
  key(window, 'n');
  const pop = doc.querySelector('.pp-cmp');
  assert.match(pop.querySelector('.pp-send').textContent, /Add note/);
  pop.querySelector('textarea').value = 'cap the delay instead';
  pop.querySelector('textarea').dispatchEvent(new window.Event('input'));
  pop.querySelector('[data-send]').click();
  assert.equal(doc.querySelectorAll('.pp-tray .pp-row').length, 1);
  assert.match(doc.querySelector('.pp-tray-h').textContent, /1 pending change/);
  assert.ok(storage.get('k'), 'kept for the next open');
  assert.match(doc.querySelector('.pp-tray [data-a="send"]').textContent, /Send back to planner/);
  doc.querySelector('.pp-tray [data-a="send"]').click();
  await wait(0);
  assert.equal(posted.length, 1);
  assert.match(posted[0], /^Feedback on plan\.md — please revise and address each point:\n1\. Note on “.+”: cap the delay instead$/);
  assert.equal(doc.querySelectorAll('.pp-tray .pp-row').length, 0);
  assert.match(doc.querySelector('.pp-tray-note').textContent, /1 change sent to the run/);
  assert.equal(storage.has('k'), false);
  // A finished run: the tray goes away when empty; Disagree sends to the chat instead of collecting.
  live = false;
  undo();
  assert.equal(doc.querySelector('.pp-tray'), null);
  assert.equal(doc.querySelector('.pp-marks'), null);
});

test('diffExtract quotes only source text, anchored on the first numbered row', () => {
  const { window, doc } = rig(`<div class="hd-diff-body">
    <div class="hd-dl hd-dl-row hd-dl-del" data-old="62" data-new="" data-path="src/a.ts" data-project=""><span class="hd-dl-n">62</span><span class="hd-dl-code"><span class="hd-dl-sign">-</span><span class="hd-dl-src">const a = 1;</span></span></div>
    <div class="hd-dl hd-dl-row hd-dl-add" data-old="" data-new="63" data-path="src/a.ts" data-project=""><span class="hd-dl-n">63</span><span class="hd-dl-code"><span class="hd-dl-sign">+</span><span class="hd-dl-src">const b = 2;</span></span></div>
  </div>`);
  const srcs = doc.querySelectorAll('.hd-dl-src');
  const r = doc.createRange();
  r.setStart(srcs[0].firstChild, 6);
  r.setEnd(srcs[1].firstChild, 7);
  const out = diffExtract(r, doc.querySelector('.hd-diff-body'));
  assert.deepEqual(out, { text: 'a = 1;\nconst b', code: true, line: 62, side: 'old', path: 'src/a.ts', project: '' });
  const r2 = doc.createRange();
  r2.setStart(srcs[1].firstChild, 0);
  r2.setEnd(srcs[1].firstChild, 5);
  assert.deepEqual({ ...diffExtract(r2, doc.querySelector('.hd-diff-body')) }, { text: 'const', code: true, line: 63, side: 'new', path: 'src/a.ts', project: '' });
  void window;
});

const TID = 'ask_00000001';
function apiHandler(bodies) {
  return (url, opts) => {
    const method = (opts.method || 'GET').toUpperCase();
    if (url === '/api/ask/threads' && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ thread: { id: TID, title: null, createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} } }) };
    }
    if (url === `/api/ask/threads/${TID}/messages` && method === 'POST') {
      bodies.push(JSON.parse(opts.body));
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000001', assistantMessageId: 'askm_00000001' }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

test('the chat composer: a quote chip rides above the text as a blockquote, and the bubble shows it as a quote card', async () => {
  const bodies = [];
  const ctx = makePanel({ fetchHandler: apiHandler(bodies) });
  const { panel, doc } = ctx;
  panel.open();
  assert.equal(panel.setQuote({ text: 'fails open', src: 'plan.md' }), true);
  const chip = doc.querySelector('.ask-chip-quote');
  assert.ok(chip);
  assert.match(chip.textContent, /From plan\.md/);
  chip.querySelector('.ask-chip-x').click();
  assert.equal(doc.querySelector('.ask-chip-quote'), null, 'removable');
  panel.setQuote({ text: 'fails open', src: 'plan.md' });
  doc.querySelector('.ask-input').value = 'Why?';
  doc.querySelector('[data-ask-send]').click();
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, '> From plan.md:\n> fails open\n\nWhy?');
  assert.equal(doc.querySelector('.ask-chip-quote'), null, 'the chip goes with the message');
  ctx.flush();
  const card = doc.querySelector('.ask-msg-user .ask-user-quote');
  assert.ok(card, 'quote card rendered');
  assert.equal(card.querySelector('.ask-user-quote-t').textContent, 'fails open');
  assert.equal(doc.querySelector('.ask-msg-user .ask-user-bubble').textContent, 'Why?');
});

test('sendQuoted sends at once into an empty composer, but never sends a draft along', async () => {
  const bodies = [];
  const ctx = makePanel({ fetchHandler: apiHandler(bodies) });
  ctx.panel.open();
  const ta = ctx.doc.querySelector('.ask-input');
  ta.value = 'my draft';
  assert.equal(ctx.panel.sendQuoted({ quote: { text: 'x y' }, text: 'I disagree: no' }), false);
  for (let i = 0; i < 3; i++) await ctx.tick();
  assert.equal(bodies.length, 0);
  assert.equal(ta.value, 'my draft\nI disagree: no');
  ta.value = '';
  assert.equal(ctx.panel.sendQuoted({ quote: { text: 'x y' }, text: 'I disagree: no' }), true);
  for (let i = 0; i < 4; i++) await ctx.tick();
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].text, '> x y\n\nI disagree: no');
});

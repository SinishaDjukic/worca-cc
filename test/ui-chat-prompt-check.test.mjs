// test/ui-chat-prompt-check.test.mjs — the prompt check chip in the Chat composer and the Shaper task
// (ui/public/chat/prompt-check.mjs through ui/public/prompt-check/chip-host.mjs) inside the real Ask panel. Fake
// timers; the grade fetch is held on a deferred promise per call. Each window is closed when its test ends.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { makePanel } from './helpers/ask-panel-harness.mjs';
import { registerComposerAddon, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { installIntentAddon } from '../ui/public/chat/intent.mjs';
import { installPromptCheckAddon, createPromptCheckAddon } from '../ui/public/chat/prompt-check.mjs';
import { JSDOM } from 'jsdom';
import { setPromptCheckPref } from '../ui/public/prompt-check/chip-host.mjs';
import { textHash, PROMPT_CHECK_DEBOUNCE_MS } from '../src/shared/prompt-check/filter.mjs';

const TID = 'ask_00000001';
const NEW_TID = 'ask_00000777';
const THREAD = { id: TID, title: 'T', createdAt: 't', updatedAt: 't', model: null, effort: null, sessionId: null, context: null, totals: {} };
const TASK = 'Add a CSV export button to the Insights page so that a team lead can share the weekly cost with finance.';
const OTHER = 'Build a Slack notifier that posts a message when a run fails, with the run title, the step and a link.';

beforeEach(() => _resetChatExtensions());

function fakeTimers() {
  let now = 0;
  let id = 0;
  const jobs = new Map();
  return {
    setTimeout: (fn, ms) => { jobs.set(++id, { at: now + ms, fn }); return id; },
    clearTimeout: (i) => { jobs.delete(i); },
    advance(ms) {
      now += ms;
      for (const [i, j] of [...jobs].sort((a, b) => a[1].at - b[1].at)) if (j.at <= now) { jobs.delete(i); j.fn(); }
    },
  };
}

function api(rec) {
  rec.grades = [];
  rec.corrections = [];
  rec.calls = [];
  return (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    rec.calls.push(`${method} ${url}`);
    if (url === '/api/prompt-check/grade') {
      return new Promise((resolve, reject) => {
        const call = { body: JSON.parse(opts.body), aborted: false };
        opts.signal?.addEventListener('abort', () => { call.aborted = true; reject(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
        call.reply = (assessment = {}) => resolve({ ok: true, status: 200, json: async () => ({
          requestId: call.body.requestId, textHash: textHash(call.body.text), source: 'model',
          assessment: { isTask: true, kind: 'implementation', grade: 'needs-detail', continuesRequirement: true, ...assessment },
        }) });
        rec.grades.push(call);
      });
    }
    if (url === '/api/prompt-check/kind-correction') {
      rec.corrections.push(JSON.parse(opts.body));
      return { ok: true, status: 201, json: async () => ({ ok: true, at: 't' }) };
    }
    if (url === '/api/ask/threads' && method === 'POST') {
      if (rec.refuseCreate) return { ok: false, status: 500, json: async () => ({ error: 'no' }) };
      return { ok: true, status: 201, json: async () => ({ thread: { ...THREAD, id: NEW_TID } }) };
    }
    if (/\/api\/ask\/threads\/[^/]+\/messages$/.test(url) && method === 'POST') {
      if (rec.refuseMessage) return { ok: false, status: 429, json: async () => ({ error: 'slow down' }) };
      return { ok: true, status: 202, json: async () => ({ userMessageId: 'askm_u0000009', attachments: [], contexts: [] }) };
    }
    if (url.startsWith(`/api/ask/threads/${TID}`) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ thread: THREAD, messages: [], attachments: [], runLinks: [], inFlight: null }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  };
}

async function open(t, { on = true, thread = true, extra = null } = {}) {
  const timers = fakeTimers();
  const intent = installIntentAddon({ win: { setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0, clearTimeout: () => {} } });
  installPromptCheckAddon({ intent, timers });
  if (extra) registerComposerAddon(extra);
  setPromptCheckPref(on);
  const rec = {};
  const ctx = makePanel({ fetchHandler: api(rec) });
  t.after(() => { ctx.panel.destroy(); setPromptCheckPref(false); ctx.window.close(); });
  if (thread) ctx.storage.setItem('worca-cc.ask.thread', TID);
  ctx.panel.open();
  await ctx.tick(); await ctx.tick(); await ctx.tick();
  ctx.flush();
  const input = ctx.doc.querySelector('textarea.ask-input');
  const type = (text) => { input.value = text; input.dispatchEvent(new ctx.window.Event('input', { bubbles: true })); };
  const settle = async () => { for (let i = 0; i < 4; i++) await ctx.tick(); ctx.flush(); };
  const graded = async (text = TASK, assessment = {}) => {
    type(text);
    timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
    rec.grades.at(-1).reply(assessment);
    await settle();
  };
  return { ctx, rec, timers, intent, input, type, settle, graded, doc: ctx.doc };
}
const chips = (s) => s.doc.querySelectorAll('[data-prompt-check]');
const lead = (s) => s.doc.querySelector('.chat-composer-lead');
const promptCheckCalls = (s) => s.rec.calls.filter((c) => c.includes('/api/prompt-check/'));
const pickKind = async (s, label) => {
  chips(s)[0].querySelector('button').click();
  [...s.doc.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === label).click();
  await s.settle();
};

test('on, a typed task: one chip in the lead row with the kind and the grade', async (t) => {
  const s = await open(t);
  await s.graded();
  assert.equal(chips(s).length, 1);
  assert.equal(chips(s)[0].parentNode, lead(s));
  assert.equal(chips(s)[0].querySelector('button').textContent, 'Implementation task');
  assert.equal(chips(s)[0].querySelector('.pcheck-grade').textContent, 'Needs detail');
  assert.deepEqual(s.rec.grades[0].body.surface, { kind: 'chat', id: TID });
});

test('off: 0 chips and 0 calls to either prompt-check route', async (t) => {
  const s = await open(t, { on: false });
  s.type(TASK);
  s.timers.advance(10_000);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(promptCheckCalls(s), []);
});

test('a short question shows 0 chips with 0 calls; a model reply with isTask false shows 0 chips', async (t) => {
  const s = await open(t);
  s.type('What does the review step do?');
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.equal(chips(s).length, 0);
  assert.deepEqual(promptCheckCalls(s), []);
  await s.graded(OTHER, { isTask: false, kind: 'conversation' });
  assert.equal(chips(s).length, 0);
});

test('the Shaper intent: surface shaper, forceTask, and a short prompt still shows its chip', async (t) => {
  const s = await open(t, { thread: false });
  s.intent.set('shape', { focus: false });
  await s.graded('Fix the login?');
  assert.deepEqual(s.rec.grades.at(-1).body.surface, { kind: 'shaper', id: 'new' });
  assert.equal(s.rec.grades.at(-1).body.forceTask, true);
  assert.equal(chips(s).length, 1);
});

test('in flight (the grade held): the chip is the same node and Send stays enabled', async (t) => {
  const s = await open(t);
  await s.graded();
  const before = chips(s)[0];
  s.type(OTHER);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.equal(s.rec.grades.length, 2);
  assert.equal(chips(s)[0], before);
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
});

test('a kind correction in an open chat regrades and POSTs the thread id, with no text', async (t) => {
  const s = await open(t);
  await s.graded();
  await pickKind(s, 'Bug report');
  assert.equal(s.rec.grades.at(-1).body.kind, 'bug');
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: TID, proposedKind: 'implementation', chosenKind: 'bug' }]);
});

test('a correction in a new chat is held, then POSTed once with the thread id its first send creates', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  assert.deepEqual(s.rec.corrections, []);
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.ok(s.rec.calls.includes(`POST /api/ask/threads/${NEW_TID}/messages`));
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
  assert.equal(chips(s).length, 0, 'sent: the chip hides');
});

test('after the held correction of a new chat is recorded, a later pick in that same chat is POSTed at once', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.equal(s.rec.corrections.length, 1);
  await s.graded(OTHER);
  await pickKind(s, 'Idea');
  assert.deepEqual(s.rec.corrections.at(-1), { surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'idea' });
  assert.equal(s.rec.corrections.length, 2);
});

test('a held correction carried onto the made thread (re-keyed before sent): once recorded, a later pick there is POSTed at once', async (t) => {
  const w = new JSDOM('<!doctype html><body><div id="lead"></div></body>');
  const timers = fakeTimers();
  const rec = {};
  const fetchImpl = api(rec);
  let tid = null;
  let made = null;
  setPromptCheckPref(true);
  const h = createPromptCheckAddon({ timers }).mount(w.window.document.getElementById('lead'), {
    threadId: () => tid, madeThread: () => made, fetch: fetchImpl, announce: () => {},
  });
  t.after(() => { h.destroy(); setPromptCheckPref(false); w.window.close(); });
  const flushAll = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  const grade = async (text) => { h.input(text); timers.advance(PROMPT_CHECK_DEBOUNCE_MS); rec.grades.at(-1).reply(); await flushAll(); };
  const pick = async (label) => {
    w.window.document.querySelector('[data-prompt-check] button').click();
    [...w.window.document.querySelectorAll('[role="menuitemradio"]')].find((i) => i.textContent === label).click();
    await flushAll();
  };
  await grade(TASK);
  await pick('Plan');
  tid = NEW_TID; made = NEW_TID;
  h.update();
  assert.deepEqual(rec.corrections, [], 'carried, still held');
  h.sent(TASK);
  assert.deepEqual(rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
  await grade(OTHER);
  await pick('Idea');
  assert.deepEqual(rec.corrections.at(-1), { surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'idea' });
  assert.equal(rec.corrections.length, 2);
});

test('a correction held in a new chat is dropped when another chat is opened instead: 0 kind-correction POSTs', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  assert.ok(s.rec.calls.some((c) => c.startsWith(`GET /api/ask/threads/${TID}`)), 'the other chat loaded');
  s.type(TASK);
  await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a refused first send keeps the held correction off the record; a later chat never receives it', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseCreate = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.equal(chips(s).length, 1, 'the draft stays, and so does its chip');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a thread made but its first message refused (429): another chat opened then receives 0 kind-correction POSTs', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseMessage = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.ok(s.rec.calls.includes(`POST /api/ask/threads/${NEW_TID}/messages`), 'the thread was made and the message refused');
  s.ctx.panel.open({ threadId: TID });
  await s.settle(); await s.settle();
  s.type(TASK);
  await s.settle();
  assert.deepEqual(s.rec.corrections, []);
});

test('a refused first message (429) then a retry in the same chat: the held correction is POSTed once, after the 202', async (t) => {
  const s = await open(t, { thread: false });
  await s.graded();
  await pickKind(s, 'Plan');
  s.rec.refuseMessage = true;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.deepEqual(s.rec.corrections, [], 'refused: nothing recorded yet');
  s.rec.refuseMessage = false;
  s.doc.querySelector('.ask-send').click();
  await s.settle();
  assert.deepEqual(s.rec.corrections, [{ surface: 'chat', threadId: NEW_TID, proposedKind: 'implementation', chosenKind: 'plan' }]);
});

test('an add-on holding the send (as the direction chip does) makes the text an answer: 0 grade calls', async (t) => {
  const s = await open(t, { extra: { id: 'holder', mount: () => ({ holdsSend: () => true }) } });
  s.type(TASK);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  await s.settle();
  assert.deepEqual(promptCheckCalls(s), []);
  assert.equal(chips(s).length, 0);
});

test('keyboard: Enter opens the kind menu, ArrowDown and Enter pick, and focus returns to the picker', async (t) => {
  const s = await open(t);
  await s.graded();
  const pick = chips(s)[0].querySelector('button');
  assert.match(pick.getAttribute('aria-label'), /^Prompt kind: /);
  pick.focus();
  pick.click();                                     // Enter on a native button is its click
  const menu = s.doc.querySelector('[role="menu"][aria-label="Prompt kind"]');
  assert.ok(menu);
  assert.equal(s.doc.activeElement.textContent, 'Requirement', 'the first kind has the focus');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  assert.equal(s.doc.activeElement.textContent, 'Implementation task');
  menu.dispatchEvent(new s.ctx.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  s.doc.activeElement.click();                      // Enter on the focused item
  await s.settle();
  assert.equal(s.doc.activeElement, pick);
  assert.equal(pick.textContent, 'Bug report');
});

test('a grade change is announced in the polite region, and focus stays on the text field', async (t) => {
  const s = await open(t);
  s.input.focus();
  await s.graded();
  const live = s.doc.querySelector('[aria-live="polite"]');
  assert.ok(live);
  assert.ok([...s.doc.querySelectorAll('[aria-live="polite"]')].some((n) => n.textContent === 'Prompt check: Implementation task, needs detail'));
  assert.equal(s.doc.activeElement, s.input);
});

test('the kind label appears only inside the chip', async (t) => {
  const s = await open(t);
  await s.graded();
  const outside = [...s.doc.body.querySelectorAll('*')].filter((n) => !n.closest('[data-prompt-check]') && !n.closest('[aria-live]')
    && [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.includes('Implementation task')));
  assert.deepEqual(outside, []);
});

test('a re-check never empties the lead row: typing a new task keeps the chip until the reply lands', async (t) => {
  const s = await open(t);
  await s.graded();
  const node = chips(s)[0];
  s.type(OTHER);
  assert.equal(chips(s)[0], node);
  s.timers.advance(PROMPT_CHECK_DEBOUNCE_MS);
  s.rec.grades.at(-1).reply({ kind: 'bug', grade: 'clear' });
  await s.settle();
  assert.equal(chips(s)[0], node);
  assert.equal(node.querySelector('.pcheck-grade').textContent, 'Clear');
});

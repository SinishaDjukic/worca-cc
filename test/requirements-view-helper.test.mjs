// test/requirements-view-helper.test.mjs — Ask Worca on the feature page in jsdom with a fake API (plans/requirements-a3-design.md §6,
// D1, D2, D6–D13, D16, D18, D20; design round 4, boards 22–25). Tasks 7 and 8 add to it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';

const { window } = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost:4317/#requirements' });
for (const k of ['document', 'location', 'Event', 'HTMLElement', 'Node', 'File', 'window']) {
  Object.defineProperty(globalThis, k, { value: k === 'window' ? window : window[k], configurable: true, writable: true });
}
const asked = [];
let answer = true;
window.confirm = (q) => { asked.push(q); return answer; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 8; i += 1) await tick(); };
after(() => window.close());
const { createRequirementsView } = await import('../ui/public/requirements-view.mjs');

/** routes: 'METHOD url' → a body, a function of the request body, or { __status, body }; anything else answers 404. */
function fakeApi(routes) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    calls.push({ method, url, body });
    const hit = routes[`${method} ${url}`];
    let out = typeof hit === 'function' ? hit(body) : hit;
    let status = out !== undefined ? 200 : 404;
    if (out && out.__status) { status = out.__status; out = out.body; }
    return { ok: status < 400, status, json: async () => out ?? { error: 'not found' }, text: async () => '# md' };
  };
  return calls;
}
const make = () => {
  const host = document.createElement('div'); const msgEl = document.createElement('p'); const subEl = document.createElement('div');
  document.body.replaceChildren(host);
  const view = createRequirementsView({ host, subEl, msgEl, deps: { route: () => {} } });
  return { host, msgEl, view };
};
const text = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const key = (el, k, extra = {}) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }));
const type = (el, v) => { el.value = v; el.dispatchEvent(new window.Event('input', { bubbles: true })); };

const INTERVIEW = { model: 'claude-opus-5-5', label: 'Opus 5.5', effort: 'medium', source: 'default' };
const BASE = { 'GET /api/projects': { projects: [{ key: 'shop-1', name: 'shop' }] }, 'GET /api/workspaces': { workspaces: [] } };
const CHECKS = ['goal', 'criteria', 'interview', 'openQuestions', 'assumptions', 'target'].map((k) => ({ key: k, ok: false, label: k, hint: 'not yet' }));
const READINESS = { ok: false, passed: 0, total: 6, checks: CHECKS, overridable: false };
const QS0 = [{ id: 'who-may', question: 'Who may cancel?', options: ['Customers', 'Support'], recommended: 'Customers', why: '' }];
const QS = [{ id: 'when', question: 'Until when can a customer cancel?', options: ['Until the label is printed', 'Until the parcel is picked up'], recommended: 'Until the label is printed', why: '' },
  { id: 'who', question: 'Who pays the return shipping?', options: ['The shop', 'The customer'], recommended: null, why: '' }];
const TURNS = [{ id: 9, kind: 'round', payload: { questions: QS0, note: '' } },
  { id: 10, kind: 'answers', payload: { roundTurnId: 9, answers: [{ id: 'who-may', question: 'Who may cancel?', answer: 'Customers', recommended: true }] } },
  { id: 11, kind: 'round', payload: { questions: QS, note: '' } }];
const feature = (over = {}) => ({ seq: 7, id: 'FEAT-7', scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel an order before it ships', status: 'your_turn', rounds: 2,
  costUsd: 0.33, busy: false, orientation: { summary: 'Orders have a status.', files: [], skipped: null },
  spec: { goal: { text: 'Customers cancel an order themselves before it ships.', measure: '' }, actors: [], flow: [], edgeCases: [], rules: ['A refund goes back to the card.'], outOfScope: [],
    criteria: [{ id: 'R-po-3', text: 'The confirm dialog is clear.' }], assumptions: [{ id: 'A-2', text: 'A cancelled order frees its stock at once.', status: 'open' }], openQuestions: [], edited: {} },
  pending: { turnId: 11, questions: QS, note: '' }, lastError: null, state: 'your_turn', readiness: READINESS, starts: [], unaskedRejections: [], changedSinceStart: [],
  attachments: [], briefDocuments: [], unaskedFiles: [], interview: INTERVIEW, resetPeriod: 'monthly', helper: { answering: false, messages: 0 }, ...over });
const chat = (messages = [], over = {}) => ({ messages, answering: false, estimate: null, ...over });
const po = (id, t, focus = null) => ({ id, role: 'po', text: t, focus, roundTurnId: null, drafts: [], proposals: [], error: null, costUsd: null, model: null });
const worca = (id, t, over = {}) => ({ id, role: 'worca', text: t, focus: null, roundTurnId: 11, drafts: [], proposals: [], error: null, costUsd: 0.02, model: 'claude-opus-5-5', ...over });

/** `s.f` and `s.helper` are what the server answers now: a test changes them to change the server. */
async function openFeature(s = {}, extra = {}) {
  s.f = s.f || feature();
  s.helper = s.helper || chat();
  const calls = fakeApi({ ...BASE, 'GET /api/requirements/7': () => ({ feature: s.f, turns: TURNS }), 'GET /api/requirements/7/helper': () => s.helper, ...extra });
  const m = make();
  await m.view.show('feature/7');
  return { ...m, calls, s };
}
const toggle = (host) => host.querySelector('[data-ui="helper-toggle"]');
async function openPanel(m) { toggle(m.host).click(); await settle(); return m.host.querySelector('.req-help'); }

// ── board 22: the toggle, the right column, the head, the first open ─────────────────

test('board 22: Ask Worca sits before Export, closed by default; pressed it takes the right column and the cards move under the current card', async () => {
  const m = await openFeature();
  const t = toggle(m.host);
  assert.deepEqual([t.textContent, t.getAttribute('aria-pressed')], ['Ask Worca', 'false']);
  assert.ok(t.compareDocumentPosition(m.host.querySelector('[data-ui="menu-export"]')) & Node.DOCUMENT_POSITION_FOLLOWING, 'before Export');
  assert.equal(m.host.querySelector('.req-help'), null);
  assert.ok(!m.calls.some((c) => c.url === '/api/requirements/7/helper'), 'a chat without messages is not fetched while closed');
  await openPanel(m);
  assert.equal(toggle(m.host).getAttribute('aria-pressed'), 'true');
  assert.ok(m.calls.some((c) => c.method === 'GET' && c.url === '/api/requirements/7/helper'), 'opening fetches the chat');
  const cols = m.host.querySelector('.req-cols');
  assert.ok(cols.classList.contains('with-helper'));
  assert.equal(m.host.querySelector('.req-right'), null);
  const kids = [...cols.querySelector('.req-left').children];
  const q = kids.findIndex((k) => k.classList.contains('qpanel'));
  assert.ok(kids[q + 1].classList.contains('req-moved'), 'right after the current card');
  assert.ok(kids[q + 2].classList.contains('req-rounds'), 'before the earlier rounds');
  assert.deepEqual([...kids[q + 1].children].map((c) => ['req-ready', 'req-files', 'req-spec'].find((x) => c.classList.contains(x))), ['req-ready', 'req-files', 'req-spec']);
  assert.ok(cols.lastElementChild.matches('aside.req-help[aria-label="Ask Worca"]'));
  toggle(m.host).click();
  await settle();
  assert.equal(m.host.querySelector('.req-help'), null);
  assert.ok(m.host.querySelector('.req-right .req-ready') && m.host.querySelector('.req-right .req-spec'), 'the cards go back');
  assert.equal(document.activeElement, toggle(m.host), 'the focus stays on the toggle');
});

test('board 22 / card 7: the head, the log, the first-open text and three questions that send at once (D18 names)', async () => {
  const sent = [];
  const s = {};
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => { sent.push(b); return (s.helper = chat([po(1, b.text)], { answering: true })); } });
  const p = await openPanel(m);
  assert.equal(text(p.querySelector('.req-help-head h3')), 'Ask Worca');
  assert.equal(text(p.querySelector('.req-help-head .hint')), 'About FEAT-7 · uses what Worca already knows');
  const more = p.querySelector('[data-ui="helper-more"]');
  assert.deepEqual([more.getAttribute('aria-label'), more.getAttribute('aria-haspopup')], ['More for this chat', 'menu']);
  assert.equal(p.querySelector('[data-ui="helper-close"]').getAttribute('aria-label'), 'Close Ask Worca');
  assert.equal(p.querySelector('[data-ui="helper-back"]').getAttribute('aria-label'), 'Back to FEAT-7');
  const log = p.querySelector('.req-help-log');
  assert.deepEqual([log.getAttribute('role'), log.getAttribute('aria-live')], ['log', 'polite']);
  assert.equal(text(p.querySelector('.req-help-empty p')), 'Ask Worca about this feature. It knows the spec, the interview so far, the product brief, your files and what it found in the code. It can draft answers to open questions and suggest spec changes — nothing changes until you accept.');
  const starters = [...p.querySelectorAll('.req-help-starter')];
  assert.deepEqual(starters.map((b) => b.textContent), ['Is anything missing from this spec?', "Which criteria can't be tested?", 'What edge cases am I missing?']);
  starters[1].click();
  await settle();
  assert.deepEqual(sent, [{ text: "Which criteria can't be tested?" }]);
  assert.equal(m.host.querySelector('.req-help-empty'), null);
});

test('D13: the composer: its label, the model and the range of the last calls, Enter sends, Shift+Enter does not, the count past 1,800', async () => {
  const sent = [];
  const s = { helper: chat([], { estimate: { low: 0.02, high: 0.04 } }) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => { sent.push(b); return (s.helper = chat([po(1, b.text)], { answering: true })); } });
  const p = await openPanel(m);
  const ta = p.querySelector('[data-ui="helper-in"]');
  assert.equal(p.querySelector(`label[for="${ta.id}"]`).textContent, 'Ask about this feature');
  assert.equal(document.activeElement, ta, 'opening puts the focus in the composer');
  assert.equal(text(p.querySelector('.req-help-costline')), 'Opus 5.5 · about $0.02–0.04 a message · Enter sends, Shift+Enter new line');
  const send = p.querySelector('[data-ui="helper-send"]');
  assert.equal(send.disabled, true, 'empty');
  type(ta, 'x'.repeat(1800));
  assert.equal(p.querySelector('.req-help-count').hidden, true);
  type(ta, 'x'.repeat(1801));
  assert.equal(text(p.querySelector('.req-help-count')), '1,801 of 2,000 characters');
  type(ta, 'x'.repeat(2001));
  assert.equal(send.disabled, true, 'past 2,000');
  type(ta, 'Is R-po-3 testable?');
  assert.equal(send.disabled, false);
  key(ta, 'Enter', { shiftKey: true });
  await settle();
  assert.deepEqual(sent, [], 'Shift+Enter adds a line');
  key(ta, 'Enter');
  await settle();
  assert.deepEqual(sent, [{ text: 'Is R-po-3 testable?' }]);
  assert.equal(m.host.querySelector('[data-ui="helper-in"]').value, '', 'a sent message leaves the composer');
});

test('D13: one cost when the last calls agree; "$0.01–0.05" before any; no model name without one', async () => {
  let m = await openFeature({ helper: chat([], { estimate: { low: 0.031, high: 0.034 } }) });
  await openPanel(m);
  assert.equal(text(m.host.querySelector('.req-help-costline')), 'Opus 5.5 · about $0.03 a message · Enter sends, Shift+Enter new line');
  m = await openFeature({ f: feature({ interview: null }) });
  await openPanel(m);
  assert.equal(text(m.host.querySelector('.req-help-costline')), 'about $0.01–0.05 a message · Enter sends, Shift+Enter new line');
});

// ── messages, card 8 and the lines of §6 ─────────────────

test("board 22: the product owner's message on the right with its cap; Worca's reply in plain text with its cost", async () => {
  const m = await openFeature({ f: feature({ helper: { answering: false, messages: 4 } }), helper: chat([
    po(1, 'Until when can a customer cancel?', { roundTurnId: 11, questionId: 'when', n: 1 }),
    worca(2, 'Your support-tickets.pdf says 38 of 52 cancel requests came after the label was printed.'),
    po(3, 'Thanks'), worca(4, 'You are welcome.', { costUsd: null })]) });
  const p = await openPanel(m);
  const mine = p.querySelector('[data-msg="1"]');
  assert.ok(mine.classList.contains('req-help-msg-po'));
  assert.equal(mine.querySelector('.req-help-cap').textContent, 'Help me answer · question 1');
  assert.equal(mine.lastChild.textContent, 'Until when can a customer cancel?');
  const reply = p.querySelector('[data-msg="2"]');
  assert.ok(reply.classList.contains('req-help-msg-w'));
  assert.equal(reply.querySelector('.req-help-text').textContent, 'Your support-tickets.pdf says 38 of 52 cancel requests came after the label was printed.');
  assert.equal(reply.querySelector('.req-help-cost').textContent, '$0.02');
  assert.equal(p.querySelector('[data-msg="4"] .req-help-cost'), null, 'no cost line when it cost nothing');
  assert.equal(p.querySelector('[data-msg="3"] .req-help-cap'), null);
});

test('card 8: while Worca answers: Answering…, Stop and the hint; Send and Clear chat wait; Stop keeps the message', async () => {
  const stops = [];
  const s = { f: feature({ helper: { answering: true, messages: 1 } }), helper: chat([po(1, "Which criteria can't be tested?")], { answering: true }) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/stop': () => { stops.push(1);
    return (s.helper = chat([po(1, "Which criteria can't be tested?"), worca(2, '', { error: { code: 'STOPPED', message: 'You stopped this reply.' }, costUsd: null })])); } });
  const p = await openPanel(m);
  const status = p.querySelector('.req-help-waiting [role="status"]');
  assert.equal(text(status), 'Answering… Worca is answering. Stop');
  assert.equal(status.querySelector('.badge.blue').textContent, 'Answering…');
  assert.equal(text(p.querySelector('.req-help-waiting .hint')), 'Send and Accept wait while Worca answers. Stop cancels the reply; your message stays in the chat.');
  type(p.querySelector('[data-ui="helper-in"]'), 'More');
  assert.equal(p.querySelector('[data-ui="helper-send"]').disabled, true);
  p.querySelector('[data-ui="helper-more"]').click();
  assert.equal(p.querySelector('[data-ui="helper-clear"]').disabled, true);
  p.querySelector('[data-ui="helper-stop"]').click();
  await settle();
  assert.deepEqual(stops, [1]);
  assert.equal(text(m.host.querySelector('.req-help-stopped')), 'You stopped this reply. Try again');
  assert.equal(text(m.host.querySelector('[data-msg="1"]')), "Which criteria can't be tested?");
});

test('§6 lines: a failed reply, Try again on the newest row only; the spending limit for this week; D20 a message left without a reply', async () => {
  const failed = { code: 'BAD_REPLY', message: 'Worca could not answer. Try again.' };
  const retries = [];
  const s = { f: feature({ resetPeriod: 'weekly', helper: { answering: false, messages: 4 } }),
    helper: chat([po(1, 'A'), worca(2, '', { error: failed, costUsd: null }), po(3, 'B'), worca(4, '', { error: failed, costUsd: 0.01 })]) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/retry': () => { retries.push(1); return (s.helper = chat([...s.helper.messages], { answering: true })); } });
  const p = await openPanel(m);
  assert.deepEqual([...p.querySelectorAll('.req-help-fail')].map((l) => [l.getAttribute('role'), text(l)]),
    [['alert', 'Worca could not answer. Try again.'], ['alert', 'Worca could not answer. Try again. Try again']]);
  assert.equal(p.querySelector('[data-msg="4"] .req-help-cost').textContent, '$0.01');
  p.querySelector('[data-ui="helper-retry"]').click();
  await settle();
  assert.deepEqual(retries, [1]);
  s.helper = chat([po(1, 'A'), worca(2, '', { error: { code: 'BUDGET', message: 'The spending limit is reached for this period.' }, costUsd: null })]);
  await m.view.changed(7);
  await settle();
  const budget = m.host.querySelector('.req-help-budget');
  assert.deepEqual([budget.getAttribute('role'), budget.textContent],
    ['alert', 'You have reached the Requirements spending limit for this week. Worca can answer again when it resets, or raise the limit in Settings › Budget.']);
  assert.equal(m.host.querySelector('[data-ui="helper-retry"]'), null, 'the spending limit offers no Try again');
  s.helper = chat([po(1, 'Left behind by a restart')]);
  await m.view.changed(7);
  await settle();
  assert.equal(text(m.host.querySelector('.req-help-fail')), 'Worca could not answer. Try again. Try again');
  assert.ok(m.host.querySelector('[data-ui="helper-retry"]'));
});

test('§6: a refused send keeps the text and says why under the composer; a spent budget says so in the chat; never a raw HTTP status', async () => {
  let reply = { __status: 409, body: { error: 'Worca is still working on this feature. Try again in a moment.' } };
  const m = await openFeature({}, { 'POST /api/requirements/7/helper/messages': () => reply });
  const p = await openPanel(m);
  type(p.querySelector('[data-ui="helper-in"]'), 'Is anything missing?');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.equal(m.host.querySelector('[data-ui="helper-in"]').value, 'Is anything missing?');
  const alert = m.host.querySelector('.req-help-refusal');
  assert.deepEqual([alert.getAttribute('role'), alert.textContent], ['alert', 'Worca is still working on this feature. Try again in a moment.']);
  reply = { __status: 409, body: { code: 'BUDGET', error: 'The spending limit of $5 is reached for this period. The interview continues when the limit resets or is raised.' } };
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal'), null);
  assert.equal(m.host.querySelector('.req-help-log .req-help-budget').textContent,
    'You have reached the Requirements spending limit for this month. Worca can answer again when it resets, or raise the limit in Settings › Budget.');
  assert.equal(m.host.querySelector('[data-ui="helper-in"]').value, 'Is anything missing?');
  reply = { __status: 502, body: {} };
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal').textContent, 'Worca could not finish that. Try again.');
});

test('D16: an archived feature\'s chat can be read: the archived line instead of the composer, no starters, Clear chat off', async () => {
  const m = await openFeature({ f: feature({ status: 'archived', state: 'archived', pending: null, helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, 'B')]) });
  const p = await openPanel(m);
  assert.equal(p.querySelector('[data-ui="helper-in"]'), null);
  assert.equal(text(p.querySelector('.req-help-archived')), 'This feature is archived: you can read the chat, not send. Restore the feature to ask Worca again.');
  assert.equal(p.querySelector('[data-msg="2"] .req-help-text').textContent, 'B');
  p.querySelector('[data-ui="helper-more"]').click();
  assert.equal(p.querySelector('[data-ui="helper-clear"]').disabled, true);
  const empty = await openFeature({ f: feature({ status: 'archived', state: 'archived', pending: null }) });
  await openPanel(empty);
  assert.ok(empty.host.querySelector('.req-help-empty') && !empty.host.querySelector('.req-help-starter'));
});

test('D14: Clear chat asks first ("Clear the chat? Changes you accepted stay in the spec.") and empties the chat', async () => {
  const deleted = [];
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, 'B')]) };
  const m = await openFeature(s, { 'DELETE /api/requirements/7/helper': () => { deleted.push(1); return (s.helper = chat()); } });
  const p = await openPanel(m);
  answer = false;
  p.querySelector('[data-ui="helper-more"]').click();
  p.querySelector('[data-ui="helper-clear"]').click();
  await settle();
  assert.deepEqual([asked.at(-1), deleted.length], ['Clear the chat? Changes you accepted stay in the spec.', 0]);
  answer = true;
  m.host.querySelector('[data-ui="helper-more"]').click();
  m.host.querySelector('[data-ui="helper-clear"]').click();
  await settle();
  assert.equal(deleted.length, 1);
  assert.ok(m.host.querySelector('.req-help-empty'), 'the first-open text again');
});

test('a chat that cannot be read keeps the last one shown: no first-open text, no starters', async () => {
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, 'B')]) };
  const m = await openFeature(s);
  await openPanel(m);
  s.helper = { __status: 502, body: {} };
  await m.view.changed(7);
  await settle();
  assert.equal(m.host.querySelector('.req-help-empty'), null);
  assert.equal(m.host.querySelector('.req-help-starter'), null);
  assert.equal(m.host.querySelector('[data-msg="2"] .req-help-text').textContent, 'B');
});

test('D18: Escape and Close shut the panel and give the focus back to Ask Worca; so does Back (the phone sheet)', async () => {
  const m = await openFeature();
  let p = await openPanel(m);
  key(p.querySelector('[data-ui="helper-in"]'), 'Escape');
  await settle();
  assert.equal(m.host.querySelector('.req-help'), null);
  assert.equal(document.activeElement, toggle(m.host));
  p = await openPanel(m);
  p.querySelector('[data-ui="helper-close"]').click();
  await settle();
  assert.equal(document.activeElement, toggle(m.host));
  p = await openPanel(m);
  p.querySelector('[data-ui="helper-back"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help'), null);
  assert.equal(document.activeElement, toggle(m.host));
});

test('D18: a live repaint keeps the log and an unchanged message\'s node (only what is new is announced), and the unsent text', async () => {
  const s = { f: feature({ helper: { answering: true, messages: 1 } }), helper: chat([po(1, 'A')], { answering: true }) };
  const m = await openFeature(s);
  const p = await openPanel(m);
  const log = p.querySelector('.req-help-log');
  const first = log.querySelector('[data-msg="1"]');
  type(p.querySelector('[data-ui="helper-in"]'), 'Typed, not sent');
  const removed = [];
  const watch = new window.MutationObserver((recs) => recs.forEach((r) => removed.push(...r.removedNodes)));
  watch.observe(log, { childList: true });
  s.helper = chat([po(1, 'A'), worca(2, 'B')]);
  s.f = feature({ helper: { answering: false, messages: 2 } });
  await m.view.changed(7);
  await settle();
  watch.takeRecords().forEach((r) => removed.push(...r.removedNodes));
  watch.disconnect();
  assert.equal(m.host.querySelector('.req-help-log'), log, 'the same live region');
  assert.equal(log.querySelector('[data-msg="1"]'), first, 'an unchanged message keeps its node');
  assert.ok(!removed.includes(first), 'and is never taken out of the live region and put back');
  assert.ok(log.querySelector('[data-msg="2"]'));
  assert.equal(m.host.querySelector('[data-ui="helper-in"]').value, 'Typed, not sent');
});

test('D18: a Worca reply keeps its node across a send (answering false → true → false) and a round starting and ending', async () => {
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, 'B')]) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => (s.helper = chat([po(1, 'A'), worca(2, 'B'), po(3, b.text)], { answering: true })) });
  const p = await openPanel(m);
  const log = p.querySelector('.req-help-log');
  const reply = log.querySelector('[data-msg="2"]');
  const removed = [];
  const watch = new window.MutationObserver((recs) => recs.forEach((r) => removed.push(...r.removedNodes)));
  watch.observe(log, { childList: true });
  type(p.querySelector('[data-ui="helper-in"]'), 'C');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.ok(m.host.querySelector('.req-help-waiting'), 'answering');
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'a send keeps the reply');
  s.helper = chat([po(1, 'A'), worca(2, 'B'), po(3, 'C'), worca(4, 'D')]);
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'the answer keeps it');
  const newest = log.querySelector('[data-msg="4"]');
  s.f = feature({ busy: true, status: 'thinking', state: 'thinking', pending: null, helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  watch.takeRecords().forEach((r) => removed.push(...r.removedNodes));
  watch.disconnect();
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'a round starting and ending keeps it');
  assert.equal(log.querySelector('[data-msg="4"]'), newest, 'and the newest reply');
  assert.ok(!removed.includes(reply) && !removed.includes(newest), 'never taken out of the live region and put back');
});

test('a chat that could not be loaded: no first-open text or starters over its messages; the line and Try again, which loads it', async () => {
  const s = { f: feature({ helper: { answering: false, messages: 3 } }), helper: { __status: 502, body: {} } };
  const m = await openFeature(s);
  const p = await openPanel(m);
  assert.equal(p.querySelector('.req-help-empty'), null);
  assert.equal(p.querySelector('.req-help-starter'), null);
  const line = p.querySelector('.req-help-unloaded');
  assert.deepEqual([line.getAttribute('role'), text(line)], ['alert', 'Worca could not load the chat. Try again. Try again']);
  const gets = () => m.calls.filter((c) => c.method === 'GET' && c.url === '/api/requirements/7/helper').length;
  const before = gets();
  s.helper = chat([po(1, 'A'), worca(2, 'B'), po(3, 'C')]);
  line.querySelector('[data-ui="helper-reload"]').click();
  await settle();
  assert.equal(gets(), before + 1, 'Try again fetches the chat');
  assert.equal(m.host.querySelector('.req-help-unloaded'), null);
  assert.equal(m.host.querySelector('[data-msg="2"] .req-help-text').textContent, 'B');
});

test('a press while a send, a starter or a Try again is in flight is ignored: a double click posts once', async () => {
  const failed = { code: 'BAD_REPLY', message: 'Worca could not answer. Try again.' };
  const posts = [];
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, '', { error: failed, costUsd: null })]) };
  let m = await openFeature(s, { 'POST /api/requirements/7/helper/retry': () => { posts.push('retry'); return (s.helper = chat([...s.helper.messages], { answering: true })); } });
  let p = await openPanel(m);
  const retry = p.querySelector('[data-ui="helper-retry"]');
  retry.click(); retry.click();
  await settle();
  assert.deepEqual(posts, ['retry']);
  posts.length = 0;
  const s2 = {};
  m = await openFeature(s2, { 'POST /api/requirements/7/helper/messages': (b) => { posts.push(b.text); return (s2.helper = chat([po(1, b.text)], { answering: true })); } });
  p = await openPanel(m);
  const starter = p.querySelector('[data-ui="helper-starter-0"]');
  starter.click(); starter.click();
  await settle();
  assert.deepEqual(posts, ['Is anything missing from this spec?']);
  posts.length = 0;
  const s3 = {};
  m = await openFeature(s3, { 'POST /api/requirements/7/helper/messages': (b) => { posts.push(b.text); return (s3.helper = chat([po(1, b.text)], { answering: true })); } });
  p = await openPanel(m);
  const ta = p.querySelector('[data-ui="helper-in"]');
  type(ta, 'Once');
  p.querySelector('[data-ui="helper-send"]').click();
  p.querySelector('[data-ui="helper-send"]').click();
  key(ta, 'Enter');
  await settle();
  assert.deepEqual(posts, ['Once']);
});

test('§6: a spent budget from Try again shows the in-chat spending-limit line; it goes once a reply starts, and on Clear chat', async () => {
  const failed = { code: 'BAD_REPLY', message: 'Worca could not answer. Try again.' };
  const BUDGET = { __status: 409, body: { code: 'BUDGET', error: 'The spending limit of $5 is reached for this period. The interview continues when the limit resets or is raised.' } };
  const rows = [po(1, 'A'), worca(2, '', { error: failed, costUsd: null })];
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat(rows) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/retry': () => BUDGET, 'DELETE /api/requirements/7/helper': () => (s.helper = chat()) });
  const p = await openPanel(m);
  p.querySelector('[data-ui="helper-retry"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal'), null, 'not the server text under the composer');
  assert.equal(m.host.querySelector('.req-help-log .req-help-budget').textContent,
    'You have reached the Requirements spending limit for this month. Worca can answer again when it resets, or raise the limit in Settings › Budget.');
  s.helper = chat([...rows, po(3, 'From another tab')], { answering: true });
  await m.view.changed(7);
  await settle();
  assert.equal(m.host.querySelector('.req-help-budget'), null, 'a reply started: the limit is no longer the news');
  s.helper = chat(rows);
  await m.view.changed(7);
  await settle();
  m.host.querySelector('[data-ui="helper-retry"]').click();
  await settle();
  assert.ok(m.host.querySelector('.req-help-log .req-help-budget'));
  m.host.querySelector('[data-ui="helper-more"]').click();
  m.host.querySelector('[data-ui="helper-clear"]').click();
  await settle();
  assert.ok(m.host.querySelector('.req-help-empty'));
  assert.equal(m.host.querySelector('.req-help-budget'), null, 'Clear chat clears the line');
});

test('D18: Escape while an input method is composing leaves the panel open', async () => {
  const m = await openFeature();
  const p = await openPanel(m);
  key(p.querySelector('[data-ui="helper-in"]'), 'Escape', { isComposing: true });
  await settle();
  assert.ok(m.host.querySelector('.req-help'));
});

test('style.css: the panel rules sit inside the Requirements block, tokens only; the pressed toggle has an ink border; the sheet at 900 px', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  assert.ok(start > 0 && end > start, 'the block markers');
  for (const sel of ['.req-help-toggle[aria-pressed="true"]', '.req-cols.with-helper', '.req-moved', '.req-help{', '.req-help-head', '.req-help-log', '.req-help-msg-po',
    '.req-help-msg-w', '.req-help-fail', '.req-help-budget', '.req-help-waiting', '.req-help-composer', '.req-help-in', '.req-help-refusal', '.req-help-archived']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const block = css.slice(start, end);
  const lines = block.split('\n').filter((l) => /req-help|with-helper|req-moved/.test(l));
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
  assert.match(block, /\.req-help-toggle\[aria-pressed="true"\]\{border-color:var\(--ink\)\}/);
  assert.ok(lines.every((l) => !(/req-help-toggle/.test(l) && /green/.test(l))), 'never green');
  assert.match(block, /\.req-cols\.with-helper\{grid-template-columns:minmax\(0,1fr\) 420px\}/);
  const sheet = block.slice(block.indexOf('@media (max-width:900px){', block.indexOf('.req-help{')));
  assert.match(sheet, /\.req-help\{position:fixed;inset:0;/);
  assert.match(sheet, /\.req-help-back\{display:inline-grid\}/);
  assert.match(sheet, /\.req-help-close,\.req-help-wide\{display:none\}/);
  assert.match(sheet, /\.req-help \.req-ico\{min-width:44px;min-height:44px\}/);
  // a 44px .btn is off the control scale (test/ui-design-language.test.mjs): a 28px button's hit area grows instead (board 20's pattern)
  assert.match(sheet, /\.req-help \.btn-sm::after\{content:"";position:absolute;inset:-9px 0\}/);
  assert.match(sheet, /\.req-help-toggle,\.req-help \.menu-item\{min-height:44px\}/, 'D18: the header toggle and Clear chat too');
});

test('a Stop press while the follow-up refetch of an earlier chat POST is still pending is sent (the POST alone holds the guard)', async () => {
  const failed = { code: 'BAD_REPLY', message: 'Worca could not answer. Try again.' };
  const posts = [];
  let holdNext = false;
  let release = null;
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, '', { error: failed, costUsd: null })]) };
  const m = await openFeature(s, {
    // the first feature fetch after Try again hangs until released (a slow refetch)
    'GET /api/requirements/7': () => {
      if (!holdNext) return { feature: s.f, turns: TURNS };
      holdNext = false;
      return new Promise((r) => { release = () => r({ feature: s.f, turns: TURNS }); });
    },
    'POST /api/requirements/7/helper/retry': () => { posts.push('retry'); holdNext = true; return (s.helper = chat([po(1, 'A')], { answering: true })); },
    'POST /api/requirements/7/helper/stop': () => { posts.push('stop');
      return (s.helper = chat([po(1, 'A'), worca(3, '', { error: { code: 'STOPPED', message: 'You stopped this reply.' }, costUsd: null })])); },
  });
  await openPanel(m);
  m.host.querySelector('[data-ui="helper-retry"]').click();
  await settle();
  assert.equal(typeof release, 'function', 'the refetch after Try again is still pending');
  await m.view.changed(7);   // a live frame paints the answering chat meanwhile
  await settle();
  m.host.querySelector('[data-ui="helper-stop"]').click();
  await settle();
  assert.deepEqual(posts, ['retry', 'stop'], 'Stop is not ignored while the earlier refetch runs');
  release();
  await settle();
  assert.equal(text(m.host.querySelector('.req-help-stopped')), 'You stopped this reply. Try again');
});

// ── Task 7: Help me answer and drafts (D1, D2, D6) ─────────────────

const draftChat = (drafts, over = {}) => chat([po(1, 'Until when?', { roundTurnId: 11, questionId: 'when', n: 1 }),
  worca(2, 'I picked Until the parcel is picked up in question 1.', { drafts, ...over })]);
const withChat = (helper) => ({ f: feature({ helper: { answering: false, messages: helper.messages.length } }), helper });
const blocks = (host) => [...host.querySelectorAll('.qpanel:not(.req-revise) .qblock')];
const pressed = (block) => [...block.querySelectorAll('.qopt')].map((o) => o.getAttribute('aria-pressed'));

test('D1: Help me answer on each pending question opens the panel with the question and its cap in the composer; nothing is sent', async () => {
  const m = await openFeature();
  const helps = [...m.host.querySelectorAll('.qpanel .req-help-ask')];
  assert.deepEqual(helps.map((b) => b.textContent), ['Help me answer', 'Help me answer']);
  assert.ok(helps[0].closest('.req-qhead').querySelector('.qtext'), 'beside its question');
  helps[1].click();
  await settle();
  const p = m.host.querySelector('.req-help');
  assert.ok(p, 'the panel opens');
  assert.equal(p.querySelector('.req-help-composer .req-help-cap').textContent, 'Help me answer · question 2');
  assert.equal(p.querySelector('[data-ui="helper-in"]').value, 'Who pays the return shipping?');
  assert.equal(document.activeElement, p.querySelector('[data-ui="helper-in"]'));
  assert.ok(!m.calls.some((c) => c.method === 'POST'), 'every message costs money: nothing is sent by itself');
  key(p.querySelector('[data-ui="helper-in"]'), 'Escape');
  await settle();
  assert.equal(document.activeElement, m.host.querySelector('[data-ui="help-11-1"]'), 'Escape gives the focus back to its opener');
  toggle(m.host).click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-composer .req-help-cap'), null, 'the header toggle opens a general chat: no cap carried over');
  m.host.querySelector('[data-ui="help-11-0"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-composer .req-help-cap').textContent, 'Help me answer · question 1');
  type(m.host.querySelector('[data-ui="helper-in"]'), '');
  assert.equal(m.host.querySelector('.req-help-composer .req-help-cap'), null, 'an emptied composer drops the cap');
});

test('D1: the message goes with its focus; its bubble carries the cap; the composer is empty again', async () => {
  const sent = [];
  const s = {};
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => { sent.push(b);
    return (s.helper = chat([po(1, b.text, { ...b.focus, n: 1 })], { answering: true })); } });
  m.host.querySelector('[data-ui="help-11-0"]').click();
  await settle();
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.deepEqual(sent, [{ text: 'Until when can a customer cancel?', focus: { roundTurnId: 11, questionId: 'when', n: 1 } }]);
  assert.equal(m.host.querySelector('[data-msg="1"] .req-help-cap').textContent, 'Help me answer · question 1');
  assert.equal(m.host.querySelector('.req-help-composer .req-help-cap'), null);
  assert.equal(m.host.querySelector('[data-ui="helper-in"]').value, '');
});

test('D1: an earlier round being changed has no Help me answer', async () => {
  const m = await openFeature();
  m.host.querySelector('[data-ui="change-9"]').click();
  await settle();
  assert.ok(m.host.querySelector('.req-revise'));
  assert.equal(m.host.querySelector('.req-revise .req-help-ask'), null);
});

test('D6 board 22: a draft fills the question card, marked drafted by Worca with its why after the options; the panel stays closed', async () => {
  const m = await openFeature(withChat(draftChat([{ question: 'when', n: 1, option: 'Until the parcel is picked up', why: 'Most requests come after the label is printed.', dropped: false }])));
  const [b1, b2] = blocks(m.host);
  assert.deepEqual(pressed(b1), ['false', 'true'], 'the draft replaces the recommended pick');
  const chip = b1.querySelector('.req-help-drafted-row');
  assert.equal(chip.hidden, false);
  // the board's × is the remove icon (a glyph as an icon fails test/ui-design-language.test.mjs)
  assert.equal(text(chip.querySelector('.req-help-drafted')), 'drafted by Worca');
  assert.equal(chip.querySelector('.req-help-drafted-x svg').getAttribute('aria-hidden'), 'true');
  assert.equal(chip.querySelector('.req-help-drafted-x').getAttribute('aria-label'), "Clear Worca's draft for question 1");
  assert.equal(text(chip.querySelector('.req-help-draft-why')), "Worca's draft: Most requests come after the label is printed.");
  assert.ok(b1.querySelector('.qopts').compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING, 'after the options row, not inside an option');
  assert.equal(b2.querySelector('.req-help-drafted-row').hidden, true);
  assert.equal(m.host.querySelector('.req-help'), null, 'the chat was fetched for its drafts; the panel stays closed');
  assert.ok(!m.calls.some((c) => c.method === 'POST'), 'a draft is never sent by itself');
});

test('D6: × puts the question back to the recommended pick; a hand pick or a typed answer removes the mark; a repaint never applies it again', async () => {
  const s = withChat(draftChat([{ question: 'when', n: 1, option: 'Until the parcel is picked up', why: '', dropped: false },
    { question: 'who', n: 2, text: 'The shop, below 50 €', why: '', dropped: false }]));
  const m = await openFeature(s);
  let [b1, b2] = blocks(m.host);
  assert.equal(b2.querySelector('.qfree').value, 'The shop, below 50 €', 'a text draft is the own answer');
  b1.querySelector('.req-help-drafted-x').click();
  assert.deepEqual(pressed(b1), ['true', 'false']);
  assert.equal(b1.querySelector('.req-help-drafted-row').hidden, true);
  assert.equal(document.activeElement, b1.querySelectorAll('.qopt')[0], 'the focus moves to the recommended option');
  b2.querySelectorAll('.qopt')[1].click();
  assert.equal(b2.querySelector('.req-help-drafted-row').hidden, true, 'a hand pick removes the mark');
  await m.view.changed(7);
  await settle();
  [b1, b2] = blocks(m.host);
  assert.deepEqual([pressed(b1), pressed(b2)], [['true', 'false'], ['false', 'true']]);
  assert.ok([b1, b2].every((b) => b.querySelector('.req-help-drafted-row').hidden), 'not applied again');
});

test('D6: Submit sends the drafted answers as any answer', async () => {
  const posted = [];
  const s = withChat(draftChat([{ question: 'when', n: 1, option: 'Until the parcel is picked up', why: '', dropped: false },
    { question: 'who', n: 2, text: 'The shop', why: '', dropped: false }]));
  const m = await openFeature(s, { 'POST /api/requirements/7/answers': (b) => { posted.push(b); return { feature: s.f, turns: TURNS }; } });
  [...m.host.querySelectorAll('.qpanel .btn-primary')].find((b) => b.textContent === 'Submit').click();
  await settle();
  assert.deepEqual(posted, [{ roundTurnId: 11, answers: [{ id: 'when', option: 'Until the parcel is picked up' }, { id: 'who', text: 'The shop' }] }]);
});

test('D6: a draft whose round is no longer pending is not applied; its reply says it was dropped', async () => {
  const m = await openFeature(withChat(chat([po(1, 'x'), worca(2, 'Reply', { roundTurnId: 9, drafts: [{ question: 'who-may', n: 1, option: 'Support', why: '', dropped: true }] })])));
  assert.ok(blocks(m.host).every((b) => b.querySelector('.req-help-drafted-row').hidden));
  const p = await openPanel(m);
  assert.equal(text(p.querySelector('[data-msg="2"] .req-help-dropped')), "The question you asked about has been answered, so Worca's draft for it was dropped.");
});

test('D2/D6 board 25: Back keeps the drafts in the question card; a reload applies the stored draft again', async () => {
  const s = withChat(draftChat([{ question: 'when', n: 1, option: 'Until the parcel is picked up', why: '', dropped: false }]));
  const m = await openFeature(s);
  await openPanel(m);
  m.host.querySelector('[data-ui="helper-back"]').click();
  await settle();
  const [b1] = blocks(m.host);
  assert.deepEqual(pressed(b1), ['false', 'true']);
  assert.equal(b1.querySelector('.req-help-drafted-row').hidden, false);
  b1.querySelector('.req-help-drafted-x').click();
  const again = await openFeature(s);
  assert.equal(blocks(again.host)[0].querySelector('.req-help-drafted-row').hidden, false, 'a new page applies it again');
});

test('style.css: the draft chip is dashed blue (blue means active); Help me answer is a 44 px line on a phone', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-qhead{', '.req-help-ask{', '.req-help-drafted-row{', '.req-help-drafted{', '.req-help-drafted-x{', '.req-help-draft-why']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const block = css.slice(start, end);
  assert.match(block, /\.req-help-drafted\{[^}]*border:1px dashed var\(--blue-ink-strong\)[^}]*color:var\(--blue-ink-strong\)/);
  assert.match(block, /\.req-help-drafted-row\[hidden\]\{display:none\}/);
  const phone = block.slice(block.indexOf('@media (max-width:900px){', block.indexOf('.req-help-drafted{')));
  assert.match(phone, /\.req-help-ask\{[^}]*min-height:44px/);
  // the × keeps its size inside the chip; its hit area grows to 44 x 44 (the ::after pattern of .req-fpick and .req-help .btn-sm)
  assert.match(phone, /\.req-help-drafted-x\{position:relative\}/);
  assert.match(phone, /\.req-help-drafted-x::after\{content:"";position:absolute;[^}]*width:44px;height:44px/);
});

// ── Fix round 1: late replies, typed answers, button names ─────────────────

/** Two features: 7 (the one a send is started on) and 8; the POST for 7 is held until `release()`. */
async function twoFeatures() {
  const s7 = { f: feature(), helper: chat() };
  const s8 = { f: feature({ seq: 8, id: 'FEAT-8', title: 'Other feature' }), helper: chat([po(1, 'B asked')]) };
  const posts = [];
  let release;
  const held = new Promise((r) => { release = r; });
  const calls = fakeApi({ ...BASE,
    'GET /api/requirements/7': () => ({ feature: s7.f, turns: TURNS }), 'GET /api/requirements/7/helper': () => s7.helper,
    'GET /api/requirements/8': () => ({ feature: s8.f, turns: TURNS }), 'GET /api/requirements/8/helper': () => s8.helper,
    'POST /api/requirements/8/helper/messages': (b) => { posts.push(['8', b.text]); return (s8.helper = chat([...s8.helper.messages, po(2, b.text)], { answering: true })); } });
  const real = globalThis.fetch;
  const gate8 = { wait: null, get7: null };
  globalThis.fetch = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET' && url === '/api/requirements/7/helper' && gate8.get7) await gate8.get7;
    if ((opts.method || 'GET') === 'POST' && url === '/api/requirements/8/helper/messages' && gate8.wait) await gate8.wait;
    if ((opts.method || 'GET') === 'POST' && url === '/api/requirements/7/helper/messages') {
      posts.push(['7', JSON.parse(opts.body).text]);
      await held;
      return { ok: true, status: 200, json: async () => chat([po(1, 'A secret')], { answering: true }), text: async () => '' };
    }
    return real(url, opts);
  };
  const m = make();
  await m.view.show('feature/7');
  return { ...m, calls, posts, release, s7, s8, gate8 };
}

test('Fix 1a: a send for feature A that lands after switching to feature B changes nothing on B', async () => {
  const m = await twoFeatures();
  let p = await openPanel(m);
  type(p.querySelector('[data-ui="helper-in"]'), 'About A');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  await m.view.show('feature/8');
  p = await openPanel(m);
  assert.ok(p.textContent.includes('B asked'));
  m.release();
  await settle();
  p = m.host.querySelector('.req-help');
  assert.ok(!p.textContent.includes('A secret'), "A's messages never show on B");
  assert.ok(p.textContent.includes('B asked'));
  assert.equal(p.querySelector('.req-help-refusal'), null, "B's error line is untouched");
});

test('Fix 1b: after switching while A is in flight, B can send, and a double press on B posts once', async () => {
  const m = await twoFeatures();
  let p = await openPanel(m);
  type(p.querySelector('[data-ui="helper-in"]'), 'About A');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  await m.view.show('feature/8');
  p = await openPanel(m);
  let release8;
  m.gate8.wait = new Promise((r) => { release8 = r; });
  type(p.querySelector('[data-ui="helper-in"]'), 'About B');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  m.release();   // A's late reply lands while B's send is still in flight: its finally must not free B's guard
  await settle();
  type(m.host.querySelector('[data-ui="helper-in"]'), 'About B');
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  release8();
  await settle();
  assert.deepEqual(m.posts.filter((x) => x[0] === '8'), [['8', 'About B']]);
  p = m.host.querySelector('.req-help');
  assert.ok(!p.textContent.includes('A secret'));
});

test('Fix 2: a typed answer removes the "drafted by Worca" mark', async () => {
  const m = await openFeature(withChat(draftChat([{ question: 'when', n: 1, option: 'Until the parcel is picked up', why: 'Why.', dropped: false }])));
  const [b1] = blocks(m.host);
  assert.equal(b1.querySelector('.req-help-drafted-row').hidden, false);
  type(b1.querySelector('.qfree'), 'Two days after the order');
  assert.equal(b1.querySelector('.req-help-drafted-row').hidden, true, 'the mark is gone');
});

test('Fix 3: each Help me answer button is described by its own question', async () => {
  const m = await openFeature();
  const helps = [...m.host.querySelectorAll('.qpanel .req-help-ask')];
  assert.equal(helps.length, 2);
  const ids = helps.map((b) => b.getAttribute('aria-describedby'));
  assert.equal(new Set(ids).size, 2);
  helps.forEach((b, i) => {
    const el = m.host.querySelector(`#${b.getAttribute('aria-describedby')}`);
    assert.ok(el && el.classList.contains('qtext'));
    assert.ok(el.textContent.includes(QS[i].question));
  });
});

test('Fix 4: A, send, B, back to A: the old reply of the earlier visit is dropped', async () => {
  const m = await twoFeatures();
  let p = await openPanel(m);
  type(p.querySelector('[data-ui="helper-in"]'), 'About A');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  await m.view.show('feature/8');
  await m.view.show('feature/7');
  p = m.host.querySelector('.req-help') || await openPanel(m);
  m.release();
  await settle();
  p = m.host.querySelector('.req-help');
  assert.ok(!p.textContent.includes('A secret'), 'the reply belongs to the first visit');
});

test('Fix 5: a Try again (reload) of the chat that ends after a switch does not free the guard another feature took', async () => {
  const m = await twoFeatures();
  m.s7.helper = { __status: 502, body: {} };
  m.s7.f = feature({ helper: { answering: false, messages: 3 } });
  await m.view.show('feature/7');
  let p = m.host.querySelector('.req-help') || await openPanel(m);
  let rel7;
  m.gate8.get7 = new Promise((r) => { rel7 = r; });
  p.querySelector('[data-ui="helper-reload"]').click();
  await settle();
  await m.view.show('feature/8');
  p = await openPanel(m);
  let rel8;
  m.gate8.wait = new Promise((r) => { rel8 = r; });
  type(p.querySelector('[data-ui="helper-in"]'), 'About B');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  rel7();
  await settle();
  type(m.host.querySelector('[data-ui="helper-in"]'), 'About B');
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  rel8();
  await settle();
  assert.deepEqual(m.posts.filter((x) => x[0] === '8'), [['8', 'About B']]);
});

// ── Task 8: proposal cards (board 24, D7–D11, D16, D18) ─────────────────

const prop = (n, over) => ({ n, id: null, value: null, before: null, reason: 'r', state: 'proposed', stale: false, askedAgain: false, ...over });
const cardsChat = (over = {}) => chat([po(1, 'What would you change?'), worca(2, 'I suggest these.', { proposals: [
  prop(1, { target: 'goal', change: 'set', value: { text: 'Customers cancel an order, or the items not yet picked up, themselves from their order history.', measure: '' },
    before: { text: 'Customers cancel an order themselves before it ships.', measure: '' }, reason: 'partly shipped orders are 9 of 52 tickets.' }),
  prop(2, { target: 'criterion', change: 'reword', id: 'R-po-3', value: 'The confirm dialog names the order number and its total.', before: 'The confirm dialog is clear.', reason: '“clear” cannot be tested.' }),
  prop(3, { target: 'assumption', change: 'reject', id: 'A-2', before: { text: 'A cancelled order frees its stock at once.', status: 'open' }, reason: 'the brief says stock is freed by the warehouse job.' }),
  prop(4, { target: 'criterion', change: 'add', value: 'An order with some items shipped can cancel only the items not yet picked up.', state: 'accepted', appliedId: 'R-po-6' }),
  prop(5, { target: 'edgeCases', change: 'set', value: ['A cancelled order sends an SMS.'], before: [], added: ['A cancelled order sends an SMS.'], removed: [], state: 'rejected' }),
] }), worca(3, 'And these.', { proposals: [
  prop(1, { target: 'rules', change: 'set', value: ['A refund goes back to the card.', 'A refund goes back the way the order was paid.'], before: ['A refund goes back to the card.'],
    added: ['A refund goes back the way the order was paid.'], removed: [], stale: true }),
  prop(2, { target: 'criterion', change: 'add', value: 'A new one.' }),
  prop(3, { target: 'criterion', change: 'remove', id: 'R-po-3', before: 'The confirm dialog is clear.' }),
  prop(4, { target: 'assumption', change: 'confirm', id: 'A-2', before: { text: 'A cancelled order frees its stock at once.', status: 'open' } }),
] })], over);
const card = (host, id) => host.querySelector(`[data-proposal="${id}"]`);
const rows = (c) => [...c.querySelectorAll('.req-help-ba > span')].map((x) => text(x));
const head = (c) => c.querySelector('.req-help-card-head').textContent;
const btns = (c) => [...c.querySelectorAll('.btn')].map((b) => [b.textContent, b.classList.contains('btn-primary'), b.disabled]);
const openCards = async (f = feature(), over = {}, extra = {}) => {
  const s = { f: { ...f, helper: { answering: !!over.answering, messages: 3 } }, helper: cardsChat(over) };
  const m = await openFeature(s, extra);
  await openPanel(m);
  return m;
};

test('board 24 cards 1–3: change a section (Before / After), reword a criterion, reject an assumption; Why, Reject and Accept', async () => {
  const m = await openCards();
  const goal = card(m.host, '2-1');
  assert.deepEqual([goal.getAttribute('role'), goal.getAttribute('aria-label')], ['group', 'Proposed change: Goal']);
  assert.equal(head(goal), 'Proposed change · Goal');
  assert.deepEqual(rows(goal), ['Before', 'Customers cancel an order themselves before it ships.', 'After', 'Customers cancel an order, or the items not yet picked up, themselves from their order history.']);
  assert.ok(goal.querySelectorAll('.req-help-ba > span')[1].classList.contains('req-help-old'));
  assert.equal(goal.querySelector('.req-help-reason').textContent, 'Why: partly shipped orders are 9 of 52 tickets.');
  assert.deepEqual(btns(goal), [['Reject', false, false], ['Accept', true, false]]);
  const reword = card(m.host, '2-2');
  assert.equal(reword.getAttribute('aria-label'), 'Proposed change: R-po-3');
  assert.equal(head(reword), 'Proposed change · Acceptance criteria · R-po-3');
  assert.deepEqual(rows(reword), ['Before', 'The confirm dialog is clear.', 'After', 'The confirm dialog names the order number and its total.']);
  const rej = card(m.host, '2-3');
  assert.deepEqual([rej.getAttribute('aria-label'), head(rej)], ['Proposed change: A-2', 'Proposed change · Assumptions · reject A-2']);
  assert.deepEqual(rows(rej), ['Reject', 'A cancelled order frees its stock at once.']);
});

test('board 24 cards 4–6: Accepted (the id it got, a green check, role=status), Rejected, and the spec changed meanwhile (role=alert)', async () => {
  const m = await openCards();
  const acc = card(m.host, '2-4');
  assert.equal(head(acc), 'Change · Acceptance criteria · add');
  assert.deepEqual(rows(acc), ['New', 'R-po-6 An order with some items shipped can cancel only the items not yet picked up.']);
  const st = acc.querySelector('.req-help-state');
  assert.deepEqual([st.getAttribute('role'), st.textContent, st.classList.contains('ok'), !!st.querySelector('svg')], ['status', 'Accepted · now in the spec as your edit', true, true]);
  assert.deepEqual([acc.querySelector('.btn'), acc.querySelector('.req-help-reason')], [null, null]);
  const rejd = card(m.host, '2-5');
  assert.equal(head(rejd), 'Change · Edge cases');
  assert.deepEqual(rows(rejd), ['After', 'A cancelled order sends an SMS.']);
  assert.deepEqual([rejd.querySelector('.req-help-state').getAttribute('role'), rejd.querySelector('.req-help-state').textContent], ['status', 'Rejected']);
  const stale = card(m.host, '3-1');
  assert.equal(head(stale), 'Proposed change · Business rules');
  assert.deepEqual(rows(stale), ['After', 'A refund goes back the way the order was paid.'], 'D8: the one added line, as board 24');
  const alert = stale.querySelector('.req-help-stale');
  assert.deepEqual([alert.getAttribute('role'), alert.textContent], ['alert', 'The spec changed since Worca proposed this.']);
  assert.deepEqual(btns(stale).map(([t]) => t), ['Reject', 'Ask again']);
  assert.ok(stale.classList.contains('is-stale'));
});

test('board 24: a pending add shows New without an id; a criterion removal; an assumption confirm', async () => {
  const m = await openCards();
  const add = card(m.host, '3-2');
  assert.deepEqual([add.getAttribute('aria-label'), head(add), rows(add)], ['Proposed change: Acceptance criteria', 'Proposed change · Acceptance criteria · add', ['New', 'A new one.']]);
  const rem = card(m.host, '3-3');
  assert.deepEqual([rem.getAttribute('aria-label'), head(rem), rows(rem)], ['Proposed change: R-po-3', 'Proposed change · Acceptance criteria · remove R-po-3', ['Remove', 'The confirm dialog is clear.']]);
  const conf = card(m.host, '3-4');
  assert.deepEqual([head(conf), rows(conf)], ['Proposed change · Assumptions · confirm A-2', ['Confirm', 'A cancelled order frees its stock at once.']]);
});

test('D10: Accept, Reject and Ask again post to their proposal and fetch the feature again; a refusal shows under the composer', async () => {
  const posted = [];
  const routes = {};
  for (const [id, what] of [['2/proposals/1', 'accept'], ['2/proposals/2', 'reject'], ['3/proposals/1', 'ask-again']]) {
    routes[`POST /api/requirements/7/helper/messages/${id}/${what}`] = () => { posted.push(`${id}/${what}`); return cardsChat(); };
  }
  routes['POST /api/requirements/7/helper/messages/3/proposals/2/accept'] = { __status: 409, body: { error: 'The spec changed since Worca proposed this.' } };
  routes['POST /api/requirements/7/helper/messages/3/proposals/3/accept'] = { __status: 404, body: { error: 'This change is no longer in the chat.' } };
  const m = await openCards(feature(), {}, routes);
  const gets = () => m.calls.filter((c) => c.method === 'GET' && c.url === '/api/requirements/7').length;
  const before = gets();
  for (const ui of ['prop-accept-2-1', 'prop-reject-2-2', 'prop-ask-again-3-1']) {
    m.host.querySelector(`[data-ui="${ui}"]`).click();
    await settle();
  }
  assert.deepEqual(posted, ['2/proposals/1/accept', '2/proposals/2/reject', '3/proposals/1/ask-again']);
  assert.equal(gets(), before + 3, 'each one repaints the feature (an accepted change is in the spec)');
  m.host.querySelector('[data-ui="prop-accept-3-2"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal').textContent, 'The spec changed since Worca proposed this.');
  m.host.querySelector('[data-ui="prop-accept-3-3"]').click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal').textContent, 'This change is no longer in the chat.', 'a 404 naming the change says so, not "turned off"');
});

test('D11/D16: Accept and Ask again wait while Worca answers or a round runs; nothing is decided on an archived feature; asked again: only the alert', async () => {
  let m = await openCards(feature(), { answering: true });
  assert.deepEqual(btns(card(m.host, '2-1')), [['Reject', false, false], ['Accept', true, true]], 'Reject is allowed while Worca answers');
  assert.deepEqual(btns(card(m.host, '3-1')), [['Reject', false, false], ['Ask again', false, true]]);
  m = await openCards(feature({ busy: true, status: 'thinking', state: 'thinking' }));
  assert.equal(btns(card(m.host, '2-1'))[1][2], true, 'Accept waits while a round runs');
  assert.equal(btns(card(m.host, '2-1'))[0][2], false, 'Reject stays allowed while a round runs');
  assert.deepEqual(btns(card(m.host, '3-1')), [['Reject', false, false], ['Ask again', false, true]], 'Ask again waits while a round runs');
  m = await openCards(feature({ status: 'archived', state: 'archived', pending: null }));
  assert.ok([...m.host.querySelectorAll('.req-help-card .btn')].every((b) => b.disabled), 'archived: read only');
  const s = { f: feature({ helper: { answering: false, messages: 4 } }), helper: cardsChat() };
  s.helper.messages[2].proposals[0].askedAgain = true;
  s.helper.messages.push(po(4, 'Propose this again for the current spec.', { askAgain: { msgId: 3, n: 1 } }));
  m = await openFeature(s);
  await openPanel(m);
  const stale = card(m.host, '3-1');
  assert.deepEqual([!!stale.querySelector('.req-help-stale'), stale.querySelector('.btn')], [true, null], 'the stale card keeps only its alert');
  assert.equal(m.host.querySelector('[data-msg="4"] .req-help-cap').textContent, 'Ask again · Business rules');
});

test('style.css: the cards use tokens only; Accepted is green ink, never a fill; the stale line is the amber alert; 44 px targets on a phone', () => {
  const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
  const start = css.indexOf('/* Requirements page (plans/requirements-design.md section 6). Tokens only. */');
  const end = css.indexOf('/* ── marketplace P3 ── */');
  for (const sel of ['.req-help-card{', '.req-help-card-head', '.req-help-ba{', '.req-help-k', '.req-help-old', '.req-help-btns', '.req-help-state', '.req-help-stale']) {
    const at = css.indexOf(sel);
    assert.ok(at > start && at < end, `${sel} inside the Requirements block`);
  }
  const block = css.slice(start, end);
  const lines = block.split('\n').filter((l) => /req-help/.test(l));
  assert.ok(lines.every((l) => !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(l)), 'tokens only');
  assert.ok(lines.every((l) => !/background:var\(--green/.test(l)), 'never a green fill');
  assert.match(block, /\.req-help-state\.ok\{color:var\(--green-ink-strong\)\}/);
  assert.match(block, /\.req-help-stale\{[^}]*background:var\(--amber-bg\);color:var\(--amber-ink-strong\)/);
  const phone = block.slice(block.indexOf('@media (max-width:900px){', block.indexOf('.req-help-card{')));
  // a 44px .btn is off the control scale (ui-design-language): the card's .btn-sm buttons take the panel's ::after hit area
  assert.match(phone, /\.req-help-btns \.btn\{flex:1\}/);
  const tap = block.indexOf('.req-help .btn-sm::after{content:"";position:absolute;inset:-9px 0}');
  const media = block.lastIndexOf('@media (max-width:900px){', tap);
  assert.ok(tap > 0 && media > 0, 'the tap-area rule follows a 900 px media query');
  const between = block.slice(media, tap);
  assert.equal((between.match(/\{/g) || []).length - (between.match(/\}/g) || []).length, 1, 'and sits inside it');
});

test('D18: a Worca row whose cards are all decided keeps its node across a Send (answering false → true → false)', async () => {
  const decided = () => [po(1, 'A'), worca(2, 'B', { proposals: [prop(1, { target: 'criterion', change: 'add', value: 'X.', state: 'accepted', appliedId: 'R-po-6' }),
    prop(2, { target: 'rules', change: 'set', value: ['Y.'], before: [], added: ['Y.'], removed: [], state: 'rejected' })] })];
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat(decided()) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => (s.helper = chat([...decided(), po(3, b.text)], { answering: true })) });
  const p = await openPanel(m);
  const log = p.querySelector('.req-help-log');
  const reply = log.querySelector('[data-msg="2"]');
  const removed = [];
  const watch = new window.MutationObserver((recs) => recs.forEach((r) => removed.push(...r.removedNodes)));
  watch.observe(log, { childList: true });
  type(p.querySelector('[data-ui="helper-in"]'), 'C');
  p.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.ok(m.host.querySelector('.req-help-waiting'), 'answering');
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'a send keeps the decided cards\' row');
  s.helper = chat([...decided(), po(3, 'C'), worca(4, 'D')]);
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  s.f = feature({ busy: true, status: 'thinking', state: 'thinking', pending: null, helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  watch.takeRecords().forEach((r) => removed.push(...r.removedNodes));
  watch.disconnect();
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'the answer and a round starting keep it too');
  assert.ok(!removed.includes(reply), 'never taken out of the live region and put back');
});

test('D18: a row with cards waiting for a decision keeps its node while Worca answers and a round runs; only their buttons turn off and on', async () => {
  const rows2 = () => [po(1, 'A'), worca(2, 'B', { proposals: [prop(1, { target: 'criterion', change: 'add', value: 'X.' }),
    prop(2, { target: 'rules', change: 'set', value: ['Y.'], before: [], added: ['Y.'], removed: [], stale: true })] })];
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat(rows2()) };
  const m = await openFeature(s, { 'POST /api/requirements/7/helper/messages': (b) => (s.helper = chat([...rows2(), po(3, b.text)], { answering: true })) });
  await openPanel(m);
  const log = m.host.querySelector('.req-help-log');
  const reply = log.querySelector('[data-msg="2"]');
  const alert = reply.querySelector('.req-help-stale');
  const off = () => ['prop-reject-2-1', 'prop-accept-2-1', 'prop-reject-2-2', 'prop-ask-again-2-2'].map((k) => m.host.querySelector(`[data-ui="${k}"]`).disabled);
  assert.deepEqual(off(), [false, false, false, false]);
  const removed = [];
  const watch = new window.MutationObserver((recs) => recs.forEach((r) => removed.push(...r.removedNodes)));
  watch.observe(log, { childList: true });
  type(m.host.querySelector('[data-ui="helper-in"]'), 'C');
  m.host.querySelector('[data-ui="helper-send"]').click();
  await settle();
  assert.deepEqual(off(), [false, true, false, true], 'Accept and Ask again wait while Worca answers');
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'the row stays');
  s.helper = chat([...rows2(), po(3, 'C'), worca(4, 'D')]);
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  assert.deepEqual(off(), [false, false, false, false], 'and come back with the reply');
  s.f = feature({ busy: true, status: 'thinking', state: 'thinking', pending: null, helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  assert.deepEqual(off(), [false, true, false, true], 'a round running');
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  assert.deepEqual(off(), [false, false, false, false]);
  watch.takeRecords().forEach((r) => removed.push(...r.removedNodes));
  watch.disconnect();
  assert.equal(log.querySelector('[data-msg="2"]'), reply, 'the row is never rebuilt');
  assert.equal(reply.querySelector('.req-help-stale'), alert, 'so the stale alert does not fire again');
  assert.ok(!removed.includes(reply), 'never taken out of the live region and put back');
});

test('D18: a focused Reject keeps the focus (the same button) when a reply lands', async () => {
  const rows2 = () => [po(1, 'A'), worca(2, 'B', { proposals: [prop(1, { target: 'criterion', change: 'add', value: 'X.' })] }), po(3, 'C')];
  const s = { f: feature({ helper: { answering: true, messages: 3 } }), helper: chat(rows2(), { answering: true }) };
  const m = await openFeature(s);
  await openPanel(m);
  const rej = m.host.querySelector('[data-ui="prop-reject-2-1"]');
  assert.equal(rej.disabled, false);
  rej.focus();
  s.helper = chat([...rows2(), worca(4, 'D')]);
  s.f = feature({ helper: { answering: false, messages: 4 } });
  await m.view.changed(7);
  await settle();
  assert.equal(document.activeElement, rej, 'the same Reject button, still focused');
  assert.equal(m.host.querySelector('[data-ui="prop-accept-2-1"]').disabled, false);
});

test('board 24 names: Accepted change, Rejected change, Out-of-date change, by the id it got or the section', async () => {
  const m = await openCards();
  const label = (id) => card(m.host, id).getAttribute('aria-label');
  assert.deepEqual(['2-1', '2-2', '2-4', '2-5', '3-1', '3-2'].map(label),
    ['Proposed change: Goal', 'Proposed change: R-po-3', 'Accepted change: R-po-6', 'Rejected change: Edge cases', 'Out-of-date change: Business rules', 'Proposed change: Acceptance criteria']);
});

test('a changed goal measure reads as the spec card does ("Measure: …")', async () => {
  const s = { f: feature({ helper: { answering: false, messages: 2 } }), helper: chat([po(1, 'A'), worca(2, 'B', { proposals: [
    prop(1, { target: 'goal', change: 'set', value: { text: 'G.', measure: 'Under 5 tickets a week.' }, before: { text: 'G.', measure: '' } })] })]) };
  const m = await openFeature(s);
  await openPanel(m);
  assert.deepEqual(rows(card(m.host, '2-1')), ['Before', 'G.', 'After', 'G. Measure: Under 5 tickets a week.']);
  assert.equal(card(m.host, '2-1').querySelector('.req-help-measure').textContent, 'Measure: Under 5 tickets a week.');
});

test("D18: after Accept or Reject the focus moves to the card's new status line; after Ask again to the composer; a refused Accept keeps it", async () => {
  const s = { f: feature({ helper: { answering: false, messages: 3 } }), helper: cardsChat() };
  const decided = (more) => () => {
    s.helper = cardsChat();
    for (const [msg, n, state] of more) s.helper.messages[msg].proposals[n - 1].state = state;
    return s.helper;
  };
  const m = await openFeature(s, {
    'POST /api/requirements/7/helper/messages/2/proposals/1/accept': decided([[1, 1, 'accepted']]),
    'POST /api/requirements/7/helper/messages/2/proposals/2/reject': decided([[1, 1, 'accepted'], [1, 2, 'rejected']]),
    'POST /api/requirements/7/helper/messages/3/proposals/1/ask-again': () => s.helper,
    'POST /api/requirements/7/helper/messages/3/proposals/2/accept': { __status: 409, body: { error: 'The spec changed since Worca proposed this.' } },
  });
  await openPanel(m);
  const ui = () => document.activeElement && document.activeElement.getAttribute('data-ui');
  m.host.querySelector('[data-ui="prop-accept-2-1"]').click();
  await settle();
  assert.equal(ui(), 'prop-state-2-1');
  assert.deepEqual([document.activeElement.getAttribute('tabindex'), document.activeElement.textContent], ['-1', 'Accepted · now in the spec as your edit']);
  m.host.querySelector('[data-ui="prop-reject-2-2"]').click();
  await settle();
  assert.deepEqual([ui(), document.activeElement.textContent], ['prop-state-2-2', 'Rejected']);
  m.host.querySelector('[data-ui="prop-ask-again-3-1"]').click();
  await settle();
  assert.equal(ui(), 'helper-in');
  const acc = m.host.querySelector('[data-ui="prop-accept-3-2"]');
  acc.focus();
  acc.click();
  await settle();
  assert.equal(m.host.querySelector('.req-help-refusal').textContent, 'The spec changed since Worca proposed this.');
  assert.equal(ui(), 'prop-accept-3-2', 'a refusal leaves the focus on Accept');
});

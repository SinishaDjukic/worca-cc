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

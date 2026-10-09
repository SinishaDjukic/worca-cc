// test/alerts.test.mjs — ui/public/alerts.mjs: browser notifications and the waiting badge
// (Settings › General › Alerts). The pure parts (kind table, tag, title prefix, count), the
// notification rules (D5–D8), the badge (title, favicon, app badge) and the Settings card,
// all against a stubbed Notification, document, navigator and storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  KIND_TITLES, kindTitle, questionTag, titleWithCount, badgeCount, readAlertSettings,
  createAlerts, mountAlertsCard, ALERT_KEYS, BLOCKED_HINT, PAUSE_TITLES, pauseTitle, pauseTag,
} from '../ui/public/alerts.mjs';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const tick = () => new Promise((r) => setTimeout(r, 0));

function memStorage(seed = {}) {
  const m = new Map(Object.entries(seed));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, map: m };
}
const throwingStorage = () => ({ getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } });

function fakeNotification({ permission = 'granted', answer = 'granted' } = {}) {
  class N {
    constructor(title, opts = {}) {
      this.title = title; this.body = opts.body; this.tag = opts.tag; this.closed = false; this.onclick = null;
      N.shown.push(this);
    }
    close() { this.closed = true; }
  }
  N.shown = [];
  N.permission = permission;
  N.requests = 0;
  N.requestPermission = () => { N.requests += 1; N.permission = answer; return Promise.resolve(answer); };
  return N;
}

/** A document whose visibility and focus the test sets. */
function fakeDoc({ visible = false, focused = false, html = '<!DOCTYPE html><html><head><title>Worca CC</title><link rel="icon" type="image/png" href="/assets/worca-favicon.png"></head><body></body></html>' } = {}) {
  const dom = new JSDOM(html, { url: 'http://localhost:4317/' });
  const doc = dom.window.document;
  const look = { visible, focused };
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => (look.visible ? 'visible' : 'hidden') });
  doc.hasFocus = () => look.focused;
  return { doc, look, window: dom.window };
}

function setup({ notify = true, badge, permission = 'granted', answer, visible = false, focused = false, nav = {}, storage, html, N } = {}) {
  const store = storage || memStorage({
    [ALERT_KEYS.notify]: notify ? '1' : '0',
    ...(badge === undefined ? {} : { [ALERT_KEYS.badge]: badge ? '1' : '0' }),
  });
  const Notif = N === undefined ? fakeNotification({ permission, answer }) : N;
  const { doc, look, window } = fakeDoc({ visible, focused, html });
  const opened = [];
  const win = { focused: 0, focus() { this.focused += 1; } };
  const drawn = [];
  const alerts = createAlerts({
    Notification: Notif, doc, nav, storage: store, win,
    onOpen: (target) => opened.push(target),
    drawFavicon: (href) => { drawn.push(href); return Promise.resolve('data:image/png;base64,DOT'); },
  });
  return { alerts, N: Notif, doc, look, window, store, opened, win, drawn };
}

const RUN = { runId: 'r1', title: 'Fix the login bug' };
const Q = (id, kind = 'gate', extra = {}) => ({ type: 'question', runId: 'r1', id, kind, ...extra });

// ── pure parts ────────────────────────────────────────────────────────────────

test('kind table: each known kind has its title, an unknown kind falls back to the generic row, every title carries "Worca:"', () => {
  assert.equal(kindTitle('questions'), 'Worca: Questions waiting');
  assert.equal(kindTitle('gate'), 'Worca: Approval needed');
  assert.equal(kindTitle('recovery'), 'Worca: Recovery decision needed');
  assert.equal(kindTitle('workflow'), 'Worca: Workflow proposal to review');
  assert.equal(kindTitle('cost-cap'), 'Worca: Cost cap reached');
  assert.equal(kindTitle('clarify'), 'Worca: Questions waiting', 'clarify asks are also emitted as kind clarify');
  assert.equal(kindTitle('form'), 'Worca: Questions waiting', 'and as kind form');
  assert.equal(kindTitle('brand-new-kind'), 'Worca: Waiting for you');
  assert.equal(kindTitle(undefined), 'Worca: Waiting for you');
  assert.equal(kindTitle('toString'), 'Worca: Waiting for you', 'no prototype leak');
  assert.deepEqual(Object.keys(KIND_TITLES).sort(), ['clarify', 'cost-cap', 'form', 'gate', 'questions', 'recovery', 'workflow']);
});

test('tag format is worca:<runId>:<questionId>', () => {
  assert.equal(questionTag('r1', 'q-7'), 'worca:r1:q-7');
});

test('title prefix: (N) is added, replaced and removed at 0', () => {
  assert.equal(titleWithCount('Worca CC', 2), '(2) Worca CC');
  assert.equal(titleWithCount('(2) Worca CC', 3), '(3) Worca CC');
  assert.equal(titleWithCount('(3) Worca CC', 0), 'Worca CC');
  assert.equal(titleWithCount('Worca CC', 0), 'Worca CC');
});

test('badge count: runs waiting plus unread problems; junk counts as 0', () => {
  assert.equal(badgeCount({ waitingRuns: 2, unreadProblems: 1 }), 3);
  assert.equal(badgeCount({ waitingRuns: 0 }), 0);
  assert.equal(badgeCount({ waitingRuns: -1, unreadProblems: NaN }), 0);
  assert.equal(badgeCount({}), 0);
});

test('settings: off by default; badge follows notifications until set; a throwing storage reads as defaults', () => {
  assert.deepEqual(readAlertSettings(memStorage()), { notify: false, badge: false });
  assert.deepEqual(readAlertSettings(memStorage({ [ALERT_KEYS.notify]: '1' })), { notify: true, badge: true });
  assert.deepEqual(readAlertSettings(memStorage({ [ALERT_KEYS.notify]: '1', [ALERT_KEYS.badge]: '0' })), { notify: true, badge: false });
  assert.deepEqual(readAlertSettings(memStorage({ [ALERT_KEYS.badge]: '1' })), { notify: false, badge: true });
  assert.deepEqual(readAlertSettings(throwingStorage()), { notify: false, badge: false });
});

// ── notification rules ────────────────────────────────────────────────────────

test('D5: no notification while the tab is visible and focused; one when it is hidden', () => {
  const a = setup({ visible: true, focused: true });
  a.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(a.N.shown.length, 0);
  const b = setup({ visible: false });
  b.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(b.N.shown.length, 1);
  assert.equal(b.N.shown[0].title, 'Worca: Approval needed');
  assert.equal(b.N.shown[0].body, 'Fix the login bug');
  assert.equal(b.N.shown[0].tag, 'worca:r1:q1');
  const c = setup({ visible: true, focused: false });
  c.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(c.N.shown.length, 1, 'visible but another window has focus');
});

test('none when the setting is off, permission is not granted, or Notification is missing', () => {
  const off = setup({ notify: false });
  off.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(off.N.shown.length, 0);
  for (const permission of ['default', 'denied']) {
    const p = setup({ permission });
    p.alerts.onQuestion(RUN, Q('q1'));
    assert.equal(p.N.shown.length, 0, permission);
  }
  const none = setup({ N: null });
  assert.doesNotThrow(() => none.alerts.onQuestion(RUN, Q('q1')));
});

test('D7: a backfilled question sets nothing off, and its live replay does not notify either', () => {
  const a = setup();
  a.alerts.onQuestion(RUN, Q('q1'), { backfill: true });
  a.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(a.N.shown.length, 0);
  a.alerts.onQuestion(RUN, Q('q2'));
  assert.equal(a.N.shown.length, 1, 'a NEW question after the backfill still notifies');
});

test('D8: the same runId/questionId twice gives one notification', () => {
  const a = setup();
  a.alerts.onQuestion(RUN, Q('q1'));
  a.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(a.N.shown.length, 1);
});

test('question-resolved closes the matching notification only', () => {
  const a = setup();
  a.alerts.onQuestion(RUN, Q('q1'));
  a.alerts.onQuestion({ runId: 'r2', title: 'Other' }, { id: 'q1', kind: 'questions' });
  a.alerts.onResolved(RUN, { type: 'question-resolved', id: 'q1' });
  assert.equal(a.N.shown[0].closed, true);
  assert.equal(a.N.shown[1].closed, false);
  a.alerts.onQuestion(RUN, Q('q1'));
  assert.equal(a.N.shown.length, 2, 'a replay after the answer does not notify again');
});

test('pause table: a usage limit, an error and a cost cap each have a title; a manual pause or a drain has none', () => {
  assert.equal(pauseTitle('usage_limit'), 'Worca: Usage limit reached');
  assert.equal(pauseTitle('error'), 'Worca: Run paused on an error');
  assert.equal(pauseTitle('recoverable'), 'Worca: Run paused on an error');
  for (const r of ['cost_pipeline', 'cost_total', 'cost_pipeline_policy', 'cost_total_policy']) assert.equal(pauseTitle(r), 'Worca: Cost cap reached', r);
  assert.equal(pauseTitle('night_guardrail'), 'Worca: Night guardrail reached');
  for (const r of [null, undefined, '', 'drain', 'toString']) assert.equal(pauseTitle(r), null, String(r));
  assert.ok(Object.isFrozen(PAUSE_TITLES));
  assert.equal(pauseTag('r1'), 'worca:r1:pause');
});

test('a usage-limit pause notifies with the run title, once, and never while the tab is looked at', () => {
  const a = setup();
  a.alerts.onPaused(RUN, 'usage_limit');
  a.alerts.onPaused(RUN, 'usage_limit');
  assert.equal(a.N.shown.length, 1);
  assert.equal(a.N.shown[0].title, 'Worca: Usage limit reached');
  assert.equal(a.N.shown[0].body, 'Fix the login bug');
  assert.equal(a.N.shown[0].tag, 'worca:r1:pause');
  const b = setup({ visible: true, focused: true });
  b.alerts.onPaused(RUN, 'usage_limit');
  assert.equal(b.N.shown.length, 0);
});

test('a pause with no reason (Pause pressed) or a drain does not notify; a backfilled pause does not either', () => {
  const a = setup();
  a.alerts.onPaused(RUN, null);
  a.alerts.onPaused(RUN, 'drain');
  a.alerts.onPaused({ runId: 'r2', title: 'Other' }, 'error', { backfill: true });
  a.alerts.onPaused({ runId: 'r2', title: 'Other' }, 'error');
  assert.equal(a.N.shown.length, 0);
});

test('a pause notification clicks through to the run and closes when the run is resolved', () => {
  const a = setup();
  a.alerts.onPaused(RUN, 'cost_total');
  a.alerts.onResolved(RUN);
  assert.equal(a.N.shown[0].closed, true);
  a.alerts.onPaused({ runId: 'r2', title: 'Other' }, 'error');
  a.N.shown[1].onclick({ preventDefault() {} });
  assert.deepEqual(a.opened, [{ runId: 'r2' }]);
});

test('D6: the body never carries the question text, answers or code; a run with no title falls back to its id', () => {
  const a = setup();
  a.alerts.onQuestion({ runId: 'r9', title: '' }, {
    id: 'q1', kind: 'questions',
    questions: [{ question: 'SECRET-QUESTION?', options: [{ label: 'SECRET-ANSWER' }] }],
    issues: [{ title: 'SECRET-CODE' }],
  });
  const n = a.N.shown[0];
  assert.equal(n.title, 'Worca: Questions waiting');
  assert.equal(n.body, 'r9');
  assert.doesNotMatch(`${n.title} ${n.body}`, /SECRET/);
});

test('a schedule problem notifies with the row title; an info row does not; it never doubles', () => {
  const a = setup();
  a.alerts.onScheduleNotification({ id: 4, severity: 'info', title: 'Nightly' });
  assert.equal(a.N.shown.length, 0);
  a.alerts.onScheduleNotification({ id: 5, severity: 'problem', title: 'Nightly deps bump', message: 'SECRET detail' });
  a.alerts.onScheduleNotification({ id: 5, severity: 'problem', title: 'Nightly deps bump' });
  assert.equal(a.N.shown.length, 1);
  assert.equal(a.N.shown[0].title, 'Worca: Scheduled run needs attention');
  assert.equal(a.N.shown[0].body, 'Nightly deps bump');
});

test('click: focuses the window, opens the run (or the schedules view) and closes the notification', () => {
  const a = setup();
  a.alerts.onQuestion(RUN, Q('q1'));
  a.N.shown[0].onclick({ preventDefault() {} });
  assert.equal(a.win.focused, 1);
  assert.deepEqual(a.opened, [{ runId: 'r1' }]);
  assert.equal(a.N.shown[0].closed, true);
  a.alerts.onScheduleNotification({ id: 5, severity: 'problem', title: 'Nightly' });
  a.N.shown[1].onclick({ preventDefault() {} });
  assert.deepEqual(a.opened[1], { schedule: true });
});

test('test notification: shown only while notifications are on and granted, with no run', () => {
  const a = setup();
  assert.equal(a.alerts.showTest(), true);
  assert.equal(a.N.shown[0].title, 'Worca: Test');
  a.N.shown[0].onclick({ preventDefault() {} });
  assert.deepEqual(a.opened, [], 'opens no run');
  const b = setup({ permission: 'denied' });
  assert.equal(b.alerts.showTest(), false);
  assert.equal(b.N.shown.length, 0);
  const c = setup({ notify: false });
  assert.equal(c.alerts.showTest(), false);
});

// ── badge ─────────────────────────────────────────────────────────────────────

test('badge: the title shows (2) with two waiting runs and goes back at 0', () => {
  const a = setup({ badge: true });
  a.alerts.updateBadge({ waitingRuns: 2 });
  assert.equal(a.doc.title, '(2) Worca CC');
  a.alerts.updateBadge({ unreadProblems: 1 });
  assert.equal(a.doc.title, '(3) Worca CC');
  a.alerts.updateBadge({ waitingRuns: 0, unreadProblems: 0 });
  assert.equal(a.doc.title, 'Worca CC');
});

test('badge: the favicon is swapped for the dotted one and restored at 0', async () => {
  const a = setup({ badge: true });
  const icon = () => a.doc.querySelector('link[rel~="icon"]').getAttribute('href');
  a.alerts.updateBadge({ waitingRuns: 1 });
  await tick();
  assert.deepEqual(a.drawn, ['/assets/worca-favicon.png'], 'drawn from the original favicon');
  assert.equal(icon(), 'data:image/png;base64,DOT');
  a.alerts.updateBadge({ waitingRuns: 0 });
  assert.equal(icon(), '/assets/worca-favicon.png');
  // a draw that resolves after the count went back to 0 does not swap
  const b = setup({ badge: true });
  b.alerts.updateBadge({ waitingRuns: 1 });
  b.alerts.updateBadge({ waitingRuns: 0 });
  await tick();
  assert.equal(b.doc.querySelector('link[rel~="icon"]').getAttribute('href'), '/assets/worca-favicon.png');
});

test('badge: setAppBadge / clearAppBadge are called only when they exist', () => {
  const calls = [];
  const a = setup({ badge: true, nav: { setAppBadge: (n) => { calls.push(['set', n]); return Promise.resolve(); }, clearAppBadge: () => { calls.push(['clear']); return Promise.reject(new Error('nope')); } } });
  a.alerts.updateBadge({ waitingRuns: 2 });
  a.alerts.updateBadge({ waitingRuns: 0 });
  assert.deepEqual(calls, [['set', 2], ['clear']]);
  const b = setup({ badge: true, nav: {} });
  assert.doesNotThrow(() => { b.alerts.updateBadge({ waitingRuns: 2 }); b.alerts.updateBadge({ waitingRuns: 0 }); });
});

test('badge switch off: no title, favicon or app-badge change; turning it off clears a shown badge', async () => {
  const calls = [];
  const nav = { setAppBadge: (n) => { calls.push(n); } };
  const a = setup({ badge: false, nav });
  a.alerts.updateBadge({ waitingRuns: 2 });
  await tick();
  assert.equal(a.doc.title, 'Worca CC');
  assert.equal(a.doc.querySelector('link[rel~="icon"]').getAttribute('href'), '/assets/worca-favicon.png');
  assert.deepEqual(calls, []);
  assert.deepEqual(a.drawn, []);
  a.alerts.setBadge(true);
  assert.equal(a.doc.title, '(2) Worca CC');
  a.alerts.setBadge(false);
  assert.equal(a.doc.title, 'Worca CC');
  assert.equal(a.store.getItem(ALERT_KEYS.badge), '0');
});

test('badge works with notifications off once the badge switch is on, and needs no permission', () => {
  const a = setup({ notify: false, badge: true, N: null });
  a.alerts.updateBadge({ waitingRuns: 1 });
  assert.equal(a.doc.title, '(1) Worca CC');
});

test('a developer who never turns Alerts on sees no change', async () => {
  const a = setup({ storage: memStorage() });
  a.alerts.onQuestion(RUN, Q('q1'));
  a.alerts.updateBadge({ waitingRuns: 3, unreadProblems: 1 });
  await tick();
  assert.equal(a.N.shown.length, 0);
  assert.equal(a.doc.title, 'Worca CC');
  assert.deepEqual(a.drawn, []);
});

test('a throwing storage never breaks notifications or the badge', () => {
  const a = setup({ storage: throwingStorage() });
  assert.doesNotThrow(() => {
    a.alerts.onQuestion(RUN, Q('q1'));
    a.alerts.updateBadge({ waitingRuns: 1 });
    a.alerts.setNotify(true);
    a.alerts.setBadge(true);
  });
});

// ── Settings card ─────────────────────────────────────────────────────────────

const SHELL = readFileSync(htmlPath, 'utf8');
function card(opts = {}) {
  const ctx = setup({ html: SHELL, ...opts });
  const $ = (sel) => ctx.doc.querySelector(sel);
  const ctl = mountAlertsCard({ doc: ctx.doc, alerts: ctx.alerts });
  const flip = async (sel) => { const box = $(sel); box.checked = !box.checked; box.dispatchEvent(new ctx.window.Event('change', { bubbles: true })); await tick(); await tick(); };
  return { ...ctx, $, ctl, flip };
}

test('card markup: after Appearance in General, every level, two switches, a test button and the info tip', () => {
  const { $ } = card({ notify: false, permission: 'default' });
  const c = $('#alerts-card');
  assert.ok(c, 'the card exists');
  assert.equal(c.dataset.minLevel, 'simple');
  assert.equal($('#appearance-card').nextElementSibling, c, 'right after Appearance');
  assert.ok(c.closest('.settings-pane[data-tab="general"]'));
  assert.equal(c.querySelector('h2').textContent, 'Alerts');
  assert.equal($('#alertsNotify').type, 'checkbox');
  assert.equal($('#alertsBadge').type, 'checkbox');
  assert.equal($('#alertsTest').textContent.trim(), 'Send test notification');
  const tip = c.querySelector('.info-tip .tip-content').textContent;
  assert.match(tip, /tab is open/);
  assert.match(tip, /System Settings › Notifications/);
  assert.match(tip, /bounce/);
});

test('card: the switch requests permission on click, not on load; granted keeps it on', async () => {
  const { $, N, flip, store } = card({ notify: false, permission: 'default', answer: 'granted' });
  assert.equal(N.requests, 0, 'nothing asked on load');
  assert.equal($('#alertsNotify').checked, false, 'off by default');
  assert.equal($('#alertsTest').disabled, true);
  await flip('#alertsNotify');
  assert.equal(N.requests, 1);
  assert.equal($('#alertsNotify').checked, true);
  assert.equal(store.getItem(ALERT_KEYS.notify), '1');
  assert.equal($('#alertsTest').disabled, false);
  assert.equal($('#alertsNotifyHint').hidden, true);
});

test('card: denied permission turns the switch back off with the hint', async () => {
  const { $, flip, store } = card({ notify: false, permission: 'default', answer: 'denied' });
  await flip('#alertsNotify');
  assert.equal($('#alertsNotify').checked, false);
  assert.equal(store.getItem(ALERT_KEYS.notify), '0');
  assert.equal($('#alertsNotifyHint').hidden, false);
  assert.equal($('#alertsNotifyHint').textContent, BLOCKED_HINT);
  assert.equal(BLOCKED_HINT, 'Notifications are blocked for this site in your browser settings.');
  assert.equal($('#alertsTest').disabled, true);
});

test('card: unsupported (no Notification, or not a secure context) disables the switch with a hint saying why', async () => {
  const a = card({ N: null });
  assert.equal(a.$('#alertsNotify').disabled, true);
  assert.equal(a.$('#alertsNotify').checked, false);
  assert.match(a.$('#alertsNotifyHint').textContent, /doesn't support/);
  assert.equal(a.$('#alertsNotifyHint').hidden, false);
  // insecure: an http://<LAN IP> address
  const ctx = setup({ html: SHELL });
  const insecure = createAlerts({ Notification: ctx.N, doc: ctx.doc, nav: {}, storage: memStorage(), win: { isSecureContext: false, focus() {} } });
  mountAlertsCard({ doc: ctx.doc, alerts: insecure });
  assert.equal(ctx.doc.querySelector('#alertsNotify').disabled, true);
  assert.match(ctx.doc.querySelector('#alertsNotifyHint').textContent, /https:\/\/ or localhost/);
});

test('card: the test button shows a notification only when granted', async () => {
  const a = card({ notify: true, permission: 'granted' });
  assert.equal(a.$('#alertsTest').disabled, false);
  a.$('#alertsTest').click();
  assert.equal(a.N.shown.length, 1);
  assert.equal(a.N.shown[0].title, 'Worca: Test');
  const b = card({ notify: true, permission: 'denied' });
  assert.equal(b.$('#alertsTest').disabled, true);
  b.$('#alertsTest').click();
  assert.equal(b.N.shown.length, 0);
});

test('card: values persist across reloads; the badge switch defaults on once notifications are on', async () => {
  const store = memStorage();
  const first = card({ storage: store, permission: 'default', answer: 'granted' });
  assert.equal(first.$('#alertsBadge').checked, false);
  await first.flip('#alertsNotify');
  assert.equal(first.$('#alertsBadge').checked, true, 'on by default once Alerts is on');
  await first.flip('#alertsBadge');
  assert.equal(store.getItem(ALERT_KEYS.badge), '0');
  const second = card({ storage: store, permission: 'granted' });
  assert.equal(second.$('#alertsNotify').checked, true);
  assert.equal(second.$('#alertsBadge').checked, false);
});

test('card: a throwing localStorage does not break the card', async () => {
  const a = card({ storage: throwingStorage(), permission: 'default', answer: 'granted' });
  assert.equal(a.$('#alertsNotify').checked, false);
  await assert.doesNotReject(() => a.flip('#alertsNotify'));
  await assert.doesNotReject(() => a.flip('#alertsBadge'));
});

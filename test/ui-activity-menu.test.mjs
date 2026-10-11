// test/ui-activity-menu.test.mjs — the top bar's Activity button and popover (ui/public/activity-menu.mjs):
// the one badge, the tabs and their numbers, rows that are links (no actions), where a row and the
// footer go, when the schedules are fetched, and the keyboard (tabs on the arrows, Escape, outside click).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createActivityMenu } from '../ui/public/activity-menu.mjs';
import { activityCounts } from '../ui/public/activity-model.mjs';
import { createFlyout } from '../ui/public/side-flyout.mjs';

const NOW = Date.UTC(2026, 9, 8, 14, 15);            // Thu Oct 8 2026, 14:15 UTC
const utc = (d, h, m) => new Date(Date.UTC(2026, 9, d, h, m)).toISOString();
const liveIt = (runId, extra = {}) => ({
  runId, pipelineId: '', title: runId, status: 'running', ask: null, pauseReason: '', unread: false, step: '',
  failedStep: '', startedAt: utc(8, 12, 0), groupKey: 'emp', groupName: 'Employee project', by: '', pr: null,
  checks: null, files: null, ...extra,
});
const ask1 = liveIt('ask1', { ask: { kind: 'gate', step: 'Review' } });
const RUNNING = [liveIt('run1'), liveIt('run2'), liveIt('start1', { status: 'starting' })];
const RUNS = {
  live: [ask1, liveIt('paused1', { status: 'paused' }), liveIt('fail1', { status: 'error', unread: true }), ...RUNNING],
  history: [{ id: 'p9', projectKey: 'worca-2', title: 'p9', status: 'paused', startedAt: utc(7, 8, 0), groupName: 'worca-cc' }],
  active: [ask1, ...RUNNING],
};
const ONLY_RUNNING = { live: RUNNING, history: [], active: RUNNING };
const SCHED = {
  tickets: [
    { id: 'once1', scheduleId: null, title: 'Upgrade', status: 'scheduled', runAt: utc(8, 22, 0), projectKey: 'svc' },
    { id: 'miss1', scheduleId: null, title: 'Docs', status: 'missed', runAt: utc(7, 9, 0), projectKey: 'svc' },
  ],
  schedules: [{ id: 'nightly', title: 'Nightly', status: 'active', nextRunAt: utc(9, 2, 0), sentence: 'Every day at 02:00', projectKey: 'billing' }],
};
const PAGE = `<!doctype html><body>
  <header><button type="button" id="topnav-activity" class="topnav-act" aria-haspopup="dialog" aria-expanded="false"><span class="topnav-act-label">Activity</span><span id="topnav-activity-n" class="topnav-badge" hidden></span></button></header>
  <div id="activity-pop" class="activity-pop" role="dialog" aria-label="Activity" hidden></div>
  <button type="button" id="out">Elsewhere</button></body>`;

function setup({ runs = RUNS, sched = SCHED } = {}) {
  const { window } = new JSDOM(PAGE);
  const doc = window.document;
  const $ = (id) => doc.getElementById(id);
  const st = { runs, sched, fetches: 0, pending: [], hashes: [] };
  const menu = createActivityMenu({
    doc, win: window, button: $('topnav-activity'), badge: $('topnav-activity-n'), pop: $('activity-pop'),
    getCounts: () => activityCounts(st.runs), getRuns: () => st.runs,
    loadSchedules: () => { st.fetches += 1; return new Promise((resolve) => st.pending.push(resolve)); },
    tz: 'UTC', now: () => NOW, navigate: (h) => st.hashes.push(h),
  });
  const click = (el, init = {}) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, detail: 1, ...init }));
  const key = (el, k) => el.dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  /** Answer every pending GET /api/schedules with st.sched, then let the promises settle. */
  const land = async () => { for (const r of st.pending.splice(0)) r(st.sched); await new Promise((r) => setTimeout(r, 0)); };
  const btn = $('topnav-activity');
  const pop = $('activity-pop');
  const tab = (id) => $(`activity-tab-${id}`);
  const tabN = (id) => tab(id).querySelector('.activity-tab-n')?.textContent ?? '';
  const rows = () => [...pop.querySelectorAll('.activity-panel .activity-row')];
  const row = (k) => rows().find((r) => r.dataset.key === k);
  return { window, doc, $, st, menu, click, key, land, btn, pop, tab, tabN, rows, row };
}

test('badge: the Needs you number in amber, else the running number, else hidden; the tooltip names both', () => {
  const t = setup();
  const badge = t.$('topnav-activity-n');
  t.menu.refresh();
  assert.deepEqual([badge.textContent, badge.dataset.tone, badge.hidden, t.btn.title], ['4', 'need', false, '4 need you · 3 running']);
  t.st.runs = ONLY_RUNNING;
  t.menu.refresh();
  assert.deepEqual([badge.textContent, badge.dataset.tone, badge.hidden, t.btn.title], ['3', 'run', false, '0 need you · 3 running']);
  t.st.runs = { live: [], history: [], active: [] };
  t.menu.refresh();
  assert.equal(badge.hidden, true);
  assert.equal(badge.dataset.tone, undefined);
  assert.equal(t.btn.hasAttribute('title'), false);
});

test('opens on the first tab with rows; each tab\'s number is the rows it lists; Scheduled has no number until its rows load', async () => {
  const t = setup();
  t.menu.refresh();
  t.click(t.btn);
  assert.equal(t.btn.getAttribute('aria-expanded'), 'true');
  assert.equal(t.pop.hidden, false);
  assert.equal(t.tab('needs').getAttribute('aria-selected'), 'true');
  assert.deepEqual(['needs', 'running', 'scheduled'].map(t.tabN), ['4', '3', ''], 'Scheduled is not loaded yet');
  assert.equal(t.rows().length, 4);
  t.click(t.tab('running'));
  assert.equal(t.rows().length, 3);
  assert.deepEqual(t.rows().map((r) => r.querySelector('.activity-row-sub').textContent),
    ['Employee project · Running', 'Employee project · Running', 'Employee project · Starting']);
  t.click(t.tab('scheduled'));
  assert.equal(t.$('activity-panel').getAttribute('aria-busy'), 'true');
  assert.equal(t.rows().length, 0);
  assert.equal(t.pop.querySelector('.activity-empty'), null, 'no "Nothing scheduled" before it is known');
  await t.land();
  assert.equal(t.tabN('scheduled'), '3');
  assert.equal(t.rows().length, 3);
  assert.deepEqual([...t.pop.querySelectorAll('.activity-glabel')].map((g) => g.textContent), ['Missed', 'Today', 'Tomorrow']);
  assert.deepEqual(t.rows().map((r) => r.querySelector('.activity-row-time').textContent), ['Wed 09:00', 'Thu 22:00', 'Fri 02:00']);
  t.click(t.btn);
  assert.equal(t.btn.getAttribute('aria-expanded'), 'false');
  assert.equal(t.pop.hidden, true);

  const idle = setup({ runs: { live: [], history: [], active: [liveIt('scan1', { title: 'Scan workspace' })] } });
  idle.click(idle.btn);
  assert.equal(idle.menu.tab, 'running');
  const quiet = setup({ runs: { live: [], history: [], active: [] } });
  quiet.click(quiet.btn);
  assert.equal(quiet.menu.tab, 'needs');
  assert.equal(quiet.pop.querySelector('.activity-empty').textContent, 'Nothing needs you');
  await quiet.land();
  assert.equal(quiet.menu.tab, 'scheduled', 'the schedules landed with rows: the first tab with rows');
  quiet.st.sched = { tickets: [], schedules: [] };
  quiet.click(quiet.btn);
  quiet.click(quiet.btn);
  quiet.menu.schedulesChanged();
  await quiet.land();
  assert.equal(quiet.menu.tab, 'needs', 'nothing anywhere: Needs you');
  quiet.click(quiet.tab('scheduled'));
  assert.equal(quiet.pop.querySelector('.activity-empty').textContent, 'Nothing scheduled');
  quiet.click(quiet.tab('running'));
  assert.equal(quiet.pop.querySelector('.activity-empty').textContent, 'Nothing running');
});

test('rows are links with no buttons; a click or Enter opens the run or the Schedules tab and closes the popover', async () => {
  const t = setup();
  t.click(t.btn);
  await t.land();
  for (const id of ['needs', 'running', 'scheduled']) {
    t.click(t.tab(id));
    assert.ok(t.rows().length > 0);
    assert.ok(t.rows().every((r) => r.tagName === 'A' && r.getAttribute('href')), id);
    assert.equal(t.pop.querySelectorAll('.activity-panel button, .activity-row button').length, 0, `${id}: no action in a row`);
  }
  const go = (tabId, k, init) => {
    if (t.pop.hidden) t.click(t.btn);
    t.click(t.tab(tabId));
    const r = t.row(k);
    r.focus();
    t.click(r, init);
    return t.st.hashes.at(-1);
  };
  assert.equal(go('needs', 'live:ask1'), '#running/ask1');
  assert.equal(t.pop.hidden, true);
  assert.notEqual(t.doc.activeElement, t.btn, 'a pointer close lets go of focus');
  assert.equal(go('needs', 'hist:worca-2/p9', { detail: 0 }), '#history/worca-2/p9');
  assert.equal(t.pop.hidden, true);
  assert.equal(t.doc.activeElement, t.btn, 'Enter (a keyboard click) hands focus back to the button');
  await t.land();
  assert.equal(go('scheduled', 'ticket:once1'), '#schedules/once');
  assert.equal(go('scheduled', 'series:nightly'), '#schedules/repeating');
  assert.equal(go('running', 'live:run2'), '#running/run2');
  t.click(t.btn);
  t.click(t.pop.querySelector('.activity-foot-link'));
  assert.deepEqual([t.st.hashes.at(-1), t.pop.hidden], ['#schedules', true]);
  t.click(t.btn);
  const plan = t.pop.querySelector('.activity-foot-new');
  assert.deepEqual([plan.tagName, plan.textContent], ['BUTTON', 'Schedule…']);
  t.click(plan);
  assert.deepEqual([t.st.hashes.at(-1), t.pop.hidden], ['#new/schedule', true]);
  t.click(t.btn);
  const n = t.st.hashes.length;
  t.click(t.row('live:ask1'), { ctrlKey: true });
  assert.deepEqual([t.st.hashes.length, t.pop.hidden], [n, false], 'a modified click is the browser\'s (a new tab)');
});

test('the schedules are fetched on open and refetched on schedules-changed only while open', async () => {
  const t = setup();
  t.menu.schedulesChanged();
  assert.equal(t.st.fetches, 0, 'closed: no fetch');
  t.click(t.btn);
  assert.equal(t.st.fetches, 1, 'opening fetches');
  await t.land();
  t.st.sched = { tickets: [], schedules: [SCHED.schedules[0]] };
  t.menu.schedulesChanged();
  assert.equal(t.st.fetches, 2, 'open: refetched');
  await t.land();
  assert.equal(t.tabN('scheduled'), '1');
  t.click(t.btn);
  t.click(t.btn);
  assert.equal(t.tabN('scheduled'), '1', 'reopened unchanged: the last rows and their number at once');
  await t.land();
  t.click(t.btn);
  t.menu.schedulesChanged();
  t.menu.schedulesChanged();
  assert.equal(t.st.fetches, 3, 'closed: still no fetch');
  t.click(t.btn);
  assert.equal(t.tabN('scheduled'), '', 'changed while closed: no number until it loads again');
  assert.equal(t.st.fetches, 4);
  await t.land();
  assert.equal(t.tabN('scheduled'), '1');
});

test('keyboard: the arrows switch tabs (wrapping, Home/End) with a roving tabindex; Escape closes and focus returns to the button; an outside click closes', async () => {
  const t = setup();
  t.btn.focus();
  t.click(t.btn, { detail: 0 });
  assert.equal(t.doc.activeElement, t.tab('needs'), 'a keyboard open lands on the open tab');
  assert.deepEqual([...t.pop.querySelectorAll('[role="tab"]')].map((b) => b.dataset.minLevel), ['simple', 'simple', 'simple'],
    'every tab carries its level, as the top bar\'s own buttons do');
  const step = (k) => { t.key(t.doc.activeElement, k); return t.doc.activeElement.dataset.tab; };
  assert.equal(step('ArrowRight'), 'running');
  assert.deepEqual(['needs', 'running', 'scheduled'].map((id) => [t.tab(id).getAttribute('aria-selected'), t.tab(id).tabIndex]),
    [['false', -1], ['true', 0], ['false', -1]]);
  assert.equal(t.$('activity-panel').getAttribute('aria-labelledby'), 'activity-tab-running');
  assert.equal(t.rows().length, 3);
  assert.equal(step('ArrowRight'), 'scheduled');
  assert.equal(step('ArrowRight'), 'needs', 'wraps');
  assert.equal(step('ArrowLeft'), 'scheduled');
  assert.equal(step('Home'), 'needs');
  assert.equal(step('End'), 'scheduled');
  t.key(t.doc.activeElement, 'Escape');
  assert.equal(t.pop.hidden, true);
  assert.equal(t.btn.getAttribute('aria-expanded'), 'false');
  assert.equal(t.doc.activeElement, t.btn);
  t.click(t.btn);
  assert.equal(t.pop.hidden, false);
  t.click(t.$('out'));
  assert.equal(t.pop.hidden, true);
  assert.equal(t.btn.getAttribute('aria-expanded'), 'false');
});

test('while open, a refresh repaints in place: the tab stays, a focused row keeps focus, an unchanged list is not rebuilt', () => {
  const t = setup();
  t.click(t.btn);
  t.row('live:fail1').focus();
  const before = t.row('live:ask1');
  t.menu.refresh();
  assert.equal(t.row('live:ask1'), before, 'nothing changed: the same nodes');
  const ask2 = liveIt('ask2', { ask: { kind: 'questions', step: '' } });
  t.st.runs = { ...RUNS, live: [ask2, ...RUNS.live], active: [ask2, ...RUNS.active] };
  t.menu.refresh();
  assert.equal(t.tabN('needs'), '5');
  assert.equal(t.rows().length, 5);
  assert.equal(t.doc.activeElement.dataset.key, 'live:fail1');
  t.st.runs = ONLY_RUNNING;
  t.menu.refresh();
  assert.equal(t.menu.tab, 'needs', 'no jump to another tab under the pointer');
  assert.equal(t.pop.querySelector('.activity-empty').textContent, 'Nothing needs you');
  assert.equal(t.doc.activeElement, t.tab('needs'), 'the focused row is gone: its tab takes focus');
});

test('the schedules fail to load (not OK, or offline): Scheduled shows no number and no rows, never a list from an earlier open', async () => {
  const t = setup({ runs: { live: [], history: [], active: [] }, sched: null });   // null: app.js loadSchedules on a non-OK answer
  t.click(t.btn);
  await t.land();
  t.click(t.tab('scheduled'));
  assert.deepEqual([t.tabN('scheduled'), t.rows().length], ['', 0], 'the first load failed');
  assert.deepEqual([t.$('activity-panel').getAttribute('aria-busy'), t.pop.querySelector('.activity-empty')?.textContent],
    ['false', 'Nothing scheduled'], 'settled: not busy with nothing pending');
  t.st.sched = SCHED;
  t.menu.schedulesChanged();
  await t.land();
  assert.deepEqual([t.tabN('scheduled'), t.rows().length], ['3', 3]);
  t.click(t.btn);
  t.menu.schedulesChanged();
  t.st.sched = null;
  t.click(t.btn);
  await t.land();
  t.click(t.tab('scheduled'));
  assert.deepEqual([t.tabN('scheduled'), t.rows().length], ['', 0], 'changed while closed, then the refetch failed: not the earlier rows');
  assert.equal(t.$('activity-panel').getAttribute('aria-busy'), 'false');
  // Kept across a close (no schedules-changed seen, e.g. a frame missed during a reconnect): the reopen shows the
  // last rows at once, and a failed refetch drops them rather than leaving a list it could not confirm.
  t.st.sched = SCHED;
  t.menu.schedulesChanged();
  await t.land();
  assert.equal(t.rows().length, 3);
  t.click(t.btn);
  t.st.sched = null;
  t.click(t.btn);
  assert.deepEqual([t.tabN('scheduled'), t.rows().length], ['3', 3], 'reopened: the last rows at once');
  await t.land();
  assert.deepEqual([t.tabN('scheduled'), t.rows().length, t.pop.querySelector('.activity-empty')?.textContent], ['', 0, 'Nothing scheduled'],
    'the refetch on open failed: the kept rows go');
  assert.equal(t.menu.tab, 'scheduled', 'and the open tab stays');
  t.click(t.btn);
  t.st.sched = SCHED;
  t.click(t.btn);
  t.click(t.tab('scheduled'));
  assert.deepEqual([t.$('activity-panel').getAttribute('aria-busy'), t.pop.querySelector('.activity-empty')], ['true', null],
    'reopened after a failure: loading again, not the last failure\'s empty text');
  await t.land();
  assert.deepEqual([t.tabN('scheduled'), t.rows().length], ['3', 3]);

  const { window } = new JSDOM(PAGE);
  const doc = window.document;
  const offline = createActivityMenu({
    doc, win: window, button: doc.getElementById('topnav-activity'), badge: doc.getElementById('topnav-activity-n'),
    pop: doc.getElementById('activity-pop'), getCounts: () => ({ needs: 0, running: 0 }), getRuns: () => ({}),
    loadSchedules: () => Promise.reject(new Error('offline')), tz: 'UTC', now: () => NOW, navigate: () => {},
  });
  offline.open();
  await new Promise((r) => setTimeout(r, 0));
  doc.getElementById('activity-tab-scheduled').click();
  assert.equal(doc.querySelector('#activity-tab-scheduled .activity-tab-n'), null);
  assert.equal(doc.querySelectorAll('.activity-panel .activity-row').length, 0);
  assert.equal(doc.getElementById('activity-panel').getAttribute('aria-busy'), 'false');
});

test('a keyboard open with nothing needing you or running: when the schedules land and pick Scheduled, focus moves with the selection', async () => {
  const t = setup({ runs: { live: [], history: [], active: [] } });
  t.btn.focus();
  t.click(t.btn, { detail: 0 });
  assert.equal(t.doc.activeElement, t.tab('needs'), 'nothing loaded yet: Needs you');
  await t.land();
  assert.equal(t.menu.tab, 'scheduled');
  assert.equal(t.doc.activeElement, t.tab('scheduled'), 'focus is on the selected tab, not on a tab with tabIndex -1');
  t.key(t.doc.activeElement, 'ArrowRight');
  assert.deepEqual([t.menu.tab, t.doc.activeElement.dataset.tab], ['needs', 'needs'], 'the arrows start from the focused tab');
  const mouse = setup({ runs: { live: [], history: [], active: [] } });
  mouse.click(mouse.btn);
  mouse.$('out').focus();
  await mouse.land();
  assert.equal(mouse.menu.tab, 'scheduled');
  assert.notEqual(mouse.doc.activeElement, mouse.tab('scheduled'), 'focus outside the tabs is left alone');
});

test('one popup at a time: Activity and a sidebar popup on the same page close each other; Escape closes the open one only', () => {
  const t = setup();
  const acct = t.doc.createElement('button');
  acct.type = 'button';
  const acctMenu = t.doc.createElement('div');
  acctMenu.hidden = true;
  const item = t.doc.createElement('button');
  item.type = 'button';
  item.setAttribute('role', 'menuitem');
  acctMenu.append(item);
  t.doc.body.append(acct, acctMenu);
  const acctFly = createFlyout({ doc: t.doc, win: t.window, trigger: acct, menu: acctMenu, mode: 'up' });
  acctFly.open();
  t.menu.open();
  assert.deepEqual([acctMenu.hidden, acct.getAttribute('aria-expanded'), t.pop.hidden], [true, 'false', false], 'opening Activity closes the account menu');
  acctFly.open();
  assert.deepEqual([t.pop.hidden, t.btn.getAttribute('aria-expanded'), acctMenu.hidden], [true, 'false', false], 'and the other way round');
  t.menu.open();
  t.tab('needs').focus();
  t.key(t.tab('needs'), 'Escape');
  assert.deepEqual([t.pop.hidden, acctMenu.hidden, t.doc.activeElement], [true, true, t.btn]);
  const again = new t.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  t.btn.dispatchEvent(again);
  assert.equal(again.defaultPrevented, false, 'nothing open: the next Escape is the page\'s');
});

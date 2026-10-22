// test/ui-limit-reset.test.mjs — the usage-limit pause notice in the UI: the run page's Overview
// banner (states A–D), the "Resume at" button and its split-menu item, Cancel, the History
// detail's notice, the minute countdown tick, the Runs-list row note and the Settings checkbox.
// Harness: jsdom boot of the REAL index.html + app.js, as in test/ui-resume-at.test.mjs (the
// data-level injection, the URL-armed fetch router, the dispatchable WebSocket stub); the History
// case boots through test/helpers/history-detail-boot.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import { bootDetail, openDetail, settle as hSettle, ROW as H_ROW, DETAIL as H_DETAIL } from './helpers/history-detail-boot.mjs';

const trackDom = useDomRelease(afterEach);

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECT = '/tmp/proj-limit-reset';

const live = [];
afterEach(() => { while (live.length) { try { live.pop().close(); } catch {} } });

const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const MIN = 60_000;
const DETAIL_TEXT = 'Claude hit its session limit';

/** Mutable server state the fetch router reads. */
function makeServer() {
  return { tickets: [], settings: { resumeAfterUsageLimit: false }, resumeStatus: 200, posts: [], deletes: [] };
}

async function boot({ level, server = makeServer() } = {}) {
  let html = readFileSync(htmlPath, 'utf8');
  if (level) html = html.replace('<html lang="en" data-theme="system">', `<html lang="en" data-theme="system" data-level="${level}">`);
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost:4317/' }));
  live.push(dom);
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  const sockets = [];
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._listeners = {}; sockets.push(this); }
    send() {} close() {}
    addEventListener(t, fn) { (this._listeners[t] ||= []).push(fn); }
    dispatch(type, evt) { for (const fn of this._listeners[type] || []) fn(evt); }
  };
  const fetchCalls = [];
  const json = (body, status = 200) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
  window.fetch = (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || 'GET').toUpperCase();
    fetchCalls.push({ url: u, opts });
    if (u.includes('/api/schedules/resume')) {
      const body = JSON.parse(opts.body);
      server.posts.push(body);
      if (server.resumeStatus !== 200 && server.resumeStatus !== 202) return json({ error: 'boom' }, server.resumeStatus);
      return json({ runId: 'ticket-1', status: 'scheduled', scheduledFor: body.scheduledFor, resumePipelineId: body.pipelineId }, 202);
    }
    if (u.includes('/api/schedules/') && method === 'DELETE') {
      server.deletes.push(u);
      return json({ ok: true });
    }
    if (u.includes('/api/schedules')) {
      return json({ schedules: [], tickets: server.tickets, counts: {}, defaults: { ifMissed: 'run', graceMin: 360, maxFailures: 3 } });
    }
    if (u.includes('/api/settings') && method === 'POST') {
      server.posts.push({ settings: JSON.parse(opts.body) });
      return json({ ...server.settings, ...JSON.parse(opts.body) });
    }
    if (u.includes('/api/settings')) return json(server.settings);
    if (u.includes('/api/resume')) return json({ ok: true, runId: 'r-new', pipelineId: 'pl_1' });
    if (u.includes('/api/projects')) return json({ projects: [{ name: 'proj', path: PROJECT, exists: true }] });
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const recv = (msg) => { for (const s of sockets) s.dispatch('message', { data: JSON.stringify(msg) }); };
  const settle = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
  const go = (hash) => { window.location.hash = hash; window.dispatchEvent(new window.Event('hashchange')); };
  return { window, doc: window.document, recv, settle, go, fetchCalls, server };
}

/** A usage-limit-paused run is open on its run page. */
async function pausedCard(ctx, { limitResetAt, reason = 'usage_limit', detail = DETAIL_TEXT } = {}) {
  const { doc, recv, settle, go } = ctx;
  go('runs');
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }] });
  await settle();
  go('running/r1');
  await settle(8);
  recv({ type: 'done', runId: 'r1', status: 'paused', reason, detail, limitEngine: 'claude', ...(limitResetAt ? { limitResetAt } : {}) });
  await settle(8);
  const page = doc.querySelector('#run-detail');
  assert.ok(page, 'the run page is open');
  return page;
}

const copyOf = (page) => page.querySelector('.rd-ov-state .rd-ov-copy');
const iso = (ms) => new Date(ms).toISOString();
const ticket = (over = {}) => ({ id: 'ticket-9', runAt: iso(Date.now() + 3 * 60 * MIN), status: 'scheduled', resumePipelineId: 'pl_1', scheduleId: null, ...over });

test('A: no limitResetAt keeps today\'s text and offers no Resume-at button', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, {});
  assert.match(copyOf(page).textContent, /usage limit reached/);
  assert.equal(page.querySelector('.limit-resume'), null);
});

test('B: names the reset time with a countdown; the button posts the +5m ticket and the notice moves to C without navigating', async () => {
  const ctx = await boot({ level: 'simple' });
  const reset = Date.now() + 2 * 60 * MIN + 30_000;
  const page = await pausedCard(ctx, { limitResetAt: iso(reset) });
  const copy = copyOf(page);
  assert.match(copy.textContent, /It resets at/);
  assert.match(copy.textContent, /in 2h/);
  assert.equal(copy.querySelector('time').textContent, hhmm(reset));
  const btn = page.querySelector('.rd-ov-state .limit-resume');
  assert.ok(btn, 'the Resume-at button shows');
  assert.equal(btn.textContent, `Resume at ${hhmm(reset + 5 * MIN)}`);
  const hashBefore = ctx.window.location.hash;
  btn.click();
  await ctx.settle(8);
  assert.equal(ctx.server.posts.length, 1);
  const body = ctx.server.posts[0];
  assert.deepEqual(Object.keys(body).sort(), ['afterUsageLimit', 'graceMin', 'ifMissed', 'pipelineId', 'scheduledFor']);
  assert.equal(body.pipelineId, 'pl_1');
  assert.equal(body.ifMissed, 'run');
  assert.equal(body.graceMin, 360);
  assert.equal(body.scheduledFor, iso(reset + 5 * MIN));
  assert.equal(ctx.window.location.hash, hashBefore, 'no navigation');
  assert.match(copyOf(page).textContent, /Resumes automatically at/);
  assert.ok(page.querySelector('.rd-ov-state .limit-cancel'), 'Cancel replaces the button');
  assert.equal(page.querySelector('.rd-ov-state .limit-resume'), null);
});

test('B, failed post: a 500 leaves B and toasts "Could not schedule the resume"', async () => {
  const server = makeServer();
  server.resumeStatus = 500;
  const ctx = await boot({ level: 'simple', server });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  page.querySelector('.rd-ov-state .limit-resume').click();
  await ctx.settle(8);
  assert.match(copyOf(page).textContent, /It resets at/);
  const btn = page.querySelector('.rd-ov-state .limit-resume');
  assert.ok(btn && !btn.disabled, 'the button is back for a retry');
  assert.match(ctx.doc.querySelector('.toasts').textContent, /Could not schedule the resume/);
});

test('C: a schedules-changed frame moves an open page B→C; Cancel deletes the ticket and returns to B', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  assert.match(copyOf(page).textContent, /It resets at/);
  ctx.server.tickets = [ticket()];
  ctx.recv({ type: 'schedules-changed' });
  await ctx.settle(10);
  assert.match(copyOf(page).textContent, /Resumes automatically at/);
  const cancel = page.querySelector('.rd-ov-state .limit-cancel');
  assert.ok(cancel);
  ctx.server.tickets = [];
  cancel.click();
  await ctx.settle(8);
  assert.equal(ctx.server.deletes.length, 1);
  assert.match(ctx.server.deletes[0], /\/api\/schedules\/ticket-9$/);
  assert.match(copyOf(page).textContent, /It resets at/);
  assert.ok(page.querySelector('.rd-ov-state .limit-resume'));
});

/** Browsers blur a focused button the moment it becomes disabled; jsdom does not. Mimic the browser. */
function blurOnDisable(btn) {
  const proto = Object.getPrototypeOf(btn);
  const desc = Object.getOwnPropertyDescriptor(proto, 'disabled') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'disabled');
  Object.defineProperty(btn, 'disabled', {
    configurable: true,
    get() { return desc.get.call(this); },
    set(v) { desc.set.call(this, v); if (v) this.blur(); },
  });
}

test('keyboard: focus moves Resume at → Cancel → Resume at instead of falling to <body>', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  const btn = page.querySelector('.rd-ov-state .limit-resume');
  blurOnDisable(btn);
  btn.focus();
  assert.equal(ctx.doc.activeElement, btn);
  btn.click();
  await ctx.settle(8);
  const cancel = page.querySelector('.rd-ov-state .limit-cancel');
  assert.ok(cancel);
  assert.equal(ctx.doc.activeElement, cancel, 'Cancel took the focus');
  ctx.server.tickets = [];
  blurOnDisable(cancel);
  cancel.focus();
  cancel.click();
  await ctx.settle(8);
  const again = page.querySelector('.rd-ov-state .limit-resume');
  assert.ok(again);
  assert.equal(ctx.doc.activeElement, again, 'Resume at took the focus back');
});

test('keyboard: a later repaint (the schedules-changed frame after the request) keeps focus on the notice button', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  const btn = page.querySelector('.rd-ov-state .limit-resume');
  blurOnDisable(btn);
  btn.focus();
  ctx.server.tickets = [ticket()];
  btn.click();
  await ctx.settle(8);
  const cancel = page.querySelector('.rd-ov-state .limit-cancel');
  assert.equal(ctx.doc.activeElement, cancel);
  // The server's broadcast arrives after the POST resolved: schedulesView reloads and the notice repaints.
  ctx.recv({ type: 'schedules-changed' });
  await ctx.settle(10);
  const rebuilt = page.querySelector('.rd-ov-state .limit-cancel');
  assert.ok(rebuilt);
  assert.equal(ctx.doc.activeElement, rebuilt, 'the repaint did not drop focus to <body>');
});

test('B′: a reset more than the margin past reads "It reset at" with no button', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() - 10 * MIN) });
  assert.match(copyOf(page).textContent, /It reset at/);
  assert.equal(page.querySelector('.rd-ov-state .limit-resume'), null);
});

test('D: a firing ticket reads "resuming…"', async () => {
  const ctx = await boot({ level: 'simple' });
  const page = await pausedCard(ctx, { limitResetAt: iso(Date.now() + 60 * MIN) });
  ctx.server.tickets = [ticket({ status: 'firing' })];
  ctx.recv({ type: 'schedules-changed' });
  await ctx.settle(10);
  assert.match(copyOf(page).textContent, /resuming…/);
});

for (const level of ['simple', 'advanced', 'expert']) {
  test(`levels: at ${level} the notice and button show; the menu item is B-only and its caret is hidden at simple`, async () => {
    const ctx = await boot({ level });
    const reset = Date.now() + 2 * 60 * MIN;
    const page = await pausedCard(ctx, { limitResetAt: iso(reset) });
    assert.match(copyOf(page).textContent, /It resets at/);
    assert.equal(page.querySelector('.rd-ov-state .limit-resume').hidden, false);
    const item = page.querySelector('.rd-resume-limit');
    assert.equal(item.hidden, false, 'B unhides the menu item');
    assert.match(item.querySelector('b').textContent, new RegExp(`Resume at ${hhmm(reset + 5 * MIN)}`));
    if (level === 'simple') {
      const more = page.querySelector('.rd-resume-more');
      assert.ok(more.hasAttribute('data-min-level') || more.hidden, 'the caret is level-gated at simple');
    }
    ctx.server.tickets = [ticket()];
    ctx.recv({ type: 'schedules-changed' });
    await ctx.settle(10);
    assert.equal(page.querySelector('.rd-resume-limit').hidden, true, 'C hides the menu item');
  });
}

test('menu item: "Resume at" is the first item of both split menus', () => {
  const doc = new JSDOM(readFileSync(htmlPath, 'utf8')).window.document;
  for (const [tpl, menu, cls] of [
    ['#run-detail-tpl', '.rd-resume-menu', 'rd-resume-limit'],
    ['#hist-detail-tpl', '.hd-resume-menu', 'hd-resume-limit-item'],
  ]) {
    const first = doc.querySelector(tpl).content.querySelector(`${menu} > [role="menuitem"]`);
    assert.ok(first.classList.contains(cls), `${menu} starts with .${cls}`);
  }
});

test('menu item: clicking it posts the same ticket as the button', async () => {
  const ctx = await boot({ level: 'advanced' });
  const reset = Date.now() + 2 * 60 * MIN;
  const page = await pausedCard(ctx, { limitResetAt: iso(reset) });
  page.querySelector('.rd-resume-more').click();
  await ctx.settle();
  page.querySelector('.rd-resume-limit').click();
  await ctx.settle(8);
  assert.equal(ctx.server.posts.length, 1);
  assert.equal(ctx.server.posts[0].scheduledFor, iso(reset + 5 * MIN));
});

/** A usage-limit-paused run is open in the Chat run panel. Chat is the boot view: no Runs view loaded the schedules. */
async function pausedPanel(ctx, { limitResetAt }) {
  const { doc, recv, settle, go } = ctx;
  recv({ type: 'hello', runs: [{ runId: 'r1', title: 'Feat', projectDir: PROJECT, status: 'running', startedAt: '00:00:00', pipelineId: 'pl_1' }] });
  await settle();
  recv({ type: 'done', runId: 'r1', status: 'paused', reason: 'usage_limit', detail: DETAIL_TEXT, limitEngine: 'claude', limitResetAt });
  await settle(8);
  assert.equal(ctx.fetchCalls.some((c) => c.url.split('?')[0].endsWith('/api/schedules')), false, 'nothing loaded the schedules yet');
  go('chat/new/run/r1');
  await settle(10);
  const screen = doc.querySelector('[data-chat-panel] .crp-host > .rd');
  assert.ok(screen, 'the run is open in the Chat panel');
  return screen;
}

test('Chat panel: a resume already booked keeps "Resume at" out of the Resume menu once the schedules load', async () => {
  const server = makeServer();
  server.tickets = [ticket()];
  const ctx = await boot({ level: 'advanced', server });
  const screen = await pausedPanel(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  assert.equal(screen.querySelector('.rd-resume-limit').hidden, true, 'C: the booked ticket hides the item');
});

test('Chat panel: a schedules-changed frame repaints the open run\'s Resume menu B→C', async () => {
  const ctx = await boot({ level: 'advanced' });
  const screen = await pausedPanel(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
  assert.equal(screen.querySelector('.rd-resume-limit').hidden, false, 'B offers the item');
  ctx.server.tickets = [ticket()];
  ctx.recv({ type: 'schedules-changed' });
  await ctx.settle(10);
  assert.equal(screen.querySelector('.rd-resume-limit').hidden, true, 'C hides the item');
});

test('History: a paused saved run with state.limitResetAt shows .hd-limit-notice in B', async () => {
  const reset = Date.now() + 2 * 60 * MIN;
  const ctx = await bootDetail({
    rows: [{ ...H_ROW, status: 'paused', pauseReason: 'usage_limit' }],
    detail: { ...H_DETAIL, state: { ...H_DETAIL.state, status: 'paused', pauseReason: 'usage_limit', pauseDetail: DETAIL_TEXT, limitEngine: 'claude', limitResetAt: iso(reset) } },
  });
  await openDetail(ctx, '');
  await hSettle(ctx.window, 6);
  const notice = ctx.window.document.querySelector('#hist-detail .hd-limit-notice');
  assert.ok(notice && !notice.hidden, 'the notice is visible');
  assert.match(notice.textContent, /It resets at/);
  assert.ok(notice.querySelector('.limit-resume'));
});

test('countdown: one 60s interval while B is painted, cleared once the run resumes', async () => {
  const set = globalThis.setInterval;
  const clear = globalThis.clearInterval;
  const made = [];
  const cleared = new Set();
  globalThis.setInterval = (fn, ms, ...rest) => { const id = set(fn, ms, ...rest); if (ms === 60_000) made.push(id); return id; };
  globalThis.clearInterval = (id) => { cleared.add(id); return clear(id); };
  try {
    const ctx = await boot({ level: 'simple' });
    const boottime = new Set(made);                    // the budget poller also ticks every 60s
    await pausedCard(ctx, { limitResetAt: iso(Date.now() + 2 * 60 * MIN) });
    const mine = made.filter((id) => !boottime.has(id));
    assert.equal(mine.length, 1, 'exactly one minute interval while B is painted');
    assert.equal(cleared.has(mine[0]), false);
    ctx.recv({ type: 'state', runId: 'r1', status: 'running' });
    await ctx.settle(8);
    assert.ok(cleared.has(mine[0]), 'the interval is cleared after the run resumes');
    for (const id of made) clear(id);
  } finally {
    globalThis.setInterval = set;
    globalThis.clearInterval = clear;
  }
});

test('run rows: the group row reads "resets HH:MM", and "resumes HH:MM" once a ticket exists', async () => {
  const ctx = await boot({ level: 'simple' });
  const reset = Date.now() + 2 * 60 * MIN;
  await pausedCard(ctx, { limitResetAt: iso(reset) });
  ctx.go('runs');
  await ctx.settle(8);
  const sub = () => ctx.doc.querySelector('a.runs-row .runs-row-sub')?.textContent || '';
  assert.match(sub(), new RegExp(`· resets ${hhmm(reset)}$`));
  const at = reset + 5 * MIN;
  ctx.server.tickets = [ticket({ runAt: iso(at) })];
  ctx.recv({ type: 'schedules-changed' });
  await ctx.settle(10);
  assert.match(sub(), new RegExp(`· resumes ${hhmm(at)}$`));
});

test('settings: #budgetLimitResume paints from GET, Save posts resumeAfterUsageLimit, visible at simple', async () => {
  const server = makeServer();
  server.settings = { resumeAfterUsageLimit: true };
  const ctx = await boot({ level: 'simple', server });
  ctx.go('settings/runs');
  await ctx.settle(10);
  const box = ctx.doc.getElementById('budgetLimitResume');
  assert.ok(box, 'the checkbox exists');
  assert.equal(box.checked, true);
  assert.equal(box.closest('[data-min-level]').getAttribute('data-min-level'), 'simple');
  box.checked = false;
  box.dispatchEvent(new ctx.window.Event('change', { bubbles: true }));
  ctx.doc.getElementById('budgetSave').click();
  await ctx.settle(8);
  const saved = server.posts.find((p) => p.settings);
  assert.ok(saved, 'Save posted');
  assert.equal(saved.settings.resumeAfterUsageLimit, false);
});

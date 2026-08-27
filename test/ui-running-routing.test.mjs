// test/ui-running-routing.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

// Behavior tests for the two-screen Running shell: `#running/<runId>` routes
// through the existing parseHash/showView machinery into the detail screen, and
// `#running` (or Back / Escape / leaving the view) returns to the list.
//
// boot() / settle() / go() are copied verbatim from test/ui-history-routing.test.mjs
// (boot 25-84, settle 89-91, go 93-96), with the fetch handler collapsed to this
// suite's two arms; the open() / recv() WebSocket drivers are copied verbatim from
// test/ui-pipeline-tabs.test.mjs:31-33. No shared harness — the duplication is
// the house convention.

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const appSrc = readFileSync(appPath, 'utf8');
const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

const PROJECT = '/tmp/proj';
const ID = 'auth-fix';
const OTHER = 'seo-pSEO';

// Same anchored helper idiom as test/ui-history-sticky-header.test.mjs.
function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}

async function boot({ url = 'http://localhost:4317/' } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};

  let lastWs = null;
  window.WebSocket = class {
    constructor() { this.readyState = 1; this._l = {}; lastWs = this; }
    send() {}
    close() {}
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); }
  };

  const calls = [];
  window.fetch = (u, opts) => {
    calls.push({ url: String(u), opts: opts || {} });
    if (String(u).includes('/api/projects')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ projects: [{ name: 'proj', path: PROJECT, exists: true }] }),
      });
    }
    return Promise.resolve({
      ok: true, status: 200,
      json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 }),
    });
  };

  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try {
      Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true });
    } catch {
      /* read-only global already present — leave it */
    }
  }
  globalThis.window = window;
  globalThis.document = window.document;
  window.localStorage.clear();   // T4's density key must not leak between cases

  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));

  const open = () => lastWs._l.open?.forEach((fn) => fn());
  const recv = (obj) => lastWs._l.message.forEach((fn) => fn({ data: JSON.stringify(obj) }));
  open();
  return { window, calls, recv };
}

async function settle(window, n = 3) {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

function go(window, hash) {
  window.location.hash = hash;
  window.dispatchEvent(new window.Event('hashchange'));
}

const live = (runId, extra = {}) => ({
  runId, title: runId, projectDir: PROJECT, status: 'running', kind: 'run',
  startedAt: '10:00:00', pendingQuestion: null, ...extra,
});

async function bootWithRuns() {
  const ctx = await boot();
  ctx.recv({ type: 'hello', runs: [live(ID), live(OTHER)] });
  await settle(ctx.window);
  return ctx;
}

// ---------- structure ----------

test('the Running view is a two-screen shell around the existing list', async () => {
  const { window } = await boot();
  const doc = window.document;
  const shell = doc.querySelector('#run-shell');
  assert.ok(shell, '#run-shell must exist');
  assert.ok(shell.classList.contains('run-shell'));
  assert.equal(shell.closest('[data-view]').dataset.view, 'running');

  const list = shell.querySelector('.run-screen.run-screen-list');
  assert.ok(list, '.run-screen-list wraps the list screen');
  assert.ok(list.querySelector('#run-list'), 'the run list moved inside the list screen');
  assert.ok(list.querySelector('.topbar h1'), 'so did the topbar');
  assert.ok(list.querySelector('.run-ask-banner'), 'and Task 2 banner');
  assert.ok(list.querySelector('.run-density'), 'and Task 4 density toggle');

  const host = doc.querySelector('#run-detail');
  assert.ok(host, '#run-detail must exist');
  assert.ok(host.classList.contains('run-screen') && host.classList.contains('run-screen-detail'));
  assert.equal(host.getAttribute('aria-hidden'), 'true', 'closed detail is hidden from AT');
  assert.equal(host.hasAttribute('inert'), true, 'and untabbable — aria-hidden alone does not do that');
  assert.ok(doc.querySelector('#run-detail-tpl'), 'the detail screen template ships in the markup');
});

test('renderFocusView is gone from app.js', async () => {
  assert.equal(/function renderFocusView\b/.test(appSrc), false,
    'the single-card focus view is replaced by the detail screen');
});

// ---------- open / close ----------

test('#running/<id> opens the detail screen and paints its header', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const doc = window.document;
  const shell = doc.querySelector('#run-shell');
  assert.ok(shell.classList.contains('detail-open'), 'the shell slides to the detail screen');

  const host = doc.querySelector('#run-detail');
  assert.equal(host.getAttribute('aria-hidden'), 'false');
  assert.equal(host.hasAttribute('inert'), false, 'the open screen is interactive');
  const listScreen = shell.querySelector('.run-screen-list');
  assert.equal(listScreen.getAttribute('aria-hidden'), 'true');
  assert.equal(listScreen.hasAttribute('inert'), true, 'the off-screen list is untabbable');

  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID);
  const status = doc.querySelector('#run-detail .rd-status');
  assert.ok(status.classList.contains('peach'), 'a running pipeline takes statusPill\'s peach family');
  assert.equal(status.querySelector('.rd-status-word').textContent, 'Running');
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /proj/);
  // startedLabel passes a bare time string through unchanged (app.js:10912-10917).
  assert.match(doc.querySelector('#run-detail .rd-meta').textContent, /10:00:00/);
  assert.equal(doc.querySelector('#run-detail .rd-pause').hidden, false, 'a live run offers Pause');
  assert.equal(doc.querySelector('#run-detail .rd-stop').hidden, false);
});

test('the list keeps every card while the detail is open (no focus view)', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const ids = [...window.document.querySelectorAll('#run-list .run-card')]
    .map((c) => c.dataset.runId).sort();
  assert.deepEqual(ids, [ID, OTHER].sort(),
    'the list screen still holds every run — the detail is a second screen, not a filter');
});

test('the Back button returns to #running and closes the screen', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('a state frame paints the branch row through the stored r.branch', async () => {
  const { window, recv } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  recv({
    type: 'state', runId: ID, status: 'running', steps: [], stepper: null,
    branch: { source: 'main', feature: 'worca-cc/auth-fix', worktreeDir: '/tmp/wt' },
  });
  await settle(window);
  const doc = window.document;
  assert.equal(doc.querySelector('#run-detail .rd-base').hidden, false);
  assert.equal(doc.querySelector('#run-detail .rd-base').textContent, 'main →');
  assert.equal(doc.querySelector('#run-detail .rd-branch-copy').hidden, false);
  assert.equal(doc.querySelector('#run-detail .rd-branch-name').textContent, 'worca-cc/auth-fix');
});

// ---------- header actions ----------
// C7 hands `.rd-stop` to Task 10, which replaces the handler BODY in place and
// rewrites the first case below (Task 10 Step 11b). Without these two, the
// header's only two controls ship untested through Tasks 5-9.

test('.rd-stop opens the confirm modal, and confirming posts /api/stop', async () => {
  const { window, calls } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  window.document.querySelector('#run-detail .rd-stop')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  // D5: Stop confirms. Opening the modal must not stop anything.
  const modal = window.document.getElementById('stop-modal');
  assert.equal(modal.classList.contains('hidden'), false, '.rd-stop opens #stop-modal');
  assert.equal(modal.dataset.runId, ID);
  assert.equal(calls.filter((c) => c.url.includes('/api/stop')).length, 0);

  modal.querySelector('.stop-confirm').dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window, 5);
  const posts = calls.filter((c) => c.url.includes('/api/stop'));
  assert.equal(posts.length, 1, 'exactly one stop POST, after the confirm');
  assert.equal(posts[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(posts[0].opts.body), { runId: ID });
});

test('.rd-pause posts /api/pause, then becomes Resume when the run parks', async () => {
  const { window, calls, recv } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const btn = () => window.document.querySelector('#run-detail .rd-pause');
  assert.equal(btn().dataset.action, 'pause');
  assert.equal(btn().querySelector('.rd-btn-label').textContent, 'Pause');

  btn().dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  const posts = calls.filter((c) => c.url.includes('/api/pause'));
  assert.equal(posts.length, 1);
  assert.deepEqual(JSON.parse(posts[0].opts.body), { runId: ID });
  assert.equal(btn().disabled, true, 'pauseRun disabled it for the duration of the request');

  // C16 REGRESSION GUARD. The server has NOT answered yet: r.status is still
  // 'running'. Frames keep arriving (a phase/subagent/cost frame routinely beats
  // the `pausing` snapshot), and each one repaints this header. If paintRdHeader
  // writes `disabled` unconditionally the button is re-armed inside the request
  // window and a second click POSTs /api/pause twice.
  recv({ type: 'phase', runId: ID, phase: 'implement', status: 'start', cycle: 1 });
  await settle(window);
  assert.equal(btn().disabled, true, 'a repaint mid-request must NOT re-enable Pause');
  btn().dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(window);
  assert.equal(calls.filter((c) => c.url.includes('/api/pause')).length, 1,
    'still exactly one pause POST');

  recv({ type: 'done', runId: ID, status: 'paused' });   // a pause routes through finishRun
  await settle(window);
  assert.equal(btn().dataset.action, 'resume', 'ONE control, two actions (C6) — there is no .rd-resume');
  assert.equal(btn().querySelector('.rd-btn-label').textContent, 'Resume');
  assert.equal(btn().hidden, false, 'a parked run still offers it');
  assert.equal(btn().disabled, false,
    'the ACTION flipped, so the disable is re-evaluated and the control comes back');
});

// ---------- Escape ----------

test('Escape with the detail open and no modal navigates back', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(shell.classList.contains('detail-open'), false);
});

test('Escape is swallowed while a modal owns it', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');
  window.document.querySelector('#confirm-modal').classList.remove('hidden');

  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`,
    'the modal owns Escape, not the router');
  assert.ok(shell.classList.contains('detail-open'));
});

test('Escape on another view never touches the Running track', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  // Force the shell to stay open while the hash points elsewhere: the guard is
  // currentView(), not the class, so a stale open shell must not swallow Escape.
  window.location.hash = 'new';
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'new');
});

// ---------- focus ----------

test('opening the detail moves focus to Back', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  assert.equal(window.document.activeElement,
    window.document.querySelector('#run-detail .rd-back'),
    'focus lands on the detail screen, not on whatever the list left behind');
});

test('closing the detail restores focus to the originating card', async () => {
  const { window } = await bootWithRuns();
  // The list only paints while the Running view is shown (onHello gates on
  // currentView()), so visit it before reading the card the focus comes home to.
  go(window, 'running');
  await settle(window);
  const head = window.document.querySelector(`#run-list .run-card[data-run-id="${ID}"] .rc-head`);
  assert.ok(head, 'T3 gives every card an .rc-head');
  assert.equal(head.getAttribute('tabindex'), '0', 'spec §4.4: the card header is focusable');

  go(window, `running/${ID}`);
  await settle(window);
  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);

  const active = window.document.activeElement;
  assert.ok(active && active.classList.contains('rc-head'), 'focus returned to a card head, not <body>');
  assert.equal(active.closest('.run-card').dataset.runId, ID,
    'and to the card the detail was opened from (re-queried by data-run-id)');
});

// ---------- transitionend cleanup ----------

test('the closing detail stays mounted + inert until the guarded transitionend', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const host = window.document.querySelector('#run-detail');

  window.document.querySelector('#run-detail .rd-back')
    .dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(host.getAttribute('aria-hidden'), 'true');
  assert.equal(host.hasAttribute('inert'), true, 'untabbable while it slides away');
  assert.ok(host.children.length > 0, 'with its content still mounted — that is the point');

  const fire = (target, propertyName) => {
    const e = new window.Event('transitionend', { bubbles: true });
    Object.defineProperty(e, 'propertyName', { value: propertyName });
    target.dispatchEvent(e);
  };
  // transitionend BUBBLES: a descendant's own transition must not clear the DOM.
  fire(host.querySelector('.rd-header'), 'transform');
  assert.ok(host.children.length > 0, 'a descendant transition is ignored');
  fire(host, 'opacity');
  assert.ok(host.children.length > 0, 'a non-transform property is ignored');
  fire(host, 'transform');
  assert.equal(host.children.length, 0, 'the host\'s own transform end clears the screen');
});

// ---------- detail -> detail ----------

test('a detail->detail hop rebuilds in place and never runs the close path', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  const removed = [];
  const origRemove = shell.classList.remove.bind(shell.classList);
  shell.classList.remove = (...a) => { removed.push(...a); return origRemove(...a); };

  go(window, `running/${OTHER}`);
  await settle(window);
  assert.equal(removed.includes('detail-open'), false, 'the track never slid back to the list');
  assert.ok(shell.classList.contains('detail-open'));
  assert.equal(window.document.querySelector('#run-detail .rd-title').textContent, OTHER,
    'the screen was rebuilt for the new run');
});

// ---------- animation gating ----------

test('entering from another view is instant; an in-view hop animates', async () => {
  const { window } = await bootWithRuns();
  const shell = window.document.querySelector('#run-shell');

  go(window, 'new');
  await settle(window);
  go(window, `running/${ID}`);
  assert.ok(shell.classList.contains('no-anim'), 'a cross-view entry must not slide');
  await settle(window);
  assert.equal(shell.classList.contains('no-anim'), false, 'the flag is dropped after a frame');

  go(window, 'running');
  await settle(window);
  go(window, `running/${ID}`);
  assert.equal(shell.classList.contains('no-anim'), false, 'a list->detail hop animates');
});

// ---------- deep link / unknown id ----------

test('deep-link boot opens the detail before hello, then upgrades from it', async () => {
  const { window, recv } = await boot({ url: `http://localhost:4317/#running/${ID}` });
  await settle(window);
  const doc = window.document;
  assert.ok(doc.querySelector('#run-shell').classList.contains('detail-open'),
    'the detail is open even though the runs Map is still empty');
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, ID,
    'the raw runId stands in until hello lands');

  recv({ type: 'hello', runs: [live(ID, { title: 'Fix the auth flow' })] });
  await settle(window);
  assert.equal(doc.querySelector('#run-detail .rd-title').textContent, 'Fix the auth flow');
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`, 'no bounce');
});

test('a deep link to a run hello does not know bounces to #running', async () => {
  const { window, recv } = await boot({ url: 'http://localhost:4317/#running/ghost' });
  await settle(window);
  recv({ type: 'hello', runs: [live(ID)] });
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running',
    'once hello has been processed an unknown id is genuinely bad');
});

test('an unknown id typed after hello bounces immediately', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running/ghost');
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), 'running');
  assert.equal(window.document.querySelector('#run-shell').classList.contains('detail-open'), false);
});

test('a sidebar child row opens the detail', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running');
  await settle(window);
  const row = window.document.querySelector(`#nav-running-children .nav-child[data-child-run-id="${ID}"]`);
  assert.ok(row, 'the sidebar row is painted');
  row.dispatchEvent(new window.Event('click', { bubbles: true }));
  window.dispatchEvent(new window.Event('hashchange'));
  await settle(window);
  assert.equal(window.location.hash.replace(/^#/, ''), `running/${ID}`);
  assert.ok(window.document.querySelector('#run-shell').classList.contains('detail-open'));
});

// ---------- leave-guard ----------

test('leaving the running view resets the track synchronously', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  const shell = window.document.querySelector('#run-shell');

  go(window, 'new');
  await settle(window);
  assert.equal(shell.classList.contains('detail-open'), false);
  assert.equal(window.document.querySelector('#run-detail').children.length, 0,
    'the instant close path empties the screen synchronously');
});

test('leaving the running view does not park focus on a hidden card', async () => {
  const { window } = await bootWithRuns();
  go(window, `running/${ID}`);
  await settle(window);
  go(window, 'new');
  await settle(window);
  const active = window.document.activeElement;
  assert.equal(active ? active.closest('.run-card') : null, null,
    'focus is not restored into the list the view switch just hid');
});

// ---------- CSS ----------

test('showView stamps body.view-running', async () => {
  const { window } = await bootWithRuns();
  go(window, 'running');
  await settle(window);
  assert.ok(window.document.body.classList.contains('view-running'));
  go(window, 'new');
  await settle(window);
  assert.equal(window.document.body.classList.contains('view-running'), false);
});

test('the Running slide shell mirrors History\'s track', () => {
  const view = ruleBody('.view[data-view="running"]');
  assert.ok(view, '.view[data-view="running"] rule must exist');
  assert.match(view, /padding:\s*0/, 'the screens own their gutters');
  assert.match(view, /position:\s*relative/, 'the absolute screens need a containing block');

  const screen = ruleBody('.run-screen');
  assert.ok(screen, '.run-screen rule must exist');
  assert.match(screen, /position:\s*absolute/);
  assert.match(screen, /overflow-y:\s*auto/, 'each screen owns its scrollport');
  assert.match(screen, /padding:\s*0 32px/, 'zero TOP padding so T7\'s sticky tabs pin flush');
  assert.match(screen, /transition:\s*transform/);

  assert.match(ruleBody('.run-screen-detail'), /transform:\s*translateX\(100%\)/);
  assert.match(css, /\.run-shell\.detail-open\s+\.run-screen-list\s*\{[^}]*translateX\(-100%\)/);
  assert.match(css, /\.run-shell\.detail-open\s+\.run-screen-detail\s*\{[^}]*translateX\(0\)/);
  assert.match(css, /\.run-shell\.no-anim\s+\.run-screen\s*\{[^}]*transition:\s*none/);
  assert.match(css, /\.run-screen-list\s+\.topbar\s*\{[^}]*padding-top:\s*26px/,
    'the inset the screen dropped is re-applied on the topbar');

  const main = ruleBody('body.view-running .main');
  assert.ok(main, 'body.view-running .main rule must exist');
  assert.match(main, /overflow:\s*hidden/);
  assert.match(main, /padding:\s*0/);
  assert.ok(ruleBody('body.view-running .topnav'), 'the compact top-nav re-applies the gutter');
});

test('wr-pulse is defined exactly once and is neutralized under reduced motion', () => {
  assert.equal((css.match(/@keyframes wr-pulse/g) || []).length, 1,
    'the shared keyframe is declared once by Task 3 (C2)');
  assert.match(css, /\.rd-status\s+\.pdot\s*\{[^}]*animation:\s*wr-pulse/);
  assert.match(css, /\.rd-status\.parked\s+\.pdot\s*\{[^}]*animation:\s*none/);
  const at = css.indexOf('.rd-status .pdot');
  const kill = css.indexOf('.rd-status .pdot,.rd-status.parked .pdot{animation:none;}');
  assert.ok(kill > at, 'the reduced-motion block sits AFTER the rule it neutralizes');
});

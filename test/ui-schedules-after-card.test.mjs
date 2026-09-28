// test/ui-schedules-after-card.test.mjs
// Schedules › Once with an after-ticket (run chains): the card says what it waits for and how it
// stands, "Schedule next…" deep-links, Details names the policy and the branch, and the Running
// view's upcoming() carries waiting after-tickets although their runAt is the sentinel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const viewPath = fileURLToPath(new URL('../ui/public/schedules-view.mjs', import.meta.url));
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));
const AFTER_T = { id: 'bbbbbbbb-0000-4000-8000-000000000002', kind: 'once', scheduleId: null, title: 'Tests', projectDir: '/a/svc-iam', workspaceId: null,
  runAt: '9999-12-31T00:00:00.000Z', scheduledFor: '9999-12-31T00:00:00.000Z', status: 'scheduled', ifMissed: 'run', graceMin: 360, attempts: 0, retryAt: null, queued: false, forced: false,
  ownerPid: null, ownerHost: null, pipelineId: null, failReason: null, askThreadId: null, askCardId: null, createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z',
  after: { kind: 'pipeline', id: 'p1', policy: 'any', title: 'Refactor', status: 'running', pipelineId: 'p1' }, sourceFromPrevious: true,
  summary: { target: 'project', workflowId: 'wf_default', guardrailsId: null, prompt: 'Add tests', source: null, sourceBranch: null, featureBranch: null, memoryScope: null, mock: false, extras: 0 } };

const MISSED_T = { ...AFTER_T, id: 'cccccccc-0000-4000-8000-000000000003', title: 'Docs', status: 'missed', failReason: 'The run before it ended with an error.',
  after: { ...AFTER_T.after, status: 'error' } };

async function boot(tickets = [AFTER_T]) {
  const dom = new JSDOM('<!doctype html><body><div id="tabs"><button data-tab="activity"></button><button data-tab="once"></button><button data-tab="repeating"></button></div><div id="feed"></div><div id="once"></div><div id="rep"></div></body>', { url: 'http://localhost/#schedules/once' });
  const { window } = dom;
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Event', 'DOMParser', 'location']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  const calls = [];
  window.fetch = (url, opts) => {
    calls.push({ url: String(url), method: (opts && opts.method) || 'GET' });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ schedules: [], tickets, counts: { scheduled: 1, missed: 0, recurring: 0, unread: 0 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 } }) });
  };
  globalThis.fetch = window.fetch;
  const mod = await import(pathToFileURL(viewPath).href + `?b=${Date.now()}_${Math.random()}`);
  const doc = window.document;
  const view = mod.createSchedulesView({ tabsHost: doc.getElementById('tabs'), feedHost: doc.getElementById('feed'), onceHost: doc.getElementById('once'), repeatingHost: doc.getElementById('rep'),
    deps: { confirmModal: async () => true, targetLabel: () => 'Project · svc-iam', workflowLabel: () => 'Default', onCounts() {}, openRun() {}, route(tab) { view.showTab(tab); } } });
  await view.load(); view.showTab('once'); await tick();
  return { doc, view, window, calls };
}

test('an after-ticket card names the run it waits for and offers Schedule next…', async () => {
  const { doc, view, window } = await boot();
  const card = doc.querySelector('#once .sched-item');
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Waiting for a run');
  assert.equal(card.querySelector('.sched-when').textContent, 'After ‘Refactor’ · running');
  assert.equal(card.querySelector('.sched-when').getAttribute('data-at'), '', 'no countdown for a predecessor');
  assert.match(card.querySelector('.sched-target').textContent, /from the run before it/);
  const kv = Object.fromEntries([...card.querySelectorAll('.sched-kv')].map((r) => [r.querySelector('.sched-k').textContent, r.querySelector('.sched-v').textContent]));
  assert.equal(kv.After, 'Refactor · running');
  assert.equal(kv['If it fails'], 'Start anyway');
  assert.equal(kv['Source branch'], 'the run before it');
  assert.equal(kv['If Worca is not running'], undefined);
  const next = [...card.querySelectorAll('button')].find((b) => b.textContent === 'Schedule next…');
  assert.ok(next);
  next.click();
  assert.equal(window.location.hash, `#new/after/t:${AFTER_T.id}`);
  assert.deepEqual(view.upcoming(60_000).map((t) => t.id), [AFTER_T.id], 'Running › Scheduled shows it');
});

test('a MISSED after-ticket keeps the predecessor word, shows its fail_reason, and offers no Schedule next…', async () => {
  const { doc } = await boot([MISSED_T]);
  const card = doc.querySelector('#once .sched-item');
  assert.equal(card.querySelector('.rc-status-word').textContent, 'Missed');
  assert.equal(card.querySelector('.sched-when').textContent, 'After ‘Refactor’ · ended with an error', 'the word after the dot is the PREDECESSOR\'s');
  assert.equal(card.querySelector('.sched-when').getAttribute('data-at'), '');
  assert.equal(card.querySelector('.sched-reason').textContent, 'The run before it ended with an error.');
  assert.equal([...card.querySelectorAll('button')].some((b) => b.textContent === 'Schedule next…'), false, 'a dead link: resolveAfterRef refuses a missed ticket');
});

test('the Running group row reads After ‘X’, never a countdown to the year 9999', async () => {
  const { view } = await boot();
  const rows = view.upcoming(24 * 3600 * 1000).map((t) => view.ticketRow(t));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].querySelector('.sched-when').textContent, 'After ‘Refactor’ · running');
  assert.equal(rows[0].querySelector('.sched-when').getAttribute('data-at'), '');
  assert.equal(rows[0].querySelector('.rc-status-word').textContent, 'Waiting for a run');
});

test('Cancel: the dependents read holds the button, so a double-click sends ONE delete', async () => {
  const { doc, calls } = await boot();
  const cancel = [...doc.querySelectorAll('#once .sched-item button')].find((b) => b.textContent === 'Cancel');
  assert.ok(cancel);
  cancel.click(); cancel.click();   // the second lands on a disabled button while the dependents read is in flight
  await tick(5);
  assert.equal(calls.filter((c) => c.method === 'DELETE').length, 1);
});

// The entry points are hidden by the `hidden` PROPERTY; jsdom cannot see that the `.rc-acts`
// cluster's author `display:inline-flex` beats the UA [hidden]{display:none}. Pin the CSS by
// source (the test/ui-running-pause-fixes.test.mjs idiom) and the two buttons by markup.
test('style.css and index.html carry the run-chain entry points', () => {
  const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');
  const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
  assert.match(css, /\.rc-acts \.btn-pause,[^{]*\.rc-after,\.rc-open\{/, '.rc-after joins the cluster BEFORE .rc-open');
  assert.match(css, /\.rc-acts \.rc-after\[hidden\]\{display:none;\}/);
  assert.match(css, /\.hd-after\[hidden\]\{display:none;\}/);
  // The skin and the focus rings the cluster rule does not give: without them the button is a
  // borderless panel-coloured square with no hover and no keyboard ring beside four that have all three.
  assert.match(css, /\.rc-after\{border:1px solid var\(--line\);color:var\(--ink-2\);\}/);
  assert.match(css, /\.rc-after:hover\{/);
  assert.match(css, /\.rc-after:focus-visible,/);
  assert.match(css, /\.hd-after:focus-visible,/);
  assert.match(html, /class="rc-after"[^>]*data-min-level="advanced"[^>]*hidden/);
  assert.match(html, /class="hd-after btn-ghost" hidden data-min-level="advanced"/);
});

// The Running card, the History-detail button and the Archive note, driven through window.__np —
// the app's own jsdom hooks (the test/ui-running-pause-fixes.test.mjs harness). Task 7's
// dependents route is stubbed; nothing else in this file boots app.js.
const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
async function bootLive(dependents = []) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  const calls = [];
  window.fetch = (url) => {
    const u = String(url); calls.push(u);
    const body = u.includes('/api/schedules/dependents') ? { dependents }
      : u.includes('/api/projects') ? { projects: [] }
        : { config: { steps: {}, customModels: [] }, models: [], efforts: [] };
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick();
  return { window, calls };
}

test('Running card: the after button appears once the pipeline id is known and deep-links to it', async () => {
  const { window } = await bootLive();
  const { upsertRun, buildRunCard, onState } = window.__np;
  const r = upsertRun({ runId: 'ra1', title: 't', projectDir: '/tmp/proj', status: 'running' });
  r.el = buildRunCard(r);
  const btn = r.el.querySelector('.rc-after');
  assert.ok(btn, 'the button is in the run-card template');
  onState(r, { status: 'running' });
  assert.equal(btn.hidden, true, 'no pipeline id yet: nothing to wait for');
  onState(r, { id: 'p1a2b3c4', status: 'running' });
  assert.equal(btn.hidden, false);
  btn.click();
  assert.equal(window.location.hash, '#new/after/p1a2b3c4');
});

test('History detail: paintHdAfter shows the button for a record and deep-links; afterDependentsNote builds the pinned sentence', async () => {
  const { window, calls } = await bootLive([{ id: 'x', kind: 'once', title: 'Tests' }, { id: 'y', kind: 'once', title: 'Docs' }]);
  const { paintHdAfter, afterDependentsNote } = window.__np;
  const screen = window.document.createElement('div');
  screen.innerHTML = '<button type="button" class="hd-after btn-ghost" hidden data-min-level="advanced">Schedule a run after this</button>';
  paintHdAfter(screen, null);
  assert.equal(screen.querySelector('.hd-after').hidden, true, 'no record, no button');
  paintHdAfter(screen, { id: 'h0000001', status: 'done' });
  assert.equal(screen.querySelector('.hd-after').hidden, false);
  screen.querySelector('.hd-after').click();
  assert.equal(window.location.hash, '#new/after/h0000001');
  assert.equal(await afterDependentsNote('pipelineId=h0000001'), '\n\n“Tests”, “Docs” wait for this run and will be marked missed.');
  assert.ok(calls.some((u) => u.includes('/api/schedules/dependents?pipelineId=h0000001')));
  // The Archive confirmation appends that note to its pinned copy, and every History paint site paints the button.
  const app = readFileSync(appPath, 'utf8');
  assert.match(app, /stay untouched\.\$\{chainNote\}`/, 'the note rides at the end of the pinned Archive message');
  assert.equal((app.match(/^\s*paintHdAfter\(/gm) || []).length, 5, 'one paintHdAfter per paintHdPr call site');
});

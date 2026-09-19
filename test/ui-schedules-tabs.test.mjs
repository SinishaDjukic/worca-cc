// test/ui-schedules-tabs.test.mjs
// The Schedules view's three tabs (Activity | Once | Repeating — the Statistics .seg idiom),
// routed as #schedules[/once|/repeating], and the "Project · name" / "Workspace · name" prefix
// on every scheduled run card (docs/scheduled-runs.md "UI").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const PROJECTS = [{ name: 'svc-iam', path: '/a/svc-iam', exists: true }];
const WORKSPACES = [{ id: 'wks-team-00000001', name: 'Storefront', projectPaths: ['/a/svc-iam', '/a/web'], projectKeys: ['svc-iam-00000001', 'web-00000002'] }];
const SOON = new Date(Date.now() + 3600_000).toISOString();
const SCHEDULES = {
  schedules: [{ id: 'sch_0000abcd', kind: 'recurring', title: 'Nightly audit', projectDir: null, workspaceId: 'wks-team-00000001', rule: { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' },
    sentence: 'Every day at 02:00', tz: 'UTC', overlap: 'skip', maxFailures: 3, failureStreak: 0, ifMissed: 'run', graceMin: 360, status: 'active', pauseReason: null, runsCount: 2, nextRunAt: SOON, lastResult: 'completed',
    summary: { target: 'workspace', workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'audit', source: null, sourceBranch: null, featureBranch: null, memoryScope: null, mock: false, extras: 0 } }],
  tickets: [{ id: '11111111-2222-3333-4444-555555555555', kind: 'once', scheduleId: null, title: 'Upgrade deps', projectDir: '/a/svc-iam', workspaceId: null, runAt: SOON, scheduledFor: SOON, status: 'scheduled',
    ifMissed: 'run', graceMin: 360, attempts: 0, retryAt: null, queued: false, forced: false, ownerPid: null, pipelineId: null, failReason: null,
    summary: { target: 'project', workflowId: 'wf_default', guardrailsId: 'normal', prompt: 'upgrade', source: null, sourceBranch: null, featureBranch: null, memoryScope: null, mock: false, extras: 0 } }],
  counts: { scheduled: 1, missed: 0, recurring: 1, unread: 1 }, defaults: { graceMin: 360, ifMissed: 'run', maxFailures: 3 },
};
const FEED = { notifications: [{ id: 7, scope: 'schedule', kind: 'failed', severity: 'problem', scheduleId: null, ticketId: 'x', pipelineId: null, projectDir: '/a/svc-iam', title: 'Old run', message: 'could not start.', createdAt: new Date().toISOString(), readAt: null, resolvedAt: null, unread: true }], unread: 1 };
const tick = (n = 1) => new Promise((r) => setTimeout(r, n));

async function boot(hash) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: `http://localhost:4317/${hash}` });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url) => {
    const u = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (u.includes('/api/projects')) return json({ projects: PROJECTS });
    if (u.includes('/api/workspaces')) return json({ workspaces: WORKSPACES });
    if (u.includes('/api/notifications')) return json(FEED);
    if (u.includes('/api/schedules')) return json(SCHEDULES);
    return json({ config: { steps: {}, customModels: [] }, models: [], efforts: [] });
  };
  // DOMParser too: the rows' icons parse SVG through it (schedules-view.mjs svgIcon).
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator', 'DOMParser']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await tick(10);
  return window;
}
const paneShown = (doc, name) => !doc.querySelector(`[data-pane="${name}"]`).hidden;
const onTab = (doc) => doc.querySelector('#schedules-tabs button.on')?.dataset.tab;

test('#schedules opens on Activity; the strip is the Statistics .seg with counts; #schedules/once and /repeating route the panes', async () => {
  let window = await boot('#schedules');
  let doc = window.document;
  assert.ok(doc.getElementById('schedules-tabs').classList.contains('seg'), 'reuses the .seg segmented control');
  assert.deepEqual([...doc.querySelectorAll('#schedules-tabs button')].map((b) => b.dataset.tab), ['activity', 'once', 'repeating']);
  assert.equal(onTab(doc), 'activity');
  assert.deepEqual([paneShown(doc, 'activity'), paneShown(doc, 'once'), paneShown(doc, 'repeating')], [true, false, false]);
  assert.deepEqual([...doc.querySelectorAll('#schedules-tabs button')].map((b) => b.textContent), ['Activity · 1', 'Once · 1', 'Repeating · 1'], 'unread, waiting and active counts');
  assert.ok(doc.querySelector('#schedules-feed .sched-feed-item.unread'), 'the feed is the Activity pane');

  window = await boot('#schedules/once');
  doc = window.document;
  assert.equal(onTab(doc), 'once');
  assert.deepEqual([paneShown(doc, 'activity'), paneShown(doc, 'once'), paneShown(doc, 'repeating')], [false, true, false]);
  assert.equal(doc.querySelectorAll('#schedules-once .sched-item').length, 1);
  assert.equal(doc.querySelectorAll('#schedules-repeating .sched-item').length, 1, 'painted while hidden too');

  // A tab click is a route: Back and a reload land on the same tab.
  doc.querySelector('#schedules-tabs button[data-tab="repeating"]').click();
  await tick(5);
  assert.equal(window.location.hash, '#schedules/repeating');
  assert.equal(onTab(doc), 'repeating');
  assert.equal(paneShown(doc, 'repeating'), true);
  doc.querySelector('#schedules-tabs button[data-tab="activity"]').click();
  await tick(5);
  assert.equal(window.location.hash, '#schedules', 'Activity is the bare route');
  assert.equal(onTab(doc), 'activity');
});

test('every scheduled run card names its target kind first: "Project · name" / "Workspace · name"', async () => {
  const window = await boot('#schedules/once');
  const doc = window.document;
  const once = doc.querySelector('#schedules-once .sched-item .sched-target').textContent;
  assert.match(once, /^Once · Project · svc-iam · Default$/);
  const series = doc.querySelector('#schedules-repeating .sched-item .sched-target').textContent;
  assert.match(series, /^Workspace · Storefront · Default$/);
});

test('empty panes say what to do, each in its own words', async () => {
  const window = await boot('#schedules/once');
  const doc = window.document;
  // Repaint with nothing scheduled.
  window.fetch = (url) => {
    const u = String(url);
    const json = (body) => Promise.resolve({ ok: true, status: 200, json: async () => body });
    if (u.includes('/api/notifications')) return json({ notifications: [], unread: 0 });
    if (u.includes('/api/schedules')) return json({ ...SCHEDULES, schedules: [], tickets: [], counts: { scheduled: 0, missed: 0, recurring: 0, unread: 0 } });
    return json({ projects: PROJECTS, workspaces: WORKSPACES });
  };
  globalThis.fetch = window.fetch;
  window.location.hash = '#schedules/repeating';
  await tick(10);
  window.location.hash = '#schedules/once';
  await tick(10);
  assert.match(doc.querySelector('#schedules-once .run-empty').textContent, /No one-off run is waiting/);
  assert.match(doc.querySelector('#schedules-repeating .run-empty').textContent, /No repeating schedule/);
  assert.ok(doc.querySelector('#schedules-once .run-empty a[href="#new/schedule"]'), 'points at Schedule a run');
  assert.deepEqual([...doc.querySelectorAll('#schedules-tabs button')].map((b) => b.textContent), ['Activity', 'Once', 'Repeating'], 'no counts when empty');
});

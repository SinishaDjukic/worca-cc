// test/stillhet-new-task-projects-host.test.mjs — F-a4-06 / F-5-04 (batch B1.4): the Legacy approach forms' project picker
// (New task…, New schedule…, Run after this) reads the store's projects part (dev's GET /api/projects) in the live kind, never
// task rows: a project with no tasks is offered, a removed one is neither offered nor defaulted, a missing folder is listed
// but never preselected. The demo keeps its task-row list. Live app host (jsdom).
// F-a4-02 / F-gb2-01 (batch B2.1): the forms' host #center-dlg sits outside #app, so an #app redraw (a live load, a frame)
// never removes an open form: its fields, typed text and focus stay, and + › New task… opens at once while data loads.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';

afterEach(closeHosts);
const sent = (calls) => posts(calls).filter(([, u]) => !/^\/api\/ask\//.test(u));
const items = async (d) => {
  d.querySelector('#center-dlg [data-menu="f-project"]').click(); await settle(20);
  const got = [...d.querySelectorAll('#center-dlg [data-menu-pick^="f-project|"]')].map((x) => x.dataset.menuPick.slice('f-project|'.length));
  d.querySelector('#center-dlg [data-menu="f-project"]').click(); await settle(20);
  return got;
};
const shown = (d) => d.querySelector('#center-dlg [data-menu="f-project"]').textContent.trim();
const openTask = async (w) => { w.RailCenters.maker('tasks').newPick('form'); await settle(60); };
const type = (w, d, sel, v) => { const t = d.querySelector(sel); t.value = v; t.dispatchEvent(new w.Event('input', { bubbles: true })); };
const yes = async (d) => { d.querySelector('#center-dlg [data-dialog="yes"]').click(); await settle(100); };
// no live runs; the newest saved task (pa) is in `old`, a project dev no longer lists
const removedNewest = () => { const s = clone(SOURCES); s.hello.runs = []; s.history.pipelines.find((p) => p.id === 'pa').projectName = 'old'; return s; };
const write = (u) => (u === '/api/run' ? [200, { runId: 'r-new' }] : [200, {}]);

test('the live picker lists every registered project, one with no tasks too, and No project last (F-a4-06, F-5-04)', async () => {
  const s = clone(SOURCES); s.projects.projects.push({ key: 'docs-4', name: 'docs', path: '/src/docs', displayPath: '~/src/docs', exists: true, vcs: 'git' });
  const { w, d, calls } = await liveHost({ sources: s });
  await go(w, '#runs', 120);
  const before = calls.length;
  await openTask(w);
  assert.deepEqual(await items(d), ['web', 'api', 'gone', 'docs', 'No project'], 'dev\'s projects in its order, then No project');
  assert.equal(shown(d), 'web', 'the newest task\'s project');
  const opened = calls.slice(before);
  assert.ok(!opened.some((c) => c.url.startsWith('/api/projects')), `the picker reads the store only: ${JSON.stringify(opened.map((c) => c.url))}`);
});

test('a removed project is not offered or defaulted; the newest task of a registered project is (F-a4-06, F-5-04)', async () => {
  const s = removedNewest();
  const { w, d, calls } = await liveHost({ sources: s, write });
  await go(w, '#runs', 120);
  await openTask(w);
  assert.ok(!(await items(d)).includes('old'), 'a project dev does not list is not offered');
  assert.equal(shown(d), 'api', 'the next task\'s registered project');
  type(w, d, '#cc-text', 'Add a pager'); await yes(d);
  const run = sent(calls).find(([, u]) => u === '/api/run');
  assert.ok(run, JSON.stringify(sent(calls)));
  assert.equal(run[2].projectDir, '/src/api');
});

test('a project whose folder is missing is listed but never preselected (F-a4-06, F-5-04)', async () => {
  const s = clone(SOURCES); s.hello.runs = []; s.history.pipelines.find((p) => p.id === 'pa').projectName = 'gone';
  const { w, d } = await liveHost({ sources: s });
  await go(w, '#runs', 120);
  await openTask(w);
  assert.ok((await items(d)).includes('gone'), 'it can still be picked on purpose');
  assert.equal(shown(d), 'api', 'the next task\'s present project');
});

test('with no tasks, the default is the first registered project whose folder exists (F-a4-06, F-5-04)', async () => {
  const s = clone(SOURCES); s.hello.runs = []; s.history.pipelines = []; s.projects.projects[0].exists = false;
  const { w, d } = await liveHost({ sources: s });
  await go(w, '#runs', 120);
  await openTask(w);
  assert.deepEqual(await items(d), ['web', 'api', 'gone', 'No project']);
  assert.equal(shown(d), 'api');
});

test('a project in its Remove undo window is neither offered nor defaulted (F-a4-06, F-5-04)', async () => {
  const { w, d, calls } = await liveHost({ sources: clone(SOURCES) });
  await go(w, '#runs', 120);
  w.RailProjectsLive.deferRemove('web-1', 5000); await settle(20);
  await openTask(w);
  assert.deepEqual(await items(d), ['api', 'gone', 'No project']);
  assert.equal(shown(d), 'api', 'the newest task in a project still there');
  assert.ok(!calls.some((c) => c.method === 'DELETE'), 'nothing removed before the window closes');
});

test('New schedule… offers the same list and default, and saving sends the registered project\'s folder (F-a4-06, F-5-04)', async () => {
  const { w, d, calls } = await liveHost({ sources: removedNewest(), write });
  await go(w, '#runs', 120);
  w.RailCenters.maker('schedules').newPick('form'); await settle(60);
  assert.deepEqual(await items(d), ['web', 'api', 'gone', 'No project']);
  assert.equal(shown(d), 'api');
  type(w, d, '#cc-name', 'Nightly pager'); type(w, d, '#cc-text', 'Add a pager'); await yes(d);
  const run = sent(calls).find(([, u]) => u === '/api/run');
  assert.ok(run, JSON.stringify(sent(calls)));
  assert.equal(run[2].projectDir, '/src/api');
});

test('Run after this with a removed project opens New task on the default, not on it (F-a4-06, F-5-04)', async () => {
  const { w, d } = await liveHost({ sources: removedNewest() });
  await go(w, '#runs', 120);
  w.RailCenters.newTask({ project: 'old' }); await settle(60);
  assert.equal(shown(d), 'api');
  w.RailCenters.newTask({ project: 'gone' }); await settle(60);
  assert.equal(shown(d), 'gone', 'a listed project asked for on purpose stays');
});

test('the demo keeps its task-row list and billing-api default (pixel comparison unchanged) (F-a4-06, F-5-04)', async () => {
  const w = stillhetHost({ hash: '#runs', after }), d = w.document;
  await settle(60);
  const rows = [...new Set(w.RailWorld.rows().map((r) => r.project).filter(Boolean)), 'No project'];
  w.RailCenters.newTask(); await settle(60);   // the demo's level hides the Legacy menu; its form is the same blank()
  assert.deepEqual(await items(d), rows);
  assert.equal(shown(d), 'billing-api');
});

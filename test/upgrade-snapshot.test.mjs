// test/upgrade-snapshot.test.mjs — spec §5a.1: a recorded dev DB (features, chains, archived runs) upgrades to the
// current schema and the Runs list shows every run, active under Show = All and archived under Show = Archived.
// The JSDOM boot is a trimmed copy of test/ui-runs-view.test.mjs's boot() (no shared harness, by convention).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { app } from '../ui/server.mjs';
import { _resetForTests, getDb, SCHEMA_VERSION } from '../src/core/db.mjs';
import { createSchedule, createTicket } from '../src/core/scheduler.mjs';
import { RUN_STATES } from '../src/shared/run-model.mjs';
import { SNAPSHOT, loadUpgradeSnapshot } from './helpers/upgrade-snapshot.mjs';
import { useDomRelease } from './helpers/jsdom-release.mjs';

const trackDom = useDomRelease(afterEach);
const ROOT = new URL('..', import.meta.url);
let srv, base, home, prevHome, payloads;

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'worca-cc-upgrade-'));
  prevHome = process.env.WORCA_HOME; process.env.WORCA_HOME = home;
  _resetForTests();
  loadUpgradeSnapshot();
  // D3: the dev DB has no schedules; one daily schedule (its first occurrence is materialised by createSchedule)
  // and one Run-after ticket chained after that occurrence, so nothing is due while the test runs.
  const projectDir = join(home, 'proj');                // no registered project needed (test/schedule-attribution.test.mjs)
  // createSchedule calls normalizeRule(rule, { todayLocal: rule.anchor || null }): without an anchor it throws
  // "rule.anchor must be YYYY-MM-DD" (only the HTTP route seeds today's date), so the rule carries one.
  const { ticket } = createSchedule({ title: 'Nightly deps', projectDir, request: { prompt: 'x', mock: true },
    rule: { freq: 'daily', time: '03:00', tz: 'UTC', anchor: new Date().toISOString().slice(0, 10) } });
  assert.ok(ticket && ticket.id, 'createSchedule materialised the first occurrence');
  createTicket({ title: 'After nightly', projectDir, request: { prompt: 'y', mock: true },
    after: { kind: 'ticket', id: ticket.id } });
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p) => (await fetch(base + p)).json();
  payloads = { history: await get('/api/history'), archived: await get('/api/history?archived=1'),
    schedules: await get('/api/schedules'), groups: await get('/api/run-groups') };
});
after(async () => {
  await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  _resetForTests();
  await rm(home, { recursive: true, force: true });
});

const recorded = (archived) => SNAPSHOT.tables.pipelines.filter((p) => !p.deleted_at && !!p.archived_at === archived).map((p) => p.id);

test('the snapshot migrates to the current schema with every row kept', () => {
  const db = getDb();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT count(*) AS n FROM pipelines').get().n, SNAPSHOT.tables.pipelines.length);
  assert.ok(SNAPSHOT.tables.shape_features.length >= 1 && recorded(true).length >= 1, 'the fixture has features and archived runs');
  assert.ok(SNAPSHOT.tables.scheduled_runs.some((t) => t.after_kind), 'the fixture has Run-after chains');
});

test('the server lists every recorded run: active in History, archived in the archived feed', () => {
  const ids = (list) => new Set(list.pipelines.map((p) => p.id));
  assert.deepEqual(recorded(false).filter((id) => !ids(payloads.history).has(id)), []);
  assert.deepEqual(recorded(true).filter((id) => !ids(payloads.archived).has(id)), []);
  // listRunGroups leaves out replanned features and groups with no listable member: compare against the features
  // that still have a non-deleted recorded run (origin or slice).
  const feats = new Set(payloads.groups.groups.filter((g) => g.kind === 'feature').map((g) => g.id));
  const runIds = new Set(SNAPSHOT.tables.pipelines.filter((p) => !p.deleted_at).map((p) => p.id));
  const sliceRuns = (f) => SNAPSHOT.tables.shape_feature_slices.filter((sl) => sl.feature_id === f.id).map((sl) => sl.pipeline_id);
  const listable = SNAPSHOT.tables.shape_features.filter((f) => f.status !== 'replanned'
    && [f.origin_pipeline_id, ...sliceRuns(f)].some((id) => id && runIds.has(id)));
  assert.ok(listable.length >= 1, 'the fixture has a listable feature');
  assert.deepEqual(listable.filter((f) => !feats.has(f.id)).map((f) => f.id), [], 'every listable feature is a group');
});

async function bootList(view) {
  const html = readFileSync(new URL('ui/public/index.html', ROOT), 'utf8');
  const dom = trackDom(new JSDOM(html, { url: 'http://localhost/#runs' }));
  const { window } = dom;
  let ws;
  window.Element.prototype.scrollIntoView = () => {};
  window.WebSocket = class { constructor() { this.readyState = 1; this._l = {}; ws = this; } send() {} close() {} addEventListener(t, fn) { (this._l[t] ||= []).push(fn); } };
  const ok = (b) => Promise.resolve({ ok: true, status: 200, json: async () => b, text: async () => JSON.stringify(b) });
  // test/ui-runs-view.test.mjs boot()'s router, with these four answered from the real server payloads.
  window.fetch = (u) => {
    const url = String(u);
    if (url.startsWith('/api/history?archived=1')) return ok(payloads.archived);
    if (url.startsWith('/api/history')) return ok(payloads.history);
    if (url.startsWith('/api/schedules')) return ok(payloads.schedules);
    if (url.startsWith('/api/run-groups')) return ok(payloads.groups);
    if (url.includes('/api/projects')) return ok({ projects: [] });
    if (url.includes('/api/workspaces')) return ok({ workspaces: [] });
    return ok({ config: { steps: {}, customModels: [] }, models: [], efforts: [], pipelines: 0, projects: 0, workspaces: 0 });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* read-only */ }
  }
  window.localStorage.clear();
  window.localStorage.setItem('worca-cc.runs.view', JSON.stringify({ show: view, groupBy: 'none', person: '' }));
  window.localStorage.setItem('worca-cc.whatsNew.runsRedesign', '1');
  await import(pathToFileURL(new URL('ui/public/app.js', ROOT).pathname).href + `?u=${Date.now()}_${Math.random()}`);
  ws._l.open?.forEach((fn) => fn());
  ws._l.message.forEach((fn) => fn({ data: JSON.stringify({ type: 'hello', runs: [] }) }));
  const doc = window.document;
  const settle = () => new Promise((r) => setTimeout(r, 20));
  await settle();
  // Group by None pages Recent by 20: open every page.
  for (let i = 0; i < 50 && doc.querySelector('.runs-older'); i++) { doc.querySelector('.runs-older').click(); await settle(); }
  return doc;
}
const listedIds = (doc) => {
  const out = new Set();
  for (const a of doc.querySelectorAll('#runs-list .runs-row')) {
    if (a.dataset.pipelineId) out.add(a.dataset.pipelineId);
    for (const k of String(a.dataset.memberKeys || '').split(/[ ,]+/)) if (k.startsWith('p:')) out.add(k.slice(2));
  }
  return out;
};

test('Show = All lists every active recorded run once, each in one of the 10 model states', async () => {
  const doc = await bootList('all');
  const seen = listedIds(doc);
  assert.deepEqual(recorded(false).filter((id) => !seen.has(id)), [], 'no missing rows');
  for (const a of doc.querySelectorAll('#runs-list .runs-row')) assert.ok(Object.hasOwn(RUN_STATES, a.dataset.state), `${a.dataset.rowKey}: ${a.dataset.state}`);
  assert.ok([...doc.querySelectorAll('#runs-list .runs-row')].some((a) => a.dataset.state === 'waiting'), 'the schedule and the Run-after ticket list as Waiting');
});

test('Show = Archived lists every archived recorded run', async () => {
  const doc = await bootList('archived');
  const seen = listedIds(doc);
  assert.deepEqual(recorded(true).filter((id) => !seen.has(id)), []);
});

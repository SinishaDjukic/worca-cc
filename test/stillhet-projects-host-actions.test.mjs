// Stillhet slice 9: Projects in the live kind, in the app host. Every action sends dev's route through the live module,
// shows its D22 pending label disabled while dev answers, and a refusal says Could not … with nothing changed. The demo
// kind sends nothing. The host is test/helpers/stillhet-projects-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectsHost, KEYS, PJ_SOURCES, sent, gate, noWould, undoTimers, settle, go, clone, closeHosts } from './helpers/stillhet-projects-host.mjs';
import { saidText } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { PROJECT_ACTIONS } from '../ui/public/stillhet/live/projects-live.mjs';

afterEach(closeHosts);
const page = (d) => d.getElementById('route-place');
const pickMore = (d, v) => { page(d).querySelector('[data-menu="pj-more"]').click(); const b = page(d).querySelector(`[data-menu-pick="pj-more|${v}"]`); assert.ok(b, `pj-more|${v} is offered`); b.click(); };
/** Waits until `f()` holds (or `ms` passed): a read of the store under load takes a while. */
const until = async (f, ms = 8000) => { for (let t = 0; t < ms && !f(); t += 50) await settle(50); };
const yes = (d) => page(d).querySelector('[data-confirm="yes"]');
/** The button at the end of the settings row named `name` (its control). */
const rowButton = (d, name) => [...page(d).querySelectorAll('.set-name')].find((n) => n.textContent.trim().startsWith(name))?.closest('.set-row')?.querySelector('.set-end button') || null;
/** R-qa-3: that very control carries the label and is disabled (a label elsewhere on the page does not count). */
const heldWith = (el, label) => !!el && el.disabled === true && (el.textContent.trim() === label || el.title === label);

test('the bar lists dev\'s projects, seed-moved reads Folder missing; while the first read is held the list says Loading and has() is true', async () => {
  const g = gate();
  const h = await projectsHost({ hold: (u) => (u === '/api/projects' ? g.p : null) });
  assert.match(page(h.d).textContent, /Loading projects/);
  assert.equal(h.w.RailPlaces.projects.has('anything'), true, 'a deep link waits for the list');
  g.open(); await settle(100);
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'hello', bootId: 'b', runs: [] }) }); await settle(200);   // the socket opens after the first read
  const names = h.w.RailProjects.list().map((p) => p.name);
  for (const n of ['seed-ok', 'seed-behind', 'seed-moved', 'seed-owned']) assert.ok(names.includes(n), n);
  assert.match(h.d.getElementById('bar-place').textContent, /seed-moved/);
  assert.match(h.d.getElementById('bar-place').textContent, /Folder missing/);
  assert.equal(h.w.RailPlaces.projects.has('anything'), false);
});

test('every project-side pending label shows on its control, disabled, while dev answers, then the control rests', async () => {
  const held = new Map();
  const hold = (u) => { for (const [k, g] of held) if (u.includes(k) && !u.includes('/probe?')) return g.p; return null; };   // COV-1: Add's probe is a read, never held here
  const dirs = { path: '/src', parent: '/', home: '/home/me', dirs: [{ name: 'a', path: '/src/a' }, { name: 'b', path: '/src/b' }] };
  const h = await projectsHost({ hash: `#projects/${KEYS.behind}`, hold, read: (u) => (u.startsWith('/api/fs/dirs') ? [200, dirs] : null) });
  noWould(h.w);
  // read from the table, not typed: every project-side action with a pending label is pressed below
  const PRESSED = new Set();
  // each action pressed on its own; `control` finds the control that action's press lands on
  const press = async (id, key, fn, control, label = PROJECT_ACTIONS[id][1]) => {
    const g = gate(); held.set(key, g);
    await fn(); await settle(40);
    assert.ok(heldWith(control(), label), `${id}: its control is disabled and reads ${label}`);
    held.delete(key); g.open(); await settle(150);
    assert.ok(!page(h.d).textContent.includes(label), `${id}: the control rests after dev answers`);
    PRESSED.add(id);
  };
  const act = () => page(h.d).querySelector('[data-pj-act]');
  await press('sync', `/api/projects/${KEYS.behind}/sync`, () => act().click(), act);
  await go(h.w, `#projects/${KEYS.offline}`, 150);
  await press('fetch', `/api/projects/${KEYS.offline}/sync`, () => act().click(), act);
  await go(h.w, `#projects/${KEYS.folder}`, 150);
  await press('git', `/api/projects/${KEYS.folder}/git-init`, () => act().click(), act);
  await go(h.w, `#projects/${KEYS.local}`, 150);
  await press('link', `/api/projects/${KEYS.local}/git-init`, async () => { act().click(); await settle(80); page(h.d).querySelector('#pj-hand-v').value = 'git@github.com:o/seed-local.git'; yes(h.d).click(); }, () => yes(h.d));
  await go(h.w, `#projects/${KEYS.ok}`, 150);
  await press('rename', `/api/projects/${KEYS.ok}`, async () => { pickMore(h.d, 'rename'); await settle(80); page(h.d).querySelector('#pj-hand-v').value = 'Seed renamed'; yes(h.d).click(); }, () => yes(h.d));
  await go(h.w, `#projects/${KEYS.moved}`, 150);
  await press('relocate', `/api/projects/${KEYS.moved}`, async () => { act().click(); await settle(80); page(h.d).querySelector('#pj-hand-v').value = '~/src/seed-moved-now'; yes(h.d).click(); }, () => yes(h.d));
  await go(h.w, `#projects/${KEYS.ok}`, 250);
  await press('set', `/api/projects/${KEYS.ok}/settings`, async () => { page(h.d).querySelector('[data-menu="pjs-pr"]').click(); page(h.d).querySelector('[data-menu-pick="pjs-pr|create a draft PR"]').click(); }, () => rowButton(h.d, 'Pull requests'));
  await press('team', `/api/projects/${KEYS.ok}/settings`, () => page(h.d).querySelector('[data-pj-team]').click(), () => page(h.d).querySelector('[data-pj-team]'));
  await press('defaults', `/api/projects/${KEYS.ok}/tags/defaults`, async () => { page(h.d).querySelector('[data-def-edit="labels"]').click(); await settle(30); h.d.getElementById('def-labels').value = 'billing'; page(h.d).querySelector('[data-def-edit="labels"]').click(); }, () => rowButton(h.d, 'Labels'));
  await go(h.w, '#projects', 150);
  await press('add', '/api/projects', async () => { h.w.RailPlaces.projects.newPick('hand-project'); await settle(100); page(h.d).querySelector('#pj-hand-v').value = '~/src/brand-new'; yes(h.d).click(); }, () => yes(h.d));
  const way = async (w) => { h.w.RailPlaces.projects.newPick('hand-project'); await settle(100); page(h.d).querySelector(`[data-pa-way="${w}"]`).click(); await settle(60); };
  await press('create', '/api/projects/create', async () => { await way('new'); page(h.d).querySelector('#pj-new-name').value = 'alpha'; yes(h.d).click(); }, () => yes(h.d));
  await press('bulk', '/api/projects/bulk', async () => { await way('many'); yes(h.d).click(); await settle(120); for (const p of ['/src/a', '/src/b']) page(h.d).querySelector(`[data-fb-pick="${p}"]`).click(); page(h.d).querySelector('.fb [data-dialog="yes"]').click(); await settle(40); yes(h.d).click(); }, () => yes(h.d));
  const projectSide = Object.entries(PROJECT_ACTIONS).filter(([id, [, label]]) => label && !id.startsWith('space-') && !['scan', 'answer', 'open-editor', 'clone'].includes(id)).map(([id]) => id);
  assert.deepEqual(projectSide.filter((id) => !PRESSED.has(id)), [], 'every project-side pending label was pressed');
  assert.deepEqual(h.w.__would, []);
});

test('F-6-03: a git project dev reads with remote:null (state unknown) is Only on this computer: Link a repository… and ⋯ Link a remote…', async () => {
  const sync = { projects: { ...PJ_SOURCES.sync.projects, [KEYS.local]: { base: 'main', remote: null, state: 'unknown', settings: { beforeRun: true } } } };
  const h = await projectsHost({ hash: `#projects/${KEYS.local}`, sources: { sync } });
  assert.match(page(h.d).textContent, /Only on this computer/);
  assert.doesNotMatch(page(h.d).textContent, /Up to date/);
  assert.equal(page(h.d).querySelector('[data-pj-act]')?.textContent.trim(), 'Link a repository…');
  page(h.d).querySelector('[data-menu="pj-more"]').click();
  assert.match(page(h.d).querySelector('[data-menu-pick="pj-more|remote"]')?.textContent || '', /Link a remote…/);
});

test('Rename sends PATCH {name}; Locate sends {path}; a 400 is the field\'s error', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, write: (u, b, m) => (m === 'PATCH' && b.path === '~/nope' ? [400, { error: 'path is not a directory' }] : [200, { ok: true }]) });
  pickMore(h.d, 'rename'); await settle(80);
  assert.equal(page(h.d).querySelector('#pj-hand-v').value, 'seed-ok');
  page(h.d).querySelector('#pj-hand-v').value = 'Seed renamed'; yes(h.d).click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PATCH', `/api/projects/${KEYS.ok}`, { name: 'Seed renamed' }]);
  assert.match(saidText(h.d), /Renamed seed-ok to Seed renamed/);
  await go(h.w, `#projects/${KEYS.moved}`, 150);
  page(h.d).querySelector('[data-pj-act]').click(); await settle(80);
  page(h.d).querySelector('#pj-hand-v').value = '~/nope'; yes(h.d).click(); await settle(120);
  assert.match(page(h.d).querySelector('.fld-err')?.textContent || '', /path is not a directory/, 'a refusal keeps the form with dev\'s message');
  page(h.d).querySelector('#pj-hand-v').value = '~/src/seed-moved-now'; yes(h.d).click(); await settle(150);
  assert.deepEqual(sent(h.calls).at(-1), ['PATCH', `/api/projects/${KEYS.moved}`, { path: '~/src/seed-moved-now' }]);
});

test('F-5-05 = F-6-02: Add by hand and Locate folder open the page of what was added or moved, never "There is no project called"', async () => {
  const NEW = 'seed-moved-9999cccc', ADDED = 'brand-new-1234abcd';
  const rec = (key, name) => ({ key, name, path: `/src/${name}`, displayPath: `~/src/${name}`, exists: true, vcs: 'git', ownedFolder: false });
  let list = clone(PJ_SOURCES.projects.projects), held = null;
  const g = gate();
  const h = await projectsHost({ hash: `#projects/${KEYS.moved}`,
    hold: (u) => (u === '/api/projects' && held ? held : null),
    read: (u) => (u === '/api/projects' ? [200, { projects: list }] : null),
    write: (u, b, m) => {
      if (m === 'PATCH') { list = [...list.filter((p) => p.key !== KEYS.moved), rec(NEW, 'seed-moved')]; return [200, { project: { key: NEW }, previousKey: KEYS.moved }]; }
      const name = b.name, key = name === 'brand-new' ? ADDED : 'late-one-5678abcd';
      if (name === 'late-one') held = g.p;   // the store's next read of the list is held
      list = [...list, rec(key, name)];
      return [200, { ok: true, projects: [{ key, name }] }];
    } });
  const noGone = () => assert.ok(!/There is no project called/.test(page(h.d).textContent), page(h.d).textContent.slice(0, 200));
  page(h.d).querySelector('[data-pj-act]').click(); await settle(80);
  page(h.d).querySelector('#pj-hand-v').value = '~/src/seed-moved-now'; yes(h.d).click(); await until(() => h.w.location.hash === `#projects/${NEW}`); await settle(100);
  assert.equal(h.w.location.hash, `#projects/${NEW}`, 'D8: the page goes to the new key');
  noGone();
  assert.ok(page(h.d).querySelector('#pj-dock'), 'the moved project\'s page');
  await go(h.w, '#projects', 150);
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  page(h.d).querySelector('#pj-hand-v').value = '~/src/brand-new'; yes(h.d).click(); await settle(60);
  assert.ok(heldWith(yes(h.d), 'Adding…'), 'Add holds Adding… while the store reads the list');
  await until(() => h.w.location.hash === `#projects/${ADDED}`); await settle(100);
  assert.deepEqual(sent(h.calls).at(-1), ['POST', '/api/projects', { name: 'brand-new', path: '~/src/brand-new' }]);
  assert.equal(h.w.location.hash, `#projects/${ADDED}`);
  noGone();
  assert.match(page(h.d).textContent, /brand-new/, 'its page, with its name');
  assert.ok(page(h.d).querySelector('#pj-dock'));
  await go(h.w, '#projects', 150);   // D4: a person who moves on during the wait stays where they went
  h.w.RailPlaces.projects.newPick('hand-project'); await settle(100);
  const lists = () => h.calls.filter((c) => c.method === 'GET' && c.url === '/api/projects').length, before = lists();
  page(h.d).querySelector('#pj-hand-v').value = '~/src/late-one'; yes(h.d).click(); await until(() => lists() > before);   // the store's read after the add, held
  await go(h.w, '#chat', 100);
  held = null; g.open(); await until(() => h.w.RailProjects.list().some((p) => p.name === 'late-one')); await settle(600);
  assert.equal(h.w.location.hash, '#chat');
});

test('Remove sends the DELETE only after the undo window; an owned folder\'s strip says the folder goes and sends deleteFolder=1', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.owned}`, beforeScripts: undoTimers });
  const timers = h.w.__undo;
  pickMore(h.d, 'remove'); await settle(80);
  assert.match(page(h.d).textContent, /Worca made its folder, so the folder goes too/);
  yes(h.d).click(); await settle(80);
  assert.equal(sent(h.calls).length, 0, 'nothing before the undo window closes');
  assert.ok(!h.d.getElementById('bar-place').textContent.includes('seed-owned'), 'hidden at once');
  for (const fn of timers.splice(0)) await fn();
  await settle(80);
  assert.deepEqual(sent(h.calls), [['DELETE', '/api/projects?name=seed-owned&deleteFolder=1', undefined]]);
  const n = h.calls.length;
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'projects-changed', action: 'removed' }) }); await settle(400);   // F-6-18
  assert.deepEqual(h.calls.slice(n).filter((c) => c.method === 'GET' && c.url.startsWith(`/api/projects/${KEYS.owned}/`)).map((c) => c.url), [], 'no read of the removed project');
  assert.ok(!h.d.getElementById('bar-place').textContent.includes('seed-owned'), 'its row does not flash back');
});

test('How its tasks run sends PATCH …/settings; Use yours sends null; Cost tags send PUT …/tags/defaults; a refused Team memory keeps the switch', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, write: (u, b, m) => (b && 'memory.team' in b ? [400, { error: 'This project has no origin', code: 'NO_ORIGIN' }] : m === 'PATCH' ? [200, { own: { 'pr.open': b['pr.open'] }, effective: { 'pr.open': { value: b['pr.open'] ?? 'none', source: b['pr.open'] ? 'project' : 'user' } }, layers: { 'pr.open': { user: 'none', default: 'none' } } }] : [200, b]) });
  await settle(150);
  page(h.d).querySelector('[data-menu="pjs-pr"]').click(); page(h.d).querySelector('[data-menu-pick="pjs-pr|create a draft PR"]').click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PATCH', `/api/projects/${KEYS.ok}/settings`, { 'pr.open': 'draft' }]);
  page(h.d).querySelector('[data-pj-reset="pr"]').click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PATCH', `/api/projects/${KEYS.ok}/settings`, { 'pr.open': null }]);
  page(h.d).querySelector('[data-def-edit="tags"]').click(); await settle(30);
  h.d.getElementById('def-tags').value = 'team: web, cost-center: 4410';
  page(h.d).querySelector('[data-def-edit="tags"]').click(); await settle(120);
  assert.deepEqual(sent(h.calls).at(-1), ['PUT', `/api/projects/${KEYS.ok}/tags/defaults`, { tags: ['team: web', 'cost-center: 4410'], labels: [] }]);
  const sw = () => page(h.d).querySelector('[data-pj-team]');
  assert.equal(sw().getAttribute('aria-checked'), 'false');
  sw().click(); await settle(150);
  assert.match(saidText(h.d), /Could not change seed-ok: This project has no origin/);
  assert.equal(sw().getAttribute('aria-checked'), 'false', 'the switch stays');
});

test('fit: while its settings are still being read (or failed), Change, Who pays and Team memory are off and a Labels change sends no PUT', async () => {
  const g = gate();
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, hold: (u) => (u === `/api/projects/${KEYS.ok}/settings` ? g.p : null) });
  await settle(150);
  const change = rowButton(h.d, 'Labels');
  assert.ok(change && change.disabled, 'Change is off while the settings are read');
  change.click(); await settle(60);
  assert.equal(h.d.getElementById('def-labels'), null, 'no field opens');
  assert.equal(page(h.d).querySelector('[data-pj-team]').disabled, true, 'the Team memory switch is off');
  assert.deepEqual(sent(h.calls), [], 'nothing is written from defaults not read yet');
  g.open(); await settle(200);
  assert.equal(rowButton(h.d, 'Labels').disabled, false, 'once read, Change is on');
});

// slice 10 D19: the project page's spend fact is this month's stats answer, its project row by name
const MONTH = '/api/stats?range=month&report=1';
const monthAnswer = { bucket: 'day', windowStartMs: 0, windowEndMs: 1, humanRateUsd: 0, totals: { spentUsd: 15.5, runs: 2 }, prev: null, series: [],
  report: { buckets: [], prevRuns: null, runs: [{ id: 'a', person: null, project: 'seed-ok', workflow: null, status: 'finished', pr: null, tags: {}, usd: 12.4, hours: 0, inCohort: true, startedMs: 1, hourBucket: -1, spend: [] },
    { id: 'b', person: null, project: 'seed-local', workflow: null, status: 'finished', pr: null, tags: {}, usd: 3.1, hours: 0, inCohort: true, startedMs: 1, hourBucket: -1, spend: [] }] } };

test('live, the page holds no stand-in: no "not in Stillhet yet", no RailWould, no Branch names row; the spend fact is dev\'s (slice 10 D19)', async () => {
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, read: (u) => (u === MONTH ? [200, monthAnswer] : null) });
  noWould(h.w);
  await settle(150);
  const t = page(h.d).textContent;
  assert.ok(!/not in Stillhet yet/.test(t));
  assert.ok(!/Branch names/.test(t), 'D19: Branch names (slice 12) is not drawn live');
  assert.match(t, /\$12\s*this month/, 'the project row of this month\'s stats answer');
  assert.ok(/Pull requests/.test(t), 'its settings are drawn from dev\'s answer');
  assert.deepEqual(h.w.__would, []);
  assert.ok(h.calls.filter((c) => c.url === MONTH).length >= 1);
});

test('slice 10 D19: while the month read is held, the project page draws no spend fact; the workspace head sums its members', async () => {
  const g = gate();
  const h = await projectsHost({ hash: `#projects/${KEYS.ok}`, hold: (u) => (u === MONTH ? g.p : null), read: (u) => (u === MONTH ? [200, monthAnswer] : null) });
  await settle(150);
  assert.ok(!/this month/.test(page(h.d).textContent), 'no spend fact while reading');
  g.open(); await settle(200);
  assert.match(page(h.d).textContent, /\$12\s*this month/);
  await go(h.w, '#projects/ws:wks-seed-shop-8888bbbb', 150); await settle(150);
  assert.match(page(h.d).textContent, /\$16 this month/, 'seed-ok and seed-local: $12.40 + $3.10');
});

test('the demo kind sends nothing: Remove, Rename and a setting change only the demo', async (t) => {
  const calls = [];
  const w = stillhetHost({ hash: '#projects/worca-cc', after: (fn) => t.after(fn), fetch: async (u, o = {}) => { calls.push([o.method || 'GET', String(u)]); return { ok: true, status: 200, json: async () => ({}) }; } });
  await settle(120);
  const d = w.document;
  pickMore(d, 'rename'); await settle(80);
  page(d).querySelector('#pj-hand-v').value = 'worca'; yes(d).click(); await settle(80);
  assert.equal(w.RailProjects.all().find((p) => p.id === 'worca-cc').name, 'worca', 'D7: the demo sets its name; the id stays');
  pickMore(d, 'remove'); await settle(80); yes(d).click(); await settle(80);
  assert.deepEqual(calls.filter(([m]) => m !== 'GET'), []);
});

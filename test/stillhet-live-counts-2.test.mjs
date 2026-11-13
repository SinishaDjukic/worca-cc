// test/stillhet-live-counts-2.test.mjs — the live kind in the app host, part 2 of 3: every count of the bar, Pulse and the
// bell equals its source and opens what it counts; the store is written only by the adapter; a refused action changes
// nothing and says so; the mode is dev's uiLevel. The host is test/helpers/stillhet-live-counts-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSE, clone, liveHost, openAcct, refusalHost, settle, store, toastText, closeHosts } from './helpers/stillhet-live-counts-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('Projects: a project whose key is not its name joins its tasks by name (api-2 is api)', async () => {
  const { w, d, hello } = await liveHost({ hash: '#projects' });
  await hello(); await settle();
  // api's tasks by dev's rule: run-c (paused at a limit) and h1 (paused); its sync state alone would say "Out of sync"
  assert.match(d.getElementById('bar-place').textContent, /api2 tasks need you/, 'its waiting tasks are counted');
  w.location.hash = '#projects/api-2'; await settle();
  d.querySelector('#route-place [data-menu="pj-more"]').click();
  d.querySelector('#route-place [data-menu-pick="pj-more|tasks"]').click(); await settle();
  const titles = [...d.querySelectorAll('#bar-tasks [data-open]')].map((x) => x.textContent);
  assert.ok(titles.some((t) => t.includes('At a limit')), 'Show its tasks lists its task');
  assert.ok(!titles.some((t) => t.includes('Busy')), 'and not another project\'s');
});

test('Projects in the live kind: its actions write nothing to the store and say they are not in Stillhet yet', async () => {
  const { w, d, hello } = await liveHost({ hash: '#projects' });
  await hello();
  w.location.hash = '#projects/api-2'; await settle();
  const was = store(w);
  const page = () => d.getElementById('route-place');
  const tried = [];
  const clickIf = (q, label) => { const b = page().querySelector(q); if (b) { b.click(); tried.push(label); } };
  const pick = (v) => { page().querySelector('[data-menu="pj-more"]')?.click(); const b = page().querySelector(`[data-menu-pick="pj-more|${v}"]`); if (b) { b.click(); tried.push(v); } };
  pick('fetch'); pick('remove');
  assert.equal(page().querySelector('[data-confirm="yes"]'), null, 'Remove asks nothing it cannot do');
  clickIf('[data-pj-team]', 'team memory');
  page().querySelector('[data-menu="pjs-pr"]')?.click(); clickIf('[data-menu-pick="pjs-pr|open no PR"]', 'a setting');
  clickIf('[data-def-edit="tags"]', 'tags edit');
  const f = d.getElementById('def-tags'); if (f) f.value = 'team: web';
  clickIf('[data-def-edit="tags"]', 'tags done');
  w.RailProjects.sync('api-2');
  clickIf('[data-pj-act]', 'origin act');   // diverged: Bring together hands over to a chat, writing nothing
  await settle();
  for (const x of ['origin act', 'fetch', 'remove', 'team memory', 'a setting', 'tags done']) assert.ok(tried.includes(x), `reached ${x}`);
  assert.deepEqual(store(w), was, 'no store write outside load');
  assert.equal(w.RailProjects.list().find((p) => p.id === 'api-2').teamMemory, undefined);
  w.location.hash = '#projects/gone-3'; await settle();
  page().querySelector('[data-pj-act]').click(); await settle();
  assert.equal(page().querySelector('#pj-hand-v'), null, 'Locate folder opens no form that would fake a move');
  assert.match(toastText(d), /not in Stillhet yet/);
  assert.deepEqual(store(w), was);
});

test('R-arch-10: every action of an area this slice does not wire goes through the adapter, refuses and changes nothing', async () => {
  const { w, d, posts, hello } = await liveHost({ level: 'expert' });
  await hello();
  const acts = [];
  const act = w.RailAdapter.act; w.RailAdapter.act = (id, args) => { const r = act(id, args); acts.push(`${id}: ${r.ok ? 'done' : r.text}`); return r; };
  const html = (id) => d.getElementById(id)?.innerHTML ?? '';
  const pickIn = (root, menu, v) => { d.querySelector(`${root} [data-menu="${menu}"]`).click(); const b = d.querySelector(`${root} [data-menu-pick="${menu}|${v}"]`); assert.ok(b, `${menu}|${v} is offered`); b.click(); };
  const sched = async () => { w.location.hash = '#chat'; await settle(); w.location.hash = '#schedule/sr1'; await settle(); };
  const cases = [
    // Schedules (slice 6): the page's Run now, its ⋯ menu and its time pickers; the API other pages call
    ['schedules.run', sched, () => d.querySelector('#route-schedule [data-sched-now]').click(), 'route-schedule'],
    ...['pause', 'skip', 'delete'].map((v) => [`schedules.${v}`, sched, () => pickIn('#route-schedule', 'sc-more', v), 'route-schedule']),
    ['schedules.sc-at', sched, () => { d.querySelector('#route-schedule [data-menu="sc-at"]').click(); [...d.querySelectorAll('#route-schedule [data-menu-pick^="sc-at|"]')].find((b) => !b.dataset.menuPick.endsWith('|02:00')).click(); }, 'route-schedule'],
    ['schedules.add', null, () => w.RailSchedules.add({ id: 'x1', title: 'Made up', every: 'every day', at: '03:00', runs: [] }), 'bar-schedules'],
    // the Tasks center's Run now on a missed schedule (the reviewer's path to RailWorld.add)
    ['schedules.run', async () => { w.location.hash = '#runs'; await settle(); }, () => d.querySelector('[data-c-sact="run|tk1"]').click(), 'app'],
    // the Tasks center's New task… form is wired by the Tasks slice (D12b, test/stillhet-tasks-list-host.test.mjs)
    // Chat (slice 4): the composer, the dock under a schedule, the chat list's row menu
    // Projects' workspaces (the Projects slice)
    ['workspaces.add', null, () => assert.equal(w.RailSpaces.add({ title: 'Made up' }), ''), 'app'],
    // Settings: a switch and an edit that would say "saved"
    ['settings.sync', async () => { w.location.hash = '#settings'; await settle(); }, () => d.querySelector('[data-svsw="sync"]').click(), 'app'],
    ['settings.save', async () => { w.location.hash = '#settings'; await settle(); }, () => { d.querySelector('[data-svdo="runs/Spending/Budget/Change…"]').click(); const f = d.querySelector('dialog input, .dlg input'); f.value = '5'; f.dispatchEvent(new w.Event('input', { bubbles: true })); d.querySelector('[data-dialog="yes"]').click(); }, 'app'],
  ];
  for (const [id, go, run, root] of cases) {
    if (go) await go();
    const before = store(w), page = html(root), schedules = clone(w.RailSchedules.all()), chats = clone(w.RailChats.data()), n = acts.length, p = posts.length;
    run(); await settle();
    assert.deepEqual(acts.slice(n), [`${id}: ${w.RailAdapter.NOT_CONNECTED}`], `${id}: one refusal, through RailAdapter.act`);
    if (!n) assert.equal(w.RailHost.toastEl.textContent, w.RailAdapter.NOT_CONNECTED, 'the app host\'s toast says so (once in 3 s, adapter.js)');
    assert.deepEqual(store(w), before, `${id}: the store is unchanged`);
    assert.deepEqual(clone(w.RailSchedules.all()), schedules, `${id}: the schedules are unchanged`);
    assert.deepEqual(clone(w.RailChats.data()), chats, `${id}: the chats are unchanged`);
    assert.equal(html(root), page, `${id}: the page is unchanged`);
    assert.equal(posts.length, p, `${id}: nothing sent to Worca`);
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  assert.equal(w.RailSpaces.list().length, 0);
});


test('every Step 5 action, refused: one toast "Could not ACTION: REASON", the store deep-equal, a toggle keeps its value', async () => {
  const { w, d, posts } = await refusalHost();
  const pop = () => d.querySelector('#app .pz-popover');
  const cases = [
    ['Resume', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh1"]').click(); }, 'resume', '/api/resume'],
    ['Try again', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh3"]').click(); }, 'try again', '/api/resume'],
    ['Run now', () => { w.RailPulse.open('updates'); pop().querySelector('[data-fix="n7"]').click(); }, 'run now', '/api/schedules/tk1/run-now'],
    ['Stop', () => { w.RailPulse.open('now'); pop().querySelector('[data-act-stop="i1"]').click(); }, 'stop Dev server :4417', '/api/actions/instances/i1/stop'],
    ['Mark read', () => { w.RailPulse.open('updates'); pop().querySelector('[data-open="n7"]').click(); }, 'mark it read', '/api/notifications/7/read'],
    ['Mark all read', () => { w.RailPulse.open('updates'); pop().querySelector('[data-menu="more"]').click(); d.querySelector('[data-menu-pick="more|allread"], [data-pick="more|allread"]').click(); }, 'mark all read', '/api/notifications/read-all'],
    ['Interface mode', () => { openAcct(d); d.querySelector('[data-sub="lvl"]').click(); d.querySelector('#app [data-level="simple"]').click(); }, 'change the interface mode', '/api/settings'],
    ['Keep awake', () => { openAcct(d); d.querySelector('[data-sw="keep"]').click(); }, 'change Keep awake', '/api/settings'],
    ['Away', () => { openAcct(d); d.querySelector('[data-sw="away"]').click(); }, 'change Away', '/api/settings'],
  ];
  for (const [name, act, what, url] of cases) {
    const before = store(w), mode = w.RailUI.prefs.mode(), n = posts.length;
    w.location.hash = '#chat'; await settle();
    act(); await settle();
    assert.equal(posts.length, n + 1, `${name}: one post`);
    assert.equal(posts.at(-1).url, url, name);
    assert.equal(toastText(d), `Could not ${what}: ${REFUSE.error}`, name);
    assert.deepEqual(store(w), before, `${name}: the store is unchanged`);
    assert.equal(w.RailUI.prefs.mode(), mode, `${name}: the mode is unchanged`);
    if (name === 'Keep awake') { openAcct(d); assert.equal(d.querySelector('[data-sw="keep"]').getAttribute('aria-checked'), 'true', 'Keep awake stays on'); }
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

test('every Step 5 action posts dev\'s route and body; no "Would…" in the app host', async () => {
  let would = 0;
  const { w, d, posts, hello } = await liveHost({ post: (url) => [200, url === '/api/settings' ? { uiLevel: 'simple', keepAwake: false } : { ok: true }] });
  await hello();
  const wrap = w.RailWould; w.RailWould = (p) => { would++; return wrap(p); };
  const pop = () => d.querySelector('#app .pz-popover');
  w.RailPulse.open('updates'); pop().querySelector('[data-fix="oh1"]').click(); await settle();
  w.RailPulse.open('updates'); pop().querySelector('[data-fix="n7"]').click(); await settle();
  w.RailPulse.open('now'); pop().querySelector('[data-act-stop="i1"]').click(); await settle();
  openAcct(d); d.querySelector('[data-sw="keep"]').click(); await settle();
  openAcct(d); d.querySelector('[data-sw="away"]').click(); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [
    ['/api/resume', { pipelineId: 'h1', baseCheck: true }],
    ['/api/schedules/tk1/run-now', {}],
    ['/api/actions/instances/i1/stop', {}],
    ['/api/settings', { keepAwake: false }],
    ['/api/settings', { nightModeToggle: 'on' }],
  ]);
  assert.match(toastText(d), /^Away: /);
  assert.equal(would, 0);
});

test('a resume that dev answers with a confirm opens the task instead', async () => {
  const { w, d, hello } = await liveHost({ post: () => [409, { code: 'base-moved', error: 'the base moved' }] });
  await hello();
  w.RailPulse.open('updates');
  d.querySelector('#app .pz-popover [data-fix="oh1"]').click(); await settle();
  assert.equal(w.location.hash, '#run/paused-restart');
  assert.match(d.getElementById('route-today').textContent, /Old pause/);
});

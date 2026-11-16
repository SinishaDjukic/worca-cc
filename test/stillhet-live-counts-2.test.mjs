// test/stillhet-live-counts-2.test.mjs — the live kind in the app host, part 2 of 3: every count of the bar, Pulse and the
// bell equals its source and opens what it counts; the store is written only by the adapter; a refused action changes
// nothing and says so; the mode is dev's uiLevel. The host is test/helpers/stillhet-live-counts-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { REFUSE, SOURCES, clone, liveHost, openAcct, refusalHost, settle, store, toastText, closeHosts } from './helpers/stillhet-live-counts-host.mjs';

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

test('Projects in the live kind (slice 9): each action sends dev\'s route; the store moves only on a read', async () => {
  const { w, d, posts, hello } = await liveHost({ hash: '#projects' });
  await hello();
  w.location.hash = '#projects/api-2'; await settle();
  const was = store(w);
  const page = () => d.getElementById('route-place');
  const pick = (v) => { page().querySelector('[data-menu="pj-more"]').click(); page().querySelector(`[data-menu-pick="pj-more|${v}"]`).click(); };
  pick('fetch'); await settle();
  w.RailProjects.sync('api-2'); await settle();
  page().querySelector('[data-pj-act]').click(); await settle();   // diverged: Bring together hands over to a chat, writing nothing
  assert.deepEqual(posts.map((p) => [p.method, p.url, p.body]), [['POST', '/api/projects/api-2/sync', { mode: 'fetch' }], ['POST', '/api/projects/api-2/sync', { mode: 'ff' }]]);
  assert.deepEqual(store(w), was, 'no store write outside a read');
  w.location.hash = '#projects/gone-3'; await settle();
  page().querySelector('[data-pj-act]').click(); await settle(80);
  page().querySelector('#pj-hand-v').value = '~/src/gone-3-here';
  page().querySelector('[data-confirm="yes"]').click(); await settle();
  assert.deepEqual(posts.at(-1), { url: '/api/projects/gone-3', method: 'PATCH', body: { path: '~/src/gone-3-here' } }, 'Locate folder sends dev\'s PATCH (D8)');
  assert.doesNotMatch(toastText(d), /not in Stillhet yet/);
});

test('R-arch-10: every action of an area this slice does not wire goes through the adapter, refuses and changes nothing', async () => {
  const { w, d, posts, hello } = await liveHost({ level: 'expert' });
  await hello();
  const acts = [];
  const act = w.RailAdapter.act; w.RailAdapter.act = (id, args) => { const r = act(id, args); acts.push(`${id}: ${r.ok ? 'done' : r.text}`); return r; };
  const html = (id) => d.getElementById(id)?.innerHTML ?? '';
  const cases = [
    // Schedules: wired by the Schedules slice (test/stillhet-schedules-actions-host.test.mjs), so none of its actions refuses here
    // the Tasks center's New task… form is wired by the Tasks slice (D12b, test/stillhet-tasks-list-host.test.mjs)
    // Chat (slice 4): the composer, the dock under a schedule, the chat list's row menu
    // Settings: settings.sync left with #1324: on a live instance the sample Sync row reads "Not in Stillhet yet" with no switch (B1.2, F-7b-03…F-7b-13), so there is nothing to refuse (test/stillhet-settings-not-live-rows.test.mjs)
    // settings.save (Spending › Budget › Change…) left with #1315: on a live instance the sample Budget row is not drawn at all (B1.1), so there is nothing to refuse
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
  w.location.hash = '#settings'; await settle();
  assert.equal(d.querySelector('[data-svsw="sync"]'), null, 'live Settings draws no Sync switch to refuse (B1.2)');
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
    ['Pulse icon', async () => { await openPulseFor(w, d); d.querySelector('[data-menu-pick="pulseFor|never"]').click(); }, 'change the Pulse icon', '/api/settings'],
  ];
  for (const [name, act, what, url] of cases) {
    const before = store(w), mode = w.RailUI.prefs.mode(), n = posts.length;
    w.location.hash = '#chat'; await settle();
    await act(); await settle();
    assert.equal(posts.length, n + 1, `${name}: one post`);
    assert.equal(posts.at(-1).url, url, name);
    assert.equal(toastText(d), `Could not ${what}: ${REFUSE.error}`, name);
    assert.deepEqual(store(w), before, `${name}: the store is unchanged`);
    assert.equal(w.RailUI.prefs.mode(), mode, `${name}: the mode is unchanged`);
    if (name === 'Pulse icon') assert.match(pulseForRow(d).textContent, /shakes until you read or act on it/, 'the Pulse icon keeps its value');
    if (name === 'Keep awake') { openAcct(d); assert.equal(d.querySelector('[data-sw="keep"]').getAttribute('aria-checked'), 'true', 'Keep awake stays on'); }
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
});

// Settings › Notifications › Pulse icon in the live kind: dev's settings.json pulseFor through /api/settings
const pulseForRow = (d) => [...d.querySelectorAll('.set-row')].find((r) => /Pulse icon/.test(r.textContent));
async function openPulseFor(w, d) {
  w.location.hash = '#settings/notifications'; await settle();
  d.querySelector('[data-menu="pulseFor"]').click();
}
const pulseNews = (d) => d.querySelector('#rail-pulse-slot .pz-pulse-b').classList.contains('is-news');

test('live: picking Pulse icon posts {pulseFor} to /api/settings and keeps the value on ok', async () => {
  const { w, d, posts, hello } = await liveHost({ post: (url, body) => [200, url === '/api/settings' ? { ...body } : { ok: true }] });
  await hello();
  await openPulseFor(w, d);
  d.querySelector('[data-menu-pick="pulseFor|10s"]').click(); await settle();
  assert.deepEqual(posts.map((p) => [p.url, p.body]), [['/api/settings', { pulseFor: '10s' }]]);
  assert.match(pulseForRow(d).textContent, /shakes for 10 seconds/);
});

test('live: a settings-changed re-fetch with pulseFor \'never\' stops a running icon', async () => {
  const sources = clone(SOURCES);
  const { w, d, sockets, hello } = await liveHost({ sources });
  await hello();
  w.RailPulse.newEvent('problem'); await settle();
  assert.equal(pulseNews(d), true, 'the icon has news');
  sources.settings.pulseFor = 'never';   // another tab saved it
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'settings-changed', action: null }) }); await settle(400);   // the adapter's re-fetch is debounced (250 ms)
  assert.equal(w.RailWorld.part('pulseFor'), 'never');
  assert.equal(pulseNews(d), false, 'the running icon stops without a reload');
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
  assert.equal(w.location.hash, '#run/h1', 'the task oh1 names (history row h1), by its id, never the case (#1266)');
});

// Pulse Needs you, project items (#1298): each names its figures, its effect and its one fix
const quiet = (edit) => { const s = clone(SOURCES); s.hello.runs = [s.hello.runs[1]]; s.history.pipelines = s.history.pipelines.filter((p) => p.status !== 'paused'); edit?.(s); return s; };   // no task waits on api
const behind = (settings) => quiet((s) => { s.sync.projects['api-2'] = { base: 'main', remote: 'origin', state: 'behind', ahead: 0, behind: 3, fetchedAt: SOURCES.sync.projects['api-2'].fetchedAt, ...(settings ? { settings } : {}) }; });
const needRow = (d, key) => d.querySelector(`#app .pz-popover [data-open="np:projects/${key}"]`);

test('Pulse Needs you, a behind project: its count, effect and \'Clears when you sync it\'; Sync on the item posts /api/projects/KEY/sync {mode:\'ff\'} and the item leaves after the re-read', async () => {
  const src = behind();
  let release; const held = new Promise((r) => { release = r; });
  const { w, d, posts, hello } = await liveHost({ sources: src, post: async (u) => { if (u === '/api/projects/api-2/sync') { await held; src.sync.projects['api-2'] = { ...src.sync.projects['api-2'], state: 'up-to-date', behind: 0 }; return [200, { sync: { ff: { ok: true } } }]; } return [200, {}]; } });
  await hello();
  d.querySelector('[data-pop]').click();
  const item = needRow(d, 'api-2');
  assert.ok(item, 'the behind project is in Needs you');
  assert.match(item.textContent, /3 commits behind origin\/main · Each new task syncs it first · Clears when you sync it/);
  const hash = w.location.hash;
  const sync = () => d.querySelector('#app .pz-popover [data-fix="np:projects/api-2"]');
  assert.equal(sync().textContent.trim(), 'Sync');
  sync().click(); await settle();
  assert.equal(sync().textContent.trim(), 'Syncing…', 'it says what it is doing');
  assert.equal(sync().disabled, true, 'and a second press is out of reach');
  sync().click(); await settle();
  assert.equal(w.location.hash, hash, 'Sync does not open the row');
  release(); await settle(400);   // the store's re-read is debounced (DEBOUNCE_MS)
  assert.deepEqual(posts.filter((p) => p.url === '/api/projects/api-2/sync').map((p) => p.body), [{ mode: 'ff' }], 'two presses, one POST');
  if (!d.querySelector('#app .pz-popover')) d.querySelector('[data-pop]').click();
  assert.equal(needRow(d, 'api-2'), null, 'synced: the item left Needs you after the re-read');
  closeHosts();
  // dev's before-run sync off: the effect says so; a dirty copy is refused by dev and the item stays
  const off = await liveHost({ sources: behind({ beforeRun: false }), post: (u) => (u === '/api/projects/api-2/sync' ? [200, { sync: { ff: { ok: false, kind: 'dirty' } } }] : [200, {}]) });
  await off.hello();
  off.d.querySelector('[data-pop]').click();
  assert.match(needRow(off.d, 'api-2').textContent, /3 commits behind origin\/main · New tasks start from older code · Clears when you sync it/);
  off.d.querySelector('#app .pz-popover [data-fix="np:projects/api-2"]').click(); await settle(80);
  assert.match(toastText(off.d), /Could not sync api: it has uncommitted changes/);
  if (!off.d.querySelector('#app .pz-popover')) off.d.querySelector('[data-pop]').click();
  assert.ok(needRow(off.d, 'api-2'), 'refused: the item stays, so Sync can be pressed again');
});

test('a diverged project\'s item opens its page with Bring together… focused; with a task question waiting, the More menu opens on it; a missing one opens Locate folder', async () => {
  const landedOn = (d) => { const a = d.activeElement; return [a?.querySelector('.mi-l')?.textContent.trim() || a?.textContent.trim(), a?.hasAttribute('data-landed')]; };
  const plain = await liveHost({ sources: quiet() });
  await plain.hello();
  plain.d.querySelector('[data-pop]').click();
  assert.match(needRow(plain.d, 'api-2').textContent, /1 ahead, 2 behind origin\/main · The next task asks how to bring them together · Clears when you bring them together/);
  assert.equal(needRow(plain.d, 'api-2').querySelector('[data-fix]'), null, 'no button on a diverged item');
  needRow(plain.d, 'api-2').click(); await settle(120);
  assert.equal(plain.w.location.hash, '#projects/api-2');
  assert.ok(plain.d.activeElement?.matches('[data-pj-act]'), 'the head\'s fix has the focus');
  assert.deepEqual(landedOn(plain.d), ['Bring together…', true]);
  closeHosts();
  // run-a's question waits on api, in its chat: the head holds the question's button, so the fix is the More menu's act item
  const onApi = clone(SOURCES);
  onApi.threads.threads = onApi.threads.threads.map((t) => (t.id === 'ask_1' ? { ...t, context: { projectKey: 'api-2' } } : t));   // its chat works in api
  const asks = await liveHost({ sources: onApi });
  await asks.hello();
  asks.d.querySelector('[data-pop]').click();
  needRow(asks.d, 'api-2').click(); await settle(120);
  assert.ok(asks.d.querySelector('#route-place [data-menu-pick="pj-more|act"]'), 'the More menu is open');
  assert.ok(asks.d.activeElement?.matches('[data-menu-pick="pj-more|act"]'));
  assert.deepEqual(landedOn(asks.d), ['Bring together…', true]);
  // gone-3's folder is missing: Locate folder's form
  asks.d.querySelector('[data-pop]').click();
  assert.match(needRow(asks.d, 'gone-3').textContent, /Its folder is gone · New tasks cannot start here · Clears when you locate its folder/);
  needRow(asks.d, 'gone-3').click(); await settle(120);
  assert.equal(asks.w.location.hash, '#projects/gone-3');
  assert.ok(asks.d.querySelector('#route-place #pj-hand-v'), 'the Locate folder form is open');
});

// test/stillhet-live-counts-1.test.mjs — the live kind in the app host, part 1 of 3: every count of the bar, Pulse and the
// bell equals its source and opens what it counts; the store is written only by the adapter; a refused action changes
// nothing and says so; the mode is dev's uiLevel. The host is test/helpers/stillhet-live-counts-host.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BELL, DEMO_NAMES, MISSED, NOW, SOURCES, TASK_NEEDS, bellN, clone, countNeedsYou, liveHost, settle, store, closeHosts } from './helpers/stillhet-live-counts-host.mjs';

afterEach(closeHosts);   // each test's window closes when the test ends
test('before the first snapshot: no rows, the loading look in the bar and Pulse, no number on the bell', async () => {
  const { w, d } = await liveHost();
  assert.equal(w.RailAdapter.kind, 'live');
  assert.equal(w.RailDemoState.list, 'loading');
  assert.equal(w.RailWorld.data().runs.length, 0);
  assert.equal(bellN(d), null);
  w.RailPulse.open('now');
  assert.match(d.querySelector('#app .pz-popover').textContent, /Loading updates…/);
  await settle(350);
  assert.match(d.getElementById('bar-chat').textContent, /Loading chats…/);
  for (const n of DEMO_NAMES) assert.ok(!d.body.textContent.includes(n), `no seeded ${n}`);
});

test('the bell: tasks by dev\'s rule, missed schedules and projects that need you; the tab title follows it', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  assert.equal(w.RailDemoState.list, '');
  const live = SOURCES.hello.runs.map((r) => ({ pipelineId: r.pipelineId, status: r.status, ask: !!r.pendingQuestion }));
  assert.equal(countNeedsYou({ live, history: SOURCES.history.pipelines.filter((p) => !p.archived) }), TASK_NEEDS);
  assert.equal(SOURCES.schedules.counts.missed, MISSED);
  assert.equal(bellN(d), BELL);
  assert.equal(d.title, `(${BELL}) Worca`, 'Badge "what needs you": the tab title counts the same');
  assert.match(d.querySelector('[data-pop]').title, /6 need you \(3 tasks, 1 missed schedule, 2 projects\)/);
  for (const n of DEMO_NAMES) assert.ok(!d.body.textContent.includes(n), `no seeded ${n}`);
});

test('with nothing that needs you the bell has no number; its words say the unread updates (look.alert-ladder)', async () => {
  const calm = clone(SOURCES);
  calm.hello.runs = [calm.hello.runs[1]];
  calm.history.pipelines = calm.history.pipelines.filter((p) => p.status !== 'paused');
  calm.schedules.tickets = calm.schedules.tickets.filter((t) => t.status !== 'missed');
  calm.schedules.counts.missed = 0;
  calm.projects.projects = calm.projects.projects.filter((p) => p.exists && p.key !== 'api-2');
  const { w, d, hello } = await liveHost({ sources: calm });
  await hello();
  assert.equal(bellN(d), null);
  w.RailPulse.open('updates');
  const unread = d.querySelectorAll('#app .pz-popover [data-open]').length;
  assert.ok(unread > 0);
  assert.match(d.querySelector('[data-pop]').title, new RegExp(`${unread} unread`));
  assert.equal(d.title, 'Worca');
});

test('the strip, Pulse\'s tabs and sections equal their rows, and each opens what it counts', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  const mini = (p) => d.querySelector(`[data-mini="${p}"]`).getAttribute('aria-label');
  assert.match(mini('runs'), new RegExp(`· ${TASK_NEEDS + MISSED} need you`), 'Tasks: the tasks and the missed time that need you');
  assert.match(mini('chat'), new RegExp(`· ${SOURCES.threads.counts.needs} need`), 'Chats: counts.needs of the threads');
  assert.equal(mini('schedules'), 'Schedules: 3 open · 1 need you', 'Schedules: tk1, tk2 and sr1 open (sr2 is paused); tk1 missed');
  d.querySelector('[data-mini="runs"]').click(); await settle();
  assert.equal(w.location.hash, '#runs');
  d.querySelector('[data-mini="chat"]').click(); await settle();
  assert.equal(w.location.hash, '#chat');
  d.querySelector('[data-mini="schedules"]').click(); await settle();
  assert.equal(w.location.hash, '#schedules');
  d.querySelector('[data-pop]').click();
  const pop = () => d.querySelector('#app .pz-popover');
  assert.equal(pop().querySelector('[data-ptab="vitals"]').getAttribute('aria-selected'), 'true', 'the bell opens Now');
  const tabN = (id) => +pop().querySelector(`[data-ptab="${id}"]`).textContent.replace(/\D+/g, ' ').trim().split(' ').pop();
  const secs = [...pop().querySelectorAll('.pz-sec')];
  let rows = 0;
  for (const s of secs) { const n = +s.querySelector('.pz-h .n').textContent.split(' ')[0]; const r = s.querySelectorAll('[data-open], [data-row]').length; assert.equal(new Set([...s.querySelectorAll('[data-open]')].map((x) => x.dataset.open)).size, n, s.querySelector('.pz-h').textContent); rows += n; void r; }
  assert.equal(tabN('vitals'), rows, 'Now counts its rows');
  assert.equal(+secs[0].querySelector('.pz-h .n').textContent.split(' ')[0], BELL, 'Needs you holds the bell\'s rows');
  pop().querySelector('[data-ptab="updates"]').click();
  assert.equal(tabN('updates'), new Set([...pop().querySelectorAll('[data-open]')].map((x) => x.dataset.open)).size, 'Updates counts its rows');
  pop().querySelector('[data-ptab="vitals"]').click();
  pop().querySelector('[data-open="r:run-a"]').click(); await settle();
  assert.equal(w.location.hash, '#chat/ask_1', 'a Needs-you row opens its task at its card, in the chat that started it');
  for (const n of DEMO_NAMES) assert.ok(!d.getElementById('route-chat').textContent.includes(n), `no seeded ${n}`);
});

test('the spend card shows windowSpendUsd; #insights/spend shows its empty look, no seeded title', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  d.querySelector('[data-acct]').click();
  d.querySelector('[data-sub="usage"]').click();
  assert.match(d.querySelector('.spend-card').textContent, /\$12\.50/);
  w.location.hash = '#insights/spend'; await settle();
  assert.equal(d.getElementById('route-place').hidden, true);
  assert.match(d.getElementById('route-today').textContent, /No insights yet\./);
  for (const n of DEMO_NAMES) assert.ok(!d.getElementById('route-today').textContent.includes(n), `no seeded ${n}`);
});

test('only the adapter writes: set, remove and taskGone change nothing; the Tasks list\'s menu and selection are dev\'s (Tasks D17)', async () => {
  const { w, d, hello } = await liveHost();
  await hello();
  const before = store(w);
  w.RailWorld.set('every');
  w.RailWorld.remove('run-a');
  w.RailShell.taskGone('question', 'Ask me');
  assert.deepEqual(store(w), before);
  w.location.hash = '#runs'; await settle();
  const row = d.querySelector('#bar-tasks [data-open]');
  assert.ok(row, 'the Tasks list draws its rows');
  // Tasks D17: the row's ⋯ menu and the list's tools are the design's own, each item on dev's route
  // (test/stillhet-tasks-list-host.test.mjs); selecting a row writes nothing to the store
  const picks = (menu) => { d.querySelector(`#bar-tasks [data-menu="${menu}"]`)?.click(); const ids = [...d.querySelectorAll('#bar-tasks [data-menu-pick]')].map((x) => x.dataset.menuPick.split('|').pop()); d.querySelector(`#bar-tasks [data-menu="${menu}"]`)?.click(); return ids; };
  const rowMenu = picks(`row:${row.dataset.open}`);
  for (const id of ['toggle', 'in-view', 'stop', 'archive']) assert.ok(rowMenu.includes(id), `${id} in the live row menu`);
  assert.ok(picks('tools').includes('select'), 'Select in the live tools');
  row.dispatchEvent(new w.MouseEvent('click', { bubbles: true, metaKey: true, ctrlKey: true }));
  await settle();
  assert.deepEqual(store(w), before, 'a selection writes nothing');
});

test('Projects: titled by dev\'s name, no seeded workspaces; Schedules: the next date is the server\'s', async () => {
  const s = clone(SOURCES);
  s.schedules.tickets.push({ id: 'tk3', kind: 'once', title: 'Sunday ticket', status: 'scheduled', runAt: new Date(2026, 10, 15, 14, 44).toISOString(), createdAt: SOURCES.schedules.tickets[0].createdAt });
  const { w, d, hello } = await liveHost({ sources: s, level: 'advanced' });
  await hello();
  assert.deepEqual([...w.RailProjects.needItems().map((x) => x.title)].sort(), ['api', 'gone']);
  assert.equal(w.RailSpaces.list().length, 0);
  w.location.hash = '#projects'; await settle();
  const text = d.body.textContent;
  for (const n of ['Web shop', 'IoT SP Platform', 'Legacy billing', 'gone-3', 'api-2']) assert.ok(!text.includes(n), `no ${n}`);
  assert.ok(text.includes('gone'));
  assert.equal(w.RailSchedules.nextLine(w.RailSchedules.find('tk3')), 'Nov 15, 14:44');
  assert.equal(w.RailSchedules.nextLine(w.RailSchedules.find('sr1')), 'Nov 13, 02:00');
  const day = (t) => w.RailSchedules.TODAY.getTime() === new Date(t).setHours(0, 0, 0, 0);
  assert.ok(day(NOW), 'today is the local day of now');
  w.Date.now = () => NOW + 86400000;
  assert.ok(day(NOW + 86400000), 'past midnight, today moves on without a reload');
  w.Date.now = () => NOW;
});

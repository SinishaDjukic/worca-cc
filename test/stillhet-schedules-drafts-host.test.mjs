// test/stillhet-schedules-drafts-host.test.mjs — a schedule's edits are drafts (rail.drafts, Schedules D6, D7, D11): a picker
// sends nothing and shows a DraftBar; Save sends one PATCH with dev's rule; Discard sends nothing and leaves the store as it was.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { liveHost, go, settle, closeHosts, clone, SOURCES, posts, store } from './helpers/stillhet-chat-live-host.mjs';

afterEach(closeHosts);
const RULE = { freq: 'daily', interval: 1, time: '02:00', tz: 'UTC' };
const toastText = (d) => [...d.querySelectorAll('body > .rc-toast')].map((e) => e.textContent).filter(Boolean).join(' | ');
const sent = (calls) => posts(calls).filter(([, u]) => /^\/api\/schedules\b/.test(u));
async function page({ write = () => [200, { kind: 'recurring', item: {} }], rule = RULE, id = 'sr1', tickets = null } = {}) {
  const src = clone(SOURCES);
  src.schedules.schedules[0] = { ...src.schedules.schedules[0], rule, overlap: 'skip', maxFailures: 3, ifMissed: 'run', graceMin: 360, tz: 'UTC' };
  if (tickets) src.schedules.tickets.push(...tickets);
  const h = await liveHost({ sources: src, write });
  await go(h.w, `#schedule/${id}`, 150); await settle(300);
  h.src = src;
  h.pick = async (menu, v) => { h.d.querySelector(`#route-schedule [data-menu="${menu}"]`).click(); await settle(5); h.d.querySelector(`#route-schedule [data-menu-pick="${menu}|${v}"]`).click(); await settle(40); };
  h.bar = () => h.d.querySelector('#route-schedule .draft-bar')?.textContent || '';
  return h;
}

test('a Repeats change sends nothing and shows the DraftBar; Save sends one PATCH with the mapped rule and drops the draft', async () => {
  const { w, d, calls, pick, bar, sockets, src } = await page();
  await pick('sc-every', 'every Monday');
  assert.equal(sent(calls).length, 0);
  assert.match(bar(), /Draft1 change/);
  assert.match(d.querySelector('#route-schedule [data-menu="sc-every"]').textContent, /every Monday/, 'the page draws the draft');
  await pick('sc-at', '09:00');
  assert.match(bar(), /2 changes/);
  d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['PATCH', '/api/schedules/sr1', { rule: { freq: 'weekly', interval: 1, time: '09:00', tz: 'UTC', weekdays: ['mo'] } }]]);
  assert.match(bar(), /2 changes/, 'the draft stays drawn until the frame');
  src.schedules.schedules[0].rule = { freq: 'weekly', interval: 1, time: '09:00', tz: 'UTC', weekdays: ['mo'] };   // what the server saved
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'schedules-changed', action: 'updated' }) }); await settle(400);
  assert.equal(bar(), '', 'saved: no draft');
  assert.equal(w.RailDrafts.get('schedule:sr1'), null);
});

test('the Expert facts are pickers in the same draft: overlap, failures before pause, if missed', async () => {
  const { d, calls, pick, bar } = await page();
  await pick('sc-overlap', 'queue');
  await pick('sc-fails', '5');
  await pick('sc-missed', 'skip');
  assert.match(bar(), /3 changes/);
  d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['PATCH', '/api/schedules/sr1', { overlap: 'queue', maxFailures: 5, ifMissed: 'skip' }]]);
});

test('Discard sends nothing and the store item is deep-equal to before the edit; setting it back drops the draft', async () => {
  const { w, d, calls, pick, bar } = await page();
  const before = store(w);
  await pick('sc-at', '09:00');
  d.querySelector('#route-schedule [data-sched-discard]').click(); await settle(40);
  assert.equal(bar(), '');
  assert.equal(sent(calls).length, 0);
  assert.deepEqual(store(w), before);
  await pick('sc-at', '09:00'); await pick('sc-at', '02:00');
  assert.equal(bar(), '', 'back to the saved value: no change left');
});

test('leaving and coming back keeps the draft; a frame during it keeps it too; Showing drafts lists only drafted schedules', async () => {
  const { w, d, pick, bar, sockets } = await page();
  await pick('sc-at', '09:00');
  await go(w, '#chat', 80); await go(w, '#schedule/sr1', 150);
  assert.match(bar(), /1 change/);
  sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'schedules-changed', action: 'external' }) }); await settle(400);
  assert.match(bar(), /1 change/, 'the draft stays over the reloaded values');
  d.querySelector('#bar-schedules [data-menu="show"]').click(); await settle(5);
  d.querySelector('#bar-schedules [data-pick="show|drafts"]').click(); await settle(40);
  const rows = [...d.querySelectorAll('#bar-schedules [data-menu^="row:sched:"]')].map((e) => e.dataset.menu);
  assert.deepEqual(rows, ['row:sched:sr1']);
});

test('a refused Save keeps the draft and says why', async () => {
  const { d, calls, pick, bar } = await page({ write: () => [400, { error: 'rule.time must be HH:MM (24-hour)' }] });
  await pick('sc-at', '09:00');
  d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.equal(sent(calls).length, 1);
  assert.match(bar(), /1 change/);
  assert.equal(toastText(d), 'Could not save the changes: rule.time must be HH:MM (24-hour)');
});

test('Save keeps the rule\'s end: a time change moves only the time, a repeat change keeps the end', async () => {
  const end = { type: 'count', count: 10 };
  let h = await page({ rule: { ...RULE, interval: 2, end } });   // every 2 days: no picker word
  await h.pick('sc-at', '09:00');
  h.d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['PATCH', '/api/schedules/sr1', { rule: { ...RULE, interval: 2, end, time: '09:00' } }]]);
  closeHosts();
  h = await page({ rule: { ...RULE, end } });
  await h.pick('sc-every', 'every Monday');
  h.d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['PATCH', '/api/schedules/sr1', { rule: { freq: 'weekly', interval: 1, time: '02:00', tz: 'UTC', weekdays: ['mo'], end } }]]);
});

test('the grace window is a picker on the Expert line while a missed time runs late; Save sends graceMin', async () => {
  const { d, calls, pick } = await page();
  assert.match(d.querySelector('#route-schedule [data-menu="sc-grace"]').textContent, /at most 6 hours late/);
  await pick('sc-grace', '60');
  d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['PATCH', '/api/schedules/sr1', { graceMin: 60 }]]);
});

// one-offs that wait for one another: tk_w waits for tk2 ("Later today"); tk3 is another one-off of the same project
const WAITERS = [
  { id: 'tk_w', kind: 'once', title: 'A waiter', status: 'scheduled', runAt: '9999-12-31T00:00:00.000Z', createdAt: new Date(2026, 10, 12, 1).toISOString(), after: { kind: 'ticket', id: 'tk2', title: 'Later today', policy: 'done' } },
  { id: 'tk3', kind: 'once', title: 'Another one', status: 'scheduled', runAt: new Date(2026, 10, 12, 20).toISOString(), createdAt: new Date(2026, 10, 12, 1).toISOString() },
];

test('a one-off that waits for a run: its run-after is a picker in the draft; Save sends the new after', async () => {
  const { d, calls, pick } = await page({ id: 'tk_w', tickets: WAITERS });
  assert.match(d.querySelector('#route-schedule [data-menu="sc-after"]').textContent, /Later today/);
  d.querySelector('#route-schedule [data-menu="sc-after"]').click(); await settle(5);
  assert.equal(d.querySelector('#route-schedule [data-menu-pick="sc-after|ticket:tk2"]')?.getAttribute('aria-checked'), 'true', 'the saved one is checked');
  d.querySelector('#route-schedule [data-menu="sc-after"]').click(); await settle(5);
  await pick('sc-after', 'ticket:tk3');
  d.querySelector('#route-schedule [data-sched-save]').click(); await settle(80);
  assert.deepEqual(sent(calls), [['PATCH', '/api/schedules/tk_w', { after: { kind: 'ticket', id: 'tk3' } }]]);
});

test('Delete names the one-offs that wait for it; Run after this opens New task waiting for it and posts after', async () => {
  const { w, d, calls } = await page({ id: 'tk2', tickets: WAITERS, write: () => [202, { runId: 'tk_new' }] });
  d.querySelector('#route-schedule [data-menu="sc-more"]').click(); await settle(5);
  d.querySelector('#route-schedule [data-menu-pick="sc-more|after"]').click(); await settle(80);
  assert.match(d.querySelector('.cc-dlg').textContent, /It starts once Later today ends/);
  const f = d.querySelector('#cc-text'); f.value = 'Ship the docs'; f.dispatchEvent(new w.Event('input', { bubbles: true }));
  d.querySelector('[data-dialog="yes"]').click(); await settle(120);
  const run = posts(calls).find(([, u]) => u === '/api/run');
  assert.deepEqual([run[2].after, run[2].afterPolicy, run[2].prompt], [{ kind: 'ticket', id: 'tk2' }, 'done', 'Ship the docs']);
  assert.match(toastText(d), /Scheduled Ship the docs: it starts once Later today ends/);
  await go(w, '#schedule/tk2', 150);
  d.querySelector('#route-schedule [data-menu="sc-more"]').click(); await settle(5);
  d.querySelector('#route-schedule [data-menu-pick="sc-more|delete"]').click(); await settle(40);
  assert.match(toastText(d), /^Deleted Later today · “A waiter” was waiting for it/);
});

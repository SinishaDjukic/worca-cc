// test/stillhet-schedules-delete-host.test.mjs — the live Schedules Delete (D8): it waits out its Undo window from the
// page, the bar row and the Chat card; Undo sends nothing; a refused DELETE brings the row back and says why.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { go, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { toastText, sources, sent, page, more, scheduledThread } from './helpers/stillhet-schedules-host.mjs';

afterEach(closeHosts);

test('Delete from the page head, the bar row and the Chat card: "Deleted TITLE" with Undo; Undo sends nothing; the next notice sends the one DELETE', async () => {
  const from = {
    page: async (d) => more(d, 'delete'),
    bar: async (d) => { d.querySelector('#bar-schedules [data-menu="row:sched:sr1"]').click(); await settle(5); d.querySelector('#bar-schedules [data-menu-pick="row:sched:sr1|delete"]').click(); await settle(40); },   // the bar row's ⋯ › Delete
    chat: async (d, w) => { await go(w, '#chat/ask_1', 300); d.querySelector('#route-chat [data-menu="card:sr1"]').click(); await settle(10); d.querySelector('#route-chat [data-menu-pick="card:sr1|Delete"]').click(); await settle(40); },   // the Chat card's More › Delete
  };
  for (const [where, press] of Object.entries(from)) {
    // sr1 was scheduled from ask_1: its Chat card is there
    const { w, d, calls } = await page('sr1', { src: sources({ askThreadId: 'ask_1' }), thread: scheduledThread('sr1') });
    await press(d, w);
    assert.match(toastText(d), /^Deleted Nightly/, where);
    assert.ok(d.querySelector('body > .rc-toast [data-toast-undo], body > .rc-toast button'), `${where}: Undo`);
    assert.equal(w.RailSchedules.find('sr1'), undefined, `${where}: the row leaves at once`);
    assert.equal(sent(calls).length, 0, `${where}: nothing sent inside the window`);
    if (where === 'chat') assert.match(d.querySelector('#route-chat').textContent, /Deleted: Nightly/, 'its Chat card says it is deleted');
    d.querySelector('body > .rc-toast [data-toast-undo], body > .rc-toast button').click(); await settle(40);
    assert.ok(w.RailSchedules.find('sr1'), `${where}: Undo brings it back`);
    assert.equal(sent(calls).length, 0, `${where}: Undo sent nothing`);
    if (where === 'chat') assert.ok(d.querySelector('#route-chat [data-menu="card:sr1"]'), 'Undo brings its Chat card back');
    await go(w, '#schedule/sr1', 80);
    await press(d, w);
    w.RailPulse.say('Something else');   // the next notice replaces the Undo: the DELETE goes now
    await settle(40);
    assert.deepEqual(sent(calls), [['DELETE', '/api/schedules/sr1', undefined]], where);
    closeHosts();
  }
});

test('a refused DELETE brings the row back and says why', async () => {
  const { w, d, calls } = await page('sr1', { write: (u, b, m) => (m === 'DELETE' ? [409, { error: 'it is firing now' }] : [200, {}]) });
  await more(d, 'delete');
  w.RailScheduleLive.pending().flush();   // the window ends
  await settle(60);
  assert.equal(sent(calls).length, 1);
  assert.ok(w.RailSchedules.find('sr1'), 'back in the list');
  assert.equal(toastText(d), 'Could not delete Nightly: it is firing now');
});

test('a Delete left alone is sent once when its 5 s notice ends', async () => {
  // the window's 5 s timers (the Undo window, the notice) are held and run by hand: no real 5 s wait
  const held = [];
  const beforeScripts = (win) => { const st = win.setTimeout.bind(win); win.setTimeout = (fn, ms, ...a) => (ms === 5000 ? (held.push(fn), -1) : st(fn, ms, ...a)); };
  const { w, d, calls } = await page('sr1', { beforeScripts });
  await more(d, 'delete');
  assert.deepEqual(sent(calls), [], 'nothing inside the window');
  assert.ok(held.length, 'the Undo window is a 5 s timer');
  for (const fn of held.splice(0)) fn();
  await settle(60);
  assert.deepEqual(sent(calls), [['DELETE', '/api/schedules/sr1', undefined]]);
  assert.equal(w.RailScheduleLive.pending(), null);
});

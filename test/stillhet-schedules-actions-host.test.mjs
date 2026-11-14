// test/stillhet-schedules-actions-host.test.mjs — the live Schedules actions (D5, D15): each repaint-table row sends its one
// request and the screen changes only on that row's frame; every refusal says why and changes nothing. Delete is in
// test/stillhet-schedules-delete-host.test.mjs, the tickets and New in test/stillhet-schedules-tickets-host.test.mjs.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { go, settle, closeHosts, clone, SOURCES, store } from './helpers/stillhet-chat-live-host.mjs';
import { toastText, sources, HISTORY, sent, page, head, more } from './helpers/stillhet-schedules-host.mjs';

afterEach(closeHosts);

test('pause, resume, skip and keep: one request each, and the page moves only on schedules-changed', async () => {
  const rows = [
    ['pause', 'sr1', {}, (d) => more(d, 'pause'), '/api/schedules/sr1/pause', (s) => { s.status = 'paused'; s.nextRunAt = null; }, /Paused/],
    ['resume', 'sr2', {}, (d) => d.querySelector('#route-schedule [data-sched-resume]').click(), '/api/schedules/sr2/resume', (s) => { s.status = 'active'; s.nextRunAt = new Date(2026, 10, 13, 2).toISOString(); }, /Next up/],
    ['skip', 'sr1', {}, (d) => more(d, 'skip'), '/api/schedules/sr1/skip-next', (s) => { s.skippedRunAt = s.nextRunAt; s.nextRunAt = new Date(2026, 10, 14, 2).toISOString(); }, /Skips next time/],
    ['keep', 'sr1', { skippedRunAt: new Date(2026, 10, 13, 2).toISOString(), nextRunAt: new Date(2026, 10, 14, 2).toISOString() }, (d) => more(d, 'skip'), '/api/schedules/sr1/keep-next', (s) => { s.nextRunAt = s.skippedRunAt; s.skippedRunAt = null; }, /Nov 13/],
  ];
  for (const [name, id, over, press, url, change, after] of rows) {
    const src = name === 'resume' ? clone(SOURCES) : sources(over);
    const { w, d, calls, frame } = await page(id, { src });
    const before = store(w), was = head(d);
    await press(d); await settle(80);
    assert.deepEqual(sent(calls), [['POST', url, {}]], name);
    assert.deepEqual(store(w), before, `${name}: the store waits for the frame`);
    assert.equal(head(d), was, `${name}: the page waits for the frame`);
    change(src.schedules.schedules.find((s) => s.id === id));
    await frame({ type: 'schedules-changed', action: name });
    assert.match(head(d), after, `${name}: the frame repaints it`);
    closeHosts();
  }
});

test('Run now posts run-now once; Stop posts /api/stop with the running fire\'s pipeline id and the page moves on pipelines-changed', async () => {
  let h = await page('sr2');
  h.d.querySelector('#route-schedule [data-sched-menu], #route-schedule [data-menu="sc-more"]').click(); await settle(5);
  h.d.querySelector('#route-schedule [data-menu-pick="sc-more|run"]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['POST', '/api/schedules/sr2/run-now', {}]]);
  closeHosts();

  h = await page('sr1', { history: HISTORY });
  assert.ok(h.d.querySelector('#route-schedule [data-sched-stop]'), 'its fire run-b is running: Stop');
  h.d.querySelector('#route-schedule [data-sched-stop]').click(); await settle(80);
  assert.deepEqual(sent(h.calls), [['POST', '/api/stop', { pipelineId: 'pb' }]]);
  assert.ok(h.d.querySelector('#route-schedule [data-sched-stop]'), 'still running until its frames say so');
  h.src.hello.runs = h.src.hello.runs.filter((r) => r.runId !== 'run-b');
  h.src.history.pipelines.push({ id: 'pb', title: 'Busy', status: 'stopped', projectName: 'web', startedAt: new Date(2026, 10, 12, 14, 20).toISOString(), mtime: Date.parse(new Date(2026, 10, 12, 14, 40).toISOString()) });
  h.sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'done', runId: 'run-b', status: 'stopped' }) });
  await h.frame({ type: 'pipelines-changed' });
  assert.equal(h.d.querySelector('#route-schedule [data-sched-stop]'), null, 'the task left running: Run now again');
});

// Each refusal leaves the store as it was, so one host per failure kind walks every page action (the 9 ids x 2 failures
// are proven request by request in test/stillhet-schedule-live.test.mjs; New and Delete's refusals have their own cases below).
test('every page action refused with a 409 or a network failure: one "Could not …" toast, the store deep-equal, no retry', async () => {
  const presses = [
    ['run', 'sr1', (d) => d.querySelector('#route-schedule [data-sched-now]').click(), 'run it now'],
    ['pause', 'sr1', (d) => more(d, 'pause'), 'pause it'],
    ['skip', 'sr1', (d) => more(d, 'skip'), 'skip next time'],
    ['save', 'sr1', async (d) => { d.querySelector('#route-schedule [data-menu="sc-at"]').click(); await settle(5); d.querySelector('#route-schedule [data-menu-pick="sc-at|09:00"]').click(); await settle(40); d.querySelector('#route-schedule [data-sched-save]').click(); }, 'save the changes'],
    ['resume', 'sr2', (d) => d.querySelector('#route-schedule [data-sched-resume]').click(), 'resume it'],
    ['keep', 'sr3', (d) => more(d, 'skip'), 'keep next time'],
    ['stop', 'sr3', (d) => d.querySelector('#route-schedule [data-sched-stop]').click(), 'stop its task'],
  ];
  for (const [status, reason] of [[409, 'this schedule is paused'], [0, 'Worca is not answering']]) {
    const src = sources();
    // sr3: a skipped time (Keep next time) and a fire still running (Stop)
    src.schedules.schedules.push({ ...src.schedules.schedules[0], id: 'sr3', title: 'Skipped and busy', skippedRunAt: new Date(2026, 10, 13, 2).toISOString(), nextRunAt: new Date(2026, 10, 14, 2).toISOString() });
    const write = () => { if (status === 0) throw new TypeError('Failed to fetch'); return [status, { error: reason }]; };
    const { w, d, calls } = await page('sr1', { src, write, history: { sr3: HISTORY.sr1 } });
    for (const [id, sid, press, words] of presses) {
      if (!location(w, sid)) { await go(w, `#schedule/${sid}`, 150); await settle(150); }
      const before = store(w), n = sent(calls).length;
      w.RailDrafts?.discard(`schedule:${sid}`);
      await press(d); await settle(80);
      assert.equal(sent(calls).length - n, 1, `${id} ${status}: one request, no retry`);
      assert.equal(toastText(d), `Could not ${words}: ${reason}`, `${id} ${status}`);
      assert.deepEqual(store(w), before, `${id} ${status}: the store is unchanged`);
    }
    closeHosts();
  }
});
const location = (w, id) => w.location.hash === `#schedule/${id}`;

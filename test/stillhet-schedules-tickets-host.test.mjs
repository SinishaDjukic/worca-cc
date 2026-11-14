// test/stillhet-schedules-tickets-host.test.mjs — the live Schedules tickets and New (D9, D16): a failed ticket's Start now
// and Open project, Pulse's missed ticket through RailScheduleLive.act, and New schedule's POST /api/run.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { go, settle, closeHosts } from './helpers/stillhet-chat-live-host.mjs';
import { HISTORY, sent, page } from './helpers/stillhet-schedules-host.mjs';

afterEach(closeHosts);

test('a failed ticket (D16): Start now posts its own run-now; Open project opens projects/KEY', async () => {
  const { w, d, calls } = await page('sr1', { history: HISTORY });
  d.querySelector('#route-schedule [data-sched-ticket="tk8|now"]').click(); await settle(60);
  assert.deepEqual(sent(calls), [['POST', '/api/schedules/tk8/run-now', {}]]);
  d.querySelector('#route-schedule [data-sched-ticket="tk8|project"]').click(); await settle(60);
  assert.equal(w.location.hash, '#projects/web-1');
});

test('Pulse\'s missed ticket Run now goes through RailScheduleLive.act', async () => {
  const { w, calls } = await page('sr1');
  const acts = []; const act = w.RailScheduleLive.act; w.RailScheduleLive.act = (id, a) => { acts.push([id, a.id]); return act(id, a); };
  w.RailPulse.open('updates');
  w.document.querySelector('#app .pz-popover [data-fix="n7"]').click(); await settle(80);
  assert.deepEqual(acts, [['run', 'tk1']]);
  assert.deepEqual(sent(calls), [['POST', '/api/schedules/tk1/run-now', {}]]);
});

test('New schedule (D9): the form posts POST /api/run with repeat.rule; a 400 keeps what was typed', async () => {
  const { w, d, calls } = await page('sr1', { write: (u) => (u === '/api/run' ? [400, { error: 'prompt is too short' }] : [200, {}]) });
  await go(w, '#schedules', 150);
  d.querySelector('#bar-head [data-bar-new]').click(); await settle(20);
  d.querySelector('#bar-head [data-menu-pick="bar-new|form"]').click(); await settle(80);
  const type = (sel, v) => { const f = d.querySelector(sel); f.value = v; f.dispatchEvent(new w.Event('input', { bubbles: true })); };
  type('#cc-name', 'Weekly lint'); type('#cc-text', 'Run the linter');
  d.querySelector('[data-c-more]').click(); await settle(20);
  const pick = async (id, v) => { d.querySelector(`[data-menu="f-${id}"]`).click(); await settle(5); d.querySelector(`[data-menu-pick="f-${id}|${v}"]`).click(); await settle(20); };
  await pick('ends', 'after 10 runs'); await pick('overlap', 'queue if still going'); await pick('fails', 'never pause');
  d.querySelector('[data-dialog="yes"]').click(); await settle(120);
  const [[method, url, body]] = sent(calls);
  assert.deepEqual([method, url, body.title, body.prompt, body.repeat.rule.freq, body.repeat.rule.time], ['POST', '/api/run', 'Weekly lint', 'Run the linter', 'weekly', '09:00']);
  assert.deepEqual([body.repeat.rule.end, body.repeat.overlap, body.repeat.maxFailures], [{ type: 'count', count: 10 }, 'queue', 0], 'Ends, overlap and failures are sent');
  assert.equal(body.repeat.rule.tz, Intl.DateTimeFormat().resolvedOptions().timeZone, 'the browser\'s zone, not the demo\'s');
  assert.equal(body.noProject, undefined);
  assert.equal(d.querySelector('#cc-name').value, 'Weekly lint', 'the form stays with what was typed');
  assert.match(d.querySelector('.cc-dlg, dialog').textContent, /Could not create the schedule: prompt is too short/);
});

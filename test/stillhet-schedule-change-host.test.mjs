// test/stillhet-schedule-change-host.test.mjs — stillhet.chat-first, panel.schedule-change, in the demo kind: Schedules is
// a view, so a schedule is changed from Chat. Its card offers Edit schedule… (its ⋯, and a quiet button when the card is
// the last thing in the thread); the form's Save applies nothing: it posts one ChangeProposal in that chat (a row per
// field, from → to) with Apply and Discard. A change typed in the composer gives the same proposal (the demo adapter
// reads the words). The schedule's own page has one "Change in its chat" and no form. jsdom app host, demo kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetHost, readStillhet } from './helpers/stillhet-host.mjs';
import { until } from './helpers/stillhet-chat-live-host.mjs';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = (x) => JSON.parse(JSON.stringify(x));
async function host(t, hash = '#chat/c1') {
  const w = stillhetHost({ hash, after: (fn) => t.after(fn), beforeScripts: (win) => win.eval(readStillhet('demo/demo-actions.js')) });   // the demo adapter the prototype host loads
  await settle(60);
  const d = w.document, S = w.StillhetSchedules;
  const chat = (s) => d.querySelector(`#route-chat ${s}`);
  const proposal = () => [...d.querySelectorAll('#route-chat .cp')].at(-1);
  const button = (root, label) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
  const field = (id, v) => { const el = d.querySelector(id); el.value = v; el.dispatchEvent(new w.Event('input', { bubbles: true })); el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  // the proposal's rows as [field, from, to], and its buttons' words
  const rows = (p) => [...p.querySelectorAll('.cp-row')].map((r) => [text(r.querySelector('dt')), text(r.querySelector('s')), text(r.querySelector('b'))]);
  const buttons = (p) => [...p.querySelectorAll('.tp-actions button')].map((b) => b.textContent.trim());
  const save = async () => { button(d.querySelector('.cc-dlg'), 'Propose changes').click(); await settle(150); };
  return { w, d, S, chat, proposal, button, field, save, rows, buttons };
}

test('the demo adapter reads a typed change: a time, a repeat, a new name; words that change nothing give none', async (t) => {
  const { w } = await host(t);
  const read = (words, list = [{ id: 's1', title: 'Nightly export check', every: 'every day', at: '02:00' }]) => plain(w.StillhetDemoActions.scheduleChange(words, list));
  assert.deepEqual(read('run it at 03:00 instead'), { id: 's1', patch: { at: '03:00' } });
  assert.deepEqual(read('make it weekdays at 9pm'), { id: 's1', patch: { at: '21:00', every: 'every weekday' } });
  assert.deepEqual(read('rename it to Night check'), { id: 's1', patch: { title: 'Night check' } });
  assert.deepEqual(read('move the Cost report to Mondays', [{ id: 's1', title: 'Nightly export check', every: 'every day', at: '02:00' }, { id: 's4', title: 'Cost report', every: 'every Friday', at: '17:00' }]), { id: 's4', patch: { every: 'every Monday' } });
  assert.equal(read('run it at 02:00'), null, 'the time it already has');
  assert.equal(read('why did it fail at 03:00?'), null, 'a question is not a change');
  assert.equal(read('run it at 03:00', []), null);
});

test('its card: Edit schedule… in its ⋯ and, as the last thing in the thread, a quiet button; Save proposes, Discard leaves it, Apply changes it everywhere', async (t) => {
  const h = await host(t);
  const before = plain([h.S.find('s1').at, h.S.find('s1').title]);
  const quiet = h.chat('[data-sched-card="s1|edit"]');
  assert.equal(quiet?.textContent.trim(), 'Edit schedule…', 'the last card offers it beside Run now and Open');
  assert.match(quiet.className, /btn-quiet/);
  assert.ok(h.chat('[data-sched-card="s1|run"]'), 'Run now stays');
  quiet.click(); await settle(80);
  assert.match(text(h.d.querySelector('.cc-dlg')), /Edit schedule/);
  h.field('#cc-at', '03:00');
  await h.save();
  assert.equal(h.d.querySelector('.cc-dlg'), null, 'the form closes');
  assert.deepEqual(plain([h.S.find('s1').at, h.S.find('s1').title]), before, 'Save applies nothing');
  let p = h.proposal();
  assert.equal(text(p.querySelector('.tp-kicker')), 'Schedule');
  assert.match(text(p), /Nightly export check ?Nothing changes until you apply it/);
  assert.deepEqual(h.rows(p).slice(0, 1), [['Time', '02:00', '03:00']], 'a row per field that changes, from → to');
  assert.equal(h.rows(p)[1][0], 'Next start');
  assert.match(h.rows(p)[1][2], /, 03:00$/);
  assert.deepEqual(h.buttons(p), ['Apply', 'Discard']);
  assert.equal(h.chat('[data-sched-card="s1|edit"]'), null, 'the card is no longer last: the button leaves; its ⋯ keeps it');
  h.button(p, 'Discard').click(); await settle(60);
  assert.deepEqual(plain([h.S.find('s1').at, h.S.find('s1').title]), before);
  assert.match(text(h.chat('.convo-col')), /Not changed: Nightly export check/);

  // again, from its ⋯, a new name too; then Apply
  h.chat('[data-menu="card:s1"]').click(); await settle(30);
  const item = [...h.d.querySelectorAll('#route-chat [data-menu-pick^="card:s1|"]')].find((x) => /^Edit schedule…/.test(text(x)));
  assert.ok(item, 'its ⋯ holds Edit schedule…');
  item.click(); await settle(80);
  h.field('#cc-at', '03:00'); h.field('#cc-name', 'Night export check');
  await h.save();
  p = h.proposal();
  assert.deepEqual(h.rows(p).slice(0, 2), [['Name', 'Nightly export check', 'Night export check'], ['Time', '02:00', '03:00']]);
  h.button(p, 'Apply').click();
  await until(() => h.S.find('s1').at === '03:00', 4000); await settle(80);
  assert.equal(h.S.find('s1').title, 'Night export check');
  assert.match(text(h.chat('.convo-col')), /Night export check ?Name: Night export check · Time: 03:00 ?Revert/, 'a receipt with Revert');
  assert.match(text(h.chat('[data-anchor="a6"]')), /Night export check.*03:00/, 'its card');
  assert.match(text(h.d.querySelector('#bar-chat')), /Night export check ?03:00/, 'the Chat bar');
  assert.deepEqual(plain([h.w.StillhetWorld.find('sch-s1').title, h.w.StillhetWorld.find('sch-s1').time]), ['Night export check', '03:00'], 'the store: Pulse and the next start time');
  h.w.location.hash = '#schedule/s1'; await settle(120);
  assert.match(text(h.d.querySelector('#route-schedule')), /Night export check/);
  assert.match(text(h.d.querySelector('#route-schedule')), /03:00/, 'its page');
  assert.match(text(h.d.querySelector('#bar-schedules')), /Night export check ?03:00/, 'the Schedules bar');
});

test('typed in its chat: "run it at 04:30 on weekdays instead" gives the same proposal; nothing changes before Apply', async (t) => {
  const h = await host(t);
  const box = h.chat('[data-composer-t]');
  box.value = 'run it at 04:30 on weekdays instead';
  box.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await until(() => h.proposal(), 5000);
  assert.deepEqual(h.rows(h.proposal()).slice(0, 2), [['Repeats', 'every day', 'every weekday'], ['Time', '02:00', '04:30']]);
  assert.deepEqual(h.buttons(h.proposal()), ['Apply', 'Discard']);
  assert.equal(h.S.find('s1').at, '02:00');
  h.button(h.proposal(), 'Apply').click();
  await until(() => h.S.find('s1').at === '04:30', 4000);
  assert.equal(h.S.find('s1').every, 'every weekday');
});

test('its page: one quiet "Change in its chat" opens that chat with the form, and has no form of its own; Pause and Run now stay', async (t) => {
  const h = await host(t, '#schedule/s1');
  await settle(60);
  const page = h.d.querySelector('#route-schedule');
  const change = page.querySelector('[data-sched-chat]');
  assert.equal(change?.textContent.trim(), 'Change in its chat');
  assert.ok(page.querySelector('[data-sched-now]'), 'Run now stays');
  assert.ok(page.querySelector('[data-sched-pause]'), 'Pause stays');
  assert.equal(page.querySelector('input, textarea, select'), null, 'no edit field on the page');
  change.click(); await settle(200);
  assert.equal(h.w.location.hash, '#chat/c1');
  assert.match(text(h.d.querySelector('.cc-dlg')), /Edit schedule/);
  assert.equal(h.d.querySelector('#cc-name').value, 'Nightly export check');
});

test('a schedule with no chat: "Change in its chat" gives it one, with its card, and the form opens there', async (t) => {
  const h = await host(t, '#schedule/s5');
  await settle(60);
  assert.equal(h.S.find('s5').chat, '');
  h.d.querySelector('#route-schedule [data-sched-chat]').click(); await settle(200);
  const cid = h.S.find('s5').chat;
  assert.ok(cid, 'it has a chat now');
  assert.equal(h.w.location.hash, `#chat/${cid}`);
  assert.match(text(h.chat('.convo-col')), /Changelog digest/);
  assert.ok(h.chat('[data-sched-card="s5|edit"]'), 'its card, the last thing there, offers Edit schedule…');
  assert.match(text(h.d.querySelector('.cc-dlg')), /Edit schedule/);
  h.field('#cc-at', '15:00');
  await h.save();
  assert.match(text(h.proposal()), /Changelog digest/);
  assert.deepEqual(h.rows(h.proposal())[0], ['Time', '14:30', '15:00']);
  assert.equal(h.S.find('s5').at, '14:30');
});

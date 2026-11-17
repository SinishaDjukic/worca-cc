// test/stillhet-one-task-host.test.mjs — stillhet.one-place, in the demo kind: a task has ONE record in the store
// (shell/world.js), found by its id. Its page (#run/<case>) and its card in its chat both read and write that record, so a
// step taken in one place shows in the other without a reload, in the bars and in the one count of what needs you.
// Each test acts in one place and reads the other. jsdom app host, demo kind.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { until } from './helpers/stillhet-chat-live-host.mjs';

const settle = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const plain = (x) => JSON.parse(JSON.stringify(x));   // the host's objects are another realm's
async function host(t, hash = '#chat/c1') {
  const w = stillhetHost({ hash, after: (fn) => t.after(fn) });
  await settle(60);
  const d = w.document, W = w.StillhetWorld;
  // jsdom lays nothing out, so the shell's page-heading rule would take the focus 120 ms after an address change; a browser
  // never does. The host answers as a browser: what is connected and not hidden shows (as test/stillhet-task-page-states-host).
  w.Element.prototype.getClientRects = function () { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; };
  const go = async (h, ms = 80) => { w.location.hash = h; await settle(ms); };
  const chat = (s) => d.querySelector(`#route-chat ${s}`);
  const page = (s) => d.querySelector(`#route-run:not([hidden]) #card ${s}`);
  const main = () => page('[data-key="act-main"]');
  // a step on the page: its main action, then the yes of its confirm strip when it asks first; done when its record moved
  const step = async (id) => { const was = W.task(id).case; main().click(); await settle(60); const yes = page('[data-confirm="yes"]'); if (yes) yes.click(); await until(() => W.task(id).case !== was, 4000); await settle(60); };
  const openPage = async (task) => { chat(`[data-open-task-page="${task}"]`).click(); await settle(120); };
  const cardOf = (anchor) => text(chat(`[data-anchor="${anchor}"]`));
  return { w, d, W, go, chat, page, main, step, openPage, cardOf };
}

test('the store: one record per task, by id: answer, followUp and pageTask (the model)', async (t) => {
  const { W } = await host(t);
  const seen = []; W.onMove((id) => seen.push(id));
  assert.equal(W.task('r1').case, 'question');
  assert.equal(W.pageTask('question', 'Add CSV export to billing').id, 'r1', 'the demo address names a state: its task is looked up once');
  assert.equal(W.needsHas('r1'), true);
  W.answer('r1', 'ISO 8601', { detail: 'Review · carries on with your answer', stage: 2 });
  assert.deepEqual(plain([W.task('r1').case, W.task('r1').answered, W.task('r1').detail, W.task('r1').stage]), ['working', 'ISO 8601', 'Review · carries on with your answer', 2]);
  assert.equal(W.needsHas('r1'), false, 'an answered task no longer needs you');
  W.followUp('r1', { text: 'Add a totals row' });
  assert.deepEqual(plain(W.task('r1').followUps), [{ text: 'Add a totals row', when: 'Proposed in its chat' }]);
  assert.deepEqual(seen, ['r1', 'r1'], 'every write tells onMove, with the id');
  assert.equal(W.answer('nope', 'x'), null);
  assert.equal(W.followUp('r1', {}), null, 'a follow-up with no words is not one');
});

test('answer its question on its page: its chat shows the question answered and the card working, the count goes down', async (t) => {
  const h = await host(t);
  const before = h.W.count();
  await h.openPage('t1');
  assert.equal(h.w.location.hash, '#run/question');
  assert.equal(h.w.StillhetRunPage.task(), 'r1', 'the page is this task, by its id');
  await h.step('r1');   // Send answer, with Worca's pick
  assert.equal(h.W.task('r1').case, 'working');
  assert.equal(h.W.task('r1').answered, 'ISO 8601 (2026-11-07)');
  assert.equal(h.W.count(), before - 1, 'the one count');
  assert.equal(h.W.needs().some((x) => x.id === 'r1'), false);
  await h.go('#chat/c1');
  assert.match(text(h.chat('.convo-col')), /Which date format should the export use\? ISO 8601 \(2026-11-07\)/, 'the question under its card reads the answer');
  assert.equal(h.chat('[data-answer-go]'), null, 'nothing left to answer');
  assert.match(h.cardOf('a2'), /^Working/);
});

test('answer its question in its chat: its page is working, with no reload', async (t) => {
  const h = await host(t);
  await h.openPage('t1');
  assert.equal(h.main().dataset.label, 'Send answer');
  await h.go('#chat/c1');
  h.chat('[data-answer="5|1"]')?.click(); await settle(20);
  h.chat('[data-answer-go]').click(); await settle(60);
  assert.equal(h.W.task('r1').case, 'working');
  assert.equal(h.W.task('r1').answered, 'The account\'s locale');
  await h.openPage('t1');
  assert.equal(h.w.location.hash, '#run/working');
  assert.equal(h.w.StillhetRunPage.task(), 'r1');
  assert.equal(text(h.page('[data-title]')), 'Add CSV export to billing');
  assert.notEqual(h.main()?.dataset.label, 'Send answer');
});

test('approve in its chat: its page has moved on, by its id', async (t) => {
  const h = await host(t, '#chat/c16');
  assert.equal(h.W.task('r2').case, 'gate');
  const was = h.W.count();
  h.chat('[data-card-act="t16|Accept as is"]').click(); await settle(60);
  h.chat('[data-card-yes]')?.click(); await settle(60);
  assert.equal(h.W.task('r2').case, 'working');
  assert.equal(h.W.count(), was - 1);
  await h.openPage('t16');
  assert.equal(h.w.location.hash, '#run/working');
  assert.equal(h.w.StillhetRunPage.task(), 'r2');
  assert.equal(text(h.page('[data-title]')), 'Migrate cron parser');
});

test('approve on its page: its card no longer asks, and the count goes down', async (t) => {
  const g = await host(t, '#chat/c16');
  await g.openPage('t16');
  assert.equal(g.w.location.hash, '#run/gate');
  const was = g.W.count();
  await g.step('r2');
  assert.notEqual(g.W.task('r2').case, 'gate', 'the page moved the one record');
  assert.equal(g.W.count(), was - 1);
  await g.go('#chat/c16');
  assert.equal(g.chat('[data-card-act="t16|Accept as is"]'), null, 'its card no longer asks');
});

test('retry a failed task on its page: its card works again, at its own stage', async (t) => {
  const h = await host(t, '#chat/c17');
  await h.openPage('t17');
  assert.equal(h.w.location.hash, '#run/failed');
  assert.equal(h.main().textContent.trim(), 'Retry');
  await h.step('r5');
  assert.deepEqual(plain([h.W.task('r5').case, h.W.task('r5').stage]), ['working', 1], 'Build runs again: it stays at Build');
  await h.go('#chat/c17');
  assert.match(h.cardOf('b0'), /^Working/);
  assert.equal(h.chat('[data-card-act^="t17|"]')?.textContent.trim() === 'Retry', false);
});

test('retry a failed task on its card: its page works again', async (t) => {
  const g = await host(t, '#chat/c17');
  const retry = g.chat('[data-card-act^="t17|"]');
  assert.equal(retry?.textContent.trim(), 'Retry', 'the card offers Retry');
  retry.click(); await settle(60); g.chat('[data-card-yes]')?.click(); await settle(60);
  assert.equal(g.W.task('r5').case, 'working');
  await g.openPage('t17');
  assert.equal(g.w.location.hash, '#run/working');
  assert.equal(g.w.StillhetRunPage.task(), 'r5');
  assert.equal(text(g.page('[data-title]')), 'Update Node to 24');
});

test('an open page follows its card with no reload: pause in the chat\'s store, the page shows Paused; resume there, it works again', async (t) => {
  const h = await host(t, '#chat/c4');
  await h.openPage('t4');
  const id = h.w.StillhetRunPage.task();
  assert.equal(id, 'r10');
  h.W.move(id, 'paused-you', 'Paused by you', { was: h.W.task(id).case });   // what its card's Pause writes
  await settle(80);
  assert.equal(h.w.location.hash, '#run/paused-you', 'the open page moved with its record');
  assert.equal(h.w.StillhetRunPage.task(), id, 'and is still this task');
  assert.match(text(h.page('[data-key="act-main"]')), /Resume/);
});

test('pause on its page: its card says Paused and resumes it; a task with the same name never moves (by id, never by name)', async (t) => {
  const h = await host(t, '#chat/c4');
  h.W.add({ id: 'x1', case: 'working', title: 'Fix flaky login test', project: 'web-app', detail: 'Build · writing the change', stage: 1 });   // a namesake
  await h.openPage('t4');
  const id = h.w.StillhetRunPage.task();
  assert.equal(id, 'r10');
  assert.equal(h.main().textContent.trim(), 'Pause');
  await h.step(id);
  assert.equal(h.W.task(id).case, 'paused-you');
  assert.equal(h.W.task('x1').case, 'working', 'the namesake did not move');
  await h.go('#chat/c4');
  assert.match(h.cardOf('b0'), /^Paused/);
  assert.match(text(h.d.querySelector('#bar-chat')), /Fix flaky login test/, 'the bar reads the same record');
  const resume = [...h.d.querySelectorAll('#route-chat [data-card-act^="t4|"]')].find((b) => /^Resume/.test(b.textContent.trim()));
  assert.ok(resume, 'its card offers Resume');
  resume.click(); await settle(80); h.chat('[data-card-yes]')?.click(); await settle(60);
  assert.equal(h.W.task(id).case, 'working', 'back where the page paused it');
  assert.equal(h.W.task('x1').case, 'working');
});

test('merge on its page: its card reads Merged and it leaves what needs you', async (t) => {
  const h = await host(t, '#chat/c18');
  assert.equal(h.W.needsHas('r9'), true);
  await h.openPage('t18');
  assert.equal(h.w.location.hash, '#run/approved');
  assert.equal(h.main().dataset.label, 'Merge PR');
  await h.step('r9');
  assert.equal(h.W.task('r9').case, 'merged');
  assert.equal(h.W.needsHas('r9'), false);
  await h.go('#chat/c18');
  assert.match(h.cardOf('b0'), /^Merged/);
});

test('Start a follow-up in its chat: the chat opens with the box focused and the task named; the follow-up joins its record and its page lists it', async (t) => {
  const h = await host(t, '#chat/c16');
  await h.openPage('t16');
  const link = h.page('[data-key="from-follow"]');
  assert.ok(link, 'the page offers it');
  link.click(); await settle(150);
  assert.equal(h.w.location.hash, '#chat/c16');
  const box = h.chat('[data-composer-t]');
  assert.equal(h.d.activeElement, box, 'the composer has the focus');
  assert.match(text(h.chat('.composer-chips')), /Task · Migrate cron parser/);
  box.value = 'Also cover leap seconds';
  box.dispatchEvent(new h.w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await settle(80);
  assert.match(text(h.chat('.convo-col')), /A follow-up on Migrate cron parser, on its branch/);
  assert.deepEqual(plain(h.W.task('r2').followUps.map((x) => x.text)), ['Also cover leap seconds']);
  await h.openPage('t16');
  assert.match(text(h.page('#ov-followups')), /Follow-ups 1 ?Also cover leap seconds ?Proposed in its chat/);
});

test('StillhetConversation has what the page calls: followUp and chatOfTask by id; nothing calls a taskMoved that does not exist', async (t) => {
  const { w } = await host(t);
  assert.equal(typeof w.StillhetConversation.followUp, 'function');
  assert.equal(w.StillhetConversation.chatOfTask({ run: 'r1' }), 'c1');
  assert.equal(w.StillhetConversation.followUp({ run: 'nope' }), false, 'a task with no chat: the page falls back to Chat');
});

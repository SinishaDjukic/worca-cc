// test/stillhet-chat-prompt-check-scope.test.mjs — where Stillhet's composer prompt check stops: send hides the chip and
// the suggestion, Task/Ask mode and pin:Shaper change what is graded, a chat switch drops a late reply, and the
// Requirements composer and the demo draw nothing (jsdom app host; test/helpers/stillhet-chat-prompt-check.mjs).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { closeHosts, settle, go } from './helpers/stillhet-chat-live-host.mjs';
import { stillhetHost } from './helpers/stillhet-host.mjs';
import { pcHost, pcNode, picker, reply, TASK, PC, improves, improveBtn, view, opened, ready } from './helpers/stillhet-chat-prompt-check.mjs';

afterEach(closeHosts);
const LONGER = `${TASK} It must also export the monthly totals for every team.`;

test('the chip hides on send', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.graded();
  assert.ok(picker(s));
  s.q('[data-cp-send]').click(); await settle(60);
  assert.equal(picker(s), null);
  assert.equal(pcNode(s).children.length, 0);
});

test('Task mode grades with forceTask:true, Ask mode with forceTask:false', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.type(TASK); await s.quiet();
  assert.equal(s.grades().at(-1).body.forceTask, false);
  s.q('[data-menu="cp-mode"]').click(); await settle(5);
  s.q('[data-menu-pick="cp-mode|Task"]').click(); await settle(20);
  await s.type(LONGER); await s.quiet();
  assert.equal(s.grades().at(-1).body.forceTask, true);
  assert.equal(s.grades().at(-1).body.surface.kind, 'chat');
});

test('with pin:Shaper armed, the grade and the correction carry surface shaper', async () => {
  const s = await pcHost();
  s.d.querySelector('#route-chat [data-starter="pin:Shaper"]').click(); await settle(10);
  assert.ok(s.q('.composer-intent'), 'Shaper is armed on Chat home');
  await s.graded();
  const g = s.grades().at(-1);
  assert.equal(g.body.surface.kind, 'shaper');
  assert.equal(g.body.forceTask, true);
  picker(s).click(); await settle(10);
  s.d.querySelector('#route-chat [data-menu-pick="cp-pcheck|bug"]').click(); await settle(20);
  s.q('[data-cp-send]').click(); await settle(80);
  assert.equal(s.w.location.hash, '#chat/ask_new');
  const c = s.held.filter((x) => x.url === `${PC}kind-correction`);
  assert.equal(c.length, 1);
  assert.equal(c[0].body.surface, 'shaper');
});

test('a chat switch drops a late reply', async () => {
  const s = await pcHost();
  await go(s.w, '#chat/ask_1');
  await s.type(TASK); await s.quiet();
  const late = s.grades().at(-1);
  await go(s.w, '#chat/ask_2');
  late.answer(reply(late, { grade: 'needs-detail' })); await settle(20);
  assert.equal(picker(s), null);
  await s.quiet();
  assert.deepEqual(s.grades().filter((c) => c.body.surface.id === 'ask_2').map((c) => c.body.text), [], 'ask_1\'s draft is never graded as ask_2\'s');
  await go(s.w, '#chat/ask_1');
  assert.equal(picker(s), null, 'nor on the way back');
});

test('a send answered after a switch away and back leaves no chip on the cleared composer', async () => {
  let release;
  const s = await pcHost({ ask: (url) => (url.endsWith('/messages') ? new Promise((r) => { release = () => r([202, { userMessageId: 'u1', assistantMessageId: 'a1' }]); }) : null) });
  await go(s.w, '#chat/ask_1');
  await s.type(TASK);
  s.q('[data-cp-send]').click(); await settle(30);
  await go(s.w, '#chat/ask_2');
  await go(s.w, '#chat/ask_1');
  await s.quiet();   // the draft still sending is checked again by ask_1's new controller
  const late = s.grades().at(-1);
  release(); await settle(60);
  assert.equal(s.box().value, '', 'the send went through and cleared the box');
  late?.answer(reply(late, { grade: 'needs-detail' })); await settle(20);
  await s.quiet();
  assert.equal(picker(s), null);
  assert.equal(pcNode(s).children.length, 0);
});

test('the Requirements page\'s Shape a feature composer draws no chip and makes no prompt check call', async () => {
  const s = await pcHost();
  const page = s.d.createElement('div'); page.id = 'rq-test-page'; s.d.body.append(page);
  const home = s.w.RailConversation.mount(page, { mode: 'ask', where: '#rq-test-page', title: 'Shape a feature' });   // requirements.js mounts it so
  home?.show?.(''); await settle(30);
  s.q = (sel) => page.querySelector(sel);
  s.box = () => page.querySelector('[data-composer-t]');
  s.type = async (text) => { const t = s.box(); t.focus(); t.value = text; t.dispatchEvent(new s.w.Event('input', { bubbles: true })); await settle(10); };
  assert.ok(s.box(), 'the Shape a feature composer is up');
  await s.type(TASK); await s.quiet(); await s.quiet();
  assert.equal(s.q('[data-pc]'), null);
  assert.equal(s.q('[data-pc-improve]'), null);
  assert.equal(s.pcCalls().length, 0);
});

test('the demo kind has no [data-pc] or [data-pc-improve] (R-qa-8, R-ux-5)', async () => {
  const w = stillhetHost({ hash: '#chat', after: (fn) => fn && afterEach(fn) });
  const d = w.document;
  await settle(30);
  const t = d.querySelector('#route-chat [data-composer-t]');
  t.value = TASK; t.dispatchEvent(new w.Event('input', { bubbles: true }));
  await settle(20);
  assert.equal(d.querySelector('[data-pc]'), null);
  assert.equal(d.querySelector('[data-pc-improve]'), null);
  w.close();
});

test('Send works while Improve is busy (R-qa-4)', async () => {
  const s = await opened({ chat: 'ask_1' });
  assert.ok(s.q('[data-pc-improve] [data-improve-act="busy"]'));
  assert.equal(s.q('[data-cp-send]').disabled, false);
  s.q('[data-cp-send]').click(); await settle(60);
  assert.ok(s.calls.some((c) => c.url === '/api/ask/threads/ask_1/messages' && c.body.text === TASK));
});

test('send closes the suggestion and the chip', async () => {
  const s = await ready({ chat: 'ask_1' });
  s.q('[data-cp-send]').click(); await settle(60);
  assert.equal(view(s), null);
  assert.equal(pcNode(s).children.length, 0);
});

test('the improve body carries the projectKey of the composer\'s project', async () => {
  const s = await pcHost();
  s.q('[data-menu="cp-project"]').click(); await settle(5);
  const pick = s.d.querySelector('#route-chat [data-menu-pick^="cp-project|"]:not([data-menu-pick="cp-project|No project"])');
  const name = pick.dataset.menuPick.split('|')[1];
  pick.click(); await settle(20);
  await s.graded(TASK, { grade: 'needs-detail' });
  improveBtn(s).click(); await settle(10);
  const key = s.w.RailWorld.part('projects').find((p) => p.name === name).id;
  assert.ok(key);
  assert.equal(improves(s).at(-1).body.projectKey, key);
  assert.equal(improves(s).at(-1).body.kind, 'implementation');
  assert.deepEqual(improves(s).at(-1).body.openDecisions, []);
});

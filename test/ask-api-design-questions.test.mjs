// test/ask-api-design-questions.test.mjs
// Design P5 Task 9: a design chat's clarifying card (`design-questions`, state `asking`) is answered through the card
// route. A valid answer flips it `answered` and starts a quiet event turn that can build; a bad one is a 400 and the
// card stays open; a typed message closes it, so a late answer is a 409. A round receipt takes no action there, and
// with Design switched off both design cards answer 404. One in-process server on the mock engine
// (test/helpers/design-chat-boot.mjs).
import { test, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, settled, mod } = await bootDesignChat(after);
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
afterEach(() => mod.designBuilds.settled());   // a mock round an event turn started ends inside its test
async function asked() {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'Q' })).body;
  await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_ASK please', ...MODEL, design: { designId: d.design.id, pins: [] } });
  const snap = await settled(d.threadId);
  const card = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.kind === 'card' && b.card.type === 'design-questions');
  assert.equal(card.state, 'asking');
  return { d, card };
}
const answer = (d, c, answers) => call('POST', `/api/ask/threads/${d.threadId}/cards/${c.id}`, { answers });

test('an answer flips the card, starts a quiet event turn, and that turn can build', async () => {
  const { d, card } = await asked();
  const r = await answer(d, card, [{ id: 'tone', value: 'plain' }]);
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.block.state, r.body.block.card.answers], ['answered', [{ id: 'tone', value: 'plain' }]]);
  const snap = await settled(d.threadId);
  const ev = snap.messages.find((m) => m.role === 'user' && /^\[worca event\] design questions card /.test(m.text));
  assert.match(ev.text, /"Which tone\?" = "Plain"/);
  assert.equal(ev.blocks[0].synthetic && ev.blocks[0].quiet, true);
  assert.equal(ev.blocks[0].text, 'Answered');
  assert.ok(snap.messages.flatMap((m) => m.blocks || []).some((b) => b.card?.type === 'design-round'), 'the event turn called start_design_build');
});
test('a bad answer is refused and the card stays open; a second answer is a 409', async () => {
  const { d, card } = await asked();
  const bad = await answer(d, card, [{ id: 'tone', value: 'nope' }]);
  assert.deepEqual([bad.status, bad.body.error], [400, 'answer every question with one of its options']);
  assert.equal((await answer(d, card, [{ id: 'tone', value: 'plain' }])).status, 200);
  const twice = await answer(d, card, [{ id: 'tone', value: 'plain' }]);
  assert.deepEqual([twice.status, twice.body.error], [409, 'card is answered']);
});
test('Review Focus 3: a typed message closes an open card; a late answer gets a 409', async () => {
  const { d, card } = await asked();
  await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT actually, plain', ...MODEL, design: { designId: d.design.id, pins: [] } });
  await settled(d.threadId);
  const late = await answer(d, card, [{ id: 'tone', value: 'plain' }]);
  assert.deepEqual([late.status, late.body.error], [409, 'card is closed']);
});
test('a round receipt takes no action on the card route', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'R' })).body;
  await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'Build it', ...MODEL, design: { designId: d.design.id, pins: [] } });
  const snap = await settled(d.threadId);
  const c = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.card?.type === 'design-round');
  const r = await call('POST', `/api/ask/threads/${d.threadId}/cards/${c.id}`, { state: 'dismissed' });
  assert.deepEqual([r.status, r.body.error], [409, 'a round receipt has no action here'], 'the run-card path would 409 too, with other words');
});
test('the [worca context] cards line names a design card by type and state, never as a run card', async () => {
  const { d, card } = await asked();
  const ctx = await mod._testing.resolveAskContext(d.threadId, { view: 'design' });
  assert.deepEqual(ctx.cards.find((x) => x.id === card.id), { id: card.id, type: 'design-questions', state: 'asking', summary: 'Your turn: pick a tone' });
});
// setFlags cannot switch `design` off here: the boot helper sets WORCA_FLAGS=design, which locks it (FlagError
// 'locked'). flagEnabled reads WORCA_FLAGS on every call, so the row flips the env lock itself and puts it back.
test('with Design switched off both design cards answer 404 and no event turn starts', async () => {
  const { d, card } = await asked();
  const r = (await call('POST', '/api/design', { kind: 'web', title: 'Off' })).body;
  await call('POST', `/api/ask/threads/${r.threadId}/messages`, { text: 'Build it', ...MODEL, design: { designId: r.design.id, pins: [] } });
  const round = (await settled(r.threadId)).messages.flatMap((m) => m.blocks || []).find((b) => b.card?.type === 'design-round');
  await mod.designBuilds.settled();
  const prevFlags = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = '-design';
  let off;
  try {
    off = [await answer(d, card, [{ id: 'tone', value: 'plain' }]), await call('POST', `/api/ask/threads/${r.threadId}/cards/${round.id}`, { state: 'dismissed' })];
  } finally { process.env.WORCA_FLAGS = prevFlags; }
  assert.deepEqual(off.map((x) => [x.status, x.body.error]), [[404, 'not found'], [404, 'not found']]);
  const snap = await settled(d.threadId);
  assert.equal(snap.messages.flatMap((m) => m.blocks || []).find((b) => b.id === card.id).state, 'asking');
  assert.ok(!snap.messages.some((m) => m.role === 'user' && /^\[worca event\] design questions card /.test(m.text)));
});

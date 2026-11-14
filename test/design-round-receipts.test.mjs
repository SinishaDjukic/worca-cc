// test/design-round-receipts.test.mjs
// Design P5 Task 8: a design-round receipt follows its build's `design-build` frames with no AI. Live frames flip
// nothing, a pause reads `paused` with its facts, a terminal frame writes the facts once, a frame seen before the card
// exists lands once it is posted, and at boot each open receipt takes its build row's state. The last test imports
// ui/server.mjs (no listen): the frame wiring and the boot sweep's row mapping are two lines there, pinned in the app.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { getDb } from '../src/core/db.mjs';
import { createThread, appendMessage, updateCardBlock, findCard, listMessages, sweepDesignRoundCards } from '../src/core/ask/store.mjs';
import { createRoundReceipts, ROUND_STATE_OF } from '../src/core/design/round-receipts.mjs';
import { createBuild, createDesign, updateBuild, updateDesign } from '../src/core/design/store.mjs';

useTempHome(after);
const frame = (status, stats = {}) => ({ type: 'design-build', designId: 'd_0123456789ab', buildId: 'b_0123456789ab', seq: 1, ts: 1, status, round: 2, kind: 'change', reason: null, waiting: 0, stats });
const STATS = { agentsTotal: 12, costUsd: 4.2, costKnown: true, elapsedMs: 374000 };
function rig({ card = true } = {}) {
  const t = createThread({ mode: 'design', title: 'x' });
  const addCard = () => appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_00000001', state: 'running', card: { type: 'design-round', buildId: 'b_0123456789ab', baseVersion: 1, summary: 's' } }] });
  if (card) addCard();
  let flips = 0;
  const flipCard = (tid, id, patch) => { flips += 1; return updateCardBlock(tid, id, patch); };
  const r = createRoundReceipts({ threadOfDesign: () => t.id, listMessages, flipCard, versionOf: () => 2 });
  const state = () => findCard(t.id, 'card_00000001')?.block;
  return { r, t, addCard, state, flips: () => flips };
}
test('live frames flip nothing; a terminal frame writes the facts once', () => {
  const { r, state, flips } = rig();
  r.onFrame(frame('planning')); r.onFrame(frame('building')); r.onFrame(frame('integrating'));
  assert.deepEqual([flips(), state().state], [0, 'running']);
  r.onFrame(frame('done', STATS)); r.onFrame(frame('done', STATS));
  assert.equal(flips(), 1);
  assert.deepEqual([state().state, state().card.version, state().card.agents, state().card.costUsd, state().card.costKnown, state().card.elapsedMs], ['done', 2, 12, 4.2, true, 374000]);
});
test('Review Focus 1: a pause reads paused with its facts, Resume flips it back, and a new server instance picks the card up', () => {
  const { r, t, state, flips } = rig();
  r.onFrame(frame('paused', STATS));
  assert.deepEqual([state().state, state().card.costUsd, state().card.version], ['paused', 4.2, undefined]);
  r.onFrame(frame('building'));
  assert.equal(state().state, 'running');
  r.onFrame(frame('paused', STATS));
  const next = createRoundReceipts({ threadOfDesign: () => t.id, listMessages, flipCard: (tid, id, p) => updateCardBlock(tid, id, p), versionOf: () => 2 });
  next.onFrame(frame('building'));                     // empty cache: it reads the stored `paused` and flips
  assert.deepEqual([state().state, flips()], ['running', 3]);
});
test('stopped, error and interrupted map; no version is written for them', () => {
  for (const [status, want] of [['stopped', 'stopped'], ['error', 'failed'], ['interrupted', 'interrupted']]) {
    const { r, state } = rig();
    r.onFrame(frame(status, STATS));
    assert.equal(state().state, want);
    assert.equal(state().card.version, undefined);
  }
});
test('Review Focus 5: a terminal frame before the card exists lands once it is posted', () => {
  const { r, state, addCard } = rig({ card: false });
  r.onFrame(frame('done', STATS));
  addCard();
  r.posted('b_0123456789ab');
  assert.equal(state().state, 'done');
});
test('other frames and a design with no chat are ignored', () => {
  const { r, flips } = rig();
  r.onFrame({ type: 'design-plan', buildId: 'b_0123456789ab', status: 'done' });
  createRoundReceipts({ threadOfDesign: () => null, listMessages, flipCard: () => assert.fail(), versionOf: () => 0 }).onFrame(frame('done', STATS));
  assert.equal(flips(), 0);
});
test('Review Focus 1: at boot each running or paused receipt takes its build row\'s state; other cards stay', () => {
  const t = createThread({ mode: 'design', title: 'boot' });   // own builds: earlier tests left running cards of b_0123456789ab
  const add = (id, card) => appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state: 'running', card }] });
  add('card_00000001', { type: 'design-round', buildId: 'b_00000000aa01' });
  add('card_00000002', { type: 'other', buildId: 'b_00000000aa01' });
  add('card_00000003', { type: 'design-round', buildId: 'b_00000000aa02' });
  const rows = { b_00000000aa01: 'interrupted', b_00000000aa02: 'paused' };   // recoverDesignBuilds keeps paused rows paused
  assert.equal(sweepDesignRoundCards((bid) => (rows[bid] ? ROUND_STATE_OF[rows[bid]] : null)), 2, 'a null answer leaves a card alone');
  assert.deepEqual(['card_00000001', 'card_00000003', 'card_00000002'].map((id) => findCard(t.id, id).block.state), ['interrupted', 'paused', 'running']);
});
test('the facts: the cost adds the live estimate, an unknown cost stays unknown, the reason rides along, Resume keeps them', () => {
  const t = createThread({ mode: 'design', title: 'facts' });
  const add = (id, buildId) => appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state: 'running', card: { type: 'design-round', buildId } }] });
  add('card_00000001', 'b_00000000bb01');
  add('card_00000002', 'b_00000000bb02');
  const r = createRoundReceipts({ threadOfDesign: () => t.id, listMessages, flipCard: updateCardBlock, versionOf: (id) => (id === 'd_0123456789ab' ? 7 : 0) });
  const at = (buildId, status, stats, reason = null) => ({ ...frame(status, stats), buildId, reason });
  r.onFrame(at('b_00000000bb01', 'paused', { ...STATS, costUsd: 1.5, estimatedUsd: 0.25 }, 'failed'));
  r.onFrame(at('b_00000000bb01', 'building', { agentsTotal: 99, costUsd: 9, costKnown: true, elapsedMs: 1 }));
  const one = findCard(t.id, 'card_00000001').block;
  assert.deepEqual([one.state, one.card.costUsd, one.card.reason, one.card.agents], ['running', 1.75, 'failed', 12], 'running carries the state alone');
  r.onFrame(at('b_00000000bb02', 'done', { ...STATS, costKnown: false }));
  const two = findCard(t.id, 'card_00000002').block;
  assert.deepEqual([two.state, two.card.costKnown, two.card.version], ['done', false, 7]);
  assert.equal(findCard(t.id, 'card_00000001').block.state, 'running', 'a frame flips only its own build\'s receipt');
});
test('the scan skips text rows and other cards of the same build; an unknown status flips nothing', () => {
  const t = createThread({ mode: 'design', title: 'scan' });
  appendMessage(t.id, { role: 'user', text: 'make it' });
  appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_00000009', state: 'running', card: { type: 'other', buildId: 'b_0123456789ab' } }] });
  appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id: 'card_00000001', state: 'running', card: { type: 'design-round', buildId: 'b_0123456789ab' } }] });
  let flips = 0;
  const r = createRoundReceipts({ threadOfDesign: () => t.id, listMessages, flipCard: (tid, id, p) => { flips += 1; return updateCardBlock(tid, id, p); }, versionOf: () => 1 });
  r.onFrame(frame('queued', STATS));
  r.onFrame(frame('toString', STATS));
  assert.equal(flips, 0);
  r.onFrame(frame('stopped', STATS));
  assert.deepEqual([findCard(t.id, 'card_00000001').block.state, findCard(t.id, 'card_00000009').block.state, flips], ['stopped', 'running', 1]);
});
test('Review Focus 5: once a frame finds the stored card, an older waiting frame never replays over it', () => {
  const { r, state, addCard } = rig({ card: false });
  r.onFrame(frame('planning'));
  addCard();
  r.onFrame(frame('done', STATS));
  r.posted('b_0123456789ab');
  assert.equal(state().state, 'done');
});
test('a terminal frame drops its build from the cache: the next frame reads the stored card again', () => {
  const { r, t, state, flips } = rig();
  r.onFrame(frame('done', STATS));
  updateCardBlock(t.id, 'card_00000001', { state: 'running' });
  r.onFrame(frame('done', STATS));
  assert.deepEqual([state().state, flips()], ['done', 2]);
});
test('the boot sweep: a paused receipt can close, a settled one never moves, an equal state is no change, poison rows are skipped', () => {
  const t = createThread({ mode: 'design', title: 'boot 2' });
  const add = (id, state, buildId) => appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state, card: { type: 'design-round', buildId } }] });
  add('card_00000001', 'paused', 'b_00000000cc01');
  add('card_00000002', 'done', 'b_00000000cc02');
  add('card_00000003', 'running', 'b_00000000cc03');
  add('card_00000004', 'running', 'b_00000000cc04');
  appendMessage(t.id, { role: 'assistant', text: '', status: 'done', blocks: [   // one reply, a receipt beside another card
    { kind: 'card', id: 'card_00000006', state: 'running', card: { type: 'design-round', buildId: 'b_00000000cc03' } },
    { kind: 'card', id: 'card_00000007', state: 'running', card: { type: 'other', buildId: 'b_00000000cc01' } },
  ] });
  const poisoned = appendMessage(t.id, { role: 'assistant', text: '', status: 'done' });
  getDb().prepare('UPDATE ask_messages SET blocks = ? WHERE id = ?').run(JSON.stringify({ x: { kind: 'card', id: 'card_00000005', state: 'running', card: { type: 'design-round', buildId: 'b_00000000cc01' } } }), poisoned.id);
  const rows = { b_00000000cc01: 'stopped', b_00000000cc02: 'interrupted', b_00000000cc03: 'running' };
  assert.equal(sweepDesignRoundCards((bid) => rows[bid] ?? null), 1);
  assert.deepEqual([1, 2, 3, 4, 6, 7].map((n) => findCard(t.id, `card_0000000${n}`).block.state), ['stopped', 'done', 'running', 'running', 'running', 'running']);
});
test('in the real app: a design-build frame lands on its receipt, and boot reconciles open receipts from build rows', async () => {
  const mod = await import('../ui/server.mjs');
  const card = (tid, id, buildId, state = 'running') => appendMessage(tid, { role: 'assistant', text: '', status: 'done', blocks: [{ kind: 'card', id, state, card: { type: 'design-round', buildId, baseVersion: 0, summary: 's' } }] });
  const at = (tid, id) => findCard(tid, id).block;
  const t1 = createThread({ mode: 'design', title: 'one' }).id;
  const d1 = createDesign({ kind: 'web', title: 'one', threadId: t1 });
  updateDesign(d1.id, { version: 3 });
  const b1 = createBuild({ designId: d1.id, kind: 'first', brief: 'b' });
  card(t1, 'card_00000001', b1.id);
  mod.designBuilds._broadcast({ type: 'design-build', designId: d1.id, buildId: b1.id, seq: 1, ts: 1, status: 'done', round: 1, kind: 'first', reason: null, waiting: 0, stats: { agentsTotal: 3, costUsd: 1.5, estimatedUsd: 0.25, costKnown: true, elapsedMs: 9000 } });
  const s1 = at(t1, 'card_00000001');
  assert.deepEqual([s1.state, s1.card.version, s1.card.costUsd, s1.card.agents], ['done', 3, 1.75, 3]);
  updateBuild(b1.id, { status: 'done' });
  const b2 = createBuild({ designId: d1.id, kind: 'change', brief: 'b' });   // open and not live: boot recovery closes it
  card(t1, 'card_00000002', b2.id);
  const t2 = createThread({ mode: 'design', title: 'two' }).id;
  const d2 = createDesign({ kind: 'web', title: 'two', threadId: t2 });
  const b3 = createBuild({ designId: d2.id, kind: 'first', brief: 'b' });
  updateBuild(b3.id, { status: 'paused', reason: 'drain' });
  card(t2, 'card_00000003', b3.id);
  card(t2, 'card_00000004', 'b_ffffffffffff');
  card(t2, 'card_00000005', b3.id, 'done');
  await mod.bootMaintenance();
  assert.deepEqual([at(t1, 'card_00000002').state, at(t2, 'card_00000003').state, at(t2, 'card_00000004').state, at(t2, 'card_00000005').state],
    ['interrupted', 'paused', 'interrupted', 'done'], 'no row reads interrupted; a paused row stays paused');
});

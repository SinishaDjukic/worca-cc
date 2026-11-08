// test/design-chat-e2e.test.mjs
// Design P5 Task 14: a web page end to end on the mock engine. A design's chat starts its first build with no
// confirm card, the engine's stage frames flow and dist/index.html lands, and no AI turn runs after the build. A
// second build cannot open while one is open, a pinned change round runs only that section's builder, "Back to
// before this" restores an earlier version without a turn, and the design thread stays off Chat's list. One
// in-process server on the mock engine (test/helpers/design-chat-boot.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, openWs, waitFrame, waitFor, settled, mod } = await bootDesignChat(after);
const { distDir } = await import('../src/core/design/paths.mjs');
const MODEL = { model: 'claude-opus-5-5', effort: 'high' };
let d; const frames = [];
after(() => mod.designBuilds.settled());

test('first build: chat → engine → page, with no AI after it', async () => {
  const ws = await openWs((f) => frames.push(f));
  const made = await call('POST', '/api/design', { kind: 'web', title: 'ShipRadar' });
  d = made.body;
  const r = await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'A landing page for ShipRadar', ...MODEL, design: { designId: d.design.id, pins: [] } });
  assert.equal(r.status, 202);
  await waitFrame(frames, (f) => f.type === 'design-build' && f.designId === d.design.id && f.status === 'done', 60000);
  const types = frames.filter((f) => f.designId === d.design.id).map((f) => f.type);
  for (const t of ['design-plan', 'design-agent', 'design-section', 'design-file']) assert.ok(types.includes(t), t);
  assert.match(readFileSync(join(distDir(d.design.id), 'index.html'), 'utf8'), /data-section=/);
  const snap = await settled(d.threadId);
  const rows = snap.messages.length;
  const card = snap.messages.flatMap((m) => m.blocks || []).find((b) => b.card?.type === 'design-round');
  assert.deepEqual([card.state, card.card.baseVersion, card.card.version, card.card.round], ['done', 0, 1, 1]);
  assert.equal(snap.thread.title, 'ShipRadar');
  await new Promise((res) => setTimeout(res, 200));
  const after2 = await call('GET', `/api/ask/threads/${d.threadId}`);
  assert.equal(after2.body.messages.length, rows, 'no AI turn after the build');
  assert.equal(frames.some((f) => f.threadId === d.threadId && (f.type === 'ask-title' || f.type === 'ask-suggestion')), false);
  ws.close();
});
test('a chat turn cannot start a second build', async () => {
  const pair = await Promise.all([1, 2].map(() => mod.designChatActions.apply({ kind: 'design-change', instruction: 'Bolder', sections: [], needsLead: true }, { threadId: d.threadId, by: 'local' })));
  assert.equal(pair.filter((r) => r.ok).length, 1);
  assert.equal(pair.find((r) => !r.ok).notice, 'A build is already open: wait for it, or press Resume or Stop.');
  pair.find((r) => r.ok).posted(false);
  await waitFor(async () => !mod.designBuilds.live().some((b) => b.designId === d.design.id), 60000);
});
test('change round: a pin names one section, only its builder runs, the same stage frames flow', async () => {
  frames.length = 0;
  const ws = await openWs((f) => frames.push(f));
  const version = (await call('GET', `/api/design/${d.design.id}`)).body.design.version;
  const pin = { id: 'hero', path: 'section > h1', tag: 'h1', text: 'Ship', html: '<h1>Ship</h1>' };
  const plan = (await call('GET', `/api/design/${d.design.id}`)).body.plan;
  pin.id = plan.sections[0].id;
  await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'Make this bolder', ...MODEL, design: { designId: d.design.id, pins: [pin] } });
  await waitFrame(frames, (f) => f.type === 'design-build' && f.designId === d.design.id && f.status === 'done', 60000);
  const agents = new Map(frames.filter((f) => f.type === 'design-agent').map((f) => [f.agentId, f]));
  assert.equal(agents.size, 1);
  assert.deepEqual([[...agents.values()][0].role, [...agents.values()][0].sectionId], ['builder', pin.id]);
  const snap = await settled(d.threadId);
  const last = snap.messages.flatMap((m) => m.blocks || []).filter((b) => b.card?.type === 'design-round').at(-1);
  assert.deepEqual([last.state, last.card.baseVersion, last.card.version], ['done', version, version + 1]);
  ws.close();
});
test('Back to before this restores the earlier page without a turn', async () => {
  const before = (await call('GET', `/api/design/${d.design.id}`)).body.design.version;
  const r = await call('POST', `/api/design/${d.design.id}/versions/1/restore`, { round: 2 });
  assert.deepEqual([r.status, r.body.restoredFrom, r.body.version], [200, 1, before + 1]);
  assert.equal((await call('GET', `/api/ask/threads/${d.threadId}`)).body.inFlight, null);
});
test('the mode stays off Chat', async () => {
  const list = await call('GET', '/api/ask/threads');
  assert.equal(list.body.threads.some((t) => t.id === d.threadId), false);
});

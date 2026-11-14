// test/design-chat-e2e.test.mjs
// Design P5 Task 14: a web page end to end on the mock engine. A design's chat starts its first build with no
// confirm card, the engine's stage frames flow and dist/index.html lands, and no AI turn runs after the build. A
// second build cannot open while one is open, a pinned change round runs only that section's builder, "Back to
// before this" restores an earlier version without a turn, and the design thread stays off Chat's list. One
// in-process server on the mock engine (test/helpers/design-chat-boot.mjs).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

// Design sound C1: answering a sound card saves the key through the real settings, which refuse under node:test unless
// this is set. The boot moves HOME into its own temp home first and restores only its five keys: this file's after
// puts the flag back.
const fallback = process.env.WORCA_TEST_ALLOW_HOME_FALLBACK;
process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => { if (fallback === undefined) delete process.env.WORCA_TEST_ALLOW_HOME_FALLBACK; else process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = fallback; });
const { call, openWs, waitFrame, waitFor, settled, homeDir, mod } = await bootDesignChat(after);
const { designWorkDir, distDir } = await import('../src/core/design/paths.mjs');
const { buildContextHeader } = await import('../src/core/ask/prompt.mjs');
const { getDb } = await import('../src/core/db.mjs');
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

// Design sound P3 Task C1: a video's first start asks about sound with worca's own card. Answering it starts no chat
// turn: Yes saves and checks the key and asks for the voice and the music, and the pick starts the round with the brief
// kept on the card. A typed message closes an open card, and the next start is silent.
const soundCardsOf = (snap) => snap.messages.flatMap((m) => m.blocks || []).filter((b) => b.card?.type === 'design-sound');
const roundsOf = (snap) => snap.messages.flatMap((m) => m.blocks || []).filter((b) => b.card?.type === 'design-round');
const FILM = 'A short film about a pottery studio. MOCK_SAY';
let v;
test('sound: a video\'s first start puts the sound card in the reply, and no round starts', async () => {
  assert.equal((await call('GET', '/api/sound')).body.keySet, false, 'this home has no key yet');
  v = (await call('POST', '/api/design', { kind: 'video', title: 'Clay' })).body;
  assert.equal((await call('POST', `/api/ask/threads/${v.threadId}/messages`, { text: FILM, ...MODEL, design: { designId: v.design.id, pins: [] } })).status, 202);
  const snap = await settled(v.threadId);
  assert.deepEqual(soundCardsOf(snap).map((b) => [b.state, b.card.step, b.card.keyNeeded, b.card.pending]), [['asking', 'ask', true, { kind: 'design-start', brief: FILM }]]);
  assert.deepEqual(roundsOf(snap), []);
  assert.equal(mod.designBuilds.live().some((b) => b.designId === v.design.id), false);
  assert.deepEqual((await call('GET', `/api/design/${v.design.id}/sound`)).body.sound, { on: false });
  const card = soundCardsOf(snap)[0];
  const ctx = await mod._testing.resolveAskContext(v.threadId, { view: 'design' });
  assert.deepEqual(ctx.cards.find((x) => x.id === card.id), { id: card.id, type: 'design-sound', state: 'asking', summary: 'Sound for this video' }, 'never shown to the model as a run card');
  const header = buildContextHeader(ctx);
  assert.ok(header.includes(`design-sound ${card.id} asking "Sound for this video"`), header);
  assert.doesNotMatch(header, / on \)/, 'the header the model reads has no run-card line');
});
test('sound: Yes with a key saves it, answers card 1 and asks for the voice and the music; a second answer is a 409', async () => {
  const c1 = soundCardsOf(await settled(v.threadId))[0];
  const url = `/api/ask/threads/${v.threadId}/cards/${c1.id}`;
  const mine = []; const ws = await openWs((f) => mine.push(f));
  const r = await call('POST', url, { answers: { sound: 'yes', apiKey: 'mock-key' } });
  assert.deepEqual([r.status, r.body.block.state, r.body.block.card.answers], [200, 'answered', { sound: 'yes' }]);
  assert.equal((await call('GET', '/api/sound')).body.keySet, true);
  await waitFrame(mine, (f) => f.type === 'settings-changed', 10000);   // as the Providers row's Save says it
  ws.close();
  const snap = (await call('GET', `/api/ask/threads/${v.threadId}`)).body;
  const stored = soundCardsOf(snap).find((b) => b.id === c1.id);
  assert.deepEqual([stored.state, stored.card.answers, stored.card.pending], ['answered', { sound: 'yes' }, null], 'the store patches a sound card\'s fields');
  const last = snap.messages.at(-1).blocks[0];
  assert.deepEqual([last.card.type, last.card.step, last.state, last.card.voices.length, last.card.pending], ['design-sound', 'pick', 'asking', 6, { kind: 'design-start', brief: FILM }]);
  assert.equal((await call('POST', url, { answers: { sound: 'yes', apiKey: 'mock-key' } })).status, 409);
  assert.equal(snap.inFlight, null, 'no chat turn');
});
test('sound: the pick starts the round with the kept brief; the film gets its sound; the key is in no chat row', async () => {
  const mine = []; const ws = await openWs((f) => mine.push(f));
  const c2 = soundCardsOf(await settled(v.threadId)).at(-1);
  const r = await call('POST', `/api/ask/threads/${v.threadId}/cards/${c2.id}`, { answers: { voiceId: 'mock-voice-1', music: { kind: 'calm' } } });
  assert.deepEqual([r.status, r.body.block.state, r.body.block.card.answers], [200, 'answered', { voiceId: 'mock-voice-1', voiceName: 'Ana', music: { kind: 'calm' } }]);
  await waitFrame(mine, (f) => f.type === 'design-build' && f.designId === v.design.id && f.status === 'done', 60000);
  ws.close();
  const snap = (await call('GET', `/api/ask/threads/${v.threadId}`)).body;
  assert.equal(roundsOf(snap).length, 1, 'the round row follows the card');
  assert.equal(roundsOf(snap)[0].card.summary.endsWith(FILM), true);
  assert.ok(existsSync(join(designWorkDir(v.design.id), 'assets', 'sound', 'sound.json')));
  assert.deepEqual((await call('GET', `/api/design/${v.design.id}/sound`)).body.sound, { on: true, voice: { id: 'mock-voice-1', name: 'Ana' }, music: { kind: 'calm' } });
  assert.equal(JSON.stringify(snap).includes('mock-key'), false);
});
test('sound: a typed message closes an open sound card, and the chat\'s next start runs a silent round', async () => {
  const w = (await call('POST', '/api/design', { kind: 'video', title: 'Kiln' })).body;
  const send = (text) => call('POST', `/api/ask/threads/${w.threadId}/messages`, { text, ...MODEL, design: { designId: w.design.id, pins: [] } });
  assert.equal((await send('A short film about a kiln')).status, 202);
  const card = soundCardsOf(await settled(w.threadId))[0];
  assert.equal(card.state, 'asking');
  // A key never passes through a chat platform; with Design off the card answers 404, as the other design cards do
  // (the boot's WORCA_FLAGS=design locks the flag, so the row flips the env itself and puts it back).
  const remote = await mod._testing.invokeAskCard({ threadId: w.threadId, cardId: card.id, body: { answers: { sound: 'yes', apiKey: 'sk_chat' } }, actor: 'ada@example.com' });
  assert.deepEqual([remote.status, remote.body.code], [403, 'CHAT_REMOTE_REFUSED']);
  const flags = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = '-design';
  let off;
  try { off = await call('POST', `/api/ask/threads/${w.threadId}/cards/${card.id}`, { answers: { sound: 'no' } }); } finally { process.env.WORCA_FLAGS = flags; }
  assert.deepEqual([off.status, off.body.error], [404, 'not found']);
  assert.deepEqual([soundCardsOf(await settled(w.threadId))[0].state, (await call('GET', `/api/design/${w.design.id}/sound`)).body.sound], ['asking', { on: false }]);
  const mine = []; const ws = await openWs((f) => mine.push(f));
  assert.equal((await send('Just make it')).status, 202);
  await waitFrame(mine, (f) => f.type === 'design-build' && f.designId === w.design.id && f.status === 'done', 60000);
  ws.close();
  const snap = await settled(w.threadId);
  assert.deepEqual(soundCardsOf(snap).map((b) => b.state), ['closed']);
  assert.equal(roundsOf(snap).length, 1);
  assert.equal(existsSync(join(designWorkDir(w.design.id), 'assets', 'sound')), false);
  assert.deepEqual((await call('POST', `/api/ask/threads/${w.threadId}/cards/${card.id}`, { answers: { sound: 'no' } })).body, { error: 'card is closed' });
  // The gear's Change reaches the same cards: card 1 with no brief as its own row, one at a time.
  const gear = await call('POST', `/api/design/${w.design.id}/sound/ask`, {});
  assert.equal(gear.status, 201);
  const opened = soundCardsOf(await settled(w.threadId)).at(-1);
  assert.deepEqual([opened.id, opened.state, opened.card.step, opened.card.pending], [gear.body.cardId, 'asking', 'ask', null]);
  assert.equal((await call('POST', `/api/design/${w.design.id}/sound/ask`, {})).status, 409);
});
// The cards route keeps one answer per card in flight (`askCardBusy`). Card 1's answer lists the voices and then saves
// the key, so two tabs answering at once would both pass its re-read, both save a key, and card 2 would list the first
// account's voices under the second key. The row holds the first answer inside the route's busy window (the cards'
// `listVoices` is bound when the server builds them, so the hold sits at `answer`'s door) and sends the second meanwhile.
test('sound: a second answer while card 1 is being applied is a 409, and only the first key is saved', async () => {
  const x = (await call('POST', '/api/design', { kind: 'video', title: 'Wheel' })).body;
  const gear = await call('POST', `/api/design/${x.design.id}/sound/ask`, {});
  assert.equal(gear.status, 201);
  const url = `/api/ask/threads/${x.threadId}/cards/${gear.body.cardId}`;
  const mine = []; const ws = await openWs((f) => mine.push(f));
  const real = mod.soundCards.answer;
  let release = () => {};
  const gate = new Promise((r) => { release = r; });
  const entered = [];
  mod.soundCards.answer = async (a) => { entered.push(a.body?.answers?.apiKey); await gate; return real(a); };
  let first; let second;
  try {
    const pA = call('POST', url, { answers: { sound: 'yes', apiKey: 'sk_tab_a' } });
    await waitFor(() => entered.length === 1);
    let secondDone = false;
    const pB = call('POST', url, { answers: { sound: 'yes', apiKey: 'sk_tab_b' } }).finally(() => { secondDone = true; });
    await waitFor(() => secondDone || entered.length === 2);   // guarded, it answers at once; unguarded, it reaches the card
    release();
    [first, second] = await Promise.all([pA, pB]);
  } finally { mod.soundCards.answer = real; release(); }
  await new Promise((r) => setTimeout(r, 200));   // the save's frame rides another socket than the answer
  ws.close();
  assert.deepEqual([first.status, second.status, second.body], [200, 409, { error: 'card is being applied' }]);
  assert.deepEqual(entered, ['sk_tab_a'], 'the second answer never reached the card');
  assert.equal(JSON.parse(readFileSync(join(homeDir, '.worca-cc', 'settings.json'), 'utf8')).providers.sound.apiKey, 'sk_tab_a');
  assert.equal(mine.filter((f) => f.type === 'settings-changed').length, 1, 'the key was saved once');
  assert.deepEqual(soundCardsOf(await settled(x.threadId)).map((b) => [b.card.step, b.state]), [['ask', 'answered'], ['pick', 'asking']]);
});
// The round a sound card starts is the answering person's: `by` reaches the build's per-person cap and its bill-to.
// The chat here has no owner (a legacy chat every signed-in person reaches), so neither its owner nor `local` stands in.
test('sound: the pick starts the round as the person who answered it, not the chat\'s owner or local', async () => {
  const x = (await call('POST', '/api/design', { kind: 'video', title: 'Lathe' })).body;
  assert.equal((await call('POST', `/api/ask/threads/${x.threadId}/messages`, { text: FILM, ...MODEL, design: { designId: x.design.id, pins: [] } })).status, 202);
  const c1 = soundCardsOf(await settled(x.threadId))[0];
  assert.equal((await call('POST', `/api/ask/threads/${x.threadId}/cards/${c1.id}`, { answers: { sound: 'yes', apiKey: 'mock-key' } })).status, 200);
  const c2 = soundCardsOf(await settled(x.threadId)).at(-1);
  assert.deepEqual([c2.card.step, c2.card.pending], ['pick', { kind: 'design-start', brief: FILM }]);
  getDb().prepare('UPDATE ask_threads SET created_by = NULL WHERE id = ?').run(x.threadId);
  const prev = { header: process.env.WORCA_IDENTITY_HEADER, proxies: process.env.WORCA_IDENTITY_TRUSTED_PROXIES };
  process.env.WORCA_IDENTITY_HEADER = 'x-test-user';
  process.env.WORCA_IDENTITY_TRUSTED_PROXIES = '127.0.0.1,::1';   // the in-process server's callers are loopback
  let r;
  try {
    r = await call('POST', `/api/ask/threads/${x.threadId}/cards/${c2.id}`, { answers: { voiceId: 'mock-voice-1', music: { kind: 'calm' } } }, { 'x-test-user': 'ada@example.com' });
  } finally {
    for (const [k, val] of [['WORCA_IDENTITY_HEADER', prev.header], ['WORCA_IDENTITY_TRUSTED_PROXIES', prev.proxies]]) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  }
  assert.equal(r.status, 200);
  assert.equal((await call('GET', `/api/design/${x.design.id}`)).body.build.createdBy, 'ada@example.com');
  await waitFor(async () => !mod.designBuilds.live().some((b) => b.designId === x.design.id), 60000);
});

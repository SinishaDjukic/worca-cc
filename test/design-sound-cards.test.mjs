// test/design-sound-cards.test.mjs — Design sound P3 Task C1: the two sound cards on the server. Card 1 asks for sound
// and the key, card 2 for the voice and the music; answering one starts no chat model turn. The key never reaches a
// stored block or an answer, a card closed during a call answers 409, and the brief kept on card 1 starts the round.
// Designs live in the real store; the card blocks in an in-memory thread whose flipCard merges `card` shallowly, as
// the ask store's updateCardBlock does for a design-sound card.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { cardStart, createSoundCards } from '../src/core/design/sound-cards.mjs';
import { SoundError, listVoices as realListVoices } from '../src/core/sound.mjs';
import { createDesign, getDesign, updateDesign } from '../src/core/design/store.mjs';

useTempHome(after, 'worca-sound-cards-');

const VOICES = await realListVoices({ mock: true });   // Ana, Ben, Cleo, Dan, Eva, Finn (mock-voice-1 … 6)
const BRIEF = { kind: 'design-start', brief: 'A film about a pottery studio' };
const TID = 'ask_00000001';

/** A chat thread in memory: its card blocks in order, flipped as the ask store flips them. */
function memoryThread() {
  const cards = [];
  return {
    cards,
    appendCardRow: (threadId, block) => { cards.push({ kind: 'card', ...structuredClone(block) }); },
    flipCard: (threadId, cardId, patch) => {
      const b = cards.find((c) => c.id === cardId);
      if (!b) return null;
      if (patch.state) b.state = patch.state;
      if (patch.card) b.card = { ...b.card, ...patch.card };
      return structuredClone(b);
    },
    findCard: (threadId, cardId) => structuredClone(cards.find((c) => c.id === cardId) ?? null),
    listCards: () => structuredClone(cards),
  };
}

/** A video design, its in-memory thread and sound cards over recorded fakes; `over` replaces any dep. */
function rig(over = {}) {
  const d = createDesign({ kind: 'video', title: 'Pottery' }, { by: 'local' });
  const thread = memoryThread();
  const seen = { voices: [], saved: [], started: [], logged: [] };
  let n = 0;
  const state = { available: true, configured: false };
  const deps = {
    getDesign, updateDesign,
    soundState: () => ({ ...state }),
    listVoices: async (o) => { seen.voices.push(o.key); return VOICES; },
    saveKey: async (key) => { seen.saved.push(key); },
    ...thread,
    newCardId: () => `card_${String(n += 1).padStart(8, '0')}`,
    start: async (pending, ctx) => { seen.started.push([pending, ctx]); },
    log: (name) => { seen.logged.push(name); },
    ...over,
  };
  const cards = createSoundCards(deps);
  return { d, thread, seen, state, cards, deps };
}

/** Card 1 for `d`, stored in the thread with the brief (as apply's posted(false) stores it). */
function ask(r, pending = BRIEF) {
  const block = r.cards.askBlock({ design: r.d, pending });
  r.thread.appendCardRow(TID, block);
  return r.thread.findCard(TID, block.id);
}
const answer = (r, block, answers) => r.cards.answer({ threadId: TID, block: r.thread.findCard(TID, block.id), body: { answers }, by: 'local' });

test('askBlock: card 1 holds the brief and says whether a key is needed; available is a video with the service on', () => {
  const r = rig();
  const b = r.cards.askBlock({ design: r.d, pending: BRIEF });
  assert.deepEqual(b, { id: 'card_00000001', state: 'asking', card: { type: 'design-sound', step: 'ask', designId: r.d.id, heading: 'Sound for this video', summary: 'Sound for this video', keyNeeded: true, pending: BRIEF } });
  r.state.configured = true;
  assert.equal(r.cards.askBlock({ design: r.d, pending: null }).card.keyNeeded, false);
  assert.equal(r.cards.available(r.d), true);
  assert.equal(r.cards.available({ ...r.d, kind: 'web' }), false);
  assert.equal(r.cards.available(null), false);
  r.state.available = false;
  assert.equal(r.cards.available(r.d), false);
});

test('B1 No: the card is answered, the design stays silent and the kept brief starts', async () => {
  const r = rig();
  const c1 = ask(r);
  const res = await answer(r, c1, { sound: 'no' });
  assert.equal(res.status, 200);
  assert.deepEqual([res.block.state, res.block.card.answers, res.block.card.pending], ['answered', { sound: 'no' }, null]);
  assert.deepEqual(r.seen.started, [[BRIEF, { threadId: TID, by: 'local' }]]);
  assert.deepEqual(getDesign(r.d.id).sound, { on: false });
  assert.equal(r.cards.openCard(TID), null);
});

test('B2 Yes with a typed key: the trimmed key lists the voices and is saved once; card 2 keeps the brief; the key is stored nowhere', async () => {
  const r = rig();
  const c1 = ask(r);
  const res = await answer(r, c1, { sound: 'yes', apiKey: ' sk_typed_0123456789 ' });
  assert.equal(res.status, 200);
  assert.deepEqual(r.seen.voices, ['sk_typed_0123456789']);
  assert.deepEqual(r.seen.saved, ['sk_typed_0123456789']);
  assert.deepEqual([res.block.state, res.block.card.answers, res.block.card.pending], ['answered', { sound: 'yes' }, null]);
  const c2 = r.cards.openCard(TID);
  assert.deepEqual([c2.state, c2.card.type, c2.card.step, c2.card.designId, c2.card.heading, c2.card.summary, c2.card.pending], ['asking', 'design-sound', 'pick', r.d.id, 'Voice and music', 'Voice and music', BRIEF]);
  assert.deepEqual(c2.card.voices, VOICES);
  assert.deepEqual(r.seen.started, []);
  assert.equal(JSON.stringify(r.thread.cards).includes('sk_typed'), false);
  assert.equal(JSON.stringify(res).includes('sk_typed'), false);
  // The saved key on a later card: no key typed, none sent.
  const s = rig();
  s.state.configured = true;
  assert.equal((await answer(s, ask(s), { sound: 'yes', apiKey: '••••••6789' })).status, 200);
  assert.deepEqual([s.seen.voices, s.seen.saved], [[undefined], []]);
});

test('B3: each key failure answers its own words, and never the key', async () => {
  const yes = (r, apiKey) => answer(r, ask(r), { sound: 'yes', ...(apiKey === undefined ? {} : { apiKey }) });
  const refusing = (err) => ({ listVoices: async () => { throw err; } });
  const r0 = rig();
  assert.deepEqual(await yes(r0), { status: 422, error: 'Enter your ElevenLabs API key', path: 'apiKey' });
  const r1 = rig(refusing(new SoundError('ElevenLabs rejected the key', 401)));
  assert.deepEqual(await yes(r1, 'sk_bad'), { status: 422, error: 'ElevenLabs rejected this key', path: 'apiKey' });
  assert.deepEqual(r1.seen.saved, []);
  const r2 = rig(refusing(new SoundError('this ElevenLabs plan or key cannot do that', 403)));
  r2.state.configured = true;
  const c = ask(r2);
  assert.deepEqual(await answer(r2, c, { sound: 'yes' }), { status: 422, error: 'ElevenLabs rejected the saved key. Enter a new one.', path: 'apiKey' });
  assert.deepEqual([r2.thread.findCard(TID, c.id).state, r2.thread.findCard(TID, c.id).card.keyNeeded], ['asking', true]);
  assert.deepEqual(await yes(rig(refusing(new SoundError('ElevenLabs did not answer in time', 504))), 'sk_x'), { status: 502, error: 'ElevenLabs could not be reached' });
  assert.deepEqual(await yes(rig(refusing(new SoundError('ElevenLabs is busy; try again', 429))), 'sk_x'), { status: 502, error: 'ElevenLabs is busy; try again' });
  const leak = rig(refusing(new TypeError('fetch failed for sk_leaky_key')));
  const lr = await yes(leak, 'sk_leaky_key');
  assert.deepEqual(lr, { status: 502, error: 'ElevenLabs could not be reached' });
  assert.equal(JSON.stringify(lr).includes('sk_leaky'), false);
  assert.deepEqual(leak.seen.logged, ['TypeError'], 'logged by its name only');
  assert.deepEqual(await yes(rig({ listVoices: async () => [] }), 'sk_x'), { status: 422, error: 'This ElevenLabs account has no voice with a sample' });
  for (const typed of ['${ELEVEN}', 'k'.repeat(513)]) {
    const r = rig();
    assert.deepEqual(await yes(r, typed), { status: 422, error: 'ElevenLabs rejected this key', path: 'apiKey' }, typed.slice(0, 12));
    assert.deepEqual(r.seen.voices, [], 'no call');
  }
  const broker = rig({ saveKey: async () => { throw Object.assign(new Error('worca can\'t store a sound key: with the credential broker, each person does that on the key page'), { code: 'BROKER' }); } });
  assert.deepEqual(await yes(broker, 'sk_x'), { status: 422, error: 'worca can\'t store a sound key: with the credential broker, each person does that on the key page', path: 'apiKey' });
  const disk = rig({ saveKey: async () => { throw new Error('EACCES /home/x'); } });
  const dr = await yes(disk, 'sk_x');
  assert.deepEqual(dr, { status: 502, error: 'ElevenLabs could not be reached' });
  assert.equal(JSON.stringify(dr).includes('/home/x'), false);
  assert.deepEqual(disk.seen.logged, ['Error'], 'answer\'s own catch logs the name only');
  for (const r of [r0, r1, r2, leak, broker, disk]) {
    assert.deepEqual(r.seen.started, []);
    assert.equal(r.thread.cards.length, 1, 'no card 2');
  }
});

test('B4: a card closed while the key is checked or saved answers 409, and no card 2 follows', async () => {
  let closeNow;
  const r = rig({ listVoices: async () => { closeNow(); return VOICES; } });
  const c = ask(r);
  closeNow = () => r.thread.flipCard(TID, c.id, { state: 'closed' });
  assert.deepEqual(await answer(r, c, { sound: 'yes', apiKey: 'sk_x' }), { status: 409, error: 'card is closed' });
  assert.deepEqual([r.seen.saved, r.thread.cards.length], [[], 1]);
  // B4b: closed while the key is saved; the checked key stays saved.
  let close2;
  const s = rig({ saveKey: async (k) => { s.seen.saved.push(k); close2(); } });
  const c2 = ask(s);
  close2 = () => s.thread.flipCard(TID, c2.id, { state: 'closed' });
  assert.deepEqual(await answer(s, c2, { sound: 'yes', apiKey: 'sk_x' }), { status: 409, error: 'card is closed' });
  assert.deepEqual([s.seen.saved, s.thread.cards.length, s.thread.cards[0].state], [['sk_x'], 1, 'closed']);
});

test('B5 pick: each bad answer is a 422 on its field; a good one stores the sound and starts the brief once', async () => {
  const r = rig();
  await answer(r, ask(r), { sound: 'yes', apiKey: 'sk_x' });
  const c2 = r.cards.openCard(TID);
  const pick = (answers) => answer(r, c2, answers);
  assert.deepEqual(await pick({ voiceId: 'nope', music: { kind: 'calm' } }), { status: 422, error: 'Pick a voice', path: 'voiceId' });
  assert.deepEqual(await pick({ voiceId: 'mock-voice-1', music: { kind: 'jazz' } }), { status: 422, error: 'Say what the music should sound like', path: 'music' });
  assert.deepEqual(await pick({ voiceId: 'mock-voice-1', music: { kind: 'custom', text: '   ' } }), { status: 422, error: 'Say what the music should sound like', path: 'music' });
  assert.deepEqual(await pick({ voiceId: 'mock-voice-1', music: { kind: 'custom', text: 'x'.repeat(301) } }), { status: 422, error: 'Keep the music description under 300 characters', path: 'music' });
  assert.deepEqual(r.seen.started, []);
  const ok = await pick({ voiceId: 'mock-voice-1', music: { kind: 'custom', text: ' Soft piano ' } });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.block.state, ok.block.card.answers, ok.block.card.pending], ['answered', { voiceId: 'mock-voice-1', voiceName: 'Ana', music: { kind: 'custom', text: 'Soft piano' } }, null]);
  assert.deepEqual(getDesign(r.d.id).sound, { on: true, voice: { id: 'mock-voice-1', name: 'Ana' }, music: { kind: 'custom', text: 'Soft piano' } });
  assert.deepEqual(r.seen.started, [[BRIEF, { threadId: TID, by: 'local' }]]);
  assert.deepEqual(await pick({ voiceId: 'mock-voice-1', music: { kind: 'calm' } }), { status: 409, error: 'card is answered' });
  assert.equal(r.seen.started.length, 1);
  // A name past 80 characters with a line break is folded to one line of 80, never refused.
  const long = 'A'.repeat(50) + '\n' + 'B'.repeat(50);
  const s = rig({ listVoices: async () => [{ id: 'v-long', name: long, about: '' }] });
  await answer(s, ask(s), { sound: 'yes', apiKey: 'sk_x' });
  const picked = await answer(s, s.cards.openCard(TID), { voiceId: 'v-long', music: { kind: 'none' } });
  assert.equal(picked.status, 200);
  const name = getDesign(s.d.id).sound.voice.name;
  assert.deepEqual([name.length, name, picked.block.card.answers.voiceName], [80, `${'A'.repeat(50)} ${'B'.repeat(29)}`, name]);
  assert.deepEqual(getDesign(s.d.id).sound.music, { kind: 'none' });
});

test('B6 gear: one sound card at a time; answering No writes the choice and starts nothing', async () => {
  const r = rig();
  const opened = await r.cards.openFromGear({ design: r.d, threadId: TID });
  assert.deepEqual(opened, { cardId: 'card_00000001' });
  assert.deepEqual([r.thread.cards[0].card.step, r.thread.cards[0].card.pending], ['ask', null]);
  assert.equal(getDesign(r.d.id).sound, null, 'opening writes nothing on the design');
  assert.equal(await r.cards.openFromGear({ design: r.d, threadId: TID }), null);
  assert.equal(r.thread.cards.length, 1);
  const res = await answer(r, r.thread.cards[0], { sound: 'no' });
  assert.equal(res.status, 200);
  assert.deepEqual(getDesign(r.d.id).sound, { on: false });
  assert.deepEqual(r.seen.started, []);
  assert.deepEqual(await r.cards.openFromGear({ design: r.d, threadId: TID }), { cardId: 'card_00000002' }, 'an answered card is not open');
});

test('B6: closeGearCards closes only open cards without a brief; holding sees a hold or an open card with one', async () => {
  const r = rig();
  const gear = await r.cards.openFromGear({ design: r.d, threadId: TID });
  assert.equal(r.cards.holding(TID), false);
  r.cards.hold(TID);
  assert.equal(r.cards.holding(TID), true);
  r.cards.release(TID);
  assert.equal(r.cards.holding(TID), false);
  const c1 = ask(r);
  assert.equal(r.cards.holding(TID), true, 'an open card with a brief');
  r.cards.closeGearCards(TID);
  assert.deepEqual([r.thread.findCard(TID, gear.cardId).state, r.thread.findCard(TID, c1.id).state], ['closed', 'asking']);
});

test('B7 cardStart: a refusal is a notice, a start posts its row, a throw is logged and swallowed', async () => {
  const notices = []; const logged = []; const seen = [];
  const posted = [];
  const startWith = (r) => cardStart({ getActions: () => ({ apply: async (req, ctx) => { seen.push([req, ctx]); if (r instanceof Error) throw r; return r; } }), postNotice: (tid, text) => notices.push([tid, text]), log: (n) => logged.push(n) });
  await startWith({ ok: false, notice: 'Design is switched off.' })(BRIEF, { threadId: TID, by: 'local' });
  assert.deepEqual(notices, [[TID, 'Design is switched off.']]);
  assert.deepEqual(seen, [[BRIEF, { threadId: TID, by: 'local', soundDecided: true }]]);
  await startWith({ ok: true, block: {}, posted: (added) => posted.push(added) })(BRIEF, { threadId: TID, by: 'local' });
  assert.deepEqual(posted, [false]);
  await assert.doesNotReject(startWith(new TypeError('boom'))(BRIEF, { threadId: TID, by: 'local' }));
  assert.deepEqual(logged, ['TypeError']);
  assert.equal(notices.length, 1);
});

test('B8: a bad body is a 4xx, never a throw', async () => {
  for (const body of [{}, { answers: 'yes' }, { answers: { sound: { toString: 0 } } }, { answers: { sound: 'yes', apiKey: {} } }, null, { answers: [] }]) {
    const r = rig();
    const c = ask(r);
    const res = await r.cards.answer({ threadId: TID, block: c, body, by: 'local' });
    assert.ok(res.status >= 400 && res.status < 500, JSON.stringify(body));
    assert.equal(r.thread.findCard(TID, c.id).state, 'asking');
  }
  const r = rig();
  assert.deepEqual(await answer(r, ask(r), { sound: 'maybe' }), { status: 422, error: 'Pick Yes or No' });
  await answer(r, ask(r), { sound: 'yes', apiKey: 'sk_x' });
  const c2 = r.cards.openCard(TID);
  for (const body of [{}, { answers: 'x' }, { answers: { voiceId: 'mock-voice-1' } }, { answers: { voiceId: 'mock-voice-1', music: 'calm' } }, { answers: { voiceId: { toString: 0 }, music: { kind: 'calm' } } }]) {
    const res = await r.cards.answer({ threadId: TID, block: c2, body, by: 'local' });
    assert.equal(res.status, 422, JSON.stringify(body));
  }
});

test('B9 restart: new sound cards over the stored card 1 answer it and start the kept brief', async () => {
  const r = rig();
  const c1 = ask(r);
  const started = [];
  const again = createSoundCards({ ...r.deps, start: async (p, ctx) => { started.push([p, ctx]); } });
  assert.equal(again.holding(TID), true, 'the stored brief holds the thread');
  const res = await again.answer({ threadId: TID, block: r.thread.findCard(TID, c1.id), body: { answers: { sound: 'no' } }, by: 'local' });
  assert.equal(res.status, 200);
  assert.deepEqual(started, [[BRIEF, { threadId: TID, by: 'local' }]]);
});

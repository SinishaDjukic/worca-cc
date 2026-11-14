// test/design-sound.test.mjs — Design sound (P2 Task B3): src/core/design/sound.mjs. The manifest in
// `work/assets/sound/` is an agent's to write, so it is read as untrusted; a scene grows to fit its voice; and the sound
// stage's work: clips made or reused, the music, every dollar booked, a stop or a refusal in the middle of it.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SoundError, silentWav } from '../src/core/sound.mjs';
import { estimateWords } from '../src/core/elevenlabs.mjs';
import { musicPrompt, musicUsd, SOUND_LIMITS, voiceUsd } from '../src/shared/sound-services.mjs';
import { designDir, designWorkDir } from '../src/core/design/paths.mjs';
import { fitDurations, makeSound, readSoundManifest, removeSound, sentenceCues, soundTracks } from '../src/core/design/sound.mjs';
import { newDesign, useDesignEnv } from './helpers/design-fixture.mjs';

useDesignEnv(after);
/** Every outside folder a test makes (mkdtempSync), removed by its exact path: never a glob, never tmpdir() itself. */
const made = [];
after(() => {
  for (const p of made) rmSync(p, { recursive: true, force: true });
});

const ON_CALM = { on: true, voice: { id: 'mock-voice-1', name: 'Ana' }, music: { kind: 'calm' } };

/** A new video plan of `[id, duration, say?]` scenes. */
function videoPlan(pairs) {
  return {
    v: 1, kind: 'video', title: 'T', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '',
    sections: pairs.map(([id, duration, say]) => ({
      id, job: `the ${id} scene`, brief: `Show the ${id} scene.`, parts: [], duration, ...(say === undefined ? {} : { say }),
    })),
  };
}
/** A new plan whose scene `id` says `say`; `undefined` takes its words away. */
function withSay(plan, id, say) {
  return {
    ...plan,
    sections: plan.sections.map((s) => {
      if (s.id !== id) return s;
      const { say: _old, ...rest } = s;
      return say === undefined ? rest : { ...rest, say };
    }),
  };
}
/** A new plan whose scene `id` lasts `s` seconds. */
function withDuration(plan, id, s) {
  return { ...plan, sections: plan.sections.map((x) => (x.id === id ? { ...x, duration: s } : x)) };
}
const PLAN = videoPlan([['open', 4, 'Meet worca. It plans.'], ['mid', 6], ['close', 3, 'Try it today.']]);

const abortError = () => new DOMException('This operation was aborted', 'AbortError');
/** P1's `speak`, stubbed: records each call, then answers a silent clip whose length `speak.seconds` may set. */
async function speak({ text, previousText, nextText, signal }) {
  speak.calls.push({ text, previousText, nextText });
  speak.onCall?.(speak.calls.length);
  if (signal?.aborted) throw abortError();
  if (speak.fail) throw speak.fail;
  const s = speak.seconds?.[text] ?? { 'Meet worca. It plans.': 4.82, 'Try it today.': 2 }[text] ?? 2;
  return {
    bytes: silentWav(s), ext: 'wav', seconds: s, words: estimateWords(text, 2.5).words.map(({ w, t0, t1 }) => ({ w, t0, t1 })),
    chars: text.length, costUsd: voiceUsd(text.length), model: 'elevenlabs/eleven_multilingual_v2',
  };
}
/** P1's `compose`, stubbed: a silent track of the asked length. */
async function compose({ prompt, seconds }) {
  compose.calls.push({ prompt, seconds });
  return { bytes: silentWav(seconds), ext: 'wav', seconds, costUsd: musicUsd(seconds), model: 'elevenlabs/music_v2_5' };
}
/** The round's booking, stubbed: `book.onCall` may pause the round, as a booking that reaches a limit does. */
function book(usd, model) {
  book.calls.push([usd, model]);
  book.onCall?.();
}
function reset() {
  speak.calls = [];
  compose.calls = [];
  book.calls = [];
  delete speak.fail;
  delete speak.seconds;
  delete speak.onCall;
  delete book.onCall;
}

let designId;
let workDir;
const run = (opts) => makeSound({ designId, workDir, plan: PLAN, sound: ON_CALM, speak, compose, book, ...opts });

beforeEach(() => {
  designId = newDesign({ kind: 'video' }).id;
  workDir = designWorkDir(designId);
  reset();
});

test('fitDurations grows only what needs it and drops what cannot fit', () => {
  const plan = videoPlan([['a', 3], ['b', 8], ['c', 5]]);
  const out = fitDurations(plan, new Map([['a', { seconds: 4.82 }], ['b', { seconds: 2 }], ['c', { seconds: 599.5 }]]));
  assert.deepEqual(out.plan.sections.map((s) => s.duration), [5.7, 8, 5]);
  assert.deepEqual(out.grown, [{ id: 'a', from: 3, to: 5.7 }]);
  assert.deepEqual(out.dropped, ['c']);
  assert.equal(plan.sections[0].duration, 3);
  assert.deepEqual(fitDurations(videoPlan([['x', 3]]), new Map([['x', { seconds: 2.2 }]])).grown, []);       // 3.0000000000000004 is 3
});
test('sentenceCues starts a cue at each sentence', () => {
  const words = [{ w: 'Meet', t0: 0.05, t1: 0.3 }, { w: 'worca.', t0: 0.3, t1: 0.8 }, { w: 'It', t0: 1.1, t1: 1.2 }, { w: 'plans.', t0: 1.2, t1: 1.7 }];
  assert.deepEqual(sentenceCues('Meet worca. It plans.', words, 0.35), [{ t: 0.4, text: 'Meet worca.' }, { t: 1.45, text: 'It plans.' }]);
  assert.deepEqual(sentenceCues('Hello', [], 0.35), [{ t: 0.35, text: 'Hello' }]);
});
test('makeSound: clips, neighbours as context, the fit, one music call, every dollar booked', async () => {
  const r = await run({ sound: ON_CALM });
  assert.deepEqual(speak.calls.map((c) => [c.text, c.previousText, c.nextText]), [['Meet worca. It plans.', undefined, 'Try it today.'], ['Try it today.', 'Meet worca. It plans.', undefined]]);
  assert.deepEqual(r.plan.sections.map((s) => s.duration), [5.7, 6, 3]);
  assert.deepEqual(r.grown, [{ id: 'open', from: 4, to: 5.7 }]);
  assert.deepEqual(compose.calls, [{ prompt: musicPrompt({ kind: 'calm' }), seconds: 14.7 }]);
  assert.deepEqual(r.made, { voice: 2, reused: 0, music: true });
  assert.deepEqual([[...r.clips.keys()], r.music.file], [['open', 'close'], 'music.wav']);
  assert.deepEqual(r.failed, []);
  assert.deepEqual(book.calls, [[voiceUsd(21), 'elevenlabs/eleven_multilingual_v2'], [voiceUsd(13), 'elevenlabs/eleven_multilingual_v2'], [musicUsd(14.7), 'elevenlabs/music_v2_5']]);
  const m = readSoundManifest(workDir);
  assert.deepEqual(m.clips.map((c) => [c.id, c.file, c.at, c.seconds]), [['open', 'voice-open.wav', 0.35, 4.82], ['close', 'voice-close.wav', 0.35, 2]]);
  assert.deepEqual(m.voice, { id: 'mock-voice-1', name: 'Ana', model: 'eleven_multilingual_v2' });
  assert.deepEqual(soundTracks(workDir, r.plan), { clips: [{ id: 'open', file: 'voice-open.wav', start: 0.35, seconds: 4.82 }, { id: 'close', file: 'voice-close.wav', start: 12.05, seconds: 2 }],
    music: { file: 'music.wav', seconds: 14.7, gain: 0.16 } });
});
test('a second run makes nothing; changed words make one clip; a new voice makes all; music follows the film', async () => {
  const first = await run({ sound: ON_CALM });
  reset();
  assert.deepEqual((await run({ sound: ON_CALM, plan: first.plan })).made, { voice: 0, reused: 2, music: false });
  assert.deepEqual([speak.calls.length, compose.calls.length, book.calls.length], [0, 0, 0]);
  reset();
  await run({ sound: ON_CALM, plan: withSay(first.plan, 'close', 'Try it now.') });
  assert.deepEqual(speak.calls.map((c) => c.text), ['Try it now.']);
  reset();
  await run({ sound: { ...ON_CALM, voice: { id: 'mock-voice-2', name: 'Ben' } }, plan: first.plan });
  assert.equal(speak.calls.length, 2);
  reset();
  await run({ sound: ON_CALM, plan: withDuration(first.plan, 'mid', 9) });              // the film is 3 s longer than the track
  assert.equal(compose.calls.length, 1);
  reset();
  await run({ sound: ON_CALM, plan: withDuration(first.plan, 'mid', 5) });              // shorter: the track is kept
  assert.equal(compose.calls.length, 0);
});
test('words removed, music set to none, sound removed', async () => {
  const first = await run({ sound: ON_CALM });
  await run({ sound: { ...ON_CALM, music: { kind: 'none' } }, plan: withSay(first.plan, 'close', undefined) });
  const m = readSoundManifest(workDir);
  assert.deepEqual([m.clips.map((c) => c.id), m.music], [['open'], null]);
  assert.deepEqual(readdirSync(join(workDir, 'assets/sound')).sort(), ['sound.json', 'voice-open.wav']);
  removeSound(designId);
  assert.equal(existsSync(join(workDir, 'assets/sound')), false);
});
test('an abort keeps what was made and books nothing for what was cut', async () => {
  const ctl = new AbortController();
  speak.onCall = (n) => { if (n === 2) ctl.abort(); };                                  // the stub rejects AbortError once aborted
  await assert.rejects(run({ sound: ON_CALM, signal: ctl.signal, atOnce: 1 }), { name: 'AbortError' });
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open']);
  assert.equal(book.calls.length, 1);
  assert.deepEqual(readdirSync(join(workDir, 'assets/sound')).sort(), ['sound.json', 'voice-open.wav']);
  reset();
  assert.deepEqual((await run({ sound: ON_CALM })).made, { voice: 1, reused: 1, music: true });
});
test('a booking that pauses the round still keeps the clip it paid for', async () => {
  const ctl = new AbortController();
  book.onCall = () => ctl.abort();                                                      // the cap closed on this booking
  await assert.rejects(run({ sound: ON_CALM, signal: ctl.signal, atOnce: 1 }), { name: 'AbortError' });
  assert.deepEqual([speak.calls.length, book.calls.length], [1, 1]);
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open']);
  assert.equal(existsSync(join(workDir, 'assets/sound/voice-open.wav')), true);
});
test('changed words that fail leave no old voice; tracks follow the plan\'s words', async () => {
  const first = await run({ sound: ON_CALM });
  reset(); speak.fail = new SoundError('ElevenLabs is busy; try again', 429);
  await run({ sound: ON_CALM, plan: withSay(first.plan, 'close', 'Try it now.') });
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open']);
  assert.equal(existsSync(join(workDir, 'assets/sound/voice-close.wav')), false);
  assert.deepEqual(soundTracks(workDir, withSay(first.plan, 'open', 'Other words.')).clips, []);
  assert.equal(soundTracks(workDir, null), null);
});
test('a refusal is a reason, not a throw; 401 stops everything, 403 only the voice', async () => {
  speak.fail = new SoundError('ElevenLabs rejected the key', 401);
  const r = await run({ sound: ON_CALM, atOnce: 1 });
  assert.deepEqual([speak.calls.length, compose.calls.length, book.calls.length], [1, 0, 0]);
  assert.deepEqual(r.failed, [{ what: 'voice', id: 'open', reason: 'ElevenLabs rejected the key' }]);
  assert.deepEqual(r.plan.sections.map((s) => s.duration), [4, 6, 3]);
  reset(); speak.fail = new SoundError('this ElevenLabs plan or key cannot do that', 403);
  const r2 = await run({ sound: ON_CALM, atOnce: 1 });
  assert.deepEqual([speak.calls.length, compose.calls.length], [1, 1]);
  assert.deepEqual(r2.made, { voice: 0, reused: 0, music: true });
});
test('a clip too long for any scene is dropped with its reason', async () => {
  speak.seconds = { 'Meet worca. It plans.': 599.5 };
  const r = await run({ sound: ON_CALM });
  assert.deepEqual(r.failed, [{ what: 'voice', id: 'open', reason: 'the voice for open is longer than a scene can be' }]);
  assert.equal(existsSync(join(workDir, 'assets/sound/voice-open.wav')), false);
});
test('the manifest is read as an agent wrote it', { skip: process.platform === 'win32' }, async () => {
  await run({ sound: ON_CALM });
  const file = join(workDir, 'assets/sound/sound.json');
  const good = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...good, clips: [{ ...good.clips[0], file: '../../plan.json' }, { ...good.clips[1], seconds: 'NaN' }], music: { ...good.music, file: 'music.exe' } }));
  assert.deepEqual(readSoundManifest(workDir), { v: 1, voice: good.voice, clips: [], music: null });
  assert.equal(soundTracks(workDir, videoPlan([['open', 4]])), null);
  writeFileSync(file, 'x'.repeat(SOUND_LIMITS.manifestBytes + 1));
  assert.equal(readSoundManifest(workDir), null);
  rmSync(file); symlinkSync('/etc/hosts', file);
  assert.equal(readSoundManifest(workDir), null);
  const outside = mkdtempSync(join(tmpdir(), 'sound-link-')); made.push(outside);       // removed by exact path in after()
  rmSync(join(workDir, 'assets/sound'), { recursive: true }); symlinkSync(outside, join(workDir, 'assets/sound'));
  await run({ sound: ON_CALM });                                                        // the link is replaced, never written through
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(lstatSync(join(workDir, 'assets/sound')).isDirectory(), true);
});
test('the manifest bound: a manifest at SOUND_LIMITS.manifestBytes is read, one byte past it is not', async () => {
  await run({ sound: ON_CALM });
  const file = join(workDir, 'assets/sound/sound.json');
  const text = readFileSync(file, 'utf8');
  writeFileSync(file, text.padEnd(SOUND_LIMITS.manifestBytes, ' '));                    // still JSON: only the bound refuses it
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open', 'close']);
  writeFileSync(file, text.padEnd(SOUND_LIMITS.manifestBytes + 1, ' '));
  assert.equal(readSoundManifest(workDir), null);
});
test('a clip whose file is a link is not played, and is made again', { skip: process.platform === 'win32' }, async () => {
  const first = await run({ sound: ON_CALM });
  const clip = join(workDir, 'assets/sound/voice-open.wav');
  rmSync(clip); symlinkSync(join(workDir, 'assets/sound/voice-close.wav'), clip);
  assert.deepEqual(soundTracks(workDir, first.plan).clips.map((c) => c.id), ['close']);
  reset();
  assert.deepEqual((await run({ sound: ON_CALM, plan: first.plan })).made, { voice: 1, reused: 1, music: false });
  assert.deepEqual(speak.calls.map((c) => c.text), ['Meet worca. It plans.']);
  assert.equal(lstatSync(clip).isFile(), true);
});
test('changed words cut by a stop leave no old voice either: the prune comes before any call', async () => {
  const first = await run({ sound: ON_CALM });
  reset();
  const ctl = new AbortController();
  speak.onCall = () => ctl.abort();
  await assert.rejects(run({ sound: ON_CALM, plan: withSay(first.plan, 'close', 'Try it now.'), signal: ctl.signal }), { name: 'AbortError' });
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open']);
  assert.equal(existsSync(join(workDir, 'assets/sound/voice-close.wav')), false);
  assert.equal(book.calls.length, 0);
});
test('a booking that throws never skips the write', async () => {
  book.onCall = () => { throw new Error('the ledger is busy'); };
  const r = await run({ sound: ON_CALM });
  assert.deepEqual([r.made, r.failed], [{ voice: 2, reused: 0, music: true }, []]);
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['open', 'close']);
  assert.equal(book.calls.length, 3);
});
test('the fit\'s edges: need is read to the millisecond, 600 s is still a scene; !, ? and … end a sentence', () => {
  const fit = (seconds, duration) => fitDurations(videoPlan([['x', duration]]), new Map([['x', { seconds }]]));
  assert.deepEqual([fit(2.2004, 3).grown, fit(2.2004, 3).plan.sections[0].duration], [[], 3]);   // 3.0004 is 3, never 3.1
  assert.deepEqual([fit(599.2, 10).grown, fit(599.2, 10).dropped], [[{ id: 'x', from: 10, to: 600 }], []]);
  const words = [{ w: 'Wow!', t0: 0 }, { w: 'Really?', t0: 1 }, { w: 'Yes…', t0: 2 }, { w: 'and', t0: 3 }, { w: 'more', t0: 3.5 }];
  assert.deepEqual(sentenceCues('Wow! Really? Yes… and more', words, 0.35).map((c) => c.text), ['Wow!', 'Really?', 'Yes…', 'and more']);
});
test('the voice: nothing for nothing, a reason once, the other type goes, not sound is still booked, a pause on the last booking makes no music', async () => {
  const silent = await run({ sound: { ...ON_CALM, music: { kind: 'none' } }, plan: videoPlan([['a', 3]]) });
  assert.deepEqual([silent.made, existsSync(join(workDir, 'assets/sound'))], [{ voice: 0, reused: 0, music: false }, false]);
  speak.fail = new SoundError('ElevenLabs is busy; try again', 429);
  assert.deepEqual((await run({ sound: ON_CALM })).failed, [{ what: 'voice', id: 'open', reason: 'ElevenLabs is busy; try again' }]);
  reset();
  writeFileSync(join(workDir, 'assets/sound/voice-open.mp3'), 'an old type');
  await run({ sound: ON_CALM });
  assert.equal(existsSync(join(workDir, 'assets/sound/voice-open.mp3')), false);
  reset();
  const ogg = async (o) => ({ ...(await speak(o)), ext: 'ogg' });
  const r = await run({ sound: ON_CALM, plan: withSay(PLAN, 'close', 'Try it now.'), speak: ogg });
  assert.deepEqual([r.failed, book.calls.length], [[{ what: 'voice', id: 'close', reason: 'ElevenLabs answered with something that is not sound' }], 1]);
  assert.deepEqual(readdirSync(join(workDir, 'assets/sound')).filter((n) => n.startsWith('voice-close')), []);
  reset();
  const ctl = new AbortController();
  book.onCall = () => ctl.abort();                                                      // the last clip's booking closes the cap
  await assert.rejects(run({ sound: { ...ON_CALM, music: { kind: 'upbeat' } }, plan: withSay(PLAN, 'close', 'Try it later.'), signal: ctl.signal }), { name: 'AbortError' });
  assert.deepEqual([speak.calls.length, compose.calls.length], [1, 0]);
});
test('the music: kept within its slack and past 300 s, made again for a new description, at least 3 s, played only while its file is there', async () => {
  const first = await run({ sound: ON_CALM });
  reset();
  await run({ sound: ON_CALM, plan: withDuration(first.plan, 'mid', 6.4) });            // 15.1 s against 14.7: within 0.5 s
  assert.equal(compose.calls.length, 0);
  await run({ sound: { ...ON_CALM, music: { kind: 'upbeat' } }, plan: first.plan });
  assert.deepEqual(compose.calls, [{ prompt: musicPrompt({ kind: 'upbeat' }), seconds: 14.7 }]);
  rmSync(join(workDir, 'assets/sound/music.wav'));
  assert.equal(soundTracks(workDir, first.plan).music, null);
  reset();
  await run({ sound: ON_CALM, plan: videoPlan([['a', 200], ['b', 200]]) });
  await run({ sound: ON_CALM, plan: videoPlan([['a', 200], ['b', 200]]) });             // 400 s loops a 300 s track
  await run({ sound: ON_CALM, plan: videoPlan([['a', 1]]) });                           // a 300 s track already covers 1 s
  assert.deepEqual(compose.calls.map((c) => c.seconds), [300]);
  rmSync(join(workDir, 'assets/sound/music.wav')); writeFileSync(join(workDir, 'assets/sound/music.mp3'), 'an old type');
  await run({ sound: ON_CALM, plan: videoPlan([['a', 1]]) });
  assert.deepEqual(compose.calls.map((c) => c.seconds), [300, 3]);
  assert.equal(existsSync(join(workDir, 'assets/sound/music.mp3')), false);
});
test('the manifest is checked field by field; a clip whose words were swapped under its key is made again', async () => {
  await run({ sound: ON_CALM });
  const file = join(workDir, 'assets/sound/sound.json');
  const good = JSON.parse(readFileSync(file, 'utf8'));
  const [c, m] = [good.clips[0], good.music];
  const write = (o) => writeFileSync(file, JSON.stringify({ ...good, ...o }));
  write({ clips: [{ ...c, file: 'voice-close.wav' }, { ...c, at: -1 }, { ...c, key: 'abc' }, { ...c, cues: [{ t: 'x', text: 'a' }] }, { ...c, id: 'tokens', file: 'voice-tokens.wav' }, { ...c, text: 5 }, { ...c, seconds: 0 }] });
  assert.deepEqual(readSoundManifest(workDir).clips, []);
  write({ clips: [c, { ...c, seconds: 9 }] });
  assert.deepEqual(readSoundManifest(workDir).clips, [c]);                              // one clip per scene: the first
  for (const music of [{ ...m, gain: 0 }, { ...m, key: 'x' }, { ...m, seconds: 0 }, 'music.wav']) {
    write({ music });
    assert.equal(readSoundManifest(workDir).music, null, JSON.stringify(music));
  }
  write({ voice: { ...good.voice, model: 2 } });
  assert.equal(readSoundManifest(workDir).voice, null);
  write({ v: 2 });
  assert.equal(readSoundManifest(workDir), null);
  write({ clips: [{ ...c, text: 'Words the plan never held.' }, good.clips[1]] });
  reset();
  await run({ sound: ON_CALM });
  assert.deepEqual(speak.calls.map((x) => x.text), ['Meet worca. It plans.']);
});
test('a clip that would take the manifest past its bound is left out, file and all', async () => {
  const long = 'x'.repeat(SOUND_LIMITS.manifestBytes);                                  // its text and its one cue: twice the bound
  const r = await run({ sound: ON_CALM, plan: withSay(PLAN, 'open', long) });
  assert.deepEqual(r.failed, [{ what: 'voice', id: 'open', reason: 'the sound could not be saved' }]);
  assert.equal(book.calls.length, 3);                                                   // ElevenLabs was paid
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['close']);
  assert.deepEqual(readdirSync(join(workDir, 'assets/sound')).filter((n) => n.startsWith('voice-open')), []);
});
test('old music never outlives a change: set to none or to a new description, it goes before any call', async () => {
  const first = await run({ sound: ON_CALM });
  reset();
  const ctl = new AbortController();
  speak.onCall = () => ctl.abort();
  await assert.rejects(run({ sound: { ...ON_CALM, music: { kind: 'none' } }, plan: withSay(first.plan, 'close', 'Try it now.'), signal: ctl.signal }), { name: 'AbortError' });
  assert.deepEqual([readSoundManifest(workDir).music, existsSync(join(workDir, 'assets/sound/music.wav'))], [null, false]);
  await run({ sound: ON_CALM, plan: first.plan });
  reset();
  const busy = async () => { throw new SoundError('ElevenLabs is busy; try again', 429); };
  const r = await run({ sound: { ...ON_CALM, music: { kind: 'upbeat' } }, plan: first.plan, compose: busy });
  assert.deepEqual([r.music, r.failed, soundTracks(workDir, first.plan).music], [null, [{ what: 'music', reason: 'ElevenLabs is busy; try again' }], null]);
});
test('the list holds only what exists: a gone file leaves it before any call; a dropped clip is not counted as made', async () => {
  await run({ sound: ON_CALM });
  rmSync(join(workDir, 'assets/sound/voice-open.wav'));
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(run({ sound: ON_CALM, signal: ctl.signal }), { name: 'AbortError' });
  assert.deepEqual(readSoundManifest(workDir).clips.map((c) => c.id), ['close']);
  reset();
  speak.seconds = { 'Meet worca. It plans.': 599.5 };
  const r = await run({ sound: ON_CALM });
  assert.deepEqual([r.made, [...r.clips.keys()]], [{ voice: 0, reused: 1, music: false }, ['close']]);
});
test('a stop during the music rejects: nothing booked or listed for it, the clips stay, no music failure is told', async () => {
  const ctl = new AbortController();
  const cut = async (o) => { compose.calls.push(o); ctl.abort(); throw abortError(); };   // the Stop lands while it composes
  const [, lines] = await warned(() => assert.rejects(run({ sound: ON_CALM, signal: ctl.signal, compose: cut }), { name: 'AbortError' }));
  assert.deepEqual(lines, []);                                                          // never reported as "the music was not made"
  assert.deepEqual([compose.calls.length, book.calls.length], [1, 2]);
  const m = readSoundManifest(workDir);
  assert.deepEqual([m.clips.map((c) => c.id), m.music], [['open', 'close'], null]);
  assert.deepEqual(readdirSync(join(workDir, 'assets/sound')).sort(), ['sound.json', 'voice-close.wav', 'voice-open.wav']);
});
test('402 stops the voice calls left, one at a time; the music is still composed', async () => {
  speak.fail = new SoundError('the ElevenLabs account is out of credits', 402);
  const r = await run({ sound: ON_CALM, atOnce: 1 });
  assert.deepEqual([speak.calls.length, compose.calls.length], [1, 1]);
  assert.deepEqual(r.failed, [{ what: 'voice', id: 'open', reason: 'the ElevenLabs account is out of credits' }]);
  assert.deepEqual(r.made, { voice: 0, reused: 0, music: true });
});
test('a pause raised by the music\'s booking rejects, as the voice\'s does; the track paid for stays listed', async () => {
  const ctl = new AbortController();
  book.onCall = () => { if (book.calls.length === 3) ctl.abort(); };                    // the music's booking closes the cap
  await assert.rejects(run({ sound: ON_CALM, signal: ctl.signal }), { name: 'AbortError' });
  assert.deepEqual([speak.calls.length, compose.calls.length, book.calls.length], [2, 1, 3]);
  assert.equal(readSoundManifest(workDir).music.file, 'music.wav');
});
/** Every folder below `dir` made writable and readable again, so the design's temp home can be removed. */
function unlockAll(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    chmodSync(join(dir, e.name), 0o755);
    unlockAll(join(dir, e.name));
  }
}
/** `fn()` with console.warn captured: `[what it returned, the lines]`. */
async function warned(fn) {
  const lines = [];
  const warn = console.warn;
  console.warn = (...a) => { lines.push(a.join(' ')); };
  try {
    return [await fn(), lines];
  } finally {
    console.warn = warn;
  }
}
test('removeSound sets aside a folder it cannot empty, never throws', { skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root: a locked folder' : false }, async () => {
  await run({ sound: ON_CALM });
  const locked = join(workDir, 'assets/sound/locked');
  mkdirSync(locked); writeFileSync(join(locked, 'f'), 'x'); chmodSync(locked, 0o555);   // an agent's folder worca cannot empty
  try {
    const [, lines] = await warned(() => removeSound(designId));
    assert.equal(existsSync(join(workDir, 'assets/sound')), false);
    assert.ok(lines.some((l) => l.includes('sound could not be removed')), lines.join('\n'));
  } finally {
    unlockAll(designDir(designId));
  }
});

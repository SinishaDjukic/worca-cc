// test/ask-voice.test.mjs
// The voice controller (docs/speech.md) with a fake VAD, fake fetch and fake
// audio: support gating, dictation, the hands-free loop, sentence-level TTS as
// frames stream, gating while thinking, barge-in, text-only fallback, stop,
// the hands-free acknowledgement, the Web Audio player that Safari needs for
// replies spoken after the click, and turn-taking: the adaptive pause, early
// transcription, and merging a continuation into the message just sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { readFileSync } from 'node:fs';
import { createVoiceController, webAudioPlayer, MERGE_GRACE_MS, READ_ONLY_ASK_TOOLS, mergeSafeBlock } from '../ui/public/ask-voice.mjs';
import { SPOKEN_FALLBACK_LINE } from '../src/shared/speech.mjs';

function fakeVad() {
  const v = { opts: null, created: 0, started: 0, paused: 0, destroyed: 0, setOptionsCalls: [] };
  v.lib = { MicVAD: { new: async (o) => { v.opts = o; v.created += 1; return {
    start: async () => { v.started += 1; }, pause: async () => { v.paused += 1; }, destroy: async () => { v.destroyed += 1; },
    setOptions: (u) => v.setOptionsCalls.push(u),
  }; } } };
  return v;
}
function fakeAudio() {
  const a = { played: [], current: null, unlocks: 0, closes: 0 };
  a.play = (blob) => { let done; const p = new Promise((r) => { done = r; }); a.current = { blob, end: () => done('ended'), stop: () => done('stopped') }; a.played.push(blob.text); return { ended: p, stop: () => a.current.stop() }; };
  a.play.unlock = () => { a.unlocks += 1; };
  a.play.close = () => { a.closes += 1; };
  return a;
}
function fakeAudioContext({ allowed = true } = {}) {
  const log = { made: 0, resumes: 0, closed: 0, started: [], stopped: 0, current: null };
  function Ctx() {
    log.made += 1;
    this.state = 'suspended';                          // what a context made outside a gesture starts as
    this.destination = {};
    this.resume = () => { log.resumes += 1; if (!allowed) return new Promise(() => {}); this.state = 'running'; return Promise.resolve(); };
    this.close = () => { log.closed += 1; this.state = 'closed'; return Promise.resolve(); };
    this.decodeAudioData = async (ab) => ({ bytes: ab.byteLength });
    this.createBufferSource = () => {
      const src = { buffer: null, onended: null, connect() {}, disconnect() {}, start() { log.started.push(src.buffer); log.current = src; }, stop() { log.stopped += 1; } };
      return src;
    };
  }
  return { Ctx, log };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const win = {
  isSecureContext: true, navigator: { mediaDevices: { getUserMedia() {} } }, AudioContext: function () {},
  setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
};

function setup({ tts = true, fetchOverride, ackPhrases = [], ackAfterMs = 60_000, random, unfinishedHoldMs = 0 } = {}) {
  const vad = fakeVad();
  const audio = fakeAudio();
  const states = [];
  const transcripts = [];
  const notices = [];
  let bargeIns = 0;
  const calls = [];
  const synthesized = [];
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === '/api/speech/synthesize') synthesized.push(JSON.parse(init.body).text);
    if (fetchOverride) { const r = await fetchOverride(url, init); if (r) return r; }
    if (url === '/api/speech') return { ok: true, json: async () => ({ stt: { configured: true }, tts: { configured: tts } }) };
    if (url === '/api/speech/transcribe') return { ok: true, json: async () => ({ text: ' hello worca ' }) };
    if (url === '/api/speech/synthesize') { const text = JSON.parse(init.body).text; return { ok: true, blob: async () => ({ text }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const sends = [];
  const v = createVoiceController({
    win, fetch, loadVad: async () => vad.lib, playAudio: audio.play, ackPhrases, ackAfterMs, random, unfinishedHoldMs,
    onState: (s, info) => states.push([s, info.mode]),
    onTranscript: (t, o) => { transcripts.push([t, o.autoSend]); sends.push([t, o]); },
    onBargeIn: () => { bargeIns += 1; },
    onNotice: (m) => notices.push(m),
  });
  return { v, vad, audio, states, transcripts, sends, notices, calls, synthesized, bargeIns: () => bargeIns };
}
const frame = (type, extra = {}) => ({ type, threadId: 't', messageId: 'm1', ...extra });
const toolFrame = (id = 'tu1', extra = {}) => frame('ask-block', { block: { kind: 'tool', id, name: 'mcp__worca__list_runs', status: 'running' }, ...extra });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('modes: dictation lands one utterance without sending then turns off; talk auto-sends and never speaks', async () => {
  await checkRows([
    { name: 'dictation: one utterance lands in the composer without auto-send, then voice is off', run: async () => {
      const t = setup();
      await t.v.start('dictate');
      assert.equal(t.v.state(), 'listening');
      assert.equal(t.vad.opts.startOnLoad, false);
      assert.equal(t.vad.opts.model, 'v5');
      t.vad.opts.onSpeechEnd(new Float32Array(1600));
      await tick(); await tick();
      assert.deepEqual(t.transcripts, [['hello worca', false]]);
      assert.equal(t.v.state(), 'off');
      assert.equal(t.vad.destroyed, 1);                    // the mic is released; the next start opens a fresh VAD
      await t.v.start('dictate');
      assert.equal(t.vad.created, 2);
    } },
    { name: 'talk (voice in, text out): auto-sends, never speaks even with a voice configured, listens again when the reply ends', run: async () => {
      const t = setup({ fetchOverride: async (url) => (url === '/api/speech'
        ? { ok: true, json: async () => ({ stt: { configured: true }, tts: { engine: 'server', configured: true } }) } : null) });
      await t.v.start('talk');
      assert.equal(t.v.mode(), 'talk');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await tick(); await tick();
      assert.deepEqual(t.transcripts, [['hello worca', true]]);
      assert.equal(t.v.state(), 'thinking');
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'First sentence. Second');
      t.v.onFrame(frame('ask-done', { text: 'First sentence. Second one.', status: 'done' }), null);
      await tick(); await tick();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.calls.includes('/api/speech/synthesize'), false);
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await tick(); await tick();
      assert.equal(t.transcripts.length, 2);             // the next question, straight away
    } },
  ]);
});

test('hands-free: transcript auto-sends, thinking ignores speech, reply spoken per sentence, then listens again', async () => {
  const t = setup();
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(1600));
  await tick(); await tick();
  assert.deepEqual(t.transcripts, [['hello worca', true]]);
  assert.equal(t.v.state(), 'thinking');
  t.vad.opts.onSpeechEnd(new Float32Array(1600));           // noise while thinking: ignored
  await tick();
  assert.equal(t.transcripts.length, 1);
  t.v.onFrame(frame('ask-start'), '');
  t.v.onFrame(frame('ask-delta'), 'First sentence. Second');
  await tick(); await tick();
  assert.equal(t.v.state(), 'speaking');
  assert.deepEqual(t.audio.played, ['First sentence.']);
  assert.deepEqual(t.vad.setOptionsCalls[0], { positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.6 });
  t.v.onFrame(frame('ask-done', { text: 'First sentence. Second one.', status: 'done' }), null);
  t.audio.current.end(); await tick(); await tick();
  assert.deepEqual(t.audio.played, ['First sentence.', 'Second one.']);
  t.audio.current.end(); await tick(); await tick();
  assert.equal(t.v.state(), 'listening');
  assert.deepEqual(t.vad.setOptionsCalls.at(-1), { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 });
});

test('barge-in while speaking stops playback, asks the panel to stop the turn, and listens', async () => {
  const t = setup();
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  t.v.onFrame(frame('ask-start'), '');
  t.v.onFrame(frame('ask-delta'), 'One. Two. Three. ');
  await tick(); await tick();
  assert.equal(t.v.state(), 'speaking');
  t.vad.opts.onSpeechRealStart();
  await tick();
  assert.equal(t.bargeIns(), 1);
  assert.equal(t.v.state(), 'listening');
  t.v.onFrame(frame('ask-delta'), 'One. Two. Three. Four. ');   // the stopped turn's tail is not spoken
  await tick();
  assert.deepEqual(t.audio.played, ['One.']);
});

test('text-only mode: TTS unconfigured/off, and a TTS, playback or acknowledgement failure (one notice naming the reason)', async () => {
  await checkRows([
    { name: 'TTS not configured: hands-free runs text only', run: async () => {
      const t = setup({ tts: false });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'Hello there. ');
      t.v.onFrame(frame('ask-done', { text: 'Hello there.', status: 'done' }), null);
      await tick();
      assert.equal(t.calls.includes('/api/speech/synthesize'), false);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'tts engine "off": hands-free stays text only', run: async () => {
      const t = setup({ fetchOverride: async (url) => (url === '/api/speech' ? { ok: true, json: async () => ({ stt: { configured: true }, tts: { engine: 'off', configured: false } }) } : null) });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-done', { text: 'Not spoken.', status: 'done' }), null);
      await tick(); await tick();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'a TTS failure drops to text-only once, with a notice; voice stays on', run: async () => {
      const t = setup({ fetchOverride: async (url) => (url === '/api/speech/synthesize' ? { ok: false, status: 502, json: async () => ({ error: 'speech server unreachable' }) } : null) });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'Hello there. ');
      await tick(); await tick();
      t.v.onFrame(frame('ask-done', { text: 'Hello there.', status: 'done' }), null);
      await tick(); await tick();
      assert.equal(t.notices.length, 1);
      assert.match(t.notices[0], /text only.*unreachable/);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'a playback failure names the browser\'s reason in the text-only notice', run: async () => {
      const t = setup();
      const blocked = new Error('the browser blocked audio playback');
      const v = createVoiceController({
        win, fetch: async (url) => (url === '/api/speech' ? { ok: true, json: async () => ({ stt: { configured: true }, tts: { configured: true } }) }
          : url === '/api/speech/transcribe' ? { ok: true, json: async () => ({ text: 'hi' }) }
            : { ok: true, blob: async () => ({}) }),
        loadVad: async () => t.vad.lib,
        playAudio: () => ({ ended: Promise.resolve('error'), error: blocked, stop() {} }),
        onState() {}, onTranscript() {}, onBargeIn() {}, onNotice: (m) => t.notices.push(m),
      });
      await v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      v.onFrame(frame('ask-start'), '');
      v.onFrame(frame('ask-done', { text: 'Hello there.', status: 'done' }), null);
      for (let i = 0; i < 6; i++) await tick();
      assert.deepEqual(t.notices, ['Voice replies are text only for now: the browser blocked audio playback']);
      assert.equal(v.state(), 'listening');
    } },
    { name: 'an acknowledgement that cannot be rendered drops replies to text only, with the reason', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], fetchOverride: async (url) => (url === '/api/speech/synthesize' ? { ok: false, status: 502, json: async () => ({ error: 'speech server unreachable' }) } : null) });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(toolFrame(), '');
      await tick(); await tick(); await tick();
      assert.equal(t.notices.length, 1);
      assert.match(t.notices[0], /text only.*unreachable/);
      assert.equal(t.v.state(), 'thinking');                // still waiting for the sent turn
      t.v.onFrame(frame('ask-done', { text: 'Not spoken.', status: 'done' }), null);
      await tick();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
    } },
  ]);
});

test('an STT failure is an error state that turns voice off', async () => {
  const t = setup({ fetchOverride: async (url) => (url === '/api/speech/transcribe' ? { ok: false, status: 502, json: async () => ({ error: 'speech server unreachable at http://127.0.0.1:8080/v1' }) } : null) });
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  assert.deepEqual(t.states.at(-1), ['error', null]);
  assert.equal(t.v.active(), false);
  assert.equal(t.vad.destroyed, 1);
});

test('stop() mid-transcription discards the late result', async () => {
  let release;
  const t = setup({ fetchOverride: (url) => (url === '/api/speech/transcribe' ? new Promise((r) => { release = () => r({ ok: true, json: async () => ({ text: 'late' }) }); }) : null) });
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick();
  assert.equal(t.v.state(), 'transcribing');
  await t.v.stop();
  release(); await tick(); await tick();
  assert.deepEqual(t.transcripts, []);
  assert.equal(t.v.state(), 'off');
});

test('after a barge-in, the stopped turn ending does not reopen listening before the new turn starts', async () => {
  const t = setup();
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  t.v.onFrame(frame('ask-start'), '');
  t.v.onFrame(frame('ask-delta'), 'One. Two. ');
  await tick(); await tick();
  t.vad.opts.onSpeechRealStart();                      // barge-in
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  assert.equal(t.v.state(), 'thinking');               // transcript handed to the panel (deferred send)
  t.v.onFrame(frame('ask-done', { text: 'One. Two.', status: 'stopped' }), null);
  assert.equal(t.v.state(), 'thinking');               // NOT listening: the new turn has not started
  t.v.onFrame(frame('ask-start', { messageId: 'm2' }), '');
  t.v.onFrame(frame('ask-delta', { messageId: 'm2' }), 'Fresh answer. ');
  await tick(); await tick();
  assert.deepEqual(t.audio.played, ['One.', 'Fresh answer.']);
});

test('a resync replay of the same turn (ask-start again, text rewound) never re-speaks', async () => {
  const t = setup();
  await t.v.start('handsfree');
  t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  t.v.onFrame(frame('ask-start'), '');
  t.v.onFrame(frame('ask-delta'), 'One. ');
  await tick(); await tick();
  t.v.onFrame(frame('ask-start'), '');                 // replay after reconnect
  t.v.onFrame(frame('ask-delta'), 'One. ');
  t.v.onFrame(frame('ask-delta'), 'One. Two. ');
  t.audio.current.end(); await tick(); await tick();
  assert.deepEqual(t.audio.played, ['One.', 'Two.']);
  t.v.onFrame(frame('ask-done', { text: 'One. Two.', status: 'done' }), null);
  t.audio.current.end(); await tick(); await tick();
  t.v.onFrame(frame('ask-start'), '');                 // a late replay of the finished turn
  t.v.onFrame(frame('ask-delta'), 'One. Two. ');
  await tick();
  assert.deepEqual(t.audio.played, ['One.', 'Two.']);
  assert.equal(t.v.state(), 'listening');
});

test('browser engines (the default): Whisper transcribes and Kokoro speaks in the page, no /api/speech/* calls', async () => {
  const vad = fakeVad();
  const played = [];
  const states = [];
  const transcripts = [];
  const engine = { loads: [], transcribed: [], spoken: [] };
  const calls = [];
  const fetch = async (url) => {
    calls.push(url);
    if (url === '/api/speech') return { ok: true, json: async () => ({ stt: { engine: 'browser', language: 'bg', configured: true }, tts: { engine: 'browser', voice: 'bf_emma', speed: 1.2, configured: true }, downloaded: { stt: false, tts: false } }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const browserSpeech = (kind) => ({
    load: async (onProgress) => { engine.loads.push(kind); if (onProgress) onProgress(42_400_000, 150_000_000); },
    transcribe: async (audio, language) => { engine.transcribed.push([audio.length, language]); return ' здравей '; },
    speak: async (text, opts) => { engine.spoken.push([text, opts]); return { audio: new Float32Array(240), rate: 24000 }; },
  });
  const v = createVoiceController({
    win: { ...win, Blob }, fetch, loadVad: async () => vad.lib, browserSpeech, ackPhrases: [], unfinishedHoldMs: 0,   // no end punctuation: not held here
    playAudio: (blob) => { played.push(blob); return { ended: Promise.resolve('ended'), stop() {} }; },
    onState: (s, info) => states.push([s, info.detail]),
    onTranscript: (t, o) => transcripts.push([t, o.autoSend]),
    onBargeIn: () => {}, onNotice: () => {},
  });
  await v.start('handsfree');
  assert.equal(v.state(), 'listening');
  assert.deepEqual(engine.loads.sort(), ['stt', 'tts']);        // the voice warms up while the mic starts
  assert.ok(states.some(([s, d]) => s === 'loading' && d === 'Downloading speech model… 42 MB'));
  vad.opts.onSpeechEnd(new Float32Array(1600));
  await tick(); await tick();
  assert.deepEqual(engine.transcribed, [[1600, 'bg']]);
  assert.deepEqual(transcripts, [['здравей', true]]);
  v.onFrame(frame('ask-start'), '');
  v.onFrame(frame('ask-done', { text: 'All done.', status: 'done' }), null);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(engine.spoken, [['All done.', { voice: 'bf_emma', speed: 1.2 }]]);
  assert.equal(played.length, 1);
  assert.equal(played[0].type, 'audio/wav');
  assert.equal(played[0].size, 44 + 240 * 2);
  assert.equal(v.state(), 'listening');
  assert.deepEqual(calls, ['/api/speech']);
});

test('browser models: preload warms only downloaded engines; kept warm between sessions, released after the idle delay and on destroy', async () => {
  await checkRows([
    { name: 'browser models are kept warm between sessions and released after the idle delay (and on destroy)', run: async () => {
      const vad = fakeVad();
      const made = [];
      const browserSpeech = (kind) => { const e = { kind, released: 0, load: async () => {}, release() { e.released += 1; } }; made.push(e); return e; };
      const fetch = async () => ({ ok: true, json: async () => ({ stt: { engine: 'browser' }, tts: { engine: 'browser' } }) });
      const v = createVoiceController({
        win, fetch, loadVad: async () => vad.lib, browserSpeech, idleReleaseMs: 20,
        onState: () => {}, onTranscript: () => {}, onBargeIn: () => {}, onNotice: () => {},
      });
      await v.start('handsfree');
      await v.stop();
      await v.start('dictate');                          // restarted within the delay: same engines, nothing released
      assert.equal(made.length, 2);
      await new Promise((r) => setTimeout(r, 40));
      assert.deepEqual(made.map((e) => e.released), [0, 0]);
      await v.stop();
      await new Promise((r) => setTimeout(r, 40));
      assert.deepEqual(made.map((e) => e.released), [1, 1]);
      await v.start('dictate');
      await v.destroy();
      assert.deepEqual(made.map((e) => e.released), [2, 2]);
    } },
    { name: 'preload warms only engines whose models are on disk, never while voice is on', run: async () => {
      const loads = [];
      let downloaded = { stt: true, tts: false };
      const fetch = async () => ({ ok: true, json: async () => ({ stt: { engine: 'browser' }, tts: { engine: 'browser' }, downloaded }) });
      const browserSpeech = (kind) => ({ load: async () => { loads.push(kind); }, release() {} });
      const v = createVoiceController({ win, fetch, loadVad: async () => fakeVad().lib, browserSpeech, onState() {}, onTranscript() {}, onBargeIn() {}, onNotice() {} });
      await v.preload();
      assert.deepEqual(loads, ['stt']);                  // Kokoro not downloaded yet: no silent 325 MB fetch
      downloaded = { stt: false, tts: false };
      await v.preload();
      assert.deepEqual(loads, ['stt']);
      await v.destroy();
    } },
  ]);
});

test('hands-free unlocks audio output synchronously, inside the click that started it (Safari plays nothing later otherwise)', async () => {
  const t = setup();
  const starting = t.v.start('handsfree');
  assert.equal(t.audio.unlocks, 1);                  // before the first await: the gesture is still live
  await starting;
  await t.v.start('talk');                           // text replies: nothing to unlock
  await t.v.start('dictate');
  assert.equal(t.audio.unlocks, 1);
  await t.v.destroy();
  assert.equal(t.audio.closes, 1);
});

test('webAudioPlayer: unlock() makes and resumes one context; replies play from it; a suspended context fails with a reason', async () => {
  await checkRows([
    { name: 'webAudioPlayer: unlock() makes and resumes one context synchronously; every reply plays from it', run: async () => {
      const { Ctx, log } = fakeAudioContext();
      const play = webAudioPlayer({ ...win, AudioContext: Ctx });
      play.unlock();
      assert.equal(log.made, 1);
      assert.equal(log.resumes, 1);
      const h = play(new Blob([new Uint8Array(8)]));
      for (let i = 0; i < 4; i++) await tick();
      assert.deepEqual(log.started, [{ bytes: 8 }]);
      log.current.onended();
      assert.equal(await h.ended, 'ended');
      const h2 = play(new Blob([new Uint8Array(4)]));
      for (let i = 0; i < 4; i++) await tick();
      h2.stop();
      assert.equal(await h2.ended, 'stopped');
      assert.equal(log.stopped, 1);
      assert.equal(log.made, 1);
      play.close();
      assert.equal(log.closed, 1);
    } },
    { name: 'webAudioPlayer: a context the browser keeps suspended fails with a reason instead of hanging in "speaking"', run: async () => {
      const { Ctx, log } = fakeAudioContext({ allowed: false });
      const play = webAudioPlayer({ ...win, setTimeout, AudioContext: Ctx }, { resumeTimeoutMs: 10 });
      const h = play(new Blob([new Uint8Array(8)]));
      assert.equal(await h.ended, 'error');
      assert.match(h.error.message, /blocked audio playback/);
      assert.deepEqual(log.started, []);
    } },
  ]);
});

test('hands-free acknowledgement: when it is (and is not) said, once per turn and rotated, stood in for by pre-tool text, never barge-in-able', async () => {
  await checkRows([
    { name: 'a quick reply is not acknowledged: its first sentence comes before the slow-answer delay', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], ackAfterMs: 30 });
      await t.v.start('handsfree');
      await tick();
      assert.deepEqual(t.synthesized, ['On it.']);          // rendered ahead while the user talks, in case it is needed
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      assert.deepEqual(t.transcripts, [['hello worca', true]]);
      assert.deepEqual(t.audio.played, []);                  // nothing said yet: it may be quick
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'I can look up runs. ');
      await tick(); await tick();
      await wait(50);
      assert.deepEqual(t.audio.played, ['I can look up runs.']);
    } },
    { name: 'a turn that ends before the delay is never acknowledged; one that ends during it listens once it is said', run: async () => {
      const quick = setup({ ackPhrases: ['On it.'], ackAfterMs: 20 });
      await quick.v.start('handsfree');
      quick.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      quick.v.onFrame(frame('ask-start'), '');
      quick.v.onFrame(frame('ask-error'), null);
      await wait(40);
      assert.deepEqual(quick.audio.played, []);
      assert.equal(quick.v.state(), 'listening');

      const t = setup({ ackPhrases: ['On it.'] });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(toolFrame(), '');
      await tick(); await tick();
      t.v.onFrame(frame('ask-error'), null);
      await tick();
      assert.equal(t.v.state(), 'thinking');
      t.audio.current.end(); await tick(); await tick();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'a long think is acknowledged once the delay passes with nothing to say, then the reply follows it', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], ackAfterMs: 20 });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      await wait(40); await tick();
      assert.deepEqual(t.audio.played, ['On it.']);
      assert.equal(t.v.state(), 'thinking');                // the chip does not claim the reply is playing
      t.v.onFrame(frame('ask-delta'), 'First sentence. ');
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ['On it.']);          // the reply waits for the acknowledgement
      t.audio.current.end(); await tick(); await tick();
      assert.deepEqual(t.audio.played, ['On it.', 'First sentence.']);
      assert.equal(t.v.state(), 'speaking');
      t.v.onFrame(frame('ask-done', { text: 'First sentence.', status: 'done' }), null);
      t.audio.current.end(); await tick(); await tick();
      assert.equal(t.v.state(), 'listening');
      assert.deepEqual(t.synthesized, ['On it.', 'First sentence.']);   // rendered once, then reused
    } },
    { name: 'research: a tool starting before anything was said is acknowledged at once', run: async () => {
      const t = setup({ ackPhrases: ['On it.'] });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(toolFrame(), '');
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ['On it.']);
      t.v.onFrame(toolFrame('tu1', { block: { kind: 'tool', id: 'tu1', status: 'done' } }), '');   // the same tool finishing
      t.v.onFrame(toolFrame('tu2'), '');                                                           // a second tool
      t.audio.current.end(); await tick(); await tick();
      assert.deepEqual(t.audio.played, ['On it.']);          // said once per turn
    } },
    { name: 'the acknowledgement rotates: never the same phrase twice running', run: async () => {
      const t = setup({ ackPhrases: ['Okay.', 'On it.'], random: () => 0 });
      await t.v.start('handsfree');
      for (const id of ['m1', 'm2', 'm3']) {
        t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
        t.v.onFrame(frame('ask-start', { messageId: id }), '');
        t.v.onFrame(toolFrame(`tu-${id}`, { messageId: id }), '');
        await tick(); await tick();
        t.audio.current.end(); await tick();
        t.v.onFrame(frame('ask-error', { messageId: id }), null);
        await tick();
        assert.equal(t.v.state(), 'listening');
      }
      assert.deepEqual(t.audio.played, ['Okay.', 'On it.', 'Okay.']);
    } },
    { name: 'the text before a tool call is spoken when the tool starts, and stands in for the acknowledgement', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], ackAfterMs: 30 });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), "I'll check the runs.");
      await tick(); await tick();
      assert.deepEqual(t.audio.played, []);                  // no space after the period yet: could still be mid-sentence
      t.v.onFrame(toolFrame(), "I'll check the runs.");
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ["I'll check the runs."]);
      t.audio.current.end(); await tick();
      await wait(50);
      t.v.onFrame(frame('ask-delta'), "I'll check the runs.\n\nThree runs failed today. ");
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ["I'll check the runs.", 'Three runs failed today.']);
    } },
    { name: 'the acknowledgement cannot be barged in on: speech over it neither stops the turn nor is sent', run: async () => {
      const t = setup({ ackPhrases: ['On it.'] });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(toolFrame(), '');
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ['On it.']);
      t.vad.opts.onSpeechRealStart();
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.vad.setOptionsCalls.length, 0);        // listen thresholds throughout: it is not 'speaking'
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'stopping voice while an acknowledgement is pending: it is never said', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], ackAfterMs: 20 });
      await t.v.start('handsfree');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      await t.v.stop();
      await wait(40);
      assert.deepEqual(t.audio.played, []);
    } },
    { name: 'no acknowledgement without a spoken voice: talk mode, and hands-free with text-to-speech off', run: async () => {
      const talk = setup({ ackPhrases: ['On it.'], ackAfterMs: 10 });
      await talk.v.start('talk');
      talk.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      talk.v.onFrame(frame('ask-start'), '');
      talk.v.onFrame(toolFrame(), '');
      const off = setup({ ackPhrases: ['On it.'], ackAfterMs: 10, tts: false });
      await off.v.start('handsfree');
      off.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      off.v.onFrame(frame('ask-start'), '');
      off.v.onFrame(toolFrame(), '');
      await wait(30);
      for (const t of [talk, off]) {
        assert.deepEqual(t.transcripts, [['hello worca', true]]);
        assert.deepEqual(t.audio.played, []);
        assert.deepEqual(t.synthesized, []);
      }
    } },
  ]);
});

// ---- adaptive pause, early transcription and merge (docs/speech.md "Using it") ----
// Frames are what vad-web's onFrameProcessed hands over: 512 samples (32 ms) each.
function feed(t, pattern) {
  for (const ch of pattern) t.vad.opts.onFrameProcessed({ isSpeech: ch === 'S' ? 0.9 : 0.1 }, new Float32Array(512));
}
const SPEECH = 'S'.repeat(10);
const SHORT_PAUSE = '.'.repeat(22);          // 704 ms: past the 0.7 s finished-sentence pause
function deferred() {
  let resolve, reject;
  const p = new Promise((a, b) => { resolve = a; reject = b; });
  p.catch(() => {});
  return { p, resolve, reject };
}
const ticks = async (n = 6) => { for (let i = 0; i < n; i++) await tick(); };

/**
 * A controller over the in-browser Whisper (or "Your server" with sttEngine 'server'). transcribe(i, audioLength) answers
 * the i-th transcription (a string or a promise); every call's audio length is logged in t.stt.
 * tts: on/off; ttsEngine picks 'server' or 'browser' (Kokoro: speak() renders sentence i as i+1 samples, read back by
 * FakeBlob); ttsConfigured false drops `configured` like the default /api/speech. speakGate(i) → a promise holding
 * render i, or null; an abort rejects it with an AbortError like speech-browser.mjs. bind: when t.frame binds the
 * oldest unbound send (noteSent, the panel's 202) to a new messageId — 'before' or 'after' its first frame, 'none' never.
 */
function setupBrowser({ pause = 0.7, transcribe = () => 'hello worca', sttEngine = 'browser', tts = false, ttsEngine = 'server', ttsConfigured = true, speakGate = null, ackPhrases = [], ackAfterMs = 60_000, synthGate = null, unfinishedHoldMs = 0, holdBackstopMs, bind = 'none' } = {}) {
  const vad = fakeVad();
  const audio = fakeAudio();
  const states = [];
  const transcripts = [];
  const calls = [];
  const stt = [];
  const spoken = [];
  const notices = [];
  const sendIds = [];
  const speaksAtSend = [];
  const clock = { t: 0 };
  let bargeIns = 0;
  const run = (len) => { const i = stt.length; stt.push(len); return transcribe(i, len); };
  const ttsBlock = tts ? { engine: ttsEngine, ...(ttsConfigured ? { configured: true } : {}) } : { engine: 'off' };
  const fetch = async (url, init = {}) => {
    calls.push(url);
    if (url === '/api/speech') return { ok: true, json: async () => ({ stt: { engine: sttEngine, language: 'en', pause, configured: true }, tts: ttsBlock }) };
    if (url === '/api/speech/transcribe') { const text = await run((init.body.length - 44) / 2); return { ok: true, json: async () => ({ text }) }; }
    if (url === '/api/speech/synthesize') { const text = JSON.parse(init.body).text; if (synthGate) await synthGate.p; return { ok: true, blob: async () => ({ text }) }; }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const aborted = () => new DOMException('aborted', 'AbortError');
  const speak = async (text, opts, signal) => {
    const i = spoken.length;
    spoken.push(text);
    if (signal && signal.aborted) throw aborted();
    const gate = speakGate ? speakGate(i) : null;
    if (gate) {
      await new Promise((resolve, reject) => {
        const onAbort = () => reject(aborted());
        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve(gate).then(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, reject);
      });
    }
    if (signal && signal.aborted) throw aborted();
    return { audio: new Float32Array(i + 1), rate: 16000 };
  };
  const browserSpeech = () => ({ load: async () => {}, release() {}, transcribe: async (a) => run(a.length), speak });
  // encodeWav: 2 bytes per sample, the data size at byte 40; sentence i was rendered as i+1 samples.
  class FakeBlob {
    constructor(parts) {
      const p = parts[0];
      const view = ArrayBuffer.isView(p) ? new DataView(p.buffer, p.byteOffset, p.byteLength) : new DataView(p);
      this.text = spoken[view.getUint32(40, true) / 2 - 1];
    }
  }
  const sends = [];
  const v = createVoiceController({
    win: { ...win, Blob: FakeBlob }, fetch, loadVad: async () => vad.lib, playAudio: audio.play, browserSpeech, ackPhrases, ackAfterMs, now: () => clock.t, unfinishedHoldMs,
    ...(holdBackstopMs !== undefined ? { holdBackstopMs } : {}),
    onState: (s) => states.push(s),
    onTranscript: (text, o, meta) => { transcripts.push([text, o.autoSend]); sends.push([text, o]); sendIds.push(meta && meta.sendId); speaksAtSend.push(v.speaks()); },
    onBargeIn: () => { bargeIns += 1; },
    onNotice: (m) => notices.push(m),
  });
  const seen = new Set();
  let nextBind = 0;
  const bindNew = (fr, fresh) => {
    if (!fresh || nextBind >= sendIds.length) return;
    const sendId = sendIds[nextBind++];
    v.noteSent?.({ sendId, userMessageId: `u-${fr.messageId}`, assistantMessageId: fr.messageId });
  };
  /** A job frame as the panel passes it, binding a new messageId to the oldest unbound send per `bind`. */
  const frameFn = (fr, live, sp) => {
    const fresh = !!fr.messageId && !seen.has(fr.messageId);
    if (fresh) seen.add(fr.messageId);
    if (bind === 'before') bindNew(fr, fresh);
    v.onFrame(fr, live, sp);
    if (bind === 'after') bindNew(fr, fresh);
  };
  return { v, vad, audio, states, transcripts, sends, calls, stt, clock, spoken, notices, sendIds, speaksAtSend, frame: frameFn, bargeIns: () => bargeIns };
}
const redemptions = (t) => t.vad.setOptionsCalls.filter((o) => 'redemptionMs' in o).map((o) => o.redemptionMs);
/** One utterance with no frames (no draft): the VAD's real start (when asked) and its end. */
async function say(t, { realStart = true } = {}) {
  if (realStart) t.vad.opts.onSpeechRealStart();
  t.vad.opts.onSpeechEnd(new Float32Array(1600));
  await ticks();
}
const texts = (...list) => (i) => list[i];

test('adaptive pause: the VAD waits per path, a finished draft ends the utterance early, an unfinished one waits (T1–T9)', async () => {
  await checkRows([
    { name: 'T1: the VAD gets the pause for its path: browser conversation 1750, server conversation 1200, dictate max(setting,1.2); the setting 2 gives 5000/2000/2000', run: async () => {
      const got = [];
      for (const pause of [0.7, 2]) {
        for (const [engine, mode] of [['browser', 'handsfree'], ['browser', 'talk'], ['server', 'handsfree'], ['browser', 'dictate']]) {
          const t = setupBrowser({ pause, sttEngine: engine });
          await t.v.start(mode);
          got.push(t.vad.opts.redemptionMs);
        }
      }
      assert.deepEqual(got, [1750, 1750, 1200, 1200, 5000, 5000, 2000, 2000]);
    } },
    { name: 'T2: early transcription: a finished draft ends the utterance at the short pause and is sent without a second transcription', run: async () => {
      const t = setupBrowser({ transcribe: () => 'Show me the runs.' });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      await ticks();
      assert.deepEqual(t.stt, [32 * 512]);
      assert.deepEqual(redemptions(t), [700]);
      t.vad.opts.onSpeechEnd(new Float32Array(32 * 512));
      await ticks();
      assert.equal(t.stt.length, 1);
      assert.deepEqual(redemptions(t), [700, 1750]);       // I11: the long pause is back before the next segment
      assert.deepEqual(t.transcripts, [['Show me the runs.', true]]);
    } },
    { name: 'T3: an unfinished draft waits for the long pause and is reused', run: async () => {
      const t = setupBrowser({ transcribe: () => 'Show me the runs and' });
      await t.v.start('talk');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE + '.'.repeat(30));
      await ticks();
      assert.deepEqual(redemptions(t), []);
      t.vad.opts.onSpeechEnd(new Float32Array(100));
      await ticks();
      assert.equal(t.stt.length, 1);
      assert.deepEqual(t.transcripts, [['Show me the runs and', true]]);
    } },
    { name: 'T4: speech after the draft snapshot discards it; the whole utterance is transcribed once at the end', run: async () => {
      const d = deferred();
      const t = setupBrowser({ transcribe: (i) => (i === 0 ? d.p : 'Show me the runs and the failed ones.') });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      feed(t, 'SSSS');
      d.resolve('Show me the runs.');
      await ticks();
      assert.deepEqual(redemptions(t), []);                 // a stale draft never ends the segment
      t.vad.opts.onSpeechEnd(new Float32Array(9999));
      await ticks();
      assert.deepEqual(t.stt, [32 * 512, 9999]);
      assert.deepEqual(t.transcripts, [['Show me the runs and the failed ones.', true]]);
    } },
    { name: 'T5: a draft still running at the VAD\'s end is awaited, not doubled', run: async () => {
      const d = deferred();
      const t = setupBrowser({ transcribe: () => d.p });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      t.vad.opts.onSpeechEnd(new Float32Array(9999));
      await ticks();
      assert.equal(t.v.state(), 'transcribing');
      d.resolve('Hello there.');
      await ticks();
      assert.equal(t.stt.length, 1);
      assert.deepEqual(t.transcripts, [['Hello there.', true]]);
    } },
    { name: 'T6: two slow drafts give up early transcription: setOptions({redemptionMs:1200}) and later utterances are single-shot', run: async () => {
      const ds = [deferred(), deferred()];
      const t = setupBrowser({ transcribe: (i) => (ds[i] ? ds[i].p : 'Third.') });
      await t.v.start('talk');
      for (const [i, id] of [[0, 'm1'], [1, 'm2']]) {
        feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
        await ticks();
        t.clock.t += 2000;                                 // slower than 1750 − 700 ms
        ds[i].resolve(`Draft ${i}.`);
        await ticks();
        t.vad.opts.onSpeechEnd(new Float32Array(100));
        await ticks();
        t.v.onFrame(frame('ask-start', { messageId: id }), '');
        t.v.onFrame(frame('ask-done', { messageId: id, text: 'ok', status: 'done' }), null);
        t.clock.t += 60_000;
      }
      assert.deepEqual(redemptions(t), [700, 1750, 1200]);
      assert.equal(t.stt.length, 2);
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE + '.'.repeat(40));
      await ticks();
      assert.equal(t.stt.length, 2, 'no draft once early transcription gave up');
      t.vad.opts.onSpeechEnd(new Float32Array(100));
      await ticks();
      assert.deepEqual(t.stt.at(-1), 100);
      assert.deepEqual(t.transcripts.map((x) => x[0]), ['Draft 0.', 'Draft 1.', 'Third.']);
    } },
    { name: 'T6b: a failed draft falls back to one transcription of the utterance', run: async () => {
      const t = setupBrowser({ transcribe: (i) => (i === 0 ? Promise.reject(new Error('worker busy')) : 'Fine.') });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      await ticks();
      t.vad.opts.onSpeechEnd(new Float32Array(777));
      await ticks();
      assert.deepEqual(t.stt, [32 * 512, 777]);
      assert.deepEqual(t.transcripts, [['Fine.', true]]);
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'T7: speech after an early-end request restores the long pause (setOptions({redemptionMs:1750}))', run: async () => {
      const t = setupBrowser({ transcribe: () => 'Done.' });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      await ticks();
      assert.deepEqual(redemptions(t), [700]);
      feed(t, 'S');
      assert.deepEqual(redemptions(t), [700, 1750]);
      feed(t, 'S');
      assert.deepEqual(redemptions(t), [700, 1750], 'restored once');
    } },
    { name: 'T8: server speech-to-text never drafts: frames make no /api/speech/transcribe call before onSpeechEnd', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: () => 'Hi.' });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE + '.'.repeat(40));
      await ticks();
      assert.equal(t.calls.includes('/api/speech/transcribe'), false);
      assert.deepEqual(redemptions(t), []);
      t.vad.opts.onSpeechEnd(new Float32Array(100));
      await ticks();
      assert.deepEqual(t.stt, [100]);
      assert.deepEqual(t.transcripts, [['Hi.', true]]);
    } },
    { name: 'T9: dictate: frames make no draft, one utterance lands unsent, voice off', run: async () => {
      const t = setupBrowser({ transcribe: () => 'A note.' });
      await t.v.start('dictate');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE + '.'.repeat(40));
      await ticks();
      assert.equal(t.stt.length, 0);
      t.vad.opts.onSpeechEnd(new Float32Array(100));
      await ticks();
      assert.deepEqual(t.transcripts, [['A note.', false]]);
      assert.equal(t.v.state(), 'off');
      assert.equal(t.bargeIns(), 0);
    } },
  ]);
});

const writeTool = (messageId = 'm1') => frame('ask-block', { messageId, block: { kind: 'tool', id: 'w1', name: 'mcp__worca__remember', status: 'running' } });

test('merge: speech that continues a sent message stops the turn and sends one joined message (M1–M4)', async () => {
  await checkRows([
    { name: 'M1: continuing while thinking merges', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      assert.deepEqual(t.transcripts, [['Show me the runs and', true]]);
      t.v.onFrame(frame('ask-start'), '');
      t.vad.opts.onSpeechRealStart();
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.bargeIns(), 1);
      assert.equal(t.transcripts.length, 1);
      t.v.onFrame(frame('ask-done', { text: 'Partial', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts[1], ['Show me the runs and the failed ones.', true]);
      assert.equal(t.transcripts.length, 2);
      assert.equal(t.v.state(), 'thinking');
      t.v.onFrame(frame('ask-start', { messageId: 'm2' }), '');
      t.v.onFrame(frame('ask-delta', { messageId: 'm2' }), 'Fresh answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Fresh answer.']);
      assert.equal(t.bargeIns(), 1);
    } },
    { name: 'M1b: the turn starting while the user is still continuing does not lose the continuation', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.vad.opts.onSpeechRealStart();
      t.v.onFrame(frame('ask-start'), '');                 // the chip says thinking again
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts[1], ['Show me the runs and the failed ones.', true]);
    } },
    { name: 'M1c: more words while the stop is pending are folded into the one merged message', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs', 'that failed', 'this week.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      await say(t);
      assert.equal(t.bargeIns(), 1);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'thinking');
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts, [['Show me the runs', true], ['Show me the runs that failed this week.', true]]);
    } },
    { name: 'M1d: a reply already heard: two continuations before ask-done are sent together, without the first message', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.', 'And the failed ones', 'from this week.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'One. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['One.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'thinking');             // the turn still runs (a tool, say)
      await say(t);
      await say(t);
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(frame('ask-done', { text: 'One.', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts, [['Show me the runs.', true], ['And the failed ones from this week.', true]]);
    } },
    { name: 'M2: speech during transcribing is carried into one message', run: async () => {
      const d = deferred();
      const t = setupBrowser({ sttEngine: 'server', transcribe: (i) => (i === 0 ? d.p : 'and the failed ones.') });
      await t.v.start('talk');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.v.state(), 'transcribing');
      t.vad.opts.onSpeechRealStart();
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(800)); await ticks();
      assert.deepEqual(t.transcripts, []);
      d.resolve('Show me the runs.');
      await ticks();
      assert.deepEqual(t.transcripts, [['Show me the runs and the failed ones.', true]]);
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'M3: a merge before ask-start: the first ask-start/ask-done after it are the stopped turn\'s and are never spoken or adopted', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me', 'the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      await say(t);
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'Old answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.transcripts.length, 1);
      t.v.onFrame(frame('ask-done', { text: 'Old answer.', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts, [['Show me', true], ['Show me the runs.', true]]);
      t.v.onFrame(frame('ask-start', { messageId: 'm2' }), '');
      t.v.onFrame(frame('ask-delta', { messageId: 'm2' }), 'New answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['New answer.']);
    } },
    { name: 'M3b: a replayed ask-start of the turn a merge stopped (a reconnect) is never adopted or spoken', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me', 'the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(frame('ask-start'), '');               // the replay
      t.v.onFrame(frame('ask-delta'), 'Old answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'thinking');
      t.v.onFrame(frame('ask-done', { text: 'Old answer.', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts, [['Show me', true], ['Show me the runs.', true]]);
    } },
    { name: 'M4: Talk: within 10 s after the reply ended the continuation is merged without a stop; at now+11 s it is a separate send', run: async () => {
      for (const [later, want] of [[5000, ['Show me the runs and the failed ones.', true]], [11_000, ['and the failed ones.', true]]]) {
        const t = setupBrowser({ transcribe: texts('Show me the runs.', 'and the failed ones.') });
        await t.v.start('talk');
        await say(t, { realStart: false });
        t.v.onFrame(frame('ask-start'), '');
        t.v.onFrame(frame('ask-done', { text: 'Two runs.', status: 'done' }), null);
        assert.equal(t.v.state(), 'listening');
        t.clock.t = later;
        await say(t);
        assert.equal(t.bargeIns(), 0, `no stop at ${later}`);
        assert.deepEqual(t.transcripts[1], want, `at ${later}`);
        assert.equal(t.transcripts.length, 2);
      }
    } },
  ]);
});

test('merge gate: a turn that changed something, showed a card or ran a sub-agent is never merged into (M5–M7)', async () => {
  await checkRows([
    { name: 'M5: a write tool (mcp__worca__remember) before the continuation: the turn is stopped and the new text is sent alone after ask-done', run: async () => {
      const t = setupBrowser({ transcribe: texts('Remember the deploy steps', 'and the rollback.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(writeTool(), '');
      await say(t);
      assert.equal(t.bargeIns(), 1);
      assert.equal(t.transcripts.length, 1);
      t.v.onFrame(frame('ask-done', { text: 'Saved.', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts[1], ['and the rollback.', true]);
      assert.equal(t.bargeIns(), 1);
    } },
    { name: 'M6: a write tool block arriving after the stop but before ask-done: the new text is sent alone', run: async () => {
      const t = setupBrowser({ transcribe: texts('Remember the deploy steps', 'and the rollback.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(writeTool(), '');
      t.v.onFrame(frame('ask-done', { text: 'Saved.', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts[1], ['and the rollback.', true]);
    } },
    { name: 'M6b: a write tool in a turn that has ended: a continuation within 10 s is sent alone, the turn is not asked again', run: async () => {
      const t = setupBrowser({ transcribe: texts('Remember the deploy steps', 'and the rollback.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(writeTool(), '');
      t.v.onFrame(frame('ask-done', { text: 'Saved.', status: 'done' }), null);
      t.clock.t = 3000;
      await say(t);
      assert.equal(t.bargeIns(), 0);
      assert.deepEqual(t.transcripts, [['Remember the deploy steps', true], ['and the rollback.', true]]);
    } },
    ...[
      ['an ask-card frame', frame('ask-card', { block: { kind: 'card', id: 'c1', card: { type: 'run' } } }), 'the failed ones.'],
      ['an agent block', frame('ask-block', { block: { kind: 'agent', id: 'a1', name: 'Task', status: 'running' } }), 'the failed ones.'],
      ['a read-only worca tool (mcp__worca__list_runs)', toolFrame(), 'Show me the runs and the failed ones.'],
      ['a read-only Read', frame('ask-block', { block: { kind: 'tool', id: 'r1', name: 'Read', status: 'done' } }), 'Show me the runs and the failed ones.'],
      ['a text block', frame('ask-block', { block: { kind: 'text', id: 'x1', text: 'Looking.' } }), 'Show me the runs and the failed ones.'],
    ].map(([what, fr, want]) => ({ name: `M7: ${what} → ${want}`, run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(fr, '');
      await say(t);
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.deepEqual(t.transcripts[1], [want, true]);
      assert.equal(t.bargeIns(), 1);
    } })),
  ]);
});

test('merge: a misfire, a filler or noise cancels nothing; a hold defers the reply; stop() sends nothing later (M8–M14)', async () => {
  await checkRows([
    { name: 'M8: a misfire after a real start: no stop, no send, state back to thinking', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.vad.opts.onSpeechRealStart();
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onVADMisfire();
      await ticks();
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'M9: a filler continuation (\'Mm-hm.\') cancels nothing', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs.', 'Mm-hm.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'thinking');
      t.v.onFrame(frame('ask-done', { text: 'Two.', status: 'done' }), null);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'M10: noise transcribed as \'Thank you.\' cancels nothing; the acknowledgement timer is re-armed after the hold', run: async () => {
      const t = setupBrowser({ tts: true, ackPhrases: ['On it.'], ackAfterMs: 30, transcribe: texts('Show me the runs.', 'Thank you.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.vad.opts.onSpeechRealStart();                    // the hold disarms the acknowledgement
      await wait(50);
      assert.deepEqual(t.audio.played, []);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'thinking');
      await wait(60); await ticks();
      assert.deepEqual(t.audio.played, ['On it.']);
    } },
    { name: 'M11: hands-free: once the reply is playing, speech is today\'s barge-in (no merge): the next utterance is sent alone', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'One. Two. ');
      await ticks();
      assert.equal(t.v.state(), 'speaking');
      await say(t);
      assert.equal(t.bargeIns(), 1);
      assert.deepEqual(t.transcripts, [['Show me the runs and', true], ['the failed ones.', true]]);
      t.v.onFrame(frame('ask-done', { text: 'One. Two.', status: 'stopped' }), null);
      assert.equal(t.transcripts.length, 2);
    } },
    { name: 'M11b: a barge-in that turns out to be a misfire leaves nothing to merge into: the next words are sent alone', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'One. Two. ');
      await ticks();
      t.vad.opts.onSpeechRealStart();
      t.vad.opts.onVADMisfire();
      assert.equal(t.bargeIns(), 1);
      await say(t);
      assert.equal(t.bargeIns(), 1);
      assert.deepEqual(t.transcripts, [['Show me the runs and', true], ['the failed ones.', true]]);
    } },
    { name: 'M11c: hands-free: a quick reply that was read aloud in full is never merged into, even within 10 s', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-done', { text: 'Two runs.', status: 'done' }), null);
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
      t.clock.t = 3000;
      await say(t);
      assert.equal(t.bargeIns(), 0);
      assert.deepEqual(t.transcripts[1], ['and the failed ones.', true]);
    } },
    { name: 'M12: a reply sentence that arrives during a hold is not played until the hold ends', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.', 'Mm-hm.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.vad.opts.onSpeechRealStart();
      t.v.onFrame(frame('ask-delta'), 'Reply one. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.']);
      assert.equal(t.v.state(), 'speaking');
      assert.equal(t.bargeIns(), 0);
    } },
    { name: 'M12b: a reply sentence still rendering when the hold starts is not played until the hold ends (I9)', run: async () => {
      const gate = deferred();
      const t = setupBrowser({ tts: true, synthGate: gate, transcribe: texts('Show me the runs.', 'Mm-hm.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-delta'), 'Reply one. ');
      await ticks();
      t.vad.opts.onSpeechRealStart();
      gate.resolve();
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.']);
      assert.equal(t.v.state(), 'speaking');
    } },
    ...[
      ['merged into the ended turn', null, 'Show me the runs and the failed ones.'],
      ['sent alone (the turn changed something)', writeTool, 'and the failed ones.'],
    ].map(([what, extra, want]) => ({ name: `M12c: a held reply's audio is dropped when the continuation is ${what} after the turn ended`, run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      if (extra) t.v.onFrame(extra(), '');
      t.vad.opts.onSpeechRealStart();
      t.v.onFrame(frame('ask-delta'), 'Here are the runs. ');
      t.v.onFrame(frame('ask-done', { text: 'Here are the runs. All green.', status: 'done' }), null);
      await ticks();
      assert.deepEqual(t.audio.played, []);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.transcripts[1], [want, true]);
      t.v.onFrame(frame('ask-start', { messageId: 'm2' }), '');
      t.v.onFrame(frame('ask-delta', { messageId: 'm2' }), 'Two failed. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two failed.']);
    } })),
    { name: 'M13: stop() during a hold and during a pending merge: nothing is sent afterwards, even when ask-done arrives', run: async () => {
      const hold = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await hold.v.start('talk');
      await say(hold, { realStart: false });
      hold.v.onFrame(frame('ask-start'), '');
      hold.vad.opts.onSpeechRealStart();
      await hold.v.stop();
      hold.vad.opts.onSpeechEnd(new Float32Array(10)); await ticks();
      hold.v.onFrame(frame('ask-done', { text: 'x', status: 'done' }), null);
      assert.equal(hold.transcripts.length, 1);
      assert.equal(hold.bargeIns(), 0);

      const pending = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await pending.v.start('talk');
      await say(pending, { realStart: false });
      pending.v.onFrame(frame('ask-start'), '');
      await say(pending);
      assert.equal(pending.bargeIns(), 1);
      await pending.v.stop();
      pending.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      await ticks();
      assert.equal(pending.transcripts.length, 1);
      assert.equal(pending.v.state(), 'off');
    } },
    { name: 'M13c: stop() during a pending merge, then voice on again: the old turn\'s ask-done sends nothing', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      assert.equal(t.bargeIns(), 1);
      await t.v.stop();
      await t.v.start('talk');
      assert.equal(t.v.state(), 'listening');
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      await ticks();
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'M13b: speech that starts while an acknowledgement plays is ignored, even over a sent message', run: async () => {
      const t = setupBrowser({ tts: true, ackPhrases: ['On it.'], transcribe: texts('Show me the runs.', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(toolFrame(), '');
      await ticks();
      assert.deepEqual(t.audio.played, ['On it.']);
      await say(t);
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.transcripts.length, 1);
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'M14: a carry followed by a misfire sends the carried text alone', run: async () => {
      const d = deferred();
      const t = setupBrowser({ sttEngine: 'server', transcribe: () => d.p });
      await t.v.start('talk');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      t.vad.opts.onSpeechRealStart();
      d.resolve('Show me the runs.');
      await ticks();
      assert.deepEqual(t.transcripts, [], 'carried while the next segment runs');
      t.vad.opts.onVADMisfire();
      await ticks();
      assert.deepEqual(t.transcripts, [['Show me the runs.', true]]);
      assert.equal(t.bargeIns(), 0);
      assert.equal(t.v.state(), 'thinking');
    } },
  ]);
});

test('M15: READ_ONLY_ASK_TOOLS are real read-only Ask tools; mergeSafeBlock fails closed', async () => {
  const src = readFileSync(new URL('../src/core/ask/tools.mjs', import.meta.url), 'utf8');
  assert.ok(Object.isFrozen(READ_ONLY_ASK_TOOLS));
  assert.equal(MERGE_GRACE_MS, 10_000);
  for (const n of READ_ONLY_ASK_TOOLS) {
    assert.ok(src.includes(`name: '${n}'`), `${n} is an Ask tool`);
    assert.doesNotMatch(n, /^(propose_|draft_)/);
  }
  await checkRows([
    [{ kind: 'tool', name: 'mcp__worca__list_runs' }, true],
    [{ kind: 'tool', name: 'list_runs' }, true],
    [{ kind: 'tool', name: 'Read' }, true],
    [{ kind: 'tool', name: 'Grep' }, true],
    [{ kind: 'tool', name: 'Glob' }, true],
    [{ kind: 'tool', name: 'mcp__worca__remember' }, false],
    [{ kind: 'tool', name: 'mcp__worca__propose_run' }, false],
    [{ kind: 'tool', name: 'mcp__github__list_issues' }, false],
    [{ kind: 'tool', name: 'Bash' }, false],
    [{ kind: 'tool' }, false],
    [{ kind: 'agent', name: 'Task' }, false],
    [{ kind: 'text', text: 'hi' }, true],
    [{ kind: 'thinking' }, true],
  ].map(([block, want]) => ({ name: `mergeSafeBlock(${JSON.stringify(block)})`, run: () => assert.equal(mergeSafeBlock(block), want) })));
});

test('hands-free spoken version: ask-spoken is read instead of the prose; no spoken version reads at most two sentences', async () => {
  const sendTurn = async (t) => { t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick(); t.v.onFrame(frame('ask-start'), '', null); };
  const drain = async (t) => { for (let i = 0; i < 12 && t.audio.current; i++) { t.audio.current.end(); await tick(); await tick(); } };
  await checkRows([
    { name: 'ask-spoken then prose deltas: only the spoken sentences are synthesized; ask-done flushes the spoken tail', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'Two runs failed. Both');
      await tick(); await tick();
      assert.deepEqual(t.audio.played, ['Two runs failed.']);
      t.v.onFrame(frame('ask-spoken'), '', 'Two runs failed. Both were the reviewer');
      t.v.onFrame(frame('ask-delta'), 'Here is the **full** reply. It is long. ', 'Two runs failed. Both were the reviewer');
      t.v.onFrame(frame('ask-done', { text: 'Here is the **full** reply. It is long.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['Two runs failed.', 'Both were the reviewer']);
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'no ask-spoken: at most two prose sentences are read (fallback)', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-delta'), 'First sentence. Second', '');
      t.v.onFrame(frame('ask-done', { text: 'First sentence. Second one. Third one.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['First sentence.', 'Second one.']);
    } },
    { name: 'the spoken text never reads a fenced code block, a table row or a link target', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      const sp = 'It failed.\n```\nnpm test\n```\n| a | b |\nSee [the run](http://x.test/run). ';
      t.v.onFrame(frame('ask-spoken'), '', sp);
      t.v.onFrame(frame('ask-done', { text: 'Full.', status: 'done' }), null, null);
      await drain(t);
      assert.ok(t.synthesized.length >= 2, JSON.stringify(t.synthesized));
      assert.ok(t.synthesized.every((x) => !/npm test|\||http/.test(x)), JSON.stringify(t.synthesized));
    } },
    { name: 'the first spoken sentence disarms the acknowledgement; a tool before any spoken text plays it', run: async () => {
      const t = setup({ ackPhrases: ['On it.'], ackAfterMs: 30 });
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'Yes. ');
      await tick(); await tick();
      await wait(50);
      await drain(t);
      assert.deepEqual(t.audio.played, ['Yes.']);
      const r = setup({ ackPhrases: ['On it.'] });
      await r.v.start('handsfree');
      await sendTurn(r);
      r.v.onFrame(toolFrame(), '', null);
      await tick(); await tick();
      assert.deepEqual(r.audio.played, ['On it.']);
      await drain(r);
      r.v.onFrame(frame('ask-spoken'), '', 'Two runs. ');
      r.v.onFrame(frame('ask-done', { text: 'x', status: 'done' }), null, null);
      await drain(r);
      assert.deepEqual(r.audio.played, ['On it.', 'Two runs.']);
    } },
    { name: 'barge-in during spoken playback stops it; later ask-spoken of that turn is not spoken', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'One. Two. ');
      await tick(); await tick();
      assert.equal(t.v.state(), 'speaking');
      t.vad.opts.onSpeechRealStart();
      await tick();
      assert.equal(t.bargeIns(), 1);
      t.v.onFrame(frame('ask-spoken'), '', 'One. Two. Three. ');
      await tick();
      assert.deepEqual(t.audio.played, ['One.']);
    } },
    { name: 'a resync replay (spoken re-growing from empty) never re-speaks', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'One. ');
      await tick(); await tick();
      t.v.onFrame(frame('ask-start'), '', '');
      t.v.onFrame(frame('ask-spoken'), '', 'One. ');
      t.v.onFrame(frame('ask-spoken'), '', 'One. Two. ');
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.audio.played, ['One.', 'Two.']);
    } },
    { name: 'a tool after spoken text flushes the spoken tail, never the prose', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'Checking the runs');
      await tick();
      assert.deepEqual(t.synthesized, [], 'no sentence end yet: it waits');
      t.v.onFrame(toolFrame(), 'Prose before the tool', 'Checking the runs');
      await drain(t);
      assert.deepEqual(t.synthesized, ['Checking the runs']);
    } },
    { name: 'one controller, two turns: a turn with a spoken version does not silence the next turn\'s prose', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'One. ');
      await tick(); await tick();
      t.v.onFrame(frame('ask-done', { text: 'Full one.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['One.']);
      assert.equal(t.v.state(), 'listening');
      t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
      t.v.onFrame(frame('ask-start', { messageId: 'm2' }), '', null);
      t.v.onFrame(frame('ask-delta', { messageId: 'm2' }), 'Prose here. ', null);
      await tick(); await tick();
      t.v.onFrame(frame('ask-done', { messageId: 'm2', text: 'Prose here.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['One.', 'Prose here.']);
    } },
    { name: 'talk mode: ask-spoken frames speak nothing', run: async () => {
      const t = setup({ fetchOverride: async (url) => (url === '/api/speech' ? { ok: true, json: async () => ({ stt: { configured: true }, tts: { engine: 'server', configured: true } }) } : null) });
      await t.v.start('talk');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'Not read. ');
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'done' }), null, null);
      await tick(); await tick();
      assert.deepEqual(t.synthesized, []);
    } },
  ]);
});

test('speaks(): true only for hands-free with text-to-speech on (not while loading, talk, dictate, TTS off, or after a TTS failure)', async () => {
  const t = setup();
  assert.equal(t.v.speaks(), false, 'voice off');
  const starting = t.v.start('handsfree');
  assert.equal(t.v.speaks(), false, 'loading: /api/speech has not answered');
  await starting;
  assert.equal(t.v.speaks(), true);
  await t.v.start('talk');
  assert.equal(t.v.speaks(), false, 'talk');
  await t.v.start('handsfree');
  assert.equal(t.v.speaks(), true);
  let release = null;
  const held = setup({ fetchOverride: async (url) => (url === '/api/speech' && release === null
    ? new Promise((r) => { release = () => r({ ok: true, json: async () => ({ stt: { configured: true }, tts: { configured: true } }) }); }) : null) });
  release = 'first';
  await held.v.start('handsfree');
  assert.equal(held.v.speaks(), true);
  release = null;
  const restarting = held.v.start('handsfree');
  await tick(); await tick();
  assert.equal(typeof release, 'function', '/api/speech is still pending');
  assert.equal(held.v.speaks(), false, 'a restart is loading again: no stale answer');
  release();
  await restarting;
  assert.equal(held.v.speaks(), true);
  await t.v.start('dictate');
  assert.equal(t.v.speaks(), false, 'dictate');
  const off = setup({ tts: false });
  await off.v.start('handsfree');
  assert.equal(off.v.speaks(), false, 'TTS off');
  const broken = setup({ fetchOverride: async (url) => (url === '/api/speech/synthesize' ? { ok: false, status: 502, json: async () => ({ error: 'down' }) } : null) });
  await broken.v.start('handsfree');
  broken.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick();
  broken.v.onFrame(frame('ask-start'), '', null);
  broken.v.onFrame(frame('ask-delta'), 'Hello there. ', null);
  await tick(); await tick(); await tick();
  assert.equal(broken.notices.length, 1);
  assert.equal(broken.v.speaks(), false, 'after ttsFailed');
});

// ---- unfinished endings wait the hold (H1), merges supersede, short spoken replies (docs/speech.md) ----
// setupBrowser's clock stands still, so the hold's remaining time is unfinishedHoldMs minus the VAD's silence
// (1200 ms on "Your server", 1750 ms adaptive): 1240 leaves a 40 ms timer.
test('unfinished ending: an ellipsis waits the hold, then one joined message (U1–U6)', async () => {
  await checkRows([
    { name: 'U1: server STT, "Do you know how...": nothing is sent before the hold, one send after it', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Do you know how...'), unfinishedHoldMs: 1240 });
      await t.v.start('handsfree');
      await say(t);
      assert.deepEqual(t.transcripts, [], 'held');
      assert.equal(t.v.state(), 'listening');
      await wait(70);
      assert.deepEqual(t.transcripts, [['Do you know how...', true]]);
      await wait(60);
      assert.equal(t.transcripts.length, 1, 'sent once');
    } },
    { name: 'U2: speech that resumes inside the hold gives exactly one message, the joined text', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Do you know how...', 'do you make the best sandwich?'), unfinishedHoldMs: 1240 });
      await t.v.start('handsfree');
      await say(t);
      assert.deepEqual(t.transcripts, []);
      await say(t);
      await wait(70);
      assert.deepEqual(t.transcripts, [['Do you know how... do you make the best sandwich?', true]]);
    } },
    { name: 'U3: browser STT: an unfinished draft makes the VAD wait the whole hold', run: async () => {
      const t = setupBrowser({ transcribe: () => 'Do you know how...', unfinishedHoldMs: 5000 });
      await t.v.start('handsfree');
      feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
      await ticks();
      assert.deepEqual(redemptions(t), [5000]);
      t.vad.opts.onSpeechEnd(new Float32Array(100));
      await ticks();
      assert.deepEqual(t.transcripts, [['Do you know how...', true]], 'the VAD already waited the hold: sent at once');
    } },
    { name: 'U4: a finished sentence is sent at once (no hold)', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t);
      assert.deepEqual(t.transcripts, [['Show me the runs.', true]]);
    } },
    { name: 'U5: a misfire during the hold re-arms it and does not send at once', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Can you tell me what'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t);
      t.vad.opts.onSpeechRealStart();
      await wait(70);
      assert.deepEqual(t.transcripts, [], 'speech started: the held words wait for that segment');
      t.vad.opts.onVADMisfire();
      await ticks();
      assert.deepEqual(t.transcripts, [], 'not sent at once');
      await wait(70);
      assert.deepEqual(t.transcripts, [['Can you tell me what', true]]);
    } },
    { name: 'U6: stop() during the hold: nothing is sent later', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('so —'), unfinishedHoldMs: 1240 });
      await t.v.start('handsfree');
      await say(t);
      await t.v.stop();
      await wait(80);
      assert.deepEqual(t.transcripts, []);
    } },
    { name: 'U7: a merge waiting on a hold: the stopped turn ends first, the merged text is sent when the hold ends', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from,'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      assert.equal(t.bargeIns(), 1, 'the finished continuation stops the turn');
      await say(t);
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.equal(t.transcripts.length, 1, 'still held');
      await wait(70);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from,', { autoSend: true, supersede: true }]]);
    } },
    { name: 'U8: speech that starts inside the hold stops its timer: the stopped turn ending meanwhile still waits for those words', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from,', 'last week.'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      await say(t);                                         // "and the ones from," is held
      t.vad.opts.onSpeechRealStart();                       // they go on talking…
      await wait(70);                                       // …past the hold
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.equal(t.transcripts.length, 1, 'the merge still waits for the words being spoken');
      t.vad.opts.onSpeechEnd(new Float32Array(1600));
      await ticks();
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from, last week.', { autoSend: true, supersede: true }]]);
    } },
    { name: 'U9: speech the voice does not deliver (another turn started) leaves the held words to their hold: sent once', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Do you know how', 'to fix the build?'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t);
      assert.deepEqual(t.transcripts, [], 'held');
      t.v.onFrame(frame('ask-start', { messageId: 'typed1' }), '');   // a typed message's turn: the state leaves listening
      await say(t);                                                    // not delivered (not listening, no resume)
      await wait(150);
      assert.deepEqual(t.transcripts, [['Do you know how', true]], 'the hold still ran out and sent the held words');
      t.v.onFrame(frame('ask-done', { messageId: 'typed1', text: 'x' }), null);
      await wait(80);
      assert.equal(t.transcripts.length, 1, 'sent once');
    } },
    { name: 'U10: a continuation held inside the merge grace still merges when its hold ends after the grace', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', tts: true, transcribe: texts('Show me the runs.', 'and do you know how'), unfinishedHoldMs: 1240 });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.clock.t = MERGE_GRACE_MS - 1000;
      await say(t);                                                    // held, inside the grace
      assert.equal(t.sends.length, 1, 'held');
      t.v.onFrame(frame('ask-delta'), 'There are three runs.');
      t.v.onFrame(frame('ask-done', { text: 'There are three runs.' }), null);
      t.clock.t = MERGE_GRACE_MS + 1000;                               // the hold ends past the grace
      await wait(100);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs and do you know how', { autoSend: true, supersede: true }]]);
    } },
    { name: 'U11: held words carried behind a newer segment stay held: the stopped turn ending meanwhile sends nothing early', run: async () => {
      let rB; const gB = new Promise((r) => { rB = r; });
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from', gB, 'last week.'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);                                                    // a finished continuation: the merge stops the turn
      await say(t);                                                    // "and the ones from" is held
      t.vad.opts.onSpeechRealStart();                                  // B
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks(2);  // B is being transcribed
      t.vad.opts.onSpeechRealStart();                                  // C starts meanwhile
      rB('of'); await ticks();                                         // B is carried behind C
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.equal(t.sends.length, 1, 'nothing sent before C is heard');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      await wait(60);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from of last week.', { autoSend: true, supersede: true }]]);
      assert.equal(t.bargeIns(), 1, 'no second turn started and stopped');
    } },
  ]);
});

test('merge passes supersede only for the merged text', async () => {
  await checkRows([
    { name: 'a plain send has no supersede', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      assert.deepEqual(t.sends, [['Show me the runs.', { autoSend: true }]]);
    } },
    { name: 'the ended path inside the grace: merged text with supersede', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-done', { text: 'ok', status: 'done' }), null);
      t.clock.t = 3000;
      await say(t);
      assert.deepEqual(t.sends[1], ['Show me the runs and the failed ones.', { autoSend: true, supersede: true }]);
    } },
    { name: 'the ended path after the grace: a separate plain send', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(frame('ask-done', { text: 'ok', status: 'done' }), null);
      t.clock.t = MERGE_GRACE_MS + 1000;
      await say(t);
      assert.deepEqual(t.sends[1], ['the failed ones.', { autoSend: true }]);
    } },
    { name: 'the ended path after an unsafe turn: a plain send', run: async () => {
      const t = setupBrowser({ transcribe: texts('Remember the deploy steps', 'and the rollback.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      t.v.onFrame(writeTool(), '');
      t.v.onFrame(frame('ask-done', { text: 'Saved.', status: 'done' }), null);
      t.clock.t = 3000;
      await say(t);
      assert.deepEqual(t.sends[1], ['and the rollback.', { autoSend: true }]);
    } },
    { name: 'the pending path: merged when safe', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      t.v.onFrame(frame('ask-done', { text: 'x', status: 'stopped' }), null);
      assert.deepEqual(t.sends[1], ['Show me the runs and the failed ones.', { autoSend: true, supersede: true }]);
    } },
    { name: 'the pending path: plain when unsafe', run: async () => {
      const t = setupBrowser({ transcribe: texts('Remember the deploy steps', 'and the rollback.') });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.v.onFrame(frame('ask-start'), '');
      await say(t);
      t.v.onFrame(writeTool(), '');
      t.v.onFrame(frame('ask-done', { text: 'Saved.', status: 'stopped' }), null);
      assert.deepEqual(t.sends[1], ['and the rollback.', { autoSend: true }]);
    } },
  ]);
});

test('no spoken marker: at most two sentences, or the short line (F1–F6)', async () => {
  const sendTurn = async (t) => { t.vad.opts.onSpeechEnd(new Float32Array(10)); await tick(); await tick(); t.v.onFrame(frame('ask-start'), '', null); };
  const drain = async (t) => { for (let i = 0; i < 12 && t.audio.current; i++) { t.audio.current.end(); await tick(); await tick(); } };
  await checkRows([
    { name: 'F1: three prose sentences: two are synthesized', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-delta'), 'One is here. Two is here. Three is here. ', null);
      t.v.onFrame(frame('ask-done', { text: 'One is here. Two is here. Three is here. Four.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['One is here.', 'Two is here.']);
    } },
    { name: 'F2: a reply that opens with a list reads the short line', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-delta'), '- run one failed.\n- run two failed.\n', null);
      t.v.onFrame(frame('ask-done', { text: '- run one failed.\n- run two failed.\n', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, [SPOKEN_FALLBACK_LINE]);
    } },
    { name: 'F3: a long first sentence reads the short line', run: async () => {
      const t = setup();
      const long = `${'word '.repeat(60).trim()}.`;
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-done', { text: `${long} Short.`, status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, [SPOKEN_FALLBACK_LINE]);
    } },
    { name: 'F4: ask-spoken still wins over the prose', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-spoken'), '', 'Two runs failed. ');
      t.v.onFrame(frame('ask-delta'), '- a\n- b\n', 'Two runs failed. ');
      t.v.onFrame(frame('ask-done', { text: '- a\n- b\n', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['Two runs failed.']);
    } },
    { name: 'F5: talk synthesizes nothing', run: async () => {
      const t = setup();
      await t.v.start('talk');
      await sendTurn(t);
      t.v.onFrame(frame('ask-delta'), 'One. Two. Three. ', null);
      t.v.onFrame(frame('ask-done', { text: 'One. Two. Three.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, []);
    } },
    { name: 'F6: narration before a tool and the final prose share the two-sentence budget', run: async () => {
      const t = setup();
      await t.v.start('handsfree');
      await sendTurn(t);
      t.v.onFrame(frame('ask-delta'), 'I will check the runs.', null);
      t.v.onFrame(toolFrame(), 'I will check the runs.', null);
      t.v.onFrame(frame('ask-delta'), 'I will check the runs.\n\nTwo runs failed. Both were reviews. ', null);
      t.v.onFrame(frame('ask-done', { text: 'I will check the runs.\n\nTwo runs failed. Both were reviews.', status: 'done' }), null, null);
      await drain(t);
      assert.deepEqual(t.synthesized, ['I will check the runs.', 'Two runs failed.']);
    } },
  ]);
});

// ---- hands-free end to end: a real sequence from the utterance to play() (H1–H9) ----
// Each row: an utterance is sent, the turn's frames arrive as the panel passes them (t.frame), each played item ends.
const startOf = (messageId = 'm1') => frame('ask-start', { messageId, userMessageId: `u-${messageId}` });
const spokenOf = (messageId = 'm1') => frame('ask-spoken', { messageId });
const doneOf = (messageId = 'm1', text = 'x', status = 'done') => frame('ask-done', { messageId, text, status });
const eventStart = (messageId = 'm9') => frame('ask-start', { messageId, userMessageId: 'u-ev' });
const never = () => new Promise(() => {});
/** Wait until cond() holds (polling every 2 ms): the time it held, or null after `ms`. */
async function until(cond, ms = 600) {
  const t0 = Date.now();
  while (!cond()) { if (Date.now() - t0 > ms) return null; await wait(2); }
  return Date.now();
}

test('hands-free end to end: replies and acks are heard (H1-H9)', async () => {
  await checkRows([
    { name: 'H1: a reply with a <spoken> block: its sentences are played in order, then listening', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      assert.deepEqual(t.sends, [['Show me the runs.', { autoSend: true }]]);
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'Two runs failed. Both were reviews. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs failed.']);
      t.frame(doneOf('m1', 'The full reply.'), null, null);
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs failed.', 'Both were reviews.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'H2: a reply with no <spoken> block: the prose fallback is played, then listening', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.frame(frame('ask-delta'), 'First sentence. Second', null);
      await ticks();
      assert.deepEqual(t.audio.played, ['First sentence.']);
      t.frame(doneOf('m1', 'First sentence. Second one.'), null, null);
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['First sentence.', 'Second one.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'H3: the default config (browser engines, no configured key): speaks() is true at start and at the send, and the reply is played', run: async () => {
      const t = setupBrowser({ tts: true, ttsEngine: 'browser', ttsConfigured: false, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      assert.equal(t.v.speaks(), true);
      await say(t, { realStart: false });
      assert.deepEqual(t.speaksAtSend, [true]);
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
    } },
    { name: 'H4: the acknowledgement plays after the silence, the reply after it', run: async () => {
      const t = setupBrowser({ tts: true, ackPhrases: ['Okay, let me look into that.'], ackAfterMs: 30, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      await wait(50); await ticks();
      assert.deepEqual(t.audio.played, ['Okay, let me look into that.']);
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Okay, let me look into that.'], 'the reply waits for the acknowledgement');
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Okay, let me look into that.', 'Two runs.']);
    } },
    { name: 'H5a: a noise blip while thinking, before any reply: the acknowledgement plays after the blip, then the reply', run: async () => {
      const t = setupBrowser({ tts: true, ackPhrases: ['On it.'], ackAfterMs: 30, transcribe: texts('Show me the runs.', '') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.vad.opts.onSpeechRealStart();                    // the blip holds the acknowledgement
      await wait(50);
      assert.deepEqual(t.audio.played, []);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.v.state(), 'thinking');
      await wait(50); await ticks();
      assert.deepEqual(t.audio.played, ['On it.']);
      t.audio.current.end(); await ticks();
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['On it.', 'Two runs.']);
    } },
    { name: 'H5b: the reply arrives during the blip: nothing plays until the blip ends, then the reply, no acknowledgement', run: async () => {
      const t = setupBrowser({ tts: true, ackPhrases: ['On it.'], ackAfterMs: 30, transcribe: texts('Show me the runs.', '') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      t.frame(spokenOf(), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      await wait(50); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
    } },
    { name: 'H6: a blip whose segment never ends: the backstop releases the hold, the reply is played, then listening', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();                    // onSpeechEnd never comes
      t.frame(spokenOf(), '', 'Two runs. ');
      t.frame(doneOf(), null, null);
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
      await wait(80); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'H7: an empty or filler early draft never stretches the VAD to the hold', run: async () => {
      for (const draft of ['', 'mm-hm']) {
        const t = setupBrowser({ transcribe: () => draft, unfinishedHoldMs: 5000 });
        await t.v.start('handsfree');
        feed(t, SPEECH); t.vad.opts.onSpeechRealStart(); feed(t, SHORT_PAUSE);
        await ticks();
        assert.equal(t.stt.length, 1, `${JSON.stringify(draft)}: the draft ran`);
        assert.ok(!redemptions(t).includes(5000), `${JSON.stringify(draft)}: ${JSON.stringify(redemptions(t))}`);
      }
    } },
    { name: 'H8: a merge while the first reply sentence still renders: no text-only notice, the merged turn\'s reply is played', run: async () => {
      const t = setupBrowser({ tts: true, ttsEngine: 'browser', speakGate: (i) => (i === 0 ? never() : null), bind: 'before', transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'Here are the runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      await say(t);                                      // the continuation stops the turn
      assert.equal(t.bargeIns(), 1);
      assert.deepEqual(t.notices, []);
      assert.equal(t.v.speaks(), true);
      t.frame(doneOf('m1', 'x', 'stopped'), null, null);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs and the failed ones.', { autoSend: true, supersede: true }]]);
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Fresh answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Fresh answer.']);
    } },
    { name: 'H9: a barge-in while the second sentence renders: no text-only notice, the next turn\'s reply is played', run: async () => {
      const t = setupBrowser({ tts: true, ttsEngine: 'browser', speakGate: (i) => (i === 1 ? never() : null), transcribe: texts('Show me the runs.', 'Stop, the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.frame(spokenOf(), '', 'One. Two. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['One.']);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'speaking', 'the second sentence is still rendering');
      t.vad.opts.onSpeechRealStart();                    // the reply's own echo is enough
      await ticks();
      assert.equal(t.bargeIns(), 1);
      assert.deepEqual(t.notices, []);
      assert.equal(t.v.speaks(), true);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.sends.slice(1), [['Stop, the failed ones.', { autoSend: true }]]);
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Fresh answer. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['One.', 'Fresh answer.']);
    } },
  ]);
});

test('the speech hold always ends (K1-K5)', async () => {
  await checkRows([
    { name: 'K1: the backstop fires once while onSpeechEnd never comes: the queued reply plays and the chip follows the turn', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      t.frame(spokenOf(), '', 'Reply one. Reply two. ');
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'listening');
      await wait(70); await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.']);
      assert.deepEqual(t.states.slice(-2), ['thinking', 'speaking']);
      const n = t.states.length;
      await wait(70); await ticks();
      assert.equal(t.states.length, n, 'fired once');
    } },
    { name: 'K2: a hold released normally leaves no live backstop', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.', '') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();   // the blip ends: the hold is released
      assert.equal(t.v.state(), 'thinking');
      const before = [...t.states];
      await wait(80); await ticks();
      assert.deepEqual(t.states, before);
      assert.deepEqual(t.audio.played, []);
    } },
    { name: 'K3: stop() during a hold: nothing plays and nothing is painted afterwards', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      t.frame(spokenOf(), '', 'Reply one. ');
      await ticks();
      await t.v.stop();
      const n = t.states.length;
      await wait(80); await ticks();
      assert.equal(t.states.length, n);
      assert.equal(t.v.state(), 'off');
      assert.deepEqual(t.audio.played, []);
    } },
    ...[
      ['a current worded draft re-arms the backstop', 'Do you know how...', true],
      ['an empty draft does not re-arm it', '', false],
    ].map(([what, draftText, rearmed]) => ({ name: `K4: ${what}`, run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 100, unfinishedHoldMs: 5000, transcribe: (i) => (i === 0 ? 'Show me the runs.' : draftText) });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      const held = Date.now();
      t.frame(spokenOf(), '', 'Reply one. ');
      await wait(60);
      feed(t, SPEECH + SHORT_PAUSE);
      await ticks();
      const drafted = Date.now();
      assert.equal(t.stt.length, 2, 'the draft ran');
      assert.deepEqual(t.audio.played, []);
      const at = await until(() => t.audio.played.length > 0);
      assert.ok(at, 'the reply plays in the end');
      if (rearmed) assert.ok(at - drafted >= 90, `re-armed at the draft: played ${at - drafted} ms after it`);
      else assert.ok(at - drafted < 90 && at - held >= 95, `from the hold's start: ${at - held} ms after it, ${at - drafted} ms after the draft`);
    } })),
    { name: 'K4: a new segment during a hold re-arms the backstop (server STT: no drafts)', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', tts: true, holdBackstopMs: 200, unfinishedHoldMs: 5000, transcribe: texts('Show me the runs.', 'and the ones from,') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();                    // segment 1: the hold starts
      const held = Date.now();
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();   // unfinished: carried, the hold stays
      assert.equal(t.sends.length, 1);
      await wait(100 - (Date.now() - held));
      t.vad.opts.onSpeechRealStart();                    // segment 2
      const seg2 = Date.now();
      t.frame(spokenOf(), '', 'Reply one. ');
      await wait(250 - (Date.now() - held)); await ticks();
      assert.deepEqual(t.audio.played, [], 'not from the hold\'s start');
      const at = await until(() => t.audio.played.length > 0);
      assert.ok(at, 'the reply plays in the end');
      assert.ok(at - seg2 >= 190, `from segment 2's start: played ${at - seg2} ms after it`);
    } },
    { name: 'K5: after a backstop release, the open segment\'s words follow the merge rules (reply heard and the turn ended: a plain send that stops the reply)', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();                    // the segment stays open
      t.frame(spokenOf(), '', 'Reply one. Reply two. ');
      t.frame(doneOf(), null, null);
      await wait(70); await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.']);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.sends.slice(1), [['and the failed ones.', { autoSend: true }]]);
      assert.equal(t.bargeIns(), 0);
      await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.'], 'the rest of the reply is never spoken');
      assert.equal(t.v.state(), 'thinking');
    } },
    { name: 'K5: after a backstop release with the turn still running, the words stop it and go out plain at its ask-done', run: async () => {
      const t = setupBrowser({ tts: true, holdBackstopMs: 40, transcribe: texts('Show me the runs.', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf(), '', null);
      t.vad.opts.onSpeechRealStart();
      t.frame(spokenOf(), '', 'Reply one. Reply two. ');
      await wait(70); await ticks();
      assert.deepEqual(t.audio.played, ['Reply one.']);
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.equal(t.bargeIns(), 1);
      assert.equal(t.sends.length, 1);
      assert.equal(t.v.state(), 'thinking');
      t.frame(doneOf('m1', 'x', 'stopped'), null, null);
      assert.deepEqual(t.sends.slice(1), [['and the failed ones.', { autoSend: true }]]);
    } },
  ]);
});

test('turns are bound by id (P1-P9)', async () => {
  const MERGED = ['Show me the runs and the failed ones.', { autoSend: true, supersede: true }];
  const mergeBeforeStart = (bind) => async () => {
    const t = setupBrowser({ tts: true, bind, transcribe: texts('Show me the runs and', 'the failed ones.') });
    await t.v.start('handsfree');
    await say(t, { realStart: false });
    await say(t);                                        // the merge stops m1 before its ask-start
    assert.equal(t.bargeIns(), 1);
    t.frame(startOf('m1'), '', null);
    t.frame(spokenOf('m1'), '', 'Old answer. ');
    t.frame(doneOf('m1', 'Old answer.', 'stopped'), null, null);
    await ticks();
    assert.deepEqual(t.audio.played, []);
    assert.deepEqual(t.sends.slice(1), [MERGED]);
    t.frame(startOf('m2'), '', null);
    t.frame(spokenOf('m2'), '', 'New answer. ');
    t.frame(doneOf('m2'), null, null);
    await ticks();
    assert.deepEqual(t.audio.played, ['New answer.']);
    t.audio.current.end(); await ticks();
    assert.equal(t.v.state(), 'listening');
    assert.equal(t.sends.length, 2, 'no duplicate send');
  };
  const bindM2 = (t) => t.v.noteSent?.({ sendId: t.sendIds[0], userMessageId: 'u-m2', assistantMessageId: 'm2' });
  await checkRows([
    { name: 'P1: a merge while the stopped turn has no ask-start yet, the 202 first: one merged send, its reply spoken', run: mergeBeforeStart('before') },
    { name: 'P2: the same with the frames before the 202', run: mergeBeforeStart('after') },
    { name: 'P3: the stopped turn ends during a hold: one merged send at the flush, the next turn is adopted and spoken', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', tts: true, bind: 'before', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from,'), unfinishedHoldMs: 1240 });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf('m1'), '', null);
      await say(t);                                      // stops m1
      await say(t);                                      // "and the ones from," is held
      t.frame(doneOf('m1', 'x', 'stopped'), null, null);
      assert.equal(t.sends.length, 1, 'still held');
      await wait(70);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from,', { autoSend: true, supersede: true }]]);
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Here they are. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Here they are.']);
      t.frame(doneOf('m2'), null, null);
      assert.equal(t.sends.length, 2);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'P4: an unbound stopped turn ends with no ask-start during a hold: a later ask-start is not claimed as it, one merged send', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from,'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      await say(t);                                      // stops the turn before its ask-start
      assert.equal(t.bargeIns(), 1);
      await say(t);                                      // held
      assert.equal(t.v.state(), 'listening');
      t.frame(doneOf('m1', 'x', 'stopped'), null, null);
      assert.equal(t.sends.length, 1);
      t.frame(eventStart('m9'), '', null);
      assert.equal(t.v.state(), 'thinking', 'm9 is an ordinary turn, not the stopped one');
      await wait(70);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from,', { autoSend: true, supersede: true }]]);
    } },
    { name: 'P5: words from a segment that started before the merge stopped the turn reach exactly one merged send', run: async () => {
      const a = deferred();
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', a.p, 'and the ones from,'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      t.frame(startOf('m1'), '', null);
      t.vad.opts.onSpeechRealStart();
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks(2);   // A is being transcribed
      t.vad.opts.onSpeechRealStart();                                  // B starts before anything stopped the turn
      a.resolve('that failed.'); await ticks();                        // A is carried behind B
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();   // B is unfinished: held
      assert.equal(t.bargeIns(), 0);
      await wait(70);
      assert.equal(t.bargeIns(), 1, 'the hold ran out: the merge stops the turn');
      t.frame(doneOf('m1', 'x', 'stopped'), null, null);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from,',{ autoSend: true, supersede: true }]]);
      await wait(70);
      assert.equal(t.sends.length, 2);
    } },
    { name: 'P6: a foreign turn after the send is bound: not played, the chip stays thinking through its ask-done, then the reply', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      bindM2(t);
      t.frame(eventStart('m9'), '', null);
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event news. ');
      t.frame(frame('ask-delta', { messageId: 'm9' }), 'Event news. ', null);
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'thinking');
      t.frame(doneOf('m9', 'Event news.'), null, null);
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'thinking');
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
    } },
    { name: 'P6b: a foreign turn while a bound pending waits: not played, the chip stays thinking, the merge goes out at the stopped turn\'s end', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf('m2'), '', null);
      await say(t);                                      // the merge stops m2
      assert.equal(t.bargeIns(), 1);
      bindM2(t);
      t.frame(eventStart('m9'), '', null);
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event news. ');
      t.frame(doneOf('m9', 'Event news.'), null, null);
      await ticks();
      assert.deepEqual(t.audio.played, []);
      assert.equal(t.v.state(), 'thinking');
      assert.equal(t.sends.length, 1);
      t.frame(doneOf('m2', 'x', 'stopped'), null, null);
      assert.deepEqual(t.sends.slice(1), [MERGED]);
    } },
    { name: 'P7: a foreign turn adopted by order, the 202 after: its playback stops, the chip thinks, the real reply is played', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event one. Event two. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Event one.']);
      bindM2(t);
      await ticks();
      assert.equal(t.v.state(), 'thinking');
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event one. Event two. Event three. ');
      t.frame(doneOf('m9', 'Event.'), null, null);
      await ticks();
      assert.deepEqual(t.audio.played, ['Event one.']);
      assert.equal(t.v.state(), 'thinking');
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Event one.', 'Two runs.']);
    } },
    { name: 'P7b: the real turn started before the late 202: nothing awaits, the state follows its playback (no thinking over a held user)', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.', '') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);              // adopted by order
      t.frame(startOf('m2'), '', null);
      t.vad.opts.onSpeechRealStart();                    // a sound: held, listening
      const n = t.states.length;
      bindM2(t);
      assert.deepEqual(t.states.slice(n), []);
      t.frame(spokenOf('m2'), '', 'Two runs. ');
      t.vad.opts.onSpeechEnd(new Float32Array(1600)); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      assert.equal(t.v.state(), 'speaking');
      t.frame(doneOf('m2'), null, null);
      t.audio.current.end(); await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'P8: noteSent with an unknown sendId, a missing id, or after stop(): ignored, no throw, no state change', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      const n = t.states.length;
      for (const arg of [undefined, null, {}, { sendId: 'v999', userMessageId: 'u-m2', assistantMessageId: 'm2' },
        { sendId: t.sendIds[0], userMessageId: 'u-m2' }, { sendId: t.sendIds[0], userMessageId: 7, assistantMessageId: 'm2' }]) t.v.noteSent(arg);
      assert.equal(t.states.length, n);
      t.frame(startOf('m1'), '', null);                  // still unbound: adopted by order
      t.frame(spokenOf('m1'), '', 'Two runs. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      await t.v.stop();
      const k = t.states.length;
      t.v.noteSent({ sendId: t.sendIds[0], userMessageId: 'u-m2', assistantMessageId: 'm2' });
      assert.equal(t.states.length, k);
      assert.equal(t.v.state(), 'off');
    } },
    { name: 'P9: a 202 that lands after its turn ended: listening, nothing awaits', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf('m2'), '', null);
      t.frame(doneOf('m2', 'Done.', 'done'), null, null);
      await ticks();
      if (t.audio.current) { t.audio.current.end(); await ticks(); }
      bindM2(t);
      await ticks();
      assert.equal(t.v.state(), 'listening');
    } },
    { name: 'P9b: a 202 for a turn whose ask-done came with no ask-start: the send counts as ended (no merge 20 s later)', run: async () => {
      const t = setupBrowser({ transcribe: texts('Show me the runs.', 'and the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(doneOf('m2', 'Done.', 'done'), null, null);
      bindM2(t);
      await ticks();
      assert.equal(t.v.state(), 'listening');
      t.clock.t = MERGE_GRACE_MS + 10_000;
      await say(t);
      assert.equal(t.bargeIns(), 0);
      assert.deepEqual(t.sends.slice(1), [['and the failed ones.', { autoSend: true }]]);
      assert.notEqual(t.sendIds[0], t.sendIds[1], 'every send has its own sendId');
    } },
    { name: 'P10: an event turn after the bound reply ended is spoken', run: async () => {
      const t = setupBrowser({ tts: true, bind: 'before', transcribe: texts('Show me the runs.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Two runs. ');
      t.frame(doneOf('m2'), null, null);
      await ticks();
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      t.frame(eventStart('m9'), '', null);
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event news. ');
      await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.', 'Event news.']);
    } },
    { name: 'P11: the 202 corrects a send that adopted an ended event turn: a continuation stops the real turn and merges at its end', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);              // adopted by order, spoken, ended
      t.frame(frame('ask-spoken', { messageId: 'm9' }), '', 'Event news. ');
      t.frame(doneOf('m9', 'Event news.'), null, null);
      await ticks();
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Event news.']);
      bindM2(t);                                         // the 202: the send's turn is m2, still running
      assert.equal(t.v.state(), 'thinking');
      await say(t);
      assert.equal(t.bargeIns(), 1, 'm2 is stopped');
      assert.equal(t.sends.length, 1, 'nothing goes out while m2 runs');
      t.frame(startOf('m2'), '', null);
      t.frame(spokenOf('m2'), '', 'Old answer. ');
      t.frame(doneOf('m2', 'Old answer.', 'stopped'), null, null);
      await ticks();
      assert.deepEqual(t.sends.slice(1), [MERGED]);
      assert.deepEqual(t.audio.played, ['Event news.'], 'the answer to the half question is never spoken');
    } },
    { name: 'P11b: the 202 drops the "changed something" flag of the event turn adopted by order: the continuation still merges', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);
      t.frame(writeTool('m9'), '', null);                // the event turn wrote something: m9 is unsafe, m2 is not
      t.frame(doneOf('m9', 'Saved.'), null, null);
      await ticks();
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Saved.']);
      bindM2(t);
      await say(t);
      assert.equal(t.bargeIns(), 1, 'm2 is stopped');
      t.frame(doneOf('m2', 'Old answer.', 'stopped'), null, null);
      await ticks();
      assert.deepEqual(t.sends.slice(1), [MERGED]);
    } },
    { name: 'P11c: the 202 names a turn whose reply was already heard: the continuation stops it and goes out plain at its end', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);              // adopted by order, ended unspoken
      t.frame(doneOf('m9', ''), null, null);
      t.frame(startOf('m2'), '', null);                  // the send's own turn starts before the 202
      t.frame(spokenOf('m2'), '', 'Two runs. ');
      await ticks();
      t.audio.current.end(); await ticks();
      assert.deepEqual(t.audio.played, ['Two runs.']);
      bindM2(t);                                         // the correction keeps "the reply was heard"
      await say(t);
      assert.equal(t.bargeIns(), 1, 'm2 is stopped');
      t.frame(doneOf('m2', 'Two runs.', 'stopped'), null, null);
      await ticks();
      assert.deepEqual(t.sends.slice(1), [['the failed ones.', { autoSend: true }]], 'not merged into a reply already heard');
    } },
    { name: 'P12: a waiting merge claimed an event turn by order that ended during a hold; the 202 names a running turn: nothing goes out until it ends', run: async () => {
      const t = setupBrowser({ sttEngine: 'server', transcribe: texts('Show me the runs.', 'that failed.', 'and the ones from,'), unfinishedHoldMs: 1240 });
      await t.v.start('talk');
      await say(t, { realStart: false });
      await say(t);                                      // stops the turn before its ask-start
      assert.equal(t.bargeIns(), 1);
      await say(t);                                      // held
      t.frame(eventStart('m9'), '', null);              // claimed by order as the stopped turn
      t.frame(doneOf('m9', 'x'), null, null);
      bindM2(t);                                         // the stopped turn is really m2, still running
      await wait(70);
      assert.equal(t.sends.length, 1, 'the held flush waits for m2');
      t.frame(doneOf('m2', 'x', 'stopped'), null, null);
      assert.deepEqual(t.sends.slice(1), [['Show me the runs that failed and the ones from,', { autoSend: true, supersede: true }]]);
    } },
    { name: 'P11d: the real turn wrote something before the 202 corrected an adopted event turn: the continuation goes out plain', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      t.frame(eventStart('m9'), '', null);              // adopted by order, ended unspoken
      t.frame(doneOf('m9', ''), null, null);
      t.frame(startOf('m2'), '', null);                  // the send's own turn starts before the 202
      t.frame(writeTool('m2'), '', null);                // and changes something while the send still names m9
      bindM2(t);
      await say(t);
      assert.equal(t.bargeIns(), 1, 'm2 is stopped');
      t.frame(doneOf('m2', 'Saved.', 'stopped'), null, null);
      await ticks();
      assert.deepEqual(t.sends.slice(1), [['the failed ones.', { autoSend: true }]], 'a turn that wrote something is never asked again');
    } },
    { name: 'P12b: a waiting merge claimed an event turn by order; the stopped turn wrote something before the 202 named it: the plain text goes out', run: async () => {
      const t = setupBrowser({ tts: true, transcribe: texts('Show me the runs and', 'the failed ones.') });
      await t.v.start('handsfree');
      await say(t, { realStart: false });
      await say(t);                                      // the merge stops the turn before its ask-start
      assert.equal(t.bargeIns(), 1);
      t.frame(eventStart('m9'), '', null);              // claimed by order as the stopped turn
      t.frame(startOf('m2'), '', null);                  // the stopped turn is really m2
      t.frame(writeTool('m2'), '', null);
      bindM2(t);
      assert.equal(t.sends.length, 1, 'nothing goes out while m2 runs');
      t.frame(doneOf('m2', 'Saved.', 'stopped'), null, null);
      await ticks();
      assert.deepEqual(t.sends.slice(1), [['the failed ones.', { autoSend: true }]]);
    } },
  ]);
});

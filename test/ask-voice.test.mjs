// test/ask-voice.test.mjs
// The voice controller (docs/speech.md) with a fake VAD, fake fetch and fake
// audio: support gating, dictation, the hands-free loop, sentence-level TTS as
// frames stream, gating while thinking, barge-in, text-only fallback, stop,
// the hands-free acknowledgement, and the Web Audio player that Safari needs for
// replies spoken after the click.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { createVoiceController, webAudioPlayer } from '../ui/public/ask-voice.mjs';

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

function setup({ tts = true, fetchOverride, ackPhrases = [], ackAfterMs = 60_000, random } = {}) {
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
  const v = createVoiceController({
    win, fetch, loadVad: async () => vad.lib, playAudio: audio.play, ackPhrases, ackAfterMs, random,
    onState: (s, info) => states.push([s, info.mode]),
    onTranscript: (t, o) => transcripts.push([t, o.autoSend]),
    onBargeIn: () => { bargeIns += 1; },
    onNotice: (m) => notices.push(m),
  });
  return { v, vad, audio, states, transcripts, notices, calls, synthesized, bargeIns: () => bargeIns };
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
    win: { ...win, Blob }, fetch, loadVad: async () => vad.lib, browserSpeech, ackPhrases: [],
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

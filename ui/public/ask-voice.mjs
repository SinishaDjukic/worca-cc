// ui/public/ask-voice.mjs
// Ask Worca voice mode (docs/speech.md): the browser half. A state machine over
// an injected VAD (Silero via @ricky0123/vad-web, loaded lazily from /vendor),
// two speech engines picked by Providers › Speech — 'browser' (Whisper /
// Kokoro in a worker, speech-browser.mjs; the default) or 'server' (the user's own
// OpenAI-compatible servers through /api/speech/*) — and an injected audio player.
// States: off → loading → listening ⇄ transcribing → thinking ⇄ speaking; error.
// Hands-free says a short acknowledgement ("Okay, let me look into that.") when the
// answer will be slow — research, or a long think — so the wait is not dead air.
// Never the Web Speech API: Chrome sends that audio to Google.
import { encodeWav, cleanTranscript, createSpeechChunker } from '../../src/shared/speech.mjs';
import { createBrowserSpeech } from './speech-browser.mjs';

export const VAD_ASSETS = Object.freeze({
  vad: '/vendor/vad/bundle.min.js',
  base: '/vendor/vad/',
  wasm: '/vendor/ort/',
});
const LISTEN_THRESHOLDS = Object.freeze({ positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 });
const BARGE_IN_THRESHOLDS = Object.freeze({ positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.6 });
const PREFETCH = 2;
const DEFAULT_PAUSE_S = 1.2;            // Settings › Speech › Pause before sending
// Modes: 'dictate' (one utterance into the composer, not sent), and two conversations
// (listen → send → wait for the reply → listen again): 'handsfree' speaks the reply,
// 'talk' leaves it as text (voice in, text out — for people who would rather not type).
const CONVERSATIONS = new Set(['handsfree', 'talk']);
// The in-browser models hold several hundred MB of memory: kept warm between voice
// sessions, released after this long with voice off (the next start reloads from disk).
const IDLE_RELEASE_MS = 30 * 60_000;
// Said when a hands-free answer is slow. Every word is in misaki's dictionary.
export const ACK_PHRASES = Object.freeze([
  'Okay, let me look into that.',
  'Hmm, let me think.',
  'Sure, one moment.',
  'Got it, let me check.',
  'Alright, give me a second.',
  'On it.',
]);
// Short Ask answers with no tools finish in about 2.5–4.5 s end to end, so their first
// sentence is spoken well inside this; silence this long after sending means a long think.
const ACK_AFTER_MS = 4000;

/** Can this page capture audio at all? { ok } or { ok:false, reason } for the composer. */
export function voiceSupport(win) {
  if (!win || !win.isSecureContext) return { ok: false, reason: 'Voice needs a secure page — open worca over https or http://localhost, not a LAN IP over plain http.' };
  if (!win.navigator || !win.navigator.mediaDevices || typeof win.navigator.mediaDevices.getUserMedia !== 'function') return { ok: false, reason: 'This browser gives the page no microphone access.' };
  if (!win.AudioContext && !win.webkitAudioContext) return { ok: false, reason: 'This browser has no Web Audio support.' };
  return { ok: true };
}

/**
 * Inject the vad-web UMD bundle once; resolves to window.vad. The bundle carries
 * its own onnxruntime-web 1.22.0 JS (MicVAD never reads a global `ort`); only the
 * matching .mjs/.wasm runtime is fetched, from VAD_ASSETS.wasm.
 */
export function loadVadLibrary(win, doc) {
  if (win.vad && win.vad.MicVAD) return Promise.resolve(win.vad);
  const add = (src) => new Promise((resolve, reject) => {
    const prior = doc.querySelector(`script[data-voice-src="${src}"]`);
    if (prior && prior.dataset.loaded === '1') { resolve(); return; }
    const s = prior || doc.createElement('script');
    s.addEventListener('load', () => { s.dataset.loaded = '1'; resolve(); }, { once: true });
    s.addEventListener('error', () => reject(new Error(`voice activity detection unavailable (${src} did not load)`)), { once: true });
    if (!prior) { s.src = src; s.async = false; s.dataset.voiceSrc = src; doc.head.appendChild(s); }
  });
  return add(VAD_ASSETS.vad).then(() => {
    if (!win.vad || !win.vad.MicVAD) throw new Error('voice activity detection unavailable');
    return win.vad;
  });
}

/**
 * Default player: Web Audio on one AudioContext. Safari lets a page play sound only
 * from a user gesture, and a reply is spoken seconds after the click, so a fresh
 * `new Audio().play()` is refused then (NotAllowedError). A context resumed inside
 * the click stays allowed: the controller calls unlock() synchronously from start().
 * play(blob) → { ended: Promise<'ended'|'stopped'|'error'>, stop(), error } (error: why it failed).
 */
export function webAudioPlayer(win, { resumeTimeoutMs = 1000 } = {}) {
  let ctx = null;
  const context = () => (ctx ||= new (win.AudioContext || win.webkitAudioContext)());
  const play = (blob) => {
    let settle;
    let src = null;
    let finished = false;
    const ended = new Promise((r) => { settle = r; });
    const h = { ended, error: null, stop: () => done('stopped') };
    function done(why) {
      if (finished) return;
      finished = true;
      if (src) {
        src.onended = null;
        if (why !== 'ended') try { src.stop(); } catch { /* not started */ }
        try { src.disconnect(); } catch { /* ignore */ }
      }
      settle(why);
    }
    (async () => {
      const c = context();
      const buffer = await c.decodeAudioData(await blob.arrayBuffer());
      if (finished) return;
      if (c.state !== 'running') {
        // Never unlocked by a gesture (or suspended by the system): resume() would wait for
        // the next click, and the chip would sit on 'Speaking…' with nothing playing.
        await Promise.race([c.resume(), new Promise((r) => win.setTimeout(r, resumeTimeoutMs))]);
        if (c.state !== 'running') throw new Error('the browser blocked audio playback');
        if (finished) return;
      }
      src = c.createBufferSource();
      src.buffer = buffer;
      src.connect(c.destination);
      src.onended = () => done('ended');
      src.start();
    })().catch((err) => { h.error = err; done('error'); });
    return h;
  };
  play.unlock = () => { const c = context(); if (c.state !== 'running') c.resume().catch(() => {}); };
  play.close = () => { if (ctx) { const c = ctx; ctx = null; try { Promise.resolve(c.close()).catch(() => {}); } catch { /* already gone */ } } };
  return play;
}

/**
 * The chip while a browser engine loads. The first use downloads the model: 'Downloading
 * speech model… 42 MB' (bytes, not a percent — the model is several files whose sizes are
 * only known as each starts, so a percent would jump backwards). Later it only loads
 * from worca's disk into memory, which takes seconds: 'Starting voice…'.
 */
function loadingDetail(loaded, downloading) {
  if (!downloading) return 'Starting voice…';
  return loaded >= 1e6 ? `Downloading speech model… ${Math.round(loaded / 1e6)} MB` : 'Downloading speech model…';
}

async function errorOf(res, fallback) {
  try { const b = await res.json(); if (b && b.error) return b.error; } catch { /* keep fallback */ }
  return `${fallback} (${res.status})`;
}

function micError(err) {
  const name = err && err.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied — allow it in the browser to use voice.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  return err && err.message ? err.message : String(err);
}

/**
 * createVoiceController({ win, fetch, loadVad, playAudio, browserSpeech, onState, onTranscript, onBargeIn, onNotice, ackPhrases })
 *  - browserSpeech(kind)                the in-browser engine for 'stt' / 'tts' (default: speech-browser.mjs)
 *  - ackPhrases, ackAfterMs             what hands-free says when the answer is slow ([] = nothing), and
 *                                       how long a silence counts as slow
 *  - onState(state, { mode, detail })   paint the mic / status chip
 *  - onTranscript(text, { autoSend })   put text in the composer (and send when autoSend)
 *  - onBargeIn()                        the user spoke over the reply: stop the in-flight turn
 *  - onNotice(message)                  a non-fatal message for the composer line
 * The panel feeds onFrame(frame, liveText) for every applied job frame of the current thread.
 */
export function createVoiceController({ win, doc, fetch, loadVad, playAudio, browserSpeech, onState, onTranscript, onBargeIn, onNotice, idleReleaseMs = IDLE_RELEASE_MS, ackPhrases = ACK_PHRASES, ackAfterMs = ACK_AFTER_MS, random = Math.random }) {
  const load = loadVad || (() => loadVadLibrary(win, doc));
  const play = playAudio || webAudioPlayer(win);
  const makeBrowser = browserSpeech || ((kind) => createBrowserSpeech(win, kind));
  const browser = {};                               // kind → engine, kept warm across sessions
  const browserEngine = (kind) => (browser[kind] ||= makeBrowser(kind));
  const ackAudio = new Map();                       // voice config + phrase → Promise<Blob>, so an ack plays at once
  let idleTimer = null;
  function releaseEngines() {
    win.clearTimeout(idleTimer);
    idleTimer = null;
    ackAudio.clear();
    for (const e of Object.values(browser)) { try { e.release(); } catch { /* already gone */ } }
    if (play.close) play.close();                   // the next hands-free click makes a fresh one
  }
  function releaseWhenIdle() {
    win.clearTimeout(idleTimer);
    idleTimer = win.setTimeout(releaseEngines, idleReleaseMs);
  }
  const s = {
    mode: null, state: 'off', vad: null, gen: 0, ttsEnabled: false, cfg: null,
    sttCtrl: null, turnId: null, chunker: null, turnEnded: false, awaitingTurn: false,
    doneIds: new Set(), queue: [], playing: null, ttsCtrl: null,
    nextAck: null, ackArmed: false, ackTimer: null, toolIds: new Set(),
  };

  function set(state, detail) {
    s.state = state;
    try { onState(state, { mode: s.mode, detail: detail || null }); } catch { /* the panel repaints itself */ }
    if (state === 'listening') prepareAck();       // the voice is idle while the user talks
  }

  async function openVad() {
    const lib = await load();
    return lib.MicVAD.new({
      model: 'v5',
      baseAssetPath: VAD_ASSETS.base,
      onnxWASMBasePath: VAD_ASSETS.wasm,
      startOnLoad: false,
      ...LISTEN_THRESHOLDS,
      // Silence that ends an utterance: longer suits slow or thoughtful speakers.
      redemptionMs: Math.round(1000 * (Number(s.cfg && s.cfg.stt && s.cfg.stt.pause) || DEFAULT_PAUSE_S)),
      minSpeechMs: 250,
      preSpeechPadMs: 300,
      ortConfig: (ort) => { ort.env.logLevel = 'error'; ort.env.wasm.numThreads = 1; },
      onSpeechRealStart: () => onSpeechStart(),
      onSpeechEnd: (audio) => { onUtterance(audio); },
      onVADMisfire: () => {},
    });
  }

  async function start(mode) {
    const sup = voiceSupport(win);
    if (!sup.ok) { fail(sup.reason); return; }
    // Before the first await, while the click's gesture is live: Safari plays the
    // replies (seconds later) only through audio output unlocked by that gesture.
    if (mode === 'handsfree' && play.unlock) { try { play.unlock(); } catch { /* replies fall back to text */ } }
    if (s.mode) await stop();
    win.clearTimeout(idleTimer);
    const gen = ++s.gen;
    s.mode = mode;
    set('loading');
    try {
      const r = await fetch('/api/speech');
      if (!r || !r.ok) throw new Error('could not read the voice settings');
      const cfg = await r.json();
      if (gen !== s.gen) return;
      s.cfg = cfg;
      const tts = cfg.tts || {};
      s.ttsEnabled = mode === 'handsfree' && (tts.engine === 'browser' || (tts.engine !== 'off' && !!tts.configured && !tts.keyMissing));
      if (s.ttsEnabled && tts.engine === 'browser') {
        // Warm the voice while the mic starts. A failed load resurfaces on the first
        // sentence (speak() loads again), where ttsFailed turns replies text-only.
        browserEngine('tts').load().catch(() => {});
      }
      if (cfg.stt && cfg.stt.engine === 'browser') {
        const downloading = !(cfg.downloaded && cfg.downloaded.stt);
        await browserEngine('stt').load((loaded) => { if (gen === s.gen) set('loading', loadingDetail(loaded, downloading)); });
        if (gen !== s.gen) return;
      }
      const vad = await openVad();
      if (gen !== s.gen) { releaseVad(vad); return; }
      s.vad = vad;
      await vad.start();                  // rejects with the getUserMedia error (NotAllowedError, …)
      if (gen !== s.gen) return;
      set('listening');
    } catch (err) {
      if (gen === s.gen) fail(micError(err));
    }
  }

  function onSpeechStart() {
    if (s.mode === 'handsfree' && s.state === 'speaking') {
      stopPlayback();
      if (s.turnId) s.doneIds.add(s.turnId);   // the stopped turn's tail (and any replay of it) is not spoken
      s.turnId = null;
      try { onBargeIn(); } catch { /* best effort */ }
      set('listening');
    }
  }

  async function onUtterance(audio) {
    if (s.state !== 'listening' || !s.mode) return;
    const gen = s.gen;
    set('transcribing');
    s.sttCtrl = new AbortController();
    let text = '';
    try {
      const stt = (s.cfg && s.cfg.stt) || {};
      if (stt.engine === 'browser') {
        text = cleanTranscript(await browserEngine('stt').transcribe(audio, stt.language, s.sttCtrl.signal));
      } else {
        const r = await fetch('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(audio, 16000), signal: s.sttCtrl.signal });
        if (gen !== s.gen) return;
        if (!r.ok) { fail(await errorOf(r, 'transcription failed')); return; }
        text = cleanTranscript((await r.json()).text);
      }
    } catch (err) {
      if (gen === s.gen) fail(`transcription failed — ${err && err.message ? err.message : err}`);
      return;
    }
    if (gen !== s.gen) return;
    if (!text) { set('listening'); return; }
    if (s.mode === 'dictate') {
      onTranscript(text, { autoSend: false });
      await stop();
      return;
    }
    s.awaitingTurn = true;              // stay 'thinking' until the sent turn's ask-start
    set('thinking');
    armAck();
    onTranscript(text, { autoSend: true });
  }

  // ── acknowledgement: "I heard you" before a slow reply ──
  // Armed when an utterance is sent; said on research (a tool starts before anything
  // was said) or after ackAfterMs of silence; dropped once the reply has something to say.
  function pickAck(except) {
    const pool = ackPhrases.length > 1 ? ackPhrases.filter((p) => p !== except) : ackPhrases;
    return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
  }

  function ackBlob(text) {
    const key = `${JSON.stringify((s.cfg && s.cfg.tts) || {})}\n${text}`;
    let p = ackAudio.get(key);
    if (!p) {
      // No abort signal: a barge-in or stop leaves the phrase rendering, cached for next time.
      p = render(text).catch((err) => { ackAudio.delete(key); throw err; });
      p.catch(() => {});
      ackAudio.set(key, p);
    }
    return p;
  }

  /** Render the next acknowledgement while the user is still speaking. */
  function prepareAck() {
    if (s.mode !== 'handsfree' || !s.ttsEnabled || !ackPhrases.length) return;
    if (!s.nextAck) s.nextAck = pickAck();
    ackBlob(s.nextAck);
  }

  function armAck() {
    disarmAck();
    if (s.mode !== 'handsfree' || !s.ttsEnabled || !ackPhrases.length) return;
    const gen = s.gen;
    s.ackArmed = true;
    s.ackTimer = win.setTimeout(() => { s.ackTimer = null; if (gen === s.gen) acknowledge(); }, ackAfterMs);
  }

  function disarmAck() {
    s.ackArmed = false;
    if (s.ackTimer) { win.clearTimeout(s.ackTimer); s.ackTimer = null; }
  }

  // Played in 'thinking', not 'speaking': like the rest of the wait for the reply it
  // cannot be barged in on, so it never stops the turn it acknowledges.
  function acknowledge() {
    if (!s.ackArmed || !s.ttsEnabled) return;
    disarmAck();
    const text = s.nextAck || pickAck();
    s.nextAck = pickAck(text);                      // never the same twice running; rendered on the next 'listening'
    if (!s.ttsCtrl) s.ttsCtrl = new AbortController();
    s.queue.push({ text, audio: ackBlob(text), ack: true });
    pump();
  }

  // ── reply → speech ──
  function onFrame(frame, liveText) {
    if (!CONVERSATIONS.has(s.mode) || !frame) return;
    if (frame.type === 'ask-start') {
      if (s.doneIds.has(frame.messageId)) return;          // replay of a finished / barged-in turn
      s.awaitingTurn = false;
      if (frame.messageId !== s.turnId) {                   // a replayed ask-start of the SAME turn keeps
        s.turnId = frame.messageId;                         // its chunker: the chunker waits out the rewind
        s.chunker = createSpeechChunker();                  // and never re-speaks
        s.toolIds.clear();
      }
      s.turnEnded = false;
      if (s.state === 'listening') set('thinking');
      return;
    }
    const mine = s.turnId && frame.messageId === s.turnId;
    if (frame.type === 'ask-delta' && mine && s.ttsEnabled) {
      for (const t of s.chunker.push(liveText || '')) enqueue(t);
    } else if (frame.type === 'ask-block' && mine && s.ttsEnabled && isNewTool(frame.block)) {
      // The text before a tool call is a finished block ("I'll check the runs."): say it
      // now, not after the tool. If there was none, research is ahead: acknowledge.
      if (liveText != null) for (const t of s.chunker.push(liveText, true)) enqueue(t);
      acknowledge();
    } else if (frame.type === 'ask-done' || frame.type === 'ask-error') {
      if (mine && s.ttsEnabled && frame.type === 'ask-done' && frame.status !== 'stopped') {
        for (const t of s.chunker.push(frame.text ?? liveText ?? '', true)) enqueue(t);
      }
      if (!s.doneIds.has(frame.messageId)) { s.awaitingTurn = false; disarmAck(); }   // the sent turn ended (even with no ask-start)
      if (mine) s.doneIds.add(s.turnId);
      if (mine || !s.turnId) { s.turnEnded = true; s.turnId = null; }
      maybeListen();
    }
  }

  function isNewTool(block) {
    if (!block || (block.kind !== 'tool' && block.kind !== 'agent') || s.toolIds.has(block.id)) return false;
    s.toolIds.add(block.id);                              // later frames of the block are status / log updates
    return true;
  }

  function enqueue(text) {
    disarmAck();                                          // the reply speaks for itself
    if (!s.ttsCtrl) s.ttsCtrl = new AbortController();
    s.queue.push({ text, audio: null });
    pump();
  }

  function synth(item) {
    item.audio = render(item.text, s.ttsCtrl.signal);
    item.audio.catch(() => {});        // observed in pump; never an unhandled rejection
  }

  /** text → Promise<Blob> of speech, from the configured engine (async: never throws synchronously). */
  async function render(text, signal) {
    const tts = (s.cfg && s.cfg.tts) || {};
    if (tts.engine === 'browser') {
      return browserEngine('tts').speak(text, { voice: tts.voice, speed: tts.speed }, signal)
        .then(({ audio, rate }) => new win.Blob([encodeWav(audio, rate)], { type: 'audio/wav' }));
    }
    return fetch('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal })
      .then(async (r) => { if (!r.ok) throw new Error(await errorOf(r, 'speech failed')); return r.blob(); });
  }

  async function pump() {
    for (const it of s.queue.slice(0, PREFETCH)) if (!it.audio) synth(it);
    if (s.playing || !s.queue.length) return;
    const item = s.queue[0];
    const gen = s.gen;
    s.playing = item;
    let blob;
    try { blob = await item.audio; } catch (err) { return ttsFailed(err, gen); }
    if (gen !== s.gen || s.playing !== item) return;
    if (!item.ack && s.state !== 'speaking') { set('speaking'); s.vad && s.vad.setOptions(BARGE_IN_THRESHOLDS); }
    const h = play(blob);
    item.stop = h.stop;
    const why = await h.ended;
    if (gen !== s.gen || s.playing !== item) return;
    s.playing = null;
    s.queue.shift();
    if (why === 'error') return ttsFailed(h.error || new Error('the browser could not play the audio'), gen);
    if (s.queue.length) pump(); else maybeListen();
  }

  function ttsFailed(err, gen) {
    if (gen !== s.gen) return;
    stopPlayback();
    s.ttsEnabled = false;
    try { onNotice(`Voice replies are text only for now — ${err && err.message ? err.message : err}`); } catch { /* ignore */ }
    maybeListen();
  }

  function stopPlayback() {
    if (s.ttsCtrl) { s.ttsCtrl.abort(); s.ttsCtrl = null; }
    const p = s.playing;
    s.playing = null;
    s.queue = [];
    if (p && p.stop) p.stop();
    if (s.vad && s.state === 'speaking') s.vad.setOptions(LISTEN_THRESHOLDS);
  }

  function maybeListen() {
    if (!CONVERSATIONS.has(s.mode) || s.playing || s.queue.length) return;
    if (s.state === 'speaking' && s.vad) s.vad.setOptions(LISTEN_THRESHOLDS);
    if (s.awaitingTurn) { if (s.state === 'speaking') set('thinking'); return; }
    if (s.turnEnded || !s.turnId) set('listening');
    else if (s.state === 'speaking') set('thinking');
  }

  function fail(message) {
    s.gen += 1;
    teardown();
    releaseWhenIdle();
    s.mode = null;
    set('error', message);
  }

  function teardown() {
    if (s.sttCtrl) { s.sttCtrl.abort(); s.sttCtrl = null; }
    stopPlayback();
    s.turnId = null; s.chunker = null; s.turnEnded = false; s.awaitingTurn = false; s.nextAck = null;
    disarmAck();
    // vad-web's pause() already stops the mic tracks, but an errored or paused
    // MicVAD cannot be reliably restarted: every session gets a fresh instance.
    if (s.vad) { const v = s.vad; s.vad = null; releaseVad(v); }
  }

  function releaseVad(v) {
    try { Promise.resolve(v.destroy()).catch(() => {}); } catch { /* never started: nothing to release */ }
  }

  async function stop() {
    if (!s.mode && s.state === 'off') return;
    s.gen += 1;
    teardown();
    releaseWhenIdle();
    s.mode = null;
    set('off');
  }

  /**
   * Warm the built-in engines in the background (the panel calls this on open once voice
   * has been used), so the mic is ready when clicked. Only models already on disk: never
   * a silent first download. Released again after the idle delay if the mic stays unused.
   */
  async function preload() {
    if (s.mode) return;
    let cfg;
    try {
      const r = await fetch('/api/speech');
      if (!r || !r.ok) return;
      cfg = await r.json();
    } catch { return; }
    if (s.mode) return;
    const kinds = ['stt', 'tts'].filter((k) => cfg[k] && cfg[k].engine === 'browser' && cfg.downloaded && cfg.downloaded[k]);
    if (!kinds.length) return;
    releaseWhenIdle();
    await Promise.all(kinds.map((k) => browserEngine(k).load().catch(() => {})));
  }

  async function destroy() {
    await stop();
    releaseEngines();
  }

  return {
    start, stop, destroy, onFrame, preload,
    fail: (m) => { if (s.mode) fail(m); },
    active: () => !!s.mode,
    mode: () => s.mode,
    state: () => s.state,
  };
}

// ui/public/ask-voice.mjs
// Ask Worca voice mode (docs/speech.md): the browser half. A state machine over
// an injected VAD (Silero via @ricky0123/vad-web, loaded lazily from /vendor),
// two speech engines picked by Providers › Speech — 'browser' (Whisper /
// Kokoro in a worker, speech-browser.mjs; the default) or 'server' (the user's own
// OpenAI-compatible servers through /api/speech/*) — and an injected audio player.
// States: off → loading → listening ⇄ transcribing → thinking ⇄ speaking; error.
// Turn-taking (conversations): a short pause sends a finished sentence, unfinished words wait
// longer (browser Whisper transcribes early to tell them apart), an unfinished final transcript
// ("Do you know how...") is held for a fixed ~5 s on every speech-to-text path, and speech that
// continues a message just sent stops that turn and sends one joined message that replaces it.
// Hands-free says a short acknowledgement ("Okay, let me look into that.") when the
// answer will be slow — research, or a long think — so the wait is not dead air.
// Never the Web Speech API: Chrome sends that audio to Google.
import { encodeWav, cleanTranscript, createSpeechChunker, createSpokenFallback, pauseProfile, sentenceUnfinished, fillerOnly, joinTranscripts, UNFINISHED_HOLD_MS } from '../../src/shared/speech.mjs';
import { READ_ONLY_ASK_TOOLS, mergeSafeBlock } from '../../src/shared/ask-merge-safe.mjs';
import { createBrowserSpeech } from './speech-browser.mjs';

export const VAD_ASSETS = Object.freeze({
  vad: '/vendor/vad/bundle.min.js',
  base: '/vendor/vad/',
  wasm: '/vendor/ort/',
});
const LISTEN_THRESHOLDS = Object.freeze({ positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 });
const BARGE_IN_THRESHOLDS = Object.freeze({ positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.6 });
const PREFETCH = 2;
// Silero v5 frames: 512 samples at 16 kHz (32 ms). The pad kept before a segment opens
// matches the VAD's preSpeechPadMs (300 ms); a draft needs this much speech first.
const PRE_FRAMES = 10;
const DRAFT_MIN_SPEECH_FRAMES = 8;
// A continuation merges into the message just sent while its turn runs, or this long after
// the send once it ended (a quick reply, or Talk's text reply) — never after the reply spoke.
export const MERGE_GRACE_MS = 10_000;
// Which turns may be stopped and asked again lives in src/shared/ask-merge-safe.mjs: the server
// checks the same rule before it hides a replaced turn. Re-exported for existing imports.
export { READ_ONLY_ASK_TOOLS, mergeSafeBlock };
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
// The speech hold's backstop: a reply waits while the user keeps talking, but at most this long past the
// unfinished hold after the last sign of real speech (a new segment, a worded draft). A segment the VAD
// never ends (a blip every few seconds keeps it open) would otherwise hold every reply and acknowledgement.
export const HOLD_BACKSTOP_MARGIN_MS = 2000;

/** Can this page capture audio at all? { ok } or { ok:false, reason } for the composer. */
export function voiceSupport(win) {
  if (!win || !win.isSecureContext) return { ok: false, reason: 'Voice needs a secure page. Open worca over https or http://localhost, not a LAN IP over plain http.' };
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
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone permission was denied. Allow it in the browser to use voice.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.';
  return err && err.message ? err.message : String(err);
}

/**
 * createVoiceController({ win, fetch, loadVad, playAudio, browserSpeech, onState, onTranscript, onBargeIn, onNotice, ackPhrases })
 *  - browserSpeech(kind)                the in-browser engine for 'stt' / 'tts' (default: speech-browser.mjs)
 *  - ackPhrases, ackAfterMs             what hands-free says when the answer is slow ([] = nothing), and
 *                                       how long a silence counts as slow
 *  - onState(state, { mode, detail })   paint the mic / status chip
 *  - onTranscript(text, { autoSend, supersede }, { sendId })  put text in the composer (and send when autoSend);
 *                                       supersede: true only when the text is a merge that replaces the
 *                                       message just sent (the panel then asks the server to hide that turn);
 *                                       sendId (auto-sends only): hand it back to noteSent() with the server's ids
 *  - onBargeIn()                        the user spoke over the reply: stop the in-flight turn
 *  - onNotice(message)                  a non-fatal message for the composer line
 *  - now, mergeGraceMs                  the clock, and how long after a send its turn still merges
 *  - unfinishedHoldMs                   how long an unfinished final transcript waits for more words
 *                                       (at least the finished pause; tests pass a small value)
 *  - holdBackstopMs                     how long the speech hold lasts with no new sign of speech before the
 *                                       reply may play anyway (null: the hold + HOLD_BACKSTOP_MARGIN_MS)
 * The panel feeds onFrame(frame, liveText, liveSpoken) for every applied job frame of the current thread, and
 * noteSent({ sendId, userMessageId, assistantMessageId }) once the server took a voice send (its 202): from then on
 * that send's reply is its own turn by id, so another turn in the chat (an event, another tab) is never spoken as it.
 */
export function createVoiceController({ win, doc, fetch: request, loadVad, playAudio, browserSpeech, onState, onTranscript, onBargeIn, onNotice, idleReleaseMs = IDLE_RELEASE_MS, ackPhrases = ACK_PHRASES, ackAfterMs = ACK_AFTER_MS, random = Math.random, now = () => Date.now(), mergeGraceMs = MERGE_GRACE_MS, unfinishedHoldMs = UNFINISHED_HOLD_MS, holdBackstopMs = null }) {
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
    sttCtrl: null, turnId: null, fallback: null, turnEnded: false, awaitingTurn: false,
    spokenChunker: null, spokenSoFar: '', spokenMode: false,   // the turn's hands-free spoken version (ask-spoken)
    doneIds: new Set(), queue: [], playing: null, ttsCtrl: null,
    nextAck: null, ackArmed: false, ackTimer: null, toolIds: new Set(),
    // turn-taking (conversations): see the contracts beside each function below
    adaptive: false, pause: pauseProfile(), redemption: null, pos: LISTEN_THRESHOLDS.positiveSpeechThreshold,
    neg: LISTEN_THRESHOLDS.negativeSpeechThreshold, pre: [], seg: null, drafting: false, draftCtrl: null,
    slowDrafts: 0, chain: Promise.resolve(), busy: 0, carry: null, sent: null, pending: null, hold: false, ackHeld: false,
    heldTimer: null, speechEndAt: null, holdTimer: null,
    endedIds: new Set(),                // turns seen ending this session: a 202 landing after its turn ended still resolves it
    unsafeIds: new Set(),               // turns seen changing something: a 202 naming one keeps it unmergeable
    sendSeq: 0,                         // never reset: a late 202 from an earlier session matches nothing
  };
  const ENDED_IDS_MAX = 32;             // also bounds unsafeIds

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
      // Silence that ends an utterance. The adaptive path waits the long pause and ends early
      // (setOptions) once a draft sounds finished; Dictate and "Your server" wait a fixed pause.
      redemptionMs: (s.redemption = baseRedemption()),
      minSpeechMs: 250,
      preSpeechPadMs: 300,
      ortConfig: (ort) => { ort.env.logLevel = 'error'; ort.env.wasm.numThreads = 1; },
      onSpeechRealStart: () => onSpeechStart(),
      onSpeechEnd: (audio) => { onUtterance(audio); },
      onVADMisfire: () => onMisfire(),
      onFrameProcessed: (p, f) => onAudioFrame(p, f),
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
    s.ttsEnabled = false;                 // decided by /api/speech below: speaks() is false while loading
    set('loading');
    try {
      const r = await request('/api/speech');
      if (!r || !r.ok) throw new Error('could not read the voice settings');
      const cfg = await r.json();
      if (gen !== s.gen) return;
      s.cfg = cfg;
      s.pause = pauseProfile(cfg.stt && cfg.stt.pause);
      s.adaptive = CONVERSATIONS.has(mode) && !!cfg.stt && cfg.stt.engine === 'browser';
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

  // ── turn-taking ──
  /** The VAD's resting silence: the long pause on the adaptive path, else the fixed one. */
  function baseRedemption() {
    return s.adaptive ? s.pause.unfinishedMs : s.pause.fixedMs;
  }

  /** The silence an unfinished final transcript waits for (H1). */
  function heldMs() {
    return Math.max(s.pause.finishedMs, unfinishedHoldMs);
  }

  function setRedemption(ms) {
    if (s.redemption === ms) return;
    s.redemption = ms;
    if (s.vad) s.vad.setOptions({ redemptionMs: ms });
  }

  /** Thresholds go through here so the frame watcher counts speech the way the VAD does. */
  function setThresholds(t) {
    s.pos = t.positiveSpeechThreshold;
    s.neg = t.negativeSpeechThreshold;
    if (s.vad) s.vad.setOptions(t);
  }

  function newSeg(frames) {
    return { frames, speechFrames: 0, silentMs: 0, lastSpeechAt: -1, idx: frames.length - 1, realStart: false, resume: false, ignored: false, draft: null, ending: false };
  }

  /** May new speech still join the message just sent? (D7) */
  function mergeable(sent, at = now()) {
    return !sent.spoke && !sent.unsafe && (!sent.ended || at - sent.at <= mergeGraceMs);
  }

  /**
   * Every VAD frame (conversations only): our own view of the segment — its audio and its silence —
   * so the adaptive path can transcribe a draft at the short pause without reading the VAD's internals.
   */
  function onAudioFrame(probs, frame) {
    if (!CONVERSATIONS.has(s.mode) || s.state === 'off' || s.state === 'loading' || s.state === 'error' || !frame) return;
    const p = (probs && probs.isSpeech) || 0;
    const speech = p >= s.pos;
    let seg = s.seg;
    if (!seg) {
      if (!speech) {
        s.pre.push(frame);
        if (s.pre.length > PRE_FRAMES) s.pre.shift();
        return;
      }
      seg = s.seg = newSeg(s.pre);
      s.pre = [];
    }
    seg.frames.push(frame);
    seg.idx = seg.frames.length - 1;
    if (speech) {
      seg.speechFrames += 1;
      seg.silentMs = 0;
      seg.lastSpeechAt = seg.idx;
      if (seg.ending) { seg.ending = false; setRedemption(s.pause.unfinishedMs); }   // they went on: wait the long pause again
    } else if (p < s.neg) {
      seg.silentMs += frame.length / 16;
    }
    maybeDraft(seg);
  }

  function maybeDraft(seg) {
    if (!s.adaptive || seg.ignored || seg.speechFrames < DRAFT_MIN_SPEECH_FRAMES || seg.silentMs < s.pause.finishedMs) return;
    if (seg.draft && seg.draft.upTo >= seg.lastSpeechAt) return;
    if (s.drafting) return;                               // one at a time: the worker runs jobs serially anyway
    startDraft(seg);
  }

  function concatFrames(frames) {
    let n = 0;
    for (const f of frames) n += f.length;
    const out = new Float32Array(n);
    let o = 0;
    for (const f of frames) { out.set(f, o); o += f.length; }
    return out;
  }

  /** Transcribe the segment so far at the short pause: a finished sentence ends the utterance now. */
  function startDraft(seg) {
    const gen = s.gen;
    const stt = (s.cfg && s.cfg.stt) || {};
    if (!s.draftCtrl) s.draftCtrl = new AbortController();
    const draft = { upTo: seg.idx, text: null, failed: false, startedAt: now(), promise: null };
    seg.draft = draft;
    s.drafting = true;
    const audio = concatFrames(seg.frames);               // the snapshot: frames keep arriving while it runs
    const signal = s.draftCtrl.signal;
    draft.promise = Promise.resolve()
      .then(() => browserEngine('stt').transcribe(audio, stt.language, signal))
      .then((t) => { draft.text = cleanTranscript(t); return draft.text; }, () => { draft.failed = true; return null; });
    draft.promise.then(() => {
      if (gen !== s.gen) return;
      s.drafting = false;
      if (!draft.failed) {
        // An engine slower than the gap between the two pauses cannot end anything early: give up after two.
        s.slowDrafts = now() - draft.startedAt > s.pause.unfinishedMs - s.pause.finishedMs ? s.slowDrafts + 1 : 0;
        if (s.slowDrafts >= 2 && s.adaptive) { s.adaptive = false; setRedemption(s.pause.fixedMs); }
      }
      const current = s.seg === seg && seg.lastSpeechAt <= draft.upTo;
      const worded = !draft.failed && !fillerOnly(draft.text);
      if (current && !draft.failed && s.adaptive) {
        if (!worded) {
          setRedemption(s.pause.unfinishedMs);            // a cough, typing or "mm-hm": the resting long pause, never the hold
        } else if (!sentenceUnfinished(draft.text)) {
          seg.ending = true;
          setRedemption(s.pause.finishedMs);              // the silence already counted is past it: the VAD ends now
        } else {
          setRedemption(Math.max(heldMs(), s.pause.unfinishedMs));   // "Do you know how...": the VAD waits the whole hold
        }
      }
      if (current && worded && s.hold) armBackstop();     // real words: the backstop counts from them
      if (s.seg) maybeDraft(s.seg);                       // speech after the snapshot wanted a newer draft
    });
  }

  function onSpeechStart() {
    const seg = CONVERSATIONS.has(s.mode) ? (s.seg ||= newSeg([])) : null;
    if (seg) { seg.realStart = true; clearHeld(); }   // held words wait for this segment
    if (s.mode === 'handsfree' && s.state === 'speaking') {
      stopPlayback();
      if (s.turnId) s.doneIds.add(s.turnId);   // the stopped turn's tail (and any replay of it) is not spoken
      s.turnId = null;
      s.sent = null;                           // the reply was heard: nothing merges into it any more
      try { onBargeIn(); } catch { /* best effort */ }
      set('listening');
      return;
    }
    if (!seg) return;
    if (s.playing && s.playing.ack) { seg.ignored = true; return; }   // maybe its own echo: never a continuation
    if ((s.sent && (!s.sent.ended || now() - s.sent.at <= mergeGraceMs)) || s.pending || s.busy > 0) {
      seg.resume = true;
      if (!s.hold) holdFor();                  // no reply audio starts over the user
      else armBackstop();                      // a new segment: the backstop counts from it
      set('listening');
    }
  }

  /** A misfire (too short to be speech) cancels nothing; earlier text it held back is sent. */
  function onMisfire() {
    if (!CONVERSATIONS.has(s.mode)) return;
    s.seg = null;
    setRedemption(baseRedemption());
    if (s.carry && !s.busy) { deliver('', newSeg([])); return; }   // held words are held again for what is left
    if (s.hold && !s.busy) releaseHold();
  }

  async function onUtterance(audio) {
    if (s.mode === 'dictate') { await dictateUtterance(audio); return; }
    if (!s.mode) return;
    const seg = s.seg || newSeg([]);
    s.seg = null;
    s.speechEndAt = now() - (s.redemption ?? baseRedemption());   // when the speech stopped, not when the VAD noticed
    setRedemption(baseRedemption());
    if (seg.ignored || (s.state !== 'listening' && !seg.resume)) {
      if (s.carry && s.carry.held && !s.busy) armHeld(Math.max(0, holdRemaining()));   // onSpeechStart stopped the hold's timer
      else if (s.hold && !s.busy && !s.carry) releaseHold();                           // nothing will deliver: never leave it set
      return;
    }
    const gen = s.gen;
    s.busy += 1;
    set('transcribing');
    const text = utteranceText(seg, audio, gen);
    text.catch(() => {});
    s.chain = s.chain.then(async () => {
      let t;
      try { t = await text; } catch (err) {
        if (gen === s.gen) fail(err && err.plain ? err.message : `transcription failed: ${err && err.message ? err.message : err}`);
        return;
      }
      if (gen !== s.gen) return;
      try { deliver(t, seg); } finally { s.busy -= 1; }
    });
  }

  /** The draft's text when it covers all the speech (awaited if still running), else one transcription of the audio. */
  async function utteranceText(seg, audio, gen) {
    const d = seg.draft;
    if (d && d.upTo >= seg.lastSpeechAt) {
      const t = await d.promise;
      if (t != null) return t;
    }
    if (gen !== s.gen) return '';
    return transcribe(audio, gen);
  }

  async function transcribe(audio, gen) {
    if (!s.sttCtrl) s.sttCtrl = new AbortController();
    const stt = (s.cfg && s.cfg.stt) || {};
    if (stt.engine === 'browser') return cleanTranscript(await browserEngine('stt').transcribe(audio, stt.language, s.sttCtrl.signal));
    const r = await request('/api/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: encodeWav(audio, 16000), signal: s.sttCtrl.signal });
    if (gen !== s.gen) return '';
    if (!r.ok) { const e = new Error(await errorOf(r, 'transcription failed')); e.plain = true; throw e; }
    return cleanTranscript((await r.json()).text);
  }

  /** Dictate: one utterance into the composer, not sent, then off (unchanged by turn-taking). */
  async function dictateUtterance(audio) {
    if (s.state !== 'listening') return;
    const gen = s.gen;
    set('transcribing');
    let text = '';
    try {
      text = await transcribe(audio, gen);
    } catch (err) {
      if (gen === s.gen) fail(err && err.plain ? err.message : `transcription failed: ${err && err.message ? err.message : err}`);
      return;
    }
    if (gen !== s.gen) return;
    if (!text) { set('listening'); return; }
    onTranscript(text, { autoSend: false });
    await stop();
  }

  /** How much of the hold is left since the speech ended (ms, may be ≤ 0). */
  function holdRemaining() {
    return s.speechEndAt == null ? 0 : heldMs() - (now() - s.speechEndAt);
  }

  function clearHeld() {
    if (s.heldTimer) { win.clearTimeout(s.heldTimer); s.heldTimer = null; }
  }

  /** Send the held words when the hold runs out. */
  function armHeld(remaining) {
    clearHeld();
    const gen = s.gen;
    s.heldTimer = win.setTimeout(() => flushHeld(gen), remaining);
  }

  function flushHeld(gen) {
    if (gen !== s.gen) return;
    s.heldTimer = null;
    if (s.busy) return;                                 // a segment being transcribed joins the held words itself
    deliver('', newSeg([]), { force: true });
  }

  /** Text T of segment seg is ready (in segment order): carry it, hold it, fold it in, merge it, or send it. */
  function deliver(T, seg, { force = false } = {}) {
    if ((s.seg && s.seg.realStart && !s.seg.ignored) || s.busy > 1) {
      const prev = s.carry;
      s.carry = { text: joinTranscripts(prev && prev.text, T), resume: !!((prev && prev.resume) || seg.resume),
        ...(prev && prev.held ? { held: true, heldAt: prev.heldAt } : {}) };
      return;
    }
    const carry = s.carry;
    s.carry = null;
    let F = joinTranscripts(carry && carry.text, T);
    let resume = !!((carry && carry.resume) || seg.resume);
    if (resume && fillerOnly(T)) {                    // "mm-hm", a cough read as "Thank you.": cancels nothing
      F = (carry && carry.text) || '';
      resume = !!(carry && carry.resume);
    }
    if (!F) { releaseHold(); return; }
    let remaining;
    if (!force && CONVERSATIONS.has(s.mode) && sentenceUnfinished(F) && (remaining = holdRemaining()) > 0) {
      // H1: an unfinished ending waits for more words; s.hold stays as it is, so no reply audio starts over them.
      s.carry = { text: F, resume, held: true, heldAt: carry && carry.heldAt != null ? carry.heldAt : now() };   // heldAt: when the words would have gone out
      armHeld(remaining);
      set('listening');
      return;
    }
    if (s.pending) {                                  // while a merge waits, every delivered word joins it
      const p = s.pending;
      if (p.merged != null) p.merged = joinTranscripts(p.merged, F);
      p.plain = joinTranscripts(p.plain, F);
      if (p.ready) { dropHold(); sendPending(p); return; }   // its turn already ended while the words were held
      releaseHold();
      return;
    }
    if (resume && s.sent) {
      const sent = s.sent;
      // Held words are judged by when they were first held: the hold must not push them past the grace (D7).
      const ok = mergeable(sent, carry && carry.heldAt != null && carry.heldAt >= sent.at ? carry.heldAt : now());
      if (sent.ended) {
        stopPlayback();                                 // the held answer to the half question is never spoken
        dropHold();
        if (ok) send(joinTranscripts(sent.text, F), { supersede: true }); else send(F);
        return;
      }
      stopForMerge(ok ? joinTranscripts(sent.text, F) : null, F);
      return;
    }
    dropHold();
    send(F);
  }

  /**
   * The normal send: the panel posts it (or queues it while a reply runs). supersede: the text is a merge
   * that replaces the message just sent.
   */
  function send(text, { supersede = false } = {}) {
    s.ackHeld = false;
    s.awaitingTurn = true;              // stay 'thinking' until the sent turn's ask-start
    set('thinking');
    armAck();
    const sendId = `v${++s.sendSeq}`;
    onTranscript(text, supersede ? { autoSend: true, supersede: true } : { autoSend: true }, { sendId });
    // bound: noteSent() tied it to its server turn (turnId = its assistant message); until then turns are taken in order.
    s.sent = { text, at: now(), turnId: null, ended: false, spoke: false, unsafe: false, sendId, userMessageId: null, bound: false };
  }

  /** Stop the running turn; its end sends `merged` (when still safe) or `plain`. */
  function stopForMerge(merged, plain) {
    const sent = s.sent;
    stopPlayback();
    if (sent.turnId) s.doneIds.add(sent.turnId);
    s.pending = { turnId: sent.turnId, merged, plain, unsafe: sent.unsafe, sendId: sent.sendId, userMessageId: sent.userMessageId, bound: sent.bound };
    s.sent = null;
    s.turnId = null;
    s.awaitingTurn = true;
    s.ackHeld = false;                  // the send at the stopped turn's end arms it again
    releaseHold();
    set('thinking');
    try { onBargeIn(); } catch { /* best effort */ }
  }

  /** The turn a merge stopped has ended: send the merged text (when still safe) or the plain one. */
  function sendPending(p) {
    s.pending = null;
    if (!p.unsafe && p.merged != null) send(p.merged, { supersede: true }); else send(p.plain);
  }

  // ── the speech hold: only these helpers (and teardown) write s.hold ──
  /** (Re)start the backstop that releases a hold no utterance ends. */
  function armBackstop() {
    clearBackstop();
    const gen = s.gen;
    s.holdTimer = win.setTimeout(() => {
      s.holdTimer = null;
      if (gen !== s.gen || !s.hold) return;
      releaseHold();
    }, holdBackstopMs ?? heldMs() + HOLD_BACKSTOP_MARGIN_MS);
  }

  function clearBackstop() {
    if (s.holdTimer) { win.clearTimeout(s.holdTimer); s.holdTimer = null; }
  }

  /** The user may be continuing: no reply audio starts, and the acknowledgement waits with it. */
  function holdFor() {
    s.hold = true;
    s.ackHeld = s.ackArmed;
    disarmAck();
    armBackstop();
  }

  /** End the hold with no repaint and no pump: the caller sends or stops next. */
  function dropHold() {
    s.hold = false;
    clearBackstop();
  }

  function releaseHold() {
    const held = s.hold;
    s.hold = false;
    clearBackstop();
    if (held && s.ackHeld && !(s.sent && s.sent.spoke) && !s.queue.length && !s.playing && (s.awaitingTurn || s.turnId)) armAck();
    s.ackHeld = false;
    if (CONVERSATIONS.has(s.mode)) set(s.awaitingTurn || s.turnId ? 'thinking' : 'listening');
    pump();
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

  // ── which turn answers a voice send ──
  /**
   * The server took voice send `sendId` (the panel's 202): its turn is assistantMessageId. Binds the waiting merge
   * or the sent message; a turn adopted by order before this was another one's, and is dropped unspoken.
   */
  function noteSent(info) {
    const { sendId, userMessageId, assistantMessageId: real } = info || {};
    if (!s.mode || typeof sendId !== 'string' || typeof userMessageId !== 'string' || typeof real !== 'string') return;
    const p = s.pending;
    if (p && p.sendId === sendId) {
      p.userMessageId = userMessageId;
      p.bound = true;
      p.turnId = real;                                    // one claimed by order stays in doneIds, unspoken
      if (s.unsafeIds.has(real)) p.unsafe = true;         // real wrote something before the 202 named it
      s.doneIds.add(real);
      if (s.endedIds.has(real)) {                         // the stopped turn already ended
        if (s.carry && s.carry.held) p.ready = true; else sendPending(p);
      } else p.ready = false;                             // a ready set by a turn claimed by order was not real's end
      return;
    }
    const sent = s.sent;
    if (!sent || sent.sendId !== sendId) return;
    sent.userMessageId = userMessageId;
    sent.bound = true;
    if (!sent.turnId) {
      sent.turnId = real;
      if (s.endedIds.has(real)) { sent.ended = true; s.awaitingTurn = false; disarmAck(); maybeListen(); }
      return;
    }
    if (sent.turnId === real) return;
    const foreign = sent.turnId;                          // adopted by order: it answered someone else
    s.doneIds.add(foreign);
    if (s.turnId === foreign) { stopPlayback(); s.turnId = null; }
    sent.turnId = real;
    // The foreign turn's flags were not real's: real ending (or not) decides a merge from here.
    sent.ended = s.endedIds.has(real);
    sent.unsafe = s.unsafeIds.has(real);
    if (s.turnId !== real) sent.spoke = false;            // a reply of real's already heard stays unmergeable
    // real's ask-start may have come before the 202: it already moved s.turnId to itself.
    s.awaitingTurn = !s.endedIds.has(real) && s.turnId !== real;
    if (s.awaitingTurn && !s.playing) set('thinking'); else maybeListen();
  }

  /** The bound record whose turn the voice waits for: the merge waiting, or the send whose turn has not ended. */
  function owner() {
    if (s.pending) return s.pending.bound ? s.pending : null;
    return s.sent && s.sent.bound && !s.sent.ended ? s.sent : null;
  }

  /** Is this frame another turn's than the bound record's (an event turn, a message from another tab)? */
  function foreignFrame(frame) {
    const o = owner();
    if (!o || frame.messageId === o.turnId) return false;
    return !(o === s.sent && frame.userMessageId && frame.userMessageId === o.userMessageId);
  }

  // ── reply → speech ──
  // Hands-free spoken version (`ask-spoken`): the server splits the model's short <spoken> block out of the reply.
  // Once one arrives, it is read instead of the prose; with none, at most two prose sentences are read, or a
  // short line when they are too long or the reply opens with a list, code or a table (createSpokenFallback).
  function onFrame(frame, liveText, liveSpoken = null) {
    if (!CONVERSATIONS.has(s.mode) || !frame) return;
    if (frame.type === 'ask-start') {
      if (s.doneIds.has(frame.messageId)) return;          // replay of a finished / barged-in turn
      // A merge stopped a turn whose ask-start had not come yet and the 202 has not named it: turns on one
      // thread are serial, so the first new one is that stopped turn — never spoken, never the sent message's.
      if (s.pending && !s.pending.bound && !s.pending.turnId) {
        s.pending.turnId = frame.messageId;
        s.doneIds.add(frame.messageId);
        return;
      }
      if (foreignFrame(frame)) return;                     // not the bound send's turn: the voice keeps waiting
      if (s.sent && !s.sent.turnId) s.sent.turnId = frame.messageId;
      s.awaitingTurn = false;
      if (frame.messageId !== s.turnId) {                   // a replayed ask-start of the SAME turn keeps
        s.turnId = frame.messageId;                         // its chunkers: they wait out the rewind
        s.fallback = createSpokenFallback();                // and never re-speak
        s.spokenChunker = createSpeechChunker();
        s.spokenSoFar = '';
        s.spokenMode = false;
        s.toolIds.clear();
      }
      s.turnEnded = false;
      if (s.state === 'listening') set('thinking');
      return;
    }
    if ((frame.type === 'ask-block' || frame.type === 'ask-card') && (frame.type === 'ask-card' || !mergeSafeBlock(frame.block))) {
      // It changed something, or left a card or a sub-agent behind: never ask that turn again.
      s.unsafeIds.add(frame.messageId);                    // by id: a 202 may name it after another turn was adopted
      if (s.unsafeIds.size > ENDED_IDS_MAX) s.unsafeIds.delete(s.unsafeIds.values().next().value);
      if (s.pending && s.pending.turnId && frame.messageId === s.pending.turnId) s.pending.unsafe = true;
      if (s.sent && s.sent.turnId && frame.messageId === s.sent.turnId) s.sent.unsafe = true;
    }
    const ends = frame.type === 'ask-done' || frame.type === 'ask-error';
    if (ends) {
      s.endedIds.add(frame.messageId);
      if (s.endedIds.size > ENDED_IDS_MAX) s.endedIds.delete(s.endedIds.values().next().value);
    }
    if (ends && s.pending
      && (frame.messageId === s.pending.turnId || (!s.pending.bound && !s.pending.turnId && !s.doneIds.has(frame.messageId)))) {
      // The turn a merge stopped has ended: now the server takes the next message (no 409).
      s.doneIds.add(frame.messageId);
      s.pending.turnId = frame.messageId;                  // an ask-start replayed later is not claimed as it
      if (s.carry && s.carry.held) { s.pending.ready = true; return; }   // words still held: they send it
      sendPending(s.pending);
      return;
    }
    if (ends && s.sent && s.sent.turnId && frame.messageId === s.sent.turnId) s.sent.ended = true;
    const mine = s.turnId && frame.messageId === s.turnId;
    if (frame.type === 'ask-spoken' && mine && s.ttsEnabled) {
      s.spokenMode = true;
      s.spokenSoFar = liveSpoken ?? s.spokenSoFar;
      for (const t of s.spokenChunker.push(s.spokenSoFar)) enqueue(t);
    } else if (frame.type === 'ask-delta' && mine && s.ttsEnabled) {
      if (!s.spokenMode) for (const t of s.fallback.push(liveText || '')) enqueue(t);
    } else if (frame.type === 'ask-block' && mine && s.ttsEnabled && isNewTool(frame.block)) {
      // The text before a tool call is a finished block ("I'll check the runs."): say it
      // now, not after the tool. If there was none, research is ahead: acknowledge.
      if (s.spokenMode) for (const t of s.spokenChunker.push(s.spokenSoFar, true)) enqueue(t);
      else if (liveText != null) for (const t of s.fallback.push(liveText, true)) enqueue(t);
      acknowledge();
    } else if (ends) {
      if (mine && s.ttsEnabled && frame.type === 'ask-done' && frame.status !== 'stopped') {
        // liveSpoken is null here (the model already cleared live): the spoken text so far is kept.
        const flushed = s.spokenMode ? s.spokenChunker.push(s.spokenSoFar, true) : s.fallback.push(frame.text ?? liveText ?? '', true);
        for (const t of flushed) enqueue(t);
      }
      // The sent turn ended (even with no ask-start) — unless it is another turn than the bound send's.
      if (!s.doneIds.has(frame.messageId) && !foreignFrame(frame)) { s.awaitingTurn = false; disarmAck(); }
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
    return request('/api/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal })
      .then(async (r) => { if (!r.ok) throw new Error(await errorOf(r, 'speech failed')); return r.blob(); });
  }

  async function pump() {
    for (const it of s.queue.slice(0, PREFETCH)) if (!it.audio) synth(it);
    if (s.playing || !s.queue.length || s.hold) return;   // never start talking over a continuation
    const item = s.queue[0];
    const gen = s.gen;
    s.playing = item;
    let blob;
    try { blob = await item.audio; } catch (err) {
      // Not the item playing any more: stopPlayback() aborted its render (a merge, a barge-in, a stop), which
      // is no failure of the voice. Only a render that fails while still current turns replies text-only.
      if (gen !== s.gen || s.playing !== item) return;
      return ttsFailed(err, gen);
    }
    if (gen !== s.gen || s.playing !== item) return;
    if (s.hold) { s.playing = null; return; }            // they went on while it rendered: it waits at the head for releaseHold()
    if (!item.ack && s.sent) s.sent.spoke = true;         // the reply was heard: no merge into it any more
    if (!item.ack && s.state !== 'speaking') { set('speaking'); setThresholds(BARGE_IN_THRESHOLDS); }
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
    try { onNotice(`Voice replies are text only for now: ${err && err.message ? err.message : err}`); } catch { /* ignore */ }
    maybeListen();
  }

  function stopPlayback() {
    if (s.ttsCtrl) { s.ttsCtrl.abort(); s.ttsCtrl = null; }
    const p = s.playing;
    s.playing = null;
    s.queue = [];
    if (p && p.stop) p.stop();
    if (s.vad && s.state === 'speaking') setThresholds(LISTEN_THRESHOLDS);
  }

  function maybeListen() {
    if (!CONVERSATIONS.has(s.mode) || s.playing || s.queue.length) return;
    if (s.state === 'speaking' && s.vad) setThresholds(LISTEN_THRESHOLDS);
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
    if (s.draftCtrl) { s.draftCtrl.abort(); s.draftCtrl = null; }
    stopPlayback();
    s.turnId = null; s.fallback = null; s.spokenChunker = null; s.spokenSoFar = ''; s.spokenMode = false; s.turnEnded = false; s.awaitingTurn = false; s.nextAck = null;
    s.seg = null; s.pre = []; s.carry = null; s.sent = null; s.pending = null; s.hold = false; s.ackHeld = false; clearBackstop();
    s.endedIds.clear(); s.unsafeIds.clear();
    s.slowDrafts = 0; s.drafting = false; s.busy = 0; s.chain = Promise.resolve(); s.redemption = null;
    clearHeld(); s.speechEndAt = null;
    s.pos = LISTEN_THRESHOLDS.positiveSpeechThreshold; s.neg = LISTEN_THRESHOLDS.negativeSpeechThreshold;
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
      const r = await request('/api/speech');
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
    start, stop, destroy, onFrame, preload, noteSent,
    fail: (m) => { if (s.mode) fail(m); },
    active: () => !!s.mode,
    mode: () => s.mode,
    state: () => s.state,
    // Hands-free with a voice that speaks: the panel then asks the model for a short spoken version.
    speaks: () => s.mode === 'handsfree' && !!s.ttsEnabled,
  };
}

// src/core/sound.mjs
// Design sound: the one place worca calls ElevenLabs (D6). It lists the account's voices, fetches
// a voice's sample, speaks a scene's words and composes the film's music, on the plumbing in
// ./elevenlabs.mjs. The key and every call stay in the server: the key goes only to
// SOUND_SERVICE.baseUrl, in the `xi-api-key` header, never through a redirect, and a sample is
// fetched with no key at all. fetch is injectable for tests; mock mode (D18) answers silent WAV
// files and makes no call.
import {
  ElevenError, elevenFetch, withRetry, fetchPublic, redactKey, mp3Duration, wordsFromAlignment, estimateWords,
  voiceCandidate, rankVoices,
} from './elevenlabs.mjs';
import { SOUND_SERVICE, SOUND_LIMITS, voiceUsd, musicUsd } from '../shared/sound-services.mjs';
import { soundConfig, resolveProviderSecret } from './settings.mjs';
import { modelEnvRef, maskModelEnvValue, envFlag } from './model-env.mjs';
import { brokerEnabled } from './broker-client.mjs';

// The reasons a SoundError carries (SPEC §7, word for word).
const NOT_SET_UP = 'ElevenLabs is not set up';
const KEY_REJECTED = 'ElevenLabs rejected the key';
const NO_CREDITS = 'the ElevenLabs account is out of credits';
const NOT_ALLOWED = 'this ElevenLabs plan or key cannot do that';
const MUSIC_REFUSED = 'ElevenLabs refused this music description';
const REFUSED = 'ElevenLabs refused the request';
const BUSY = 'ElevenLabs is busy; try again';
const UNREACHABLE = 'ElevenLabs could not be reached';
const TOO_SLOW = 'ElevenLabs did not answer in time';
const NOT_SOUND = 'ElevenLabs answered with something that is not sound';
const VAR_REFUSED = 'Save the row before testing a key kept in a variable';

const VOICE_MODEL = `elevenlabs/${SOUND_SERVICE.voiceModel}`;
const MUSIC_MODEL = `elevenlabs/${SOUND_SERVICE.musicModel}`;
const MAX_VOICE_PAGES = 3;
const ABOUT_MAX = 120;
const MOCK_WPS = 2.5;
const MOCK_SAMPLE_SEC = 2;
const WAV_RATE = 8000;
const MOCK_VOICES = Object.freeze(['Ana', 'Ben', 'Cleo', 'Dan', 'Eva', 'Finn'].map((name, i) => Object.freeze({
  id: `mock-voice-${i + 1}`, name, about: i % 2 ? 'male · american · warm' : 'female · british · calm',
})));

/** A failure with one of SPEC §7's reasons. status: 409 not set up, 401/402/403 the account, 4xx refused, 429/5xx busy, 502 unreachable or not sound, 504 time. */
export class SoundError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'SoundError'; this.status = status; }
}

const abortError = () => new DOMException('This operation was aborted', 'AbortError');
const notSound = () => new SoundError(NOT_SOUND, 502);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo));
const isHttps = (u) => {
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
};
const nonEmpty = (v) => typeof v === 'string' && v !== '';

/** Voice id → sample address of every voice listed since the server started (`https:` only; SPEC §5). */
const samples = new Map();

/** `mockEnabled`'s rule, except that a passed fetch turns mock off (D18). */
const mockOn = (mock, fetch) => mock ?? (fetch ? false : envFlag('WORCA_MOCK', 'ORCH_MOCK'));

/** The key to call with: a typed one (trimmed, as the header sends it), else the stored one resolved; none is a 409 before any call. */
function keyOf(key) {
  const k = nonEmpty(key) ? key.trim() : resolveProviderSecret(soundConfig().apiKey);
  if (!k) throw new SoundError(NOT_SET_UP, 409);
  return k;
}

/** The retry's wait, which ends early when `signal` aborts (the next attempt then makes no call). */
function waitFor(signal) {
  return (ms) => new Promise((resolve) => {
    if (signal?.aborted) { resolve(); return; }
    const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** An ElevenError after the retries as a SoundError with SPEC §7's words (`detail` is already cut and redacted). */
function soundErrorOf(e) {
  const { status, code, detail } = e;
  if (status === 401) return new SoundError(KEY_REJECTED, 401);
  if (status === 402) return new SoundError(NO_CREDITS, 402);
  if (status === 403) return new SoundError(NOT_ALLOWED, 403);
  if (status === 400 && code === 'bad_prompt') return new SoundError(MUSIC_REFUSED, 400);
  if (status === 429 || status >= 500) return new SoundError(BUSY, status);
  if (status >= 400) return new SoundError(`${REFUSED}: ${detail || `HTTP ${status}`}`, status);
  return new SoundError(UNREACHABLE, 502);
}

/**
 * One keyed ElevenLabs call with the retry: each attempt has its own deadline, which covers
 * reading the body (`read`) too. Rejects with a SoundError, or an AbortError when `signal` stops it.
 */
async function call(path, { key, method, query, body, read, fetch, signal, sleep, timeoutMs }) {
  const send = fetch ?? globalThis.fetch;
  const fetchImpl = (url, init) => send(url, { ...init, redirect: 'error' });
  const attempt = async () => {
    if (signal?.aborted) throw abortError();
    const deadline = AbortSignal.timeout(timeoutMs);
    try {
      const res = await elevenFetch(path, {
        key, method, query, body, base: SOUND_SERVICE.baseUrl, fetchImpl, timeoutMs: 0,
        signal: AbortSignal.any([deadline, signal].filter(Boolean)),
      });
      return await read(res);
    } catch (e) {
      if (signal?.aborted) throw abortError();
      if (deadline.aborted) throw new SoundError(TOO_SLOW, 504);
      if (e instanceof ElevenError || e instanceof SoundError) throw e;
      throw notSound();
    }
  };
  try {
    return await withRetry(attempt, { sleep: sleep ?? waitFor(signal) });
  } catch (e) {
    throw e instanceof ElevenError ? soundErrorOf(e) : e;
  }
}

/** Leave a body unread (frees the connection); never throws. */
function drop(res) {
  try { res.body?.cancel().catch(() => {}); } catch { /* a locked or odd body */ }
}

const readJson = async (res) => {
  const j = await res.json();
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw notSound();
  return j;
};

/** A voice's line under its name: gender, accent and description, the ones it has. */
const aboutOf = (v) => [v.gender, v.accent, v.description].filter(nonEmpty).join(' · ').slice(0, ABOUT_MAX);

/**
 * The account's voices that have a sample: narration voices first, female and male alternating,
 * at most SOUND_LIMITS.voices. Adds each one's sample address to those voiceSample serves.
 * @returns {Promise<Array<{ id: string, name: string, about: string }>>}
 */
export async function listVoices({ key, fetch, signal, mock, sleep, timeoutMs = SOUND_LIMITS.voiceCallMs } = {}) {
  if (mockOn(mock, fetch)) {
    if (signal?.aborted) throw abortError();
    return MOCK_VOICES.map((v) => ({ ...v }));
  }
  const k = keyOf(key);
  const all = [];
  let token;
  for (let page = 0; page < MAX_VOICE_PAGES; page += 1) {
    const j = await call('/v2/voices', { key: k, method: 'GET', query: { page_size: 100, next_page_token: token }, read: readJson, fetch, signal, sleep, timeoutMs });
    if (Array.isArray(j.voices)) all.push(...j.voices);
    token = nonEmpty(j.next_page_token) ? j.next_page_token : null;
    if (!j.has_more || !token) break;
  }
  const kept = rankVoices(all.map(voiceCandidate).filter((v) => v.id && isHttps(v.previewUrl)), 'either').slice(0, SOUND_LIMITS.voices);
  for (const v of kept) samples.set(v.id, v.previewUrl);
  return kept.map((v) => ({ id: v.id, name: v.name, about: aboutOf(v) }));
}

/** A listed voice's sample, fetched with no key. null for a voice never listed or a failed download. */
export async function voiceSample(id, { fetch, mock } = {}) {
  if (mockOn(mock, fetch)) return MOCK_VOICES.some((v) => v.id === id) ? { bytes: silentWav(MOCK_SAMPLE_SEC), type: 'audio/wav' } : null;
  const url = samples.get(id);
  if (!url) return null;
  const bytes = await fetchPublic(url, { fetchImpl: fetch, maxBytes: SOUND_LIMITS.sampleBytes });
  return bytes ? { bytes, type: 'audio/mpeg' } : null;
}

/**
 * One scene's words in one voice, with each word's timing; the neighbouring scenes' words are
 * context (`previous_text` / `next_text`).
 * @returns {Promise<{ bytes: Buffer, ext: 'mp3'|'wav', seconds: number, words: Array<{ w: string, t0: number, t1: number }>, chars: number, costUsd: number, model: string }>}
 */
export async function speak({ text, voiceId, previousText, nextText, fetch, signal, mock, key, sleep, timeoutMs = SOUND_LIMITS.voiceCallMs } = {}) {
  const chars = text.length;
  const costUsd = voiceUsd(chars);
  const timing = (words) => words.map(({ w, t0, t1 }) => ({ w, t0, t1 }));
  if (mockOn(mock, fetch)) {
    if (signal?.aborted) throw abortError();
    const est = estimateWords(text, MOCK_WPS);
    const bytes = silentWav(est.dur);
    return { bytes, ext: 'wav', seconds: audioInfo(bytes).seconds, words: timing(est.words), chars, costUsd, model: VOICE_MODEL };
  }
  const k = keyOf(key);
  const body = { text, model_id: SOUND_SERVICE.voiceModel };
  if (nonEmpty(previousText)) body.previous_text = previousText;
  if (nonEmpty(nextText)) body.next_text = nextText;
  const read = async (res) => {
    const j = await readJson(res);
    if (typeof j.audio_base64 !== 'string') throw notSound();
    const bytes = Buffer.from(j.audio_base64, 'base64');
    if (bytes.length > SOUND_LIMITS.audioBytes) throw notSound();
    const info = audioInfo(bytes);
    if (!info) throw notSound();
    const words = timing(wordsFromAlignment(j.alignment || j.normalized_alignment));
    return { bytes, ext: info.ext, seconds: info.seconds, words, chars, costUsd, model: VOICE_MODEL };
  };
  return call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, {
    key: k, method: 'POST', query: { output_format: SOUND_SERVICE.voiceFormat }, body, read, fetch, signal, sleep, timeoutMs,
  });
}

/**
 * One instrumental track of `seconds` (3 to 300) for a description; its length and price are
 * read from the bytes ElevenLabs answers.
 * @returns {Promise<{ bytes: Buffer, ext: 'mp3'|'wav', seconds: number, costUsd: number, model: string }>}
 */
export async function compose({ prompt, seconds, fetch, signal, mock, key, sleep, timeoutMs = SOUND_LIMITS.musicCallMs } = {}) {
  const length = clamp(seconds, SOUND_LIMITS.musicMinSec, SOUND_LIMITS.musicMaxSec);
  const made = (bytes, info) => ({ bytes, ext: info.ext, seconds: info.seconds, costUsd: musicUsd(info.seconds), model: MUSIC_MODEL });
  if (mockOn(mock, fetch)) {
    if (signal?.aborted) throw abortError();
    const bytes = silentWav(length);
    return made(bytes, audioInfo(bytes));
  }
  const k = keyOf(key);
  const body = { prompt, music_length_ms: Math.round(length * 1000), model_id: SOUND_SERVICE.musicModel, force_instrumental: true };
  const read = async (res) => {
    const declared = Number(res.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > SOUND_LIMITS.audioBytes) { drop(res); throw notSound(); }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > SOUND_LIMITS.audioBytes) throw notSound();
    const info = audioInfo(bytes);
    if (!info) throw notSound();
    return made(bytes, info);
  };
  return call('/v1/music', { key: k, method: 'POST', body, read, fetch, signal, sleep, timeoutMs });
}

/** WAV seconds from its `fmt ` byte rate and its `data` size (cut to the bytes there are), or null. */
function wavSeconds(b) {
  let byteRate = 0;
  for (let i = 12; i + 8 <= b.length;) {
    const id = b.toString('latin1', i, i + 4);
    const size = b.readUInt32LE(i + 4);
    if (id === 'fmt ' && i + 20 <= b.length) byteRate = b.readUInt32LE(i + 16);
    else if (id === 'data') return byteRate > 0 ? Math.min(size, b.length - i - 8) / byteRate : null;
    i += 8 + size + (size & 1);
  }
  return null;
}

/** What audio `bytes` hold: `wav` or `mp3` and their length in seconds; null for anything else. */
export function audioInfo(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : bytes instanceof Uint8Array ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null;
  if (!b || b.length < 4) return null;
  let out = null;
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WAVE') out = { ext: 'wav', seconds: wavSeconds(b) };
  else if (b.toString('latin1', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) out = { ext: 'mp3', seconds: mp3Duration(b) };
  return out && Number.isFinite(out.seconds) && out.seconds > 0 ? out : null;
}

/** `seconds` of silence: PCM 16-bit mono at 8000 Hz behind a 44-byte header. */
export function silentWav(seconds) {
  const data = Math.max(0, Math.round((Number.isFinite(seconds) ? seconds : 0) * WAV_RATE)) * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVE', 8, 'latin1');
  b.write('fmt ', 12, 'latin1');
  b.writeUInt32LE(16, 16);            // fmt chunk size
  b.writeUInt16LE(1, 20);             // PCM
  b.writeUInt16LE(1, 22);             // mono
  b.writeUInt32LE(WAV_RATE, 24);      // sample rate
  b.writeUInt32LE(WAV_RATE * 2, 28);  // byte rate
  b.writeUInt16LE(2, 32);             // block align
  b.writeUInt16LE(16, 34);            // bits per sample
  b.write('data', 36, 'latin1');
  b.writeUInt32LE(data, 40);
  return b;
}

/** The Providers row's state: the key's fields, never the key (it reaches the browser and the chat model). */
export function soundState() {
  const { apiKey } = soundConfig();
  const ref = modelEnvRef(apiKey);
  const keySet = !!apiKey;
  const keyMissing = keySet && !resolveProviderSecret(apiKey);
  return {
    service: SOUND_SERVICE.id,
    configured: keySet && !keyMissing,
    keySet,
    keySource: !keySet ? null : ref ? 'env' : 'stored',
    keyRef: ref ? apiKey : null,
    keyMasked: keySet && !ref ? maskModelEnvValue(apiKey) : null,
    keyMissing,
    available: !brokerEnabled(),
  };
}

/** Whether a round can make sound: never under the broker; then mock, or a key that resolves. */
export function soundReady() {
  if (brokerEnabled()) return false;
  return envFlag('WORCA_MOCK', 'ORCH_MOCK') || !!resolveProviderSecret(soundConfig().apiKey);
}

/** The row's Test: the voices the typed key (or the stored one) can list. Never throws. */
export async function testSound(typed = {}, fetch) {
  let key;
  let stored = '';
  try {
    stored = soundConfig().apiKey;
    const t = typed && typeof typed === 'object' && typeof typed.apiKey === 'string' ? typed.apiKey.trim() : '';
    if (t && t !== stored && !t.startsWith('••')) {
      if (modelEnvRef(t)) return { ok: false, message: VAR_REFUSED };
      key = t;
    }
    const list = await listVoices({ key, fetch });
    return { ok: true, voices: list.length };
  } catch (err) {
    if (err instanceof SoundError) return { ok: false, message: err.message };
    return { ok: false, message: redactKey(redactKey(err?.message ?? String(err), key), resolveProviderSecret(stored)) };
  }
}

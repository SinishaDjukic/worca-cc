// src/core/speech.mjs
// Ask Worca voice mode (docs/speech.md): the server half. Calls the user's
// OpenAI-compatible speech servers — STT POST {baseUrl}/audio/transcriptions
// (multipart), TTS POST {baseUrl}/audio/speech (JSON) — so keys stay on the
// server and the browser never meets CORS. fetch is injectable for tests.
import { speechConfig, resolveProviderSecret } from './settings.mjs';
import { modelEnvRef, maskModelEnvValue, isUpstreamBaseUrl } from './model-env.mjs';
import { encodeWav } from '../shared/speech.mjs';

export const SPEECH_KINDS = Object.freeze(['stt', 'tts']);
export const MAX_TTS_CHARS = 4096;          // OpenAI's /audio/speech input cap
const CALL_TIMEOUT_MS = 60_000;
const TEST_TIMEOUT_MS = 15_000;

export class SpeechError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'SpeechError'; this.status = status; }
}

/** GET /api/speech and the Providers card: never a key, only where it comes from. */
export function speechState() {
  const c = speechConfig();
  const side = (kind) => {
    const { apiKey, ...rest } = c[kind];
    const ref = modelEnvRef(apiKey);
    return {
      ...rest,
      configured: rest.engine === 'browser' || (rest.engine === 'server' && !!rest.baseUrl),
      keySet: !!apiKey,
      keySource: !apiKey ? null : ref ? 'env' : 'stored',
      keyRef: ref ? apiKey : null,
      keyMasked: apiKey && !ref ? maskModelEnvValue(apiKey) : null,
      keyMissing: !!apiKey && !resolveProviderSecret(apiKey),
    };
  };
  return { stt: side('stt'), tts: side('tts') };
}

/** Stored config for `kind`, with what the user TYPED on the card (unsaved) laid over it. */
const originOf = (u) => { try { return new URL(u).origin; } catch { return ''; } };

function endpoint(kind, typed) {
  const c = { ...speechConfig()[kind] };
  const t = typed && typeof typed === 'object' ? typed : {};
  const storedOrigin = originOf(c.baseUrl);
  if (typeof t.baseUrl === 'string' && isUpstreamBaseUrl(t.baseUrl)) c.baseUrl = t.baseUrl.trim().replace(/\/+$/, '');
  for (const k of ['model', 'voice']) if (k in c && typeof t[k] === 'string' && t[k].trim()) c[k] = t[k].trim();
  if (kind === 'stt' && typeof t.language === 'string' && t.language.trim()) c.language = t.language.trim().toLowerCase();
  if (kind === 'tts' && t.speed !== undefined && t.speed !== '' && Number.isFinite(Number(t.speed))) c.speed = Number(t.speed);
  if (typeof t.apiKey === 'string' && t.apiKey.trim() && !t.apiKey.startsWith('••')) c.apiKey = t.apiKey.trim();
  // The STORED key only ever goes to the stored server's origin. A Test aimed at a
  // different typed URL without a typed key is sent keyless, so a stored key can never
  // be sent to an arbitrary URL typed on the card (stricter than testProviderConnection).
  else if (c.apiKey && originOf(c.baseUrl) !== storedOrigin) c.apiKey = '';
  const key = resolveProviderSecret(c.apiKey);
  return { ...c, key, unresolved: !!c.apiKey && !key };
}

function assertUsable(kind, c) {
  const what = kind === 'stt' ? 'speech-to-text' : 'text-to-speech';
  if (!c.baseUrl) throw new SpeechError(`${what} is not configured (Providers › Speech)`, 409);
  if (c.unresolved) throw new SpeechError(`the ${what} key's \${VAR} is not set in worca's environment`, 409);
}

async function callUpstream(f, url, init, key, ms) {
  const timeout = AbortSignal.timeout(ms);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const headers = { ...(init.headers || {}), ...(key ? { authorization: `Bearer ${key}` } : {}) };
  let r;
  try {
    r = await f(url, { ...init, headers, signal });
  } catch (err) {
    throw new SpeechError(`speech server unreachable at ${url} — ${err && err.message ? err.message : String(err)}`, 502);
  }
  if (r.status === 401 || r.status === 403) throw new SpeechError(`speech server rejected the key (${r.status})`, 502);
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new SpeechError(`speech server answered ${r.status}${body ? `: ${body.slice(0, 200)}` : ''}`, 502);
  }
  return r;
}

/** WAV bytes → { text }. */
export async function transcribe({ audio, mime = 'audio/wav', fetch: f = globalThis.fetch, signal, typed, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const c = endpoint('stt', typed);
  assertUsable('stt', c);
  if (!audio || !audio.length) throw new SpeechError('no audio in the request', 400);
  const form = new FormData();
  form.append('file', new Blob([audio], { type: mime }), 'speech.wav');
  form.append('model', c.model);
  form.append('response_format', 'json');
  if (c.language && c.language !== 'auto') form.append('language', c.language);
  const r = await callUpstream(f, `${c.baseUrl}/audio/transcriptions`, { method: 'POST', body: form, signal }, c.key, timeoutMs);
  const j = await r.json().catch(() => null);
  if (!j || typeof j.text !== 'string') throw new SpeechError('speech server answered without a transcript', 502);
  return { text: j.text.trim() };
}

/** Text → the upstream Response (the caller streams its body). */
export async function synthesize({ text, fetch: f = globalThis.fetch, signal, typed, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  const c = endpoint('tts', typed);
  assertUsable('tts', c);
  const input = typeof text === 'string' ? text.trim() : '';
  if (!input) throw new SpeechError('text is required', 400);
  if (input.length > MAX_TTS_CHARS) throw new SpeechError(`text is longer than ${MAX_TTS_CHARS} characters`, 400);
  const body = JSON.stringify({ model: c.model, voice: c.voice, input, speed: c.speed, response_format: 'wav' });
  return callUpstream(f, `${c.baseUrl}/audio/speech`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal }, c.key, timeoutMs);
}

/** The card's Test button: what is ON SCREEN (typed) over what is stored. Never throws. */
export async function testSpeech(kind, typed = {}, f = globalThis.fetch) {
  if (!SPEECH_KINDS.includes(kind)) return { ok: false, message: `unknown speech service ${kind}` };
  try {
    if (kind === 'stt') {
      await transcribe({ audio: encodeWav(new Float32Array(8000)), fetch: f, typed, timeoutMs: TEST_TIMEOUT_MS });
      return { ok: true, detail: 'transcription endpoint answered' };
    }
    const r = await synthesize({ text: 'Test.', fetch: f, typed, timeoutMs: TEST_TIMEOUT_MS });
    const bytes = (await r.arrayBuffer()).byteLength;
    return bytes ? { ok: true, detail: `${bytes} bytes of audio` } : { ok: false, message: 'speech server answered with no audio' };
  } catch (err) {
    return { ok: false, message: err && err.message ? err.message : String(err) };
  }
}

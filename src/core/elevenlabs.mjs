// src/core/elevenlabs.mjs — the ElevenLabs plumbing worca's server and the promo video scripts
// share: the transport (one keyed API call, the retry, a public download without a credential),
// the timing helpers that replace afinfo (an MP3 frame counter, word timing from the TTS
// alignment or estimated from the pace), and an account voice as a voice candidate.
//
// The caller passes the key and the origin in: this module reads no environment and no
// settings. The key travels only in the `xi-api-key` header, and every message that could echo
// it goes through redactKey().
//
// Pure Node with no imports (fetch, AbortSignal, URLSearchParams, Buffer and setTimeout are
// globals), so a promo script child, which runs with WORCA_HOME stripped, loads it too.

export const ELEVEN_BASE = 'https://api.elevenlabs.io';
/** Higher formats (mp3_44100_192, pcm_*) are refused on the lower tiers. */
export const OUTPUT_FORMAT = 'mp3_44100_128';
export const TTS_MODEL = 'eleven_multilingual_v2';
/** Narration words per second by pace (the writer sizes the script with the same numbers). */
export const WORDS_PER_SEC = Object.freeze({ Relaxed: 2.2, Lively: 2.5, Fast: 2.8 });

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

// ── the transport ──────────────────────────────────────────────────────────────

const KEY_SHAPE_RE = /\bsk_[A-Za-z0-9_]{20,}/g;

/** `text` with every occurrence of `key` — and anything shaped like an ElevenLabs key — masked. */
export function redactKey(text, key) {
  let s = text === undefined || text === null ? '' : String(text);
  if (typeof key === 'string' && key.length >= 4) s = s.split(key).join('[redacted]');
  return s.replace(KEY_SHAPE_RE, '[redacted]');
}

/**
 * An ElevenLabs failure: `status` 0 for a network error, else the HTTP status; `code` from the
 * body; `detail` the body's message, redacted and cut to 200 characters ('' when there is none).
 */
export class ElevenError extends Error {
  constructor(message, { status = 0, code = null, detail = '' } = {}) {
    super(message);
    this.name = 'ElevenError';
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

/** True for a failure worth a retry: network, 429, 5xx. Never an auth or quota refusal. */
export const retryable = (e) => e instanceof ElevenError && (e.status === 0 || e.status === 429 || e.status >= 500);
/** True when the account itself said no (bad key, no credits, plan): stop asking. */
export const accountRefusal = (e) => e instanceof ElevenError && [401, 402, 403].includes(e.status);

function detailOf(text) {
  try {
    const j = JSON.parse(text);
    const d = j?.detail ?? j;
    if (typeof d === 'string') return { code: null, message: d };
    if (Array.isArray(d)) return { code: 'invalid_request', message: d.map((x) => x?.msg).filter(Boolean).join('; ') };
    if (isObject(d)) return { code: typeof d.status === 'string' ? d.status : (typeof d.code === 'string' ? d.code : null), message: typeof d.message === 'string' ? d.message : '' };
  } catch { /* not JSON */ }
  return { code: null, message: '' };
}

/**
 * One ElevenLabs API call. Resolves the Response on 2xx; rejects with an ElevenError whose
 * message carries the method, the path (never a query, never the key) and the status. A
 * caller's `signal` aborts it as well (a network ElevenError); `timeoutMs: 0` turns off its own timer.
 * @param {string} path '/v2/voices'
 * @param {{key:string, method?:string, body?:object, query?:object, fetchImpl?:Function, base?:string, timeoutMs?:number, accept?:string, signal?:AbortSignal}} opts
 */
export async function elevenFetch(path, { key, method = 'GET', body, query, fetchImpl = globalThis.fetch, base = ELEVEN_BASE, timeoutMs = 120000, accept, signal } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    for (const one of Array.isArray(v) ? v : [v]) qs.append(k, String(one));
  }
  const q = qs.toString();
  const url = `${String(base).replace(/\/+$/, '')}${path}${q ? `?${q}` : ''}`;
  const headers = { 'xi-api-key': key };
  if (accept) headers.accept = accept;
  const init = { method, headers };
  if (body !== undefined) { headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const timer = timeoutMs && typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : null;
  if (signal && timer) init.signal = AbortSignal.any([signal, timer]);
  else if (signal || timer) init.signal = signal || timer;
  const where = `ElevenLabs ${method} ${path}`;
  let res;
  try {
    res = await fetchImpl(url, init);
  } catch (err) {
    const code = err?.cause?.code || err?.code || err?.name || 'failed';
    throw new ElevenError(redactKey(`${where}: network error (${code})`, key), { status: 0 });
  }
  if (!res.ok) {
    let text = '';
    try { text = (await res.text()).slice(0, 4000); } catch { /* no body */ }
    const d = detailOf(text);
    // Redact before cutting: a cut through the key would leave its first characters behind.
    const detail = redactKey(d.message, key).slice(0, 200);
    const msg = detail ? `: ${detail}` : '';
    throw new ElevenError(redactKey(`${where} → HTTP ${res.status}${d.code ? ` (${d.code})` : ''}${msg}`, key), { status: res.status, code: d.code, detail });
  }
  return res;
}

const realSleep = (ms) => new Promise((r) => { setTimeout(r, ms).unref?.(); });

/** Run `fn`; on a retryable ElevenError wait and try again (`delays` = the waits, in ms). */
export async function withRetry(fn, { delays = [2000, 5000], sleep = realSleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await fn(attempt); } catch (e) {
      if (attempt >= delays.length || !retryable(e)) throw e;
      await sleep(delays[attempt]);
    }
  }
}

/** Download a public URL (a voice preview) WITHOUT any credential. Buffer, or null on any failure. */
export async function fetchPublic(url, { fetchImpl = globalThis.fetch, maxBytes = 8 * 1024 * 1024, timeoutMs = 60000 } = {}) {
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) return null;
  try {
    const init = {};
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);
    const res = await fetchImpl(url, init);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length && buf.length <= maxBytes ? buf : null;
  } catch { return null; }
}

// ── timing ─────────────────────────────────────────────────────────────────────

const MPEG_BITRATES = {
  // [version][layer] → kbps by index (version: 1 = MPEG-1, 2 = MPEG-2 and 2.5)
  1: { 1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] },
  2: { 1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    3: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] },
};
const MPEG_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/**
 * Duration in seconds of an MP3 buffer, by walking its MPEG frames (ID3v2 skipped, a Xing/Info
 * header frame not counted). Pure JS, so it works on every OS without afinfo or ffprobe.
 * null when no frame parses.
 */
export function mp3Duration(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return null;
  let i = 0;
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'ID3') {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    i = 10 + size + ((buf[5] & 0x10) ? 10 : 0);
  }
  let samples = 0;
  let rate = 0;
  let frames = 0;
  let misses = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i += 1;
      if (frames && ++misses > 4096) break;          // trailing garbage (an ID3v1 tag): stop
      continue;
    }
    const verBits = (buf[i + 1] >> 3) & 3;            // 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5
    const layerBits = (buf[i + 1] >> 1) & 3;          // 3 = layer I, 2 = II, 1 = III
    const brIdx = buf[i + 2] >> 4;
    const srIdx = (buf[i + 2] >> 2) & 3;
    const pad = (buf[i + 2] >> 1) & 1;
    if (verBits === 1 || layerBits === 0 || brIdx === 0 || brIdx === 15 || srIdx === 3) { i += 1; continue; }
    const layer = 4 - layerBits;
    const ver = verBits === 3 ? 1 : 2;
    const sr = MPEG_RATES[verBits][srIdx];
    const kbps = MPEG_BITRATES[ver][layer][brIdx];
    let len;
    let spf;
    if (layer === 1) { len = (Math.floor((12 * kbps * 1000) / sr) + pad) * 4; spf = 384; }
    else if (layer === 2) { len = Math.floor((144 * kbps * 1000) / sr) + pad; spf = 1152; }
    else { len = Math.floor(((ver === 1 ? 144 : 72) * kbps * 1000) / sr) + pad; spf = ver === 1 ? 1152 : 576; }
    if (len < 4) { i += 1; continue; }
    const head = buf.toString('latin1', i + 4, Math.min(i + 64, buf.length));
    const isInfo = frames === 0 && (head.includes('Xing') || head.includes('Info'));
    if (!isInfo) { samples += spf; frames += 1; }
    rate = sr;
    misses = 0;
    i += len;
  }
  return frames && rate ? samples / rate : null;
}

const round3 = (x) => Math.round(x * 1000) / 1000;
export { round3 };

/** The word key the kit matches narration against: lowercase `[a-z0-9-]`. */
export const wordKey = (w) => String(w).toLowerCase().replace(/[^a-z0-9-]/g, '');

/** ElevenLabs character alignment → words `{w, key, t0, t1}` (seconds from the clip start). */
export function wordsFromAlignment(al) {
  const chars = Array.isArray(al?.characters) ? al.characters : [];
  const s = Array.isArray(al?.character_start_times_seconds) ? al.character_start_times_seconds : [];
  const e = Array.isArray(al?.character_end_times_seconds) ? al.character_end_times_seconds : [];
  const out = [];
  let cur = null;
  chars.forEach((ch, i) => {
    const t0 = Number(s[i]);
    const t1 = Number(e[i]);
    if (/\s/.test(ch)) { if (cur) { out.push(cur); cur = null; } return; }
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) return;
    if (!cur) cur = { w: '', t0, t1 };
    cur.w += ch;
    cur.t1 = t1;
  });
  if (cur) out.push(cur);
  return out.map((w) => ({ w: w.w, key: wordKey(w.w), t0: round3(w.t0), t1: round3(w.t1) }));
}

/**
 * Word timing for a line nobody spoke (a silent video): `wps` words a second, longer words a
 * little longer, a breath after a comma and a sentence. Shaped like a TTS line.
 * @returns {{dur:number, speechStart:number, speechEnd:number, words:Array<{w,key,t0,t1}>}}
 */
export function estimateWords(text, wps = WORDS_PER_SEC.Lively) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  const lead = 0.05;
  const trail = 0.15;
  if (!tokens.length) return { dur: lead + trail, speechStart: lead, speechEnd: lead, words: [] };
  const weight = (w) => 0.6 + 0.4 * Math.min(2.5, wordKey(w).length / 5);
  const total = tokens.length / (wps > 0 ? wps : WORDS_PER_SEC.Lively);
  const sum = tokens.reduce((a, w) => a + weight(w), 0);
  const words = [];
  let t = lead;
  tokens.forEach((w, i) => {
    const d = (total * weight(w)) / sum;
    words.push({ w, key: wordKey(w), t0: round3(t), t1: round3(t + d) });
    t += d;
    if (i < tokens.length - 1) {
      if (/(\.\.\.|…)$/.test(w)) t += 0.35;
      else if (/[.!?]$/.test(w)) t += 0.3;
      else if (/[,;:]$/.test(w)) t += 0.15;
    }
  });
  const speechEnd = words[words.length - 1].t1;
  return { dur: round3(speechEnd + trail), speechStart: lead, speechEnd, words };
}

// ── voices ─────────────────────────────────────────────────────────────────────

const NARRATION_USE_RE = /narrat|informative|educational|advertis|news|commercial|explainer|promo/i;

const lc = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** An account voice (`/v2/voices`) → a candidate. */
export function voiceCandidate(v) {
  const labels = v?.labels && typeof v.labels === 'object' ? v.labels : {};
  return {
    id: String(v?.voice_id || ''), name: clip(v?.name, 80) || 'Voice', gender: lc(labels.gender), accent: lc(labels.accent),
    description: clip(labels.description || labels.descriptive || v?.description, 200),
    useCase: lc(labels.use_case || labels['use case'] || labels.usecase), previewUrl: v?.preview_url || null, source: 'account',
  };
}

/**
 * Filter by gender (`'either'` keeps all and interleaves female/male for variety) and rank
 * narration-like use cases first; otherwise the API's order stands. Pure.
 */
export function rankVoices(list, gender = 'either') {
  const score = (v) => (NARRATION_USE_RE.test(v.useCase || '') ? 0 : 1);
  const ranked = (xs) => xs.map((v, i) => ({ v, i })).sort((a, b) => score(a.v) - score(b.v) || a.i - b.i).map((x) => x.v);
  if (gender === 'female' || gender === 'male') return ranked(list.filter((v) => v.gender === gender));
  const f = ranked(list.filter((v) => v.gender === 'female'));
  const m = ranked(list.filter((v) => v.gender === 'male'));
  const rest = ranked(list.filter((v) => v.gender !== 'female' && v.gender !== 'male'));
  const out = [];
  for (let i = 0; i < Math.max(f.length, m.length); i += 1) {
    const pair = [f[i], m[i]].filter(Boolean).sort((a, b) => score(a) - score(b));
    out.push(...pair);
  }
  return [...out, ...rest];
}

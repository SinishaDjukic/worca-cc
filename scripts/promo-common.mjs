// scripts/promo-common.mjs — what the three promo video script cards share (promoVoices,
// promoNarrate, promoRender): the setup answers, the pipeline-dir layout, the ElevenLabs
// transport, and the timing helpers that replace afinfo (an MP3 frame counter, word timing
// from the TTS alignment or estimated from the pace).
//
// The ElevenLabs key is read from the ENVIRONMENT only (`ELEVENLABS_API_KEY`: the engine
// puts a key typed into the setup form there for script children, held in memory; otherwise
// it is the user's own variable). It travels in the `xi-api-key` header to the ElevenLabs
// API and nowhere else, and every message that could echo it goes through redactKey().
//
// Pure Node (no worca imports: a script child runs with WORCA_HOME stripped). The kit tools
// (assets/promo-kit/tools/*.mjs) are loaded lazily, at call time, so a card that never needs
// one never depends on it.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ELEVEN_BASE = 'https://api.elevenlabs.io';
export const KEY_ENV = 'ELEVENLABS_API_KEY';
/** Test/proxy override of the API origin. Environment only — never a param or a wire. */
export const BASE_ENV = 'WORCA_PROMO_ELEVENLABS_BASE';
/** Higher formats (mp3_44100_192, pcm_*) are refused on the lower tiers. */
export const OUTPUT_FORMAT = 'mp3_44100_128';
export const TTS_MODEL = 'eleven_multilingual_v2';

export const TONES = Object.freeze(['Playful', 'Professional', 'Bold', 'Calm']);
export const PACES = Object.freeze(['Relaxed', 'Lively', 'Fast']);
export const LENGTHS = Object.freeze([30, 60, 90, 150]);
/** Narration words per second by pace (the writer sizes the script with the same numbers). */
export const WORDS_PER_SEC = Object.freeze({ Relaxed: 2.2, Lively: 2.5, Fast: 2.8 });

export const DEFAULT_SETUP = Object.freeze({
  tone: 'Playful', lengthSec: 60, pace: 'Lively', mascots: true, mascotSource: 'design', mascotImage: null,
  mascotAmount: 40, narrated: false, voiceGender: 'either', music: true,
});

/** The kit's SFX names (assets/promo-kit/film/kit.js `F.SFX`) when the kit cannot be read. */
export const FALLBACK_SFX = Object.freeze(['whoosh', 'whoosh-short', 'swoosh-up', 'swish-down', 'pop', 'pop-high', 'bubble',
  'click', 'tap', 'type', 'boing', 'thud', 'squash', 'ding', 'success', 'sparkle', 'stamp', 'slide', 'zip', 'tick', 'step',
  'hop', 'land', 'snore', 'alarm', 'scratch', 'drumroll', 'confetti', 'lock', 'buzz', 'cash', 'chime', 'rise', 'impact',
  'wobble', 'blip']);

export const KIT_DIR_URL = new URL('../assets/promo-kit/', import.meta.url);
export const KIT_JS_URL = new URL('film/kit.js', KIT_DIR_URL);

/** One kit tool module, imported at call time (`find-tools`, `init-film`, `mix`, …). */
export async function loadKitTool(name) {
  return import(new URL(`tools/${name}.mjs`, KIT_DIR_URL).href);
}

// ── files ───────────────────────────────────────────────────────────────────────

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

export function readJson(path) {
  if (!path) return null;
  try { return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}

/** Write JSON atomically (tmp + rename), creating the folder. */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export function writeText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/** The pipeline-dir layout the lanes agreed on (`P/promo/…`). */
export function promoPaths(pipelineDir) {
  const promo = join(pipelineDir, 'promo');
  return {
    promo,
    setupPort: join(pipelineDir, 'promo-setup.json'),
    setupFile: join(promo, 'setup.json'),
    voicePort: join(pipelineDir, 'promo-voice.json'),
    voicesJson: join(promo, 'voices.json'),
    voicesDir: join(promo, 'voices'),
    script: join(promo, 'script.json'),
    product: join(promo, 'product.md'),
    timeline: join(promo, 'timeline.json'),
    film: join(promo, 'film'),
    filmHtml: join(promo, 'film', 'index.html'),
    vo: join(promo, 'audio', 'vo'),
    music: join(promo, 'audio', 'music'),
    sfx: join(promo, 'audio', 'sfx'),
    videoMd: join(promo, 'video.md'),
    // Indexed run artifacts: an `extraFiles` glob is ONE directory under the pipeline dir,
    // so the deliverables live at P/video/, not under P/promo/.
    video: join(pipelineDir, 'video'),
  };
}

/** The values of a form answers file: the `{form, version, values}` wrapper, a flat object, or a
 *  clarifier question list (`{questions: [{id, answer}]}`). null when there is nothing usable. */
export function answerValues(doc) {
  if (!isObject(doc)) return null;
  if (isObject(doc.values)) return doc.values;
  if (Array.isArray(doc.questions)) {
    const out = {};
    for (const q of doc.questions) if (isObject(q) && typeof q.id === 'string') out[q.id] = q.answer;
    return out;
  }
  return doc;
}

const pickCase = (value, list) => {
  const s = String(value ?? '').trim().toLowerCase();
  return list.find((x) => x.toLowerCase() === s) || null;
};
const bool = (v, dflt) => {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (['true', 'on', 'yes', '1'].includes(s)) return true;
  if (['false', 'off', 'no', '0'].includes(s)) return false;
  return dflt;
};

/** '30 s' | '60' | '2.5 min' | 90 → the nearest of 30/60/90/150 seconds. */
export function parseLength(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value).trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  const secs = /min/.test(s) ? n * 60 : n;
  return LENGTHS.reduce((best, x) => (Math.abs(x - secs) < Math.abs(best - secs) ? x : best), LENGTHS[0]);
}

/** Normalize setup values (any of the accepted shapes) onto DEFAULT_SETUP. Pure. */
export function normalizeSetup(values) {
  const v = isObject(values) ? values : {};
  const out = { ...DEFAULT_SETUP };
  out.tone = pickCase(v.tone, TONES) || out.tone;
  out.lengthSec = parseLength(v.length ?? v.lengthSec) || out.lengthSec;
  out.pace = pickCase(v.pace, PACES) || out.pace;
  out.mascots = bool(v.mascots, out.mascots);
  out.mascotSource = /attach/i.test(String(v.mascotSource ?? '')) ? 'attached' : 'design';
  out.mascotImage = typeof v.mascotImage === 'string' && v.mascotImage.trim() ? v.mascotImage.trim() : null;
  const amount = Number(v.mascotAmount);
  out.mascotAmount = Number.isFinite(amount) ? Math.max(0, Math.min(100, Math.round(amount))) : out.mascotAmount;
  out.narrated = typeof v.narrated === 'boolean' ? v.narrated : /^\s*narrat/i.test(String(v.audio ?? ''));
  const g = String(v.voiceGender ?? '').trim().toLowerCase();
  out.voiceGender = g.startsWith('f') ? 'female' : g.startsWith('m') ? 'male' : 'either';
  out.music = bool(v.music, out.music);
  return out;
}

/**
 * The setup answers: a bound answers input (`answersPath`) first, then the setup form's port
 * file `P/promo-setup.json`, then the agent's `P/promo/setup.json`; defaults when none reads.
 */
export function readSetup(pipelineDir, { answersPath = null } = {}) {
  const p = promoPaths(pipelineDir || '.');
  for (const file of [answersPath, p.setupPort, p.setupFile]) {
    if (!file) continue;
    const values = answerValues(readJson(file));
    if (values) return normalizeSetup(values);
  }
  return { ...DEFAULT_SETUP };
}

/** The kit's SFX names, read from kit.js `F.SFX = [...]`; FALLBACK_SFX when absent. */
export function kitSfxNames(kitJsPath = KIT_JS_URL) {
  try {
    const src = readFileSync(kitJsPath, 'utf8');
    const m = /F\.SFX\s*=\s*\[([\s\S]*?)\]/.exec(src);
    if (m) {
      const names = [...m[1].matchAll(/['"]([a-z0-9][a-z0-9-]*)['"]/g)].map((x) => x[1]);
      if (names.length) return [...new Set(names)];
    }
  } catch { /* the kit is not there: the built-in list */ }
  return [...FALLBACK_SFX];
}

// ── the key and the transport ────────────────────────────────────────────────────

/** The key from the environment, '' when there is none. */
export function elevenKey(env = process.env) {
  const v = env?.[KEY_ENV];
  return typeof v === 'string' ? v.trim() : '';
}

export function elevenBase(env = process.env) {
  const v = env?.[BASE_ENV];
  return (typeof v === 'string' && /^https?:\/\//.test(v.trim()) ? v.trim() : ELEVEN_BASE).replace(/\/+$/, '');
}

const KEY_SHAPE_RE = /\bsk_[A-Za-z0-9_]{20,}/g;

/** `text` with every occurrence of `key` — and anything shaped like an ElevenLabs key — masked. */
export function redactKey(text, key) {
  let s = text === undefined || text === null ? '' : String(text);
  if (typeof key === 'string' && key.length >= 4) s = s.split(key).join('[redacted]');
  return s.replace(KEY_SHAPE_RE, '[redacted]');
}

/** An ElevenLabs failure: `status` 0 for a network error, else the HTTP status; `code` from the body. */
export class ElevenError extends Error {
  constructor(message, { status = 0, code = null } = {}) {
    super(message);
    this.name = 'ElevenError';
    this.status = status;
    this.code = code;
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
 * message carries the method, the path (never a query, never the key) and the status.
 * @param {string} path '/v2/voices'
 * @param {{key:string, method?:string, body?:object, query?:object, fetchImpl?:Function, base?:string, timeoutMs?:number, accept?:string}} opts
 */
export async function elevenFetch(path, { key, method = 'GET', body, query, fetchImpl = globalThis.fetch, base = ELEVEN_BASE, timeoutMs = 120000, accept } = {}) {
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
  if (timeoutMs && typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(timeoutMs);
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
    const msg = d.message ? `: ${d.message.slice(0, 200)}` : '';
    throw new ElevenError(redactKey(`${where} → HTTP ${res.status}${d.code ? ` (${d.code})` : ''}${msg}`, key), { status: res.status, code: d.code });
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

/** A voice id as a file name. */
export const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'voice';

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

/** A card's report, written to every md output port the card allocated (they may share a file). */
export function writeReport(outputs, ports, text) {
  const seen = new Set();
  for (const id of ports) {
    const p = outputs?.[id]?.path;
    if (!p || seen.has(p)) continue;
    seen.add(p);
    writeText(p, text);
  }
}

/** True when a file exists and is not empty. */
export const present = (p) => {
  try { return existsSync(p) && statSync(p).size > 0; } catch { return false; }
};

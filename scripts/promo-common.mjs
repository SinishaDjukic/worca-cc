// scripts/promo-common.mjs — what the three promo video script cards share (promoVoices,
// promoNarrate, promoRender): the setup answers, the pipeline-dir layout, and the ElevenLabs
// key and origin readers. The ElevenLabs transport and the timing helpers that replace afinfo
// (an MP3 frame counter, word timing from the TTS alignment or estimated from the pace) live in
// src/core/elevenlabs.mjs; this file imports and re-exports them.
//
// The ElevenLabs key is read from the ENVIRONMENT only (`ELEVENLABS_API_KEY`: the engine
// puts a key typed into the setup form there for script children, held in memory; otherwise
// it is the user's own variable). It travels in the `xi-api-key` header to the ElevenLabs
// API and nowhere else, and every message that could echo it goes through redactKey().
//
// Its one worca import is src/core/elevenlabs.mjs, which is pure Node and imports nothing (a
// script child runs with WORCA_HOME stripped). The kit tools (assets/promo-kit/tools/*.mjs) are
// loaded lazily, at call time, so a card that never needs one never depends on it.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ELEVEN_BASE } from '../src/core/elevenlabs.mjs';

export {
  ELEVEN_BASE, OUTPUT_FORMAT, TTS_MODEL, WORDS_PER_SEC, ElevenError, retryable, accountRefusal, redactKey, elevenFetch,
  withRetry, fetchPublic, mp3Duration, round3, wordKey, wordsFromAlignment, estimateWords,
} from '../src/core/elevenlabs.mjs';

export const KEY_ENV = 'ELEVENLABS_API_KEY';
/** Test/proxy override of the API origin. Environment only — never a param or a wire. */
export const BASE_ENV = 'WORCA_PROMO_ELEVENLABS_BASE';

export const TONES = Object.freeze(['Playful', 'Professional', 'Bold', 'Calm']);
export const PACES = Object.freeze(['Relaxed', 'Lively', 'Fast']);
export const LENGTHS = Object.freeze([30, 60, 90, 150]);

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

// ── the key and the address ──────────────────────────────────────────────────────

/** The key from the environment, '' when there is none. */
export function elevenKey(env = process.env) {
  const v = env?.[KEY_ENV];
  return typeof v === 'string' ? v.trim() : '';
}

export function elevenBase(env = process.env) {
  const v = env?.[BASE_ENV];
  return (typeof v === 'string' && /^https?:\/\//.test(v.trim()) ? v.trim() : ELEVEN_BASE).replace(/\/+$/, '');
}

/** A voice id as a file name. */
export const safeId = (id) => String(id || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64) || 'voice';

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

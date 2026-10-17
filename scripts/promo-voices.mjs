// scripts/promo-voices.mjs — the `promoVoices` card: the voices a promo narrator can use, with a
// preview clip each, for the voice picker (promoVoice).
//
// Silent video, or no key in the environment → `{voices: []}` and a "skipped" report: the voice
// picker then asks nothing and the run goes on silent. Narrated with a key → the account's own
// voices (`GET /v2/voices`, which includes the premade ones every tier can use) filtered by the
// setup's voice choice, narration-like use cases first, topped up from the shared library
// (`GET /v1/shared-voices`) when fewer than six match; each voice's preview mp3 is downloaded to
// promo/voices/<id>.mp3 WITHOUT the key (preview URLs are public storage). Any ElevenLabs failure
// (bad key, no network) is `{voices: [], error}` and a clean finish — never a crashed run.
//
// Writes the `voices` port file and the agreed copy at promo/voices.json (the same document).
import { join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  readSetup, promoPaths, writeJson, elevenKey, elevenBase, elevenFetch, withRetry, fetchPublic, redactKey, safeId,
} from './promo-common.mjs';

export const MAX_VOICES = 6;
const NARRATION_USE_RE = /narrat|informative|educational|advertis|news|commercial|explainer|promo/i;

const lc = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const clip = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

/** An account voice (`/v2/voices`) → a candidate. */
function fromAccount(v) {
  const labels = v?.labels && typeof v.labels === 'object' ? v.labels : {};
  return {
    id: String(v?.voice_id || ''), name: clip(v?.name, 80) || 'Voice', gender: lc(labels.gender), accent: lc(labels.accent),
    description: clip(labels.description || labels.descriptive || v?.description, 200),
    useCase: lc(labels.use_case || labels['use case'] || labels.usecase), previewUrl: v?.preview_url || null, source: 'account',
  };
}

/** A shared-library voice (`/v1/shared-voices`) → a candidate. */
function fromLibrary(v) {
  return {
    id: String(v?.voice_id || ''), name: clip(v?.name, 80) || 'Voice', gender: lc(v?.gender), accent: lc(v?.accent),
    description: clip(v?.description || v?.descriptive, 200), useCase: lc(v?.use_case), previewUrl: v?.preview_url || null,
    source: 'library', publicOwnerId: typeof v?.public_owner_id === 'string' ? v.public_owner_id : null,
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

async function listAccount(call) {
  const out = [];
  let token = null;
  for (let page = 0; page < 3; page += 1) {
    const res = await call('/v2/voices', { page_size: 100, ...(token ? { next_page_token: token } : {}) });
    const j = await res.json();
    for (const v of Array.isArray(j?.voices) ? j.voices : []) out.push(fromAccount(v));
    token = j?.has_more && j?.next_page_token ? j.next_page_token : null;
    if (!token) break;
  }
  return out;
}

async function listLibrary(call, gender) {
  const res = await call('/v1/shared-voices', {
    page_size: 30, language: 'en', use_cases: ['narrative_story', 'advertisement', 'informative_educational'],
    ...(gender === 'female' || gender === 'male' ? { gender } : {}),
  });
  const j = await res.json();
  return (Array.isArray(j?.voices) ? j.voices : []).map(fromLibrary);
}

/** The voices document for a narrated run with a key. Throws an ElevenError on an account call failure. */
async function findVoices({ pipelineDir, gender, key, base, fetchImpl, sleep, log }) {
  const call = (path, query) => withRetry(() => elevenFetch(path, { key, query, fetchImpl, base }), { sleep });
  const account = rankVoices(await listAccount(call), gender).filter((v) => v.id && v.previewUrl);
  let pool = account;
  if (account.length < MAX_VOICES) {
    try {
      const lib = rankVoices(await listLibrary(call, gender), gender).filter((v) => v.id && v.previewUrl);
      const have = new Set(account.map((v) => v.id));
      pool = [...account, ...lib.filter((v) => !have.has(v.id))];
    } catch (e) {
      // The library is a top-up: the account's voices still stand.
      log('warn', `shared voice library unavailable: ${redactKey(e?.message || e, key)}`);
    }
  }
  const dir = promoPaths(pipelineDir).voicesDir;
  const voices = [];
  for (const v of pool) {
    if (voices.length >= MAX_VOICES) break;
    const buf = await fetchPublic(v.previewUrl, { fetchImpl });
    if (!buf) { log('warn', `no preview for voice ${v.name} (${v.id}) — left out`); continue; }
    const file = `${safeId(v.id)}.mp3`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), buf);
    const entry = { id: v.id, name: v.name, gender: v.gender, accent: v.accent, description: v.description, preview: `promo/voices/${file}`, source: v.source };
    if (v.source === 'library' && v.publicOwnerId) entry.publicOwnerId = v.publicOwnerId;
    voices.push(entry);
  }
  return voices;
}

/**
 * @param {object} api the node harness api
 * @param {{fetchImpl?:Function, env?:object, sleep?:Function}} [deps] injected in tests
 */
export default async function promoVoices(api, deps = {}) {
  const { inputs = {}, outputs = {}, ctx = {} } = api;
  const log = typeof api.log === 'function' ? api.log : () => {};
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const pipelineDir = ctx.pipelineDir || ctx.cwd || process.cwd();
  const paths = promoPaths(pipelineDir);
  const setup = readSetup(pipelineDir, { answersPath: inputs.answers?.path || null });
  const key = elevenKey(env);
  const doc = { version: 1, voices: [] };
  let summary;
  if (!setup.narrated) {
    doc.skipped = 'silent';
    summary = 'voices skipped (silent video)';
  } else if (!key) {
    doc.skipped = 'no-key';
    summary = 'voices skipped (no ElevenLabs API key in the environment) — the video will be silent';
  } else {
    try {
      doc.voices = await findVoices({ pipelineDir, gender: setup.voiceGender, key, base: elevenBase(env), fetchImpl, sleep: deps.sleep, log });
      if (!doc.voices.length) doc.error = 'no matching voice with a preview clip';
      summary = doc.voices.length
        ? `${doc.voices.length} voice${doc.voices.length === 1 ? '' : 's'} to choose from (${setup.voiceGender})`
        : `no voices found (${setup.voiceGender}) — the video will be silent`;
    } catch (e) {
      doc.voices = [];
      doc.error = redactKey(e?.message || String(e), key);
      summary = `voices unavailable (${doc.error}) — the video will be silent`;
    }
  }
  if (doc.error) log('warn', doc.error);
  writeJson(paths.voicesJson, doc);
  if (outputs.voices?.path) writeJson(outputs.voices.path, doc);
  return { summary: redactKey(summary, key) };
}

// src/core/demo-scenario.mjs — scripted mock answers for the extension demo video (tools/demo/extension-video).
// Active ONLY when WORCA_DEMO_SCENARIO names a JSON file AND the caller is already in mock mode; otherwise every
// function returns null and the mock answers as before. Shape:
//   { chunkMs?, ask: [{ match, title?, answer, usage?, costUsd? }], pinpoint: [{ match, explain?, alternatives? }] }
// `match` is a case-insensitive substring of the typed text (Ask) or the selected quote (Pinpoint); first entry wins.
import { readFileSync, statSync } from 'node:fs';

export const TITLE_PROMPT_PREFIX = 'Write the title for this task:';
let cache = { path: null, mtimeMs: 0, data: null };

/** The parsed scenario, or null (env unset, unreadable or malformed: the mock then answers as usual). */
export function loadDemoScenario(env = process.env) {
  const path = String(env.WORCA_DEMO_SCENARIO || '').trim();
  if (!path) return null;
  try {
    const { mtimeMs } = statSync(path);
    if (cache.path !== path || cache.mtimeMs !== mtimeMs) cache = { path, mtimeMs, data: normalize(JSON.parse(readFileSync(path, 'utf8'))) };
    return cache.data;
  } catch { return null; }
}

function normalize(raw) {
  const list = (v) => (Array.isArray(v) ? v : []).filter((e) => e && typeof e.match === 'string' && e.match.trim());
  const chunkMs = Number.isFinite(raw?.chunkMs) ? Math.min(Math.max(raw.chunkMs, 0), 2000) : 60;
  return { chunkMs, ask: list(raw?.ask).filter((e) => typeof e.answer === 'string'), pinpoint: list(raw?.pinpoint) };
}
const hit = (entries, text) => entries.find((e) => String(text || '').toLowerCase().includes(e.match.toLowerCase())) || null;

/** Ask: { answer, usage, costUsd, chunkMs } for the typed text, a { title } for Worca's title prompt, or null. */
export function demoAskReply(userText, env = process.env) {
  const sc = loadDemoScenario(env);
  if (!sc) return null;
  const text = String(userText || '').trim();
  if (text.startsWith(TITLE_PROMPT_PREFIX)) {
    const e = hit(sc.ask, text.slice(TITLE_PROMPT_PREFIX.length));
    return e && e.title ? { title: e.title } : null;
  }
  const e = hit(sc.ask, text.split(/\r?\n/).map((l) => l.trim()).find(Boolean));
  return e ? { answer: e.answer, usage: e.usage || null, costUsd: Number(e.costUsd) || 0, chunkMs: sc.chunkMs } : null;
}

/** Pinpoint: { explain?, alternatives?, chunkMs } for the selected quote, or null. */
export function demoPinpointReply(quote, env = process.env) {
  const sc = loadDemoScenario(env);
  const e = sc && hit(sc.pinpoint, quote);
  return e ? { explain: typeof e.explain === 'string' ? e.explain : null, alternatives: Array.isArray(e.alternatives) ? e.alternatives : null, chunkMs: sc.chunkMs } : null;
}

/** Split an answer into short word groups (3 words) for a natural stream. */
export function demoChunks(text, words = 3) {
  const w = String(text).match(/\S+\s*/g) || [];
  const out = [];
  for (let i = 0; i < w.length; i += words) out.push(w.slice(i, i + words).join(''));
  return out;
}

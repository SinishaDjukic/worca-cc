#!/usr/bin/env node
// Thin the film's SFX cue dump before mixing: five mascots walking at once must sound like a light patter, not a
// drum roll. Merges same-name cues that land close together, caps dense bursts, and adds global accents.
//   node promo-kit/tools/thin-cues.mjs --in cues.json --out cues-thin.json [--accent 12.5:chime:0.7 …]
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// merge windows (s) and gain ceilings per name; anything unlisted merges identical names within 45 ms
const MERGE = { step: 0.12, hop: 0.09, land: 0.09, tick: 0.07, blip: 0.08, pop: 0.06, 'pop-high': 0.06, sparkle: 0.15, tap: 0.06, click: 0.05 };
const CEIL = { step: 0.32, hop: 0.6, land: 0.6, tick: 0.5, sparkle: 0.55 };
const BG = new Set(['step', 'tick', 'blip', 'hop', 'land', 'tap', 'sparkle']);

/**
 * @param {Array<{t:number, name:string, gain?:number, pan?:number, dur?:number|null, rate?:number}>} cues
 * @param {{accents?: Array<{t:number, name:string, gain?:number}>}} [o] cues the music bed doesn't land (a final logo hit…)
 * @returns cues sorted by time (the input is not modified)
 */
export function thinCues(cues, { accents = [] } = {}) {
  const sorted = (cues || []).map((c) => ({ pan: 0, dur: null, rate: 1, ...c, gain: c.gain ?? 1 })).sort((a, b) => a.t - b.t);
  const out = [];
  const lastOf = new Map();
  for (const c of sorted) {
    const win = MERGE[c.name] ?? 0.045;
    const prev = lastOf.get(c.name);
    if (prev && c.t - prev.t < win) { prev.n++; prev.gain = Math.min(CEIL[c.name] ?? 1.2, Math.max(prev.gain, c.gain) * (1 + 0.12 / prev.n)); continue; }
    const k = { ...c, n: 1, gain: Math.min(CEIL[c.name] ?? 1.5, c.gain) };
    out.push(k); lastOf.set(c.name, k);
  }
  // dense bursts: more than 5 cues inside 250 ms → background kinds drop 6 dB there
  for (let i = 0; i < out.length; i++) {
    let n = 0; for (let j = i; j < out.length && out[j].t - out[i].t < 0.25; j++) n++;
    if (n > 5) for (let j = i; j < out.length && out[j].t - out[i].t < 0.25; j++) if (BG.has(out[j].name) && !out[j].ducked) { out[j].gain *= 0.5; out[j].ducked = true; }
  }
  for (const a of accents) out.push({ pan: 0, dur: null, rate: 1, gain: 1, ...a });
  out.sort((a, b) => a.t - b.t);
  return out.map(({ n, ducked, ...c }) => c);
}

const isMain = () => { try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } };
if (process.argv[1] && isMain()) {
  const argv = process.argv.slice(2);
  const arg = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined; };
  if (!arg('in') || !arg('out')) { console.error('usage: thin-cues.mjs --in cues.json --out cues-thin.json [--accent t:name:gain]'); process.exit(1); }
  const src = JSON.parse(readFileSync(arg('in'), 'utf8'));
  const accents = argv.flatMap((v, i) => (argv[i - 1] === '--accent' ? [v] : [])).map((s) => { const [t, name, gain] = s.split(':'); return { t: +t, name, gain: gain ? +gain : 1 }; });
  const list = Array.isArray(src) ? src : src.cues;
  const thin = thinCues(list, { accents });
  writeFileSync(arg('out'), JSON.stringify({ dur: src.dur, cues: thin }, null, 1));
  console.log(`${list.length} cues → ${thin.length} after thinning (+${accents.length} accents)`);
}

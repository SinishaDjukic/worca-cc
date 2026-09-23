// Human-hours estimator (money-saved design §4). PURE: no I/O, no builtin imports — shared by
// the orchestrator (per step), the backfill (per run) and, later, the browser. Every rule
// reads EVIDENCE of what a step produced; no agent key is ever consulted.

export const HUMAN_ESTIMATE_DEFAULTS = Object.freeze({
  codeBase: 0.5, codeFileH: 0.1, codeExp: 0.85, codeDiv: 25,        // 0.5 + 0.1·files + lines^0.85/25
  writeBase: 0.25, writeWph: 500, writeCapWords: 6000,              // 0.25 + min(words,6000)/500
  reviseFactor: 0.35, reviseDecay: 0.5,                             // write · 0.35 · 0.5^(cycle−1)
  jsonBase: 0.25, jsonItemH: 0.05,                                  // 0.25 + 0.05·items
  readLph: 300, readWph: 3000, rereadFactor: 0.3,                   // (lines/300 + words/3000) · (cycle>1 ? 0.3 : 1)
});

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Round hours to 2 dp (the unit the rate multiplies). */
export const roundHours = (h) => Math.round(((finite(h) ? h : 0) + Number.EPSILON) * 100) / 100;

/** Merge user overrides over the defaults: only finite, non-negative numbers for KNOWN keys apply. */
export function resolveConstants(overrides) {
  if (!overrides || typeof overrides !== 'object') return HUMAN_ESTIMATE_DEFAULTS;
  const out = { ...HUMAN_ESTIMATE_DEFAULTS };
  for (const key of Object.keys(HUMAN_ESTIMATE_DEFAULTS)) {
    const v = overrides[key];
    if (finite(v) && v >= 0) out[key] = v;
  }
  return out;
}

const FENCE_RE = /```[\s\S]*?```/g;

/** Words outside fenced code blocks. Plans embed whole files; a human would not have typed those. */
export function proseWords(text) {
  if (text == null) return 0;
  return String(text).replace(FENCE_RE, ' ').split(/\s+/).filter(Boolean).length;
}

/** Array length, else the first array-valued member's length, else the key count; 0 for scalars. */
export function jsonItems(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const arr = Object.values(value).find(Array.isArray);
  return arr ? arr.length : Object.keys(value).length;
}

/**
 * @param {object} evidence  see the module header in human-evidence.mjs for the collector
 * @param {object} [k]       resolved constants
 * @returns {{hours:number, signals:{code:number,write:number,revise:number,json:number,read:number}, method:'heuristic'|'override'|'none'}}
 */
export function estimateStepHours(evidence, k = HUMAN_ESTIMATE_DEFAULTS) {
  const signals = { code: 0, write: 0, revise: 0, json: 0, read: 0 };
  const e = evidence || {};
  const effort = e.agent?.humanEffort;
  if (effort && finite(effort.hours) && effort.hours >= 0) {
    return { hours: roundHours(effort.hours), signals, method: 'override' };
  }
  if (e.nodeKind !== 'agent' || !e.agent) return { hours: 0, signals, method: 'none' };
  const cycle = Number.isInteger(e.cycle) && e.cycle > 0 ? e.cycle : 1;

  // 3. code delta
  if (e.code) {
    const lines = (e.code.insertions | 0) + (e.code.deletions | 0);
    if (lines > 0) signals.code = k.codeBase + k.codeFileH * (e.code.files | 0) + Math.pow(lines, k.codeExp) / k.codeDiv;
  }
  // 4. prose: the LARGEST md output only (a plan plus its review note is one activity)
  const mds = (e.outputs || []).filter((o) => o && o.type === 'md');
  if (mds.length) {
    const top = mds.reduce((a, b) => ((b.words | 0) > (a.words | 0) ? b : a));
    const w = k.writeBase + Math.min(top.words | 0, k.writeCapWords) / k.writeWph;
    if (top.revision) signals.revise = w * k.reviseFactor * Math.pow(k.reviseDecay, cycle - 1);
    else signals.write = w;
  }
  // 5. structured outputs
  for (const o of e.outputs || []) {
    if (o && o.type === 'json') signals.json += k.jsonBase + k.jsonItemH * (o.items | 0);
  }
  // 6. reading (verifiers only)
  if (e.agent.runnerType === 'verifier' && e.reads) {
    const base = (e.reads.diffLines | 0) / k.readLph + (e.reads.words | 0) / k.readWph;
    signals.read = base * (cycle > 1 ? k.rereadFactor : 1);
  }
  // 7. total, scaled
  const factor = effort && finite(effort.factor) && effort.factor >= 0 ? effort.factor : 1;
  for (const s of Object.keys(signals)) signals[s] = roundHours(signals[s] * factor);
  const hours = roundHours(Object.values(signals).reduce((a, b) => a + b, 0));
  return { hours, signals, method: 'heuristic' };
}

/** Σ finite step.humanHours, 2 dp. Mirrors run-harness sumStepCosts. */
export function sumStepHours(steps) {
  let sum = 0;
  for (const s of Array.isArray(steps) ? steps : []) if (finite(s?.humanHours)) sum += s.humanHours;
  return roundHours(sum);
}

/** hours × rate − spent, 2 dp; negative is a real (honest) outcome. */
export function savedUsd(hours, rateUsd, spentUsd) {
  const v = (finite(hours) ? hours : 0) * (finite(rateUsd) ? rateUsd : 0) - (finite(spentUsd) ? spentUsd : 0);
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

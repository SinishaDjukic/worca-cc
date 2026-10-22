// src/shared/cost-tag-suggest.mjs — cost tag autocomplete order and the New run auto-fill (slice s2).
// Browser-safe, no I/O: the vocabulary and the policy dimensions are passed in.
import { parseTag } from './run-tags.mjs';
import { prefillTags } from './tag-dimensions.mjs';

const keyOf = (t) => parseTag(t).tag?.key || null;
const valueOf = (t) => parseTag(t).tag?.value || '';

/**
 * Key suggestions: required policy keys (policy order), then other policy keys, then this project's keys by use count.
 * @param {{ dims?: object[], vocab?: { keys?: {key:string,count:number,plain?:boolean,valued?:boolean}[] } }} o
 * @returns {{ key: string, valued: boolean, plain: boolean, source: 'required'|'policy'|'project' }[]}
 */
export function suggestKeys({ dims = [], vocab = null } = {}) {
  const used = new Map((vocab?.keys || []).map((k) => [k.key, k]));
  const out = []; const seen = new Set();
  const push = (key, source, valued, plain) => { if (seen.has(key)) return; seen.add(key); out.push({ key, valued, plain, source }); };
  for (const d of dims) if (d.required) push(d.key, 'required', true, false);
  for (const d of dims) if (!d.required) push(d.key, 'policy', true, false);
  const rest = [...used.values()].sort((a, b) => (b.count || 0) - (a.count || 0) || (a.key < b.key ? -1 : 1));
  for (const k of rest) push(k.key, 'project', k.valued !== false, !!k.plain);
  return out;
}

/** Value suggestions for one key: the policy's allowed list when it has one, else the values used with it, newest first. */
export function suggestValues({ key, dims = [], vocab = null } = {}) {
  const d = dims.find((x) => x.key === key);
  if (d && Array.isArray(d.values) && d.values.length) return d.values.slice();
  return [...((vocab?.values || {})[key] || [])]
    .sort((a, b) => String(b.lastAt || '').localeCompare(String(a.lastAt || '')) || (b.count || 0) - (a.count || 0))
    .map((v) => v.value);
}

/**
 * The New run / Ask card fill: the person's last tagged run in the project, else the project's defaults; values outside a
 * dimension's list are dropped, then the dimension slots are completed (project default → Default → last used).
 * @returns {{ tags: string[], from: 'last-run'|'defaults'|null }}
 */
export function autoFillTags({ dims = [], lastRun = [], projectDefaults = [] } = {}) {
  const from = lastRun.length ? 'last-run' : projectDefaults.length ? 'defaults' : null;
  const base = (lastRun.length ? lastRun : projectDefaults).filter((t) => {
    const d = dims.find((x) => x.key === keyOf(t));
    return !d || !d.values?.length || d.values.includes(valueOf(t));
  });
  return { tags: prefillTags(dims, base, { projectDefaults, lastUsed: lastRun }), from };
}

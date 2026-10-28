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
 * The New run / Ask card fill (#923): the project's defaults, values outside a dimension's list dropped, then the dimension
 * slots completed (project default → Default → the person's last value, mandatory dimensions only). The last run's other
 * tags are never copied.
 * @returns {{ tags: string[], from: 'defaults'|null }}
 */
export function autoFillTags({ dims = [], lastUsed = [], projectDefaults = [] } = {}) {
  const base = projectDefaults.filter((t) => {
    const d = dims.find((x) => x.key === keyOf(t));
    return !d || !d.values?.length || d.values.includes(valueOf(t));
  });
  return { tags: prefillTags(dims, base, { projectDefaults, lastUsed }), from: projectDefaults.length ? 'defaults' : null };
}

// src/shared/run-tags.mjs — run tags (#718): the ONE parser/normaliser. Browser-safe, no imports:
// the server, the CLI, the Ask validator and the web UI all read this module.
// A tag is written as `key:value` (parseTag/normaliseTags with { strict: true }); a plain `key` (value '')
// stored before that rule still reads, displays and filters, and a write may keep it (`keep`).
// One value per key per run (the last one wins), so a run's cost lands in exactly one row per key when spend is grouped.

export const MAX_TAGS = 20;
export const MAX_VALUE_LEN = 64;
export const TAG_KEY_RE = /^[a-z0-9][a-z0-9._-]{0,31}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

const squash = (s) => String(s).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/** The write-mode refusal for a bare key, free text or a key with a space. */
export const keyValueError = (raw) => `"${String(raw).trim()}": a tag is key:value, for example client:acme`;

/** One raw tag → { tag: { key, value } } or { error }. strict (writing): `key:value` only, a key is never dashed. */
export function parseTag(raw, { strict = false } = {}) {
  if (typeof raw !== 'string') return { error: 'a tag must be a string' };
  const i = raw.indexOf(':');
  const name = squash(i < 0 ? raw : raw.slice(0, i));
  if (strict && name && (i < 0 || name.includes(' '))) return { error: keyValueError(raw) };
  const key = name.replace(/ /g, '-');
  const value = i < 0 ? '' : squash(raw.slice(i + 1));
  if (!key) return { error: 'a tag needs a name' };
  if (!TAG_KEY_RE.test(key)) return { error: `"${key}": a tag name is letters, digits, ".", "_" or "-" (up to 32)` };
  if (i >= 0 && !value) return { error: `"${key}:" needs a value after the colon` };
  if (value.length > MAX_VALUE_LEN) return { error: `"${key}": a value is at most ${MAX_VALUE_LEN} characters` };
  if (CONTROL_RE.test(value)) return { error: `"${key}": a value cannot hold control characters` };
  return { tag: { key, value } };
}

/** { key, value } → 'key:value' | 'key'. */
export const formatTag = ({ key, value }) => (value ? `${key}:${value}` : key);

/**
 * A list from a request → { tags: string[] (sorted by key, one per key), errors: string[] }.
 * null/undefined = no tags. Any error means the caller must refuse the whole list.
 * strict: a write — every entry must be key:value, except one already stored on that run or source (`keep`).
 */
export function normaliseTags(list, { strict = false, keep = [] } = {}) {
  if (list == null) return { tags: [], errors: [] };
  if (!Array.isArray(list)) return { tags: [], errors: ['tags must be a list of strings'] };
  const kept = strict ? new Set(normaliseTags(keep).tags) : null;
  const byKey = new Map();
  const errors = [];
  for (const raw of list) {
    let r = parseTag(raw, { strict });
    if (r.error && kept) {
      // Grandfather only a stored tag sent back as stored (`Urgent` → `urgent`). The lenient parse dashes
      // spaces, so `hello world` would otherwise match a stored `hello-world`: that is new free text.
      const old = parseTag(raw);
      if (!old.error && kept.has(formatTag(old.tag)) && formatTag(old.tag) === squash(raw)) r = old;
    }
    if (r.error) errors.push(r.error);
    else byKey.set(r.tag.key, r.tag.value);
  }
  if (byKey.size > MAX_TAGS) errors.push(`at most ${MAX_TAGS} tags per run`);
  const tags = [...byKey].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => formatTag({ key, value }));
  return { tags, errors };
}

/** Does a normalised tag list match a query? 'client' = any client value, 'client:acme' = exact. */
export function hasTag(tags, query) {
  const q = parseTag(String(query || ''));
  if (q.error) return false;
  return (tags || []).some((t) => {
    const r = parseTag(t);
    return !r.error && r.tag.key === q.tag.key && (!String(query).includes(':') || r.tag.value === q.tag.value);
  });
}

/** Readable diff for the timeline: '+client:globex −client:acme'. */
export function describeTagChange(before, after) {
  const b = new Set(before || []); const a = new Set(after || []);
  const parts = [...a].filter((t) => !b.has(t)).map((t) => `+${t}`)
    .concat([...b].filter((t) => !a.has(t)).map((t) => `−${t}`));
  return parts.join(' ') || 'no change';
}

/** 'tag:client' → 'client'; anything else (incl. 'tag:' and a bad key) → null. */
export function parseTagGroupBy(groupBy) {
  const m = typeof groupBy === 'string' ? /^tag:(.+)$/.exec(groupBy) : null;
  return m && TAG_KEY_RE.test(m[1]) ? m[1] : null;
}

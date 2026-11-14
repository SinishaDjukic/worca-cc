// src/shared/model-vendor.mjs
// Who makes a model, for the server's picking facts (src/core/model-tiers.mjs) and the browser's model marks.

// The maker, from a model NAME (the upstream id when the entry has one, else the catalog id): a family word as its own token.
const ANTHROPIC_RE = /(^|[^a-z0-9])(anthropic|claude|opus|sonnet|haiku|fable)(?![a-z])/;
const OPENAI_RE = /(^|[^a-z0-9])(openai|chatgpt|gpt|codex|o[1-9])(?![a-z])/;

/** 'anthropic' | 'openai' | 'other'. A catalog row carries `upstreamModel`, an /api/models row `upstream.model`. */
export function vendorOf(row) {
  // An upstream id alone decides (a gateway alias like "sonnet-fast" may serve GLM): no family word there is `other`.
  const upstream = row.upstreamModel ?? row.upstream?.model;
  const up = typeof upstream === 'string' ? upstream.trim().toLowerCase() : '';
  const name = up || String(row.id ?? '').toLowerCase();
  if (ANTHROPIC_RE.test(name)) return 'anthropic';
  if (OPENAI_RE.test(name)) return 'openai';
  if (up) return 'other';
  // No family word: a harness's own sign-in names its maker (a raw id the claude CLI runs on its login is Claude's).
  const c = row.connection && typeof row.connection === 'object' ? row.connection : null;
  if (c && c.kind === 'signin') return c.engine === 'claude' ? 'anthropic' : c.engine === 'codex' ? 'openai' : 'other';
  return 'other';
}

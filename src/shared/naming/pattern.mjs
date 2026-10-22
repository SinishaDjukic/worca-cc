// src/shared/naming/pattern.mjs — browser-safe pattern, type and sanitize helpers for Smart run naming
// (docs/feature-flags.md). The server, the New run form and the tests all read this module.
export const PLACEHOLDERS = Object.freeze(['type', 'slug', 'ticket', 'id']);
export const DEFAULT_PATTERN = '{type}/{slug}';
export const PRESET_TYPES = Object.freeze(['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'perf', 'ci']);
export const DEFAULT_TYPES = Object.freeze(['feat', 'fix', 'chore', 'docs', 'refactor', 'test']);
export const TYPE_RE = /^[a-z][a-z0-9-]{0,15}$/;
export const MAX_BRANCH_LEN = 80;

/** Same rules as worktree.mjs sanitizeBranchName (pinned by test/naming-pattern.test.mjs). */
export function sanitizeRef(raw) {
  return String(raw ?? '').toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, '-').replace(/-{2,}/g, '-')
    .replace(/^[-/_.]+|[-/_.]+$/g, '').slice(0, MAX_BRANCH_LEN);
}

/** null when the pattern is usable, else a one-line reason. */
export function patternProblem(p) {
  if (typeof p !== 'string' || !p.trim()) return 'pattern is required';
  if (p.length > 60) return 'pattern is longer than 60 characters';
  const unknown = [...p.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).find((k) => !PLACEHOLDERS.includes(k));
  if (unknown !== undefined) return `unknown placeholder {${unknown}}`;
  if (!p.includes('{slug}')) return 'pattern must contain {slug}';
  if (/[^A-Za-z0-9{}/_.-]/.test(p)) return 'pattern may only use letters, digits, / _ . - and placeholders';
  return null;
}

/** A model/user type if allowed, else the first allowed type (the fallback). */
export function normalizeType(raw, types) {
  const t = String(raw ?? '').trim().toLowerCase();
  return types.includes(t) ? t : types[0];
}

const fill = (p, v) => p.replace(/\{(type|slug|ticket|id)\}/g, (_, k) => v[k]);
const tidy = (s) => s.split('/').map((seg) => seg.replace(/^[-_.]+|[-_.]+$/g, '')).filter(Boolean).join('/');

/** Render a pattern. Empty parts (no ticket) leave no dangling separators. The slug is cut to fit
 *  MAX_BRANCH_LEN so type, ticket and id always survive. */
export function renderPattern(pattern, { type = '', slug = '', ticket = '', id = '' } = {}) {
  const v = { type: sanitizeRef(type), slug: sanitizeRef(slug), ticket: sanitizeRef(ticket), id: sanitizeRef(id) };
  const room = MAX_BRANCH_LEN - (tidy(sanitizeRef(fill(pattern, { ...v, slug: 'x' }))).length - 1);
  v.slug = v.slug.slice(0, Math.max(room, 8)).replace(/-+$/, '');
  return sanitizeRef(tidy(sanitizeRef(fill(pattern, v))));
}

/** The final name for a config `{pattern, addRunId}`: {id} always renders; the switch appends -id only without it. */
export function renderBranch(cfg, parts) {
  const id = cfg.addRunId || cfg.pattern.includes('{id}') ? parts.id || '' : '';
  const name = renderPattern(cfg.pattern, { ...parts, id });
  return cfg.addRunId && !cfg.pattern.includes('{id}') && id ? sanitizeRef(`${name}-${id}`) : name;
}

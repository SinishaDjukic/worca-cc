// ui/public/export-slug.mjs
// Pure, DOM-free slug logic for the Export-to-Claude-Code modal, in its own module so
// it can be unit-tested (and drift-guarded against src/core/skills.mjs isValidSkillName)
// without importing the whole browser app. app.js imports exportSlugPreview from here.

// slugifyLocal(s) -> mirrors src/core/artifacts.mjs slugify so the export modal previews
// the same default slug the server would derive from a workflow name.
export function slugifyLocal(s) {
  const out = String(s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || 'untitled';
}

// exportSlugPreview(rawSlug, workflowName) -> { slug, preview, valid }
// An explicit slug is used verbatim (and must be a valid skill name); otherwise the
// workflow name is slugified and capped at 48. `preview` is the "/<slug>" the user types.
export function exportSlugPreview(rawSlug, workflowName) {
  const explicit = typeof rawSlug === 'string' && rawSlug.trim();
  const slug = explicit ? rawSlug.trim() : (slugifyLocal(workflowName).slice(0, 48) || 'workflow');
  // MUST stay in step with isValidSkillName in src/core/skills.mjs — the core's assertName
  // rejects on Apply what this reports invalid. skills.mjs pulls node:fs so it cannot be
  // imported in the browser; export-slug.test.mjs guards these two against drift.
  const valid = /^[A-Za-z0-9._-]+$/.test(slug) && slug !== '.' && slug !== '..';
  return { slug, preview: `/${slug}`, valid };
}

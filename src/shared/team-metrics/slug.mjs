// src/shared/team-metrics/slug.mjs — pure, no imports: used by metrics/*, policy/cache.mjs (a leaf that
// config.mjs imports, so it must not import metrics/sync.mjs), policy/sync.mjs, ask/*-proposal.mjs and the browser aggregate.

const VS_SLUG_RE = /^([a-z0-9][a-z0-9-]*)\.visualstudio\.com\/(.+)$/;
/**
 * Today's slug for a slug older code wrote for an Azure DevOps repo (M3); everything else unchanged. Idempotent.
 * "dev.azure.com/org/repo" (the https default-repo short form) → "dev.azure.com/org/repo/repo";
 * "org.visualstudio.com/[defaultcollection/]proj[/repo]" → "dev.azure.com/org/proj/(repo|proj)".
 * Segments are split explicitly: an optional "defaultcollection/" in a regex backtracks into the project.
 */
export function canonicalMetricsSlug(slug) {
  if (typeof slug !== 'string') return slug;
  const short = /^dev\.azure\.com\/([^/]+)\/([^/]+)$/.exec(slug);
  if (short) return `dev.azure.com/${short[1]}/${short[2]}/${short[2]}`;
  const vs = VS_SLUG_RE.exec(slug);
  if (!vs) return slug;
  let segs = vs[2].split('/').filter(Boolean);
  if (segs.length > 1 && segs[0] === 'defaultcollection') segs = segs.slice(1);
  if (segs.length === 1) segs = [segs[0], segs[0]];
  return segs.length === 2 ? `dev.azure.com/${vs[1]}/${segs[0]}/${segs[1]}` : slug;
}

/** Two stored/derived metrics or policy slugs name the same repository (case-insensitive, older Azure spellings folded). */
export function sameMetricsSlug(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  return canonicalMetricsSlug(a.toLowerCase()) === canonicalMetricsSlug(b.toLowerCase());
}

// Relative submodule URLs for the git-submodules detector. Pure; never throws. Absolute remotes are
// normalised by P1's keys.mjs `remoteSlug` — the function extract uses for every member's origin
// alias — so this file only resolves '../x' / './x' against a superproject's slug.
const trimSlashes = (s) => { let e = s.length; while (e > 0 && s[e - 1] === '/') e -= 1; return s.slice(0, e); };

/** Resolve a relative submodule URL ('../billing.git', './sub') against the superproject's slug
 *  (`remoteSlug(origin)`; git semantics: each '../' drops one trailing segment). null when the
 *  result would climb above the host. */
export function resolveRelativeRemote(baseSlug, rel) {
  if (typeof baseSlug !== 'string' || typeof rel !== 'string') return null;
  const segs = baseSlug.split('/');
  const parts = trimSlashes(rel.trim().replace(/\.git$/i, '')).split('/');
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') { if (segs.length <= 1) return null; segs.pop(); continue; }
    segs.push(p);
  }
  return segs.length > 1 ? segs.join('/').toLowerCase() : null;
}

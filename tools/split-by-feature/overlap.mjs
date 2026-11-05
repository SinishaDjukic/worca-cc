// tools/split-by-feature/overlap.mjs — can two Express route layers match the same request? (#919) Express 4 paths
// (`*`, `:id?`, `:id(re)`) and Express 5 ones (`*name`, `{/:id}`).
// Paths are { kind: 'string' | 'array' | 'regexp', value } descriptions; anything not a plain string is answered
// conservatively (true), so the planner pins and the checker reports rather than miss a swap.
export function describePath(p) {
  if (typeof p === 'string') return { kind: 'string', value: p };
  if (Array.isArray(p)) return { kind: 'array', value: p.map(describePath) };
  if (p instanceof RegExp || typeof p?.source === 'string') return { kind: 'regexp', value: `/${p.source}/${p.flags ?? ''}` };   // a routeTable keeps { source, flags }
  return { kind: 'regexp', value: String(p) };
}

/** A concrete path a string pattern matches (":id" → "x1"); null for anything else. */
export function probeOf(d) {
  if (!d || d.kind !== 'string' || !d.value.startsWith('/')) return null;
  return d.value.replace(/[{}]/g, '').replace(/:(\w+)(\([^)]*\))?\??/g, 'x1').replace(/\*\w*/g, 'x1');
}
export const routeRe = (p) => new RegExp('^' + p.replace(/[.+^$|[\]\\]/g, '\\$&').replace(/:(\w+)(\([^)]*\))?\??/g, '[^/]+').replace(/\*\w*/g, '.*')
  .replace(/\{/g, '(?:').replace(/\}/g, ')?') + '/?$', 'i');

export function pathsOverlap(a, b) {
  if (a.kind === 'array') return a.value.some((x) => pathsOverlap(x, b));
  if (b.kind === 'array') return b.value.some((y) => pathsOverlap(a, y));
  const pa = probeOf(a); const pb = probeOf(b);
  if (pa === null || pb === null) return true;
  return routeRe(b.value).test(pa) || routeRe(a.value).test(pb);
}
const verbsMeet = (a, b) => a.some((m) => m === '_all' || m === 'all' || b.includes(m) || b.includes('_all') || b.includes('all'));
/** Route vs route ({ methods, path }), or route vs middleware ({ re: { source, flags } }). */
export function canOverlap(a, b) {
  if (a.kind === 'mw' && b.kind === 'mw') return true;
  const [r, o] = a.kind === 'route' ? [a, b] : [b, a];
  if (o.kind === 'mw') return routeMeetsMw(r.path, o.re);
  return verbsMeet(r.methods, o.methods) && pathsOverlap(r.path, o.path);
}
/** A route path vs a middleware mount regexp. A param or wildcard can stand for any segment, so one probe
 * ("x1") cannot prove the two never meet (`/api/runs/:id` vs a `/api/runs/groups` mount): answer true. */
function routeMeetsMw(d, re) {
  if (d.kind === 'array') return d.value.some((x) => routeMeetsMw(x, re));
  if (!re || d.kind !== 'string' || /[:*(?{]/.test(d.value)) return true;   // !re: a mount that was not recorded
  return new RegExp(re.source, re.flags).test(d.value);
}

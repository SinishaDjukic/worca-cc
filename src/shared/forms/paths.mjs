// src/shared/forms/paths.mjs
// The one path language of ask forms (spec §3): `data.a.b` and `data.items[].id`.
// Used by `bind`, `enumFrom`, `defaultFrom` and `options.from`. No expressions, no
// indexes, no functions — a path either names a value or a column of values.

const PATH_RE = /^data(\.[A-Za-z_][A-Za-z0-9_]*(\[\])?)+$/;

export const isValidPath = (path) => typeof path === 'string' && path.length <= 200 && PATH_RE.test(path);

const segments = (path) => path.split('.').slice(1).map((part) => (
  part.endsWith('[]') ? { key: part.slice(0, -2), each: true } : { key: part, each: false }));

/** Resolve against `{ data }`. A path with a `[]` segment returns a flat array
 *  (missing branches contribute nothing); any other path returns the value or undefined. */
export function resolvePath(path, root) {
  if (!isValidPath(path)) return undefined;
  let cur = [root && root.data];
  let many = false;
  for (const { key, each } of segments(path)) {
    cur = cur.map((c) => (c !== null && typeof c === 'object' && !Array.isArray(c) && Object.hasOwn(c, key) ? c[key] : undefined));
    if (each) {
      many = true;
      cur = cur.flatMap((c) => (Array.isArray(c) ? c : []));
    }
  }
  return many ? cur.filter((c) => c !== undefined) : cur[0];
}

/** The schema a path lands on inside a data schema, or null when the path does not exist.
 *  An object with no `properties` is opaque: any path below it is accepted as `{}`. */
export function schemaAtPath(path, dataSchema) {
  if (!isValidPath(path)) return null;
  let cur = dataSchema;
  for (const { key, each } of segments(path)) {
    if (!cur || cur.type !== 'object') return null;
    if (!cur.properties) return {};
    cur = Object.hasOwn(cur.properties, key) ? cur.properties[key] : null;
    if (!cur) return null;
    if (each) {
      if (cur.type !== 'array' || !cur.items) return null;
      cur = cur.items;
    }
  }
  return cur || null;
}

export const pathInSchema = (path, dataSchema) => schemaAtPath(path, dataSchema) !== null;

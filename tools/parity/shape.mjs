// tools/parity/shape.mjs — #919 slice 2: the JSON "shape" of a response (types + keys, never values).
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const KEY_RE = /^[A-Za-z_$][\w$]{0,63}$/;   // identifier-like: a field name, not data
const ID_RE = /[0-9a-f]{8,}|[0-9a-f]{8}_[0-9a-f]{4}_/i; // a hex run or a uuid-like tail: an id used as a key
const MAX_KEYS = 50;
const isDataKey = (k) => !KEY_RE.test(k) || ID_RE.test(k);

function merge(a, b) {
  if (a === undefined) return b;
  if (JSON.stringify(a) === JSON.stringify(b)) return a;
  const obj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  if (obj(a) && obj(b)) {
    const out = {};
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
      out[k] = k in a && k in b ? merge(a[k], b[k]) : merge(a[k] ?? 'absent', b[k] ?? 'absent');
    }
    return out;
  }
  if (Array.isArray(a) && Array.isArray(b) && a[0] === 'array' && b[0] === 'array') {
    if (a[1] === 'empty') return b;
    if (b[1] === 'empty') return a;
    return ['array', merge(a[1], b[1])];
  }
  const parts = (x) => (typeof x === 'string' ? x.split('|') : [JSON.stringify(x)]);
  return [...new Set([...parts(a), ...parts(b)])].sort().join('|');
}

/** Shape of a parsed JSON value; `contentType` is used when the body was not JSON. */
export function shapeOf(value, contentType) {
  if (value === undefined) return `body:${String(contentType || 'none').split(';')[0].trim()}`;
  const t = typeOf(value);
  if (t === 'array') return ['array', value.length ? value.map((v) => shapeOf(v)).reduce(merge, undefined) : 'empty'];
  if (t !== 'object') return t;
  const keys = Object.keys(value);
  if (keys.length > MAX_KEYS || keys.some(isDataKey)) {
    return keys.length ? { '*': keys.map((k) => shapeOf(value[k])).reduce(merge, undefined) } : {};
  }
  const out = {};
  for (const k of keys.sort()) out[k] = shapeOf(value[k]);
  return out;
}

export const shapeKey = (value, contentType) => JSON.stringify(shapeOf(value, contentType));

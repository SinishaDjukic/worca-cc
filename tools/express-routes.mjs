// tools/express-routes.mjs — one route table for Express 4 and Express 5 (#919, #1049). dev is on Express 5 while PR
// branches that started before the split are still on 4, and the split, catch-up and parity tools read both: they read
// a tree's app only through recordMounts + routeTable, and compare paths only in normalizePath's spelling.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export const EXPRESS_MAJORS = Object.freeze([4, 5]);

/** The express major the tree at `root` loads (its own node_modules, never the tool's); throws for anything but 4 or 5. */
export function expressMajor(root) {
  const v = createRequire(resolve(root, 'package.json'))('express/package.json').version;
  const major = Number(String(v).split('.')[0]);
  if (!EXPRESS_MAJORS.includes(major)) throw new Error(`the route tools read Express 4 or 5 apps; found express ${v}`);
  return major;
}

/** A require() rooted in the express package the tree at `root` loads: what recordMounts takes. */
export const expressRequire = (root) => createRequire(createRequire(resolve(root, 'package.json')).resolve('express/package.json'));

/**
 * Records each middleware layer's mount path as it is registered, on the router prototype the tree's express uses
 * (Express 4: express/lib/router; Express 5: the router package). Express 5 layers keep no mount path at all, and
 * Express 4 keeps only a regexp. Call it before the app registers anything. `req` requires from the express package.
 * Self-contained (no imports, no module scope): tools/parity/routes.mjs inlines its source into a target's own node.
 */
export function recordMounts(req) {
  const major = Number(String(req('./package.json').version).split('.')[0]);
  const proto = major === 4 ? req('./lib/router') : req('router').prototype;
  if (proto.use.recordsMounts) return major;
  const use = proto.use;
  proto.use = function useRecordingMounts(fn, ...rest) {
    let arg = fn;
    while (Array.isArray(arg) && arg.length) arg = arg[0];
    const path = typeof arg === 'function' ? '/' : fn;   // the router's own rule: a first argument that is not a function is the path
    const n = this.stack.length;
    const out = use.call(this, fn, ...rest);
    for (const l of this.stack.slice(n)) l.mountPath = path;
    return out;
  };
  proto.use.recordsMounts = true;
  return major;
}

/**
 * The app's layers in order, the same shape on Express 4 and 5: { name, mount, route, handler, stack }. `mount` is the
 * recorded path of a middleware layer ('/' when it has none; null when recordMounts did not run), `route` is
 * { path, methods, handlers }, `stack` a nested router's own table. A RegExp path is { source, flags }. `fnKey` maps a
 * handler to what the caller keeps (a hash, or nothing). Express 4's own query and expressInit layers are left out:
 * Express 5 has none. Self-contained, like recordMounts.
 */
export function routeTable(app, fnKey = () => undefined) {
  const p = (x) => (x instanceof RegExp ? { source: x.source, flags: x.flags } : Array.isArray(x) ? x.map(p) : x);
  const table = (stack) => stack.map((l) => (l.route
    ? { name: l.name, route: { path: p(l.route.path), methods: { ...l.route.methods }, handlers: l.route.stack.map((s) => fnKey(s.handle)) } }
    : { name: l.name, mount: l.mountPath === undefined ? null : p(l.mountPath), handler: fnKey(l.handle),
      stack: l.handle && Array.isArray(l.handle.stack) ? table(l.handle.stack) : undefined }));
  if (app._router) return table(app._router.stack.filter((l, i) => !(i < 2 && (l.name === 'query' || l.name === 'expressInit'))));
  return table(app.router.stack);                   // Express 5 (on Express 4, app.router throws)
}

/**
 * One spelling of a route path for both majors, so a 4 tree and a 5 tree compare: a wildcard is `*` whatever its name
 * (Express 4 `*`, Express 5 `*splat`), an optional segment is `{/:p}` (Express 4 `/:p?`). Anything else is kept.
 */
export function normalizePath(p) {
  if (Array.isArray(p)) return p.map(normalizePath);
  if (typeof p !== 'string') return p;
  return p.replace(/\/:(\w+)\?/g, '{/:$1}').replace(/\*[A-Za-z_$][\w$]*/g, '*');
}

/**
 * A middleware mount → the mount regexp source Express 4 builds for it (`/api/x` → `^\/api\/x\/?(?=\/|$)`, `/:id` →
 * `(?:\/([^/]+?))`), so middleware keys and overlap checks read the same on both majors. A RegExp mount keeps its own
 * source; null (not recorded) and anything else give null.
 */
export function mountSource(mount) {
  if (mount === '/') return '^\\/?(?=\\/|$)';
  if (mount && typeof mount === 'object' && !Array.isArray(mount) && typeof mount.source === 'string') return mount.source;
  if (Array.isArray(mount)) { const s = mount.map(mountSource); return s.every((x) => typeof x === 'string') ? s.map((x) => `(?:${x})`).join('|') : null; }
  if (typeof mount !== 'string') return null;
  const body = mount.replace(/\/+$/, '').split(/(\/:\w+)/)
    .map((s) => (/^\/:\w+$/.test(s) ? '(?:\\/([^/]+?))' : s.replace(/[.+*?^${}()|[\]\\/]/g, '\\$&'))).join('');
  return `^${body}\\/?(?=\\/|$)`;
}

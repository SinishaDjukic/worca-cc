// tools/split-by-feature/equivalence.mjs — compare an original and a split tree (#919 s1).
//   node tools/split-by-feature/equivalence.mjs --dump ROOT PROBES.json   → JSON of the app's layers and served output
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { describePath, canOverlap } from './overlap.mjs';
import { recordMounts, expressRequire, routeTable, normalizePath, mountSource } from '../express-routes.mjs';
import { readPartsManifest } from '../../src/core/public-assets.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
// The asset layer is the root-mounted static only; a scoped serveStatic (`/src/shared`) is ordinary middleware.
export const isUnscopedStatic = (l) => l.kind === 'mw' && l.name === 'serveStatic' && l.fastSlash === true;
const isAsset = (l) => isUnscopedStatic(l) || (l.kind === 'mw' && (l.name === 'serveStyleCss' || l.name === 'servePublic'));
// Accepted served deltas (D10, D23): the probe key, and the only before → after change that is allowed for it.
const rawShellToRendered = (b, a) => b.status === 200 && b.csp === null && a.status === 200 && a.csp !== null;
export const ACCEPTED_SERVED_DELTAS = Object.freeze({ 'GET //index.html': rawShellToRendered, 'GET /%69ndex.html': rawShellToRendered });
export const ACCEPTED_HEADER_DELTAS = ['/style.css: ETag value is a body hash instead of size-mtime', '/style.css: a Range request gets 200 with the full body instead of 206'];
const ENV_ALLOW = ['PATH', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SystemRoot'];

/** The only environment a dry-run child sees: an allowlist of the parent's plus the sandbox. */
export function childEnv(home, extra = {}) {
  const env = { HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_MOCK: '1', WORCA_TEST_ALLOW_HOME_FALLBACK: '1', PORT: '0', ...extra };
  for (const k of ENV_ALLOW) if (process.env[k] !== undefined) env[k] = process.env[k];
  return env;
}

/** The probe list, built from the split tree's manifest and run against both trees. */
export function probesFor(manifest) {
  const p = [['GET', '/style.css'], ['HEAD', '/style.css'], ['GET', '/Style.css'], ['GET', '//style.css'], ['GET', '/%73tyle.css'],
    ['GET', '/style.css/'], ['GET', '/'], ['GET', '/index.html'], ['GET', '//index.html'], ['GET', '/%69ndex.html'],
    ['GET', '/no-such-page'], ['GET', '/parts.json'], ['GET', '/%E0%A4%A'], ['GET', '/app.js']];
  for (const rel of [...manifest.css, ...manifest.html]) {
    p.push(['GET', `/${rel}`], ['GET', `//${rel}`], ['GET', `/${rel.toUpperCase()}`]);
    if (rel.endsWith('.html')) p.push(['GET', `/${rel.slice(0, -'.html'.length)}`]);
  }
  for (const d of manifest.dirs) p.push(['GET', `/${d}`], ['GET', `/${d}/`]);
  return p;
}

const record = async (res, method) => ({
  status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'),
  csp: res.headers.get('content-security-policy'), location: res.headers.get('location'),
  etag: res.headers.has('etag'), lastModified: res.headers.has('last-modified'),
  sha: sha(method === 'HEAD' ? '' : await res.text()),
});

/** A routeTable (tools/express-routes.mjs) → the compared layers. Paths in normalizePath's spelling and middleware mounts as
 *  Express 4's mount regexp, so an Express 4 tree and an Express 5 tree compare. */
export const layersOf = (table) => table.map((l) => (l.route
  ? { kind: 'route', path: describePath(normalizePath(l.route.path)), methods: Object.keys(l.route.methods).sort(), handlers: l.route.handlers }
  : { kind: 'mw', name: l.name, fastSlash: l.mount === '/', re: mountSource(l.mount) === null ? null : { source: mountSource(l.mount), flags: 'i' }, handler: l.handler }));

export async function dumpApp(root, probes) {
  recordMounts(expressRequire(root));                                                      // Express 4 or 5, before the app registers
  const { app, server } = await import(pathToFileURL(join(root, 'ui/server.mjs')).href);   // listens only when run as main
  const layers = layersOf(routeTable(app, (f) => sha(f.toString())));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (p, o = {}) => fetch(base + p, { redirect: 'manual', ...o });
  const served = {};
  for (const [method, p] of probes) served[`${method} ${p}`] = await record(await get(p, { method }), method);
  // conditional GET: each tree's own validators must give 304, as express.static did
  const css = await get('/style.css');
  served['GET /style.css If-None-Match'] = { status: (await get('/style.css', { headers: { 'if-none-match': css.headers.get('etag') } })).status };
  served['GET /style.css If-Modified-Since'] = { status: (await get('/style.css', { headers: { 'if-modified-since': css.headers.get('last-modified') } })).status };
  // the shell under non-default theme, UI level and flag (each through the app's own API; origin passes the origin check)
  const json = (method, p, body) => get(p, { method, headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body) });
  for (const [label, method, p, body] of [['dark', 'POST', '/api/settings', { theme: 'dark' }], ['advanced', 'POST', '/api/settings', { uiLevel: 'advanced' }],
    ['flagsDemo', 'PATCH', '/api/flags', { flagsDemo: true }]]) {
    const r = await json(method, p, body);
    if (r.status >= 300) throw new Error(`probe setup failed: ${method} ${p} → ${r.status}`);
    served[`GET / (${label})`] = await record(await get('/'), 'GET');
    served[`GET /index.html (${label})`] = await record(await get('/index.html'), 'GET');
  }
  server.close();
  return { layers, served };
}

export function dumpInChild(root, probes, home) {
  const dir = mkdtempSync(join(tmpdir(), 'split-probes-'));
  try {
    writeFileSync(join(dir, 'probes.json'), JSON.stringify(probes));
    const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url), '--dump', root, join(dir, 'probes.json')],
      { env: childEnv(home()), cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, timeout: 180_000 });
    return JSON.parse(out.slice(out.indexOf('{"layers"')));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const routeKey = (l) => `r ${l.methods.join(',')} ${JSON.stringify(l.path)} ${l.handlers.join(',')}`;
const layerKey = (l) => (l.kind === 'route' ? routeKey(l) : `m ${l.name} ${l.re?.source ?? 'unknown mount'} ${l.handler}`);

/** Layers that take part in the comparison (asset layers are checked by position), each with a unique key. */
function keyed(layers) {
  const seen = new Map();
  return layers.filter((l) => !isAsset(l)).map((l) => {
    const k = layerKey(l); const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    return { key: `${k}#${n}`, layer: l };
  });
}

export function compareDumps(before, after) {
  const problems = []; const acceptedDeltas = [];
  // asset layers: exactly one unscoped serveStatic before; after, serveStyleCss at its index and servePublic next
  const idx = (ls, pred) => ls.reduce((a, l, i) => (pred(l) ? [...a, i] : a), []);
  const named = (name) => (l) => l.kind === 'mw' && l.name === name;
  const sb = idx(before.layers, isUnscopedStatic);
  const sa = idx(after.layers, isUnscopedStatic); const sc = idx(after.layers, named('serveStyleCss')); const sp = idx(after.layers, named('servePublic'));
  if (sb.length !== 1) problems.push(`original tree: expected 1 unscoped serveStatic, found ${sb.length}`);
  else if (!sc.length && !sp.length) {                                                  // an unsplit tree (compared with itself)
    if (sa.length !== 1 || sa[0] !== sb[0]) problems.push(`asset middleware moved: serveStatic@${sb[0]} → serveStatic@${sa.join(',')}`);
  } else if (sa.length || sc.length !== 1 || sp.length !== 1 || sc[0] !== sb[0] || sp[0] !== sb[0] + 1) {
    problems.push(`asset middleware moved: serveStatic@${sb[0]} → serveStyleCss@${sc.join(',')}, servePublic@${sp.join(',')}, unscoped serveStatic@${sa.join(',')}`);
  }
  const kb = keyed(before.layers); const ka = keyed(after.layers);
  const rb = kb.filter((x) => x.layer.kind === 'route').map((x) => x.key).sort();
  const ra = ka.filter((x) => x.layer.kind === 'route').map((x) => x.key).sort();
  if (rb.join('\n') !== ra.join('\n')) problems.push(`route layers differ: ${diffSorted(rb, ra).slice(0, 10).join('; ')}`);
  const mb = kb.filter((x) => x.layer.kind === 'mw').map((x) => x.key);
  const ma = ka.filter((x) => x.layer.kind === 'mw').map((x) => x.key);
  if (mb.join('\n') !== ma.join('\n')) problems.push(`middleware sequence differs: ${diffSorted(mb, ma).slice(0, 10).join('; ')}`);
  const posA = new Map(ka.map((x, i) => [x.key, i]));
  const common = kb.map((x, i) => ({ ...x, b: i, a: posA.get(x.key) })).filter((x) => x.a !== undefined);
  for (let x = 0; x < common.length; x++) for (let y = x + 1; y < common.length; y++) {
    const [p, q] = [common[x], common[y]];                      // p is before q in the original
    if (p.a < q.a) continue;
    if (canOverlap(p.layer, q.layer)) problems.push(`order flip between overlapping layers: ${p.key} / ${q.key}`);
  }
  for (const k of Object.keys(before.served)) {
    const b = before.served[k]; const a = after.served[k];
    if (JSON.stringify(b) === JSON.stringify(a)) continue;
    if (a && ACCEPTED_SERVED_DELTAS[k]?.(b, a)) acceptedDeltas.push({ probe: k, before: b, after: a });
    else problems.push(`served output differs: ${k}`);
  }
  for (const k of ['GET /style.css']) if (before.served[k]?.status !== 200) problems.push(`${k} answered ${before.served[k]?.status} on the original tree`);
  return { equal: problems.length === 0, problems, acceptedDeltas };
}

// compareTrees is synchronous (dumpInChild uses execFileSync). Callers that clean up `home` dirs in a `finally`
// rely on that; if it ever becomes async they must `return await` it.
export function compareTrees(beforeRoot, afterRoot, { home }) {
  const probes = probesFor(readPartsManifest(join(afterRoot, 'ui/public')) ?? { css: [], html: [], dirs: [] });   // null on an unsplit dir
  const before = dumpInChild(beforeRoot, probes, home); const after = dumpInChild(afterRoot, probes, home);
  const r = compareDumps(before, after);
  const split = after.layers.some((l) => l.kind === 'mw' && l.name === 'serveStyleCss');
  return { ...r, acceptedDeltas: [...r.acceptedDeltas, ...(split ? ACCEPTED_HEADER_DELTAS.map((note) => ({ note })) : [])],
    probes: Object.keys(before.served).length, routes: before.layers.filter((l) => l.kind === 'route').length };
}

function diffSorted(a, b) { const sb = new Set(b); const sa = new Set(a); return [...a.filter((x) => !sb.has(x)).map((x) => '-' + x), ...b.filter((x) => !sa.has(x)).map((x) => '+' + x)]; }

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--dump') {
  const d = await dumpApp(process.argv[3], JSON.parse(readFileSync(process.argv[4], 'utf8')));
  // exit only after the pipe drained: macOS stdout pipes are async, and an early exit truncates at 64 KiB
  process.stdout.write(JSON.stringify(d) + '\n', () => process.exit(0));
}

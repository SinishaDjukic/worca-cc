#!/usr/bin/env node
// tools/split-by-feature.mjs — #919: split ui/server.mjs routes, ui/public/style.css and ui/public/index.html
// into per-feature files. Pure planner + writer; same input → same output (no clocks, sorted output).
//   --check [--stats]          plan only; exit 1 on any problem (unmapped, new pin, over cap, missing part, gate)
//   --apply                    write the split into --root (default: cwd) on a clean checkout; a split tree: 0 files changed
//   --dry-run [--json F] [--tests safety|none]
//                              git archive HEAD → temp dirs, apply in one, tree hash, second apply, equivalence, tests
//   --write-caps               rewrite tools/split-by-feature/size-caps.json (only lowers, drops or adds)
//   --root D                   the repo root to read, feature map, pin baseline and size caps included (default: cwd)
// Every mode checks Express 4 first (it reads app._router) and exits 1 otherwise.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, realpathSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir, devNull } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { loadMap } from './split-by-feature/plan.mjs';
import { planRoutes, emitRouteFile, orderFlips, leadStart, CAP, FALLBACK_ANCHOR } from './split-by-feature/routes.mjs';
import { splitCss, lineCount } from './split-by-feature/css.mjs';
import { splitHtml } from './split-by-feature/html.mjs';
import { readPartsManifest } from '../src/core/public-assets.mjs';
import { compareTrees, childEnv } from './split-by-feature/equivalence.mjs';

export const MIGRATION_VERSION = 1;
export const SPIKE_GATE = Object.freeze({ movedShare: 0.95 });   // and ui/server.mjs within its ceiling in size-caps.json
const PINNED_REL = 'tools/split-by-feature/pinned.json';
const CAPS_REL = 'tools/split-by-feature/size-caps.json';

export function assertExpress4(root) {
  const v = createRequire(join(root, 'package.json'))('express/package.json').version;
  if (!v.startsWith('4.')) throw new Error(`split-by-feature v${MIGRATION_VERSION} reads app._router (Express 4); found express ${v}`);
}

/** Everything --apply would write, plus problems and stats. No I/O beyond reading the inputs. */
export function planSplit({ root, serverSrc, css, html, mapText } = {}) {
  const ui = (p) => join(root, 'ui', p);
  if (existsSync(ui('public/parts.json')) && serverSrc === undefined) {
    try { readPartsManifest(ui('public')); return { alreadySplit: true, problems: [], files: new Map() }; }
    catch (err) { return { alreadySplit: true, problems: [`${err.message} (ui/public/parts.json:1)`], files: new Map() }; }
  }
  serverSrc ??= readFileSync(ui('server.mjs'), 'utf8');
  css ??= readFileSync(ui('public/style.css'), 'utf8');
  html ??= readFileSync(ui('public/index.html'), 'utf8');
  let map;
  try { map = loadMap(root, mapText); } catch (err) { return { problems: err.problems ?? [err.message], files: new Map() }; }

  const forced = new Map();                                // order pins (D6); each round only adds to it
  const keepCentral = new Set();                           // shared helpers of a component too big for one file
  let routes = planRoutes(serverSrc, map); let files;
  for (let round = 0; ; round++) {
    files = packFiles(routes, map);
    const flips = orderFlips(routes, files);
    const split = splitHelpers(routes, files.oversized);
    if (!flips.size && !split.length) break;
    if (round >= 50) throw new Error('split: order pins did not settle after 50 rounds');
    for (const [i, why] of flips) forced.set(i, why);
    for (const i of split) keepCentral.add(i);
    routes = planRoutes(serverSrc, map, { forced, keepCentral });
  }
  const c = splitCss(css, map); const h = splitHtml(html, map);
  const problems = [...routes.problems, ...c.problems, ...h.problems];
  if (mapText === undefined) {
    const baseline = new Set(JSON.parse(readFileSync(join(root, PINNED_REL), 'utf8')).map((p) => p.key));
    for (const p of routes.pins) if (!baseline.has(p.key)) problems.push(`new pin: ${p.key} — ${p.reason} (ui/server.mjs:${p.line})`);
  }
  const out = new Map();                                   // repo-relative path → text (null = delete)
  const routeFiles = [];
  for (const f of files) {
    const doc = map.features.find((x) => x.name === f.feature).doc;
    const r = emitRouteFile({ name: f.name, feature: f.feature, doc, version: MIGRATION_VERSION, stmtIdx: f.stmtIdx, plan: routes });
    if (lineCount(r.text) > CAP) problems.push(`over cap: ${r.file} would be ${lineCount(r.text)} lines (ui/server.mjs:${r.firstLine})`);
    out.set(r.file, r.text); routeFiles.push({ ...f, fromServer: r.fromServer });
  }
  for (const p of [...c.parts, ...h.parts]) {
    if (existsSync(ui(`public/${p.file}`))) problems.push(`part ${p.file} would overwrite an existing file (ui/public/${p.file}:1)`);
  }
  if (problems.length) return { problems, files: out, pins: routes.pins, routes, css: c.parts, html: h.parts };   // nothing to patch
  const existing = new Set(readdirSync(ui('public'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name));
  const parts = [...c.parts, ...h.parts];
  for (const p of parts) out.set(`ui/public/${p.file}`, p.text);
  const dirs = [...new Set(parts.map((p) => p.feature))].filter((d) => !existing.has(d)).sort();
  out.set('ui/public/parts.json', JSON.stringify({ version: MIGRATION_VERSION, css: c.parts.map((p) => p.file), html: h.parts.map((p) => p.file), dirs }, null, 2) + '\n');
  out.set('ui/public/style.css', null); out.set('ui/public/index.html', null);
  out.set('ui/routes/index.mjs', routeIndex(routeFiles, routes));
  const server = patchServer(serverSrc, routes, routeFiles);  // removals, exports, imports, registration, assets
  out.set('ui/server.mjs', server);
  for (const [p, t] of patchDocsAndPackage(root, c.parts, out, map)) out.set(p, t);  // package.json files, docs/design-system.md:10, docs/feature-files.md, size-caps.json
  const regionRoutes = routes.routeInfo.size;
  const stats = { regionRoutes, movedRoutes: [...routes.routeInfo.keys()].filter((i) => routes.group.has(i)).length,
    pinnedRoutes: routes.pins.length, serverLinesAfter: lineCount(server) };
  stats.movedShare = regionRoutes ? stats.movedRoutes / regionRoutes : 1;
  return { problems, files: out, pins: routes.pins, routes, css: c.parts, html: h.parts, stats };
}

/**
 * A component over the cap cannot land in one file. Its declarations with more than one user stay central (they
 * are imported from ../server.mjs instead), which breaks the component apart on the next round.
 */
export function splitHelpers(plan, oversized = []) {
  const out = [];
  for (const comp of oversized) for (const i of comp) {
    if (plan.routeInfo.has(i)) continue;
    if ((plan.usersOf.get(i)?.size ?? 0) > 1) out.push(i);
  }
  return out;
}

const HEAD_SLACK = 2;                                     // the real head names the feature and its doc: a little longer
/**
 * Moved statements → route files. Statements of one group join into components through their declaration edges
 * (a helper always lands with every user), components pack in source order into files of at most CAP lines, and
 * a feature's files are named f, f-2, … in segment, then source order. Sorted by segment, then name: the
 * ROUTE_SEGMENTS order.
 */
export function packFiles(plan, map) {
  const { group, uses, declStmt } = plan;
  const parent = new Map([...group.keys()].map((i) => [i, i]));
  const find = (i) => { while (parent.get(i) !== i) { parent.set(i, parent.get(parent.get(i))); i = parent.get(i); } return i; };
  for (const [i, g] of group) for (const v of uses[i]) {
    const d = declStmt.get(v);
    if (d !== i && group.get(d) === g) { const a = find(i); const b = find(d); if (a !== b) parent.set(Math.max(a, b), Math.min(a, b)); }
  }
  const comps = new Map();                                 // root → sorted stmt indices
  for (const i of [...group.keys()].sort((a, b) => a - b)) {
    const r = find(i);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r).push(i);
  }
  const byGroup = new Map();                               // group → components in order of first statement
  for (const c of [...comps.values()].sort((a, b) => a[0] - b[0])) {
    const g = group.get(c[0]);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(c);
  }
  // The size of the file a statement list would emit: its statements plus its own import head.
  const fileLines = (stmtIdx) => lineCount(emitRouteFile({ name: 'x', feature: 'x', doc: null, version: MIGRATION_VERSION,
    stmtIdx: [...stmtIdx].sort((a, b) => a - b), plan }).text);
  const chunks = [];                                       // { feature, segment, stmtIdx }
  const oversized = [];                                    // components over the cap on their own
  for (const [g, list] of byGroup) {
    const [feature, seg] = [g.slice(0, g.lastIndexOf('#')), Number(g.slice(g.lastIndexOf('#') + 1))];
    let cur = null;
    for (const c of list) {
      if (fileLines(c) > CAP - HEAD_SLACK) oversized.push(c);
      if (!cur || fileLines([...cur.stmtIdx, ...c]) > CAP - HEAD_SLACK) { cur = { feature, segment: seg, stmtIdx: [] }; chunks.push(cur); }
      cur.stmtIdx.push(...c);
    }
  }
  const order = (a, b) => a.segment - b.segment || a.stmtIdx[0] - b.stmtIdx[0];
  const count = new Map();
  for (const f of map.features) count.set(f.name, 0);
  for (const ch of chunks.sort(order)) {
    const k = count.get(ch.feature) + 1; count.set(ch.feature, k);
    ch.name = k > 1 ? `${ch.feature}-${k}` : ch.feature;
    ch.stmtIdx.sort((a, b) => a - b);
  }
  const files = chunks.sort((a, b) => a.segment - b.segment || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return Object.assign(files, { oversized });
}

const modId = (name) => `m_${name.replace(/-/g, '_')}`;
const firstLine = (src, body, i) => src.slice(body[i].start, src.indexOf('\n', body[i].start)).trim().slice(0, 60);
const segmentLabel = (plan, k) => (k < plan.barriers.length ? `before ${firstLine(plan.src, plan.body, plan.barriers[k])}` : 'before the SPA fallback');

/** ui/routes/index.mjs: one frozen list per segment, each sorted by file name. */
export function routeIndex(files, plan) {
  const lists = plan.ends.map(() => []);
  for (const f of files) lists[f.segment].push(f.name);
  const names = [...new Set(files.map((f) => f.name))].sort();
  return [
    `// ui/routes/index.mjs — generated by tools/split-by-feature.mjs v${MIGRATION_VERSION}. ui/server.mjs registers ROUTE_SEGMENTS[k] right`,
    '// before its k-th central app.use between the static mount and the SPA fallback, and the last list right before the',
    "// fallback. Each list is sorted by file name. Add a new feature's file to the list of the segment it belongs in.",
    ...names.map((n) => `import * as ${modId(n)} from './${n}.mjs';`),
    'export const ROUTE_SEGMENTS = Object.freeze([',
    ...lists.map((l, k) => `  Object.freeze([${l.sort().map(modId).join(', ')}]),   // ${segmentLabel(plan, k)}`),
    ']);',
    '',
  ].join('\n');
}

const INDEX_DECL = "const INDEX_FILE = path.join(PUBLIC_DIR, 'index.html');\n";
const INDEX_READ = "fs.readFileSync(INDEX_FILE, 'utf8')";
const STATIC_LINE = "app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));\n";
const EXPORT_LINE = 'export { app, server, runs };\n';
const ASSET_BLOCK = `// /style.css is assembled from its parts (#919). It matches every spelling express.static served it under
// (//style.css, /%73tyle.css, and any case on a case-insensitive file system), and nothing else.
const CASE_INSENSITIVE_PUBLIC = fs.existsSync(path.join(PUBLIC_DIR, 'APP.JS'));
const assetWarned = new Set();
const warnAssetOnce = (what, err) => {
  if (assetWarned.has(what)) return;
  assetWarned.add(what);
  console.error(\`[split] \${what}: \${err && err.message ? err.message : err}\`);
};
app.use(function serveStyleCss(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const rel = publicRelPath(req.path);
  if (rel !== 'style.css' && !(CASE_INSENSITIVE_PUBLIC && rel !== null && rel.toLowerCase() === 'style.css')) return next();
  let entry;
  try { entry = readStyleCssEntry(PUBLIC_DIR); }
  catch (err) { warnAssetOnce('style.css', err); return res.status(500).type('text/plain').send('stylesheet unavailable'); }
  res.set('Content-Type', 'text/css; charset=UTF-8');
  res.set('Cache-Control', 'public, max-age=0');
  res.set('Last-Modified', new Date(entry.mtimeMs).toUTCString());
  return res.send(Buffer.from(entry.text));    // a Buffer keeps the Content-Type set above; ETag and 304 via res.send / req.fresh
});
const serveStatic = express.static(PUBLIC_DIR, { extensions: ['html'] });
app.use(function servePublic(req, res, next) {
  let part = false;
  // A broken parts.json must not take every static file down with it: log once and serve static.
  try { part = isPublicPart(req.path, PUBLIC_DIR); } catch (err) { warnAssetOnce('ui/public/parts.json', err); }
  return part ? next() : serveStatic(req, res, next);
});
`;

const once = (src, needle, what) => {
  const at = src.indexOf(needle);
  if (at < 0 || src.indexOf(needle, at + 1) >= 0) throw new Error(`split: ui/server.mjs must hold ${what} exactly once`);
  return at;
};

/** The names a module already exports under their own name. */
function exportedNames(body) {
  const names = new Set();
  for (const s of body) {
    if (s.type !== 'ExportNamedDeclaration') continue;
    for (const sp of s.specifiers) if (sp.local.name === (sp.exported.name ?? sp.exported.value)) names.add(sp.local.name);
    const d = s.declaration;
    if (!d) continue;
    if (d.id) names.add(d.id.name);
    for (const x of d.declarations ?? []) if (x.id.type === 'Identifier') names.add(x.id.name);
  }
  return names;
}

/** ui/server.mjs after the split: moved statements out, exports, imports, one registration line per segment, assets. */
export function patchServer(src, plan, files) {
  const { body, ends, barriers, group } = plan;
  const edits = [];                                        // [start, end, text] on the original offsets
  once(src, STATIC_LINE, 'the static mount');
  once(src, EXPORT_LINE, '`export { app, server, runs };`');
  once(src, INDEX_DECL, 'the INDEX_FILE declaration');
  if (src.split('INDEX_FILE').length - 1 !== 3) throw new Error('split: ui/server.mjs must name INDEX_FILE exactly three times');
  if (src.split(INDEX_READ).length - 1 !== 2) throw new Error('split: ui/server.mjs must read INDEX_FILE exactly twice');
  once(src, FALLBACK_ANCHOR, 'the SPA fallback comment');
  for (const i of group.keys()) {
    const end = src[body[i].end] === '\n' ? body[i].end + 1 : body[i].end;
    edits.push([leadStart(src, body, i), end, '']);
  }
  const total = ends.length;
  ends.forEach((e, k) => {
    const label = segmentLabel(plan, k).replace(/^before (.*\S)$/, (m, x) => (k < barriers.length ? `before ${x.replace(/\s*\(?$/, '')} …` : m));
    edits.push([leadStart(src, body, e), leadStart(src, body, e),
      `for (const mod of ROUTE_SEGMENTS[${k}]) mod.register(app);   // feature routes (#919), segment ${k} of ${total}: ${label}\n`]);
  });
  const fromServer = new Set(files.flatMap((f) => [...f.fromServer]));
  for (const n of exportedNames(body)) fromServer.delete(n);
  const exp = src.indexOf(EXPORT_LINE) + EXPORT_LINE.length;
  if (fromServer.size) edits.push([exp, exp, `export { ${[...fromServer].sort().join(', ')} };\n`]);
  const lastImport = body.filter((s) => s.type === 'ImportDeclaration').at(-1);
  const impAt = src[lastImport.end] === '\n' ? lastImport.end + 1 : lastImport.end;
  edits.push([impAt, impAt, "import { ROUTE_SEGMENTS } from './routes/index.mjs';\n"
    + "import { isPublicPart, publicRelPath } from '../src/core/public-assets.mjs';\n"
    + "import { readIndexHtml } from '../src/core/read-index-html.mjs';\n"
    + "import { readStyleCssEntry } from '../src/core/read-style-css.mjs';\n"]);
  const decl = src.indexOf(INDEX_DECL);
  edits.push([decl, decl + INDEX_DECL.length, '']);
  for (let at = src.indexOf(INDEX_READ); at >= 0; at = src.indexOf(INDEX_READ, at + 1)) edits.push([at, at + INDEX_READ.length, 'readIndexHtml(PUBLIC_DIR)']);
  const st = src.indexOf(STATIC_LINE);
  edits.push([st, st + STATIC_LINE.length, ASSET_BLOCK]);
  // Highest offset first; at one offset, an insertion goes after a removal that ends there.
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (let k = 1; k < edits.length; k++) if (edits[k][1] > edits[k - 1][0]) throw new Error(`split: overlapping edits at ${edits[k][0]}`);
  let out = src;
  for (const [s, e, t] of edits) out = out.slice(0, s) + t + out.slice(e);
  if (out.includes('INDEX_FILE')) throw new Error('split: an INDEX_FILE use is left in ui/server.mjs');
  return out;
}

/** Keep an entry only for a file still over 1,000 lines, at min(cap, count); add files over 1,000 lines. Never raises. */
export function nextCaps(caps, counts) {
  const out = {};
  for (const rel of Object.keys({ ...caps, ...counts }).sort()) {
    const n = counts[rel];
    if (n === undefined || n <= CAP) continue;
    out[rel] = caps[rel] === undefined ? n : Math.min(caps[rel], n);
  }
  return out;
}

const CODE = /\.(mjs|js|css|html)$/; const VENDORED = /(\.min\.js$|\/vendor\/|\/fonts\/|dagre)/;
/** Line counts of every code file under src/, ui/ and tools/ (the size-cap test's walk), with `out` applied. */
export function codeLineCounts(root, out = new Map()) {
  const counts = {};
  for (const d of ['src', 'ui', 'tools']) {
    if (!existsSync(join(root, d))) continue;
    for (const f of readdirSync(join(root, d), { recursive: true })) {
      const rel = `${d}/${String(f).split('\\').join('/')}`;
      if (!CODE.test(rel) || VENDORED.test(rel) || out.has(rel)) continue;
      counts[rel] = lineCount(readFileSync(join(root, rel), 'utf8'));
    }
  }
  for (const [rel, t] of out) if (t !== null && /^(src|ui|tools)\//.test(rel) && CODE.test(rel) && !VENDORED.test(rel)) counts[rel] = lineCount(t);
  return counts;
}
const readCaps = (root) => (existsSync(join(root, CAPS_REL)) ? JSON.parse(readFileSync(join(root, CAPS_REL), 'utf8')) : {});
const capsText = (caps) => JSON.stringify(caps, null, 2) + '\n';

/** The size-cap ceiling recorded for the residual ui/server.mjs (undefined when there is none). */
export function serverCeiling(root) { return readCaps(root)['ui/server.mjs']; }

/** The spike gate: enough route statements moved, and the residual server no larger than its ceiling. */
export function spikeGate(stats, ceiling) {
  const reasons = [];
  if (!(stats.movedShare >= SPIKE_GATE.movedShare)) reasons.push(`moved ${Math.floor(stats.movedShare * 100)}% < ${SPIKE_GATE.movedShare * 100}%`);
  if (!Number.isInteger(ceiling)) reasons.push(`no size-cap ceiling for ui/server.mjs in ${CAPS_REL}`);
  else if (stats.serverLinesAfter > ceiling) reasons.push(`ui/server.mjs ${stats.serverLinesAfter} lines > ceiling ${ceiling}`);
  return { pass: reasons.length === 0, reasons, ceiling: Number.isInteger(ceiling) ? ceiling : null };
}

export function writeCaps(root) {
  writeFileSync(join(root, CAPS_REL), capsText(nextCaps(readCaps(root), codeLineCounts(root))));
}

const DESIGN_SENTENCE = 'Every colour is a token in `:root` of `ui/public/style.css`';
/** package.json files, the :root sentence in docs/design-system.md, docs/feature-files.md and the size caps. */
export function patchDocsAndPackage(root, cssParts, out, map) {
  const res = new Map();
  const pkg = readFileSync(join(root, 'package.json'), 'utf8');
  const pkgLine = pkg.match(/^([ \t]*)"ui\/server\.mjs",\n/m);
  if (!pkgLine) throw new Error('split: package.json files must list "ui/server.mjs"');
  if (!/"ui\/routes\/"/.test(pkg)) res.set('package.json', pkg.replace(pkgLine[0], `${pkgLine[0]}${pkgLine[1]}"ui/routes/",\n`));
  const ds = readFileSync(join(root, 'docs/design-system.md'), 'utf8');
  const rootPart = cssParts.find((p) => /^:root\s*\{/m.test(p.text));
  if (ds.includes(DESIGN_SENTENCE) && rootPart) {
    res.set('docs/design-system.md', ds.replace(DESIGN_SENTENCE, `Every colour is a token in \`:root\` of \`ui/public/${rootPart.file}\` (served as \`/style.css\`)`));
  }
  const rows = [];
  for (const f of map.features) {
    const mine = [...out].filter(([p, t]) => t !== null && (p.startsWith(`ui/routes/${f.name}.mjs`) || p.startsWith(`ui/routes/${f.name}-`)
      ? new RegExp(`^ui/routes/${f.name}(?:-\\d+)?\\.mjs$`).test(p) : p.startsWith(`ui/public/${f.name}/${f.name}`)
        && new RegExp(`^ui/public/${f.name}/${f.name}(?:-\\d+)?\\.(?:css|html)$`).test(p)));
    if (!mine.length) continue;
    rows.push(`## ${f.name}${f.doc ? ` ([${f.doc.slice(5)}](${f.doc.slice(5)}))` : ''}`, '', '| File | Lines |', '|---|---|',
      ...mine.sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, t]) => `| \`${p}\` | ${lineCount(t)} |`), '');
  }
  res.set('docs/feature-files.md', ['# Feature files', '',
    `Generated by \`tools/split-by-feature.mjs\` v${MIGRATION_VERSION} (#919): the per-feature route files, CSS parts and markup`,
    'parts each feature owns, with their line counts. `ui/server.mjs` keeps the central code (guards, pre-parsers, barriers',
    'and pinned routes). See [split-by-feature.md](split-by-feature.md).', '', ...rows].join('\n'));
  const planned = new Map([...out, ...res]);
  res.set(CAPS_REL, capsText(nextCaps(readCaps(root), codeLineCounts(root, planned))));
  return res;
}

/** Writes only what differs, deletes null entries that exist; returns the changed paths.
 *  Callers: --apply, the dry run, and readiness's applySplit (tools/readiness/trees.mjs). */
export function writeFiles(root, files) {
  const changed = [];
  for (const [rel, text] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const abs = join(root, rel);
    if (text === null) { if (existsSync(abs)) { rmSync(abs); changed.push(rel); } continue; }
    if (existsSync(abs) && readFileSync(abs, 'utf8') === text) continue;
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
    changed.push(rel);
  }
  return changed;
}

/** True when `root` is a git checkout with staged or unstaged changes to tracked files; false outside git. */
function gitDirty(root) {
  try { return execFileSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() !== ''; }
  catch { return false; }
}

const SAFETY_TESTS = ['test/public-assets.test.mjs', 'test/extension-css.test.mjs', 'test/index-html.test.mjs'];   // the shell readers that exist

/** `git archive HEAD` of `repo` into `dir`: the dry run's input is the commit, never the working tree. */
export const gitArchive = (repo) => (dir) => execFileSync('sh', ['-c', 'git -C "$1" archive --format=tar HEAD | tar -x -C "$2"', 'sh', repo, dir]);

export function dryRun({ repo = process.cwd(), json, tests = 'safety', exportTree = gitArchive(repo) } = {}) {
  assertExpress4(repo);
  const head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const dirty = gitDirty(repo);
  const tmp = (p) => mkdtempSync(join(tmpdir(), p));
  const before = tmp('split-before-'); const after = tmp('split-after-'); const homes = [];
  const home = () => { const h = tmp('split-home-'); homes.push(h); return h; };
  const finish = (report) => { if (json) writeFileSync(json, JSON.stringify(report, null, 2) + '\n'); return report; };
  try {
    for (const d of [before, after]) { exportTree(d); symlinkSync(join(repo, 'node_modules'), join(d, 'node_modules'), 'dir'); }
    const plan = planSplit({ root: after });
    if (plan.alreadySplit) return finish({ ok: false, head, dirty, problems: ['HEAD is already split (ui/public/parts.json exists)'] });
    if (plan.problems.length) return finish({ ok: false, head, dirty, problems: plan.problems });
    const gate = spikeGate(plan.stats, serverCeiling(after));
    writeFiles(after, plan.files);
    const treeHash = treeHashOf(after);
    // a second apply, two ways: a fresh plan of the original over the split, and --apply's own already-split shortcut
    const secondApply = writeFiles(after, planSplit({ root: before }).files);
    if (!planSplit({ root: after }).alreadySplit) secondApply.push('ui/public/parts.json (the split tree is not seen as split)');
    const hashAgain = treeHashOf(after);
    const eq = compareTrees(before, after, { home });
    const generated = [...plan.files].filter(([p, t]) => t !== null && p !== 'ui/server.mjs' && !p.endsWith('.json') && !p.startsWith('docs/'));
    const overCap = generated.filter(([, t]) => lineCount(t) > CAP).map(([p, t]) => `${p}: ${lineCount(t)} lines`);
    const testRuns = runTests(after, tests, home);
    const problems = [...eq.problems, ...gate.reasons.map((x) => `spike gate: ${x}`), ...overCap.map((x) => `over cap: ${x}`),
      ...(secondApply.length ? [`second --apply changed ${secondApply.join(', ')}`] : []),
      ...(hashAgain !== treeHash ? [`tree hash changed after the second --apply: ${treeHash} → ${hashAgain}`] : []),
      ...testRuns.filter((t) => !t.ok).map((t) => `tests failed in the split tree: ${t.files.join(' ')} (exit ${t.status})`)];
    return finish({ ok: problems.length === 0, head, dirty, migrationVersion: MIGRATION_VERSION, treeHash, problems, gate, stats: plan.stats,
      pins: plan.pins.map((p) => p.key), equivalence: { equal: eq.equal, probes: eq.probes, routes: eq.routes },
      acceptedDeltas: eq.acceptedDeltas, secondApplyChanged: secondApply.length, generatedOverCap: overCap, tests: testRuns });
  } finally {
    for (const d of [before, after, ...homes]) rmSync(d, { recursive: true, force: true });
  }
}

function runTests(dir, which, home) {
  if (which === 'none') return [];
  const r = spawnSync(process.execPath, ['tools/test.mjs', ...SAFETY_TESTS], { cwd: dir, env: childEnv(home()), encoding: 'utf8', maxBuffer: 256 << 20, timeout: 1_500_000 });
  return [{ files: SAFETY_TESTS, ok: r.status === 0, status: r.status, tail: String(r.stdout).split('\n').slice(-30).join('\n') }];
}

/** git write-tree over a throwaway index: the hash depends only on file contents and modes, never on git config. */
export function treeHashOf(dir, { env: extra = {} } = {}) {
  const gitDir = join(dir, '.git-split');
  const env = { ...extra, PATH: process.env.PATH, HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull, GIT_CONFIG_COUNT: '0', GIT_ATTR_NOSYSTEM: '1',
    GIT_DIR: gitDir, GIT_WORK_TREE: dir, GIT_INDEX_FILE: join(gitDir, 'index') };
  const git = (args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.filemode=true', '-c', 'core.symlinks=true',
    '-c', 'core.ignorecase=false', '-c', 'core.safecrlf=false', ...args], { cwd: dir, env, encoding: 'utf8' });
  try {
    git(['init', '-q']);
    git(['add', '-A', '--force', '--', '.', ':!node_modules', ':!.git-split']);
    return git(['write-tree']).trim();
  } finally { rmSync(gitDir, { recursive: true, force: true }); }
}

function dryRunMain(root, head, arg, { out, err }) {
  const tests = arg('--tests') ?? 'safety';
  if (!['safety', 'none'].includes(tests)) { err('--tests must be safety or none'); return 1; }
  if (head === 'no-git') { err('--dry-run needs a git checkout: it splits the HEAD commit, not the working tree'); return 1; }
  const r = dryRun({ repo: root, json: arg('--json'), tests });
  if (r.dirty) err(`working tree has uncommitted changes; the dry run used HEAD ${r.head.slice(0, 9)}`);
  if (!r.ok) { for (const p of r.problems.slice(0, 20)) err(p); err('NOT EQUIVALENT'); return 1; }
  out(`HEAD ${r.head.slice(0, 9)} · treeHash ${r.treeHash} · served equal (${r.equivalence.probes} probes) · route table equal (${r.equivalence.routes} routes) · `
    + `${r.acceptedDeltas.length} accepted deltas · spike gate passed (ceiling ${r.gate.ceiling}) · second --apply changed 0 files${tests === 'none' ? '' : ' · split-tree tests pass'}`);
  return 0;
}


/** Short HEAD for messages; 'no-git' for a fixture root that is not a repository (--check needs no git). */
function gitHead(root) {
  try { return execFileSync('git', ['-C', root, 'rev-parse', '--short=9', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'no-git'; }
}

export async function main(argv = process.argv.slice(2), { out = console.log, err = console.error } = {}) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const root = arg('--root') ?? process.cwd();
  try { assertExpress4(root); } catch (e) { err(e.message); return 1; }
  const head = gitHead(root);
  if (argv.includes('--dry-run')) return dryRunMain(root, head, arg, { out, err });
  if (argv.includes('--write-caps')) { writeCaps(root); return 0; }
  const plan = planSplit({ root });
  if (argv.includes('--apply')) {
    if (plan.alreadySplit) {
      if (plan.problems.length) { for (const p of plan.problems) err(p); return 1; }
      out(`already split (parts manifest v${MIGRATION_VERSION} present): 0 files changed`); return 0;
    }
    if (plan.problems.length) { for (const p of plan.problems) err(p); return 1; }
    if (gitDirty(root)) { err(`refusing --apply: ${root} has uncommitted changes; apply on a clean checkout`); return 1; }
    const g = spikeGate(plan.stats, serverCeiling(root));
    if (!g.pass) { err(`spike gate FAILED (${g.reasons.join('; ')}): nothing written`); return 1; }
    const changed = writeFiles(root, plan.files);
    out(`applied split-by-feature v${MIGRATION_VERSION} on ${head}: ${changed.length} files changed`);
    return 0;
  }
  // --check (default)
  if (plan.problems.length) { for (const p of plan.problems) err(p); return 1; }
  if (plan.alreadySplit) out(`already split (parts manifest v${MIGRATION_VERSION} present): nothing left to move`);
  else {
    out(`split-by-feature v${MIGRATION_VERSION} on ${head}: ${plan.stats.regionRoutes} routes, ${plan.stats.pinnedRoutes} pinned, ${plan.css.length} CSS parts, ${plan.html.length} markup parts — covered`);
    if (argv.includes('--stats')) {
      const g = spikeGate(plan.stats, serverCeiling(root));
      const why = g.pass ? `>= ${SPIKE_GATE.movedShare * 100}% moved, ceiling ${g.ceiling} lines` : g.reasons.join('; ');
      out(`moved ${plan.stats.movedRoutes}/${plan.stats.regionRoutes} route statements (${Math.round(plan.stats.movedShare * 100)}%), ui/server.mjs after the split: ${plan.stats.serverLinesAfter} lines — spike gate ${g.pass ? 'passed' : 'FAILED'} (${why})`);
      if (!g.pass) return 1;
    }
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) process.exitCode = await main();

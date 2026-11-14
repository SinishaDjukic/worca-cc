// tools/stillhet-import-guard.mjs — "never wrap dev's DOM" as a check. Scans every file under ui/public/stillhet/ and
// returns the violations: { file, line, kind, text }. Kinds:
//   import   an import, import(), importScripts, require, or a script/link URL into ui/public/ outside the allowed folders
//   dev-dom  a selector, getElementById or closest() that names an id of dev's shell page and not of Stillhet's own
//   capture  window.Today, Today., or cloneNode/adoptNode of a node found by a dev-dom reference
//   fragment a fetch of a dev HTML fragment
// The dev-dom kind is a heuristic: ids Stillhet shares with dev by name are in ALLOWED_IDS, each with its reason.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readIndexHtml } from '../src/core/read-index-html.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STILLHET = join(ROOT, 'ui/public/stillhet');
const PUBLIC = join(ROOT, 'ui/public');

// Where a Stillhet file may reach: its own folder, the design system, fonts, assets, and the engine files the prototype already bundles.
const ALLOWED_DIRS = ['stillhet', 'design-system', 'fonts', 'assets'];
const ALLOWED_FILES = ['graph/view.mjs', 'graph/run-decor.mjs'];

/** Ids both pages use by name; the reason says why that is not a reach into dev's DOM. */
export const ALLOWED_IDS = {
  app: 'the mount point both shells name; shell.html owns its own',
  worca: 'the mount point of the Stillhet shell (shell.html); dev has a same-named wrapper',
  toast: 'a generic word; Stillhet\'s toast is .rc-toast in shell.html',
  case: 'the prototype tools panel select; the page code falls back to a detached select',
};

// No file reads window.Today: the capture is gone. The parameter stays so the guard test can seed a reader.
export const KNOWN_CAPTURE_READERS = {};

const ids = (text) => new Set([...text.matchAll(/\bid="([^"]+)"|\bid:\s*'([^']+)'/g)].map((m) => m[1] || m[2]));   // markup, and an id handed to a library part as an attribute

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
}

/** `devIds`: ids of dev's shell page; `ownIds`: ids Stillhet's own shell and generated markup draws. */
export function scanText(text, file, { devIds = new Set(), ownIds = new Set(), publicDir = PUBLIC, captureReaders = KNOWN_CAPTURE_READERS } = {}) {
  const out = [];
  const rel = file.replace(/\\/g, '/');
  const add = (i, kind, t) => out.push({ file: rel, line: text.slice(0, i).split('\n').length, kind, text: t.slice(0, 120) });
  const here = resolve(publicDir, 'stillhet', posix.dirname(rel.replace(/^.*?stillhet\//, '')));
  const inAllowed = (abs) => {
    const r = relative(publicDir, abs).replace(/\\/g, '/');
    if (r.startsWith('..')) return /^(src\/shared)\//.test(relative(resolve(publicDir, '..', '..'), abs).replace(/\\/g, '/'));
    return ALLOWED_DIRS.some((d) => r === d || r.startsWith(d + '/')) || ALLOWED_FILES.includes(r);
  };
  const target = (u) => (u.startsWith('/') ? resolve(publicDir, '.' + u) : resolve(here, u));
  for (const m of text.matchAll(/\b(?:import\s+(?:[^'"()]*?\s+from\s+)?|import\s*\(\s*|importScripts\s*\(\s*|require\s*\(\s*)(['"])([^'"]+)\1/g)) {
    if (/^(node:|https?:)/.test(m[2]) || !/^[./]/.test(m[2])) continue;
    if (!inAllowed(target(m[2]))) add(m.index, 'import', m[0]);
  }
  for (const m of text.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:|data:)/.test(m[1])) continue;
    if (!inAllowed(target(m[1]))) add(m.index, 'import', m[0]);
  }
  const sels = [...text.matchAll(/(?:getElementById\(\s*['"]([^'"]+)['"]|(?:querySelector(?:All)?|closest|matches)\(\s*['"`][^'"`]*?#([\w-]+))/g)];
  const devRefs = [];
  for (const m of sels) {
    const id = m[1] || m[2];
    if (devIds.has(id) && !ownIds.has(id) && !(id in ALLOWED_IDS)) { devRefs.push(m.index); add(m.index, 'dev-dom', m[0]); }
  }
  for (const m of text.matchAll(/\b(?:window\.)?Today\b[.\[]|window\.Today\b/g)) {
    if (!(rel.replace(/^.*?stillhet\//, '') in captureReaders)) add(m.index, 'capture', m[0]);
  }
  if (devRefs.length) for (const m of text.matchAll(/\b(?:cloneNode|adoptNode)\s*\(/g)) add(m.index, 'capture', m[0]);
  for (const m of text.matchAll(/\bfetch\(\s*['"`]([^'"`]+\.html)\b/g)) add(m.index, 'fragment', m[0]);
  return out;
}

/** Every violation under ui/public/stillhet/. */
export function guardStillhet({ dir = STILLHET, devHtml = readIndexHtml(), ownHtml = null, captureReaders = KNOWN_CAPTURE_READERS } = {}) {
  const own = ownHtml ?? readFileSync(join(dir, 'shell.html'), 'utf8');
  // Own ids: shell.html, any id Stillhet's own scripts draw, and the library's markup (the library is allowed).
  const drawn = (d) => walk(d).filter((f) => /\.(m?js|html)$/.test(f)).map((f) => readFileSync(f, 'utf8')).join('\n');
  const ownText = [own, drawn(dir), drawn(join(PUBLIC, 'design-system'))].join('\n');
  const devIds = ids(devHtml), ownIds = ids(ownText.replace(/\\"/g, '"'));
  return walk(dir)
    .filter((f) => /\.(js|mjs|html)$/.test(f) && !/\/(components|graph)\.js$/.test(f))
    .flatMap((f) => scanText(readFileSync(f, 'utf8'), relative(dir, f).replace(/^/, 'stillhet/'), { devIds, ownIds, publicDir: PUBLIC, captureReaders }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const v = guardStillhet();
  for (const x of v) console.log(`${x.file}:${x.line} ${x.kind} ${x.text}`);
  process.exit(v.length ? 1 : 0);
}

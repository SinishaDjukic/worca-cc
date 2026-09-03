// Build docs.worca.dev into ./dist.
//
// No framework: the landing page is a single HTML template stamped with the
// current @worca/app version, plus the self-contained pages that already live
// under ../docs (the what's-new changelog and the why-worca deck). Everything
// the page needs is copied here so `wrangler deploy` ships one directory.
//
// Output:
//   dist/index.html                 landing page
//   dist/404.html                   same page, served with 404 for unknown paths
//   dist/changelog/index.html       newest docs/changelog/worca-app-v*.html
//   dist/changelog/<version>/       every changelog page, by version
//   dist/why-worca/index.html       docs/why-worca/why-worca.standalone.html
//   dist/<public files>             favicon, logo

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const docs = path.join(repo, 'docs');

const REPO_URL = 'https://github.com/SinishaDjukic/worca-cc';

const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const version = pkg.version;
const isPrerelease = version.includes('-');

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// --- static files -----------------------------------------------------------
await cp(path.join(here, 'public'), dist, { recursive: true });
// The changelog and deck pages carry no <link rel="icon">, so browsers ask for /favicon.ico.
await cp(path.join(here, 'public', 'worca-favicon.png'), path.join(dist, 'favicon.ico'));

// --- changelog pages --------------------------------------------------------
// docs/changelog/worca-app-v<version>.html are self-contained (screenshots are
// inlined as data URIs); the .src.html siblings are authoring sources, skipped.
const changelogDir = path.join(docs, 'changelog');
const changelogPages = [];
if (existsSync(changelogDir)) {
  for (const name of await readdir(changelogDir)) {
    const m = /^worca-app-v(.+)\.html$/.exec(name);
    if (!m || name.endsWith('.src.html')) continue;
    changelogPages.push({ version: m[1], file: path.join(changelogDir, name) });
  }
}
changelogPages.sort((a, b) => compareVersions(b.version, a.version));
for (const page of changelogPages) {
  const out = path.join(dist, 'changelog', page.version);
  await mkdir(out, { recursive: true });
  await cp(page.file, path.join(out, 'index.html'));
}
const latestChangelog = changelogPages[0] ?? null;
if (latestChangelog) {
  await cp(latestChangelog.file, path.join(dist, 'changelog', 'index.html'));
}

// --- why-worca deck ---------------------------------------------------------
const deck = path.join(docs, 'why-worca', 'why-worca.standalone.html');
const hasDeck = existsSync(deck);
if (hasDeck) {
  await mkdir(path.join(dist, 'why-worca'), { recursive: true });
  await cp(deck, path.join(dist, 'why-worca', 'index.html'));
}

// --- landing page -----------------------------------------------------------
const template = await readFile(path.join(here, 'src', 'index.html'), 'utf8');
const vars = {
  VERSION: version,
  VERSION_LABEL: isPrerelease ? 'Release candidate' : 'Current release',
  VERSION_CLASS: isPrerelease ? 'rc' : '',
  RELEASE_URL: `${REPO_URL}/releases/tag/worca-app-v${version}`,
  REPO_URL,
  CHANGELOG_HREF: latestChangelog ? '/changelog/' : `${REPO_URL}/blob/dev/docs/changelog/README.md`,
  CHANGELOG_VERSION: latestChangelog ? latestChangelog.version : version,
  DECK_HREF: hasDeck ? '/why-worca/' : `${REPO_URL}/blob/dev/docs/why-worca.md`,
  BUILD_DATE: new Date().toISOString().slice(0, 10),
};
const html = template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
  if (!(key in vars)) throw new Error(`Unknown template variable {{${key}}}`);
  return escapeHtml(vars[key]);
});
await writeFile(path.join(dist, 'index.html'), html);
await writeFile(path.join(dist, '404.html'), html);

console.log(
  `docs-site: built dist/ for @worca/app ${version}` +
    ` (changelog pages: ${changelogPages.length}, deck: ${hasDeck ? 'yes' : 'no'})`,
);

// --- helpers ----------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// semver-ish ordering: 1.2.0 > 1.2.0-rc.3 > 1.2.0-rc.2 > 1.1.1
function compareVersions(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) if (pa.core[i] !== pb.core[i]) return pa.core[i] - pb.core[i];
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;
  if (!pb.pre.length) return -1;
  const n = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i];
    const y = pb.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    if (typeof x === 'number') return -1;
    if (typeof y === 'number') return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}
function parse(v) {
  const [core, pre = ''] = v.split('-', 2);
  return {
    core: core.split('.').map((n) => Number(n) || 0),
    pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

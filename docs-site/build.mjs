// Build docs.worca.dev into ./dist.
//
// VitePress renders the docs pages from ../docs/*.md (.vitepress/config.mjs),
// then this adds the pages that are not markdown: the what's-new changelog and
// the why-worca deck. Everything the site needs ends up in dist/ so
// `wrangler deploy` ships one directory.
//
// Output:
//   dist/index.html, dist/<page>.html  VitePress: the home page and one page per docs/*.md
//   dist/404.html                      VitePress not-found page, served for unknown paths
//   dist/changelog/index.html       the list of releases (src/changelog.html)
//   dist/changelog/<version>/       every changelog page, with its screenshots
//   dist/_redirects                 /changelog/latest/ -> the newest release
//   dist/why-worca/index.html       docs/why-worca/why-worca.standalone.html
//   dist/<public files>             favicon, logo
//
// The changelog half lives in changelog.mjs.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build as buildPages } from 'vitepress';

import { buildChangelog } from './changelog.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const dist = path.join(here, 'dist');
const docs = path.join(repo, 'docs');

const REPO_URL = 'https://github.com/SinishaDjukic/worca-cc';

const pkg = JSON.parse(await readFile(path.join(repo, 'package.json'), 'utf8'));
const version = pkg.version;

await rm(dist, { recursive: true, force: true });

// --- docs pages (VitePress; also copies public/ into dist/) -------------------
await buildPages(here);

// --- static files -----------------------------------------------------------
// The changelog and deck pages carry no <link rel="icon">, so browsers ask for /favicon.ico.
await cp(path.join(here, 'public', 'worca-favicon.png'), path.join(dist, 'favicon.ico'));

// --- changelog pages --------------------------------------------------------
const BUILD_DATE = new Date().toISOString().slice(0, 10);
const changelog = await buildChangelog({
  repoRoot: repo,
  dist,
  template: await readFile(path.join(here, 'src', 'changelog.html'), 'utf8'),
  vars: { REPO_URL, BUILD_DATE },
});
const latestChangelog = changelog[0] ?? null;
if (latestChangelog) {
  await writeFile(path.join(dist, '_redirects'), `/changelog/latest/ /changelog/${latestChangelog.version}/ 302\n`);
}

// --- why-worca deck ---------------------------------------------------------
const deck = path.join(docs, 'why-worca', 'why-worca.standalone.html');
const hasDeck = existsSync(deck);
if (hasDeck) {
  await mkdir(path.join(dist, 'why-worca'), { recursive: true });
  await cp(deck, path.join(dist, 'why-worca', 'index.html'));
}

console.log(
  `docs-site: built dist/ for @worca/app ${version}` +
    ` (changelog pages: ${changelog.length}, deck: ${hasDeck ? 'yes' : 'no'})`,
);

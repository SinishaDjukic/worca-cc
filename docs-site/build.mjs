// Build docs.worca.dev into ./dist.
//
// No framework: the landing page is a single HTML template stamped with the
// current @worca/app version, plus the pages that already live under ../docs
// (the what's-new changelog and the why-worca deck). Everything the site needs
// is copied here so `wrangler deploy` ships one directory.
//
// Output:
//   dist/index.html                 landing page
//   dist/404.html                   same page, served with 404 for unknown paths
//   dist/changelog/index.html       the list of releases (src/changelog.html)
//   dist/changelog/<version>/       every changelog page, with its screenshots
//   dist/_redirects                 /changelog/latest/ -> the newest release
//   dist/why-worca/index.html       docs/why-worca/why-worca.standalone.html
//   dist/architecture/              the C4 viewer (docs/architecture/viewer.html) on Worca's model
//   dist/<public files>             favicon, logo
//
// The changelog half lives in changelog.mjs.

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChangelog, fill } from './changelog.mjs';

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

// --- architecture: the C4 viewer on Worca's own model -------------------------
// The same <worca-c4> module the app's Artifacts tab uses, with its vendored dagre, beside the
// standalone page and the model it opens by default (docs/architecture/).
const archPage = path.join(docs, 'architecture', 'viewer.html');
const archModel = path.join(docs, 'architecture', 'architecture.c4');
const hasArch = existsSync(archPage) && existsSync(archModel);
if (hasArch) {
  const out = path.join(dist, 'architecture');
  await mkdir(out, { recursive: true });
  await cp(archPage, path.join(out, 'index.html'));
  await cp(archModel, path.join(out, 'architecture.c4'));
  for (const f of ['c4-view.mjs', 'dagre.min.js']) await cp(path.join(repo, 'ui', 'public', 'c4', f), path.join(out, f));
}

// --- landing page -----------------------------------------------------------
const template = await readFile(path.join(here, 'src', 'index.html'), 'utf8');
const vars = {
  VERSION: version,
  VERSION_LABEL: isPrerelease ? 'Release candidate' : 'Current release',
  VERSION_CLASS: isPrerelease ? 'rc' : '',
  RELEASE_URL: `${REPO_URL}/releases/tag/worca-app-v${version}`,
  REPO_URL,
  CHANGELOG_HREF: latestChangelog ? `/changelog/${latestChangelog.version}/` : `${REPO_URL}/blob/dev/docs/changelog/README.md`,
  CHANGELOG_VERSION: latestChangelog ? latestChangelog.version : version,
  DECK_HREF: hasDeck ? '/why-worca/' : `${REPO_URL}/blob/dev/docs/why-worca.md`,
  ARCH_HREF: hasArch ? '/architecture/' : `${REPO_URL}/blob/dev/docs/ARCHITECTURE.md`,
  BUILD_DATE,
};
const html = fill(template, vars);
await writeFile(path.join(dist, 'index.html'), html);
await writeFile(path.join(dist, '404.html'), html);

console.log(
  `docs-site: built dist/ for @worca/app ${version}` +
    ` (changelog pages: ${changelog.length}, deck: ${hasDeck ? 'yes' : 'no'}, architecture: ${hasArch ? 'yes' : 'no'})`,
);

// The changelog part of the docs.worca.dev build.
//
// Source of truth, all under docs/changelog/:
//   entries.json                   one record per release: version, since, date, artifact
//   worca-app-v<version>.src.html  the page /worca-changelog wrote (a fragment: the
//                                  Artifact host adds the document shell)
//   shots/<version>/*              the screenshots the page references
//
// For each entry this writes dist/changelog/<version>/index.html — the page with a
// real document shell (doctype, charset, viewport: served as-is it rendered in quirks
// mode with no charset), a thin "all releases · previous · next" bar, and its images
// copied next to it as files — plus dist/changelog/index.html, the list of releases
// read from the pages themselves (hero sub + section headlines), so the list never
// drifts from what the pages say.
//
// The self-contained, data-URI build of a page (inline-assets.mjs) is only for the
// Artifact preview; it is not an input here and is not committed.

import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const SITE = 'https://docs.worca.dev';
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read and validate docs/changelog/entries.json against the pages on disk.
 * Every entry needs its .src.html, and every .src.html needs an entry — a page
 * without a record (or the reverse) fails the build instead of going missing.
 * @returns {Promise<{version:string, since:string, date:string, artifact?:string, src:string}[]>} newest first
 */
export async function readEntries(changelogDir, srcNames) {
  const file = path.join(changelogDir, 'entries.json');
  let list;
  try {
    list = JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file}: ${err.message}`);
  }
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array of entries`);
  const seen = new Set();
  const entries = list.map((e, i) => {
    const where = `${file} entry ${i}`;
    if (!e || typeof e !== 'object') throw new Error(`${where}: not an object`);
    if (!VERSION_RE.test(e.version || '')) throw new Error(`${where}: bad version ${JSON.stringify(e.version)}`);
    if (!VERSION_RE.test(e.since || '')) throw new Error(`${where}: bad since ${JSON.stringify(e.since)}`);
    if (!DATE_RE.test(e.date || '')) throw new Error(`${where}: bad date ${JSON.stringify(e.date)} (want YYYY-MM-DD)`);
    if (e.artifact !== undefined && !/^https:\/\/claude\.ai\//.test(e.artifact)) throw new Error(`${where}: bad artifact URL`);
    if (seen.has(e.version)) throw new Error(`${where}: duplicate version ${e.version}`);
    seen.add(e.version);
    const src = `worca-app-v${e.version}.src.html`;
    if (!srcNames.includes(src)) throw new Error(`${where}: docs/changelog/${src} does not exist`);
    return { ...e, src: path.join(changelogDir, src) };
  });
  for (const name of srcNames) {
    const m = /^worca-app-v(.+)\.src\.html$/.exec(name);
    if (m && !seen.has(m[1])) throw new Error(`docs/changelog/${name} has no entry in entries.json`);
  }
  return entries.sort((a, b) => compareVersions(b.version, a.version));
}

/**
 * What the release list shows for a page: its title, the hero's sub line, and one
 * headline per feature section, with its kicker (the hero and the receipts are left out).
 */
export function pageSummary(html) {
  const title = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1].trim() ?? '';
  const sub = /<p class="sub">([\s\S]*?)<\/p>/.exec(html)?.[1] ?? '';
  const sections = [];
  const re = /<section class="sec" id="(s\d+)">([\s\S]*?)<\/section>/g;
  for (const m of html.matchAll(re)) {
    const h2 = /<h2[^>]*>([\s\S]*?)<\/h2>/.exec(m[2]);
    const kicker = /<span class="kicker">(?:\s*<span[^>]*><\/span>)?([^<]*)<\/span>/.exec(m[2]);
    if (h2) sections.push({ id: m[1], kicker: kicker ? inlineText(kicker[1]) : '', title: inlineText(h2[1]) });
  }
  return { title: inlineText(title), sub: inlineText(sub), sections };
}

/**
 * Point every local <img src> at a file next to the page and report which files to
 * copy. Paths resolve like inline-assets.mjs: relative to the page, then to the repo
 * root. Remote and data: sources are left alone.
 * @returns {{ html: string, assets: {from: string, name: string}[] }}
 */
export function localizeImages(html, { pageDir, repoRoot }) {
  const assets = new Map();   // name -> from
  const missing = [];
  const out = html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/g, (m, pre, src, post) => {
    if (/^(data:|https?:|\/\/|\/)/i.test(src)) return m;
    const from = [path.resolve(pageDir, src), path.resolve(repoRoot, src)].find((p) => existsSync(p));
    if (!from) { missing.push(src); return m; }
    const name = path.basename(from);
    const prev = assets.get(name);
    if (prev && prev !== from) throw new Error(`two different images are both named ${name}: ${prev}, ${from}`);
    assets.set(name, from);
    return pre + name + post;
  });
  if (missing.length) throw new Error(`missing image(s): ${missing.join(', ')}`);
  return { html: out, assets: [...assets].map(([name, from]) => ({ from, name })) };
}

/** Wrap a changelog fragment in a document shell and add the release bar. */
export function docShell(fragment, { entry, summary, prev, next }) {
  const body = fragment.replace(/<title>[\s\S]*?<\/title>\s*/i, '');
  const url = `${SITE}/changelog/${entry.version}/`;
  const desc = summary.sub || summary.title;
  const link = (e, rel, label) => (e
    ? `<a rel="${rel}" href="/changelog/${attr(e.version)}/">${label}</a>`
    : `<span aria-hidden="true">${label}</span>`);
  const bar =
    `<nav class="docs-bar" aria-label="Releases">` +
    `<a href="/">docs.worca.dev</a>` +
    `<a href="/changelog/">All releases</a>` +
    `<span class="docs-bar-step">` +
    link(prev, 'prev', prev ? `&larr; ${esc(prev.version)}` : '&larr;') +
    `<b>${esc(entry.version)}</b>` +
    link(next, 'next', next ? `${esc(next.version)} &rarr;` : '&rarr;') +
    `</span></nav>`;
  // Tokens are the page's own (--card, --line, --ink-2, --mono); nothing on the page is restyled.
  const barCss =
    `.docs-bar{max-width:1280px;margin:0 auto;padding:12px 22px 0;display:flex;flex-wrap:wrap;gap:8px;` +
    `align-items:center;font:600 12px/1 var(--mono,ui-monospace,monospace);letter-spacing:.04em}` +
    `.docs-bar a,.docs-bar span,.docs-bar b{padding:7px 12px;border-radius:999px;border:1px solid var(--line,#E2DFD7);` +
    `background:var(--card,#fff);color:var(--ink-2,#56534C);text-decoration:none}` +
    `.docs-bar a:hover{color:var(--ink,#14151A);border-color:var(--ink-3,#8B8780)}` +
    `.docs-bar-step{display:inline-flex;gap:6px;margin-left:auto;padding:0!important;border:0!important;background:none!important}` +
    `.docs-bar-step span{opacity:.4}.docs-bar b{color:var(--ink,#14151A)}` +
    `@media (max-width:640px){.docs-bar{padding:10px 14px 0}.docs-bar-step{margin-left:0}}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(summary.title || `Worca — What's new in ${entry.version}`)}</title>
<meta name="description" content="${attr(desc)}">
<link rel="canonical" href="${url}">
<link rel="icon" type="image/png" href="/worca-favicon.png">
<meta property="og:title" content="${attr(summary.title)}">
<meta property="og:description" content="${attr(desc)}">
<meta property="og:url" content="${url}">
<style>${barCss}</style>
</head>
<body>
${bar}
${body}
</body>
</html>
`;
}

/** The /changelog/ list page, from docs-site/src/changelog.html. */
export function renderIndex(template, entries, vars) {
  const items = entries.map(({ entry, summary }, i) => {
    const href = `/changelog/${attr(entry.version)}/`;
    const rc = entry.version.includes('-');
    const heads = summary.sections
      .map((s) => `<li><a href="${href}#${attr(s.id)}">${esc(s.title)}</a></li>`)
      .join('');
    return `<article class="rel${i === 0 ? ' latest' : ''}">
  <div class="rel-meta">
    <a class="rel-ver${rc ? ' rc' : ''}" href="${href}">${esc(entry.version)}</a>
    <time datetime="${attr(entry.date)}">${esc(formatDate(entry.date))}</time>
    <span class="rel-since">since ${esc(entry.since)}</span>
  </div>
  <div class="rel-body">
    <p class="rel-sub">${esc(listSub(summary.sub))}</p>
    <ul class="rel-heads">${heads}</ul>
    <a class="rel-go" href="${href}">Read what's new in ${esc(entry.version)} &rarr;</a>
  </div>
</article>`;
  }).join('\n');
  return fill(template, { ...vars, RELEASES: items }, new Set(['RELEASES']));
}

/**
 * Build every changelog page and the list into dist/changelog/.
 * @returns {Promise<{version:string}[]>} the entries, newest first
 */
export async function buildChangelog({ repoRoot, dist, template, vars = {} }) {
  const changelogDir = path.join(repoRoot, 'docs', 'changelog');
  if (!existsSync(path.join(changelogDir, 'entries.json'))) return [];
  const entries = await readEntries(changelogDir, await readdir(changelogDir));
  const pages = [];
  for (const entry of entries) {
    const html = await readFile(entry.src, 'utf8');
    pages.push({ entry, html, summary: pageSummary(html) });
  }
  for (let i = 0; i < pages.length; i++) {
    const { entry, html, summary } = pages[i];
    const out = path.join(dist, 'changelog', entry.version);
    await mkdir(out, { recursive: true });
    const local = localizeImages(html, { pageDir: path.dirname(entry.src), repoRoot });
    for (const a of local.assets) await copyFile(a.from, path.join(out, a.name));
    const page = docShell(local.html, {
      entry,
      summary,
      next: pages[i - 1]?.entry ?? null,   // newer
      prev: pages[i + 1]?.entry ?? null,   // older
    });
    await writeFile(path.join(out, 'index.html'), page);
  }
  await writeFile(path.join(dist, 'changelog', 'index.html'), renderIndex(template, pages, vars));
  await writeFile(path.join(dist, 'changelog', 'index.json'), `${JSON.stringify(changelogFeed(pages))}\n`);
  return entries;
}

// The address the app reads the feed from and links to (src/core/update-check.mjs CHANGELOG_URL).
const SITE_URL = 'https://docs.worca.dev';

/**
 * The machine-readable release list (changelog/index.json), newest first. The app's update dialog
 * reads it to list what changes between the running version and the one being installed.
 */
export function changelogFeed(pages, siteUrl = SITE_URL) {
  return {
    releases: pages.map(({ entry, summary }) => ({
      version: entry.version,
      date: entry.date,
      sub: listSub(summary.sub),
      url: `${siteUrl}/changelog/${entry.version}/`,
      sections: summary.sections.map(({ kicker, title }) => ({ kicker, title })),
    })),
  };
}

// --- helpers ----------------------------------------------------------------

/** Replace {{KEY}} slots; values are HTML-escaped unless the key is in `raw`. */
export function fill(template, vars, raw = new Set()) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) throw new Error(`Unknown template variable {{${key}}}`);
    return raw.has(key) ? vars[key] : esc(vars[key]);
  });
}

/** Older pages open their sub with "Since 1.3.0 — …"; the list shows the since beside it. */
function listSub(sub) {
  const rest = sub.replace(/^Since \S+ — /, '');
  return rest === sub ? sub : rest.charAt(0).toUpperCase() + rest.slice(1);
}

function inlineText(s) {
  return String(s)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'").replace(/&mdash;/g, '—').replace(/&rarr;/g, '→').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}
const attr = esc;

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// semver-ish ordering: 1.2.0 > 1.2.0-rc.3 > 1.2.0-rc.2 > 1.1.1
export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
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
function parseVersion(v) {
  const [core, pre = ''] = v.split('-', 2);
  return {
    core: core.split('.').map((n) => Number(n) || 0),
    pre: pre ? pre.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)) : [],
  };
}

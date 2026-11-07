// The Worca Rail page, generated from the branch and never edited by hand (docs/rail/gate.md): the rules (docs/rail/), the
// catalog (docs/design-system-catalog.json) and the library's gallery (plans/rail/prototype/components.html), with the
// library's own code and CSS inside, as one file a person can read anywhere.
//   node tools/rail-artifact.mjs [out.html]     default: plans/rail/generated/worca-rail.html (not committed)
// It only writes the file. Publishing it is a separate step, with a person's yes.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = (f) => f.replace(/\.md$/, '');

/** The chapters in the index's order: { id, title, html }. */
export function chapters() {
  const index = read('docs/rail/README.md');
  const order = ['README.md', ...[...index.matchAll(/\]\(([a-z-]+\.md)\)/g)].map((m) => m[1])];
  return order.map((f) => {
    const md = read(`docs/rail/${f}`);
    // a link between chapters stays inside the page
    const html = marked.parse(md).replace(/href="([a-z-]+)\.md"/g, 'href="#$1"');
    return { id: slug(f) === 'README' ? 'rail' : slug(f), title: (md.match(/^# (.+)$/m) || [, f])[1], html };
  });
}

/** The catalog as tables: what a page can be built from. */
export function catalogHtml(cat = JSON.parse(read('docs/design-system-catalog.json'))) {
  const rows = (list, cols) => `<table><thead><tr>${cols.map((c) => `<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${list.map((x) => `<tr>${cols.map((c) => `<td>${esc(c[1](x))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<h2>Components</h2>${rows(cat.components, [['Name', (x) => x.name], ['For', (x) => (x.needs || []).join('; ')], ['Not for', (x) => x.notFor || ''], ['For example', (x) => x.example || '']])}
  <h2>Patterns</h2>${rows(cat.patterns, [['Name', (x) => x.name], ['For', (x) => x.for], ['Holds', (x) => (x.slots || []).join('; ')]])}
  <h2>Shared logic</h2>${rows(cat.logic, [['Name', (x) => x.name], ['For', (x) => (x.needs || []).join('; ')], ['For example', (x) => x.example]])}
  <h2>Where an action goes</h2>${rows(cat.actions, [['Kind of action', (x) => x.kind], ['Slot', (x) => x.slot]])}`;
}

// The gallery's body and script, as the prototype draws it.
function gallery() {
  const page = read('plans/rail/prototype/components.html');
  const style = (page.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const script = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  return { style, script };
}

// The catalog's way in: a tile per component, grouped by kind, each jumping to its drawn section.
const KINDS = [['acting', 'Acting'], ['choosing', 'Choosing'], ['entering', 'Entering'], ['showing', 'Showing'], ['telling', 'Telling']];
const tileId = (name) => name.replace(/\s/g, '-');
export function tilesHtml(cat = JSON.parse(read('docs/design-system-catalog.json'))) {
  const rest = cat.components.filter((c) => !KINDS.some(([k]) => k === c.kind));
  const groups = [...KINDS.map(([k, title]) => [title, cat.components.filter((c) => c.kind === k)]), ['More', rest]].filter(([, l]) => l.length);
  return groups.map(([title, list]) => `<h2 class="ra-kind">${esc(title)} <span>${list.length}</span></h2><div class="ra-tiles">${list.map((c) => `<a class="ra-tile" href="#${esc(tileId(c.name))}"><b>${esc(c.name)}</b><span>${esc((c.needs || [])[0] || '')}</span></a>`).join('')}</div>`).join('');
}

// A font the CSS loads by its path goes in as data, so the one file stands alone.
function selfContained(css) {
  return css.replace(/url\((['"]?)\.\.\/\.\.\/\.\.\/ui\/public\/([^)'"]+)\1\)/g, (m, q, path) => {
    const f = join(ROOT, 'ui/public', path);
    if (!/\.woff2$/.test(path) || !existsSync(f)) return 'url(data:,)';
    return `url(data:font/woff2;base64,${readFileSync(f).toString('base64')})`;
  });
}

// When a build was made, as the prototype's corner says it: 7 Nov 2026, 16:40.
const whenOf = (at) => new Date(at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

// The cover: the rail itself, 20px rings at a 32px pitch on the ink slab, the live one in the working colour, beside the state colours.
function cover(sha, stamp = null) {
  const rows = [24, 56, 88, 120, 152, 184, 216];
  const wires = rows.slice(0, -1).map((y, i) => `<line class="ra-w${i >= 4 ? ' is-next' : ''}" x1="34" y1="${y + 10}" x2="34" y2="${y + 22}"></line>`).join('');
  const rings = rows.map((y, i) => `<circle class="${i === 4 ? 'ra-live' : `ra-r${i > 4 ? ' is-next' : ''}`}" cx="34" cy="${y}" r="10"></circle>`).join('');
  return `<header class="ra-cover"><svg class="ra-art" viewBox="0 0 480 288" aria-hidden="true"><rect class="ra-ink" x="0" y="-8" width="184" height="264" rx="8"></rect>${wires}${rings}<rect class="ra-seq" x="200" y="40" width="56" height="64" rx="4"></rect><rect class="ra-green" x="264" y="64" width="56" height="40" rx="4"></rect><rect class="ra-peach" x="200" y="120" width="120" height="136" rx="8"></rect><rect class="ra-violet" x="336" y="40" width="160" height="216" rx="8"></rect></svg>
<div class="ra-words"><div class="ra-name">Worca<br>Rail</div><p class="ra-tag">Every screen reads down one rail, and everything has one place on it.</p></div></header>
<p class="ra-src">${stamp ? `Built from <b>${esc(stamp.branch)}</b> at ${esc(stamp.sha)}${stamp.dirty ? ' with changes not yet committed' : ''}, last updated ${esc(whenOf(stamp.at))}` : `Generated from the branch at ${esc(sha)}`}. The source is the repository; this page is never edited by hand.</p>`;
}

/** The whole page. Needs the prototype's generated files (the gates write them). */
export function buildPage({ sha = '', stamp = null } = {}) {
  const ch = chapters(); const g = gallery();
  const css = selfContained([read('plans/rail/prototype/app.css'), read('plans/rail/prototype/design-system/rail-look.css'), read('plans/rail/prototype/design-system/rail.css')].join('\n'));
  const lib = read('plans/rail/prototype/components.js').replace(/<\/script>/g, '<\\/script>');
  const nav = [[ch[0].id, ch[0].title], ['gallery-sec', 'Components'], ...ch.slice(1).map((c) => [c.id, c.title]), ['catalog', 'Patterns and logic']];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Worca Rail</title>
<!-- Generated by tools/rail-artifact.mjs from ${esc(sha)}. Never edit this file: change docs/rail/, the catalog or the library. -->
<style>${css}</style>
<style>${g.style}
  html,body{background:var(--bg);color:var(--ink);font-family:var(--sans);margin:0;}
  .ra{display:grid;grid-template-columns:232px minmax(0,1fr);gap:32px;max-width:1120px;margin:0 auto;padding:32px 16px;}
  .ra-nav{position:sticky;top:16px;align-self:start;display:flex;flex-direction:column;gap:2px;font-size:var(--fs-meta);}
  .ra-nav a{color:var(--ink-2);text-decoration:none;padding:4px 8px;border-radius:var(--r-xs);}
  .ra-nav a:hover{background:var(--hover);color:var(--ink);}
  .ra-main{min-width:0;display:flex;flex-direction:column;gap:48px;}
  .ra-doc{font-size:var(--fs-body);line-height:1.6;}
  .ra-doc h1{font:600 var(--fs-page)/1.3 var(--sans);letter-spacing:-.02em;margin:0 0 12px;}
  .ra-doc h2{font:600 var(--fs-section)/1.4 var(--sans);margin:24px 0 8px;}
  .ra-doc table{display:block;overflow-x:auto;border-collapse:collapse;font-size:var(--fs-meta);margin:12px 0;}
  .ra-doc th,.ra-doc td{padding:6px 12px 6px 0;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;}
  .ra-doc th{color:var(--ink-2);font-weight:500;}
  .ra-doc code{font-family:var(--mono);font-size:.92em;}
  .ra-doc a{color:inherit;}
  .ra-kind{font:600 var(--fs-section)/1.4 var(--sans);margin:24px 0 8px;color:var(--ink);}
  .ra-kind span{font-weight:400;font-size:var(--fs-caption);color:var(--ink-2);}
  .ra-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:8px;}
  .ra-tile{display:flex;flex-direction:column;gap:4px;padding:12px;border:1px solid var(--line);border-radius:var(--r-sm,6px);color:var(--ink);text-decoration:none;font-size:var(--fs-meta);min-width:0;transition:background-color 100ms var(--ease);}
  .ra-tile:hover{background:var(--hover);}
  .ra-tile b{font-weight:600;font-size:var(--fs-body);}
  .ra-tile span{color:var(--ink-2);line-height:1.4;}
  #gallery{margin-top:32px;max-width:none;}
  #gallery > .mk-intro{display:none;}
  .ra-src{margin:0 0 32px;font-size:var(--fs-caption);color:var(--ink-2);}
  .ra-cover{position:relative;min-height:288px;}
  .ra-art{position:absolute;top:0;right:-24px;width:480px;height:288px;}
  .ra-ink{fill:var(--ink);}.ra-seq{fill:var(--ink-3);}.ra-green{fill:var(--green);}.ra-peach,.ra-live{fill:var(--peach);}.ra-violet{fill:var(--violet);}
  .ra-r{fill:none;stroke:var(--bg);stroke-width:1.5;}.ra-r.is-next{stroke:var(--ink-3);}
  .ra-w{stroke:var(--bg);stroke-width:1;}.ra-w.is-next{stroke:var(--ink-3);}
  .ra-words{position:absolute;left:0;bottom:0;max-width:340px;}
  .ra-name{font-size:96px;line-height:.95;font-weight:600;letter-spacing:-.02em;color:var(--ink);}
  .ra-tag{margin:10px 0 0 4px;font-size:14px;line-height:20px;color:var(--ink-2);}
  @media (max-width:900px){.ra-art{display:none;}.ra-cover{min-height:200px;}.ra-name{font-size:64px;}}
  @media (max-width:760px){.ra{grid-template-columns:minmax(0,1fr);}.ra-nav{position:static;flex-direction:row;flex-wrap:wrap;}}
</style></head>
<body class="rc-board">
<div class="ra"><nav class="ra-nav" aria-label="Chapters">${nav.map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('')}</nav>
<main class="ra-main">
${cover(sha, stamp)}
${ch.slice(0, 1).map((c) => `<section class="ra-doc" id="${c.id}">${c.html}</section>`).join('')}
<section id="gallery-sec"><div class="ra-doc"><h1>Components</h1><p>Every piece of the library, drawn by its own code. Pick one to see its states and rules.</p></div>${tilesHtml()}<div class="mk-wrap rc" id="gallery"></div></section>
${ch.slice(1).map((c) => `<section class="ra-doc" id="${c.id}">${c.html}</section>`).join('\n')}
<section class="ra-doc" id="catalog"><h1>Patterns and logic</h1>${catalogHtml()}</section>
</main></div>
<script>${lib}</script>
<script>${g.script.replace(/<\/script>/g, '<\\/script>')}</script>
</body></html>
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = process.argv[2] || join(ROOT, 'plans/rail/generated/worca-rail.html');
  const { writeAppCss } = await import('../plans/rail/prototype/gates/app-css.mjs');
  const { writeComponentsJs, railStamp } = await import('../plans/rail/prototype/gates/components-js.mjs');
  writeAppCss(); writeComponentsJs();
  const stamp = railStamp();   // the branch, the commit and when, as the prototype's corner has them
  const html = buildPage({ sha: stamp.sha, stamp });
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, html);
  console.log(`${out} · ${(html.length / 1048576).toFixed(1)} MB · ${readdirSync(join(ROOT, 'docs/rail')).length} chapters`);
}

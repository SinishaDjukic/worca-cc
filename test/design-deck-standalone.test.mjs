// test/design-deck-standalone.test.mjs — Design P7 Task 12: a deck's HTML export is one offline file built by the
// deck kit's own bundler. The assembler hands it a doc whose code is all sibling `<script src>` files (`scriptFiles`),
// every asset already embedded by P1's inliner; `assembleDeckStandalone` bundles it in a private temp folder with the
// package's `build-standalone.mjs` (no shell, a scrubbed env), checks nothing was left out, and always removes the
// folder. Thumbnails of decks and films stay visible with no script run (`thumbStillCss`).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import * as deckStandalone from '../src/core/design/deck-standalone.mjs';
import { thumbStillCss } from '../src/core/design/kinds.mjs';
import { staticDoc } from '../src/core/design/render.mjs';

const { assembleDeckStandalone, BUILD_STANDALONE } = deckStandalone;
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const slide = (id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'] });
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [slide('s1'), slide('s2')] };
const BASE = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.js': 'window.G=1;',
  'sections/s1/index.html': '<section data-section="s1" data-label="One"><h1>One</h1></section>', 'sections/s1/style.css': '[data-section="s1"] h1{top:0}',
  'sections/s2/index.html': '<section data-section="s2" data-label="Two"><h1>Two</h1></section>', 'sections/s2/style.css': '[data-section="s2"] h1{top:0}' };

const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const awkward = () => { const d = mkdtempSync(join(tmpdir(), "worca deck 'q$-")); dirs.push(d); return d; };   // also each row's tmpRoot: the bundler's own folder is awkward too
const empty = (root) => assert.deepEqual(readdirSync(root), [], 'nothing left behind');
const PNG = Buffer.from([1, 2, 3]); const B64 = PNG.toString('base64');
/** work/ under `root`: BASE, assets/logo.png and `extra`, with the pitch kit staged as a round stages it. */
async function deckWorld(extra = {}, root = awkward()) {
  const work = join(root, 'work');
  const put = (rel, data) => { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), data); };
  for (const [rel, text] of Object.entries(BASE)) put(rel, text);
  put('assets/logo.png', PNG);
  for (const [rel, text] of Object.entries(extra)) put(rel, text);
  await stageDesignKit({ kind: 'pitch', workDir: work });
  return work;
}

test('the real bundler from an awkward folder: one file, every asset form embedded, nothing left behind', async () => {
  const tmpRoot = awkward();
  const work = await deckWorld({ 'sections/s1/index.html': '<section data-section="s1" data-label="One"><img src="assets/logo.png" srcset="assets/logo.png 2x"><video poster="assets/logo.png"></video><svg><image href="assets/logo.png"/></svg></section>',
    'sections/s1/style.css': '[data-section="s1"]{background:url(assets/logo.png)}', 'sections/s1/script.js': 'const a = "</script>"; const b = "<!-- x"; root.dataset.ok = "1";' });
  const plan = { ...DECK, sections: [{ ...DECK.sections[0], parts: ['html', 'css', 'js'] }, DECK.sections[1]] };
  const r = await assembleDeckStandalone({ workDir: work, plan, tmpRoot });
  assert.deepEqual(r.problems, []);
  const still = new JSDOM(r.html).window.document;   // no scripts run: the kit's own comments quote `<script src=…>` and `no-rail` (deck-stage.js:57, :25)
  assert.equal(still.querySelectorAll('script[src]').length, 0);
  assert.equal(still.querySelector('body deck-stage').hasAttribute('no-rail'), false);
  assert.ok(r.html.includes('window.__DECK_EXPORTED=true'), 'went through the kit');
  assert.ok(r.html.includes("customElements.define('deck-stage'"));
  for (const form of [`src="data:image/png;base64,${B64}"`, `${B64} 2x`, 'poster="data:', `url(data:image/png;base64,${B64})`]) assert.ok(r.html.includes(form), form);   // P1's inliner keeps url() unquoted; the kit skips data: URLs
  assert.equal(r.html.includes('data-worca-'), false); assert.equal(r.html.includes(BRIDGE_MARKER), false);
  empty(tmpRoot);
  const win = new JSDOM(r.html, { url: 'http://localhost/deck.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; } }).window;
  after(() => win.close());
  for (let i = 0; i < 40 && !win.document.querySelector('[data-deck-active]'); i++) await new Promise((res) => setTimeout(res, 5));
  assert.equal(win.document.querySelector('deck-stage > [data-deck-active]').getAttribute('data-section'), 's1');
  assert.equal(win.document.querySelector('[data-section="s1"]').dataset.ok, '1', 'the section script ran, with its strings intact');
  assert.equal(win.__DECK_EXPORTED, true);
});
test('problems survive; a remote the kit embedded leaves the list', async () => {
  const r = await assembleDeckStandalone({ workDir: await deckWorld({ 'sections/s1/index.html': '<section data-section="s1" data-label="One"><img src="assets/gone.png"><img src="https://x.dev/a.png"></section>' }), plan: DECK, tmpRoot: awkward() });
  assert.deepEqual(r.problems.map((p) => p.why).sort(), ['missing', 'remote']);
  // The kit embeds only a Google Fonts link (build-standalone.mjs:345), here the real kit with its fetch stubbed, and the
  // preconnects are gone before it runs. A remote it leaves stays, its `&` held as `&amp;` in the raw output.
  const dir = awkward(); const preload = join(dir, 'fonts.mjs'); writeFileSync(preload, REALPATH_PRELOAD);
  const kit = (cmd, args, opts) => spawn(cmd, ['--import', pathToFileURL(preload).href, ...args], { ...opts, env: { ...opts.env, REALPATH_LOG: join(dir, 'log') } });
  const two = await deckWorld({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${FONTS}<img src="https://x.dev/b?c=1&amp;d=2"></section>` });
  const kept = await assembleDeckStandalone({ workDir: two, plan: DECK, tmpRoot: awkward(), spawnImpl: kit });
  assert.ok(kept.html.includes('data:font/woff2;base64,') && !kept.html.includes('fonts.googleapis.com'), 'the kit embedded the fonts');
  assert.deepEqual(kept.problems, [{ ref: 'https://x.dev/b?c=1&d=2', why: 'remote' }]);
  // Offline the kit keeps the font link, so its remote stays; the preconnects are gone either way.
  const offline = await assembleDeckStandalone({ workDir: two, plan: DECK, tmpRoot: awkward(), spawnImpl: passes() });
  assert.deepEqual(offline.problems.map((p) => p.ref), ['https://fonts.googleapis.com/css2?family=Inter&display=swap', 'https://x.dev/b?c=1&d=2']);
});
// Review cycle 4: P1 reports decoded refs, so a search of the raw output misses a remote spelled with an entity, and one
// search per problem is quadratic. A remote leaves only when the export lost it whole (a preconnect, the font link) and
// the output, read as P1 reads a page, loads it nowhere.
test('a remote the output still loads stays: an entity in its URL, another tag loading it, a value the export reshaped', async () => {
  const work = await deckWorld({ 'sections/s1/index.html': String.raw`<section data-section="s1" data-label="One"><img src="https://x&#46;dev/one.png"><link rel="preconnect" href="https://cdn.x.dev/two.png"><img src=" https://cdn&#x2E;x.dev/two.png "><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><style>@import url("https://fonts.googleapis.com/css2?family=Inter");</style><img src="https://x.dev/ src=a\b"></section>` });
  const r = await assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward(), spawnImpl: embedsFonts });
  assert.equal(r.html.includes('<link href="https://fonts.googleapis.com'), false, 'the font link was embedded');
  assert.deepEqual(r.problems, ['https://x.dev/one.png', 'https://cdn.x.dev/two.png', 'https://fonts.googleapis.com/css2?family=Inter', String.raw`https://x.dev/ src=a\b`].map((ref) => ({ ref, why: 'remote' })));
  // An output the walk cannot read whole loses no remote.
  const deep = await deckWorld({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${FONTS}${'<div>'.repeat(600)}x${'</div>'.repeat(600)}</section>` });
  const d = await assembleDeckStandalone({ workDir: deep, plan: DECK, tmpRoot: awkward(), spawnImpl: embedsFonts });
  assert.deepEqual(d.problems.map((p) => p.ref), ['https://fonts.googleapis.com', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com/css2?family=Inter&display=swap', 'index.html']);
});
test('20,000 remotes spelled with an entity keep their problems, in well under a second of CPU', async () => {
  const imgs = Array.from({ length: 20000 }, (_, i) => `<img src="https://x&#46;dev/${i}.png">`).join('');
  const work = await deckWorld({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${FONTS}${imgs}</section>` });
  const cpu = process.cpuUsage();
  const r = await assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward(), spawnImpl: embedsFonts });
  const used = process.cpuUsage(cpu);
  assert.ok((used.user + used.system) / 1000 < 1000, `${(used.user + used.system) / 1000} ms of CPU`);
  assert.deepEqual([r.problems.length, r.problems[0], r.problems.at(-1)], [20000, { ref: 'https://x.dev/0.png', why: 'remote' }, { ref: 'https://x.dev/19999.png', why: 'remote' }]);
});
/** A bundler that inlines nothing and drops our live script tags, keeping its input page as `seen.page`. */
const passes = (seen = {}) => (cmd, args) => {
  seen.page = readFileSync(args[1], 'utf8');
  writeFileSync(args[3], seen.page.replace(/<script src="[^"]+"><\/script>/g, ''));
  const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c;
};
/** The Google Fonts snippet: two preconnects and the stylesheet link the kit embeds. */
const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Inter&amp;display=swap" rel="stylesheet">';
/** `passes`, and the first Google Fonts link swapped for a style block, by the kit's own matcher (build-standalone.mjs:345, :367). */
const embedsFonts = (cmd, args) => {
  writeFileSync(args[3], readFileSync(args[1], 'utf8').replace(/<script src="[^"]+"><\/script>/g, '').replace(/<link[^>]+href="(https:\/\/fonts\.googleapis\.com\/css2[^"]+)"[^>]*>/, '<style>\n@font-face{font-family:Inter}\n</style>'));
  const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c;
};
// Review C1: the bundler realpaths a local ref before its confinement check, and on Windows `\\host\share` is an SMB
// connection with the user's credentials. A stylesheet link to one of our scripts would make it scan that code for url().
test('the bundler gets no backslash ref and no stylesheet link into its folder; the problems stay', async () => {
  const seen = {};
  const work = await deckWorld({
    'sections/s1/index.html': String.raw`<section data-section="s1" data-label="One"><img src="\\h\s\a.png"><link rel=stylesheet href="\/h/s/a.css"><video poster="\\h\s\p.png"></video><img srcset="\\h\s\c.png 2x"><img alt=x src=\\h\s\d.png><link rel="stylesheet" href="deck-stage.js"><link rel='stylesheet' href='./deck-enhance.js?v=1'><link rel="stylesheet" href="https://x.dev/f.css"><img src="https://x.dev/a\b.png"><img src="assets/logo.png"><img/src="\\h\s\g.png"><svg><image xlink:href="\\h\s\x.png"/></svg></section>`,
    'sections/s1/style.css': String.raw`[data-section="s1"]{background:url(\\h\s\e.png)}[data-section="s1"] h1{background:url("\/h/s/f.png")}`,
  });
  const r = await assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward(), spawnImpl: passes(seen) });
  for (const bad of [String.raw`\\h\s`, String.raw`\/h/s`, 'href="deck-stage.js"', 'deck-enhance.js?v=1']) assert.equal(seen.page.includes(bad), false, bad);
  for (const kept of ['<img src="#">', '<link rel=stylesheet href="#">', '<video poster="#">', '<img srcset="#">', '<img alt=x src="#">', '<link rel="stylesheet" href="#">', "<link rel='stylesheet' href=\"#\">", 'url(#)', 'url("#")', '<img/src="#">', '<image xlink:href="#"/>',
    '<link rel="stylesheet" href="https://x.dev/f.css">', String.raw`<img src="https://x.dev/a\b.png">`, `<img src="data:image/png;base64,${B64}">`]) assert.ok(seen.page.includes(kept), kept);
  assert.deepEqual(r.problems.map((p) => `${p.why} ${p.ref}`).sort(), [String.raw`escaped \/h/s/a.css`, String.raw`escaped \/h/s/f.png`, String.raw`escaped \\h\s\a.png`,
    String.raw`escaped \\h\s\c.png`, String.raw`escaped \\h\s\d.png`, String.raw`escaped \\h\s\e.png`, String.raw`escaped \\h\s\g.png`, String.raw`escaped \\h\s\p.png`, String.raw`escaped \\h\s\x.png`, 'missing ./deck-enhance.js?v=1', 'missing deck-stage.js',
    String.raw`remote https://x.dev/a\b.png`, 'remote https://x.dev/f.css']);
});
// Review C1, cycle 2: the bundler takes the first `\ssrc` of a tag even inside another attribute's value, reads url()
// per style block, and reshapes the page between its passes (url() embeds, the export flag before `</head>`, the font
// link and preconnect swaps). The real bundler runs under a preload that logs every realpathSync of a path holding a
// backslash, with a Google Fonts stub so the font path runs offline.
const REALPATH_PRELOAD = `import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const real = fs.realpathSync;
function logged(p, o) { const s = String(p); if (s.includes('\\\\')) fs.appendFileSync(process.env.REALPATH_LOG, s + '\\n'); return real(p, o); }
logged.native = real.native;
fs.realpathSync = logged;
syncBuiltinESMExports();
globalThis.fetch = async (u) => (String(u).startsWith('https://fonts.googleapis.com/css2')
  ? new Response("@font-face {\\n  font-family: 'Inter';\\n  src: url(https://fonts.gstatic.com/s/inter/a.woff2) format('woff2');\\n}\\n")
  : new Response(new Uint8Array([1, 2, 3])));
`;
test('the real bundler never realpaths a backslash path, whatever the page nests or the bundler reshapes', async () => {
  const dir = awkward(); const preload = join(dir, 'realpath-log.mjs'); writeFileSync(preload, REALPATH_PRELOAD);
  const FONT = '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">';
  const sec = (html) => ({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${html}</section>` });
  const cases = {
    'src inside a remote href': sec(String.raw`<img href="https://x.dev/ src=\\h\s\p1.png">`),
    'src inside a data: poster': sec(String.raw`<video poster="data:x src=\\h\s\p3.png"></video>`),
    'script src inside a remote href': sec(String.raw`<script href="https://x.dev/ src=\\h\s\p5.js"></script>`),
    'a url( left open in one style block': sec(String.raw`<style>.z{background:url(https://x.dev/ }</style><style>.a{background:url(\\h\s\p2.png)}</style>`),
    'an embedded url() moves the first src': sec(String.raw`<style>.x{} <img a=url( src=/../deck-stage.js) src=\\h\s\A1.png> </style>`),
    'an embedded url() drops a >': sec(String.raw`<style>.x{} <img url(a>/../deck-stage.js) src=\\h\s\A2.png> </style>`),
    'an embedded url() joins a link to our script': { ...sec('<style><link rel=stylesheet a=url(x>/../deck-stage.js) href=global.js></style>'), 'global.js': String.raw`/* .q{background:url(\\h\s\M.png)} */ window.G=1;` },
    'the export flag lands inside a value': { 'tokens.css': String.raw`:root{--a:1} /* <script src=global.js src='\\h\s\B.js </head></script>'></script> */` },
    'the preconnect removal starts a value': sec(String.raw`${FONT}<img src=<link rel="preconnect" href="https://fonts.gstatic.com">\\h\s\C.png>`),
    'the font swap moves a quote': sec(String.raw`<script src=global.js src='\\h\s\D.js <link href="https://fonts.googleapis.com/css2?family=Inter"></script>`),
  };
  const leaked = [];
  for (const [name, files] of Object.entries(cases)) {
    const log = join(dir, `${Object.keys(cases).indexOf(name)}.log`); writeFileSync(log, '');
    const viaPreload = (cmd, args, opts) => spawn(cmd, ['--import', pathToFileURL(preload).href, ...args], { ...opts, env: { ...opts.env, REALPATH_LOG: log } });
    const r = await assembleDeckStandalone({ workDir: await deckWorld(files), plan: DECK, tmpRoot: awkward(), spawnImpl: viaPreload });
    assert.ok(r.html.includes("customElements.define('deck-stage'"), `${name}: bundled`);
    if (readFileSync(log, 'utf8')) leaked.push(name);
  }
  assert.deepEqual(leaked, [], 'no backslash path reached realpathSync');
});
test('a page the passes cannot settle is refused before the bundler runs', async () => {
  const nested = (n) => ({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${'<link rel="pre'.repeat(n)}<link rel="preconnect">${'connect">'.repeat(n)}</section>` });   // each pass's removal makes the next one
  // Review cycle 4: four passes at most, so a crafted page costs four linear passes, never 32. Two layers settle in three.
  for (const n of [40, 3]) {
    const tmpRoot = awkward();
    await assert.rejects(assembleDeckStandalone({ workDir: await deckWorld(nested(n)), plan: DECK, tmpRoot, spawnImpl: () => { throw new Error('spawned'); } }), (e) => e.code === 'IO' && /could not be made safe/.test(e.message), `${n} layers`);
    empty(tmpRoot);
  }
  const seen = {};
  await assembleDeckStandalone({ workDir: await deckWorld(nested(2)), plan: DECK, tmpRoot: awkward(), spawnImpl: passes(seen) });
  assert.equal(seen.page.includes('preconnect'), false, 'two layers settle');
});
// Review cycle 3, issue 2: `bundlerSafe` and the output checks run on the server's event loop over text the model wrote.
// The bundler's own regexes backtrack from every `url(` (cubic on `url(` + spaces), and rescan to the end from every
// `<style`, `<link` and `<!--` that nothing closes, so the export reads the same matches with linear scans.
test('pages built to make the bundler\'s matchers backtrack bundle in well under a second of CPU', async () => {
  const tail = `${'<style>'.repeat(40000)}${'<link rel="preconnect" '.repeat(20000)}${'<!--'.repeat(80000)}`;   // nothing closes them
  const work = await deckWorld({ 'shell.html': SHELL + tail, 'sections/s1/style.css': `[data-section="s1"]{background:url(${' '.repeat(20000)}}`, 'sections/s2/style.css': `[data-section="s2"]{}${'url('.repeat(200000)}'${' '.repeat(200000)}x` });   // every url( stops at one quote
  const seen = {};
  const cpu = process.cpuUsage();
  await assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward(), spawnImpl: passes(seen) });
  const used = process.cpuUsage(cpu);
  assert.ok((used.user + used.system) / 1000 < 1000, `${(used.user + used.system) / 1000} ms of CPU`);
  assert.ok(seen.page.endsWith(tail) && seen.page.includes('url(    ') && seen.page.includes('url(url(url('), 'nothing to make safe, so the page went as written');
});
// The seed and the bundler's own regexes (build-standalone.mjs :178, :239, :272, :325, :366): each linear scan returns
// exactly their matches.
test('the linear scans find exactly what the bundler\'s regexes match', () => {
  const { cssUrls, styleBlocks, linkTags, preconnectLinks, htmlComments } = deckStandalone._testing;
  let seed = 7;
  const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const text = (alpha, n) => Array.from({ length: 1 + Math.floor(rnd() * n) }, () => alpha[Math.floor(rnd() * alpha.length)]).join('');
  const spansOf = (re, s) => [...s.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
  const rows = [
    [/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (s) => [...s.matchAll(/(url\(\s*['"]?)([^'")]+)(['"]?\s*\))/g)].map((m) => [m.index, m.index + m[1].length, m[2], m.index + m[0].length]),
      (s) => cssUrls(s).map((u) => [u.index, u.at, u.value, u.end]), ['url(', 'url(', 'url', '(', ' ', ' ', '\t', ' ', "'", '"', ')', 'a', '#', '\\']],
    [/<style\b[^>]*>[\s\S]*?<\/style>/gi, (s) => [...s.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].map((m) => [m.index, m.index + m[0].indexOf('>') + 1, m.index + m[0].length - 8, m.index + m[0].length]),
      (s) => styleBlocks(s).map((b) => [b.index, b.at[1] + 1, b.at[2], b.end]), ['<style', '<STYLE', '<Style', '>', '</style>', '</STYLE>', '</sty', 's', '_', ' ', 'x', '<']],
    [/<link\b[^>]*>/gi, (s) => spansOf(/<link\b[^>]*>/gi, s), (s) => linkTags(s).map((t) => [t.index, t.end]), ['<link', '<LINK', '<lin', 'k', '_', '>', ' ', 'a', '\n']],
    [/<link rel="preconnect"[^>]*>\s*/g, (s) => spansOf(/<link rel="preconnect"[^>]*>\s*/g, s), (s) => preconnectLinks(s).map((t) => [t.index, t.end]),
      ['<link rel="preconnect"', '<link rel="preconnect"', '<link', ' rel="preconnect"', '>', ' ', '\n', 'a']],
    [/<!--[\s\S]*?-->/g, (s) => spansOf(/<!--[\s\S]*?-->/g, s), (s) => htmlComments(s).map((c) => [c.index, c.end]), ['<!--', '-->', '<!-', '--', '-', '>', 'x', '<']],
  ];
  for (const [re, want, got, alpha] of rows) {
    let matched = 0;
    for (let i = 0; i < 20000; i++) {
      const s = text(alpha, 24);
      const w = want(s);
      matched += w.length;
      assert.deepEqual(got(s), w, `${re} on ${JSON.stringify(s)}`);
    }
    assert.ok(matched > 1000, `${re}: the fuzz reaches matches (${matched})`);
  }
});
// Review M3: P1's ref is often not raw output text, so only a remote, the one kind the bundler can embed, may leave the list.
test('a missing, escaped or too-large problem stays, whatever the output holds', async () => {
  const gone = await deckWorld({ 'sections/s1/index.html': '<section data-section="s1" data-label="One"><div style="background:url(&quot;assets/gone.png&quot;)"></div><img src="assets/gone&#46;jpg"><img src="https://x.dev/kept.png"><link rel="preconnect" href="assets/pre.png"></section>' });
  const r = await assembleDeckStandalone({ workDir: gone, plan: DECK, tmpRoot: awkward(), spawnImpl: passes() });
  assert.deepEqual(r.problems.map((p) => p.why).sort(), ['missing', 'missing', 'missing', 'remote']);   // the preconnect the export removed too
  const deep = await deckWorld({ 'sections/s1/index.html': `<section data-section="s1" data-label="One">${'<div>'.repeat(600)}<img src="assets/logo.png">${'</div>'.repeat(600)}</section>` });
  const d = await assembleDeckStandalone({ workDir: deep, plan: DECK, tmpRoot: awkward(), spawnImpl: passes() });
  assert.deepEqual(d.problems, [{ ref: 'index.html', why: 'too-large' }]);
});
// Review M4: the bundler skips a tag inside a comment, so the output keeps it as written; that is not a script left out.
test('a script tag in a comment is no script left out; one more than the comments hold is', async () => {
  const work = await deckWorld({ 'sections/s1/index.html': '<section data-section="s1" data-label="One"><!-- <script src="global.js"></script> --><h1>One</h1></section>' });
  const r = await assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward() });   // the real bundler
  assert.ok(r.html.includes('<!-- <script src="global.js"></script> -->'));
  assert.ok(r.html.includes('window.G=1;'), 'the live one was inlined');
  const keeps = (cmd, args) => { writeFileSync(args[3], readFileSync(args[1], 'utf8').replace(/<script src="(?!global\.js")[^"]+"><\/script>/g, '')); const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c; };
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot: awkward(), spawnImpl: keeps }), (e) => e.code === 'IO' && /left out/.test(e.message));
});
test('the bundler is the package\'s own, spawned with no shell and a scrubbed env; never from .kit', async () => {
  const calls = [];
  const fake = (cmd, args, opts) => { calls.push({ cmd, args, opts }); writeFileSync(args[3], '<!doctype html><html><head></head><body>OK</body></html>'); const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c; };
  process.env.ANTHROPIC_API_KEY = 'sk-test'; after(() => { delete process.env.ANTHROPIC_API_KEY; });
  await assembleDeckStandalone({ workDir: await deckWorld(), plan: DECK, spawnImpl: fake, tmpRoot: awkward() });
  const c = calls[0];
  assert.equal(c.cmd, process.execPath); assert.equal(c.args[0], BUILD_STANDALONE);
  assert.equal(c.args[0].includes('.kit'), false); assert.equal(c.args[2], '--out');
  assert.equal(c.opts.shell, undefined); assert.equal(c.opts.windowsHide, true);
  for (const k of ['ANTHROPIC_API_KEY', 'WORCA_HOME']) assert.equal(k in c.opts.env, false, k);
  assert.deepEqual([c.opts.cwd, c.opts.killSignal, c.opts.timeout, c.opts.stdio], [dirname(c.args[1]), 'SIGKILL', 120000, ['ignore', 'ignore', 'pipe']]);
  assert.equal(c.args[3], join(c.opts.cwd, 'deck.standalone.html'));
});
test('a bundler failure is the export\'s error, with its last line, and leaves nothing', async () => {
  const tmpRoot = awkward();
  const fail = (code, signal, line) => () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => { c.stderr.emit('data', Buffer.from(`[build] one\n[build] ${line}\n`)); c.emit('close', code, signal); }); return c; };
  const work = await deckWorld();
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot, spawnImpl: fail(1, null, 'boom') }), (e) => e.code === 'IO' && /Could not bundle the deck: .*boom/.test(e.message));
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot, spawnImpl: fail(null, 'SIGKILL', '') }), (e) => e.code === 'IO' && /timed out/.test(e.message));
  const spawnErr = () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('error', new Error('ENOENT'))); return c; };
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot, spawnImpl: spawnErr }), (e) => e.code === 'IO' && /ENOENT/.test(e.message));
  const unbundled = (cmd, args) => { writeFileSync(args[3], '<script src="deck-stage.js"></script>'); const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c; };
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot, spawnImpl: unbundled }), (e) => e.code === 'IO' && /left out/.test(e.message));
  const silent = () => { const c = new EventEmitter(); c.stderr = new EventEmitter(); queueMicrotask(() => c.emit('close', 0, null)); return c; };
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, tmpRoot, spawnImpl: silent }), (e) => e.code === 'IO' && e.message === 'Could not bundle the deck: no output');
  empty(tmpRoot);
});
test('a kit file missing is the assembler\'s error, before any spawn; other kinds are refused', async () => {
  const work = await deckWorld(); rmSync(join(work, '.kit/deck-stage.js'));
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: DECK, spawnImpl: () => { throw new Error('no spawn'); } }), (e) => e.code === 'IO' && /deck-stage\.js/.test(e.message));
  await assert.rejects(assembleDeckStandalone({ workDir: work, plan: { ...DECK, kind: 'web' } }), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => assembleDesign({ workDir: work, plan: { ...DECK, kind: 'video' }, mode: 'standalone', scriptFiles: true }), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => assembleDesign({ workDir: work, plan: DECK, mode: 'dist', scriptFiles: true }), (e) => e.code === 'BAD_REQUEST');
});
test('scriptFiles: sibling names for all code, so the kit\'s document scans never see code', async () => {
  const r = assembleDesign({ workDir: await deckWorld({ 'global.js': 'window.G=1;', 'sections/s1/script.js': 'x()' }), plan: { ...DECK, sections: [{ ...DECK.sections[0], parts: ['html', 'js'] }, DECK.sections[1]] }, mode: 'standalone', scriptFiles: true });
  assert.deepEqual(r.scripts.map((s) => s.name), ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js', 'global.js', 'section-s1.js']);
  for (const s of r.scripts) assert.ok(r.html.includes(`<script src="${s.name}"></script>`), s.name);
  assert.ok(r.scripts.at(-1).text.startsWith('(function(root){\nx()\n})'));
  assert.deepEqual(r.problems, [], 'the inliner leaves our own sibling names alone');
  assert.doesNotMatch(r.html.replace(/<style[\s\S]*?<\/style>/g, ''), /customElements\.define/);
});
test('an aborted export kills the bundler and leaves nothing', async () => {
  const tmpRoot = awkward(); const ac = new AbortController(); let killed = null;
  const slow = (cmd, args, opts) => { const c = new EventEmitter(); c.stderr = new EventEmitter(); c.kill = (s) => { killed = s; queueMicrotask(() => c.emit('close', null, 'SIGKILL')); }; opts.signal?.addEventListener('abort', () => c.kill('SIGKILL')); queueMicrotask(() => ac.abort()); return c; };
  await assert.rejects(assembleDeckStandalone({ workDir: await deckWorld(), plan: DECK, signal: ac.signal, tmpRoot, spawnImpl: slow }));
  assert.equal(killed, 'SIGKILL'); empty(tmpRoot);
});
test('thumbnails of a deck and a film are not blank, and run no script', () => {
  for (const kind of ['pitch', 'presentation']) assert.match(thumbStillCss(kind), /deck-stage:not\(:defined\)\{visibility:visible!important/);
  assert.match(thumbStillCss('video'), /\[data-film\]\{visibility:visible!important\}/);
  assert.equal(thumbStillCss('web'), '');
  const doc = staticDoc('<!doctype html><html><head><style>deck-stage:not(:defined){visibility:hidden}</style></head><body><deck-stage><section>S</section></deck-stage><script>x()</script></body></html>', { extraCss: thumbStillCss('pitch') });
  assert.ok(doc.includes(thumbStillCss('pitch'))); assert.equal(doc.includes('x()'), false); assert.ok(doc.includes("script-src 'none'"));
});

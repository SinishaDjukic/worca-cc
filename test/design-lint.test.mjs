// test/design-lint.test.mjs
// Plan Task 12: lintDesign over sections, scope and references, and its scanHtml and scanCss helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { assembleDesign, lintDesign } from '../src/core/design/assemble.mjs';
import { HTML_MAX_DEPTH, HTML_MAX_SCAN_LENGTH, scanCss, scanHtml } from '../src/core/design/html-scan.mjs';
import { checkRows } from './helpers/rows.mjs';

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><main><!--worca:sections--></main><!--worca:foot--></body></html>';
const dirs = []; after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function world(files) {
  const d = mkdtempSync(join(tmpdir(), 'dlint-')); dirs.push(d);
  const work = join(d, 'work'); mkdirSync(work);
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); }
  return work;
}

const plan = (kind = 'web', ids = ['hero']) => ({ v: 1, kind, title: 'T', canvas: { w: 1440 }, notes: '', sections: ids.map((id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'], estHeight: 100 })) });
const OK_HTML = '<section data-section="hero"><h1>x</h1></section>'; const OK_CSS = '[data-section="hero"] h1{color:red}';
// The two files the reference rows point at are on disk, so only `missing-file` rows name one that is not.
const lint = (html = OK_HTML, css = OK_CSS, extra = {}, p = plan()) => lintDesign({ workDir: world({ 'shell.html': SHELL, 'sections/hero/index.html': html, 'sections/hero/style.css': css, 'assets/a.png': 'png', 'assets/x.woff2': 'font', ...extra }), plan: p });
const rules = (r) => r.findings.map((f) => f.rule);

test('a clean web design lints ok', () => { const r = lint(); assert.equal(r.ok, true); assert.deepEqual(r.findings, []); });

test('HTML rules', async () => {
  await checkRows([
    ['<section data-section="hero"></section><p>x</p>', ['section-root']],
    ['text<section data-section="hero"></section>', ['section-root']],
    ['<section></section>', ['section-root']],
    ['<section data-section="other"></section>', ['section-root']],
    ['<html><body data-section="hero"></body></html>', ['section-root']],
    ['<!-- note --><section data-section="hero"></section>\n', []],
    ['<section data-section="hero" data-worca-slot="hero"></section>', ['reserved-attr']],
    ['<section data-section="hero"><div data-worca-slot="pricing"></div></section>', ['reserved-attr']],
    ['<section data-section="hero"><b data-worca-bridge></b></section>', ['reserved-attr']],
    ['<section data-section="hero"><img src="https://x.dev/a.png"></section>', ['external-url']],
    ['<section data-section="hero"><img srcset="assets/a.png 1x, https://x.dev/b.png 2x"></section>', ['external-url']],
    ['<section data-section="hero"><img src="../../x.png"></section>', ['escapes-work']],
    ['<section data-section="hero"><img src="assets/a.png"></section>', []],
    ['<section data-section="hero"><img src="assets/att/clarify.png"></section>', ['missing-file']],
    ['<section data-section="hero"><img src="assets/a.png" srcset="assets/a.png 1x, assets/b.png 2x"></section>', ['missing-file']],
    ['<section data-section="hero"><img src="assets/b.png"><img src="assets/b.png?v=2"><img src="./assets/b.png#x"></section>', ['missing-file']],
    ['<section data-section="hero"><img src="assets"></section>', ['missing-file']],
    ['<section data-section="hero"><a href="assets/b.png">x</a><form action="send"></form></section>', []],
    ['<section data-section="hero"><svg><use href="#mark"/></svg><img src="data:image/png;base64,AAAA"></section>', []],
    ['<section data-section="hero"><div style="background:url(assets/b.png)"></div></section>', ['missing-file']],
    ['<section data-section="hero"><a href="https://worca.dev">x</a></section>', []],
    ['<section data-section="hero"><a href="../../x">x</a></section>', ['escapes-work']],
    ['<section data-section="hero"><iframe src="https://x.dev/"></iframe></section>', ['external-url']],
    ['<section data-section="hero"><form action="../../x"></form></section>', ['escapes-work']],
    ['<section data-section="hero"><div style="background:url(https://x.dev/a.png)"></div></section>', ['external-url']],
    ['<section data-section="hero"><style>b{background:url(../../x.png)}</style></section>', ['escapes-work']],
  ].map(([h, want]) => ({ name: h, run: () => assert.deepEqual(rules(lint(h)), want) })));
});

test('CSS rules', async () => {
  await checkRows([
    ['h1{color:red}', ['css-scope']], [':root{--x:1}', ['css-scope']],
    ['[data-section="hero"] h1, h2{top:0}', ['css-scope']],
    ['[data-section="pricing"] h1{top:0}', ['css-scope']],
    ['[data-section=\'hero\'] h1, [data-section=hero] h2{top:0}', []],
    ['@media (min-width:1px){[data-section="hero"] h1{top:0}}', []],
    ['@media (min-width:1px){h1{top:0}}', ['css-scope']],
    ['@supports (top:0){@media print{h1{top:0}}}', ['css-scope']],
    ['@keyframes spin{from{top:0}to{top:1px}}', ['keyframes-prefix']],
    ['@keyframes hero-spin{from{top:0}to{top:1px}}', []],
    ['/* h1{} */[data-section="hero"] a::after{content:"}h1{"}', []],
    ['[data-section="hero"]{.a{color:red}}', []],
    ['[data-section="hero"] a{background:url(https://x.dev/a.png)}', ['external-url']],
    ['@import url(../x.css);', ['escapes-work']],
    ['@font-face{font-family:x;src:url(assets/x.woff2)}', []],
    ['@font-face{font-family:x;src:url(assets/y.woff2)}', ['missing-file']],
    ['[data-section="hero"] a{background:url(assets/b.png)}[data-section="hero"] b{background:url("assets/b.png")}', ['missing-file']],
    ['[data-section="hero"] a[href="a,b"]{top:0}', []],
    ['[data-section="hero"] :is(a,b){top:0}', []],
    ['@-webkit-keyframes spin{from{top:0}to{top:1px}}', ['keyframes-prefix']],
    ['@container (min-width:1px){h1{top:0}}', ['css-scope']], ['@layer base{h1{top:0}}', ['css-scope']],
    ['@import "../x.css";', ['escapes-work']],
  ].map(([c, want]) => ({ name: c, run: () => assert.deepEqual(rules(lint(OK_HTML, c)), want) })));
});

test('across sections: duplicate ids name both; parts and shell', () => {
  const two = lintDesign({ workDir: world({ 'shell.html': SHELL.replace('<main>', '<main id="top">'),
    'sections/hero/index.html': '<section data-section="hero"><h1 id="t"></h1><i id="top"></i></section>', 'sections/hero/style.css': OK_CSS,
    'sections/pricing/index.html': '<section data-section="pricing"><h2 id="t"></h2></section>', 'sections/pricing/style.css': '[data-section="pricing"]{top:0}' }), plan: plan('web', ['hero', 'pricing']) });
  const dup = two.findings.filter((f) => f.rule === 'duplicate-id');
  assert.equal(dup.length, 2);
  assert.match(dup[0].message + dup[1].message, /"t".*hero.*pricing/s);
  const missing = lintDesign({ workDir: world({ 'shell.html': SHELL }), plan: plan() });
  assert.deepEqual(missing.findings.map((f) => [f.rule, f.file]), [['missing-part', 'sections/hero/index.html'], ['missing-part', 'sections/hero/style.css']]);
  const extra = lint(OK_HTML, OK_CSS, { 'sections/hero/script.js': 'x' });
  assert.equal(extra.ok, true, 'a warning does not fail');
  assert.deepEqual(extra.findings.map((f) => [f.rule, f.severity]), [['unplanned-part', 'warn']]);
  assert.deepEqual(rules(lintDesign({ workDir: world({ 'shell.html': '<html></html>', 'sections/hero/index.html': OK_HTML, 'sections/hero/style.css': OK_CSS }), plan: plan() })), ['shell-marker', 'shell-marker', 'shell-marker']);
  assert.deepEqual(rules(lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('</head>', '<link rel="stylesheet" href="https://fonts.example/x.css"></head>') })), ['external-url']);
  assert.deepEqual(rules(lint(OK_HTML, OK_CSS, { 'tokens.css': 'body{background:url(https://x.dev/a.png)}' })), ['external-url'], 'global files are not scope-checked, but their URLs are');
  assert.deepEqual(rules(lint(OK_HTML, OK_CSS, { 'global.css': '@import url(../x.css);' })), ['escapes-work']);
  assert.deepEqual(rules(lintDesign({ workDir: world({ 'sections/hero/index.html': OK_HTML, 'sections/hero/style.css': OK_CSS }), plan: plan() })), ['shell-marker', 'shell-marker', 'shell-marker'], 'no shell.html reads as an empty shell');
  const unended = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<!--worca:foot--></body></html>', '</body></html><!--worca:foot') });
  assert.deepEqual(rules(unended), ['shell-marker'], 'a marker comment the shell never ends is no marker');
  assert.match(unended.findings[0].message, /<!--worca:foot--> must appear exactly once, found 0/);
});

test('shell slots: allowed in the shell; unknown, duplicate and malformed are errors; the marker rule follows them', async () => {
  const both = { 'sections/hero/index.html': OK_HTML, 'sections/hero/style.css': OK_CSS, 'sections/pricing/index.html': '<section data-section="pricing"></section>', 'sections/pricing/style.css': '[data-section="pricing"]{top:0}' };
  const shell = (body) => `<!doctype html><html><head><!--worca:head--></head><body>${body}<!--worca:foot--></body></html>`;
  const run = (body) => lintDesign({ workDir: world({ ...both, 'shell.html': shell(body) }), plan: plan('web', ['hero', 'pricing']) });
  const H = '<div data-worca-slot="hero"></div>'; const P = '<div data-worca-slot="pricing"></div>'; const M = '<!--worca:sections-->';
  await checkRows([
    [H + P, []], [H + P + M, []], [H + M, []], [M, []],
    [H, ['shell-marker']],
    [H + P + M + M, ['shell-marker']],
    [`${H}${P}<div data-worca-slot="ghost"></div>`, ['shell-slot-unknown']],
    [`${H}${H}${P}`, ['shell-slot-duplicate']],
    [`<div data-worca-slot="hero">x</div>${P}${M}`, ['shell-slot-malformed']],
    [`<section data-worca-slot="hero"></section>${P}${M}`, ['shell-slot-malformed']],
    [`<div data-worca-slot></div>${H}${P}`, ['shell-slot-malformed']],
    [`<div data-worca-slot="hero">x</div>${P}`, ['shell-marker', 'shell-slot-malformed']],
    [`<div class="x" data-worca-slot="hero"></div>${P}`, ['shell-slot-attrs']],
    // A commented-out slot is no slot, but its data-worca- text is still refused, as all such text outside a parsed attribute is.
    [`<!-- <div data-worca-slot="ghost"></div> -->${H}${P}`, ['reserved-attr']],
    [`<b data-worca-bridge></b>${H}${P}`, ['reserved-attr']],
    [`<b data-worca-css="x"></b>${H}${P}`, ['reserved-attr']],
  ].map(([b, want]) => ({ name: b, run: () => assert.deepEqual(rules(run(b)), want) })));
  const f = (b) => run(b).findings[0];
  assert.match(f(H).message, /pricing/);
  assert.match(f(`${H}${P}<div data-worca-slot="ghost"></div>`).message, /"ghost"/);
  assert.deepEqual([f(`${H}${H}${P}`).section, f(`${H}${H}${P}`).file, f(`${H}${H}${P}`).severity], ['hero', 'shell.html', 'error']);
  assert.equal(run(`${H}${H}${P}`).ok, false);
  const attrs = run(`<div class="x" data-worca-slot="hero"></div>${P}`);
  assert.deepEqual([attrs.ok, attrs.findings[0].severity], [true, 'warn']);
  const headless = lintDesign({ workDir: world({ ...both, 'shell.html': `<body><!--worca:head-->${H}${P}<!--worca:foot--></body>` }), plan: plan('web', ['hero', 'pricing']) });
  assert.deepEqual(rules(headless), ['shell-marker'], 'no parsed head before the markers: P3\'s run doc, which has a bridge, would throw BAD_SHELL');
  assert.match(headless.findings[0].message, /head/);
});

test('M11: vh in a web section is a warning, on any viewport-height unit; other kinds are not judged', () => {
  for (const c of ['[data-section="hero"]{height:100vh}', '[data-section="hero"]{min-height:calc(50svh + 1px)}', '[data-section="hero"]{height:80DVH}']) {
    const r = lint(OK_HTML, c);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.severity, f.section, f.file]), [['section-vh', 'warn', 'hero', 'sections/hero/style.css']], c);
    assert.equal(r.ok, true, 'a warning does not fail');
  }
  for (const c of ['[data-section="hero"]{height:820px}', '[data-section="hero"]{height:clamp(480px,60%,900px)}', '[data-section="hero"] a::after{content:"100vh"}', '/* 100vh */[data-section="hero"]{top:0}', '[data-section="hero"] .vh1{top:0}']) assert.deepEqual(rules(lint(OK_HTML, c)), [], c);
  const film = { ...plan('video', ['hero']), canvas: { w: 1920, h: 1080, fps: 60 } };
  assert.deepEqual(rules(lint('<div data-section="hero" data-scene></div>', '[data-section="hero"]{height:100vh}', {}, film)), []);
});

test('the root element per kind (C-2 table)', () => {
  const deck = { ...plan('presentation', ['hero']), canvas: { w: 1920, h: 1080 } };
  assert.deepEqual(rules(lint('<div data-section="hero" data-label="x"></div>', OK_CSS, {}, deck)), ['section-root']);
  assert.deepEqual(rules(lint('<section data-section="hero"></section>', OK_CSS, {}, deck)), ['section-root'], 'no data-label');
  assert.deepEqual(rules(lint('<section data-section="hero" data-label="x"></section>', OK_CSS, {}, deck)), []);
  const film = { ...plan('video', ['hero']), canvas: { w: 1920, h: 1080, fps: 60 } };
  assert.deepEqual(rules(lint('<section data-section="hero"></section>', OK_CSS, {}, film)), ['section-root']);
  assert.deepEqual(rules(lint('<div data-section="hero" data-scene></div>', OK_CSS, {}, film)), []);
});

test('never throws on garbage; findings are capped at 200', () => {
  for (const g of ['\u0000\uFFFD<<<', '<!-- never closed', '<section', '{{{{', '/* open', '"']) assert.equal(typeof lint(g, g).ok, 'boolean', g);
  const r = lint(OK_HTML, Array.from({ length: 300 }, (_, i) => `h${i}{top:0}`).join(''));
  assert.equal(r.findings.length, 201);
  assert.equal(r.findings.at(-1).rule, 'truncated');
  assert.equal(r.findings.at(-1).severity, 'warn');
  assert.equal(r.counts.error, 300, 'the count is still true');
});

test('each error rule is an error and fails the lint (only unplanned-part, shell-slot-attrs, section-vh and truncated warn)', async () => {
  const slot = (body) => SHELL.replace('<!--worca:sections-->', body);
  await checkRows([
    ['escapes-work', 'escapes-work', () => lint('<section data-section="hero"><img src="../../x.png"></section>')],
    ['external-url', 'external-url', () => lint('<section data-section="hero"><img src="https://x.dev/a.png"></section>')],
    ['missing-file', 'missing-file', () => lint('<section data-section="hero"><img src="assets/nope.png"></section>')],
    ['section-root', 'section-root', () => lint('<section></section>')],
    ['reserved-attr in a section', 'reserved-attr', () => lint('<section data-section="hero"><b data-worca-bridge></b></section>')],
    ['reserved-attr in the shell', 'reserved-attr', () => lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<main>', '<main data-worca-css="x">') })],
    ['css-scope', 'css-scope', () => lint(OK_HTML, 'h1{top:0}')],
    ['keyframes-prefix', 'keyframes-prefix', () => lint(OK_HTML, '[data-section="hero"]{top:0}@keyframes spin{from{top:0}}')],
    ['missing-part', 'missing-part', () => lintDesign({ workDir: world({ 'shell.html': SHELL, 'sections/hero/index.html': OK_HTML }), plan: plan() })],
    ['shell-marker', 'shell-marker', () => lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<!--worca:foot-->', '') })],
    ['shell-slot-malformed', 'shell-slot-malformed', () => lint(OK_HTML, OK_CSS, { 'shell.html': slot('<div data-worca-slot="hero">x</div><!--worca:sections-->') })],
    ['shell-slot-unknown', 'shell-slot-unknown', () => lint(OK_HTML, OK_CSS, { 'shell.html': slot('<!--worca:sections--><div data-worca-slot="ghost"></div>') })],
    ['shell-slot-duplicate', 'shell-slot-duplicate', () => lint(OK_HTML, OK_CSS, { 'shell.html': slot('<div data-worca-slot="hero"></div><div data-worca-slot="hero"></div>') })],
    ['duplicate-id', 'duplicate-id', () => lint('<section data-section="hero"><i id="t"></i><b id="t"></b></section>')],
  ].map(([name, rule, run]) => ({ name, run: () => {
    const r = run();
    assert.deepEqual(r.findings.map((f) => [f.rule, f.severity]), [[rule, 'error']]);
    assert.deepEqual([r.ok, r.counts], [false, { error: 1, warn: 0 }]);
  } })));
});

test('a pitch deck needs a slide root; an unplanned style.css is still judged; area[href] is a nav ref', () => {
  const pitch = { ...plan('pitch', ['hero']), canvas: { w: 1920, h: 1080 } };
  assert.deepEqual(rules(lint('<div data-section="hero" data-label="x"></div>', OK_CSS, {}, pitch)), ['section-root']);
  assert.deepEqual(rules(lint('<section data-section="hero"></section>', OK_CSS, {}, pitch)), ['section-root'], 'no data-label');
  assert.deepEqual(rules(lint('<section data-section="hero" data-label="x"></section>', OK_CSS, {}, pitch)), []);
  const htmlOnly = { ...plan(), sections: plan().sections.map((s) => ({ ...s, parts: ['html'] })) };
  const unplanned = lint(OK_HTML, 'h1{}[data-section="hero"]{background:url(../../x)}', {}, htmlOnly);
  assert.deepEqual(unplanned.findings.map((f) => [f.rule, f.severity, f.file]), [
    ['unplanned-part', 'warn', 'sections/hero/style.css'], ['css-scope', 'error', 'sections/hero/style.css'], ['escapes-work', 'error', 'sections/hero/style.css'],
  ]);
  assert.equal(unplanned.ok, false);
  const area = lint('<section data-section="hero"><map name="m"><area href="../../x"></map></section>');
  assert.deepEqual([rules(area), area.ok], [['escapes-work'], false]);
  assert.deepEqual(rules(lint('<section data-section="hero"><map name="m"><area href="https://worca.dev"></map></section>')), [], 'a remote area only navigates');
});

test('a <![CDATA[ anywhere fails the file: a browser ends it at its first > outside svg and math, and lint cannot tell where it leaves them', () => {
  const hidden = lint('<section data-section="hero"><![CDATA[><img src="https://x.dev/a.png" data-worca-bridge>]]></section>');
  assert.deepEqual([hidden.findings.map((f) => [f.rule, f.severity, f.file]), hidden.ok], [[['section-root', 'error', 'sections/hero/index.html'], ['reserved-attr', 'error', 'sections/hero/index.html']], false]);
  assert.match(hidden.findings[0].message, /CDATA/);
  assert.equal(scanHtml('<p><![CDATA[><i>]]></p>').unread, 'cdata');
  assert.equal(scanHtml('<svg><text><![CDATA[a < b]]></text></svg>').unread, 'cdata', 'inside svg too');
  for (const fine of ['<section data-section="hero"><!--[CDATA[ x ]]--></section>', '<section data-section="hero"><![cdata[x]></section>']) {
    assert.deepEqual(rules(lint(fine)), [], `${fine}: htmlparser2 reads it as a browser does`);
  }
  const shell = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<main>', '<main><![CDATA[><b data-worca-bridge>]]>') });
  assert.deepEqual([rules(shell), shell.ok], [['shell-marker', 'reserved-attr'], false]);
  assert.match(shell.findings[0].message, /CDATA/);
});

// Each row is markup where htmlparser2's tree builder leaves a browser's, so text one of them reads as markup the other
// reads as text. In each, a browser (Chrome 156, parse5) builds the live <img> or <input>, which loads the remote URL,
// while htmlparser2 never sees it. The remote-only IMG carries no reserved attribute, so the raw-text backstop cannot
// catch these: only `unread` can.
const IMG = '<img src="https://x.dev/a.png">';
const INPUT = '<input type="image" src="https://x.dev/a.png">';
const DIVERGES = [
  // start-tag and end-tag breakouts: a browser has left svg/math, so the CDATA is a bogus comment there
  ['cdata', `<svg><p><![CDATA[>${IMG}]]></svg>`], ['cdata', `<svg><div><![CDATA[>${IMG}]]></div></svg>`],
  ['cdata', `<math><b><![CDATA[>${IMG}]]></b></math>`], ['cdata', `<svg><font color=red><![CDATA[>${IMG}]]></font></svg>`],
  ['cdata', `<svg></p><![CDATA[>${IMG}]]></svg>`], ['cdata', `<svg></br><![CDATA[>${IMG}]]></svg>`],
  // integration points htmlparser2 matches by name in any namespace (annotation-xml always)
  ['rawtext', `<math><annotation-xml><style>${IMG}</style></annotation-xml></math>`], ['rawtext', `<math><desc><style>${IMG}</style></desc></math>`],
  ['rawtext', `<math><title><style>${IMG}</style></title></math>`], ['rawtext', `<svg><mtext><style>${IMG}</style></mtext></svg>`],
  // self-closed integration points htmlparser2 never closes
  ['rawtext', `<svg><desc/><style>${IMG}</style></svg>`], ['rawtext', `<svg><title/><style>${IMG}</style></svg>`],
  ['rawtext', `<svg><foreignObject/><style>${IMG}</style></svg>`], ['rawtext', `<math><mi/><style>${IMG}</style></math>`],
  ['rawtext', `<math><annotation-xml/><style>${IMG}</style></math>`],
  // every raw-text name: htmlparser2 reads its body as text, a browser in svg as markup
  ...['script', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'plaintext'].map((name) => ['rawtext', `<svg><desc/><${name}>${IMG}</${name}></svg>`]),
  // end tags htmlparser2 pops past svg with, where a browser ignores them and stays inside
  ['rawtext', `<div><svg><desc></div></desc><style>${IMG}</style></svg></div>`],
  ['rawtext', `<svg><foreignObject><div></svg></div></foreignObject><style>${IMG}</style>`],
  // breakouts: a browser's raw text ends at </style, where htmlparser2 is inside a comment
  ['rawtext', `<svg><p><style><!--</style>${IMG}-->`], ['rawtext', `<svg><p><style>x</svg><!--</style>${IMG}-->`],
  ['rawtext', `<svg><p><noscript><!--</noscript>${IMG}-->`],
  // the old select parser ignores a raw-text start tag and reads its body as markup
  ...['style', 'title', 'xmp', 'noembed'].map((name) => ['rawtext', `<select><${name}>${INPUT}</${name}></select>`]),
  // noscript is raw text while scripts run
  ['rawtext', `<noscript><style></noscript>${IMG}</style>`], ['rawtext', `<noscript><b title="</noscript>${IMG}">`], ['rawtext', `<noscript><!--</noscript>${IMG}-->`],
  // a script's <!-- <script> escape: a browser's script runs past the first </script>
  ['rawtext', `<script><!--<script></script><!--</script>${IMG}-->`], ['rawtext', `<script><!--<SCRIPT/></script><!--</script>${IMG}-->`],
  // only </title followed by space, / or > ends it; a plaintext never ends in htmlparser2; template's column-group mode
  ['rawtext', `<svg><desc/><title>a</titlex>${IMG}</title></svg>`], ['rawtext', `<svg><desc/><plaintext></plaintext>${IMG}</svg>`],
  ['rawtext', `<template><col><style></template>${IMG}</style>`],
  // only an end tag ends it: a <!title> is a bogus comment, and htmlparser2 reads the integration point's title as text
  ['rawtext', `<math><annotation-xml><title><!title>${IMG}</title></annotation-xml></math>`],
  // htmlparser2 ends an end tag at its first >, a browser reads its attributes
  ['endtag', `</p a="><!--">${IMG}-->`], ['endtag', `</p a="><style>">${IMG}</style>`], ['endtag', `<style></style a="><style>">${IMG}</style>`],
  ['endtag', `<b></b a='><style>'>${IMG}</style>`],
  // htmlparser2 reads U+001C as < and U+000F as / in a raw-text end tag
  ['control', `<style><\x0Fstyle><!--</style>${IMG}-->`], ['control', `<style>\x1C/style><!--</style>${IMG}-->`],
];
const SHOWN = { cdata: /CDATA/, rawtext: /raw-text/, endtag: /end tag/, control: /control character/ };

test('M10: markup htmlparser2 and a browser read differently fails the file, before lint could miss a live element in it', async () => {
  await checkRows(DIVERGES.map(([why, inner]) => ({ name: inner, run: () => {
    assert.equal(scanHtml(inner).unread, why);
    const r = lint(`<section data-section="hero">${inner}</section>`);
    assert.deepEqual([r.findings.map((f) => [f.rule, f.severity]), r.ok], [[['section-root', 'error']], false]);
    assert.match(r.findings[0].message, SHOWN[why]);
    // A <plaintext> takes the markers after it too, so only the first finding is this one.
    const shell = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<main>', `${inner}<main>`) });
    assert.deepEqual([shell.findings[0].rule, shell.ok], ['shell-marker', false], 'the shell, the same');
    assert.match(shell.findings[0].message, SHOWN[why]);
  } })));
  assert.equal(scanHtml(`<!doctype html><html><head></head><frameset><style><frame src="https://x.dev/a"></style></frameset></html>`).unread, 'rawtext', 'frameset ignores a <style>, and loads the frame');
});

test('M10: raw-text bodies a browser reads as htmlparser2 does stay clean', async () => {
  await checkRows([
    '<svg><title>Logo</title></svg>', '<svg><style>.a{fill:red}</style></svg>', '<svg><title>a &lt; b</TITLE ></svg>', '<svg><desc>d</desc><title>x</title><path d="M0"/></svg>',
    '<style>[data-section="hero"]::after{content:"<"}</style>', '<script>if (a < b) go();</script><svg></svg>', '<script><!-- go() --></script>',
    '<script>var a = "<!--";</script>', '<noscript>Turn scripts on</noscript>', '<select><option>x</option></select><p>y</p>', '<textarea>a < b</textarea><math></math>',
    // the fail-closed guards' clean side: two scripts in a row, any case of </script, a style comment, a bogus end
    // tag, an optgroup a </select> closes, and every character that may end a raw-text end tag
    '<script>a()</script><script>b()</script>', '<script>a()</SCRIPT><!-- <script> -->', '<style>/* <!-- <script> */</style>', '<i></ "b"></i>',
    '<select><optgroup label="a"><option>x</select>', ...['\t', '\n', '\f', '\r', '/'].map((c) => `<svg><title>a</title${c}></svg>`),
  ].map((inner) => ({ name: inner, run: () => {
    assert.equal(scanHtml(inner).unread, null);
    assert.deepEqual(rules(lint(`<section data-section="hero">${inner}</section>`)), []);
  } })));
});

test('M10: data-worca- text that is not an attribute lint read is an error, in sections and the shell', async () => {
  await checkRows([
    // a browser builds a second svg <form> with the attribute; htmlparser2 drops it as a nested form
    '<svg><form><form data-worca-bridge></form></form></svg>', '<p>data-worca-bridge</p>', '<!-- data-worca-slot -->', '<i title="DATA-WORCA-x"></i>',
  ].map((inner) => ({ name: inner, run: () => {
    const r = lint(`<section data-section="hero">${inner}</section>`);
    assert.deepEqual([r.findings.map((f) => [f.rule, f.severity, f.file]), r.ok], [[['reserved-attr', 'error', 'sections/hero/index.html']], false]);
    assert.match(r.findings[0].message, /data-worca-/);
    const shell = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<main>', `${inner}<main>`) });
    assert.deepEqual([shell.findings.map((f) => [f.rule, f.section, f.file]), shell.ok], [[['reserved-attr', null, 'shell.html']], false]);
  } })));
  const twice = lint('<section data-section="hero"><b data-worca-bridge></b><p>data-worca-x data-worca-y</p></section>');
  assert.deepEqual(rules(twice), ['reserved-attr', 'reserved-attr'], 'the parsed one, and one finding for the rest');
  assert.match(twice.findings[1].message, /2 more times/);
});

test('M10 end to end: a shell and a section hiding live, bridge-marked images fail lint, and the strict modes refuse the shell', () => {
  const MARKED = '<img src="https://x.dev/a.png" data-worca-bridge>';
  const shell = SHELL.replace('<main>', `<svg><desc/><style>${MARKED}</style></svg><main>`);
  const workDir = world({ 'shell.html': shell, 'sections/hero/index.html': `<section data-section="hero"><math><mi/><style>${MARKED}</style></math></section>`, 'sections/hero/style.css': OK_CSS });
  const r = lintDesign({ workDir, plan: plan() });
  // The shell's second shell-marker: htmlparser2 closes the <desc/> at </svg>, so the markers after it are misplaced too.
  assert.deepEqual([r.findings.map((f) => [f.rule, f.file]), r.ok], [[['section-root', 'sections/hero/index.html'], ['reserved-attr', 'sections/hero/index.html'],
    ['shell-marker', 'shell.html'], ['shell-marker', 'shell.html'], ['reserved-attr', 'shell.html']], false]);
  for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir, plan: plan(), mode }), (e) => e.code === 'BAD_SHELL' && /raw-text/.test(e.message), mode);
});

test('lint and assembly judge the same plan sections: a section with a non-string id is in neither', () => {
  const p = plan();
  p.sections.push({ id: 5, job: 'x', brief: 'b', parts: ['html'], estHeight: 100 });
  const workDir = world({ 'shell.html': SHELL, 'sections/hero/index.html': OK_HTML, 'sections/hero/style.css': OK_CSS, 'sections/5/index.html': '<script src="https://x.dev/a.js"></script>' });
  assert.equal(lintDesign({ workDir, plan: p }).ok, true);
  for (const mode of ['run', 'dist', 'standalone']) {
    const r = assembleDesign({ workDir, plan: p, mode });
    assert.deepEqual(r.sections, [{ id: 'hero', state: 'included' }], mode);
    assert.equal(r.html.includes('x.dev'), false, mode);
  }
});

test('M10 across files: a marker or slot where a browser reads the fill in another context fails the shell', async () => {
  // Each section is clean alone: its <style> hides the img from htmlparser2. Filled inside svg, math, select or
  // template, a browser reads that style as markup (Chrome 156 loads the img for the svg rows).
  const files = { 'sections/hero/index.html': `<section data-section="hero"><style>${IMG}</style></section>`, 'sections/hero/style.css': OK_CSS, 'tokens.css': `[data-section="hero"]{top:0}/*${IMG}*/` };
  const page = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}<!--worca:foot--></body></html>`;
  const M = '<!--worca:sections-->';
  await checkRows([
    [page('<!--worca:head-->', `<svg>${M}</svg>`), /<!--worca:sections-->/], [page('<!--worca:head-->', `<svg><div data-worca-slot="hero"></div></svg>${M}`), /slot "hero"/],
    [page('', `<svg><!--worca:head--></svg>${M}`), /<!--worca:head-->/], [page('<!--worca:head-->', `<math><mi>${M}</mi></math>`), /sections/],
    [page('<!--worca:head-->', `<select>${M}</select>`), /sections/], [page('<!--worca:head-->', `<template>${M}</template>`), /sections/],
    [page('<!--worca:head-->', `<svg><foreignObject><div></foreignObject></svg>${M}`), /<!--worca:sections--> and <!--worca:foot-->/],
    [page('<!--worca:head-->', `<div><svg><desc></div>${M}`), /sections/],
  ].map(([shell, named]) => ({ name: shell, run: () => {
    const workDir = world({ ...files, 'shell.html': shell });
    const r = lintDesign({ workDir, plan: plan() });
    assert.deepEqual([rules(r), r.ok], [['shell-marker'], false]);
    assert.match(r.findings[0].message, /inside an svg, math, select, frameset or template/);
    assert.match(r.findings[0].message, named);
    for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir, plan: plan(), mode }), (e) => e.code === 'BAD_SHELL' && /inside an svg/.test(e.message), mode);
  } })));
  for (const body of ['<header><svg><title>Logo</title><path d="M0"/><g><circle r="1"/></g></svg></header>', '<select><option>a<option>b</select>', '<svg><foreignObject><div>x</div></foreignObject></svg>']) {
    const workDir = world({ ...files, 'shell.html': page('<!--worca:head-->', `${body}${M}`) });
    assert.deepEqual(rules(lintDesign({ workDir, plan: plan() })), [], body);
    assert.equal(assembleDesign({ workDir, plan: plan(), mode: 'run' }).sections[0].state, 'included', body);
  }
});

test('M10 across files: a section must end between tags with every svg, math, select, frameset and template closed', async () => {
  await checkRows([
    '<section data-section="hero">x</section><!--', '<section data-section="hero"><style>x', '<section data-section="hero">x</section><img src="assets/a.png',
    '<section data-section="hero"><select></section>', '<section data-section="hero"><svg></section>', '<section data-section="hero"><template></section>',
    '<section data-section="hero">x</section><svg>',
    // a trailing <: the probe's own < makes it text, while a browser starts a tag with what follows it in the page
    '<section data-section="hero">x</section><', '<section data-section="hero">x<',
    // closed by </svg>, not by its own end tag: lint cannot follow which elements a browser still holds open
    '<section data-section="hero"><svg><path d="M0"></svg></section>',
  ].map((html) => ({ name: html, run: () => {
    assert.equal(scanHtml(html).unread, 'unclosed');
    const r = lint(html);
    assert.deepEqual([rules(r), r.ok], [['section-root'], false]);
    assert.match(r.findings[0].message, /close every element explicitly/);
  } })));
  assert.equal(scanHtml('<section data-section="hero">x</section><noscript>').unread, 'rawtext', 'a noscript with no end tag runs into the next section');
  assert.deepEqual(rules(lint('<section data-section="hero"><svg viewBox="0 0 1 1"><path d="M0"/><g><rect/></g></svg><select><option>a<option>b</select><p>x</section>')), []);
  // Joined, the comment section a leaves open runs into b and ends inside b's style: a browser loads the img.
  const two = lintDesign({ workDir: world({ 'shell.html': SHELL, 'sections/hero/index.html': '<section data-section="hero">x</section><!--', 'sections/hero/style.css': OK_CSS,
    'sections/pricing/index.html': `<section data-section="pricing"><style>-->${IMG}</style></section>`, 'sections/pricing/style.css': '[data-section="pricing"]{top:0}' }), plan: plan('web', ['hero', 'pricing']) });
  assert.deepEqual(two.findings.map((f) => [f.rule, f.section]), [['section-root', 'hero']]);
  // Joined, a section's trailing < and the text the shell has after the marker or slot are one live element (Chrome
  // 156 fetched and ran the script).
  const page = (body) => SHELL.replace('<main><!--worca:sections--></main>', body);
  for (const [html, shell] of [
    ['<section data-section="hero"><h1>Hi</h1></section><', page('<main><!--worca:sections-->script src="https://x.dev/a.js"></script></main>')],
    ['<section data-section="hero">x<', page('<main><div data-worca-slot="hero"></div>img src="https://x.dev/a.png"></main>')],
  ]) {
    const r = lintDesign({ workDir: world({ 'shell.html': shell, 'sections/hero/index.html': html, 'sections/hero/style.css': OK_CSS }), plan: plan() });
    assert.deepEqual([r.findings.map((f) => [f.rule, f.section]), r.ok], [[['section-root', 'hero']], false], html);
    assert.match(r.findings[0].message, /end the file between tags/);
  }
  // The shell side: a bare < right before a marker or slot joins with what fills it, or, when the fill is empty (no
  // script for the foot, no CSS for the head, a section with no html for its slot), with the shell text after it.
  for (const [shell, named] of [
    [SHELL.replace('<!--worca:foot-->', '<<!--worca:foot-->script src="https://x.dev/a.js"></script>'), /<!--worca:foot-->/],
    [SHELL.replace('<!--worca:head-->', '<<!--worca:head-->link rel="stylesheet" href="https://x.dev/a.css">'), /<!--worca:head-->/],
    [page('<main><div data-worca-slot="hero"></div><<!--worca:sections-->img src="https://x.dev/a.png"></main>'), /<!--worca:sections-->/],
    [page('<main><<div data-worca-slot="hero"></div>img src="https://x.dev/a.png"></main>'), /slot "hero"/],
  ]) {
    const workDir = world({ 'shell.html': shell, 'sections/hero/index.html': OK_HTML, 'sections/hero/style.css': OK_CSS });
    const r = lintDesign({ workDir, plan: plan() });
    assert.deepEqual([rules(r), r.ok], [['shell-marker'], false], shell);
    assert.match(r.findings[0].message, /bare </);
    assert.match(r.findings[0].message, named);
    for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir, plan: plan(), mode }), (e) => e.code === 'BAD_SHELL' && /bare </.test(e.message), mode);
  }
  assert.deepEqual(rules(lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<!--worca:foot-->', 'a < <!--worca:foot-->') })), [], 'a < with a space after it is text in both');
});

test('m6 and element names: img and image read src, srcset, href and xlink:href, whichever parser names them', async () => {
  await checkRows([
    ['<svg><image src="https://x.dev/a.png"/></svg>', ['external-url']], ['<svg><image href="https://x.dev/a.png"/></svg>', ['external-url']],
    ['<img href="https://x.dev/a.png">', ['external-url']], ['<img xlink:href="//x.dev/a.png">', ['external-url']], ['<svg><image srcset="https://x.dev/a.png 2x"/></svg>', ['external-url']],
    // a browser leaves svg at <p> and makes the image an img; htmlparser2 names it img inside desc
    ['<svg><p><image src="https://x.dev/a.png"></svg>', ['section-root', 'external-url']], ['<svg><desc/><image href="https://x.dev/a.png"/></svg>', ['section-root', 'external-url']],
  ].map(([inner, want]) => ({ name: inner, run: () => assert.deepEqual(rules(lint(`<section data-section="hero">${inner}</section>`)), want) })));
});

test('m6: a <base> and an svg <script href> load from where they point', async () => {
  await checkRows([
    ['<base href="https://x.dev/">', ['external-url']], ['<base href="../../">', ['escapes-work']],
    ['<svg><script href="https://x.dev/a.js"></script></svg>', ['external-url']], ['<svg><script xlink:href="//x.dev/a.js"></script></svg>', ['external-url']],
    ['<img src="&#1;https://x.dev/a.png">', ['external-url']], ['<img srcset="&#x1f;//x.dev/a.png 1x">', ['external-url']],
    ['<img src="&#1; &#1;https://x.dev/a.png">', ['external-url']],
    // an HTML script's src, which the svg entry for script must keep
    ['<script src="https://x.dev/a.js"></script>', ['external-url']], ['<script src="../../x.js"></script>', ['escapes-work']],
  ].map(([inner, want]) => ({ name: inner, run: () => assert.deepEqual(rules(lint(`<section data-section="hero">${inner}</section>`)), want) })));
});

test('nesting past HTML_MAX_DEPTH fails the file, and agent-written files cost linear CPU', () => {
  const deep = (n) => '<div>'.repeat(n);
  const section = lint(`<section data-section="hero">${deep(HTML_MAX_DEPTH + 1)}</section>`);
  assert.deepEqual([section.findings.map((f) => [f.rule, f.severity]), section.ok], [[['section-root', 'error']], false]);
  assert.match(section.findings[0].message, /512/);
  assert.equal(scanHtml(deep(HTML_MAX_DEPTH + 1)).unread, 'depth');
  assert.deepEqual([scanHtml(deep(HTML_MAX_DEPTH)).unread, rules(lint(`<section data-section="hero">${deep(HTML_MAX_DEPTH - 1)}</section>`))], [null, []], 'exactly the limit is fine');
  const shell = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('</body>', `${deep(HTML_MAX_DEPTH + 1)}</body>`) });
  assert.deepEqual(rules(shell), ['shell-marker'], 'every marker comes before the cut: the depth alone fails it');
  assert.match(shell.findings[0].message, /512/);
  const long = 'x'.repeat(HTML_MAX_SCAN_LENGTH);
  assert.deepEqual([scanHtml(long).unread, scanHtml(`${long}x`).unread], [null, 'size']);
  const big = lint(`<section data-section="hero">${long}</section>`);
  assert.deepEqual(rules(big), ['section-root']);
  assert.match(big.findings[0].message, /longer than 8 MiB/);
  const bigShell = lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('</body>', `${long}</body>`) });
  assert.deepEqual(rules(bigShell), ['shell-marker']);
  assert.match(bigShell.findings[0].message, /longer than 8 MiB/);
  // About 1 MiB each: a nest of divs in a section, and open slots in the shell. Both cost seconds of CPU when the
  // parser's stack or the open-slot list grows with the file.
  const files = { 'shell.html': SHELL.replace('</main>', `</main>${'<div data-worca-slot="hero">'.repeat(40_000)}`), 'sections/hero/index.html': `<section data-section="hero">${deep(200_000)}</section>`,
    'sections/hero/style.css': OK_CSS, '.crew.json': JSON.stringify([{ id: 'hero', status: 'done', summary: '' }]) };
  const workDir = world(files);
  const cpu = process.cpuUsage();
  const r = lintDesign({ workDir, plan: plan() });
  assembleDesign({ workDir, plan: plan(), mode: 'build', bridge: '<script data-worca-bridge></script>' });
  assembleDesign({ workDir: world({ ...files, 'shell.html': SHELL }), plan: plan(), mode: 'standalone' });
  const used = process.cpuUsage(cpu);
  assert.ok(used.user + used.system < 3e6, `took ${Math.round((used.user + used.system) / 1000)} ms of CPU`);
  assert.equal(r.ok, false);
  // Interior spaces in a URL, in an attribute and in a stylesheet: a regex trimming both edges retries every run of
  // them, so 80k spaces cost 2 s of CPU.
  const spaced = `a${' '.repeat(200_000)}b`;
  const before = process.cpuUsage();
  const urls = lint(`<section data-section="hero"><img src="${spaced}"></section>`, `[data-section="hero"]{background:url("${spaced}")}`);
  const spent = process.cpuUsage(before);
  assert.ok(spent.user + spent.system < 1e6, `200k spaces in two URLs took ${Math.round((spent.user + spent.system) / 1000)} ms of CPU`);
  assert.deepEqual(rules(urls), ['missing-file', 'missing-file'], 'a name too long for a disk is not on it');
  assert.ok(urls.findings.every((f) => f.message.length < 400), 'and its finding does not carry it whole');
});

test('scanHtml: the shapes P7 reads; a nested form the parser drops reaches no rule', () => {
  const s = scanHtml('<!-- c --> x <SECTION Data-Section="hero" id="a"><img id="b" src="assets/a.png" srcset="assets/b.png 1x, assets/c.png 2x"><a href="../y" data-worca-bridge>k</a><style>i{background:url(d.png)}</style><i style="background:url(e.png)"></i></SECTION>');
  assert.deepEqual(s.roots, [{ name: 'section', attrs: { 'data-section': 'hero', id: 'a' } }]);
  assert.equal(s.strayText.trim(), 'x');
  assert.deepEqual(s.ids, ['a', 'b']);
  assert.deepEqual(s.refs, [{ value: 'assets/a.png', nav: false }, { value: 'assets/b.png', nav: false }, { value: 'assets/c.png', nav: false }, { value: '../y', nav: true }, { value: 'd.png', nav: false }, { value: 'e.png', nav: false }]);
  assert.deepEqual(s.reserved.map((r) => [r.tag, r.name]), [['a', 'data-worca-bridge']]);
  assert.equal(scanHtml('<p>  \n</p>\n ').strayText, '');
  assert.deepEqual(['&', '&amp', '<'].map((end) => scanHtml(`<section data-section="hero">x</section>${end}`).strayText), ['&', '&', '<'], 'text the end probe flushes is the file\'s own');
  const nested = scanHtml('<form action="a"><form action="../../x" data-worca-bridge id="n"></form></form>');
  assert.deepEqual([nested.refs, nested.reserved, nested.ids], [[{ value: 'a', nav: true }], [], []]);
  assert.deepEqual(rules(lint('<section data-section="hero"><form action="a"><form action="../../x"></form></form></section>')), [], 'a browser drops it too');
});

test('scanCss: selectors, keyframes, every url once, vh', () => {
  const c = scanCss('@charset "utf-8";@import url(a.css) screen;@import "b.css";@layer x, y;@keyframes "q"{from{top:0}}@font-face{src:url(f.woff2)}@media print{ h1 , [data-x="1,2"] {top:0} }i{.n{background:url(\'g.png\')}}');
  assert.deepEqual(c.selectors, ['h1', '[data-x="1,2"]', 'i']);
  assert.deepEqual(c.keyframes, ['q']);
  assert.deepEqual(c.urls, ['a.css', 'b.css', 'f.woff2', 'g.png']);
  assert.equal(c.vh, false);
  assert.equal(scanCss('@media (min-height:100vh){i{top:0}}').vh, true, 'an at-rule prelude counts too');
  assert.equal(scanCss('i{background:url(a/100vh.png)}').vh, false, 'a url is not a length');
  assert.deepEqual(scanCss('i{top:0} "open').selectors, ['i'], 'an unterminated string ends the scan');
});

test('edges the plan rows leave open: scope and keyframes boundaries, a closed group, body and head roots, empty and repeated ids', async () => {
  await checkRows([
    ['@keyframes hero{from{top:0}}', []], ['@keyframes "hero-q"{from{top:0}}', []], ['@keyframes heroic{from{top:0}}', ['keyframes-prefix']],
    ['[data-section="hero-x"] a{top:0}', ['css-scope']], ['[data-section="hero] a[x="]{top:0}', ['css-scope']],
    ['@media print{i}[data-section="hero"]{top:0}', []],
  ].map(([c, want]) => ({ name: c, run: () => assert.deepEqual(rules(lint(OK_HTML, c)), want) })));
  for (const h of ['<body data-section="hero"></body>', '<head data-section="hero"></head>']) assert.deepEqual(rules(lint(h)), ['section-root'], h);
  const film = { ...plan('video', ['hero']), canvas: { w: 1920, h: 1080, fps: 60 } };
  for (const h of ['<div data-section="hero"></div>', '<section data-section="hero" data-scene></section>']) assert.deepEqual(rules(lint(h, OK_CSS, {}, film)), ['section-root'], `video: ${h}`);
  const blank = lintDesign({ workDir: world({ 'shell.html': SHELL, 'sections/hero/index.html': '<section data-section="hero"><i id=""></i></section>', 'sections/hero/style.css': OK_CSS,
    'sections/pricing/index.html': '<section data-section="pricing"><b id=""></b></section>', 'sections/pricing/style.css': '[data-section="pricing"]{top:0}' }), plan: plan('web', ['hero', 'pricing']) });
  assert.deepEqual(rules(blank), [], 'an empty id is no id');
  const twice = lint('<section data-section="hero"><i id="t"></i><b id="t"></b></section>');
  assert.deepEqual(twice.findings.map((f) => [f.rule, f.section, f.file, f.message]), [['duplicate-id', 'hero', 'sections/hero/index.html', 'id "t" is used 2 times, by hero']]);
  const many = lint(OK_HTML, Array.from({ length: 300 }, (_, i) => `h${i}{top:0}`).join(''));
  assert.deepEqual(many.counts, { error: 300, warn: 0 }, 'the truncated line is not a finding about the design');
});

test('big and broken input: no stack overflow, a linear vh test, bad strings and url tokens read as a browser reads them', async () => {
  const N = 150000;
  const img = '<img src="https://x.dev/a.png">';
  const css = `${Array(N).fill('h').join(',')}{top:0}[data-section="hero"]{${'b:url(https://x.dev/a.png);'.repeat(N)}}`;
  const big = lint(`<section data-section="hero">${img.repeat(N)}</section>`, css, { 'shell.html': SHELL.replace('</body>', `${img.repeat(N)}${'<!--worca:foot-->'.repeat(N)}</body>`) });
  assert.deepEqual([big.counts, big.findings.length, big.findings.at(-1).rule], [{ error: 4 * N + 1, warn: 0 }, 201, 'truncated']);
  const digits = `[data-section="hero"]{top:${'1'.repeat(120000)}px}`;
  const cpu = process.cpuUsage();
  assert.equal(scanCss(digits).vh, false);
  const used = process.cpuUsage(cpu);
  assert.ok(used.user + used.system < 1e6, `a long run of digits took ${Math.round((used.user + used.system) / 1000)} ms of CPU`);
  await checkRows([
    ['[data-section="hero"] a{content:"x\n}h1{top:0}', ['css-scope']],
    ['[data-section="hero"] a{content:"x\n}[data-section="hero"]{height:100vh}', ['section-vh']],
    ['[data-section="hero"] a{background:url(assets/x/*.png)}h1{top:0}', ['css-scope', 'missing-file']],
    ['[data-section="hero"] a{background:url(assets/a\'b.png)}h1{top:0}@keyframes spin{}', ['css-scope', 'keyframes-prefix']],
    ['[data-section="hero"] a{background:URL( assets/{x}.png )}h1{top:0}', ['css-scope', 'missing-file']],
  ].map(([c, want]) => ({ name: c, run: () => assert.deepEqual(rules(lint(OK_HTML, c)), want) })));
});

test('missing-file: a loaded reference to a file that is not in work/, in a section, a global file or the shell', () => {
  const one = lint('<section data-section="hero"><img src="assets/att/clarify.png" alt="x"></section>');
  assert.equal(one.ok, false);
  assert.deepEqual(one.findings.map((f) => [f.rule, f.severity, f.section, f.file]), [['missing-file', 'error', 'hero', 'sections/hero/index.html']]);
  assert.match(one.findings[0].message, /^"assets\/att\/clarify\.png" is not a file in this design/);
  // The file on disk clears it, wherever in work/ it is; a folder or a link out of work/ does not.
  assert.deepEqual(rules(lint('<section data-section="hero"><img src="assets/att/clarify.png"></section>', OK_CSS, { 'assets/att/clarify.png': 'png' })), []);
  assert.deepEqual(rules(lint('<section data-section="hero"><img src="assets/project/logo.svg"><img src="assets/web/a.jpg"></section>', OK_CSS, { 'assets/project/logo.svg': '<svg/>', 'assets/web/a.jpg': 'jpg' })), []);
  const linked = world({ 'shell.html': SHELL, 'sections/hero/index.html': '<section data-section="hero"><img src="assets/out.png"></section>', 'sections/hero/style.css': OK_CSS });
  writeFileSync(join(linked, '..', 'out.png'), 'png');
  mkdirSync(join(linked, 'assets'));
  symlinkSync(join(linked, '..', 'out.png'), join(linked, 'assets', 'out.png'));
  assert.deepEqual(rules(lintDesign({ workDir: linked, plan: plan() })), ['missing-file'], 'a link out of work/ loads nothing in an export');
  // Global files and the shell are the lead's own, and are checked the same way.
  assert.deepEqual(lint(OK_HTML, OK_CSS, { 'global.css': 'body{background:url(assets/bg.png)}' }).findings.map((f) => [f.rule, f.section, f.file]), [['missing-file', null, 'global.css']]);
  assert.deepEqual(lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('<main>', '<main><img src="assets/project/logo.svg">') }).findings.map((f) => [f.rule, f.section, f.file]), [['missing-file', null, 'shell.html']]);
  assert.deepEqual(rules(lint(OK_HTML, OK_CSS, { 'shell.html': SHELL.replace('</head>', '<link rel="stylesheet" href="tokens.css"></head>'), 'tokens.css': ':root{--a:1}' })), []);
  // No work/ folder at all says nothing about files: every part is already missing.
  assert.ok(!rules(lintDesign({ workDir: join(tmpdir(), 'no-such-design-work'), plan: plan() })).includes('missing-file'));
});

test('a document: the Look source line of brand.md, heading ids and order, no global.js, no slots', () => {
  const doc = (ids = ['intro']) => ({ v: 1, kind: 'document', title: 'T', canvas: { w: 794 }, page: 'A4', toc: true, numbered: false, notes: '',
    sections: ids.map((id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'], estHeight: 100 })) });
  const good = '<section data-section="intro"><h2 id="intro-title">Intro</h2><h3 id="intro-scope">Scope</h3></section>';
  const css = '[data-section="intro"] h2{margin:0}';
  const files = (over = {}) => ({ 'shell.html': SHELL, 'brand.md': 'Look source: worca — the brief names no style\n', 'sections/intro/index.html': good, 'sections/intro/style.css': css, ...over });
  const run = (over, p = doc()) => lintDesign({ workDir: world(files(over)), plan: p });
  assert.deepEqual(run().findings, [], 'a clean document lints ok');

  const noBrand = files(); delete noBrand['brand.md'];
  const missing = lintDesign({ workDir: world(noBrand), plan: doc() });
  assert.deepEqual(missing.findings, [{ rule: 'look-source', severity: 'error', section: null, file: 'brand.md', message: 'brand.md was not written: its first line is "Look source: <brief|project|skill|worca> — <why>"' }]);
  assert.equal(missing.ok, false);
  assert.deepEqual(run({ 'brand.md': 'Look source: mine — x' }).findings.map((f) => [f.rule, f.severity, f.message]),
    [['look-source', 'error', 'brand.md: Look source must be brief, project, skill or worca, found "mine"']]);
  assert.deepEqual(rules(run({ 'brand.md': 'Look source: project — CLAUDE.md' })), [], 'lint cannot know the project: the plan gate owns that rule');

  const badId = run({ 'sections/intro/index.html': '<section data-section="intro"><h2 id="title">Intro</h2><h3>Scope</h3></section>' });
  assert.deepEqual(badId.findings.map((f) => [f.rule, f.severity, f.section, f.message]), [
    ['doc-heading-id', 'warn', 'intro', '<h2> "Intro" has no id that starts with "intro-": the contents list cannot link to it'],
    ['doc-heading-id', 'warn', 'intro', '<h3> "Scope" has no id that starts with "intro-": the contents list cannot link to it'],
  ]);
  assert.equal(badId.ok, true, 'warns only');
  assert.deepEqual(run({ 'sections/intro/index.html': '<section data-section="intro"><p>x</p></section>' }).findings.map((f) => [f.rule, f.message]),
    [['doc-no-heading', 'section intro has no <h2>, so the contents list leaves it out']]);
  assert.deepEqual(rules(run({ 'sections/intro/index.html': '<section data-section="intro"><h3 id="intro-a">A</h3><h2 id="intro-b">B</h2></section>' })), ['doc-heading-order']);
  const script = run({ 'global.js': 'window.x=1' });
  assert.deepEqual(script.findings.map((f) => [f.rule, f.severity, f.file, f.message]), [['doc-script', 'warn', 'global.js', 'a document runs no script: the PDF and the thumbnail never run global.js']]);

  const slotted = run({ 'shell.html': SHELL.replace('<main>', '<main><div data-worca-slot="intro"></div>') });
  assert.deepEqual(slotted.findings.map((f) => [f.rule, f.message]),
    [['shell-slot-kind', 'slot "intro": a document takes no slots, every section goes to <!--worca:sections--> in plan order, so take the slot out']]);
  const noMarker = run({ 'shell.html': SHELL.replace('<!--worca:sections-->', '<div data-worca-slot="intro"></div>') });
  assert.ok(noMarker.findings.some((f) => f.rule === 'shell-marker' && /exactly once, found 0/.test(f.message)), 'a document needs the marker');

  // Plan order, then global files (look-source with them), then the shell.
  const order = run({ 'brand.md': '', 'global.js': 'x', 'sections/intro/index.html': '<section data-section="intro"><p>x</p></section>', 'shell.html': SHELL.replace('<main>', '<main><div data-worca-slot="intro"></div>') });
  assert.deepEqual(rules(order), ['doc-no-heading', 'look-source', 'doc-script', 'shell-slot-kind']);
});

test('a web design gets none of the document rules', () => {
  const r = lint('<section data-section="hero"><h3>x</h3><h2 id="nope">y</h2></section>', OK_CSS, { 'global.js': 'x', 'brand.md': 'no line' });
  assert.deepEqual(r.findings, []);
});

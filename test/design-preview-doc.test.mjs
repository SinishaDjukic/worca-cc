// test/design-preview-doc.test.mjs
// Design P3 Task 10: the build doc and the run doc, generated at serve time in memory (M5, M9, M10, Contract issue 4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { safeInlineScript, bridgeScriptTag, stripBuildDoc, renderPreviewDoc } from '../src/core/design/preview-doc.mjs';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { HTML_MAX_DEPTH } from '../src/core/design/html-scan.mjs';
import { validatePlan } from '../src/core/design/plan.mjs';
import { tmpDesign } from './helpers/design-preview-fixture.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'symlinks' : false };

/** Every file under `dir`, recursively. */
function walkFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out;
}

/** `[relPath, size, mtimeMs]` for every folder and file under `root`, sorted by path. */
function snapshotTree(root) {
  const rows = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const st = statSync(p);
      rows.push([relative(root, p), st.isDirectory() ? 0 : st.size, st.mtimeMs]);
      if (e.isDirectory()) walk(p);
    }
  };
  walk(root);
  return rows.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}

const NONCE = 'NONCE1';
test('safeInlineScript cannot close its own element or open a comment', () => {
  assert.equal(safeInlineScript('a</script>b</SCRIPT>c<!--d'), 'a<\\/script>b<\\/SCRIPT>c<\\!--d');
});
test('M10: bridge tags are one complete element with the marker; build carries the nonce and morphdom, run has neither', () => {
  const b = bridgeScriptTag({ mode: 'build', nonce: NONCE }); const r = bridgeScriptTag({ mode: 'run', nonce: NONCE });
  assert.ok(b.startsWith(`<script data-worca-bridge nonce="${NONCE}">`));
  assert.ok(r.startsWith('<script data-worca-bridge>'));
  assert.equal(BRIDGE_MARKER, 'data-worca-bridge');
  for (const t of [b, r]) { assert.ok(t.includes(BRIDGE_MARKER)); assert.ok(t.endsWith('</script>')); assert.equal(t.match(/<\/script/gi).length, 1); }
  assert.ok(b.length - r.length > 5000);
});
const STRIP = [
  ['<a href="javascript:x" class="c">t</a>', '<a class="c">t</a>'],
  ['<a href=" JaVa\tScRiPt:x">t</a>', '<a>t</a>'],
  ['<img src="a.png" onerror="x">', '<img src="a.png">'],
  ['<svg viewBox="0 0 1 1" onload="x"></svg>', '<svg viewBox="0 0 1 1"></svg>'],
  ['<a title="&quot;q&quot;" onclick="x">t</a>', '<a title="&quot;q&quot;">t</a>'],
  ['<meta http-equiv="refresh" content="0">', ''], ['<meta charset="utf-8">', '<meta charset="utf-8">'],
  ['<base href="x">', ''], ['<script>1</script>', ''], ['<script nonce="G">1</script>', ''],
  [`<script data-worca-bridge nonce="${NONCE}">1</script>`, `<script data-worca-bridge nonce="${NONCE}">1</script>`],
  ['<iframe srcdoc="x"></iframe>', ''], ['<object data="x"><p>y</p></object>', ''], ['<embed src="x">', ''],
  ['<p title="a &amp; b">x</p>', '<p title="a &amp; b">x</p>'],
  ['<style>.tile{zoom:.25}</style>', '<style>.tile{zoom:.25}</style>'],
  ['<!--worca:sections-->', '<!--worca:sections-->'],
  // htmlparser2's offsets: a tag after `</p >` starts at that `>`; an upper-case void tag must still close at once
  ['<p>x</p ><a onclick="x">t</a>', '<p>x</p ><a>t</a>'], ['<script>1</script >z', 'z'],
  ['<div><EMBED src=x><p>after</p></div>', '<div><p>after</p></div>'],
  // a void or self-closed element ends at its own open tag, so the text after it stays
  ['<div><EMBED src=x>mid<p>after</p></div>', '<div>mid<p>after</p></div>'],
  ['<svg><path d="M0" onclick="x"/><text>t</text></svg>', '<svg><path d="M0"/><text>t</text></svg>'],
  // attribute names keep their case but are compared lower-cased
  ['<a HREF="JavaScript:x" Title="t">u</a>', '<a Title="t">u</a>'], ['<img src="a.png" ONERROR="x">', '<img src="a.png">'],
];
test('stripBuildDoc removes hostile parts and copies everything else byte for byte', () => {
  for (const [i, w] of STRIP) assert.equal(stripBuildDoc(i, { nonce: NONCE }), w, i);
});
test('build doc: exactly one script, with the nonce, first in head; finished sections in, others slots', () => {
  const dir = tmpDesign({ hostile: true });
  const html = renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE });
  const { document: d } = new JSDOM(html).window;
  const scripts = d.querySelectorAll('script');
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0].getAttribute('nonce'), NONCE);
  assert.ok(scripts[0].hasAttribute(BRIDGE_MARKER));
  assert.equal(d.head.firstElementChild, scripts[0]);
  assert.ok(d.querySelector('[data-worca-slot="price"]'));
  assert.ok(d.querySelector('[data-section="hero"]'));
});
test('build doc: hostile markup is gone and does not run, even in an engine with no CSP', async () => {
  const dir = tmpDesign({ hostile: true });
  const html = renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE });
  const sent = [];
  const dom = new JSDOM(html, { url: 'http://localhost/design-preview/T/build/#n=n1', runScripts: 'dangerously',
    beforeParse(w) { w.parent = { postMessage: (m) => sent.push(m) }; } });
  await new Promise((r) => dom.window.addEventListener('load', r));
  const { window: w } = dom; const d = w.document;
  assert.ok(sent.some((m) => m.t === 'ready'), 'the bridge did run');
  for (const el of d.querySelectorAll('img,svg,a,details,button,body')) for (const ev of ['error', 'load', 'click', 'toggle']) el.dispatchEvent(new w.Event(ev, { bubbles: true, cancelable: true }));
  assert.equal(w.__pwn, undefined);
  d.querySelector('script').remove();
  const rest = d.documentElement.outerHTML;
  for (const bad of [/\son\w+=/i, /javascript:/i, /<iframe/i, /<object/i, /<embed/i, /http-equiv/i, /<base/i, /<script/i]) assert.doesNotMatch(rest, bad);
  dom.window.close();
});
test('run doc: bridge first in head with no nonce; the artifact stays whole', () => {
  const dir = tmpDesign({});
  const { document: d } = new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'run', nonce: NONCE })).window;
  const first = d.head.firstElementChild;
  assert.equal(first.tagName, 'SCRIPT');
  assert.equal(first.hasAttribute('nonce'), false);
  assert.ok(first.hasAttribute(BRIDGE_MARKER));
});
test('no plan, a half-written one, or a linked one: a doc that still carries the bridge', () => {
  const dir = tmpDesign({ noPlan: true });
  for (const mode of ['build', 'run']) {
    const { document: d } = new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode, nonce: NONCE })).window;
    assert.equal(d.querySelectorAll('script').length, 1, mode);
    assert.equal(d.querySelectorAll('[data-section]').length, 0, mode);
  }
  writeFileSync(join(dir.work, 'plan.json'), '{"v":1,"sec');
  assert.equal(new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE })).window.document.querySelectorAll('[data-worca-slot]').length, 0);
});
test('a linked plan.json is not read', POSIX, () => {
  const dir = tmpDesign({ noPlan: true });
  const outside = join(dir.root, 'evil.json'); writeFileSync(outside, readFileSync(join(tmpDesign({}).work, 'plan.json')));
  symlinkSync(outside, join(dir.work, 'plan.json'));
  assert.equal(new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE })).window.document.querySelectorAll('[data-worca-slot]').length, 0);
});
test('the assembler gets the bridge, the mode and inline', () => {
  const dir = tmpDesign({}); const calls = [];
  renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE, inline: true,
    assemble: (o) => { calls.push(o); return { html: '<!doctype html><html><head></head><body></body></html>' }; } });
  assert.equal(calls[0].mode, 'build'); assert.equal(calls[0].inline, true);
  assert.equal(calls[0].bridge, bridgeScriptTag({ mode: 'build', nonce: NONCE }));
  assert.ok(calls[0].plan.sections.length === 2);
});
test('M5: a slot the shell placed stays nested, and a finished section fills it in place', () => {
  const dir = tmpDesign({ fine: true });
  const crew = JSON.parse(readFileSync(join(dir.work, '.crew.json'), 'utf8'));
  crew.find((s) => s.id === 's1').status = 'done';
  writeFileSync(join(dir.work, '.crew.json'), JSON.stringify(crew));
  mkdirSync(join(dir.work, 'sections', 's1'), { recursive: true });
  writeFileSync(join(dir.work, 'sections', 's1', 'index.html'), '<div data-section="s1">one</div>');
  const { document: d } = new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE })).window;
  const row = d.querySelector('.row');
  assert.equal(row.children[0].getAttribute('data-worca-slot'), 's0');
  assert.equal(row.children[1].getAttribute('data-section'), 's1');
  assert.equal(d.querySelectorAll('[data-worca-slot],[data-section]').length, 40);
  assert.equal(d.querySelectorAll('[data-worca-slot="s0"]').length, 1);
});
test('M9: a deck plan keeps every section in the doc, and the doc adds nothing that sizes them', () => {
  const dir = tmpDesign({});
  const plan = JSON.parse(readFileSync(join(dir.work, 'plan.json'), 'utf8'));
  plan.kind = 'pitch'; plan.canvas = { w: 1920, h: 1080 };
  plan.sections = [{ id: 's1', job: 'One', brief: 'b', parts: ['html'] }, { id: 's2', job: 'Two', brief: 'b', parts: ['html'] }];
  writeFileSync(join(dir.work, 'plan.json'), JSON.stringify(plan));
  const { document: d } = new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'pitch', mode: 'build', nonce: NONCE })).window;
  assert.equal(d.querySelectorAll('[data-worca-slot],[data-section]').length, 2);
  assert.equal(d.documentElement.getAttribute('style'), null);
  assert.equal(d.body.getAttribute('style'), null);
});
test('serving writes nothing, and the marker never reaches the disk', () => {
  const dir = tmpDesign({ hostile: true });
  const before = snapshotTree(dir.root);
  for (const mode of ['build', 'run']) renderPreviewDoc({ workDir: dir.work, kind: 'web', mode, nonce: NONCE });
  assert.deepEqual(snapshotTree(dir.root), before);
  for (const f of walkFiles(dir.root)) assert.ok(!readFileSync(f).includes(BRIDGE_MARKER), f);
});
test('the bridge marker never reaches dist or an export', () => {
  const dir = tmpDesign({});
  const { plan } = validatePlan(readFileSync(join(dir.work, 'plan.json'), 'utf8'), { kind: 'web' });
  const bridge = bridgeScriptTag({ mode: 'run', nonce: NONCE });
  for (const mode of ['dist', 'standalone']) {
    assert.throws(() => assembleDesign({ workDir: dir.work, plan, mode, bridge }), (e) => e.code === 'BAD_REQUEST', mode);
    assert.ok(!assembleDesign({ workDir: dir.work, plan, mode }).html.includes(BRIDGE_MARKER), mode);
  }
  const files = walkFiles(join(dir.root, 'dist'));
  assert.ok(files.length > 0);
  for (const f of files) assert.ok(!readFileSync(f).includes(BRIDGE_MARKER), f);
});

// Beyond the plan's rows: the rest of the strip list (L3.5), the first of two same-named attributes (the one a browser
// keeps), an unquoted value ending in `/` (not a self-closed tag), a close implied by an outer close tag, a script
// cut off at the end, and a call without a nonce, which keeps no script at all.
const STRIP_MORE = [
  ['<p><frame src="x">a</p>', '<p>a</p>'], ['<frameset cols="1"><p>x</p></frameset>z', 'z'], ['<applet code="x">a</applet>z', 'z'],
  ['<img src="javascript:x" alt="a">', '<img alt="a">'], ['<p data="javascript:x" class="c">t</p>', '<p class="c">t</p>'],
  ['<a href="VBScript:x">t</a>', '<a>t</a>'], ['<a href="javascript:x" HREF="ok" onclick="y">t</a>', '<a>t</a>'],
  ['<svg><use onclick=y href=x/><text>t</text></use></svg>', '<svg><use href="x/"><text>t</text></use></svg>'],
  ['<div><object data="x"><p>y</div>z', '<div></div>z'], ['<p>a<script>1', '<p>a'],
];
test('stripBuildDoc: the rest of the strip list, duplicates, `x/`, implied and cut-off closes; no nonce keeps no script', () => {
  for (const [i, w] of STRIP_MORE) assert.equal(stripBuildDoc(i, { nonce: NONCE }), w, i);
  assert.equal(stripBuildDoc('<script>1</script>x', {}), 'x');
  assert.equal(stripBuildDoc('<script nonce="">1</script>x', { nonce: '' }), 'x');
});
test('no plan: the build doc is still P1 tokens, global and shell; the run doc is the bridge alone, even with no shell.html', () => {
  const dir = tmpDesign({ noPlan: true });
  const { document: d } = new JSDOM(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE })).window;
  assert.ok(d.querySelector('style[data-worca-css="tokens"]'));
  assert.ok(d.querySelector('style[data-worca-css="global"]'));
  assert.equal(d.querySelector('header')?.textContent, 'H');
  unlinkSync(join(dir.work, 'shell.html'));
  assert.equal(renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'run', nonce: NONCE }),
    `<!doctype html><html><head>${bridgeScriptTag({ mode: 'run', nonce: NONCE })}</head><body></body></html>`);
});
// What can navigate the frame past the click guard: an SVG set or animate of href, a closed declarative shadow root
// (the guard cannot see into it) and noscript (never shown with scripting on). The kept bridge is never rewritten.
const STRIP_NAV = [
  ['<svg><a><set attributeName="href" to="/x" begin="0s" fill="freeze"/><text>t</text></a></svg>', '<svg><a><text>t</text></a></svg>'],
  ['<svg><a><set to="/x" attributeName="href"/><text>t</text></a></svg>', '<svg><a><text>t</text></a></svg>'],
  ['<svg><a href="#ok"><animate attributeName=" XLink:HREF " values="/x" dur="1s"></animate><text>t</text></a></svg>', '<svg><a href="#ok"><text>t</text></a></svg>'],
  ['<svg><animate attributeName="&#104;ref" values="/x"/><animate attributeName="foo:href" values="/x"/></svg>', '<svg></svg>'],
  ['<svg><a><set attributeName=" Href\t" to="/x"/><text>t</text></a></svg>', '<svg><a><text>t</text></a></svg>'],
  ['<svg><set attributeName="\u00a0href\u3000" to="/x"/></svg>', '<svg></svg>'],
  ['<svg><set attributeName="a href" to="/x"/><set attributeName=": href" to="/x"/></svg>', '<svg><set attributeName="a href" to="/x"/><set attributeName=": href" to="/x"/></svg>'],
  ['<svg><rect><set attributeName="fill" to="red"/><animate attributeName="width" values="1;2" dur="1s"/></rect></svg>',
    '<svg><rect><set attributeName="fill" to="red"/><animate attributeName="width" values="1;2" dur="1s"/></rect></svg>'],
  ['<template shadowrootmode="closed"><a href="/x">s</a></template>', '<template><a href="/x">s</a></template>'],
  ['<template shadowrootmode="OPEN"><a href="/x">s</a></template>', '<template shadowrootmode="OPEN"><a href="/x">s</a></template>'],
  ['<template shadowroot="open" id="t">x</template>', '<template id="t">x</template>'],
  ['<noscript><p>Enable JS</p></noscript>after', 'after'],
  ['<p title="<noscript><base href=x>">x</p>', '<p title="&lt;noscript>&lt;base href=x>">x</p>'],
  ['<p title="<meta charset=utf-8>">x</p>', '<p title="<meta charset=utf-8>">x</p>'],
  [`<script data-worca-bridge nonce="${NONCE}">/* <meta http-equiv="x"> <noscript> <base> */</script><p>x</p>`,
    `<script data-worca-bridge nonce="${NONCE}">/* <meta http-equiv="x"> <noscript> <base> */</script><p>x</p>`],
  ['<a href="&amp;#106;avascript:x" onclick="y">t</a>', '<a href="&amp;#106;avascript:x">t</a>'],
  // An opener inside a value another opener's walk crossed: its own unquoted value still ends at the next space.
  ["<meta x='<meta a=b http-equiv=r ' c=d>", "<meta x='&lt;meta a=b http-equiv=r ' c=d>"],
];
test('stripBuildDoc: SVG href animations, closed shadow roots and noscript go; the kept bridge is untouched', () => {
  for (const [i, w] of STRIP_NAV) assert.equal(stripBuildDoc(i, { nonce: NONCE }), w, i);
});

// Markup htmlparser2 reads as text or an attribute value while a browser builds a live element: it never treats
// noscript as raw text (a browser with scripting on does), and it ignores the MathML and SVG integration points.
const R = 'http-equiv="refresh" content="0;url=https://evil.example/"';
const HIDDEN = [
  `<noscript><p title="</noscript><meta ${R}>"></noscript>`,
  '<noscript><p title="</noscript><meta http-equiv=&quot;refresh&quot; content=&quot;0;url=https://evil.example/&quot;>"></noscript>',
  `<noscript><style></noscript><meta ${R}></style></noscript>`,
  `<math><mtext><mglyph><style><meta ${R}></style></mglyph></mtext></math>`,
  `<math><title><style><meta ${R}></style></title></math>`,
  `<math><desc><style><meta ${R}></style></desc></math>`,
  `<svg><mi><style><meta ${R}></style></mi></svg>`,
  `<svg><mtext><style><meta ${R}></style></mtext></svg>`,
  `<math><annotation-xml><style><meta ${R}></style></annotation-xml></math>`,
  `<svg><annotation-xml encoding="text/html"><style><meta ${R}></style></annotation-xml></svg>`,
  `<math><mi><malignmark><style><meta ${R}></style></malignmark></mi></math>`,
  `<svg><p><style><a id="</style><meta ${R}>">`,
  `<svg></p><style><a id="</style><meta ${R}>">`,
  `<svg><mi><textarea><meta ${R}></textarea></mi></svg>`,
  `<math><title><xmp><meta ${R}></xmp></title></math>`,
  `<math><title><noembed><meta ${R}></noembed></title></math>`,
  `<svg><desc><math><title><style><meta ${R}></style></title></math></desc></svg>`,
  '<svg><p><style><a id="</style><base href="https://evil.example/">">',
  '<svg><p><style><a id="</style><svg><a><set attributeName="href" to="/x"/><text>t</text></a></svg>">',
  '<svg><p><style><a id="</style><svg><a><set attributeName="&#104;ref" to="/x"/><text>t</text></a></svg>">',
  '<svg><p><style><a id="</style><svg><a><set attributeName=" href " to="/x"/><text>t</text></a></svg>">',
  '<svg><p><style><a id="</style><svg><a><set attributeName="\u00a0href\u3000" to="/x"/><text>t</text></a></svg>">',
  '<svg><p><style><a id="</style><svg><a><animate attributeName="xlink:HREF" values="/x"/><text>t</text></a></svg>">',
  '<svg></p><style><a id="</style><svg><a><animate attributeName="href" values="/x"/><text>t</text></a></svg>">',
  '<svg><p><style><a id="</style><div><template shadowrootmode="closed"><a href="/x">s</a></template></div>">',
  '<math><title><style><noscript><meta http-equiv="refresh"></noscript></style></title></math>',
  // A `/` between attributes is skipped, as the tokenizer skips it.
  `<math><title><style><meta/${R}></style></title></math>`,
];
/** What a browser with scripting on would build from `html` that can navigate, template contents included. */
function liveNavigators(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const found = [];
  const visit = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const name = el.localName;
      if (name === 'meta' && el.hasAttribute('http-equiv')) found.push('meta http-equiv');
      if (name === 'base' || name === 'noscript') found.push(name);
      if ((name === 'set' || name === 'animate') && /(^|:)href$/i.test((el.getAttribute('attributeName') ?? '').trim())) found.push(`${name} of href`);
      if (name === 'template') {
        if (el.hasAttribute('shadowroot') || (el.hasAttribute('shadowrootmode') && el.getAttribute('shadowrootmode').toLowerCase() !== 'open')) found.push('closed shadow root');
        visit(el.content);
      }
    }
  };
  visit(dom.window.document);
  dom.window.close();
  return found;
}
test('stripBuildDoc: what htmlparser2 misreads but a browser with scripting on builds is escaped', () => {
  // The check itself: scripting on, each payload does build a live navigator before the strip.
  for (const p of HIDDEN) assert.notDeepEqual(liveNavigators(`<!doctype html><html><head></head><body>${p}</body></html>`), [], p);
  for (const p of HIDDEN) {
    const out = stripBuildDoc(`<!doctype html><html><head></head><body><section>${p}</section></body></html>`, { nonce: NONCE });
    assert.deepEqual(liveNavigators(out), [], `${p}\n=> ${out}`);
  }
});
// A `form` content attribute joins a control to a form anywhere in the doc, and a form's controls override what morphdom
// walks: without it a control joins only its ancestor form, which the bridge sees before it merges.
const FORM_ATTR = [
  ['<input form="f" name="nextSibling">', '<input name="nextSibling">'],
  ['<button FORM=g type="button" onclick="x">b</button>', '<button type="button">b</button>'],
  ['<p form="x" class="c">t</p>', '<p class="c">t</p>'],
  ['<form id="f"><input name="n"><select name="s"></select></form>', '<form id="f"><input name="n"><select name="s"></select></form>'],
];
const FORM_CONTROLS = ['<input form="f" name="nextSibling">', '<button form=f name=firstChild>b</button>', '<select form="f" name="s"></select>',
  '<textarea form="f" name="t"></textarea>', '<output form="f" name="o"></output>', '<fieldset form="f" name="fs"></fieldset>',
  '<object form="f" name="ob"></object>', '<input/form="f">'];
/** Every element a browser with scripting on would build from `html` that carries a `form` attribute, template contents included. */
function formAttrs(html) {
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const found = [];
  const visit = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (el.hasAttribute('form')) found.push(el.localName);
      if (el.localName === 'template') visit(el.content);
    }
  };
  visit(dom.window.document);
  dom.window.close();
  return found;
}
test('stripBuildDoc: no element keeps a form attribute, even one htmlparser2 reads as text', () => {
  for (const [i, w] of FORM_ATTR) assert.equal(stripBuildDoc(i, { nonce: NONCE }), w, i);
  const page = (p) => `<!doctype html><html><head></head><body><section>${p}</section></body></html>`;
  const payloads = [...FORM_CONTROLS, ...HIDDEN.filter((p) => p.includes(`<meta ${R}>`)).flatMap((p) => FORM_CONTROLS.map((c) => p.replace(`<meta ${R}>`, c)))]
    .filter((p) => formAttrs(page(p)).length);
  assert.ok(payloads.length > 100, `${payloads.length} payloads build a control with a form attribute`);
  for (const p of payloads) {
    const out = stripBuildDoc(page(p), { nonce: NONCE });
    assert.deepEqual(formAttrs(out), [], `${p}\n=> ${out}`);
  }
});
test('build doc: no control in the shell or a finished section keeps a form attribute', () => {
  const dir = tmpDesign();
  const shell = join(dir.work, 'shell.html');
  writeFileSync(shell, readFileSync(shell, 'utf8').replace('<header>H</header>',
    '<aside><input form="f" name="firstChild"><input form="g" name="nextSibling"><form id="g"></form></aside><header>H</header>'));
  writeFileSync(join(dir.work, 'sections', 'hero', 'index.html'), '<section data-section="hero"><p>B</p><input form="f" name="firstChild"></section>');
  const html = renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE });
  const { document: d } = new JSDOM(html).window;
  assert.equal(d.querySelectorAll('aside input, [data-section="hero"] input').length, 3);
  assert.deepEqual(formAttrs(html), []);
});
test('stripBuildDoc: the escape pass stays linear on openers nested in one long tag', () => {
  const LONG = [
    `<p>${'<meta a '.repeat(60000)}><template x='${'<template y '.repeat(30000)}'>t</template></p>`,
    // An unquoted value runs to the next space or `>`: here to the end of the text, holding every later opener.
    `<p>${'<meta/a='.repeat(60000)}</p>`,
    `<p>${'<template/a=x'.repeat(40000)}</p>`,
    `<style>:root{--a:1}/*${'<meta/a='.repeat(60000)}*/</style>`,
    `<p>${'<set/a='.repeat(60000)}${'<meta/=='.repeat(60000)}</p>`,
    // The values the pass reads: an `attributeName` or a `shadowrootmode` running to the end of the text, once per opener.
    `<p>${'<animate/attributeName='.repeat(40000)}</p>`,
    `<p>${'<set/attributename='.repeat(40000)}</p>`,
    `<p>${'<set/attributeName='.repeat(40000)}xhref </p>`,
    `<p>${'<set/attributeName='.repeat(20000)}${'\u00a0'.repeat(200000)} </p>`,
    // Every unquoted value ends where the same long run of space or `/` starts, which each walk would skip again.
    `<p>${'<set/a='.repeat(64000)}${' '.repeat(64000)}</p>`,
    `<style>${'<META/x='.repeat(64000)}${'\t'.repeat(64000)}</style>`,
    `<p>${'<set/a='.repeat(64000)}${' /'.repeat(32000)}></p>`,
    // Only a `&` inside the value counts, not one after it.
    '<style><set attributeName=fill>&amp;</style>',
    `<p>${'<input/a='.repeat(60000)}</p>`,
  ];
  // A `&` or a closed mode escapes every opener: inside a `<style>` (raw text) the first pass leaves them to this one.
  // The last row's `&` is far from every opener: a search per value is fast but quadratic, so its bound is 1 s.
  const ESCAPED = [
    [`<style>/*${'<template/shadowrootmode='.repeat(40000)}*/</style>`, '<template', '&lt;template'],
    [`<style>/*${'<set/attributeName=a'.repeat(40000)}&*/</style>`, '<set', '&lt;set'],
    [`<style>/*${'<set/attributeName=a'.repeat(60000)}${'a'.repeat(1200000)}&*/</style>`, '<set', '&lt;set', 1e6],
    [`<style>/*${'<select/form='.repeat(60000)}*/</style>`, '<select', '&lt;select'],
  ];
  for (const [big, want, bound = 3e6] of [...LONG.map((s) => [s, s]), ...ESCAPED.map(([s, from, to, cpu]) => [s, s.replaceAll(from, to), cpu])]) {
    const before = process.cpuUsage();
    const out = stripBuildDoc(big, { nonce: NONCE });
    const { user, system } = process.cpuUsage(before);
    assert.equal(out, want, big.slice(0, 40));
    assert.ok(user + system < bound, `${big.slice(0, 40)}: ${(user + system) / 1000} ms of CPU`);
  }
});
// htmlparser2 keeps its open elements in an array that every tag shifts or searches, so each tag costs the depth. P1 bounds
// each piece at HTML_MAX_DEPTH, but a raw-text element left open in one section swallows the next one's `<!--`, and the
// joined doc then nests without bound: past a shell and a section at P1's bound, the doc is refused.
test('stripBuildDoc: a doc nested deeper than a shell and a section can be is refused, and at once', () => {
  const MAX = 2 * HTML_MAX_DEPTH;
  const full = `${'<div>'.repeat(MAX - 2)}${'<img><br><input>'.repeat(3)}<svg><path/><path/></svg><p>x</p>`;
  assert.equal(stripBuildDoc(full, { nonce: NONCE }), full, 'void and self-closed elements never stay open');
  assert.equal(stripBuildDoc('<div>'.repeat(MAX), { nonce: NONCE }), '<div>'.repeat(MAX));
  assert.throws(() => stripBuildDoc('<div>'.repeat(MAX + 1), { nonce: NONCE }), { name: 'RangeError', message: /more than 1024 deep/ });
  const before = process.cpuUsage();
  assert.throws(() => stripBuildDoc(`<section><textarea>\n<!--</textarea>${'<div>'.repeat(200000)}`, { nonce: NONCE }), RangeError);
  const { user, system } = process.cpuUsage(before);
  assert.ok(user + system < 3e6, `${(user + system) / 1000} ms of CPU`);
});
test('build doc: one section ending in an open textarea and the next in a comment start is refused, not walked', () => {
  const dir = tmpDesign();
  const plan = JSON.parse(readFileSync(join(dir.work, 'plan.json'), 'utf8'));
  plan.sections = [{ ...plan.sections[1], id: 's0' }, { ...plan.sections[1], id: 's1' }];
  writeFileSync(join(dir.work, 'plan.json'), JSON.stringify(plan));
  writeFileSync(join(dir.work, '.crew.json'), JSON.stringify([{ id: 's0', status: 'done', summary: 's' }, { id: 's1', status: 'done', summary: 's' }]));
  for (const [id, html] of [['s0', '<section data-section="s0"><textarea>'], ['s1', `<!--</textarea>${'<div>'.repeat(200000)}`]]) {
    mkdirSync(join(dir.work, 'sections', id), { recursive: true });
    writeFileSync(join(dir.work, 'sections', id, 'index.html'), html);
  }
  const before = process.cpuUsage();
  assert.throws(() => renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'build', nonce: NONCE }), RangeError);
  const { user, system } = process.cpuUsage(before);
  assert.ok(user + system < 3e6, `${(user + system) / 1000} ms of CPU`);
  assert.doesNotThrow(() => renderPreviewDoc({ workDir: dir.work, kind: 'web', mode: 'run', nonce: NONCE }), 'the run doc takes no strip pass');
});
test('build bridge: a shell naming its html "exports" and its head "module" cannot steer morphdom off the window', () => {
  const html = `<!doctype html><html id="exports"><head id="module">${bridgeScriptTag({ mode: 'build', nonce: NONCE })}</head><body></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/design-preview/T/build/#n=n1', runScripts: 'dangerously',
    beforeParse(w) { w.parent = { postMessage() {} }; } });
  const { window: w } = dom;
  assert.equal(w.exports, w.document.documentElement, 'window named properties are what the UMD would read');
  assert.equal(typeof w.morphdom, 'function');
  assert.equal(w.document.head.exports, undefined, 'the CommonJS branch never ran');
  w.close();
});
test('build bridge: shell markup before <head> naming Document members stops neither morphdom nor the bridge', async () => {
  // The parser puts what comes before an explicit <head> in the doc before the bridge runs, so Document's named
  // properties (which override its built-ins) are in place when morphdom loads and the bridge boots.
  const names = ['createElement', 'createElementNS', 'createRange', 'readyState'];
  const html = `<!doctype html><html>${names.map((n) => `<img name="${n}" alt="">`).join('')}<head>${bridgeScriptTag({ mode: 'build', nonce: NONCE })}</head>`
    + '<body><section data-section="hero"><h1>a</h1></section></body></html>';
  const sent = [];
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e.message));
  // jsdom reads document.addEventListener itself once the constructor returns, so an `<img name="addEventListener">`
  // would break jsdom: that one is an own property while the doc is parsed, and goes before jsdom's read.
  const dom = new JSDOM(html, { url: 'http://localhost/design-preview/T/build/#n=n1', runScripts: 'dangerously', virtualConsole,
    beforeParse(w) {
      w.parent = { postMessage: (m) => sent.push(structuredClone(m)) };
      Object.defineProperty(w.document, 'addEventListener', { configurable: true, value: w.document.createElement('img') });
    } });
  const { window: w } = dom;
  delete w.document.addEventListener;
  assert.equal(w.document.createElement.localName, 'img', 'named properties override built-ins on Document');
  assert.deepEqual([typeof w.morphdom, errors], ['function', []]);
  // The real readyState is read: the doc is still loading, so `ready` waits for DOMContentLoaded.
  assert.deepEqual(sent, []);
  await new Promise((r) => w.addEventListener('DOMContentLoaded', r));
  assert.deepEqual(sent.map((m) => m.t), ['ready']);
  const send = (t, fields) => w.dispatchEvent(new w.MessageEvent('message', { data: { ns: 'worca-design', v: 1, n: 'n1', t, ...fields }, source: w.parent }));
  send('hello', { mode: 'build', kind: 'web' });
  send('section', { id: 'hero', rev: 1, html: '<section><h1>b</h1><p>c</p></section>', final: true });
  assert.deepEqual(sent.filter((m) => m.t === 'err'), []);
  assert.deepEqual(sent.filter((m) => m.t === 'applied').map((m) => [m.id, m.rev]), [['hero', 0], ['hero', 1]]);
  assert.equal(w.Document.prototype.querySelector.call(w.document, '[data-section="hero"]').outerHTML, '<section data-section="hero"><h1>b</h1><p>c</p></section>');
  w.close();
});
test('bridgeScriptTag refuses an unknown mode, and a build nonce that could leave its attribute', () => {
  assert.throws(() => bridgeScriptTag({ mode: 'dist', nonce: NONCE }), TypeError);
  for (const nonce of [undefined, '', 'a"b', 'a b', 'a>b']) assert.throws(() => bridgeScriptTag({ mode: 'build', nonce }), TypeError, String(nonce));
  assert.ok(bridgeScriptTag({ mode: 'build', nonce: 'Ab-_09+/==' }).startsWith('<script data-worca-bridge nonce="Ab-_09+/==">'));
});

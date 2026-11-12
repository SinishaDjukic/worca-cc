// test/design-assemble-document.test.mjs — a document assembles with no slots: its sections at the shell's
// <!--worca:sections--> in plan order, worca's contents list first and its print CSS in the head outside `build`, and
// a trailing marker in `build` for the bridge. Model text (headings, the title) never becomes markup or CSS. Plus the
// pure helpers of doc-kind.mjs, and the other kinds' head and fills, unchanged.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';
import { assembleDesign } from '../src/core/design/assemble.mjs';
import { DesignError } from '../src/core/design/ids.mjs';
import { kindHead, wrapFills } from '../src/core/design/kinds.mjs';
import { PAGE_SIZES, pageWidth, cssString, documentCss, scanHeadings, tocHtml } from '../src/core/design/doc-kind.mjs';

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><main class="doc"><header class="doc-head"><h1>Q3</h1></header><!--worca:sections--></main><!--worca:foot--></body></html>';
const sec = (id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'], estHeight: 600 });
const DOC = { v: 1, kind: 'document', title: 'Q3 platform review', canvas: { w: 794 }, page: 'A4', toc: true, numbered: false, notes: '', sections: [sec('summary'), sec('findings')] };
const BASE = {
  'shell.html': SHELL,
  'tokens.css': "@font-face{font-family:'Poppins';src:url(assets/worca/poppins-latin-400-normal.woff2) format('woff2')}:root{color-scheme:light dark}",
  'assets/worca/poppins-latin-400-normal.woff2': 'wOF2font',
  'sections/summary/index.html': '<section data-section="summary"><h2 id="summary-title">Summary</h2><p>Held.</p><h3 id="summary-scope">Scope</h3></section>',
  'sections/findings/index.html': '<section data-section="findings"><h2 id="findings-title">Findings</h2><h3 id="findings-uptime">Uptime</h3><h3 id="findings-cost">Cost</h3></section>',
};
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function seed(files = BASE) {
  const d = mkdtempSync(join(tmpdir(), 'ddoc-')); dirs.push(d);
  const work = join(d, 'work'); mkdirSync(work);
  for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); }
  return work;
}
const parse = (html) => new JSDOM(html).window.document;
const count = (html, p) => html.split(p).length - 1;

test('run and standalone: the contents list comes first in the sections, in plan order, with links to the headings', () => {
  for (const mode of ['run', 'standalone', 'dist']) {
    const r = assembleDesign({ workDir: seed(), plan: DOC, mode });
    const d = parse(r.html);
    const nav = d.querySelector('nav[data-worca-toc]');
    assert.ok(nav, mode);
    assert.equal(nav.compareDocumentPosition(d.querySelector('[data-section="summary"]')) & 4, 4, `${mode}: the nav comes before the first section`);
    assert.equal(nav.parentElement, d.querySelector('main.doc'), 'inside the shell\'s sections container');
    assert.deepEqual([...nav.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent]),
      [['#summary-title', 'Summary'], ['#summary-scope', 'Scope'], ['#findings-title', 'Findings'], ['#findings-uptime', 'Uptime'], ['#findings-cost', 'Cost']]);
    assert.deepEqual([...nav.querySelectorAll(':scope > ol > li')].map((li) => li.querySelectorAll('ol > li').length), [1, 2], 'h3s nest under their h2');
    assert.equal(nav.querySelector('.doc-toc-num'), null, 'no numbers unless the plan asks');
    assert.deepEqual([...d.querySelectorAll('[data-section]')].map((s) => s.dataset.section), ['summary', 'findings']);
  }
});

test('numbered: the contents list and the head CSS number the headings the same way', () => {
  const r = assembleDesign({ workDir: seed(), plan: { ...DOC, numbered: true }, mode: 'run' });
  const d = parse(r.html);
  assert.deepEqual([...d.querySelectorAll('nav[data-worca-toc] .doc-toc-num')].map((n) => n.textContent), ['1', '1.1', '2', '2.1', '2.2']);
  const css = d.querySelector('style[data-worca-doc]').textContent;
  assert.ok(css.includes('counter-set:worca-h3 0'));
  assert.ok(css.includes('body{counter-reset:worca-h2 worca-h3}'));
  assert.ok(!parse(assembleDesign({ workDir: seed(), plan: DOC, mode: 'run' }).html).querySelector('style[data-worca-doc]').textContent.includes('counter('.concat('worca-h2')), 'no counters unless numbered');
});

test('toc:false gives no contents list; the print CSS stays', () => {
  const r = assembleDesign({ workDir: seed(), plan: { ...DOC, toc: false }, mode: 'run' });
  assert.equal(r.html.includes('data-worca-toc'), false);
  assert.ok(r.html.includes('@page{size:A4'));
});

test('the head carries the page size and forces a light print, before tokens.css', () => {
  const a4 = assembleDesign({ workDir: seed(), plan: DOC, mode: 'run' }).html;
  assert.ok(a4.includes('@page{size:A4'));
  assert.match(a4, /@media print\{[^]*?:root\{color-scheme:light!important/);
  assert.ok(a4.indexOf('data-worca-doc') < a4.indexOf('@font-face'), 'worca\'s print CSS comes before the design\'s CSS');
  const letter = assembleDesign({ workDir: seed(), plan: { ...DOC, page: 'Letter', canvas: { w: 816 } }, mode: 'standalone' }).html;
  assert.ok(letter.includes('@page{size:letter'));
});

test('build: no contents list and no print CSS; sections in plan order and one trailing marker for the bridge', () => {
  const shell = SHELL.replace('<!--worca:sections-->', '<div data-worca-slot="findings"></div><!--worca:sections-->');
  const work = seed({ ...BASE, 'shell.html': shell });
  const r = assembleDesign({ workDir: work, plan: DOC, mode: 'build' });
  assert.equal(r.html.includes('data-worca-toc'), false);
  assert.equal(r.html.includes('data-worca-doc'), false);
  assert.equal(count(r.html, '<!--worca:sections-->'), 1);
  const d = parse(r.html);
  // Nothing is done in build yet: each section is its slot, in plan order, the shell's own slot gone.
  assert.deepEqual([...d.querySelectorAll('[data-worca-slot]')].map((s) => s.getAttribute('data-worca-slot')), ['summary', 'findings']);
  const main = d.querySelector('main.doc');
  assert.equal(main.lastChild.nodeType, 8, 'the marker is the last thing in the sections container');
  assert.equal(main.lastChild.data, 'worca:sections');
});

test('a shell slot is removed and its section lands at the marker in plan order', () => {
  const shell = SHELL.replace('<header class="doc-head">', '<div data-worca-slot="findings"></div><header class="doc-head">');
  const d = parse(assembleDesign({ workDir: seed({ ...BASE, 'shell.html': shell }), plan: DOC, mode: 'run' }).html);
  assert.equal(d.querySelector('[data-worca-slot]'), null);
  assert.deepEqual([...d.querySelectorAll('main.doc > [data-section]')].map((s) => s.dataset.section), ['summary', 'findings']);
  assert.equal(d.querySelector('header.doc-head').nextElementSibling.tagName, 'NAV', 'the title block stays above the sections');
});

test('a shell without <!--worca:sections--> is BAD_SHELL outside build', () => {
  const shell = SHELL.replace('<!--worca:sections-->', '<div data-worca-slot="summary"></div><div data-worca-slot="findings"></div>');
  assert.throws(() => assembleDesign({ workDir: seed({ ...BASE, 'shell.html': shell }), plan: DOC, mode: 'run' }), (e) => e instanceof DesignError && e.code === 'BAD_SHELL');
});

test('hostile headings: a bad id is plain text, and heading text is escaped', () => {
  const files = { ...BASE, 'sections/summary/index.html': '<section data-section="summary"><h2 id=\'x" onmouseover="alert(1)\'>&lt;img src=x onerror=1&gt;</h2><h2 id="findings-x">Not mine</h2></section>' };
  const r = assembleDesign({ workDir: seed(files), plan: DOC, mode: 'run' });
  const nav = parse(r.html).querySelector('nav[data-worca-toc]');
  const first = nav.querySelector(':scope > ol > li');
  assert.equal(first.querySelector('a'), null);
  assert.equal(first.querySelector('span').textContent, '<img src=x onerror=1>');
  assert.equal(nav.querySelector('img'), null);
  assert.equal(nav.querySelectorAll('[onmouseover]').length, 0);
  assert.ok(r.html.includes('&lt;img src=x onerror=1&gt;'));
  assert.equal(nav.querySelector(':scope > ol > li:nth-child(2) > a'), null, 'an id of another section does not link');
});

test('a hostile title is hex-escaped in the print CSS and cannot close the style', () => {
  const plain = assembleDesign({ workDir: seed(), plan: DOC, mode: 'run' }).html;
  const r = assembleDesign({ workDir: seed(), plan: { ...DOC, title: 'a"</style><script>alert(1)</script>' }, mode: 'run' }).html;
  assert.equal(count(r, '<style'), count(plain, '<style'));
  assert.equal(count(r, '</style>'), count(plain, '</style>'));
  assert.equal(r.includes('<script>alert'), false);
  assert.ok(r.includes('"a\\000022 \\00003C /style\\00003E '));
});

test('standalone inlines worca\'s fonts from assets/worca/', () => {
  const r = assembleDesign({ workDir: seed(), plan: DOC, mode: 'standalone' });
  assert.ok(r.html.includes('url(data:font/woff2;base64,') || r.html.includes('url("data:font/woff2;base64,'), 'the font is a data: URL');
  assert.equal(r.html.includes('assets/worca/'), false);
});

test('the other kinds\' head and fills do not move, whatever the plan holds', () => {
  const plan = { ...DOC, numbered: true };
  for (const kind of ['web', 'presentation', 'pitch', 'video', undefined]) {
    for (const mode of ['build', 'run', 'dist', 'standalone']) {
      assert.equal(kindHead({ kind, mode, plan }), kindHead({ kind, mode }), `${kind} ${mode}`);
      assert.equal(wrapFills({ kind, mode, fills: '<x></x>', toc: '<nav></nav>' }), wrapFills({ kind, mode, fills: '<x></x>' }), `${kind} ${mode}`);
    }
  }
  assert.equal(kindHead({ kind: 'web', mode: 'run' }), '');
  assert.equal(wrapFills({ kind: 'web', mode: 'run', fills: 'F' }), 'F');
  assert.equal(kindHead({ kind: 'document', mode: 'build', plan }), '');
  assert.equal(wrapFills({ kind: 'document', mode: 'build', fills: 'F', toc: 'T' }), 'F<!--worca:sections-->');
  assert.equal(wrapFills({ kind: 'document', mode: 'run', fills: 'F', toc: 'T' }), 'TF');
  assert.match(kindHead({ kind: 'document', mode: 'dist', plan }), /^<style data-worca-doc>@page\{size:A4/);
});

test('page sizes', () => {
  assert.deepEqual(PAGE_SIZES, { A4: { w: 794, css: 'A4' }, Letter: { w: 816, css: 'letter' } });
  assert.deepEqual(['A4', 'Letter', 'a4', 'constructor', undefined].map(pageWidth), [794, 816, 794, 794, 794]);
});

test('cssString: a safe set stays, everything else is a hex escape; never <, ", a newline or */', () => {
  assert.equal(cssString('Q3 review: costs & risks (draft)'), '"Q3 review: costs & risks (draft)"');
  assert.equal(cssString('a"b'), '"a\\000022 b"');
  for (const s of ['</style><script>', 'a\nb\r\\c', '/* x */', '"', 'é 😀']) {
    const out = cssString(s);
    const inner = out.slice(1, -1);
    assert.doesNotMatch(inner, /[<"\n\r]|\*\//, s);
    assert.ok(out.startsWith('"') && out.endsWith('"'));
  }
  assert.equal(cssString('😀'), '"\\01F600 "');
  assert.equal(cssString('x'.repeat(500)).length, 122, 'capped at 120 characters');
  assert.equal(cssString(undefined), '""');
});

test('documentCss: the page, the margin boxes, the break rules, counters only when numbered, no colour literal', () => {
  const css = documentCss({ page: 'A4', numbered: true, title: 'Q3' });
  for (const must of ['@page{size:A4', 'counter(page)', '@top-left{content:"Q3"', '@page:first{@top-left{content:none}}', 'break-after:avoid', 'break-inside:avoid', 'print-color-adjust:exact',
    ':root{color-scheme:light!important', '.doc-toc{break-after:page}', '[data-section] h2{counter-increment:worca-h2;counter-set:worca-h3 0}', '[data-section] h3{counter-increment:worca-h3}',
    'content:counter(worca-h2) ". "', 'content:counter(worca-h2) "." counter(worca-h3) " "', '.doc-toc ol{list-style:none', 'tabular-nums']) assert.ok(css.includes(must), must);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgb\(/i);
  assert.equal(documentCss({ page: 'A4', numbered: false, title: 'Q3' }).includes('worca-h2'), false);
  assert.ok(documentCss({ page: 'Letter', numbered: false, title: '' }).includes('@page{size:letter'));
  assert.equal(documentCss({ page: 'A4', numbered: false, title: '' }).includes('@top-left{content:"'), false, 'no title, no title box');
});

test('scanHeadings: h2 and h3 in order, ids gated by the section, svg and template skipped, text collapsed and capped', () => {
  const html = `<section data-section="s"><h2 id="s-a">  One
    <b>bold</b> &amp; more </h2><h3 id="s-b">Two</h3><h3 id="other-x">Three</h3><h2></h2><svg><h2 id="s-svg">no</h2></svg>
    <template><h3 id="s-t">no</h3></template><math><h2>no</h2></math><h4 id="s-h4">no</h4><h2 id="s-">Bad id</h2><h3 id="s-${'x'.repeat(65)}">${'y'.repeat(200)}</h3></section>`;
  const heads = scanHeadings(html, 's');
  assert.deepEqual(heads.slice(0, 4), [
    { level: 2, text: 'One bold & more', id: 's-a' }, { level: 3, text: 'Two', id: 's-b' }, { level: 3, text: 'Three', id: null }, { level: 2, text: 'Bad id', id: null }]);
  assert.equal(heads.length, 5);
  assert.deepEqual([heads[4].id, heads[4].text.length], [null, 160]);
});

test('tocHtml: nothing without an h2; an h3 before the section\'s first h2 is left out; at most 200 entries', () => {
  assert.equal(tocHtml({ sections: [{ id: 's', html: '<section data-section="s"><h3 id="s-a">A</h3></section>' }] }), '');
  const toc = tocHtml({ sections: [{ id: 's', html: '<section><h3 id="s-a">Early</h3><h2 id="s-b">B</h2></section>' }] });
  assert.ok(toc.startsWith('<nav class="doc-toc" data-worca-toc aria-label="Contents"><h2 class="doc-toc-title">Contents</h2><ol>'));
  assert.ok(toc.endsWith('</ol></nav>\n'));
  assert.equal(toc.includes('Early'), false);
  const many = Array.from({ length: 300 }, (_, i) => `<h2 id="s-h${i}">H${i}</h2>`).join('');
  assert.equal(count(tocHtml({ sections: [{ id: 's', html: many }] }), '<li>'), 200);
});

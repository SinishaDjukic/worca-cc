// test/office-lite-docx.test.mjs — the simplified preview's .docx path (ui/public/artifacts/office-docx.mjs): docx-preview renders
// into an inert document, its HTML goes through DOMPurify (blob: URLs of this render only), its CSS through scopeDocxCss,
// and image references are budgeted before docx-preview sees the archive. jsdom with scripts evaluated outside-only (the
// vendor UMD files), real DOMPurify from node_modules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import {
  DOCX_OPTIONS, DOCX_PURIFY_CONFIG, docxPurifier, scopeDocxCss, renderDocx, imageRefBudget, inertFactory,
} from '../ui/public/artifacts/office-docx.mjs';
import { openCappedZip, OfficeLiteError } from '../ui/public/artifacts/office-zip.mjs';
import { PURIFY_BASE } from '../ui/public/ask-markdown.mjs';
import { OFFICE_LITE_LIMITS } from '../src/shared/artifact-kinds.mjs';
import { fixture } from './helpers/office-lite-fixtures.mjs';
import { officeVendor } from './helpers/office-vendor.mjs';

const L = OFFICE_LITE_LIMITS;
const NodeZip = (await import('node:module')).createRequire(import.meta.url)('jszip');

async function setup() {
  const { window: win } = new JSDOM('<!doctype html><html><body></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true, url: 'http://localhost:4317/' });
  const vendor = officeVendor(win);
  await vendor.importer('/vendor/jszip/jszip.min.js');
  await vendor.importer('/vendor/docx-preview/docx-preview.min.js');
  return { win, vendor, JSZip: win.JSZip, docx: win.docx };
}
async function render(name, limits = L, over = {}) {
  const s = await setup();
  const zip = await openCappedZip(s.JSZip, fixture(name), limits);
  const out = await renderDocx({ zip, docx: over.docx || s.docx, createDOMPurify, win: s.win, limits });
  return { ...s, ...out };
}
const styleText = (node) => [...node.querySelectorAll('style')].map((s) => s.textContent).join('\n');

test('T-D1 memo.docx: page layout with the heading, the table (merged cell keeps colspan) and a blob: image; list-marker rules kept', async () => {
  const { node, vendor, blobUrls } = await render('memo.docx');
  assert.ok(node.classList.contains('olp-docx'));
  const page = node.querySelector('.docx-wrapper section.docx');
  assert.ok(page, 'the page layout');
  assert.match(page.textContent, /Quarterly memo/);
  assert.match(page.textContent, /Cell B/);
  assert.match(page.textContent, /bold words/);
  assert.equal(node.querySelector('td[colspan="2"]')?.textContent, 'Merged head');
  const img = node.querySelector('img');
  assert.ok(vendor.created.includes(img.getAttribute('src')), 'the image is a blob: URL this render made');
  assert.ok(blobUrls.includes(img.getAttribute('src')));
  const a = [...node.querySelectorAll('a')].find((x) => x.textContent === 'worca site');
  assert.ok(a && !a.hasAttribute('href'), 'links keep their text, never their href');
  const css = styleText(node);
  assert.match(css, /\.olp-docx p\.docx-num-1-0::?before\s*\{[^}]*content:[^;}]*counter\(docx-num-1-0/, 'the numbered list marker');
  assert.match(css, /\.olp-docx p\.docx-num-2-0::?before\s*\{[^}]*content:/, 'the bullet marker');
  assert.match(css, /--docx-majorHAnsi-font:\s*Arial/, 'theme custom properties survive');
  assert.match(css, /\.olp-docx p\.docx_heading1 span/);
});

test('T-D2 hostile.docx: no script, the script text stays text, no javascript: href, no on* attribute, no src for an external image', async () => {
  const { node } = await render('hostile.docx');
  assert.equal(node.querySelector('script'), null);
  assert.match(node.textContent, /<script>alert\(1\)<\/script>/);
  const a = [...node.querySelectorAll('a')].find((x) => x.textContent === 'click me');
  assert.ok(a, 'the link text is kept');
  assert.equal(a.hasAttribute('href'), false);
  for (const el of node.querySelectorAll('*')) {
    for (const at of el.attributes) assert.ok(!/^on/i.test(at.name), `${el.tagName} ${at.name}`);
  }
  for (const img of node.querySelectorAll('img')) assert.equal(img.hasAttribute('src'), false, 'not src="null", not remote');
  assert.ok(!/\}\s*body|body\s*\{/.test(styleText(node)), 'the style id injection is dropped');
  assert.ok(!node.innerHTML.includes('evil.example'));
});

test('T-D3 the purifier: only this render\'s blob: URLs survive in src/href; URL-free attributes are kept', async () => {
  const { win } = await setup();
  const p = docxPurifier(createDOMPurify, win);
  assert.equal(docxPurifier(createDOMPurify, win), p, 'one purifier per window');
  const blobs = new Set(['blob:ok']);
  const html = (s) => { const d = win.document.createElement('div'); d.append(p.sanitize(s, blobs)); return d; };
  for (const bad of ['<img src="data:image/png;base64,AAAA">', '<img src="https://x/a.png">', '<img src="null">', '<img src="blob:other">']) {
    assert.equal(html(bad).querySelector('img').hasAttribute('src'), false, bad);
  }
  for (const bad of ['<a href="#history/x">t</a>', '<a href="https://x">t</a>', '<a href="blob:ok">t</a>', '<a href="javascript:alert(1)">t</a>']) {
    const a = html(bad).querySelector('a');
    assert.equal(a.hasAttribute('href'), false, bad);
    assert.equal(a.textContent, 't');
  }
  assert.equal(html('<img src="blob:ok">').querySelector('img').getAttribute('src'), 'blob:ok');
  assert.equal(html('<span style="background:url(https://x)">s</span>').querySelector('span').hasAttribute('style'), false);
  assert.equal(html('<span style="background:url(blob:other)">s</span>').querySelector('span').hasAttribute('style'), false);
  assert.match(html('<span style="background:url(blob:ok)">s</span>').querySelector('span').getAttribute('style'), /blob:ok/);
  assert.equal(html('<span style="color:red">s</span>').querySelector('span').getAttribute('style'), 'color:red');
  const td = html('<table><tbody><tr><td colspan="2" rowspan="3">x</td></tr></tbody></table>').querySelector('td');
  assert.deepEqual([td.getAttribute('colspan'), td.getAttribute('rowspan')], ['2', '3']);
  const img = html('<img width="10" height="20" alt="a">').querySelector('img');
  assert.deepEqual([img.getAttribute('width'), img.getAttribute('height'), img.getAttribute('alt')], ['10', '20', 'a']);
  const svg = html('<svg viewBox="0 0 1 1"><path d="M0 0" fill="red" stroke="blue"/></svg>');
  assert.equal(svg.querySelector('svg').getAttribute('viewBox'), '0 0 1 1');
  const path = svg.querySelector('path');
  assert.deepEqual([path.getAttribute('d'), path.getAttribute('fill'), path.getAttribute('stroke')], ['M0 0', 'red', 'blue']);
  assert.equal(html('<p id="x" name="y" class="docx-c c">p</p>').querySelector('p').outerHTML, '<p class="docx-c">p</p>');
  assert.equal(html('<input type="checkbox"><form><button>b</button></form>').querySelector('input, form, button'), null);
});

test('T-D4 scopeDocxCss: plain rules only, every selector scoped and allow-listed, escapes and custom properties kept, remote url() dropped', async () => {
  const { win } = await setup();
  const blobSet = new Set(['blob:ok']);
  const scope = (css, o = {}) => scopeDocxCss(css, { CSSStyleSheet: win.CSSStyleSheet, blobSet, ...o });
  const num = scope('p.docx-num-1-0:before{content:""counter(docx-num-1-0, decimal)".\\9";counter-increment:docx-num-1-0}');
  assert.match(num, /^\.olp-docx p\.docx-num-1-0::?before \{ content: ""counter\(docx-num-1-0, decimal\)"\.\\9"; counter-increment: docx-num-1-0;? ?\}$/);
  assert.match(scope('p.b:before{content:"•\\a0"}'), /content: "•/);
  assert.match(scope('.docx{--docx-majorHAnsi-font:Arial}'), /--docx-majorHAnsi-font: Arial/);
  assert.equal(scope('.x{--u:u\\72l(https://x)}'), '', 'a backslash outside a string is dropped');
  assert.equal(scope('.x{font-family:\\66oo}'), '');
  assert.equal(scope('.x{content:"a\\zb"}'.replace('\\z', '\\\\z')), '', 'a non-hex escape is dropped');
  assert.equal(scope('.docx p.a}body{color:red}'), '', 'jsdom keeps `.docx p.a}body` as one selector; the allowlist drops the rule');
  assert.equal(scope('@import url(x.css); @font-face{font-family:x;src:url(blob:ok)} @media print{.x{color:red}}'), '');
  const remote = scope('.x{background:url(https://0x7f000001/b)}');
  assert.ok(!/url\(|0x7f000001/.test(remote), `the url declaration is dropped (jsdom expands the shorthand's other longhands): ${remote}`);
  assert.equal(scope('.x{background-image:url("blob:other")}'), '');
  assert.match(scope('.x{background-image:url("blob:ok")}'), /url\("blob:ok"\)/);
  assert.equal(scope('.x{background-image:image-set("https://x" 1x)}'), '');
  assert.match(scope('.x{color:red !important}'), /color: red !important/);
  const many = scope('.a, .b > p, :root{color:blue} .c:is(.d, .e){color:red}');
  for (const rule of many.split('\n')) {
    for (const sel of rule.slice(0, rule.indexOf('{')).split(/,(?![^(]*\))/)) assert.ok(sel.trim().startsWith('.olp-docx '), sel);
  }
  assert.match(many, /\.olp-docx :root/, ':root becomes an inert descendant selector');
  assert.equal(scope('.x{color:red}', { scope: '.olp-docx', emit: () => 'body{color:red}' }), '', 'the self-check refuses an unscoped emit');
  assert.equal(scope('.x{color:red}', { emit: () => '@media print{.olp-docx .x{color:red}}' }), '');
  assert.equal(scope('}}}{{'), '');
  assert.equal(scopeDocxCss('.x{color:red}', { CSSStyleSheet: class { replaceSync() { throw new Error('no'); } }, blobSet }), '');
});

test('T-D5 DOCX_OPTIONS are pinned; altchunk.docx renders no iframe and no script; the purifier drops <iframe srcdoc> and <style>', async () => {
  assert.deepEqual({ ...DOCX_OPTIONS }, {
    className: 'docx', inWrapper: true, breakPages: true, ignoreFonts: true, renderAltChunks: false, renderComments: false,
    renderChanges: false, experimental: false, useBase64URL: false, debug: false, trimXmlDeclaration: true, hideWrapperOnPrint: false,
    renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
  });
  assert.ok(Object.isFrozen(DOCX_OPTIONS) && Object.isFrozen(DOCX_PURIFY_CONFIG));
  const { node, win } = await render('altchunk.docx');
  assert.equal(node.querySelector('iframe, script, img'), null);
  assert.match(node.textContent, /Before the chunk/);
  assert.ok(!node.textContent.includes('chunk text'));
  assert.equal(win.pwned, undefined);
  const p = docxPurifier(createDOMPurify, win);
  const d = win.document.createElement('div');
  d.append(p.sanitize('<iframe srcdoc="<script>parent.pwned=1</script>"></iframe><style>body{color:red}</style><p>ok</p>', new Set()));
  assert.equal(d.innerHTML, '<p>ok</p>');
  assert.ok(!DOCX_PURIFY_CONFIG.ALLOWED_TAGS.includes('input'));
  for (const t of PURIFY_BASE.ALLOWED_TAGS) if (t !== 'input') assert.ok(DOCX_PURIFY_CONFIG.ALLOWED_TAGS.includes(t), t);
  for (const a of ['src', 'href']) assert.ok(!DOCX_PURIFY_CONFIG.ADD_URI_SAFE_ATTR.includes(a), a);
  assert.ok(DOCX_PURIFY_CONFIG.ADD_URI_SAFE_ATTR.includes('colspan'));
  assert.equal(String(DOCX_PURIFY_CONFIG.ALLOWED_URI_REGEXP), '/^blob:/i');
});

test('T-D6 the inline style hook: a backslash, expression( and @import drop the style attribute', async () => {
  const { win } = await setup();
  const p = docxPurifier(createDOMPurify, win);
  for (const style of ['color:r\\65 d', 'width:expression(alert(1))', '@import "x.css"', 'color:red;<b>']) {
    const d = win.document.createElement('div');
    d.append(p.sanitize(`<span style='${style}'>s</span>`, new Set()));
    assert.equal(d.querySelector('span').hasAttribute('style'), false, style);
  }
});

test('T-D7 inertFactory: the nodes docx-preview returns are owned by the inert document, never the live one', async () => {
  const s = await setup();
  const seen = [];
  const spy = { parseAsync: (...a) => s.docx.parseAsync(...a), renderDocument: async (...a) => { const n = await s.docx.renderDocument(...a); seen.push(...n); return n; } };
  const zip = await openCappedZip(s.JSZip, fixture('memo.docx'), L);
  const { node } = await renderDocx({ zip, docx: spy, createDOMPurify, win: s.win, limits: L });
  assert.ok(seen.length > 2);
  for (const n of seen) assert.notEqual(n.ownerDocument, s.win.document, n.nodeName);
  assert.equal(node.ownerDocument, s.win.document, 'the mounted root is the live document\'s');
  const inert = s.win.document.implementation.createHTMLDocument('');
  const h = inertFactory(inert);
  const el = h({ tagName: 'p', className: 'c', style: { color: 'red' }, children: ['t', { tagName: '#comment', children: ['x'] }, { ns: 'http://www.w3.org/2000/svg', tagName: 'svg' }] });
  assert.equal(el.ownerDocument, inert);
  assert.equal(el.outerHTML, '<p class="c" style="color: red;">t<!--x--><svg></svg></p>');
  assert.equal(h({ tagName: '#fragment', children: ['a', 'b'] }).textContent, 'ab');
  assert.equal(h(el), el, 'a Node passes through');
});

test('T-D8 imageRefBudget: 40 references to one 64 KB picture count 2.5 MB; past maxTotal → EXPANDS before parseAsync', async () => {
  const s = await setup();
  let parses = 0;
  const spy = { parseAsync: (...a) => { parses += 1; return s.docx.parseAsync(...a); }, renderDocument: (...a) => s.docx.renderDocument(...a) };
  const tight = { ...L, maxTotal: 1024 * 1024 };
  const zip = await openCappedZip(s.JSZip, fixture('refs.docx'), tight);
  await assert.rejects(renderDocx({ zip, docx: spy, createDOMPurify, win: s.win, limits: tight }), (e) => e instanceof OfficeLiteError && e.code === 'EXPANDS');
  assert.equal(parses, 0);
  // The picture stored under a backslash name, which docx-preview's loader also finds: still counted.
  const bs = await NodeZip.loadAsync(fixture('refs.docx'));
  const media = Object.keys(bs.files).find((n) => n.startsWith('word/media/') && !bs.files[n].dir);
  bs.file(media.replace(/\//g, '\\'), await bs.file(media).async('uint8array'), { createFolders: false });
  bs.remove(media);
  const bsZip = await openCappedZip(s.JSZip, await bs.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), tight);
  await assert.rejects(renderDocx({ zip: bsZip, docx: spy, createDOMPurify, win: s.win, limits: tight }), (e) => e instanceof OfficeLiteError && e.code === 'EXPANDS');
  assert.equal(parses, 0);
  const { node } = await render('refs.docx');
  assert.equal(node.querySelectorAll('img').length, 40);
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const texts = new Map([
    ['word/document.xml', `<w:document xmlns:w="urn:w" xmlns:r="${REL}" xmlns:a="urn:a"><a:blip r:embed="rExt"/><a:blip r:link="rExt"/><a:blip r:embed="rIn"/></w:document>`],
    ['word/_rels/document.xml.rels', `<Relationships xmlns="urn:r"><Relationship Id="rExt" Type="${REL}/image" Target="https://x/a.png" TargetMode="External"/><Relationship Id="rIn" Type="${REL}/image" Target="media/a.png"/></Relationships>`],
  ]);
  const sizes = { 'word/media/a.png': 100 };
  assert.doesNotThrow(() => imageRefBudget(texts, (n) => sizes[n] || 0, s.win.DOMParser, { ...L, maxTotal: 100 }), 'external references count 0');
  assert.throws(() => imageRefBudget(texts, (n) => sizes[n] || 0, s.win.DOMParser, { ...L, maxTotal: 99 }), (e) => e.code === 'EXPANDS');
});

const CT_NS = 'http://schemas.openxmlformats.org/package/2006/content-types';
/** memo.docx with its [Content_Types].xml and its one picture's bytes replaced; `target` rewrites the picture's
 *  relationship target, `backslash` stores the picture under its backslash name. */
async function memoWith({ types, image, target, backslash = false }) {
  const z = await NodeZip.loadAsync(fixture('memo.docx'));
  z.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="${CT_NS}">${types}</Types>`);
  if (image != null) z.file('word/media/image1.png', image);
  if (target != null) {
    const rels = await z.file('word/_rels/document.xml.rels').async('string');
    z.file('word/_rels/document.xml.rels', rels.replace('Target="media/image1.png"', () => `Target="${target}"`));
  }
  if (backslash) {
    z.file('word\\media\\image1.png', await z.file('word/media/image1.png').async('uint8array'), { createFolders: false });
    z.remove('word/media/image1.png');
  }
  return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function renderBytes(bytes, limits = L) {
  const s = await setup();
  const zip = await openCappedZip(s.JSZip, bytes, limits);
  return { ...s, ...(await renderDocx({ zip, docx: s.docx, createDOMPurify, win: s.win, limits })) };
}
const typeOf = (vendor, url) => vendor.types[vendor.created.indexOf(url)];

test('T-D9 a picture blob never takes the type the document declares: a raster type only when the bytes are that image, else application/octet-stream', async () => {
  const memo = await render('memo.docx');
  assert.equal(typeOf(memo.vendor, memo.node.querySelector('img').getAttribute('src')), 'image/png', 'a real png stays image/png');
  const html = '<Default Extension="png" ContentType="text/html"/><Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/word/media/image1.png" ContentType="text/html"/><Override PartName="word/media/image1.png" ContentType="text/html"/>';
  const declared = await renderBytes(await memoWith({ types: html }));
  assert.equal(typeOf(declared.vendor, declared.node.querySelector('img').getAttribute('src')), 'image/png', 'png bytes declared text/html');
  for (const [types, image] of [
    [html, '<script>alert(document.domain)</script>'],
    ['<Default Extension="png" ContentType="image/svg+xml"/>', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ['<Default Extension="png" ContentType="image/png"/>', '<html><script>alert(1)</script></html>'],
  ]) {
    const out = await renderBytes(await memoWith({ types, image }));
    assert.ok(out.vendor.created.length > 0, 'docx-preview made the blob');
    for (const t of out.vendor.types) assert.equal(t, 'application/octet-stream', `${types} / ${image}`);
  }
  // Paths docx-preview loads under another name than the entry's: a target resolving to a leading-slash path (its get()
  // strips one `/`, blobToURL compares the raw path) and a picture stored under its backslash name.
  for (const over of [{ target: '//docx//word/media/image1.png' }, { target: 'http://docx//word/media/image1.png' }, { backslash: true }]) {
    const out = await renderBytes(await memoWith({ types: html, image: '<html><script>alert(1)</script></html>', ...over }));
    assert.ok(out.vendor.created.length > 0, `docx-preview made the blob: ${JSON.stringify(over)}`);
    for (const t of out.vendor.types) assert.equal(t, 'application/octet-stream', JSON.stringify(over));
  }
});

test('T-D10 imageRefBudget counts every relationship a reference names, resolved the way docx-preview resolves it', async () => {
  const { win } = await setup();
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const refs = Array.from({ length: 100 }, () => '<a:blip r:embed="rBig"/>').join('');
  const doc = `<w:document xmlns:w="urn:w" xmlns:r="${REL}" xmlns:a="urn:a">${refs}</w:document>`;
  const rels = (attrs) => `<Relationships xmlns="urn:r"><Relationship Id="rBig" ${attrs}/></Relationships>`;
  const big = 64 * 1024;
  const tight = { ...L, maxTotal: 1024 * 1024 };
  const run = (relAttrs, { main = 'word/document.xml', media = 'word/media/big.png', xml = true } = {}) => {
    const cut = main.lastIndexOf('/');
    const texts = new Map([[`${main.slice(0, cut + 1)}_rels/${main.slice(cut + 1)}.rels`, rels(relAttrs)]]);
    if (xml) texts.set(main, doc);
    const names = [...texts.keys(), main, media];
    return () => imageRefBudget(texts, (n) => (n === media ? big : 0), win.DOMParser, tight, names);
  };
  const expands = (e) => e instanceof OfficeLiteError && e.code === 'EXPANDS';
  assert.throws(run(`Type="${REL}/image" Target="media/big.png"`), expands, 'the plain case');
  for (const attrs of [
    `Type="${REL}/hyperlink" Target="media/big.png"`,
    `Type="${REL}/Image" Target="media/big.png"`,
    `Type="${REL}/image" Target="media\\big.png"`,
    `Type="${REL}/image" Target="http://docx/word/media/big.png"`,
    `Type="${REL}/image" Target="//docx/word/media/big.png"`,
    `Type="${REL}/image" Target="/word/media/big.png"`,
    `Type="${REL}/image" Target="//docx//word/media/big.png"`,
    `Type="${REL}/image" Target="http://docx//word/media/big.png"`,
    `Type="${REL}/image" Target="..//word/media/big.png"`,
    `Type="${REL}/image" Target="media/big.png" TargetMode="External"`,
  ]) assert.throws(run(attrs), expands, attrs);
  // Two relationships with one Id: docx-preview loads the first (rels.find), so the first is what is budgeted.
  const dup = new Map([['word/document.xml', doc], ['word/_rels/document.xml.rels', '<Relationships xmlns="urn:r">'
    + `<Relationship Id="rBig" Type="${REL}/image" Target="media/big.png"/><Relationship Id="rBig" Type="${REL}/image" Target="media/tiny.png"/></Relationships>`]]);
  assert.throws(() => imageRefBudget(dup, (n) => ({ 'word/media/big.png': big, 'word/media/tiny.png': 1 })[n] || 0, win.DOMParser, tight,
    [...dup.keys(), 'word/media/big.png', 'word/media/tiny.png']), expands, 'the first relationship with an Id counts');
  assert.throws(run(`Type="${REL}/image" Target="media/big.png"`, { media: 'word\\media\\big.png' }), expands, 'a backslash entry name docx-preview also finds');
  assert.throws(run(`Type="${REL}/image" Target="media/big.png"`, { main: 'word/document.bin', xml: false }),
    (e) => e instanceof OfficeLiteError && e.code === 'UNREADABLE', 'a source part that is not .xml was never decoded or DTD-checked');
  assert.equal(run(`Type="${REL}/image" Target="https://x/big.png" TargetMode="External"`)(), 0, 'a target outside the package costs nothing');
  const ten = new Map([['word/document.xml', doc.replace(refs, refs.slice(0, 10 * '<a:blip r:embed="rBig"/>'.length))],
    ['word/_rels/document.xml.rels', rels(`Type="${REL}/image" Target="media/big.png"`)]]);
  assert.equal(imageRefBudget(ten, (n) => (n === 'word/media/big.png' ? big : 0), win.DOMParser, tight, [...ten.keys(), 'word/media/big.png']), 10 * big);
});

test('T-D11 the purifier: fill/stroke url() and escapes, image-set( and an unterminated url( in style, app class tokens, data-/aria- attributes', async () => {
  const { win } = await setup();
  const p = docxPurifier(createDOMPurify, win);
  const blobs = new Set(['blob:ok']);
  const html = (s) => { const d = win.document.createElement('div'); d.append(p.sanitize(s, blobs)); return d; };
  const rect = html('<svg><rect fill="url(https://evil.example/p.svg#g)" stroke="url(//x/s.svg#s)" transform="rotate(45)"/></svg>').querySelector('rect');
  assert.equal(rect.hasAttribute('fill'), false);
  assert.equal(rect.hasAttribute('stroke'), false);
  assert.equal(rect.getAttribute('transform'), 'rotate(45)');
  assert.equal(html('<svg><rect fill="u\\72l(https://x/p#g)"/></svg>').querySelector('rect').hasAttribute('fill'), false, 'an escape spelling url(');
  assert.equal(html('<svg><rect fill="url(blob:ok)"/></svg>').querySelector('rect').getAttribute('fill'), 'url(blob:ok)');
  for (const style of ["background-image:image-set('https://x/a.png' 1x)", "background-image:-webkit-image-set('https://x/a.png' 1x)", 'background-image:url(https://x']) {
    assert.equal(html(`<span style="${style}">s</span>`).querySelector('span').hasAttribute('style'), false, style);
  }
  assert.equal(html('<p class="docx_a\tterm-opener btn viewer-modal">p</p>').querySelector('p').getAttribute('class'), 'docx_a');
  assert.equal(html('<td class="first-row odd-col docx-num-1-0 tab">x</td>'.replace(/^/, '<table><tbody><tr>').replace(/$/, '</tr></tbody></table>')).querySelector('td').getAttribute('class'), 'first-row odd-col docx-num-1-0');
  assert.equal(html('<span class="term-opener">s</span>').querySelector('span').hasAttribute('class'), false);
  const data = html('<p data-action="x" data-tool-kind="files" aria-label="y">p</p>').querySelector('p');
  assert.deepEqual([...data.attributes].map((a) => a.name), []);
});

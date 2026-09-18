// test/ui-logo-mask.test.mjs — the wordmark and the mark are mask-painted with
// the ink token (spec §4.4) so they follow the theme with no per-theme asset and
// no JS; the rail select's chevron is a token-coloured pseudo-element, not a
// data-URI with a baked hex. The mask assets must be real RGBA PNGs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makePanel } from './helpers/ask-panel-harness.mjs';

const P = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const html = readFileSync(P('../ui/public/index.html'), 'utf8');
const css = readFileSync(P('../ui/public/style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|[\\s,}])' + escaped + '\\s*\\{([^}]*)\\}'));
  return m ? m[1] : null;
};
const png = (file) => { const b = readFileSync(file); return { sig: b.slice(1, 4).toString(), w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] }; };

test('index.html paints the brand with spans, not <img> (the PNG cannot follow the ink)', () => {
  assert.match(html, /<span class="logo" role="img" aria-label="Worca"><\/span>/);
  assert.match(html, /<span class="logo-mark" role="img" aria-label="Worca"><\/span>/);
  assert.ok(!/<img[^>]*class="logo(-mark)?"/.test(html), 'no <img class="logo"> / <img class="logo-mark"> left');
  assert.ok(html.includes('href="/assets/worca-favicon.png"'), 'the browser-tab favicon link is unchanged');
});

test('the wordmark is a contain (alpha) mask painted with --ink, sized by aspect-ratio', () => {
  const b = ruleBody('.brand .logo');
  assert.ok(b, '.brand .logo rule');
  assert.match(b, /background:\s*var\(--ink\)/);
  assert.match(b, /aspect-ratio:\s*512\s*\/\s*190/);
  assert.match(b, /(?:^|;)\s*mask:\s*url\(\/assets\/worca-logo-mask\.png\)\s*center\/contain\s+no-repeat/);
  assert.match(b, /-webkit-mask:\s*url\(\/assets\/worca-logo-mask\.png\)/);
  assert.match(b, /height:\s*34px/);
  assert.doesNotMatch(b, /mask-mode/, 'alpha mode (the default) — the asset is white on transparent');
});

for (const sel of ['.brand .logo-mark', '.ask-pill-logo', '.ask-header-logo']) {
  test(`${sel}: one element, ink-painted, luminance mask of the mark asset (disc minus the W)`, () => {
    const b = ruleBody(sel);
    assert.ok(b, `${sel} rule`);
    assert.match(b, /background:\s*var\(--ink\)/);
    assert.match(b, /(?:^|;)\s*mask:\s*url\(\/assets\/worca-mark-mask\.png\)\s*center\/contain\s+no-repeat/);
    assert.match(b, /-webkit-mask:\s*url\(\/assets\/worca-mark-mask\.png\)/);
    assert.match(b, /(?:^|;)\s*mask-mode:\s*luminance/);
    assert.match(b, /-webkit-mask-mode:\s*luminance/);
    assert.equal(ruleBody(`${sel}::after`), null, 'no second layer needed');
  });
}

test('the two mask assets are alpha PNGs of the expected size', () => {
  const logo = P('../ui/public/assets/worca-logo-mask.png'); const mark = P('../ui/public/assets/worca-mark-mask.png');
  assert.ok(existsSync(logo), 'ui/public/assets/worca-logo-mask.png missing — copy the run extra (or run tools/make-logo-mask.mjs)');
  assert.ok(existsSync(mark), 'ui/public/assets/worca-mark-mask.png missing — copy the run extra');
  for (const [file, w, h] of [[logo, 512, 190], [mark, 256, 256]]) {
    const meta = png(file);
    assert.equal(meta.sig, 'PNG', file); assert.equal(meta.w, w, file); assert.equal(meta.h, h, file);
    assert.ok([4, 6].includes(meta.colorType), `${file}: colour type ${meta.colorType} carries no alpha (need 4 = grey+alpha or 6 = RGBA)`);
  }
});

test('the Ask sheet logos are decorative spans, no <img>, no favicon src', () => {
  const ctx = makePanel({});
  ctx.panel.open();
  const pill = ctx.doc.querySelector('.ask-pill-logo'); const head = ctx.doc.querySelector('.ask-header-logo');
  assert.ok(pill && head, 'both logo elements exist');
  for (const el of [pill, head]) {
    assert.equal(el.tagName, 'SPAN');
    assert.equal(el.getAttribute('aria-hidden'), 'true');
    assert.equal(el.getAttribute('src'), null);
  }
  ctx.panel.destroy();
});

test('the pill mark sits in a 22px host beside the thinking orb — a mask clips children, so the orb is a sibling, not a child', () => {
  const host = ruleBody('.ask-pill-mark');
  assert.ok(host, '.ask-pill-mark rule');
  assert.match(host, /position:\s*relative/);
  assert.match(host, /width:\s*22px/); assert.match(host, /height:\s*22px/);
  assert.match(host, /flex:\s*0 0 auto/, 'the slot never changes size: label and kbd stay put');
  assert.doesNotMatch(host, /mask/, 'the host itself is unmasked, or it would clip the orb too');
  const ctx = makePanel({});
  const mark = ctx.doc.querySelector('.ask-pill > .ask-pill-mark');
  assert.ok(mark, 'the host is the pill\'s first child');
  assert.equal(mark.tagName, 'SPAN');
  assert.ok(mark.querySelector(':scope > .ask-pill-logo'), 'the masked span is inside the host');
  assert.ok(mark.querySelector(':scope > .ask-orb'), 'and so is the orb, as a sibling of the masked span');
  assert.equal(mark.querySelector('.ask-pill-logo .ask-orb'), null, 'never nested under the mask');
  ctx.panel.destroy();
});

test('the rail select chevron is a token-coloured ::after on a wrapper, not a baked-hex data-URI', () => {
  const sel = ruleBody('.ins-panel .ins-select');
  assert.ok(sel, '.ins-panel .ins-select rule');
  assert.doesNotMatch(sel, /data:image/, 'no data-URI chevron (its stroke was a baked #5C5C63)');
  assert.match(ruleBody('.ins-select-wrap') || '', /position:\s*relative/);
  const chev = ruleBody('.ins-select-wrap::after');
  assert.ok(chev, '.ins-select-wrap::after rule');
  assert.match(chev, /border-right:\s*1\.8px solid var\(--ink-2\)/);
  assert.match(chev, /border-bottom:\s*1\.8px solid var\(--ink-2\)/);
  assert.match(chev, /rotate\(45deg\)/);
  assert.match(chev, /pointer-events:\s*none/);
  const src = readFileSync(P('../ui/public/graph/inspector.mjs'), 'utf8');
  assert.match(src, /h\(doc, 'span', 'ins-select-wrap'\)/, 'select() wraps the <select> in .ins-select-wrap');
});

// test/ui-button-scale.test.mjs — the one button scale in ui/public/style.css: three heights, one radius, tint hover
// with no lift, a 40px floor under a coarse pointer, no one-off gate / qpanel sizes, and links underlined on hover only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
// Comments name selectors too (e.g. the busy-state note before .is-busy), so the rule scans read the CSS without them.
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rule = (sel) => (new RegExp(`(?:^|\\})\\s*${esc(sel)}\\{([^}]*)\\}`, 'm').exec(bare) || [])[1] ?? null;

test('tokens: sm 28, md 34, lg 42, one 8px radius, 14px icons', () => {
  assert.match(css, /:root\{--btn-h-sm:28px;--btn-h-md:34px;--btn-h-lg:42px;--btn-r:8px;--btn-ic:14px;\}/);
});

test('.btn: md by default, min-height (not height), 1px --line-2 border, 8px radius, weight 500, 6px gap', () => {
  const b = rule('.btn');
  assert.match(b, /--btn-h:var\(--btn-h-md\)/);
  assert.match(b, /min-height:var\(--btn-h\)/);
  assert.doesNotMatch(b, /(^|;)height:/);
  assert.match(b, /border:1px solid var\(--line-2\)/);
  assert.match(b, /border-radius:var\(--btn-r\)/);
  assert.match(b, /font-weight:500/);
  assert.match(b, /gap:6px/);
  assert.match(rule('.btn-primary'), /font-weight:600/);
  assert.match(rule('.btn svg'), /width:var\(--btn-ic\);height:var\(--btn-ic\)/);
});

test('sizes: on a .btn, .btn-sm and .btn-mini share the 28px rule; a bare .btn-mini keeps its pill padding; .btn-lg is 42px; .btn-icon is square', () => {
  assert.match(rule('.btn:where(.btn-sm,.btn-mini)'), /--btn-h:var\(--btn-h-sm\)/);
  // The ~41 btn-ghost btn-mini elements without .btn keep their legacy pill padding (no min-height reaches them).
  assert.match(rule('.btn-mini'), /padding:8px 14px/);
  assert.ok(bare.indexOf('.btn-mini{') < bare.indexOf('.btn:where(.btn-sm,.btn-mini){'), 'the scoped sm rule wins on a .btn by order');
  assert.match(rule('.btn-lg'), /--btn-h:var\(--btn-h-lg\)/);
  assert.match(rule('.btn-icon'), /width:var\(--btn-h\);padding:0/);
  assert.ok(bare.indexOf('.btn-icon{') > bare.indexOf('.btn:where(.btn-sm,.btn-mini){'), '.btn-icon padding wins over .btn-sm');
});

test('coarse pointer: sm and md are at least 40px', () => {
  assert.match(css, /@media \(pointer:coarse\)\{:root\{--btn-h-sm:40px;--btn-h-md:40px;\}\}/);
});

test('hover: a tint in :where() that shows in dark too, and no .btn rule lifts', () => {
  // --hover is nearly --surface in dark, so the tint mixes --ink into the button's own background.
  assert.match(rule('.btn:where(:hover:not(:disabled))'), /background:color-mix\(in srgb,var\(--ink\) 7%,var\(--surface\)\)/);
  assert.match(rule('.btn:hover'), /transform:none/);
  // Every rule whose selector names a scale class (.btn, .btn-primary, .btn-danger, .btn-quiet, .btn-sm/-lg/-icon/-mini)
  // with :hover. .btn-go / .btn-ghost / .rd-cta-only selectors are slice 3's and do not match the token test.
  const SCALE = /\.btn(?:-(?:primary|danger|quiet|sm|lg|icon|mini))?(?![-\w])/;
  let seen = 0;
  for (const m of bare.matchAll(/(?:^|\})\s*([^{}@]+)\{([^}]*)\}/gm)) {
    if (!/:hover/.test(m[1]) || !SCALE.test(m[1])) continue;
    seen += 1;
    assert.doesNotMatch(m[2], /translateY/, m[1].trim());
  }
  assert.ok(seen >= 4, `scale hover rules found: ${seen}`);
  assert.match(rule('.btn:focus-visible'), /outline:2px solid var\(--ink\);outline-offset:2px/);
});

test('variants: primary, default outline, danger, quiet', () => {
  assert.match(rule('.btn-primary'), /background:var\(--ink\)/);
  assert.match(rule('.btn-danger'), /color:var\(--red-ink\)/);
  assert.match(rule('.btn-quiet'), /background:transparent;border-color:transparent/);
  assert.match(rule('.btn-quiet:where(:hover:not(:disabled))'), /background:color-mix\(in srgb,var\(--ink\) 7%,transparent\)/);
});

test('the gate / qpanel one-off overrides are gone; gate rows right-align and never flex:1', () => {
  assert.equal(rule('.qpanel-foot .btn-go'), null);
  assert.equal(rule(':is(.rd-questions,.chat-rc-q) .qpanel-foot .btn-go'), null);
  assert.equal(rule(':is(.rd-questions,.chat-rc-q) .gate-actions .btn'), null);
  assert.equal(rule('.gate-actions .btn'), null);
  assert.match(rule('.gate-actions'), /justify-content:flex-end/);
  assert.doesNotMatch(css, /\.gate-actions \.btn\{[^}]*flex:1/);
});

test('phone width: gate and plan rows stack full width', () => {
  const m = /@media \(max-width:640px\)\{\s*\.qpanel-foot:is\(\.gate-actions,\.plan-actions\)\{flex-direction:column;align-items:stretch;\}\s*\.qpanel-foot:is\(\.gate-actions,\.plan-actions\) > \.btn\{width:100%;margin-left:0;\}/.exec(css);
  assert.ok(m, 'the stack block');
});

test('links: a.btn never underlined; .link-btn, .shape-feature-pr and .rd-slice-link underline on hover only', () => {
  assert.match(rule('a.btn,a.btn:is(:hover,:focus,:focus-visible,:active,:visited)'), /text-decoration:none/);
  for (const sel of ['.link-btn', '.shape-feature-pr', '.rd-slice-link']) {
    assert.match(rule(sel), /text-decoration:none/, sel);
    assert.match(rule(`${sel}:hover`), /text-decoration:underline/, `${sel}:hover`);
  }
});

test('link-look Shaper buttons that carry .btn keep their text height', () => {
  assert.match(rule('.plan-fold'), /min-height:0/);
  assert.match(rule('.plan-persp-edit'), /min-height:0/);
});

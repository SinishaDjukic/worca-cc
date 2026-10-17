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
const B = ':is(.btn,.btn-ghost,.btn-go,.rd-cta)';

test('tokens: sm 28, md 34, lg 42, one 6px radius, 14px icons', () => {
  assert.match(css, /:root\{--btn-h-sm:28px;--btn-h-md:34px;--btn-h-lg:42px;--btn-ic:14px;--tab-h:32px;\}/);
});

test('.btn: md by default, min-height (not height), 1px --line-2 border, 6px radius, weight 500, 6px gap', () => {
  const b = rule(B);
  assert.match(b, /--btn-h:var\(--btn-h-md\)/);
  assert.match(b, /min-height:var\(--btn-h\)/);
  assert.doesNotMatch(b, /(^|;)height:/);
  assert.match(b, /border:1px solid var\(--line-2\)/);
  assert.match(b, /border-radius:var\(--r-sm\)/);
  assert.match(b, /font-weight:500/);
  assert.match(b, /gap:6px/);
  assert.match(rule(':is(.btn-primary,.btn-go,.rd-cta)'), /font-weight:600/);
  assert.match(rule(`${B} svg`), /width:var\(--btn-ic\);height:var\(--btn-ic\)/);
});

test('sizes: on a .btn, .btn-sm and .btn-mini share the 28px rule; a bare .btn-mini keeps its pill padding; .btn-lg is 42px; .btn-icon is square', () => {
  assert.match(rule(':is(.btn,.btn-ghost,.btn-go):where(.btn-sm,.btn-mini)'), /--btn-h:var\(--btn-h-sm\)/);
  // A .btn-mini with no scale class keeps its legacy pill padding.
  assert.match(rule('.btn-mini'), /padding:8px 14px/);
  assert.ok(bare.indexOf('.btn-mini{') < bare.indexOf(':is(.btn,.btn-ghost,.btn-go):where(.btn-sm,.btn-mini){'), 'the scoped sm rule wins on a .btn by order');
  assert.match(rule(':is(.btn-lg,.rd-cta)'), /--btn-h:var\(--btn-h-lg\)/);
  assert.match(rule('.btn-icon'), /width:var\(--btn-h\);padding:0/);
  assert.ok(bare.indexOf('.btn-icon{') > bare.indexOf(':is(.btn,.btn-ghost,.btn-go):where(.btn-sm,.btn-mini){'), '.btn-icon padding wins over .btn-sm');
});

test('coarse pointer: sm and md are at least 40px', () => {
  assert.match(css, /@media \(pointer:coarse\)\{:root\{--btn-h-sm:40px;--btn-h-md:40px;\}\}/);
});

test('hover: a tint in :where() that shows in dark too, and no .btn rule lifts', () => {
  // --hover is nearly --surface in dark, so the tint mixes --ink into the button's own background.
  assert.match(rule(`${B}:where(:hover:not(:disabled))`), /background:color-mix\(in srgb,var\(--ink\) 7%,var\(--surface\)\)/);
  assert.match(rule(`${B}:hover`), /transform:none/);
  // Every rule whose selector names a scale class (.btn*, .rd-cta) with :hover.
  const SCALE = /\.(?:btn[\w-]*|rd-cta)(?![\w-])/;
  let seen = 0;
  for (const m of bare.matchAll(/(?:^|\})\s*([^{}@]+)\{([^}]*)\}/gm)) {
    if (!/:hover/.test(m[1]) || !SCALE.test(m[1])) continue;
    seen += 1;
    assert.doesNotMatch(m[2], /translateY/, m[1].trim());
  }
  assert.ok(seen >= 4, `scale hover rules found: ${seen}`);
  assert.match(rule(`${B}:focus-visible`), /outline:2px solid var\(--ink\);outline-offset:2px/);
});

test('variants: primary, default outline, danger, quiet', () => {
  assert.match(rule(':is(.btn-primary,.btn-go,.rd-cta)'), /background:var\(--ink\)/);
  assert.match(rule('.btn-danger'), /color:var\(--red-ink-strong\)/);
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
  assert.match(rule(`a${B},a${B}:is(:hover,:focus,:focus-visible,:active,:visited)`), /text-decoration:none/);
  for (const sel of ['.link-btn', '.shape-feature-pr', '.rd-slice-link']) {
    assert.match(rule(sel), /text-decoration:none/, sel);
    assert.match(rule(`${sel}:hover`), /text-decoration:underline/, `${sel}:hover`);
  }
});

test('link-look Shaper buttons that carry .btn keep their text height', () => {
  assert.match(rule('.plan-fold'), /min-height:0/);
  assert.match(rule('.plan-persp-edit'), /min-height:0/);
});

test('aliases: .btn-ghost is the outline, .btn-go the primary, .rd-cta the lg primary; the legacy pills are gone', () => {
  assert.equal(rule('.btn-ghost'), null);
  assert.equal(rule('.btn-go'), null);
  assert.equal(rule('.btn-go:hover'), null);
  assert.equal(rule('.rd-cta:hover'), null);
  assert.match(rule(B), /min-height:var\(--btn-h\)/);
  assert.match(rule(':is(.btn-primary,.btn-go,.rd-cta)'), /background:var\(--ink\)/);
  assert.match(rule(':is(.btn-lg,.rd-cta)'), /--btn-h:var\(--btn-h-lg\)/);
});

test('.rd-cta sizes to content; the slot spans only at phone width; the pending box is lg; the morph hides the border', () => {
  assert.doesNotMatch(rule('.rd-cta') || '', /width:100%/);
  assert.match(rule('.rd-pr-slot'), /width:fit-content;max-width:100%/);
  assert.match(css, /@media \(max-width:640px\)\{\s*\.rd-pr-slot\{width:auto;\}\s*\.rd-pr-slot > \.rd-cta\{width:100%;\}/);
  assert.match(rule('.rd-pr-wait'), /min-height:var\(--btn-h-lg\)/);
  assert.match(rule('.rd-pr-slot.is-morph > .rd-cta'), /border-color:transparent/);
  assert.equal(rule('.rd-pr-box:has(> .rd-pr-status:not([hidden])) .rd-cta'), null);
});

test('tabs: run, saved-run, project and Settings tabs share --tab-h', () => {
  assert.match(rule('.rd-tab'), /height:var\(--tab-h\)/);
  assert.match(rule('.hd-tab,.pd-tab'), /height:var\(--tab-h\)/);
  assert.match(rule('.settings-tabs > button'), /height:var\(--tab-h\)/);
  assert.ok(bare.indexOf('.settings-tabs > button{') > bare.indexOf('.seg button{'), 'the Settings tab rule wins over .seg button by order');
  // The chat run panel's tabs keep the 32px height with room for the badge: no vertical padding.
  assert.match(rule('.crp :is(.rd-tab,.hd-tab)'), /padding:0 12px/);
  assert.doesNotMatch(bare, /\.crp :is\(\.rd-tab,\.hd-tab\)\{padding:6px/);
});

test('the run bar has no forced 36px heights; the opener and ⋯ are sized by .btn-icon; the splits use --r-sm', () => {
  assert.doesNotMatch(bare, /\.rd-bar \.rd-pause,[^{]*\{height:36px/);
  assert.doesNotMatch(rule('.term-opener') || '', /height:36px/);
  assert.doesNotMatch(rule('.rd-bar-more') || '', /height:36px/);
  assert.doesNotMatch(bare, /\.rd-resume-more\{[^}]*height:36px/);
  assert.match(rule('.btn-split > .btn-go:first-child'), /border-radius:var\(--r-sm\) 0 0 var\(--r-sm\)/);
  assert.doesNotMatch(rule('.hd-after') || '', /padding/);
  assert.equal(rule('.hd-after,.rd-after'), null);
  assert.equal(rule('.hd-after:hover,.rd-after:hover'), null);
  assert.match(rule('.rd-bar .rd-night'), /height:var\(--btn-h-md\)/);
});

test('the one-off resize overrides in the audited views are gone', () => {
  for (const sel of ['.grv-actions .btn-ghost', '.mv-env-btns .btn-ghost', '.mv-pv-btns .btn-ghost,.mv-pv-btns .btn-go',
    '.mv-cp-code-row .btn-ghost', '.mv-needs-signin .mv-signin', '.chat-rc-btn:hover', '.chat-rc-stop:hover', '.chat-rc-stop',
    '.stop-cancel', '.stop-confirm'])
    assert.equal(rule(sel), null, sel);
  for (const sel of ['.mv-card .btn-ghost', '.mv-env-row .mv-env-rm', '.mv-env-add', '.mv-env-row .mv-env-copy',
    '.mv-cp-signin-box .mv-cp-cancel', '.hd-publish'])
    assert.doesNotMatch(rule(sel) || '', /padding|font/, sel);
  assert.doesNotMatch(rule('.proj-sync .ps-btn'), /height:|padding:|font-size:/);
  assert.doesNotMatch(rule('#projects-sync-all') || '', /height:|padding:|font-size:/, '#projects-sync-all');
});

test('markup: run bar buttons are on the scale, Start run is the one lg, no inline paddings', () => {
  const html = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
  for (const c of ['btn rd-after', 'btn rd-pause', 'btn btn-danger rd-stop', 'btn hd-after', 'btn hd-resume', 'btn hd-pause', 'btn btn-danger hd-stop',
    'rd-bar-more btn-ghost btn-icon', 'rd-wait-more btn-ghost btn-sm', 'btn stop-cancel', 'btn btn-danger stop-confirm'])
    assert.ok(html.includes(`class="${c}"`), c);
  assert.equal(html.match(/class="term-opener btn-ghost btn-icon"/g)?.length, 3);
  assert.match(html, /id="start-btn" class="btn-go btn-lg"/);
  assert.equal(html.match(/btn-lg/g)?.length, 1);
  assert.doesNotMatch(html, /style="padding:11px 20px/);
});

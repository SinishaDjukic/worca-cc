// test/ui-design-css.test.mjs — the Design stage's stylesheet (ui/public/design/design.css), its `--stage-*` tokens and
// its named exceptions in docs/design-system.md › Design stage exceptions. Rules are written compact, so they are matched
// as written (cssRules collapses whitespace in selectors only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
import { CREW_TOKENS } from '../ui/public/design/stage-model.mjs';

/** WCAG contrast of two 6-digit hex colours: the same math as test/ui-theme-tokens.test.mjs. */
const L = (hex) => {
  const h = hex.replace('#', ''); const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const css = readStyleCss();
const ALL = cssRules(css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')));
const body = (sel) => ALL.filter((r) => r.sel === sel && !r.media).map((r) => r.body).join(';');

test('the HUD: mock values, 8px radius, always dark', () => {
  const h = body('.dz-hud');
  for (const d of ['left:50%', 'bottom:20px', 'transform:translateX(-50%)', 'z-index:4', 'gap:12px', 'height:44px', 'padding:0 6px 0 14px', 'color-scheme:dark',
    'border:1px solid var(--glass-line)', 'border-radius:var(--r-md)', 'background:var(--panel-veil)', 'backdrop-filter:blur(18px) saturate(1.5)', 'box-shadow:var(--shadow-pop)', 'font-size:var(--fs-meta)', 'font-weight:500', 'font-variant-numeric:tabular-nums']) assert.ok(h.includes(d), d);
});
test('Review Focus 1: Stop and hide never shrink; text and dots give way', () => {
  assert.match(body('.dz-hud'), /max-width:calc\(100% - 16px\)/);
  assert.match(body('.dz-hud-acts'), /flex:none/);
  assert.match(body('.dz-hud-text'), /min-width:0;overflow:hidden;text-overflow:ellipsis/);
  assert.match(body('.dz-dots'), /flex:0 1 auto;min-width:0;overflow:hidden;padding:3px;margin:-3px/, 'the clip sits 3px outside the dots, so a focus ring and a hover ring are not cut');
  assert.match(body('.dz-line'), /width:96px;flex:0 1 96px/, 'the width stays, or a shrink-to-fit HUD cuts its text');
  assert.match(body('.dz-hud-cost'), /flex:none/);
});
test('the popover, the tooltip, the dots, the plan rows', () => {
  for (const d of ['bottom:74px', 'width:min(640px,calc(100% - 16px))', 'max-height:calc(100% - 96px)', 'color-scheme:dark', 'border-radius:var(--r-md)', 'box-shadow:var(--shadow-sheet)']) assert.ok(body('.dz-pop').includes(d), d);
  assert.match(body('.dz-arow'), /grid-template-columns:8px 112px 78px minmax\(0,1fr\) 52px 28px/);
  assert.match(body('.dz-who-dot'), /color-scheme:dark/, 'the chat Plan list shows the same dark-arm crew colour as the cursor');
  for (const sel of ['.dz-meta', '.dz-spacer', '.dz-menu-anchor']) assert.ok(body(sel), sel);
  assert.match(body('.dz-tip'), /bottom:72px/);
  assert.match(body('.dz-dots button'), /width:12px;height:18px/);
  assert.match(body('.dz-plan-row'), /height:26px/);
  assert.match(body('.dz-plan-n'), /min-width:14px/);
  assert.match(body('.is-stopped > .dz-sdot'), /background:var\(--seq\)/);
});
test('the overlay: constant-size marks under the scale, the label chip, the arrow', () => {
  assert.match(body('.overlay-doc'), /--k:calc\(1 \/ var\(--s,1\)\)/);
  assert.match(body('.overlay-doc'), /color-scheme:dark/);
  assert.match(body('.dz-cursor-label'), /left:12px;top:13px;height:18px;padding:0 6px;border-radius:var\(--r-xs\)/);
  assert.match(body('.dz-box'), /border:calc\(1\.5px \* var\(--k\)\) solid var\(--stage-blue\)/);
  assert.match(body('.dz-tag'), /height:17px;padding:0 5px;border-radius:var\(--r-xs\)/);
  assert.match(body('.dz-frame'), /border:0/);
  assert.ok(body('.dz-cursor > svg'), 'a child rule: the label\'s arrow icon keeps its own size and stroke');
  assert.match(body('.overlay-doc.is-pass .dz-cursor'), /pointer-events:none/);
  assert.doesNotMatch(body('.frame-box'), /overflow/, 'cursors may leave the frame');
});
test('reduced motion stops every stage transition and animation', () => {
  const r = ALL.filter((x) => /prefers-reduced-motion/.test(x.media) && /\.dz-|\.frame-box/.test(x.sel));
  for (const sel of ['.frame-box', '.dz-cursor', '.dz-box', '.dz-guide-v', '.dz-guide-h', '.dz-trail', '.dz-line i', '.dz-dots button::after']) {
    assert.ok(r.some((x) => x.sel.includes(sel) && /(transition|animation):none/.test(x.body)), sel);
  }
});
test('crew labels read at 4.5:1 on every crew colour', () => {
  const root = ALL.find((x) => x.sel === ':root').body;
  const dark = (name) => { const m = root.match(new RegExp(`${name}:light-dark\\([^,]+,(#[0-9A-Fa-f]{6})\\)`)); assert.ok(m, name); return m[1]; };
  for (const t of CREW_TOKENS) assert.ok(contrast(dark(t), dark('--stage-chip-ink')) >= 4.5, t);
  assert.equal(CREW_TOKENS.some((t) => t.includes('violet')), false);
});
test('the guide names the exceptions, and no stage rule has an accent edge', () => {
  const g = readFileSync(new URL('../docs/design-system.md', import.meta.url), 'utf8');
  assert.match(g, /### Design stage exceptions/);
  assert.match(g, /The named exceptions are the away screensaver .* and the Design stage/);
  for (const r of ALL.filter((x) => /\.dz-|\.overlay-doc|\.frame-box/.test(x.sel))) assert.doesNotMatch(r.body, /border-left/, r.sel);
});

test('made pictures: tiles of their shape on one baseline, a still dashed tile, the boards\' viewer and Set up, no accent edge', () => {
  assert.match(body('.dsc-pics'), /display:flex;flex-wrap:wrap;align-items:flex-end;gap:7px/, 'the boards\' strip: the chat\'s own attachment row gap (.extras-pills)');
  assert.match(body('.dsc-pic'), /font-size:var\(--fs-meta\);line-height:1\.4/, 'the boards\' name line: 12px/1.4');
  // The chat's own attachment thumb box (.ask-attachment-thumb, ask-worca-beside.css ≈86: 180 wide, 130 tall at most).
  for (const [s, w, h] of [['wide', 180, 120], ['tall', 87, 130], ['square', 130, 130]]) {
    assert.match(body(`.dsc-pic.is-${s}`), new RegExp(`width:${w}px`), s);
    assert.match(body(`.dsc-pic.is-${s} .dsc-pic-box`), new RegExp(`height:${h}px`), s);
  }
  assert.match(body('.dsc-pic.is-making .dsc-pic-box'), /border-style:dashed;border-color:var\(--line-2\)/, 'board BuildMaking: the dashed edge in --line-2, as the chat\'s own drop box (.dsc-drop)');
  assert.match(body('.dz-pics-off .dz-pics-setup'), /text-decoration:none/, 'board GearPicturesNotSetUp: Set up is not underlined');
  assert.match(body('.dz-pic-modal .dz-pic-card'), /width:min\(770px,100%\)/, 'board PictureViewer: a 720 px picture inside the 1 px border and 24 px padding');
  assert.match(body('.dz-pic-full'), /max-width:100%;max-height:60vh;margin:0 auto 16px/, 'the gap above What it shows sits on the picture');
  assert.match(body('.dz-pic-h'), /margin:0 0 4px/);
  for (const r of ALL.filter((x) => /\.dsc-pic|\.dz-pic/.test(x.sel))) {
    assert.doesNotMatch(r.body, /border-left/, r.sel);
    assert.doesNotMatch(r.body, /animation/, `${r.sel}: the quiet tile is still (board BuildMaking)`);
  }
});

test('the sound cards are the white ask card: no .dsc-sound- rule names an amber, yellow or warn token', () => {
  const rules = ALL.filter((x) => /\.dsc-sound-/.test(x.sel));
  assert.ok(rules.length >= 5, 'the voice row, its dividers, the fields and the answered line');
  for (const r of rules) {
    assert.doesNotMatch(r.body, /--[\w-]*(?:amber|yellow|warn)/, r.sel);
    assert.doesNotMatch(r.body, /border-left/, r.sel);
  }
});

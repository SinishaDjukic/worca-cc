// test/ui-chat-home-style.test.mjs — worca Chat P6 CSS: one appended section, tokens only (no hex, no coloured left
// edges), quick actions as 56px tiles (review B10), the 176px dotted graph well, [hidden] beating display rules,
// and every home animation stopped under prefers-reduced-motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const BANNER = '/* ===== Chat P6: home ===== */';
const block = () => { const i = css.indexOf(BANNER); return i < 0 ? '' : css.slice(i); };

test('the Chat home styles live in ONE appended P6 section', () => {
  assert.equal(css.split(BANNER).length - 1, 1);
  assert.ok(block().length > 4000, 'the section carries the home rules');
  for (const sel of ['.chat-home-title', '.chat-home-actions', '.chat-home-tab-n',
    '.chat-run-tile', '.chat-home-chat', '.chat-home-wf', '.chat-home-promo', '.chat-intent']) {
    assert.ok(block().includes(`${sel}{`) || block().includes(`${sel},`) || block().includes(`${sel} `), sel);
  }
});

test('tokens only: no hex colour and no coloured left-edge line anywhere in the section', () => {
  const rules = block().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(rules, /#[0-9a-fA-F]{3,8}\b/);
  // test/ui-theme-tokens.test.mjs "no colour literal outside the token blocks": masks too (a mask reads only alpha).
  assert.doesNotMatch(rules, /\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/i);
  assert.doesNotMatch(rules, /border-left/);
});

test('quick actions: one row of label-sized 40px tiles (icon, label, badge inline), a hairline rounded border, a hover tint; 2 columns below a 640px container; the phone heading shrinks', () => {
  const b = block();
  assert.match(b, /\.chat-home-actions\{display:flex;flex-wrap:nowrap;justify-content:center;gap:8px;overflow:hidden;\}/);
  assert.match(b, /\.chat-home-act\[data-overflow\]\{display:none;\}/);
  // F-15: the tile wears .btn.btn-lg in markup (40px, hairline border, hover tint); the hook sets layout only.
  assert.match(b, /\.chat-home-act\{display:flex;flex-direction:row;[^}]*flex:none;[^}]*text-align:left;\}/);
  assert.doesNotMatch(b.match(/\.chat-home-act\{[^}]*\}/)[0], /min-height|padding|border|background|color|font/);
  // Web UI review: "Shaper" broke as "Shap / er" beside its Labs badge. The label never shrinks or wraps;
  // the badge (overflow:hidden, ellipsis) is what gives way.
  assert.match(b, /\.chat-home-act-l\{flex:none;white-space:nowrap;\}/);
  assert.doesNotMatch(b, /\.chat-home-act-l\{[^}]*overflow-wrap:anywhere/);
  assert.match(b, /\.chat-home-promo-row\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(200px,1fr\)\);/, 'the Advanced Schedules promo leaves no hole either');
  assert.match(b, /\.chat-home-body\{container:chat-home \/ inline-size;/);
  assert.match(b, /\.chat-home-body\{[^}]*margin:20px auto 32px;/, 'the bordered tiles get air under the composer');
  assert.match(b, /@container chat-home \(max-width:640px\)\{\.chat-home-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);\}/);
  assert.match(b, /@media \(max-width:760px\)\{\.chat-home-title\{font-size:var\(--fs-page\);/);
});

test('the run tile well is 176px and dotted (dots only behind graphs); the title stretches over the tile', () => {
  const b = block();
  assert.match(b, /\.chat-run-tile \.run-flow-wrap\.chat-run-tile-well\{height:176px;margin:0;overflow:hidden;/);
  assert.match(b, /\.chat-home-wf-tb\{[^}]*background-image:radial-gradient\(circle,var\(--line-2\) 1\.1px,transparent 1\.1px\);background-size:22px 22px;/);
  assert.match(b, /\.chat-run-tile-open::after\{content:"";position:absolute;inset:0;/);
  // The title style and the ellipsis sit on the inner span: a .btn is inline-flex (no ellipsis) and keeps weight 500.
  assert.match(b, /\.chat-run-tile-name\{min-width:0;font-weight:600;color:var\(--ink\);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;\}/);
  assert.match(b, /\.chat-run-tile-answer\{position:relative;z-index:2;/);
});

test('[hidden] beats the display rules of the elements the modules hide (the intent chip is removed, never hidden)', () => {
  assert.match(block(), /:is\(\.chat-home-act,\.chat-run-tile-answer,\.chat-home-tab-n,\.chat-run-tile-note\)\[hidden\]\{display:none;\}/);
});

test('reduced motion: the chevrons and dots do not move', () => {
  const m = block().match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'a reduced-motion block');
  assert.match(m[1], /\.chat-home-chev\{transition:none;\}/);
  assert.match(m[1], /\.chat-home-dot\.is-think\{animation:none;\}/);
});

test('measured in Chrome: the tab strip is the one .tabs (its inset line, no clipped border), the pill text ellipsizes, the panel gets the ring', () => {
  const b = block();
  assert.match(css, /\n\.tabs\{[^}]*box-shadow:inset 0 -1px 0 var\(--line\);overflow-x:auto;/, 'no border: an overflow-x strip clips a -1px child');
  assert.doesNotMatch(css, /\.chat-home-ink\b/, 'review B4: no sliding underline');
  assert.match(b, /\.chat-run-tile-pt\{min-width:0;overflow:hidden;text-overflow:ellipsis;\}/, 'ellipsis never reaches a flex child by itself');
  assert.match(b, /:is\(\.chat-home-act,\.chat-home-panel,/);
  assert.doesNotMatch(b, /\b298\b|\b76px\b/, 'test/ui-sidebar-compact.test.mjs bans the old rail widths anywhere in style.css');
  assert.match(b, /\.chat-home-wf-tb rect\{fill:var\(--panel\);stroke:var\(--w-void\);\}/);
});

test('measured in Chrome (cycle 2): no stacking context on the home, AA text on the washes, the tab ring and the pill never cut', () => {
  const b = block();
  // The Ask tour (app.js gsHops 'ask') rings .ask-input and .ask-send in the hero slot with no `lift`: an isolated home
  // traps their .guide-target (z 45) under the fixed .guide-scrim (z 44) and Chrome sends every click to the scrim.
  assert.match(b, /\n\.chat-home\{position:relative;\}\n/, 'no isolation / z-index on the home');
  assert.match(b, /\n\.chat-home > \*\{position:relative;\}\n/, 'the home children stay positioned (containing blocks unchanged)');
  assert.doesNotMatch(b.replace(/\/\*[\s\S]*?\*\//g, ''), /isolation:isolate/);
  // AA in light: the strong inks on the tinted washes (--X-ink on --X-bg reads 3.3–3.9:1).
  assert.match(b, /\.chat-home-tab-n\{[^}]*color:var\(--amber-ink-strong\);/);
  assert.match(b, /\.chat-run-tile-answer\{[^}]*color:var\(--amber-ink-strong\);/);
  assert.match(b, /\.chat-run-tile-pill\.st-peach\{background:var\(--peach-bg\);color:var\(--h-peach-ink\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-amber\{background:var\(--amber-bg\);color:var\(--amber-ink-strong\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-red\{background:var\(--red-bg\);color:color-mix\(in srgb,var\(--red-ink\) 80%,var\(--ink\)\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-blue\{background:var\(--blue-bg\);color:var\(--h-blue-ink\);\}/);
  // The strip's overflow-x:auto clips y at the tabs' own height: the one .tab ring sits inside.
  assert.match(css, /\.tab:focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;/);
  assert.match(b, /\.chat-run-tile-head\{display:flex;flex-wrap:wrap;/, 'a long title pushes the pill to its own line');
  assert.match(b, /\.chat-run-tile-pill\{[^}]*max-width:100%;/);
  assert.match(b, /\.chat-hero-slot \.ask-input::placeholder\{white-space:nowrap;overflow:hidden;\}/);
});

test('a flat white Chat page: .chat-page paints --panel, and no aurora is styled or built', () => {
  assert.match(css, /\.chat-page\{position:absolute;inset:0;[^}]*background:var\(--panel\);/);
  assert.doesNotMatch(css, /chat-aurora|chat-home-aurora|chatAurora/);
  const home = readFileSync(new URL('../ui/public/chat/home.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(home, /aurora/i);
});

test('a feature card opened in Chat › Plans draws no border of its own: the Ship card inside keeps the one border (impl review 2)', () => {
  assert.match(css, /(?:^|[,}\s])\.chat-home-plan \.shape-feature\{[^}]*border:0;/);
});

test('the "More you can do" cards are still gradient pictures: one per card, light scheme, no border, nothing moves', () => {
  const b = block().replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(b, /\.chat-home-promo\{[^}]*border:0;[^}]*background:var\(--field\) center\/cover no-repeat;[^}]*color-scheme:light;/,
    'the field shows while a picture loads; the card pins a scheme so the ink never follows the page theme');
  for (const id of ['workflows', 'away', 'schedules']) {
    assert.match(b, new RegExp(`\\.chat-home-promo\\[data-promo="${id}"\\]\\{background-image:url\\(/assets/promo-${id}\\.jpg\\);`), id);
    assert.ok(existsSync(new URL(`../ui/public/assets/promo-${id}.jpg`, import.meta.url)), `promo-${id}.jpg ships`);
  }
  // The red and the night pictures carry light ink; the button is the light one everywhere.
  for (const id of ['workflows', 'schedules']) assert.match(b, new RegExp(`\\.chat-home-promo\\[data-promo="${id}"\\]\\{[^}]*color-scheme:dark;`), id);
  assert.doesNotMatch(b, /\.chat-home-promo\[data-promo="away"\]\{[^}]*color-scheme/, 'the pale blue keeps the card\'s light scheme');
  assert.match(b, /\.chat-home-promo-b\{[^}]*color-scheme:light;/);
  assert.doesNotMatch(b, /\.chat-home-promo[\w-]*(?:\[[^\]]*\])?\{[^}]*(?:animation|transition)/, 'static: no animation on the cards');
  assert.doesNotMatch(b, /\.chat-home-promo[\w-]*(?:\[[^\]]*\])?\{[^}]*-wash\)/, 'no wash on any promo rule');
});

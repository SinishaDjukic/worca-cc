// test/ui-chat-home-style.test.mjs — worca Chat P6 CSS: one appended section, tokens only (no hex, no coloured left
// edges), 8 → 4 quick actions in a narrow container, the 176px dotted graph well, [hidden] beating display rules,
// and every home animation stopped under prefers-reduced-motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const BANNER = '/* ===== Chat P6: home ===== */';
const block = () => { const i = css.indexOf(BANNER); return i < 0 ? '' : css.slice(i); };

test('the Chat home styles live in ONE appended P6 section', () => {
  assert.equal(css.split(BANNER).length - 1, 1);
  assert.ok(block().length > 4000, 'the section carries the home rules');
  for (const sel of ['.chat-home-aurora', '.chat-home-title', '.chat-home-actions', '.chat-home-tab', '.chat-home-ink',
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

test('8 quick actions per row (auto-fit: a gated tile leaves no hole), 4 below a 640px container; the phone heading shrinks', () => {
  const b = block();
  assert.match(b, /\.chat-home-actions\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(72px,1fr\)\);/);
  assert.match(b, /\.chat-home-promo-row\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(200px,1fr\)\);/, 'the Advanced Schedules promo leaves no hole either');
  assert.match(b, /\.chat-home-body\{container:chat-home \/ inline-size;/);
  assert.match(b, /@container chat-home \(max-width:640px\)\{\.chat-home-actions\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\);\}/);
  assert.match(b, /@media \(max-width:760px\)\{\.chat-home-title\{font-size:24px;/);
});

test('the run tile well is 176px and dotted (dots only behind graphs); the title stretches over the tile', () => {
  const b = block();
  assert.match(b, /\.chat-run-tile \.run-flow-wrap\.chat-run-tile-well\{height:176px;margin:0;overflow:hidden;/);
  assert.match(b, /\.chat-home-wf-tb\{[^}]*background-image:radial-gradient\(circle,var\(--line-2\) 1\.1px,transparent 1\.1px\);background-size:22px 22px;/);
  assert.match(b, /\.chat-run-tile-open::after\{content:"";position:absolute;inset:0;/);
  assert.match(b, /\.chat-run-tile-answer\{position:relative;z-index:2;/);
});

test('[hidden] beats the display rules of the elements the modules hide (the intent chip is removed, never hidden)', () => {
  assert.match(block(), /:is\(\.chat-home-act,\.chat-run-tile-answer,\.chat-home-tab-n,\.chat-run-tile-note\)\[hidden\]\{display:none;\}/);
});

test('reduced motion: the aurora is still, the underline and dots do not move', () => {
  const m = block().match(/@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\n\}/);
  assert.ok(m, 'a reduced-motion block');
  assert.match(m[1], /\.chat-aurora-orb\{animation:none;\}/);
  assert.match(m[1], /\.chat-home-ink,\.chat-home-chev\{transition:none;\}/);
  assert.match(m[1], /\.chat-home-dot\.is-think\{animation:none;\}/);
});

test('measured in Chrome: the underline sits inside the scrolling strip, the pill text ellipsizes, the panel gets the ring', () => {
  const b = block();
  assert.match(b, /\.chat-home-tablist\{[^}]*box-shadow:inset 0 -1px 0 var\(--line\);overflow-x:auto;/, 'no border: an overflow-x strip clips a -1px child');
  assert.match(b, /\.chat-home-ink\{position:absolute;left:0;bottom:0;/);
  assert.match(b, /\.chat-run-tile-pt\{min-width:0;overflow:hidden;text-overflow:ellipsis;\}/, 'ellipsis never reaches a flex child by itself');
  assert.match(b, /:is\(\.chat-home-act,\.chat-home-tab,\.chat-home-panel,/);
  assert.doesNotMatch(b, /\b298\b|\b76px\b/, 'test/ui-sidebar-compact.test.mjs bans the old rail widths anywhere in style.css');
  assert.match(b, /\.chat-home-wf-tb rect\{fill:var\(--panel\);stroke:var\(--w-void\);\}/);
});

test('measured in Chrome (cycle 2): no stacking context on the home, AA text on the washes, the tab ring and the pill never cut', () => {
  const b = block();
  // The Ask tour (app.js gsHops 'ask') rings .ask-input and .ask-send in the hero slot with no `lift`: an isolated home
  // traps their .guide-target (z 45) under the fixed .guide-scrim (z 44) and Chrome sends every click to the scrim.
  assert.match(b, /\n\.chat-home\{position:relative;\}\n/, 'no isolation / z-index on the home');
  assert.match(b, /\.chat-home > :not\(\.chat-home-aurora\)\{position:relative;\}/, 'the content paints over the aurora by tree order');
  assert.doesNotMatch(b.match(/\n\.chat-home-aurora\{[^}]*\}/)[0], /z-index/);
  assert.doesNotMatch(b.replace(/\/\*[\s\S]*?\*\//g, ''), /isolation:isolate/);
  // AA in light: the strong inks on the tinted washes (--X-ink on --X-bg reads 3.3–3.9:1).
  assert.match(b, /\.chat-home-tab-n\{[^}]*color:var\(--amber-ink-strong\);/);
  assert.match(b, /\.chat-run-tile-answer\{[^}]*color:var\(--amber-ink-strong\);/);
  assert.match(b, /\.chat-run-tile-pill\.st-peach\{background:var\(--peach-bg\);color:var\(--h-peach-ink\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-amber\{background:var\(--amber-bg\);color:var\(--amber-ink-strong\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-red\{background:var\(--red-bg\);color:color-mix\(in srgb,var\(--red-ink\) 80%,var\(--ink\)\);\}/);
  assert.match(b, /\.chat-run-tile-pill\.st-blue\{background:var\(--blue-bg\);color:var\(--h-blue-ink\);\}/);
  // The strip's overflow-x:auto clips y at the tabs' own height: the tab ring goes inside, after the shared ring rule.
  const ring = b.indexOf('.chat-home-tab:focus-visible{outline-offset:-2px;');
  assert.ok(ring > b.indexOf(':is(.chat-home-act,.chat-home-tab,'), 'the inset tab ring follows (and so beats) the shared one');
  assert.match(b, /\.chat-run-tile-head\{display:flex;flex-wrap:wrap;/, 'a long title pushes the pill to its own line');
  assert.match(b, /\.chat-run-tile-pill\{[^}]*max-width:100%;/);
  assert.match(b, /\.chat-hero-slot \.ask-input::placeholder\{white-space:nowrap;overflow:hidden;\}/);
});

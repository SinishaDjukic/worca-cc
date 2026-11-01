// test/ui-session-css.test.mjs — the tray's CSS contract: tokens, z-order, radius tokens, no new --gv-* var.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../ui/public/style.css', import.meta.url)), 'utf8');

test('three light-dark tokens', () => {
  assert.match(css, /--sess-fill:light-dark\(#F2F2F0,#232321\);/);
  assert.match(css, /--sess-head:light-dark\(#E9E9E8,#2B2B29\);/);
  assert.match(css, /--sess-line:light-dark\(#D4D4D2,#3F3F3D\);/);
});

test('layer z 0 and pointer-events none; tray corners are a radius token; selection mirrors .node.sel', () => {
  assert.match(css, /\.gv-sessions\{position:absolute;left:0;top:0;width:0;height:0;z-index:0;pointer-events:none;\}/);
  assert.match(css, /\.gv-world \.gv-sess\{[^}]*border-radius:var\(--r-md\);[^}]*background:var\(--sess-fill\);/);
  assert.match(css, /\.gv-world \.gv-sess\.sel\{border-color:transparent;box-shadow:0 0 0 1\.5px var\(--ink\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.fallback,\.gv-world \.gv-sess\.lone\{border-style:dashed;\}/);
  assert.match(css, /\.gv-edit \.gv-sess-head\{pointer-events:auto;cursor:grab;\}/);
  // The hover is 8% ink: --red-ink-strong on it is 4.39:1, so an error strip keeps its own background (correction 80).
  assert.match(css, /\.gv-edit \.gv-sess:not\(\.bad\) \.gv-sess-head:hover\{background:var\(--row-selected\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.is-active \.sdot\{background:var\(--peach\);[^}]*animation:dotpulse/);
});

test('the member chip is slate and collapses beside run totals', () => {
  assert.match(css, /\.nsess\{[^}]*background:var\(--slate-bg\);color:var\(--slate-ink\);/);
  assert.match(css, /\.nlabel:has\(\.nrun\) \.nsess \.t\{display:none;\}/);
});

test('reduced motion stops the dot pulse', () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\{[^@]*\.gv-world \.gv-sess\.is-active \.sdot\{animation:none;\}/);
});

test('the reduced-motion stop comes AFTER the pulse rule: @media adds no specificity, so it must win on source order', () => {
  const pulse = css.indexOf('.gv-world .gv-sess.is-active .sdot{background:var(--peach)');
  const stop = css.indexOf('.gv-world .gv-sess.is-active .sdot{animation:none;}');
  assert.ok(pulse > 0 && stop > pulse, `pulse at ${pulse}, stop at ${stop}`);
});

test('status dots, the dot-only small hosts and the open side of a wrapped flow segment', () => {
  assert.match(css, /\.gv-world \.gv-sess\.warn \.sdot,\.gv-world \.gv-sess\.is-paused \.sdot\{background:var\(--amber\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.is-done \.sdot\{background:var\(--green\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.is-error \.sdot\{background:var\(--red\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.is-stopped \.sdot,\.gv-world \.gv-sess\.is-interrupted \.sdot\{background:var\(--red\);\}/);
  assert.match(css, /\.gv-world \.gv-sess\.is-pending \.sdot\{box-shadow:inset 0 0 0 1\.5px var\(--ink-3\);\}/);
  assert.match(css, /\.gv-static \.gv-sess-head \.st,\.gv-static \.gv-sess-head \.sr,\.gv-static \.gv-sess-head \.sglyph\{display:none;\}/);
  assert.match(css, /\.gv-world \.gv-sess\.open-left\{border-left-style:dashed;\}/);
  assert.match(css, /\.gv-world \.gv-sess\.open-right\{border-right-style:dashed;\}/);
  // The chat run card (.gv-wrap-card) and the proposal well (.gv-well) are monitor views: dot only, no chip (05 §4.8).
  assert.match(css, /\.gv-wrap-card \.gv-sess-head \.st,\.gv-wrap-card \.gv-sess-head \.sr,\.gv-wrap-card \.gv-sess-head \.sglyph,\.gv-wrap-card \.nsess,\n\.gv-well \.gv-sess-head \.st,\.gv-well \.gv-sess-head \.sr,\.gv-well \.gv-sess-head \.sglyph,\.gv-well \.nsess\{display:none;\}/);
  assert.match(css, /\.gv-world \.gv-sess\.bad \.gv-sess-head \.st\{color:var\(--red-ink-strong\);\}/);
});

test('the strip shows its pips in the flow, rings on keyboard focus (edit) and takes the monitor\'s click', () => {
  // .npip/.nwarn are absolute at -5px; the strip clips (overflow:hidden), so a session's pip would be a 5px sliver.
  assert.match(css, /\.gv-world \.gv-sess-head>\.npip,\.gv-world \.gv-sess-head>\.nwarn\{position:static;flex:0 0 auto;\}/);
  assert.match(css, /\.gv-edit \.gv-sess-head:focus-visible\{outline:2px solid var\(--ink\);outline-offset:-2px;\}/);
  assert.match(css, /\.gv-monitor \.gv-sess-head\{pointer-events:auto;[^}]*\}/, 'Task 57 may add its cursor to this rule');
});

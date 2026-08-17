// test/ui-run-flow-css.test.mjs — Running + History cards render the pipeline as
// a composer-style node graph (.run-flow-wrap > .run-flow). Locks in the ported
// stylesheet (scroll wrap, columns/strips, node sizing, per-status states + glow
// keyframes, status badges, animated wire classes, the always-visible .nrun
// duration · cost line, loop-badge text). jsdom has no layout -> assert on TEXT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../ui/public/style.css'),
  'utf8',
);

function ruleBody(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : null;
}

test('.run-flow-wrap is a dotted-grid horizontal scroll container', () => {
  const body = ruleBody('.run-flow-wrap');
  assert.ok(body, '.run-flow-wrap rule missing');
  assert.match(body, /position:\s*relative/);
  assert.match(body, /overflow-x:\s*auto/, 'wide pipelines scroll horizontally');
  assert.match(body, /border-radius:\s*18px/);
  assert.match(body, /border:\s*1px solid var\(--line\)/);
  assert.match(body, /radial-gradient/, 'dotted-grid background');
  assert.match(body, /var\(--line-2\)/, 'grid dots use --line-2');
});

test('.run-flow is a max-content flex row with deep top/bottom padding', () => {
  const body = ruleBody('.run-flow');
  assert.ok(body, '.run-flow rule missing');
  assert.match(body, /display:\s*flex/);
  assert.match(body, /align-items:\s*flex-start/,
    'columns are TOP-aligned: node heights differ, and centering staggered every STEP tag');
  assert.match(body, /padding:\s*66px 30px 52px/, 'deep padding for self-loop + col tags');
  assert.match(body, /width:\s*max-content/);
});

test('.run-flow .strip / .col / .col-tag are scoped', () => {
  assert.ok(ruleBody('.run-flow .strip'), '.run-flow .strip missing');
  assert.ok(ruleBody('.run-flow .col'), '.run-flow .col missing');
  const tag = ruleBody('.run-flow .col .col-tag');
  assert.ok(tag, '.run-flow .col .col-tag missing');
  assert.match(tag, /var\(--ink-3\)/);
});

test('.run-flow .node overrides width + cursor without re-declaring the base look', () => {
  const body = ruleBody('.run-flow .node');
  assert.ok(body, '.run-flow .node rule missing');
  assert.match(body, /width:\s*198px/, 'run node is narrower than the composer node');
  assert.match(body, /cursor:\s*default/);
  assert.doesNotMatch(body, /::before/, 'accent bar must be inherited, not re-declared');
});

test('.run-flow node icon + meta are sized down', () => {
  const nic = ruleBody('.run-flow .node .nic');
  assert.ok(nic, '.run-flow .node .nic missing');
  assert.match(nic, /width:\s*33px/);
  assert.match(nic, /height:\s*33px/);
});

test('.nrun line: always-visible duration · cost, small monospace, --ink-3', () => {
  const nrun = ruleBody('.run-flow .node .nrun');
  assert.ok(nrun, '.run-flow .node .nrun rule missing');
  assert.match(nrun, /font-family:\s*var\(--mono\)/, '.nrun must be monospace');
  assert.match(nrun, /color:\s*var\(--ink-3\)/);
  assert.match(nrun, /margin-top/, '.nrun sits below the meta block');
  assert.doesNotMatch(nrun, /display:\s*none/);
  assert.ok(
    ruleBody('.run-flow .node .nrun .dur') || /\.run-flow \.node \.nrun \.dur/.test(css),
    '.dur sub-span styled',
  );
  assert.ok(
    ruleBody('.run-flow .node .nrun .cost') || /\.run-flow \.node \.nrun \.cost/.test(css),
    '.cost sub-span styled',
  );
});

test('per-status node states are present', () => {
  assert.match(css, /\.run-flow \.node\.is-pending\s*\{[^}]*opacity:\s*\.5/);
  assert.ok(ruleBody('.run-flow .node.is-done .nmeta small'), 'is-done small color');
  assert.match(css, /\.run-flow \.node\.is-active\s*\{[^}]*animation:\s*nodeGlow/);
  assert.match(css, /\.run-flow \.node\.is-paused\s*\{[^}]*animation:\s*nodeGlowAmber/);
  assert.match(css, /\.run-flow \.node\.is-stopped\s*\{[^}]*color-mix\(in srgb, var\(--red\)/);
});

test('.nmodel sub-line is pinned to neutral grey, placed after the per-status block', () => {
  assert.match(css, /\.run-flow \.node \.nmeta small\.nmodel\{[^}]*color:var\(--ink-3\)[^}]*\}/,
    '.nmodel sub-line is pinned to neutral grey');
  // Guard the source-order win: the .nmodel rule must come AFTER the per-status small rules.
  assert.ok(
    css.indexOf('small.nmodel') > css.lastIndexOf('.is-stopped .nmeta small'),
    '.nmodel rule must be placed after the per-status .nmeta small block',
  );
});

test('node glow keyframes defined', () => {
  assert.match(css, /@keyframes nodeGlow\b/);
  assert.match(css, /@keyframes nodeGlowAmber\b/);
});

test('.nstat status badge + done/paused/stopped variants', () => {
  const base = ruleBody('.run-flow .nstat');
  assert.ok(base, '.run-flow .nstat rule missing');
  assert.match(base, /position:\s*absolute/);
  assert.match(base, /border-radius:\s*50%/);
  assert.match(css, /\.run-flow \.nstat\.done\s*\{[^}]*background:\s*var\(--green\)/);
  assert.match(css, /\.run-flow \.nstat\.paused\s*\{[^}]*background:\s*var\(--amber\)/);
  assert.match(css, /\.run-flow \.nstat\.stopped\s*\{[^}]*background:\s*var\(--red\)/);
});

test('animated wire classes + wireFlow keyframes', () => {
  assert.match(css, /\.run-flow \.wires path\.wire-dim\s*\{[^}]*opacity:\s*\.26/);
  const live = css.match(/\.run-flow \.wires path\.wire-live\s*\{([^}]*)\}/);
  assert.ok(live, '.wire-live rule missing');
  assert.match(live[1], /opacity:\s*1/);
  assert.match(live[1], /stroke-width:\s*2\.4/);
  assert.match(live[1], /animation:\s*wireFlow/);
  assert.match(css, /@keyframes wireFlow\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*-18/);
});

test('.loop-badge text uses the sans font (legible cycle count)', () => {
  assert.ok(
    ruleBody('.run-flow .loop-badge text') || ruleBody('.loop-badge text'),
    '.loop-badge text rule missing',
  );
});

test('prefers-reduced-motion disables node glow + marching-ants', () => {
  assert.match(css, /prefers-reduced-motion[\s\S]*\.run-flow \.node\.is-active/);
  assert.match(css, /prefers-reduced-motion[\s\S]*\.run-flow \.wires path\.wire-live[\s\S]*animation:\s*none/);
});

test('.fan square strip: wrap row, 7px squares, blue .on pulses via sqPulse', () => {
  assert.match(css, /\.run-flow \.node\.run-node\{[^}]*flex-wrap:\s*wrap/,
    'run-node wraps so the fan drops to its own row');
  const fan = ruleBody('.run-flow .node .fan');
  assert.ok(fan, '.fan rule missing');
  assert.match(fan, /flex:\s*0 0 100%/, 'fan takes a full row');
  assert.match(fan, /border-top:\s*1px solid var\(--line\)/);
  const sq = ruleBody('.run-flow .node .fan .sq');
  assert.ok(sq, '.fan .sq rule missing');
  assert.match(sq, /width:\s*7px/);
  assert.match(sq, /background:\s*var\(--ink-3\)/, 'idle square is grey');
  const on = ruleBody('.run-flow .node .fan .sq.on');
  assert.ok(on, '.fan .sq.on rule missing');
  assert.match(on, /background:\s*var\(--blue\)/);
  assert.match(on, /animation:\s*sqPulse/, 'only the graph .fan .sq.on pulses');
  assert.match(css, /@keyframes sqPulse\b/, 'sqPulse keyframes defined');
});

test('sqPulse is scoped to the graph fan ONLY (never .subs-tree / .led / .subs-legend)', () => {
  // Every selector that attaches animation:sqPulse must be the graph fan square.
  const animRules = [...css.matchAll(/([^{}]+)\{[^}]*animation:\s*sqPulse[^}]*\}/g)].map((m) => m[1].trim());
  assert.ok(animRules.length >= 1, 'at least one sqPulse user');
  for (const sel of animRules) {
    assert.equal(sel, '.run-flow .node .fan .sq.on',
      `sqPulse may only attach to .run-flow .node .fan .sq.on, found: ${sel}`);
  }
});

test('reduced-motion disables the fan square pulse', () => {
  assert.match(css, /prefers-reduced-motion[\s\S]*\.run-flow \.node \.fan \.sq\.on[\s\S]*animation:\s*none/);
});

test('Sub-agents pill: rounded button, sb-count blue default + grey variant, chev rotate', () => {
  // .subs-bar shares its margin/hidden rules with the History clarify/logs bars
  // (grouped selector), so match the grouped rule rather than a standalone one.
  assert.match(css, /\.subs-bar[^{]*\{[^}]*margin-top:\s*14px/, '.subs-bar margin rule missing');
  const btn = ruleBody('.btn-subs');
  assert.ok(btn, '.btn-subs rule missing');
  assert.match(btn, /border-radius:\s*999px/, 'pill is fully rounded');
  assert.match(btn, /cursor:\s*pointer/);
  const cnt = ruleBody('.btn-subs .sb-count');
  assert.ok(cnt, '.sb-count rule missing');
  assert.match(cnt, /background:\s*var\(--blue-bg\)/, 'default count is blue');
  assert.match(cnt, /color:\s*var\(--blue-ink\)/);
  assert.ok(ruleBody('.btn-subs .sb-count.grey'), '.sb-count.grey variant missing');
  const panel = ruleBody('.subs-panel');
  assert.ok(panel, '.subs-panel rule missing');
  assert.match(panel, /border-radius:\s*18px/);
  assert.match(css, /\.subs-panel\[hidden\]\{[^}]*display:\s*none/);
  assert.match(css, /\.btn-subs\[aria-expanded="true"\] \.chev\{[^}]*rotate\(180deg\)/,
    'open pill rotates the chevron');
});

test('tree legend + step + connector-row CSS, and NO animation on tree squares', () => {
  assert.ok(ruleBody('.subs-legend'), '.subs-legend rule missing');
  assert.ok(ruleBody('.subs-legend .sq.on'), 'legend active swatch');
  assert.ok(ruleBody('.subs-legend .sq.off'), 'legend finished swatch');
  const step = ruleBody('.subs-step');
  assert.ok(step, '.subs-step rule missing');
  assert.match(step, /border-top:\s*1px solid var\(--line\)/);
  assert.ok(ruleBody('.subs-step-head .dot'), '.dot rule missing');
  assert.match(css, /\.subs-step-head \.subs-stat\.run\{[^}]*background:\s*var\(--blue-bg\)/);
  assert.match(css, /\.subs-step-head \.subs-stat\.done\{[^}]*background:\s*var\(--green-bg\)/);
  assert.match(css, /\.subs-step-head \.subs-stat\.stop\{[^}]*background:\s*var\(--red-bg\)/);
  assert.ok(ruleBody('.subs-step-head .subs-n'), '.subs-n rule missing');

  const li = ruleBody('.subs-tree li');
  assert.ok(li, '.subs-tree li rule missing');
  assert.match(li, /position:\s*relative/, 'rows are positioned for ::before/::after connectors');
  assert.ok(ruleBody('.subs-tree li::before') || /\.subs-tree li::before/.test(css), 'vertical connector');
  assert.ok(ruleBody('.subs-tree li::after') || /\.subs-tree li::after/.test(css), 'horizontal connector');
  assert.ok(ruleBody('.subs-tree li .led'), 'row .led rule missing');
  assert.ok(ruleBody('.subs-tree li .led.on'), 'lit row .led variant missing');
  assert.match(css, /\.subs-tree li \.st\.run\{[^}]*background:\s*var\(--blue-bg\)/);
  assert.match(css, /\.subs-tree li \.st\.done\{[^}]*background:\s*var\(--green-bg\)/);
  assert.match(css, /\.subs-tree li \.st\.stop\{[^}]*background:\s*var\(--red-bg\)/);

  // The ONLY sqPulse user stays the graph fan (re-assert the scoping after the tree CSS lands).
  const animRules = [...css.matchAll(/([^{}]+)\{[^}]*animation:\s*sqPulse[^}]*\}/g)].map((m) => m[1].trim());
  for (const sel of animRules) assert.equal(sel, '.run-flow .node .fan .sq.on');
  // No tree rule may reference sqPulse / any animation on .led or .subs squares.
  assert.doesNotMatch(css, /\.subs-tree[^{]*\{[^}]*animation/, 'tree rows never animate');
  assert.doesNotMatch(css, /\.subs-legend[^{]*\{[^}]*animation/, 'legend never animates');
});

test('skill pills: .subs-skills flex-wraps; row pills take their own full line; pills are rounded', () => {
  assert.match(ruleBody('.subs-skills'), /flex-wrap:\s*wrap/, '.subs-skills wraps');
  assert.match(css, /\.subs-tree li\{[^}]*flex-wrap:\s*wrap/, '.subs-tree li wraps so pills drop below name/status');
  assert.match(ruleBody('.subs-tree li .subs-skills'), /flex:\s*0 0 100%/, 'row pill container takes a full row');
  assert.match(ruleBody('.skill-pill'), /border-radius:\s*999px/, 'pills are rounded like the house style');
});

test('§7.4 .is-mcp-tool stays in the green MCP family; .is-overflow is muted', () => {
  const tool = ruleBody('.skill-pill.is-mcp-tool');
  assert.ok(tool, '.skill-pill.is-mcp-tool rule missing');
  assert.match(tool, /font-family:\s*var\(--mono\)/, 'the tool segment is monospace');
  assert.match(tool, /padding:\s*2px 7px/, 'denser padding than a plain label pill');
  // It is a VARIANT: the green background/ink comes from .is-mcp, which must still
  // be declared (the class list is "is-mcp is-mcp-tool"), not restated here.
  assert.match(ruleBody('.skill-pill.is-mcp'), /var\(--green-bg\)/, 'the green family base survives');

  const over = ruleBody('.skill-pill.is-overflow');
  assert.ok(over, '.skill-pill.is-overflow rule missing');
  assert.match(over, /var\(--ink-3\)|var\(--ink-2\)/, 'muted ink, not a status color');
  assert.doesNotMatch(over, /var\(--(green|blue|red|amber|violet)-bg\)/,
    'the sentinel must not read as one of the label/status families');
});

test('graphify pill is inline & content-sized (no full-row / own-line override)', () => {
  // base pill stays inline-block, content-sized
  assert.match(ruleBody('.graphify-pill'), /display:\s*inline-block/, 'base pill is inline-block');
  // the per-row full-width override is gone -> pill no longer eats a whole row
  assert.doesNotMatch(css, /\.subs-tree li \.graphify-pill\s*\{[^}]*flex:\s*0 0 100%/,
    'row graphify pill must not be forced to a full row');
  // the own-line header override (direct child of .subs-step) is gone -> pill is inline in the header
  assert.doesNotMatch(css, /\.subs-step\s*>\s*\.graphify-pill/,
    'header graphify pill must not be a block child of .subs-step');
});

test('Agents dropdown: .subs-empty placeholder is muted', () => {
  const body = ruleBody('.subs-empty');
  assert.ok(body, '.subs-empty rule missing');
  assert.match(body, /color:\s*var\(--ink-3\)/, 'placeholder uses the muted ink token');
});

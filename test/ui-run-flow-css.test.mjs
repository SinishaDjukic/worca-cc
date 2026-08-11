// test/ui-run-flow-css.test.mjs — Running + History cards mount the SHARED graph
// renderer (.run-flow-wrap > .run-flow > .gv) and lay run-decor's live layer over
// it. Locks in the run-monitor stylesheet: the mount, the per-status node states
// (incl. the NEW skipped/error), the glow + marching-ants keyframes, the gate
// pip, the End result chip, the executions footer, the legacy chip strip and the
// reduced-motion opt-outs. jsdom has no layout -> assert on TEXT.
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


// There are several prefers-reduced-motion blocks; grab the run-monitor one.
function reducedMotionBlock() {
  for (const m of css.matchAll(/@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/g)) {
    if (m[1].includes('.run-flow')) return m[1];
  }
  return null;
}

test('.run-flow-wrap is a dotted-grid scroll container', () => {
  const body = ruleBody('.run-flow-wrap');
  assert.ok(body, '.run-flow-wrap rule missing');
  assert.match(body, /position:\s*relative/);
  assert.match(body, /overflow:\s*auto/, 'wide/tall graphs scroll');
  assert.match(body, /border-radius:\s*18px/);
  assert.match(body, /border:\s*1px solid var\(--line\)/);
  assert.match(body, /radial-gradient/, 'dotted-grid background');
  assert.match(body, /var\(--line-2\)/, 'grid dots use --line-2');
});

test('.run-flow is a positioned, sized mount for the absolutely-placed .gv', () => {
  const body = ruleBody('.run-flow');
  assert.ok(body, '.run-flow rule missing');
  assert.match(body, /position:\s*relative/, 'the renderer positions .gv/.gv-world absolutely');
  assert.match(body, /height:\s*\d+px/, 'an absolute child needs a real height to be visible');
  assert.ok(ruleBody('.run-flow .gv,.run-flow .gv-world'), 'the mount pins the renderer roots');
});

test('the run-level warning banner is amber and hides when empty', () => {
  const body = ruleBody('.run-warn');
  assert.ok(body, '.run-warn rule missing');
  assert.match(body, /var\(--amber-bg\)/);
  assert.match(body, /var\(--amber-ink\)/);
  assert.match(ruleBody('.run-warn\[hidden\]') || '', /display:\s*none/);
});

test('every run status has a node treatment, including the new skipped + error', () => {
  for (const state of ['is-pending', 'is-active', 'is-paused', 'is-stopped', 'is-error', 'is-skipped']) {
    assert.ok(ruleBody(`.run-flow .node.${state}`), `${state} rule missing`);
  }
  assert.match(ruleBody('.run-flow .node.is-pending'), /opacity:\s*\.5/);
  const skipped = ruleBody('.run-flow .node.is-skipped');
  assert.match(skipped, /opacity:\s*\.35/, 'spec §7: skipped is .35');
  assert.match(skipped, /border-style:\s*dashed/, 'spec §7: skipped is dashed');
  const error = ruleBody('.run-flow .node.is-error');
  assert.match(error, /border-color:\s*var\(--red\)/, 'spec §7: error gets a red ring');
  assert.match(ruleBody('.run-flow .node.is-active'), /animation:\s*nodeGlow/);
  assert.match(ruleBody('.run-flow .node.is-paused'), /animation:\s*nodeGlowAmber/);
});

test('node glow keyframes defined', () => {
  assert.match(css, /@keyframes\s+nodeGlow\s*\{/);
  assert.match(css, /@keyframes\s+nodeGlowAmber\s*\{/);
});

test('the card height transitions so an executions toggle animates', () => {
  assert.match(ruleBody('.run-flow .node'), /transition:[^;]*height/);
});

test('the gate pip is an amber pulsing "?" affordance', () => {
  const body = ruleBody('.run-flow .ngate');
  assert.ok(body, '.ngate rule missing');
  assert.match(body, /background:\s*var\(--amber\)/);
  assert.match(body, /cursor:\s*pointer/, 'clicking it goes to the question panel');
  assert.match(body, /animation:\s*dotpulse/);
});

test('.nrun duration · cost rides the card header, with a separator only when both show', () => {
  const body = ruleBody('.run-flow .node .nrun');
  assert.ok(body, '.nrun rule missing');
  assert.match(body, /font-family:\s*var\(--mono\)/);
  assert.match(ruleBody('.run-flow .node .nrun .dur:empty,.run-flow .node .nrun .cost:empty'), /display:\s*none/);
  assert.match(ruleBody('.run-flow .node .nrun .cost:not\(:empty\)::before'), /content:/);
});

test('the End result chip renders as a bottom row with a link affordance', () => {
  const body = ruleBody('.run-flow .xresult');
  assert.ok(body, '.xresult rule missing');
  assert.match(body, /text-overflow:\s*ellipsis/, 'a long artifact path must not blow the card');
  assert.match(ruleBody('.run-flow .xresult a'), /var\(--blue-ink\)/);
});

test('executions footer: 26px collapsed strip, 22px rows — matching graph-geometry', () => {
  assert.ok(ruleBody('.run-flow .xfoot'), '.xfoot rule missing');
  assert.match(ruleBody('.run-flow .xtoggle'), /height:\s*26px/, 'FOOTER_H');
  assert.match(ruleBody('.run-flow .xrow'), /height:\s*22px/, 'EXEC_ROW_H');
  assert.match(ruleBody('.run-flow .xsq .xq'), /width:\s*7px/, 'spec §7: 7px squares');
  assert.match(ruleBody('.run-flow .xrows\[hidden\]'), /display:\s*none/);
  assert.match(ruleBody('.run-flow .xtoggle\[aria-expanded="true"\] .chev'), /rotate\(180deg\)/);
  assert.match(ruleBody('.run-flow .xrow'), /cursor:\s*pointer/, 'a row click filters the log');
  assert.match(ruleBody('.run-flow .xrow.is-active .led'), /animation:\s*sqPulse/, 'a running execution pulses');
});

test('the loop fired-count badge is amber, alongside the renderer budget badge', () => {
  assert.match(ruleBody('.run-flow .wbadge .wfired'), /var\(--amber-ink\)/);
});

test('animated wire class + wireFlow keyframes survive the run-block rewrite', () => {
  const body = ruleBody('.run-flow .gv-wires path.wire-live');
  assert.ok(body, 'wire-live rule missing');
  assert.match(body, /animation:\s*wireFlow/);
  assert.match(body, /stroke-dasharray/, 'marching ants need a dash pattern');
  assert.match(css, /@keyframes\s+wireFlow\s*\{\s*to\s*\{\s*stroke-dashoffset:\s*-18/);
});

test('prefers-reduced-motion disables every run-monitor animation', () => {
  const block = reducedMotionBlock();
  assert.ok(block, 'run-monitor reduced-motion block missing');
  for (const sel of ['.run-flow .node.is-active', '.run-flow .gv-wires path.wire-live',
                     '.run-flow .node .fan .sq.on', '.run-flow .ngate']) {
    assert.ok(block.includes(sel), `${sel} not opted out of motion`);
  }
});

test('the legacy v1 chip strip has its own status tints', () => {
  assert.ok(ruleBody('.run-strip'), '.run-strip rule missing');
  assert.match(ruleBody('.run-strip .rchip.is-done'), /var\(--green-bg\)/);
  assert.match(ruleBody('.run-strip .rchip.is-error'), /var\(--red-bg\)/);
});

test('.fan square strip: 7px squares, blue .on pulses via sqPulse', () => {
  const fan = ruleBody('.run-flow .node .fan');
  assert.ok(fan, '.fan rule missing');
  const sq = ruleBody('.run-flow .node .fan .sq');
  assert.match(sq, /width:\s*7px/);
  assert.match(sq, /height:\s*7px/);
  const on = ruleBody('.run-flow .node .fan .sq.on');
  assert.match(on, /background:\s*var\(--blue\)/);
  assert.match(on, /animation:\s*sqPulse/);
  assert.match(css, /@keyframes\s+sqPulse\s*\{/);
});

test('sqPulse is scoped to the graph fan + the executions rows ONLY (never .subs-tree / .subs-legend)', () => {
  const ALLOWED = new Set([
    '.run-flow .node .fan .sq.on',
    '.run-flow .xsq .xq.is-active',
    '.run-flow .xrow.is-active .led',
  ]);
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*animation:\s*sqPulse[^}]*)\}/g)];
  assert.ok(rules.length > 0, 'no rule attaches sqPulse');
  for (const [, selector] of rules) {
    for (const sel of selector.split(',')) {
      const s = sel.trim();
      if (!s || s.startsWith('@')) continue;
      assert.ok(ALLOWED.has(s), `sqPulse leaked onto "${s}"`);
    }
  }
});

test('reduced-motion disables the fan square pulse', () => {
  assert.match(reducedMotionBlock(), /\.run-flow \.node \.fan \.sq\.on\{animation:none/);
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

  // sqPulse stays confined to the run graph (the fan strip + the running
  // execution rows) — re-assert the scoping after the tree CSS lands.
  const RUN_ONLY = /^\.run-flow /;
  const animRules = [...css.matchAll(/([^{}]+)\{[^}]*animation:\s*sqPulse[^}]*\}/g)].map((m) => m[1].trim());
  for (const rule of animRules) {
    for (const sel of rule.split(',')) assert.match(sel.trim(), RUN_ONLY);
  }
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

// test/ui-worca-level-css.test.mjs — the Worca level stylesheet adds no colour of its own: every --wl-* colour
// alias points at a theme token (or is the one oklch celebration tint), no .wl-*/gs-level rule carries a colour
// literal, and every class the level markup emits has a rule. The dark-mode and design gates themselves are
// ui-theme-tokens.test.mjs and ui-design-language.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const ALL = cssRules(readStyleCss());
const LEVEL_RULES = ALL.filter((r) => /\.(?:wl-|worca-hover-card|worca-dlg|gs-level)|data-worca-level/.test(r.sel));
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/i;
const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const ALIASES = {
  '--wl-seg-done': 'var(--ink)',
  '--wl-dot-done': 'var(--ink)',
  '--wl-seg-todo': 'var(--line-2)',
  '--wl-dot-todo': 'var(--ink-3)',
  '--wl-link': 'var(--blue-ink-strong)',
  '--wl-chip-next-ink': 'var(--blue-ink-strong)',
  '--wl-chip-next-bg': 'var(--blue-bg)',
  '--wl-chip-reached-bg': 'var(--green-bg)',
  '--wl-chip-reached-ink': 'var(--green-ink-strong)',
};
const CELEBRATE = 'light-dark(oklch(0.96 0.025 var(--wl-hue)), oklch(0.3 0.05 var(--wl-hue)))';
const squash = (v) => v.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

function aliasValues(name) {
  return LEVEL_RULES.flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'g'))].map((m) => squash(m[1])));
}

test('every --wl-* colour alias resolves to a theme token, or to the oklch celebration tint', () => {
  for (const [name, want] of Object.entries(ALIASES)) {
    const got = aliasValues(name);
    assert.ok(got.length > 0, `${name} is declared`);
    assert.deepEqual([...new Set(got)], [want], `${name} → ${want}`);
  }
  assert.deepEqual([...new Set(aliasValues('--wl-celebrate-bg'))], [CELEBRATE]);
});

test('the celebration tint is declared on the element that receives --wl-hue (.worca-dlg-art), not on .worca-dlg', () => {
  const declaring = LEVEL_RULES.filter((r) => /--wl-celebrate-bg\s*:/.test(r.body));
  assert.ok(declaring.length > 0);
  for (const r of declaring) {
    assert.deepEqual(r.sel.split(',').map((x) => x.trim()), ['.worca-dlg-art'], 'declared only where --wl-hue is set inline');
  }
  const art = LEVEL_RULES.find((r) => r.sel.trim() === '.worca-dlg-art' && /background\s*:/.test(r.body));
  assert.match(art.body, /background:\s*var\(--wl-celebrate-bg\)/);
  assert.match(read('ui/public/worca-level/dialogs.mjs'), /art\.style\.setProperty\('--wl-hue'/);
});

test('--wl-* colour aliases live on .wl-* rules, never on :root', () => {
  const onRoot = ALL.filter((r) => /(?:^|,)\s*:root\b/.test(r.sel) && /--wl-(?:seg|dot|link|chip|celebrate)/.test(r.body));
  assert.deepEqual(onRoot.map((r) => r.sel), []);
});

test('no level rule carries a hex, rgb, hsl, white or black', () => {
  assert.ok(LEVEL_RULES.length > 20, 'the level rules were found');
  const bad = LEVEL_RULES.filter((r) => LITERAL.test(r.body)).map((r) => `${r.sel} → ${r.body.slice(0, 80)}`);
  assert.deepEqual(bad, []);
});

test('each level key tints with a hue number', () => {
  const HUES = { curious: 235, runner: 195, hooked: 295, worcaholic: 65, council: 150 };
  for (const [key, hue] of Object.entries(HUES)) {
    const rule = ALL.find((r) => r.sel.includes(`[data-worca-level=${key}]`) || r.sel.includes(`[data-worca-level="${key}"]`));
    assert.ok(rule, `${key} has a hue rule`);
    assert.match(rule.body, new RegExp(`--wl-hue:\\s*${hue}\\b`));
  }
});

test('the segment row, card, hover card, hero, reach list and dialog all have rules', () => {
  for (const sel of ['.wl-seg', '.wl-seg-i', '.wl-card', '.worca-hover-card', '.wl-hero', '.wl-reach', '.wl-level', '.wl-dot', '.worca-dlg', '.gs-level-line']) {
    assert.ok(ALL.some((r) => r.sel.split(',').some((s) => s.trim().startsWith(sel))), `${sel} has a rule`);
  }
});

test('every wl-* class the level markup emits has a rule', () => {
  const css = ALL.map((r) => r.sel).join(' ');
  const files = ['ui/public/worca-level/hover-card.mjs', 'ui/public/worca-level/profile-view.mjs', 'ui/public/worca-level/segments.mjs', 'ui/public/account-menu.mjs'];
  const used = new Set(files.flatMap((f) => [...read(f).matchAll(/'((?:[\w-]+ )*wl-[\w-]+(?: [\w-]+)*)'/g)].flatMap((m) => m[1].split(' ').filter((c) => c.startsWith('wl-')))));
  assert.ok(used.size > 30, 'the markup classes were found');
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
  assert.deepEqual(missing, []);
});

test('the segment row uses the xs corner and a tighter gap only for a dense small bar', () => {
  const seg = ALL.filter((r) => r.sel.includes('.wl-seg-i')).map((r) => r.body).join(';');
  assert.match(seg, /border-radius:\s*var\(--r-xs\)/);
  const dense = ALL.find((r) => r.sel.includes('.wl-seg[data-gap="2"]') || r.sel.includes(".wl-seg[data-gap='2']"));
  assert.ok(dense, 'a data-gap="2" rule exists');
  assert.match(dense.body, /gap:\s*2px/);
});

// test/extension-css-coverage.test.mjs — the generated extension CSS covers the sidebar markup, the shadow variant is
// well-formed, and the extension's own CSS carries no colour literal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sidebarCss, shadowCss, hasRuleFor } from '../tools/extension-css.mjs';
import { SIDEBAR_CLASSES } from '../extension/src/sidebar/sidebar-view.mjs';

const style = readFileSync('ui/public/style.css', 'utf8');
test('every class the sidebar markup uses has at least one rule in the generated sidebar CSS', () => {
  const css = sidebarCss(style, readFileSync('extension/src/sidebar/sidebar.css', 'utf8'));
  for (const c of SIDEBAR_CLASSES) assert.ok(hasRuleFor(css, c), c);
});
test('the shadow variant: own layer first, tokens on :host with color-scheme, ask-chip + Pinpoint, renamed fonts, no :root', () => {
  const css = shadowCss(style, readFileSync('extension/src/content/shadow.css', 'utf8'));
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');                      // comments name both strings (review m7)
  const reset = code.indexOf('all:initial');
  const tokens = code.indexOf(':host{', reset + 1);                          // the generated token block (was :root{)
  assert.ok(reset >= 0 && tokens > reset, 'shadow.css (all:initial) comes before the generated :host token block (m1)');
  assert.match(code.slice(tokens, code.indexOf('}', tokens)), /color-scheme:\s*light dark/);
  assert.ok(css.includes(':host([data-theme="dark"])'));
  assert.ok(css.includes('.ask-chip{'));
  assert.ok(css.includes('.pp-bar'));
  assert.ok(!/:root/.test(css));
  assert.ok(css.includes("'Worca Poppins'"));
  assert.ok(!css.includes('@font-face'));
});
test('extension CSS has no colour literal (same rule as test/ui-theme-tokens.test.mjs)', () => {
  const RE = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![-\w])(?:white|black)(?![-\w])/gi;
  for (const f of ['extension/src/sidebar/sidebar.css', 'extension/src/content/shadow.css']) {
    // Declaration bodies only, as test/ui-theme-tokens.test.mjs does. Otherwise `#[0-9a-f]{3,8}` also matches ID
    // selectors such as `#feed`.
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const bodies = (src.match(/\{[^{}]*\}/g) || []).join('\n');
    assert.deepEqual(bodies.match(RE) || [], [], f);
  }
});

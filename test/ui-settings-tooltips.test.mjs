// test/ui-settings-tooltips.test.mjs
// Settings view: gray helper text lives in ⓘ info-tip tooltips, not visible hints.
// Structure here; hover/focus behavior in the "behavior" tests added with the
// app.js wiring (Task 2 of the settings-tooltips plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));

const settingsView = () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  return dom.window.document.querySelector('.view[data-view="settings"]');
};

test('settings: six info-tip icons, each with non-empty tip content', () => {
  const view = settingsView();
  const tips = [...view.querySelectorAll('button.info-tip')];
  assert.equal(tips.length, 6, 'six ⓘ icons (2 folder fields, budget heading, 3 budget fields)');
  for (const tip of tips) {
    assert.equal(tip.getAttribute('type'), 'button', 'icon must not submit anything');
    assert.match(tip.getAttribute('aria-label') || '', /^About /, 'icon names its setting');
    const content = tip.querySelectorAll(':scope > span.tip-content.hidden');
    assert.equal(content.length, 1, 'exactly one hidden tip-content span per icon');
    assert.ok(content[0].textContent.trim().length > 20, 'tooltip content is real text');
  }
});

test('settings: tooltip contents carry the old hint texts (incl. merged root note)', () => {
  const view = settingsView();
  const byLabel = (label) =>
    view.querySelector(`button.info-tip[aria-label="${label}"] .tip-content`);

  const root = byLabel('About Worca CC root folder');
  assert.ok(root, 'root-folder icon exists');
  assert.match(root.textContent.replace(/\s+/g, ' '), /history store, the project list, and saved workflows/);
  assert.match(root.textContent.replace(/\s+/g, ' '), /does not move existing data/, 'migration note merged in');
  assert.ok(root.querySelector('code'), 'keeps <code> formatting');
  assert.ok(root.querySelector('b'), 'keeps <b>not</b> emphasis');

  const projects = byLabel('About Projects root folder');
  assert.match(projects.textContent.replace(/\s+/g, ' '), /CLAUDE\.md, \.claude\/skills, and \.mcp\.json/);

  const budget = byLabel('About budget costs');
  assert.match(budget.textContent.replace(/\s+/g, ' '), /client-side estimate \(total_cost_usd\), not authoritative billing/);

  assert.ok(byLabel('About Per-pipeline cost limit'), 'per-pipeline icon');
  assert.ok(byLabel('About Total cost limit'), 'total icon');
  assert.ok(byLabel('About Reset period'), 'reset-period icon');
});

test('settings: visible hints are gone; status elements stay', () => {
  const view = settingsView();
  // The two dynamic Default: hint elements are deleted outright.
  assert.equal(view.querySelector('#settingsRootDefault'), null);
  assert.equal(view.querySelector('#settingsProjectsRootDefault'), null);
  // No visible hint text remains outside tooltips — the only .hint elements left
  // are the empty status lines (filled at runtime by JS).
  for (const hint of view.querySelectorAll('.hint')) {
    assert.equal(hint.textContent.trim(), '',
      `unexpected visible hint text: "${hint.textContent.trim().slice(0, 40)}"`);
  }
  assert.ok(view.querySelector('#settingsMsg'), 'settings status line stays');
  assert.ok(view.querySelector('#budgetMsg'), 'budget status line stays');
  assert.ok(view.querySelector('#budgetReadout'), 'spent readout stays');
  // Labels sit in .label-row wrappers so the icon rides beside the text.
  assert.ok(view.querySelector('.label-row > label[for="settingsRoot"]'));
  assert.ok(view.querySelector('.card-head .label-row > h2'), 'budget h2 wrapped with its icon');
});

test('style.css defines the info-tip icon and the floating bubble', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.info-tip{'), '.info-tip rule');
  assert.ok(css.includes('.info-bubble{'), '.info-bubble rule');
  assert.match(css, /\.info-bubble\{[^}]*position:fixed/, 'bubble is viewport-positioned');
  assert.match(css, /\.info-bubble\{[^}]*z-index:70/, 'bubble on the established tooltip layer');
  assert.ok(css.includes('.label-row{'), '.label-row rule');
});

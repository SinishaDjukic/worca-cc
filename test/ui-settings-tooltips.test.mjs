// test/ui-settings-tooltips.test.mjs
// Settings view: gray helper text lives in ⓘ info-tip tooltips, not visible hints.
// Structure here; hover/focus behavior in the "behavior" tests added with the
// app.js wiring (Task 2 of the settings-tooltips plan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));

const settingsView = () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  return dom.window.document.querySelector('.view[data-view="settings"]');
};

test('settings: eleven info-tip icons, each with non-empty tip content', () => {
  const view = settingsView();
  const tips = [...view.querySelectorAll('button.info-tip')];
  assert.equal(tips.length, 11, 'eleven ⓘ icons (2 folder fields, budget heading, 3 budget fields, ask heading, 2 ask fields, chat history, spawn diagnostics)');
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
  // `.card h2`'s later 18px bottom margin wins the specificity tie against
  // `.card-head h2` — inside the flex row that sinks the ⓘ below the heading.
  assert.match(css, /\.label-row > h2\{margin:0;\}/, 'budget h2 sheds its bottom margin inside the flex row');
  // The deleted disclaimer hint used to separate the readout from the fields.
  assert.match(css, /\.budget-readout\{[^}]*margin-bottom:24px/, 'spend readout keeps a section gap below it');
});

async function boot({ fetchHandler } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url, opts) => {
    if (fetchHandler) { const r = fetchHandler(String(url), opts || {}); if (r) return r; }
    if (String(url).includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch {}
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  return { window };
}

const fire = (window, target, type, Ctor = 'Event') =>
  target.dispatchEvent(new window[Ctor](type, { bubbles: true }));

test('hovering an info icon shows the shared bubble with that icon HTML; leaving hides it', async () => {
  const { window } = await boot();
  const doc = window.document;
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(doc.querySelector('.info-bubble'), null, 'no bubble until first hover');

  const rootTip = doc.querySelector('button.info-tip[aria-label="About Worca CC root folder"]');
  fire(window, rootTip, 'mouseover');
  let bubble = doc.querySelector('.info-bubble');
  assert.ok(bubble, 'bubble created on hover');
  assert.equal(bubble.getAttribute('role'), 'tooltip');
  assert.ok(!bubble.classList.contains('hidden'), 'bubble visible');
  assert.match(bubble.textContent.replace(/\s+/g, ' '), /does not move existing data/);
  assert.ok(bubble.querySelector('code'), 'HTML formatting carried into the bubble');

  fire(window, rootTip, 'mouseout');
  assert.ok(doc.querySelector('.info-bubble').classList.contains('hidden'), 'hidden on mouseout');

  // A second icon reuses the same bubble with new content.
  const budgetTip = doc.querySelector('button.info-tip[aria-label="About budget costs"]');
  fire(window, budgetTip, 'mouseover');
  bubble = doc.querySelector('.info-bubble');
  assert.equal(doc.querySelectorAll('.info-bubble').length, 1, 'one shared bubble');
  assert.match(bubble.textContent, /not authoritative billing/);
});

test('keyboard: focus shows the bubble, Escape and blur hide it', async () => {
  const { window } = await boot();
  const doc = window.document;
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  const tip = doc.querySelector('button.info-tip[aria-label="About Reset period"]');
  fire(window, tip, 'focusin');
  const bubble = doc.querySelector('.info-bubble');
  assert.ok(bubble && !bubble.classList.contains('hidden'), 'focus shows bubble');
  assert.match(bubble.textContent, /Times are local/);

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(bubble.classList.contains('hidden'), 'Escape hides bubble');

  fire(window, tip, 'focusin');
  assert.ok(!bubble.classList.contains('hidden'), 're-shown on focus');
  fire(window, tip, 'focusout');
  assert.ok(bubble.classList.contains('hidden'), 'blur hides bubble');
});

test('focusin associates the icon with the bubble via aria-describedby; Escape/focusout clears it', async () => {
  const { window } = await boot();
  const doc = window.document;
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  const rootTip = doc.querySelector('button.info-tip[aria-label="About Worca CC root folder"]');
  assert.ok(!rootTip.hasAttribute('aria-describedby'), 'no association before focus');

  fire(window, rootTip, 'focusin');
  assert.equal(rootTip.getAttribute('aria-describedby'), 'info-bubble', 'icon points at the bubble');
  const bubble = doc.getElementById('info-bubble');
  assert.ok(bubble, 'the id the icon points at resolves to the bubble');
  assert.ok(!bubble.classList.contains('hidden'), 'the described bubble is visible');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.ok(!rootTip.hasAttribute('aria-describedby'), 'Escape clears the association');

  fire(window, rootTip, 'focusin');
  assert.equal(rootTip.getAttribute('aria-describedby'), 'info-bubble', 're-focus restores it');
  fire(window, rootTip, 'focusout');
  assert.ok(!rootTip.hasAttribute('aria-describedby'), 'focusout clears the association');

  // Moving focus straight to a different icon (no intervening blur) hands the
  // association off instead of leaving it stuck on the icon that lost focus.
  fire(window, rootTip, 'focusin');
  const budgetTip = doc.querySelector('button.info-tip[aria-label="About budget costs"]');
  fire(window, budgetTip, 'focusin');
  assert.ok(!rootTip.hasAttribute('aria-describedby'), 'previous icon released');
  assert.equal(budgetTip.getAttribute('aria-describedby'), 'info-bubble', 'new icon takes over');
});

test('navigating away from Settings hides the info bubble (showView leave-guard)', async () => {
  const { window } = await boot();
  const doc = window.document;
  window.location.hash = 'settings';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  const rootTip = doc.querySelector('button.info-tip[aria-label="About Worca CC root folder"]');
  fire(window, rootTip, 'focusin');
  const bubble = doc.querySelector('.info-bubble');
  assert.ok(bubble && !bubble.classList.contains('hidden'), 'bubble visible while still on Settings');
  assert.equal(rootTip.getAttribute('aria-describedby'), 'info-bubble');

  window.location.hash = 'new';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise((r) => setTimeout(r, 0));

  assert.ok(bubble.classList.contains('hidden'), 'bubble hidden after leaving Settings');
  assert.ok(!rootTip.hasAttribute('aria-describedby'), 'association cleared on the way out too');
});

test('loadSettings has no dead references to the removed Default: hint elements', () => {
  const app = readFileSync(appPath, 'utf8');
  assert.ok(!app.includes('settingsRootDefault'), 'el.settingsRootDefault gone');
  assert.ok(!app.includes('settingsProjectsRootDefault'), 'el.settingsProjectsRootDefault gone');
});

// test/ui-settings-about.test.mjs
// Settings ▸ About card: version (linked to its release tag) + repo link, painted
// from the `app` block of GET /api/settings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const htmlPath = fileURLToPath(new URL('../ui/public/index.html', import.meta.url));
const cssPath = fileURLToPath(new URL('../ui/public/style.css', import.meta.url));
const appPath = fileURLToPath(new URL('../ui/public/app.js', import.meta.url));
const pkg = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'));

// package.json repository.url in browsable form (same normalisation as ui/server.mjs).
const REPO_URL = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
// U+2014: what index.html's `&mdash;` placeholder parses to.
const EM_DASH = '\u2014';

// Fixture `app` values; deliberately not package.json's so painted and static states differ.
const PAINTED_VERSION = '9.9.9-test';
const PAINTED_REPO_URL = 'https://example.com/acme/widget';
const PAINTED_REPO_TEXT = 'example.com/acme/widget';
const PAINTED_RELEASE_URL = 'https://example.com/acme/widget/releases/tag/worca-app-v9.9.9-test';

const DAY = 86400000;
const okBudget = () => ({
  pipelineLimitUsd: null, totalLimitUsd: null, resetPeriod: 'monthly',
  windowStartMs: Date.now() - 3 * DAY, windowEndMs: Date.now() + 4 * DAY,
  msUntilReset: 4 * DAY, windowSpendUsd: 0, allTimeSpendUsd: 0,
  remainingUsd: null, blocked: false,
});

// GET /api/settings as the real route answers it, `app` included. Keep `chat: {}`:
// loadSettings hands it to paintChatSettings un-awaited, so a throw there fails the file.
const okSettings = () => ({
  root: '', projectsRoot: '', projectsRootDefault: '/home/me', default: '/home/me',
  pipelineCostLimitUsd: null, totalCostLimitUsd: null, costLimitResetPeriod: 'monthly',
  askMaxTurns: 40, askMaxBudgetUsd: 2, chat: {},
  app: { version: PAINTED_VERSION, repoUrl: PAINTED_REPO_URL, releaseUrl: PAINTED_RELEASE_URL },
});

const settingsView = () => {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  return dom.window.document.querySelector('.view[data-view="settings"]');
};

async function boot({ settings = okSettings } = {}) {
  const dom = new JSDOM(readFileSync(htmlPath, 'utf8'), { url: 'http://localhost:4317/' });
  const { window } = dom;
  window.Element.prototype.scrollIntoView = function () {};
  window.WebSocket = class { constructor() { this.readyState = 1; } send() {} close() {} addEventListener() {} };
  window.fetch = (url) => {
    const u = String(url);
    if (u.includes('/api/settings'))
      return Promise.resolve({ ok: true, status: 200, json: async () => settings() });
    if (u.includes('/api/budget'))
      return Promise.resolve({ ok: true, status: 200, json: async () => okBudget() });
    if (u.includes('/api/projects'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ projects: [] }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ config: { steps: {}, customModels: [] }, models: [], efforts: [] }) });
  };
  for (const k of ['window', 'document', 'location', 'localStorage', 'WebSocket', 'fetch', 'navigator']) {
    try { Object.defineProperty(globalThis, k, { value: window[k], configurable: true, writable: true }); } catch { /* keep */ }
  }
  globalThis.window = window; globalThis.document = window.document;
  await import(pathToFileURL(appPath).href + `?b=${Date.now()}_${Math.random()}`);
  await new Promise((r) => setTimeout(r, 0));
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const $ = (sel) => window.document.querySelector(sel);
  const openSettings = async () => {
    window.location.hash = 'settings';
    window.dispatchEvent(new window.Event('hashchange'));
    await tick();
  };
  return { window, tick, $, openSettings };
}

test('About is the LAST settings card, read-only, with no version baked into the markup', () => {
  const view = settingsView();
  const cards = [...view.querySelectorAll('section.card.settings-card')];
  const about = cards[cards.length - 1];
  assert.equal(cards.length, 7, 'the six existing cards plus About');
  assert.equal(about.id, 'about-card', 'About sits after the Chat notifications card');
  assert.equal(about.querySelector('.label-row > h2').textContent.trim(), 'About');

  assert.equal(about.querySelector('input, select, textarea, button'), null, 'no controls');
  assert.equal(about.querySelector('.hint'), null, 'no status line (nothing saves)');

  assert.ok(!/\d+\.\d+\.\d+/.test(about.textContent), 'no version string in the markup');
  const version = about.querySelector('#aboutVersion');
  assert.equal(version.textContent.trim(), EM_DASH, 'placeholder only');
  // The version is an anchor so paint can link it to its release tag, but the
  // placeholder must never be clickable: no href until the payload supplies one.
  assert.equal(version.tagName, 'A');
  assert.equal(version.hasAttribute('href'), false, 'placeholder carries no href');
  assert.equal(version.getAttribute('target'), '_blank');
  assert.equal(version.getAttribute('rel'), 'noopener noreferrer');

  // The two existing settings-view invariants stay intact (ui-settings-tooltips).
  assert.equal(view.querySelectorAll('button.info-tip').length, 12, 'About adds no ⓘ icon');
  for (const hint of view.querySelectorAll('.hint')) assert.equal(hint.textContent.trim(), '');
});

test('the repo link opens in a new tab, safely, at the package.json repository', () => {
  const link = settingsView().querySelector('#aboutRepoLink');
  assert.ok(link, 'About card has a repo link');
  assert.equal(link.tagName, 'A');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  // The static pre-paint href must track package.json.
  assert.equal(link.getAttribute('href'), REPO_URL);
});

test('opening Settings paints the version and repo link from the server payload', async () => {
  const { $, openSettings } = await boot();
  await openSettings();
  // None of these values is in index.html, so each line fails if paintAbout stops running.
  assert.equal($('#aboutVersion').textContent.trim(), PAINTED_VERSION, 'version painted from the payload');
  assert.equal($('#aboutVersion').getAttribute('href'), PAINTED_RELEASE_URL, 'version links to its release tag');
  assert.equal($('#aboutRepoLink').getAttribute('href'), PAINTED_REPO_URL, 'href painted from the payload');
  assert.equal($('#aboutRepoLink').textContent.trim(), PAINTED_REPO_TEXT, 'link text is the URL without its scheme');
  assert.equal($('#aboutRepoLink').getAttribute('target'), '_blank', 'paint never drops target');
  assert.equal($('#aboutRepoLink').getAttribute('rel'), 'noopener noreferrer', 'paint never drops rel');
});

test('a payload with no `app` block leaves the static fallback alone (never blanks the card)', async () => {
  const noApp = () => { const s = okSettings(); delete s.app; return s; };
  const { $, openSettings } = await boot({ settings: noApp });
  await openSettings();
  assert.equal($('#aboutVersion').textContent.trim(), EM_DASH, 'placeholder kept, not emptied');
  assert.equal($('#aboutVersion').hasAttribute('href'), false, 'placeholder still unlinked');
  assert.equal($('#aboutRepoLink').getAttribute('href'), REPO_URL, 'static href kept');
  // Without paintAbout's `if (!info) return` the throw would abort every later paint.
  assert.equal($('#settingsMsg').textContent.trim(), '', 'the rest of the settings paint still ran');
});

test('malformed `repoUrl`/`releaseUrl` cannot abort the rest of the settings paint', async () => {
  const badUrl = () => ({ ...okSettings(), app: { version: PAINTED_VERSION, repoUrl: 42, releaseUrl: null } });
  const { $, openSettings } = await boot({ settings: badUrl });
  await openSettings();
  assert.equal($('#settingsMsg').textContent.trim(), '', 'no throw reached the loadSettings catch');
  assert.equal($('#aboutRepoLink').getAttribute('href'), REPO_URL, 'static href kept');
  assert.equal($('#aboutVersion').textContent.trim(), PAINTED_VERSION, 'the usable part still painted');
  assert.equal($('#aboutVersion').hasAttribute('href'), false, 'no release link without a usable URL');
});

test('style.css styles the About rows', () => {
  const css = readFileSync(cssPath, 'utf8');
  assert.ok(css.includes('.about-row{'), '.about-row rule');
  assert.ok(css.includes('.about-key{'), '.about-key rule');
  assert.ok(css.includes('.about-val{'), '.about-val rule');
  assert.ok(css.includes('.about-version{'), '.about-version rule');
  assert.ok(css.includes('.about-link{'), '.about-link rule');
  assert.ok(css.includes('.about-version[href]{'), 'the painted version reads as a link');
  // Same specificity on one anchor: .about-link must come after .about-val to win.
  assert.ok(css.indexOf('.about-val{') < css.indexOf('.about-link{'),
    '.about-link must stay after .about-val');
});

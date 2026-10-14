// test/extension-settings-view.test.mjs — Settings → General → "Browser extension" renderer
// (ui/public/extension-settings-view.mjs): the paired list with a Revoke button each, the empty and
// remote-mode states, and the pair-code / browser-label helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExtensionPairings, formatPairCode, browserLabel, renderExtensionInstall, selectInstallBrowser, detectBrowser } from '../ui/public/extension-settings-view.mjs';

const { document } = new JSDOM('<!doctype html><body></body>').window;
test('lists paired extensions with a Revoke button each', () => {
  const el = renderExtensionPairings({ remoteMode: false, paired: [{ id: 'ext_1', name: 'Worca for Chrome', browser: 'chrome', origin: 'chrome-extension://abcdefghijklmnop', createdAt: '2026-10-13T10:00:00Z', lastUsedAt: null }], pending: [] }, { doc: document });
  assert.equal(el.querySelectorAll('.xp-row').length, 1);
  assert.equal(el.querySelector('[data-revoke]').dataset.revoke, 'ext_1');
  assert.match(el.textContent, /Chrome/);
});
test('empty and remote-mode states', () => {
  assert.match(renderExtensionPairings({ paired: [], pending: [] }, { doc: document }).textContent, /No browser extension is paired/);
  assert.match(renderExtensionPairings({ remoteMode: true }, { doc: document }).textContent, /local Worca only/);
});
test('helpers', () => { assert.equal(formatPairCode('482913'), '482 913'); assert.equal(browserLabel('firefox'), 'Firefox'); });

const INSTALL = (over = {}) => ({
  remoteMode: false, version: '1.12.0', releaseUrl: 'https://github.com/acme/worca/releases/tag/worca-app-v1.12.0', buildCommand: 'npm run ext:build',
  builds: ['chrome', 'edge', 'firefox'].map((b) => ({ browser: b, present: true, path: `/opt/worca/extension/dist/${b}`, version: '1.12.0', steps: [`step for ${b}`], downloadUrl: `https://github.com/acme/worca/releases/download/worca-app-v1.12.0/worca-${b}-1.12.0.zip` })),
  ...over,
});
const visible = (el) => [...el.querySelectorAll('[data-xi-panel]')].filter((p) => !p.hidden).map((p) => p.dataset.xiPanel);

test('install: three tabs, the detected browser open, its path, Copy path, steps, version and release links', () => {
  const el = renderExtensionInstall(INSTALL(), { doc: document, browser: 'edge' });
  assert.deepEqual([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent), ['Chrome', 'Edge', 'Firefox']);
  assert.deepEqual(visible(el), ['edge']);
  const panel = el.querySelector('#xi-panel-edge');
  assert.equal(panel.querySelector('.xi-path').textContent, '/opt/worca/extension/dist/edge');
  assert.equal(panel.querySelector('[data-copy-path]').dataset.copyPath, '/opt/worca/extension/dist/edge');
  assert.equal(panel.querySelector('.xi-steps li').textContent, 'step for edge');
  assert.match(panel.querySelector('.xi-meta').textContent, /Version 1\.12\.0/);
  const links = [...panel.querySelectorAll('a.xi-link')];
  assert.equal(links[0].getAttribute('href'), 'https://github.com/acme/worca/releases/download/worca-app-v1.12.0/worca-edge-1.12.0.zip');
  assert.equal(links[1].getAttribute('href'), 'https://github.com/acme/worca/releases/tag/worca-app-v1.12.0');
  assert.ok(links.every((a) => a.target === '_blank' && /noopener/.test(a.rel)));
  assert.equal(el.querySelector('#xi-tab-edge').getAttribute('aria-selected'), 'true');
  assert.match(el.querySelector('#xi-panel-firefox .xi-meta').textContent, /unsigned/);
});

test('install: selectInstallBrowser switches the panel and the tab state', () => {
  const el = renderExtensionInstall(INSTALL(), { doc: document, browser: 'chrome' });
  selectInstallBrowser(el, 'firefox');
  assert.deepEqual(visible(el), ['firefox']);
  assert.ok(el.querySelector('#xi-tab-firefox').classList.contains('on'));
  assert.equal(el.querySelector('#xi-tab-chrome').getAttribute('aria-selected'), 'false');
});

test('install: no build → says so and shows npm run ext:build, no Copy path', () => {
  const data = INSTALL();
  data.builds = data.builds.map((b) => ({ ...b, present: false, version: null }));
  const el = renderExtensionInstall(data, { doc: document, browser: 'chrome' });
  assert.match(el.querySelector('#xi-panel-chrome').textContent, /No packaged build was found/);
  assert.equal(el.querySelector('#xi-panel-chrome .xi-cmd').textContent, 'npm run ext:build');
  assert.equal(el.querySelector('[data-copy-path]'), null);
});

test('install: hosted Worca shows no server path; a wrong-shaped answer renders an error, not a throw', () => {
  const data = INSTALL({ remoteMode: true });
  data.builds = data.builds.map((b) => ({ ...b, path: null }));
  const el = renderExtensionInstall(data, { doc: document });
  assert.equal(el.querySelector('.xi-path'), null);
  assert.match(el.textContent, /hosted/);
  assert.match(renderExtensionInstall({ config: {} }, { doc: document }).textContent, /Could not load the packaged browser extension/);
  assert.match(renderExtensionInstall(null, { doc: document }).textContent, /Could not load/);
});

test('detectBrowser', () => {
  assert.equal(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0'), 'edge');
  assert.equal(detectBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0'), 'firefox');
  assert.equal(detectBrowser('Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/130.0 Safari/537.36'), 'chrome');
  assert.equal(detectBrowser(''), 'chrome');
});

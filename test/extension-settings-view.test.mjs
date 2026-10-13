// test/extension-settings-view.test.mjs — Settings → General → "Browser extension" renderer
// (ui/public/extension-settings-view.mjs): the paired list with a Revoke button each, the empty and
// remote-mode states, and the pair-code / browser-label helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderExtensionPairings, formatPairCode, browserLabel } from '../ui/public/extension-settings-view.mjs';

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

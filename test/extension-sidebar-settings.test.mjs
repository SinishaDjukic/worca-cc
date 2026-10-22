// test/extension-sidebar-settings.test.mjs — the sidebar's Settings (the real sidebar.mjs in jsdom): retries
// and phase changes never reset the panel; only Save does. The theme selector is gone: the sidebar follows the browser.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { bootSidebar, stopSidebar, ok, OFFLINE } from './helpers/sidebar-harness.mjs';

afterEach(stopSidebar);
const DEAD = 'http://127.0.0.1:4999';
const hellos = (h) => h.paths().filter((p) => p === '/api/extension/hello').length;

/** Open the panel, type an address, focus the input with the caret inside it. */
function typeInto(h, text, caret) {
  const details = h.$('details.wx-settings');
  details.open = true;
  const input = h.doc.getElementById('wx-base-url');
  input.value = text;
  input.focus();
  input.setSelectionRange(caret, caret);
  return { details, input };
}

test('offline retries never collapse Settings or drop the typed address, focus or caret', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE });
  assert.ok(h.$('.wx-offline'), 'the offline screen shows');
  const { details, input } = typeInto(h, 'http://127.0.0.1:51', 9);
  const before = hellos(h);
  for (let i = 0; i < 3; i++) await h.tick(5000);
  assert.ok(hellos(h) >= before + 3, 'the offline retry keeps probing');
  assert.equal(h.$('details.wx-settings'), details, 'the same panel, never rebuilt');
  assert.ok(details.isConnected && details.open, 'still open');
  assert.equal(h.doc.getElementById('wx-base-url'), input);
  assert.equal(input.value, 'http://127.0.0.1:51');
  assert.equal(h.doc.activeElement, input, 'focus survives');
  assert.equal(input.selectionStart, 9, 'the caret survives');
});

test('a phase change (offline → Connect) keeps the panel too', async () => {
  let up = false;
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: (p) => (up && p === '/api/extension/hello' ? ok({ ok: true }) : OFFLINE) });
  const { details, input } = typeInto(h, 'http://localhost:7', 4);
  up = true;
  await h.tick(5000);
  assert.ok(h.$('.wx-unpaired'), 'now the Connect screen');
  assert.equal(h.$('details.wx-settings'), details);
  assert.ok(details.open);
  assert.equal(input.value, 'http://localhost:7');
  assert.equal(h.doc.activeElement, input);
});

test('the panel: the Pinpoint option, a labelled "Worca address" row, a compact Save, the hint, and no theme select', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE });
  const details = h.$('details.wx-settings');
  assert.equal(details.querySelector('summary').textContent, 'Settings');
  const body = details.querySelector('.wx-settings-body');
  assert.ok(body.firstElementChild.matches('label.wx-settings-check'), 'the Pinpoint option comes first');
  assert.equal(body.firstElementChild.textContent.trim(), 'Show Pinpoint when I select text');
  assert.equal(h.doc.getElementById('wx-pinpoint-select').checked, false, 'off by default');
  assert.equal(details.querySelector('.wx-pin-hint').textContent, 'Off: select text, then press the Pinpoint shortcut (Alt+Shift+W).');
  assert.equal(h.$('label[for="wx-base-url"]').textContent, 'Worca address');
  const input = h.doc.getElementById('wx-base-url');
  assert.equal(input.value, DEAD);
  const row = input.closest('.wx-settings-row');
  assert.ok(row, 'input and Save share one row');
  const save = row.querySelector('button');
  assert.equal(save.textContent, 'Save');
  assert.ok(save.classList.contains('btn-sm'), 'worca\'s compact button size');
  assert.equal(details.querySelector('.hint:not(.wx-pin-hint)').textContent, 'Only 127.0.0.1 or localhost. Saving forgets the pairing.');
  assert.equal(details.querySelector('select'), null, 'no theme select');
  assert.equal(h.$('[aria-label="Theme"]'), null);
});

test('Save stores the normalised address, resets the input to it, forgets the token and probes it', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD, 'worca.token': 'tok', 'worca.pairedId': 'ext_1' }, route: () => OFFLINE });
  const { input } = typeInto(h, ' http://localhost:5001/x ', 3);
  await h.click(h.$('.wx-settings-row button'));
  assert.equal(h.store['worca.baseUrl'], 'http://localhost:5001');
  assert.equal(h.store['worca.token'], undefined);
  assert.equal(h.store['worca.pairedId'], undefined);
  assert.equal(input.value, 'http://localhost:5001', 'Save resets the input to the stored value');
  assert.ok(h.calls.some((c) => c === 'GET http://localhost:5001/api/extension/hello'), 'probes the new address');
});

test('an invalid address: a validation message, nothing stored', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE });
  const { input } = typeInto(h, 'https://example.com', 0);
  await h.click(h.$('.wx-settings-row button'));
  assert.equal(h.store['worca.baseUrl'], DEAD);
  assert.match(input.validationMessage, /127\.0\.0\.1|localhost/);
  input.value = 'http://localhost:1';
  input.dispatchEvent(new h.win.Event('input', { bubbles: true }));
  assert.equal(input.validationMessage, '', 'typing clears the message');
});

test('a stale stored worca.theme has no effect and is cleared on startup; hello carries no theme', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD, 'worca.theme': 'dark' }, route: () => OFFLINE });
  assert.equal(h.doc.documentElement.dataset.theme, 'system');
  assert.ok(!('worca.theme' in h.store), 'cleared');
  const hello = h.posted.find((m) => m.type === 'hello');
  assert.ok(hello);
  assert.ok(!('theme' in hello));
});

test('no theme plumbing is left: no theme message between sidebar, background and content, no data-theme on the Pinpoint host', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['extension/src/background.mjs', 'extension/src/content/content.mjs', 'extension/src/sidebar/sidebar.mjs']) {
    const src = readFileSync(f, 'utf8');
    assert.doesNotMatch(src, /type: 'theme'|=== 'theme'|STORAGE_KEYS\.theme|setAttribute\('data-theme'/, f);
  }
  assert.doesNotMatch(readFileSync('extension/src/content/shadow.css', 'utf8'), /data-theme/);
  const { STORAGE_KEYS } = await import('../extension/src/ext-api.mjs');
  assert.ok(!('theme' in STORAGE_KEYS));
});

test('the Pinpoint option: stored on change, read back on boot; the hint names the shortcut as the user bound it', async () => {
  const h = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE });
  const box = h.doc.getElementById('wx-pinpoint-select');
  box.checked = true;
  box.dispatchEvent(new h.win.Event('change', { bubbles: true }));
  await h.flush();
  assert.equal(h.store['worca.pinpointOnSelect'], true);
  stopSidebar();
  const h2 = await bootSidebar({ storage: { 'worca.baseUrl': DEAD, 'worca.pinpointOnSelect': true }, route: () => OFFLINE });
  assert.equal(h2.doc.getElementById('wx-pinpoint-select').checked, true);
  stopSidebar();
  const h3 = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE, commands: [{ name: 'worca-pinpoint', shortcut: 'Ctrl+Shift+Y' }] });
  assert.equal(h3.$('.wx-pin-hint').textContent, 'Off: select text, then press the Pinpoint shortcut (Ctrl+Shift+Y).');
  stopSidebar();
  const h4 = await bootSidebar({ storage: { 'worca.baseUrl': DEAD }, route: () => OFFLINE, commands: [{ name: 'worca-pinpoint', shortcut: '' }] });
  assert.match(h4.$('.wx-pin-hint').textContent, /set a Pinpoint shortcut/);
});

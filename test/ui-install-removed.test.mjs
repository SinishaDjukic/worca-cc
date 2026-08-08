// test/ui-install-removed.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const html = readFileSync(fileURLToPath(new URL('../ui/public/index.html', import.meta.url)), 'utf8');
const appJs = readFileSync(fileURLToPath(new URL('../ui/public/app.js', import.meta.url)), 'utf8');

test('index.html: Install agents button is removed', () => {
  assert.ok(!html.includes('id="install-btn"'), 'install button #install-btn still present');
  assert.ok(!html.includes('Install agents'), '"Install agents" label still present');
});

test('index.html: sidebar footer survives; WS status indicator is removed', () => {
  assert.ok(html.includes('class="side-foot"'), '.side-foot footer was wrongly removed');
  assert.ok(!html.includes('id="ws-dot"'), 'WS status dot still present');
  assert.ok(!html.includes('id="ws-label"'), 'WS status label still present');
});

test('app.js: WS status indicator wiring is removed', () => {
  assert.ok(!appJs.includes('setWsStatus'), 'setWsStatus still present');
  assert.ok(!appJs.includes('wsDot'), 'wsDot DOM ref still present');
  assert.ok(!appJs.includes('wsLabel'), 'wsLabel DOM ref still present');
});

test('app.js: install button client wiring is removed', () => {
  assert.ok(!appJs.includes('installBtn'), 'installBtn DOM ref / handler still present');
  assert.ok(!appJs.includes("'/api/install'"), 'client still calls /api/install');
});

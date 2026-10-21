// test/ui-release-row.test.mjs — Shaper s4: the release row ("+ Add a release" → "Release v1.12.0 · draft after merge · Edit").
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderReleaseRow } from '../ui/public/shape/release-row.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };
const TAG = { version: 'v1.12.0', from: 'tag', lastTag: 'v1.11.0', packageVersion: null };
const lineOf = (el) => el.querySelector('.release-row-text').textContent + el.querySelector('.release-row-edit').textContent;
const mount = (hint) => { const doc = docOf(); const row = renderReleaseRow(doc, hint); doc.body.appendChild(row.el); return row; };

test('collapsed: "Add a release" (a quiet small button with the plus icon), and check() sends nothing', () => {
  const row = mount(TAG);
  const add = row.el.querySelector('.release-row-add');
  assert.equal(add.textContent, 'Add a release');
  assert.ok(add.classList.contains('btn') && add.classList.contains('btn-sm') && add.classList.contains('btn-quiet'));
  assert.equal(add.querySelectorAll('.ic').length, 1, 'run 4 D15: the plus icon, no typed "+"');
  assert.ok(row.el.hasAttribute('data-release-row'));
  assert.deepEqual(row.check(), { ok: true, value: null });
});

test('expanded with a tag hint: the version line and its source; check() sends the version', () => {
  const row = mount(TAG);
  row.el.querySelector('.release-row-add').click();
  assert.equal(lineOf(row.el), 'Release v1.12.0 · draft after merge · Edit');
  assert.equal(row.el.querySelector('.release-row-source').textContent, 'Last tag v1.11.0 + minor');
  assert.deepEqual(row.check(), { ok: true, value: { version: 'v1.12.0' } });
});

test('a package.json hint names its source', () => {
  const row = mount({ version: 'v1.4.0', from: 'package', lastTag: null, packageVersion: '1.4.0' });
  row.el.querySelector('.release-row-add').click();
  assert.equal(lineOf(row.el), 'Release v1.4.0 · draft after merge · Edit');
  assert.equal(row.el.querySelector('.release-row-source').textContent, 'From package.json 1.4.0');
});

test('no hint: an input; an invalid value is refused with the hint line; Enter commits a valid one', () => {
  const row = mount(null);
  row.el.querySelector('.release-row-add').click();
  const input = row.el.querySelector('.release-row-input');
  assert.ok(input);
  assert.equal(row.el.querySelector('.release-row-source').textContent, 'No tag or package.json version: type one');
  assert.deepEqual(row.check(), { ok: false });
  input.value = 'v1';
  assert.deepEqual(row.check(), { ok: false });
  assert.equal(row.el.querySelector('.release-row-err').textContent, 'Use a version like v1.12.0');
  input.value = 'v2.0.0';
  input.dispatchEvent(new input.ownerDocument.defaultView.KeyboardEvent('keydown', { key: 'Enter' }));
  assert.equal(lineOf(row.el), 'Release v2.0.0 · draft after merge · Edit');
  assert.equal(row.el.querySelector('.release-row-err').textContent, '');
});

test('Edit: the input holds the version; setHint after expanding changes nothing, before expanding it is taken', () => {
  const row = mount(TAG);
  row.el.querySelector('.release-row-add').click();
  row.setHint({ version: 'v9.0.0', from: 'tag', lastTag: 'v8.9.0', packageVersion: null });
  assert.equal(lineOf(row.el), 'Release v1.12.0 · draft after merge · Edit');
  row.el.querySelector('.release-row-edit').click();
  assert.equal(row.el.querySelector('.release-row-input').value, 'v1.12.0');
  const late = mount(null);
  late.setHint(TAG);
  late.el.querySelector('.release-row-add').click();
  assert.equal(lineOf(late.el), 'Release v1.12.0 · draft after merge · Edit');
});

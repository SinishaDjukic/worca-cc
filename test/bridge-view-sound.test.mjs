// test/bridge-view-sound.test.mjs
// The Providers tab's Sound (Design) row: its place after Image generation, SPEC §7's words, no head, intro or badge
// of its own, the one key field (a password field the broker rule hides), collectSoundRow's PATCH body, and its CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderSoundRow, collectSoundRow } from '../ui/public/bridge-view.mjs';
import { renderProvidersTab } from '../ui/public/models/providers-tab.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const SO = { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••cdef', keyMissing: false, configured: true };
const row = (tab) => tab.querySelector('.mv-pv-row[data-provider="sound"]');
const key = (tab) => row(tab).querySelector('.mv-pv-key');

test('the row comes right after Image generation', () => {
  const tab = renderProvidersTab({ sound: SO }, { doc });
  assert.deepEqual([...tab.querySelectorAll('.mv-pv-row')].map((r) => r.dataset.provider), ['copilot', 'openrouter', 'openai', 'anthropic', 'speech', 'images', 'sound']);
  assert.ok(row(tab).classList.contains('mv-so-row') && row(tab).closest('.mv-pv-card'), 'a divided row of its own');
});

test('the field label, the placeholder and the buttons are SPEC §7\'s words; the tab\'s row head carries the name', () => {
  const r = renderSoundRow({ sound: SO }, { doc });
  assert.equal(r.querySelector('.mv-head, .mv-name'), null, 'no head in the body');
  assert.doesNotMatch(r.textContent, /Gives a Design video a voice and music through ElevenLabs/, 'no intro');
  assert.deepEqual([...r.querySelectorAll('.mv-field-label')].map((l) => l.textContent), ['ElevenLabs API key']);
  assert.equal(r.querySelector('.mv-pv-key').placeholder, 'sk_…');
  assert.deepEqual([...r.querySelectorAll('.mv-pv-btns button')].map((b) => [b.className, b.textContent]), [['btn mv-so-test', 'Test'], ['btn btn-primary mv-so-save', 'Save']]);
  const result = r.querySelector('.mv-pv-main > .mv-so-result');
  assert.deepEqual([result.tagName, result.classList.contains('hint'), result.hidden, result.getAttribute('role'), result.textContent], ['SMALL', true, true, 'status', '']);
  assert.ok(r.querySelector('.mv-pv-main > .mv-pv-msg'), 'the status line a refused Test clears');
});

test('no badge in the row in any state: the tab\'s row head shows it', () => {
  for (const so of [{}, { keySet: true, keyMissing: true }, { keySet: true, configured: true }, undefined, { keyMissing: true }]) {
    assert.equal(renderSoundRow(so === undefined ? {} : { sound: so }, { doc }).querySelector('.badge'), null, JSON.stringify(so));
  }
});

test('the key field: a password field with the stored ref or mask, in a .mv-field the broker rule hides; the buttons are the card\'s actions', () => {
  const tab = renderProvidersTab({ sound: SO }, { doc });
  const k = key(tab);
  assert.deepEqual([k.className, k.type, k.getAttribute('autocomplete'), k.value], ['input mv-pv-key', 'password', 'off', '••••••cdef']);
  assert.equal(key(renderProvidersTab({ sound: { ...SO, keyRef: '${ELEVEN_KEY}' } }, { doc })).value, '${ELEVEN_KEY}', 'a ${VAR} reference shows as itself');
  assert.equal(key(renderProvidersTab({}, { doc })).value, '');
  assert.ok(k.closest('label.mv-field').classList.contains('mv-so-key') && k.closest('.mv-pv-ctl'));
  const actions = row(tab).querySelector('.mv-pv-btns[data-card-actions]');
  assert.deepEqual([...actions.children].map((b) => b.className), ['btn mv-so-test', 'btn btn-primary mv-so-save']);
  const brokered = renderProvidersTab({ sound: SO, broker: { enabled: true } }, { doc });
  assert.ok(key(brokered).closest('.mv-providers').classList.contains('mv-providers--broker') && key(brokered).closest('.mv-field'), 'hidden by .mv-providers--broker .mv-field:has(.mv-pv-key)');
  assert.ok(row(brokered).querySelector('.mv-so-test') && !row(brokered).querySelector('.mv-pv-test'), 'the Test stays');
});

test('collectSoundRow: {} for an untouched key (masked or empty), the trimmed text for a typed one, \'\' for a cleared one, null without the row', () => {
  const tab = renderProvidersTab({ sound: SO }, { doc });
  assert.deepEqual(collectSoundRow(tab), {});
  assert.deepEqual(collectSoundRow(renderProvidersTab({}, { doc })), {}, 'an untouched empty field sends nothing');
  key(tab).value = '  sk_typed_key  ';
  assert.deepEqual(collectSoundRow(tab), { apiKey: 'sk_typed_key' });
  key(tab).value = '';
  assert.deepEqual(collectSoundRow(tab), { apiKey: '' });
  assert.equal(collectSoundRow(doc.createElement('div')), null);
});

test('collectSoundRow on the row\'s own body: {} while the key is untouched, { apiKey } once typed', () => {
  const r = renderSoundRow({ sound: SO }, { doc });
  assert.ok(r.matches('.mv-pv-row.mv-so-row[data-provider="sound"]'));
  assert.deepEqual(collectSoundRow(r), {});
  r.querySelector('.mv-pv-key').value = 'sk_new';
  assert.deepEqual(collectSoundRow(r), { apiKey: 'sk_new' });
  assert.deepEqual(collectSoundRow(renderSoundRow(null, { doc })), {}, 'no payload: an empty, untouched field');
});

test('the CSS: the Test result hides while [hidden] (.hint is display:block), and the key column stacks under 560px', () => {
  const css = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');
  assert.match(css, /\.mv-so-result\[hidden\]\{display:none;\}/);
  assert.match(css, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row\.mv-so-row \.mv-pv-ctl\{grid-template-columns:minmax\(0,1fr\);\}\s*\}/);
});

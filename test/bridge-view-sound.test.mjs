// test/bridge-view-sound.test.mjs
// The Providers card's Sound (Design) row: its place after Image generation, SPEC §7's words, the three badges,
// the one key field (a password field the broker rule hides), collectSoundRow's PATCH body, and its CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderProvidersCard, collectSoundRow } from '../ui/public/bridge-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const SO = { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••cdef', keyMissing: false, configured: true };
const row = (card) => card.querySelector('.mv-pv-row[data-provider="sound"]');
const key = (card) => row(card).querySelector('.mv-pv-key');

test('the row comes right after Image generation', () => {
  const card = renderProvidersCard({ sound: SO }, { doc, split: true });
  assert.deepEqual([...card.querySelectorAll('.mv-pv-row')].map((r) => r.dataset.provider), ['copilot', 'openai', 'anthropic', 'speech', 'images', 'sound']);
  assert.ok(row(card).classList.contains('mv-so-row') && row(card).closest('.mv-pv-card'), 'a divided row of its own');
});

test('the name, the sentence, the field label, the placeholder and the buttons are SPEC §7\'s words', () => {
  const r = row(renderProvidersCard({ sound: SO }, { doc, split: true }));
  assert.equal(r.querySelector('.mv-head .mv-name').textContent, 'Sound (Design)');
  assert.equal(r.querySelector('.mv-pv-main > .hint').textContent, 'Gives a Design video a voice and music through ElevenLabs. The key stays on this machine.');
  assert.deepEqual([...r.querySelectorAll('.mv-field-label')].map((l) => l.textContent), ['ElevenLabs API key']);
  assert.equal(r.querySelector('.mv-pv-key').placeholder, 'sk_…');
  assert.deepEqual([...r.querySelectorAll('.mv-pv-btns button')].map((b) => [b.className, b.textContent]), [['btn mv-so-test', 'Test'], ['btn btn-primary mv-so-save', 'Save']]);
  const result = r.querySelector('.mv-pv-main > .mv-so-result');
  assert.deepEqual([result.tagName, result.classList.contains('hint'), result.hidden, result.getAttribute('role'), result.textContent], ['SMALL', true, true, 'status', '']);
  assert.ok(r.querySelector('.mv-pv-main > .mv-pv-msg'), 'the status line a refused Test clears');
});

test('the badge: not set up, key missing, ready; no sound in the state is not set up', () => {
  const badge = (so) => row(renderProvidersCard(so === undefined ? {} : { sound: so }, { doc })).querySelector('.mv-head .badge');
  const read = (so) => [badge(so).className, badge(so).textContent];
  assert.deepEqual(read({}), ['badge grey', 'not set up']);
  assert.deepEqual(read({ keySet: true, keyMissing: true }), ['badge red', 'key missing']);
  assert.deepEqual(read({ keySet: true, configured: true }), ['badge green', 'ready']);
  assert.deepEqual(read(undefined), ['badge grey', 'not set up']);
  assert.deepEqual(read({ keyMissing: true }), ['badge grey', 'not set up'], 'no key set is not set up first');
});

test('the key field: a password field with the stored ref or mask, in a .mv-field the broker rule hides; the buttons are the card\'s actions', () => {
  const card = renderProvidersCard({ sound: SO }, { doc, split: true });
  const k = key(card);
  assert.deepEqual([k.className, k.type, k.getAttribute('autocomplete'), k.value], ['input mv-pv-key', 'password', 'off', '••••••cdef']);
  assert.equal(key(renderProvidersCard({ sound: { ...SO, keyRef: '${ELEVEN_KEY}' } }, { doc })).value, '${ELEVEN_KEY}', 'a ${VAR} reference shows as itself');
  assert.equal(key(renderProvidersCard({}, { doc })).value, '');
  assert.ok(k.closest('label.mv-field').classList.contains('mv-so-key') && k.closest('.mv-pv-ctl'));
  const actions = row(card).querySelector('.mv-pv-btns[data-card-actions]');
  assert.deepEqual([...actions.children].map((b) => b.className), ['btn mv-so-test', 'btn btn-primary mv-so-save']);
  const brokered = renderProvidersCard({ sound: SO, broker: { enabled: true } }, { doc });
  assert.ok(brokered.classList.contains('mv-providers--broker') && key(brokered).closest('.mv-field'), 'hidden by .mv-providers--broker .mv-field:has(.mv-pv-key)');
  assert.ok(row(brokered).querySelector('.mv-so-test') && !row(brokered).querySelector('.mv-pv-test'), 'the Test stays');
});

test('collectSoundRow: {} for an untouched key (masked or empty), the trimmed text for a typed one, \'\' for a cleared one, null without the row', () => {
  const card = renderProvidersCard({ sound: SO }, { doc });
  assert.deepEqual(collectSoundRow(card), {});
  assert.deepEqual(collectSoundRow(renderProvidersCard({}, { doc })), {}, 'an untouched empty field sends nothing');
  key(card).value = '  sk_typed_key  ';
  assert.deepEqual(collectSoundRow(card), { apiKey: 'sk_typed_key' });
  key(card).value = '';
  assert.deepEqual(collectSoundRow(card), { apiKey: '' });
  assert.equal(collectSoundRow(doc.createElement('div')), null);
});

test('the CSS: the Test result hides while [hidden] (.hint is display:block), and the key column stacks under 560px', () => {
  const css = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');
  assert.match(css, /\.mv-so-result\[hidden\]\{display:none;\}/);
  assert.match(css, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row\.mv-so-row \.mv-pv-ctl\{grid-template-columns:minmax\(0,1fr\);\}\s*\}/);
});

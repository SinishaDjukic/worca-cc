// test/bridge-view-openrouter-row.test.mjs
// The OpenRouter row on the Providers tab (models-menu P2, Task 6): its place after Copilot, its badge, its fields
// and what Save collects from them, the OpenAI-compatible row without its old preset, and providerRowOf, which
// sends a catalogue Sign in to the row that holds the model's key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderProvidersCard, collectOpenRouterRow, providerRowOf } from '../ui/public/bridge-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const OR_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER = { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••1234', legacyKey: false, maxConcurrent: 4, order: ['anthropic', 'google'], sort: 'price', allowFallbacks: false };
const state = (openrouter = OPENROUTER, extra = {}) => ({
  copilot: {}, openai: { baseUrl: 'https://api.openai.com/v1' }, anthropic: {}, speech: {}, images: {}, sound: {},
  broker: { enabled: false }, openrouter, ...extra,
});
const orRow = (card) => card.querySelector('.mv-pv-row[data-provider="openrouter"]');
const badge = (card) => orRow(card).querySelector('.mv-head .badge');

test('the OpenRouter row sits after Copilot, and draws from defaults when the payload has no block', () => {
  const card = renderProvidersCard(state(), { doc, split: true });
  assert.deepEqual([...card.querySelectorAll('.mv-pv-row')].map((r) => r.dataset.provider),
    ['copilot', 'openrouter', 'openai', 'anthropic', 'speech', 'images', 'sound']);
  const row = orRow(card);
  assert.ok(row.classList.contains('mv-or-row'));
  assert.ok(row.closest('.mv-pv-card'), 'a divided row of its own on the tab');
  assert.equal(row.querySelector('.mv-name').textContent, 'OpenRouter');
  assert.ok(row.querySelector('.mv-pv-main small.hint.mv-pv-msg'), 'the status line is in the main column');
  const bare = renderProvidersCard(null, { doc });
  assert.equal(bare.querySelectorAll('.mv-pv-row').length, 7);
  assert.equal(badge(bare).textContent, 'no key');
  assert.deepEqual(collectOpenRouterRow(bare), { maxConcurrent: 8, order: [], sort: '', allowFallbacks: true });
});

test('the row shows the stored settings, and Save collects them (the key only when it changed)', () => {
  const card = renderProvidersCard(state(), { doc, split: true });
  doc.body.replaceChildren(card);
  const row = orRow(card);
  const key = row.querySelector('label.mv-field input.input.mv-pv-key[data-provider="openrouter"]');
  assert.equal(key.value, '••••••1234');
  assert.equal(key.placeholder, 'sk-…, or ${VAR} to read your shell env');
  assert.equal(row.querySelector('.mv-pv-conc[data-provider="openrouter"]').value, '4');
  assert.equal(row.querySelector('input.input.mv-or-order').value, 'anthropic, google');
  const sort = row.querySelector('select.select.mv-or-sort');
  assert.equal(sort.value, 'price');
  assert.deepEqual([...sort.options].map((o) => [o.value, o.textContent]),
    [['', 'OpenRouter default'], ['price', 'Price'], ['throughput', 'Throughput'], ['latency', 'Latency']]);
  const fb = row.querySelector('.mv-or-fallbacks');
  assert.ok(fb.matches('input.sw-input') && fb.checked === false);
  assert.equal(fb.closest('label').querySelector('.switch-label').textContent, 'Allow other providers when these are unavailable');
  const btns = row.querySelector('.mv-pv-btns[data-card-actions]');
  assert.deepEqual([...btns.querySelectorAll('button')].map((b) => [b.className, b.textContent, b.dataset.provider]), [
    ['btn mv-or-browse', 'Import models…', 'openrouter'],
    ['btn mv-pv-test', 'Test connection', 'openrouter'],
    ['btn btn-primary mv-pv-save', 'Save', 'openrouter'],
  ]);
  assert.deepEqual(collectOpenRouterRow(card), { maxConcurrent: 4, order: ['anthropic', 'google'], sort: 'price', allowFallbacks: false });
  key.value = '';
  row.querySelector('.mv-or-order').value = ' xai ,';
  assert.deepEqual(collectOpenRouterRow(row), { apiKey: '', maxConcurrent: 4, order: ['xai'], sort: 'price', allowFallbacks: false });
  assert.equal(collectOpenRouterRow(renderProvidersCard(state(), { doc }).querySelector('.mv-pv-row[data-provider="copilot"]')), null);
  // An empty key field is "untouched" too: its original is '' (set even then), so a typed key is the change.
  const empty = renderProvidersCard(state({ ...OPENROUTER, keySet: false, keySource: null, keyMasked: null }), { doc, split: true });
  const emptyKey = orRow(empty).querySelector('.mv-pv-key');
  assert.equal(emptyKey.dataset.original, '');
  assert.equal('apiKey' in collectOpenRouterRow(empty), false);
  emptyKey.value = 'sk-or-new';
  orRow(empty).querySelector('.mv-pv-conc').value = '';
  assert.deepEqual(collectOpenRouterRow(empty), { apiKey: 'sk-or-new', maxConcurrent: '', order: ['anthropic', 'google'], sort: 'price', allowFallbacks: false });
});

test('the badge says where the key comes from', () => {
  assert.equal(badge(renderProvidersCard(state(), { doc })).textContent, 'key set');
  const lent = badge(renderProvidersCard(state({ ...OPENROUTER, legacyKey: true }), { doc }));
  assert.equal(lent.textContent, 'key from OpenAI-compatible');
  assert.ok(lent.classList.contains('green'));
  const unset = badge(renderProvidersCard(state({ ...OPENROUTER, keySet: false, keySource: 'env', keyRef: '${OPENROUTER_KEY}', keyMasked: null }), { doc }));
  assert.equal(unset.textContent, 'key ${OPENROUTER_KEY} not set');
  assert.ok(unset.classList.contains('red'));
  const none = badge(renderProvidersCard(state({ ...OPENROUTER, keySet: false, keySource: null, keyMasked: null }), { doc }));
  assert.equal(none.textContent, 'no key');
  assert.ok(none.classList.contains('grey'));
  const brokered = renderProvidersCard(state(OPENROUTER, { broker: { enabled: true, keyPage: 'https://keys.example/', providers: {} } }), { doc });
  const pill = orRow(brokered).querySelector('.mv-head .mv-broker-pill');
  assert.ok(pill, 'with the broker, the broker pill');
  assert.equal(pill.textContent, 'add your key on the key page');
});

test('the OpenAI-compatible row keeps its fields and its import, without the OpenRouter preset', () => {
  const card = renderProvidersCard(state(), { doc, split: true });
  assert.equal(card.querySelector('.mv-pv-preset'), null);
  assert.equal(card.querySelector('.mv-pv-presets'), null);
  const row = card.querySelector('.mv-pv-row[data-provider="openai"]');
  assert.equal(row.querySelector('.mv-pv-baseurl').value, 'https://api.openai.com/v1');
  assert.ok(row.querySelector('.mv-pv-key'));
  assert.ok(row.querySelector('.mv-pv-conc'));
  assert.equal(row.querySelector('.mv-pv-browse').textContent, 'Import models…');
});

test('providerRowOf: the row that holds a model\'s key', () => {
  const onOR = { openai: { baseUrl: OR_BASE } };
  const local = { openai: { baseUrl: 'http://127.0.0.1:11434/v1' } };
  assert.equal(providerRowOf({ upstream: { provider: 'openai', model: 'a/b' } }, onOR), 'openrouter');
  assert.equal(providerRowOf({ upstream: { provider: 'openai', model: 'a/b', baseUrl: 'http://127.0.0.1:11434/v1' } }, onOR), 'openai');
  assert.equal(providerRowOf({ upstream: { provider: 'copilot', model: 'gpt-5' } }, onOR), 'copilot');
  assert.equal(providerRowOf({ id: 'plain' }, onOR), null);
  assert.equal(providerRowOf(null, onOR), null);
  assert.equal(providerRowOf({ upstream: { provider: 'openai', model: 'a/b', baseUrl: OR_BASE } }, local), 'openrouter');
  assert.equal(providerRowOf({ upstream: { provider: 'openai', model: 'a/b' } }, local), 'openai');
  assert.equal(providerRowOf({ upstream: { provider: 'openai', model: 'a/b' } }, null), 'openai');
});

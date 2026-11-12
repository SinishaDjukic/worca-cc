// test/bridge-view-images.test.mjs
// The Providers card's Image generation row (Design pictures): its fields and grid, the service presets
// (a stored key never follows a switch to another address; the saved values come back on switching back),
// collectImagesRow's PATCH body, the Test answer and a refused Save in the row itself, the Settings search entry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderProvidersCard, applyImagesPreset, collectImagesRow, showImagesTest, showImagesSaveError } from '../ui/public/bridge-view.mjs';
import { ADDON_ENTRIES } from '../ui/public/settings-index.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;

const IM = { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04, configured: true, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••abcd', keyMissing: false };
const row = (card) => card.querySelector('.mv-pv-row[data-provider="images"]');
const field = (card, k) => row(card).querySelector(`.mv-im-field[data-field="${k}"]`);
test('the row comes after Speech: name, sentence, badge, labels, services, buttons', () => {
  const card = renderProvidersCard({ images: IM }, { doc, split: true });
  assert.deepEqual([...card.querySelectorAll('.mv-pv-row')].map((r) => r.dataset.provider), ['copilot', 'openai', 'anthropic', 'speech', 'images']);
  const r = row(card);
  assert.equal(r.querySelector('.mv-name').textContent, 'Image generation (Design)');
  assert.equal(r.querySelector('.mv-pv-main > .hint').textContent, 'Lets a Design lead have a picture made when no real one fits. The key stays on this machine.');
  assert.deepEqual([...r.querySelectorAll('.mv-field-label')].map((l) => l.textContent), ['Service', 'Base URL', 'Model', 'API key', 'Price per picture ($)']);
  assert.deepEqual([...field(card, 'service').options].map((o) => [o.value, o.textContent]), [['openai', 'OpenAI'], ['xai', 'xAI'], ['openrouter', 'OpenRouter'], ['other', 'Other (OpenAI-compatible)']]);
  assert.deepEqual([...r.querySelectorAll('.mv-pv-btns button')].map((b) => b.textContent), ['Test picture', 'Save']);
  const badge = (im) => row(renderProvidersCard({ images: im }, { doc })).querySelector('.mv-head .badge').textContent;
  assert.deepEqual([badge(IM), badge({ ...IM, configured: false, keyMissing: true }), badge({})], ['ready', 'key missing', 'not set up']);
  assert.equal(field(renderProvidersCard({}, { doc }), 'price').value, '0.04', 'nothing saved yet: the preset price is filled in');
});
test('the fields sit on a three-column grid of their own: Service · Base URL · Model, then API key over two columns · Price', () => {
  const r = row(renderProvidersCard({ images: IM }, { doc, split: true }));
  assert.ok(r.classList.contains('mv-im-row') && !r.classList.contains('mv-sp-row'), "not Speech's two columns");
  assert.ok(r.querySelector('.mv-im-field[data-field="apiKey"]').closest('.mv-field').classList.contains('mv-im-key'));
  const price = r.querySelector('.mv-im-field[data-field="price"]');
  assert.deepEqual([price.closest('.mv-field').classList.contains('mv-im-price'), price.type, price.getAttribute('inputmode')], [true, 'text', 'decimal']);
  const css = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');
  assert.match(css, /\.mv-pv-card \.mv-pv-row\.mv-im-row \.mv-pv-ctl\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\);/);
  assert.match(css, /\.mv-im-row \.mv-im-key\{grid-column:span 2;\}/);
  assert.match(css, /\.mv-im-row \.mv-im-price\{max-width:190px;\}/);
  assert.match(css, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row\.mv-im-row \.mv-pv-ctl\{grid-template-columns:minmax\(0,1fr\);\}\s*\.mv-im-row \.mv-im-key\{grid-column:auto;\}\s*\}/);
});
test('a refused Save shows in the row\'s own line, not the card\'s alert', () => {
  const card = renderProvidersCard({ images: IM }, { doc, split: true });
  showImagesSaveError(card, 'Enter a price; 0 for a free server');
  const line = row(card).querySelector('.mv-pv-msg');
  assert.deepEqual([line.textContent, line.classList.contains('err')], ['Enter a price; 0 for a free server', true]);
});
test('picking a service fills Base URL, Model and Price; a key for another address is not carried over', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  assert.equal(applyImagesPreset(card, 'xai'), true);
  assert.deepEqual(['baseUrl', 'model', 'price', 'apiKey'].map((k) => field(card, k).value), ['https://api.x.ai/v1', 'grok-imagine-image-2.0', '0.04', '']);
  applyImagesPreset(card, 'openai');
  assert.equal(field(card, 'apiKey').value, '••••••abcd', 'back on the stored address: the stored key again');
  applyImagesPreset(card, 'other');
  assert.deepEqual(['baseUrl', 'model', 'price'].map((k) => field(card, k).value), ['', '', '']);
});
test('collectImagesRow: an unchanged key is left out; edits, clears and the price are carried', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  assert.deepEqual(collectImagesRow(card), { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04 });
  field(card, 'apiKey').value = 'sk-new'; field(card, 'price').value = '';
  assert.deepEqual([collectImagesRow(card).apiKey, collectImagesRow(card).price], ['sk-new', '']);
});
test('the Test answer shows in the row: the picture and Made in, or the reason', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  assert.deepEqual([row(card).querySelector('.mv-im-result').hidden, row(card).querySelector('.mv-im-result').getAttribute('role')], [true, 'status']);
  showImagesTest(card, { ok: true, w: 1024, h: 1024, ms: 11_200, dataUrl: 'data:image/png;base64,AAAA' });
  assert.deepEqual([row(card).querySelector('.mv-im-shot').src, row(card).querySelector('.mv-im-made').textContent], ['data:image/png;base64,AAAA', 'Made in 11 s · 1024×1024']);
  showImagesTest(card, { ok: false, message: 'the image service rejected the key' });
  const line = row(card).querySelector('.mv-im-made');
  assert.deepEqual([line.textContent, line.classList.contains('err'), row(card).querySelector('.mv-im-shot').hidden], ['the image service rejected the key', true, true]);
});
test('with the broker the key field hides as Speech\'s does; the Test stays', () => {
  const card = renderProvidersCard({ images: IM, broker: { enabled: true } }, { doc });
  assert.ok(card.classList.contains('mv-providers--broker') && field(card, 'apiKey').classList.contains('mv-pv-key'));
  assert.ok(row(card).querySelector('.mv-im-test') && !row(card).querySelector('.mv-pv-test'));
});
test('the Settings search finds the row, and the page wires its buttons', () => {
  const e = ADDON_ENTRIES.find((x) => x.id === 'addon:providers/images');
  assert.deepEqual([e.title, e.href], ['Image generation (Design)', '#providers/images']);
  assert.deepEqual(e.alts, ['image', 'images', 'picture', 'pictures', 'image generation', 'gpt-image', 'grok']);
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  for (const re of [/mv-im-save[\s\S]{0,300}patchProviderFlow\('images'[\s\S]{0,200}onError:[\s\S]{0,80}showImagesSaveError/, /mv-im-test'\)\) testImagesFlow/, /mv-im-service'\)\) applyImagesPreset/]) assert.match(app, re);
});

test('a saved row with no address renders: its stored origin is empty, never a throw', () => {
  const card = renderProvidersCard({ images: { ...IM, service: 'other', baseUrl: '' } }, { doc });
  assert.equal(row(card).getAttribute('data-stored-origin'), '');
  assert.equal(field(card, 'service').value, 'other');
  const blank = renderProvidersCard({ images: { ...IM, baseUrl: '' } }, { doc });
  applyImagesPreset(blank, 'other');
  assert.equal(field(blank, 'apiKey').value, '', 'no address on either side is no shared origin');
});
test('applyImagesPreset: an unknown service is refused and changes nothing', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  assert.deepEqual([applyImagesPreset(card, 'nope'), applyImagesPreset(card, 'toString')], [false, false]);
  assert.deepEqual(['service', 'baseUrl', 'apiKey'].map((k) => field(card, k).value), ['openai', 'https://api.openai.com/v1', '••••••abcd']);
});
test('collectImagesRow: a price that is not a number goes as typed, for the server to refuse', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  field(card, 'price').value = ' free ';
  assert.equal(collectImagesRow(card).price, 'free');
});
test('a saved Other row: a price of 0 shows 0; another service empties the key; Other brings its own values back', () => {
  const card = renderProvidersCard({ images: { ...IM, service: 'other', baseUrl: 'http://127.0.0.1:7860/v1', model: 'sd', price: 0, keyMasked: '••••••wxyz' } }, { doc });
  assert.equal(field(card, 'price').value, '0');
  applyImagesPreset(card, 'openai');
  assert.equal(field(card, 'apiKey').value, '', 'the stored key is for another address');
  applyImagesPreset(card, 'other');
  assert.deepEqual(['baseUrl', 'model', 'price', 'apiKey'].map((k) => field(card, k).value), ['http://127.0.0.1:7860/v1', 'sd', '0', '••••••wxyz']);
});
test('a Test after a failed one shows its picture and a plain line again', () => {
  const card = renderProvidersCard({ images: IM }, { doc });
  showImagesTest(card, { ok: false, message: 'the image service rejected the key' });
  showImagesTest(card, { ok: true, w: 1024, h: 1024, ms: 11_200, dataUrl: 'data:image/png;base64,AAAA' });
  assert.deepEqual([row(card).querySelector('.mv-im-shot').hidden, row(card).querySelector('.mv-im-made').classList.contains('err')], [false, false]);
});
test('a refused Save is announced: the row\'s line is an alert', () => {
  const card = renderProvidersCard({ images: IM }, { doc, split: true });
  showImagesSaveError(card, 'Enter a price; 0 for a free server');
  assert.equal(row(card).querySelector('.mv-pv-msg').getAttribute('role'), 'alert');
});
test('the Price input is as narrow as the house\'s concurrency field', () => {
  const css = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');
  assert.match(css, /\.mv-im-row \.mv-im-price \.input\{max-width:120px;\}/);
});

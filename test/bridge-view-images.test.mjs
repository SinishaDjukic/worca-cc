// test/bridge-view-images.test.mjs
// The Image generation row (Design pictures): Service · Model · API key, then a preset service's Base URL and Price
// behind a folded "Advanced" (Other shows them openly, with the endpoint line); the model picked from the service's
// list or typed; the service presets (a stored key never follows a switch to another address; the saved values come
// back on switching back); collectImagesRow's PATCH body, imagesRowProblem's refusals, the Test answer and a refused
// Save in the row itself, the Settings search entry, and the row's CSS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { renderImagesRow, applyImagesPreset, collectImagesRow, imagesRowProblem, showImagesTest, showImagesSaveError } from '../ui/public/bridge-view.mjs';
import { renderProvidersTab } from '../ui/public/models/providers-tab.mjs';
import { icon } from '../ui/public/icons.mjs';
import { IMAGE_SERVICES } from '../src/shared/image-services.mjs';
import { ADDON_ENTRIES } from '../ui/public/settings-index.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;

const IM = { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04, configured: true, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••abcd', keyMissing: false };
const OTHER = { ...IM, service: 'other', baseUrl: 'http://localhost:8080/v1/', model: 'sd', price: 0, keyMasked: '••••••wxyz' };
/** The row body alone, drawn over a stored images block. */
const row = (im) => renderImagesRow({ images: im }, { doc });
const field = (r, k) => r.querySelector(`.mv-im-field[data-field="${k}"]`);
const disc = (r) => r.querySelector('.mdl-disc');
const adv = (r) => r.querySelector('.mdl-adv');
const pickEl = (r) => r.querySelector('.mv-im-model-pick');
const typedEl = (r) => r.querySelector('.mv-im-model');
const options = (sel) => [...sel.options].map((o) => [o.value, o.textContent]);
/** Pick a model the way a person does: the value, then a bubbling change. */
const pick = (r, value) => { const s = pickEl(r); s.value = value; s.dispatchEvent(new win.Event('change', { bubbles: true })); };
const ENDPOINT = (base) => `worca asks for a picture at POST ${base}/images/generations, the way OpenAI's API takes it.`;
const KEY_PH = 'sk-…, or ${VAR} to read your shell env';
const LOCAL_KEY_PH = 'Leave empty for a server on this machine';
const CSS = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');

test('the row comes after Speech: no name, sentence or badge of its own; labels, services, buttons', () => {
  const tab = renderProvidersTab({ images: IM }, { doc });
  assert.deepEqual([...tab.querySelectorAll('.mv-pv-row')].map((r) => r.dataset.provider), ['copilot', 'openrouter', 'openai', 'anthropic', 'speech', 'images', 'sound']);
  const r = tab.querySelector('.mv-pv-row[data-provider="images"]');
  assert.equal(r.querySelector('.mv-name, .mv-head'), null, 'no head: the tab\'s row head names it');
  assert.doesNotMatch(r.textContent, /Lets a Design lead have a picture made/, 'no intro');
  assert.deepEqual([...r.querySelectorAll('.mv-field-label')].map((l) => l.textContent), ['Service', 'Model', 'API key', 'Base URL', 'Price per picture ($)']);
  assert.deepEqual(options(field(r, 'service')), [['openai', 'OpenAI'], ['xai', 'xAI'], ['openrouter', 'OpenRouter'], ['other', 'Other (OpenAI-compatible)']]);
  assert.deepEqual([...r.querySelectorAll('.mv-pv-btns button')].map((b) => b.textContent), ['Test picture', 'Save']);
  const badge = (im) => row(im).querySelector('.badge');
  assert.deepEqual([badge(IM), badge({ ...IM, configured: false, keyMissing: true }), badge({})], [null, null, null], 'no badge in the row');
  assert.equal(field(row({}), 'price').value, '0.04', 'nothing saved yet: the preset price is filled in');
});

test('the body reads fields, then the message and the Test answer, then the buttons; one grid of fields', () => {
  const r = row(IM);
  assert.ok(r.matches('div.mv-pv-row.mv-im-row[data-provider="images"]') && !r.classList.contains('mv-sp-row'), "not Speech's two columns");
  assert.deepEqual([...r.children].map((c) => c.className), ['mv-pv-ctl', 'mv-pv-main', 'mv-pv-btns']);
  assert.deepEqual([...r.querySelector('.mv-pv-main').children].map((c) => c.className), ['hint mv-pv-msg', 'mv-im-result']);
  assert.deepEqual([...r.querySelector('.mv-pv-ctl').children].map((c) => c.className), ['mv-field', 'mv-field mdl-model', 'mv-field mv-im-key', 'btn btn-quiet btn-sm mdl-disc', 'mdl-adv']);
  assert.deepEqual([...row(OTHER).querySelector('.mv-pv-ctl').children].map((c) => c.className), ['mv-field', 'mv-field mdl-model', 'mv-field mv-im-key', 'mv-field mv-im-baseurl', 'mv-field mv-im-price', 'hint mv-im-endpoint']);
  assert.ok(field(r, 'service').matches('select.input.mv-im-service'));
  const key = field(r, 'apiKey');
  assert.deepEqual([key.matches('input.input.mv-pv-key'), key.closest('.mv-field').matches('label.mv-field.mv-im-key'), key.placeholder], [true, true, KEY_PH]);
  const price = field(r, 'price');
  assert.deepEqual([price.closest('.mv-field').matches('label.mv-field.mv-im-price'), price.type, price.getAttribute('inputmode'), price.placeholder], [true, 'text', 'decimal', '0 for a free server']);
  assert.ok(field(r, 'baseUrl').closest('.mv-field').matches('label.mv-field.mv-im-baseurl'));
  // The model field's label names whichever control is drawn, by id: a label never holds the Pick from list button.
  const label = r.querySelector('.mdl-model > label.mv-field-label');
  assert.deepEqual([label.textContent, label.htmlFor], ['Model', pickEl(r).id]);
  const typed = row({ ...IM, model: 'my-own-image-model' });
  assert.equal(typed.querySelector('.mdl-model > label.mv-field-label').htmlFor, typedEl(typed).id);
  assert.ok(typedEl(typed).id);
});

test('a preset row: the model picked from the list, Base URL and Price folded under Advanced', () => {
  const r = row(IM);
  const sel = pickEl(r);
  assert.ok(sel.matches('select.select.mv-im-field.mv-im-model-pick[data-field="model"]'));
  assert.equal(sel.value, 'gpt-image-2.6-flare');
  const [def, ...rest] = IMAGE_SERVICES.openai.models;
  assert.deepEqual(options(sel), [[def, `${def} (default)`], ...rest.map((id) => [id, id]), ['__other__', 'Other model…']]);
  assert.equal(typedEl(r), null, 'one model control at a time');
  const d = disc(r);
  assert.deepEqual([d.tagName, d.className, d.type, d.textContent, d.getAttribute('aria-expanded')], ['BUTTON', 'btn btn-quiet btn-sm mdl-disc', 'button', 'Advanced', 'false']);
  assert.equal(d.firstElementChild.outerHTML, icon(doc, 'chevron', 14).outerHTML, 'the chevron icon, then the word');
  const a = adv(r);
  assert.ok(a.tagName === 'DIV' && a.id && a.hidden);
  assert.equal(d.getAttribute('aria-controls'), a.id);
  assert.ok(a.querySelector('.mv-im-baseurl') && a.querySelector('.mv-im-price'));
  assert.deepEqual(collectImagesRow(r), { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04 });
  // Toggled inline: no app.js arm is needed.
  d.click();
  assert.deepEqual([d.getAttribute('aria-expanded'), a.hidden], ['true', false]);
  d.click();
  assert.deepEqual([d.getAttribute('aria-expanded'), a.hidden], ['false', true]);
  // Two rows never share the region's id.
  assert.notEqual(adv(row(IM)).id, a.id);
});

test('empty stored values show the preset\'s, folded; a stored value that differs opens Advanced', () => {
  const blank = row({ ...IM, baseUrl: '', price: null });
  assert.deepEqual([field(blank, 'baseUrl').value, field(blank, 'price').value], ['https://api.openai.com/v1', '0.04']);
  assert.deepEqual([adv(blank).hidden, disc(blank).getAttribute('aria-expanded')], [true, 'false']);
  assert.deepEqual(collectImagesRow(blank), { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04 }, 'Save sends the preset values');
  assert.equal(pickEl(row({ ...IM, model: '' })).value, 'gpt-image-2.6-flare', 'no stored model: the default, as the server fills it');
  const proxy = row({ ...IM, baseUrl: 'https://proxy.example/v1' });
  assert.deepEqual([adv(proxy).hidden, disc(proxy).getAttribute('aria-expanded')], [false, 'true']);
  const dearer = row({ ...IM, price: 0.05 });
  assert.deepEqual([adv(dearer).hidden, disc(dearer).getAttribute('aria-expanded')], [false, 'true']);
  assert.equal(adv(row({ ...IM, price: 0.04 })).hidden, true, 'the preset\'s own price is no difference');
});

test('a model that is not in the list is typed; Pick from list brings the select back; Other model… types one', () => {
  const r = row({ ...IM, model: 'my-own-image-model' });
  doc.body.replaceChildren(r);
  const typed = typedEl(r);
  assert.ok(typed.matches('input.input.mv-im-field.mv-im-model[data-field="model"]'));
  assert.deepEqual([typed.value, typed.placeholder], ['my-own-image-model', 'Model id, as the service names it']);
  const back = r.querySelector('.mv-im-model-list');
  assert.deepEqual([back.tagName, back.className, back.type, back.textContent], ['BUTTON', 'btn btn-quiet btn-sm mv-im-model-list', 'button', 'Pick from list']);
  assert.equal(pickEl(r), null);
  assert.equal(collectImagesRow(r).model, 'my-own-image-model');
  back.click();
  assert.deepEqual([pickEl(r)?.value, typedEl(r), r.querySelector('.mv-im-model-list')], ['gpt-image-2.6-flare', null, null], 'the select, on the default');
  assert.equal(doc.activeElement, pickEl(r), 'the focus stays in the field');
  pick(r, '__other__');
  assert.equal(pickEl(r), null);
  assert.deepEqual([typedEl(r).value, doc.activeElement === typedEl(r), !!r.querySelector('.mv-im-model-list')], ['', true, true]);
  assert.equal(r.querySelectorAll('[data-field="model"]').length, 1, 'rebuilt, never hidden');
  assert.equal(collectImagesRow(r).model, '');
  // A listed id picked from the select stays picked.
  r.querySelector('.mv-im-model-list').click();
  pick(r, 'gpt-image-2.5-flare');
  assert.deepEqual([pickEl(r).value, collectImagesRow(r).model], ['gpt-image-2.5-flare', 'gpt-image-2.5-flare']);
  // "Other model…" left selected without its change event still collects as no model.
  pickEl(r).value = '__other__';
  assert.equal(collectImagesRow(r).model, '');
  doc.body.replaceChildren();
});

test('Other: Base URL and Price show openly with the endpoint line, the local key wording, a typed model', () => {
  const r = row(OTHER);
  assert.deepEqual([disc(r), adv(r)], [null, null]);
  assert.deepEqual([field(r, 'baseUrl').value, field(r, 'price').value], ['http://localhost:8080/v1/', '0']);
  const line = r.querySelector('small.hint.mv-im-endpoint');
  assert.equal(line.textContent, ENDPOINT('http://localhost:8080/v1'), 'no trailing slash');
  assert.equal(field(r, 'apiKey').placeholder, LOCAL_KEY_PH);
  assert.deepEqual([typedEl(r).value, pickEl(r), r.querySelector('.mv-im-model-list')], ['sd', null, null], 'an empty list: typed, nothing to pick from');
  const url = field(r, 'baseUrl');
  url.value = 'https://img.example/v2';
  url.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(line.textContent, ENDPOINT('https://img.example/v2'));
  url.value = '  ';
  url.dispatchEvent(new win.Event('input', { bubbles: true }));
  assert.equal(line.textContent, ENDPOINT('<Base URL>'));
  assert.deepEqual(collectImagesRow(row(OTHER)), { service: 'other', baseUrl: 'http://localhost:8080/v1/', model: 'sd', price: 0 });
});

test('OpenRouter has no default: the list starts with Pick a model, and a row without one is refused', () => {
  const r = row({ ...IM, service: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', model: '', price: 0.05 });
  const sel = pickEl(r);
  assert.deepEqual(options(sel), [['', 'Pick a model'], ...IMAGE_SERVICES.openrouter.models.map((id) => [id, id]), ['__other__', 'Other model…']]);
  assert.equal(sel.value, '');
  assert.equal(imagesRowProblem(r), 'Pick a model');
  pick(r, IMAGE_SERVICES.openrouter.models[1]);
  assert.equal(imagesRowProblem(r), '');
});

test('switching service: a key for another address is not carried; the default model; the saved row comes back', () => {
  const r = row({ ...IM, model: 'gpt-image-2.5-flare' });
  assert.equal(applyImagesPreset(r, 'xai'), true);
  assert.deepEqual(['baseUrl', 'model', 'price', 'apiKey'].map((k) => field(r, k).value), ['https://api.x.ai/v1', 'grok-imagine-image-2.0', '0.04', '']);
  assert.deepEqual([pickEl(r).value, options(pickEl(r))[0][1], adv(r).hidden], ['grok-imagine-image-2.0', 'grok-imagine-image-2.0 (default)', true]);
  assert.equal(r.querySelectorAll('.mdl-disc, .mdl-adv').length, 2, 'the fold is reused');
  applyImagesPreset(r, 'openai');
  assert.deepEqual([pickEl(r).value, field(r, 'apiKey').value], ['gpt-image-2.5-flare', '••••••abcd'], 'back on the saved service: its model and the stored key');
  applyImagesPreset(r, 'other');
  assert.deepEqual([disc(r), adv(r), !!r.querySelector('.mv-im-endpoint')], [null, null, true], 'Base URL and Price show openly');
  assert.deepEqual(['baseUrl', 'model', 'price', 'apiKey'].map((k) => field(r, k).value), ['', '', '', '']);
  assert.deepEqual([field(r, 'baseUrl').closest('.mdl-adv'), field(r, 'apiKey').placeholder, r.querySelector('.mv-im-endpoint').textContent], [null, LOCAL_KEY_PH, ENDPOINT('<Base URL>')]);
  applyImagesPreset(r, 'openrouter');
  assert.deepEqual([r.querySelector('.mv-im-endpoint'), adv(r).hidden, disc(r).getAttribute('aria-expanded'), field(r, 'apiKey').placeholder], [null, true, 'false', KEY_PH]);
  assert.deepEqual([pickEl(r).value, field(r, 'baseUrl').value, field(r, 'price').value], ['', 'https://openrouter.ai/api/v1', '0.05'], 'no default: Pick a model');
  assert.ok(adv(r).contains(field(r, 'baseUrl')) && adv(r).contains(field(r, 'price')));
  assert.equal(r.querySelectorAll('.mdl-disc, .mdl-adv').length, 2, 'one fold, never a second');
});

test('switching back restores a typed model as typed and reopens Advanced over a stored address of its own', () => {
  const typed = row({ ...IM, model: 'my-own-image-model' });
  applyImagesPreset(typed, 'xai');
  applyImagesPreset(typed, 'openai');
  assert.deepEqual([typedEl(typed)?.value, pickEl(typed)], ['my-own-image-model', null], 'an id not in the list stays a typed id');
  const proxy = row({ ...IM, baseUrl: 'https://proxy.example/v1' });
  applyImagesPreset(proxy, 'xai');
  assert.deepEqual([adv(proxy).hidden, disc(proxy).getAttribute('aria-expanded')], [true, 'false'], 'another service: its own values, folded');
  applyImagesPreset(proxy, 'openai');
  assert.deepEqual([field(proxy, 'baseUrl').value, adv(proxy).hidden, disc(proxy).getAttribute('aria-expanded')], ['https://proxy.example/v1', false, 'true']);
});

test('imagesRowProblem: the address, the model and the price, in that order; a valid row has none', () => {
  const other = (patch) => row({ ...OTHER, ...patch });
  for (const baseUrl of ['', 'localhost:8080/v1', 'http://local host/v1', 'ftp://x']) assert.equal(imagesRowProblem(other({ baseUrl })), 'Enter the address, starting with http:// or https://', baseUrl);
  assert.equal(imagesRowProblem(other({ model: '' })), 'Enter a model', 'the typed input is shown');
  assert.equal(imagesRowProblem(other({ price: null })), 'Enter a price; 0 for a free server');
  assert.equal(imagesRowProblem(other({ baseUrl: '', model: '', price: null })), 'Enter the address, starting with http:// or https://');
  assert.equal(imagesRowProblem(other({ model: '', price: null })), 'Enter a model');
  assert.equal(imagesRowProblem(row(OTHER)), '');
  assert.equal(imagesRowProblem(row(IM)), '');
  assert.equal(imagesRowProblem(row({ ...IM, price: null })), '', 'a preset fills its own price');
  const r = row(IM);
  pick(r, '__other__');
  assert.equal(imagesRowProblem(r), 'Enter a model');
  r.querySelector('.mv-im-model-list').click();
  assert.equal(imagesRowProblem(r), '');
  // The tab holds the row: the tab works as the root, as every collector's does.
  assert.equal(imagesRowProblem(renderProvidersTab({ images: { ...OTHER, price: null } }, { doc })), 'Enter a price; 0 for a free server');
});

test('a refused Save shows in the row\'s own line, announced, and opens Advanced', () => {
  const tab = renderProvidersTab({ images: IM }, { doc });
  showImagesSaveError(tab, 'Enter a price; 0 for a free server');
  const r = tab.querySelector('.mv-pv-row[data-provider="images"]');
  const line = r.querySelector('.mv-pv-msg');
  assert.deepEqual([line.textContent, line.classList.contains('err'), line.getAttribute('role')], ['Enter a price; 0 for a free server', true, 'alert']);
  assert.deepEqual([adv(r).hidden, disc(r).getAttribute('aria-expanded')], [false, 'true'], 'a server refusal can name a field inside it');
  const other = row(OTHER);
  showImagesSaveError(other, 'Enter a model');
  assert.equal(other.querySelector('.mv-pv-msg').textContent, 'Enter a model', 'Other has no fold to open');
});

test('collectImagesRow: an unchanged key is left out; edits, clears and the price are carried', () => {
  const r = row(IM);
  field(r, 'apiKey').value = 'sk-new'; field(r, 'price').value = '';
  assert.deepEqual([collectImagesRow(r).apiKey, collectImagesRow(r).price], ['sk-new', '']);
  field(r, 'price').value = ' free ';
  assert.equal(collectImagesRow(r).price, 'free', 'not a number: as typed, for the server to refuse');
  assert.equal(collectImagesRow(doc.createElement('div')), null);
});

test('the Test answer shows in the row: the picture and Made in, or the reason; a pass after a failure is plain again', () => {
  const tab = renderProvidersTab({ images: IM }, { doc });
  const r = tab.querySelector('.mv-pv-row[data-provider="images"]');
  assert.deepEqual([r.querySelector('.mv-im-result').hidden, r.querySelector('.mv-im-result').getAttribute('role')], [true, 'status']);
  showImagesTest(tab, { ok: true, w: 1024, h: 1024, ms: 11_200, dataUrl: 'data:image/png;base64,AAAA' });
  assert.deepEqual([r.querySelector('.mv-im-shot').src, r.querySelector('.mv-im-made').textContent], ['data:image/png;base64,AAAA', 'Made in 11 s · 1024×1024']);
  showImagesTest(tab, { ok: false, message: 'the image service rejected the key' });
  const line = r.querySelector('.mv-im-made');
  assert.deepEqual([line.textContent, line.classList.contains('err'), r.querySelector('.mv-im-shot').hidden], ['the image service rejected the key', true, true]);
  showImagesTest(tab, { ok: true, w: 1024, h: 1024, ms: 11_200, dataUrl: 'data:image/png;base64,AAAA' });
  assert.deepEqual([r.querySelector('.mv-im-shot').hidden, line.classList.contains('err')], [false, false]);
});

test('with the broker the key field hides as Speech\'s does; the Test stays', () => {
  const tab = renderProvidersTab({ images: IM, broker: { enabled: true } }, { doc });
  const r = tab.querySelector('.mv-pv-row[data-provider="images"]');
  assert.ok(r.closest('.mv-providers').classList.contains('mv-providers--broker') && field(r, 'apiKey').classList.contains('mv-pv-key'));
  assert.ok(r.querySelector('.mv-im-test') && !r.querySelector('.mv-pv-test'));
});

test('the Settings search finds the row, and the page wires its buttons; Save asks imagesRowProblem first', () => {
  const e = ADDON_ENTRIES.find((x) => x.id === 'addon:providers/images');
  assert.deepEqual([e.title, e.href], ['Image generation (Design)', '#models/providers/images']);
  assert.deepEqual(e.alts, ['image', 'images', 'picture', 'pictures', 'image generation', 'gpt-image', 'grok', 'providers']);
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  for (const re of [
    /mv-im-save[\s\S]{0,300}patchProviderFlow\('images'[\s\S]{0,200}onError:[\s\S]{0,80}showImagesSaveError/,
    /mv-im-save'\)\)[\s\S]{0,120}const problem = imagesRowProblem\(providerRoot\(\)\);\s*if \(problem\) showImagesSaveError\(providerRoot\(\), problem\);\s*else patchProviderFlow\('images'/,
    /mv-im-test'\)\) testImagesFlow/,
    /mv-im-service'\)\) applyImagesPreset/,
  ]) assert.match(app, re);
});

test('a saved row with no address renders: its stored origin is empty, never a throw', () => {
  const r = row({ ...IM, service: 'other', baseUrl: '' });
  assert.equal(r.getAttribute('data-stored-origin'), '');
  assert.equal(field(r, 'service').value, 'other');
  const blank = row({ ...IM, baseUrl: '' });
  applyImagesPreset(blank, 'other');
  assert.equal(field(blank, 'apiKey').value, '', 'no address on either side is no shared origin');
});

test('applyImagesPreset: an unknown service is refused and changes nothing', () => {
  const r = row(IM);
  assert.deepEqual([applyImagesPreset(r, 'nope'), applyImagesPreset(r, 'toString')], [false, false]);
  assert.deepEqual(['service', 'baseUrl', 'apiKey', 'model'].map((k) => field(r, k).value), ['openai', 'https://api.openai.com/v1', '••••••abcd', 'gpt-image-2.6-flare']);
  assert.ok(disc(r) && adv(r).hidden);
});

test('a saved Other row: a price of 0 shows 0; another service empties the key; Other brings its own values back', () => {
  const r = row({ ...OTHER, baseUrl: 'http://127.0.0.1:7860/v1' });
  assert.equal(field(r, 'price').value, '0');
  applyImagesPreset(r, 'openai');
  assert.equal(field(r, 'apiKey').value, '', 'the stored key is for another address');
  applyImagesPreset(r, 'other');
  assert.deepEqual(['baseUrl', 'model', 'price', 'apiKey'].map((k) => field(r, k).value), ['http://127.0.0.1:7860/v1', 'sd', '0', '••••••wxyz']);
  assert.equal(r.querySelector('.mv-im-endpoint').textContent, ENDPOINT('http://127.0.0.1:7860/v1'));
});

test('the CSS: Service · Model · API key, the fold and its region on the same grid, Base URL over two columns · Price, the endpoint line, one column when narrow', () => {
  const block = CSS.slice(CSS.indexOf('/* Image generation'), CSS.indexOf('/* Sound (Design)'));
  const rules = [
    '.mv-pv-card .mv-pv-row.mv-im-row .mv-pv-ctl,.mv-im-row .mdl-adv{grid-template-columns:minmax(0,1fr) minmax(0,1.5fr) minmax(0,1fr);gap:10px 14px;align-items:start;}',
    '.mv-im-row .mdl-adv{display:grid;grid-column:1/-1;}',
    '.mv-im-row .mdl-disc{grid-column:1/-1;justify-self:start;}',
    '.mv-im-row .mv-im-baseurl{grid-column:span 2;}',
    '.mv-im-row .mv-im-price{max-width:190px;}',
    '.mv-im-row .mv-im-price .input{max-width:120px;}',
    '.mv-im-row .mv-im-endpoint{grid-column:1/-1;margin:0;}',
    '.mdl-model-typed{display:flex;gap:6px;align-items:center;min-width:0;}',
    '.mdl-model-typed .input{flex:1 1 auto;min-width:0;}',
    '.mv-im-model-list{flex:none;}',
  ];
  for (const rule of rules) assert.ok(block.includes(`\n${rule}\n`), rule);
  assert.match(block, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row\.mv-im-row \.mv-pv-ctl,\.mv-im-row \.mdl-adv\{grid-template-columns:minmax\(0,1fr\);\}\s*\.mv-im-row \.mv-im-baseurl\{grid-column:auto;\}\s*\}/);
  assert.doesNotMatch(block, /\.mv-im-key\{grid-column/, 'the key no longer spans two columns');
  assert.doesNotMatch(block, /\.mdl-disc[^{]*\{[^}]*\b(?:height|transform|transition)\b/, 'the button keeps .btn-sm\'s height; the chevron turn is the tab\'s');
  // The house rules for the bridge's earlier lines stay where they were.
  assert.match(CSS, /@container drows \(max-width:560px\)\{\s*\.mv-pv-card \.mv-pv-row:not\(\.mv-sp-row\) \.mv-pv-ctl\{grid-template-columns:minmax\(0,1fr\);\}\s*\}/);
  assert.match(CSS, /\.mv-pv-card \.mv-pv-row\.mv-so-row \.mv-pv-ctl\{grid-template-columns:minmax\(0,2fr\) minmax\(0,1fr\);/);
});

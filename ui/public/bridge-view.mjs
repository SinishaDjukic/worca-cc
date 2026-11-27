// ui/public/bridge-view.mjs
// Pure DOM renderers for the model bridge (model-bridge-design.md §8): the
// Providers tab's row bodies (models/providers-tab.mjs folds them), the Copilot sign-in block, the import sheets
// (GitHub Copilot's and an endpoint's) and the model form's Connection section.
// Same contract as models-view.mjs: every function takes `doc` via
// opts and returns DETACHED elements; app.js owns endpoint calls, mounting
// and the delegated listeners. Interactive elements carry a routing class
// (mv-cp-*, mv-pv-*, mv-or-*, mvi-*, mv-conn-*) plus data-provider / data-id.

import { icon } from './icons.mjs';
import { copyButton, copyFromButton } from './copy-button.mjs';
import { makeSwitch } from './switch.mjs';
import { codexReaches, runsOnText } from '../../src/shared/connections.mjs';
import { SIGN_IN_ENGINE_NAMES } from '../../src/shared/engine-switch.mjs';
import { IMAGE_SERVICES, originOf, pictureSeconds } from '../../src/shared/image-services.mjs';
import { markedSelect, modelMark } from './models/brand-marks.mjs';
import { addVaultNote } from './settings/secret-vault-note.mjs';

function h(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Mirrors model-env.mjs PROVIDER_APIS — the server validates; this is the form. */
export const PROVIDER_APIS = { copilot: ['anthropic', 'openai-chat', 'openai-responses'], openai: ['openai-chat', 'openai-responses'], anthropic: ['anthropic'] };
/** Mirrors model-env.mjs CODEX_UPSTREAM_APIS: a Codex model reaches an OpenAI-compatible endpoint itself, Responses only. */
export const CODEX_PROVIDER_APIS = ['openai-responses'];
/** Mirrors model-env.mjs TRANSLATED_APIS: the apis the bridge translates (no passthrough). */
export const TRANSLATED_APIS = ['openai-chat', 'openai-responses'];
export const PROVIDER_LABELS = { copilot: 'GitHub Copilot', openai: 'OpenAI-compatible', anthropic: 'Anthropic-compatible' };
export const API_LABELS = { anthropic: 'Anthropic Messages', 'openai-chat': 'OpenAI chat completions', 'openai-responses': 'OpenAI Responses' };
/** The import sheet's short API column. */
const API_SHORT = { anthropic: 'Messages', 'openai-chat': 'chat', 'openai-responses': 'Responses' };

/**
 * The effort levels an imported model listed, stashed on the Connection block
 * (spec §6.3) — only while the provider and the upstream model id are still the
 * ones they came from — or null.
 */
function storedReasoningEfforts(conn, provider) {
  const raw = conn && conn.dataset ? conn.dataset.reasoningEfforts : '';
  if (!raw || conn.dataset.reasoningEffortsProvider !== provider) return null;
  const modelIn = conn.querySelector('.mv-conn-model');
  if ((modelIn ? modelIn.value.trim() : '') !== (conn.dataset.reasoningEffortsModel || '')) return null;
  try {
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.length ? list : null;
  } catch { return null; }
}

/** Stash (or clear) an upstream's effort levels on the Connection block: no form field edits them. */
function stashReasoningEfforts(conn, upstream) {
  const list = upstream && upstream.capabilities && upstream.capabilities.reasoningEfforts;
  if (Array.isArray(list) && list.length) {
    conn.dataset.reasoningEfforts = JSON.stringify(list);
    conn.dataset.reasoningEffortsProvider = upstream.provider;
    conn.dataset.reasoningEffortsModel = String(upstream.model || '').trim();
  } else {
    delete conn.dataset.reasoningEfforts;
    delete conn.dataset.reasoningEffortsProvider;
    delete conn.dataset.reasoningEffortsModel;
  }
}
export const CAPABILITY_FLAGS = [['toolCalls', 'Tool calls'], ['vision', 'Vision'], ['reasoning', 'Reasoning']];

// ── Providers tab: row bodies (§8.1) ─────────────────────────────────────────

/**
 * With the credential broker: the viewer's own state in the slot `name` (copilot|openrouter|openai|anthropic) spends
 * from (key page), not worca's settings, which hold no key: { text, cls: 'green'|'red'|'grey', link, title }. `link`
 * is true only where a missing or rejected key links to the key page (`broker.keyPage` set); `title` is '' for none.
 */
export function brokerState(broker, name) {
  const b = broker || {};
  const p = (b.providers || {})[name] || {};
  const what = name === 'copilot' ? 'sign-in' : 'key';
  const pill = (text, cls, title = '') => ({ text, cls, link: false, title });
  if (b.signInNeeded) return pill(`sign in to see your ${what}`, 'grey');
  if (p.state === 'none') return pill('no broker slot for this URL', 'red', p.error || 'The credential broker has no slot for this base URL.');
  if (p.state === 'keyless') return pill('local, no key needed', 'green');
  if (b.error) return pill('key page unreachable', 'grey', b.error);
  if (p.state === 'set') return pill(`your ${what}${p.suffix ? ` ••••${p.suffix}` : ''}`, 'green');
  if (p.state === 'operator') return pill('team key', 'green');
  const label = p.state === 'invalid' ? `your ${what} was rejected` : `add your ${what} on the key page`;
  const cls = p.state === 'invalid' ? 'red' : 'grey';
  if (!b.keyPage) return pill(label, cls);
  return { text: label, cls, link: true, title: 'Opens the key page in a new tab. Reopen this tab afterwards to see the change.' };
}

/** The broker pill (brokerState) as a badge; a link to the key page opens it in a new tab. */
function brokerPill(doc, b, name) {
  const s = brokerState(b, name);
  const x = h(doc, s.link ? 'a' : 'span', `badge ${s.cls}${s.link ? ' mv-broker-pill' : ''}`, s.text);
  if (s.link) { x.href = b.keyPage; x.target = '_blank'; x.rel = 'noopener'; }
  if (s.title) x.title = s.title;
  return x;
}

/** With the broker on, a provider body starts with its pill; a key-page link in it stays a link of its own. */
function brokerLine(doc, broker, name) {
  const box = h(doc, 'div', 'mv-pv-broker');
  box.appendChild(brokerPill(doc, broker, name));
  return box;
}

let fieldSeq = 0;

/** An ⓘ tip in Settings' markup (settings.html); app.js's document-level .info-tip listeners show it wherever it sits. */
export function infoTip(doc, label, text) {
  const tip = h(doc, 'button', 'info-tip', 'i');
  tip.type = 'button';
  // "About account", but "About API key": a label that opens with an acronym keeps its case.
  tip.setAttribute('aria-label', `About ${/^[A-Z]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)}`);
  tip.appendChild(h(doc, 'span', 'tip-content hidden', text));
  return tip;
}

/**
 * A field whose hint is an ⓘ tip: div.mv-field > div.label-row(label.mv-field-label[for] + tip) + the control. A label
 * names its first labelable descendant and a tip is a button, so the tip sits beside the label, never inside it, and
 * the label points at the control by an id of its own.
 */
export function tippedField(doc, labelText, ctl, tip) {
  const wrap = h(doc, 'div', 'mv-field');
  const row = h(doc, 'div', 'label-row');
  const label = h(doc, 'label', 'mv-field-label', labelText);
  ctl.id = `mdl-field-${++fieldSeq}`;
  label.htmlFor = ctl.id;
  row.append(label, infoTip(doc, labelText, tip));
  wrap.append(row, ctl);
  return wrap;
}

function quotaLine(q) {
  if (!q) return '';
  if (q.unlimited) return 'Premium requests: unlimited on this plan';
  if (q.used != null && q.entitlement != null) return `Premium requests used this month: ${q.used} / ${q.entitlement}${q.resetDate ? ` (resets ${q.resetDate})` : ''}`;
  if (q.remaining != null) return `Premium requests remaining this month: ${q.remaining}`;
  return '';
}

/** A number field; with a `tip`, the tipped field (tippedField) in place of the plain label. */
function numberField(doc, cls, labelText, value, { min = 1, max = 64, tip = '', provider } = {}) {
  const inp = h(doc, 'input', `input ${cls}`);
  inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1';
  inp.value = value == null ? '' : String(value);
  if (provider) inp.dataset.provider = provider;
  if (tip) return tippedField(doc, labelText, inp, tip);
  const wrap = h(doc, 'label', 'mv-field');
  wrap.appendChild(h(doc, 'span', 'mv-field-label', labelText));
  wrap.appendChild(inp);
  return wrap;
}

const SPEECH_FIELDS = {
  stt: [
    ['baseUrl', 'Base URL', 'http://127.0.0.1:8080/v1'],
    ['apiKey', 'API key', 'optional for a local server; or ${VAR}'],
    ['model', 'Model', 'whisper-1'],
  ],
  tts: [
    ['baseUrl', 'Base URL', 'http://127.0.0.1:8880/v1'],
    ['apiKey', 'API key', 'optional for a local server; or ${VAR}'],
    ['model', 'Model', 'tts-1'],
  ],
};

const SPEECH_ENGINE_OPTIONS = {
  stt: [['browser', 'In the browser (built-in)'], ['server', 'Your server']],
  tts: [['browser', 'In the browser (built-in)'], ['server', 'Your server'], ['off', 'Off (replies stay text only)']],
};

function speechBadge(doc, s, kind) {
  if (s.engine === 'browser') return h(doc, 'span', 'badge green', 'in the browser');
  if (s.engine === 'off') return h(doc, 'span', 'badge grey', 'off (replies stay text only)');
  if (s.keyMissing) return h(doc, 'span', 'badge red', 'key ${VAR} not set');
  if (s.configured) return h(doc, 'span', 'badge green', 'configured');
  return h(doc, 'span', 'badge grey', kind === 'tts' ? 'off (replies stay text only)' : 'not configured');
}

export function formatSpeechBytes(n) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1e6))} MB`;
}

function speechInput(doc, kind, field, label, placeholder, s) {
  const wrap = h(doc, 'label', 'mv-field');
  wrap.appendChild(h(doc, 'span', 'mv-field-label', label));
  const inp = h(doc, 'input', `input mv-sp-field${field === 'apiKey' ? ' mv-pv-key' : ''}`);
  inp.type = field === 'speed' || field === 'pause' ? 'number' : 'text';
  if (field === 'speed') { inp.min = '0.25'; inp.max = '4'; inp.step = '0.05'; }
  if (field === 'pause') { inp.min = '0.3'; inp.max = '5'; inp.step = '0.1'; }
  inp.dataset.kind = kind;
  inp.dataset.field = field;
  inp.placeholder = placeholder;
  inp.value = field === 'apiKey' ? (s.keyRef || s.keyMasked || '') : (s[field] == null ? '' : String(s[field]));
  if (field === 'apiKey' && inp.value) inp.dataset.original = inp.value;
  wrap.appendChild(inp);
  return wrap;
}

/** The Speech body (providers.speech, docs/speech.md): Ask Worca's voice mode, never a model upstream. */
export function renderSpeechRow(providers, { doc = globalThis.document } = {}) {
  const sp = (providers || {}).speech || {};
  const row = h(doc, 'div', 'mv-pv-row mv-sp-row');
  row.dataset.provider = 'speech';
  const main = h(doc, 'div', 'mv-pv-main');
  if (sp.cacheBytes) {
    // The built-in engines' downloads (~/.worca-cc/speech-cache); the next mic use fetches them again.
    const cache = h(doc, 'div', 'mv-pv-btns mv-sp-cache');
    cache.appendChild(h(doc, 'small', 'hint', `Downloaded speech models: ${formatSpeechBytes(sp.cacheBytes)}`));
    const clear = h(doc, 'button', 'btn mv-sp-clear', 'Remove speech models');
    clear.type = 'button';
    cache.appendChild(clear);
    main.appendChild(cache);
  }
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  row.appendChild(main);
  const ctl = h(doc, 'div', 'mv-pv-ctl');
  for (const kind of ['stt', 'tts']) {
    const s = sp[kind] || {};
    const box = h(doc, 'div', 'mv-sp-kind');
    box.dataset.kind = kind;
    const head = h(doc, 'div', 'mv-head');
    head.appendChild(h(doc, 'b', 'mv-name', kind === 'stt' ? 'Speech-to-text' : 'Text-to-speech'));
    head.appendChild(speechBadge(doc, s, kind));
    box.appendChild(head);
    const eng = h(doc, 'label', 'mv-field');
    eng.appendChild(h(doc, 'span', 'mv-field-label', 'Engine'));
    const sel = h(doc, 'select', 'input mv-sp-field mv-sp-engine');
    sel.dataset.kind = kind;
    sel.dataset.field = 'engine';
    for (const [value, label] of SPEECH_ENGINE_OPTIONS[kind]) {
      const o = h(doc, 'option', '', label);
      o.value = value;
      sel.appendChild(o);
    }
    sel.value = s.engine || 'browser';
    eng.appendChild(sel);
    box.appendChild(eng);
    // The server fields matter only for engine 'server' (they stay stored either way).
    const server = h(doc, 'div', 'mv-sp-server');
    server.dataset.kind = kind;
    server.hidden = sel.value !== 'server';
    sel.addEventListener('change', () => { server.hidden = sel.value !== 'server'; });
    if (kind === 'tts') {
      // Kokoro's voices (af_heart, bf_emma, …) serve both the built-in engine and Kokoro-FastAPI.
      box.appendChild(speechInput(doc, kind, 'voice', 'Voice', 'af_heart, bf_emma, … (OpenAI: alloy, …)', s));
      box.appendChild(speechInput(doc, kind, 'speed', 'Speed', '1', s));
    }
    if (kind === 'stt') {
      box.appendChild(speechInput(doc, kind, 'language', 'Language', 'auto, or an ISO code such as bg', s));
      // The silence that sends a finished sentence; unfinished ones wait 2.5× as long (browser speech-to-text).
      box.appendChild(speechInput(doc, kind, 'pause', 'Pause before sending (seconds)', '0.7 (after a finished sentence; unfinished ones wait longer)', s));
    }
    for (const [field, label, placeholder] of SPEECH_FIELDS[kind]) server.appendChild(speechInput(doc, kind, field, label, placeholder, s));
    const btns = h(doc, 'div', 'mv-pv-btns');
    const test = h(doc, 'button', 'btn mv-sp-test', kind === 'stt' ? 'Test speech-to-text' : 'Test text-to-speech');
    test.type = 'button';
    test.dataset.kind = kind;
    btns.appendChild(test);
    server.appendChild(btns);
    box.appendChild(server);
    ctl.appendChild(box);
  }
  row.appendChild(ctl);
  const save = h(doc, 'div', 'mv-pv-btns');
  save.dataset.cardActions = '';
  const b = h(doc, 'button', 'btn btn-primary mv-sp-save', 'Save');
  b.type = 'button';
  save.appendChild(b);
  row.appendChild(save);
  return row;
}

function imagesField(doc, field, label, ctl, cls = '') {
  const wrap = h(doc, 'label', `mv-field${cls ? ` ${cls}` : ''}`);
  wrap.appendChild(h(doc, 'span', 'mv-field-label', label));
  ctl.dataset.field = field;
  wrap.appendChild(ctl);
  return wrap;
}

function imagesInput(doc, field, value) {
  const inp = h(doc, 'input', `input mv-im-field${field === 'apiKey' ? ' mv-pv-key' : ''}`);
  inp.type = 'text';
  inp.value = value;
  return inp;
}

/** The image row's key wording: a hosted service's, or Other's, which is often a server on this machine with no key. */
const IMAGES_KEY_PLACEHOLDER = 'sk-…, or ${VAR} to read your shell env';
const IMAGES_LOCAL_KEY_PLACEHOLDER = 'Leave empty for a server on this machine';
/** The model select's last option, "Other model…": it turns the field into a typed id, and is never sent itself. */
const OTHER_IMAGE_MODEL = '__other__';

/** The endpoint line under Other's address: the typed address without a trailing slash, else a stand-in. */
function imagesEndpointText(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  return `worca asks for a picture at POST ${base || '<Base URL>'}/images/generations, the way OpenAI's API takes it.`;
}

/**
 * Draw the row's one model control for `service`, holding `value`: the select over the service's list (a first
 * "Pick a model" when the service has no default, the default marked, "Other model…" last), else the typed input,
 * when the list is empty, the id is not in it or `typed` asks for it, with "Pick from list" while there is a list.
 * The control is rebuilt, never hidden, so one element carries data-field="model"; `focus` moves into the new one.
 */
function drawImagesModel(row, service, value, { typed = false, focus = false } = {}) {
  const doc = row.ownerDocument;
  const preset = IMAGE_SERVICES[service] || {};
  const list = preset.models || [];
  const label = h(doc, 'label', 'mv-field-label', 'Model');
  const box = row.querySelector('.mdl-model');
  let ctl;
  if (!typed && list.length && (value === '' || list.includes(value))) {
    ctl = h(doc, 'select', 'select mv-im-field mv-im-model-pick');
    const option = (v, text) => { const o = h(doc, 'option', '', text); o.value = v; ctl.appendChild(o); };
    if (!preset.model) option('', 'Pick a model');
    for (const id of list) option(id, id === preset.model ? `${id} (default)` : id);
    option(OTHER_IMAGE_MODEL, 'Other model…');
    ctl.value = value;
    ctl.addEventListener('change', () => {
      if (ctl.value === OTHER_IMAGE_MODEL) drawImagesModel(row, service, '', { typed: true, focus: true });
    });
    box.replaceChildren(label, ctl);
  } else {
    ctl = h(doc, 'input', 'input mv-im-field mv-im-model');
    ctl.type = 'text';
    ctl.placeholder = 'Model id, as the service names it';
    ctl.value = value;
    if (list.length) {
      // The way back to the list: on the default, or on "Pick a model" when the service has none.
      const typedBox = h(doc, 'div', 'mdl-model-typed');
      const back = h(doc, 'button', 'btn btn-quiet btn-sm mv-im-model-list', 'Pick from list');
      back.type = 'button';
      back.addEventListener('click', () => drawImagesModel(row, service, preset.model || '', { focus: true }));
      typedBox.append(ctl, back);
      box.replaceChildren(label, typedBox);
    } else box.replaceChildren(label, ctl);
  }
  ctl.dataset.field = 'model';
  ctl.id = `mdl-field-${++fieldSeq}`;
  label.htmlFor = ctl.id;
  if (focus) ctl.focus();
}

/** Open or fold the row's Advanced region; a no-op on Other, which has none. */
function setImagesAdvanced(row, open) {
  const disc = row.querySelector('.mdl-disc');
  const adv = row.querySelector('.mdl-adv');
  if (!disc || !adv) return;
  disc.setAttribute('aria-expanded', String(open));
  adv.hidden = !open;
}

/**
 * True when the row's Base URL or Price is not `service`'s own: Advanced then shows it open. The row fills an empty
 * stored value with the preset's, so only a stored, non-empty value that differs opens it.
 */
function imagesDiffersFromPreset(row, service) {
  const p = IMAGE_SERVICES[service] || {};
  const url = row.querySelector('.mv-im-field[data-field="baseUrl"]').value.trim();
  const price = row.querySelector('.mv-im-field[data-field="price"]').value.trim();
  return url !== (p.baseUrl || '') || Number(price) !== p.price;
}

/**
 * Lay out Base URL and Price for `service`. Other shows them openly, with the endpoint line under them. A preset
 * service folds them under "Advanced", open only while one differs from the preset's. The same two fields move, so
 * what they hold stays. The key's placeholder follows the service.
 */
function placeImagesEndpoint(row, service) {
  const doc = row.ownerDocument;
  const ctl = row.querySelector('.mv-pv-ctl');
  const url = row.querySelector('.mv-im-baseurl');
  const price = row.querySelector('.mv-im-price');
  const other = service === 'other';
  row.querySelector('.mv-im-field[data-field="apiKey"]').placeholder = other ? IMAGES_LOCAL_KEY_PLACEHOLDER : IMAGES_KEY_PLACEHOLDER;
  if (other) {
    const line = row.querySelector('.mv-im-endpoint') || h(doc, 'small', 'hint mv-im-endpoint');
    ctl.append(url, price, line);
    row.querySelector('.mdl-disc')?.remove();
    row.querySelector('.mdl-adv')?.remove();
    line.textContent = imagesEndpointText(row.querySelector('.mv-im-field[data-field="baseUrl"]').value);
    return;
  }
  row.querySelector('.mv-im-endpoint')?.remove();
  let adv = row.querySelector('.mdl-adv');
  let disc = row.querySelector('.mdl-disc');
  if (!adv) {
    adv = h(doc, 'div', 'mdl-adv');
    adv.id = `mdl-adv-${++fieldSeq}`;
    const button = h(doc, 'button', 'btn btn-quiet btn-sm mdl-disc');
    button.type = 'button';
    button.setAttribute('aria-controls', adv.id);
    button.append(icon(doc, 'chevron', 14), doc.createTextNode('Advanced'));
    button.addEventListener('click', () => setImagesAdvanced(row, button.getAttribute('aria-expanded') !== 'true'));
    disc = button;
  }
  adv.append(url, price);
  ctl.append(disc, adv);
  setImagesAdvanced(row, imagesDiffersFromPreset(row, service));
}

/**
 * The Image generation body (providers.images, Design pictures): the service a Design lead's pictures are made by.
 * Never a model upstream. Service · Model · API key; a preset service's Base URL and Price under "Advanced" (Other's
 * openly, with the endpoint line); then the message, the Test answer and the buttons. What it renders with is kept on
 * the row (data-stored-*), so a re-pick of the saved service brings the saved values back and a switch to another
 * address never carries the stored key along.
 */
export function renderImagesRow(providers, { doc = globalThis.document } = {}) {
  const im = (providers || {}).images || {};
  const service = im.service || 'openai';
  const preset = IMAGE_SERVICES[service] || {};
  // An empty stored address, model or price shows the preset's, so a Save sends it.
  const baseUrl = String(im.baseUrl || preset.baseUrl || '');
  const model = String(im.model || preset.model || '');
  const price = String(im.price ?? preset.price ?? '');
  const row = h(doc, 'div', 'mv-pv-row mv-im-row');
  row.dataset.provider = 'images';
  row.dataset.storedOrigin = originOf(im.baseUrl);
  row.dataset.storedService = service;
  row.dataset.storedBaseUrl = baseUrl;
  row.dataset.storedModel = model;
  row.dataset.storedPrice = price;

  const ctl = h(doc, 'div', 'mv-pv-ctl');
  const sel = h(doc, 'select', 'input mv-im-field mv-im-service');
  for (const s of Object.values(IMAGE_SERVICES)) {
    const o = h(doc, 'option', '', s.label);
    o.value = s.id;
    sel.appendChild(o);
  }
  sel.value = service;
  ctl.appendChild(imagesField(doc, 'service', 'Service', sel));
  ctl.appendChild(h(doc, 'div', 'mv-field mdl-model'));
  const key = imagesInput(doc, 'apiKey', im.keyRef || im.keyMasked || '');
  if (key.value) key.dataset.original = key.value;
  ctl.appendChild(imagesField(doc, 'apiKey', 'API key', key, 'mv-im-key'));
  const urlIn = imagesInput(doc, 'baseUrl', baseUrl);
  urlIn.addEventListener('input', () => {
    const line = row.querySelector('.mv-im-endpoint');
    if (line) line.textContent = imagesEndpointText(urlIn.value);
  });
  ctl.appendChild(imagesField(doc, 'baseUrl', 'Base URL', urlIn, 'mv-im-baseurl'));
  const priceIn = imagesInput(doc, 'price', price);
  priceIn.setAttribute('inputmode', 'decimal');
  priceIn.placeholder = '0 for a free server';
  ctl.appendChild(imagesField(doc, 'price', 'Price per picture ($)', priceIn, 'mv-im-price'));
  row.appendChild(ctl);
  drawImagesModel(row, service, model);
  placeImagesEndpoint(row, service);

  const main = h(doc, 'div', 'mv-pv-main');
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  // The Test picture's answer: the picture whole, and how long it took, or the reason it failed.
  const result = h(doc, 'div', 'mv-im-result');
  result.hidden = true;
  result.setAttribute('role', 'status');
  const shot = h(doc, 'img', 'mv-im-shot');
  shot.alt = 'Test picture';
  result.appendChild(shot);
  result.appendChild(h(doc, 'small', 'hint mv-im-made'));
  main.appendChild(result);
  row.appendChild(main);

  const btns = h(doc, 'div', 'mv-pv-btns');
  btns.dataset.cardActions = '';
  const test = h(doc, 'button', 'btn mv-im-test', 'Test picture');
  test.type = 'button';
  btns.appendChild(test);
  const save = h(doc, 'button', 'btn btn-primary mv-im-save', 'Save');
  save.type = 'button';
  btns.appendChild(save);
  row.appendChild(btns);
  return row;
}

/**
 * The Sound body (providers.sound, Design sound): the ElevenLabs key a Design video's voice and music are made with.
 * One field; its original value is kept even when empty, so an untouched field never collects as a cleared key.
 */
export function renderSoundRow(providers, { doc = globalThis.document } = {}) {
  const so = (providers || {}).sound || {};
  const row = h(doc, 'div', 'mv-pv-row mv-so-row');
  row.dataset.provider = 'sound';
  const main = h(doc, 'div', 'mv-pv-main');
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  // The Test's answer: how many voices the key reaches, or the reason it failed.
  const result = h(doc, 'small', 'hint mv-so-result');
  result.hidden = true;
  result.setAttribute('role', 'status');
  main.appendChild(result);
  row.appendChild(main);

  const ctl = h(doc, 'div', 'mv-pv-ctl');
  const field = h(doc, 'label', 'mv-field mv-so-key');
  field.appendChild(h(doc, 'span', 'mv-field-label', 'ElevenLabs API key'));
  const key = h(doc, 'input', 'input mv-pv-key');
  key.type = 'password';
  key.setAttribute('autocomplete', 'off');
  key.placeholder = 'sk_…';
  key.value = so.keyRef || so.keyMasked || '';
  key.dataset.original = key.value;
  field.appendChild(key);
  ctl.appendChild(field);
  row.appendChild(ctl);

  const btns = h(doc, 'div', 'mv-pv-btns');
  btns.dataset.cardActions = '';
  const test = h(doc, 'button', 'btn mv-so-test', 'Test');
  test.type = 'button';
  btns.appendChild(test);
  const save = h(doc, 'button', 'btn btn-primary mv-so-save', 'Save');
  save.type = 'button';
  btns.appendChild(save);
  row.appendChild(btns);
  return row;
}

/** GET /api/providers' `openrouter` block when the payload has none: no key, the server's defaults. */
const OPENROUTER_ROW_DEFAULTS = Object.freeze({ keySet: false, keySource: null, keyRef: null, keyMasked: null, legacyKey: false, maxConcurrent: 8, order: [], sort: '', allowFallbacks: true });

/**
 * The OpenRouter body (providers.openrouter): its own key, concurrency cap and routing defaults, which every model on
 * openrouter.ai uses. While the OpenAI-compatible row points at openrouter.ai and this row has no key, that row's key
 * is lent (`legacyKey`). The key's original value is kept even when empty, so an untouched field never collects.
 */
export function renderOpenRouterRow(providers, { doc = globalThis.document } = {}) {
  const p = providers || {};
  const o = { ...OPENROUTER_ROW_DEFAULTS, ...(p.openrouter || {}) };
  const row = h(doc, 'div', 'mv-pv-row mv-or-row');
  row.dataset.provider = 'openrouter';
  if (p.broker && p.broker.enabled) row.appendChild(brokerLine(doc, p.broker, 'openrouter'));
  const main = h(doc, 'div', 'mv-pv-main');
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  row.appendChild(main);

  const ctl = h(doc, 'div', 'mv-pv-ctl');
  const field = (labelText, input, cls = '') => {
    const f = h(doc, 'label', `mv-field${cls ? ` ${cls}` : ''}`);
    f.appendChild(h(doc, 'span', 'mv-field-label', labelText));
    f.appendChild(input);
    return f;
  };
  const key = h(doc, 'input', 'input mv-pv-key');
  key.type = 'text'; key.dataset.provider = 'openrouter';
  key.value = o.keyRef || o.keyMasked || '';
  key.dataset.original = key.value;
  key.placeholder = 'sk-…, or ${VAR} to read your shell env';
  ctl.appendChild(field('API key', key, 'mv-or-key'));
  ctl.appendChild(numberField(doc, 'mv-pv-conc', 'Max concurrent requests', o.maxConcurrent, { provider: 'openrouter' }));
  const order = h(doc, 'input', 'input mv-or-order');
  order.type = 'text'; order.placeholder = 'Names, comma-separated';
  order.value = Array.isArray(o.order) ? o.order.join(', ') : '';
  ctl.appendChild(field('Provider order', order));
  const sort = h(doc, 'select', 'select mv-or-sort');
  for (const [value, text] of [['', 'OpenRouter default'], ['price', 'Price'], ['throughput', 'Throughput'], ['latency', 'Latency']]) {
    const opt = h(doc, 'option', null, text); opt.value = value; sort.appendChild(opt);
  }
  sort.value = o.sort || '';
  ctl.appendChild(field('Sort providers by', sort));
  ctl.appendChild(makeSwitch(doc, { label: 'Allow other providers when these are unavailable', inputClass: 'mv-or-fallbacks', checked: o.allowFallbacks !== false }).row);
  row.appendChild(ctl);

  const btns = h(doc, 'div', 'mv-pv-btns');
  btns.dataset.cardActions = '';
  for (const [cls, text] of [['btn mv-or-browse', 'Import models'], ['btn mv-pv-test', 'Test connection'], ['btn btn-primary mv-pv-save', 'Save']]) {
    const b = h(doc, 'button', cls, text);
    b.type = 'button'; b.dataset.provider = 'openrouter';
    btns.appendChild(b);
  }
  row.appendChild(btns);
  return row;
}

/**
 * The GitHub Copilot body (providers.copilot): Account and the cap, which Save sends together (app.js's generic
 * .mv-pv-save arm, through collectProviderRow); the account it is signed in as, the device-flow box while `signIn`
 * ({userCode, verificationUri, status, error}; app.js keeps it across repaints) is in flight, and the usage line.
 */
export function renderCopilotRow(providers, { doc = globalThis.document, signIn = null } = {}) {
  const p = providers || {};
  const c = p.copilot || { connected: false, accountType: 'individual', maxConcurrent: 4 };
  const brokered = !!(p.broker && p.broker.enabled);
  const row = h(doc, 'div', 'mv-pv-row');
  row.dataset.provider = 'copilot';
  // With the broker, the broker's view of your sign-in.
  if (brokered) row.appendChild(brokerLine(doc, p.broker, 'copilot'));
  const main = h(doc, 'div', 'mv-pv-main');
  const onHost = c.githubHost && c.githubHost !== 'github.com' ? ` on ${c.githubHost}` : '';
  if (c.connected && !brokered) main.appendChild(h(doc, 'small', 'hint', `Connected${c.login ? ` as @${c.login}` : ''}${onHost}`));
  if (c.tokenSource === 'env') main.appendChild(h(doc, 'small', 'hint', `Token read from your shell env (${c.tokenRef}).`));
  const flow = h(doc, 'div', 'mv-cp-flow');
  if (signIn) flow.appendChild(renderCopilotSignIn(signIn, { doc }));
  main.appendChild(flow);
  main.appendChild(h(doc, 'small', 'hint mv-cp-quota', quotaLine(c.quota)));
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  row.appendChild(main);

  const ctl = h(doc, 'div', 'mv-pv-ctl');
  const sel = h(doc, 'select', 'select mv-cp-account');
  for (const [v, t] of [['individual', 'Individual'], ['business', 'Business'], ['enterprise', 'Enterprise'], ['ghe-com', 'GHE.com tenant']]) {
    const o = h(doc, 'option', null, t); o.value = v; if (v === c.accountType) o.selected = true; sel.appendChild(o);
  }
  ctl.appendChild(tippedField(doc, 'Account', sel, 'Picks the Copilot API host. The sign-in itself reports the host it was issued for and wins when it does. GHE.com tenant: everything goes to your tenant.'));
  // The tenant's host, shown while Account is GHE.com tenant (syncCopilotHostField); Save sends it with the account.
  const hostIn = h(doc, 'input', 'input mv-cp-host');
  hostIn.type = 'text'; hostIn.placeholder = 'acme.ghe.com';
  hostIn.value = c.enterpriseHost || '';
  const hostField = tippedField(doc, 'GHE.com host', hostIn, 'Your tenant, like acme.ghe.com. Sign-in, models and quota then use it.');
  hostField.classList.add('mv-cp-host-field');
  hostField.hidden = c.accountType !== 'ghe-com';
  ctl.appendChild(hostField);
  ctl.appendChild(numberField(doc, 'mv-pv-conc', 'Max concurrent requests', c.maxConcurrent, {
    provider: 'copilot',
    tip: "Fan-out children beyond this wait their turn. The one knob that lowers GitHub's abuse-detection risk. Keep it low.",
  }));
  row.appendChild(ctl);

  const btns = h(doc, 'div', 'mv-pv-btns');
  btns.dataset.cardActions = '';
  const button = (cls, text) => {
    const b = h(doc, 'button', cls, text);
    b.type = 'button';
    btns.appendChild(b);
    return b;
  };
  button('btn btn-quiet mv-cp-quota-refresh', 'Refresh usage').disabled = !c.connected;
  // With the broker, the import runs with the viewer's own Copilot sign-in (on the key page).
  const imp = button('btn mv-cp-fetch-models', 'Import models');
  imp.disabled = !c.connected && !brokered;
  if (imp.disabled) imp.title = 'Sign in first';
  if (c.connected) button('btn mv-cp-signout', 'Sign out');
  else if (!signIn) button('btn mv-cp-signin', 'Sign in');
  button('btn btn-primary mv-pv-save', 'Save').dataset.provider = 'copilot';
  row.appendChild(btns);
  return row;
}

/** An endpoint body (providers.openai | providers.anthropic): its base URL, key and cap, saved by Save. */
export function renderEndpointRow(providers, name, { doc = globalThis.document } = {}) {
  const p = providers || {};
  const k = p[name] || { configured: false, keySet: false, baseUrl: '', maxConcurrent: 8 };
  const row = h(doc, 'div', 'mv-pv-row');
  row.dataset.provider = name;
  if (p.broker && p.broker.enabled) row.appendChild(brokerLine(doc, p.broker, name));
  const main = h(doc, 'div', 'mv-pv-main');
  if (k.keySource === 'env') main.appendChild(h(doc, 'small', 'hint', `Key read from your shell env (${k.keyRef}).`));
  main.appendChild(h(doc, 'small', 'hint mv-pv-msg'));
  row.appendChild(main);

  const ctl = h(doc, 'div', 'mv-pv-ctl');
  const bu = h(doc, 'label', 'mv-field');
  bu.appendChild(h(doc, 'span', 'mv-field-label', 'Base URL'));
  const buIn = h(doc, 'input', 'input mv-pv-baseurl');
  buIn.type = 'text'; buIn.value = k.baseUrl || ''; buIn.dataset.provider = name;
  buIn.placeholder = name === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com';
  bu.appendChild(buIn);
  ctl.appendChild(bu);
  const keyIn = h(doc, 'input', 'input mv-pv-key');
  keyIn.type = 'text'; keyIn.dataset.provider = name;
  keyIn.value = k.keyRef || k.keyMasked || '';
  if (keyIn.value) keyIn.dataset.original = keyIn.value;
  keyIn.placeholder = 'sk-…, or ${VAR} to read your shell env';
  ctl.appendChild(tippedField(doc, 'API key', keyIn, 'Stored masked; leave masked to keep. A model can override this key on its Connection.'));
  addVaultNote(keyIn);
  ctl.appendChild(numberField(doc, 'mv-pv-conc', 'Max concurrent requests', k.maxConcurrent, { provider: name }));
  row.appendChild(ctl);

  // A failure shows as a card alert just above this row; a success on the button itself (#555).
  const btns = h(doc, 'div', 'mv-pv-btns');
  btns.dataset.cardActions = '';
  if (name === 'openai') {
    // §8.4 for a server you run: ask the endpoint what it serves instead of typing model ids.
    const browse = h(doc, 'button', 'btn mv-pv-browse', 'Import models');
    browse.type = 'button'; browse.dataset.provider = name;
    browse.title = 'List what this endpoint serves (llama.cpp, Ollama, LM Studio, vLLM…) and import the ones you want';
    btns.appendChild(browse);
  }
  const test = h(doc, 'button', 'btn mv-pv-test', 'Test connection');
  test.type = 'button'; test.dataset.provider = name;
  btns.appendChild(test);
  const save = h(doc, 'button', 'btn btn-primary mv-pv-save', 'Save');
  save.type = 'button'; save.dataset.provider = name;
  btns.appendChild(save);
  row.appendChild(btns);
  return row;
}

/** OpenRouter's address, where its row's "Import models" lists (docs/models.md "OpenRouter"); mirrors provider-ops
 *  OPENROUTER_BASE_URL. */
export const OPENROUTER_PRESET = Object.freeze({ baseUrl: 'https://openrouter.ai/api/v1', keyRef: '${OPENROUTER_KEY}' });
/** The Import dialog's hosted-API presets: an endpoint with a key of its own, stored on each imported entry
 *  (src/core/model-env.mjs GEMINI_OPENAI_BASE_URL / QWEN_OPENAI_BASE_URL; docs/models.md › Gemini and Qwen models). */
export const ENDPOINT_PRESETS = Object.freeze({
  gemini: Object.freeze({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRef: '${GEMINI_API_KEY}' }),
  qwen: Object.freeze({ baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', keyRef: '${DASHSCOPE_API_KEY}' }),
});

/**
 * Collect the OpenRouter row (`rootEl` is the row or an ancestor) into PATCH /api/providers/openrouter's body:
 * `apiKey` only when the field differs from its original ('' when cleared); `maxConcurrent` a number ('' when empty:
 * the server's default); `order` the comma-separated names, trimmed, blanks dropped. Null without the row.
 */
export function collectOpenRouterRow(rootEl) {
  const row = rootEl && (rootEl.matches && rootEl.matches('.mv-or-row') ? rootEl : rootEl.querySelector('.mv-or-row'));
  if (!row) return null;
  const body = {};
  const key = row.querySelector('.mv-pv-key');
  const v = key.value.trim();
  if (v !== key.dataset.original) body.apiKey = v;
  const conc = row.querySelector('.mv-pv-conc').value.trim();
  body.maxConcurrent = conc === '' ? '' : Number(conc);
  body.order = row.querySelector('.mv-or-order').value.split(',').map((s) => s.trim()).filter(Boolean);
  body.sort = row.querySelector('.mv-or-sort').value;
  body.allowFallbacks = row.querySelector('.mv-or-fallbacks').checked;
  return body;
}

/**
 * The Providers row that holds a catalogue model's key: 'openrouter' for an OpenAI-compatible entry whose base URL
 * (its own, else the OpenAI-compatible row's) is on openrouter.ai, else its upstream provider; null without one.
 */
export function providerRowOf(model, providers) {
  const up = model && model.upstream;
  if (!up) return null;
  if (up.provider === 'openai' && isOpenRouterUrl(up.baseUrl || providers?.openai?.baseUrl)) return 'openrouter';
  return up.provider;
}

/** The row `sel` names: `rootEl` itself (a body on its own), else the first one below it (the card, the tab). */
const rowIn = (rootEl, sel) => (rootEl.matches?.(sel) ? rootEl : rootEl.querySelector(sel));

/** Show the GHE.com host field only while the Copilot row's Account select says GHE.com tenant. */
export function syncCopilotHostField(rootEl) {
  const row = rowIn(rootEl, '.mv-pv-row[data-provider="copilot"]');
  const acct = row && row.querySelector('.mv-cp-account');
  const field = row && row.querySelector('.mv-cp-host-field');
  if (acct && field) field.hidden = acct.value !== 'ghe-com';
}

/**
 * Collect a provider row (`rootEl` is the row or an ancestor) into its PATCH body, masked echo dropped: Copilot's
 * { accountType, enterpriseHost (GHE.com tenant only, the server refuses one without the other), maxConcurrent }, an endpoint's { baseUrl, apiKey (only when changed), maxConcurrent }. Null without it.
 */
export function collectProviderRow(rootEl, name) {
  const row = rowIn(rootEl, `.mv-pv-row[data-provider="${name}"]`);
  if (!row) return null;
  const body = {};
  const acct = row.querySelector('.mv-cp-account');
  if (acct) body.accountType = acct.value;
  const host = row.querySelector('.mv-cp-host');
  if (acct && acct.value === 'ghe-com' && host) body.enterpriseHost = host.value.trim();
  const bu = row.querySelector('.mv-pv-baseurl');
  if (bu) body.baseUrl = bu.value.trim();
  const key = row.querySelector('.mv-pv-key');
  if (key) {
    const v = key.value.trim();
    if (v !== (key.dataset.original || '')) body.apiKey = v;   // unchanged (masked or ref) = keep
  }
  const conc = row.querySelector('.mv-pv-conc');
  if (conc && conc.value.trim() !== '') body.maxConcurrent = Number(conc.value);
  return body;
}

/** Collect the Speech row (`rootEl` is the row or an ancestor) into PATCH /api/providers/speech's body
 *  (masked/unchanged key omitted). */
export function collectSpeechRow(rootEl) {
  const row = rowIn(rootEl, '.mv-pv-row[data-provider="speech"]');
  if (!row) return null;
  const body = { stt: {}, tts: {} };
  for (const inp of row.querySelectorAll('.mv-sp-field')) {
    const { kind, field } = inp.dataset;
    const v = inp.value.trim();
    if (field === 'apiKey') { if (v !== (inp.dataset.original || '')) body[kind].apiKey = v; continue; }
    body[kind][field] = (field === 'speed' || field === 'pause') && v !== '' ? Number(v) : v;
  }
  return body;
}

const imagesRowOf = (rootEl) => rowIn(rootEl, '.mv-pv-row[data-provider="images"]');

/**
 * Pick a service on the Image generation row: its Base URL, Model and Price fill in (a preset with no price
 * leaves Price empty), the model control redrawn on the service's default ("Pick a model" when it has none). The key
 * stays only when the preset's address has the stored key's origin; the saved service brings back what was saved,
 * key and model (picked or typed) included. Base URL and Price move between Other's open fields and Advanced.
 * Nothing is saved. False for an unknown service.
 */
export function applyImagesPreset(rootEl, id) {
  const row = imagesRowOf(rootEl);
  if (!row || !Object.hasOwn(IMAGE_SERVICES, id)) return false;
  const f = (k) => row.querySelector(`.mv-im-field[data-field="${k}"]`);
  const ds = row.dataset;
  const original = f('apiKey').dataset.original || '';
  const preset = IMAGE_SERVICES[id];
  const saved = id === ds.storedService;
  const origin = originOf(preset.baseUrl);
  f('service').value = id;
  f('baseUrl').value = saved ? ds.storedBaseUrl || '' : preset.baseUrl;
  f('price').value = saved ? ds.storedPrice || '' : preset.price == null ? '' : String(preset.price);
  f('apiKey').value = saved || (origin && origin === ds.storedOrigin) ? original : '';
  drawImagesModel(row, id, saved ? ds.storedModel || '' : preset.model);
  placeImagesEndpoint(row, id);
  return true;
}

/** Collect the Image generation row into PATCH /api/providers/images' body (masked/unchanged key omitted). The model
 *  comes from whichever control is drawn; "Other model…" collects as no model. */
export function collectImagesRow(rootEl) {
  const row = imagesRowOf(rootEl);
  if (!row) return null;
  const body = {};
  for (const inp of row.querySelectorAll('.mv-im-field')) {
    const { field } = inp.dataset;
    const v = inp.value.trim();
    if (field === 'apiKey') { if (v !== (inp.dataset.original || '')) body.apiKey = v; continue; }
    if (field === 'model' && v === OTHER_IMAGE_MODEL) { body.model = ''; continue; }
    if (field === 'price') {
      // A number goes as one; anything else as typed, which the server refuses in its own words.
      const n = Number(v);
      body.price = v === '' ? '' : Number.isFinite(n) ? n : v;
      continue;
    }
    body[field] = v;
  }
  return body;
}

/** Collect the Sound row (`rootEl` is the row or an ancestor) into PATCH /api/providers/sound's body: {} while the
 *  key is untouched, else { apiKey } ('' for a cleared field). */
export function collectSoundRow(rootEl) {
  const row = rowIn(rootEl, '.mv-pv-row[data-provider="sound"]');
  if (!row) return null;
  const key = row.querySelector('.mv-pv-key');
  const v = key.value.trim();
  return v === key.dataset.original ? {} : { apiKey: v };
}

/** The Test picture's answer, in the row: the picture and "Made in n s · w×h", or the reason in red. */
export function showImagesTest(rootEl, r) {
  const row = imagesRowOf(rootEl);
  if (!row) return;
  const shot = row.querySelector('.mv-im-shot');
  const line = row.querySelector('.mv-im-made');
  row.querySelector('.mv-im-result').hidden = false;
  if (r && r.ok) {
    shot.src = r.dataUrl;
    shot.hidden = false;
    line.className = 'hint mv-im-made';
    line.textContent = `Made in ${pictureSeconds(r.ms)} s · ${r.w}×${r.h}`;
    return;
  }
  shot.hidden = true;
  shot.removeAttribute('src');
  line.className = 'hint err mv-im-made';
  line.textContent = (r && r.message) || '';
}

/**
 * Why the Image generation row cannot be saved as it is, in the row's words, or '': Other's address, then the model,
 * then Other's price (a preset service fills its own). app.js refuses Save with it before any request is sent.
 */
export function imagesRowProblem(rootEl) {
  const row = imagesRowOf(rootEl);
  if (!row) return '';
  const b = collectImagesRow(row);
  if (b.service === 'other' && !/^https?:\/\/\S+$/.test(b.baseUrl)) return 'Enter the address, starting with http:// or https://';
  if (!b.model) return row.querySelector('.mv-im-model-pick') ? 'Pick a model' : 'Enter a model';
  if (b.service === 'other' && b.price === '') return 'Enter a price; 0 for a free server';
  return '';
}

/** A refused Save of the Image generation row, in the row's own line and announced (not the card's alert). Advanced
 *  opens, since a server refusal can name a field inside it. */
export function showImagesSaveError(rootEl, message) {
  const row = imagesRowOf(rootEl);
  const line = row && row.querySelector('.mv-pv-msg');
  if (!line) return;
  line.textContent = message;
  line.className = 'hint err mv-pv-msg';
  line.setAttribute('role', 'alert');
  setImagesAdvanced(row, true);
}

/** The code is its own copy button (copy-button.mjs: the code as the label, then a green tick and "Copied"), the one
 *  step of the box. It copies by itself, so the box works wherever it is mounted (Providers, the setup assistant).
 *  A failure stays in the box's status line: a button's text cannot be selected, so it says to type the code. */
function copyCodeButton(doc, code, status) {
  const b = copyButton(doc, { name: `Copy code ${code}`, label: code, title: 'Copy code', cls: 'mv-cp-copy' });
  b.querySelector('.copy-btn-text').classList.add('mv-cp-code');
  b.dataset.code = code;
  b.addEventListener('click', async () => {
    if (await copyFromButton(b, code, { empty: 'No code yet' })) return;
    status.textContent = code ? `Could not copy the code. Type ${code} on GitHub instead.` : 'No code yet.';
    status.classList.add('err');
  });
  return b;
}

// In the order it is used: the code (its own copy button), then Open (the primary step); below, the wait (a spinner
// while it lasts) with Cancel on the same line.
export function renderCopilotSignIn(flow, { doc = globalThis.document } = {}) {
  const box = h(doc, 'div', 'mv-cp-signin-box');
  box.appendChild(h(doc, 'small', 'hint', 'Copy this code, then enter it on GitHub to connect your Copilot account.'));
  const status = h(doc, 'small', `hint mv-cp-status${flow.error ? ' err' : ''}`, flow.error || flow.status || 'Waiting for approval…');
  status.setAttribute('role', 'status');
  const codeRow = h(doc, 'div', 'mv-cp-code-row');
  codeRow.appendChild(copyCodeButton(doc, flow.userCode || '', status));
  const href = flow.verificationUri || `https://${flow.host || 'github.com'}/login/device`;
  const link = h(doc, 'a', 'btn btn-primary mv-cp-open', `Open ${href.replace(/^https:\/\//, '')}`);
  link.href = href;
  link.target = '_blank'; link.rel = 'noopener';
  codeRow.appendChild(link);
  box.appendChild(codeRow);
  const foot = h(doc, 'div', 'mv-cp-foot');
  const wait = h(doc, 'div', 'mv-cp-wait');
  if (!flow.error) { const spin = h(doc, 'span', 'mk-phase-spin'); spin.setAttribute('aria-hidden', 'true'); wait.appendChild(spin); }
  wait.appendChild(status);
  const cancel = h(doc, 'button', 'btn btn-quiet mv-cp-cancel', flow.error ? 'Dismiss' : 'Cancel');
  cancel.type = 'button';
  foot.append(wait, cancel);
  box.appendChild(foot);
  return box;
}

// ── Import from Copilot (§8.4) ───────────────────────────────────────────────

/** A yes/no table cell: a check icon (named "yes" for screen readers) or a dash. */
const yesNoCell = (doc, v) => {
  const td = h(doc, 'td', null, v ? null : '—');
  if (v) { td.setAttribute('aria-label', 'yes'); td.append(icon(doc, 'check', 12)); }
  return td;
};
const fmtK = (n) => (n ? `${Math.round(n / 1000)}k` : '—');

/** ADD-3: a listed model's mark in the Model column, as its Catalogue row will wear it (brand-marks.mjs modelMark: the
 *  vendor's mark from the id or its `vendor/` prefix, else the own mark). It reads the id the import writes (the
 *  listing's `catalogId`), whose server or host word vendorOf weighs as the Catalogue row's. */
function sheetMark(doc, m) {
  const id = String(m.id || '');
  return modelMark(doc, { id: String(m.catalogId || id), label: String(m.name || ''), upstream: { model: id } }, 'sm');
}

/** The import sheet over GET /api/providers/copilot/models' list. */
export function renderImportSheet(models, { doc = globalThis.document } = {}) {
  const root = h(doc, 'section', 'card mv-editor mvi');
  root.appendChild(h(doc, 'h3', 'mv-editor-title', 'Import from GitHub Copilot'));
  root.appendChild(h(doc, 'small', 'hint',
    'These run through your Copilot subscription. Claude models keep extended thinking; other vendors run through a translation layer (no web tools; reasoning arrives as summaries on the Responses API). Imported entries are priced free (Copilot bills premium requests, not tokens), and Worca counts requests per run.'));
  const list = Array.isArray(models) ? models : [];
  if (!list.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'Copilot returned no chat models for this account.'));
  } else {
    const tbl = h(doc, 'table', 'tm-tbl mvi-tbl');
    const thead = h(doc, 'thead');
    const hr = h(doc, 'tr');
    const allTh = h(doc, 'th');
    const all = h(doc, 'input', 'mvi-all'); all.type = 'checkbox'; all.title = 'Select all importable';
    allTh.appendChild(all);
    hr.appendChild(allTh);
    for (const t of ['Model', 'Vendor', 'Context', 'Tools', 'Vision', 'Reasoning', 'API', 'Status']) hr.appendChild(h(doc, 'th', null, t));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = h(doc, 'tbody');
    for (const m of list) {
      const tr = h(doc, 'tr');
      tr.dataset.id = m.id;
      const disabled = m.policyState && m.policyState !== 'enabled';
      if (disabled) tr.className = 'mvi-disabled';
      const cbTd = h(doc, 'td');
      const cb = h(doc, 'input', 'mvi-cb'); cb.type = 'checkbox'; cb.value = m.id; cb.disabled = !!disabled;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      const nameTd = h(doc, 'td');
      const nameRow = h(doc, 'div', 'mdl-sheet-name');
      nameRow.appendChild(sheetMark(doc, m));
      const nameTx = h(doc, 'span', 'mdl-sheet-name-tx');
      nameTx.appendChild(h(doc, 'b', null, m.name || m.id));
      nameTx.appendChild(h(doc, 'small', 'hint mvi-id', m.id));
      nameRow.appendChild(nameTx);
      nameTd.appendChild(nameRow);
      tr.appendChild(nameTd);
      tr.appendChild(h(doc, 'td', null, m.vendor || '—'));
      tr.appendChild(h(doc, 'td', 'num', fmtK(m.contextWindow || m.maxPromptTokens)));
      tr.appendChild(yesNoCell(doc, m.toolCalls));
      tr.appendChild(yesNoCell(doc, m.vision));
      tr.appendChild(yesNoCell(doc, m.reasoning));
      tr.appendChild(h(doc, 'td', 'mvi-api', API_SHORT[m.api] || '—'));
      const status = [];
      if (m.inCatalog) status.push('In catalogue');
      if (m.preview) status.push('preview');
      if (disabled) status.push('disabled: enable it in your GitHub Copilot settings');
      tr.appendChild(h(doc, 'td', 'mvi-status', status.join(' · ') || '—'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);
  }
  const msg = h(doc, 'p', 'form-msg mvi-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn btn-primary mvi-go', 'Import selected');
  go.type = 'button'; go.disabled = !list.length;
  const cancel = h(doc, 'button', 'btn mvi-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** The import sheet over GET /api/providers/opencode/models (§8.4's Copilot import): what YOUR installed opencode can
 *  run, as `opencode models` lists it. Same chrome and same checkbox contract as the Copilot sheet — collectImportSheet
 *  reads both — with the columns the CLI itself gives: the model id (provider/model, its provider shown beside it) and
 *  the catalogue status. Each entry runs on the OpenCode harness, its id as opencode takes it. */
export function renderOpencodeSheet(models, { doc = globalThis.document } = {}) {
  const list = Array.isArray(models) ? models : [];
  const root = h(doc, 'section', 'card mv-editor mvi');
  root.dataset.source = 'opencode';
  root.appendChild(h(doc, 'h3', 'mv-editor-title', 'Import from OpenCode'));
  root.appendChild(h(doc, 'small', 'hint',
    'The models your installed opencode can run — its configured provider keys and sign-ins, plus the free OpenCode Zen models. Each is added as an OpenCode model under the id above, so a run (or chat) on OpenCode calls it exactly as `opencode models` lists it.'));
  if (!list.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'opencode lists no models.'));
  } else {
    const tbl = h(doc, 'table', 'tm-tbl mvi-tbl');
    const thead = h(doc, 'thead');
    const hr = h(doc, 'tr');
    const allTh = h(doc, 'th');
    const all = h(doc, 'input', 'mvi-all'); all.type = 'checkbox'; all.title = 'Select all importable';
    allTh.appendChild(all);
    hr.appendChild(allTh);
    for (const t of ['Model', 'Provider', 'Status']) hr.appendChild(h(doc, 'th', null, t));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = h(doc, 'tbody');
    for (const m of list) {
      const tr = h(doc, 'tr');
      tr.dataset.id = m.id;
      const cbTd = h(doc, 'td');
      const cb = h(doc, 'input', 'mvi-cb'); cb.type = 'checkbox'; cb.value = m.id;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      const nameTd = h(doc, 'td');
      const nameRow = h(doc, 'div', 'mdl-sheet-name');
      nameRow.appendChild(sheetMark(doc, m));
      const nameTx = h(doc, 'span', 'mdl-sheet-name-tx');
      nameTx.appendChild(h(doc, 'b', null, m.name || m.id));
      nameTx.appendChild(h(doc, 'small', 'hint mvi-id', m.id || ''));
      nameRow.appendChild(nameTx);
      nameTd.appendChild(nameRow);
      tr.appendChild(nameTd);
      tr.appendChild(h(doc, 'td', null, m.provider || '—'));
      const status = [];
      if (m.inCatalog) status.push('In catalogue');
      tr.appendChild(h(doc, 'td', 'mvi-status', status.join(' · ') || '—'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);
  }
  const msg = h(doc, 'p', 'form-msg mvi-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn btn-primary mvi-go', 'Import selected');
  go.type = 'button'; go.disabled = !list.length;
  const cancel = h(doc, 'button', 'btn mvi-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/**
 * The import sheet over GET /api/providers/openai/models (§8.4): what one OpenAI-compatible
 * endpoint serves. Same chrome and same checkbox contract as the Copilot sheet — collectImportSheet
 * reads both — with the columns a local server decides a pipeline on: the window ONE request gets,
 * tool calls, and whether the model is loaded.
 */
export function renderEndpointSheet(payload, { doc = globalThis.document } = {}) {
  const p = payload || {};
  const list = Array.isArray(p.models) ? p.models : [];
  const hosted = p.server === 'openrouter';
  const root = h(doc, 'section', 'card mv-editor mvi mvi-ep');
  root.dataset.source = 'endpoint';
  root.dataset.baseurl = p.baseUrl || '';
  if (p.server) root.dataset.server = p.server;
  root.appendChild(h(doc, 'h3', 'mv-editor-title', `Import from ${p.serverLabel || 'this endpoint'}`));
  root.appendChild(h(doc, 'small', 'hint', hosted
    ? `${p.baseUrl || ''}: these run through the translation layer (no web tools). Worca reads each model's window, output cap, tool and reasoning support and its listed price, and pins them on the entry.`
    : p.server === 'gemini' || p.server === 'qwen'
      ? `${p.baseUrl || ''}: these run through the translation layer (no web tools) and bill to your ${p.serverLabel || 'provider'} account. Worca pins the windows the endpoint lists; set a price on each to see its cost.`
      : `${p.baseUrl || ''}: these run through the translation layer (no thinking blocks, no web tools) and are priced free: a model on your own machine bills nothing. Worca pins the prompt limit only when the server reports the window it really serves.`));
  for (const w of Array.isArray(p.warnings) ? p.warnings : []) root.appendChild(h(doc, 'small', 'hint mvi-warn', w));
  // A hosted catalog lists hundreds of models: beside the dialog's text filter, narrow by what a
  // pipeline decides on. The controls only mark the view — endpointRowMatches reads them — so, like
  // that text filter, they are no change the dialog could lose (data-dirty-ignore).
  if (hosted && list.length) {
    const bar = h(doc, 'div', 'chip-select mvi-or-filters');
    bar.dataset.dirtyIgnore = '';
    const chip = (cls, text) => {
      const l = h(doc, 'label', 'mvi-chip');
      const cb = h(doc, 'input', cls); cb.type = 'checkbox';
      l.appendChild(cb); l.appendChild(h(doc, 'span', null, text));
      bar.appendChild(l);
    };
    chip('mvi-f-free', 'Free');
    chip('mvi-f-tools', 'Tools');
    const ctxL = h(doc, 'label', 'mvi-chip');
    ctxL.appendChild(h(doc, 'span', null, 'Window ≥'));
    const ctx = h(doc, 'select', 'select mvi-f-ctx');
    for (const [v, t] of [['0', 'any'], ['65536', '64k'], ['131072', '128k'], ['262144', '256k'], ['1000000', '1M']]) {
      const o = h(doc, 'option', null, t); o.value = v; ctx.appendChild(o);
    }
    ctxL.appendChild(ctx);
    bar.appendChild(ctxL);
    root.appendChild(bar);
  }
  if (!list.length) {
    root.appendChild(h(doc, 'div', 'hist-empty', 'This endpoint lists no models.'));
  } else {
    const tbl = h(doc, 'table', 'tm-tbl mvi-tbl');
    const thead = h(doc, 'thead');
    const hr = h(doc, 'tr');
    const allTh = h(doc, 'th');
    const all = h(doc, 'input', 'mvi-all'); all.type = 'checkbox'; all.title = 'Select all importable';
    allTh.appendChild(all);
    hr.appendChild(allTh);
    for (const t of ['Model', 'Detail', 'Window', 'Tools', 'Vision', 'Status']) hr.appendChild(h(doc, 'th', null, t));
    thead.appendChild(hr);
    tbl.appendChild(thead);
    const tbody = h(doc, 'tbody');
    for (const m of list) {
      const tr = h(doc, 'tr');
      tr.dataset.id = m.id;
      tr.dataset.free = m.free ? '1' : '0';
      tr.dataset.tools = m.toolCalls === true ? '1' : '0';
      tr.dataset.ctx = String(m.servedContext || 0);
      const blocked = m.importable === false;
      if (blocked) tr.className = 'mvi-disabled';
      const cbTd = h(doc, 'td');
      const cb = h(doc, 'input', 'mvi-cb'); cb.type = 'checkbox'; cb.value = m.id; cb.disabled = blocked;
      cbTd.appendChild(cb);
      tr.appendChild(cbTd);
      const nameTd = h(doc, 'td');
      const nameRow = h(doc, 'div', 'mdl-sheet-name');
      nameRow.appendChild(sheetMark(doc, m));
      const nameTx = h(doc, 'span', 'mdl-sheet-name-tx');
      nameTx.appendChild(h(doc, 'b', null, m.name || m.id));
      nameTx.appendChild(h(doc, 'small', 'hint mvi-id', m.catalogId || ''));
      nameRow.appendChild(nameTx);
      nameTd.appendChild(nameRow);
      tr.appendChild(nameTd);
      tr.appendChild(h(doc, 'td', null, m.detail || '—'));
      // The served window is the one a prompt limit may be pinned from; the trained one is context.
      const ctxTd = h(doc, 'td', 'num', fmtK(m.servedContext));
      if (!m.servedContext && m.trainedContext) {
        ctxTd.textContent = '';
        ctxTd.appendChild(h(doc, 'span', 'mvi-ctx-unknown', `? · supports ${fmtK(m.trainedContext)}`));
      }
      tr.appendChild(ctxTd);
      tr.appendChild(m.toolCalls === null || m.toolCalls === undefined ? h(doc, 'td', null, '?') : yesNoCell(doc, m.toolCalls));
      tr.appendChild(m.vision === null || m.vision === undefined ? h(doc, 'td', null, '?') : yesNoCell(doc, m.vision));
      const status = [];
      if (m.inCatalog) status.push('In catalogue');
      if (m.loaded === true) status.push('loaded');
      else if (m.loaded === false) status.push('not loaded');
      if (blocked) status.push(m.blocked || 'not importable');
      tr.appendChild(h(doc, 'td', 'mvi-status', status.join(' · ') || '—'));
      tbody.appendChild(tr);
    }
    tbl.appendChild(tbody);
    root.appendChild(tbl);
  }
  const msg = h(doc, 'p', 'form-msg mvi-msg');
  msg.setAttribute('aria-live', 'polite');
  root.appendChild(msg);
  const btns = h(doc, 'div', 'mv-editor-btns');
  const go = h(doc, 'button', 'btn btn-primary mvi-go', 'Import selected');
  go.type = 'button'; go.disabled = !list.some((m) => m.importable !== false);
  const cancel = h(doc, 'button', 'btn mvi-cancel', 'Cancel');
  cancel.type = 'button';
  btns.appendChild(go); btns.appendChild(cancel);
  root.appendChild(btns);
  return root;
}

/** The Copilot model ids ticked in an import sheet. */
export function collectImportSheet(rootEl) {
  return [...rootEl.querySelectorAll('.mvi-cb')].filter((c) => c.checked && !c.disabled).map((c) => c.value);
}

/**
 * Whether an import-sheet row passes the dialog's text query and, on a hosted sheet, its Free /
 * Tools / window filters. A view filter only — the tick on a hidden row is kept. Pure over the DOM.
 */
export function endpointRowMatches(tr, sheet, query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (q && !tr.textContent.toLowerCase().includes(q) && !String(tr.dataset.id || '').toLowerCase().includes(q)) return false;
  const bar = sheet && sheet.querySelector('.mvi-or-filters');
  if (!bar) return true;
  if (bar.querySelector('.mvi-f-free')?.checked && tr.dataset.free !== '1') return false;
  if (bar.querySelector('.mvi-f-tools')?.checked && tr.dataset.tools !== '1') return false;
  const min = Number(bar.querySelector('.mvi-f-ctx')?.value || 0);
  return !(min > 0 && Number(tr.dataset.ctx || 0) < min);
}

// ── Editor: Connection section (§8.3) ───────────────────────────────────────

/** Whether a base URL is OpenRouter's (mirrors model-env.mjs isOpenRouterBaseUrl; this module imports nothing). */
export function isOpenRouterUrl(v) {
  if (typeof v !== 'string' || !v.trim()) return false;
  let host;
  try { host = new URL(v.trim()).hostname.toLowerCase(); } catch { return false; }
  return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
}

/** Where a model runs (src/shared/connections.mjs connectionOf kinds): its harness's sign-in, routing env, or a provider. */
const WHERES = Object.freeze(['signin', 'env', 'provider']);
/** Each `where` as the connection mode the rules below compare against. */
const MODE_OF = Object.freeze({ signin: 'direct', env: 'env', provider: 'provider' });
/** The Provider select's choices. OpenRouter is not a provider of its own: it is the OpenAI-compatible provider at
 *  OpenRouter's address, whose key the OpenRouter row holds (providerRowOf). */
const PROVIDER_CHOICES = Object.freeze([
  ['copilot', PROVIDER_LABELS.copilot], ['openrouter', 'OpenRouter'], ['openai', PROVIDER_LABELS.openai], ['anthropic', PROVIDER_LABELS.anthropic],
]);
/** The provider a Provider choice stores: OpenRouter collects as `openai`. Only the select's own display keeps the choice. */
const apiProvider = (v) => (v === 'openrouter' ? 'openai' : v);

/** el: inside a model form or a connection section → 'provider' | 'signin' | 'env' (its data-where). */
export function connectionWhere(el) {
  const host = el && el.dataset && el.dataset.where ? el : el && el.closest ? el.closest('[data-where]') : null;
  const where = host ? host.dataset.where : '';
  return WHERES.includes(where) ? where : 'signin';
}

/** A connection's mode, in the words the rules below use: direct (a sign-in), env or provider. */
const modeOf = (conn) => MODE_OF[connectionWhere(conn)];

/** Where a connection's controls sit: the model form moves the folds after Pricing (models-view.mjs) and a standalone
 *  section keeps them, so every read looks from the form when there is one. */
const scopeOf = (conn) => (conn.closest && conn.closest('.mv-editor')) || conn;

/**
 * The one writer of data-where (the editor and its .mv-conn); then applyConnectionMode. Inside a model form the form's
 * own rules follow (conn._applyEditor, set by models-view renderModelEditor: the harness field, a new form's harness,
 * the suggested id, Save), and they start with applyConnectionMode.
 */
export function setConnectionWhere(root, where) {
  if (!root) return;
  const next = WHERES.includes(where) ? where : 'signin';
  const conn = root.classList && root.classList.contains('mv-conn') ? root : root.querySelector && root.querySelector('.mv-conn');
  const editor = (conn || root).closest ? (conn || root).closest('.mv-editor') : null;
  if (editor) editor.dataset.where = next;
  if (!conn) return;
  conn.dataset.where = next;
  if (typeof conn._applyEditor === 'function') conn._applyEditor();
  else applyConnectionMode(conn);
}

/** Which `where` an engine's model may use: Claude Code all three; Codex its own sign-in or an OpenAI-compatible
 *  Responses endpoint (codex ignores routing env); every other harness (Cursor, Copilot, Gemini CLI, Goose, OpenCode,
 *  Qwen Code) its own sign-in only. */
const MODE_TEXT = Object.freeze({
  claude: Object.freeze(['signin', 'env', 'provider']),
  codex: Object.freeze(['signin', 'provider']),
});

/** MODE_TEXT's rule, public: claude → ['signin','env','provider']; codex → ['signin','provider']; else ['signin']. A
 *  missing engine is Claude Code. */
export function wheresFor(engine) {
  return [...(MODE_TEXT[engine || 'claude'] || ['signin'])];
}

/** Whether the Connection form resolves to OpenRouter chat completions: its own base URL, else the provider's. */
function openRouterApplies(conn) {
  if (modeOf(conn) !== 'provider') return false;
  const scope = scopeOf(conn);
  if (apiProvider(scope.querySelector('.mv-conn-provider')?.value) !== 'openai' || scope.querySelector('.mv-conn-api')?.value !== 'openai-chat') return false;
  const own = (scope.querySelector('.mv-conn-baseurl')?.value || '').trim();
  return isOpenRouterUrl(own || conn._providers?.openai?.baseUrl || '');
}

/** Load an `upstream.openrouter` block (or nothing: the defaults) into the routing fields. */
function fillOpenRouter(root, or) {
  const o = or || {};
  const p = o.provider || {};
  const set = (sel, v) => { const el = root.querySelector(sel); if (el) el.value = v; };
  set('.mv-conn-or-models', Array.isArray(o.models) ? o.models.join(', ') : '');
  set('.mv-conn-or-order', Array.isArray(p.order) ? p.order.join(', ') : '');
  set('.mv-conn-or-sort', p.sort || '');
  const fb = root.querySelector('.mv-conn-or-fallbacks');
  if (fb) fb.checked = p.allow_fallbacks !== false;   // OpenRouter's default is on
}

/** The routing fields as an `upstream.openrouter` block, or undefined when all are at their defaults. */
function collectOpenRouter(conn) {
  const scope = scopeOf(conn);
  const list = (sel) => (scope.querySelector(sel)?.value || '').split(',').map((s) => s.trim()).filter(Boolean);
  const out = {};
  const models = list('.mv-conn-or-models');
  if (models.length) out.models = models;
  const provider = {};
  const order = list('.mv-conn-or-order');
  if (order.length) provider.order = order;
  if (scope.querySelector('.mv-conn-or-fallbacks')?.checked === false) provider.allow_fallbacks = false;
  const sort = scope.querySelector('.mv-conn-or-sort')?.value || '';
  if (sort) provider.sort = sort;
  if (Object.keys(provider).length) out.provider = provider;
  return Object.keys(out).length ? out : undefined;
}

/** div.mv-field > label.mv-field-label[for] (in a .label-row with its ⓘ when there is a tip) + `box`, which holds `ctl`. */
function connField(doc, labelText, ctl, { box = ctl, tip = '' } = {}) {
  if (tip && box === ctl) return tippedField(doc, labelText, ctl, tip);
  const wrap = h(doc, 'div', 'mv-field');
  const label = h(doc, 'label', 'mv-field-label', labelText);
  ctl.id = `mdl-field-${++fieldSeq}`;
  label.htmlFor = ctl.id;
  if (tip) {
    const row = h(doc, 'div', 'label-row');
    row.append(label, infoTip(doc, labelText, tip));
    wrap.appendChild(row);
  } else wrap.appendChild(label);
  wrap.appendChild(box);
  return wrap;
}

/** A fold: P3's disclosure button (button.btn.btn-quiet.btn-sm.mdl-disc: chevron, span.mdl-disc-name, span.mdl-disc-sum)
 *  over `body`, which stays hidden until opened. The button wires its own click. */
function foldOf(doc, name, body, cls) {
  body.id = `mdl-fold-${++fieldSeq}`;
  body.hidden = true;
  const button = h(doc, 'button', `btn btn-quiet btn-sm mdl-disc ${cls}`);
  button.type = 'button';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', body.id);
  button.append(icon(doc, 'chevron', 14), h(doc, 'span', 'mdl-disc-name', name), h(doc, 'span', 'mdl-disc-sum'));
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
  });
  return button;
}

/**
 * The Connection block of the model form. `model` is the MASKED entry or null; `providers` the GET /api/providers
 * payload; `copilotModels` an optional list for the upstream-id datalist; `where` where the model runs (else its stored
 * connection: an upstream is a provider, env is routing env, anything else a sign-in); `provider` a new provider form's
 * Provider choice (copilot | openrouter | openai | anthropic; openrouter fills OpenRouter's address).
 * → div.mv-conn[data-where]: div.mv-conn-body (Provider with its state word, Upstream model id) and div.mv-conn-more,
 * two folds: "Connection" (the API segment over the hidden select, the model's own Base URL, API key and headers, the
 * OpenRouter routing) and "Capabilities and limits". The model form moves .mv-conn-more after Pricing.
 */
export function renderConnectionSection(model, { doc = globalThis.document, providers = null, copilotModels = [], where = '', provider = '' } = {}) {
  const editing = !!model;
  const upstream = editing && model.upstream ? model.upstream : null;
  const wrap = h(doc, 'div', 'mv-conn');
  wrap.dataset.where = WHERES.includes(where) ? where
    : upstream ? 'provider' : editing && model.env && Object.keys(model.env).length ? 'env' : 'signin';
  wrap.dataset.provider = upstream ? upstream.provider : '';
  // The stored upstream: collectConnection hands back what the form has no control for.
  if (upstream) wrap.dataset.upstream = JSON.stringify(upstream);
  stashReasoningEfforts(wrap, upstream);
  if (providers) wrap._providers = providers;   // OpenRouter's address and the state word (jsdom-safe expando)

  const body = h(doc, 'div', 'mv-conn-body');
  const grid = h(doc, 'div', 'mv-conn-grid');
  // An existing model shows OpenRouter when OpenRouter's row holds its key, and changes no field for it.
  const choice = upstream ? (providerRowOf(model, providers) === 'openrouter' ? 'openrouter' : upstream.provider)
    : PROVIDER_CHOICES.some(([v]) => v === provider) ? provider : 'copilot';
  const provSel = h(doc, 'select', 'select mv-conn-provider');
  for (const [value, text] of PROVIDER_CHOICES) {
    const o = h(doc, 'option', null, text); o.value = value;
    if (value === choice) o.selected = true;
    provSel.appendChild(o);
  }
  wrap.dataset.providerChoice = choice;   // the select's last value: only a change of it moves OpenRouter's address
  const provRow = h(doc, 'div', 'mv-conn-prov-row');
  const state = h(doc, 'span', 'mdl-st mv-conn-provider-hint');   // the provider's state word (models-view.mjs paints it)
  state.hidden = true;
  provRow.append(markedSelect(doc, provSel, 'provider'), state);   // FRM-1: the picked provider's mark inside it
  grid.appendChild(connField(doc, 'Provider', provSel, { box: provRow }));

  const modelIn = h(doc, 'input', 'input mv-conn-model');
  modelIn.type = 'text'; modelIn.placeholder = 'gpt-5, claude-sonnet-4.5, …';
  modelIn.value = upstream ? upstream.model : '';
  if (Array.isArray(copilotModels) && copilotModels.length) {
    const dl = h(doc, 'datalist');
    dl.id = `mv-conn-copilot-models-${editing ? model.id : 'new'}`;
    for (const m of copilotModels) {
      const o = h(doc, 'option'); o.value = m.id; o.label = `${m.name || m.id} · ${m.vendor || ''}${m.contextWindow ? ` · ${fmtK(m.contextWindow)}` : ''}`;
      dl.appendChild(o);
    }
    modelIn.setAttribute('list', dl.id);
    grid.appendChild(dl);
  }
  grid.appendChild(connField(doc, 'Upstream model id', modelIn, { tip: 'The id the endpoint expects. The model’s ID above stays Worca’s handle.' }));
  body.appendChild(grid);
  wrap.appendChild(body);

  // Connection: the API, the model's own address, key and headers, and OpenRouter's routing.
  const wire = h(doc, 'div', 'mv-conn-fold mv-conn-wire');
  const apiName = h(doc, 'span', 'mv-field-label', 'API');
  apiName.id = `mdl-field-${++fieldSeq}`;
  const apiSeg = h(doc, 'div', 'seg mv-conn-api-seg');
  apiSeg.setAttribute('role', 'group');
  apiSeg.setAttribute('aria-labelledby', apiName.id);
  const apiSel = h(doc, 'select', 'select mv-conn-api');
  apiSel.hidden = true;   // the segment drives it; the collector, app.js and the modal guard read it
  if (upstream) apiSel.dataset.keep = upstream.api;   // refilled by applyConnectionMode below
  const apiField = h(doc, 'div', 'mv-field');
  apiField.append(apiName, apiSeg, apiSel);
  wire.appendChild(apiField);
  const own = h(doc, 'div', 'mv-conn-own');   // never for Copilot: collectConnection sends none of it
  const bu = h(doc, 'input', 'input mv-conn-baseurl');
  bu.type = 'text'; bu.placeholder = 'leave empty to use the provider’s base URL';
  bu.value = upstream && upstream.baseUrl ? upstream.baseUrl : !upstream && choice === 'openrouter' ? OPENROUTER_PRESET.baseUrl : '';
  own.appendChild(connField(doc, 'Base URL', bu));
  const key = h(doc, 'input', 'input mv-conn-key');
  key.type = 'text'; key.placeholder = 'leave empty to use the provider’s key; or ${VAR}';
  key.value = upstream && upstream.apiKey ? upstream.apiKey : '';
  if (key.value) key.dataset.original = key.value;
  own.appendChild(connField(doc, 'API key', key));
  const hdr = h(doc, 'textarea', 'textarea mv-conn-headers');
  hdr.rows = 2; hdr.placeholder = 'One per line: Header-Name: value';
  hdr.value = upstream && upstream.headers ? Object.entries(upstream.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
  own.appendChild(connField(doc, 'Extra headers', hdr));
  wire.appendChild(own);
  // OpenRouter routing: shown only while the entry resolves to OpenRouter (applyConnectionMode).
  const orBox = h(doc, 'div', 'mv-conn-or');
  const orModels = h(doc, 'input', 'input mv-conn-or-models');
  orModels.type = 'text'; orModels.placeholder = 'e.g. qwen/qwen3.8-27b (comma-separated)';
  orBox.appendChild(connField(doc, 'Fallback models', orModels, { tip: 'Tried in order when this model is rate-limited or down (a :free model’s shared pool often is). Provider order and sort pick who serves it.' }));
  const orOrder = h(doc, 'input', 'input mv-conn-or-order');
  orOrder.type = 'text'; orOrder.placeholder = 'provider names, comma-separated (empty lets OpenRouter choose)';
  orBox.appendChild(connField(doc, 'Provider order', orOrder));
  const orSort = h(doc, 'select', 'select mv-conn-or-sort');
  for (const [value, text] of [['', 'OpenRouter default'], ['price', 'Price'], ['throughput', 'Throughput'], ['latency', 'Latency']]) {
    const o = h(doc, 'option', null, text); o.value = value; orSort.appendChild(o);
  }
  orBox.appendChild(connField(doc, 'Sort providers by', orSort));
  orBox.appendChild(makeSwitch(doc, { label: 'Allow other providers when these are unavailable', inputClass: 'mv-conn-or-fallbacks', rowClass: 'mv-conn-cap' }).row);
  wire.appendChild(orBox);
  fillOpenRouter(orBox, upstream && upstream.openrouter);

  // Capabilities and limits.
  const caps = h(doc, 'div', 'mv-conn-fold mv-conn-caps');
  const capsRow = h(doc, 'div', 'mv-conn-caps-row');
  const stored = upstream && upstream.capabilities ? upstream.capabilities : {};
  for (const [k, text] of CAPABILITY_FLAGS) {
    const lab = h(doc, 'label', 'mv-conn-cap');
    const cb = h(doc, 'input', 'mv-conn-cap-cb');
    cb.type = 'checkbox'; cb.dataset.cap = k;
    cb.checked = stored[k] === undefined ? (k === 'toolCalls') : !!stored[k];
    lab.appendChild(cb);
    lab.appendChild(h(doc, 'span', null, text));
    capsRow.appendChild(lab);
  }
  for (const [k, text] of [['maxPromptTokens', 'Prompt limit (tokens)'], ['maxOutputTokens', 'Output limit (tokens)']]) {
    const lab = h(doc, 'label', 'mv-conn-limit');
    lab.appendChild(h(doc, 'span', null, text));
    const inp = h(doc, 'input', 'input mv-conn-limit-in');
    inp.type = 'number'; inp.min = '1'; inp.step = '1'; inp.dataset.limit = k;
    inp.value = stored[k] ? String(stored[k]) : '';
    lab.appendChild(inp);
    capsRow.appendChild(lab);
  }
  caps.appendChild(capsRow);

  const more = h(doc, 'div', 'mv-conn-more');
  more.append(foldOf(doc, 'Connection', wire, 'mv-conn-disc'), wire, foldOf(doc, 'Capabilities and limits', caps, 'mv-caps-disc'), caps);
  wrap.appendChild(more);
  applyConnectionMode(wrap);
  return wrap;
}

/** The api options `apis` (what the provider and engine allow); keeps the current pick when still legal. → whether the
 *  option list changed. */
function refillApiSelect(sel, apis, keep) {
  const cur = keep || sel.value;
  const changed = [...sel.options].map((o) => o.value).join('\n') !== apis.join('\n');
  if (changed) {
    sel.replaceChildren(...apis.map((a) => {
      const o = sel.ownerDocument.createElement('option');
      o.value = a; o.textContent = API_LABELS[a] || a;
      return o;
    }));
  }
  sel.value = apis.includes(cur) ? cur : apis[0] || '';
  sel.disabled = apis.length <= 1;
  return changed;
}

/** The API segment over the hidden select: rebuilt when the option list changed (a rebuild on every apply would drop
 *  the focus), else only its pressed state repainted. */
function paintApiSeg(conn, sel, rebuild) {
  const seg = scopeOf(conn).querySelector('.mv-conn-api-seg');
  if (!seg) return;
  if (rebuild || seg.children.length !== sel.options.length) {
    seg.replaceChildren(...[...sel.options].map((o) => {
      const b = h(seg.ownerDocument, 'button', null, o.textContent);
      b.type = 'button';
      b.dataset.api = o.value;
      b.addEventListener('click', () => pickApi(conn, sel, o.value));
      return b;
    }));
  }
  for (const b of seg.children) {
    b.setAttribute('aria-pressed', String(b.dataset.api === sel.value));
    b.disabled = sel.disabled;
  }
}

/** A segment click: the select takes the api and sends a bubbling change, which app.js and the modal guard see. */
function pickApi(conn, sel, api) {
  if (sel.value === api) return;
  sel.value = api;
  applyConnectionMode(conn);
  const ev = sel.ownerDocument.createEvent('Event');
  ev.initEvent('change', true, false);
  sel.dispatchEvent(ev);
}

/** OpenRouter's address follows the Provider select: a change TO OpenRouter fills OPENROUTER_PRESET's address (the field
 *  empty or elsewhere), a change away clears an OpenRouter address; typing a URL never moves the select. Only a change
 *  counts: the select's last value rides conn.dataset.providerChoice. */
function followProviderChoice(conn, choice, scope) {
  const last = conn.dataset.providerChoice;
  if (!last || last === choice) return;
  const bu = scope.querySelector('.mv-conn-baseurl');
  if (!bu) return;
  if (choice === 'openrouter') {
    if (!isOpenRouterUrl(bu.value)) bu.value = OPENROUTER_PRESET.baseUrl;
  } else if (last === 'openrouter' && isOpenRouterUrl(bu.value)) bu.value = '';
}

/** The capabilities' words on the fold, in CAPABILITY_FLAGS' order. */
const CAPABILITY_WORDS = Object.freeze([['toolCalls', 'tools'], ['vision', 'vision'], ['reasoning', 'reasoning']]);
/** 272000 → "272k", 1048576 → "1M". */
const tokenCount = (n) => (n >= 1e6 ? `${Math.round(n / 1e5) / 10}M` : `${Math.round(n / 1000)}k`);

/** The folds' summaries: "OpenAI Responses · own address" and "Tools, vision · 272k prompt" (or "No capabilities"). */
function paintFoldSums(scope, provider, api) {
  const connSum = scope.querySelector('.mv-conn-disc .mdl-disc-sum');
  if (connSum) {
    const own = provider !== 'copilot' && (scope.querySelector('.mv-conn-baseurl')?.value || '').trim();
    connSum.textContent = `${API_LABELS[api] || api}${own ? ' · own address' : ''}`;
  }
  const capsSum = scope.querySelector('.mv-caps-disc .mdl-disc-sum');
  if (capsSum) {
    const on = CAPABILITY_WORDS.filter(([k]) => scope.querySelector(`.mv-conn-cap-cb[data-cap="${k}"]`)?.checked).map(([, w]) => w).join(', ');
    const prompt = Number((scope.querySelector('.mv-conn-limit-in[data-limit="maxPromptTokens"]')?.value || '').trim());
    const words = [on ? on.charAt(0).toUpperCase() + on.slice(1) : 'No capabilities'];
    if (prompt > 0) words.push(`${tokenCount(prompt)} prompt`);
    capsSum.textContent = words.join(' · ');
  }
}

/**
 * Apply the Connection rules to the form (§8.3): the provider fields and the folds show only for a provider, the
 * model's own address, key and headers only off Copilot, the API list follows the provider, the summaries follow the
 * fields, and the effort checkboxes in the SAME editor collapse to medium for a translated model without reasoning.
 * The single place that knows these rules — the initial render and app.js's delegated `change` handler both call it.
 * @param {Element} connEl  the .mv-conn root (or any ancestor containing one)
 */
export function applyConnectionMode(connEl) {
  const conn = connEl && (connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector && connEl.querySelector('.mv-conn'));
  if (!conn) return;
  const scope = scopeOf(conn);
  // The model's engine (conn.dataset.engine, set by models-view setModelEngine) decides where it may run (wheresFor). A
  // new form or a copy holds the form's engine, and a where that engine cannot reach makes it Claude Code's (models-view
  // applyConnectionModeIn moves the harness). An entry being edited keeps its engine: such a where falls back to its
  // own sign-in. A Codex model: the OpenAI-compatible provider only, the Responses API only, none of the bridge's pins.
  const eng = conn.dataset.engine || 'claude';
  const where = connectionWhere(conn);
  const held = conn.dataset.editing !== '1' && !wheresFor(eng).includes(where) ? 'claude' : eng;
  if (!wheresFor(held).includes(where)) { setConnectionWhere(conn, 'signin'); return; }
  const mode = MODE_OF[where];
  const codex = held === 'codex';
  const ownSignIn = SIGN_IN_ENGINE_NAMES.includes(held) || held === 'copilot';   // a sign-in only: no endpoint fields
  const reaches = !ownSignIn && mode === 'provider';
  const body = conn.querySelector('.mv-conn-body');
  if (body) body.hidden = !reaches;
  const more = scope.querySelector('.mv-conn-more');
  if (more) more.hidden = !reaches;
  const provSel = scope.querySelector('.mv-conn-provider');
  if (provSel) {
    followProviderChoice(conn, provSel.value, scope);
    for (const o of provSel.options) o.hidden = o.disabled = codex && o.value !== 'openai';
    if (codex) provSel.value = 'openai';
    provSel.disabled = codex;
    conn.dataset.providerChoice = provSel.value;
  }
  const provider = apiProvider(provSel?.value || 'copilot');
  conn.dataset.provider = mode === 'provider' ? provider : '';
  const apiSel = scope.querySelector('.mv-conn-api');
  if (apiSel) {
    const rebuilt = refillApiSelect(apiSel, codex ? CODEX_PROVIDER_APIS : PROVIDER_APIS[provider] || [], apiSel.dataset.keep || apiSel.value);
    delete apiSel.dataset.keep;
    paintApiSeg(conn, apiSel, rebuilt);
  }
  const api = apiSel ? apiSel.value : '';
  const own = scope.querySelector('.mv-conn-own');
  if (own) own.hidden = provider === 'copilot';
  const orBox = scope.querySelector('.mv-conn-or');
  if (orBox) orBox.hidden = codex || ownSignIn || !openRouterApplies(conn);
  const capsOff = codex || ownSignIn;
  const capsDisc = scope.querySelector('.mv-caps-disc');
  if (capsDisc) capsDisc.hidden = capsOff;
  const capsBox = scope.querySelector('.mv-conn-caps');
  if (capsBox) capsBox.hidden = capsOff || capsDisc?.getAttribute('aria-expanded') !== 'true';
  paintFoldSums(scope, provider, api);
  const reasoning = !!scope.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]')?.checked;
  // Efforts live in the editor grid beside this block.
  const editor = conn.closest ? conn.closest('.mv-editor') : null;
  const effCbs = editor ? [...editor.querySelectorAll('.mv-effort-cb')] : [];
  const effHint = editor ? editor.querySelector('.mv-efforts-hint') : null;
  const translated = !codex && mode === 'provider' && TRANSLATED_APIS.includes(api);
  const translatedNoReasoning = translated && !reasoning;
  // The model's own effort levels (carried from Import): offer only the Worca efforts it lists.
  const levels = translated && reasoning ? storedReasoningEfforts(conn, provider) : null;
  const offered = levels ? effCbs.map((cb) => cb.value).filter((v) => levels.includes(v)) : null;
  const allowed = offered && !offered.length ? ['medium'] : offered;
  for (const cb of effCbs) {
    if (translatedNoReasoning) {
      cb.disabled = cb.value !== 'medium';
      if (cb.value !== 'medium') cb.checked = false; else cb.checked = true;
    } else if (allowed) {
      cb.disabled = !allowed.includes(cb.value);
      if (cb.disabled) cb.checked = false;
    } else cb.disabled = false;
  }
  // Every stored effort fell outside the model's levels: offer its levels rather than
  // save an empty list (the server reads empty as every effort, the disabled ones too).
  if (allowed && !effCbs.some((cb) => cb.checked)) for (const cb of effCbs) if (allowed.includes(cb.value)) cb.checked = true;
  if (effHint) {
    effHint.textContent = translatedNoReasoning
      ? 'This model has no reasoning control, so only medium is offered.'
      : levels ? `Maps to this model's levels: ${levels.join(', ')}.`   // ≤ 80 with all seven (L18)
        : translated ? 'Maps to reasoning_effort low / medium / high (xhigh and max are not distinct).'
          : 'All checked = every effort (the default).';
  }
}

/** Load a stored upstream into a rendered Connection block (Edit a copy, import prefill); null leaves for the sign-in. */
export function setModelUpstream(connEl, upstream) {
  const conn = connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector('.mv-conn');
  if (!conn) return;
  const scope = scopeOf(conn);
  stashReasoningEfforts(conn, upstream);
  if (upstream) conn.dataset.upstream = JSON.stringify(upstream);
  else delete conn.dataset.upstream;
  if (upstream) {
    // The select shows OpenRouter as a render does; a load is no change of it, so no address moves.
    const prov = scope.querySelector('.mv-conn-provider');
    if (prov) {
      prov.value = providerRowOf({ upstream }, conn._providers) === 'openrouter' ? 'openrouter' : upstream.provider;
      conn.dataset.providerChoice = prov.value;
    }
    const api = scope.querySelector('.mv-conn-api'); if (api) api.dataset.keep = upstream.api;
    const model = scope.querySelector('.mv-conn-model'); if (model) model.value = upstream.model || '';
    const bu = scope.querySelector('.mv-conn-baseurl'); if (bu) bu.value = upstream.baseUrl || '';
    const key = scope.querySelector('.mv-conn-key'); if (key) { key.value = upstream.apiKey || ''; if (key.value) key.dataset.original = key.value; }
    const hdr = scope.querySelector('.mv-conn-headers'); if (hdr) hdr.value = upstream.headers ? Object.entries(upstream.headers).map(([k, v]) => `${k}: ${v}`).join('\n') : '';
    fillOpenRouter(scope, upstream.openrouter);
    const caps = upstream.capabilities || {};
    for (const cb of scope.querySelectorAll('.mv-conn-cap-cb')) cb.checked = caps[cb.dataset.cap] === undefined ? cb.dataset.cap === 'toolCalls' : !!caps[cb.dataset.cap];
    for (const inp of scope.querySelectorAll('.mv-conn-limit-in')) inp.value = caps[inp.dataset.limit] ? String(caps[inp.dataset.limit]) : '';
  }
  setConnectionWhere(conn, upstream ? 'provider' : 'signin');
}

/** The upstream keys the form always decides: collected, or dropped on purpose (a hidden OpenRouter block, a Codex
 *  model's capability pins). */
const DRAWN_KEYS = new Set(['provider', 'api', 'model', 'openrouter', 'capabilities']);
/** The keys the form decides off Copilot only (a Copilot model has none of these fields). */
const OWN_KEYS = new Set(['baseUrl', 'apiKey', 'headers']);

/** The stored upstream's keys the form has no control for (today: a Copilot model's headers) come back unchanged while
 *  the provider and the upstream model are the stored ones: PATCH replaces `upstream` whole. */
function keepUndrawn(conn, upstream) {
  let stored = null;
  try { stored = JSON.parse(conn.dataset.upstream || 'null'); } catch { stored = null; }
  if (!stored || typeof stored !== 'object') return;
  if (stored.provider !== upstream.provider || String(stored.model || '').trim() !== upstream.model) return;
  for (const [k, v] of Object.entries(stored)) {
    if (DRAWN_KEYS.has(k) || k in upstream || (OWN_KEYS.has(k) && upstream.provider !== 'copilot')) continue;
    upstream[k] = v;
  }
}

/**
 * Collect the Connection block: `{ upstream }` where upstream is the object to
 * store, or null to clear (the form shows the truth, like Pricing's 'cli').
 * A masked key echo is sent as-is; the server treats it as "keep".
 */
export function collectConnection(connEl) {
  const conn = connEl.classList && connEl.classList.contains('mv-conn') ? connEl : connEl.querySelector('.mv-conn');
  if (!conn) return { upstream: undefined };
  if (modeOf(conn) !== 'provider') return { upstream: null };
  const scope = scopeOf(conn);
  const codex = conn.dataset.engine === 'codex';
  const provider = codex ? 'openai' : apiProvider(scope.querySelector('.mv-conn-provider')?.value || 'copilot');
  const api = scope.querySelector('.mv-conn-api')?.value || '';
  const model = (scope.querySelector('.mv-conn-model')?.value || '').trim();
  const upstream = { provider, api, model };
  if (provider !== 'copilot') {
    const bu = (scope.querySelector('.mv-conn-baseurl')?.value || '').trim();
    if (bu) upstream.baseUrl = bu;
    const key = (scope.querySelector('.mv-conn-key')?.value || '').trim();
    if (key) upstream.apiKey = key;
    const lines = (scope.querySelector('.mv-conn-headers')?.value || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const headers = {};
    for (const l of lines) {
      const i = l.indexOf(':');
      if (i > 0) headers[l.slice(0, i).trim()] = l.slice(i + 1).trim();
    }
    if (Object.keys(headers).length) upstream.headers = headers;
    // Only while the entry resolves to OpenRouter: another endpoint would reject the fields.
    const or = !codex && openRouterApplies(conn) ? collectOpenRouter(conn) : undefined;
    if (or) upstream.openrouter = or;
  }
  keepUndrawn(conn, upstream);
  if (codex) return { upstream };   // the capability pins steer the bridge only
  const capabilities = {};
  for (const cb of scope.querySelectorAll('.mv-conn-cap-cb')) capabilities[cb.dataset.cap] = !!cb.checked;
  for (const inp of scope.querySelectorAll('.mv-conn-limit-in')) {
    const v = (inp.value || '').trim();
    if (v !== '') capabilities[inp.dataset.limit] = Number(v);
  }
  // The model's effort levels ride along unedited while it stays a translated reasoning model on the same provider.
  const levels = storedReasoningEfforts(conn, provider);
  if (levels && capabilities.reasoning && TRANSLATED_APIS.includes(api)) capabilities.reasoningEfforts = levels;
  upstream.capabilities = capabilities;
  return { upstream };
}

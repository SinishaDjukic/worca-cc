// test/models-provider-state.test.mjs — the Providers tab's state words and folded summary lines (models-menu P3
// Task 1): providerState / providerSummary / providerModelCounts (ui/public/models/provider-state.mjs) and the broker
// pill's pure state, brokerState (ui/public/bridge-view.mjs), which the pill in each provider row's body is built from.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { providerState, providerSummary, providerModelCounts } from '../ui/public/models/provider-state.mjs';
import { brokerState, renderCopilotRow, renderOpenRouterRow, renderEndpointRow } from '../ui/public/bridge-view.mjs';
import { PROVIDER_ROWS } from '../ui/public/models/page-tabs.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM(''); doms.push(d); return d.window.document; };

/** GET /api/providers with all eight blocks: nothing set up, broker off. */
const base = Object.freeze({
  copilot: { connected: false, login: null, accountType: 'individual', maxConcurrent: 4, tokenSource: null, tokenRef: null },
  openrouter: { keySet: false, keySource: null, keyRef: null, keyMasked: null, legacyKey: false, maxConcurrent: 8 },
  openai: { configured: false, keyOptional: false, keySet: false, keySource: null, keyRef: null, baseUrl: 'https://api.openai.com/v1', maxConcurrent: 8 },
  anthropic: { configured: false, keyOptional: false, keySet: false, keySource: null, keyRef: null, baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
  speech: {
    stt: { engine: 'browser', configured: true, keySet: false, keyMissing: false, keyRef: null },
    tts: { engine: 'browser', configured: true, keySet: false, keyMissing: false, keyRef: null },
    cacheBytes: null,
  },
  images: { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'm-1', price: 0.04, keySet: true, keyMissing: false, configured: false },
  sound: { service: 'elevenlabs', configured: false, keySet: false, keyMissing: false },
  broker: { enabled: false },
});

/** The payload with `patch` merged into one block. */
const withBlock = (name, patch) => ({ ...base, [name]: { ...base[name], ...patch } });
/** providerState for one row, with `patch` merged into that row's block. */
const st = (name, patch = {}, opts) => providerState(withBlock(name, patch), name, opts);
const S = (tone, text, fix = '') => ({ tone, text, fix });
const KEY_PAGE = 'https://keys.example/';
const brokered = (broker, name) => providerState({ ...base, broker: { enabled: true, keyPage: KEY_PAGE, ...broker } }, name);

test('copilot: connected, a token variable that is not set, needs sign-in when models use it, else not connected', () => {
  assert.deepEqual(st('copilot', { connected: true }), S('ok', 'Connected'));
  assert.deepEqual(st('copilot', { tokenSource: 'env', tokenRef: '${GH_TOKEN}' }), S('fail', 'Token ${GH_TOKEN} not set'));
  assert.deepEqual(st('copilot', {}, { hasModels: true }), S('need', 'Needs sign-in', 'Sign in'));
  assert.deepEqual(st('copilot'), S('off', 'Not connected'));
});

test('openrouter: a lent key, its own key, a key variable that is not set, needs a key when models use it, else no key', () => {
  assert.deepEqual(st('openrouter', { legacyKey: true, keySet: true }), S('ok', 'Key from OpenAI-compatible'));
  assert.deepEqual(st('openrouter', { keySet: true }), S('ok', 'Key set'));
  assert.deepEqual(st('openrouter', { legacyKey: true, keySet: false, keySource: 'env', keyRef: '${OPENAI_KEY}' }), S('fail', 'Key ${OPENAI_KEY} not set'));
  assert.deepEqual(st('openrouter', {}, { hasModels: true }), S('need', 'Needs key', 'Set key'));
  assert.deepEqual(st('openrouter'), S('off', 'No key'));
});

test('openai and anthropic: key set, a key variable that is not set (the ref once), a local address, needs key, no key', () => {
  for (const name of ['openai', 'anthropic']) {
    assert.deepEqual(st(name, { keySet: true, configured: true }), S('ok', 'Key set'), name);
    assert.deepEqual(st(name, { keySet: true, configured: false, keySource: 'env', keyRef: '${OPENAI_KEY}' }), S('fail', 'Key ${OPENAI_KEY} not set'), name);
    assert.deepEqual(st(name, {}, { hasModels: true }), S('need', 'Needs key', 'Set key'), name);
    assert.deepEqual(st(name), S('off', 'No key'), name);
  }
  assert.deepEqual(st('openai', { keyOptional: true }), S('ok', 'Local, no key needed'));
  assert.deepEqual(st('openai', { keyOptional: true }, { hasModels: true }), S('ok', 'Local, no key needed'));
});

test('broker on: the pill\'s words, first letter capitalised; green is ok, red is fail, add-your is need, other grey is off', () => {
  assert.deepEqual(brokered({ providers: { openai: { state: 'invalid' } } }, 'openai'), S('fail', 'Your key was rejected'));
  assert.deepEqual(brokered({ providers: { openai: { state: 'set', suffix: 'abcd' } } }, 'openai'), S('ok', 'Your key ••••abcd'));
  assert.deepEqual(brokered({ providers: { openai: { state: 'operator' } } }, 'openai'), S('ok', 'Team key'));
  assert.deepEqual(brokered({ providers: { openai: { state: 'keyless' } } }, 'openai'), S('ok', 'Local, no key needed'));
  assert.deepEqual(brokered({ providers: { openai: { state: 'none', error: 'no slot' } } }, 'openai'), S('fail', 'No broker slot for this URL'));
  assert.deepEqual(brokered({ providers: {} }, 'openai'), S('need', 'Add your key on the key page'));
  assert.deepEqual(brokered({ keyPage: null, providers: { openrouter: { state: 'missing' } } }, 'openrouter'), S('need', 'Add your key on the key page'));
  assert.deepEqual(brokered({ providers: {} }, 'copilot'), S('need', 'Add your sign-in on the key page'));
  assert.deepEqual(brokered({ signInNeeded: true, providers: {} }, 'anthropic'), S('off', 'Sign in to see your key'));
  assert.deepEqual(brokered({ error: 'ECONNREFUSED', providers: { openai: { slot: 's' } } }, 'openai'), S('off', 'Key page unreachable'));
  // The broker outranks the row's own settings, and hasModels never turns its words into a fix.
  const on = { ...withBlock('openai', { keySet: true, configured: true }), broker: { enabled: true, keyPage: KEY_PAGE, providers: { openai: { state: 'invalid' } } } };
  assert.deepEqual(providerState(on, 'openai', { hasModels: true }), S('fail', 'Your key was rejected'));
  // Speech, images and sound ignore the broker, as today's badges do.
  const all = { ...base, broker: { enabled: true, keyPage: KEY_PAGE, signInNeeded: true, providers: {} } };
  assert.deepEqual(providerState(all, 'speech'), S('ok', 'In the browser'));
  assert.deepEqual(providerState({ ...all, images: { ...base.images, configured: true } }, 'images'), S('ok', 'Ready'));
  assert.deepEqual(providerState({ ...all, sound: { ...base.sound, configured: true } }, 'sound'), S('ok', 'Ready'));
});

test('brokerState: text, class, link and title, branch by branch', () => {
  const LINK_TITLE = 'Opens the key page in a new tab. Reopen this tab afterwards to see the change.';
  const B = (broker) => ({ enabled: true, keyPage: KEY_PAGE, ...broker });
  const rows = [
    [B({ signInNeeded: true, providers: { openai: { state: 'invalid' } } }), 'openai', { text: 'sign in to see your key', cls: 'grey', link: false, title: '' }],
    [B({ signInNeeded: true }), 'copilot', { text: 'sign in to see your sign-in', cls: 'grey', link: false, title: '' }],
    [B({ providers: { openai: { state: 'none', error: 'no slot here' } } }), 'openai', { text: 'no broker slot for this URL', cls: 'red', link: false, title: 'no slot here' }],
    [B({ providers: { openai: { state: 'none' } } }), 'openai', { text: 'no broker slot for this URL', cls: 'red', link: false, title: 'The credential broker has no slot for this base URL.' }],
    [B({ error: 'down', providers: { openai: { state: 'keyless' } } }), 'openai', { text: 'local, no key needed', cls: 'green', link: false, title: '' }],
    [B({ error: 'ECONNREFUSED', providers: { openai: { slot: 's' } } }), 'openai', { text: 'key page unreachable', cls: 'grey', link: false, title: 'ECONNREFUSED' }],
    [B({ providers: { openai: { state: 'set', suffix: 'abcd' } } }), 'openai', { text: 'your key ••••abcd', cls: 'green', link: false, title: '' }],
    [B({ providers: { copilot: { state: 'set' } } }), 'copilot', { text: 'your sign-in', cls: 'green', link: false, title: '' }],
    [B({ providers: { anthropic: { state: 'operator' } } }), 'anthropic', { text: 'team key', cls: 'green', link: false, title: '' }],
    [B({ providers: { openai: { state: 'invalid' } } }), 'openai', { text: 'your key was rejected', cls: 'red', link: true, title: LINK_TITLE }],
    [B({ keyPage: null, providers: { openai: { state: 'invalid' } } }), 'openai', { text: 'your key was rejected', cls: 'red', link: false, title: '' }],
    [B({ providers: { openrouter: { state: 'missing' } } }), 'openrouter', { text: 'add your key on the key page', cls: 'grey', link: true, title: LINK_TITLE }],
    [B({ keyPage: null }), 'openrouter', { text: 'add your key on the key page', cls: 'grey', link: false, title: '' }],
  ];
  for (const [broker, name, want] of rows) assert.deepEqual(brokerState(broker, name), want, `${name} ${JSON.stringify(broker)}`);
  assert.deepEqual(brokerState(undefined, 'openai'), { text: 'add your key on the key page', cls: 'grey', link: false, title: '' });
});

test('a provider row\'s broker pill is built from brokerState with today\'s DOM', () => {
  const doc = docOf();
  /** The four provider rows' body builders, each called as (providers, { doc }). */
  const BODY = {
    copilot: renderCopilotRow,
    openrouter: renderOpenRouterRow,
    openai: (p, o) => renderEndpointRow(p, 'openai', o),
    anthropic: (p, o) => renderEndpointRow(p, 'anthropic', o),
  };
  const LINK = 'href="https://keys.example/" target="_blank" rel="noopener" title="Opens the key page in a new tab. Reopen this tab afterwards to see the change."';
  const rows = [
    ['openai', { keyPage: KEY_PAGE, providers: { openai: { state: 'invalid' } } }, `<a class="badge red mv-broker-pill" ${LINK}>your key was rejected</a>`],
    ['openai', { keyPage: KEY_PAGE, providers: {} }, `<a class="badge grey mv-broker-pill" ${LINK}>add your key on the key page</a>`],
    ['openai', { providers: { openai: { state: 'missing' } } }, '<span class="badge grey">add your key on the key page</span>'],
    ['openai', { keyPage: KEY_PAGE, providers: { openai: { state: 'none', error: 'no slot here' } } }, '<span class="badge red" title="no slot here">no broker slot for this URL</span>'],
    ['anthropic', { keyPage: KEY_PAGE, providers: { anthropic: { state: 'none' } } }, '<span class="badge red" title="The credential broker has no slot for this base URL.">no broker slot for this URL</span>'],
    ['openai', { keyPage: KEY_PAGE, error: 'ECONNREFUSED', providers: { openai: { slot: 'x' } } }, '<span class="badge grey" title="ECONNREFUSED">key page unreachable</span>'],
    ['openai', { keyPage: KEY_PAGE, providers: { openai: { state: 'set', suffix: 'abcd' } } }, '<span class="badge green">your key ••••abcd</span>'],
    ['openai', { keyPage: KEY_PAGE, providers: { openai: { state: 'operator' } } }, '<span class="badge green">team key</span>'],
    ['openai', { keyPage: KEY_PAGE, providers: { openai: { state: 'keyless' } } }, '<span class="badge green">local, no key needed</span>'],
    ['copilot', { keyPage: KEY_PAGE, signInNeeded: true, providers: {} }, '<span class="badge grey">sign in to see your sign-in</span>'],
    ['copilot', { keyPage: KEY_PAGE, providers: { copilot: { state: 'set' } } }, '<span class="badge green">your sign-in</span>'],
    ['openrouter', { keyPage: KEY_PAGE, providers: { openrouter: { state: 'invalid' } } }, `<a class="badge red mv-broker-pill" ${LINK}>your key was rejected</a>`],
  ];
  for (const [name, broker, html] of rows) {
    const row = BODY[name]({ broker: { enabled: true, ...broker } }, { doc });
    assert.ok(row.matches(`.mv-pv-row[data-provider="${name}"]`), name);
    const box = row.querySelector(':scope > .mv-pv-broker');
    assert.equal(box.children[0].outerHTML, html, `${name} ${JSON.stringify(broker)}`);
  }
});

test('speech: in the browser, a configured server side, a server side not configured, a server key variable not set', () => {
  const sp = (stt, tts) => st('speech', { stt: { ...base.speech.stt, ...stt }, tts: { ...base.speech.tts, ...tts } });
  assert.deepEqual(st('speech'), S('ok', 'In the browser'));
  assert.deepEqual(sp({}, { engine: 'off', configured: false }), S('ok', 'In the browser'));
  assert.deepEqual(sp({ engine: 'server', configured: true }, {}), S('ok', 'Configured'));
  assert.deepEqual(sp({ engine: 'server', configured: true }, { engine: 'server', configured: false }), S('need', 'Not configured'));
  assert.deepEqual(sp({}, { engine: 'server', configured: false }), S('need', 'Not configured'));
  assert.deepEqual(sp({ engine: 'server', configured: true, keyMissing: true, keyRef: '${STT}' }, {}), S('fail', 'Key ${STT} not set'));
  assert.deepEqual(sp({ engine: 'server', configured: false }, { engine: 'server', configured: true, keyMissing: true, keyRef: '${TTS}' }), S('fail', 'Key ${TTS} not set'));
  // A browser side's leftover key is not the row's problem.
  assert.deepEqual(sp({ keyMissing: true, keyRef: '${STT}' }, {}), S('ok', 'In the browser'));
});

test('images: ready, never saved, address, model, price and key missing, else not set up', () => {
  assert.deepEqual(st('images', { configured: true }), S('ok', 'Ready'));
  assert.deepEqual(st('images', { price: null, keySet: false }), S('off', 'Not set up'));
  assert.deepEqual(st('images', { service: 'other', baseUrl: '' }), S('need', 'Address missing'));
  // Only Other's address is yours to fill in: a preset service is never "Address missing".
  assert.deepEqual(st('images', { baseUrl: '' }), S('off', 'Not set up'));
  assert.deepEqual(st('images', { service: 'other', baseUrl: 'http://x', model: '' }), S('need', 'Model missing'));
  // A service with a model list has a model to pick, the row's own word.
  assert.deepEqual(st('images', { service: 'openrouter', model: '' }), S('need', 'Pick a model'));
  assert.deepEqual(st('images', { service: 'other', baseUrl: 'http://x', model: 'm', price: null }), S('need', 'Price missing'));
  assert.deepEqual(st('images', { price: null }), S('need', 'Price missing'));
  assert.deepEqual(st('images', { keyMissing: true }), S('fail', 'Key missing'));
  assert.deepEqual(st('images', { keySet: false }), S('need', 'Key missing'));
  assert.deepEqual(st('images', { service: 'other', baseUrl: 'https://img.example/v1', model: 'm', keySet: false }), S('need', 'Key missing'));
  assert.deepEqual(st('images'), S('off', 'Not set up'));
});

test('sound: ready, a key variable that is not set, else not set up', () => {
  assert.deepEqual(st('sound', { configured: true, keySet: true }), S('ok', 'Ready'));
  assert.deepEqual(st('sound', { keySet: true, keyMissing: true }), S('fail', 'Key missing'));
  assert.deepEqual(st('sound'), S('off', 'Not set up'));
});

test('summaries: account or host, requests at a time and the model count; the three fixed lines', () => {
  assert.equal(providerSummary(base, 'copilot', { copilot: 3 }), 'Individual · 4 requests at a time · 3 models');
  assert.equal(providerSummary(withBlock('copilot', { accountType: 'business', maxConcurrent: 2 }), 'copilot'), 'Business · 2 requests at a time');
  assert.equal(providerSummary(base, 'openrouter', { openrouter: 1 }), 'openrouter.ai · 8 requests at a time · 1 model');
  assert.equal(providerSummary(withBlock('openai', { baseUrl: 'http://127.0.0.1:11434/v1' }), 'openai'), '127.0.0.1:11434 · 8 requests at a time');
  assert.equal(providerSummary(base, 'openai', { openai: 0 }), 'api.openai.com · 8 requests at a time');
  assert.equal(providerSummary(withBlock('anthropic', { maxConcurrent: 3 }), 'anthropic', { anthropic: 2 }), 'api.anthropic.com · 3 requests at a time · 2 models');
  assert.equal(providerSummary(base, 'speech'), 'Chat voice · speech-to-text and text-to-speech');
  assert.equal(providerSummary(base, 'images'), 'Design pictures · OpenAI · m-1');
  assert.equal(providerSummary(withBlock('images', { service: 'other', model: '' }), 'images'), 'Design pictures · Other (OpenAI-compatible)');
  assert.equal(providerSummary(base, 'sound'), 'Design voice and music · ElevenLabs');
  // Counts are per row: another row's models never land on this line.
  assert.equal(providerSummary(base, 'openai', { copilot: 5, openrouter: 2 }), 'api.openai.com · 8 requests at a time');
});

test('the {} payload: every row has a state and a summary; an unparsable address is shown as written', () => {
  for (const name of PROVIDER_ROWS) {
    for (const p of [{}, undefined, null]) {
      const s = providerState(p, name);
      assert.ok(['ok', 'need', 'fail', 'off'].includes(s.tone), `${name} tone`);
      assert.equal(typeof s.text, 'string', `${name} text`);
      assert.ok(s.text, `${name} text`);
      assert.equal(typeof providerSummary(p, name), 'string', `${name} summary`);
    }
  }
  assert.deepEqual(providerState({}, 'copilot'), S('off', 'Not connected'));
  assert.deepEqual(providerState({}, 'openai'), S('off', 'No key'));
  assert.deepEqual(providerState({}, 'images'), S('off', 'Not set up'));
  assert.equal(providerSummary({}, 'copilot'), 'Individual · 4 requests at a time');
  assert.equal(providerSummary({}, 'openrouter'), 'openrouter.ai · 8 requests at a time');
  assert.equal(providerSummary({}, 'images'), 'Design pictures · OpenAI');
  const bad = providerSummary({ openai: { baseUrl: 'not a url' } }, 'openai');
  assert.ok(bad.startsWith('not a url'), bad);
  assert.equal(bad, 'not a url · 8 requests at a time');
});

test('providerModelCounts: models per provider row by providerRowOf; other rows are not counted', () => {
  const providers = withBlock('openai', { baseUrl: 'https://openrouter.ai/api/v1' });
  const models = [
    { id: 'cp', upstream: { provider: 'copilot', model: 'gpt-5' } },
    { id: 'or', upstream: { provider: 'openai', model: 'x/y' } },
    { id: 'plain' },
  ];
  assert.deepEqual(providerModelCounts(models, providers), { copilot: 1, openrouter: 1, openai: 0, anthropic: 0 });
  assert.deepEqual(providerModelCounts([
    { upstream: { provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1' } },
    { upstream: { provider: 'anthropic' } },
    { upstream: { provider: 'anthropic' } },
    { upstream: { provider: 'gemini' } },
    null,
  ], {}), { copilot: 0, openrouter: 0, openai: 1, anthropic: 2 });
  assert.deepEqual(providerModelCounts(undefined, undefined), { copilot: 0, openrouter: 0, openai: 0, anthropic: 0 });
});

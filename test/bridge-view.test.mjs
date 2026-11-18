// test/bridge-view.test.mjs
// The model bridge's pure renderers (model-bridge-design.md §8): Providers
// row states, the sign-in block, the import sheet + select-all + collect,
// the editor Connection section (mode reveal, provider→api coupling, Advanced
// only for key-based providers, efforts collapse for a translated model
// without reasoning), collect/set round-trips, the bridge badges, a bridged model in the Catalogue (its row, its
// provider's state and its side panel: catalogue-model.mjs) and renderModelEditor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import {
  collectProviderRow, renderCopilotSignIn, renderImportSheet, collectImportSheet, applyImportSelectAll,
  renderConnectionSection, applyConnectionMode, setModelUpstream, collectConnection,
  bridgedBadge, needsSignInPill, degradationLine,
  renderCopilotRow, renderOpenRouterRow, renderEndpointRow, renderSpeechRow, renderImagesRow, renderSoundRow,
  collectImagesRow, applyImagesPreset,
} from '../ui/public/bridge-view.mjs';
import { renderModelEditor, collectModelEditor, applyConnectionModeIn } from '../ui/public/models-view.mjs';
import { buildCatalogue, buildModelPanel } from '../ui/public/models/catalogue-model.mjs';
import { PROVIDER_ROWS } from '../ui/public/models/page-tabs.mjs';
import { renderProvidersTab } from '../ui/public/models/providers-tab.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const PROVIDERS = {
  copilot: { connected: true, login: 'octo', accountType: 'business', maxConcurrent: 3, tokenSource: 'stored', quota: { used: 12, entitlement: 300, unlimited: false, resetDate: '2026-10-01' } },
  openai: { configured: true, keySet: true, keySource: 'stored', keyMasked: '••••••abcd', baseUrl: 'https://gw.example/v1', maxConcurrent: 8 },
  anthropic: { configured: false, keySet: true, keySource: 'env', keyRef: '${ANT}', baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
};
/** GET /api/providers with all eight blocks: Copilot signed in (business), images on OpenAI, the broker off. */
const P = Object.freeze({
  copilot: { connected: true, login: 'octo', accountType: 'business', maxConcurrent: 4, tokenSource: 'stored', tokenRef: null, quota: { used: 12, entitlement: 300, unlimited: false, resetDate: '2026-10-01' } },
  openrouter: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••1234', legacyKey: false, maxConcurrent: 8, order: ['anthropic'], sort: 'price', allowFallbacks: true },
  openai: { configured: true, keyOptional: false, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••abcd', baseUrl: 'https://gw.example/v1', maxConcurrent: 8 },
  anthropic: { configured: false, keyOptional: false, keySet: true, keySource: 'env', keyRef: '${ANT}', keyMasked: null, baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
  speech: {
    stt: { engine: 'server', baseUrl: 'http://127.0.0.1:8080/v1', model: 'whisper-1', language: 'bg', configured: true, keySet: true, keySource: 'stored', keyMasked: '••••••abcd', keyRef: null, keyMissing: false },
    tts: { engine: 'browser', baseUrl: '', model: 'tts-1', voice: 'af_heart', speed: 1, configured: false, keySet: false, keySource: null, keyMasked: null, keyRef: null, keyMissing: false },
    cacheBytes: 480e6,
  },
  images: { service: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-image-2.6-flare', price: 0.04, configured: true, keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••efgh', keyMissing: false },
  sound: { keySet: true, keySource: 'stored', keyRef: null, keyMasked: '••••••cdef', keyMissing: false, configured: true },
  broker: { enabled: false },
});
const KEY_PAGE = 'https://keys.example/';
const BROKER = Object.freeze({ ...P, broker: { enabled: true, keyPage: KEY_PAGE, providers: {} } });
/** One builder per PROVIDER_ROWS member, each called as (providers, { doc }). */
const BUILDERS = {
  copilot: renderCopilotRow,
  openrouter: renderOpenRouterRow,
  openai: (p, o) => renderEndpointRow(p, 'openai', o),
  anthropic: (p, o) => renderEndpointRow(p, 'anthropic', o),
  speech: renderSpeechRow,
  images: renderImagesRow,
  sound: renderSoundRow,
};
/** The muted lines a row's main column shows, the status line left out (an empty line shows nothing). */
const lines = (row) => [...row.querySelectorAll('.mv-pv-main > small.hint:not(.mv-pv-msg)')].map((s) => s.textContent).filter(Boolean);

test('the Providers tab\'s Copilot row: not connected / connected states; sign-in block replaces the button; no notice anywhere', () => {
  const tab = renderProvidersTab({ copilot: { connected: false, accountType: 'individual', maxConcurrent: 4 } }, { doc });
  assert.equal(tab.querySelector('.mv-providers-hint'), null, 'no intro of its own: the tab is divided rows');
  const cp = tab.querySelector('.mv-pv-row[data-provider="copilot"]');
  assert.equal(cp.querySelector('.mv-head, .badge'), null, 'no head and no state badge in the row');
  assert.equal(lines(cp).some((l) => /^Connected/.test(l)), false, 'signed out: no account line');
  assert.ok(cp.querySelector('.mv-cp-signin'));
  assert.equal(cp.querySelector('.mv-cp-fetch-models').disabled, true);
  assert.equal(cp.querySelector('.mv-cp-terms'), null, 'no notice button or pill');
  assert.doesNotMatch(cp.textContent, /notice/i);
  assert.doesNotMatch(cp.textContent, /Claude models run through Copilot's native Anthropic endpoint/, 'no row intro');
  const on = renderCopilotRow({ copilot: { connected: true, login: 'octo' } }, { doc });
  assert.ok(lines(on).includes('Connected as @octo'));
  assert.ok(lines(renderCopilotRow({ copilot: { connected: true } }, { doc })).includes('Connected'), 'no login: the plain word');
  // A stale state object from an older server still renders plainly.
  const staleRow = renderCopilotRow({ copilot: { connected: false, termsCurrent: false, acknowledgedTerms: '2026-01-01T00:00:00.000Z' } }, { doc });
  assert.ok(staleRow.querySelector('.mv-cp-signin'));
  assert.equal(lines(staleRow).some((l) => /^Connected/.test(l)), false);
  // The tab hands the sign-in in flight to the Copilot row.
  const flowTab = renderProvidersTab({ copilot: { connected: false } }, { doc, signIn: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' } });
  assert.equal(flowTab.querySelector('.mv-cp-signin'), null);
  assert.equal(flowTab.querySelector('.mv-cp-code').textContent, 'ABCD-1234');
  assert.equal(flowTab.querySelector('.mv-cp-copy').dataset.code, 'ABCD-1234');
  assert.equal(flowTab.querySelector('.mv-cp-open').href, 'https://github.com/login/device');
  const errBox = renderCopilotSignIn({ userCode: 'X', error: 'denied' }, { doc });
  assert.ok(errBox.querySelector('.mv-cp-status').classList.contains('err'));
  assert.equal(errBox.querySelector('.mv-cp-cancel').textContent, 'Dismiss');
  assert.equal(renderProvidersTab(null, { doc }).querySelectorAll('.mv-pv-row[data-provider]').length, 7);   // copilot, OpenRouter, openai, anthropic + Speech + Image generation + Sound
});

test('collectProviderRow: unchanged masked key is omitted (keep); a new key, base URL and cap are sent', () => {
  const tab = renderProvidersTab(PROVIDERS, { doc });
  assert.deepEqual(collectProviderRow(tab, 'openai'), { baseUrl: 'https://gw.example/v1', maxConcurrent: 8 });
  const key = tab.querySelector('.mv-pv-row[data-provider="openai"] .mv-pv-key');
  key.value = 'sk-new';
  tab.querySelector('.mv-pv-row[data-provider="openai"] .mv-pv-conc').value = '2';
  assert.deepEqual(collectProviderRow(tab, 'openai'), { baseUrl: 'https://gw.example/v1', apiKey: 'sk-new', maxConcurrent: 2 });
  assert.equal(collectProviderRow(tab, 'nope'), null);
});

test('the Copilot body: Account and the cap go with Save; Refresh usage, Import models, Sign out | Sign in, Save', () => {
  const row = renderCopilotRow(P, { doc });
  assert.ok(row.matches('.mv-pv-row[data-provider="copilot"]'));
  const acct = row.querySelector('select.select.mv-cp-account');
  assert.equal(acct.value, 'business');
  const btns = [...row.querySelectorAll('.mv-pv-btns button')];
  assert.deepEqual(btns.map((b) => b.textContent), ['Refresh usage', 'Import models', 'Sign out', 'Save']);
  assert.deepEqual(btns.map((b) => b.className), ['btn btn-quiet mv-cp-quota-refresh', 'btn mv-cp-fetch-models', 'btn mv-cp-signout', 'btn btn-primary mv-pv-save']);
  const save = row.querySelector('.mv-pv-btns[data-card-actions] .mv-pv-save');
  assert.deepEqual([save.dataset.provider, save.classList.contains('btn-primary'), save.type], ['copilot', true, 'button']);
  assert.deepEqual(collectProviderRow(row, 'copilot'), { accountType: 'business', maxConcurrent: 4 });
  acct.value = 'enterprise';
  row.querySelector('.mv-pv-conc').value = '2';
  assert.deepEqual(collectProviderRow(row, 'copilot'), { accountType: 'enterprise', maxConcurrent: 2 });
  assert.ok(row.querySelector('.mv-pv-main > small.hint.mv-pv-msg'), 'the status line the quota message writes to');
  assert.deepEqual(lines(row), ['Connected as @octo', 'Premium requests used this month: 12 / 300 (resets 2026-10-01)']);
  assert.equal(row.querySelector('.mv-pv-main > small.hint.mv-cp-quota').textContent, 'Premium requests used this month: 12 / 300 (resets 2026-10-01)');
  assert.equal(row.querySelector('.mv-cp-quota-refresh').disabled, false);
  assert.equal(row.querySelector('.mv-cp-fetch-models').disabled, false);

  const out = renderCopilotRow({ copilot: { connected: false, accountType: 'individual', maxConcurrent: 4, tokenSource: 'env', tokenRef: '${GH_TOKEN}' } }, { doc });
  assert.equal(out.querySelector('.mv-cp-signin').className, 'btn mv-cp-signin', 'Save is the only primary');
  assert.equal(out.querySelector('.mv-cp-signin').textContent, 'Sign in');
  assert.equal(out.querySelector('.mv-cp-signout'), null);
  const imp = out.querySelector('.mv-cp-fetch-models');
  assert.deepEqual([imp.disabled, imp.title], [true, 'Sign in first']);
  assert.equal(out.querySelector('.mv-cp-quota-refresh').disabled, true);
  assert.deepEqual(lines(out), ['Token read from your shell env (${GH_TOKEN}).']);
  assert.deepEqual([...out.querySelectorAll('.mv-pv-btns button')].map((b) => b.textContent), ['Refresh usage', 'Import models', 'Sign in', 'Save']);

  const mid = renderCopilotRow({ copilot: { connected: false } }, { doc, signIn: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' } });
  assert.equal(mid.querySelector('.mv-cp-signin'), null, 'a sign-in in flight has no second Sign in');
  assert.equal(mid.querySelector('.mv-pv-main > .mv-cp-flow .mv-cp-code').textContent, 'ABCD-1234');
  assert.ok(mid.querySelector('.mv-cp-flow a.btn-primary.mv-cp-open'), 'the sign-in box keeps its own primary step');
  assert.deepEqual([...mid.querySelectorAll('.mv-pv-btns button')].map((b) => b.textContent), ['Refresh usage', 'Import models', 'Save']);
  // With the broker, the import runs with the viewer's own sign-in on the key page, and the pill, not worca's own
  // sign-in, says whose account it is.
  assert.equal(renderCopilotRow({ ...BROKER, copilot: { connected: false } }, { doc }).querySelector('.mv-cp-fetch-models').disabled, false);
  assert.equal(lines(renderCopilotRow(BROKER, { doc })).some((l) => /^Connected/.test(l)), false);
  // Changing Account or the cap sends nothing: app.js's generic .mv-pv-save arm saves both.
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /patchProviderFlow\('copilot', \{ (accountType|maxConcurrent)/);
  assert.match(app, /t\.classList\.contains\('mv-pv-save'\)\) \{\s*const body = collectProviderRow\(providerRoot\(\), t\.dataset\.provider\);/);
});

test('info tips: the Copilot Account and cap and the endpoint API keys carry today\'s hint as a tip; the label still names its control', () => {
  const TIPS = {
    account: 'Picks the Copilot API host. The sign-in itself reports the host it was issued for and wins when it does.',
    cap: "Fan-out children beyond this wait their turn. The one knob that lowers GitHub's abuse-detection risk. Keep it low.",
    key: 'Stored masked; leave masked to keep. A model can override this key on its Connection.',
  };
  const cases = [
    [renderCopilotRow(P, { doc }), '.mv-cp-account', 'Account', 'About account', TIPS.account],
    [renderCopilotRow(P, { doc }), '.mv-pv-conc', 'Max concurrent requests', 'About max concurrent requests', TIPS.cap],
    [renderEndpointRow(P, 'openai', { doc }), '.mv-pv-key', 'API key', 'About API key', TIPS.key],
    [renderEndpointRow(P, 'anthropic', { doc }), '.mv-pv-key', 'API key', 'About API key', TIPS.key],
  ];
  try {
    for (const [row, sel, label, about, text] of cases) {
      doc.body.replaceChildren(row);
      const ctl = row.querySelector(sel);
      const field = ctl.closest('.mv-field');
      assert.equal(field.tagName, 'DIV', `${label}: a tipped field is a div, so the tip is no part of a label`);
      const tips = field.querySelectorAll('.info-tip');
      assert.equal(tips.length, 1, `${label}: one tip`);
      const tip = tips[0];
      assert.deepEqual([tip.tagName, tip.type, tip.getAttribute('aria-label')], ['BUTTON', 'button', about]);
      assert.deepEqual([tip.firstChild.nodeValue, tip.querySelector('.tip-content.hidden').textContent], ['i', text]);
      assert.ok(field.querySelector(':scope > .label-row > label.mv-field-label + .info-tip'), `${label}: label, then the tip, in one row`);
      assert.equal(ctl.parentElement, field, `${label}: the control sits in the field, after the label row`);
      assert.equal(ctl.labels.length, 1, `${label}: one label`);
      assert.equal(ctl.labels[0].textContent, label, `${label}: the label names the control`);
      assert.equal(field.querySelector('small.hint'), null, `${label}: no hint line`);
    }
    const [a, b] = [renderCopilotRow(P, { doc }), renderCopilotRow(P, { doc })].map((r) => r.querySelector('.mv-cp-account').id);
    assert.ok(a && b && a !== b, 'each control gets an id of its own');
  } finally {
    doc.body.replaceChildren();
  }
  // A tipped label reads like an untipped one, and the 28px tip leaves the label's line as tall as it was.
  const css = readFileSync(new URL('../ui/public/models/model-bridge.css', import.meta.url), 'utf8');
  assert.match(css, /\.mv-pv-row \.label-row\{margin:0;\}/);
  assert.match(css, /\.mv-pv-row \.label-row > \.mv-field-label\{font-size:12px;font-weight:600;\}/);
  assert.match(css, /\.mv-pv-row \.label-row > \.info-tip\{margin-block:-6px;\}/);
});

test('row bodies: no head, intro or row badge, no paragraph over 80 characters, the status line and the actions with Save the only primary', () => {
  for (const name of PROVIDER_ROWS) {
    const row = BUILDERS[name](P, { doc });
    assert.ok(row.matches(`.mv-pv-row[data-provider="${name}"]`), name);
    assert.ok(row.querySelector('small.hint.mv-pv-msg'), `${name}: the status line`);
    assert.ok(row.querySelector(':scope > div.mv-pv-btns[data-card-actions]'), `${name}: the actions`);
    assert.deepEqual([...row.querySelectorAll('.mv-pv-btns .btn-primary')].map((b) => b.textContent), ['Save'], `${name}: Save is the only primary`);
    for (const n of row.querySelectorAll('small.hint, p, .mv-providers-hint')) {
      if (n.closest('.mv-im-endpoint')) continue;
      assert.ok(n.textContent.length <= 80, `${name}: "${n.textContent}"`);
    }
    for (const n of row.querySelectorAll('.mv-name, .mv-head')) assert.ok(n.closest('.mv-sp-kind'), `${name}: ${n.className} outside a speech box`);
    assert.equal([...row.querySelectorAll('.badge')].filter((n) => !n.closest('.mv-sp-kind')).length, 0, `${name}: no row badge`);
  }
  // The speech boxes keep their titles and per-side badges.
  const sp = renderSpeechRow(P, { doc });
  assert.deepEqual([...sp.querySelectorAll('.mv-sp-kind > .mv-head')].map((n) => [n.querySelector('.mv-name').textContent, n.querySelector('.badge').textContent]),
    [['Speech-to-text', 'configured'], ['Text-to-speech', 'in the browser']]);
  assert.ok(sp.querySelector('.mv-sp-cache .mv-sp-clear'), 'Remove speech models stays');
  // The endpoint bodies keep their fields, the env-key line and their buttons.
  const an = renderEndpointRow(P, 'anthropic', { doc });
  assert.deepEqual(lines(an), ['Key read from your shell env (${ANT}).']);
  assert.equal(an.querySelector('.mv-pv-baseurl').placeholder, 'https://api.anthropic.com');
  assert.deepEqual([...an.querySelectorAll('.mv-pv-btns button')].map((b) => [b.className, b.textContent, b.dataset.provider]),
    [['btn mv-pv-test', 'Test connection', 'anthropic'], ['btn btn-primary mv-pv-save', 'Save', 'anthropic']]);
  const oa = renderEndpointRow(P, 'openai', { doc });
  assert.equal(oa.querySelector('.mv-pv-baseurl').placeholder, 'https://api.openai.com/v1');
  assert.deepEqual([...oa.querySelectorAll('.mv-pv-btns button')].map((b) => b.textContent), ['Import models', 'Test connection', 'Save']);
  assert.ok(renderEndpointRow(null, 'openai', { doc }).querySelector('.mv-pv-key'), 'a missing payload draws the empty form');
});

test('broker on: the four provider bodies start with the broker pill; speech, images and sound have none', () => {
  for (const name of ['copilot', 'openrouter', 'openai', 'anthropic']) {
    const row = BUILDERS[name](BROKER, { doc });
    const box = row.firstElementChild;
    assert.ok(box.matches('div.mv-pv-broker'), `${name}: the body starts with the broker pill`);
    const a = box.querySelector('a.mv-broker-pill');
    assert.equal(a.getAttribute('href'), KEY_PAGE, name);
    assert.equal(a.textContent, name === 'copilot' ? 'add your sign-in on the key page' : 'add your key on the key page');
    assert.equal(BUILDERS[name](P, { doc }).querySelector('.mv-pv-broker'), null, `${name}: no pill without the broker`);
  }
  for (const name of ['speech', 'images', 'sound']) assert.equal(BUILDERS[name](BROKER, { doc }).querySelector('.mv-pv-broker, .mv-broker-pill'), null, name);
});

test('row-level collectors: a body collects by itself', () => {
  assert.deepEqual(collectProviderRow(renderEndpointRow(P, 'openai', { doc }), 'openai'), { baseUrl: 'https://gw.example/v1', maxConcurrent: 8 });
  assert.equal(collectProviderRow(renderEndpointRow(P, 'openai', { doc }), 'anthropic'), null, 'another row\'s body is not this row');
  const im = renderImagesRow(P, { doc });
  assert.equal(collectImagesRow(im).service, 'openai');
  assert.equal(applyImagesPreset(im, 'xai'), true);
  assert.equal(collectImagesRow(im).service, 'xai');
});

test('import sheet: rows, disabled policy rows, status column, select-all and collect', () => {
  const models = [
    { id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI', contextWindow: 128000, toolCalls: true, vision: true, reasoning: true, preview: true, pickerEnabled: true, policyState: 'enabled', inCatalog: false },
    { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', vendor: 'Anthropic', contextWindow: 200000, toolCalls: true, vision: true, reasoning: false, pickerEnabled: true, policyState: 'enabled', inCatalog: true },
    { id: 'grok-x', name: 'Grok', vendor: 'xAI', toolCalls: true, vision: false, reasoning: false, pickerEnabled: true, policyState: 'unconfigured', inCatalog: false },
  ];
  const sheet = renderImportSheet(models, { doc });
  const rows = [...sheet.querySelectorAll('tbody tr')];
  assert.equal(rows.length, 3);
  assert.equal(rows[0].querySelector('.mvi-status').textContent, 'preview');
  assert.equal(rows[1].querySelector('.mvi-status').textContent, 'in catalog');
  assert.match(rows[2].querySelector('.mvi-status').textContent, /disabled: enable it/);
  assert.ok(rows[2].classList.contains('mvi-disabled'));
  assert.equal(rows[2].querySelector('.mvi-cb').disabled, true);
  assert.equal(rows[0].querySelectorAll('td')[3].textContent, '128k');
  assert.deepEqual(collectImportSheet(sheet), []);
  applyImportSelectAll(sheet, true);
  assert.deepEqual(collectImportSheet(sheet), ['gpt-5', 'claude-sonnet-4.5']);
  const empty = renderImportSheet([], { doc });
  assert.ok(empty.querySelector('.hist-empty'));
  assert.equal(empty.querySelector('.mvi-go').disabled, true);
});

test('connection: create defaults to direct with the provider block hidden; provider mode reveals it and couples api to provider', () => {
  const conn = renderConnectionSection(null, { doc, providers: PROVIDERS });
  assert.equal(conn.querySelector('.mv-conn-mode-rb:checked').value, 'direct');
  assert.equal(conn.querySelector('.mv-conn-body').hidden, true);
  conn.querySelector('.mv-conn-mode-rb[value="provider"]').checked = true;
  applyConnectionMode(conn);
  assert.equal(conn.querySelector('.mv-conn-body').hidden, false);
  assert.equal(conn.dataset.provider, 'copilot');
  const api = conn.querySelector('.mv-conn-api');
  assert.deepEqual([...api.options].map((o) => o.value), ['anthropic', 'openai-chat', 'openai-responses']);
  assert.equal(conn.querySelector('.mv-conn-adv').hidden, true);          // copilot: no key/base URL
  assert.match(conn.querySelector('.mv-conn-provider-hint').textContent, /Connected as @octo/);
  assert.match(conn.querySelector('.mv-conn-note').textContent, /native Anthropic endpoint/);
  conn.querySelector('.mv-conn-provider').value = 'openai';
  applyConnectionMode(conn);
  assert.deepEqual([...api.options].map((o) => o.value), ['openai-chat', 'openai-responses']);
  assert.equal(api.disabled, false);
  assert.equal(conn.querySelector('.mv-conn-adv').hidden, false);
  // Expandable like every other disclosure (New pipeline's Advanced): the chevron says so without a hover.
  const sum = conn.querySelector('.mv-conn-adv > summary');
  assert.ok(sum.querySelector('.adv-chev[aria-hidden="true"]'), 'the Advanced summary carries the disclosure chevron');
  assert.equal(sum.textContent.trim(), 'Advanced: base URL, API key, extra headers');
  assert.match(conn.querySelector('.mv-conn-note').textContent, /Translated/);
  conn.querySelector('.mv-conn-provider').value = 'anthropic';
  applyConnectionMode(conn);
  assert.match(conn.querySelector('.mv-conn-provider-hint').textContent, /\$\{VAR\} is not set/);
  assert.ok(conn.querySelector('.mv-conn-provider-hint').classList.contains('warn'));
  assert.match(conn.querySelector('.mv-conn-note').textContent, /Passthrough/);
});

test('connection: collect round-trips provider/api/model/advanced/capabilities; direct collects null', () => {
  const conn = renderConnectionSection(null, { doc });
  assert.deepEqual(collectConnection(conn), { upstream: null });
  setModelUpstream(conn, { provider: 'openai', api: 'openai-chat', model: 'gpt-4.1', baseUrl: 'https://gw/v1', apiKey: '${K}', headers: { 'X-Team': 'w' }, capabilities: { toolCalls: true, vision: false, reasoning: true, maxPromptTokens: 100000 } });
  assert.equal(conn.querySelector('.mv-conn-mode-rb:checked').value, 'provider');
  assert.equal(conn.querySelector('.mv-conn-headers').value, 'X-Team: w');
  assert.deepEqual(collectConnection(conn), { upstream: {
    provider: 'openai', api: 'openai-chat', model: 'gpt-4.1', baseUrl: 'https://gw/v1', apiKey: '${K}', headers: { 'X-Team': 'w' },
    capabilities: { toolCalls: true, vision: false, reasoning: true, maxPromptTokens: 100000 },
  } });
  // Copilot: advanced fields are not collected even when filled in earlier.
  setModelUpstream(conn, { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5', capabilities: { vision: true } });
  const c = collectConnection(conn).upstream;
  assert.equal(c.provider, 'copilot');
  assert.equal(c.api, 'anthropic');
  assert.equal(c.baseUrl, undefined);
  assert.equal(c.apiKey, undefined);
  assert.equal(c.capabilities.vision, true);
  assert.equal(c.capabilities.toolCalls, true);   // the unset default
});

test('editor: a translated model without reasoning collapses efforts to medium; reasoning restores them; an upstream entry renders in provider mode', () => {
  const editor = renderModelEditor(null, EFFORTS, { doc, providers: PROVIDERS });
  doc.body.appendChild(editor);
  try {
    const conn = editor.querySelector('.mv-conn');
    conn.querySelector('.mv-conn-mode-rb[value="provider"]').checked = true;
    conn.querySelector('.mv-conn-provider').value = 'openai';
    conn.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]').checked = false;
    applyConnectionModeIn(editor);
    const cbs = [...editor.querySelectorAll('.mv-effort-cb')];
    assert.deepEqual(cbs.map((c) => [c.value, c.checked, c.disabled]), [['medium', true, false], ['high', false, true], ['xhigh', false, true], ['max', false, true]]);
    assert.match(editor.querySelector('.mv-efforts-hint').textContent, /only medium is offered/);
    conn.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]').checked = true;
    applyConnectionModeIn(editor);
    assert.ok(cbs.every((c) => !c.disabled));
    assert.match(editor.querySelector('.mv-efforts-hint').textContent, /reasoning_effort/);
    const { body } = collectModelEditor(editor);
    assert.equal(body.upstream.provider, 'openai');
    assert.deepEqual(body.efforts, ['medium']);
  } finally {
    editor.remove();
  }
  const stored = { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium', 'high'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5', capabilities: { reasoning: true } }, cost: { free: true } };
  const ed2 = renderModelEditor(stored, EFFORTS, { doc, providers: PROVIDERS, copilotModels: [{ id: 'gpt-5', name: 'GPT-5', vendor: 'OpenAI' }] });
  assert.equal(ed2.querySelector('.mv-conn-mode-rb:checked').value, 'provider');
  assert.equal(ed2.querySelector('.mv-conn-model').value, 'gpt-5');
  assert.equal(ed2.querySelector('.mv-conn-api').value, 'openai-chat');
  assert.ok(ed2.querySelector('datalist option[value="gpt-5"]'));
  assert.equal(ed2.querySelector('.mv-cost-mode-rb:checked').value, 'free');
  const edited = collectModelEditor(ed2);
  assert.equal(edited.id, 'copilot-gpt-5');
  assert.equal(edited.body.upstream.model, 'gpt-5');
  // Switching an edited entry back to direct sends an explicit clear.
  ed2.querySelector('.mv-conn-mode-rb[value="direct"]').checked = true;
  assert.equal(collectModelEditor(ed2).body.upstream, null);
  // Create mode never sends a null upstream.
  const ed3 = renderModelEditor(null, EFFORTS, { doc });
  assert.equal('upstream' in collectModelEditor(ed3).body, false);
});

test('catalogue: a bridged model sits under its provider, which says Needs sign-in once; the panel names the upstream id and the translation limits', () => {
  const gpt = { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5', capabilities: { maxPromptTokens: 128000 } }, bridged: 'copilot', needsSignIn: true, signInReason: 'not_signed_in', signInMessage: 'not signed in' };
  const claude = { id: 'copilot-claude', label: 'Claude (Copilot)', efforts: EFFORTS, upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5' }, bridged: 'copilot', needsSignIn: false };
  const data = (providers) => ({ models: [gpt, claude], plugin: [{ ...gpt, id: 'p-gpt', plugin: 'p', secrets: [] }], predefined: [], providers });
  const copilotSub = (providers) => buildCatalogue(data(providers)).groups.find((g) => g.engine === 'claude').subs.find((x) => x.key === 'copilot');
  const sub = copilotSub({});
  assert.deepEqual([sub.name, sub.state.text, sub.state.fix, sub.fixRow], ['GitHub Copilot', 'Needs sign-in', 'Sign in', 'copilot']);
  assert.deepEqual(sub.rows.map((r) => [r.id, r.name, r.chip, r.state]), [
    ['copilot-gpt-5', 'GPT-5', null, null], ['copilot-claude', 'Claude', null, null], ['p-gpt', 'GPT-5', 'Plugin', null],
  ], 'the sub-group says the need once; the rows do not repeat it');
  // No Providers payload: nothing is claimed about the provider, so the row that needs sign-in says so itself.
  assert.deepEqual(copilotSub(null).rows.map((r) => [r.id, r.state?.text ?? null]), [['copilot-gpt-5', 'Needs setup'], ['copilot-claude', null], ['p-gpt', 'Needs setup']]);
  const fact = (panel, k) => panel.facts.find((f) => f.k === k)?.v;
  const panel = buildModelPanel(data({}), 'copilot-gpt-5');
  assert.deepEqual(panel.state, { tone: 'need', text: 'Needs sign-in' });
  assert.deepEqual([fact(panel, 'Sends as'), fact(panel, 'Provider'), fact(panel, 'Source')], ['gpt-5', 'GitHub Copilot', 'Yours']);
  assert.deepEqual(panel.limits, [{ k: 'Prompt', v: '~128k tokens' }, { k: 'Reasoning', v: 'None' }, { k: 'Web search', v: 'Not available' }]);
  assert.deepEqual(buildModelPanel(data({}), 'copilot-claude').limits, [], 'not translated: no limits');
  const plugin = buildModelPanel(data({}), 'p-gpt');
  assert.deepEqual([fact(plugin, 'Source'), plugin.limits.length], ['Plugin p', 3]);
  assert.equal(bridgedBadge(gpt, { doc }).textContent, 'bridged: copilot');
  assert.equal(degradationLine(gpt), 'translated: no thinking blocks, no WebSearch/WebFetch, prompt limit ~128k tokens');
  assert.equal(bridgedBadge({ bridged: false }, { doc }), null);
  assert.equal(needsSignInPill({ needsSignIn: false }, { doc }), null);
  assert.equal(needsSignInPill({ needsSignIn: true, signInReason: 'no_key', bridged: 'openai' }, { doc }).querySelector('.mv-signin').textContent, 'Set key');
  assert.equal(needsSignInPill({ needsSignIn: true, signInReason: 'not_signed_in', bridged: 'copilot' }, { doc }).querySelector('.badge').textContent, 'needs sign-in');
  assert.equal(degradationLine(claude), '');
});

test('connection + cards: the Responses API is offered for copilot and openai, labelled, and described', () => {
  const conn = renderConnectionSection(null, { doc, providers: PROVIDERS });
  setModelUpstream(conn, { provider: 'openai', api: 'openai-responses', model: 'gpt-5-codex', capabilities: { reasoning: true } });
  assert.equal(conn.querySelector('.mv-conn-api').value, 'openai-responses');
  assert.match(conn.querySelector('.mv-conn-note').textContent, /^Translated to the Responses API: reasoning summaries arrive as thinking, WebSearch\/WebFetch withheld/);
  assert.equal(collectConnection(conn).upstream.api, 'openai-responses');
  setModelUpstream(conn, { provider: 'copilot', api: 'openai-responses', model: 'gpt-6-astra' });
  assert.match(conn.querySelector('.mv-conn-note').textContent, /Copilot bills premium requests, so Pricing defaults to Free\.$/);
  assert.equal(degradationLine({ upstream: { api: 'openai-responses', capabilities: { maxPromptTokens: 272000 } } }), 'translated: reasoning summaries only, no WebSearch/WebFetch, prompt limit ~272k tokens');
  assert.equal(degradationLine({ upstream: { api: 'openai-chat', capabilities: {} } }), 'translated: no thinking blocks, no WebSearch/WebFetch');
  assert.match(bridgedBadge({ bridged: 'copilot', upstream: { model: 'gpt-6-astra', api: 'openai-responses' } }, { doc }).title, /as gpt-6-astra \(OpenAI Responses\)/);
});

test('editor: stored efforts all outside the model\'s levels fall back to the levels it offers — never an empty (= every effort) save', () => {
  const stored = { id: 'copilot-gpt-5.4', label: 'GPT-5.4 (Copilot)', efforts: ['max'], upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-5.4', capabilities: { reasoning: true, reasoningEfforts: ['low', 'medium', 'high', 'xhigh'] } } };
  const editor = renderModelEditor(stored, EFFORTS, { doc, providers: PROVIDERS });
  doc.body.appendChild(editor);
  try {
    applyConnectionModeIn(editor);
    assert.deepEqual([...editor.querySelectorAll('.mv-effort-cb')].map((c) => [c.value, c.checked, c.disabled]), [['medium', true, false], ['high', true, false], ['xhigh', true, false], ['max', false, true]]);
    assert.deepEqual(collectModelEditor(editor).body.efforts, ['medium', 'high', 'xhigh']);
  } finally {
    editor.remove();
  }
});

test('editor: an imported Responses entry keeps its effort list on save, offers only the listed efforts, and drops the list when Reasoning is unchecked', () => {
  const stored = {
    id: 'copilot-gpt-5.4', label: 'GPT-5.4 (Copilot)',
    upstream: { provider: 'copilot', api: 'openai-responses', model: 'gpt-5.4', capabilities: { toolCalls: true, vision: true, reasoning: true, maxPromptTokens: 272000, reasoningEfforts: ['none', 'low', 'medium', 'high', 'xhigh'] } },
    cost: { free: true },
  };
  const editor = renderModelEditor(stored, EFFORTS, { doc, providers: PROVIDERS });
  doc.body.appendChild(editor);
  try {
    applyConnectionModeIn(editor);
    const cbs = [...editor.querySelectorAll('.mv-effort-cb')];
    assert.deepEqual(cbs.map((c) => [c.value, c.disabled]), [['medium', false], ['high', false], ['xhigh', false], ['max', true]]);
    assert.equal(cbs[3].checked, false);
    assert.equal(editor.querySelector('.mv-efforts-hint').textContent, "Maps to this model's effort levels: none, low, medium, high, xhigh.");
    const saved = collectModelEditor(editor).body;
    assert.deepEqual(saved.upstream.capabilities.reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(saved.efforts, ['medium', 'high', 'xhigh']);
    editor.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]').checked = false;
    applyConnectionModeIn(editor);
    assert.equal('reasoningEfforts' in collectModelEditor(editor).body.upstream.capabilities, false);
    editor.querySelector('.mv-conn-cap-cb[data-cap="reasoning"]').checked = true;
    editor.querySelector('.mv-conn-api').value = 'openai-chat';                       // chat keeps the list too (it maps effort the same way)
    applyConnectionModeIn(editor);
    assert.deepEqual(collectModelEditor(editor).body.upstream.capabilities.reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
    editor.querySelector('.mv-conn-api').value = 'anthropic';                          // passthrough: the CLI speaks effort itself
    applyConnectionModeIn(editor);
    assert.equal('reasoningEfforts' in collectModelEditor(editor).body.upstream.capabilities, false);
    editor.querySelector('.mv-conn-api').value = 'openai-chat';
    applyConnectionModeIn(editor);
    const modelIn = editor.querySelector('.mv-conn-model');
    const maxCb = () => [...editor.querySelectorAll('.mv-effort-cb')].find((c) => c.value === 'max');
    modelIn.value = 'gpt-5.4-mini';                                                    // another upstream model: gpt-5.4's levels do not apply
    applyConnectionModeIn(editor);
    assert.equal('reasoningEfforts' in collectModelEditor(editor).body.upstream.capabilities, false);
    assert.equal(maxCb().disabled, false);
    modelIn.value = ' gpt-5.4 ';                                                        // back to it: the levels return
    applyConnectionModeIn(editor);
    assert.deepEqual(collectModelEditor(editor).body.upstream.capabilities.reasoningEfforts, ['none', 'low', 'medium', 'high', 'xhigh']);
    assert.equal(maxCb().disabled, true);
    editor.querySelector('.mv-conn-provider').value = 'openai';                       // another provider: Copilot's levels do not apply
    applyConnectionModeIn(editor);
    assert.equal('reasoningEfforts' in collectModelEditor(editor).body.upstream.capabilities, false);
  } finally {
    editor.remove();
  }
  // Loading a different upstream (Edit a copy / import prefill) replaces the stash — even on the same provider and model.
  const conn = renderConnectionSection(stored, { doc });
  setModelUpstream(conn, { provider: 'copilot', api: 'openai-responses', model: 'gpt-5.4', capabilities: { reasoning: true } });
  assert.equal('reasoningEfforts' in collectConnection(conn).upstream.capabilities, false);
});

test('Copy code copies by itself (any page that mounts the box): the code is the button, then a green tick and "Copied"; a refusal says so in the status line', async () => {
  const dom = new JSDOM('<!doctype html><body></body>');
  const d = dom.window.document;
  const copied = [];
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async (t) => { copied.push(t); } }, configurable: true });
  const box = renderCopilotSignIn({ userCode: 'ABCD-1234' }, { doc: d });
  const btn = box.querySelector('.mv-cp-copy');
  assert.ok(btn.querySelector('.ico-copy') && btn.querySelector('.ico-check'), 'the copy and tick icons');
  assert.ok(btn.classList.contains('copy-btn'), 'the one copy button');
  assert.equal(btn.querySelector('.mv-cp-code').textContent, 'ABCD-1234', 'the code is its label');
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(copied, ['ABCD-1234']);
  assert.ok(btn.classList.contains('copied'));
  assert.equal(btn.querySelector('.copy-btn-msg').textContent, 'Copied');
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true });
  btn.click(); await new Promise((r) => setTimeout(r, 0));
  assert.equal(btn.classList.contains('copied'), false);
  assert.ok(btn.classList.contains('copy-miss'));
  assert.equal(box.querySelector('.mv-cp-status').textContent, 'Could not copy the code. Type ABCD-1234 on GitHub instead.', 'it outlasts the 1.2 s flash');
  dom.window.close();
});

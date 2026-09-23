// test/bridge-view.test.mjs
// The model bridge's pure renderers (model-bridge-design.md §8): Providers
// card states, the sign-in block, the import sheet + select-all + collect,
// the editor Connection section (mode reveal, provider→api coupling, Advanced
// only for key-based providers, efforts collapse for a translated model
// without reasoning), collect/set round-trips, and the card badges inside
// renderModelsList / renderModelEditor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderProvidersCard, collectProviderRow, renderCopilotSignIn, renderImportSheet, collectImportSheet, applyImportSelectAll,
  renderConnectionSection, applyConnectionMode, setModelUpstream, collectConnection,
  bridgedBadge, needsSignInPill, degradationLine, COPILOT_TERMS,
} from '../ui/public/bridge-view.mjs';
import { renderModelsList, renderModelEditor, collectModelEditor, applyConnectionModeIn } from '../ui/public/models-view.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const EFFORTS = ['medium', 'high', 'xhigh', 'max'];
const PROVIDERS = {
  copilot: { connected: true, login: 'octo', accountType: 'business', acknowledgedTerms: '2026-09-20T10:00:00.000Z', termsCurrent: true, maxConcurrent: 3, tokenSource: 'stored', quota: { used: 12, entitlement: 300, unlimited: false, resetDate: '2026-10-01' } },
  openai: { configured: true, keySet: true, keySource: 'stored', keyMasked: '••••••abcd', baseUrl: 'https://gw.example/v1', maxConcurrent: 8 },
  anthropic: { configured: false, keySet: true, keySource: 'env', keyRef: '${ANT}', baseUrl: 'https://api.anthropic.com', maxConcurrent: 8 },
};

test('providers card: connected copilot shows login, quota, import + sign-out; key rows show their state', () => {
  const card = renderProvidersCard(PROVIDERS, { doc });
  assert.ok(card.classList.contains('mv-providers'));
  const cp = card.querySelector('.mv-pv-row[data-provider="copilot"]');
  assert.match(cp.querySelector('.badge').textContent, /connected as @octo/);
  assert.equal(cp.querySelector('.mv-cp-account').value, 'business');
  assert.equal(cp.querySelector('.mv-pv-conc').value, '3');
  assert.match(cp.querySelector('.mv-cp-quota').textContent, /12 \/ 300.*resets 2026-10-01/);
  assert.ok(cp.querySelector('.mv-cp-signout'));
  assert.equal(cp.querySelector('.mv-cp-signin'), null);
  assert.equal(cp.querySelector('.mv-cp-fetch-models').disabled, false);
  assert.equal(cp.querySelector('.mv-cp-terms').textContent, 'Re-read notice');
  const oa = card.querySelector('.mv-pv-row[data-provider="openai"]');
  assert.equal(oa.querySelector('.badge').textContent, 'key set');
  assert.equal(oa.querySelector('.mv-pv-key').value, '••••••abcd');
  assert.equal(oa.querySelector('.mv-pv-baseurl').value, 'https://gw.example/v1');
  const an = card.querySelector('.mv-pv-row[data-provider="anthropic"]');
  assert.equal(an.querySelector('.badge').textContent, 'key ${VAR} not set');
  assert.equal(an.querySelector('.mv-pv-key').value, '${ANT}');
});

test('providers card: not connected / not acknowledged states; sign-in block replaces the button', () => {
  const card = renderProvidersCard({ copilot: { connected: false, termsCurrent: false, accountType: 'individual', maxConcurrent: 4 } }, { doc });
  const cp = card.querySelector('.mv-pv-row[data-provider="copilot"]');
  assert.match(cp.querySelector('.badge').textContent, /blocked until acknowledged/);
  assert.ok(cp.querySelector('.mv-cp-signin'));
  assert.equal(cp.querySelector('.mv-cp-fetch-models').disabled, true);
  assert.equal(cp.querySelector('.mv-cp-terms').textContent, 'Read notice');
  const flowCard = renderProvidersCard({ copilot: { connected: false, termsCurrent: true } }, { doc, signIn: { userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' } });
  assert.equal(flowCard.querySelector('.mv-cp-signin'), null);
  assert.equal(flowCard.querySelector('.mv-cp-code').textContent, 'ABCD-1234');
  assert.equal(flowCard.querySelector('.mv-cp-copy').dataset.code, 'ABCD-1234');
  assert.equal(flowCard.querySelector('.mv-cp-open').href, 'https://github.com/login/device');
  const errBox = renderCopilotSignIn({ userCode: 'X', error: 'denied' }, { doc });
  assert.ok(errBox.querySelector('.mv-cp-status').classList.contains('err'));
  assert.equal(errBox.querySelector('.mv-cp-cancel').textContent, 'Dismiss');
  assert.equal(renderProvidersCard(null, { doc }).querySelectorAll('.mv-pv-row').length, 3);
});

test('collectProviderRow: unchanged masked key is omitted (keep); a new key, base URL and cap are sent', () => {
  const card = renderProvidersCard(PROVIDERS, { doc });
  assert.deepEqual(collectProviderRow(card, 'openai'), { baseUrl: 'https://gw.example/v1', maxConcurrent: 8 });
  const key = card.querySelector('.mv-pv-row[data-provider="openai"] .mv-pv-key');
  key.value = 'sk-new';
  card.querySelector('.mv-pv-row[data-provider="openai"] .mv-pv-conc').value = '2';
  assert.deepEqual(collectProviderRow(card, 'openai'), { baseUrl: 'https://gw.example/v1', apiKey: 'sk-new', maxConcurrent: 2 });
  assert.equal(collectProviderRow(card, 'nope'), null);
});

test('terms notice text names the risk and the account', () => {
  assert.match(COPILOT_TERMS.body, /supported clients/);
  assert.match(COPILOT_TERMS.body, /Your GitHub account, not Worca/);
  assert.equal(COPILOT_TERMS.checkbox, 'I understand and want to continue');
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
  assert.equal(rows[1].querySelector('.mvi-status').textContent, 'in catalog ✓');
  assert.match(rows[2].querySelector('.mvi-status').textContent, /disabled — enable it/);
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
  assert.deepEqual([...api.options].map((o) => o.value), ['anthropic', 'openai-chat']);
  assert.equal(conn.querySelector('.mv-conn-adv').hidden, true);          // copilot: no key/base URL
  assert.match(conn.querySelector('.mv-conn-provider-hint').textContent, /Connected as @octo/);
  assert.match(conn.querySelector('.mv-conn-note').textContent, /native Anthropic endpoint/);
  conn.querySelector('.mv-conn-provider').value = 'openai';
  applyConnectionMode(conn);
  assert.deepEqual([...api.options].map((o) => o.value), ['openai-chat']);
  assert.equal(api.disabled, true);
  assert.equal(conn.querySelector('.mv-conn-adv').hidden, false);
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

test('cards: bridged badge, needs-sign-in pill + Sign in button, degradation line, upstream in the summary', () => {
  const gpt = { id: 'copilot-gpt-5', label: 'GPT-5 (Copilot)', efforts: ['medium'], upstream: { provider: 'copilot', api: 'openai-chat', model: 'gpt-5', capabilities: { maxPromptTokens: 128000 } }, bridged: 'copilot', needsSignIn: true, signInReason: 'not_signed_in', signInMessage: 'not signed in' };
  const claude = { id: 'copilot-claude', label: 'Claude (Copilot)', efforts: EFFORTS, upstream: { provider: 'copilot', api: 'anthropic', model: 'claude-sonnet-4.5' }, bridged: 'copilot', needsSignIn: false };
  const list = renderModelsList({ globals: [gpt, claude], plugins: [{ ...gpt, id: 'p-gpt', plugin: 'p', secrets: [] }], efforts: EFFORTS }, { doc });
  const card = list.querySelector('.mv-card[data-id="copilot-gpt-5"]');
  assert.equal(card.querySelector('.mv-bridged').textContent, 'bridged: copilot');
  assert.equal(card.querySelector('.mv-needs-signin-badge').textContent, 'needs sign-in');
  assert.equal(card.querySelector('.mv-signin').dataset.provider, 'copilot');
  assert.equal(card.querySelector('.mv-degradation').textContent, 'translated — no thinking blocks, no WebSearch/WebFetch, prompt limit ~128k tokens');
  assert.match(card.querySelector('.mv-summary').textContent, /→ gpt-5/);
  const c2 = list.querySelector('.mv-card[data-id="copilot-claude"]');
  assert.equal(c2.querySelector('.mv-needs-signin'), null);
  assert.equal(c2.querySelector('.mv-degradation'), null);
  const pc = list.querySelector('.mv-plugin[data-id="p-gpt"]');
  assert.equal(pc.querySelector('.mv-bridged').textContent, 'bridged: copilot');
  assert.ok(pc.querySelector('.mv-needs-signin'));
  assert.equal(bridgedBadge({ bridged: false }, { doc }), null);
  assert.equal(needsSignInPill({ needsSignIn: false }, { doc }), null);
  assert.equal(needsSignInPill({ needsSignIn: true, signInReason: 'no_key', bridged: 'openai' }, { doc }).querySelector('.mv-signin').textContent, 'Set key');
  assert.equal(needsSignInPill({ needsSignIn: true, signInReason: 'terms', bridged: 'copilot' }, { doc }).querySelector('.badge').textContent, 'needs acknowledgement');
  assert.equal(degradationLine(claude), '');
});

// The Test-connection verdict has to land where the eye is: a pill in the button row, empty until a
// test runs. The hint line under the description reads as "nothing happened" (#models UX).
test('providers card: every key-based row carries an empty result pill beside its buttons', () => {
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const card = renderProvidersCard(PROVIDERS, { doc });
  for (const name of ['openai', 'anthropic']) {
    const row = card.querySelector(`.mv-pv-row[data-provider="${name}"]`);
    const pill = row.querySelector('.mv-pv-btns .mv-pv-result');
    assert.ok(pill, `${name} has a result pill`);
    assert.equal(pill.textContent, '', 'silent until a test runs');
    assert.equal(pill.className, 'mv-pv-result', 'the is-on state is added by the flow');
    assert.ok(row.querySelector('.mv-pv-test'), 'and the button it belongs to');
  }
});

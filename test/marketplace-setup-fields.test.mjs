// test/marketplace-setup-fields.test.mjs — P4 (CONTRACT §3.6): the shared Set up fields. One section per task source /
// chat channel / model secrets; secrets never prefilled; a stored secret is "Set · Replace"; Required; More options; profiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setupSections, renderSetupFields, collectSetupFields, flagMissing } from '../ui/public/marketplace/setup-fields.mjs';
import { checkRows } from './helpers/rows.mjs';
import { SLACK_CONFIG, AZURE_CONFIG, GH_SOURCE, F } from './helpers/marketplace-install-fixtures.mjs';

const { window } = new JSDOM('<!doctype html><body></body>');
const doc = window.document;
const mount = (section, mode = 'install') => { const el = renderSetupFields(doc, section, { mode }); doc.body.replaceChildren(el); return el; };
const slack = (mode) => mount(setupSections(SLACK_CONFIG)[0], mode);
const type = (el, key, v) => { const i = el.querySelector(`[data-key="${key}"]`); i.value = v; i.dispatchEvent(new window.Event('input', { bubbles: true })); };
const label = (field) => field.querySelector('label').firstChild.textContent;

test('setupSections: sources (named from the snapshot), channels, then model secrets; empty schemas and the broker drop out', () => {
  const config = { sources: [GH_SOURCE, { ...GH_SOURCE, id: 'noop', schema: [] }], channels: SLACK_CONFIG.channels,
    models: { schema: [F('apiKey', 'API key', { secret: true })], values: { apiKey: { set: false } } } };
  assert.deepEqual(setupSections(config, { names: { github: 'GitHub Issues' } }).map((s) => [s.kind, s.id, s.title]),
    [['source', 'github', 'GitHub Issues'], ['channel', 'main', 'Slack'], ['modelSecrets', '', 'Model secrets']]);
  assert.deepEqual(setupSections(config).map((s) => s.title), ['github', 'Slack', 'Model secrets']);
  assert.deepEqual(setupSections({ ...config, models: { ...config.models, broker: { keyPage: null } } }).map((s) => s.kind), ['source', 'channel']);
  assert.deepEqual(setupSections({ sources: [], channels: [] }), []);
  assert.deepEqual(setupSections(undefined), []);
  assert.deepEqual(setupSections({ plugins: [], orphans: [] }), [], 'a payload without sources/channels/models (ui-git-hide-set\'s fake) gives no section');
});

test('renderSetupFields: the Slack channel in install mode (board 1.3)', async () => {
  await checkRows([
    { name: 'section hooks, heading, field order, labels, Required, help as one hint line', run: () => {
      const el = slack();
      assert.equal(el.matches('section.mk-setup[data-kind="channel"][data-channel-id="main"]'), true);
      assert.equal(el.querySelector('h3.section-title.mk-setup-h').textContent, 'Set up Slack');
      const shown = [...el.querySelectorAll(':scope > .field')];
      assert.deepEqual(shown.map(label), ['Bot token (xoxb-…)', 'App-level token (xapp-…)', 'Notify channel IDs', 'Allowed channel IDs (commands)']);
      assert.deepEqual(shown.map((f) => f.querySelector('.mk-req')?.textContent ?? null), ['Required', 'Required', null, null]);
      assert.deepEqual(shown.map((f) => f.querySelector('small.hint')?.textContent ?? null), ['OAuth & Permissions → Bot User OAuth Token.', null, null, null]);
      for (const f of shown) assert.equal(f.querySelector('label').htmlFor, f.querySelector('[data-key]').id);
      assert.deepEqual(['notifyChatIds', 'allowedChatIds', 'channelAllowlist', 'botToken'].map((k) => el.querySelector(`[data-key="${k}"]`).className),
        ['input mk-mono', 'input mk-mono', 'input mk-mono', 'input'], 'L23/SM30: channel-id fields are mono (review B m-P4-6)');
      assert.equal(new Set(shown.map((f) => f.querySelector('[data-key]').id)).size, 4, 'unique ids');
    } },
    { name: 'an unset secret: an empty password field behind the key glyph, never prefilled', run: () => {
      const i = slack().querySelector('[data-key="botToken"]');
      assert.deepEqual([i.type, i.value, i.className, i.getAttribute('autocomplete'), i.getAttribute('aria-required'), i.dataset.required, i.parentElement.className],
        ['password', '', 'input', 'off', 'true', '1', 'mk-secret']);
      assert.ok(i.parentElement.querySelector('.ic svg'), 'key glyph');
    } },
    { name: 'More options folds the advanced field with its count; collect still sends it', run: () => {
      const el = slack();
      const more = el.querySelector('button.btn.btn-quiet.mk-disc');
      const body = el.querySelector('.mk-disc-body');
      assert.deepEqual([more.type, more.getAttribute('aria-expanded'), more.getAttribute('aria-controls'), more.textContent, more.querySelector('.mk-count').textContent, body.hidden],
        ['button', 'false', body.id, 'More options1', '1', true]);
      more.click();
      assert.deepEqual([more.getAttribute('aria-expanded'), body.hidden], ['true', false]);
      assert.equal(label(body.querySelector('.field')), 'Listen filter (optional)');
      type(el, 'botToken', 'xoxb-1'); type(el, 'appToken', 'xapp-1'); type(el, 'notifyChatIds', 'C07Q2M4KD1');
      assert.deepEqual(collectSetupFields(el), { channelId: 'main', values: { botToken: 'xoxb-1', appToken: 'xapp-1', notifyChatIds: 'C07Q2M4KD1', allowedChatIds: '', channelAllowlist: '' } });
    } },
    { name: 'no advanced field: no More options', run: () => assert.equal(mount(setupSections({ sources: [GH_SOURCE] })[0]).querySelector('.mk-disc'), null) },
    { name: 'SM51: manage mode heads the group with h4.subsection-title and the bare name; install keeps h3.section-title', run: () => {
      const h = slack('manage').querySelector('.mk-setup-h');
      assert.deepEqual([h.tagName, h.className, h.textContent], ['H4', 'subsection-title mk-setup-h', 'Slack']);
      const i = slack('install').querySelector('.mk-setup-h');
      assert.deepEqual([i.tagName, i.className, i.textContent], ['H3', 'section-title mk-setup-h', 'Set up Slack']);
    } },
    { name: 'a select keeps the stored value inside .select-wrap; a source collects its sourceId', run: () => {
      const el = mount(setupSections({ sources: [{ ...GH_SOURCE, values: { token: { set: false }, closeOnDone: 'yes' } }] })[0]);
      const sel = el.querySelector('.select-wrap > select.select[data-key="closeOnDone"]');
      assert.deepEqual([sel.value, [...sel.options].map((o) => [o.value, o.textContent])], ['yes', [['no', 'no'], ['yes', 'yes']]]);
      assert.deepEqual(collectSetupFields(el), { sourceId: 'github', values: { closeOnDone: 'yes' } }, 'an empty secret is not sent');
    } },
    { name: 'model secrets collect as { target: "modelSecrets" }', run: () => {
      const el = mount(setupSections({ models: { schema: [F('apiKey', 'API key', { secret: true })], values: { apiKey: { set: false } } } })[0]);
      assert.deepEqual([el.dataset.kind, el.dataset.target, el.querySelector('.mk-setup-h').textContent], ['modelSecrets', 'modelSecrets', 'Model secrets']);
      type(el, 'apiKey', 'k-1');
      assert.deepEqual(collectSetupFields(el), { target: 'modelSecrets', values: { apiKey: 'k-1' } });
    } },
  ]);
});

test('a stored secret shows Set + Replace; untouched it is omitted, replaced it is sent', () => {
  const el = mount(setupSections(AZURE_CONFIG([{ id: 'work', label: 'Work' }]))[0]);
  const set = el.querySelector('.mk-secret-set');
  const replace = set.querySelector('button.btn.btn-sm.btn-quiet.mk-replace');
  assert.deepEqual([set.querySelector('.mk-secret-dots').textContent, set.querySelector('.mk-secret-dots').getAttribute('aria-hidden'),
    set.querySelector('.mk-chip.mk-chip-ok').textContent, replace.textContent, replace.getAttribute('aria-label')],
  ['••••••••••', 'true', 'Set', 'Replace', 'Replace Personal access token']);
  assert.equal(el.querySelector('[data-key="pat"]'), null, 'no control carries the stored secret');
  assert.deepEqual(collectSetupFields(el), { sourceId: 'azure', profile: 'work', values: { organization: 'acme' } });
  replace.click();
  const pat = el.querySelector('[data-key="pat"]');
  assert.deepEqual([pat.type, pat.value, pat.dataset.set, doc.activeElement === pat, pat.closest('.field').querySelector('label').htmlFor === pat.id],
    ['password', '', '1', true, true]);
  assert.deepEqual(collectSetupFields(el).values, { organization: 'acme' }, 'Replace left empty keeps the stored secret');
  assert.equal(flagMissing(el), 0, 'a stored required secret is not missing');
  type(el, 'pat', 'new-pat');
  assert.deepEqual(collectSetupFields(el).values, { organization: 'acme', pat: 'new-pat' });
});

test('profiles: a roster shows the profile select; an empty roster asks for the first profile id', () => {
  const roster = mount(setupSections(AZURE_CONFIG([{ id: 'work', label: 'Work' }, { id: 'home', label: '' }]))[0]);
  const sel = roster.querySelector('.select-wrap > select.select.mk-profile-sel');
  assert.deepEqual([roster.dataset.profile, sel.dataset.sourceId, sel.value, [...sel.options].map((o) => o.textContent), label(sel.closest('.field'))],
    ['work', 'azure', 'work', ['Work (work)', 'home'], 'Profile']);
  const fresh = mount(setupSections(AZURE_CONFIG())[0]);
  const id = fresh.querySelector('input.input.mk-profile-id');
  assert.deepEqual([label(id.closest('.field')), id.closest('.field').querySelector('.mk-req').textContent, id.placeholder, id.type, id.hasAttribute('data-key')],
    ['Profile', 'Required', 'work', 'text', false]);
  assert.equal(flagMissing(fresh), 3, 'profile id, organization and the unset PAT');
  id.value = ' work '; type(fresh, 'organization', 'acme'); type(fresh, 'pat', 'p-1');
  assert.deepEqual(collectSetupFields(fresh), { sourceId: 'azure', profile: 'work', newProfile: true, values: { organization: 'acme', pat: 'p-1' } });
});

test('flagMissing: "Enter a value." under each empty required control, the first focused, a folded one unfolded', () => {
  const cfg = structuredClone(SLACK_CONFIG);
  cfg.channels[0].schema[4].required = true;
  const el = mount(setupSections(cfg)[0]);
  assert.equal(flagMissing(el), 3);
  assert.deepEqual([...el.querySelectorAll('.field-invalid')].map((i) => i.dataset.key), ['botToken', 'appToken', 'channelAllowlist']);
  assert.deepEqual([...el.querySelectorAll('.field-error .fe-text')].map((m) => m.textContent), ['Enter a value.', 'Enter a value.', 'Enter a value.']);
  assert.deepEqual([el.querySelector('.mk-disc-body').hidden, el.querySelector('.mk-disc').getAttribute('aria-expanded')], [false, 'true']);
  assert.equal(doc.activeElement, el.querySelector('[data-key="botToken"]'));
  type(el, 'botToken', 'x'); type(el, 'appToken', 'y'); type(el, 'channelAllowlist', 'C1');
  assert.deepEqual([flagMissing(el), el.querySelectorAll('.field-error').length], [0, 0]);
});

test('setup fields: the details the rows above leave open', () => {
  const el = slack();
  assert.deepEqual(['notifyChatIds', 'allowedChatIds', 'channelAllowlist', 'botToken'].map((k) => el.querySelector(`[data-key="${k}"]`).getAttribute('spellcheck')),
    ['false', 'false', 'false', null], 'channel ids are code-like');
  assert.deepEqual([...el.querySelectorAll('.field[data-field]')].map((f) => f.dataset.field), ['botToken', 'appToken', 'notifyChatIds', 'allowedChatIds', 'channelAllowlist']);
  assert.equal(el.querySelector('[data-key="botToken"]').id, 'mk-f-c-main-botToken');
  const more = el.querySelector('.mk-disc');
  more.click(); more.click();
  assert.deepEqual([more.getAttribute('aria-expanded'), el.querySelector('.mk-disc-body').hidden], ['false', true], 'a second click folds it again');
  type(el, 'botToken', '  '); type(el, 'appToken', 'y');
  assert.equal(flagMissing(el), 1, 'a blank value is missing');
  const { advanced, ...bare } = F('token', 'GitHub token');
  const plain = mount(setupSections({ sources: [{ ...GH_SOURCE, id: 'my src', schema: [bare], values: {} }] })[0]);
  assert.deepEqual([plain.querySelector('.mk-disc'), plain.querySelectorAll(':scope > .field').length, plain.querySelector('[data-key="token"]').id, advanced],
    [null, 1, 'mk-f-s-my-src-token', false], 'a field without the advanced key is not advanced; ids are sanitised');
  const host = mount(setupSections({ sources: [{ ...GH_SOURCE, schema: [F('host', 'Host', { default: 'https://dev.azure.com' })], values: {} }] })[0]);
  assert.deepEqual(collectSetupFields(host).values, { host: 'https://dev.azure.com' }, 'an unset text field starts at its default');
  assert.deepEqual(setupSections({ channels: [...SLACK_CONFIG.channels, { id: 'x', displayName: 'X', schema: [] }] }).map((s) => s.id), ['main']);
  const fresh = mount(setupSections(AZURE_CONFIG())[0]).querySelector('.mk-profile-id');
  assert.deepEqual(['aria-required', 'autocomplete', 'spellcheck'].map((a) => fresh.getAttribute(a)), ['true', 'off', 'false']);
  const stored = mount(setupSections(AZURE_CONFIG([{ id: 'work', label: 'Work' }]))[0]);
  assert.equal(stored.querySelector('[data-field="pat"] label').htmlFor, stored.querySelector('.mk-replace').id, 'the label names Replace until the secret is replaced');
});

test('v3: a select without a stored value shows its default; an empty secret is never sent; model secrets are required', () => {
  const first = mount(setupSections({ sources: [{ ...GH_SOURCE, values: {}, schema: [F('closeOnComplete', 'Close work item on completion', { type: 'select',
    default: 'no', options: [{ value: 'yes', label: 'yes' }, { value: 'no', label: 'no' }] }), F('token', 'GitHub token', { secret: true })] }] })[0]);
  assert.deepEqual([first.querySelector('select').value, collectSetupFields(first)], ['no', { sourceId: 'github', values: { closeOnComplete: 'no' } }],
    'a first profile has no stored values (the server sends {}); an optional secret left empty stays out ("" reads back as { set: true })');
  const ms = mount(setupSections({ models: { schema: [F('apiKey', 'API key', { secret: true })], values: { apiKey: { set: false } } } })[0]);
  assert.deepEqual([ms.querySelector('[data-key="apiKey"]').dataset.required, ms.querySelector('.mk-req')?.textContent, flagMissing(ms)], ['1', 'Required', 1],
    'the server sends model secrets as optional; plugin-setup-state counts every one as required');
});

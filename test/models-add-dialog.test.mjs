// test/models-add-dialog.test.mjs — Add model, step 1 and the list of step 2 (models-menu P5 Task 4, DESIGN ADD-1…ADD-4):
// step 1 opens on a sign-in with Claude Code and shows each card's part; step 2's plan follows the provider's state
// before any request; its toolbar, message, mount, blocked box and foot; the sheets' status word "In catalogue".
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  ADD_PROVIDERS, ADD_PROVIDER_LABELS, renderAddStep1, collectAddStep1, renderAddStep2, addStep2Plan, paintAddSelection,
} from '../ui/public/models/add-model-dialog.mjs';
import { providerState } from '../ui/public/models/provider-state.mjs';
import { renderImportSheet, renderEndpointSheet } from '../ui/public/bridge-view.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

/** GET /api/providers: Copilot signed in, OpenRouter's key set, the OpenAI-compatible row keyed with no address. */
const P = Object.freeze({
  copilot: { connected: true }, openrouter: { keySet: true }, openai: { configured: true, keySet: true, baseUrl: '' },
  anthropic: {}, broker: { enabled: false },
});
const ALL_READY = ['claude', 'codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen'].map((name) => ({ name, ready: true }));

const opts = (root) => [...root.querySelectorAll('[role="radiogroup"] button.mdl-opt[role="radio"]')];
const optOf = (root, where) => root.querySelector(`.mdl-opt[data-where="${where}"]`);
const change = (sel, value) => { sel.value = value; sel.dispatchEvent(new sel.ownerDocument.defaultView.Event('change', { bubbles: true })); };

test('step 1 opens on a sign-in with Claude Code', () => {
  const doc = docOf();
  const root = renderAddStep1({}, { doc, providers: P, engines: ALL_READY });
  doc.body.append(root);
  assert.ok(root.matches('section.card.mdl-add[data-step="1"]'));
  assert.ok(!root.classList.contains('dlg'), 'app.js lays it out');
  assert.equal(root.querySelector('.mdl-add-head > h3.mv-editor-title').textContent, 'Add model');
  assert.equal(root.querySelector('[role="radiogroup"]').getAttribute('aria-label'), 'Where it runs');
  assert.deepEqual(opts(root).map((o) => [o.dataset.where, o.getAttribute('aria-checked'), o.querySelector('.mdl-opt-t').textContent]), [
    ['provider', 'false', 'A provider'], ['signin', 'true', 'A sign-in'], ['env', 'false', 'A custom endpoint'],
  ]);
  assert.deepEqual(opts(root).map((o) => o.querySelector('.mdl-opt-d').textContent), [
    'GitHub Copilot, OpenRouter, OpenAI-compatible, Anthropic-compatible',
    'A CLI you are signed in to, such as Claude Code',
    'Set by env vars. Claude Code only',
  ]);
  assert.ok(opts(root).every((o) => o.type === 'button' && o.querySelector('.mdl-opt-kind .ic') && !o.disabled));
  assert.ok(root.querySelector('.mdl-hx[aria-label="Harness"] [data-engine="claude"][aria-pressed="true"]'));
  assert.equal(root.querySelector('.mdl-add-provider'), null);
  assert.equal(root.querySelector('.mdl-steps [aria-current="step"]').textContent, '1 Where it runs');
  assert.deepEqual([...root.querySelectorAll('.mdl-steps li')].map((li) => li.textContent), ['1 Where it runs', '2 The model']);
  const close = root.querySelector('.mdl-add-head > button.mdl-close');
  assert.ok(close.matches('.btn.btn-quiet.btn-sm.btn-icon[aria-label="Close"]'));
  assert.ok(close.querySelector('.ic'));
  const foot = root.querySelector(':scope > .mdl-add-foot.mv-editor-btns');
  assert.deepEqual([...foot.querySelectorAll('button')].map((b) => [b.className, b.textContent]), [
    ['btn mv-cancel', 'Cancel'], ['btn btn-primary mdl-next', 'Next'],
  ]);
  assert.deepEqual(collectAddStep1(root), { where: 'signin', provider: 'copilot', engine: 'claude' });

  root.querySelector('.mdl-hx [data-engine="codex"]').click();
  assert.equal(collectAddStep1(root).engine, 'codex');

  optOf(root, 'provider').click();
  assert.deepEqual(opts(root).map((o) => o.getAttribute('aria-checked')), ['true', 'false', 'false']);
  const sel = root.querySelector('select.mdl-add-provider');
  assert.ok(sel, 'the provider card shows the select');
  assert.equal(root.querySelector('.mdl-hx'), null, 'and hides the tiles');
  assert.deepEqual(collectAddStep1(root), { where: 'provider', provider: 'copilot', engine: 'codex' });

  change(sel, 'openai');
  optOf(root, 'env').click();
  assert.equal(root.querySelector('.mdl-add-provider'), null);
  assert.equal(root.querySelector('.mdl-hx'), null, 'a custom endpoint has no part');
  assert.deepEqual(collectAddStep1(root), { where: 'env', provider: 'openai', engine: 'codex' });

  optOf(root, 'signin').click();
  assert.ok(root.querySelector('.mdl-hx [data-engine="codex"][aria-pressed="true"]'), 'the pick survives a round trip');
  optOf(root, 'provider').click();
  assert.equal(root.querySelector('.mdl-add-provider').value, 'openai');
});

test('step 1 for a provider', () => {
  const doc = docOf();
  assert.deepEqual([...ADD_PROVIDERS], ['copilot', 'openrouter', 'openai', 'anthropic']);
  const root = renderAddStep1({ where: 'provider', provider: 'openrouter' }, { doc, providers: { ...P, openrouter: { keySet: false } } });
  const sel = root.querySelector('select.mdl-add-provider');
  assert.deepEqual([...sel.options].map((o) => [o.value, o.textContent]), ADD_PROVIDERS.map((p) => [p, ADD_PROVIDER_LABELS[p]]));
  assert.deepEqual([...sel.options].map((o) => o.textContent), ['GitHub Copilot', 'OpenRouter', 'OpenAI-compatible', 'Anthropic-compatible']);
  assert.equal(sel.value, 'openrouter');
  assert.equal(root.querySelector('.mdl-st.need').textContent, 'Needs key');
  assert.equal(root.querySelector('.mdl-hx'), null);
  assert.equal(optOf(root, 'provider').getAttribute('aria-checked'), 'true');
  const label = root.querySelector(`label[for="${sel.id}"]`);
  assert.equal(label && label.textContent, 'Provider');

  change(sel, 'copilot');
  assert.equal(root.querySelectorAll('.mdl-st').length, 1, 'the select repaints the one state word');
  assert.equal(root.querySelector('.mdl-st.ok').textContent, 'Connected');
  assert.equal(collectAddStep1(root).provider, 'copilot');

  const bare = renderAddStep1({ where: 'provider' }, { doc });
  assert.ok(bare.querySelector('select.mdl-add-provider'));
  assert.equal(bare.querySelector('.mdl-st'), null, 'nothing claimed without the providers');

  const fixed = renderAddStep1({ where: 'provider', provider: 'openai' }, { doc, providers: P, fixedEngine: 'codex' });
  assert.equal(fixed.querySelector('.mdl-hx'), null);
  assert.equal(optOf(fixed, 'env').disabled, true);
  assert.equal(optOf(fixed, 'signin').disabled, false);
  assert.equal(optOf(fixed, 'provider').disabled, false);
  assert.equal(fixed.querySelector('.mdl-next').textContent, 'Continue');
  assert.equal(fixed.querySelector('.mdl-steps'), null, 'no step names');
  assert.deepEqual(opts(fixed).map((o) => o.tabIndex), [0, -1, -1], 'one tab stop: the checked card');
  const arrow = (key) => fixed.querySelector('.mdl-opt[aria-checked="true"]').dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key, bubbles: true }));
  arrow('ArrowDown');
  assert.equal(collectAddStep1(fixed).where, 'signin');
  assert.deepEqual(opts(fixed).map((o) => o.tabIndex), [-1, 0, -1]);
  arrow('ArrowDown');
  assert.equal(collectAddStep1(fixed).where, 'provider', 'the arrows skip a disabled card');
  arrow('ArrowUp');
  assert.equal(collectAddStep1(fixed).where, 'signin', 'ArrowUp wraps past the disabled card');
  optOf(fixed, 'signin').click();
  assert.equal(fixed.querySelector('.mdl-hx'), null, 'a saved model keeps its harness');
  assert.deepEqual(collectAddStep1(fixed), { where: 'signin', provider: 'openai', engine: 'codex' });

  const other = renderAddStep1({ where: 'env' }, { doc, fixedEngine: 'cursor' });
  assert.deepEqual(opts(other).map((o) => [o.dataset.where, o.disabled, o.getAttribute('aria-checked')]), [
    ['provider', true, 'false'], ['signin', false, 'true'], ['env', true, 'false'],
  ], 'a where the harness does not allow falls back to its sign-in');
});

test("step 1's cards are one radio group: each arrow moves the pick and the focus across the enabled cards", () => {
  const doc = docOf();
  const key = (root, k) => {
    const e = new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
    root.querySelector('.mdl-opt[aria-checked="true"]').dispatchEvent(e);
    return e.defaultPrevented;
  };
  const root = renderAddStep1({}, { doc, engines: ALL_READY });
  doc.body.append(root);
  optOf(root, 'signin').focus();
  for (const [k, where] of [['ArrowDown', 'env'], ['ArrowRight', 'provider'], ['ArrowUp', 'env'], ['ArrowLeft', 'signin']]) {
    assert.equal(key(root, k), true, `${k} is the group's (preventDefault: the dialog does not scroll)`);
    assert.deepEqual(opts(root).map((o) => o.getAttribute('aria-checked')), opts(root).map((o) => String(o.dataset.where === where)), `${k} checks ${where}`);
    assert.deepEqual(opts(root).map((o) => o.tabIndex), opts(root).map((o) => (o.dataset.where === where ? 0 : -1)), `${k}: the one tab stop moves`);
    assert.equal(doc.activeElement, optOf(root, where), `${k}: the focus follows the pick`);
  }
  for (const k of ['Tab', 'Enter', ' ']) assert.equal(key(root, k), false, `${k} is not the group's`);
  assert.equal(collectAddStep1(root).where, 'signin');
  assert.ok(root.querySelector('.mdl-add-part .mdl-hx'), 'the picked card shows its part');

  const fixed = renderAddStep1({ where: 'signin' }, { doc, fixedEngine: 'codex' });
  doc.body.append(fixed);
  for (const [k, where] of [['ArrowRight', 'provider'], ['ArrowLeft', 'signin'], ['ArrowDown', 'provider'], ['ArrowUp', 'signin']]) {
    assert.equal(key(fixed, k), true, k);
    assert.equal(collectAddStep1(fixed).where, where, `${k} skips the disabled custom endpoint`);
    assert.equal(doc.activeElement, optOf(fixed, where), `${k}: the focus follows`);
  }
});

test("step 1's harness tiles take the app's locks", () => {
  const doc = docOf();
  const click = (n) => n.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  const locks = [{ name: 'codex', reason: 'Off while the credential broker is on' }];
  const root = renderAddStep1({}, { doc, providers: P, engines: ALL_READY, locks });
  doc.body.append(root);
  const codex = root.querySelector('.mdl-hx-t[data-engine="codex"]');
  assert.equal(codex.disabled, true);
  assert.equal(codex.title, 'Off while the credential broker is on');
  click(codex);   // a dispatched click reaches a disabled button's listeners
  assert.equal(collectAddStep1(root).engine, 'claude', 'a click on a locked tile picks nothing');
  click(optOf(root, 'provider'));
  assert.equal(collectAddStep1(root).engine, 'claude', 'nor does the screen keep it while the tiles are away');
  click(optOf(root, 'signin'));
  assert.ok(root.querySelector('.mdl-hx-t[data-engine="claude"][aria-pressed="true"]'));

  const held = renderAddStep1({ where: 'provider', engine: 'codex' }, { doc, engines: ALL_READY, locks });
  assert.equal(collectAddStep1(held).engine, 'claude', 'a harness the flow held, locked since, is not kept');
  click(optOf(held, 'signin'));
  assert.ok(held.querySelector('.mdl-hx-t[data-engine="claude"][aria-pressed="true"]'));
});

test('"Change where it runs" offers a harness only the providers it can use', () => {
  const doc = docOf();
  const values = (root) => [...root.querySelector('select.mdl-add-provider').options].map((o) => o.value);
  const said = (root) => optOf(root, 'provider').querySelector('.mdl-opt-d').textContent;
  const codex = renderAddStep1({ where: 'provider', provider: 'openai' }, { doc, providers: P, fixedEngine: 'codex' });
  assert.deepEqual(values(codex), ['openrouter', 'openai']);
  assert.equal(codex.querySelector('select.mdl-add-provider').value, 'openai');
  assert.equal(said(codex), 'OpenRouter, OpenAI-compatible');
  const copilot = renderAddStep1({ where: 'provider', provider: 'copilot' }, { doc, providers: P, fixedEngine: 'codex' });
  assert.equal(copilot.querySelector('select.mdl-add-provider').value, 'openrouter', 'one Codex cannot use: the first it can');
  assert.equal(collectAddStep1(copilot).provider, 'openrouter');
  assert.equal(collectAddStep1(renderAddStep1({ where: 'signin', provider: 'anthropic' }, { doc, fixedEngine: 'codex' })).provider, 'openrouter',
    'also while the provider part is away');

  const claude = renderAddStep1({ where: 'provider', provider: 'anthropic' }, { doc, providers: P, fixedEngine: 'claude' });
  assert.deepEqual(values(claude), [...ADD_PROVIDERS], 'Claude Code keeps all four');
  assert.equal(claude.querySelector('select.mdl-add-provider').value, 'anthropic');
  assert.equal(said(claude), 'GitHub Copilot, OpenRouter, OpenAI-compatible, Anthropic-compatible');
});

test('what step 2 does per provider', () => {
  assert.deepEqual(addStep2Plan('copilot', { ...P, copilot: { connected: false } }), { kind: 'blocked', text: 'Needs sign-in', fix: 'Sign in', row: 'copilot' });
  assert.deepEqual(addStep2Plan('copilot', P), { kind: 'list', source: 'copilot' });
  assert.deepEqual(
    addStep2Plan('copilot', { ...P, copilot: { connected: false }, broker: { enabled: true, providers: { copilot: { state: 'set' } } } }),
    { kind: 'list', source: 'copilot' }, "the broker's green state lists",
  );
  assert.deepEqual(addStep2Plan('openrouter', P), { kind: 'list', source: 'endpoint', baseUrl: 'https://openrouter.ai/api/v1', auto: true });
  assert.deepEqual(addStep2Plan('openrouter', { ...P, openrouter: { keySet: false } }), { kind: 'blocked', text: 'Needs key', fix: 'Set key', row: 'openrouter' });
  const env = { ...P, openrouter: { keySource: 'env', keyRef: '${OPENROUTER_KEY}' } };
  const s = providerState(env, 'openrouter', { hasModels: true });
  assert.equal(s.tone, 'fail');
  assert.deepEqual(addStep2Plan('openrouter', env), { kind: 'blocked', text: s.text, fix: 'Set key', row: 'openrouter' });
  assert.equal(addStep2Plan('openrouter', env).text, 'Key ${OPENROUTER_KEY} not set');
  const local = { ...P, openai: { configured: true, baseUrl: 'http://127.0.0.1:11434/v1' } };
  assert.deepEqual(addStep2Plan('openai', local), { kind: 'list', source: 'endpoint', baseUrl: 'http://127.0.0.1:11434/v1', auto: true });
  assert.deepEqual(addStep2Plan('openai', local, { baseUrl: 'http://box:8080/v1' }), { kind: 'list', source: 'endpoint', baseUrl: 'http://box:8080/v1', auto: true });
  assert.deepEqual(addStep2Plan('openai', P), { kind: 'list', source: 'endpoint', baseUrl: '', auto: false });
  assert.deepEqual(addStep2Plan('openai', null), { kind: 'list', source: 'endpoint', baseUrl: '', auto: false });
  assert.deepEqual(addStep2Plan('anthropic', P), { kind: 'nolist', text: 'No list to pick from' });
});

test("step 2's toolbar and foot", () => {
  const doc = docOf();
  const withUrl = { ...P, openai: { configured: true, baseUrl: 'http://127.0.0.1:11434/v1' } };
  const op = renderAddStep2({ provider: 'openai', baseUrl: '' }, { doc, providers: withUrl });
  assert.ok(op.matches('section.card.mdl-add[data-step="2"]'));
  assert.ok(!op.classList.contains('dlg'));
  assert.equal(op.querySelector('.mdl-steps [aria-current="step"]').textContent, '2 The model');
  assert.ok(op.querySelector('.mdl-add-head > button.mdl-close.btn[aria-label="Close"]'));
  assert.equal(op.querySelector('select.mdl-add-provider').value, 'openai');
  const base = op.querySelector('input#mimp-base');
  assert.equal(base.value, 'http://127.0.0.1:11434/v1');
  assert.equal(base.placeholder, 'http://127.0.0.1:11434/v1');
  assert.equal(op.querySelector('button#mimp-list').textContent, 'List models');
  assert.deepEqual([...op.querySelectorAll('button.mimp-preset')].map((b) => [b.dataset.preset, b.textContent]), [['gemini', 'Gemini'], ['qwen', 'Qwen']]);
  const key = op.querySelector('input#mimp-key');
  assert.equal(key.placeholder, '${GEMINI_API_KEY}');
  assert.equal(op.querySelector('label[for="mimp-key"]').textContent, 'API key (optional)');
  assert.equal(renderAddStep2({ provider: 'openai', baseUrl: 'http://box:8080/v1' }, { doc, providers: withUrl }).querySelector('#mimp-base').value, 'http://box:8080/v1');
  assert.equal(renderAddStep2({ provider: 'openai' }, { doc }).querySelector('#mimp-base').value, '');

  const cp = renderAddStep2({ provider: 'copilot' }, { doc, providers: P });
  assert.equal(cp.querySelector('#mimp-base'), null);
  assert.equal(cp.querySelector('.mimp-preset'), null);
  assert.equal(cp.querySelector('#mimp-key'), null);
  const go = cp.querySelector('button#mimp-go');
  assert.ok(go.matches('.btn.btn-primary'));
  assert.equal(go.disabled, true);
  assert.equal(go.textContent, 'Add models');
  const filter = cp.querySelector('input#mimp-filter.input[type="search"]');
  assert.ok(filter.hasAttribute('data-dirty-ignore'));
  assert.equal(filter.placeholder, 'Filter by model, id or vendor');
  assert.equal(filter.getAttribute('aria-label'), 'Filter the listed models');
  assert.equal(filter.hidden, false, 'always shown');
  const manual = cp.querySelector('button.mdl-manual');
  assert.ok(manual.matches('.btn.btn-quiet'));
  assert.equal(manual.textContent, 'Enter an id instead');
  assert.equal(cp.querySelector('p#mimp-msg').getAttribute('aria-live'), 'polite');
  assert.equal(cp.querySelector('div#mimp-body').childElementCount, 0);
  const blocked = cp.querySelector('div.mdl-add-blocked');
  assert.equal(blocked.hidden, true);
  assert.ok(blocked.querySelector('span.mdl-st'));
  assert.ok(blocked.querySelector('button.btn.mdl-add-fix'));
  for (const node of [...op.querySelectorAll('[id]'), ...cp.querySelectorAll('[id]')].filter((n) => n.id.startsWith('mimp-'))) {
    assert.ok(node.classList.contains(node.id), `#${node.id} carries .${node.id}: app.js reaches it by class`);
  }
  const foot = cp.querySelector(':scope > .mdl-add-foot.mv-editor-btns');
  assert.deepEqual([...foot.children].map((n) => [n.tagName, n.className, n.textContent]), [
    ['SPAN', 'mdl-add-note', ''], ['BUTTON', 'btn mv-back', 'Back'], ['BUTTON', 'btn btn-primary mimp-go', 'Add models'],
  ]);
  assert.ok([...foot.querySelectorAll('.btn')].every((b) => !b.classList.contains('btn-sm')));

  const read = () => [cp.querySelector('.mdl-add-note').textContent, go.textContent, go.disabled];
  paintAddSelection(cp, 2);
  assert.deepEqual(read(), ['2 selected', 'Add 2 models', false]);
  paintAddSelection(cp, 1);
  assert.deepEqual(read(), ['1 selected', 'Add 1 model', false]);
  paintAddSelection(cp, 0);
  assert.deepEqual(read(), ['', 'Add models', true]);
});

test('the sheets say "In catalogue"', () => {
  const doc = docOf();
  const sheet = renderImportSheet([{ id: 'gpt-x', name: 'GPT X', vendor: 'OpenAI', policyState: 'enabled', inCatalog: true }], { doc });
  assert.equal(sheet.querySelector('.mvi-status').textContent, 'In catalogue');
  const ep = renderEndpointSheet({ baseUrl: 'http://127.0.0.1:11434/v1', models: [{ id: 'qwen3', inCatalog: true }] }, { doc });
  assert.equal(ep.querySelector('.mvi-status').textContent, 'In catalogue');
});

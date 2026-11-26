// test/ui-inspector-engine.test.mjs — the composer inspector knows no run engine, so it shows one
// model list grouped Claude / Codex (cascading-settings-design.md D10) and the picked model's
// own efforts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderNodeInspector } from '../ui/public/graph/inspector.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude' },
  { id: 'gpt-5.5', label: 'GPT-5.5', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex' },
];
const opts = (models) => ({ template: { nodes: [], wires: [] }, portsFn: () => ({ inputs: [], outputs: [] }), meta: { key: 'planner', displayName: 'Plan' }, models, efforts: ['medium', 'high', 'xhigh', 'max'], doc });

test('the agent inspector groups models by provider, names a harness other than Claude Code, and offers the picked model\'s own efforts', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: { model: 'gpt-5.5', effort: 'low' } }, opts(MODELS));
  const sel = el.querySelector('[data-field="model"]');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Claude sign-in', 'ChatGPT sign-in']);
  assert.deepEqual([...sel.querySelectorAll('optgroup[label="ChatGPT sign-in"] option')].map((o) => [o.value, o.textContent]), [['gpt-5.5', 'GPT-5.5 · OpenAI Codex']]);
  assert.equal(sel.options[0].value, '', 'inherit stays first, outside the groups');
  assert.equal(sel.value, 'gpt-5.5');
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'minimal', 'low', 'medium', 'high']);
});

test('one connection in the catalog: still its group (every model picker groups by connection), and the given efforts', () => {
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: {} }, opts([MODELS[0]]));
  assert.deepEqual([...el.querySelectorAll('[data-field="model"] optgroup')].map((g) => g.label), ['Claude sign-in']);
  assert.deepEqual([...el.querySelector('[data-field="effort"]').options].map((o) => o.value), ['', 'medium', 'high', 'xhigh', 'max']);
});

test('an endpoint model both harnesses reach is listed once, under its provider, naming both', () => {
  const ep = { id: 'openai-gpt-5.5', label: 'GPT-5.5 (API)', efforts: ['medium', 'high'], engine: 'claude', harnesses: ['claude', 'codex'], connection: { kind: 'provider', provider: 'openai', api: 'openai-responses', codex: true } };
  const el = renderNodeInspector({ id: 'n_agent', kind: 'agent', key: 'planner', config: {} }, opts([...MODELS, ep]));
  const sel = el.querySelector('[data-field="model"]');
  assert.deepEqual([...sel.querySelectorAll('optgroup')].map((g) => g.label), ['Claude sign-in', 'ChatGPT sign-in', 'OpenAI-compatible']);
  assert.deepEqual([...sel.querySelectorAll('optgroup[label="OpenAI-compatible"] option')].map((o) => o.textContent), ['GPT-5.5 (API) · Claude Code, OpenAI Codex']);
});

// ── node time limits (#1646) ──
const LIMITS = [['timeLimitMinutes', 'Time limit (min)'], ['idleLimitMinutes', 'Idle limit (min)']];
const agentPanel = (config) => renderNodeInspector({ id: 'n_impl', kind: 'agent', key: 'planner', config }, opts([MODELS[0]]));
const limitField = (el, key) => {
  const input = el.querySelector(`[data-field="${key}"]`);
  assert.ok(input, `the ${key} field`);
  const wrap = input.closest('.ins-f');
  const described = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map((id) => el.querySelector(`[id="${id}"]`));
  return { input, wrap, label: wrap.querySelector('label.ins-label'), described };
};

test('R-ux-1, R-ux-5: an agent node shows both limit fields empty, each described as no limit when left empty', () => {
  const el = agentPanel({});
  const awaitAll = el.querySelector('[data-field="awaitAll"]');
  for (const [key, label] of LIMITS) {
    const f = limitField(el, key);
    assert.equal(f.input.value, '');
    assert.equal(f.input.type, 'text', 'the raw typed text reaches the composer');
    assert.equal(f.input.getAttribute('inputmode'), 'decimal');
    assert.equal(f.label.textContent, label);
    assert.ok(f.input.id);
    assert.equal(f.label.htmlFor, f.input.id, 'the label is tied to its input');
    assert.ok(awaitAll.compareDocumentPosition(f.input) & 4, 'after Await all inputs');
    const hint = f.wrap.nextElementSibling;
    assert.ok(hint?.matches('small.ins-hint'), 'the hint follows the field');
    assert.match(hint.textContent, /Leave empty for no limit/i);
    assert.match(hint.textContent, /minutes/);
    assert.deepEqual(f.described, [hint], 'aria-describedby names the hint');
    for (const part of [f.wrap, hint]) {
      assert.equal(part.dataset.minLevel, 'expert', 'gated like the script Timeout');
      assert.equal('levelKeep' in part.dataset, false);
    }
    assert.equal(f.input.classList.contains('field-invalid'), false);
  }
  assert.equal(limitField(el, 'timeLimitMinutes').described[0].textContent, 'Leave empty for no limit, or enter minutes as an upper limit.');
  assert.equal(el.querySelector('.field-error'), null);
});

test('R-ux-2: a stored limit is shown and kept on screen at every level; the other field stays empty', () => {
  const el = agentPanel({ idleLimitMinutes: 2000 });
  const idle = limitField(el, 'idleLimitMinutes');
  assert.equal(idle.input.value, '2000');
  assert.equal(idle.wrap.dataset.levelKeep, '1');
  assert.ok(idle.wrap.nextElementSibling?.matches('small.ins-hint'), 'a valid value keeps its hint');
  assert.equal(limitField(el, 'timeLimitMinutes').input.value, '');
  assert.equal(el.querySelector('.field-error'), null);
});

test('R-ux-6: an invalid stored value shows the house field error in place of the hint', () => {
  for (const bad of [0, -1, 'abc', '0,5']) {
    const el = agentPanel({ timeLimitMinutes: bad });
    const f = limitField(el, 'timeLimitMinutes');
    assert.equal(f.input.value, String(bad), 'shows what was typed');
    const err = f.wrap.querySelector('.field-error');
    assert.ok(err, `${bad}: a message under the field`);
    assert.ok(err.querySelector('.fe-ic'));
    assert.equal(err.querySelector('.fe-text').textContent, 'Enter minutes above 0, or leave it empty for no limit.');
    assert.ok(f.input.classList.contains('field-invalid'));
    assert.equal(f.input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(f.described, [err], 'aria-describedby names the error, and only it');
    assert.equal(f.wrap.nextElementSibling?.matches('.ins-hint') === true, false, 'one message under the field');
    const other = limitField(el, 'idleLimitMinutes');
    assert.ok(other.wrap.nextElementSibling?.matches('small.ins-hint'), 'the valid field keeps its hint');
    assert.equal(el.querySelectorAll('.field-error').length, 1);
  }
});

test('R-ux-4, R-ux-5: script and flow node settings show no limit field', () => {
  for (const node of [{ id: 'n_s', kind: 'script', key: 'shell', config: {} }, { id: 'n_and', kind: 'and', config: { arity: 2 } }]) {
    const el = renderNodeInspector(node, opts([MODELS[0]]));
    for (const [key, label] of LIMITS) {
      assert.equal(el.querySelector(`[data-field="${key}"]`), null, `${node.kind}: ${key}`);
      assert.equal(el.textContent.includes(label), false);
    }
  }
});

test('R-ux-4: no other screen (Settings, New run, project agent settings) offers a node limit', () => {
  const ui = fileURLToPath(new URL('../ui/public/', import.meta.url));
  const allowed = new Set(['graph/inspector.mjs', 'graph/composer.mjs']);
  const hits = readdirSync(ui, { recursive: true }).filter((f) => /\.(mjs|js|html)$/.test(f))
    .filter((f) => /timeLimitMinutes|idleLimitMinutes|Time limit \(min\)|Idle limit \(min\)/.test(readFileSync(join(ui, f), 'utf8')))
    .map((f) => relative(ui, join(ui, f)).replaceAll('\\', '/')).filter((f) => !allowed.has(f));
  assert.deepEqual(hits, []);
});

test('R-ux-6: an edit that ends on the same invalid text brings the error back on Enter or leaving the field', () => {
  const win = doc.defaultView;
  for (const commit of [(i) => i.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })), (i) => i.dispatchEvent(new win.Event('blur'))]) {
    const el = agentPanel({ idleLimitMinutes: 'abc' });
    doc.body.replaceChildren(el);
    const f = limitField(el, 'idleLimitMinutes');
    f.input.value = 'abcz';
    f.input.dispatchEvent(new win.Event('input', { bubbles: true }));
    assert.equal(el.querySelector('.field-error'), null, 'typing clears the message');
    f.input.value = 'abc';   // the text the field had when focused: the browser fires no change event
    f.input.dispatchEvent(new win.Event('input', { bubbles: true }));
    commit(f.input);
    const err = f.wrap.querySelector('.field-error');
    assert.ok(err, 'the message is back');
    assert.equal(err.querySelector('.fe-text').textContent, 'Enter minutes above 0, or leave it empty for no limit.');
    assert.equal(f.input.getAttribute('aria-invalid'), 'true');
    assert.deepEqual(limitField(el, 'idleLimitMinutes').described, [err]);
    commit(f.input);
    assert.equal(el.querySelectorAll('.field-error').length, 1, 'one message, not one per commit');
  }
});

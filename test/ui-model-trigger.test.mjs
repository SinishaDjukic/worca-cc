import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { modelTrigger } from '../ui/public/models/model-columns.mjs';

const sign = (engine) => ({ kind: 'signin', engine });
const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high'], engine: 'claude', connection: sign('claude'), harnesses: ['claude'] },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['low', 'high'], engine: 'codex', connection: sign('codex'), harnesses: ['codex'] },
];
const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
function rig(opts = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="host"></div></body>'); doms.push(dom);
  const win = dom.window; const doc = win.document; const host = doc.getElementById('host');
  const btn = modelTrigger({ doc, win, value: null, catalog: CAT, label: 'Model for Plan', defaultEngine: 'claude', inheritHint: 'workflow default', ...opts });
  host.append(btn);
  const changes = [];
  host.addEventListener('change', (e) => changes.push([e.target.value, e.target.dataset.engine]));
  const pop = () => doc.querySelector('.mdl-cols-pop');
  const opt = (col, key) => [...pop().querySelectorAll(`[data-col="${col}"] [role="option"]`)].find((b) => b.dataset.key === key);
  return { doc, btn, changes, pop, opt };
}

test('an empty value is the inherit trigger; a pinned one shows its harness mark; a lost model says so', () => {
  const a = rig().btn;
  assert.deepEqual([a.tagName, a.type, a.className, a.value, a.dataset.engine, a.getAttribute('aria-haspopup'), a.getAttribute('aria-expanded'), a.getAttribute('aria-label'), a.querySelector('.mdl-pick-text').textContent, !!a.querySelector('.mdl-mark')],
    ['BUTTON', 'button', 'mdl-pick inherit', '', '', 'dialog', 'false', 'Model for Plan: inherit', 'inherit', false]);
  const b = rig({ value: { model: 'gpt-6.1-sol', engine: 'codex' }, cls: 'step-model' }).btn;
  assert.deepEqual([b.className, b.value, b.dataset.engine, b.getAttribute('aria-label'), b.querySelector('.mdl-pick-text').textContent, !!b.querySelector('.mdl-mark.sm')],
    ['mdl-pick step-model', 'gpt-6.1-sol', 'codex', 'Model for Plan: GPT-6.1 Sol, on OpenAI Codex', 'GPT-6.1 Sol', true]);
  const c = rig({ value: { model: 'gone-1' } }).btn;
  assert.deepEqual([c.value, c.dataset.engine, c.querySelector('.mdl-pick-text').textContent, !!c.querySelector('.mdl-mark')], ['gone-1', '', 'gone-1 (not in the catalog)', false]);
});

test('a pick sets value and data-engine, redraws the trigger, focuses it and fires one bubbling change; inherit clears both', () => {
  const r = rig();
  r.btn.click();
  assert.deepEqual([r.pop().getAttribute('aria-label'), r.pop().querySelector('.mdl-cols-hint').textContent], ['Model for Plan', 'workflow default']);
  r.opt('harness', 'codex').click();
  r.opt('model', 'gpt-6.1-sol').click();
  assert.equal(r.pop(), null);
  assert.deepEqual(r.changes, [['gpt-6.1-sol', 'codex']]);
  assert.deepEqual([r.btn.className, r.btn.querySelector('.mdl-pick-text').textContent, !!r.btn.querySelector('.mdl-mark'), r.btn.getAttribute('aria-label'), r.doc.activeElement === r.btn],
    ['mdl-pick', 'GPT-6.1 Sol', true, 'Model for Plan: GPT-6.1 Sol, on OpenAI Codex', true]);
  r.btn.click();
  r.pop().querySelector('.mdl-cols-inherit').click();
  assert.deepEqual([r.changes[1], r.btn.className], [['', ''], 'mdl-pick inherit']);
});

test('it opens on the value it holds now; Add model reaches the host; a disabled trigger opens nothing', () => {
  const adds = [];
  const r = rig({ onAddModel: (e) => adds.push(e) });
  r.btn.value = 'gpt-6.1-sol'; r.btn.dataset.engine = 'codex';   // set by a host, as on a <select>
  r.btn.click();
  assert.equal(r.opt('harness', 'codex').getAttribute('aria-selected'), 'true');
  assert.ok(r.opt('model', 'gpt-6.1-sol').querySelector('.ask-model-check'));
  r.opt('harness', 'cursor').click();
  r.pop().querySelector('.mdl-cols-add').click();
  assert.deepEqual(adds, ['cursor']);
  const d = rig({ disabled: true, title: 'Set in Settings › Memory' });
  d.btn.click();
  assert.deepEqual([d.btn.disabled, d.btn.title, d.pop()], [true, 'Set in Settings › Memory', null]);
});

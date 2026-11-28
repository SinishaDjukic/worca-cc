import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { openModelColumns } from '../ui/public/models/model-columns.mjs';
import { cssRules } from './helpers/css-rules.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';
const sign = (engine) => ({ kind: 'signin', engine });
const prov = (provider, api, codex = false) => ({ kind: 'provider', provider, api, codex, prefer: 'claude' });
const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'], engine: 'claude', connection: sign('claude'), harnesses: ['claude'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'], engine: 'claude', connection: sign('claude'), harnesses: ['claude'], hidden: true },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', efforts: ['minimal', 'low', 'medium', 'high'], engine: 'codex', connection: sign('codex'), harnesses: ['codex'] },
  { id: 'openai-gpt-6.1-sol', label: 'GPT-6.1 Sol (OpenAI-compatible)', efforts: ['low', 'medium', 'high'], custom: 'global', bridged: 'openai', upstreamModel: 'gpt-6.1-sol', connection: prov('openai', 'openai-responses', true), harnesses: ['claude', 'codex'] },
  { id: 'or-kimi-k3', label: 'Kimi K3 (OpenRouter)', custom: 'global', bridged: 'openai', upstreamModel: 'moonshotai/kimi-k3', needsSignIn: true, signInReason: 'no_key', connection: prov('openai', 'openai-chat'), harnesses: ['claude'] },
  { id: 'ant-sonnet', label: 'Sonnet via gateway', custom: 'global', bridged: 'anthropic', needsSignIn: true, signInReason: 'no_key', connection: prov('anthropic', 'anthropic-messages'), harnesses: ['claude'] },
  { id: 'gh-gpt', label: 'GPT-5 (Copilot)', custom: 'global', bridged: 'copilot', needsSignIn: true, signInReason: 'signed_out', connection: prov('copilot', null), harnesses: ['claude'] },
  { id: 'copilot/claude-sonnet-5-5', label: 'Claude Sonnet 5.5', efforts: ['low', 'medium', 'high'], engine: 'copilot', builtin: true, connection: sign('copilot'), harnesses: ['copilot'] },
];
const ENGINES = [{ name: 'claude', label: 'Claude Code', ready: true, reason: null }, { name: 'codex', label: 'OpenAI Codex', ready: false, reason: 'Codex is not signed in.' },
  { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor is off while the credential broker is on', broker: true }];
const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
function rig({ value = null, engines = () => ENGINES, onAddModel } = {}) {
  const dom = new JSDOM('<!doctype html><body><button id="t" type="button">Model</button></body>'); doms.push(dom);
  const win = dom.window; const doc = win.document; const anchor = doc.getElementById('t');
  const picks = []; const adds = [];
  const open = (o = {}) => openModelColumns({ doc, win, anchor, catalog: CAT, value, defaultEngine: 'claude', engines, inheritHint: 'follows the run',
    label: 'Model for Plan', onPick: (v) => picks.push(v), onAddModel: onAddModel === undefined ? (e) => adds.push(e) : onAddModel, ...o });
  const pop = () => doc.querySelector('.mdl-cols-pop');
  const col = (c) => pop().querySelector(`[data-col="${c}"]`);
  const rows = (c) => [...col(c).querySelectorAll('[role="option"]')];
  const row = (c, k) => rows(c).find((r) => r.dataset.key === k);
  const names = (c) => rows(c).map((r) => r.querySelector('.mdl-cols-name').textContent);
  const key = (k, t = doc.activeElement) => { const e = new win.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }); t.dispatchEvent(e); return e; };
  return { win, doc, anchor, picks, adds, open, pop, col, rows, row, names, key };
}
/** A getter in readyEngines' style that has no rows until land() runs its waiter. */
function lateRows() {
  let rows = null; let waiter = null;
  return { get: (onLoad) => { if (!rows && onLoad) waiter = onLoad; return rows; }, land: () => { rows = ENGINES; if (waiter) waiter(); } };
}

test('the panel: a non-modal dialog on <body> with inherit and the host\'s hint, a divider and three labelled listboxes', () => {
  const r = rig(); r.open();
  const p = r.pop();
  assert.deepEqual([p.parentNode, p.className, p.getAttribute('role'), p.getAttribute('aria-label'), p.getAttribute('aria-modal'), r.anchor.getAttribute('aria-expanded')],
    [r.doc.body, 'menu mdl-cols-pop', 'dialog', 'Model for Plan', null, 'true']);
  const inh = p.querySelector('button.mdl-cols-inherit');
  assert.deepEqual([inh.querySelector('.mdl-cols-inherit-t').textContent, inh.querySelector('.mdl-cols-hint').textContent, inh.lastElementChild.className], ['inherit', 'follows the run', 'ask-model-check']);
  assert.ok(inh.nextElementSibling.matches('.menu-sep[role="separator"]'));
  const heads = [...p.querySelectorAll('.mdl-col-h')].map((h) => h.textContent);
  assert.deepEqual(heads, ['Harness', 'Provider', 'Model · 1']);
  ['harness', 'provider', 'model'].forEach((c, i) => assert.equal(r.doc.getElementById(r.col(c).querySelector('[role="listbox"]').getAttribute('aria-labelledby')).textContent, heads[i]));
  assert.deepEqual(r.names('harness'), ['Claude Code', 'GitHub Copilot', 'Gemini CLI', 'Goose', 'OpenCode', 'Qwen Code'], 'Codex (signed out) and Cursor (behind the broker) are not listed');
  assert.deepEqual(r.rows('harness').filter((x) => x.querySelector('.badge')).map((x) => [x.dataset.key, x.querySelector('.badge').textContent]), [['claude', 'Default']]);
  assert.ok(r.row('harness', 'claude').querySelector('.mdl-mark.sm img'));
  assert.deepEqual(r.rows('provider').map((x) => { const s = x.querySelector('.mdl-st'); return `${s.className}:${s.textContent}`; }),
    ['mdl-st ok:Ready', 'mdl-st need:Needs key', 'mdl-st need:Needs sign-in', 'mdl-st ok:Ready']);
  assert.deepEqual(r.rows('harness').map((x) => x.tabIndex), [0, -1, -1, -1, -1, -1], 'one Tab stop per column');
  assert.equal(r.doc.activeElement, inh, 'nothing picked: the focus is on inherit');
});
test('a model on two harnesses: listed under each with "also on …", ticked under the pick\'s harness only; a pick from the other names that harness', () => {
  const r = rig({ value: { model: 'openai-gpt-6.1-sol', engine: 'codex' } }); r.open();
  assert.deepEqual([r.row('harness', 'codex').getAttribute('aria-selected'), r.row('provider', 'OpenAI-compatible').getAttribute('aria-selected')], ['true', 'true']);
  const m = r.row('model', 'openai-gpt-6.1-sol');
  assert.deepEqual([m.getAttribute('aria-selected'), m.querySelector('.mdl-cols-note').textContent, m.lastElementChild.className, r.doc.activeElement === m],
    ['true', 'also on Claude Code', 'ask-model-check', true]);
  assert.equal(r.pop().querySelector('.mdl-cols-inherit .ask-model-check'), null);
  r.row('harness', 'claude').click();
  r.row('provider', 'OpenAI-compatible').click();
  const there = r.row('model', 'openai-gpt-6.1-sol');
  assert.deepEqual([there.getAttribute('aria-selected'), there.querySelector('.mdl-cols-note').textContent, there.querySelector('.ask-model-check')], ['false', 'also on OpenAI Codex', null]);
  assert.equal(r.pop().querySelectorAll('.ask-model-check').length, 0, 'no tick anywhere on Claude Code');
  there.click();
  assert.deepEqual(r.picks, [{ model: 'openai-gpt-6.1-sol', engine: 'claude' }]);
});
test('keys: Up/Down/Home/End in a column, Right/Enter into the next, Left back; Enter picks after the trigger has the focus; no key reaches the page', () => {
  const r = rig({ engines: () => null }); let at = null; let leaked = 0;   // no readiness known: every harness is listed
  r.open({ onPick: (v) => { at = { v, open: !!r.pop(), focus: r.doc.activeElement === r.anchor }; } });
  r.doc.addEventListener('keydown', () => { leaked += 1; });
  r.key('ArrowDown');
  assert.equal(r.doc.activeElement, r.row('harness', 'claude'));
  r.key('ArrowDown');
  assert.deepEqual([r.doc.activeElement, r.row('harness', 'codex').getAttribute('aria-selected'), r.names('provider')], [r.row('harness', 'codex'), 'true', ['ChatGPT sign-in', 'OpenAI-compatible']]);
  assert.equal(r.key('ArrowRight').defaultPrevented, true);
  assert.equal(r.doc.activeElement, r.row('provider', 'ChatGPT sign-in'));
  r.key('Enter');
  assert.equal(r.doc.activeElement, r.row('model', 'gpt-6.1-sol'));
  r.key('ArrowLeft'); r.key('End'); r.key('ArrowRight');
  assert.equal(r.doc.activeElement, r.row('model', 'openai-gpt-6.1-sol'));
  for (const k of ['Delete', 'Backspace', 'PageDown', 'a']) r.key(k);
  r.key('Enter');
  assert.deepEqual([at, leaked], [{ v: { model: 'openai-gpt-6.1-sol', engine: 'codex' }, open: false, focus: true }, 0]);
});
test('a harness with no models: No models yet on its sign-in, an empty Model column with Add model for that harness; Right goes nowhere', () => {
  const r = rig(); r.open();
  r.row('harness', 'gemini').click();
  const st = r.row('provider', 'Gemini CLI sign-in').querySelector('.mdl-st');
  assert.deepEqual([r.names('provider'), st.className, st.textContent], [['Gemini CLI sign-in'], 'mdl-st off', 'No models yet']);
  assert.deepEqual([r.col('model').querySelector('.mdl-col-h').textContent, r.rows('model'), r.col('model').querySelector('.mdl-cols-empty').textContent], ['Model', [], 'No models yet.']);
  r.row('provider', 'Gemini CLI sign-in').click(); r.key('ArrowRight');
  assert.equal(r.doc.activeElement, r.row('provider', 'Gemini CLI sign-in'));
  const add = r.col('model').querySelector('button.mdl-cols-add');
  assert.deepEqual([add.className, add.textContent], ['btn btn-sm btn-quiet mdl-cols-add', 'Add model']);
  add.click();
  assert.deepEqual([r.adds, r.pop(), r.doc.activeElement === r.anchor, r.picks], [['gemini'], null, true, []]);
  const none = rig({ onAddModel: null }); none.open(); none.row('harness', 'gemini').click();
  assert.equal(none.col('model').querySelector('.mdl-cols-add'), null);
});
test('a model that needs a key is disabled with its reason and does not pick', () => {
  const r = rig(); r.open();
  r.row('provider', 'OpenAI-compatible').click();
  const kimi = r.row('model', 'or-kimi-k3');
  assert.deepEqual([kimi.disabled, kimi.getAttribute('aria-disabled'), kimi.title], [true, 'true', 'Its provider is not set up yet. Set it up on the Providers tab.']);
  kimi.dispatchEvent(new r.win.MouseEvent('click', { bubbles: true }));
  assert.deepEqual([r.picks, !!r.pop()], [[], true]);
});
test('a harness that is not ready is listed only as the default harness or the pick\'s own: Not ready with its reason; a broker-locked one is disabled and the keys pass it by', () => {
  const pinned = rig({ value: { model: 'gpt-6.1-sol', engine: 'codex' } }); pinned.open();
  assert.deepEqual(pinned.names('harness'), ['Claude Code', 'OpenAI Codex', 'GitHub Copilot', 'Gemini CLI', 'Goose', 'OpenCode', 'Qwen Code']);
  const s = pinned.row('provider', 'ChatGPT sign-in').querySelector('.mdl-st');
  assert.deepEqual([s.className, s.textContent, s.title], ['mdl-st off', 'Not ready', 'Codex is not signed in.']);
  const dflt = rig(); dflt.open({ defaultEngine: 'codex' });
  assert.deepEqual([dflt.names('harness').includes('OpenAI Codex'), dflt.row('harness', 'codex').querySelector('.badge').textContent, dflt.row('harness', 'cursor')], [true, 'Default', undefined]);
  const r = rig({ value: { model: 'gone-1', engine: 'cursor' } }); r.open();
  const cursor = r.row('harness', 'cursor');
  assert.deepEqual([cursor.disabled, cursor.title, r.row('harness', 'codex')], [true, 'cursor is off while the credential broker is on', undefined]);
  r.row('harness', 'claude').click();
  cursor.dispatchEvent(new r.win.MouseEvent('click', { bubbles: true }));
  assert.equal(r.row('harness', 'claude').getAttribute('aria-selected'), 'true');
  r.row('harness', 'copilot').click(); r.key('ArrowDown');
  assert.deepEqual([r.doc.activeElement, r.picks], [r.row('harness', 'gemini'), []]);
});
test('readiness that lands after the open fills the words, drops the harnesses that are not ready and keeps the focus; rows that land after the close draw nothing', () => {
  const late = lateRows(); const r = rig({ engines: late.get }); r.open();
  assert.equal(r.row('provider', 'Claude sign-in').querySelector('.mdl-st'), null);
  assert.equal(r.rows('harness').length, 8, 'nothing known yet: every harness');
  r.key('ArrowDown');
  late.land();
  assert.deepEqual([r.row('provider', 'Claude sign-in').querySelector('.mdl-st').textContent, r.doc.activeElement.dataset.key, r.row('harness', 'cursor'), r.row('harness', 'codex')], ['Ready', 'claude', undefined, undefined]);
  assert.deepEqual(r.names('harness'), ['Claude Code', 'GitHub Copilot', 'Gemini CLI', 'Goose', 'OpenCode', 'Qwen Code']);
  const gone = lateRows(); const g = rig({ engines: gone.get }); g.open();
  g.key('Escape'); gone.land();
  assert.equal(g.pop(), null);
});
test('the shown harness turns out not ready when readiness lands: the first listed harness is shown and takes the focus', () => {
  const late = lateRows(); const r = rig({ engines: late.get }); r.open();
  r.key('ArrowDown'); r.key('ArrowDown');
  assert.equal(r.doc.activeElement, r.row('harness', 'codex'));
  late.land();
  assert.deepEqual([r.row('harness', 'codex'), r.row('harness', 'claude').getAttribute('aria-selected'), r.doc.activeElement, r.names('provider')[0]],
    [undefined, 'true', r.row('harness', 'claude'), 'Claude sign-in']);
  const deep = lateRows(); const d = rig({ engines: deep.get }); d.open();
  d.row('harness', 'codex').click(); d.row('provider', 'ChatGPT sign-in').click(); d.key('ArrowRight');
  assert.equal(d.doc.activeElement, d.row('model', 'gpt-6.1-sol'));
  deep.land();
  assert.deepEqual([d.doc.activeElement, d.rows('model').map((x) => x.dataset.key), d.picks], [d.row('harness', 'claude'), ['claude-opus-5-5'], []]);
  const idle = lateRows(); const i = rig({ engines: idle.get }); i.open();
  i.row('harness', 'codex').click(); i.pop().querySelector('.mdl-cols-inherit').focus();
  idle.land();
  assert.deepEqual([i.doc.activeElement.className, i.row('harness', 'claude').getAttribute('aria-selected')], ['menu-item mdl-cols-inherit', 'true'], 'the focus on inherit stays there');
});
test('placed below its trigger; the columns take the room there is, up to 420px', () => {
  const r = rig();
  r.anchor.getBoundingClientRect = () => ({ left: 40, right: 140, top: 100, bottom: 132, width: 100, height: 32 });
  Object.defineProperty(r.win, 'innerHeight', { value: 300, configurable: true });
  r.open();
  assert.deepEqual([r.pop().style.left, r.pop().style.top, r.pop().querySelector('.mdl-cols').style.height], ['40px', '138px', '154px']);
});
test('the skin: fixed, as wide as there is room up to 672px and scrolling sideways below it; three columns; tokens only', () => {
  const rules = cssRules(readStyleCss()).filter((x) => !x.media);
  const body = (sel) => rules.filter((x) => x.sel === sel).map((x) => x.body).join(';');
  assert.match(body('.mdl-cols-pop'), /position:fixed;z-index:58;width:min\(672px,calc\(100vw - 16px\)\);overflow-x:auto/);
  assert.match(body('.mdl-cols-pop .mdl-cols'), /grid-template-columns:204px 214px minmax\(238px,1fr\)/);
  assert.match(body('.mdl-cols-pop .mdl-cols'), /align-items:stretch/);
  assert.match(body('.mdl-cols-pop .mdl-cols'), /column-gap:0/);
  const bare = rules.filter((x) => x.sel === '.mdl-cols');
  assert.equal(bare.length, 1);
  assert.match(bare[0].body, /grid-template-columns:minmax\(0,1\.25fr\) minmax\(0,1fr\) 200px 28px/);
  assert.match(body('.mdl-col-list'), /overflow-y:auto/);
  assert.match(body('.mdl-cols-row[aria-selected="true"]'), /background:var\(--row-selected\)/);
  assert.match(body('.mdl-cols-hint,.mdl-cols-note'), /color:var\(--ink-2\);font-size:var\(--fs-meta\)/);
  assert.match(body('.mdl-col-h'), /font-size:var\(--fs-caption\);font-weight:600;color:var\(--ink-2\)/);
});

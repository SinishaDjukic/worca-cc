// test/models-model-picker.test.mjs — the Jobs tab's model and effort picker (models-menu P6 Task 2, DESIGN JOB-3…JOB-5,
// CAT-8): the short list and the rest for one harness, the three panes as data, what a pick turns a value into, the
// button's label, and the open menu in the Chat composer's grammar (ask-panel.mjs openPopover / menuItem).
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { modelName, splitForPicker, pickerItems, applyPick, openModelPicker, pickLabel } from '../ui/public/models/model-picker.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const docOf = () => { const d = new JSDOM('<!doctype html><body></body>'); doms.push(d); return d.window.document; };

const CAT = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-opus-5', label: 'Opus 5', efforts: ['medium', 'high', 'xhigh', 'max'] },
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5', efforts: ['medium', 'high'] },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', efforts: ['medium', 'high', 'max'], hidden: true },
  { id: 'my-gw', label: 'My GW', custom: 'global', efforts: ['medium', 'high'] },
  { id: 'or-grok', label: 'xAI: Grok (OpenRouter)', custom: 'global', needsSignIn: true, signInReason: 'no_key', bridged: 'openai', upstreamModel: 'x-ai/grok' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol', engine: 'codex', efforts: ['minimal', 'low', 'medium', 'high'] },
];

const ids = (list) => list.map((m) => m.id);
const items = (opts) => pickerItems({ catalog: CAT, engine: 'claude', clearLabel: "Each job's own default", ...opts });
const itemOf = (list, label) => list.find((i) => i.kind === 'item' && i.label === label);

function setup() {
  const doc = docOf();
  const win = doc.defaultView;
  const anchor = doc.createElement('button');
  anchor.type = 'button';
  anchor.textContent = 'Quick jobs';
  doc.body.append(anchor);
  const picks = [];
  const open = (opts = {}) => openModelPicker({ doc, win, anchor, catalog: CAT, engine: 'claude', value: null, clearLabel: 'Follow Quick jobs', onPick: (v) => picks.push(v), ...opts });
  return { doc, win, anchor, picks, open };
}
const menuOf = (doc) => doc.querySelector('.menu.ask-pop.ask-pop-model.mdl-pick-pop[role="menu"]');
// A row's label: its .ask-model-name, else its first span (Effort, More models, a back row).
const itemNamed = (doc, name) => [...menuOf(doc).querySelectorAll('.menu-item')].find((b) => {
  const n = b.querySelector('.ask-model-name') || b.querySelector('span');
  return !!n && n.textContent === name;
});
const key = (doc, target, k) => target.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

test('the short list and the rest: one per family, the own models, the blocked ones last with their need (case 1)', () => {
  const s = splitForPicker(CAT, 'claude');
  assert.deepEqual(ids(s.primary), ['claude-opus-5-5', 'claude-haiku-4-5', 'my-gw']);
  assert.deepEqual(s.rest.map((m) => [m.id, !!m.blocked, m.hint || '']), [['claude-opus-5', false, ''], ['or-grok', true, 'Needs key']]);
  assert.deepEqual(ids(splitForPicker(CAT, 'codex').primary), ['gpt-6.1-sol']);
  assert.deepEqual(splitForPicker(CAT, 'cursor'), { primary: [], rest: [] });
  const signedOut = CAT.map((m) => (m.id === 'or-grok' ? { ...m, signInReason: 'not_signed_in' } : m));
  assert.equal(splitForPicker(signedOut, 'claude').rest.find((m) => m.id === 'or-grok').hint, 'Needs sign-in');
  // The current pick holds its family's slot, so Opus 5 stays in the rest.
  assert.deepEqual(ids(splitForPicker(CAT, 'claude', 'claude-opus-5-5').primary), ['claude-opus-5-5', 'claude-haiku-4-5', 'my-gw']);
  // Entries are copies: the catalogue rows are never marked.
  assert.equal(CAT.find((m) => m.id === 'or-grok').blocked, undefined);
  // Your own models are never demoted, however many there are.
  const two = [...CAT, { id: 'my-gw-2', label: 'My GW 2', custom: 'global', efforts: ['high'] }];
  assert.deepEqual(ids(splitForPicker(two, 'claude').primary), ['claude-opus-5-5', 'claude-haiku-4-5', 'my-gw', 'my-gw-2']);
});

test('the current pick is always up front, hidden, blocked or gone (case 2)', () => {
  assert.ok(ids(splitForPicker(CAT, 'claude', 'claude-sonnet-4-6').primary).includes('claude-sonnet-4-6'));
  const grok = splitForPicker(CAT, 'claude', 'or-grok');
  assert.ok(ids(grok.primary).includes('or-grok'));
  assert.equal(grok.primary.find((m) => m.id === 'or-grok').blocked, undefined);
  assert.ok(!ids(grok.rest).includes('or-grok'));
  // Catalogue order, as the Chat picker: Opus 5.5 took the Opus slot before the loop met the picked Opus 5, and stays.
  const opus5 = splitForPicker(CAT, 'claude', 'claude-opus-5');
  assert.deepEqual(ids(opus5.primary), ['claude-opus-5-5', 'claude-opus-5', 'claude-haiku-4-5', 'my-gw']);
  assert.deepEqual(ids(opus5.rest), ['or-grok']);
  // The picked model's family counts as seen: a later Opus goes to the rest.
  const later = [...CAT, { id: 'claude-opus-4-1', label: 'Opus 4.1', efforts: ['high'] }];
  assert.deepEqual(ids(splitForPicker(later, 'claude', 'claude-opus-5-5').rest), ['claude-opus-5', 'or-grok', 'claude-opus-4-1']);
  // A stored pick from another harness still shows in its own picker.
  assert.ok(ids(splitForPicker(CAT, 'claude', 'gpt-6.1-sol').primary).includes('gpt-6.1-sol'));
  const gone = items({ value: { model: 'deleted-one' } });
  const row = itemOf(gone, 'deleted-one (not in the catalog)');
  assert.ok(row);
  assert.equal(row.tick, true);
  assert.deepEqual(row.act, { type: 'model', id: 'deleted-one' });
  assert.equal(gone.indexOf(row), 2, 'first among the primary, after the clear item and its separator');
});

test('the main pane: clear item, the short list, Effort and More models (case 3)', () => {
  const main = items({ value: { model: 'claude-opus-5-5', effort: 'xhigh' } });
  assert.deepEqual([main[0].label, main[0].tick, main[0].act], ["Each job's own default", false, { type: 'clear' }]);
  assert.equal(main[1].kind, 'sep');
  for (const i of main) {
    assert.equal(typeof i.tick, 'boolean');
    assert.equal(typeof i.disabled, 'boolean');
  }
  // CAT's short list is one connection: no heads in the main pane.
  assert.equal(main.filter((i) => i.kind === 'head').length, 0);
  assert.deepEqual(main.filter((i) => i.model).map((i) => i.label), ['Opus 5.5', 'Haiku 4.5', 'My GW']);
  const effort = itemOf(main, 'Effort');
  assert.deepEqual([effort.hint, effort.next, effort.disabled], ['xhigh', true, false]);
  assert.deepEqual(effort.act, { type: 'pane', pane: 'effort' });
  assert.equal(main[main.indexOf(effort) - 1].kind, 'sep');
  const more = itemOf(main, 'More models');
  assert.equal(more.next, true);
  assert.deepEqual(more.act, { type: 'pane', pane: 'more' });
  assert.equal(itemOf(main, 'Opus 5.5').tick, true);
  assert.equal(itemOf(main, 'Haiku 4.5').tick, false);
  assert.deepEqual(itemOf(main, 'Haiku 4.5').act, { type: 'model', id: 'claude-haiku-4-5' });
  assert.equal(itemOf(main, 'Effort').tick, false);
  const none = items({ value: null });
  assert.equal(none[0].tick, true);
  assert.equal(itemOf(none, 'Effort').hint, 'Model default');
  assert.equal(itemOf(items({ value: { model: 'claude-opus-5-5' } }), 'Effort').hint, 'Model default');
  // Nothing left over: no More models row.
  assert.equal(itemOf(pickerItems({ catalog: CAT, engine: 'codex', clearLabel: 'x' }), 'More models'), undefined);
  // An effort-only value: the clear item is not ticked.
  assert.equal(items({ value: { effort: 'high' }, allowEffortOnly: true })[0].tick, false);
});

test('Effort is off without a model, on a model-only job and with no effort list (case 4)', () => {
  const at = (opts) => { const e = itemOf(items(opts), 'Effort'); return [e.disabled, e.hint]; };
  assert.equal(at({ value: null })[0], true);
  assert.equal(at({ value: null, allowEffortOnly: true })[0], false);
  assert.deepEqual(at({ value: { model: 'claude-opus-5-5' }, modelOnly: true }), [true, 'not supported']);
  assert.deepEqual(at({ value: null, allowEffortOnly: true, engine: 'cursor' }), [true, 'not supported']);
  // A model without efforts (Grok, once picked) reads "not supported" too.
  assert.deepEqual(at({ value: { model: 'or-grok' } }), [true, 'not supported']);
});

test('the effort pane: back row, Model default, then the model\'s efforts or the harness\'s (case 5)', () => {
  const pane = (value) => items({ value, allowEffortOnly: true, pane: 'effort' });
  const haiku = pane({ model: 'claude-haiku-4-5', effort: 'high' });
  assert.deepEqual([haiku[0].label, haiku[0].back, haiku[0].act], ['Effort', true, { type: 'pane', pane: 'main' }]);
  assert.equal(haiku[1].kind, 'sep');
  assert.deepEqual(haiku.filter((i) => i.kind === 'item' && !i.back).map((i) => i.label), ['Model default', 'medium', 'high']);
  assert.deepEqual(haiku.filter((i) => i.tick).map((i) => i.label), ['high']);
  assert.deepEqual(itemOf(haiku, 'Model default').act, { type: 'effort', effort: '' });
  assert.deepEqual(itemOf(haiku, 'medium').act, { type: 'effort', effort: 'medium' });
  const none = pane(null);
  assert.deepEqual(none.filter((i) => i.kind === 'item' && !i.back).map((i) => i.label), ['Model default', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(itemOf(none, 'Model default').tick, true);
  // A stored id the catalogue lost: the harness's efforts.
  assert.deepEqual(pane({ model: 'gone' }).filter((i) => i.kind === 'item' && !i.back).map((i) => i.label), ['Model default', 'medium', 'high', 'xhigh', 'max']);
});

test('the more pane: back row, then the rest grouped by connection, blocked ones disabled with their need', () => {
  const more = items({ value: null, pane: 'more' });
  assert.deepEqual([more[0].label, more[0].back, more[0].act], ['Models', true, { type: 'pane', pane: 'main' }]);
  assert.equal(more[1].kind, 'sep');
  assert.deepEqual(more.filter((i) => i.kind === 'head').map((i) => i.label), ['Claude sign-in', 'OpenAI-compatible']);
  assert.deepEqual(more.slice(2).map((i) => [i.kind, i.label]), [['head', 'Claude sign-in'], ['item', 'Opus 5'], ['head', 'OpenAI-compatible'], ['item', 'Grok']]);
  const grok = itemOf(more, 'Grok');
  assert.deepEqual([grok.disabled, grok.hint], [true, 'Needs key']);
  assert.equal(itemOf(more, 'Opus 5').disabled, false);
});

test('applyPick: what a model, an effort or the clear item turns a value into (case 6)', () => {
  const o = { catalog: CAT, engine: 'claude' };
  const haiku = { type: 'model', id: 'claude-haiku-4-5' };
  assert.deepEqual(applyPick({ model: 'claude-opus-5-5', effort: 'xhigh' }, haiku, o), { model: 'claude-haiku-4-5' });
  assert.deepEqual(applyPick({ model: 'claude-opus-5-5', effort: 'high' }, haiku, o), { model: 'claude-haiku-4-5', effort: 'high' });
  assert.deepEqual(applyPick({ model: 'claude-opus-5-5', effort: 'high' }, haiku, { ...o, modelOnly: true }), { model: 'claude-haiku-4-5' });
  assert.equal(applyPick(null, { type: 'effort', effort: 'high' }, o), null);
  assert.deepEqual(applyPick(null, { type: 'effort', effort: 'high' }, { ...o, allowEffortOnly: true }), { effort: 'high' });
  assert.equal(applyPick({ effort: 'high' }, { type: 'effort', effort: '' }, { ...o, allowEffortOnly: true }), null);
  assert.equal(applyPick({ model: 'x' }, { type: 'clear' }, o), null);
  assert.deepEqual(applyPick({ model: 'claude-opus-5-5', effort: 'high' }, { type: 'effort', effort: 'max' }, o), { model: 'claude-opus-5-5', effort: 'max' });
  assert.deepEqual(applyPick({ model: 'claude-opus-5-5', effort: 'high' }, { type: 'effort', effort: '' }, o), { model: 'claude-opus-5-5' });
  assert.deepEqual(applyPick(null, haiku, o), { model: 'claude-haiku-4-5' });
});

test('picking the ticked "<id> (not in the catalog)" row again keeps its effort; a catalogue row still checks it', () => {
  const o = { catalog: CAT, engine: 'claude' };
  const gone = { model: 'gone', effort: 'high' };
  assert.deepEqual(applyPick(gone, { type: 'model', id: 'gone' }, o), { model: 'gone', effort: 'high' });
  assert.deepEqual(applyPick(gone, { type: 'model', id: 'gone' }, { ...o, modelOnly: true }), { model: 'gone' }, 'a model-only job never takes an effort');
  // From the lost id to a catalogue model: the new model's list decides (Haiku: medium, high).
  assert.deepEqual(applyPick(gone, { type: 'model', id: 'claude-haiku-4-5' }, o), { model: 'claude-haiku-4-5', effort: 'high' });
  assert.deepEqual(applyPick({ model: 'gone', effort: 'max' }, { type: 'model', id: 'claude-haiku-4-5' }, o), { model: 'claude-haiku-4-5' });
  // A catalogue model picked again still drops an effort it does not list.
  assert.deepEqual(applyPick({ model: 'claude-haiku-4-5', effort: 'max' }, { type: 'model', id: 'claude-haiku-4-5' }, o), { model: 'claude-haiku-4-5' });
  // Acts with no id are not re-picks: an effort-only value still clears and changes.
  assert.equal(applyPick({ effort: 'high' }, { type: 'clear' }, o), null);
  assert.deepEqual(applyPick({ effort: 'high' }, { type: 'effort', effort: 'max' }, { ...o, allowEffortOnly: true }), { effort: 'max' });
  // In the open menu: the lost row has the tick and the focus, and picking it hands back the stored value.
  const { doc, picks, open } = setup();
  open({ value: gone });
  const row = itemNamed(doc, 'gone (not in the catalog)');
  assert.equal(doc.activeElement, row);
  row.click();
  assert.deepEqual(picks, [{ model: 'gone', effort: 'high' }]);
});

test('pickLabel and modelName: the /api/config row\'s name, a lost id, no value (case 7)', () => {
  const grok = pickLabel({ model: 'or-grok' }, CAT);
  assert.equal(grok.text, 'Grok');
  assert.equal(grok.model.id, 'or-grok');
  assert.equal(modelName(CAT.find((m) => m.id === 'or-grok')), 'Grok');
  assert.equal(modelName(CAT[0]), 'Opus 5.5');
  const gone = pickLabel({ model: 'gone' }, CAT);
  assert.deepEqual([gone.text, gone.missing, gone.model], ['gone (not in the catalog)', true, null]);
  assert.deepEqual(pickLabel(null, CAT), { model: null, text: '', effort: '', missing: false });
  assert.equal(pickLabel({ model: 'claude-opus-5-5', effort: 'max' }, CAT).effort, 'max');
  assert.deepEqual(pickLabel({ effort: 'high' }, CAT), { model: null, text: '', effort: 'high', missing: false });
});

test('the open menu is the Chat grammar: a pick closes it, focuses the button, then calls onPick (case 8)', () => {
  const { doc, anchor, picks, open } = setup();
  const p = open();
  const menu = menuOf(doc);
  assert.ok(menu, 'div.menu.ask-pop.ask-pop-model.mdl-pick-pop[role=menu]');
  assert.equal(menu.parentNode, doc.body);
  assert.equal(anchor.getAttribute('aria-expanded'), 'true');
  const first = menu.querySelector('.menu-item');
  assert.equal(first.textContent, 'Follow Quick jobs');
  for (const b of menu.querySelectorAll('.menu-item')) {
    assert.ok(b.matches('button.menu-item.ask-pop-item[role="menuitem"][type="button"]'));
    assert.equal(b.tabIndex === -1 || b === doc.activeElement, true);
  }
  // Ticked on open: nothing is picked, so the clear item has the tick and the focus.
  assert.ok(first.querySelector('.ask-model-check'));
  assert.equal(doc.activeElement, first);
  assert.ok(menu.querySelector('.ask-pop-divider'));
  const haiku = itemNamed(doc, 'Haiku 4.5');
  assert.ok(haiku.querySelector('.mdl-mark'), 'a model row carries its mark');
  haiku.click();
  assert.deepEqual(picks, [{ model: 'claude-haiku-4-5' }]);
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  assert.equal(doc.activeElement, anchor);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  p.close();
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  assert.equal(picks.length, 1);
});

test('the menu calls onPick only after it is gone and the focus is back on the button', () => {
  const { doc, anchor, open } = setup();
  let at = null;
  open({ onPick: () => { at = { open: !!menuOf(doc), focus: doc.activeElement === anchor }; } });
  itemNamed(doc, 'Follow Quick jobs').click();
  assert.deepEqual(at, { open: false, focus: true });
});

test('a second open on the same button closes the first; another button moves it', () => {
  const { doc, anchor, open } = setup();
  open();
  const again = open();
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  again.close();
  const other = doc.createElement('button');
  doc.body.append(other);
  open();
  openModelPicker({ doc, win: doc.defaultView, anchor: other, catalog: CAT, engine: 'claude', value: null, clearLabel: 'x', onPick() {} });
  assert.equal(doc.querySelectorAll('.mdl-pick-pop').length, 1);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  assert.equal(other.getAttribute('aria-expanded'), 'true');
});

test('Escape closes it and focuses the button, and no later handler sees the key', () => {
  const { doc, anchor, picks, open } = setup();
  open();
  let later = 0;
  doc.addEventListener('keydown', () => { later += 1; });
  const ev = new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  doc.dispatchEvent(ev);
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  assert.equal(doc.activeElement, anchor);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(later, 0);
  assert.deepEqual(picks, []);
  // Closed: Escape is the page's again.
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(later, 1);
});

test('Effort redraws the pane in place; a disabled Effort item fires nothing', () => {
  const { doc, picks, open } = setup();
  open();
  const off = itemNamed(doc, 'Effort');
  assert.equal(off.disabled, true);
  assert.ok(off.title);
  // A dispatched click reaches a disabled button (jsdom's click() would skip it).
  off.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.ok(menuOf(doc).querySelector('.ask-pop-row-value'));
  assert.equal(menuOf(doc).querySelector('.ask-pane-back'), null);
  assert.deepEqual(picks, []);
  open();
  assert.equal(doc.querySelector('.mdl-pick-pop'), null);
  open({ value: { model: 'claude-opus-5-5' } });
  const root = menuOf(doc);
  assert.equal(doc.activeElement.querySelector('.ask-model-name').textContent, 'Opus 5.5', 'focus on the ticked item');
  const effort = itemNamed(doc, 'Effort');
  assert.equal(effort.disabled, false);
  assert.equal(effort.querySelector('.ask-pop-row-value').textContent, 'Model default');
  assert.equal(effort.querySelector('.ask-pop-row-chev').textContent, '›');
  effort.click();
  assert.equal(menuOf(doc), root, 'the same root node');
  const back = root.querySelector('.ask-pane-back');
  assert.equal(back.textContent, '‹ Effort');
  assert.equal(doc.activeElement, back, 'the first enabled item of the new pane');
  itemNamed(doc, 'high').click();
  assert.deepEqual(picks, [{ model: 'claude-opus-5-5', effort: 'high' }]);
});

test('More models: two connection heads, the blocked model disabled; back to Models', () => {
  const { doc, picks, open } = setup();
  open({ value: { model: 'claude-opus-5-5' } });
  const root = menuOf(doc);
  assert.equal(root.querySelectorAll('.ask-pop-subgroup').length, 0);
  itemNamed(doc, 'More models').click();
  assert.equal(menuOf(doc), root);
  assert.deepEqual([...root.querySelectorAll('.ask-pop-subgroup')].map((h) => h.textContent), ['Claude sign-in', 'OpenAI-compatible']);
  assert.equal(root.querySelector('.ask-pane-back').textContent, '‹ Models');
  const grok = itemNamed(doc, 'Grok');
  assert.equal(grok.disabled, true);
  assert.ok(grok.title);
  assert.equal(grok.querySelector('.ask-pop-row-value').textContent, 'Needs key');
  grok.dispatchEvent(new doc.defaultView.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(picks, []);
  assert.ok(menuOf(doc));
  root.querySelector('.ask-pane-back').click();
  assert.ok(itemNamed(doc, 'More models'));
  itemNamed(doc, 'More models').click();
  itemNamed(doc, 'Opus 5').click();
  assert.deepEqual(picks, [{ model: 'claude-opus-5' }]);
});

test('a model row\'s mark is its vendor\'s, read from the upstream model an /api/config row names', () => {
  const { doc, open } = setup();
  const own = { id: 'or-mystery', label: 'Mystery (OpenRouter)', custom: 'global', bridged: 'openai', upstreamModel: 'openai/mystery-1' };
  open({ catalog: [...CAT, own] });
  const mark = itemNamed(doc, 'Mystery').querySelector('.mdl-mark');
  assert.ok(mark.matches('.mdl-mark.sm'));
  assert.equal(mark.classList.contains('own'), false);
  assert.equal(mark.querySelector('img').getAttribute('alt'), 'OpenAI');
});

test('keys: arrows wrap over enabled items, Home and End, Enter picks', () => {
  const { doc, picks, open } = setup();
  open({ value: { model: 'claude-haiku-4-5', effort: 'high' } });
  const menu = menuOf(doc);
  const enabled = [...menu.querySelectorAll('.menu-item')].filter((b) => !b.disabled);
  const label = (b) => (b.querySelector('.ask-model-name') || b).textContent;
  assert.equal(label(doc.activeElement), 'Haiku 4.5');
  key(doc, doc.activeElement, 'Home');
  assert.equal(doc.activeElement, enabled[0]);
  key(doc, doc.activeElement, 'ArrowUp');
  assert.equal(doc.activeElement, enabled.at(-1), 'ArrowUp from the first wraps to the last');
  key(doc, doc.activeElement, 'ArrowDown');
  assert.equal(doc.activeElement, enabled[0]);
  key(doc, doc.activeElement, 'End');
  assert.equal(doc.activeElement, enabled.at(-1));
  assert.equal(doc.activeElement.tabIndex, 0);
  key(doc, enabled[0], 'Home');
  key(doc, doc.activeElement, 'ArrowDown');
  assert.equal(label(doc.activeElement), 'Opus 5.5');
  const enter = new doc.defaultView.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  doc.activeElement.dispatchEvent(enter);
  assert.equal(enter.defaultPrevented, true);
  assert.deepEqual(picks, [{ model: 'claude-opus-5-5', effort: 'high' }]);
});

test('a press outside or focus leaving closes it without moving the focus; a press inside keeps it', () => {
  const { doc, anchor, picks, open } = setup();
  const PE = doc.defaultView.PointerEvent || doc.defaultView.MouseEvent;
  const outside = doc.createElement('input');
  doc.body.append(outside);
  open();
  menuOf(doc).querySelector('.ask-pop-divider').dispatchEvent(new PE('pointerdown', { bubbles: true }));
  assert.ok(menuOf(doc), 'a press inside the menu keeps it');
  anchor.dispatchEvent(new PE('pointerdown', { bubbles: true }));
  assert.ok(menuOf(doc), 'a press on the button is the toggle\'s, not an outside press');
  outside.dispatchEvent(new PE('pointerdown', { bubbles: true }));
  assert.equal(menuOf(doc), null);
  assert.notEqual(doc.activeElement, anchor);
  open();
  outside.focus();
  assert.equal(menuOf(doc), null, 'focus leaving the menu closes it');
  assert.equal(doc.activeElement, outside);
  assert.equal(anchor.getAttribute('aria-expanded'), 'false');
  assert.deepEqual(picks, []);
});

test('placed below its button with placeFlyout, and placed again when the page scrolls', () => {
  const { doc, anchor, open } = setup();
  let rect = { left: 40, right: 300, top: 100, bottom: 132, width: 260, height: 32 };
  anchor.getBoundingClientRect = () => rect;
  open();
  const menu = menuOf(doc);
  assert.equal(menu.hidden, false);
  assert.deepEqual([menu.style.left, menu.style.top], ['40px', '138px']);
  rect = { ...rect, top: 60, bottom: 92 };
  doc.dispatchEvent(new doc.defaultView.Event('scroll'));
  assert.equal(menu.style.top, '98px');
});

test('#1450: the "Let Claude Code decide" item exists only with decideLabel, after the clear item, and maps to { cliDecides: true }', () => {
  assert.equal(items({}).some((i) => i.act?.type === 'cli'), false);
  const main = items({ decideLabel: 'Let Claude Code decide' });
  assert.deepEqual([main[0].act, main[1].label, main[1].act, main[1].tick], [{ type: 'clear' }, 'Let Claude Code decide', { type: 'cli' }, false]);
  const ticked = items({ decideLabel: 'Let Claude Code decide', value: { cliDecides: true } });
  assert.equal(ticked[1].tick, true);
  assert.equal(ticked[0].tick, false, 'cliDecides is not the empty role');
  assert.deepEqual(applyPick(null, { type: 'cli' }, { catalog: CAT, engine: 'claude' }), { cliDecides: true });
  assert.deepEqual(applyPick({ cliDecides: true }, { type: 'model', id: 'claude-opus-5-5' }, { catalog: CAT, engine: 'claude' }), { model: 'claude-opus-5-5' });
  assert.equal(applyPick({ cliDecides: true }, { type: 'clear' }, { catalog: CAT, engine: 'claude' }), null);
});

test('#1450: openModelPicker passes decideLabel through and reports the cli pick', () => {
  const { doc, picks, open } = setup();
  open({ decideLabel: 'Let Claude Code decide' });
  const row = itemNamed(doc, 'Let Claude Code decide');
  assert.ok(row, 'the menu shows the item');
  row.click();
  assert.deepEqual(picks.at(-1), { cliDecides: true });
});

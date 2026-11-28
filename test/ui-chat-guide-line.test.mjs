// test/ui-chat-guide-line.test.mjs — the composer's Guide switch and Guide line (ui/public/chat/guide-line.mjs, a
// CONTRACT §2 composer add-on registered after the role picker). With the shaperSmallRuns flag on and the Shaper pin set
// the lead row reads pin, role picker, "Guide" switch, and one line of fixed height sits between the field and the bar:
// the first-time offer while the prompt is empty, else nothing. The prefs and the model's name are read once per mount
// (GET /api/shape/guide). With the flag off or no Shaper pin there is no switch, no line and no request. It never takes,
// holds or rewords a send. No check runs yet.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createGuideLine, installGuideLine, refreshGuideLine, guideTip, lineText, loadGuide, saveGuidePrefs,
  GUIDE_ADDON_ID, LINE_TITLE, OFFER_TEXT, TIP_HEAD,
} from '../ui/public/chat/guide-line.mjs';
import { createIntentAddon, INTENTS } from '../ui/public/chat/intent.mjs';
// A namespace read, so a missing new export (layoutWraps) fails only its own test.
import * as rolePicker from '../ui/public/chat/role-picker.mjs';
import { composerAddons, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { _resetAnswerer } from '../ui/public/answerer.mjs';

const TIP = 'Guide: a quick model check of your prompt for gaps, before you send. It can write the prompt out. Runs on';
const OFFER = 'New: Guide checks your idea for gaps before you send. Switch it off any time.';
const tipFor = (label) => `${TIP} ${label} (change it in Settings › Models).`;
const NO_MODEL_TIP = `${TIP} no model yet (pick one in Settings › Models).`;
const PREFS = Object.freeze({ model: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' }, on: true, offerSeen: false, rowsOpen: false });

const saved = {};
beforeEach(() => {
  for (const k of ['fetch', 'document', 'ResizeObserver']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  _resetAnswerer();
  _resetChatExtensions();
});
afterEach(() => {
  for (const [k, d] of Object.entries(saved)) { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; }
  _resetAnswerer();
  _resetChatExtensions();
});
const trackDom = useDomRelease(afterEach);

const tick = () => new Promise((r) => setTimeout(r, 0));
const settle = async () => { await tick(); await tick(); await tick(); };
function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** The composer's box as ask-panel builds it: lead row, field, message, compact bar. */
function page({ bar = true } = {}) {
  const dom = trackDom(new JSDOM(`<!doctype html><body><div class="chat-page" data-chat-page data-view="home">
    <div class="ask-composer"><div class="ask-composer-box"><div class="chat-composer-lead" data-chat-composer-lead></div>
    <textarea class="ask-input"></textarea><div class="ask-composer-msg" hidden></div>${bar
    ? '<div class="ask-composer-row" data-bar="compact"><button type="button" class="ask-send">Send</button></div>' : ''}</div></div></div>
    <button id="elsewhere">x</button></body>`));
  const win = dom.window;
  const doc = win.document;
  const observers = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.disconnected = false; observers.push(this); }
    observe(t) { this.targets.push(t); }
    unobserve(t) { this.targets = this.targets.filter((x) => x !== t); }
    disconnect() { this.targets = []; this.disconnected = true; }
  }
  win.ResizeObserver = FakeResizeObserver;
  globalThis.ResizeObserver = FakeResizeObserver;
  const lead = doc.querySelector('[data-chat-composer-lead]');
  const input = doc.querySelector('.ask-input');
  const said = [];
  const ctx = {
    doc, fetch: null, threadId: () => null, thread: () => null, runStore: null,
    setPlaceholder: () => {}, focus: () => input.focus(), announce: (t) => said.push(t),
  };
  let width = 700;
  const resize = async () => {
    width -= 20;
    for (const o of observers.filter((x) => !x.disconnected)) {
      o.cb(o.targets.map((target) => ({ target, contentRect: { width, height: 26 } })), o);
    }
    await tick();
  };
  return {
    doc, win, lead, input, ctx, said, resize,
    picker: () => lead.querySelector('.ask-asker-pick'),
    sw: () => lead.querySelector('.ask-guide-sw'),
    swInput: () => lead.querySelector('.ask-guide-sw input'),
    line: () => doc.querySelector('.ask-guide'),
    text: () => doc.querySelector('.ask-guide .ask-guide-t')?.textContent,
    /** The lead row's controls in DOM order. */
    order: () => [...lead.children].map((c) => (c.matches('.chat-intent') ? 'pin'
      : c.matches('.ask-asker-pick') ? 'picker' : c.matches('.ask-guide-sw') ? 'guide' : c.className)),
    /** The person types: the field's value, then its input event. */
    type(v) { input.value = v; input.dispatchEvent(new win.Event('input', { bubbles: true })); },
  };
}

/** `page()` plus the real intent add-on, the real role picker and the Guide add-on with every dependency injected. */
function setup({ flag = true, prefs = {}, load = null, save = null, pin = null, picker = true, measureWraps = () => false, value = '', bar = true } = {}) {
  const p = page({ bar });
  p.input.value = value;
  const state = { picker: flag, guide: flag, pickerSubs: new Set(), subs: new Set(), flagOffs: 0, intentOffs: 0 };
  const calls = { load: 0, save: [] };
  const stored = { ...PREFS, ...prefs };
  const intent = createIntentAddon();
  const intentHandle = intent.addon.mount(p.lead, p.ctx);
  if (pin) intent.set(pin, { focus: false });
  if (picker) {
    rolePicker.createRolePicker({
      intent,
      flagOn: (k) => k === 'shaperSmallRuns' && state.picker,
      onFlagChange: (k, fn) => { state.pickerSubs.add(fn); return () => state.pickerSubs.delete(fn); },
      load: () => Promise.resolve({ lead: null }),
      save: (k) => Promise.resolve({ lead: k }),
      measureWraps,
    }).addon.mount(p.lead, p.ctx);
  }
  const ctl = createGuideLine({
    intent: {
      current: () => intent.current(),
      onChange: (fn) => { const off = intent.onChange(fn); return () => { state.intentOffs += 1; off(); }; },
    },
    flagOn: (k) => k === 'shaperSmallRuns' && state.guide,
    onFlagChange: (k, fn) => {
      assert.equal(k, 'shaperSmallRuns');
      state.subs.add(fn);
      return () => { state.flagOffs += 1; state.subs.delete(fn); };
    },
    load: () => { calls.load += 1; return load ? load(calls.load) : Promise.resolve({ ...stored }); },
    save: (patch) => { calls.save.push(patch); return save ? save(patch, calls.save.length) : Promise.resolve({ ...stored, ...patch }); },
  });
  const handle = ctl.addon.mount(p.lead, p.ctx);
  const setFlag = (on) => { state.guide = on; for (const fn of [...state.subs]) fn(on); };
  const shaper = async () => { intent.set('shape', { focus: false }); await settle(); };
  return { ...p, state, calls, stored, intent, intentHandle, ctl, handle, setFlag, shaper };
}

test('the add-on id and the words: the offer, the line\'s title and the tooltip with and without a model', () => {
  assert.equal(GUIDE_ADDON_ID, 'guide');
  assert.equal(LINE_TITLE, 'Sending works as it is.');
  assert.equal(OFFER_TEXT, OFFER);
  assert.equal(TIP_HEAD, TIP);
  assert.equal(guideTip('Haiku 5.5'), tipFor('Haiku 5.5'));
  assert.equal(guideTip(null), NO_MODEL_TIP);
});

test('lineText: no line with Guide off; the offer only the first time while the prompt is empty; else nothing', () => {
  const base = { on: true, offerSeen: false, offerGone: false, prompt: '' };
  assert.equal(lineText(base), OFFER);
  assert.equal(lineText({ ...base, on: false }), null);
  assert.equal(lineText({ ...base, on: false, prompt: 'x' }), null);
  assert.equal(lineText({ ...base, offerSeen: true }), '');
  assert.equal(lineText({ ...base, offerGone: true }), '');
  assert.equal(lineText({ ...base, prompt: 'x' }), '');
});

test('R-ux-1: the lead row reads Shaper pin, role picker, Guide switch', async () => {
  const s = setup();
  await s.shaper();
  assert.deepEqual(s.order(), ['pin', 'picker', 'guide']);
  const row = s.sw();
  assert.ok(row.matches('label.switch-row.ask-guide-sw'), 'the app\'s switch');
  const input = s.swInput();
  assert.ok(input.matches('input.sw-input.ask-guide-sw-input[type="checkbox"][role="switch"]'));
  assert.equal(input.checked, true, 'on once offered');
  assert.equal(row.querySelector('.switch-label').textContent, 'Guide');
});

test('with no role picker the switch sits right after the pin, before anything else in the row', async () => {
  const s = setup({ picker: false, flag: false });
  s.intent.set('shape', { focus: false });
  const dir = s.doc.createElement('span');
  dir.className = 'chat-dir';
  s.lead.appendChild(dir);
  s.setFlag(true);
  await settle();
  assert.deepEqual(s.order(), ['pin', 'guide', 'chat-dir']);
});

test('after the pin is cleared and set again the order is pin, picker, switch, with one line and no second read', async () => {
  const s = setup();
  await s.shaper();
  s.intent.clear();
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  await s.shaper();
  assert.deepEqual(s.order(), ['pin', 'picker', 'guide']);
  assert.equal(s.doc.querySelectorAll('.ask-guide').length, 1);
  assert.equal(s.calls.load, 1);
});

test('R-qa-10: the switch\'s tooltip names the Guide model, on the row and on the control', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.sw().title, tipFor('Haiku 5.5'));
  assert.equal(s.swInput().title, tipFor('Haiku 5.5'));
});

test('with no Guide model the tooltip says to pick one', async () => {
  const s = setup({ prefs: { model: null } });
  await s.shaper();
  assert.equal(s.sw().title, NO_MODEL_TIP);
  assert.equal(s.swInput().title, NO_MODEL_TIP);
});

test('R-arch-3: refresh() reads once more and the tooltip names the new model, with nothing saved', async () => {
  const s = setup();
  await s.shaper();
  s.stored.model = { id: 'claude-opus-5-5', label: 'Opus 5.5' };
  s.ctl.refresh();
  await settle();
  assert.equal(s.calls.load, 2);
  assert.equal(s.sw().title, tipFor('Opus 5.5'));
  assert.equal(s.swInput().title, tipFor('Opus 5.5'));
  assert.deepEqual(s.order(), ['pin', 'picker', 'guide']);
  assert.equal(s.doc.querySelectorAll('.ask-guide').length, 1);
  assert.deepEqual(s.calls.save, []);
});

test('a model changed while the pin is cleared is the one the tooltip names when the pin comes back', async () => {
  const s = setup();
  await s.shaper();
  s.intent.clear();               // leaving Chat for Settings › Models drops the pin
  s.stored.model = { id: 'claude-opus-5-5', label: 'Opus 5.5' };
  s.ctl.refresh();
  await settle();
  await s.shaper();
  assert.equal(s.sw().title, tipFor('Opus 5.5'));
});

test('installGuideLine registers one add-on, and refreshGuideLine() refreshes every installed one', async () => {
  assert.doesNotThrow(() => refreshGuideLine(), 'with nothing mounted it does nothing');
  const p = page();
  const intent = createIntentAddon();
  intent.addon.mount(p.lead, p.ctx);
  let label = 'Haiku 5.5';
  let loads = 0;
  const deps = {
    intent, flagOn: () => true, onFlagChange: () => () => {},
    load: async () => { loads += 1; return { ...PREFS, model: { id: 'm', label } }; },
    save: async () => ({}),
  };
  installGuideLine(deps);
  assert.deepEqual(composerAddons().map((a) => a.id), ['guide']);
  const handle = composerAddons()[0].mount(p.lead, p.ctx);
  try {
    intent.set('shape', { focus: false });
    await settle();
    assert.equal(p.sw().title, tipFor('Haiku 5.5'));
    label = 'Opus 5.5';
    refreshGuideLine();
    await settle();
    assert.equal(loads, 2);
    assert.equal(p.sw().title, tipFor('Opus 5.5'));
  } finally { handle.destroy(); }
});

test('a refresh started while the first read is out wins: the first read\'s later answer changes nothing', async () => {
  const first = deferred();
  const second = deferred();
  const s = setup({ load: (n) => (n === 1 ? first.promise : second.promise) });
  await s.shaper();
  s.ctl.refresh();
  await settle();
  assert.equal(s.calls.load, 2);
  second.resolve({ ...PREFS, offerSeen: true, model: { id: 'claude-opus-5-5', label: 'Opus 5.5' } });
  await settle();
  assert.equal(s.sw().title, tipFor('Opus 5.5'));
  first.resolve({ ...PREFS, on: false });
  await settle();
  assert.equal(s.sw().title, tipFor('Opus 5.5'));
  assert.equal(s.swInput().checked, true);
  assert.ok(s.line(), 'the line stays');
});

test('nothing shows before the read lands, so a switched-off Guide never flashes on', async () => {
  const d = deferred();
  const s = setup({ load: () => d.promise });
  await s.shaper();
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  d.resolve({ ...PREFS, on: false });
  await settle();
  assert.equal(s.swInput().checked, false);
  assert.equal(s.line(), null);
});

test('a failed read shows no switch and no line, and the next pin set reads again', async () => {
  const s = setup({ load: (n) => (n === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ ...PREFS })) });
  await s.shaper();
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  assert.doesNotMatch(s.doc.body.textContent, /offline/);
  s.intent.clear();
  await s.shaper();
  assert.equal(s.calls.load, 2);
  assert.deepEqual(s.order(), ['pin', 'picker', 'guide']);
  assert.ok(s.line());
});

test('R-ux-1: exactly one line, between the field and the bar, titled "Sending works as it is."; the bar is untouched', async () => {
  const s = setup();
  const bar = () => s.doc.querySelector('.ask-composer-row[data-bar="compact"]').outerHTML;
  const barBefore = bar();
  await s.shaper();
  assert.equal(s.doc.querySelectorAll('.ask-guide').length, 1);
  const line = s.line();
  assert.ok(line.matches('.ask-composer-box > div.ask-guide'));
  assert.ok(line.previousElementSibling.matches('.ask-composer-msg'), 'after the field and its message');
  assert.ok(line.nextElementSibling.matches('.ask-composer-row[data-bar="compact"]'), 'right before the bar');
  assert.equal(line.title, 'Sending works as it is.');
  assert.ok(line.querySelector(':scope > span.ask-guide-t'));
  assert.equal(bar(), barBefore);
});

test('without a bar to sit before there is no line; the switch still shows', async () => {
  const s = setup({ bar: false });
  await s.shaper();
  assert.ok(s.sw());
  assert.equal(s.line(), null);
});

test('R-qa-11: the offer shows while the prompt is empty, typing clears it for good and saves offerSeen exactly once', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.text(), OFFER);
  assert.deepEqual(s.calls.save, [], 'showing it saves nothing');
  const line = s.line();
  const cls = line.className;
  const style = line.getAttribute('style');
  s.type('U');
  await settle();
  assert.equal(s.text(), '');
  assert.equal(s.line(), line, 'the same element');
  assert.equal(line.className, cls);
  assert.equal(line.getAttribute('style'), style);
  assert.deepEqual(s.calls.save, [{ offerSeen: true }]);
  s.type('Uploads fail');
  s.type('');
  s.handle.update(null);
  await settle();
  assert.equal(s.text(), '', 'a dismissed offer never returns in this mount');
  assert.deepEqual(s.calls.save, [{ offerSeen: true }]);
});

for (const [name, write] of [
  ['an ArrowUp recall (keyup)', (s) => s.input.dispatchEvent(new s.win.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }))],
  ['a code write that focuses the field', (s) => s.input.dispatchEvent(new s.win.Event('focus'))],
  ['a code write followed by a render (update)', (s) => s.handle.update(null)],
]) {
  test(`the offer follows the field's value: ${name} clears it and saves offerSeen once`, async () => {
    const s = setup();
    await s.shaper();
    assert.equal(s.text(), OFFER);
    s.input.value = 'see run aaaa1111';   // no input event
    write(s);
    await settle();
    assert.equal(s.text(), '');
    write(s);
    await settle();
    assert.deepEqual(s.calls.save, [{ offerSeen: true }]);
  });
}

test('an offer already seen, or a prompt that is not empty when the line lands: no offer and nothing saved', async () => {
  const seen = setup({ prefs: { offerSeen: true } });
  await seen.shaper();
  assert.equal(seen.text(), '');
  seen.type('x');
  seen.type('');
  await settle();
  assert.equal(seen.text(), '');
  assert.deepEqual(seen.calls.save, []);
  const typed = setup({ value: 'Uploads fail' });
  await typed.shaper();
  assert.equal(typed.text(), '');
  typed.type('Uploads fail on large files');
  await settle();
  assert.deepEqual(typed.calls.save, [], 'an offer never shown writes nothing');
});

test('R-ux-2: the line\'s height is the same with the offer shown and with nothing to say (the stylesheet rule)', async () => {
  const s = setup();
  const style = s.doc.createElement('style');
  style.textContent = cssParts().base.filter((r) => r.sel.includes('ask-guide')).map((r) => `${r.sel}{${r.body}}`).join('\n');
  s.doc.head.appendChild(style);
  await s.shaper();
  const height = () => s.win.getComputedStyle(s.line()).height;
  assert.equal(s.text(), OFFER);
  assert.equal(height(), '33px');
  s.type('Uploads fail');
  await settle();
  assert.equal(s.text(), '');
  assert.equal(height(), '33px');
});

test('R-qa-8: switching Guide off removes the line, keeps the picker and saves on:false with the offer that was on screen', async () => {
  const s = setup();
  await s.shaper();
  s.swInput().click();
  await settle();
  assert.equal(s.swInput().checked, false);
  assert.equal(s.line(), null);
  assert.ok(s.picker(), 'the role picker stays');
  assert.deepEqual(s.order(), ['pin', 'picker', 'guide']);
  assert.deepEqual(s.calls.save, [{ on: false, offerSeen: true }], 'one save');
  s.type('Uploads fail on large files');
  s.handle.update(null);
  await settle();
  assert.equal(s.line(), null);
  assert.equal(s.calls.save.length, 1);
  s.type('');
  s.swInput().click();
  await settle();
  assert.ok(s.line(), 'on again: the line is back');
  assert.equal(s.text(), '', 'the used offer does not return');
  assert.deepEqual(s.calls.save.at(-1), { on: true });
});

test('with the offer already seen, the switch saves only on', async () => {
  const s = setup({ prefs: { offerSeen: true } });
  await s.shaper();
  s.swInput().click();
  await settle();
  assert.deepEqual(s.calls.save, [{ on: false }]);
});

test('R-qa-8: a new composer with on:false loaded shows the switch off, no line, and saves nothing', async () => {
  const s = setup({ prefs: { on: false } });
  await s.shaper();
  assert.equal(s.swInput().checked, false);
  assert.equal(s.sw().title, tipFor('Haiku 5.5'));
  assert.equal(s.line(), null);
  s.type('A prompt of well over twelve characters');
  s.handle.update(null);
  await settle();
  assert.equal(s.line(), null);
  assert.deepEqual(s.calls.save, []);
});

test('R-qa-10: after a click on the switch, and after Space on it, focus is in the prompt field', async () => {
  const s = setup({ prefs: { offerSeen: true } });
  await s.shaper();
  s.swInput().focus();
  s.swInput().click();
  await settle();
  assert.equal(s.doc.activeElement, s.input, 'after a click, turning it off');
  s.swInput().focus();
  assert.equal(s.doc.activeElement, s.swInput());
  // Space on a checkbox: the key events, then the click the browser makes of them.
  for (const type of ['keydown', 'keyup']) s.swInput().dispatchEvent(new s.win.KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
  s.swInput().click();
  await settle();
  assert.equal(s.swInput().checked, true);
  assert.equal(s.doc.activeElement, s.input, 'after Space, turning it on');
});

test('a refused save puts the switch and the line back, with nothing said', async () => {
  for (const was of [true, false]) {
    const d = deferred();
    const s = setup({ prefs: { on: was, offerSeen: true }, save: () => d.promise });
    await s.shaper();
    const said = s.said.length;
    s.swInput().click();
    assert.equal(s.swInput().checked, !was);
    assert.equal(!!s.line(), !was, 'painted while the save is out');
    d.reject(new Error('disk full'));
    await settle();
    assert.equal(s.swInput().checked, was);
    assert.equal(!!s.line(), was);
    assert.equal(s.said.length, said);
    assert.doesNotMatch(s.doc.body.textContent, /disk full/);
  }
});

test('two quick uses of the switch save in order: the second save starts only after the first settles', async () => {
  const d = deferred();
  const s = setup({ prefs: { offerSeen: true }, save: (patch, n) => (n === 1 ? d.promise : Promise.resolve({})) });
  await s.shaper();
  s.swInput().click();
  s.swInput().click();
  await settle();
  assert.deepEqual(s.calls.save, [{ on: false }]);
  d.resolve({});
  await settle();
  assert.deepEqual(s.calls.save, [{ on: false }, { on: true }]);
  assert.equal(s.swInput().checked, true);
});

test('R-ux-1 (360px): the real role picker folds by itself when the Guide switch would wrap, and unfolds without it', async () => {
  // jsdom has no layout: the row "wraps" only while the switch is in it.
  const s = setup({ measureWraps: (leadEl) => !!leadEl.querySelector(':scope > .ask-guide-sw') });
  await s.shaper();
  await s.resize();
  assert.ok(s.sw());
  assert.ok(s.picker().classList.contains('is-folded'));
  s.setFlag(false);
  await s.resize();
  assert.equal(s.sw(), null);
  assert.equal(s.picker().classList.contains('is-folded'), false);
});

test('R-arch-13: the picker\'s own measure looks at the Guide switch, else the picker; a trailing direction chip never folds it', () => {
  assert.equal(typeof rolePicker.layoutWraps, 'function', 'exported');
  const { doc, lead } = page();
  const place = (cls, top) => {
    const n = doc.createElement('span');
    n.className = cls;
    n.getBoundingClientRect = () => ({ top, height: 26 });
    lead.appendChild(n);
    return n;
  };
  const wraps = (tops) => {
    lead.replaceChildren();
    place('chat-intent', 0);
    const picker = place('ask-asker-pick', tops.picker);
    if (tops.sw !== undefined) place('ask-guide-sw', tops.sw);
    if (tops.dir !== undefined) place('chat-dir', tops.dir);
    return rolePicker.layoutWraps(lead, picker);
  };
  assert.equal(wraps({ picker: 0, sw: 32 }), true, 'only the switch sits below the pin');
  assert.equal(wraps({ picker: 0, sw: 0, dir: 32 }), false, 'only the direction chip sits below');
  assert.equal(wraps({ picker: 32 }), true, 'no switch: the picker, as before');
  assert.equal(wraps({ picker: 0, dir: 32 }), false);
});

test('R-qa-12: no pin, another pin, or the flag off: no switch, no line and no request, a refresh included', async () => {
  const s = setup();
  await settle();
  s.ctl.refresh();
  await settle();
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  for (const id of Object.keys(INTENTS).filter((x) => x !== 'shape')) {
    s.intent.set(id, { focus: false });
    await settle();
    assert.equal(s.sw(), null, id);
    assert.equal(s.line(), null, id);
  }
  s.type('A prompt of well over twelve characters');
  s.handle.update(null);
  await settle();
  assert.equal(s.calls.load, 0);
  assert.deepEqual(s.calls.save, []);
  const off = setup({ flag: false });
  await off.shaper();
  off.ctl.refresh();
  off.type('A prompt of well over twelve characters');
  off.handle.update(null);
  await settle();
  assert.equal(off.sw(), null);
  assert.equal(off.line(), null);
  assert.equal(off.lead.childElementCount, 1, 'only the Shaper pin');
  assert.equal(off.calls.load, 0);
  assert.deepEqual(off.calls.save, []);
});

test('one read per composer mount: pin set twice, and a mount with the pin already set', async () => {
  const s = setup();
  await s.shaper();
  await s.shaper();
  s.intent.set('run', { focus: false });
  await s.shaper();
  assert.equal(s.calls.load, 1);
  const pinned = setup({ pin: 'shape' });
  await settle();
  assert.equal(pinned.calls.load, 1);
  assert.deepEqual(pinned.order(), ['pin', 'picker', 'guide']);
});

test('the switch and the line follow the flag while the Shaper pin is set', async () => {
  const s = setup();
  await s.shaper();
  s.setFlag(false);
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  s.setFlag(true);
  await settle();
  assert.ok(s.sw());
  assert.equal(s.doc.querySelectorAll('.ask-guide').length, 1);
  assert.equal(s.calls.load, 1);
});

test('R-arch-10: the add-on can never take, hold or reword a send', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.handle.beforeSend, undefined);
  assert.equal(s.handle.transformSend, undefined);
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
  const src = readFileSync(new URL('../ui/public/chat/guide-line.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /innerHTML|insertAdjacentHTML/, 'every text is set as text');
});

test('destroy() unsubscribes, removes the switch and the line, and stops listening to the field', async () => {
  const s = setup();
  await s.shaper();
  assert.ok(s.line());
  s.handle.destroy();
  assert.equal(s.state.intentOffs, 1);
  assert.equal(s.state.flagOffs, 1);
  assert.equal(s.sw(), null);
  assert.equal(s.line(), null);
  s.type('Uploads fail');
  await s.shaper();
  assert.deepEqual(s.calls.save, []);
  assert.equal(s.sw(), null);
});

test('loadGuide and saveGuidePrefs: the two routes; both reject on a non-200', async () => {
  const asked = [];
  const ok = (body) => async (url, init) => {
    asked.push([init?.method || 'GET', url, init?.body ?? null]);
    return { ok: true, status: 200, json: async () => body };
  };
  assert.deepEqual(await loadGuide(ok(PREFS)), PREFS);
  await saveGuidePrefs({ on: false }, ok({ on: false }));
  assert.deepEqual(asked[0], ['GET', '/api/shape/guide', null]);
  assert.deepEqual(asked[1].slice(0, 2), ['PUT', '/api/shape/guide/prefs']);
  assert.deepEqual(JSON.parse(asked[1][2]), { on: false });
  const refused = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 'BAD_GUIDE_PREFS' } }) });
  await assert.rejects(loadGuide(refused));
  await assert.rejects(saveGuidePrefs({ on: false }, refused));
});

// ── the stylesheet (chat-shell.css, the mock's classes) ──
/** chat-shell.css split into its plain rules and the rules inside `@media (pointer:coarse)`. */
function cssParts() {
  const css = readFileSync(new URL('../ui/public/chat/chat-shell.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let plain = '';
  let coarse = '';
  for (let i = 0; i < css.length;) {
    const at = css.indexOf('@media', i);
    if (at < 0) { plain += css.slice(i); break; }
    plain += css.slice(i, at);
    const open = css.indexOf('{', at);
    let end = open + 1;
    for (let depth = 1; end < css.length && depth; end += 1) depth += css[end] === '{' ? 1 : css[end] === '}' ? -1 : 0;
    if (/pointer\s*:\s*coarse/.test(css.slice(at, open))) coarse += css.slice(open + 1, end - 1);
    i = end;
  }
  const rules = (t) => [...t.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ sel: sel.trim().replace(/\s*>\s*/g, ' > '), body: body.trim().replace(/\s*([:;])\s*/g, '$1') }));
  return { base: rules(plain), coarse: rules(coarse) };
}
const declared = (rules, selector) => rules.filter((r) => r.sel === selector).map((r) => r.body).join(';').split(';').filter(Boolean);
const holds = (rules, selector, wanted) => {
  const got = declared(rules, selector);
  for (const d of wanted) assert.ok(got.includes(d), `${selector} { ${d} } — has: ${got.join('; ') || 'no rule'}`);
};

test('R-ux-2: the line is 33px (32px and its divider), never wraps, its words end in an ellipsis; 41px on a coarse pointer', () => {
  const { base, coarse } = cssParts();
  holds(base, '.ask-guide', ['display:flex', 'align-items:center', 'gap:8px', 'box-sizing:border-box', 'height:33px', 'margin:0 6px',
    'border-top:1px solid var(--line)', 'font-size:var(--fs-meta)', 'color:var(--ink-2)', 'white-space:nowrap', 'min-width:0']);
  holds(base, '.ask-guide-t', ['flex:1 1 auto', 'min-width:0', 'overflow:hidden', 'text-overflow:ellipsis']);
  holds(coarse, '.ask-guide', ['height:41px']);
});

test('the switch in the lead row: the mock\'s rules, and 40px on a coarse pointer like the picker', () => {
  const { base, coarse } = cssParts();
  holds(base, '.chat-composer-lead > .ask-guide-sw', ['min-height:26px', 'margin-left:4px']);
  holds(base, '.chat-composer-lead > .ask-guide-sw .switch-label', ['font-size:var(--fs-meta)']);
  holds(coarse, '.chat-composer-lead > .ask-guide-sw', ['min-height:40px']);
});

test('R-arch-12: the new rules use tokens only: no colour literal, no animation, no transition', () => {
  const { base, coarse } = cssParts();
  const rules = [...base, ...coarse].filter((r) => r.sel.includes('ask-guide'));
  assert.ok(rules.length, 'the stylesheet has Guide rules');
  for (const r of rules) {
    assert.doesNotMatch(r.body, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|violet/i, r.sel);
    assert.doesNotMatch(r.body, /animation|transition/, r.sel);
  }
});

test('app.js installs Guide once, after the role picker and before the panel, and refreshes it after a Models save', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{[^}]*\binstallGuideLine\b[^}]*\} from '\.\/chat\/guide-line\.mjs';/);
  assert.match(app, /import \{[^}]*\brefreshGuideLine\b[^}]*\} from '\.\/chat\/guide-line\.mjs';/);
  const calls = [...app.matchAll(/\binstallGuideLine\(\{ intent: chatIntent \}\)/g)];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].index > app.indexOf('installRolePicker({ intent: chatIntent })'), 'after the role picker');
  assert.ok(calls[0].index < app.indexOf('askPanel = createAskPanel('), 'before createAskPanel');
  assert.match(app, /\brefreshGuideLine\(\)/);
});

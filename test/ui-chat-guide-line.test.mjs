// test/ui-chat-guide-line.test.mjs — the composer's Guide switch and Guide line (ui/public/chat/guide-line.mjs, a
// CONTRACT §2 composer add-on registered after the role picker). With the shaperSmallRuns flag on and the Shaper pin set
// the lead row reads pin, role picker, "Guide" switch, and one line of fixed height sits between the field and the bar:
// the first-time offer while the prompt is empty, else nothing. The prefs and the model's name are read once per mount
// (GET /api/shape/guide). With the flag off or no Shaper pin there is no switch, no line and no request. It never takes,
// holds or rewords a send.
// The check: 2 seconds after the person types a changed prompt of 12 or more characters, one POST
// /api/shape/guide/check (never on send, one in flight, a stale answer dropped). The line reads "Checking your prompt…",
// then the result: a fold button "Prompt 2/5 · 3 gaps", or with no gap the size in words. A failed check leaves it empty.
// Every test injects the timer and the check, so nothing waits and no route is called.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createGuideLine, installGuideLine, refreshGuideLine, guideTip, lineText, loadGuide, saveGuidePrefs,
  GUIDE_ADDON_ID, LINE_TITLE, OFFER_TEXT, TIP_HEAD,
} from '../ui/public/chat/guide-line.mjs';
// A namespace read too, so a missing check export fails only its own test.
import * as guide from '../ui/public/chat/guide-line.mjs';
import { createIntentAddon, INTENTS } from '../ui/public/chat/intent.mjs';
import { icon } from '../ui/public/icons.mjs';
import { GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, GUIDE_PROMPT_MAX, GUIDE_SIZES } from '../src/shared/prompt-check/assessment.mjs';
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

/** Timers a test drives by hand: nothing runs until advance(ms) reaches it. */
function manualTimers() {
  let now = 0;
  let ids = 0;
  const queued = new Map();
  return {
    setTimeout(fn, ms = 0) { ids += 1; queued.set(ids, { fn, at: now + ms }); return ids; },
    clearTimeout(id) { queued.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...queued].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        queued.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
    pending: () => queued.size,
  };
}

/** The check as a spy: every call is recorded with its body and signal, and answers only when the test says so. It
 *  ignores the signal on purpose, so a late answer to an aborted request still lands. */
function checker() {
  const calls = [];
  const check = (body, opts = {}) => {
    const d = deferred();
    calls.push({ body, signal: opts.signal, resolve: d.resolve });
    return d.promise;
  };
  return { calls, check };
}

/** The check route's body with the first `covered` of the five checks covered. */
function answer(covered = 2, size = 'large', register = 'technical') {
  const checks = GUIDE_CHECK_IDS.map((id, i) => ({
    id, label: GUIDE_CHECK_LABELS[register][id], covered: i < covered, question: i < covered ? '' : `question ${id}`,
  }));
  return { register, size, checks, model: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' } };
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
function setup({ flag = true, prefs = {}, load = null, save = null, pin = null, picker = true, measureWraps = () => false, value = '', bar = true,
  timers = manualTimers(), check = null, role = null, before = null } = {}) {
  const p = page({ bar });
  p.input.value = value;
  if (before) before(p, timers);   // listeners that must be in place before the add-ons mount
  const checks = checker();
  const state = { picker: flag, guide: flag, pickerSubs: new Set(), subs: new Set(), flagOffs: 0, intentOffs: 0, sendSubs: new Set(), role };
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
      // The controller's send subscription (intent.mjs), counted here.
      onSend: (fn) => {
        state.sendSubs.add(fn);
        const off = typeof intent.onSend === 'function' ? intent.onSend(fn) : () => {};
        return () => { state.sendSubs.delete(fn); off(); };
      },
    },
    timers,
    check: check || checks.check,
    role: () => state.role,
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
  /** Let `ms` pass on the injected timer, then let the promises run. */
  const wait = async (ms = 2000) => { timers.advance(ms); await settle(); };
  /** Answer check call `n` with a result body. */
  const reply = async (n, body = answer()) => { checks.calls[n].resolve({ ok: true, check: body }); await settle(); };
  /** Answer check call `n` with a failure code. */
  const refuse = async (n, code) => { checks.calls[n].resolve({ ok: false, code }); await settle(); };
  const fold = () => p.doc.querySelector('.ask-guide .ask-guide-fold');
  const quiet = () => p.doc.querySelector('.ask-guide .ask-guide-q');
  return { ...p, state, calls, stored, intent, intentHandle, ctl, handle, setFlag, shaper, timers, checks: checks.calls, wait, reply, refuse, fold, quiet };
}

const PROMPT = 'Export runs as CSV';
const LONGER = 'Export runs as CSV or JSON';
const CHECKING = 'Checking your prompt…';
const GAPS = 'Prompt 2/5 · 3 gaps';

/** A Shaper composer showing the result of one check of PROMPT. */
async function withResult(body = answer(), opts = {}) {
  const s = setup(opts);
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.checks.length, 1, 'one check after the pause');
  await s.reply(0, body);
  return s;
}

/** Nothing of a check is on the line: it is empty, with no button and no word about checking. */
function emptyLine(s, why) {
  assert.ok(s.line(), `${why}: the line is kept`);
  assert.equal(s.text(), '', why);
  assert.equal(s.line().textContent, '', why);
  assert.equal(s.fold(), null, why);
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
  // Checking, and with a result: the same line, the same height.
  const line = s.line();
  await s.wait();
  assert.equal(s.text(), CHECKING);
  assert.equal(height(), '33px', 'checking');
  await s.reply(0);
  assert.equal(s.fold()?.textContent, GAPS);
  assert.equal(height(), '33px', 'a result');
  assert.equal(s.line(), line, 'the same element');
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

// ── the check: pure words, state and the request ──
test('the check\'s constants: a 2000 ms pause, 12 characters, the two checking words and the three size phrases', () => {
  assert.equal(guide.CHECK_DELAY_MS, 2000);
  assert.equal(guide.CHECK_MIN_CHARS, 12);
  assert.equal(guide.CHECKING_TEXT, CHECKING);
  assert.equal(guide.RECHECK_TEXT, 'checking…');
  assert.deepEqual(guide.SIZE_WORDS, { small: 'Small: one run', medium: 'Medium: a few runs', large: 'Large: several runs' });
  assert.ok(Object.isFrozen(guide.SIZE_WORDS));
});

test('resultWords: with a gap open the score and the gap count, whatever the size', () => {
  for (const size of GUIDE_SIZES) {
    assert.deepEqual(guide.resultWords(answer(2, size)), { fold: true, head: 'Prompt 2/5', rest: ' · 3 gaps' }, size);
    assert.deepEqual(guide.resultWords(answer(4, size)), { fold: true, head: 'Prompt 4/5', rest: ' · 1 gap' }, size);
    assert.deepEqual(guide.resultWords(answer(0, size)), { fold: true, head: 'Prompt 0/5', rest: ' · 5 gaps' }, size);
  }
});

test('resultWords: with no gap open the size in words: small is plain "Clear enough", medium and large are folds, never a number of runs', () => {
  assert.deepEqual(guide.resultWords(answer(5, 'small')), { fold: false, head: 'Clear enough', rest: ' · Small: one run' });
  assert.deepEqual(guide.resultWords(answer(5, 'medium')), { fold: true, head: 'Prompt 5/5', rest: ' · Medium: a few runs' });
  assert.deepEqual(guide.resultWords(answer(5, 'large')), { fold: true, head: 'Prompt 5/5', rest: ' · Large: several runs' });
  for (const size of GUIDE_SIZES) {
    const { head, rest } = guide.resultWords(answer(5, size));
    assert.doesNotMatch(rest, /\d/, size);
    assert.doesNotMatch(`${head}${rest}`, /small runs|\d+ runs?\b/i, size);
  }
});

test('resultWords: null for a body that is not five checks and a known size', () => {
  const good = answer();
  for (const [name, body] of [
    ['nothing', undefined], ['null', null], ['an empty body', {}], ['no checks', { size: 'small' }],
    ['checks that are not a list', { size: 'small', checks: {} }], ['four checks', { ...good, checks: good.checks.slice(1) }],
    ['six checks', { ...good, checks: [...good.checks, good.checks[0]] }], ['no size', { checks: good.checks }],
    ['an unknown size', { ...good, size: 'very-large' }],
  ]) assert.equal(guide.resultWords(body), null, name);
});

test('lineState, first match: a result (with "checking…" on a re-check), the first check, the offer, else empty; off is off', () => {
  const base = { on: true, offerSeen: false, offerGone: false, prompt: '', result: null, checking: false };
  const result = answer();
  const kind = (over) => guide.lineState({ ...base, ...over }).kind;
  assert.equal(kind({ on: false, result, checking: true }), 'off');
  const shown = guide.lineState({ ...base, prompt: PROMPT, result });
  assert.equal(shown.kind, 'result');
  assert.deepEqual(shown.words, guide.resultWords(result));
  assert.ok(!shown.recheck);
  const again = guide.lineState({ ...base, prompt: PROMPT, result, checking: true });
  assert.equal(again.kind, 'result', 'a result outranks checking');
  assert.equal(again.recheck, true);
  assert.equal(kind({ result }), 'result', 'a result outranks the offer');
  assert.equal(kind({ prompt: PROMPT, checking: true }), 'checking');
  assert.equal(kind({ checking: true }), 'checking', 'checking outranks the offer');
  assert.equal(kind({}), 'offer');
  assert.equal(kind({ offerSeen: true }), 'empty');
  assert.equal(kind({ offerGone: true }), 'empty');
  assert.equal(kind({ prompt: PROMPT }), 'empty');
});

test('checkGuide: one POST /api/shape/guide/check with the prompt, the role (null for none) and the signal', async () => {
  const asked = [];
  const body = answer();
  const fetchFn = async (url, init) => { asked.push({ url, init }); return { ok: true, status: 200, json: async () => body }; };
  const ctl = new AbortController();
  assert.deepEqual(await guide.checkGuide({ prompt: PROMPT, role: 'product' }, { signal: ctl.signal, fetchFn }), { ok: true, check: body });
  await guide.checkGuide({ prompt: PROMPT, role: null }, { fetchFn });
  await guide.checkGuide({ prompt: PROMPT }, { fetchFn });
  assert.equal(asked.length, 3);
  assert.equal(asked[0].url, '/api/shape/guide/check');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.headers['Content-Type'], 'application/json');
  assert.equal(asked[0].init.signal, ctl.signal);
  assert.deepEqual(asked.map((a) => JSON.parse(a.init.body)),
    [{ prompt: PROMPT, role: 'product' }, { prompt: PROMPT, role: null }, { prompt: PROMPT, role: null }]);
});

const ROUTE_CODES = [
  ['GUIDE_BAD_ROLE', 400], ['GUIDE_BAD_PROMPT', 400], ['GUIDE_PROMPT_TOO_LONG', 413], ['GUIDE_OFF', 409], ['GUIDE_COST_LIMIT', 429],
  ['GUIDE_NO_MODEL', 503], ['GUIDE_BUSY', 429], ['GUIDE_SUPERSEDED', 409], ['GUIDE_MODEL_FAILED', 502], ['GUIDE_CHECK_FAILED', 500],
];

test('checkGuide never rejects: every route code, an abort, a network error and a reply that does not parse resolve with a code', async () => {
  const run = (fetchFn) => guide.checkGuide({ prompt: PROMPT, role: null }, { fetchFn });
  for (const [code, status] of ROUTE_CODES) {
    const refused = async () => ({ ok: false, status, json: async () => ({ error: { code, message: 'x' } }) });
    assert.deepEqual(await run(refused), { ok: false, code }, code);
  }
  assert.deepEqual(await run(async () => { throw new DOMException('This operation was aborted', 'AbortError'); }), { ok: false, code: 'ABORTED' });
  assert.deepEqual(await run(async () => { throw new TypeError('Failed to fetch'); }), { ok: false, code: 'NETWORK' });
  const unparsable = async () => { throw new SyntaxError('Unexpected token <'); };
  assert.deepEqual(await run(async () => ({ ok: true, status: 200, json: unparsable })), { ok: false, code: 'BAD_REPLY' });
  assert.deepEqual(await run(async () => ({ ok: false, status: 502, json: unparsable })), { ok: false, code: 'BAD_REPLY' });
});

// ── the check: the debounce, the single flight and the stale drop ──
test('R-qa-2: 11 characters make no check, padded with spaces too', async () => {
  const s = setup();
  await s.shaper();
  s.type('abcdefghijk');
  await s.wait(3000);
  s.type('  abcdefghijk  ');
  await s.wait(3000);
  assert.equal(s.checks.length, 0);
  s.type('abcdefghijkl');
  await s.wait(2000);
  assert.equal(s.checks.length, 1, 'the twelfth character makes the call');
});

test('R-qa-2: 12 characters make no check at 1999 ms and exactly one at 2000 ms, with the trimmed prompt and the role the composer carries', async () => {
  const s = setup({ role: 'product' });
  await s.shaper();
  s.type('  abcdefghijkl \n');
  await s.wait(1999);
  assert.equal(s.checks.length, 0);
  await s.wait(1);
  assert.equal(s.checks.length, 1);
  assert.deepEqual(s.checks[0].body, { prompt: 'abcdefghijkl', role: 'product' });
  assert.equal(s.checks[0].signal.aborted, false);
  await s.wait(10000);
  assert.equal(s.checks.length, 1);
  s.state.role = null;                 // the role is read when the check is made
  s.type(LONGER);
  await s.wait();
  assert.deepEqual(s.checks[1].body, { prompt: LONGER, role: null });
});

test('the 2 seconds count from the last keystroke: typing again starts the pause over', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait(1500);
  s.type(LONGER);
  await s.wait(1999);
  assert.equal(s.checks.length, 0);
  await s.wait(1);
  assert.deepEqual(s.checks.map((c) => c.body.prompt), [LONGER]);
});

test('R-qa-2: unchanged text makes no second check, in flight or answered, spaces around it included', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.checks.length, 1, 'in flight');
  assert.equal(s.checks[0].signal.aborted, false, 'the same text aborts nothing');
  await s.reply(0);
  s.type(PROMPT);
  await s.wait();
  s.type(`  ${PROMPT}  `);
  await s.wait();
  assert.equal(s.checks.length, 1, 'answered');
  assert.equal(s.fold().textContent, GAPS, 'the result stays');
});

test('R-arch-4: at most one check in flight: typing aborts it, and the next pause makes one new call', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.type(LONGER);
  assert.equal(s.checks[0].signal.aborted, true, 'a changed prompt aborts the request at once');
  assert.equal(s.checks.length, 1);
  await s.wait();
  assert.equal(s.checks.length, 2);
  assert.equal(s.checks[1].signal.aborted, false);
});

test('R-arch-4 example: a person types, waits, then edits before the answer lands: the stale answer never shows', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.type(LONGER);
  await s.reply(0);                    // lands although its request was aborted
  assert.equal(s.fold(), null);
  assert.doesNotMatch(s.line().textContent, /Prompt|gap|Checking/, 'no word of it, and nothing left checking');
});

test('an answer is dropped when the field changed with no input event (a recall, a code write)', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.input.value = LONGER;
  await s.reply(0);
  emptyLine(s, 'the answer was asked for other text');
});

test('a shown result whose field changed with no input event is checked again: update() arms the pause, one new call', async () => {
  const s = await withResult();
  s.input.value = LONGER;   // a recall, a code write: no input event
  s.handle.update();
  await s.wait(1999);
  assert.equal(s.checks.length, 1, 'nothing before the pause ends');
  await s.wait(1);
  assert.equal(s.checks.length, 2, 'exactly one new check');
  assert.equal(s.checks[1].body.prompt, LONGER);
  s.handle.update();
  await s.wait();
  assert.equal(s.checks.length, 2, 'no second re-check while it is out');
});

test('an older answer that lands after a newer check started changes nothing; the newer one paints', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.type(LONGER);
  await s.wait();
  await s.reply(0, answer(4));
  assert.equal(s.fold(), null);
  assert.equal(s.text(), CHECKING, 'the newer check is still out');
  await s.reply(1);
  assert.equal(s.fold().textContent, GAPS);
});

for (const code of ['GUIDE_SUPERSEDED', 'ABORTED']) {
  test(`a lone ${code} ends checking: the line is empty, and the next input checks again`, async () => {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.text(), CHECKING);
    await s.refuse(0, code);
    emptyLine(s, code);
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.checks.length, 2, 'the same text is asked again');
  });

  test(`${code} on a re-check keeps the result shown before it, with no "checking…", and the next input checks again`, async () => {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    await s.refuse(1, code);
    assert.equal(s.fold()?.textContent, GAPS);
    assert.equal(s.quiet(), null);
    await s.wait(5000);
    assert.equal(s.checks.length, 2, 'the repaint does not ask again on its own');
    s.type(LONGER);
    await s.wait();
    assert.equal(s.checks.length, 3);
  });
}

test('shortening the prompt below 12 characters aborts the check and empties the line', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.type('Export');
  assert.equal(s.checks[0].signal.aborted, true);
  await s.wait(3000);
  emptyLine(s, 'shortened mid-check');
  assert.equal(s.checks.length, 1);
  await s.reply(0);
  emptyLine(s, 'its late answer');
});

test('shortening below 12 characters drops the result, and the same prompt typed again is checked again', async () => {
  const s = await withResult();
  s.type('Export runs');             // 11 characters
  await s.wait(3000);
  emptyLine(s, 'a short prompt');
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.checks.length, 2);
});

test('a prompt over the route\'s limit is not sent and the result goes; at the limit it is checked', async () => {
  const s = await withResult();
  s.type('x'.repeat(GUIDE_PROMPT_MAX + 1));
  await s.wait(3000);
  assert.equal(s.checks.length, 1);
  emptyLine(s, 'over the limit');
  s.type('y'.repeat(GUIDE_PROMPT_MAX));
  await s.wait();
  assert.equal(s.checks.length, 2);
});

test('a render, a keyup and a focus never start a check: only typing does', async () => {
  const s = setup({ value: PROMPT });
  await s.shaper();
  s.handle.update(null);
  s.input.dispatchEvent(new s.win.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
  s.input.dispatchEvent(new s.win.Event('focus'));
  await s.wait(3000);
  assert.equal(s.checks.length, 0);
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.checks.length, 1);
});

// ── never on send ──
const keydown = (s, init) => s.input.dispatchEvent(new s.win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

for (const [name, send] of [
  ['the intent\'s send signal for this field', (s) => { s.intentHandle.transformSend(s.input.value); }],
  ['Enter', (s) => keydown(s, { key: 'Enter' })],
  ['a click on Send', (s) => s.doc.querySelector('.ask-send').click()],
  ['the send\'s clear of the field, then a render', (s) => { s.input.value = ''; s.handle.update(null); }],
]) {
  test(`R-arch-4, never on send: ${name} before the pause ends makes no check`, async () => {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait(1000);
    send(s);
    await s.wait(3000);
    assert.equal(s.checks.length, 0);
    s.type(LONGER);
    await s.wait();
    assert.equal(s.checks.length, 1, 'the control: typing afterwards checks');
  });
}

test('Guide subscribes to the send signal once per composer, and a signal for another field changes nothing', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.state.sendSubs.size, 1);
  s.type(PROMPT);
  await s.wait(1000);
  for (const fn of [...s.state.sendSubs]) fn({ field: s.doc.createElement('textarea') });
  await s.wait(1000);
  assert.equal(s.checks.length, 1);
  for (const fn of [...s.state.sendSubs]) fn({ field: s.doc.createElement('textarea') });
  assert.equal(s.checks[0].signal.aborted, false);
});

test('the send signal for this field aborts the check in flight, drops the result and lets the same text be checked again', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait();
  s.intentHandle.transformSend(s.input.value);
  s.handle.update(null);               // the render that follows a send
  await settle();
  assert.equal(s.checks[1].signal.aborted, true);
  assert.equal(s.fold(), null);
  assert.doesNotMatch(s.line().textContent, /Prompt|checking/i);
  await s.reply(1);
  assert.equal(s.fold(), null, 'its late answer is dropped');
  s.type(LONGER);
  await s.wait();
  assert.equal(s.checks.length, 3);
});

for (const [name, init] of [
  ['an Enter that ends an IME composition', { key: 'Enter', isComposing: true }],
  ['Shift+Enter (a new line)', { key: 'Enter', shiftKey: true }],
]) {
  test(`${name} leaves the pause running: exactly one check at 2000 ms`, async () => {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait(1000);
    keydown(s, init);
    await s.wait(999);
    assert.equal(s.checks.length, 0);
    await s.wait(1);
    assert.equal(s.checks.length, 1);
  });
}

test('Enter and a click on Send only clear the pending pause: a check already out is not aborted and the line stays', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait();
  keydown(s, { key: 'Enter' });
  s.doc.querySelector('.ask-send').click();
  await settle();
  assert.equal(s.checks[1].signal.aborted, false);
  assert.equal(s.fold().textContent, GAPS);
  assert.ok(s.quiet());
});

test('the click on Send clears the pause before the button\'s own handlers run (the capture phase)', async () => {
  let atClick = null;
  const s = setup({
    before: (p, timers) => p.doc.querySelector('.ask-send').addEventListener('click', () => { atClick = timers.pending(); }),
  });
  await s.shaper();
  s.type(PROMPT);
  assert.equal(s.timers.pending(), 1, 'the pause is running');
  s.doc.querySelector('.ask-send').click();
  assert.equal(atClick, 0);
});

// ── the gates: when nothing may be asked ──
test('R-qa-2 example: 40 characters and 3 seconds make no check with the flag off, with no pin, or with Guide off after a reload', async () => {
  const forty = 'Uploads of large files fail with no word';
  assert.equal(forty.length, 40);
  const walk = async (opts, arm) => {
    const s = setup(opts);
    await arm(s);
    await settle();
    s.type(forty);
    s.handle.update(null);
    await s.wait(3000);
    return s.checks.length;
  };
  assert.equal(await walk({}, (s) => s.shaper()), 1, 'the control: Guide on with the Shaper pin');
  assert.equal(await walk({ flag: false }, (s) => s.shaper()), 0, 'flag off');
  assert.equal(await walk({}, () => {}), 0, 'no pin');
  assert.equal(await walk({}, (s) => s.intent.set('run', { focus: false })), 0, 'another pin');
  assert.equal(await walk({ prefs: { on: false } }, (s) => s.shaper()), 0, 'Guide off, a new composer');
});

test('typing before the Guide read lands starts nothing', async () => {
  const d = deferred();
  const s = setup({ load: () => d.promise });
  await s.shaper();
  s.type(PROMPT);
  await s.wait(3000);
  d.resolve({ ...PREFS });
  await settle();
  await s.wait(3000);
  assert.equal(s.checks.length, 0);
  s.type(LONGER);
  await s.wait();
  assert.equal(s.checks.length, 1);
});

const LEAVES = [
  ['Guide switched off', (s) => s.swInput().click(), (s) => s.swInput().click()],
  ['the Shaper pin removed', (s) => s.intent.clear(), (s) => s.intent.set('shape', { focus: false })],
  ['the flag turned off', (s) => s.setFlag(false), (s) => s.setFlag(true)],
];
for (const [name, leave, back] of LEAVES) {
  test(`${name} mid-pause makes no check`, async () => {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait(1000);
    leave(s);
    await s.wait(3000);
    assert.equal(s.checks.length, 0);
    back(s);
    await settle();
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.checks.length, 1, 'back: typing checks');
  });

  test(`${name} mid-check aborts it and drops the result; back, the line is empty and the same text is checked again`, async () => {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    leave(s);
    await settle();
    assert.equal(s.checks[1].signal.aborted, true);
    await s.reply(1);
    back(s);
    await settle();
    emptyLine(s, name);
    s.type(LONGER);
    await s.wait();
    assert.equal(s.checks.length, 3);
  });
}

test('destroy() clears the pause, aborts the check and drops the send subscription', async () => {
  const waiting = setup();
  await waiting.shaper();
  waiting.type(PROMPT);
  waiting.handle.destroy();
  await waiting.wait(3000);
  assert.equal(waiting.checks.length, 0);
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.state.sendSubs.size, 1);
  s.handle.destroy();
  assert.equal(s.checks[0].signal.aborted, true);
  assert.equal(s.state.sendSubs.size, 0);
  await s.reply(0);
  assert.equal(s.line(), null);
});

test('with no check injected the composer asks the real route through the page\'s fetch, with no role', async () => {
  const asked = [];
  globalThis.fetch = async (url, init) => { asked.push([init?.method, url, init?.body]); return { ok: true, status: 200, json: async () => answer() }; };
  const p = page();
  const intent = createIntentAddon();
  intent.addon.mount(p.lead, p.ctx);
  const timers = manualTimers();
  const ctl = createGuideLine({
    intent, timers, flagOn: () => true, onFlagChange: () => () => {}, load: async () => ({ ...PREFS }), save: async () => ({}),
  });
  const handle = ctl.addon.mount(p.lead, p.ctx);
  try {
    intent.set('shape', { focus: false });
    await settle();
    p.type(PROMPT);
    timers.advance(2000);
    await settle();
    assert.equal(asked.length, 1);
    assert.deepEqual(asked[0].slice(0, 2), ['POST', '/api/shape/guide/check']);
    assert.deepEqual(JSON.parse(asked[0][2]), { prompt: PROMPT, role: null });
    assert.equal(p.doc.querySelector('.ask-guide .ask-guide-fold')?.textContent, GAPS);
  } finally { handle.destroy(); }
});

// ── the line: checking, result, re-check, failure ──
test('the first check in flight reads "Checking your prompt…", with no button', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  assert.equal(s.text(), '', 'nothing during the pause');
  await s.wait();
  assert.equal(s.text(), CHECKING);
  assert.equal(s.fold(), null);
  assert.equal(s.quiet(), null);
});

test('R-po-2 example: "Export runs as CSV" reads "Prompt 2/5 · 3 gaps" on a real fold button whose aria-expanded turns false to true', async () => {
  const s = await withResult();
  const b = s.fold();
  assert.ok(b, 'the fold button');
  assert.ok(b.matches('button.btn.plan-fold.ask-guide-fold[type="button"]'));
  assert.equal(b.textContent, GAPS);
  assert.equal(s.line().textContent, GAPS, 'nothing else on the line');
  assert.equal(b.querySelector(':scope > span.plan-fold-text > b.ask-guide-head')?.textContent, 'Prompt 2/5');
  assert.equal(b.querySelector(':scope > span.plan-fold-text > span.ask-guide-rest')?.textContent, ' · 3 gaps');
  const chev = b.querySelector(':scope > .ask-guide-chev');
  assert.ok(chev, 'the chevron');
  assert.equal(chev.getAttribute('aria-hidden'), 'true');
  assert.equal(chev.innerHTML, icon(s.doc, 'chevron-down', 12).innerHTML, 'the app\'s chevron-down');
  assert.equal(b.getAttribute('aria-expanded'), 'false', 'shut on arrival');
  b.click();
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  b.click();
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(s.doc.querySelector('.ask-guide-rows'), null, 'no rows yet');
  assert.ok(s.line().nextElementSibling.matches('.ask-composer-row[data-bar="compact"]'), 'the line stays right before the bar');
});

test('the fold is the app\'s one fold() with the app\'s icon set', () => {
  const src = readFileSync(new URL('../ui/public/chat/guide-line.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{[^}]*\bfold\b[^}]*\} from '\.\.\/shape\/check-row\.mjs';/);
  assert.match(src, /import \{[^}]*\bicon\b[^}]*\} from '\.\.\/icons\.mjs';/);
});

test('a re-check keeps the result with a quiet "checking…" after it; the new result lands in the same button, still open', async () => {
  const s = await withResult();
  const b = s.fold();
  b.click();
  s.type(LONGER);
  assert.equal(s.fold(), b, 'the result stays during the pause');
  assert.equal(s.quiet(), null);
  await s.wait();
  assert.equal(s.fold(), b);
  assert.equal(b.textContent, GAPS);
  assert.equal(s.quiet()?.textContent, 'checking…');
  assert.equal(b.nextElementSibling, s.quiet(), 'after the button');
  assert.doesNotMatch(s.line().textContent, /Checking your prompt/);
  await s.reply(1, answer(4));
  assert.equal(s.quiet(), null);
  assert.equal(s.fold(), b, 'built once, updated in place');
  assert.equal(b.textContent, 'Prompt 4/5 · 1 gap');
  assert.equal(b.getAttribute('aria-expanded'), 'true', 'the open choice survives a new result');
});

for (const [size, words] of [
  ['large', 'Prompt 5/5 · Large: several runs'], ['medium', 'Prompt 5/5 · Medium: a few runs'], ['small', 'Clear enough · Small: one run'],
]) {
  test(`with no gap open and a ${size} size the line reads "${words}", with no number of runs`, async () => {
    const s = await withResult(answer(5, size));
    const shown = size === 'small' ? s.doc.querySelector('.ask-guide > span.ask-guide-sum') : s.fold();
    assert.ok(shown, size === 'small' ? 'plain text' : 'a fold button');
    assert.equal(shown.textContent, words);
    assert.equal(s.line().textContent, words);
    assert.equal(shown.querySelector('b.ask-guide-head')?.textContent, words.split(' · ')[0]);
    assert.equal(shown.querySelector('span.ask-guide-rest')?.textContent, ` · ${words.split(' · ')[1]}`);
    if (size === 'small') {
      assert.equal(s.fold(), null, 'no button');
      assert.equal(s.line().querySelector('button, svg'), null, 'no chevron');
    }
    assert.doesNotMatch(s.line().textContent, /small runs|\d+ runs?\b/i);
    s.type(LONGER);
    await s.wait();
    assert.equal(s.quiet()?.textContent, 'checking…', 're-checking');
    assert.equal(shown.nextElementSibling, s.quiet(), 'after the result');
    assert.equal(s.line().textContent, `${words}checking…`);
  });
}

test('the line moves between the fold and the plain words as results change', async () => {
  const s = await withResult(answer(5, 'small'));
  s.type(LONGER);
  await s.wait();
  await s.reply(1);
  assert.equal(s.line().textContent, GAPS);
  assert.equal(s.doc.querySelector('.ask-guide-sum'), null);
  s.type(PROMPT);
  await s.wait();
  await s.reply(2, answer(5, 'small'));
  assert.equal(s.line().textContent, 'Clear enough · Small: one run');
  assert.equal(s.fold(), null);
});

const FAILURES = [
  ...ROUTE_CODES.map(([code]) => code).filter((c) => c !== 'GUIDE_SUPERSEDED').map((code) => [code, { ok: false, code }]),
  ['NETWORK', { ok: false, code: 'NETWORK' }],
  ['BAD_REPLY', { ok: false, code: 'BAD_REPLY' }],
  ['a code Guide does not know', { ok: false, code: 'SOMETHING_NEW' }],
  ['a 200 with a body that is no result', { ok: true, check: {} }],
];

test('a failed first check, whatever its code, returns the line to empty and never sticks at "Checking your prompt…"', async () => {
  for (const [name, failure] of FAILURES) {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.text(), CHECKING, name);
    s.checks[0].resolve(failure);
    await settle();
    emptyLine(s, name);
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.checks.length, 1, `${name}: unchanged text is not asked again`);
    s.handle.destroy();
  }
});

test('a failed re-check empties the line too', async () => {
  for (const [name, failure] of FAILURES) {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    assert.ok(s.quiet(), name);
    s.checks[1].resolve(failure);
    await settle();
    emptyLine(s, name);
    assert.equal(s.quiet(), null, name);
    s.handle.destroy();
  }
});

test('model text is set as text: markup in a reply creates no element', async () => {
  const markup = '<img src=x onerror=alert(1)>';
  const bad = await withResult({ ...answer(), size: markup });
  emptyLine(bad, 'a size that is markup is no result');
  assert.equal(bad.doc.querySelector('img'), null);
  const body = answer();
  const s = await withResult({ ...body, checks: body.checks.map((c) => ({ ...c, label: markup, question: markup })) });
  assert.equal(s.fold()?.textContent, GAPS);
  assert.equal(s.doc.querySelector('img'), null);
});

test('a result, checking and re-checking leave Send on and give the add-on no say in a send', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait();
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
  assert.equal(s.handle.beforeSend, undefined);
  assert.equal(s.handle.transformSend, undefined);
});

// ── the stylesheet (chat-shell.css, the mock's classes) ──
/** chat-shell.css split into its plain rules and the rules inside `@media (pointer:coarse)`. */
function cssParts(file = '../ui/public/chat/chat-shell.css') {
  const css = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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

/** Every declaration the base rules give a selector ending in `last` (a comma list counts each of its selectors). */
const ending = (rules, last) => rules.filter((r) => r.sel.split(',').some((x) => last.test(x.trim()))).flatMap((r) => r.body.split(';').filter(Boolean));

test('the result\'s rules: the size words give way first, the head, the chevron and "checking…" never shrink', () => {
  const { base } = cssParts();
  const wants = (last, wanted) => {
    const got = ending(base, last);
    for (const d of wanted) assert.ok(got.includes(d), `${last} { ${d} } — has: ${got.join('; ') || 'no rule'}`);
  };
  wants(/\.ask-guide-fold$/, ['align-self:center', 'flex:0 1 auto', 'min-width:0', 'overflow:hidden']);
  wants(/\.ask-guide-fold[^,]* \.plan-fold-text$/, ['display:flex', 'min-width:0', 'overflow:hidden']);
  wants(/\.ask-guide-sum$/, ['display:flex', 'min-width:0', 'overflow:hidden']);
  wants(/\.ask-guide-head$/, ['flex:none', 'color:var(--ink)']);
  wants(/\.ask-guide-rest$/, ['min-width:0', 'overflow:hidden', 'text-overflow:ellipsis']);
  wants(/\.ask-guide-q$/, ['flex:none']);
  wants(/\.ask-guide-chev$/, ['flex:none']);
  wants(/\[aria-expanded="?true"?\][^,]* \.ask-guide-chev$/, ['transform:rotate(180deg)']);
});

test('the fold sits centred on the line: its align-self wins over .plan-fold, whose stylesheet loads later', () => {
  const { doc } = page();
  const line = doc.createElement('div');
  line.className = 'ask-guide';
  const b = doc.createElement('button');
  b.className = 'btn plan-fold ask-guide-fold';
  line.append(b);
  doc.querySelector('.ask-composer-box').append(line);
  const loaded = JSON.parse(readFileSync(new URL('../ui/public/parts.json', import.meta.url), 'utf8')).css
    .filter((f) => f === 'chat/chat-shell.css' || f === 'shape/shape-it.css');
  assert.equal(loaded.length, 2);
  const weight = (sel) => (sel.match(/#[\w-]+/g) || []).length * 10000
    + (sel.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+/g) || []).length * 100 + (sel.match(/(^|[\s>+~])[a-z][\w-]*/g) || []).length;
  const matches = (sel) => { try { return b.matches(sel); } catch { return false; } };
  let won = null;
  for (const r of loaded.flatMap((f) => cssParts(`../ui/public/${f}`).base)) {
    const value = r.body.split(';').find((d) => d.startsWith('align-self:'))?.slice('align-self:'.length);
    if (!value) continue;
    for (const sel of r.sel.split(',').map((x) => x.trim()).filter(matches)) {
      if (!won || weight(sel) >= won.weight) won = { weight: weight(sel), value };
    }
  }
  assert.equal(won?.value, 'center');
});

test('app.js installs Guide once, after the role picker and before the panel, and refreshes it after a Models save', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{[^}]*\binstallGuideLine\b[^}]*\} from '\.\/chat\/guide-line\.mjs';/);
  assert.match(app, /import \{[^}]*\brefreshGuideLine\b[^}]*\} from '\.\/chat\/guide-line\.mjs';/);
  // The check's two dependencies (D2): the role a send carries now, and the app's unref'd timers.
  const calls = [...app.matchAll(/\binstallGuideLine\(\{ intent: chatIntent, role: \(\) => chatRole\.role\(\), timers: chatHomeTimers \}\)/g)];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].index > app.indexOf('installRolePicker({ intent: chatIntent })'), 'after the role picker');
  assert.ok(calls[0].index < app.indexOf('askPanel = createAskPanel('), 'before createAskPanel');
  assert.match(app, /\brefreshGuideLine\(\)/);
});

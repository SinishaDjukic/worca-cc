// test/ui-chat-guide-line.test.mjs — the composer's Guide switch and Guide line (ui/public/chat/guide-line.mjs, a
// CONTRACT §2 composer add-on registered after the role picker). With the shaperSmallRuns flag on and the Shaper pin set
// the lead row reads pin, role picker, "Guide" switch, and one line of fixed height sits between the field and the bar:
// the first-time offer while the prompt is empty, else nothing. The prefs and the model's name are read once per mount
// (GET /api/shape/guide). With the flag off or no Shaper pin there is no switch, no line and no request. It never takes,
// holds or rewords a send.
// The check: 2 seconds after the person types a changed prompt of 12 or more characters, one POST
// /api/shape/guide/check (never on send, one in flight, a stale answer dropped). The line reads "Checking your prompt…",
// then the result: a fold button "Prompt 2/5 · 3 gaps", or with no gap the size in words. A failed check says so with one
// action: "Try again", or "Open Models" when Guide has no model. Each new result is spoken once through ctx.announce.
// Write it out: with a gap open the line has one quiet "Write it out"; it reads "Writing it out…" with "Stop", then
// "Guide filled 4 gaps · check them" with the size words and "Undo", which exists until the first edit.
// Every test injects the timer, the check and the write, so nothing waits and no route is called.
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
import {
  GUIDE_CHECK_IDS, GUIDE_CHECK_LABELS, GUIDE_DEFAULT_QUESTIONS, GUIDE_PROMPT_MAX, GUIDE_SIZES,
} from '../src/shared/prompt-check/assessment.mjs';
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

/** The write as a spy, like checker(): it answers only when the test says so and ignores the signal on purpose. */
function writer() {
  const calls = [];
  const write = (body, opts = {}) => {
    const d = deferred();
    calls.push({ body, signal: opts.signal, resolve: d.resolve });
    return d.promise;
  };
  return { calls, write };
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
  timers = manualTimers(), check = null, role = null, before = null, write = null } = {}) {
  const p = page({ bar });
  p.input.value = value;
  if (before) before(p, timers);   // listeners that must be in place before the add-ons mount
  const checks = checker();
  const writes = writer();
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
    write: write || writes.write,
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
  const act = () => p.doc.querySelector('.ask-guide .ask-guide-act');
  /** What Guide announced: the shared spy also hears the intent chip say "Shaper" when the pin is set. */
  const spoken = () => p.said.filter((t) => t !== 'Shaper');
  /** The line's Write it out, Stop or Undo button. */
  const doBtn = () => p.doc.querySelector('.ask-guide .ask-guide-do');
  return { ...p, state, calls, stored, intent, intentHandle, ctl, handle, setFlag, shaper, timers, checks: checks.calls, wait, reply, refuse, fold, quiet, act, spoken, writes: writes.calls, doBtn };
}

const PROMPT = 'Export runs as CSV';
const LONGER = 'Export runs as CSV or JSON';
const CHECKING = 'Checking your prompt…';
const GAPS = 'Prompt 2/5 · 3 gaps';
const FAIL = 'Guide is not answering right now.';
const NO_MODEL = 'Guide has no model to run on.';
const SPOKEN = 'Prompt 2 of 5, 3 gaps';
const MODELS = '#models/jobs/helpers';

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
  // Writing it out, and written out: still the same element at the same height.
  await press(s, WRITE);
  assert.equal(s.text(), WRITING);
  assert.equal(height(), '33px', 'writing it out');
  assert.equal(s.line(), line, 'writing: the same element');
  await land(s, 0, written(s.input.value));
  assert.equal(s.doBtn()?.textContent, 'Undo');
  assert.equal(height(), '33px', 'written out');
  assert.equal(s.line(), line, 'written: the same element');
  // Both failures: still the same element at the same height.
  for (const [n, code, words, state] of [[1, 'GUIDE_MODEL_FAILED', FAIL, 'failed'], [2, 'GUIDE_NO_MODEL', NO_MODEL, 'no-model']]) {
    s.type(`${PROMPT} ${n}`);
    await s.wait();
    await s.refuse(n, code);
    assert.equal(s.text(), words, state);
    assert.equal(height(), '33px', state);
    assert.equal(s.line(), line, `${state}: the same element`);
  }
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

test('lineState, first match over writing, written, result, checking, failure, offer and empty (off is off)', () => {
  // `base` is offer-eligible: Guide on, the offer unseen, the prompt empty.
  const base = { on: true, offerSeen: false, offerGone: false, prompt: '', result: null, checking: false, failure: null, writing: false, written: null };
  const result = answer();
  const typed = { prompt: PROMPT };
  const done = { n: 4, size: 'large' };
  for (const [row, over, kind, more = {}] of [
    ['writing it out', { writing: true, written: done, result, checking: true, failure: 'failed' }, 'writing'],
    ['off outranks everything', { on: false, writing: true, written: done, result, checking: true, failure: 'failed' }, 'off'],
    ['writing it out over the offer', { writing: true }, 'writing'],
    ['written over result, checking and failure', { ...typed, written: done, result, checking: true, failure: 'failed' }, 'written'],
    ['written over the offer', { written: done }, 'written'],
    ['result over checking and failure', { ...typed, result, checking: true, failure: 'failed' }, 'result', { recheck: true }],
    ['result over failure', { ...typed, result, failure: 'failed' }, 'result', { recheck: false }],
    ['a result alone', { ...typed, result }, 'result', { recheck: false }],
    ['result over the offer', { result }, 'result', { recheck: false }],
    ['checking over failure', { ...typed, checking: true, failure: 'failed' }, 'checking'],
    ['checking over the offer', { checking: true }, 'checking'],
    ['failure over the offer', { failure: 'failed' }, 'failure', { failure: 'failed' }],
    ['no model over the offer', { failure: 'no-model' }, 'failure', { failure: 'no-model' }],
    ['failure with a typed prompt', { ...typed, failure: 'failed' }, 'failure', { failure: 'failed' }],
    ['the offer', {}, 'offer'],
    ['no failure given at all', { failure: undefined }, 'offer'],
    ['nothing: the offer seen', { offerSeen: true }, 'empty'],
    ['nothing: the offer gone', { offerGone: true }, 'empty'],
    ['nothing: a typed prompt', typed, 'empty'],
  ]) {
    const got = guide.lineState({ ...base, ...over });
    assert.equal(got.kind, kind, row);
    for (const [key, value] of Object.entries(more)) assert.equal(got[key], value, `${row}: ${key}`);
  }
  assert.deepEqual(guide.lineState({ ...base, ...typed, result }).words, guide.resultWords(result));
  assert.deepEqual(guide.lineState({ ...base, ...typed, result, written: done }).words, guide.filledWords(4, 'large'));
});

test('lineState: a result offers the write only while a gap is open', () => {
  const base = { on: true, offerSeen: true, offerGone: false, prompt: PROMPT, checking: false };
  for (const [body, write] of [
    [answer(0), true], [answer(2), true], [answer(4, 'small'), true],
    [answer(5, 'large'), false], [answer(5, 'medium'), false], [answer(5, 'small'), false],
  ]) {
    assert.equal(guide.lineState({ ...base, result: body }).write, write, JSON.stringify(guide.resultWords(body)));
    assert.equal(guide.lineState({ ...base, result: body, checking: true }).write, write, 'the same while it is checked again');
  }
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

// ── the failure words and which line a code gets ──
test('failureKind maps every route code and client code: no model, nothing, or "failed"', () => {
  const wanted = { GUIDE_NO_MODEL: 'no-model', GUIDE_OFF: null, GUIDE_SUPERSEDED: null, ABORTED: null };
  const codes = [...ROUTE_CODES.map(([code]) => code), 'NETWORK', 'BAD_REPLY', 'ABORTED', 'SOMETHING_NEW'];
  assert.equal(codes.length, 14);
  for (const code of codes) assert.equal(guide.failureKind(code), Object.hasOwn(wanted, code) ? wanted[code] : 'failed', code);
});

test('the failure words, their actions and the Models address are the module\'s constants', () => {
  assert.equal(guide.FAIL_TEXT, FAIL);
  assert.equal(guide.NO_MODEL_TEXT, NO_MODEL);
  assert.equal(guide.TRY_AGAIN, 'Try again');
  assert.equal(guide.OPEN_MODELS, 'Open Models');
  assert.equal(guide.MODELS_HREF, MODELS);
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
  assert.equal(s.line().textContent, `${GAPS}Write it out`, 'the fold and Write it out, nothing else on the line');
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
  const rows = s.doc.querySelector('.ask-guide-rows');
  assert.ok(rows, 'the rows region');
  assert.equal(rows.hidden, true, 'shut again');
  assert.equal(s.line().nextElementSibling, rows, 'the rows sit right under the line');
  assert.ok(rows.nextElementSibling.matches('.ask-composer-row[data-bar="compact"]'), 'and right before the bar');
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
  assert.equal(s.line().textContent, `${GAPS}Write it out`);
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

/** The line a `FAILURES` row ends in: `[sentence, action]`, or null for an empty line (Guide off elsewhere). */
const failureLine = (name) => {
  if (name === 'GUIDE_OFF') return null;
  return name === 'GUIDE_NO_MODEL' ? [NO_MODEL, 'Open Models'] : [FAIL, 'Try again'];
};

/** The failure line is exactly its words and its one quiet button; with `wanted` null the line is empty. */
function failedLine(s, wanted, why) {
  if (!wanted) { emptyLine(s, why); assert.equal(s.act(), null, why); return; }
  const [words, label] = wanted;
  assert.equal(s.text(), words, why);
  const b = s.act();
  assert.ok(b, `${why}: the action`);
  assert.ok(b.matches('button.btn.btn-sm.btn-quiet.ask-guide-act[type="button"]'), `${why}: the app's quiet small button`);
  assert.equal(b.textContent, label, why);
  assert.equal(b.disabled, false, why);
  assert.deepEqual([...s.line().children], [s.line().querySelector('.ask-guide-t'), b], `${why}: the words, then the action, and nothing else`);
}

test('a failed first check shows its line and its one action, and never sticks at "Checking your prompt…"', async () => {
  for (const [name, failure] of FAILURES) {
    const s = setup();
    await s.shaper();
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.text(), CHECKING, name);
    s.checks[0].resolve(failure);
    await settle();
    failedLine(s, failureLine(name), name);
    s.type(PROMPT);
    await s.wait();
    assert.equal(s.checks.length, 1, `${name}: unchanged text is not asked again`);
    failedLine(s, failureLine(name), `${name}, after the same text`);
    s.handle.destroy();
  }
});

test('a failed re-check shows the failure with no "checking…" and no older result', async () => {
  for (const [name, failure] of FAILURES) {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    assert.ok(s.quiet(), name);
    s.checks[1].resolve(failure);
    await settle();
    failedLine(s, failureLine(name), name);
    assert.equal(s.quiet(), null, name);
    assert.equal(s.fold(), null, name);
    s.handle.destroy();
  }
});

test('the next check after a failure reads "Checking your prompt…" with no action, and its answer replaces the failure', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  await s.refuse(0, 'GUIDE_MODEL_FAILED');
  assert.equal(s.text(), FAIL);
  s.type(LONGER);
  await s.wait();
  assert.equal(s.text(), CHECKING, 'checking outranks the failure');
  assert.equal(s.act(), null);
  await s.reply(1);
  assert.equal(s.fold()?.textContent, GAPS);
  assert.equal(s.act(), null);
  assert.equal(s.line().textContent, `${GAPS}Write it out`, 'nothing of the failure stays');
});

test('model text is set as text: markup in a reply creates no element', async () => {
  const markup = '<img src=x onerror=alert(1)>';
  const bad = await withResult({ ...answer(), size: markup });
  failedLine(bad, [FAIL, 'Try again'], 'a size that is markup is no result');
  assert.equal(bad.doc.querySelector('img'), null);
  const body = answer();
  const s = await withResult({ ...body, checks: body.checks.map((c) => ({ ...c, label: markup, question: markup })) });
  assert.equal(s.fold()?.textContent, GAPS);
  assert.equal(s.doc.querySelector('img'), null);
});

// ── the failure line: its title, Try again, Open Models, and what clears it ──
/** A Shaper composer showing the failure line for one check of PROMPT that answered `code`. */
async function withFailure(code = 'GUIDE_MODEL_FAILED', opts = {}) {
  const s = setup(opts);
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  await s.refuse(0, code);
  assert.equal(s.text(), code === 'GUIDE_NO_MODEL' ? NO_MODEL : FAIL, `the ${code} line`);
  assert.ok(s.act(), `the ${code} action`);
  return s;
}

test('a failure sentence carries its own title, and no other state of the words has one', async () => {
  for (const [code, words] of [['GUIDE_MODEL_FAILED', FAIL], ['GUIDE_NO_MODEL', NO_MODEL]]) {
    const s = setup();
    await s.shaper();
    const span = s.line().querySelector('.ask-guide-t');
    assert.equal(span.hasAttribute('title'), false, 'the offer');
    s.type(PROMPT);
    await s.wait();
    assert.equal(span.hasAttribute('title'), false, 'checking');
    await s.refuse(0, code);
    assert.equal(s.line().querySelector('.ask-guide-t'), span);
    assert.equal(span.getAttribute('title'), words);
    assert.equal(s.line().title, 'Sending works as it is.', 'the line\'s own title stays');
    s.type(LONGER);
    await s.wait();
    assert.equal(span.hasAttribute('title'), false, 'checking again');
    await s.reply(1);
    assert.equal(span.hasAttribute('title'), false, 'a result');
    s.type(PROMPT);
    await s.wait();
    await s.refuse(2, code);
    assert.equal(span.getAttribute('title'), words, 'failed again');
    s.type('Export');
    await settle();
    assert.equal(span.textContent, '');
    assert.equal(span.hasAttribute('title'), false, 'empty');
    s.handle.destroy();
  }
});

test('Try again makes exactly one new check call, at once, and returns focus to the prompt', async () => {
  const s = await withFailure('GUIDE_MODEL_FAILED', { value: '', role: 'product' });
  const b = s.act();
  b.focus();
  assert.equal(s.doc.activeElement, b);
  b.click();
  b.click();                           // a second click before the check resolves
  assert.equal(s.checks.length, 2, 'one new call, with no pause');
  assert.deepEqual(s.checks[1].body, { prompt: PROMPT, role: 'product' });
  assert.equal(s.checks[1].signal.aborted, false);
  assert.equal(s.doc.activeElement, s.input, 'focus is in the prompt field');
  assert.equal(s.text(), CHECKING);
  assert.equal(s.act(), null, 'the button left the line');
  await s.wait(5000);
  assert.equal(s.checks.length, 2, 'and nothing more later');
  await s.reply(1);
  assert.equal(s.fold()?.textContent, GAPS);
});

test('Try again that fails again shows the same calm line, and its button makes one more call', async () => {
  const s = await withFailure('GUIDE_COST_LIMIT');
  s.act().click();
  assert.equal(s.checks.length, 2);
  await s.refuse(1, 'GUIDE_BUSY');
  assert.equal(s.text(), FAIL);
  assert.equal(s.act()?.textContent, 'Try again');
  s.act().click();
  assert.equal(s.checks.length, 3);
});

test('Try again during the pause after an edit checks the new text once: the pause is cleared', async () => {
  const s = await withFailure();
  s.type(`  ${LONGER}  `);
  await s.wait(500);
  assert.equal(s.act()?.textContent, 'Try again', 'the failure stays during the pause');
  s.act().click();
  assert.equal(s.checks.length, 2);
  assert.equal(s.checks[1].body.prompt, LONGER, 'the trimmed text the field holds');
  await s.wait(5000);
  assert.equal(s.checks.length, 2);
});

test('a Try again button no longer shown makes no call: Guide off', async () => {
  const s = await withFailure();
  const b = s.act();
  s.swInput().click();
  await settle();
  assert.equal(s.line(), null);
  b.click();
  await s.wait(3000);
  assert.equal(s.checks.length, 1);
});

test('Open Models goes to #models/jobs/helpers and starts no check', async () => {
  const s = await withFailure('GUIDE_NO_MODEL');
  assert.equal(s.act().textContent, 'Open Models');
  assert.equal(s.win.location.hash, '');
  s.act().click();
  assert.equal(s.win.location.hash, MODELS);
  await s.wait(5000);
  assert.equal(s.checks.length, 1);
});

test('a Models save that brings a model drops the no-model line; only the next typing checks again', async () => {
  const s = await withFailure('GUIDE_NO_MODEL');
  s.ctl.refresh();
  await settle();
  assert.equal(s.calls.load, 2);
  assert.equal(s.text(), '');
  assert.equal(s.act(), null);
  await s.wait(5000);
  assert.equal(s.checks.length, 1, 'no check starts by itself');
  s.type(PROMPT);
  await s.wait();
  assert.equal(s.checks.length, 2, 'the same text is asked again');
});

test('a read that still has no model keeps the no-model line, and any read keeps a "not answering" line', async () => {
  const still = await withFailure('GUIDE_NO_MODEL', { load: () => Promise.resolve({ ...PREFS, model: null }) });
  still.ctl.refresh();
  await settle();
  assert.equal(still.text(), NO_MODEL);
  assert.equal(still.act()?.textContent, 'Open Models');
  const failed = await withFailure('GUIDE_MODEL_FAILED');
  failed.ctl.refresh();
  await settle();
  assert.equal(failed.text(), FAIL);
  assert.equal(failed.act()?.textContent, 'Try again');
});

test('a short prompt, a send and Guide off each clear the failure', async () => {
  const short = await withFailure();
  short.type('Export');
  await settle();
  emptyLine(short, 'a short prompt');
  assert.equal(short.act(), null);

  const sent = await withFailure('GUIDE_NO_MODEL');
  sent.intentHandle.transformSend(sent.input.value);
  sent.handle.update(null);
  await settle();
  assert.equal(sent.act(), null, 'a send');
  assert.doesNotMatch(sent.line()?.textContent ?? '', /not answering|no model/i);

  const off = await withFailure();
  off.swInput().click();
  await settle();
  assert.equal(off.line(), null, 'Guide off removes the line');
  off.swInput().click();
  await settle();
  emptyLine(off, 'Guide on again');
  assert.equal(off.act(), null);
});

test('the failure line has no cross, no red or amber and no toast, and is no live region', async () => {
  const BANNED = /(^|-)(danger|error|warn|red|amber|toast)(-|$)/;
  for (const code of ['GUIDE_MODEL_FAILED', 'GUIDE_NO_MODEL']) {
    const s = await withFailure(code);
    const all = [s.line(), ...s.line().querySelectorAll('*')];
    assert.equal(s.line().querySelectorAll('svg').length, 0, `${code}: no icon`);
    assert.doesNotMatch(s.line().textContent, /[×✕✖✗✘]/, `${code}: no cross character`);
    for (const el of all) {
      assert.deepEqual([...el.classList].filter((c) => BANNED.test(c)), [], `${code}: ${el.outerHTML}`);
      assert.equal(el.getAttribute('style'), null, `${code}: no inline colour`);
      assert.equal(el.hasAttribute('aria-live'), false, `${code}: no aria-live`);
      assert.ok(!['status', 'alert'].includes(el.getAttribute('role')), `${code}: no status or alert role`);
    }
    assert.equal(s.doc.querySelectorAll('.toast, [class*="toast"], [id*="toast"], [role="alert"]').length, 0, `${code}: no toast`);
    assert.equal(s.doc.querySelector('.ask-send').disabled, false, `${code}: Send stays on`);
    assert.equal(s.handle.beforeSend, undefined);
    assert.equal(s.handle.transformSend, undefined);
    s.handle.destroy();
  }
});

// ── the announcement: each new result once, through the composer's announce ──
test('resultSpeech reads n/5 as "n of 5" and the dot as a comma; null for a body that is no result', () => {
  for (const [body, words] of [
    [answer(2), SPOKEN], [answer(2, 'small'), SPOKEN], [answer(4), 'Prompt 4 of 5, 1 gap'],
    [answer(5, 'large'), 'Prompt 5 of 5, Large: several runs'], [answer(5, 'medium'), 'Prompt 5 of 5, Medium: a few runs'],
    [answer(5, 'small'), 'Clear enough, Small: one run'],
  ]) assert.equal(guide.resultSpeech(body), words);
  for (const body of [null, undefined, {}, { ...answer(), size: '<img src=x onerror=alert(1)>' }]) assert.equal(guide.resultSpeech(body), null);
});

test('announce: a new result once, the same result again never, a changed result once more', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  assert.deepEqual(s.spoken(), [], 'checking says nothing');
  await s.reply(0);
  assert.deepEqual(s.spoken(), [SPOKEN]);
  s.handle.update(null);
  s.handle.update(null);
  await settle();
  assert.deepEqual(s.spoken(), [SPOKEN], 'a repaint says nothing');
  s.type(LONGER);
  await s.wait();
  await s.reply(1);
  assert.deepEqual(s.spoken(), [SPOKEN], 'the same result again');
  s.type(PROMPT);
  await s.wait();
  await s.reply(2, answer(2, 'small', 'plain'));
  assert.deepEqual(s.spoken(), [SPOKEN], 'other labels and size, the same words');
  s.type(LONGER);
  await s.wait();
  await s.reply(3, answer(4));
  assert.deepEqual(s.spoken(), [SPOKEN, 'Prompt 4 of 5, 1 gap']);
});

test('R-qa-5 example: a re-check that returns the same "Prompt 3/5 · 2 gaps" makes no second announcement', async () => {
  const s = await withResult(answer(3));
  assert.equal(s.fold()?.textContent, 'Prompt 3/5 · 2 gaps');
  assert.deepEqual(s.spoken(), ['Prompt 3 of 5, 2 gaps']);
  s.type(LONGER);
  await s.wait();
  await s.reply(1, answer(3));
  assert.equal(s.fold()?.textContent, 'Prompt 3/5 · 2 gaps');
  assert.equal(s.spoken().length, 1);
});

test('R-ux-3 example: a re-check keeps "Prompt 3/5 · 2 gaps" in place with "checking…" after it', async () => {
  const s = await withResult(answer(3));
  const b = s.fold();
  s.type(LONGER);
  await s.wait();
  assert.equal(s.fold(), b);
  assert.equal(b.textContent, 'Prompt 3/5 · 2 gaps');
  assert.equal(b.nextElementSibling, s.quiet());
  assert.equal(s.quiet()?.textContent, 'checking…');
});

test('announce: failure, checking and an aborted re-check say nothing; a result after a failure is spoken again', async () => {
  const first = await withFailure();
  assert.deepEqual(first.spoken(), [], 'a failure is not spoken');
  const noModel = await withFailure('GUIDE_NO_MODEL');
  assert.deepEqual(noModel.spoken(), []);
  for (const code of ['ABORTED', 'GUIDE_SUPERSEDED']) {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    await s.refuse(1, code);
    assert.deepEqual(s.spoken(), [SPOKEN], code);
    s.type(LONGER);
    await s.wait();
    await s.reply(2);
    assert.deepEqual(s.spoken(), [SPOKEN], `${code}, then the same result: still the shown words`);
    s.handle.destroy();
  }
  for (const failure of [{ ok: false, code: 'GUIDE_MODEL_FAILED' }, { ok: false, code: 'GUIDE_NO_MODEL' }, { ok: true, check: {} }]) {
    const s = await withResult();
    s.type(LONGER);
    await s.wait();
    s.checks[1].resolve(failure);
    await settle();
    assert.deepEqual(s.spoken(), [SPOKEN], 'the failed re-check says nothing');
    s.type(PROMPT);
    await s.wait();
    await s.reply(2);
    assert.deepEqual(s.spoken(), [SPOKEN, SPOKEN], `after ${failure.code || 'a body that is no result'} the result is new`);
    s.handle.destroy();
  }
});

test('announce: a result after a short prompt or a send is new, and is spoken again', async () => {
  for (const [name, clear] of [
    ['a short prompt', (s) => s.type('Export')],
    ['a send', (s) => { s.intentHandle.transformSend(s.input.value); s.handle.update(null); }],
  ]) {
    const s = await withResult();
    clear(s);
    await settle();
    s.type(PROMPT);
    await s.wait();
    await s.reply(1);
    assert.deepEqual(s.spoken(), [SPOKEN, SPOKEN], name);
    s.handle.destroy();
  }
});

test('announce: an answer for text the field no longer holds is not spoken', async () => {
  const s = setup();
  await s.shaper();
  s.type(PROMPT);
  await s.wait();
  s.input.value = LONGER;              // a recall, a code write: no input event
  await s.reply(0, answer(4));
  assert.deepEqual(s.spoken(), []);
  s.type(LONGER);
  await s.wait();
  await s.reply(1);
  assert.deepEqual(s.spoken(), [SPOKEN], 'the control: the answer that is shown is spoken');
});

test('a result, checking, re-checking, writing it out and written out leave Send on and give the add-on no say in a send', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait();
  const free = (why) => {
    assert.equal(s.doc.querySelector('.ask-send').disabled, false, why);
    assert.equal(s.handle.beforeSend, undefined, why);
    assert.equal(s.handle.transformSend, undefined, why);
  };
  free('re-checking');
  await press(s, WRITE);
  assert.equal(s.text(), WRITING);
  free('writing it out');
  await land(s, 0, written(LONGER));
  assert.equal(s.doBtn()?.textContent, 'Undo');
  free('written out');
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

test('Guide\'s rules name no red, amber, danger or warning token', () => {
  const { base, coarse } = cssParts();
  const rules = [...base, ...coarse].filter((r) => r.sel.includes('.ask-guide'));
  assert.ok(rules.length, 'the stylesheet has Guide rules');
  for (const r of rules) assert.doesNotMatch(r.body, /--(red|amber|danger|warn)/, r.sel);
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

// ── slice 7: the check rows and Add ──
// The result fold opens onto the five checks, shut by default and opened only by the person (remembered per person). An
// open gap has the hollow mark and its Add. Add writes "<question>: <answer>" into the prompt, with the question the row
// shows, without its closing question mark; a row that shows only its label (no question, or a default one) writes the
// label. The row is covered at once. While an Add field is open, results are held.
const XSS = '<img src=x onerror=alert(1)>';
const TEAM = 'people on the team';
const SIZE_SMALL = 'Clear enough · Small: one run';
const THREE_OF_FIVE = 'Prompt 3/5 · 2 gaps';
/** The model's own questions. `done` has none of its own, so the route fills in the default one. */
const MODEL_QUESTIONS = Object.freeze({
  who: 'Who receives the emails?', what: 'What lands in their inbox?', trigger: 'A reset, a sign-up, a schedule?',
  limits: 'How many emails a day at most?',
});

/** The check route's body for a plain-register lead (Product): by default "What starts it" and "Limits" are covered. */
function product({ covered = ['trigger', 'limits'], questions = {}, size = 'large' } = {}) {
  const checks = GUIDE_CHECK_IDS.map((id) => {
    const met = covered.includes(id);
    const asked = Object.hasOwn(questions, id) ? questions[id] : MODEL_QUESTIONS[id] ?? GUIDE_DEFAULT_QUESTIONS.plain[id];
    return { id, label: GUIDE_CHECK_LABELS.plain[id], covered: met, question: met ? '' : asked };
  });
  return { register: 'plain', size, checks, model: { id: 'claude-haiku-5-5', label: 'Haiku 5.5' } };
}

const rowsEl = (s) => s.doc.querySelector('.ask-guide-rows');
const rowOf = (s, id) => rowsEl(s)?.querySelector(`[data-check="${id}"]`) ?? null;
const markOf = (row) => row.querySelector(':scope > .plan-check-mark');
const detailOf = (row) => row.querySelector('.plan-check-detail');
const addBtn = (s, id) => rowOf(s, id)?.querySelector(':scope > button.btn-quiet') ?? null;
const field = (s) => s.doc.querySelector('.ask-guide-ans input');
const fieldCheck = (s) => field(s)?.closest('[data-check]')?.dataset.check ?? null;
const fields = (s) => s.doc.querySelectorAll('.ask-guide-ans').length;
const rowsSaves = (s) => s.calls.save.filter((p) => 'rowsOpen' in p);

/** The rows are there, in the state `open`, and the fold says so. */
function assertRows(s, open, why = '') {
  assert.ok(rowsEl(s), `${why}: the rows region`);
  assert.equal(rowsEl(s).hidden, !open, `${why}: ${open ? 'open' : 'shut'}`);
  assert.equal(s.fold()?.getAttribute('aria-expanded'), String(open), `${why}: aria-expanded`);
}

/** A result on the line with its rows opened by a click on the fold. */
async function withRows(body = product(), opts = {}) {
  const s = await withResult(body, opts);
  s.fold().click();
  await settle();
  assertRows(s, true, 'after a click on the fold');
  return s;
}

/** The person activates a gap row's Add; returns the field that opens. */
async function openAdd(s, id) {
  const b = addBtn(s, id);
  assert.ok(b, `the Add on "${id}"`);
  b.focus();
  b.click();
  await settle();
  assert.ok(field(s), `a field after Add on "${id}"`);
  return field(s);
}

/** The person types in the open Add field. */
function typeAnswer(s, value) {
  const input = field(s);
  assert.ok(input, 'an open Add field');
  input.value = value;
  input.dispatchEvent(new s.win.Event('input', { bubbles: true }));
}

/** A key in the open Add field; returns the event. */
function pressIn(s, init) {
  const e = new s.win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  assert.ok(field(s), 'an open Add field');
  field(s).dispatchEvent(e);
  return e;
}

/** Type an answer into the open field and press Enter. */
async function answerWith(s, value) {
  typeAnswer(s, value);
  pressIn(s, { key: 'Enter' });
  await settle();
}

const escape = async (s) => { const e = pressIn(s, { key: 'Escape' }); await settle(); return e; };

/** Count the calls of the composer's ctx.focus (which focuses the prompt field). */
function focusSpy(s) {
  let n = 0;
  const real = s.ctx.focus;
  s.ctx.focus = () => { n += 1; real(); };
  return () => n;
}

/** An open Add field on "Who is it for" while the check of LONGER (call 1) is still out. */
async function fieldOpenMidCheck(opts = {}) {
  const s = await withRows(product(), opts);
  s.type(LONGER);
  await s.wait();
  assert.equal(s.checks.length, 2, 'the re-check is out');
  await openAdd(s, 'who');
  typeAnswer(s, 'people on');
  return s;
}

// ── the pure helpers ──
test('slice 7: the Add words, and each Add button\'s own name from its label', () => {
  assert.equal(guide.ADD_TEXT, 'Add');
  assert.equal(guide.ADD_PLACEHOLDER, 'Your answer');
  assert.equal(guide.addName('Who is it for'), 'Add: who is it for');
  assert.equal(guide.addName('Acceptance checks'), 'Add: acceptance checks');
});

test('shownQuestion: a question shows only where it adds: never a default of either register, never on a covered check', () => {
  for (const id of GUIDE_CHECK_IDS) {
    for (const register of ['plain', 'technical']) {
      assert.equal(guide.shownQuestion({ id, covered: false, question: GUIDE_DEFAULT_QUESTIONS[register][id] }), '', `${register} ${id}`);
    }
    assert.equal(guide.shownQuestion({ id, covered: false, question: '' }), '', `${id}: no question`);
    assert.equal(guide.shownQuestion({ id, covered: true, question: 'Who receives the emails?' }), '', `${id}: covered`);
    assert.equal(guide.shownQuestion({ id, covered: false, question: 'Who receives the emails?' }), 'Who receives the emails?', id);
  }
});

test('addLine: "<head>: <answer>", the answer trimmed and its whitespace runs collapsed to one space', () => {
  assert.equal(guide.addLine('Who is it for', '  people  on the team '), 'Who is it for: people on the team');
  assert.equal(guide.addLine('Limits', 'ten a day,\n\tnever at night'), 'Limits: ten a day, never at night');
});

test('appendAnswer: nothing in front of an empty prompt or after a line break, else one line break; the prompt is untouched', () => {
  const line = 'Who is it for: people on the team';
  assert.equal(guide.appendAnswer('', line), line);
  assert.equal(guide.appendAnswer('Export runs\n', line), `Export runs\n${line}`);
  assert.equal(guide.appendAnswer('Export runs', line), `Export runs\n${line}`);
  assert.equal(guide.appendAnswer('Export runs  ', line), `Export runs  \n${line}`, 'trailing spaces are kept');
});

test('withAnswered: a copy with those checks covered and without a question; the input is never changed', () => {
  const body = product();
  const before = structuredClone(body);
  const got = guide.withAnswered(body, new Set(['who']));
  assert.deepEqual(body, before, 'the input is as it was');
  assert.notEqual(got, body);
  assert.deepEqual(got.checks.map((c) => [c.id, c.covered]),
    [['who', true], ['what', false], ['trigger', true], ['limits', true], ['done', false]]);
  assert.equal(got.checks[0].question, '');
  assert.equal(got.checks[0].label, 'Who is it for');
  assert.equal(got.checks[1].question, MODEL_QUESTIONS.what);
  assert.equal(got.size, body.size);
});

// ── the rows under the fold: shut by default, opened only by the person ──
test('R-ux-5: a result arrives with the rows shut, right under the line and outside it', async () => {
  const s = await withResult(product());
  assertRows(s, false, 'a new result');
  const rows = rowsEl(s);
  assert.ok(rows.matches('.ask-composer-box > div.ask-guide-rows.srows'));
  assert.equal(s.line().nextElementSibling, rows, 'right after the line');
  assert.ok(rows.nextElementSibling.matches('.ask-composer-row[data-bar="compact"]'), 'right before the bar');
  assert.equal(s.line().contains(rows), false, 'never inside the line');
  assert.equal(rows.children.length, 1);
  assert.ok(rows.firstElementChild.matches('div.plan-checks'));
  s.handle.update(null);
  await settle();
  assert.equal(s.doc.querySelectorAll('.ask-guide-rows').length, 1, 'a repaint adds no second region');
  assert.equal(s.line().nextElementSibling, rowsEl(s));
  assert.deepEqual(rowsSaves(s), [], 'a result saves nothing about the rows');
});

test('R-ux-5: a click on the fold shows the five rows and saves rowsOpen:true once; a second click shuts them and saves false', async () => {
  const s = await withResult(product());
  s.fold().click();
  await settle();
  assertRows(s, true, 'opened');
  assert.deepEqual([...rowsEl(s).querySelectorAll('[data-check]')].map((r) => r.dataset.check), [...GUIDE_CHECK_IDS], 'in the checks\' order');
  assert.deepEqual(rowsSaves(s), [{ rowsOpen: true }]);
  assert.equal(s.ctl.prefs().rowsOpen, true);
  s.handle.update(null);
  await settle();
  assert.deepEqual(rowsSaves(s), [{ rowsOpen: true }], 'a repaint saves nothing');
  s.fold().click();
  await settle();
  assertRows(s, false, 'shut');
  assert.deepEqual(rowsSaves(s), [{ rowsOpen: true }, { rowsOpen: false }]);
  assert.equal(s.ctl.prefs().rowsOpen, false);
});

test('R-ux-5: no result opens or shuts the rows by itself: a re-check keeps the person\'s choice, open or shut', async () => {
  const s = await withRows();
  s.type(LONGER);
  await s.wait();
  assertRows(s, true, 'while re-checking');
  await s.reply(1, product({ covered: [] }));
  assertRows(s, true, 'a new result');
  s.fold().click();
  await settle();
  s.type(PROMPT);
  await s.wait();
  await s.reply(2, product({ covered: ['who'] }));
  assertRows(s, false, 'a new result');
  assert.deepEqual(rowsSaves(s), [{ rowsOpen: true }, { rowsOpen: false }], 'only the two clicks saved');
});

test('R-ux-5: after a send, the next prompt\'s result arrives open', async () => {
  const s = await withRows();
  s.intentHandle.transformSend(s.input.value);
  s.input.value = '';
  s.handle.update(null);
  await settle();
  assert.equal(rowsEl(s), null, 'the send removes the rows');
  s.type(LONGER);
  await s.wait();
  assert.equal(rowsEl(s), null, 'no rows while the first check is out');
  await s.reply(1, product());
  assertRows(s, true, 'the next prompt');
});

test('R-ux-5 example: a person opens the rows once; their next prompt arrives open, and for another person on the same host they arrive shut', async () => {
  const profiles = { ada: { ...PREFS }, bob: { ...PREFS } };
  const as = (who) => ({
    load: () => Promise.resolve({ ...profiles[who] }),
    save: (patch) => { Object.assign(profiles[who], patch); return Promise.resolve({ ...profiles[who] }); },
  });
  const first = await withResult(product(), as('ada'));
  assertRows(first, false, 'the first time');
  first.fold().click();
  await settle();
  assert.equal(profiles.ada.rowsOpen, true, 'the choice is saved');
  first.handle.destroy();
  const next = await withResult(product(), as('ada'));
  assertRows(next, true, 'the same person\'s next prompt');
  const other = await withResult(product(), as('bob'));
  assertRows(other, false, 'another person');
  assert.equal(profiles.bob.rowsOpen, false);
});

test('a fresh prefs read is the only other thing that opens the rows', async () => {
  const s = await withResult(product());
  assertRows(s, false, 'as loaded');
  s.stored.rowsOpen = true;
  s.ctl.refresh();
  await settle();
  assertRows(s, true, 'after the read');
});

test('a refused rowsOpen save keeps the rows open for this composer, with nothing said', async () => {
  const s = await withRows(product(), { save: (patch) => ('rowsOpen' in patch ? Promise.reject(new Error('disk full')) : Promise.resolve({})) });
  await settle();
  assertRows(s, true, 'after the refusal');
  s.type(LONGER);
  await s.wait();
  await s.reply(1, product({ covered: ['who'] }));
  assertRows(s, true, 'the next result');
  assert.doesNotMatch(s.doc.body.textContent, /disk full/);
});

for (const [name, leave] of [
  ['"Clear enough"', async (s) => { s.type(LONGER); await s.wait(); await s.reply(1, answer(5, 'small')); }],
  ['a failure', async (s) => { s.type(LONGER); await s.wait(); await s.refuse(1, 'GUIDE_MODEL_FAILED'); }],
  ['a short prompt (the empty line)', async (s) => { s.type('Export'); await settle(); }],
  ['Guide switched off', async (s) => { s.swInput().click(); await settle(); }],
  ['the Shaper pin removed', async (s) => { s.intent.clear(); await settle(); }],
  ['the flag turned off', async (s) => { s.setFlag(false); await settle(); }],
  ['destroy()', async (s) => { s.handle.destroy(); }],
]) {
  test(`the rows exist only under a result fold: ${name} removes them and an open Add field`, async () => {
    const s = await withRows();
    await openAdd(s, 'who');
    await leave(s);
    assert.equal(rowsEl(s), null);
    assert.equal(fields(s), 0);
  });
}

// ── the rows: the hollow mark and Add for a gap, the tick and the label alone for a covered check ──
test('R-ux-5: a gap row has the hollow mark named "open", its question only where it adds, and its own Add', async () => {
  const s = await withRows();
  for (const [id, label, question] of [
    ['who', 'Who is it for', MODEL_QUESTIONS.who], ['what', 'What they get', MODEL_QUESTIONS.what], ['done', 'How you know it worked', null],
  ]) {
    const row = rowOf(s, id);
    assert.equal(row.classList.contains('ok'), false, id);
    const mark = markOf(row);
    assert.ok(mark.matches('.plan-check-mark.is-wait'), `${id}: the waiting mark`);
    assert.ok(mark.querySelector(':scope > .status-dot.is-grey-ring'), `${id}: the hollow ring`);
    assert.equal(mark.querySelector('svg'), null, `${id}: no cross`);
    assert.equal(mark.getAttribute('role'), 'img', id);
    assert.equal(mark.getAttribute('aria-label'), 'open', id);
    assert.equal(row.querySelector('.plan-check-text > .plan-check-label')?.textContent, label, id);
    if (question) assert.equal(row.querySelector('.plan-check-text > .plan-check-detail')?.textContent, question, id);
    else assert.equal(detailOf(row), null, `${id}: a default question only restates the label`);
    const b = row.lastElementChild;
    assert.ok(b.matches('button.btn.btn-sm.btn-quiet[type="button"]'), `${id}: the quiet small button`);
    assert.equal(b.textContent, 'Add', id);
    assert.equal(b.getAttribute('aria-label'), `Add: ${label.toLowerCase()}`, id);
  }
  assert.deepEqual([...rowsEl(s).querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    ['Add: who is it for', 'Add: what they get', 'Add: how you know it worked']);
  assert.equal(fields(s), 0, 'no field until Add');
});

test('a covered row has the tick named "covered" and its label only', async () => {
  const s = await withRows();
  for (const [id, label] of [['trigger', 'What starts it'], ['limits', 'Limits']]) {
    const row = rowOf(s, id);
    assert.ok(row.classList.contains('ok'), id);
    const mark = markOf(row);
    assert.equal(mark.getAttribute('role'), 'img', id);
    assert.equal(mark.getAttribute('aria-label'), 'covered', id);
    assert.equal(mark.innerHTML, icon(s.doc, 'check', 12).outerHTML, `${id}: the app's tick`);
    assert.equal(detailOf(row), null, id);
    assert.equal(row.querySelector('button, input'), null, id);
    assert.equal(row.textContent, label, id);
  }
});

test('with no role the rows carry the technical labels, and each Add is named from its own', async () => {
  const s = await withRows(answer(2));
  assert.deepEqual([...rowsEl(s).querySelectorAll('.plan-check-label')].map((e) => e.textContent),
    ['Who calls it', 'The behaviour', 'Trigger and scope', 'Constraints', 'Acceptance checks']);
  assert.deepEqual([...rowsEl(s).querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    ['Add: trigger and scope', 'Add: constraints', 'Add: acceptance checks']);
});

test('a model question that is markup shows as those characters: in the row, the field\'s name and the prompt, with no element', async () => {
  const s = await withRows(product({ questions: { who: XSS } }));
  assert.equal(detailOf(rowOf(s, 'who')).textContent, XSS);
  assert.equal(s.doc.querySelector('img'), null);
  const input = await openAdd(s, 'who');
  assert.equal(input.getAttribute('aria-label'), XSS);
  assert.equal(s.doc.querySelector('img'), null);
  await answerWith(s, TEAM);
  assert.equal(s.input.value, `${PROMPT}\n${XSS}: ${TEAM}`, 'plain text in the field');
  assert.equal(s.doc.querySelector('img'), null);
});

// ── Add ──
test('Add opens one field in place of the row\'s button, focused, named by the question', async () => {
  const s = await withRows();
  const input = await openAdd(s, 'who');
  assert.equal(s.doc.activeElement, input);
  assert.ok(input.matches('.ask-guide-ans > input.input.input-sm[type="text"]'));
  assert.equal(input.placeholder, 'Your answer');
  assert.equal(input.getAttribute('aria-label'), MODEL_QUESTIONS.who);
  assert.equal(input.value, '');
  const row = rowOf(s, 'who');
  assert.ok(row.lastElementChild.matches('span.ask-guide-ans'), 'the field ends the row');
  assert.equal(row.querySelectorAll('button').length, 1, 'the quiet button is gone');
  const b = row.querySelector('.ask-guide-ans > button');
  assert.ok(b.matches('button.btn.btn-sm[type="button"]'));
  assert.equal(b.classList.contains('btn-quiet'), false);
  assert.equal(b.textContent, 'Add');
  assert.equal(b.getAttribute('aria-label'), 'Add: who is it for');
  assertRows(s, true, 'opening a field');
});

test('R-po-3 example: "people on the team" on "Who is it for" joins the prompt, the line reads 3/5, and the row is covered at once', async () => {
  // The route's body when the model gave no question of its own: the row shows the label alone.
  const s = await withRows(product({ questions: { who: GUIDE_DEFAULT_QUESTIONS.plain.who } }));
  assert.equal(detailOf(rowOf(s, 'who')), null);
  assert.equal(s.fold().textContent, GAPS);
  let inputs = 0;
  s.input.addEventListener('input', () => { inputs += 1; });
  await openAdd(s, 'who');
  assert.equal(inputs, 0, 'opening the field writes nothing');
  await answerWith(s, TEAM);
  assert.equal(s.input.value, `${PROMPT}\nWho is it for: people on the team`);
  assert.equal(inputs, 1, 'one input event on the prompt field, so the composer refits and Send updates');
  assert.equal(s.fold().textContent, THREE_OF_FIVE);
  const row = rowOf(s, 'who');
  assert.ok(row.classList.contains('ok'));
  assert.equal(markOf(row).getAttribute('aria-label'), 'covered');
  assert.equal(row.textContent, 'Who is it for', 'the label only');
  assert.equal(row.querySelector('button, input'), null);
  assert.equal(s.checks.length, 1, 'covered at once: no check was needed');
  assert.deepEqual(s.spoken(), [SPOKEN], 'a local Add is not announced');
  assertRows(s, true, 'after an Add');
});

for (const [name, question, head] of [
  ['the question without its closing question mark (mock frame 9)', 'Who receives the emails?', 'Who receives the emails'],
  ['only the closing question mark goes', 'Who? Which team?', 'Who? Which team'],
  ['a question with no question mark is used as it is', 'Name the people who use it', 'Name the people who use it'],
  ['a row with a default question shows only its label, so the label', GUIDE_DEFAULT_QUESTIONS.plain.who, 'Who is it for'],
  ['the other register\'s default question is hidden too, so the label', GUIDE_DEFAULT_QUESTIONS.technical.who, 'Who is it for'],
  ['a gap with no question uses the label', '', 'Who is it for'],
]) {
  test(`R-po-3, what Add writes: ${name}`, async () => {
    const s = await withRows(product({ questions: { who: question } }));
    await openAdd(s, 'who');
    await answerWith(s, 'customers who reset a password or sign up');
    assert.equal(s.input.value, `${PROMPT}\n${head}: customers who reset a password or sign up`);
  });
}

test('the field\'s own Add button commits like Enter, with the answer trimmed to one line', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  typeAnswer(s, '  people   on the team  ');
  s.doc.querySelector('.ask-guide-ans > button').click();
  await settle();
  assert.equal(s.input.value, `${PROMPT}\nWho receives the emails: ${TEAM}`);
  assert.equal(s.fold().textContent, THREE_OF_FIVE);
});

test('the person\'s words stay byte for byte in front of the added line, and a prompt ending in a line break gets no second one', async () => {
  const typed = 'Export runs as CSV  \n\n- one file per project\n';
  const s = setup();
  await s.shaper();
  s.type(typed);
  await s.wait();
  await s.reply(0, product());
  s.fold().click();
  await settle();
  await openAdd(s, 'who');
  await answerWith(s, TEAM);
  assert.equal(s.input.value, `${typed}Who receives the emails: ${TEAM}`);
});

test('a blank answer does nothing: Enter and the button keep the field, its focus, the prompt and the line', async () => {
  const s = await withRows();
  const input = await openAdd(s, 'who');
  let inputs = 0;
  s.input.addEventListener('input', () => { inputs += 1; });
  for (const blank of ['', '   ']) {
    await answerWith(s, blank);
    assert.equal(field(s), input, `"${blank}"`);
    assert.equal(s.doc.activeElement, input);
    s.doc.querySelector('.ask-guide-ans > button').click();
    await settle();
    assert.equal(field(s), input, `"${blank}" and the button`);
  }
  assert.equal(s.input.value, PROMPT);
  assert.equal(inputs, 0);
  assert.equal(s.fold().textContent, GAPS);
});

test('a row that shows no question still names its field: the default question, else the label', async () => {
  const s = await withRows();
  assert.equal((await openAdd(s, 'done')).getAttribute('aria-label'), GUIDE_DEFAULT_QUESTIONS.plain.done);
  const bare = await withRows(product({ questions: { who: '' } }));
  assert.equal((await openAdd(bare, 'who')).getAttribute('aria-label'), 'Who is it for');
});

test('one Add field at most: opening another closes the first and drops its draft', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  typeAnswer(s, 'half a thought');
  await openAdd(s, 'what');
  assert.equal(fields(s), 1);
  assert.equal(fieldCheck(s), 'what');
  assert.ok(addBtn(s, 'who'), 'the first row has its Add back');
  assert.equal((await openAdd(s, 'who')).value, '', 'the draft was dropped');
  assert.equal(fields(s), 1);
  assert.equal(s.input.value, PROMPT, 'nothing was added');
});

test('an Add is a change of the prompt: the next pause checks the new text, and the next result starts afresh', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  await answerWith(s, TEAM);
  await escape(s);
  await s.wait();
  assert.equal(s.checks.length, 2);
  assert.equal(s.checks[1].body.prompt, `${PROMPT}\nWho receives the emails: ${TEAM}`);
  assert.equal(s.fold().textContent, THREE_OF_FIVE, 'covered stays while re-checking');
  await s.reply(1, product({ covered: ['trigger'] }));
  assert.equal(s.fold().textContent, 'Prompt 1/5 · 4 gaps', 'the new result is shown as it is');
  assert.equal(markOf(rowOf(s, 'who')).getAttribute('aria-label'), 'open');
});

// ── results are held while an Add field is open ──
test('R-po-3: a result landing while an Add field is open moves nothing, and applies after the field closes', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  await answerWith(s, TEAM);           // the field moves on to "What they get"
  typeAnswer(s, 'a CSV file');
  const input = field(s);
  await s.wait();
  assert.equal(s.checks.length, 2, 'checks keep firing while a field is open');
  const rows = rowsEl(s).innerHTML;
  await s.reply(1, product({ covered: [...GUIDE_CHECK_IDS] }));
  assert.equal(s.fold().textContent, THREE_OF_FIVE, 'the line');
  assert.equal(rowsEl(s).innerHTML, rows, 'the rows');
  assert.equal(field(s), input, 'the same input element');
  assert.equal(input.value, 'a CSV file', 'its draft');
  assert.equal(s.doc.activeElement, input, 'the focus');
  assert.equal(s.quiet(), null, 'no "checking…" left');
  assert.deepEqual(s.spoken(), [SPOKEN], 'a held result is not spoken yet');
  await escape(s);
  assert.equal(s.fold().textContent, 'Prompt 5/5 · Large: several runs');
  assert.deepEqual(s.spoken(), [SPOKEN, 'Prompt 5 of 5, Large: several runs'], 'spoken once, when applied');
  assert.equal(fields(s), 0);
});

test('R-po-3 example: a result that landed while the person typed did not move their field, and Add still covers the point', async () => {
  const s = await fieldOpenMidCheck();
  const input = field(s);
  await s.reply(1, product({ covered: [] }));
  assert.equal(field(s), input);
  assert.equal(input.value, 'people on');
  assert.equal(s.doc.activeElement, input);
  assert.equal(s.fold().textContent, GAPS);
  await answerWith(s, TEAM);
  assert.equal(s.input.value, `${LONGER}\nWho receives the emails: ${TEAM}`);
  assert.equal(s.fold().textContent, THREE_OF_FIVE);
});

test('a result held while a field is open applies when Escape closes it without an Add', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: ['who', 'what', 'trigger', 'limits'] }));
  assert.equal(s.fold().textContent, GAPS);
  await escape(s);
  assert.equal(s.fold().textContent, 'Prompt 4/5 · 1 gap');
  assert.equal(markOf(rowOf(s, 'who')).getAttribute('aria-label'), 'covered');
  assertRows(s, true, 'the held result');
});

test('a failure held while a field is open applies only after it closes', async () => {
  const s = await fieldOpenMidCheck();
  const input = field(s);
  await s.refuse(1, 'GUIDE_MODEL_FAILED');
  assert.equal(s.fold().textContent, GAPS, 'the result stays');
  assert.equal(s.act(), null);
  assert.equal(field(s), input);
  await escape(s);
  assert.equal(s.text(), FAIL);
  assert.equal(rowsEl(s), null);
});

test('of two results held while a field is open, only the later one applies', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  await answerWith(s, TEAM);
  await s.wait();
  await s.reply(1, product({ covered: ['who', 'what', 'trigger', 'limits'] }));
  await answerWith(s, 'a CSV file');
  await s.wait();
  assert.equal(s.checks.length, 3);
  await s.reply(2, product({ covered: [...GUIDE_CHECK_IDS], size: 'medium' }));
  await escape(s);
  assert.equal(s.fold().textContent, 'Prompt 5/5 · Medium: a few runs');
  assert.deepEqual(s.spoken(), [SPOKEN, 'Prompt 5 of 5, Medium: a few runs']);
});

test('a held result for text the field no longer holds is dropped, and the new text is checked', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: [...GUIDE_CHECK_IDS] }));
  const other = `${LONGER}, nightly`;
  s.input.value = other;               // a recall, a code write: no input event
  await escape(s);
  assert.equal(s.fold()?.textContent, GAPS, 'the held result is not shown');
  await s.wait();
  assert.equal(s.checks.length, 3);
  assert.equal(s.checks[2].body.prompt, other);
});

test('typing in the prompt closes the Add field and drops its draft', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  typeAnswer(s, 'half a thought');
  s.type(LONGER);
  await settle();
  assert.equal(fields(s), 0);
  assert.equal(s.input.value, LONGER, 'the draft never reaches the prompt');
  assert.equal((await openAdd(s, 'who')).value, '');
});

test('a result held while a field is open applies when the person shuts the fold, and focus stays on the fold', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: ['who', 'what', 'trigger', 'limits'] }));
  const focused = focusSpy(s);
  s.fold().focus();
  s.fold().click();
  await settle();
  assert.equal(fields(s), 0);
  assertRows(s, false, 'shut by the person');
  assert.equal(s.fold().textContent, 'Prompt 4/5 · 1 gap');
  assert.equal(s.doc.activeElement, s.fold());
  assert.equal(focused(), 0);
});

test('a send closes the Add field and applies nothing of what was held', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: [...GUIDE_CHECK_IDS] }));
  s.intentHandle.transformSend(s.input.value);
  s.input.value = '';
  s.handle.update(null);
  await settle();
  assert.equal(fields(s), 0);
  assert.equal(rowsEl(s), null);
  assert.equal(s.fold(), null);
  assert.doesNotMatch(s.line().textContent, /Prompt|checking/i);
  assert.deepEqual(s.spoken(), [SPOKEN]);
});

test('Guide switched off with a field open closes it; switched on again, no field and no held result come back', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: [...GUIDE_CHECK_IDS] }));
  s.swInput().click();
  await settle();
  assert.equal(fields(s), 0);
  assert.equal(rowsEl(s), null);
  s.swInput().click();
  await settle();
  emptyLine(s, 'Guide on again');
  assert.equal(fields(s), 0);
  assert.equal(rowsEl(s), null);
});

test('an Add that pushes the prompt over the limit clears the result: no field, no rows, focus in the prompt', async () => {
  const long = 'x'.repeat(GUIDE_PROMPT_MAX - 10);
  const s = setup();
  await s.shaper();
  s.type(long);
  await s.wait();
  await s.reply(0, product());
  s.fold().click();
  await settle();
  await openAdd(s, 'who');
  const focused = focusSpy(s);
  await answerWith(s, TEAM);
  assert.equal(s.input.value, `${long}\nWho receives the emails: ${TEAM}`, 'the answer is kept');
  assert.equal(fields(s), 0, 'no field opens on the cleared result');
  assert.equal(rowsEl(s), null);
  assert.ok(focused() >= 1, 'ctx.focus was called');
  assert.equal(s.doc.activeElement, s.input);
  await s.wait(3000);
  assert.equal(s.checks.length, 1, 'over the limit is not sent');
});

// ── the keyboard path ──
test('R-qa-3 example: Add on "Who is it for", type, Enter: the person is in the "What they get" field', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  const focused = focusSpy(s);
  await answerWith(s, TEAM);
  assert.equal(fields(s), 1);
  assert.equal(fieldCheck(s), 'what');
  assert.equal(s.doc.activeElement, field(s));
  assert.equal(field(s).value, '');
  assert.equal(focused(), 0, 'the prompt does not take the focus on the way');
});

test('Enter moves to the next open gap past the covered rows, and from the last one back to the first still open', async () => {
  const s = await withRows();
  await openAdd(s, 'what');
  await answerWith(s, 'a CSV file');
  assert.equal(fieldCheck(s), 'done', '"What starts it" and "Limits" are covered');
  await answerWith(s, 'the file opens');
  assert.equal(fieldCheck(s), 'who', 'the earlier open gap');
  assert.equal(s.doc.activeElement, field(s));
});

test('R-qa-3: with no gap left, Enter ends in the prompt field and the line says the size in words', async () => {
  const s = await withRows(product({ size: 'small' }));
  await openAdd(s, 'who');
  await answerWith(s, TEAM);
  await answerWith(s, 'a CSV file');
  const focused = focusSpy(s);
  await answerWith(s, 'the file opens');
  assert.equal(fields(s), 0);
  assert.equal(s.line().textContent, SIZE_SMALL);
  assert.equal(rowsEl(s), null);
  assert.ok(focused() >= 1, 'ctx.focus was called');
  assert.equal(s.doc.activeElement, s.input);
  assert.equal(s.input.value, [PROMPT, `Who receives the emails: ${TEAM}`, 'What lands in their inbox: a CSV file',
    'How you know it worked: the file opens'].join('\n'), 'one added line per Add');
});

for (const [name, init] of [
  ['Shift+Enter', { key: 'Enter', shiftKey: true }],
  ['an Enter that ends an IME composition', { key: 'Enter', isComposing: true }],
]) {
  test(`${name} in an Add field adds nothing and keeps the field`, async () => {
    const s = await withRows();
    const input = await openAdd(s, 'who');
    typeAnswer(s, TEAM);
    pressIn(s, init);
    await settle();
    assert.equal(s.input.value, PROMPT);
    assert.equal(field(s), input);
    assert.equal(input.value, TEAM);
    assert.equal(s.fold().textContent, GAPS);
  });
}

test('R-qa-3: Escape closes the field back to the prompt, adds nothing, and reaches no outer handler', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  typeAnswer(s, 'half a thought');
  const focused = focusSpy(s);
  let outer = 0;
  s.doc.addEventListener('keydown', () => { outer += 1; });
  const e = await escape(s);
  assert.equal(fields(s), 0);
  assert.ok(focused() >= 1, 'ctx.focus');
  assert.equal(s.doc.activeElement, s.input);
  assert.equal(e.defaultPrevented, true);
  assert.equal(outer, 0, 'propagation stopped');
  assert.equal(s.input.value, PROMPT);
  assert.ok(addBtn(s, 'who'), 'the row has its Add back');
  assertRows(s, true, 'Escape leaves the rows open');
  assert.equal((await openAdd(s, 'who')).value, '', 'the draft was dropped');
});

test('a repaint leaves the open field alone: the same element, its draft and its focus', async () => {
  const s = await withRows();
  const input = await openAdd(s, 'who');
  typeAnswer(s, 'half a thought');
  s.handle.update(null);
  s.input.dispatchEvent(new s.win.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
  s.stored.rowsOpen = true;            // what the profile holds since the click on the fold
  s.ctl.refresh();
  await settle();
  assert.equal(field(s), input);
  assert.equal(input.value, 'half a thought');
  assert.equal(s.doc.activeElement, input);
});

test('shutting the rows closes the Add field and keeps focus on the fold', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  const focused = focusSpy(s);
  s.fold().focus();
  s.fold().click();
  await settle();
  assert.equal(fields(s), 0);
  assertRows(s, false, 'shut');
  assert.equal(s.doc.activeElement, s.fold());
  assert.equal(focused(), 0);
});

/** A result on screen with the rows open, and a re-check (call 1) out. */
async function rechecking() {
  const s = await withRows();
  s.type(LONGER);
  await s.wait();
  return s;
}

test('a new result under a focused Add keeps focus on the same check\'s Add', async () => {
  const s = await rechecking();
  addBtn(s, 'who').focus();
  await s.reply(1, product({ covered: ['limits'] }));
  assert.ok(addBtn(s, 'trigger'), 'the rows differ');
  assert.equal(s.doc.activeElement, addBtn(s, 'who'));
});

test('a new result that covers the focused row moves focus to the next row\'s Add', async () => {
  const s = await rechecking();
  addBtn(s, 'who').focus();
  await s.reply(1, product({ covered: ['who', 'trigger', 'limits'] }));
  assert.equal(s.doc.activeElement, addBtn(s, 'what'));
});

for (const [name, target, body] of [
  ['the focused fold leaves the line', (s) => s.fold(), { ok: true, check: product({ covered: [...GUIDE_CHECK_IDS], size: 'small' }) }],
  ['a failure removes the focused row', (s) => addBtn(s, 'who'), { ok: false, code: 'GUIDE_MODEL_FAILED' }],
]) {
  test(`a repaint never leaves focus on the body: ${name}, so the prompt takes it`, async () => {
    const s = await rechecking();
    const focused = focusSpy(s);
    target(s).focus();
    s.checks[1].resolve(body);
    await settle();
    assert.equal(rowsEl(s), null);
    assert.ok(focused() >= 1, 'ctx.focus');
    assert.equal(s.doc.activeElement, s.input);
  });
}

test('focus that was elsewhere is never moved by a repaint of the rows', async () => {
  const s = await rechecking();
  const other = s.doc.querySelector('#elsewhere');
  other.focus();
  const focused = focusSpy(s);
  await s.reply(1, product({ covered: ['who'] }));
  assert.equal(markOf(rowOf(s, 'who')).getAttribute('aria-label'), 'covered', 'the rows were repainted');
  assert.equal(s.doc.activeElement, other);
  assert.equal(focused(), 0);
});

test('with an Add field open Send stays on and the add-on has no say in a send', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
  assert.equal(s.handle.beforeSend, undefined);
  assert.equal(s.handle.transformSend, undefined);
});

// ── the rows' stylesheet ──
test('the covered tick is --ink-2, and the rows and the Add field use tokens only', () => {
  const { base, coarse } = cssParts();
  holds(base, '.ask-guide-rows .plan-check-row.ok .plan-check-mark', ['color:var(--ink-2)']);
  const rules = [...base, ...coarse].filter((r) => /\.ask-guide-(rows|ans)/.test(r.sel));
  assert.ok(rules.some((r) => r.sel.includes('.ask-guide-ans')), 'the Add field has rules');
  for (const r of rules) assert.doesNotMatch(r.body, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, r.sel);
});

test('the rows and the Add field follow the mock\'s rules', () => {
  const { base } = cssParts();
  holds(base, '.ask-guide-rows', ['margin:0 6px', 'font-size:var(--fs-body)']);
  holds(base, '.ask-guide-ans', ['display:flex', 'gap:8px', 'flex:1 0 100%', 'padding-left:calc(var(--row-mark) + var(--row-gap))']);
  holds(base, '.ask-guide-ans > .input', ['flex:1 1 auto', 'min-width:0']);
});

test('a row with an open Add field wraps, so the field sits under its label', async () => {
  const s = await withRows();
  await openAdd(s, 'who');
  const { base } = cssParts();
  const matching = (el) => base.filter((r) => { try { return el.matches(r.sel); } catch { return false; } })
    .flatMap((r) => r.body.split(';'));
  assert.ok(matching(rowOf(s, 'who')).includes('flex-wrap:wrap'), 'the row wraps');
  assert.ok(matching(rowOf(s, 'who').querySelector('.plan-check-text')).includes('flex-basis:12em'), 'its text keeps 12em');
});

// ── Write it out, Stop and Undo ──
const WRITE = 'Write it out';
const WRITING = 'Writing it out…';
/** The person's two lines, with trailing spaces and a last line of spaces: Undo gives these exact bytes back. */
const TWO_LINES = 'Line one  \nLine two \n  ';
const WRITE_ROUTE_CODES = [
  ...ROUTE_CODES.filter(([code]) => code !== 'GUIDE_CHECK_FAILED'), ['GUIDE_BAD_GAPS', 400], ['GUIDE_WRITE_FAILED', 500],
];

/** What the write route answers for `prompt` and the gaps `ids`: the prompt, then one "(suggested)" line per gap. */
function written(prompt, ids = GUIDE_CHECK_IDS.slice(2), { register = 'technical', fill = (id) => `fill for ${id}` } = {}) {
  const lines = ids.map((id) => `${GUIDE_CHECK_LABELS[register][id]}: ${fill(id)} (suggested)`);
  return { text: `${prompt}${prompt.endsWith('\n') ? '' : '\n'}${lines.join('\n')}`, filled: [...ids] };
}
/** The person activates the line's button named `label`. */
async function press(s, label) {
  const b = s.doBtn();
  assert.equal(b?.textContent, label, `a "${label}" button on the line`);
  b.focus();
  b.click();
  await settle();
  return b;
}
/** Answer write call `n` with a written text. */
async function land(s, n, body) {
  assert.ok(s.writes[n], `write call ${n}`);
  s.writes[n].resolve({ ok: true, written: body });
  await settle();
}
const failWrite = async (s, n, code) => { s.writes[n].resolve({ ok: false, code }); await settle(); };
/** A Shaper composer showing the result of one check of `prompt`. */
async function resultFor(prompt, body = answer(), opts = {}) {
  const s = setup(opts);
  await s.shaper();
  s.type(prompt);
  await s.wait();
  await s.reply(0, body);
  return s;
}
/** A write of `prompt` that is out. */
async function midWrite(prompt = PROMPT, body = answer(), opts = {}) {
  const s = await resultFor(prompt, body, opts);
  await press(s, WRITE);
  assert.equal(s.writes.length, 1, 'one write is out');
  return s;
}
/** A landed write of `prompt`; `s.landed` is what the route answered. */
async function writtenOut(prompt = PROMPT, body = answer(), opts = {}) {
  const s = await midWrite(prompt, body, opts);
  const out = written(prompt, s.writes[0].body.gaps);
  await land(s, 0, out);
  assert.equal(s.input.value, out.text, 'the written text is in the field');
  return Object.assign(s, { landed: out });
}
/** The line is a result again, with its one "Write it out". */
function resultBack(s, words = GAPS, why = '') {
  assert.equal(s.fold()?.textContent, words, why);
  assert.equal(s.line().textContent, `${words}${WRITE}`, why);
  assert.equal(s.doc.querySelectorAll('.ask-guide-do').length, 1, why);
}
/** No Undo and nothing of a written text on the line. */
function noUndo(s, why = '') {
  assert.doesNotMatch(s.line()?.textContent ?? '', /Undo|Guide filled/, why);
  assert.equal([...s.doc.querySelectorAll('.ask-guide-do')].filter((b) => b.textContent === 'Undo').length, 0, why);
}
const isQuietDo = (b) => b.matches('button.btn.btn-sm.btn-quiet.ask-guide-do[type="button"]') && !b.classList.contains('ask-guide-act') && !b.disabled;

test('Write it out: the words of the three buttons and of the writing line', () => {
  assert.equal(guide.WRITE_TEXT, WRITE);
  assert.equal(guide.WRITING_TEXT, WRITING);
  assert.equal(guide.STOP_TEXT, 'Stop');
  assert.equal(guide.UNDO_TEXT, 'Undo');
});

test('filledWords and filledSpeech: the gaps filled, "check it" for one, and the size in words, never a number of runs', () => {
  assert.deepEqual(guide.filledWords(4, 'large'), { head: 'Guide filled 4 gaps', mid: ' · check them', rest: ' · Large: several runs' });
  assert.deepEqual(guide.filledWords(1, 'small'), { head: 'Guide filled 1 gap', mid: ' · check it', rest: ' · Small: one run' });
  assert.deepEqual(guide.filledWords(2, 'medium'), { head: 'Guide filled 2 gaps', mid: ' · check them', rest: ' · Medium: a few runs' });
  assert.equal(guide.filledWords(3, 'huge').rest, '');
  assert.equal(guide.filledWords(3, undefined).rest, '');
  assert.equal(guide.filledSpeech(4), 'Guide filled 4 gaps, check them');
  assert.equal(guide.filledSpeech(1), 'Guide filled 1 gap, check it');
});

test('suggestedScrollTop: the line of the first "(suggested)" at or after `from`, one line above it, never below 0', () => {
  const own = 'mine (suggested)\ntwo\nthree';
  const value = `${own}\nWho calls it: a (suggested)\nConstraints: b (suggested)`;
  assert.equal(guide.suggestedScrollTop(value, own.length, 20), 40, 'line 3, minus one line; the person\'s own one is skipped');
  assert.equal(guide.suggestedScrollTop('Who calls it: a (suggested)', 0, 20), 0, 'the first line');
  assert.equal(guide.suggestedScrollTop('x\nWho calls it: a (suggested)', 1, 18), 0, 'the second line');
  for (const lineHeight of [NaN, 0, -20]) assert.equal(guide.suggestedScrollTop(value, own.length, lineHeight), 0, String(lineHeight));
});

test('writeGuide: one POST /api/shape/guide/write with the prompt, the role (null for none), the gaps and the signal', async () => {
  const asked = [];
  const out = written(TWO_LINES, ['who', 'done']);
  const fetchFn = async (url, init) => {
    asked.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ...out, model: { id: 'm', label: 'M' } }) };
  };
  const ctl = new AbortController();
  assert.deepEqual(await guide.writeGuide({ prompt: TWO_LINES, role: 'product', gaps: ['who', 'done'] }, { signal: ctl.signal, fetchFn }),
    { ok: true, written: out });
  await guide.writeGuide({ prompt: TWO_LINES, gaps: ['who', 'done'] }, { fetchFn });
  assert.equal(asked[0].url, '/api/shape/guide/write');
  assert.equal(asked[0].init.method, 'POST');
  assert.equal(asked[0].init.headers['Content-Type'], 'application/json');
  assert.equal(asked[0].init.signal, ctl.signal);
  assert.deepEqual(asked.map((a) => JSON.parse(a.init.body)), [
    { prompt: TWO_LINES, role: 'product', gaps: ['who', 'done'] }, { prompt: TWO_LINES, role: null, gaps: ['who', 'done'] },
  ]);
});

test('writeGuide never rejects: every route code, an abort, a network error and a reply that does not parse resolve with a code', async () => {
  const run = (fetchFn) => guide.writeGuide({ prompt: PROMPT, role: null, gaps: ['who'] }, { fetchFn });
  for (const [code, status] of WRITE_ROUTE_CODES) {
    const refused = async () => ({ ok: false, status, json: async () => ({ error: { code, message: 'x' } }) });
    assert.deepEqual(await run(refused), { ok: false, code }, code);
  }
  assert.deepEqual(await run(async () => { throw new DOMException('This operation was aborted', 'AbortError'); }), { ok: false, code: 'ABORTED' });
  assert.deepEqual(await run(async () => { throw new TypeError('Failed to fetch'); }), { ok: false, code: 'NETWORK' });
  const unparsable = async () => { throw new SyntaxError('Unexpected token <'); };
  assert.deepEqual(await run(async () => ({ ok: true, status: 200, json: unparsable })), { ok: false, code: 'BAD_REPLY' });
  assert.deepEqual(await run(async () => ({ ok: false, status: 502, json: unparsable })), { ok: false, code: 'BAD_REPLY' });
});

test('writeGuide: a 200 whose text does not start with the sent prompt, or that filled no known gap, is BAD_REPLY', async () => {
  const good = written(TWO_LINES, ['who']);
  for (const [name, body] of [
    ['nothing', null], ['an empty body', {}], ['no text', { filled: ['who'] }], ['a text that is not a string', { ...good, text: 7 }],
    ['a rewritten text', { ...good, text: 'REWRITTEN' }], ['the prompt trimmed', { ...good, text: `${TWO_LINES.trim()}\nx (suggested)` }],
    ['no filled', { text: good.text }], ['an empty filled', { ...good, filled: [] }], ['an unknown id', { ...good, filled: ['admin'] }],
    ['filled that is not a list', { ...good, filled: 'who' }],
  ]) {
    const got = await guide.writeGuide({ prompt: TWO_LINES, gaps: ['who'] }, { fetchFn: async () => ({ ok: true, status: 200, json: async () => body }) });
    assert.deepEqual(got, { ok: false, code: 'BAD_REPLY' }, name);
  }
});

test('with no write injected the composer asks the real write route through the page\'s fetch', async () => {
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push([init?.method, url, init?.body]);
    return { ok: true, status: 200, json: async () => (url.endsWith('/write') ? written(PROMPT) : answer()) };
  };
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
    const b = p.doc.querySelector('.ask-guide .ask-guide-do');
    assert.equal(b?.textContent, WRITE);
    b.click();
    await settle();
    assert.deepEqual(asked.at(-1).slice(0, 2), ['POST', '/api/shape/guide/write']);
    assert.deepEqual(JSON.parse(asked.at(-1)[2]), { prompt: PROMPT, role: null, gaps: ['trigger', 'limits', 'done'] });
    assert.equal(p.input.value, written(PROMPT).text);
  } finally { handle.destroy(); }
});

test('"Write it out" shows once, a quiet button at the right end after the spacer, while a gap is open', async () => {
  const s = await withResult();
  const all = s.doc.querySelectorAll('.ask-guide-do');
  assert.equal(all.length, 1);
  const b = all[0];
  assert.ok(isQuietDo(b), `the app's quiet small button: ${b.outerHTML}`);
  assert.equal(b.textContent, WRITE);
  assert.equal(b.querySelector('svg'), null, 'a labelled button, no icon');
  assert.ok(b.previousElementSibling?.matches('.ask-guide-sp'), 'after the spacer');
  assert.deepEqual([...s.line().children], [s.fold(), b.previousElementSibling, b], 'fold, spacer, button');
  s.handle.update(null);
  await settle();
  assert.equal(s.doBtn(), b, 'built once per mount');
  s.type(LONGER);
  await s.wait();
  assert.equal(s.quiet()?.textContent, 'checking…');
  assert.deepEqual([...s.line().children], [s.fold(), s.quiet(), b.previousElementSibling, b], 'after "checking…" on a re-check');
  assert.equal(s.doc.querySelectorAll('.ask-guide-do').length, 1);
});

test('"Write it out" is absent with no gap open, on the failure lines, while first checking, and on an empty line', async () => {
  for (const size of GUIDE_SIZES) {
    const s = await withResult(answer(5, size));
    assert.equal(s.doBtn(), null, `no gap, ${size}`);
    s.handle.destroy();
  }
  for (const code of ['GUIDE_MODEL_FAILED', 'GUIDE_NO_MODEL']) {
    const s = await withFailure(code);
    assert.equal(s.doBtn(), null, code);
    s.handle.destroy();
  }
  const s = setup();
  await s.shaper();
  assert.equal(s.doBtn(), null, 'the offer');
  s.type(PROMPT);
  assert.equal(s.doBtn(), null, 'empty');
  await s.wait();
  assert.equal(s.doBtn(), null, 'checking');
  await s.reply(0);
  assert.equal(s.doBtn()?.textContent, WRITE, 'the control: a result with a gap');
});

test('"Write it out" goes once Add has answered the last open gap', async () => {
  const s = await withRows(product({ covered: ['what', 'trigger', 'limits', 'done'] }));
  assert.equal(s.doBtn()?.textContent, WRITE);
  await openAdd(s, 'who');
  await answerWith(s, TEAM);
  assert.equal(s.doBtn(), null);
});

test('R-po-4: one click makes exactly one write with the field\'s exact text, the role and the open gaps', async () => {
  const s = await resultFor(TWO_LINES, answer(1), { role: 'product' });
  const b = await press(s, WRITE);
  b.click();                           // the button is not on the line any more: a second click does nothing
  await settle();
  assert.equal(s.writes.length, 1);
  assert.deepEqual(s.writes[0].body, { prompt: TWO_LINES, role: 'product', gaps: ['what', 'trigger', 'limits', 'done'] });
  assert.equal(s.writes[0].signal.aborted, false);
  assert.equal(s.input.value, TWO_LINES, 'nothing changes before the answer');
  await s.wait(5000);
  assert.equal(s.writes.length, 1);
  assert.equal(s.checks.length, 1);
});

test('"Writing it out…" with Stop: the result and its rows leave the line, and the focus is in the prompt', async () => {
  const s = await withRows(answer());
  await press(s, WRITE);
  assert.equal(s.text(), WRITING);
  assert.equal(s.line().textContent, `${WRITING}Stop`);
  const stop = s.doBtn();
  assert.ok(isQuietDo(stop), stop.outerHTML);
  assert.ok(stop.previousElementSibling?.matches('.ask-guide-sp'));
  assert.equal(s.fold(), null);
  assert.equal(s.quiet(), null);
  assert.equal(rowsEl(s), null, 'the rows are gone while writing');
  assert.equal(s.doc.activeElement, s.input);
  assert.equal(s.doc.querySelector('.ask-send').disabled, false);
  await press(s, 'Stop');
  assertRows(s, true, 'the rows come back as the person left them');
});

test('a write clears a pending pause: no check goes out while writing', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait(1000);
  await press(s, WRITE);
  await s.wait(5000);
  assert.equal(s.checks.length, 1);
  assert.equal(s.writes[0].body.prompt, LONGER, 'the field\'s current text');
});

test('a write during a re-check aborts that check, whose late answer changes nothing', async () => {
  const s = await withResult();
  s.type(LONGER);
  await s.wait();
  await press(s, WRITE);
  assert.equal(s.checks[1].signal.aborted, true);
  assert.deepEqual(s.writes[0].body, { prompt: LONGER, role: null, gaps: ['trigger', 'limits', 'done'] });
  await s.reply(1, answer(4));
  assert.equal(s.text(), WRITING);
  assert.equal(s.fold(), null);
  assert.deepEqual(s.spoken(), [SPOKEN]);
});

test('a write asks only for the gaps Add left open, closes an open Add field and drops its draft', async () => {
  const s = await withRows(product());
  await openAdd(s, 'who');
  await answerWith(s, TEAM);           // the field moves on to "What they get"
  typeAnswer(s, 'half a thought');
  const before = s.input.value;
  await press(s, WRITE);
  assert.deepEqual(s.writes[0].body, { prompt: before, role: null, gaps: ['what', 'done'] });
  assert.equal(fields(s), 0);
  assert.equal(s.input.value, before, 'the draft never reaches the prompt');
  await s.wait(5000);
  assert.equal(s.checks.length, 1, 'the pause Add armed is cleared');
  await land(s, 0, written(before, ['what', 'done'], { register: 'plain' }));
  assert.equal(s.doc.querySelector('.ask-guide-head')?.textContent, 'Guide filled 2 gaps');
  await press(s, 'Undo');
  assert.equal(s.input.value, before, 'Add\'s answer stays: it was there before the write');
  assert.equal(s.fold()?.textContent, THREE_OF_FIVE, 'and its point stays covered');
});

test('a write drops a check result held behind an open Add field', async () => {
  const s = await fieldOpenMidCheck();
  await s.reply(1, product({ covered: [...GUIDE_CHECK_IDS] }));
  await press(s, WRITE);
  await press(s, 'Stop');
  assert.equal(s.fold()?.textContent, GAPS, 'the held result is not applied');
  assert.equal(fields(s), 0);
});

test('R-qa-4 example: typing a letter mid-write aborts the request; the field keeps the text plus the letter', async () => {
  const s = await midWrite(TWO_LINES);
  s.type(`${TWO_LINES}x`);
  await settle();
  assert.equal(s.writes[0].signal.aborted, true);
  assert.equal(s.input.value, `${TWO_LINES}x`);
  resultBack(s, GAPS, 'the result is back');
  await land(s, 0, written(TWO_LINES));
  assert.equal(s.input.value, `${TWO_LINES}x`, 'a late write answer changes nothing');
  noUndo(s, 'late answer');
  assert.deepEqual(s.spoken(), [SPOKEN]);
  await s.wait();
  assert.equal(s.checks.length, 2, 'the typed text is checked as usual');
  assert.equal(s.checks[1].body.prompt, `${TWO_LINES}x`.trim());
});

test('R-qa-4: Stop aborts the request, the field is byte-identical and the result is back with "Write it out"', async () => {
  const s = await midWrite(TWO_LINES);
  await press(s, 'Stop');
  assert.equal(s.writes[0].signal.aborted, true);
  assert.equal(s.input.value, TWO_LINES);
  resultBack(s);
  assert.equal(s.doc.activeElement, s.input);
  await land(s, 0, written(TWO_LINES));
  assert.equal(s.input.value, TWO_LINES, 'a late write answer changes nothing');
  resultBack(s, GAPS, 'after the late answer');
  assert.deepEqual(s.spoken(), [SPOKEN], 'Stop says nothing');
  await s.wait(5000);
  assert.equal(s.checks.length, 1, 'unchanged text is not checked again');
  await press(s, WRITE);
  assert.equal(s.writes.length, 2, 'and it can be written again');
  assert.equal(s.writes[1].signal.aborted, false);
});

test('R-po-4: the landing writes the text, reads "Guide filled 3 gaps · check them · Large: several runs" with Undo, and is spoken once', async () => {
  let inputs = 0;
  const s = await midWrite(PROMPT);
  s.input.addEventListener('input', () => { inputs += 1; });
  const out = written(PROMPT);
  await land(s, 0, out);
  assert.equal(s.input.value, out.text);
  assert.ok(inputs >= 1, 'the field says it changed, so the panel resizes it and keeps Send on');
  const words = 'Guide filled 3 gaps · check them · Large: several runs';
  assert.equal(s.line().textContent, `${words}Undo`);
  const sum = s.line().querySelector(':scope > .ask-guide-sum');
  assert.equal(sum?.textContent, words);
  assert.equal(sum.querySelector(':scope > b.ask-guide-head')?.textContent, 'Guide filled 3 gaps');
  assert.equal(sum.querySelector(':scope > .ask-guide-mid')?.textContent, ' · check them');
  assert.equal(sum.querySelector(':scope > .ask-guide-rest')?.textContent, ' · Large: several runs');
  const undo = s.doBtn();
  assert.ok(isQuietDo(undo), undo.outerHTML);
  assert.ok(undo.previousElementSibling?.matches('.ask-guide-sp'));
  assert.equal(s.fold(), null);
  assert.equal(rowsEl(s), null);
  assert.deepEqual(s.spoken(), [SPOKEN, 'Guide filled 3 gaps, check them']);
  s.handle.update(null);
  s.input.dispatchEvent(new s.win.KeyboardEvent('keyup', { key: 'ArrowUp', bubbles: true }));
  await s.wait(5000);
  assert.equal(s.doBtn(), undo, 'a repaint keeps Undo');
  assert.equal(s.checks.length, 1, 'the written text counts as checked');
  assert.equal(s.spoken().length, 2);
  assert.doesNotMatch(s.line().textContent, /small runs|\d+ runs?\b/i);
});

test('the written line counts the gaps filled, one reading "check it", with the shown result\'s size', async () => {
  const some = await midWrite(PROMPT, answer(2, 'medium'));
  await land(some, 0, written(PROMPT, ['limits']));
  assert.equal(some.line().textContent, 'Guide filled 1 gap · check it · Medium: a few runs' + 'Undo');
  assert.equal(some.spoken().at(-1), 'Guide filled 1 gap, check it');
  some.type(`${some.input.value}!`);
  await settle();
  resultBack(some, 'Prompt 3/5 · 2 gaps', 'only the filled point is covered');
});

test('the caret lands right after the first "(suggested)" past the person\'s own words', async () => {
  const own = 'Keep the (suggested) retries as they are';
  const s = await writtenOut(own);
  const at = s.landed.text.indexOf('(suggested)', own.length) + '(suggested)'.length;
  assert.ok(at > own.length, 'fixture');
  assert.equal(s.input.selectionStart, at);
  assert.equal(s.input.selectionEnd, at);
  assert.equal(s.doc.activeElement, s.input);
});

test('R-po-4: the field scrolls to the first "(suggested)"', async () => {
  const own = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
  const s = await midWrite(own);
  s.input.style.lineHeight = '20px';
  await land(s, 0, written(own));
  assert.equal(s.input.scrollTop, 220, 'the thirteenth line, with one line above it');
});

test('a landing never takes the focus from elsewhere on the page', async () => {
  const s = await midWrite(PROMPT);
  const other = s.doc.querySelector('#elsewhere');
  other.focus();
  const focused = focusSpy(s);
  await land(s, 0, written(PROMPT));
  assert.equal(s.doc.activeElement, other);
  assert.equal(focused(), 0);
});

test('a landing with the focus on Stop puts it in the prompt', async () => {
  const s = await midWrite(PROMPT);
  s.doBtn().focus();
  assert.equal(s.doc.activeElement, s.doBtn(), 'fixture');
  await land(s, 0, written(PROMPT));
  assert.equal(s.doc.activeElement, s.input);
});

test('R-qa-10 / R-po-4 example: "Guide filled 4 gaps · check them", Undo, and the two lines are back byte for byte', async () => {
  const s = await writtenOut(TWO_LINES, answer(1));
  assert.match(s.line().textContent, /^Guide filled 4 gaps · check them · Large: several runs/);
  assert.notEqual(s.input.value, TWO_LINES);
  let inputs = 0;
  s.input.addEventListener('input', () => { inputs += 1; });
  await press(s, 'Undo');
  assert.equal(s.input.value, TWO_LINES);
  assert.ok(inputs >= 1, 'the field says it changed');
  resultBack(s, 'Prompt 1/5 · 4 gaps', 'the result from before the write');
  noUndo(s, 'after Undo');
  assert.equal(s.doc.activeElement, s.input);
  await s.wait(5000);
  assert.equal(s.checks.length, 1, 'the restored text was already checked');
  await press(s, WRITE);
  assert.deepEqual(s.writes[1].body.gaps, ['what', 'trigger', 'limits', 'done']);
  assert.equal(s.writes[1].body.prompt, TWO_LINES);
});

test('R-qa-11: after the first edit there is no Undo, the line is the result again and the edit is checked', async () => {
  const s = await writtenOut();
  const undo = s.doBtn();
  const edited = `${s.landed.text}!`;
  s.type(edited);
  await settle();
  noUndo(s, 'after one letter');
  assert.equal(s.fold()?.textContent, 'Prompt 5/5 · Large: several runs');
  assert.equal(s.line().textContent, 'Prompt 5/5 · Large: several runs', 'no gap left, so no button');
  undo.click();
  await settle();
  assert.equal(s.input.value, edited, 'a stale Undo changes nothing');
  await s.wait(1999);
  assert.equal(s.checks.length, 1);
  await s.wait(1);
  assert.equal(s.checks.length, 2, 'exactly one check of the edited text');
  assert.equal(s.checks[1].body.prompt, edited);
});

test('the browser\'s own undo back to the written text brings no Undo back and makes no check', async () => {
  const s = await writtenOut();
  s.type(`${s.landed.text}!`);
  await settle();
  s.input.value = s.landed.text;
  s.input.dispatchEvent(new s.win.InputEvent('input', { bubbles: true, inputType: 'historyUndo' }));
  await settle();
  noUndo(s, 'after a native undo');
  assert.equal(s.fold()?.textContent, 'Prompt 5/5 · Large: several runs');
  assert.equal(s.input.value, s.landed.text);
  await s.wait(5000);
  assert.equal(s.checks.length, 1);
});

test('a written text changed with no input event (a recall, a code write) ends Undo for good', async () => {
  const s = await writtenOut();
  const undo = s.doBtn();
  s.input.value = LONGER;
  s.handle.update(null);
  await settle();
  noUndo(s, 'a recall');
  undo.click();
  await settle();
  assert.equal(s.input.value, LONGER);
  s.input.value = s.landed.text;
  s.handle.update(null);
  await settle();
  noUndo(s, 'recalled back');
});

test('Undo clicked after a change nobody announced restores nothing', async () => {
  const s = await writtenOut();
  s.input.value = LONGER;              // no input event and no repaint yet
  s.doBtn().click();
  await settle();
  assert.equal(s.input.value, LONGER);
});

test('a write answer for text the field no longer holds is dropped', async () => {
  const s = await midWrite(PROMPT);
  s.input.value = LONGER;              // a recall, a code write: no input event
  await land(s, 0, written(PROMPT));
  assert.equal(s.input.value, LONGER);
  assert.doesNotMatch(s.line().textContent, /Writing|Guide filled|Undo/);
  assert.deepEqual(s.spoken(), [SPOKEN]);
});

test('R-qa-12: write output holding markup lands as those characters and creates no element', async () => {
  const s = await midWrite(PROMPT);
  const out = written(PROMPT, ['trigger', 'limits', 'done'], { fill: () => XSS });
  await land(s, 0, out);
  assert.equal(s.input.value, out.text);
  assert.ok(s.input.value.includes('<img src=x onerror=alert(1)>'));
  assert.equal(s.doc.querySelector('img'), null);
});

test('a failed write leaves the field byte-identical, shows the result with "Write it out" and announces the failure once', async () => {
  for (const [code, words] of [
    ['GUIDE_MODEL_FAILED', FAIL], ['GUIDE_NO_MODEL', NO_MODEL], ['GUIDE_COST_LIMIT', FAIL], ['GUIDE_BUSY', FAIL],
    ['GUIDE_WRITE_FAILED', FAIL], ['NETWORK', FAIL], ['BAD_REPLY', FAIL],
  ]) {
    const s = await midWrite(TWO_LINES);
    await failWrite(s, 0, code);
    assert.equal(s.input.value, TWO_LINES, code);
    resultBack(s, GAPS, code);
    assert.equal(s.act(), null, `${code}: no failure action`);
    s.handle.update(null);
    await settle();
    assert.deepEqual(s.spoken(), [SPOKEN, words], code);
    await press(s, WRITE);
    assert.equal(s.writes.length, 2, `${code}: the button works again`);
    s.handle.destroy();
  }
});

test('a superseded, aborted or Guide-off write changes nothing and announces nothing', async () => {
  for (const code of ['GUIDE_SUPERSEDED', 'ABORTED', 'GUIDE_OFF']) {
    const s = await midWrite(TWO_LINES);
    await failWrite(s, 0, code);
    assert.equal(s.input.value, TWO_LINES, code);
    assert.doesNotMatch(s.line()?.textContent ?? '', /Writing|Guide filled|Undo/, code);
    assert.deepEqual(s.spoken(), [SPOKEN], code);
    if (code !== 'GUIDE_OFF') resultBack(s, GAPS, code);
    s.handle.destroy();
  }
});

/** What ends a write and its Undo from outside the person's typing. */
const WRITE_ENDS = [
  ['a send', (s) => { s.intentHandle.transformSend(s.input.value); s.input.value = ''; s.handle.update(null); }],
  ['Guide switched off', (s) => s.swInput().click()],
  ['the Shaper pin removed', (s) => s.intent.clear()],
  ['the flag turned off', (s) => s.setFlag(false)],
  ['a prompt cut below 12 characters', (s) => s.type('Export')],
  ['destroy()', (s) => s.handle.destroy()],
];
for (const [name, end] of WRITE_ENDS) {
  test(`${name} mid-write aborts it, and its late answer changes nothing`, async () => {
    const s = await midWrite(PROMPT);
    end(s);
    await settle();
    assert.equal(s.writes[0].signal.aborted, true);
    const held = s.input.value;
    await land(s, 0, written(PROMPT));
    assert.equal(s.input.value, held);
    assert.doesNotMatch(s.line()?.textContent ?? '', /Writing|Guide filled|Undo/);
    assert.deepEqual(s.spoken(), [SPOKEN]);
  });

  test(`${name} removes Undo from a written text`, async () => {
    const s = await writtenOut();
    const undo = s.doBtn();
    end(s);
    await settle();
    noUndo(s, name);
    const held = s.input.value;
    undo.click();
    await settle();
    assert.equal(s.input.value, held);
  });
}

test('a written text past the check\'s limit stays in the field with Undo; the next edit clears the result', async () => {
  const long = 'x'.repeat(GUIDE_PROMPT_MAX - 10);
  const s = await writtenOut(long);
  assert.ok(s.input.value.length > GUIDE_PROMPT_MAX, 'fixture');
  s.handle.update(null);
  await settle();
  assert.equal(s.doBtn()?.textContent, 'Undo');
  s.type(`${s.input.value}!`);
  await s.wait(3000);
  noUndo(s, 'edited');
  emptyLine(s, 'over the limit');
  assert.equal(s.checks.length, 1);
});

test('a prompt checked within the limit but past it with its trailing whitespace offers no write and sends none', async () => {
  const s = await resultFor(`${'x'.repeat(GUIDE_PROMPT_MAX)}\n`);
  assert.equal(s.fold()?.textContent, GAPS, 'the result is shown');
  assert.equal(s.doc.querySelectorAll('.ask-guide-do').length, 0, 'no Write it out');
  assert.equal(s.writes.length, 0, 'no write request');
});

test('the stylesheet has the spacer, the middle words that never shrink and the buttons that never shrink', () => {
  const { base } = cssParts();
  holds(base, '.ask-guide-sp', ['flex:1 1 0']);
  holds(base, '.ask-guide-mid', ['flex:none', 'white-space:pre']);
  holds(base, '.ask-guide > .ask-guide-do', ['flex:none']);
});

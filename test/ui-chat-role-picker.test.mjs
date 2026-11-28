// test/ui-chat-role-picker.test.mjs — the composer's role picker (a CONTRACT §2 composer add-on, registered after the
// intent chip). With the shaperSmallRuns flag on and the Shaper pin set it sits right after the pin and says who is
// asking; the app's menu picks one of the seven roles or "No role"; the pick is saved (PUT /api/answerer), rides the
// sent Shaper message as one paragraph after the lead, and focus goes back to the prompt field. With the flag off or
// no Shaper pin it is not in the DOM and asks for nothing. It never takes or holds a send.
// jsdom has no layout: the fold is driven by the injected `measureWraps` through a fake ResizeObserver.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createRolePicker, installRolePicker, ROLE_PICKER_ADDON_ID, ROLE_ICONS, NO_ROLE_ICON,
} from '../ui/public/chat/role-picker.mjs';
import { createIntentAddon, installIntentAddon, INTENTS } from '../ui/public/chat/intent.mjs';
import { composerAddons, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { _resetAnswerer, leadLabel, saveAnswerer } from '../ui/public/answerer.mjs';
import { applyFlags } from '../ui/public/flags.mjs';
import { icon } from '../ui/public/icons.mjs';
import { closeMenus } from '../ui/public/workflows/menu.mjs';
import { answererLeadKeys } from '../src/shared/answerer.mjs';
import { readStyleCss } from '../src/core/read-style-css.mjs';

const LEAD = INTENTS.shape.lead;
const ROLES = ['product', 'architect', 'ux', 'qa', 'security', 'devops', 'compliance'];
const LABELS = ['Product', 'Engineering', 'Design', 'QA', 'Security', 'DevOps', 'Compliance'];
const ICON_OF = {
  product: 'briefcase', architect: 'terminal', ux: 'design', qa: 'eye', security: 'shield', devops: 'cloud', compliance: 'scale',
};
const TITLE_NONE = 'Who is asking: Worca words its questions for you. Remembered.';

const saved = {};
beforeEach(() => {
  for (const k of ['fetch', 'document', 'ResizeObserver']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  _resetAnswerer();
  _resetChatExtensions();
});
// Registered before useDomRelease: an open menu is closed while its document is still alive.
afterEach(() => {
  closeMenus();
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

/** The composer's box (as the intent suite builds it) with the real intent add-on mounted into the lead row. */
function page() {
  const dom = trackDom(new JSDOM(`<!doctype html><body><div class="chat-page" data-chat-page data-view="home">
    <div class="ask-composer"><div class="ask-composer-box"><div class="chat-composer-lead" data-chat-composer-lead></div>
    <textarea class="ask-input"></textarea></div></div></div><button id="elsewhere">x</button></body>`));
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
  /** A layout change of the lead row, as the browser reports it. */
  const resize = async () => {
    width -= 20;
    for (const o of observers.filter((x) => !x.disconnected)) {
      o.cb(o.targets.map((target) => ({ target, contentRect: { width, height: 26 } })), o);
    }
    await tick();
  };
  return {
    doc, win, lead, input, ctx, said, observers, resize,
    picker: () => lead.querySelector('.ask-asker-pick'),
    name: () => lead.querySelector('.ask-asker-pick .ask-asker-l')?.textContent,
  };
}

/** `page()` plus the picker with every dependency injected. `profile` is what the loader answers. */
function setup({ flag = true, profile = null, load = null, save = null, measureWraps = () => false, pin = null } = {}) {
  const p = page();
  const state = { on: flag, subs: new Set(), flagOffs: 0, intentOffs: 0 };
  const calls = { load: 0, save: [] };
  const intent = createIntentAddon();
  const intentHandle = intent.addon.mount(p.lead, p.ctx);
  if (pin) intent.set(pin, { focus: false });
  const ctl = createRolePicker({
    intent: {
      current: () => intent.current(),
      onChange: (fn) => { const off = intent.onChange(fn); return () => { state.intentOffs += 1; off(); }; },
    },
    flagOn: (k) => k === 'shaperSmallRuns' && state.on,
    onFlagChange: (k, fn) => {
      assert.equal(k, 'shaperSmallRuns');
      state.subs.add(fn);
      return () => { state.flagOffs += 1; state.subs.delete(fn); };
    },
    load: () => { calls.load += 1; return load ? load() : Promise.resolve({ lead: profile }); },
    save: (k) => { calls.save.push(k); return save ? save(k) : Promise.resolve({ lead: k }); },
    measureWraps,
  });
  const handle = ctl.addon.mount(p.lead, p.ctx);
  const setFlag = (on) => { state.on = on; for (const fn of [...state.subs]) fn(on); };
  /** The Shaper pin is set and the profile has landed. */
  const shaper = async () => { intent.set('shape', { focus: false }); await settle(); };
  /** What a send carries: the add-ons' transformSend in registration order. */
  const sent = (text) => handle.transformSend(intentHandle.transformSend(text));
  return { ...p, state, calls, intent, intentHandle, ctl, handle, setFlag, shaper, sent };
}

const menu = (doc) => doc.querySelector('.wfv-menu');
const rows = (doc) => [...doc.querySelectorAll('.wfv-menu [role^="menuitem"]')];
const rowLabel = (r) => r.querySelector('.wfv-menu-l').textContent;
const row = (doc, label) => rows(doc).find((r) => rowLabel(r) === label);
async function pick(s, label) {
  s.picker().click();
  const r = row(s.doc, label);
  assert.ok(r, `the menu has a "${label}" row`);
  r.click();
  await settle();
}
/** The inner markup of icon `name`, as the document serialises it. */
const glyph = (doc, name) => icon(doc, name).querySelector('svg').innerHTML;
const escape = (s) => {
  menu(s.doc).dispatchEvent(new s.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
};

test('R-po-1: the add-on id and one icon per role, in the order of the leads, plus the person for none', () => {
  assert.equal(ROLE_PICKER_ADDON_ID, 'role-picker');
  assert.deepEqual({ ...ROLE_ICONS }, ICON_OF);
  assert.deepEqual(Object.keys(ROLE_ICONS), answererLeadKeys({ smallRuns: true }));
  assert.ok(Object.isFrozen(ROLE_ICONS));
  assert.equal(NO_ROLE_ICON, 'person');
});

test('R-qa-7: with the flag on and the Shaper pin, the lead row holds the pin then the picker reading "Your role"', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.lead.children.length, 2, 'exactly 2 controls');
  assert.ok(s.lead.children[0].matches('.chat-intent[data-intent="shape"]'));
  const btn = s.lead.children[1];
  assert.ok(btn.matches('button.btn.btn-sm.btn-quiet.shape-lead-pick.ask-asker-pick'));
  assert.equal(btn.type, 'button');
  assert.equal(s.name(), 'Your role');
  assert.equal(btn.getAttribute('aria-label'), 'Your role: not picked');
  assert.equal(btn.title, TITLE_NONE);
  assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
  assert.equal(btn.getAttribute('aria-expanded'), 'false');
  assert.equal(s.ctl.role(), null);
  const svgs = [...btn.querySelectorAll('svg')];
  assert.equal(svgs.length, 2, 'the role icon and the arrow');
  assert.equal(svgs[0].innerHTML, glyph(s.doc, 'person'));
  assert.equal(svgs[0].getAttribute('width'), '14');
  assert.equal(svgs[1].innerHTML, glyph(s.doc, 'chevron-down'));
  assert.equal(svgs[1].getAttribute('width'), '12');
});

test('the picker goes right after the pin, not at the end of the lead row', async () => {
  const s = setup({ flag: false });
  s.intent.set('shape', { focus: false });
  const other = s.doc.createElement('span');
  other.className = 'x-other';
  s.lead.appendChild(other);
  s.setFlag(true);
  await settle();
  assert.deepEqual([...s.lead.children].map((c) => c.classList.contains('chat-intent') ? 'pin' : c.classList.contains('ask-asker-pick') ? 'picker' : c.className),
    ['pin', 'picker', 'x-other']);
});

test('a composer mounted while the Shaper pin is set shows the picker at once', async () => {
  const s = setup({ pin: 'shape', profile: 'qa' });
  assert.ok(s.picker(), 'in the DOM without another intent change');
  await settle();
  assert.equal(s.name(), 'QA');
});

test('R-qa-8: the menu is the app menu: 7 roles in order, each with its icon, one separator, then "No role"', async () => {
  const s = setup();
  await s.shaper();
  s.picker().click();
  const m = menu(s.doc);
  assert.ok(m.matches('.menu.wfv-menu[role="menu"]'));
  assert.equal(m.getAttribute('aria-label'), 'Your role');
  assert.equal(s.picker().getAttribute('aria-expanded'), 'true');
  const kids = [...m.children];
  assert.equal(kids.length, 9);
  assert.ok(kids[7].matches('.menu-sep[role="separator"]'));
  assert.equal(m.querySelectorAll('.menu-sep').length, 1);
  const items = rows(s.doc);
  assert.deepEqual(items.map(rowLabel), [...LABELS, 'No role']);
  assert.equal(items[7], kids[8], '"No role" is last, after the separator');
  [...ROLES.map((k) => ICON_OF[k]), 'person'].forEach((name, i) => {
    assert.equal(items[i].querySelector('.wfv-menu-ic svg')?.innerHTML, glyph(s.doc, name), `${rowLabel(items[i])}: ${name}`);
  });
  assert.equal(new Set(items.map((r) => r.querySelector('.wfv-menu-ic svg').innerHTML)).size, 8, 'distinct icons');
  assert.deepEqual(items.map((r) => r.getAttribute('aria-checked')), [...ROLES.map(() => 'false'), 'true'], 'nothing saved: "No role" is checked');
  assert.equal(m.querySelector('.wfv-menu-hint'), null, 'nothing saved: no "you, last time"');
  s.picker().click();
  assert.equal(menu(s.doc), null, 'the second click closes it');
  assert.equal(s.picker().getAttribute('aria-expanded'), 'false');
});

test('R-qa-8: the saved role is on the picker, checked in the menu, and alone carries "you, last time"', async () => {
  const s = setup({ profile: 'compliance' });
  await s.shaper();
  assert.equal(s.name(), 'Compliance');
  assert.equal(s.ctl.role(), 'compliance');
  assert.equal(s.picker().getAttribute('aria-label'), 'Your role: Compliance');
  assert.equal(s.picker().title, `Compliance. ${TITLE_NONE}`);
  assert.equal(s.picker().querySelector('svg').innerHTML, glyph(s.doc, 'scale'));
  s.picker().click();
  assert.equal(row(s.doc, 'Compliance').querySelector('.wfv-menu-hint')?.textContent, 'you, last time');
  assert.equal(menu(s.doc).querySelectorAll('.wfv-menu-hint').length, 1);
  assert.equal(row(s.doc, 'Compliance').getAttribute('aria-checked'), 'true');
  assert.equal(row(s.doc, 'No role').getAttribute('aria-checked'), 'false');
});

test('a pick paints at once and saves the key exactly once', async () => {
  const d = deferred();
  const s = setup({ save: () => d.promise });
  await s.shaper();
  await pick(s, 'Engineering');
  assert.equal(s.name(), 'Engineering', 'painted while the save is still out');
  assert.equal(s.ctl.role(), 'architect');
  assert.equal(s.picker().getAttribute('aria-label'), 'Your role: Engineering');
  assert.equal(s.picker().title, `Engineering. ${TITLE_NONE}`);
  assert.equal(s.picker().querySelector('svg').innerHTML, glyph(s.doc, 'terminal'));
  assert.deepEqual(s.calls.save, ['architect']);
  assert.equal(menu(s.doc), null);
  assert.equal(s.picker().getAttribute('aria-expanded'), 'false');
  d.resolve({ lead: 'architect' });
  await settle();
  assert.equal(s.name(), 'Engineering');
  assert.deepEqual(s.calls.save, ['architect']);
});

test('"No role" saves null and the picker reads "Your role" again', async () => {
  const s = setup({ profile: 'security' });
  await s.shaper();
  await pick(s, 'No role');
  assert.deepEqual(s.calls.save, [null]);
  assert.equal(s.name(), 'Your role');
  assert.equal(s.ctl.role(), null);
  assert.equal(s.picker().getAttribute('aria-label'), 'Your role: not picked');
  assert.equal(s.picker().title, TITLE_NONE);
  assert.equal(s.picker().querySelector('svg').innerHTML, glyph(s.doc, 'person'));
  assert.equal(s.sent('Uploads fail'), `${LEAD}\n\nUploads fail`);
});

test('picking the role already set makes no request', async () => {
  const s = setup({ profile: 'qa' });
  await s.shaper();
  await pick(s, 'QA');
  assert.deepEqual(s.calls.save, []);
  assert.equal(s.name(), 'QA');
  const none = setup();
  await none.shaper();
  await pick(none, 'No role');
  assert.deepEqual(none.calls.save, []);
});

test('a failed save puts the previous role back, says nothing and holds nothing', async () => {
  const d = deferred();
  const s = setup({ profile: 'product', save: () => d.promise });
  await s.shaper();
  const announced = s.said.length;
  await pick(s, 'Design');
  assert.equal(s.name(), 'Design');
  d.reject(new Error('disk full'));
  await settle();
  assert.equal(s.name(), 'Product');
  assert.equal(s.ctl.role(), 'product');
  assert.equal(s.picker().getAttribute('aria-label'), 'Your role: Product');
  assert.equal(s.said.length, announced, 'no announcement');
  assert.equal(s.picker().disabled, false);
  assert.doesNotMatch(s.doc.body.textContent, /disk full/, 'no toast, no message');
  assert.equal(s.sent('x'), `${LEAD}\n\nAsking as: product.\n\nx`);
});

test('a failed "No role" keeps the role that was saved; a failed first pick goes back to "Your role"', async () => {
  const fail = () => Promise.reject(new Error('refused'));
  const s = setup({ profile: 'devops', save: fail });
  await s.shaper();
  await pick(s, 'No role');
  assert.equal(s.name(), 'DevOps');
  const none = setup({ save: fail });
  await none.shaper();
  await pick(none, 'QA');
  assert.equal(none.name(), 'Your role');
  assert.equal(none.ctl.role(), null);
});

test('two quick picks save in order: the second save starts only after the first settles, and the profile ends on it', async () => {
  const outs = [];
  const s = setup({ save: (k) => { const d = deferred(); outs.push({ k, d }); return d.promise; } });
  await s.shaper();
  await pick(s, 'Design');
  await pick(s, 'Security');
  await settle();
  assert.deepEqual(s.calls.save, ['ux'], 'the second save waits for the first');
  outs[0].d.resolve({ lead: 'ux' });
  await settle();
  assert.deepEqual(s.calls.save, ['ux', 'security'], 'then runs, in pick order');
  assert.equal(s.name(), 'Security');
  outs[1].d.resolve({ lead: 'security' });
  await settle();
  assert.equal(s.name(), 'Security');
  assert.equal(s.ctl.role(), 'security');
});

test('of two quick picks, a refused first save leaves the latest pick; a refused latest save goes back to the stored role', async () => {
  const outs = [];
  const s = setup({ profile: 'product', save: (k) => { const d = deferred(); outs.push({ k, d }); return d.promise; } });
  await s.shaper();
  await pick(s, 'Design');
  await pick(s, 'Security');
  outs[0].d.reject(new Error('refused'));
  await settle();
  assert.equal(s.name(), 'Security', 'not the latest pick: nothing put back');
  outs[1].d.reject(new Error('refused'));
  await settle();
  assert.equal(s.name(), 'Product', 'the profile still holds Product');
  assert.equal(s.ctl.role(), 'product');
});

test('a profile read that a pick overtook does not put the old role back, whether it answers the old role or a timeout', async () => {
  for (const late of [{ lead: 'qa' }, { lead: null }]) {
    const reads = [];
    let first = true;
    const s = setup({
      load: () => {
        if (first) { first = false; return Promise.resolve({ lead: 'qa' }); }
        const d = deferred(); reads.push(d); return d.promise;
      },
    });
    await s.shaper();
    assert.equal(s.name(), 'QA', 'the first read landed');
    s.intent.clear();
    await s.shaper();
    assert.equal(reads.length, 1, 'a second read is out');
    await pick(s, 'Compliance');
    assert.deepEqual(s.calls.save, ['compliance'], 'its save resolved first');
    reads[0].resolve(late);
    await settle();
    assert.equal(s.name(), 'Compliance', `the older read (${late.lead}) leaves the pick`);
    assert.equal(s.ctl.role(), 'compliance');
    s.picker().click();
    assert.equal(row(s.doc, 'Compliance').querySelector('.wfv-menu-hint')?.textContent, 'you, last time');
    closeMenus();
  }
});

test('"you, last time" follows a saved pick', async () => {
  const s = setup({ profile: 'qa' });
  await s.shaper();
  await pick(s, 'Compliance');
  await settle();
  s.picker().click();
  assert.equal(menu(s.doc).querySelectorAll('.wfv-menu-hint').length, 1);
  assert.equal(row(s.doc, 'Compliance').querySelector('.wfv-menu-hint')?.textContent, 'you, last time');
  closeMenus();
  await pick(s, 'No role');
  await settle();
  s.picker().click();
  assert.equal(menu(s.doc).querySelector('.wfv-menu-hint'), null, 'after "No role" no row is "last time"');
});

test('a profile read that failed is asked again the next time the picker shows', async () => {
  let fail = true;
  const s = setup({ load: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve({ lead: 'devops' })) });
  await s.shaper();
  assert.equal(s.name(), 'Your role');
  fail = false;
  s.intent.clear();
  await s.shaper();
  assert.equal(s.calls.load, 2);
  assert.equal(s.name(), 'DevOps');
});

test('with the app\'s own loader, a role the Shaper card saves shows on the picker the next time it shows, with no extra request', async () => {
  const urls = [];
  let stored = 'qa';
  globalThis.fetch = async (url, init) => {
    urls.push(`${init?.method || 'GET'} ${url}`);
    if (init?.method === 'PUT') stored = JSON.parse(init.body).lead;
    return { ok: true, status: 200, json: async () => ({ lead: stored }) };
  };
  const p = page();
  const intent = createIntentAddon();
  intent.addon.mount(p.lead, p.ctx);
  const ctl = createRolePicker({
    intent: { current: () => intent.current(), onChange: (fn) => intent.onChange(fn) },
    flagOn: (k) => k === 'shaperSmallRuns', onFlagChange: () => () => {},
  });
  ctl.addon.mount(p.lead, p.ctx);
  intent.set('shape', { focus: false });
  await settle();
  assert.equal(p.name(), 'QA');
  await saveAnswerer('compliance');   // the Shaper card's write
  intent.clear();
  intent.set('shape', { focus: false });
  await settle();
  assert.equal(p.name(), 'Compliance');
  assert.deepEqual(urls, ['GET /api/answerer', 'PUT /api/answerer']);
});

test('R-qa-9: after a pick, a "No role", a re-pick and an Escape, focus is on the prompt field', async () => {
  const s = setup();
  await s.shaper();
  for (const label of ['Compliance', 'Compliance', 'No role']) {
    s.picker().focus();
    await pick(s, label);
    assert.equal(s.doc.activeElement, s.input, `after picking ${label}`);
  }
  s.picker().focus();
  s.picker().click();
  assert.notEqual(s.doc.activeElement, s.input, 'the menu holds the focus while open');
  escape(s);
  assert.equal(menu(s.doc), null);
  assert.equal(s.doc.activeElement, s.input, 'after Escape');
  assert.deepEqual(s.calls.save, ['compliance', null], 'Escape saves nothing');
});

test('R-qa-10: when the lead row would wrap the picker folds, keeping its aria-label and title; it unfolds when there is room', async () => {
  let wraps = true;
  const seen = [];
  let s = null;
  const measureWraps = (leadEl, pickerEl) => {
    seen.push({ lead: leadEl === s?.lead, picker: pickerEl === s?.picker(), folded: pickerEl.classList.contains('is-folded') });
    return wraps;
  };
  s = setup({ profile: 'compliance', measureWraps });
  await s.shaper();
  assert.ok(s.observers.some((o) => o.targets.includes(s.lead)), 'a ResizeObserver watches the lead row');
  await s.resize();
  assert.ok(s.picker().classList.contains('is-folded'));
  assert.equal(s.picker().getAttribute('aria-label'), 'Your role: Compliance');
  assert.equal(s.picker().title, `Compliance. ${TITLE_NONE}`);
  assert.equal(s.picker().querySelector('svg').innerHTML, glyph(s.doc, 'scale'), 'the role icon stays');
  seen.length = 0;
  await s.resize();
  assert.ok(seen.length, 'measured again on a resize');
  assert.deepEqual(seen.at(-1), { lead: true, picker: true, folded: false }, 'unfolds first, then measures');
  assert.ok(s.picker().classList.contains('is-folded'));
  wraps = false;
  await s.resize();
  assert.equal(s.picker().classList.contains('is-folded'), false);
});

test('R-qa-10: .is-folded hides the name, not the role icon or the arrow (the stylesheet rule)', async () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (css.match(/[^{}]*ask-asker[^{}]*\{[^{}]*\}/g) || []);
  assert.ok(rules.length, 'the stylesheet has rules for the picker');
  let wraps = false;
  const s = setup({ profile: 'ux', measureWraps: () => wraps });
  const style = s.doc.createElement('style');
  style.textContent = rules.join('\n');
  s.doc.head.appendChild(style);
  await s.shaper();
  const parts = () => {
    const btn = s.picker();
    const label = btn.querySelector('.ask-asker-l');
    const svgs = [...btn.querySelectorAll('svg')];
    const box = (svg) => svg.closest('.ask-asker-pick > *');
    return [box(svgs[0]), label, box(svgs.at(-1))].map((el) => s.win.getComputedStyle(el).display === 'none');
  };
  await s.resize();
  assert.deepEqual(parts(), [false, false, false], 'unfolded: icon, name and arrow show');
  wraps = true;
  await s.resize();
  assert.deepEqual(parts(), [false, true, false], 'folded: the icon and the arrow');
});

test('R-arch-6: the picker style is the mock rule, in tokens: no new colour, no motion', () => {
  const css = readStyleCss().replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = (css.match(/[^{}]*ask-asker[^{}]*\{[^{}]*\}/g) || []).map((r) => r.trim());
  const base = rules.find((r) => /^\.chat-composer-lead\s*>\s*\.ask-asker-pick\s*\{/.test(r));
  assert.ok(base, '.chat-composer-lead > .ask-asker-pick');
  const body = base.slice(base.indexOf('{') + 1, -1).replace(/\s*([:;])\s*/g, '$1');
  for (const d of ['gap:5px', 'padding:0 6px', 'color:var(--ink)']) assert.ok(body.includes(d), `${d} in ${body}`);
  for (const r of rules) {
    assert.doesNotMatch(r, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i, r);
    assert.doesNotMatch(r, /animation|transition|violet/, r);
  }
});

test('R-arch-6: the role names are the app\'s lead labels', async () => {
  const s = setup();
  await s.shaper();
  s.picker().click();
  assert.deepEqual(rows(s.doc).slice(0, 7).map(rowLabel), answererLeadKeys({ smallRuns: true }).map(leadLabel));
});

test('R-qa-12: with a role, the sent Shaper text carries exactly one role paragraph right after the lead', async () => {
  const s = setup({ profile: 'compliance' });
  await s.shaper();
  assert.equal(s.sent('Uploads fail'), `${LEAD}\n\nAsking as: compliance.\n\nUploads fail`);
  assert.equal(s.sent('Uploads fail\n\nOn large files'), `${LEAD}\n\nAsking as: compliance.\n\nUploads fail\n\nOn large files`);
  assert.equal(s.sent(''), `${LEAD}\n\nAsking as: compliance.`, 'the lead alone');
  assert.equal(s.sent('x').split('Asking as: ').length - 1, 1);
});

test('every role goes out as its lead key', async () => {
  const s = setup();
  await s.shaper();
  for (const [i, key] of ROLES.entries()) {
    await pick(s, LABELS[i]);
    assert.equal(s.sent('x'), `${LEAD}\n\nAsking as: ${key}.\n\nx`);
  }
});

test('R-qa-12: with no role the sent text is today\'s byte for byte', async () => {
  const s = setup();
  await s.shaper();
  assert.equal(s.sent('Uploads fail'), `${LEAD}\n\nUploads fail`);
  assert.equal(s.sent(''), LEAD);
});

test('R-arch-7: transformSend leaves the text alone with the flag off, no intent, another intent, or a text without the lead', async () => {
  const s = setup({ profile: 'qa' });
  await s.shaper();
  const shaped = `${LEAD}\n\nx`;
  for (const other of ['x', `${LEAD} and more`, `${LEAD}\nx`, `Something else\n\n${LEAD}\n\nx`, `${INTENTS.run.lead}\n\nx`]) {
    assert.equal(s.handle.transformSend(other), other, 'a text that does not start with the lead and a blank line');
  }
  s.state.on = false;                                 // read at the point of use, no change event
  assert.equal(s.handle.transformSend(shaped), shaped, 'flag off');
  assert.equal(s.handle.transformSend(LEAD), LEAD, 'flag off, lead alone');
  s.state.on = true;
  s.intent.set('run', { focus: false });
  assert.equal(s.handle.transformSend(shaped), shaped, 'another intent');
  s.intent.clear();
  assert.equal(s.handle.transformSend(shaped), shaped, 'no intent');
  assert.equal(s.handle.transformSend('hello'), 'hello');
});

test('before the profile lands the picker reads "Your role" and a send carries no role line; Send never waits', async () => {
  const d = deferred();
  const s = setup({ load: () => d.promise });
  await s.shaper();
  assert.equal(s.name(), 'Your role');
  assert.equal(s.sent('x'), `${LEAD}\n\nx`);
  d.resolve({ lead: 'security' });
  await settle();
  assert.equal(s.name(), 'Security');
  assert.equal(s.sent('x'), `${LEAD}\n\nAsking as: security.\n\nx`);
});

test('R-qa-13: the add-on can reword a send but never take or hold one: no beforeSend', () => {
  const s = setup({ pin: 'shape' });
  assert.equal('beforeSend' in s.handle, false);
  assert.equal(s.ctl.addon.id, ROLE_PICKER_ADDON_ID);
  for (const k of ['update', 'transformSend', 'destroy']) assert.equal(typeof s.handle[k], 'function', k);
  assert.doesNotThrow(() => s.handle.update(null));
});

test('R-qa-14: no pin, another pin, or the flag off: no picker in the DOM and the profile is never read', async () => {
  const s = setup({ profile: 'qa' });
  await settle();
  assert.equal(s.picker(), null);
  assert.equal(s.lead.childElementCount, 0, 'the empty lead row stays empty');
  for (const id of Object.keys(INTENTS).filter((x) => x !== 'shape')) {
    s.intent.set(id, { focus: false });
    await settle();
    assert.equal(s.picker(), null, id);
  }
  assert.equal(s.calls.load, 0);
  const off = setup({ flag: false, profile: 'qa' });
  await off.shaper();
  assert.equal(off.picker(), null);
  assert.equal(off.lead.childElementCount, 1, 'only the Shaper pin');
  assert.equal(off.calls.load, 0);
  assert.deepEqual(off.calls.save, []);
});

test('R-qa-14: with the app\'s own loader, no request without the Shaper pin; one read once it is set, none again on re-pin', async () => {
  const urls = [];
  globalThis.fetch = async (url, init) => {
    urls.push(`${init?.method || 'GET'} ${url}`);
    return { ok: true, status: 200, json: async () => ({ lead: 'qa' }) };
  };
  const p = page();
  const intent = createIntentAddon();
  intent.addon.mount(p.lead, p.ctx);
  const flags = { flagOn: () => true, onFlagChange: () => () => {} };
  createRolePicker({ intent, ...flags }).addon.mount(p.lead, p.ctx);
  intent.set('run', { focus: false });
  await settle();
  assert.deepEqual(urls, []);
  intent.set('shape', { focus: false });
  await settle();
  assert.deepEqual(urls, ['GET /api/answerer']);
  assert.equal(p.name(), 'QA');
  intent.clear();
  intent.set('shape', { focus: false });
  await settle();
  assert.deepEqual(urls, ['GET /api/answerer'], 'the cached profile');
  assert.equal(p.name(), 'QA');
});

test('the picker leaves with the pin (cleared, ✕, another intent, spent by its message) and comes back with it', async () => {
  const s = setup({ profile: 'ux' });
  await s.shaper();
  s.intent.clear();
  assert.equal(s.picker(), null);
  assert.equal(s.lead.childElementCount, 0);
  await s.shaper();
  assert.equal(s.lead.querySelectorAll('.ask-asker-pick').length, 1);
  assert.equal(s.name(), 'Design');
  s.lead.querySelector('.chat-intent-x').click();
  assert.equal(s.picker(), null);
  await s.shaper();
  s.intent.set('run', { focus: false });
  assert.equal(s.picker(), null);
  await s.shaper();
  s.intent.set('shape', { focus: false });
  assert.equal(s.lead.querySelectorAll('.ask-asker-pick').length, 1, 'set again: still one picker');
  s.sent('x');
  s.intentHandle.update({ id: 'ask_00000001', messages: [{ role: 'user' }] });
  assert.equal(s.intent.current(), null);
  assert.equal(s.picker(), null);
});

test('the picker follows the flag while the Shaper pin is set', async () => {
  const s = setup({ flag: false, profile: 'qa' });
  await s.shaper();
  assert.equal(s.calls.load, 0);
  s.setFlag(true);
  await settle();
  assert.equal(s.name(), 'QA');
  s.setFlag(false);
  assert.equal(s.picker(), null);
  assert.equal(s.sent('x'), `${LEAD}\n\nx`);
  s.setFlag(true);
  await settle();
  assert.equal(s.lead.querySelectorAll('.ask-asker-pick').length, 1);
});

test('destroy() unsubscribes from the intent and the flag and disconnects the ResizeObserver', async () => {
  const s = setup();
  await s.shaper();
  s.intent.clear();
  s.handle.destroy();
  assert.equal(s.state.intentOffs, 1);
  assert.equal(s.state.flagOffs, 1);
  assert.equal(s.state.subs.size, 0);
  assert.ok(s.observers.every((o) => o.disconnected || !o.targets.length), 'no observer left watching');
  await s.shaper();
  assert.equal(s.picker(), null, 'a destroyed mount paints nothing');
});

test('installRolePicker registers one add-on after the intent chip, and reads the real flag state by default', async () => {
  const p = page();
  globalThis.document = p.doc;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ lead: null }) });
  const intent = installIntentAddon();
  const ctl = installRolePicker({ intent });
  installRolePicker({ intent });
  assert.deepEqual(composerAddons().map((a) => a.id), ['intent', 'role-picker']);
  assert.equal(typeof ctl.role, 'function');
  const handles = composerAddons().map((a) => a.mount(p.lead, p.ctx));
  try {
    intent.set('shape', { focus: false });
    await settle();
    assert.equal(p.picker(), null, 'the flag is off');
    applyFlags({ shaperSmallRuns: true }, p.doc);
    await settle();
    assert.ok(p.picker(), 'turned on: the picker appears');
    applyFlags({ shaperSmallRuns: false }, p.doc);
    assert.equal(p.picker(), null, 'turned off: it leaves');
  } finally {
    for (const h of handles) h.destroy();
    applyFlags({ shaperSmallRuns: false }, p.doc);
  }
});

// R-po-1's example, with the app's own loader and saver against a stand-in for GET/PUT /api/answerer (the server side
// is proved in test/api-answerer.test.mjs). A "next week" / reload is a new page: a fresh cache and a fresh composer.
// The Settings › Chat half of the example belongs to the slice that adds that setting.
test('R-po-1 example: pick Compliance and send; next week it reads "Compliance" with "you, last time"; after "No role" and a reload, "Your role"', async () => {
  let stored = null;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    const method = init?.method || 'GET';
    requests.push(method === 'PUT' ? `PUT ${url} ${init.body}` : `${method} ${url}`);
    if (method === 'PUT') stored = JSON.parse(init.body).lead;
    return { ok: true, status: 200, json: async () => ({ lead: stored }) };
  };
  const visit = async () => {
    _resetAnswerer();
    const p = page();
    const intent = createIntentAddon();
    const intentHandle = intent.addon.mount(p.lead, p.ctx);
    const handle = createRolePicker({ intent, flagOn: () => true, onFlagChange: () => () => {} }).addon.mount(p.lead, p.ctx);
    intent.set('shape', { focus: false });
    await settle();
    return { ...p, sent: (t) => handle.transformSend(intentHandle.transformSend(t)) };
  };

  const first = await visit();
  assert.equal(first.name(), 'Your role');
  await pick(first, 'Compliance');
  assert.equal(first.sent('Uploads fail'), `${LEAD}\n\nAsking as: compliance.\n\nUploads fail`);
  assert.deepEqual(requests.filter((r) => r.startsWith('PUT')), ['PUT /api/answerer {"lead":"compliance"}']);
  closeMenus();

  const nextWeek = await visit();
  assert.equal(nextWeek.name(), 'Compliance');
  nextWeek.picker().click();
  assert.equal(row(nextWeek.doc, 'Compliance').querySelector('.wfv-menu-hint')?.textContent, 'you, last time');
  row(nextWeek.doc, 'No role').click();
  await settle();
  assert.equal(requests.at(-1), 'PUT /api/answerer {"lead":null}');

  const reloaded = await visit();
  assert.equal(reloaded.name(), 'Your role');
  reloaded.picker().click();
  assert.equal(menu(reloaded.doc).querySelector('.wfv-menu-hint'), null);
  assert.equal(reloaded.sent('Uploads fail'), `${LEAD}\n\nUploads fail`);
});

test('app.js installs the picker once, after the intent add-on and before the panel is built', () => {
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  assert.match(app, /import \{[^}]*\binstallRolePicker\b[^}]*\} from '\.\/chat\/role-picker\.mjs';/);
  const calls = [...app.matchAll(/\binstallRolePicker\(\{ intent: chatIntent \}\)/g)];
  assert.equal(calls.length, 1);
  assert.ok(calls[0].index > app.indexOf('installIntentAddon({'), 'after the intent add-on');
  assert.ok(calls[0].index < app.indexOf('askPanel = createAskPanel('), 'before createAskPanel');
});

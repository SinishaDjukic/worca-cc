// test/ui-chat-intent.test.mjs — worca Chat P6: the composer's intent chip (a CONTRACT §2 composer add-on). A quick
// action arms it (icon + label + ✕, the placeholder follows); the chip exists only while an intent is set (P1 hides
// the empty lead row); Backspace in an empty composer removes it; on send ONE plain sentence goes in front of the
// text and the intent lasts until the message lands; it never wipes another add-on's placeholder; the home rotates
// example placeholders while idle.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useDomRelease } from './helpers/jsdom-release.mjs';
import {
  createIntentAddon, installIntentAddon, intentText, splitIntentLead, INTENTS, EXAMPLES, EXAMPLE_MS, INTENT_ADDON_ID,
} from '../ui/public/chat/intent.mjs';
import { composerAddons, _resetChatExtensions } from '../ui/public/chat/extensions.mjs';
import { setShapeFirst } from './helpers/shape-gate.mjs';

const trackDom = useDomRelease(afterEach);
const DEFAULT_PH = 'Ask about any run, agent, or project…';   // P1's resting placeholder (setPlaceholder(null))

function setup({ view = 'home', onSend = null } = {}) {
  const dom = trackDom(new JSDOM(`<!doctype html><body><div class="chat-page" data-chat-page data-view="${view}">
    <div class="ask-composer"><div class="ask-composer-box"><div class="chat-composer-lead" data-chat-composer-lead></div>
    <textarea class="ask-input"></textarea></div></div></div></body>`));
  const doc = dom.window.document;
  const input = doc.querySelector('.ask-input');
  input.placeholder = DEFAULT_PH;
  const timers = { fn: null, ms: 0, cleared: false };
  const win = { setInterval: (fn, ms) => { timers.fn = fn; timers.ms = ms; return 7; }, clearInterval: (id) => { if (id === 7) timers.cleared = true; } };
  const ph = [];
  const focus = [];
  const said = [];
  let thread = null;
  const ctx = {
    doc, fetch: null, threadId: () => (thread ? thread.id : null), thread: () => thread, runStore: null,
    // P1's addonCtx.setPlaceholder: a string shows, null restores the default.
    setPlaceholder: (t) => { ph.push(t); input.placeholder = typeof t === 'string' && t ? t : DEFAULT_PH; },
    focus: () => focus.push(1), announce: (t) => said.push(t),
  };
  const ctl = createIntentAddon({ win, onSend });
  const lead = doc.querySelector('[data-chat-composer-lead]');
  const handle = ctl.addon.mount(lead, ctx);
  return {
    doc, ctl, handle, lead, ph, focus, said, timers, win, input,
    page: doc.querySelector('[data-chat-page]'),
    chip: () => lead.querySelector('.chat-intent'),
    setThread: (t) => { thread = t; },
  };
}
const key = (doc, el, k) => {
  const e = new doc.defaultView.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  el.dispatchEvent(e);
  return e;
};

test('mounting adds nothing to the lead row (P1 hides it while empty); set() adds the chip, swaps the placeholder, announces, focuses', () => {
  const s = setup();
  assert.equal(s.ctl.addon.id, INTENT_ADDON_ID);
  assert.equal(INTENT_ADDON_ID, 'intent');
  assert.equal(s.lead.childElementCount, 0, 'an empty lead row: .chat-composer-lead:empty stays display:none');
  assert.deepEqual(s.ph, [], 'mounting touches no placeholder');
  assert.equal(s.ctl.set('run'), true);
  assert.equal(s.lead.querySelectorAll('.chat-intent').length, 1);
  assert.equal(s.chip().dataset.intent, 'run');
  assert.ok(s.chip().querySelector('.chat-intent-ic svg'), 'the icon');
  assert.equal(s.chip().querySelector('.chat-intent-l').textContent, 'New run');
  const x = s.chip().querySelector('button.chat-intent-x');
  assert.equal(x.getAttribute('aria-label'), 'Remove New run');
  assert.equal(s.input.placeholder, 'Describe the task…');
  assert.deepEqual(s.said, ['New run']);
  assert.equal(s.focus.length, 1);
  assert.equal(s.ctl.set('track', { focus: false }), true);
  assert.equal(s.lead.querySelectorAll('.chat-intent').length, 1, 'one chip, repainted');
  assert.equal(s.focus.length, 1, 'focus:false leaves focus where it is (a run picker is about to open)');
  assert.equal(s.ctl.set('nope'), false);
  assert.equal(s.ctl.current(), 'track', 'an unknown id changes nothing');
});

test('✕ removes the chip from the lead row and gives the placeholder back to the Chat default', () => {
  const s = setup();
  s.ctl.set('script');
  s.chip().querySelector('.chat-intent-x').click();
  assert.equal(s.ctl.current(), null);
  assert.equal(s.chip(), null);
  assert.equal(s.lead.childElementCount, 0);
  assert.equal(s.ph.at(-1), null, 'setPlaceholder(null) = the default');
  assert.equal(s.input.placeholder, DEFAULT_PH);
  assert.equal(s.focus.length, 2, 'the ✕ hands focus back to the composer');
});

test('Backspace in an EMPTY composer removes the chip; with text it is an ordinary Backspace', () => {
  const s = setup();
  s.ctl.set('schedule');
  s.input.value = 'nightly';
  const typed = key(s.doc, s.input, 'Backspace');
  assert.equal(typed.defaultPrevented, false);
  assert.equal(s.ctl.current(), 'schedule');
  s.input.value = '';
  const removed = key(s.doc, s.input, 'Backspace');
  assert.equal(removed.defaultPrevented, true);
  assert.equal(s.ctl.current(), null);
  assert.equal(s.chip(), null);
  const again = key(s.doc, s.input, 'Backspace');
  assert.equal(again.defaultPrevented, false, 'no intent: Backspace is left alone');
});

test('send: transformSend arms the glide on every Ask send and puts ONE sentence in front; the intent lasts until the message lands', async () => {
  let sends = 0;
  const s = setup({ onSend: () => { sends += 1; } });
  assert.equal(await s.handle.beforeSend('hello'), false, 'never takes the send');
  assert.equal(sends, 0, 'beforeSend arms nothing: another add-on may still take the send');
  assert.equal(s.handle.transformSend('hello'), 'hello', 'no intent: the text goes out untouched');
  assert.equal(sends, 1);
  s.ctl.set('track');
  assert.equal(s.handle.transformSend('“Fix it” (#p1)'), 'Track this run here.\n\n“Fix it” (#p1)');
  assert.equal(s.ctl.current(), 'track', 'kept while the send is in flight');
  s.handle.update({ id: 'ask_00000001', messages: [] });
  assert.equal(s.ctl.current(), 'track', 'no message yet (the send failed or is still posting): kept for a retry');
  assert.equal(s.handle.transformSend('again'), 'Track this run here.\n\nagain', 'a retry carries it again');
  s.page.dataset.view = 'thread';                                   // P1 moved to the new chat
  s.handle.update({ id: 'ask_00000001', messages: [] });
  assert.equal(s.ctl.current(), 'track', 'a pending send keeps it across the hero → dock switch');
  s.handle.update({ id: 'ask_00000001', messages: [{ role: 'user' }] });
  assert.equal(s.ctl.current(), null, 'the message landed: the intent is spent');
  assert.equal(s.chip(), null);
  const boom = setup({ onSend: () => { throw new Error('flip failed'); } });
  assert.equal(boom.handle.transformSend('x'), 'x', 'a failing hook never blocks the send');
});

test('a send from a chat that already has messages waits for THAT chat to grow', () => {
  const s = setup();
  s.setThread({ id: 'ask_00000002', messages: [{}, {}] });
  s.ctl.set('diff');
  s.handle.transformSend('“Header” (#p3)');
  s.handle.update({ id: 'ask_00000002', messages: [{}, {}] });
  assert.equal(s.ctl.current(), 'diff');
  s.handle.update({ id: 'ask_00000002', messages: [{}, {}, {}] });
  assert.equal(s.ctl.current(), null);
});

test('leaving the home without sending drops the intent: a later message in another chat is not prefixed', () => {
  const s = setup();
  s.ctl.set('script');
  s.handle.update(null);
  assert.equal(s.ctl.current(), 'script', 'still on the home: kept');
  s.page.dataset.view = 'thread';                                   // a History pick opened another chat
  s.handle.update({ id: 'ask_00000003', messages: [{}, {}] });
  assert.equal(s.ctl.current(), null);
  assert.equal(s.chip(), null);
  assert.equal(s.handle.transformSend('hi'), 'hi');
});

test('leave() (the Chat page was left) drops a set intent, but keeps one riding a send for the retry', () => {
  const s = setup();
  s.ctl.set('script');
  s.ctl.leave();
  assert.equal(s.ctl.current(), null);
  assert.equal(s.chip(), null);
  s.ctl.set('track');
  s.handle.transformSend('x');
  s.ctl.leave();
  assert.equal(s.ctl.current(), 'track', 'a send in flight or refused keeps it');
});

test('placeholder ownership: clearing gives back only a placeholder this add-on put there', () => {
  const s = setup();
  s.ctl.set('run');
  assert.equal(s.input.placeholder, 'Describe the task…');
  // P3's direction chip set its own placeholder in the same flush (it registered first, so it painted first).
  s.input.placeholder = 'Tell the run what to change. The next step reads it';
  const n = s.ph.length;
  s.ctl.clear();
  assert.equal(s.ph.length, n, 'not ours any more: no setPlaceholder(null)');
  assert.equal(s.input.placeholder, 'Tell the run what to change. The next step reads it');
  s.input.placeholder = DEFAULT_PH;
  s.ctl.set('run');
  s.ctl.clear();
  assert.equal(s.ph.at(-1), null, 'ours: given back');
  assert.equal(s.input.placeholder, DEFAULT_PH);
});

test('every intent: a chip label, an icon, a placeholder and one plain sentence ending in a period; Step away comes with its text', () => {
  for (const [id, it] of Object.entries(INTENTS)) {
    assert.ok(it.label && it.icon && it.placeholder, id);
    assert.match(it.lead, /^[A-Z][^\n]*\.$/, `${id}: one sentence`);
    assert.equal(intentText(id, '  '), it.lead, `${id}: the sentence alone when nothing was typed`);
    assert.equal(intentText(id, 'x'), `${it.lead}\n\nx`);
  }
  assert.equal(intentText('nope', ' x '), 'x');
  assert.deepEqual(Object.keys(INTENTS), ['run', 'shape', 'workflow', 'schedule', 'track', 'diff', 'script',
    'away', 'metrics', 'model', 'workspace', 'remember', 'tasks']);
  assert.equal(INTENTS.away.prefill, "I'm away now", 'an empty composer never sends: Step away arrives with its text (P2\'s receipt words, straight apostrophe)');
  assert.equal(INTENTS.metrics.placeholder, 'Which project or workspace?', 'get_team_metrics needs a scope; the range defaults to this month');
  assert.deepEqual(Object.keys(INTENTS).filter((id) => INTENTS[id].prefill), ['away']);
});

test('Shaper (Shape it first): refused while the gate is off; with it on it arms and the send leads with its sentence', () => {
  assert.equal(INTENTS.shape.label, 'Shaper');
  assert.equal(INTENTS.shape.help, undefined);
  assert.equal(INTENTS.shape.badge, 'Labs');
  const s = setup();
  try {
    setShapeFirst(false);
    assert.equal(s.ctl.set('shape'), false, 'gate off (the default): no intent');
    assert.equal(s.ctl.current(), null);
    assert.equal(s.chip(), null);
    setShapeFirst(true);
    assert.equal(s.ctl.set('shape'), true);
    assert.equal(s.ctl.current(), 'shape');
    assert.equal(s.chip().querySelector('.chat-intent-l').textContent, 'Shaper');
    assert.equal(s.input.placeholder, 'Describe the problem…');
    const sent = s.handle.transformSend('Uploads fail on large files');
    assert.ok(sent.startsWith(INTENTS.shape.lead), sent);
    assert.equal(sent, `${INTENTS.shape.lead}\n\nUploads fail on large files`);
  } finally {
    setShapeFirst(false);
  }
});

test('examples rotate on the home while idle; they stop when typing, with an intent, or on a thread — never over an intent', () => {
  const s = setup();
  assert.equal(s.timers.ms, EXAMPLE_MS);
  assert.equal(EXAMPLE_MS, 3500);
  s.timers.fn();
  assert.equal(s.ph.at(-1), EXAMPLES[0]);
  s.timers.fn();
  assert.equal(s.ph.at(-1), EXAMPLES[1]);
  s.input.value = 'x';
  s.timers.fn();
  assert.equal(s.ph.at(-1), null, 'typing drops the example');
  const n = s.ph.length;
  s.timers.fn();
  assert.equal(s.ph.length, n, 'nothing more while the composer has text');
  s.input.value = '';
  s.timers.fn();
  assert.equal(s.ph.at(-1), EXAMPLES[0]);
  s.ctl.set('run');
  assert.equal(s.ph.at(-1), 'Describe the task…');
  s.timers.fn();
  assert.equal(s.ph.at(-1), 'Describe the task…', 'never over an intent');
  s.ctl.clear();
  s.timers.fn();
  assert.equal(s.ph.at(-1), EXAMPLES[0]);
  s.page.dataset.view = 'thread';
  s.handle.update({ id: 'ask_00000001', messages: [] });
  assert.equal(s.ph.at(-1), null, 'the dock never keeps a home example');
  const m = s.ph.length;
  s.timers.fn();
  assert.equal(s.ph.length, m, 'no rotation on a thread');
});

test('destroy stops the timer, the Backspace and address listeners and removes the chip', () => {
  const s = setup();
  s.ctl.set('run');
  s.handle.destroy();
  assert.equal(s.timers.cleared, true);
  assert.equal(s.lead.querySelector('.chat-intent'), null);
  const e = key(s.doc, s.input, 'Backspace');
  assert.equal(e.defaultPrevented, false);
  assert.equal(s.ctl.set('script'), true, 'the controller outlives its mounts');
  s.handle.transformSend('x');                                      // rides a send; the mount's listeners are gone
  const win = s.doc.defaultView;
  win.dispatchEvent(new win.HashChangeEvent('hashchange', { oldURL: 'http://localhost:4317/#chat/ask_0000000a' }));
  assert.equal(s.ctl.current(), 'script', 'the hashchange listener left with its mount');
});

test('a composer mounted while an intent is set shows it at once', () => {
  const s = setup();
  s.ctl.set('away');
  const lead2 = s.doc.createElement('div');
  s.doc.querySelector('.ask-composer-box').prepend(lead2);
  s.ctl.addon.mount(lead2, { doc: s.doc, setPlaceholder: () => {}, focus: () => {}, announce: () => {} });
  assert.ok(lead2.querySelector('.chat-intent'));
  assert.equal(lead2.querySelector('.chat-intent-l').textContent, 'Step away');
});

test('installIntentAddon registers ONE composer add-on with id "intent" (a re-install replaces it)', () => {
  _resetChatExtensions();
  const win = { setInterval: () => 1, clearInterval: () => {} };
  const a = installIntentAddon({ win });
  installIntentAddon({ win });
  const list = composerAddons().filter((x) => x.id === 'intent');
  assert.equal(list.length, 1);
  assert.notEqual(list[0], a.addon, 'the last install wins');
  _resetChatExtensions();
});

test('Backspace inside an IME composition, or with the browser tab hidden: the chip and the examples stay put', () => {
  const s = setup();
  s.ctl.set('run');
  const e = new s.doc.defaultView.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true, isComposing: true });
  s.input.dispatchEvent(e);
  assert.equal(e.defaultPrevented, false);
  assert.equal(s.ctl.current(), 'run');
  const h = setup();
  Object.defineProperty(h.doc, 'visibilityState', { value: 'hidden', configurable: true });
  h.timers.fn();
  assert.deepEqual(h.ph, [], 'no rotation in a hidden tab');
});

test('New chat drops the intent — set, riding a send in flight, or refused: the next chat starts clean', () => {
  const s = setup();
  const nb = s.doc.createElement('button');
  nb.type = 'button';
  nb.setAttribute('data-ask-new-btn', '');                          // P1's head button, inside the page
  s.page.prepend(nb);
  s.ctl.set('run');
  assert.equal(s.handle.transformSend('first task'), 'Propose a pipeline run for this task.\n\nfirst task');
  nb.click();                                                       // P1: newThread() → update(null) on a fresh home
  s.handle.update(null);
  assert.equal(s.ctl.current(), null);
  assert.equal(s.chip(), null);
  assert.equal(s.input.placeholder, DEFAULT_PH);
  assert.equal(s.handle.transformSend('hello'), 'hello', 'the new chat’s first message goes out as typed');
});

test('leaving the chat a send created, by address (the logo, the Chat row, Back), drops the intent riding that send', () => {
  const s = setup();
  const win = s.doc.defaultView;
  const leave = (from) => win.dispatchEvent(new win.HashChangeEvent('hashchange', { oldURL: `http://localhost:4317/${from}`, newURL: 'http://localhost:4317/#chat/new' }));
  s.ctl.set('run');
  leave('#chat/ask_0000000a');
  assert.equal(s.ctl.current(), 'run', 'nothing rode a send: an address change alone keeps the intent on the home');
  assert.equal(s.handle.transformSend('fix it'), 'Propose a pipeline run for this task.\n\nfix it');
  s.setThread({ id: 'ask_0000000a', messages: [] });                // P1 made the chat; its message POST is still out
  leave('#chat/ask_0000000a');
  assert.equal(s.ctl.current(), 'run', 'the page still shows that chat (its run panel, another view): kept');
  s.setThread(null);                                                // the logo: P1 opened a new chat
  leave('#chat/new');
  assert.equal(s.ctl.current(), 'run', 'an address that named no chat: kept');
  leave('#chat/ask_0000000a/run/r1/qa');
  assert.equal(s.ctl.current(), null, 'the chat the send rode is gone from the page: the intent is spent');
  assert.equal(s.chip(), null);
  assert.equal(s.input.placeholder, DEFAULT_PH);
  assert.equal(s.handle.transformSend('what time is it'), 'what time is it', 'the next chat’s first message goes out as typed');
});

test('the examples rotate through every one of them, then start over', () => {
  const s = setup();
  for (const ex of [...EXAMPLES, EXAMPLES[0]]) {
    s.timers.fn();
    assert.equal(s.ph.at(-1), ex);
  }
  assert.equal(EXAMPLES.length, 4);
});

test('splitIntentLead: the Shaper lead is for the model only (D21)', () => {
  const lead = INTENTS.shape.lead;
  assert.equal(lead, 'Shape this task first: propose a run with `shape`.', 'the model-facing lead is unchanged');
  assert.deepEqual(splitIntentLead(`${lead}\n\nUploads fail on large files`), { intent: 'shape', text: 'Uploads fail on large files' });
  assert.deepEqual(splitIntentLead(lead), { intent: 'shape', text: '' });
  assert.deepEqual(splitIntentLead(`${lead}\n\n> From plan.md:\n> x\n\nWhy?`), { intent: 'shape', text: '> From plan.md:\n> x\n\nWhy?' });
  assert.deepEqual(splitIntentLead('Shape this task first please'), { intent: null, text: 'Shape this task first please' });
  assert.deepEqual(splitIntentLead(`${lead} and more`), { intent: null, text: `${lead} and more` }, 'exact lead only');
  assert.deepEqual(splitIntentLead(undefined), { intent: null, text: '' });
  assert.deepEqual(splitIntentLead(`${INTENTS.run.lead}\n\nx`), { intent: null, text: `${INTENTS.run.lead}\n\nx` }, 'other intents unchanged');
});

test('pinned workflow: run intent with the workflow names the chip, keeps the run placeholder and leads with its id', () => {
  const s = setup();
  s.ctl.set('run', { workflow: { id: 'wf_pay', name: 'Payroll close' } });
  assert.equal(s.doc.querySelector('.chat-intent-l').textContent, 'Payroll close');
  assert.equal(s.doc.querySelector('.chat-intent-x').getAttribute('aria-label'), 'Remove Payroll close');
  assert.equal(s.input.placeholder, INTENTS.run.placeholder);
  assert.equal(s.handle.transformSend('close October'),
    'Propose a pipeline run of workflow wf_pay ("Payroll close") for this task.\n\nclose October');
});

test('re-arming run with another workflow repaints; plain run keeps its lead byte for byte', () => {
  const s = setup();
  s.ctl.set('run', { workflow: { id: 'wf_pay', name: 'Payroll close' } });
  s.ctl.set('run', { workflow: { id: 'wf_post', name: 'Social post' } });
  assert.equal(s.doc.querySelector('.chat-intent-l').textContent, 'Social post');
  s.ctl.set('run');
  assert.equal(s.doc.querySelector('.chat-intent-l').textContent, 'New run');
  assert.equal(intentText('run', 'x'), 'Propose a pipeline run for this task.\n\nx');
  assert.equal(s.ctl.workflow(), null);
});

test('a workflow on any intent but run is ignored', () => {
  const s = setup();
  s.ctl.set('script', { workflow: { id: 'wf_pay', name: 'Payroll close' } });
  assert.equal(s.doc.querySelector('.chat-intent-l').textContent, 'Write a script');
  assert.equal(s.ctl.workflow(), null);
});

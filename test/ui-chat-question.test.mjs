// test/ui-chat-question.test.mjs — Projects, any way P4b: the chat question card, built from data alone (no run): the
// Runs page's ask-card grammar, keyboard picks, the submit and its error, the answered card, the closed line, focus kept.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildChatQuestion, buildChatReceipt } from '../ui/public/chat/question.mjs';
import { keepFocus } from '../ui/public/chat/keep-focus.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
function rig() { const dom = new JSDOM('<!doctype html><html><body></body></html>'); doms.push(dom); return { doc: dom.window.document, win: dom.window }; }
const tick = () => new Promise((r) => setTimeout(r, 0));
const keyOn = (win, el, key, init = {}) => { const e = new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }); el.dispatchEvent(e); return e; };
function spec(doc, over = {}) {
  const chip = doc.createElement('span'); chip.className = 'kind-chip kind-git'; chip.textContent = 'Git';
  return {
    id: 'chat-q-card_00000009',
    heading: 'Your turn: pick a project',
    questions: [{ id: 'project', text: 'Which project is this for?', why: 'Both Havn apps have a booking screen.', options: [
      { value: 'havn-and-00000001', label: 'Havn Android', chip, sub: '/Users/me/Develop/havn-android' },
      { value: 'havn-ios-00000002', label: 'Havn IOS', sub: 'C:\\Users\\me\\Develop\\Havn' },
      { value: 'none', label: 'Continue without project' },
    ] }],
    submitLabel: (picks) => (picks.get('project') ? `Go ${picks.get('project')}` : 'Go'),
    onSubmit: async () => {},
    ...over,
  };
}

test('markup: the heading outside the card, one white clarify card with keyed tiles, the pill footer, a quiet error line', () => {
  const { doc } = rig();
  const { el } = buildChatQuestion(doc, spec(doc));
  assert.equal(el.tagName, 'SECTION');
  assert.deepEqual([...el.classList], ['chat-rc-q', 'chat-q']);
  const head = el.querySelector(':scope > h3.chat-rc-q-head');
  assert.deepEqual([head.textContent, head.id, el.getAttribute('aria-labelledby')], ['Your turn: pick a project', 'chat-q-card_00000009-h', 'chat-q-card_00000009-h']);
  const panel = el.querySelector(':scope > .chat-rc-qbody > .qpanel');
  assert.equal(panel.dataset.kind, 'clarify', 'the white per-question grammar, never the base amber .qpanel');
  const qb = panel.querySelector(':scope > .qblock');
  assert.equal(qb.dataset.q, 'project');
  assert.deepEqual(['.qn', '.qtext-t', '.qwhy'].map((s) => qb.querySelector(`.qtext > ${s}`).textContent), ['1', 'Which project is this for?', 'Both Havn apps have a booking screen.']);
  const group = qb.querySelector(':scope > .qopts');
  assert.deepEqual([group.getAttribute('role'), group.getAttribute('aria-label')], ['group', 'Which project is this for?']);
  const opts = [...group.querySelectorAll(':scope > button.qopt')];
  assert.deepEqual(opts.map((o) => [o.type, o.dataset.key, o.dataset.value, o.getAttribute('aria-pressed'), o.querySelector('.chat-q-opt-label').textContent, o.querySelector('.kind-chip')?.textContent ?? null, o.querySelector('.chat-q-opt-sub')?.textContent ?? null]), [
    ['button', 'A', 'havn-and-00000001', 'false', 'Havn Android', 'Git', '/Users/me/Develop/havn-android'],
    ['button', 'B', 'havn-ios-00000002', 'false', 'Havn IOS', null, 'C:\\Users\\me\\Develop\\Havn'],
    ['button', 'C', 'none', 'false', 'Continue without project', null, null],
  ]);
  const foot = panel.querySelector(':scope > .qpanel-foot');
  assert.equal(foot.querySelector('.qanswered').textContent, '0 of 1 answered');
  const go = foot.querySelector('button[data-qpanel-submit]');
  assert.deepEqual([go.type, go.textContent, go.disabled], ['button', 'Go', true]);
  const err = el.querySelector(':scope > .chat-rc-q-err');
  assert.deepEqual([err.hidden, err.getAttribute('role')], [true, 'status']);
});

test('a pick: one option pressed, the count and the submit label follow it; another pick moves it', () => {
  const { doc } = rig();
  const { el, picks } = buildChatQuestion(doc, spec(doc));
  const opts = [...el.querySelectorAll('.qopt')];
  const go = el.querySelector('[data-qpanel-submit]');
  opts[1].click();
  assert.deepEqual(opts.map((o) => [o.classList.contains('sel'), o.getAttribute('aria-pressed')]), [[false, 'false'], [true, 'true'], [false, 'false']]);
  assert.equal(el.querySelector('.qanswered').textContent, '1 of 1 answered');
  assert.deepEqual([go.textContent, go.disabled], ['Go havn-ios-00000002', false]);
  opts[2].click();
  assert.deepEqual(opts.map((o) => o.classList.contains('sel')), [false, false, true]);
  assert.equal(go.textContent, 'Go none');
  assert.deepEqual([...picks()], [['project', 'none']]);
});

test('keyboard: arrows move and pick (wrapping), a letter picks its option from anywhere in the card, Enter on an option submits it, modifiers do nothing', async () => {
  const { doc, win } = rig();
  const sent = [];
  const { el } = buildChatQuestion(doc, spec(doc, { onSubmit: async (p) => { sent.push(Object.fromEntries(p)); } }));
  doc.body.appendChild(el);
  const opts = [...el.querySelectorAll('.qopt')];
  opts[0].focus();
  assert.equal(keyOn(win, opts[0], 'ArrowDown').defaultPrevented, true);
  assert.deepEqual([doc.activeElement, opts[1].getAttribute('aria-pressed')], [opts[1], 'true']);
  keyOn(win, opts[1], 'ArrowRight'); assert.equal(doc.activeElement, opts[2]);
  keyOn(win, opts[2], 'ArrowDown'); assert.equal(doc.activeElement, opts[0], 'wraps to the first');
  keyOn(win, opts[0], 'ArrowUp'); assert.equal(doc.activeElement, opts[2], 'and back to the last');
  keyOn(win, opts[2], 'ArrowLeft'); assert.equal(doc.activeElement, opts[1]);
  const go = el.querySelector('[data-qpanel-submit]');
  go.focus();
  keyOn(win, go, 'a');
  assert.deepEqual([doc.activeElement, opts[0].getAttribute('aria-pressed')], [opts[0], 'true'], 'a letter, lower case too');
  keyOn(win, opts[0], 'c', { ctrlKey: true });
  assert.equal(opts[0].getAttribute('aria-pressed'), 'true', 'Ctrl+C is not a pick');
  keyOn(win, opts[0], 'x');
  assert.equal(doc.activeElement, opts[0], 'a letter with no option does nothing');
  assert.deepEqual(sent, []);
  opts[1].focus();
  assert.equal(keyOn(win, opts[1], 'Enter').defaultPrevented, true);
  await tick();
  assert.deepEqual(sent, [{ project: 'havn-ios-00000002' }], 'Enter picks the focused option and submits');
});

test('a letter picks in the question that holds the focus, else in the first', () => {
  const { doc, win } = rig();
  const q = (id) => ({ id, text: id, options: [{ value: `${id}-a`, label: 'A' }, { value: `${id}-b`, label: 'B' }] });
  const { el, picks } = buildChatQuestion(doc, spec(doc, { questions: [q('one'), q('two')] }));
  doc.body.appendChild(el);
  const second = el.querySelectorAll('.qblock')[1].querySelectorAll('.qopt');
  second[0].focus();
  keyOn(win, second[0], 'b');
  assert.deepEqual([[...picks()], doc.activeElement], [[['two', 'two-b']], second[1]]);
  doc.activeElement.blur();
  keyOn(win, el.querySelector('.qpanel'), 'b');
  assert.deepEqual([...picks()], [['two', 'two-b'], ['one', 'one-b']], 'no question holds the focus: the first');
});

test('submit: everything waits while it is sent; a refusal shows its words in the card and gives the controls back; an empty one says Answer not sent', async () => {
  const { doc, win } = rig();
  let settleIt = null;
  const { el } = buildChatQuestion(doc, spec(doc, { onSubmit: () => new Promise((res, rej) => { settleIt = { res, rej }; }) }));
  doc.body.appendChild(el);
  const buttons = () => [...el.querySelectorAll('button')].map((b) => b.disabled);
  const err = el.querySelector('.chat-rc-q-err');
  el.querySelector('.qopt').click();
  el.querySelector('[data-qpanel-submit]').click();
  assert.deepEqual(buttons(), [true, true, true, true]);
  keyOn(win, el.querySelectorAll('.qopt')[1], 'b');
  assert.deepEqual([buttons(), el.querySelector('.qopt.sel').dataset.key], [[true, true, true, true], 'A'], 'no pick while the answer is in flight');
  settleIt.rej(new Error('this chat already has a project'));
  await tick();
  assert.deepEqual([err.hidden, err.textContent], [false, 'this chat already has a project']);
  assert.deepEqual(buttons(), [false, false, false, false]);
  assert.equal(doc.activeElement, el.querySelector('[data-qpanel-submit]'), 'the focus waits on the submit for a retry');
  el.querySelector('[data-qpanel-submit]').click();
  settleIt.rej(new Error(''));
  await tick();
  assert.equal(err.textContent, 'Answer not sent');
  el.querySelector('[data-qpanel-submit]').click();
  settleIt.res();
  await tick();
  assert.equal(err.hidden, true);
  assert.deepEqual(buttons(), [true, true, true, true], 'sent: the card waits for its answered state');
  keyOn(win, el.querySelectorAll('.qopt')[1], 'b');
  assert.deepEqual(buttons(), [true, true, true, true], 'a sent card takes no more picks');
});

test('answered (canvas SwitchAsk, B9): the card stays a card — the pick marked (the Answered pill), every tile disabled, no footer', () => {
  const { doc, win } = rig();
  const sent = [];
  const { el } = buildChatQuestion(doc, spec(doc, { answered: new Map([['project', 'havn-ios-00000002']]), onSubmit: async () => { sent.push(1); } }));
  doc.body.appendChild(el);
  assert.deepEqual([...el.classList], ['chat-rc-q', 'chat-q', 'is-answered']);
  assert.equal(el.querySelector('.chat-rc-q-head').textContent, 'Your turn: pick a project');
  const opts = [...el.querySelectorAll('.qopt')];
  assert.deepEqual(opts.map((o) => [o.classList.contains('sel'), o.getAttribute('aria-pressed'), o.disabled]), [[false, 'false', true], [true, 'true', true], [false, 'false', true]],
    'the picked tile is .sel: style.css draws the green Answered pill beside the number (.qblock:has(.qopt.sel))');
  assert.equal(el.querySelector('.qpanel-foot'), null, 'nothing left to submit');
  keyOn(win, opts[0], 'a');
  keyOn(win, opts[0], 'Enter');
  assert.deepEqual([opts[0].classList.contains('sel'), sent], [false, []], 'no keys act on an answered card');
});

test('buildChatReceipt: a closed question is one plain line, never the question', () => {
  const { doc } = rig();
  const el = buildChatReceipt(doc, 'Not answered');
  assert.deepEqual([...el.classList], ['chat-rc-q', 'chat-q', 'is-closed']);
  assert.equal(el.getAttribute('aria-label'), 'Question');
  const line = el.querySelector(':scope > .chat-rc-receipt');
  assert.deepEqual([line.tagName, line.textContent], ['DIV', 'Not answered']);
  assert.equal(el.querySelector('.qpanel'), null);
});

test('keepFocus (#958): a control moved inside the root gets the focus back when it fell to <body>; destroy() ends it', async () => {
  const { doc } = rig();
  const root = doc.createElement('div');
  const a = doc.createElement('div'); const b = doc.createElement('div');
  root.append(a, b); doc.body.appendChild(root);
  const { el } = buildChatQuestion(doc, spec(doc));
  a.appendChild(el);
  const keeper = keepFocus(root, doc);
  const opt = el.querySelectorAll('.qopt')[1];
  opt.focus();
  b.appendChild(el);                                   // moved into another row
  await tick();
  assert.equal(doc.activeElement, opt, 'moved to another row: refocused');
  a.appendChild(el); a.removeChild(el); a.appendChild(el);   // out and back into the same row
  await tick();
  assert.equal(doc.activeElement, opt, 'back in the same row: refocused');
  keeper.destroy();
  opt.focus();
  b.appendChild(el);
  await tick();
  assert.notEqual(doc.activeElement, opt, 'destroyed: no watch');
  root.remove();
});

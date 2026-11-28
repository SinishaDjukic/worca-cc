// test/ui-shape-gap-question.test.mjs — Shaper small runs slice 8 (D13): the Verifier's gap question
// (ui/public/shape/gap-question.mjs). One question per gap, three answers, a reason to ship with the gap, the new text to
// change the requirement, and one "Send answers". The stop is hand-built from the shared contract.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildGapQuestion } from '../ui/public/shape/gap-question.mjs';

const doms = [];
afterEach(() => { for (const d of doms.splice(0)) d.window.close(); });
const flush = async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0)); };

const WHY_PO = 'the export skips archived runs';
const WHY_UX = 'the list wraps onto two lines';
const STOP = {
  reason: 'check', run: null, node: 'n_verify', form: 'gaps', pick: 'fix', head: 'Verifier · 2 gaps found',
  text: `R-po-2: ${WHY_PO} and 1 more. No run is added until each gap is answered.`, findingsLine: '2 gaps open',
  gaps: [{ id: 'R-po-2', why: WHY_PO, text: 'People export every run' }, { id: 'R-ux-1', why: WHY_UX, text: 'The list is dense' }],
  answers: [
    { value: 'fix', label: 'Add a fix run', sub: 'One more run closes it, then the Verifier checks again' },
    { value: 'ship', label: 'Ship with the gap', sub: 'Say why it can ship as is' },
    { value: 'change', label: 'Change the requirement', sub: 'A change run builds the new text, then the Verifier checks it' },
  ],
  options: [{ value: 'answer', label: 'Send answers', sub: 'Every gap answered, then Worca adds the runs', go: 'Send answers', short: 'answered the gaps',
    payload: { decision: 'answer' } }],
};

function mount({ submit = async () => true, stop = STOP } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  doms.push(dom);
  const doc = dom.window.document;
  const host = doc.body.appendChild(doc.createElement('div'));
  const posts = [];
  host.appendChild(buildGapQuestion(doc, stop, { submit: (p) => { posts.push(p); return submit(p); } }));
  const panel = host.querySelector('.qpanel[data-kind="gaps"]');
  assert.ok(panel, 'the panel is .qpanel[data-kind=gaps]');
  const blocks = () => [...panel.querySelectorAll('.qblock')];
  /** The elements matching `sel` of gap `i`: inside its block, or between it and the next one. */
  const under = (i, sel) => [...panel.querySelectorAll(sel)].filter((el) => {
    const mine = blocks()[i]; const next = blocks()[i + 1];
    return mine.contains(el) || (!!(mine.compareDocumentPosition(el) & 4) && (!next || (!next.contains(el) && !!(el.compareDocumentPosition(next) & 4))));
  });
  const shown = (els) => els.filter((el) => !el.closest('[hidden], .hidden'));
  const reasonOf = (i) => shown(under(i, 'input.input.input-sm'))[0] || null;
  const textOf = (i) => shown(under(i, 'textarea'))[0] || null;
  const pick = (i, value) => blocks()[i].querySelector(`.qopt[data-value="${value}"]`).click();
  const send = () => [...panel.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Send answers');
  const type = (field, value) => { field.value = value; field.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const picked = (i) => [...blocks()[i].querySelectorAll('.qopt[aria-pressed="true"]')].map((t) => t.dataset.value);
  return { dom, doc, host, panel, posts, blocks, under, reasonOf, textOf, pick, send, type, picked };
}

test('2 gaps give 2 questions of 3 answers each, Add a fix run preset, one Send answers and no fields', () => {
  const g = mount();
  assert.equal(g.blocks().length, 2);
  for (const [i, gap] of STOP.gaps.entries()) {
    const b = g.blocks()[i];
    assert.deepEqual([...b.querySelectorAll('.qopt .chat-q-opt-label')].map((x) => x.textContent), STOP.answers.map((a) => a.label));
    assert.deepEqual([...b.querySelectorAll('.qopt .chat-q-opt-sub')].map((x) => x.textContent), STOP.answers.map((a) => a.sub));
    assert.deepEqual([...b.querySelectorAll('.qopt[data-preset="1"]')].map((t) => t.dataset.value), ['fix']);
    assert.ok(b.textContent.includes(gap.id) && b.textContent.includes(gap.why), `${gap.id} names itself and its why`);
    assert.equal(g.reasonOf(i), null);
    assert.equal(g.textOf(i), null);
  }
  assert.equal([...g.panel.querySelectorAll('.btn-primary')].length, 1, 'one primary');
  assert.equal([...g.panel.querySelectorAll('button')].filter((b) => b.textContent.trim() === 'Send answers').length, 1);
  assert.equal(g.send().disabled, false, 'every gap is preset');
});

test('the why of each gap appears once', () => {
  const g = mount();
  for (const why of [WHY_PO, WHY_UX]) assert.equal(g.host.textContent.split(why).length - 1, 1, why);
});

test('Send posts the fix presets as they are', async () => {
  const g = mount();
  g.send().click();
  await flush();
  assert.deepEqual(g.posts, [{ decision: 'answer', answers: [{ id: 'R-po-2', answer: 'fix' }, { id: 'R-ux-1', answer: 'fix' }] }]);
});

test('Ship with the gap shows a reason input under that gap, and Send stays disabled while it is empty', async () => {
  const g = mount();
  g.pick(0, 'ship');
  const reason = g.reasonOf(0);
  assert.ok(reason, 'a reason input under R-po-2');
  assert.equal(g.reasonOf(1), null);
  assert.equal(reason.maxLength, 300);
  assert.equal(g.send().disabled, true);
  g.send().click();
  await flush();
  assert.deepEqual(g.posts, []);
  g.type(g.reasonOf(0), '   ');
  assert.equal(g.send().disabled, true, 'blank is empty');
  g.type(g.reasonOf(0), 'covered by a later feature');
  assert.equal(g.send().disabled, false);
  g.pick(0, 'fix');
  assert.equal(g.reasonOf(0), null, 'the field goes with the answer');
  assert.equal(g.send().disabled, false);
});

test('Change the requirement shows a textarea prefilled with the current text; Send needs a text', () => {
  const g = mount();
  g.pick(1, 'change');
  const area = g.textOf(1);
  assert.ok(area, 'a textarea under R-ux-1');
  assert.equal(area.value, 'The list is dense');
  assert.equal(g.textOf(0), null);
  g.type(area, '');
  assert.equal(g.send().disabled, true);
  g.type(g.textOf(1), 'The list shows one line per run');
  assert.equal(g.send().disabled, false);
});

test('Send posts exactly one answer per gap, in order, with the reason and the new text', async () => {
  const g = mount();
  g.pick(1, 'change');
  g.type(g.textOf(1), 'The list shows one line per run');
  g.pick(0, 'ship');
  g.type(g.reasonOf(0), 'covered by a later feature');
  assert.equal(g.textOf(1).value, 'The list shows one line per run', 'picking in one gap keeps the other\'s text');
  g.send().click();
  await flush();
  assert.deepEqual(g.posts, [{ decision: 'answer', answers: [
    { id: 'R-po-2', answer: 'ship', reason: 'covered by a later feature' },
    { id: 'R-ux-1', answer: 'change', text: 'The list shows one line per run' }] }]);
});

test('typing a, b or c in the reason or the text types: it never picks another answer', () => {
  const g = mount();
  g.pick(0, 'ship');
  g.pick(1, 'change');
  for (const [i, field, answer] of [[0, g.reasonOf(0), 'ship'], [1, g.textOf(1), 'change']]) {
    for (const key of ['a', 'b', 'c', 'A']) {
      const e = new g.dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      field.dispatchEvent(e);
      assert.equal(e.defaultPrevented, false, `${answer}: ${key}`);
    }
    assert.deepEqual(g.picked(i), [answer]);
    assert.deepEqual(g.picked(1 - i), [i === 0 ? 'change' : 'ship']);
  }
});

test('a refused answer shows the server\'s reason under the gap it names and keeps the answers', async () => {
  const refusal = 'R-ux-1 already reads that';
  const g = mount({ submit: async () => refusal });
  g.pick(1, 'change');
  g.send().click();
  await flush();
  assert.equal(g.posts.length, 1);
  const said = g.under(1, '.plan-err').filter((el) => el.textContent.includes(refusal) && !el.closest('[hidden], .hidden'));
  assert.equal(said.length, 1, 'under R-ux-1');
  assert.equal(g.host.textContent.split(refusal).length - 1, 1, 'said once');
  assert.equal(g.send().disabled, false, 'the person can answer again');
  assert.deepEqual(g.picked(1), ['change']);
  assert.equal(g.textOf(1).value, 'The list is dense');
});

// Slice 10 (R-po-5, D12): what Away mode already answered, and why a gap is held for the person.
const HELD_LINE = 'Held for you: the Verifier calls this a judgement call';
const AWAY_ROW = 'R-po-1 → fix · decided by Away mode';
const MIXED = { ...STOP, head: 'Verifier · 1 gap found', findingsLine: '1 gap open',
  gaps: [{ id: 'R-po-2', why: WHY_PO, text: 'People export every run', kind: 'judgement', hold: 'the Verifier calls this a judgement call' }],
  decided: [{ id: 'R-po-1', answer: 'fix', by: 'away' }] };
const reads = (root, text) => [...root.querySelectorAll('*')].filter((el) => el.textContent.replace(/\s+/g, ' ').trim() === text);

test('a stop with a decided gap shows one Away row above the questions and no answer buttons for it', async () => {
  const g = mount({ stop: MIXED });
  const rows = reads(g.host, AWAY_ROW);
  assert.ok(rows.length >= 1, `the row "${AWAY_ROW}"`);
  const meta = rows.filter((el) => el.classList.contains('meta'));
  assert.ok(meta.length, 'the row is .meta text');
  assert.equal(g.host.textContent.split('decided by Away mode').length - 1, 1, 'said once');
  assert.ok(meta[0].compareDocumentPosition(g.blocks()[0]) & 4, 'above the questions');
  assert.deepEqual(g.blocks().map((b) => b.dataset.q), ['R-po-2'], 'no answer buttons for R-po-1');
  g.send().click();
  await flush();
  assert.deepEqual(g.posts, [{ decision: 'answer', answers: [{ id: 'R-po-2', answer: 'fix' }] }]);
});

test('a held gap says why it is held, once, with that gap', () => {
  const g = mount({ stop: { ...MIXED, gaps: [MIXED.gaps[0], STOP.gaps[1]] } });
  assert.ok(reads(g.host, HELD_LINE).length >= 1, `the line "${HELD_LINE}"`);
  assert.equal(g.host.textContent.split('Held for you:').length - 1, 1, 'only the held kind has the line');
  assert.ok(g.under(0, '*').some((el) => el.textContent.replace(/\s+/g, ' ').trim() === HELD_LINE), 'with R-po-2');
});

test('a stop with no kind and nothing decided reads as before: no held line and no decided row', () => {
  const g = mount();
  assert.doesNotMatch(g.host.textContent, /Held for you|decided by/);
});

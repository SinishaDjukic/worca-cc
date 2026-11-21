// test/ui-workflow-test-liked-suggest.test.mjs — board 2's liked row, board 3's liked box and chips, board 6's pair block
// (plans/workflow-tests-part4-plan.md Task 24; P4-M2, P4-M6, P4-M7 and board 58's words, approved 2026-11-20).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { likedRow, openLikedDialog } from '../ui/public/workflows/criteria-editor.mjs';
import { pairBlock, pairReasonText } from '../ui/public/workflows/criteria-rows.mjs';
import { openFromRunDialog } from '../ui/public/workflows/test-dialogs.mjs';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';
import { renderExampleEditor } from '../ui/public/workflows/example-editor.mjs';

const dom = () => { const d = new JSDOM('<!doctype html><body></body>'); return { doc: d.window.document, win: d.window }; };
const tick = () => new Promise((r) => setTimeout(r, 0));
const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const NOTE = 'When you disagree, Worca notes it. Over time this shows how far Worca\'s checking can be trusted.';

test('board 2 and 32: the liked row', () => {
  const { doc } = dom();
  const row = likedRow(doc, { kind: 'text', name: 'brief-bulk-export-good.md', size: 900 }, { project: false, onReplace: () => {}, onRemove: () => {} });
  assert.match(row.textContent, /A result you liked · optional[\s\S]*Worca also says which result is closer to this one\.[\s\S]*brief-bulk-export-good\.md[\s\S]*Replace/);
  const p = likedRow(doc, { kind: 'changes', name: 'Changes from the run on 28 Oct · 3 files', size: 900 }, { project: true, onReplace: () => {}, onRemove: () => {} });
  assert.match(p.textContent, /which changes are closer to these\.[\s\S]*Changes from the run on 28 Oct · 3 files/);
});

test('P4-M2: Remove beside Replace, the empty row on a saved example, and the row of an example not saved yet', () => {
  const { doc } = dom();
  const did = [];
  const row = likedRow(doc, { kind: 'text', name: 'good.md', size: 9 }, { onReplace: () => did.push('replace'), onRemove: () => did.push('remove') });
  assert.equal(row.querySelector('.wft-liked-file').textContent, 'good.md');
  assert.ok(!row.querySelector('.wft-liked-file').classList.contains('is-plain'), 'a file name in code font');
  const rm = row.querySelector('button.wft-liked-rm');
  assert.equal(rm.getAttribute('aria-label'), 'Remove the result you liked');
  assert.ok(rm.querySelector('svg'), 'an icon from icons.mjs');
  click([...row.querySelectorAll('button')].find((b) => b.textContent === 'Replace'));
  click(rm);
  assert.deepEqual(did, ['replace', 'remove']);
  const changes = likedRow(doc, { kind: 'changes', name: 'Changes from the run on 28 Oct · 3 files', size: 9 }, { project: true, onReplace() {}, onRemove() {} });
  assert.ok(changes.querySelector('.wft-liked-file').classList.contains('is-plain'), 'changes are named in plain words');
  assert.equal(changes.querySelector('button.wft-liked-rm').getAttribute('aria-label'), 'Remove the changes you liked');
  const empty = likedRow(doc, null, { onReplace: () => did.push('add'), onRemove() {} });
  assert.equal(empty.querySelector('.wft-grp').textContent, 'A result you liked · optional');
  assert.equal(empty.querySelector('.wft-grp-hint').textContent, 'When two versions are compared, Worca also says which result is closer to this one.');
  const add = empty.querySelector('button');
  assert.deepEqual([add.textContent, add.disabled], ['Add a result you liked', false]);
  assert.equal(empty.querySelector('.wft-liked-rm'), null);
  click(add);
  assert.equal(did.at(-1), 'add');
  const unsaved = likedRow(doc, null, { saved: false, onReplace: () => did.push('never'), onRemove() {} });
  assert.equal(unsaved.querySelector('button').disabled, true);
  assert.equal(unsaved.querySelector('.hint').textContent, 'Save the example first.');
});

test('P4-M2: the dialog: upload a file, or use a try\'s result; the server\'s words stay in the dialog', async () => {
  const { doc, win } = dom();
  const sent = [];
  openLikedDialog({ doc, win, tries: [{ id: 41, label: 'v4 · try 2 · 14 Oct · passed' }, { id: 40, label: 'v4 · try 1 · 14 Oct · passed' }],
    onFile: async () => ({ ok: true }), onTry: async (id) => { sent.push(id); return sent.length === 1 ? { ok: false, error: 'A test try cannot become a result you liked; pick it as a try instead.' } : { ok: true }; } });
  assert.equal(doc.querySelector('#mk-dialog-title').textContent, 'A result you liked');
  const file = doc.getElementById('wft-liked-file');
  assert.equal(file.type, 'file');
  assert.equal(doc.querySelector('label[for="wft-liked-file"]').textContent, 'Upload a file');
  assert.equal(file.closest('.field').querySelector('.hint').textContent, 'A text file, at most 2 MB.');
  assert.equal(doc.querySelector('label[for="wft-liked-try"]').textContent, "Or use a try's result");
  assert.deepEqual([...doc.getElementById('wft-liked-try').options].map((o) => o.textContent), ['v4 · try 2 · 14 Oct · passed', 'v4 · try 1 · 14 Oct · passed']);
  const ok = doc.querySelector('.wft-dlg-ok');
  assert.equal(ok.textContent, 'Keep it');
  click(ok);
  await tick();
  assert.deepEqual(sent, [41]);
  assert.equal(doc.querySelector('.wft-dlg-error').textContent, 'A test try cannot become a result you liked; pick it as a try instead.');
  click(ok);
  await tick();
  assert.equal(doc.querySelector('#mk-dialog'), null, 'closes once kept');
  // No try to pick: only the upload, and nothing picked says so.
  const b = dom();
  openLikedDialog({ doc: b.doc, win: b.win, tries: [], onFile: async () => ({ ok: true }), onTry: async () => ({ ok: true }) });
  assert.equal(b.doc.getElementById('wft-liked-try'), null);
  click(b.doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(b.doc.querySelector('.wft-dlg-error').textContent, 'Pick a file first.');
});

test('the editor shows the row under the criteria; Replace and Remove save at once and repaint the row only', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const doc = window.document;
  const calls = [];
  const ex = { id: 4, name: 'Bulk invoice export', request: 'R', answers: [], otherwise: 'pick', basics: { noError: true, noHelp: true, maxCostUsd: null, maxSentBack: null },
    checks: [], tries: 3, files: [], note: null, criteria: [], judge: null, liked: null };
  const actions = { back() {}, save: async () => ({ ok: true }), tryOnce: async () => ({ ok: true }),
    putLiked: async (b) => { calls.push(['put', b]); return { ok: true, example: { ...ex, liked: { kind: 'text', name: 'v4 · try 2', size: 5 } } }; },
    removeLiked: async () => { calls.push(['remove']); return { ok: true, example: { ...ex, liked: null } }; } };
  const root = doc.getElementById('root');
  renderExampleEditor(root, ex, actions, { doc, win: window, likedTries: [{ id: 41, label: 'v4 · try 2 · 14 Oct · passed' }] });
  const grps = [...root.querySelectorAll('.wft-c3 .wft-grp')].map((g) => g.textContent);
  assert.deepEqual(grps.slice(-2), ['Your criteria', 'A result you liked · optional']);
  const name = root.querySelector('#wft-ex-name');
  name.value = 'Edited, not saved';
  click([...root.querySelectorAll('.wft-liked button')].find((b) => b.textContent === 'Add a result you liked'));
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(calls, [['put', { tryId: 41 }]]);
  assert.equal(root.querySelector('.wft-liked .wft-liked-file').textContent, 'v4 · try 2');
  assert.equal(name.value, 'Edited, not saved', 'the rest of the editor is not repainted');
  click(root.querySelector('.wft-liked button.wft-liked-rm'));
  await tick();
  assert.deepEqual(calls.at(-1), ['remove']);
  assert.equal(root.querySelector('.wft-liked .wft-liked-file'), null);
  assert.equal(doc.activeElement.textContent, 'Add a result you liked', 'the focus stays on the row');
  // A new example: the row waits for the first save.
  const fresh = doc.createElement('section');
  renderExampleEditor(fresh, { ...ex, id: null }, actions, { doc, win: window });
  const add = [...fresh.querySelectorAll('.wft-liked button')].find((b) => b.textContent === 'Add a result you liked');
  assert.equal(add.disabled, true);
});

test('board 6: the pair block names the winner by its version, never by "Result 1"', () => {
  const { doc } = dom();
  const sent = [];
  const b = pairBlock(doc, { judgementId: 5, winner: 'a', reason: 'It sets a goal you can measure.', question: 'better', answer: null }, { a: 'v4', b: 'v5 draft' },
    { onAnswer: (id, agree) => sent.push([id, agree]) });
  assert.match(b.textContent, /Which result is better overall\?[\s\S]*Worca read both without knowing which version wrote which\.[\s\S]*v4's result\.[\s\S]*It sets a goal you can measure\./);
  b.querySelector('button.wft-agree').click();
  assert.deepEqual(sent, [[5, true]]);
  assert.match(pairBlock(doc, { judgementId: 6, winner: 'unsure', reason: 'x', question: 'liked', answer: null }, { a: 'v4', b: 'v5' }, { onAnswer: () => {} }).textContent,
    /closer to the one you liked[\s\S]*Worca could not decide: it answered differently when the order changed\./);
});

test('P4-M6: the pair block\'s words, its states, the note on disagreeing, and Undo', async () => {
  const { doc } = dom();
  const L = { a: 'v4', b: 'v5 draft' };
  const liked = pairBlock(doc, { judgementId: 5, winner: 'b', reason: 'Like the result you liked, it sets a goal you can measure.', question: 'liked', answer: null }, L, { onAnswer: () => {} });
  assert.equal(liked.querySelector('h2').textContent, 'Which result is closer to the one you liked?');
  assert.equal(liked.querySelector('.hint').textContent, 'Worca read both without knowing which version wrote which. It compared the first try of each version.');
  assert.equal(liked.querySelector('.wft-pair-said').textContent, "v5 draft's result. Like the result you liked, it sets a goal you can measure.");
  assert.equal(liked.querySelector('.wft-pair-note').textContent, NOTE);
  const tie = pairBlock(doc, { judgementId: 7, winner: 'tie', reason: "Both set a measurable goal; v5's is shorter.", question: 'better', answer: null }, L, { onAnswer: () => {} });
  assert.equal(tie.querySelector('.wft-pair-said').textContent, "They are about the same. Both set a measurable goal; v5's is shorter.");
  assert.ok(tie.querySelector('button.wft-disagree'));
  const unsure = pairBlock(doc, { judgementId: 8, winner: 'unsure', reason: 'The checker did not pick the same result both times, so it cannot say which is better.', question: 'better', answer: null }, L, { onAnswer: () => {} });
  assert.equal(unsure.querySelector('.wft-pair-said').textContent, 'Worca could not decide: it answered differently when the order changed.');
  assert.equal(unsure.querySelector('button'), null, 'no Agree or Disagree');
  assert.equal(unsure.querySelector('.wft-pair-note'), null);
  // An answer given before (a reload): what was said, and Undo takes it back.
  const sent = [];
  const done = pairBlock(doc, { judgementId: 9, winner: 'a', reason: 'It sets a goal you can measure.', question: 'better', answer: false }, L,
    { onAnswer: async (id, agree) => { sent.push([id, agree]); return { answer: agree, trust: null }; } });
  doc.body.append(done);
  assert.match(done.querySelector('.wft-said').textContent, /^You disagreed: Worca notes it\.Undo$/);
  done.querySelector('.wft-said button').click();
  await tick();
  assert.deepEqual(sent, [[9, null]]);
  assert.ok(done.querySelector('button.wft-agree'), 'the answers come back');
  done.querySelector('button.wft-agree').click();
  await tick();
  assert.match(done.querySelector('.wft-said').textContent, /^You agreed\.Undo$/);
  assert.equal(done.querySelector('.wft-crit-trust'), null, 'a pair has no trust line');
});

test('Task 14: the reason\'s "result A" / "result B" and "the first / second result" become the versions', () => {
  const L = { a: 'v4', b: 'v5 draft' };
  assert.equal(pairReasonText('result A sets a goal; result B does not.', L), "v4's result sets a goal; v5 draft's result does not.");
  assert.equal(pairReasonText('The first result is clearer than the second result.', L), "v4's result is clearer than v5 draft's result.");
  assert.equal(pairReasonText('The result a reader wants is short.', L), 'The result a reader wants is short.', 'only the capital side letters');
  // Fix round 1: a possessive names the version, never "v4's result's".
  assert.equal(pairReasonText("result A's goal can be measured; result B's cannot.", L), "v4's goal can be measured; v5 draft's cannot.");
  assert.equal(pairReasonText("The first result's goal is clearer than the second result's.", L), "v4's goal is clearer than v5 draft's.");
});

const tv = (id) => ({ tryId: id, status: 'passed', name: 'brief.md', text: 'Brief', truncated: false, connectors: 'pretend', wouldHaveSent: [], answeredReads: [],
  verdict: { basics: [], checks: [] } });
const side = (over = {}) => ({ run: { id: 7, kind: 'compare' }, compareTitle: 'Your v5 draft compared with v4', example: { id: 1, name: 'Bulk invoice export' },
  labels: { a: 'v4', b: 'v5 draft' }, row: { a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 }, result: 'worse' }, connectors: 'pretend',
  tries: [{ n: 1, a: tv(1), b: tv(2) }, { n: 2, a: tv(3), b: tv(4) }],
  pair: { judgementId: 5, winner: 'a', reason: 'result A sets a goal you can measure.', question: 'liked', answer: null }, ...over });

test('P4-M6: the side by side shows the pair question above the try tabs, and its answer goes through actions.answer', async () => {
  const { window } = new JSDOM('<!doctype html><body><section id="root" tabindex="-1"></section></body>');
  const doc = window.document;
  const root = doc.getElementById('root');
  const sent = [];
  renderSideBySide(root, side(), { back() {}, pick() {}, readWhole() {}, answer: async (id, agree) => { sent.push([id, agree]); return { answer: agree, trust: null }; } }, { doc });
  const pair = root.querySelector('.wft-pair');
  assert.ok(pair);
  assert.equal(pair.nextElementSibling, root.querySelector('.wft-sbs-tabs'), 'right above the try tabs');
  assert.equal(pair.querySelector('.wft-pair-said').textContent, "v4's result. v4's result sets a goal you can measure.");
  pair.querySelector('button.wft-agree').click();
  await tick();
  assert.deepEqual(sent, [[5, true]]);
  const r2 = doc.createElement('section');
  renderSideBySide(r2, side({ pair: null }), { back() {}, pick() {}, readWhole() {} }, { doc });
  assert.equal(r2.querySelector('.wft-pair'), null);
  assert.ok(r2.querySelector('.wft-pg-head .wft-sbs-tabs'), 'without a pair the tabs stay in the heading');
  const once = doc.createElement('section');
  renderSideBySide(once, side({ run: { id: 8, kind: 'once' }, labels: { a: null, b: 'Your draft' } }), { back() {}, pick() {}, readWhole() {} }, { doc });
  assert.equal(once.querySelector('.wft-pair'), null, 'one version: no pair');
});

// Board 3 and P4-M7.
const past = (over = {}) => ({
  pipelineId: 'abcd1234', workflowId: 'wf_b', workflowName: 'Product brief writer', title: 'Saved filters for reports',
  request: 'Write the brief.', files: ['reports-interviews.md', 'usage.csv'],
  qa: [{ question: 'Who uses filters?', answer: 'Analysts' }, { question: 'Which reports?', answer: 'Monthly' }],
  use: 4, useLabel: 'v4', testable: true, reason: null, reasonText: null, hasResult: true, ...over,
});
const LONG = 'It ignored the usage data. It should say how many people use filters today and which filters matter most.';
const blur = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('blur'));

test('board 3: "This result, as a result you liked" in Keep from this run, off at first, sent as liked', async () => {
  const { doc, win } = dom();
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSubmit: async (b) => { sent = b; return { ok: true }; } });
  const rows = [...doc.querySelectorAll('.wft-keep .wft-chk')].map((l) => l.textContent);
  assert.equal(rows.at(-1), 'This result, as a result you liked');
  assert.equal(doc.getElementById('wft-fr-liked').checked, false);
  doc.getElementById('wft-fr-liked').checked = true;
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal(sent.liked, true);
  const none = dom();
  let sent2 = null;
  openFromRunDialog({ doc: none.doc, win: none.win, past: past({ hasResult: false }), onSubmit: async (b) => { sent2 = b; return { ok: true }; } });
  assert.equal(none.doc.getElementById('wft-fr-liked'), null, 'a run that left no result offers none');
  click(none.doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal('liked' in sent2, false);
});

test('P4-M7: the note\'s hint, loading, the chips, a chip added, and what is sent', async () => {
  const { doc, win } = dom();
  const asked = [];
  let answer;
  const onSuggest = (note) => { asked.push(note); return new Promise((r) => { answer = r; }); };
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSuggest, onSubmit: async (b) => { sent = b; return { ok: true }; } });
  const note = doc.getElementById('wft-fr-note');
  assert.equal(note.closest('.field').querySelector('.hint').textContent, 'Worca can turn your note into criteria. You choose which to keep.');
  const box = doc.querySelector('.wft-sugg-box');
  assert.equal(box.hidden, true);
  assert.equal(box.getAttribute('aria-live'), 'polite');
  note.value = 'Too short.';
  blur(note);
  assert.deepEqual(asked, [], 'fewer than 20 characters: nothing is asked');
  note.value = LONG;
  blur(note);
  blur(note);
  assert.deepEqual(asked, [LONG], 'one paid request at a time');
  assert.equal(box.hidden, false);
  assert.equal(box.textContent, 'Worca is reading your note…');
  assert.ok(box.querySelector('svg'), 'the spinner');
  answer({ suggestions: ['Uses numbers from usage.csv', 'Ranks the filters by how often they are used', 'Says how many people use filters today'] });
  await tick();
  assert.match(box.textContent, /^Worca turned your note into criteria[\s\S]*Click one to add it\. You can change the words later\./);
  const chips = () => [...box.querySelectorAll('button.wft-sugg-chip')];
  // The board's "+" is the plus icon (no typed glyph, docs/design-system.md › Icons), then the words.
  assert.deepEqual(chips().map((b) => b.textContent), ['Uses numbers from usage.csv', 'Ranks the filters by how often they are used', 'Says how many people use filters today']);
  assert.ok(chips().every((b) => b.firstElementChild.matches('.ic[aria-hidden="true"]') && b.querySelector('svg')));
  assert.ok(chips().every((b) => b.classList.contains('wft-sugg-tag')), 'the approved violet suggestion style');
  click(chips()[1]);
  assert.equal(doc.activeElement, chips()[2], 'the focus moves to the next chip');
  assert.equal(chips()[1].textContent, 'Ranks the filters by how often they are used· Added');
  assert.ok(chips()[1].classList.contains('is-added') && chips()[1].disabled);
  assert.ok(chips()[1].querySelector('svg'), 'the tick');
  blur(note);
  assert.equal(asked.length, 1, 'the same note is not asked again');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(sent.criteria, [{ text: 'Ranks the filters by how often they are used' }]);
});

test('P4-M7 and board 58: none found, and a failure in the server\'s words; the next blur asks again', async () => {
  const { doc, win } = dom();
  const replies = [{ suggestions: [] }, { error: 'Worca could not get suggestions this time. Try again.' }, { suggestions: ['Says how many people use filters today'] }];
  const asked = [];
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSuggest: async (n) => { asked.push(n); return replies.shift(); }, onSubmit: async (b) => { sent = b; return { ok: true }; } });
  const note = doc.getElementById('wft-fr-note');
  const box = doc.querySelector('.wft-sugg-box');
  note.value = LONG;
  blur(note);
  await tick();
  assert.equal(box.textContent, 'Worca found no criteria in your note. You can write your own in the example after you add it.');
  assert.ok(box.classList.contains('is-none'));
  note.value = `${LONG} And the export limit.`;
  blur(note);
  await tick();
  assert.equal(box.textContent, 'Worca could not get suggestions this time. Try again.');
  blur(note);
  await tick();
  assert.equal(asked.length, 3, 'after a failure the same note can be asked again');
  assert.deepEqual([...box.querySelectorAll('button.wft-sugg-chip')].map((b) => b.textContent), ['Says how many people use filters today']);
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.equal('criteria' in sent, false, 'nothing picked, nothing sent');
});

// Fix round 1: Safari and Firefox on macOS do not focus a clicked button, so a blur's relatedTarget is null; pointerdown comes before
// the blur in every browser.
const press = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('pointerdown', { bubbles: true }));
const release = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.Event('pointerup', { bubbles: true }));

test('fix round 1: a press on Cancel or Add example sends no paid call, even when the button takes no focus', async () => {
  const { doc, win } = dom();
  const asked = [];
  openFromRunDialog({ doc, win, past: past(), onSuggest: async (n) => { asked.push(n); return { suggestions: [] }; }, onSubmit: async () => ({ ok: true }) });
  const note = doc.getElementById('wft-fr-note');
  note.value = LONG;
  const cancel = [...doc.querySelectorAll('.mk-dialog-foot button')].find((b) => b.textContent === 'Cancel');
  press(cancel);
  blur(note);   // relatedTarget null, as Safari
  release(cancel);
  await tick();
  assert.deepEqual(asked, [], 'leaving the dialog asks nothing');
  // After the press is over, a plain blur asks again as before.
  blur(note);
  await tick();
  assert.deepEqual(asked, [LONG]);
});

test('fix round 1: a chip clicked right after the note was edited keeps the pick, and asks nothing new', async () => {
  const { doc, win } = dom();
  const asked = [];
  let sent = null;
  openFromRunDialog({ doc, win, past: past(), onSuggest: async (n) => { asked.push(n); return { suggestions: ['Uses numbers from usage.csv', 'Says how many people use filters today'] }; },
    onSubmit: async (b) => { sent = b; return { ok: true }; } });
  const note = doc.getElementById('wft-fr-note');
  note.value = LONG;
  blur(note);
  await tick();
  note.value = `${LONG} Also the limit.`;   // edited, then a chip is clicked: pointerdown, the note's blur, then the click
  const chip = doc.querySelectorAll('button.wft-sugg-chip')[1];
  press(chip);
  blur(note);
  release(chip);
  click(chip);
  await tick();
  assert.equal(asked.length, 1, 'no new paid call');
  assert.ok(chip.isConnected && chip.classList.contains('is-added'), 'the pick is kept');
  click(doc.querySelector('.wft-dlg-ok'));
  await tick();
  assert.deepEqual(sent.criteria, [{ text: 'Says how many people use filters today' }]);
});

test('fix round 1: a note changed while Worca read it is asked again once the answer lands, if the person left the box', async () => {
  const { doc, win } = dom();
  const asked = [];
  const answers = [];
  openFromRunDialog({ doc, win, past: past(), onSuggest: (n) => { asked.push(n); return new Promise((r) => answers.push(r)); }, onSubmit: async () => ({ ok: true }) });
  const note = doc.getElementById('wft-fr-note');
  note.value = LONG;
  blur(note);
  const changed = `${LONG} And the export limit.`;
  note.value = changed;
  blur(note);   // still out: nothing more is sent yet
  assert.deepEqual(asked, [LONG]);
  answers[0]({ suggestions: ['Uses numbers from usage.csv'] });
  await tick();
  assert.deepEqual(asked, [LONG, changed], 'the new words are asked once the first answer is in');
  answers[1]({ suggestions: ['Mentions the export limit'] });
  await tick();
  assert.deepEqual([...doc.querySelectorAll('button.wft-sugg-chip')].map((b) => b.textContent), ['Mentions the export limit']);
  assert.equal(asked.length, 2);
});

test('tests-app.mjs: the liked routes, the suggestions call, the tries to pick, and the side by side\'s answers', () => {
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.match(ctl, /wftCall\('PUT', `\$\{base\}\/examples\/\$\{session\.exampleId\}\/liked`/);
  assert.match(ctl, /wftCall\('DELETE', `\$\{base\}\/examples\/\$\{session\.exampleId\}\/liked`\)/);
  assert.match(ctl, /wftCall\('POST', '\/api\/workflow-tests\/suggest-criteria', \{ workflowId: past\.workflowId, pipelineId: past\.pipelineId, note \}\)/);
  assert.match(ctl, /likedTries: /);
});

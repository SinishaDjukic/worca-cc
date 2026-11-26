// test/ui-workflow-test-checker.test.mjs — board 11's ready state and its answers; P4-M3's states (approved 2026-11-20) are pinned here,
// with board 58's words, the address, the links that open the page (the editor, By criterion) and the controller.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { renderChecker, renderByCriterion } from '../ui/public/workflows/criteria-pages.mjs';
import { renderCriteriaSection } from '../ui/public/workflows/criteria-editor.mjs';
import { testsAddress, TESTS_ROUTE_RE } from '../ui/public/workflows/tests-view.mjs';
import { NO_SOURCE_TEXT, NO_PASSED_TRY_TEXT, LIMIT_TEXT } from '../src/shared/workflow-tests/criteria-text.mjs';

const view = (answers = [true, true, null, null]) => ({ round: { id: 7, criterionId: 'k_1', status: answers.every((a) => a !== null) ? 'done' : 'ready' },
  exampleName: 'Bulk invoice export',
  criterion: 'Names a success metric with a number, and how to measure it', source: { label: 'From a real result' },
  cards: [null, 'number removed', 'how to measure removed', 'only a vague goal'].map((planted, i) => ({ judgementId: 20 + i, card: i, planted,
    excerpt: `Excerpt ${i}`, met: i === 0, reason: i === 0 ? 'A number (60%) and how it is counted.' : 'It gives no number.', answer: answers[i] })),
  left: answers.filter((a) => a === null).length, auto: { same: { n: 4, of: 4 }, padding: { n: 4, of: 4 }, proof: { n: 3, of: 4 } },
  costUsd: 0.12, canUse: answers.every((a) => a !== null) });
const NOOP = { answer: () => {}, back: () => {}, use: () => {}, reword: () => {}, useWords: () => {}, keepWords: () => {}, retry: () => {}, tryOnce: () => {} };
const dom = () => { const { document: doc } = new JSDOM('<!doctype html><div id="r"></div>').window; return { doc, root: doc.getElementById('r') }; };
const btnByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent === text);

test('board 11: the criterion, the four cards, the answers left, the self-tests and the cost', () => {
  const { doc, root } = dom();
  const sent = [];
  renderChecker(root, view(), { answer: (id, right) => sent.push([id, right]), back: () => {}, use: () => {}, reword: () => {} }, { doc, exampleName: 'Bulk invoice export' });
  assert.match(root.textContent, /Check the checker/);
  assert.equal(root.querySelector('.wft-crumb').textContent, 'Example: Bulk invoice export');
  assert.equal(root.querySelector('.wft-cc-crit').textContent, 'Names a success metric with a number, and how to measure it');
  assert.equal(root.querySelector('.qcount').textContent, '2 of 4 left');
  const cards = [...root.querySelectorAll('.wft-cc-card')];
  assert.equal(cards[1].querySelector('.wft-cc-planted').textContent, 'Broken on purpose: number removed');
  assert.equal(cards[0].querySelector('.wft-cc-src').textContent, 'From a real result');
  assert.match(cards[0].textContent, /Worca says: met\.\s*A number \(60%\) and how it is counted\.[\s\S]*You said: right/);
  cards[2].querySelector('button.wft-cc-wrong').click();
  assert.deepEqual(sent, [[22, false]]);
  assert.match(root.textContent, /If you say "wrong", Worca suggests clearer words for the criterion and asks again\./);
  assert.match(root.textContent, /Worca also tested its own checking/);
  assert.deepEqual([...root.querySelectorAll('.wft-cc-auto .badge')].map((b) => [b.textContent, b.className]),
    [['4 of 4', 'badge green'], ['4 of 4', 'badge green'], ['3 of 4', 'badge red']]);
  assert.match(root.textContent, /This check cost \$0\.12\. Your answers also count toward how far Worca's checking is trusted\./);
  assert.equal(root.querySelector('button.wft-cc-use').disabled, true);
  renderChecker(root, view([true, true, false, true]), NOOP, { doc, exampleName: 'E' });
  assert.equal(root.querySelector('button.wft-cc-use').disabled, false);
  assert.equal(root.querySelector('.qcount').textContent, '0 of 4 left');
  assert.equal(root.querySelectorAll('.wft-cc-card')[2].querySelector('.wft-cc-done').textContent, 'You said: wrong');
});

test('the checker\'s address, and the route that opens it after a reload', () => {
  assert.equal(testsAddress({ workflowId: 'wf_a', shown: true, view: 'checker', exampleId: 4, roundId: 7 }), '#workflows/wf_a/tests/4/checker/7');
  assert.equal(testsAddress({ workflowId: 'wf_a', shown: true, view: 'checker', exampleId: 4, roundId: null }), '#workflows/wf_a/tests/4', 'no round yet: the example');
  assert.deepEqual([...TESTS_ROUTE_RE.exec('tests/4/checker/7')].slice(1, 5), [undefined, undefined, '4', '7']);
  assert.deepEqual([...TESTS_ROUTE_RE.exec('tests/run/12')].slice(1, 3), [undefined, '12'], 'Part 2\'s forms still match');
  assert.deepEqual([...TESTS_ROUTE_RE.exec('tests/4')].slice(1, 2), ['4']);
  assert.equal(TESTS_ROUTE_RE.exec('tests/4/checker/x'), null);
});

test("board 59 D: every card's excerpt is plain text, line breaks kept (the real card and the planted ones; while preparing too)", () => {
  const { doc, root } = dom();
  const md = '**Contract**: Create a content outline\n- **Hook / Problem** (2–3 sentences)';
  const plain = 'Contract: Create a content outline\nHook / Problem (2–3 sentences)';
  const v = view();
  v.cards = v.cards.map((c) => ({ ...c, excerpt: md }));
  renderChecker(root, v, NOOP, { doc, exampleName: 'E' });
  assert.deepEqual([...root.querySelectorAll('.wft-cc-excerpt')].map((x) => x.textContent), [plain, plain, plain, plain]);
  renderChecker(root, { ...v, round: { id: 7, criterionId: 'k_1', status: 'making' } }, NOOP, { doc, exampleName: 'E' });
  assert.deepEqual([...root.querySelectorAll('.wft-cc-excerpt')].map((x) => x.textContent), [plain, plain, plain, plain]);
  assert.equal(v.cards[0].excerpt, md, 'display only: the data is unchanged');
});

test('P4-M3: while Worca prepares (making the broken results, then checking), the box replaces the panel', () => {
  const { doc, root } = dom();
  const making = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'making' }, cards: [], left: 0 };
  renderChecker(root, making, NOOP, { doc, exampleName: 'Bulk invoice export' });
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.getAttribute('aria-live'), 'polite');
  assert.equal(box.getAttribute('aria-label'), 'Worca is preparing');
  assert.match(box.textContent, /^Worca is breaking a good result in a few ways…You can leave this page\. Worca keeps going and shows the results here\.$/);
  assert.equal(root.querySelector('.qpanel'), null);
  assert.equal(root.querySelector('.wft-cc-auto'), null, 'no self-tests before the round is ready');
  assert.equal(root.querySelector('.wft-cc-crit').textContent, 'Names a success metric with a number, and how to measure it', 'the criterion stays');
  const checking = { ...making, cards: view().cards.slice(0, 2) };
  renderChecker(root, checking, NOOP, { doc, exampleName: 'Bulk invoice export' });
  const b = root.querySelector('.wft-cc-state');
  assert.equal(b.getAttribute('aria-label'), 'Worca is checking');
  assert.match(b.textContent, /Checking 4 results…/);
  const cards = [...b.querySelectorAll('.wft-cc-card')];
  assert.equal(cards.length, 2);
  assert.equal(cards[1].querySelector('.wft-cc-planted').textContent, 'Broken on purpose: number removed');
  assert.equal(cards[1].querySelector('.wft-cc-excerpt').textContent, 'Excerpt 1');
  assert.equal(b.querySelector('.wft-cc-verdict'), null, 'no verdict before the round is ready');
  assert.equal(b.querySelector('button'), null);
});

test('P4-M3: no good result yet, and the spending limit reached (no round): the header, the criterion and the box', () => {
  const { doc, root } = dom();
  const asked = [];
  const acts = { ...NOOP, back: () => asked.push('back'), tryOnce: () => asked.push('try'), retry: () => asked.push('retry') };
  const criterion = { id: 'k_1', text: 'Names a success metric with a number' };
  renderChecker(root, null, acts, { doc, exampleName: 'Bulk invoice export', criterion, empty: { kind: 'none', text: NO_SOURCE_TEXT } });
  assert.match(root.textContent, /Check the checker/);
  assert.equal(root.querySelector('.wft-cc-crit').textContent, 'Names a success metric with a number');
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Worca needs a good result first');
  assert.equal(box.getAttribute('aria-labelledby'), box.querySelector('h2').id);
  assert.match(box.textContent, /Try this example once first, so Worca has a good result to break\./);
  btnByText(box, 'Try your draft once now').click();
  btnByText(box, 'Back').click();
  assert.deepEqual(asked, ['try', 'back']);
  assert.equal(btnByText(box, 'Try your draft once now').className, 'btn btn-sm btn-primary');
  renderChecker(root, null, acts, { doc, exampleName: 'Bulk invoice export', criterion, empty: { kind: 'limit', text: LIMIT_TEXT } });
  const lim = root.querySelector('.wft-cc-state');
  assert.equal(lim.querySelector('h2').textContent, 'Check the checker did not start');
  const stop = lim.querySelector('.wft-cc-stop');
  assert.equal(stop.className, 'wft-cc-stop is-limit');
  assert.equal(stop.getAttribute('role'), 'status');
  assert.equal(stop.textContent, LIMIT_TEXT, 'the server\'s words');
  btnByText(lim, 'Try again').click();
  assert.deepEqual(asked, ['try', 'back', 'retry']);
  assert.equal(btnByText(lim, 'Try again').className, 'btn btn-sm');
});

test('board 59 A: tried, but no try passed: "Worca needs a good result first", its words, Back and "Pick a result you liked"', () => {
  const { doc, root } = dom();
  const asked = [];
  const acts = { ...NOOP, back: () => asked.push('back'), pickLiked: () => asked.push('liked'), tryOnce: () => asked.push('try') };
  renderChecker(root, null, acts, { doc, exampleName: 'Bulk invoice export', criterion: { id: 'k_1', text: 'Names a metric' },
    empty: { kind: 'tried', text: NO_PASSED_TRY_TEXT } });
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Worca needs a good result first');
  assert.equal(box.getAttribute('aria-labelledby'), box.querySelector('h2').id);
  assert.equal(box.querySelector('.wft-cc-say').textContent,
    'No try of this example passed yet, so Worca has no good result to break. Pick a result you liked, or fix what fails and try again.');
  assert.deepEqual([...box.querySelectorAll('button')].map((b) => [b.textContent, b.className]),
    [['Back', 'btn btn-sm'], ['Pick a result you liked', 'btn btn-sm btn-primary']]);
  assert.equal(btnByText(box, 'Try your draft once now'), undefined, 'board 53 state 3 is for an example never tried');
  btnByText(box, 'Pick a result you liked').click();
  btnByText(box, 'Back').click();
  assert.deepEqual(asked, ['liked', 'back']);
});

test('P4-M3: a round that failed (a restart, board 58) says so, what it cost, with Back and Try again', () => {
  const { doc, root } = dom();
  const asked = [];
  const failed = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'failed', detail: 'Worca restarted before this round was ready. Try again.' }, cards: [], costUsd: 0.03 };
  renderChecker(root, failed, { ...NOOP, retry: () => asked.push('retry'), back: () => asked.push('back') }, { doc, exampleName: 'E' });
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Check the checker did not finish');
  const stop = box.querySelector('.wft-cc-stop');
  assert.equal(stop.className, 'wft-cc-stop is-err');
  assert.equal(stop.getAttribute('role'), 'alert');
  assert.equal(stop.textContent, 'Worca restarted before this round was ready. Try again.');
  assert.equal(box.querySelector('.hint').textContent, 'Nothing is counted from this round. This round cost $0.03.');
  btnByText(box, 'Try again').click();
  btnByText(box, 'Back').click();
  assert.deepEqual(asked, ['retry', 'back']);
  assert.equal(root.querySelector('.qpanel'), null);
  assert.equal(root.querySelector('.wft-cc-use'), null);
  renderChecker(root, { ...failed, round: { ...failed.round, detail: null } }, NOOP, { doc, exampleName: 'E' });
  assert.equal(root.querySelector('.wft-cc-stop').textContent, 'This round did not finish. Start a new round.', 'board 58 when the round has no words of its own');
});

test('P4-M3: after a "Wrong", Worca\'s clearer words replace the panel: use them and check again, or keep my words', () => {
  const { doc, root } = dom();
  const asked = [];
  const v = view([true, true, false, null]);
  renderChecker(root, v, { ...NOOP, useWords: (t) => asked.push(['use', t]), keepWords: () => asked.push(['keep']) },
    { doc, exampleName: 'E', reworded: { text: 'Names a success metric with a target number, and says where that number is counted.' } });
  assert.equal(root.querySelector('.qpanel'), null);
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.getAttribute('aria-label'), 'After a wrong answer');
  const cards = [...box.querySelectorAll('.wft-cc-card')];
  assert.equal(cards.length, 1, 'the card you said was wrong');
  assert.equal(cards[0].querySelector('.wft-cc-planted').textContent, 'Broken on purpose: how to measure removed');
  assert.equal(cards[0].querySelector('.wft-cc-done').textContent, 'You said: wrong');
  const sugg = box.querySelector('.wft-sugg');
  assert.equal(sugg.querySelector('.wft-sugg-tag').textContent, 'Worca suggests clearer words');
  assert.equal(sugg.querySelector('.wft-cc-words').textContent, '"Names a success metric with a target number, and says where that number is counted."');
  assert.equal(sugg.querySelector('.hint').textContent, 'Checking again makes 4 new results to confirm, about $0.12.');
  btnByText(sugg, 'Use these words and check again').click();
  btnByText(sugg, 'Keep my words').click();
  assert.deepEqual(asked, [['use', 'Names a success metric with a target number, and says where that number is counted.'], ['keep']]);
  // Fix round 5: the estimate is the round's own calls (its three copy calls and its checks), not the clearer words' call.
  const again = dom();
  renderChecker(again.root, { ...v, costUsd: 0.14, againUsd: 0.12 }, NOOP, { doc: again.doc, exampleName: 'E', reworded: { text: 'x' } });
  assert.equal(again.root.querySelector('.wft-sugg .hint').textContent, 'Checking again makes 4 new results to confirm, about $0.12.');
  assert.ok(root.querySelector('.wft-cc-auto'), 'the self-tests and the cost stay');
  // The reword route's refusals are shown in the server's words, with Try again (reword) and Keep my words.
  renderChecker(root, v, { ...NOOP, reword: () => asked.push(['reword']) },
    { doc, exampleName: 'E', reworded: { error: 'Worca could not suggest clearer words this time. Try again.' } });
  const err = root.querySelector('.wft-cc-state .wft-cc-stop');
  assert.equal(err.className, 'wft-cc-stop is-err');
  assert.equal(err.textContent, 'Worca could not suggest clearer words this time. Try again.');
  btnByText(root.querySelector('.wft-cc-state'), 'Try again').click();
  assert.deepEqual(asked.at(-1), ['reword']);
  renderChecker(root, v, NOOP, { doc, exampleName: 'E', reworded: { error: LIMIT_TEXT, limit: true } });
  assert.equal(root.querySelector('.wft-cc-state .wft-cc-stop').className, 'wft-cc-stop is-limit');
});

test('P4-M3: done, with some costs not known (P4-Q17)', () => {
  const { doc, root } = dom();
  renderChecker(root, { ...view([true, true, true, true]), costUnknown: true }, NOOP, { doc, exampleName: 'E' });
  assert.equal(root.querySelector('.wft-cc-foot .hint').textContent,
    "This check cost $0.12 · the cost of some checks is not known, so Worca cannot count them in your spending limit. Your answers also count toward how far Worca's checking is trusted.");
});

test('board 12: By criterion\'s "Confirm 4 results" and "Fix it" open Check the checker of that criterion', () => {
  const { doc, root } = dom();
  const asked = [];
  const data = { rows: [
    { key: '4|k:k_1', label: 'Names a metric', exampleName: 'Bulk', exact: false, trust: { state: 'confirm', n: 0, agree: 0, decides: true }, a: { met: 1, of: 1 }, b: { met: 1, of: 1 } },
    { key: '4|k:k_5', label: 'Proposes a test', exampleName: 'Bulk', exact: false, trust: { state: 'unreliable', n: 10, agree: 6, decides: false }, a: { met: 1, of: 1 }, b: { met: 0, of: 1 } },
    { key: '4|c:c_2', label: 'Mentions 200', exampleName: 'Bulk', exact: true, trust: { state: 'exact', decides: true }, a: { met: 1, of: 1 }, b: { met: 1, of: 1 } },
  ], more: 0 };
  renderByCriterion(root, data, { doc, labels: { a: 'v3', b: 'v4' }, onConfirm: (exampleId, c) => asked.push([exampleId, c.id, c.text, c.exampleName]) });
  const rows = [...root.querySelectorAll('.wft-bc-row:not(.is-head)')];
  const confirm = rows[0].querySelector('button.wft-confirm');
  assert.equal(confirm.textContent, 'Confirm 4 results');
  assert.equal(confirm.className, 'badge amber wft-confirm');
  confirm.click();
  const fix = rows[1].querySelector('button.wft-fix');
  assert.equal(fix.textContent, 'Fix it');
  assert.match(rows[1].querySelector('small').textContent, /^Agrees with people 6 of 10 times\. Shown, but does not decide better or worse\. Fix it$/);
  fix.click();
  assert.equal(rows[2].querySelector('button'), null);
  assert.deepEqual(asked, [[4, 'k_1', 'Names a metric', 'Bulk'], [4, 'k_5', 'Proposes a test', 'Bulk']]);
  renderByCriterion(root, data, { doc, labels: { a: 'v3', b: 'v4' } });
  assert.equal(root.querySelector('button.wft-confirm'), null, 'no link without onConfirm');
  assert.equal(root.querySelector('.wft-bc-row:not(.is-head) .badge').textContent, 'Confirm 4 results');
});

// ---- The controller (tests-app.mjs), driven with a fake server ----
const LEAVE = /You can leave this page/;
function harness(routes) {
  const w = new JSDOM('<!doctype html><html data-flags="workflowTests"><body><div id="wfv-tests"></div></body></html>', { url: 'http://localhost/#workflows' }).window;
  const doc = w.document;
  globalThis.document = doc;
  const calls = [];
  const timers = [];
  const win = { location: w.location, history: w.history, localStorage: w.localStorage,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {} };
  const fetch = async (path, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push([method, path, body]);
    const h = routes[`${method} ${path}`];
    const out = (await (typeof h === 'function' ? h(body) : h)) || { status: 404, body: { error: 'not here' } };
    return { ok: out.status < 400, status: out.status, json: async () => out.body };
  };
  return { doc, win, calls, timers, fetch, root: doc.getElementById('wfv-tests') };
}
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => setImmediate(r)); };

test('tests-app.mjs: the address opens a round, polls while Worca makes it, a Wrong asks for clearer words, and "Use these words" saves them and starts a new round', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  let round7 = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'making' }, cards: [], left: 0 };
  const routes = {
    [`GET ${B}/examples/4/checker/7`]: () => ({ status: 200, body: round7 }),
    [`POST ${B}/examples/4/checker/7/answers`]: (b) => ({ status: 200, body: view([true, true, b.right, null]) }),
    [`POST ${B}/examples/4/checker/7/reword`]: { status: 200, body: { text: 'Clearer words' } },
    [`GET ${B}/examples/4`]: { status: 200, body: { example: { id: 4, name: 'Bulk', criteria: [{ id: 'k_0', text: 'Other' }, { id: 'k_1', text: 'Old words' }] } } },
    [`PUT ${B}/examples/4`]: (b) => ({ status: 200, body: { example: { id: 4, name: 'Bulk', criteria: b.criteria } } }),
    [`POST ${B}/examples/4/checker`]: { status: 201, body: { round: { id: 8, status: 'making' } } },
    [`GET ${B}/examples/4/checker/8`]: { status: 200, body: { ...round7, round: { id: 8, criterionId: 'k_1', status: 'making' }, criterion: 'Clearer words' } },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/4/checker/7');
  assert.match(h.root.querySelector('.wft-cc-state').textContent, LEAVE);
  assert.equal(h.timers.length, 1, 'polls while Worca makes the round');
  round7 = view();
  h.timers.shift()();
  await settle();
  assert.equal(h.root.querySelector('.qcount').textContent, '2 of 4 left');
  assert.equal(h.timers.length, 0, 'a ready round is not polled');
  h.root.querySelectorAll('.wft-cc-card')[2].querySelector('button.wft-cc-wrong').click();
  await settle();
  assert.deepEqual(h.calls.filter(([m]) => m === 'POST').map(([, p, b]) => [p.slice(B.length), b]),
    [['/examples/4/checker/7/answers', { judgementId: 22, right: false }], ['/examples/4/checker/7/reword', {}]]);
  assert.equal(h.root.querySelector('.wft-cc-words').textContent, '"Clearer words"');
  btnByText(h.root, 'Use these words and check again').click();
  await settle();
  const put = h.calls.find(([m]) => m === 'PUT');
  assert.deepEqual(put[2], { criteria: [{ id: 'k_0', text: 'Other' }, { id: 'k_1', text: 'Clearer words' }] }, 'the criterion is saved through the example save, its id kept');
  assert.deepEqual(h.calls.filter(([m]) => m === 'POST').at(-1).slice(1), [`${B}/examples/4/checker`, { criterionId: 'k_1' }]);
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/4/checker/8');
  assert.equal(h.root.querySelector('.wft-cc-crit').textContent, 'Clearer words');
});

test('tests-app.mjs: a refused start shows P4-M3\'s states (no good result, the limit); Try your draft once now starts a try', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  let refusal = { status: 422, body: { error: NO_SOURCE_TEXT } };
  const failed = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'failed', detail: 'Worca restarted before this round was ready. Try again.' }, cards: [] };
  const routes = {
    [`GET ${B}/examples/4/checker/7`]: { status: 200, body: failed },
    [`POST ${B}/examples/4/checker`]: () => refusal,
    [`POST ${B}/examples/4/try-once`]: { status: 201, body: { run: { id: 31 } } },
    [`GET ${B}/runs/31`]: { status: 200, body: null },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  btnByText(h.root, 'Try again').click();   // the failed round: a new round of the same criterion
  await settle();
  assert.deepEqual(h.calls.at(-1).slice(0, 3), ['POST', `${B}/examples/4/checker`, { criterionId: 'k_1' }]);
  assert.equal(h.root.querySelector('.wft-cc-state h2').textContent, 'Worca needs a good result first');
  assert.equal(h.root.querySelector('.wft-cc-crit').textContent, view().criterion, 'the criterion stays');
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/4', 'no round: the address names the example');
  refusal = { status: 422, body: { error: LIMIT_TEXT } };
  // A press on Try your draft once now starts a try of the example and shows its progress.
  btnByText(h.root, 'Try your draft once now').click();
  await settle();
  assert.ok(h.calls.some(([m, p]) => m === 'POST' && p === `${B}/examples/4/try-once`));
  assert.equal(h.win.location.hash, '#workflows/wf_a/tests/run/31');
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  btnByText(h.root, 'Try again').click();
  await settle();
  assert.equal(h.root.querySelector('.wft-cc-state h2').textContent, 'Check the checker did not start');
  assert.equal(h.root.querySelector('.wft-cc-stop').textContent, LIMIT_TEXT);
});

test('board 59 A: tests-app.mjs tells the two 422s apart; "Pick a result you liked" opens the example with its "A result you liked" dialog', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  const failed = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'failed', detail: 'Worca restarted before this round was ready. Try again.' }, cards: [] };
  const routes = {
    [`GET ${B}/examples/4/checker/7`]: { status: 200, body: failed },
    [`POST ${B}/examples/4/checker`]: { status: 422, body: { error: NO_PASSED_TRY_TEXT } },
    [`GET ${B}/examples/4`]: { status: 200, body: { example: { id: 4, name: 'Bulk invoice export', request: 'R', tries: 1, files: [], answers: [], checks: [],
      basics: { noError: true, noHelp: false }, criteria: [{ id: 'k_1', text: 'Names a metric' }], judge: { model: 'm' }, liked: null } } },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  btnByText(h.root, 'Try again').click();
  await settle();
  const box = h.root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Worca needs a good result first');
  assert.equal(box.querySelector('.wft-cc-say').textContent, NO_PASSED_TRY_TEXT);
  assert.equal(btnByText(box, 'Try your draft once now'), undefined);
  btnByText(box, 'Pick a result you liked').click();
  await settle();
  assert.ok(h.calls.some(([m, p]) => m === 'GET' && p === `${B}/examples/4`), 'the example is opened');
  assert.equal(h.root.querySelector('.wft-title').textContent, 'Example: Bulk invoice export');
  assert.equal(h.doc.querySelector('#mk-dialog-title').textContent, 'A result you liked', 'its dialog is open');
});

test('tests-app.mjs wires the example editor\'s Confirm 4 results and Fix it, and Compare\'s By criterion links, to Check the checker', () => {
  const ctl = readFileSync(new URL('../ui/public/workflows/tests-app.mjs', import.meta.url), 'utf8');
  assert.match(ctl, /onConfirmCriterion: \(c\) => wftConfirmCriterion\(session\.exampleId, c/);
  assert.match(ctl, /confirmCriterion: \(exampleId, c\) => wftConfirmCriterion\(exampleId, c/);
  assert.match(ctl, /const m = TESTS_ROUTE_RE\.exec\(sub\);/);
  const cmp = readFileSync(new URL('../ui/public/workflows/test-compare.mjs', import.meta.url), 'utf8');
  assert.match(cmp, /onConfirm: actions\.confirmCriterion \? \(exampleId, c\) => actions\.confirmCriterion\(exampleId, c\) : null/);
});

// ---- Fix round 1 ----
const deferred = () => { let resolve; const p = new Promise((r) => { resolve = r; }); return { p, resolve }; };
const flush = () => new Promise((r) => setImmediate(r));

test('fix 1 (e): the real card names the version and date it came from; Right / Wrong name their card; a self-test with nothing to count is grey', () => {
  const { doc, root } = dom();
  const v = { ...view(), source: { label: 'From a real result', useLabel: 'v4', at: '2026-10-14T09:30:00Z' }, auto: { same: { n: 4, of: 4 }, padding: { n: 0, of: 0 }, proof: { n: 3, of: 4 } } };
  renderChecker(root, v, NOOP, { doc, exampleName: 'E', dateText: (iso) => (iso.startsWith('2026-10-14') ? '14 Oct' : iso) });
  const cards = [...root.querySelectorAll('.wft-cc-card')];
  assert.equal(cards[0].querySelector('.wft-cc-src').textContent, 'From a real result · v4, 14 Oct');
  assert.deepEqual([...cards[2].querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    ['Right: Broken on purpose: how to measure removed', 'Wrong: Broken on purpose: how to measure removed']);
  assert.deepEqual([...root.querySelectorAll('.wft-cc-auto .badge')].map((b) => b.className), ['badge green', 'badge', 'badge red']);
  renderChecker(root, { ...v, source: { label: 'From the result you liked' } }, NOOP, { doc, exampleName: 'E' });
  assert.equal(root.querySelector('.wft-cc-src').textContent, 'From the result you liked', 'nothing more to name');
});

test('fix 1 (b): while an answer or the clearer words are out, every Right / Wrong waits; the words being written show where they will go', () => {
  const { doc, root } = dom();
  renderChecker(root, view(), NOOP, { doc, exampleName: 'E', busy: true });
  const all = [...root.querySelectorAll('button.wft-cc-right, button.wft-cc-wrong')];
  assert.equal(all.length, 4);
  assert.ok(all.every((b) => b.disabled));
  renderChecker(root, view([true, true, false, null]), NOOP, { doc, exampleName: 'E', busy: true, rewording: true });
  assert.equal(root.querySelector('.qpanel'), null);
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.getAttribute('aria-label'), 'After a wrong answer');
  assert.equal(box.querySelectorAll('.wft-cc-card').length, 1);
  const wait = box.querySelector('.wft-cc-wait');
  assert.equal(wait.textContent, 'Worca is writing clearer words…');
  assert.equal(wait.getAttribute('role'), 'status');
  assert.ok(wait.querySelector('svg'), 'a spinner icon');
  assert.equal(box.querySelector('.wft-sugg'), null);
});

test('fix 1: Try again (failed, limit), Confirm 4 results and Fix it wait while their request is out', async () => {
  const { doc, root } = dom();
  let d = deferred();
  const failed = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'failed', detail: null }, cards: [] };
  renderChecker(root, failed, { ...NOOP, retry: () => d.p }, { doc, exampleName: 'E' });
  const again = btnByText(root, 'Try again');
  again.click();
  assert.equal(again.disabled, true);
  d.resolve(); await d.p; await flush();
  assert.equal(again.disabled, false);
  d = deferred();
  renderChecker(root, null, { ...NOOP, retry: () => d.p }, { doc, exampleName: 'E', criterion: { id: 'k_1', text: 'x' }, empty: { kind: 'limit', text: LIMIT_TEXT } });
  const lim = btnByText(root, 'Try again');
  lim.click();
  assert.equal(lim.disabled, true);
  d.resolve(); await d.p; await flush();
  assert.equal(lim.disabled, false);
  // By criterion
  d = deferred();
  const data = { rows: [{ key: '4|k:k_1', label: 'Names a metric', exampleName: 'Bulk', exact: false, trust: { state: 'confirm', n: 0, agree: 0, decides: true }, a: { met: 1, of: 1 }, b: { met: 1, of: 1 } }], more: 0 };
  renderByCriterion(root, data, { doc, labels: { a: 'v3', b: 'v4' }, onConfirm: () => d.p });
  const link = root.querySelector('button.wft-confirm');
  link.click();
  assert.equal(link.disabled, true);
  d.resolve(); await d.p; await flush();
  assert.equal(link.disabled, false);
  // The editor's criteria rows
  d = deferred();
  const s = renderCriteriaSection(doc, { criteria: [{ id: 'k_1', text: 'A' }, { id: 'k_2', text: 'B' }], judge: null },
    { trust: { k_1: { state: 'confirm', n: 0, agree: 0, decides: true }, k_2: { state: 'unreliable', n: 10, agree: 6, decides: false } }, onConfirm: () => d.p });
  root.replaceChildren(s.el);
  const conf = root.querySelector('button.wft-confirm');
  const fix = root.querySelector('button.wft-fix');
  conf.click();
  assert.deepEqual([conf.disabled, fix.disabled], [true, true], 'one round at a time from the editor');
  d.resolve(); await d.p; await flush();
  assert.deepEqual([conf.disabled, fix.disabled], [false, false]);
});

test('fix 1 (b): tests-app.mjs sends one answer at a time and one request for clearer words per round, and shows the words being written', async () => {
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  const ans = deferred();
  const words = deferred();
  const routes = {
    [`GET ${B}/examples/4/checker/7`]: { status: 200, body: view() },
    [`POST ${B}/examples/4/checker/7/answers`]: () => ans.p,
    [`POST ${B}/examples/4/checker/7/reword`]: () => words.p,
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  const rw = () => [...h.root.querySelectorAll('button.wft-cc-right, button.wft-cc-wrong')];
  rw()[1].click();   // Wrong on card 2 (cards 0 and 1 are answered)
  await settle();
  assert.ok(rw().every((b) => b.disabled), 'every Right / Wrong waits for the answer');
  rw()[3].click();   // a press on a disabled button sends nothing
  ans.resolve({ status: 200, body: view([true, true, false, null]) });
  await settle();
  assert.equal(h.root.querySelector('.wft-cc-state .wft-cc-wait').textContent, 'Worca is writing clearer words…');
  assert.equal(h.calls.filter(([m, p]) => m === 'POST' && p.endsWith('/reword')).length, 1);
  assert.equal(h.calls.filter(([m, p]) => m === 'POST' && p.endsWith('/answers')).length, 1);
  words.resolve({ status: 200, body: { text: 'Clearer' } });
  await settle();
  assert.equal(h.root.querySelector('.wft-cc-words').textContent, '"Clearer"');
  btnByText(h.root, 'Keep my words').click();
  await settle();
  assert.ok(rw().length === 2 && rw().every((b) => !b.disabled), 'the last card can be answered again');
});

// Fix round 6: user decision 2026-11-22 (review I4) and review M1.
const TOO_LONG = 'This result is too long for Worca to break on purpose. Check the checker works on results up to about 40,000 characters.';

test('user decision 2026-11-22: a result too long to break: "Check the checker did not start", its words, and only Back', () => {
  const { doc, root } = dom();
  const asked = [];
  renderChecker(root, null, { ...NOOP, back: () => asked.push('back'), retry: () => asked.push('retry') },
    { doc, exampleName: 'Bulk invoice export', criterion: { id: 'k_1', text: 'Names a metric' }, empty: { kind: 'long', text: TOO_LONG } });
  const box = root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Check the checker did not start');
  assert.equal(box.querySelector('.wft-cc-say').textContent, TOO_LONG);
  assert.deepEqual([...box.querySelectorAll('button')].map((b) => [b.textContent, b.className]), [['Back', 'btn btn-sm']], 'no Try again that can never work');
  btnByText(box, 'Back').click();
  assert.deepEqual(asked, ['back']);
});

test('user decision 2026-11-22: tests-app.mjs tells the too-long refusal from the other 422s', async () => {
  const { TOO_LONG_TEXT } = await import('../src/shared/workflow-tests/criteria-text.mjs');
  assert.equal(TOO_LONG_TEXT, TOO_LONG);
  const { createWorkflowTests } = await import('../ui/public/workflows/tests-app.mjs');
  const B = '/api/workflows/wf_a/tests';
  const failed = { ...view(), round: { id: 7, criterionId: 'k_1', status: 'failed', detail: 'This round did not finish. Start a new round.' }, cards: [] };
  const routes = {
    [`GET ${B}/examples/4/checker/7`]: { status: 200, body: failed },
    [`POST ${B}/examples/4/checker`]: { status: 422, body: { error: TOO_LONG } },
  };
  const h = harness(routes);
  const ctl = createWorkflowTests({ doc: h.doc, win: h.win, fetch: h.fetch, safeJson: (r) => r.json(), composer: () => ({ template: () => ({ id: 'wf_a' }) }),
    api: {}, versions: () => ({ showPage: () => ctl.enterList() }), currentView: () => 'workflows', confirmModal: async () => true, openNewPipeline: () => {},
    hdMarkdown: {}, mock: () => false, runPageShows: () => false });
  ctl.route('wf_a', 'tests/4/checker/7', true);
  await settle();
  btnByText(h.root, 'Try again').click();
  await settle();
  const box = h.root.querySelector('.wft-cc-state');
  assert.equal(box.querySelector('h2').textContent, 'Check the checker did not start');
  assert.equal(box.querySelector('.wft-cc-say').textContent, TOO_LONG);
  assert.equal(btnByText(box, 'Try again'), undefined);
  assert.equal(box.querySelector('.wft-cc-stop'), null, 'not the amber limit line');
});

test('review M1: a planted card whose excerpt is empty (a copy that only removed lines) draws no excerpt box', () => {
  const { doc, root } = dom();
  const v = view();
  v.cards[2] = { ...v.cards[2], excerpt: '' };
  renderChecker(root, v, NOOP, { doc, exampleName: 'E' });
  const cards = [...root.querySelectorAll('.wft-cc-card')];
  assert.deepEqual(cards.map((c) => c.querySelectorAll('.wft-cc-excerpt').length), [1, 1, 0, 1]);
  assert.equal(cards[2].querySelector('.wft-cc-planted').textContent, 'Broken on purpose: how to measure removed');
});

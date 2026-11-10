// test/ui-workflow-test-project-compare.test.mjs — workflow tests 3a: one example side by side for a project example (canvas
// boards 36, 37): what changed in the project, the picked file's diff, the command check, what the guard stopped, and the
// "For developers" facts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderSideBySide } from '../ui/public/workflows/test-compare.mjs';

const click = (el) => el.dispatchEvent(new el.ownerDocument.defaultView.MouseEvent('click', { bubbles: true }));
const texts = (root, sel) => [...root.querySelectorAll(sel)].map((n) => n.textContent);
const PATCH = ['diff --git a/src/core/billing/round.mjs b/src/core/billing/round.mjs', '--- a/src/core/billing/round.mjs', '+++ b/src/core/billing/round.mjs',
  '@@ -1,3 +1,4 @@', "+import { toCents } from './money.mjs';", ' export function roundCents(value) {', '-  return Math.round(value * 100) / 100;',
  '+  return toCents(value) / 100;', ' }', ''].join('\n');
const changes = (counts, files, added, removed) => ({ counts, files, total: files.length, added, removed });
const A = { tryId: 11, status: 'passed', connectors: 'pretend', text: null, name: null, truncated: false, answeredReads: [], wouldHaveSent: [],
  verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: true, value: '213 passed', output: 'ℹ pass 213' }] },
  project: { changes: changes({ added: 0, changed: 3, removed: 0 }, [
    { status: 'changed', path: 'src/core/billing/round.mjs', added: 2, removed: 1 }, { status: 'changed', path: 'src/core/billing/invoice-totals.mjs', added: 6, removed: 1 },
    { status: 'changed', path: 'test/billing/invoice-totals.test.mjs', added: 6, removed: 1 }], 14, 3), setup: { cmd: 'npm ci', ms: 110000 } } };
const B = { ...A, tryId: 12, status: 'failed',
  verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: false, value: '212 passed, 1 failed', output: 'ℹ pass 212\nℹ fail 1' }] },
  project: { changes: changes({ added: 1, changed: 2, removed: 1 }, [
    { status: 'changed', path: 'src/core/billing/round.mjs', added: 2, removed: 1 }, { status: 'added', path: 'src/core/billing/money.mjs', added: 12, removed: 0 },
    { status: 'removed', path: 'src/core/billing/legacy-round.mjs', added: 0, removed: 30 }, { status: 'changed', path: 'test/billing/invoice-totals.test.mjs', added: 8, removed: 0 }], 22, 31),
  setup: { cmd: 'npm ci', ms: 110000 } },
  wouldHaveSent: [
    { guard: true, server: 'git', tool: 'push', noun: 'push', to: null, preview: 'Send the changes to the branch fix-ticket-482', cap: 'Not sent · stopped by Worca',
      full: 'This try tried to send its changes to the branch fix-ticket-482 on GitHub.', cmd: 'git push origin fix-ticket-482' },
    { guard: true, server: 'GitHub CLI', tool: 'create a pull request', noun: 'pull request', to: null, preview: 'Create a pull request: Fix rounding in invoice totals',
      cap: 'Full text · from fix-ticket-482 into main', full: 'Title: Fix rounding in invoice totals', cmd: 'gh pr create --title "Fix rounding in invoice totals" --base main' }] };
const side = (over = {}) => ({
  run: { id: 5, kind: 'compare' }, compareTitle: 'Your v3 draft compared with v2', example: { id: 1, name: 'Ticket 482: invoice totals round wrong' },
  labels: { a: 'v2', b: 'v3 draft' }, row: { result: 'worse', a: { passed: 3, total: 3 }, b: { passed: 1, total: 3 } }, connectors: 'pretend',
  tries: [{ n: 1, a: A, b: B }], start: { ref: 'main', short: 'abc1234', at: '2026-10-28T09:00:00.000Z', setupCmd: 'npm ci', setupMs: 110000 },
  nothingPushed: true, ...over,
});
function boot(s = side(), { patches = new Map([[12, PATCH]]) } = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const calls = [];
  const actions = { back() {}, pick() {}, readWhole() {}, loadChanges: (id) => calls.push(['load', id]), pickFile: (k, p) => calls.push(['pick', k, p]),
    readChanges: (id, t) => calls.push(['all', id, t]), commandOutput: (t, o) => calls.push(['out', t, o]) };
  renderSideBySide(root, s, actions, { doc: window.document, tryIndex: 0, patches, picked: {}, dateText: () => '28 Oct' });
  return { root, calls };
}

test('board 36: the start in the header, what changed per version, the picked file\'s diff', () => {
  const { root, calls } = boot();
  assert.equal(root.querySelector('.wft-pg-head .hint').textContent, 'v2 passed 3 of 3 tries · v3 draft passed 1 of 3 · both started from main · 28 Oct');   // U-T14 (F26): the commit id is under "For developers" only
  assert.deepEqual(texts(root, '.wft-chgcard h2'), ['What changed in the project · v2', 'What changed in the project · v3 draft']);
  assert.deepEqual(texts(root, '.wft-chg-head .hint'), ['3 changed', '1 added, 2 changed, 1 removed']);
  const b = root.querySelectorAll('.wft-chgcard')[1];
  assert.deepEqual([...b.querySelectorAll('.wft-fbtn .badge')].map((x) => [x.textContent, x.className]),
    [['Changed', 'badge'], ['Added', 'badge green'], ['Removed', 'badge wft-badge-rm'], ['Changed', 'badge']]);
  assert.deepEqual([...b.querySelectorAll('.wft-fbtn')].map((x) => x.getAttribute('aria-pressed')), ['true', 'false', 'false', 'false']);
  const region = b.querySelector('.wft-diff');
  assert.equal(region.getAttribute('aria-label'), 'Changes in src/core/billing/round.mjs, v3 draft');
  assert.deepEqual([...region.querySelectorAll('.wft-dl')].map((l) => [l.className, l.textContent]), [
    ['wft-dl add', "+ import { toCents } from './money.mjs';"], ['wft-dl ctx', '  export function roundCents(value) {'],
    ['wft-dl del', '-   return Math.round(value * 100) / 100;'], ['wft-dl add', '+   return toCents(value) / 100;'], ['wft-dl ctx', '  }']]);
  assert.deepEqual(calls.filter((c) => c[0] === 'load'), [['load', 11]], 'the v2 try\'s diff is read; v3 draft\'s is already here');
  click(b.querySelectorAll('.wft-fbtn')[1]);
  assert.deepEqual(calls.at(-1), ['pick', 'b', 'src/core/billing/money.mjs']);
  const all = [...b.querySelectorAll('button')].find((x) => x.textContent === 'Read all the changes');
  assert.equal(all.getAttribute('aria-label'), 'Read all the changes, v3 draft');
  click(all);
  assert.deepEqual(calls.at(-1), ['all', 12, 'What changed in the project · v3 draft']);
});

test('board 36: the command check not met, and its output; the For developers facts', () => {
  const { root, calls } = boot();
  const why = root.querySelector('.wft-why-cmd');
  assert.equal(why.querySelector('span').textContent, 'Not met for v3 draft: the command ended with an error.');
  assert.equal(why.querySelector('b').textContent, 'Not met for v3 draft:');
  click([...why.querySelectorAll('button')].find((x) => x.textContent === 'See the command output'));
  assert.deepEqual(calls.at(-1), ['out', 'The command npm test passes · v3 draft', 'ℹ pass 212\nℹ fail 1']);
  const dev = root.querySelector('.wft-dev-card');
  assert.equal(dev.querySelector('h2').textContent, 'For developers');
  assert.equal(dev.querySelector('.hint').textContent, "Each try worked in Worca's own copy of the project, which was deleted after the checks. The list of changes and the full diff of each try are kept here.");
  assert.deepEqual(texts(dev, '.wft-dev-facts > span'), ['Start point: main at abc1234 · 28 Oct', 'Setup: npm ci · 1 min 50 s',
    'v2: 3 files, 14 lines added, 3 removed', 'v3 draft: 4 files, 22 lines added, 31 removed']);
});

test('board 37: the lock note; what the guard stopped, per version; nothing for the other', () => {
  const { root } = boot();
  assert.deepEqual(texts(root, '.wft-modes > .wft-mode > span:not(.ic)'), ['Connectors: pretend. Nothing was posted or sent.', "The changes stayed in Worca's own copy of the project: nothing was pushed."]);
  const [a, b] = root.querySelectorAll('.wft-sent');
  assert.equal(a.querySelector('.wft-sent-foot').textContent, "Nothing would have been sent. The changes stayed in Worca's own copy of the project: nothing was pushed.");
  assert.equal(b.querySelector('.wft-sent-head .hint').textContent, '1 push, 1 pull request');
  assert.deepEqual(texts(b, '.wft-call-line'), ['git · push · Send the changes to the branch fix-ticket-482',
    'GitHub CLI · create a pull request · Create a pull request: Fix rounding in invoice totals']);
  const first = b.querySelector('.wft-call-full');
  assert.equal(first.querySelector('.wft-call-cap').textContent, 'Not sent · stopped by Worca');
  assert.equal(first.querySelector('.wft-call-cmd').textContent, 'git push origin fix-ticket-482');
  assert.equal(b.querySelectorAll('.wft-call-cap')[1].textContent, 'Full text · from fix-ticket-482 into main');
  assert.equal([...b.querySelectorAll('.wft-sent-foot')].at(-1).textContent, 'Each one answered "Not sent: this is a test."');
});

test('board 37 with Real: the lock note says pushes stay blocked; a real try still lists what the guard stopped', () => {
  const real = side({ connectors: 'real', tries: [{ n: 1, a: { ...A, connectors: 'real' }, b: { ...B, connectors: 'real' } }] });
  const { root } = boot(real);
  const lock = [...root.querySelectorAll('.wft-modes > .wft-mode > span:not(.ic)')].at(-1);
  assert.equal(lock.textContent, "The changes stayed in Worca's own copy of the project: nothing was pushed. Pushes, pull requests and issues stay blocked in every test, also with Real connectors.");
  assert.equal(root.querySelectorAll('.wft-sent').length, 1, 'only the column whose try the guard stopped');
  assert.ok(root.querySelector('.wft-sent-real'), 'the other keeps Part 2\'s real note');
  // Fix 1 (P32): the column the guard stopped still says it used real connectors, before the rows; only the stopped ones answered.
  const sent = root.querySelector('.wft-sent');
  assert.equal(sent.querySelector('.wft-mode').textContent, 'Connectors: real. This try used your real connectors.');
  assert.ok(sent.querySelector('.wft-mode').compareDocumentPosition(sent.querySelector('.wft-call')) & 4, 'the note comes before the rows');
  assert.equal([...sent.querySelectorAll('.wft-sent-foot')].at(-1).textContent, 'Each one Worca stopped answered "Not sent: this is a test."');
});

test('Fix 1 (P32): a command its time limit stopped says so, with or without output', () => {
  const slow = (output) => ({ ...B, verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: false, value: 'Stopped after 5 minutes',
    ...(output ? { output } : {}), timedOut: true }] } });
  const { root, calls } = paint(side({ tries: [{ n: 1, a: A, b: slow('ℹ pass 40') }] }));
  const why = root.querySelector('.wft-why-cmd');
  assert.equal(why.querySelector('span').textContent, 'Not met for v3 draft: the command ran longer than its time limit and was stopped.');
  click(why.querySelector('button'));
  assert.deepEqual(calls.at(-1), ['out', 'The command npm test passes · v3 draft', 'ℹ pass 40']);
  const quiet = paint(side({ tries: [{ n: 1, a: A, b: slow(null) }] })).root.querySelector('.wft-why-cmd');
  assert.equal(quiet.textContent, 'Not met for v3 draft: the command ran longer than its time limit and was stopped.');
  assert.equal(quiet.querySelector('button'), null, 'no output: no button');
});

function paint(s, o = {}) {
  const { window } = new JSDOM('<!doctype html><body><section id="root"></section></body>');
  const root = window.document.getElementById('root');
  const calls = [];
  const actions = { back() {}, pick() {}, readWhole() {}, loadChanges: (id) => calls.push(['load', id]), pickFile: (k, p) => calls.push(['pick', k, p]),
    readChanges: (id, t) => calls.push(['all', id, t]), commandOutput: (t, out) => calls.push(['out', t, out]) };
  renderSideBySide(root, s, actions, { doc: window.document, tryIndex: 0, patches: new Map(), picked: {}, dateText: () => '28 Oct', ...o });
  return { root, calls };
}

test('board 36: the picked file follows `picked`; the buttons control the diff; "Renamed" is plain; the diff is text, never markup', () => {
  const evil = PATCH.replace("+  return toCents(value) / 100;", '+  return "<img src=x onerror=alert(1)>";');
  const files = [...B.project.changes.files, { status: 'renamed', from: 'src/old.mjs', path: 'src/new.mjs', added: 0, removed: 0 }];
  const b2 = { ...B, project: { ...B.project, changes: { ...B.project.changes, files, total: files.length } } };
  const { root } = paint(side({ tries: [{ n: 1, a: A, b: b2 }] }), { patches: new Map([[11, ''], [12, evil]]), picked: { b: 'src/core/billing/round.mjs' } });
  const b = root.querySelectorAll('.wft-chgcard')[1];
  const btns = [...b.querySelectorAll('.wft-fbtn')];
  assert.deepEqual(btns.map((x) => x.getAttribute('aria-controls')), Array(5).fill('wft-diff-b'));
  assert.equal(b.querySelector('.wft-diff').id, 'wft-diff-b');
  assert.deepEqual([btns[4].querySelector('.badge').textContent, btns[4].querySelector('.badge').className], ['Renamed', 'badge']);
  assert.equal(b.querySelector('img'), null, 'a diff line is text');
  assert.ok(texts(b, '.wft-dl').includes('+   return "<img src=x onerror=alert(1)>";'));
  assert.equal(b.querySelector('.wft-diff').tabIndex, 0, 'it scrolls sideways: the keys reach it');
  // v2's try has no diff kept (''): its card says so; a file the diff does not hold says that.
  assert.equal(root.querySelectorAll('.wft-chgcard')[0].querySelector('.wft-diff-note').textContent, 'Worca kept no record of what this try changed.');
  const { root: r2 } = paint(side(), { patches: new Map([[11, PATCH], [12, PATCH]]), picked: { b: 'src/core/billing/money.mjs' } });
  assert.equal(r2.querySelectorAll('.wft-chgcard')[1].querySelector('.wft-diff-note').textContent, 'No changes to show for this file.');
  assert.equal(r2.querySelectorAll('.wft-chgcard')[1].querySelector('.wft-diff').getAttribute('aria-label'), 'Changes in src/core/billing/money.mjs, v3 draft');
});

test('board 36: reading, not read, shortened, more files (P30)', () => {
  const many = Array.from({ length: 50 }, (_, k) => ({ status: 'added', path: `gen/f${k}.mjs`, added: 1, removed: 0 }));
  const lines = ['diff --git a/gen/f0.mjs b/gen/f0.mjs', 'new file mode 100644', '--- /dev/null', '+++ b/gen/f0.mjs', '@@ -0,0 +1,450 @@',
    ...Array.from({ length: 450 }, (_, k) => `+line ${k}`), ''].join('\n');
  const a2 = { ...A, project: { ...A.project, changes: { counts: { added: 52, changed: 0, removed: 0 }, files: many, total: 52, added: 52, removed: 0 } } };
  const { root, calls } = paint(side({ tries: [{ n: 1, a: a2, b: B }] }), { patches: new Map([[11, lines], [12, null]]) });
  const [a, b] = root.querySelectorAll('.wft-chgcard');
  assert.equal(a.querySelector('.wft-chg-more').textContent, 'And 2 more files: read all the changes.');
  assert.equal(a.querySelectorAll('.wft-dl').length, 400);
  assert.equal(a.querySelector('.wft-diff-note').textContent, 'Shortened here: read all the changes.');
  assert.equal(b.querySelector('.wft-diff-note').textContent, 'Worca could not read the changes of this try. Read all the changes to try again.');
  assert.deepEqual(calls, [], 'nothing to read: both are known');
  const { root: r2 } = paint(side());
  assert.equal(r2.querySelector('.wft-diff-note').textContent, 'Reading the changes…');
});

test('P7: a project try\'s "What it wrote" card only when it left a result; Try it once now: one column, "started from"', () => {
  const withText = { ...B, text: 'Fixed the rounding.' };
  const { root } = paint(side({ tries: [{ n: 1, a: A, b: withText }] }));
  assert.deepEqual(texts(root, '.wft-out-card h2'), ['What v3 draft wrote']);
  const once = side({ run: { id: 5, kind: 'once' }, labels: { a: null, b: 'Your draft' }, row: { result: null, a: { passed: 0, total: 0 }, b: { passed: 1, total: 1 } },
    tries: [{ n: 1, a: null, b: A }] });
  const { root: r1 } = paint(once);
  assert.equal(r1.querySelector('.wft-pg-head .hint').textContent, 'Your draft passed 1 of 1 try · started from main · 28 Oct');
  assert.deepEqual(texts(r1, '.wft-chgcard h2'), ['What changed in the project · Your draft']);
  assert.deepEqual(texts(r1, '.wft-dev-facts > span').slice(2), ['Your draft: 3 files, 14 lines added, 3 removed']);
  assert.equal(paint({ ...once, tries: [{ n: 1, a: null, b: B }] }).root.querySelector('.wft-why-cmd span').textContent,
    'Not met for your draft: the command ended with an error.');
});

test('a command met, or one not met with no output, has no output button; Part 2 sides keep their pages', () => {
  const quiet = { ...B, verdict: { basics: [], checks: [{ id: 'c_1', label: 'The command npm test passes', met: false, value: 'Not met', output: '' }] } };
  const { root } = paint(side({ tries: [{ n: 1, a: A, b: quiet }] }));
  const why = root.querySelector('.wft-why-cmd');
  assert.equal(why.textContent, 'Not met for v3 draft: the command ended with an error.');
  assert.equal(why.querySelector('button'), null);
  assert.equal(why.closest('.wft-crow').firstChild.textContent, 'The command npm test passes', 'under its own row (board 36)');
  const part2 = side({ start: null, nothingPushed: false, tries: [{ n: 1, a: { ...A, project: null }, b: { ...B, project: null, wouldHaveSent: [] } }] });
  const { root: r2 } = paint(part2);
  assert.equal(r2.querySelector('.wft-chgcard'), null);
  assert.equal(r2.querySelector('.wft-dev-card'), null);
  assert.equal(r2.querySelector('.wft-pg-head .hint').textContent, 'v2 passed 3 of 3 tries · v3 draft passed 1 of 3');
  assert.deepEqual(texts(r2, '.wft-sent-foot'), ['Nothing would have been sent.', 'Nothing would have been sent.']);
});

// test/ui-shape-run-facts.test.mjs — Shaper small runs D2 (D10): ui/public/shape/run-facts.mjs, the run's "Starts from"
// fact and its "Owns" rows, one box shared by the live page, the saved page and the chat run panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { mountRunFacts } from '../ui/public/shape/run-facts.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const INFO = {
  featureId: 'feat_1', title: 'Charts everywhere', index: 4, total: 10, sliceTitle: 'Export', state: 'running', next: null,
  owns: [{ id: 'R-po-1', text: 'Export the report', pass: true }, { id: 'R-arch-10', text: 'It stays fast', pass: false },
    { id: 'R-qa-2', text: 'It is tested', pass: null }],
  startsFrom: { kind: 'run', run: 3, branch: 'feat/run-3', text: 'the latest finished run (run 3)' },
  stored: { planVersion: 1, planReviewed: false, tests: null },
};
const hostOf = () => { const h = doc.createElement('div'); h.className = 'rd-run-facts'; return h; };

test('one Starts-from fact (an .rd-kv row, data-fact="starts") and one Owns row per id in a .plan-body.srows.run-facts box', () => {
  const host = hostOf();
  const box = mountRunFacts(host, INFO);
  assert.equal(box, host.querySelector(':scope > .plan-body.srows.run-facts'));
  const starts = box.querySelectorAll('[data-fact="starts"]');
  assert.equal(starts.length, 1);
  assert.ok(starts[0].closest('dl.rd-kv'));
  assert.equal(starts[0].querySelector('dt.rd-kv-k').textContent, 'Starts from');
  assert.equal(starts[0].querySelector('dd.rd-kv-v').textContent, 'the latest finished run (run 3)');
  const rows = [...box.querySelectorAll('.plan-check-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-id').textContent), ['R-po-1', 'R-arch-10', 'R-qa-2']);
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-label').textContent), ['Export the report', 'It stays fast', 'It is tested']);
  assert.deepEqual(rows.map((r) => r.title), ['R-po-1 · Export the report', 'R-arch-10 · It stays fast', 'R-qa-2 · It is tested']);
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label')), ['met', 'unmet', 'waiting']);
  assert.ok(rows[2].querySelector('.plan-check-mark').classList.contains('is-wait'));
  assert.equal(box.textContent.match(/Starts from/g).length, 1);
  assert.equal(box.textContent.match(/Owns/g).length, 1);
});

test('an Owns row shows the word and no run number', () => {
  const info = { ...INFO, owns: [{ id: 'R-po-1', text: 'Export the report', pass: null, word: 'being built', mark: 'live' },
    { id: 'R-qa-2', text: 'It is tested', pass: true, word: 'met', mark: 'check' }] };
  const rows = [...mountRunFacts(hostOf(), info).querySelectorAll('.plan-check-row')];
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-detail').textContent), ['being built', 'met']);
  assert.deepEqual(rows.map((r) => r.querySelector('.plan-check-mark').getAttribute('aria-label')), ['being built', 'met']);
  assert.ok(rows[0].querySelector('.plan-check-mark').classList.contains('is-live'));
  assert.ok(rows.every((r) => !/\brun \d/i.test(r.textContent)), 'the head\'s kind chip says the run number');
});

test('the box names neither the feature title nor the run\'s own "Run N"', () => {
  const box = mountRunFacts(hostOf(), INFO);
  assert.doesNotMatch(box.textContent, /Charts everywhere/);
  assert.doesNotMatch(box.textContent, /\bRun 4\b/i);
  assert.doesNotMatch(box.textContent, /\brun 4\b/);
});

test('a branch source names it in mono; startsFrom null drops only the starts row; no owned ids: no Owns list', () => {
  const branch = mountRunFacts(hostOf(), { ...INFO, startsFrom: { kind: 'branch', branch: 'hotfix/x', text: 'the branch hotfix/x' } });
  const dd = branch.querySelector('[data-fact="starts"] dd');
  assert.equal(dd.textContent, 'the branch hotfix/x');
  assert.equal(dd.querySelector('code.mono, .mono').textContent, 'hotfix/x');
  const noSource = mountRunFacts(hostOf(), { ...INFO, startsFrom: null });
  assert.equal(noSource.querySelector('[data-fact="starts"]'), null);
  assert.equal(noSource.querySelectorAll('.plan-check-row').length, 3, 'the Owns rows are still drawn');
  const noOwns = mountRunFacts(hostOf(), { ...INFO, owns: [] });
  assert.equal(noOwns.querySelectorAll('[data-fact="starts"]').length, 1);
  assert.equal(noOwns.querySelector('.plan-check-row'), null);
  assert.doesNotMatch(noOwns.textContent, /Owns/);
});

test('null info (or info without owns) hides and empties the host; a second call gives the same DOM', () => {
  const host = hostOf();
  mountRunFacts(host, INFO);
  const html = host.innerHTML;
  const box = host.firstElementChild;
  mountRunFacts(host, INFO);
  assert.equal(host.innerHTML, html);
  assert.equal(host.firstElementChild, box, 'repainted in place');
  assert.equal(host.hidden, false);
  assert.equal(mountRunFacts(host, null), null);
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  mountRunFacts(host, INFO);
  assert.equal(host.hidden, false);
  const { owns, ...noOwns } = INFO;
  assert.ok(owns);
  assert.equal(mountRunFacts(host, noOwns), null);
  assert.equal(host.hidden, true);
  assert.equal(host.children.length, 0);
  assert.equal(mountRunFacts(null, INFO), null);
});

// ── Slice 11 (R-po-6): Waits for and Needed by ───────────────────────────────────────────────────────────────────────
const rowsOf = (box) => [...box.querySelectorAll('dl.rd-kv > .rd-kv-row')].map((r) => [r.dataset.fact, r.querySelector('dt').textContent, r.querySelector('dd').textContent]);

test('S11-T8 run 7: Starts from, Waits for 2, 6, Needed by 12, in that order, each once; run 1 reads its long list whole', () => {
  const box = mountRunFacts(hostOf(), { ...INFO, index: 7, links: { waitsFor: [2, 6], neededBy: [12] } });
  assert.deepEqual(rowsOf(box).map((r) => r.slice(0, 2)), [['starts', 'Starts from'], ['waits', 'Waits for'], ['needed', 'Needed by']]);
  assert.deepEqual(rowsOf(box).slice(1).map((r) => r[2]), ['2, 6', '12']);
  assert.equal(box.textContent.match(/Waits for/g).length, 1);
  assert.equal(box.textContent.match(/Needed by/g).length, 1);
  const one = mountRunFacts(hostOf(), { ...INFO, links: { waitsFor: [], neededBy: [2, 3, 4, 7, 8, 12] } });
  assert.equal(one.querySelector('[data-fact="needed"] dd').textContent, '2, 3, 4, 7, 8, 12');
});

test('S11-T9 no dependants reads Needed by: nothing; an empty Waits for is left out', () => {
  const box = mountRunFacts(hostOf(), { ...INFO, links: { waitsFor: [], neededBy: [] } });
  assert.equal(box.querySelector('[data-fact="needed"] dd').textContent, 'nothing');
  assert.equal(box.querySelector('[data-fact="waits"]'), null);
});

test('S11-T10 startsFrom null with links: only the two link rows in one dl; no links: no new rows; a second paint is the same DOM', () => {
  const host = hostOf();
  const box = mountRunFacts(host, { ...INFO, startsFrom: null, links: { waitsFor: [2], neededBy: [3] } });
  assert.equal(box.querySelectorAll('dl.rd-kv').length, 1);
  assert.deepEqual(rowsOf(box).map((r) => r[0]), ['waits', 'needed']);
  const plain = mountRunFacts(hostOf(), INFO);
  assert.equal(plain.querySelector('[data-fact="waits"]'), null);
  assert.equal(plain.querySelector('[data-fact="needed"]'), null);
  const info = { ...INFO, links: { waitsFor: [2, 6], neededBy: [12] } };
  mountRunFacts(host, info);
  const html = host.innerHTML;
  mountRunFacts(host, info);
  assert.equal(host.innerHTML, html);
});

// ── Slice 16 (R-po-6): the requirement's example, and a started run with every dependency done ────────────────────────
test('S16-T3 run 7: Waits for 2, 6 and Needed by 8, 12, in that order, each once', () => {
  const box = mountRunFacts(hostOf(), { ...INFO, index: 7, links: { waitsFor: [2, 6], neededBy: [8, 12] } });
  assert.deepEqual(rowsOf(box).slice(1), [['waits', 'Waits for', '2, 6'], ['needed', 'Needed by', '8, 12']]);
  assert.equal(box.textContent.match(/Waits for/g).length, 1);
  assert.equal(box.textContent.match(/Needed by/g).length, 1);
});

test('S16-T4 a started run with all dependencies done has no Waits for row at all, only Starts from and Needed by', () => {
  const box = mountRunFacts(hostOf(), { ...INFO, index: 7, links: { waitsFor: [], neededBy: [12] } });
  assert.deepEqual(rowsOf(box).map((r) => r[0]), ['starts', 'needed']);
  assert.equal(box.querySelector('[data-fact="waits"]'), null);
  assert.doesNotMatch(box.textContent, /Waits for/);
  assert.equal(box.querySelector('[data-fact="needed"] dd').textContent, '12');
});

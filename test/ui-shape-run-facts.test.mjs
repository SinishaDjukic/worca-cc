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

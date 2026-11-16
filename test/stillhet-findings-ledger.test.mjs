// test/stillhet-findings-ledger.test.mjs — plans/rail/findings.md keeps one shape (D14 of the feature 1 final check): every
// Open row has a named owner from a fixed list, every Closed row names a PR or a reason, and no row the final check fixed is
// still Open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../plans/rail/findings.md', import.meta.url), 'utf8');
const OWNERS = ['feature 3', 'Projects slice', 'final cleanup PR', 'owner decision', 'dev PR (owner to open the issue)', 'feature 2 final check'];
/** The rows of the table under `## title`: each a list of its cells. */
function rows(title) {
  const at = doc.indexOf(`\n## ${title}\n`);
  assert.ok(at >= 0, `a ## ${title} section`);
  const next = doc.indexOf('\n## ', at + 1);
  return doc.slice(at, next < 0 ? undefined : next).split('\n').filter((l) => /^\|/.test(l)).slice(2)
    .map((l) => l.slice(1, l.lastIndexOf('|')).split(' | ').map((c) => c.trim()));
}

test('every Open row reads open (owner: X), X one of the owners', () => {
  const open = rows('Open');
  assert.ok(open.length > 0, 'the rows are read');
  for (const r of open) {
    assert.equal(r.length, 6, r.join(' | '));
    const m = /^open \(owner: (.+)\)$/.exec(r[5]);
    assert.ok(m, `Status: ${r[5]}`);
    assert.ok(OWNERS.includes(m[1]), `owner: ${m[1]}`);
  }
});

test('every Closed row names a PR or starts reason:', () => {
  const closed = rows('Closed');
  assert.ok(closed.length > 0, 'the rows are read');
  for (const r of closed) {
    assert.equal(r.length, 4, r.join(' | '));
    assert.match(r[3], /^(#\d+|this PR)$|^reason: \S/, `Closed by: ${r[3]}`);
  }
});

test('no row the final check fixed is still Open', () => {
  const open = rows('Open').map((r) => r[2]).join('\n');
  for (const fixed of ['usage rings', 'Needs you rows', '#959', 'review verdict', 'unapproved plan', 'needy round', 'removed run ids', '{base}', 'Archive toast',
    'Delete\'s confirm', "does: 'pr'", 'cap refusal', 'Bulk Label', '404s', 'account menu', 'Double full stop', 'clipped at 360', 'group page head', 'What broke',
    'empty live diff', 'state.capUsd', 'stub `gh`', 'Merge confirm and its new live actions', 'Audit a run cost cap', "composer's project picker reads"]) {
    assert.ok(!open.includes(fixed), `still open: ${fixed}`);
  }
});

test('the owner\'s real-test rows (#1298) are Closed by this PR: the Pulse project item, the not-live places, the stale bar, the first Marketplace sync', () => {
  const closed = rows('Closed'), open = rows('Open');
  const at = (from, area, words) => closed.find((r) => r[0] === from && r[1] === area && r[2].includes(words));
  for (const [from, area, words] of [['owner real test (4402)', 'Pulse', 'Your copy is older'], ['owner real test (4403)', 'Shell', 'not-live places drew No … yet'],
    ['owner real test (4403)', 'Shell', 'the bar kept the last place\'s rows'], ['triage (fresh home)', 'Marketplace', 'a fresh install never synced the builtin']]) {
    const r = at(from, area, words);
    assert.ok(r, `Closed: ${from} | ${area} | ${words}`);
    assert.equal(r.length, 4);
    assert.equal(r[3], 'this PR');
  }
  assert.ok(!open.some((r) => r[0] === 'owner real test (4402)' && r[1] === 'Pulse'), 'no longer Open');
});

test('#1310: a person\'s work over time is Closed by this PR; the Timeline\'s not-homed parts stay Open for the owner', () => {
  const closed = rows('Closed'), open = rows('Open');
  const done = closed.find((r) => r[0] === 'slice 10' && r[1] === 'Insights' && r[2].includes("a person's work over time"));
  assert.ok(done, 'the Closed row'); assert.equal(done[3], 'this PR');
  const left = open.find((r) => r[0] === 'slice 10' && r[1] === 'Insights' && r[2].includes('Timeline is homed only in part'));
  assert.ok(left, 'the Open row');
  for (const words of ['team-wide items view', 'Shipped / In review / Needs attention tiles', 'filters', '"PRs outside Worca" switch']) assert.ok(left[2].includes(words), words);
  assert.equal(left[5], 'open (owner: owner decision)');
  assert.ok(!open.some((r) => r[2].includes('Timeline tab has no Stillhet home yet')), 'the old row is narrowed, not kept');
});

test('gate.real-data F-cov23-07: the presets Duplicate makes and Stillhet cannot rename or delete are an Open row for feature 3 (Settings › Presets, slice 12)', () => {
  const r = rows('Open').find((x) => x[0] === 'gate.real-data (COV-2)' && x[1] === 'New task' && x[2].includes('F-cov23-07'));
  assert.ok(r, 'the Open row');
  for (const words of ['Duplicate', '(copy)', 'rename', 'delete', 'Settings › Presets', 'slice 12']) assert.ok(r[2].includes(words), words);
  assert.equal(r[5], 'open (owner: feature 3)');
});

test('F-cov23-09 (#1392): a proposal\'s files on the closed card stay Open for feature 3', () => {
  const row = rows('Open').find((r) => /F-cov23-09/.test(r[2]));
  assert.ok(row, 'an Open row');
  assert.equal(row[5], 'open (owner: feature 3)');
});

// test/stillhet-findings-ledger.test.mjs — plans/rail/findings.md keeps one shape (D14 of the feature 1 final check): every
// Open row has a named owner from a fixed list, every Closed row names a PR or a reason, and no row the final check fixed is
// still Open.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../plans/rail/findings.md', import.meta.url), 'utf8');
const OWNERS = ['feature 3', 'Projects slice', 'final cleanup PR', 'owner decision', 'dev PR (owner to open the issue)'];
/** The rows of the table under `## title`: each a list of its cells. */
function rows(title) {
  const at = doc.indexOf(`\n## ${title}\n`);
  assert.ok(at >= 0, `a ## ${title} section`);
  const next = doc.indexOf('\n## ', at + 1);
  return doc.slice(at, next < 0 ? undefined : next).split('\n').filter((l) => /^\|/.test(l)).slice(2)
    .map((l) => l.slice(1, l.lastIndexOf('|')).split(' | ').map((c) => c.trim()));
}

test('every Open row reads open (owner: X), X one of the five owners', () => {
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
    'empty live diff', 'state.capUsd', 'stub `gh`', 'Merge confirm and its new live actions', 'Audit a run cost cap']) {
    assert.ok(!open.includes(fixed), `still open: ${fixed}`);
  }
});

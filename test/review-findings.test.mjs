// test/review-findings.test.mjs — the finding-disposition contract (src/shared/review/findings.mjs, #990 slice 3): every
// finding comes back fixed or disputed (with a reason), a finding with no answer stays open, every round carries plain
// counts, old rounds derive them, and two roles contradicting each other on one section make one conflict.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DISPOSITIONS_MAX_BYTES, normalizeDispositions, applyDispositions, roleCounts, reviewCounts, withCounts, roundCounts,
  findingIds, normalizeConflicts, normalizePicks, conflictClarifications, withClarifications, dispositionsPathFor,
  dispositionsBlock,
} from '../src/shared/review/findings.mjs';

const finding = (id, severity, section = 'Testing') => ({ id, severity, title: id, section, fix: 'f', status: 'open' });
/** 3 findings across 2 roles, plus a role skipped from the last round. */
const fixtureRound = () => ({ pass: 1, round: 1, plan: '/p/plan.md', roles: [
  { key: 'ux', label: 'UX', skipped: false, findings: [finding('ux-1-1', 'major'), finding('ux-1-2', 'minor', 'Rollout')], checklist: [] },
  { key: 'qa', label: 'QA', skipped: false, findings: [finding('qa-1-1', 'critical', ' rollout ')], checklist: [] },
  { key: 'product', label: 'Product', skipped: true, findings: [finding('product-0-1', 'major')], checklist: [] },
] });
const ANSWER = { dispositions: [
  { id: 'ux-1-1', status: 'fixed' },
  { id: 'qa-1-1', status: 'disputed', reason: 'The plan already covers the empty state in Testing.' },
] };
const isCounts = (c) => ['raised', 'fixed', 'disputed', 'open'].every((k) => Number.isInteger(c[k]) && c[k] >= 0)
  && Object.keys(c).length === 4;

test('a missing disposition stays open; fixed carries the version, disputed its reason', () => {
  const round = applyDispositions(fixtureRound(), ANSWER, 3);
  const [ux1, ux2] = round.roles[0].findings;
  const qa1 = round.roles[1].findings[0];
  assert.deepEqual([ux1.status, ux1.fixedIn], ['fixed', 3]);
  assert.deepEqual([qa1.status, qa1.reason, qa1.disputedIn], ['disputed', 'The plan already covers the empty state in Testing.', 3]);
  assert.equal(ux2.status, 'open');
  assert.equal('reason' in ux2 || 'fixedIn' in ux2, false);
});

test('without a version (a non-refiner sink) fixed has no fixedIn and disputed has disputedIn null', () => {
  const round = applyDispositions(fixtureRound(), ANSWER);
  assert.equal('fixedIn' in round.roles[0].findings[0], false);
  assert.equal(round.roles[1].findings[0].disputedIn, null);
});

test('a re-applied answer clears the fields an earlier one set', () => {
  const round = applyDispositions(fixtureRound(), ANSWER, 2);
  applyDispositions(round, {}, 3);
  for (const f of round.roles.slice(0, 2).flatMap((r) => r.findings)) {
    assert.deepEqual([f.status, 'fixedIn' in f, 'disputedIn' in f, 'reason' in f], ['open', false, false, false], f.id);
  }
});

test('a disputed entry with no reason stays open; an unknown status is no answer', () => {
  const round = applyDispositions(fixtureRound(), { dispositions: [
    { id: 'ux-1-1', status: 'disputed', reason: '   ' }, { id: 'ux-1-2', status: 'wontfix', reason: 'x' }] }, 2);
  assert.deepEqual(round.roles[0].findings.map((f) => f.status), ['open', 'open']);
});

test('normalizeDispositions: dispositions override addressed; ids are strings; reasons are one line, 300 at most', () => {
  const d = normalizeDispositions({ addressed: ['a-1-1', 'a-1-2'], dispositions: [
    { id: 'a-1-1', status: 'disputed', reason: 'wrong\nsection' }, { id: 7, status: 'disputed', reason: 'y'.repeat(400) }] });
  assert.deepEqual(d.get('a-1-1'), { status: 'disputed', reason: 'wrong section' });
  assert.deepEqual(d.get('a-1-2'), { status: 'fixed', reason: '' });
  assert.equal(d.get('7').reason.length, 300);
  assert.equal(normalizeDispositions(null).size, 0);
  assert.equal(normalizeDispositions({ dispositions: 'x', addressed: 5 }).size, 0);
});

test('normalizeDispositions reads at most 500 entries', () => {
  const many = Array.from({ length: 600 }, (_, i) => ({ id: `a-1-${i + 1}`, status: 'fixed' }));
  const d = normalizeDispositions({ dispositions: many });
  assert.equal(d.size, 500);
  assert.equal(d.has('a-1-501'), false);
});

test('addressed alone marks findings fixed (a refiner that follows its unchanged directive)', () => {
  const round = applyDispositions(fixtureRound(), { summary: 'ok', issues: [], addressed: ['ux-1-1', 'qa-1-1'] }, 2);
  assert.deepEqual(round.roles.map((r) => r.findings.map((f) => f.status)), [['fixed', 'open'], ['fixed'], ['open']]);
  assert.deepEqual(round.counts, { raised: 3, fixed: 2, disputed: 0, open: 1 });
});

test('counts are four integers: reviewCounts returns 3 raised, 1 fixed, 1 disputed, 1 open for the fixture', () => {
  const round = applyDispositions(fixtureRound(), ANSWER, 2);
  assert.deepEqual(reviewCounts(round), { raised: 3, fixed: 1, disputed: 1, open: 1 });
  assert.deepEqual(round.counts, { raised: 3, fixed: 1, disputed: 1, open: 1 }, 'applyDispositions ends with withCounts');
  assert.deepEqual(round.roles[0].counts, { raised: 2, fixed: 1, disputed: 0, open: 1 });
  assert.deepEqual(round.roles[1].counts, { raised: 1, fixed: 0, disputed: 1, open: 0 });
  for (const c of [round.counts, ...round.roles.slice(0, 2).map((r) => r.counts)]) assert.ok(isCounts(c), JSON.stringify(c));
});

test('counts add up: raised is every non-skipped finding and equals fixed + disputed + open', () => {
  for (const answer of [{}, ANSWER, { addressed: ['ux-1-1', 'ux-1-2', 'qa-1-1'] }]) {
    const c = applyDispositions(fixtureRound(), answer, 2).counts;
    assert.equal(c.raised, 3);
    assert.equal(c.raised, c.fixed + c.disputed + c.open);
  }
});

test('skipped roles are left out: no counts on their record, none of their findings counted or listed', () => {
  const round = withCounts(fixtureRound());
  assert.equal('counts' in round.roles[2], false);
  assert.deepEqual(round.counts, { raised: 3, fixed: 0, disputed: 0, open: 3 });
  const stale = fixtureRound();
  stale.roles[2].counts = { raised: 9, fixed: 9, disputed: 0, open: 0 };
  assert.equal('counts' in withCounts(stale).roles[2], false, 'a copied record loses its stale counts');
  assert.deepEqual(findingIds(fixtureRound()), ['ux-1-1', 'ux-1-2', 'qa-1-1']);
  applyDispositions(stale, { addressed: ['product-0-1'] }, 2);
  assert.equal(stale.roles[2].findings[0].status, 'open', 'a skipped role keeps its record');
});

test('roundCounts derives counts for an old round; stored valid counts are returned as they are', () => {
  const old = fixtureRound();
  old.roles[0].findings[0].status = 'fixed';
  old.roles[1].findings[0].status = 'fixed';
  assert.deepEqual(roundCounts(old), { raised: 3, fixed: 2, disputed: 0, open: 1 });
  assert.deepEqual(roundCounts({ ...old, counts: { raised: 1, fixed: 1, disputed: 0, open: 0 } }), { raised: 1, fixed: 1, disputed: 0, open: 0 });
  for (const bad of [{ raised: -1, fixed: 0, disputed: 0, open: 0 }, { raised: 1.5, fixed: 0, disputed: 0, open: 0 }, { raised: 3 }, 'x']) {
    assert.deepEqual(roundCounts({ ...old, counts: bad }), { raised: 3, fixed: 2, disputed: 0, open: 1 }, JSON.stringify(bad));
  }
  assert.deepEqual(roleCounts({ findings: [{ status: 'weird' }, { status: 'disputed' }] }), { raised: 2, fixed: 0, disputed: 1, open: 1 });
  assert.deepEqual(roleCounts(null), { raised: 0, fixed: 0, disputed: 0, open: 0 });
  assert.deepEqual(roundCounts(null), { raised: 0, fixed: 0, disputed: 0, open: 0 });
});

const conflict = (a, b, o = {}) => ({ findings: [a, b], question: 'Modal or inline?', options: ['Keep the modal', 'Inline'], ...o });

test('normalizeConflicts keeps one card per pair, in either order, with roles and section', () => {
  const out = normalizeConflicts({ conflicts: [conflict('ux-1-2', 'qa-1-1'), conflict('qa-1-1', 'ux-1-2')] }, fixtureRound());
  assert.deepEqual(out, [{ id: 'conflict-1', findings: ['ux-1-2', 'qa-1-1'], roles: ['ux', 'qa'], section: 'Rollout',
    question: 'Modal or inline?', options: ['Keep the modal', 'Inline'] }]);
});

test('normalizeConflicts drops same-role, unknown, skipped, different-section, bad-question and too-few-option pairs', () => {
  const round = fixtureRound();
  round.roles[0].findings.push(finding('ux-1-3', 'minor', 'Rollout'));
  const bad = [
    conflict('ux-1-2', 'ux-1-3'),                         // same role
    conflict('ux-1-2', 'nope-1-1'),                       // unknown
    conflict('qa-1-1', 'product-0-1'),                    // skipped role
    conflict('ux-1-1', 'qa-1-1'),                         // Testing vs Rollout
    conflict('ux-1-2', 'qa-1-1', { question: '' }),
    conflict('ux-1-2', 'qa-1-1', { question: 'q'.repeat(301) }),
    conflict('ux-1-2', 'qa-1-1', { options: ['only one', 'only one', ' '] }),
    { findings: ['ux-1-2'], question: 'q', options: ['a', 'b'] },
  ];
  assert.deepEqual(normalizeConflicts({ conflicts: bad }, round), []);
  assert.deepEqual(normalizeConflicts(null, round), []);
  assert.deepEqual(normalizeConflicts({ conflicts: [conflict('ux-1-2', 'qa-1-1', { options: ['A', 'B', 'C', 'D', 'E'] })] }, round)[0].options,
    ['A', 'B', 'C', 'D'], 'at most 4 options');
});

test('normalizeConflicts keeps at most 4 per round; the 5th pair is dropped', () => {
  const roles = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ key: k, label: k, skipped: false, findings: [finding(`${k}-1-1`, 'major')], checklist: [] }));
  const pairs = [['a', 'b'], ['a', 'c'], ['a', 'd'], ['a', 'e'], ['a', 'f']].map(([x, y]) => conflict(`${x}-1-1`, `${y}-1-1`));
  const out = normalizeConflicts({ conflicts: pairs }, { roles });
  assert.deepEqual(out.map((c) => [c.id, c.findings[1]]), [['conflict-1', 'b-1-1'], ['conflict-2', 'c-1-1'], ['conflict-3', 'd-1-1'], ['conflict-4', 'e-1-1']]);
});

const CONFLICTS = [{ id: 'conflict-1', findings: ['ux-1-2', 'qa-1-1'], roles: ['ux', 'qa'], section: 'Rollout', question: 'Modal or inline?', options: ['Keep', 'Inline'] }];

test('normalizePicks: unknown and repeated ids are dropped; an option or free text is a choice', () => {
  const r = normalizePicks([{ id: 'conflict-1', choice: ' Inline ' }, { id: 'conflict-9', choice: 'x' }, { id: 'conflict-1', choice: 'Keep' }], CONFLICTS);
  assert.deepEqual(r, { ok: true, picks: [{ id: 'conflict-1', choice: 'Inline' }] });
  assert.deepEqual(normalizePicks([{ id: 'conflict-1', choice: 'Both, behind a flag' }], CONFLICTS).picks, [{ id: 'conflict-1', choice: 'Both, behind a flag' }]);
  assert.deepEqual(normalizePicks([{ id: 'conflict-1', choice: '  ' }], CONFLICTS), { ok: true, picks: [] });
  assert.deepEqual(normalizePicks(undefined, CONFLICTS), { ok: true, picks: [] });
});

test('normalizePicks rejects a 501-character choice and scans at most 16 entries', () => {
  assert.deepEqual(normalizePicks([{ id: 'conflict-1', choice: 'x'.repeat(501) }], CONFLICTS), { ok: false, error: 'a decision is over 500 characters' });
  assert.equal(normalizePicks([{ id: 'conflict-1', choice: 'x'.repeat(500) }], CONFLICTS).ok, true);
  const junk = Array.from({ length: 1000 }, () => ({ id: 'nope', choice: 'x' }));
  assert.deepEqual(normalizePicks([...junk, { id: 'conflict-1', choice: 'Keep' }], CONFLICTS).picks, []);
});

test('withClarifications adds a line once, replaces the placeholder and makes the section when missing', () => {
  const lines = conflictClarifications(CONFLICTS, [{ id: 'conflict-1', choice: 'Inline' }, { id: 'conflict-7', choice: 'x' }]);
  assert.deepEqual(lines, ['- **conflict-1** — Modal or inline? → **Inline (decided at plan approval)**']);
  const md = '# Plan\n\n## Testing\n\nx\n\n## Clarifications (Q&A)\n\n- No clarifications were required; the task was unambiguous.\n';
  const once = withClarifications(md, lines);
  assert.equal(once, `# Plan\n\n## Testing\n\nx\n\n## Clarifications (Q&A)\n\n${lines[0]}\n`);
  assert.equal(withClarifications(once, lines), once, 'a re-asked approval never adds the line twice');
  const kept = '## Clarifications (Q&A)\n\n- **a** — q → **b**\n\n## After\n';
  assert.equal(withClarifications(kept, lines), `## Clarifications (Q&A)\n\n- **a** — q → **b**\n${lines[0]}\n\n## After\n`);
  assert.equal(withClarifications('# Plan\n', lines), `# Plan\n\n## Clarifications (Q&A)\n\n${lines[0]}\n`);
  assert.equal(withClarifications('# Plan\n', []), '# Plan\n');
});

test('dispositionsBlock names the path and the contract; dispositionsPathFor sits beside the findings file', () => {
  assert.equal(dispositionsPathFor('/abs/pipe/x-role-findings-r1.md'), '/abs/pipe/x-role-findings-r1-dispositions.json');
  const path = '/abs/pipe/x-role-findings-r1-dispositions.json';
  const b = dispositionsBlock(path);
  assert.match(b, /^## Dispositions\n/);
  assert.match(b, /"fixed"/);
  assert.match(b, /"disputed"/);
  assert.match(b, /conflict, left to the person/);
  assert.match(b, /counts as open/);
  assert.ok(b.trimEnd().endsWith(`Dispositions file: ${path}`), 'the path line ends the block');
  assert.equal(DISPOSITIONS_MAX_BYTES, 262144);
});

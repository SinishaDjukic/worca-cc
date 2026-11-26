// test/shape-prototype.test.mjs — Shaper small runs C1 (src/shared/shape/prototype.mjs): the Prototype step's pure rules,
// the persisted record's validation, the remark rules, the requirement rewrite and the prompt blocks. Pure, no database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isScreenRequirement, screenRequirements, prototypeOffer, SKIP_LINES, skipLine, normalizePrototype, screensOfPlan,
  remarkTarget, validRemarkProposal, rewriteRequirement, prototypeBlock, prototypeReviewBlock, prototypeRemarkBlock,
  normalizeReview, prototypeReviewRounds,
} from '../src/shared/shape/prototype.mjs';
import { prototypeCare, careCell } from '../src/shared/shape/feature-record.mjs';
import { criteriaCheck } from '../src/shared/review/coverage.mjs';

const REQS = [
  '# Requirements', '',
  '- [ ] R-po-1 People can save a template', '  Example: Ann saves "Weekly" and sees it in the list',
  '- [ ] R-ux-1 The template editor shows a preview', '  Example: typing a subject updates the preview',
  '- [ ] R-ux-2 The preview shows light mode', '  Example: the preview is white on a light page', '',
].join('\n');

test('isScreenRequirement: the ux prefix or the Care screen words', () => {
  assert.equal(isScreenRequirement({ id: 'R-ux-1', text: 'anything' }), true);
  assert.equal(isScreenRequirement({ id: 'R-po-3', text: 'the preferences page lists every channel' }), true);
  assert.equal(isScreenRequirement({ id: 'R-arch-1', text: 'the API returns 404' }), false);
  assert.equal(isScreenRequirement(null), false);
  assert.deepEqual(screenRequirements([{ id: 'R-ux-1', text: 'x' }, { id: 'R-arch-1', text: 'the API returns 404' }, null]),
    [{ id: 'R-ux-1', text: 'x' }]);
});

test('prototypeCare: Lean skips, only Thorough reviews, read from the Care table', () => {
  assert.deepEqual(prototypeCare('lean'), { primary: 'skip', review: false });
  assert.deepEqual(prototypeCare('balanced'), { primary: 'build', review: false });
  assert.deepEqual(prototypeCare('thorough'), { primary: 'build', review: true });
  assert.match(careCell('prototype', 'lean'), /only when asked/);
  assert.match(careCell('prototype', 'thorough'), /reviewed by Design and Product/);
  assert.equal(prototypeReviewRounds(), Number(careCell('fixCycles', 'thorough')));
  assert.equal(prototypeReviewRounds(), 3);
});

test('prototypeOffer: picks per position, then the skip causes in order', () => {
  assert.deepEqual(prototypeOffer({ position: 'balanced', screens: 2, designOn: true }), { offer: { primary: 'build', menu: 'skip', review: false } });
  assert.deepEqual(prototypeOffer({ position: 'thorough', screens: 2, designOn: true }), { offer: { primary: 'build', menu: 'skip', review: true } });
  assert.deepEqual(prototypeOffer({ position: 'lean', screens: 1, designOn: true }), { offer: { primary: 'skip', menu: 'build', review: false } });
  assert.deepEqual(prototypeOffer({ position: 'balanced', screens: 0, designOn: true }), { skip: 'no-screens' });
  assert.deepEqual(prototypeOffer({ position: 'balanced', screens: 0, designOn: false }), { skip: 'no-screens' });
  assert.deepEqual(prototypeOffer({ position: 'thorough', screens: 3, designOn: false }), { skip: 'design-off' });
  assert.deepEqual(prototypeOffer({ position: 'balanced', screens: [{ id: 'R-ux-1' }], designOn: true }).offer.primary, 'build');
});

test('skipLine: the 4 exact lines', () => {
  assert.equal(skipLine('no-screens'), 'Prototype skipped · no screen requirements');
  assert.equal(skipLine('lean'), 'Prototype skipped · Lean builds it only when asked');
  assert.equal(skipLine('design-off'), 'Prototype skipped · Design is turned off');
  assert.equal(skipLine('person'), 'Prototype skipped by you');
  assert.equal(Object.keys(SKIP_LINES).length, 4);
  assert.equal(skipLine('nope'), '');
});

test('rewriteRequirement: changes exactly the item line and its example; null for an absent id or empty example', () => {
  const out = rewriteRequirement(REQS, 'R-ux-2', { text: 'The preview follows dark mode', example: 'the preview is dark on a dark page' });
  const a = REQS.split('\n'); const b = out.split('\n');
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? null : i)).filter((i) => i !== null);
  assert.deepEqual(changed, [6, 7]);
  assert.equal(b[6], '- [ ] R-ux-2 The preview follows dark mode');
  assert.equal(b[7], '  Example: the preview is dark on a dark page');
  assert.equal(criteriaCheck(out, { requireExamples: true }).ok, true);
  assert.equal(rewriteRequirement(REQS, 'R-ux-9', { text: 'x', example: 'y' }), null);
  assert.equal(rewriteRequirement(REQS, 'R-ux-2', { text: 'x', example: '  ' }), null);
  assert.equal(rewriteRequirement(REQS, 'R-ux-2', { text: '', example: 'y' }), null);
  // A bold item, and newlines folded onto one line.
  const bold = '- **R-ux-1** Old\n  Example: old\n';
  assert.equal(rewriteRequirement(bold, 'R-ux-1', { text: 'New\ntext', example: 'new' }), '- **R-ux-1** New text\n  Example: new\n');
});

test('rewriteRequirement: a result that fails criteriaCheck writes nothing', () => {
  // The file already lists R-ux-1 twice: the rewritten text still fails the check.
  const twice = `${REQS}- [ ] R-ux-1 again\n  Example: again\n`;
  assert.equal(rewriteRequirement(twice, 'R-ux-2', { text: 'x', example: 'y' }), null);
});

test('validRemarkProposal and remarkTarget', () => {
  const ids = ['R-ux-1', 'R-ux-2'];
  assert.deepEqual(validRemarkProposal({ id: 'R-ux-2', text: ' Dark ', example: 'dark page' }, ids), { id: 'R-ux-2', text: 'Dark', example: 'dark page' });
  assert.equal(validRemarkProposal({ id: 'R-ux-9', text: 'a', example: 'b' }, ids), null);
  assert.equal(validRemarkProposal({ id: 'R-ux-2', text: '', example: 'b' }, ids), null);
  assert.equal(validRemarkProposal({ id: 'R-ux-2', text: 'x'.repeat(301), example: 'b' }, ids), null);
  assert.equal(validRemarkProposal({ id: 'R-ux-2', text: 'a', example: 'x'.repeat(301) }, ids), null);
  assert.equal(validRemarkProposal({ id: null }, ids), null);
  assert.equal(validRemarkProposal('junk', ids), null);
  assert.equal(remarkTarget('make it darker', ids), null);
  assert.equal(remarkTarget('R-ux-1 and R-ux-2 differ', ids), null);
  assert.equal(remarkTarget('R-ux-2 should show dark mode', ids), 'R-ux-2');
  assert.equal(remarkTarget('R-ux-20 is new', ids), null);
});

test('screensOfPlan: the screen name and its ids from the job, else from the brief', () => {
  assert.deepEqual(screensOfPlan([
    { id: 'editor', job: 'Template editor [R-ux-1]' },
    { id: 'prefs', job: 'Email preferences', brief: '[R-ux-2, R-po-1] The preferences page.' },
    { id: 'hero', job: 'Hero', brief: 'No ids here' },
    null,
  ]), [
    { section: 'editor', name: 'Template editor', ids: ['R-ux-1'] },
    { section: 'prefs', name: 'Email preferences', ids: ['R-ux-2', 'R-po-1'] },
    { section: 'hero', name: 'Hero', ids: [] },
  ]);
  assert.deepEqual(screensOfPlan('junk'), []);
});

const REC = {
  v: 1, state: 'built', screenIds: ['R-ux-1'], designId: 'd_1', buildId: 'b_1', round: 1, version: 2,
  screens: [{ section: 'editor', name: 'Template editor', ids: ['R-ux-1'] }], costUsd: 2.8,
  findings: [{ role: 'design', text: 'Spacing is tight', objection: false }], reviewRounds: 0,
  remarks: 0, rebuilt: false, at: '2026-11-21T10:00:00.000Z',
};

test('normalizePrototype: a valid record round-trips; junk is null', () => {
  assert.deepEqual(normalizePrototype(REC), REC);
  const full = { ...REC, state: 'confirmed', remark: { text: 'R-ux-1 darker', id: 'R-ux-1', proposed: { text: 'a', example: 'b', was: 'c' } },
    ref: { dir: '/x/prototype-confirmed', version: 2, designId: 'd_1', digest: 'a'.repeat(64) } };
  assert.deepEqual(normalizePrototype(full), full);
  assert.deepEqual(normalizePrototype({ ...REC, state: 'skipped', cause: 'lean' }).cause, 'lean');
  for (const bad of [null, 'x', [], { ...REC, v: 2 }, { ...REC, state: 'nope' }, { ...REC, screenIds: ['x'] },
    { ...REC, costUsd: -1 }, { ...REC, round: 1.5 }, { ...REC, at: 'never' }, { ...REC, state: 'skipped', cause: 'why' },
    { ...REC, findings: [{ role: 'qa', text: 'x', objection: true }] }, { ...REC, remark: { text: '' } },
    { ...REC, ref: { dir: 1, version: 1, designId: 'd' } }, { ...REC, ref: { dir: '/x', version: 1, designId: 'd', digest: 'nope' } }]) {
    assert.equal(normalizePrototype(bad), null, JSON.stringify(bad));
  }
  // Unknown keys are dropped, never kept.
  assert.equal('extra' in normalizePrototype({ ...REC, extra: 1 }), false);
});

test('normalizeReview: findings by Design and Product only, capped', () => {
  assert.deepEqual(normalizeReview({ findings: [
    { role: 'design', text: ' Too tight ', objection: true, sections: ['editor', 3] },
    { role: 'qa', text: 'x', objection: true },
    { role: 'product', text: '' },
    { role: 'product', text: 'Fine', objection: 'yes' },
  ] }), [
    { role: 'design', text: 'Too tight', objection: true, sections: ['editor'] },
    { role: 'product', text: 'Fine', objection: false, sections: [] },
  ]);
  assert.deepEqual(normalizeReview(null), []);
});

test('prompt blocks: the hand-off names the path, the ids and the rule; the agent blocks name their output', () => {
  const b = prototypeBlock({ dir: '/p/prototype', ids: ['R-ux-1', 'R-ux-2'] });
  assert.match(b, /\/p\/prototype/);
  assert.match(b, /R-ux-1, R-ux-2/);
  assert.match(b, /the requirement and its example win/);
  assert.ok(b.endsWith('\n\n'));
  const r = prototypeReviewBlock({ dir: '/d/dist', requirements: '/r.md', screens: REC.screens, out: '/o.json', round: 2 });
  assert.match(r, /\/d\/dist/); assert.match(r, /\/o\.json/); assert.match(r, /round 2/); assert.match(r, /Template editor/);
  const m = prototypeRemarkBlock({ remark: 'make it dark', requirements: '/r.md', ids: ['R-ux-1'], target: 'R-ux-1', out: '/m.json' });
  assert.match(m, /make it dark/); assert.match(m, /\/m\.json/); assert.match(m, /R-ux-1/);
});

test('R-arch-11: the module imports nothing from src/core or ui', () => {
  const src = readFileSync(new URL('../src/shared/shape/prototype.mjs', import.meta.url), 'utf8');
  for (const m of src.matchAll(/from '([^']+)'/g)) assert.ok(!/\/core\/|\/ui\//.test(m[1]), m[1]);
});

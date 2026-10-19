// test/requirements-edits.test.mjs — the product owner's edits are ground truth (design D6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature } from '../src/core/requirements/store.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, setArchived,
} from '../src/core/requirements/edits.mjs';
import { emptySpec } from '../src/core/requirements/spec.mjs';

useTempHome(after);
const make = () => {
  const f = createFeature({ scopeType: 'project', scopeKey: 'k', title: 't', description: 'd' });
  return updateFeature(f.seq, { status: 'your_turn', criteriaSeq: 3, assumptionSeq: 1, spec: { ...emptySpec(),
    criteria: [{ id: 'R-po-3', text: 'c3' }], assumptions: [{ id: 'A-1', text: 'a1', status: 'open' }] } });
};

test('sections: an edit marks the section; release clears the mark', () => {
  const f = make();
  const g = setSection(f.seq, 'actors', 'Customer\nSupport', { by: 'po' });
  assert.deepEqual(g.spec.actors, ['Customer', 'Support']);
  assert.equal(g.spec.edited.actors, true);
  assert.equal(releaseSection(f.seq, 'actors').spec.edited.actors, undefined);
  assert.deepEqual(listTurns(f.seq).map((t) => [t.kind, t.payload.section, !!t.payload.released]),
    [['edit', 'actors', false], ['edit', 'actors', true]]);
  assert.throws(() => setSection(f.seq, 'criteria', []), (e) => e.code === 'BAD_REQUEST');
});

test('criteria: added with the next id, edited and removed only by the product owner', () => {
  const f = make();
  let g = addCriterion(f.seq, 'c4');
  assert.deepEqual(g.spec.criteria.at(-1), { id: 'R-po-4', text: 'c4', edited: true });
  g = removeCriterion(f.seq, 'R-po-4');
  g = addCriterion(f.seq, 'c5');
  assert.equal(g.spec.criteria.at(-1).id, 'R-po-5', 'a removed id is never reused');
  g = editCriterion(f.seq, 'R-po-3', 'c3 better');
  assert.deepEqual(g.spec.criteria[0], { id: 'R-po-3', text: 'c3 better', edited: true });
  assert.throws(() => editCriterion(f.seq, 'R-po-99', 'x'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => addCriterion(f.seq, '  '), (e) => e.code === 'BAD_REQUEST');
});

test('assumptions: confirm, reject, reopen', () => {
  const f = make();
  assert.equal(setAssumption(f.seq, 'A-1', 'confirmed').spec.assumptions[0].status, 'confirmed');
  assert.equal(setAssumption(f.seq, 'A-1', 'open').spec.assumptions[0].status, 'open');
  assert.throws(() => setAssumption(f.seq, 'A-1', 'maybe'), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => setAssumption(f.seq, 'A-9', 'confirmed'), (e) => e.code === 'NOT_FOUND');
  assert.equal(listTurns(f.seq).filter((t) => t.kind === 'assumption').length, 2);
});

test('header and archive; archived features refuse edits', () => {
  const f = make();
  assert.equal(updateHeader(f.seq, { title: 'New title' }).title, 'New title');
  assert.throws(() => updateHeader(f.seq, { title: '' }), (e) => e.code === 'BAD_REQUEST');
  assert.equal(setArchived(f.seq, true).status, 'archived');
  assert.throws(() => addCriterion(f.seq, 'x'), (e) => e.code === 'CONFLICT');
  assert.equal(setArchived(f.seq, false).status, 'your_turn');
  assert.equal(getFeature(f.seq).title, 'New title');
});

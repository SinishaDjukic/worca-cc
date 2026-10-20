// test/requirements-edits.test.mjs — the product owner's edits are ground truth (design D6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { createFeature, getFeature, listTurns, updateFeature, appendTurn, setContext, createStart } from '../src/core/requirements/store.mjs';
import {
  updateHeader, setSection, releaseSection, addCriterion, editCriterion, removeCriterion, setAssumption, setArchived, confirmOpenAssumptions, revertToStart,
} from '../src/core/requirements/edits.mjs';
import { emptySpec, nextIdNumber } from '../src/core/requirements/spec.mjs';
import { buildRoundPrompt } from '../src/core/requirements/round.mjs';
import { renderSpecMarkdown } from '../src/core/requirements/markdown.mjs';
import { startOrientation, settled, isBusy } from '../src/core/requirements/interview.mjs';

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

test('header edits are turns and reach the next round prompt', () => {
  const f = make();
  updateHeader(f.seq, { title: 'T2', scopeType: 'project', scopeKey: 'other' });
  updateHeader(f.seq, { description: 'D2' });
  updateHeader(f.seq, { title: 'T2' });   // no change: no turn
  const turns = listTurns(f.seq).filter((t) => t.kind === 'edit');
  assert.deepEqual(turns.map((t) => t.payload.header), [['title', 'scope'], ['description']]);
  const text = buildRoundPrompt({ feature: getFeature(f.seq), turns: listTurns(f.seq) });
  assert.match(text, /The product owner changed the title and the project or workspace\./);
  assert.match(text, /The product owner changed the description\./);
});

test('a refused edit appends no turn; every accepted edit appends exactly one', () => {
  const f = make();
  assert.throws(() => addCriterion(f.seq, ' '), (e) => e.code === 'BAD_REQUEST');
  assert.throws(() => editCriterion(f.seq, 'R-po-99', 'x'), (e) => e.code === 'NOT_FOUND');
  assert.throws(() => setAssumption(f.seq, 'A-1', 'maybe'), (e) => e.code === 'BAD_REQUEST');
  assert.equal(listTurns(f.seq).length, 0);
  addCriterion(f.seq, 'x'); setSection(f.seq, 'rules', 'r'); setAssumption(f.seq, 'A-1', 'confirmed');
  assert.equal(listTurns(f.seq).length, 3);
});

test('addCriterion follows the highest id present even when the counter lags', () => {
  const f = make();
  updateFeature(f.seq, { criteriaSeq: 0 });
  assert.equal(addCriterion(f.seq, 'n').spec.criteria.at(-1).id, 'R-po-4');
});

test('nextIdNumber: above both the counter and the highest id', () => {
  assert.equal(nextIdNumber(0, [], 'A-'), 1);
  assert.equal(nextIdNumber(5, [{ id: 'A-2' }], 'A-'), 6);
  assert.equal(nextIdNumber(1, [{ id: 'A-7' }, { id: 'R-po-9' }, { id: 'A-x' }, null], 'A-'), 8);
});

test('BUSY: edits and archiving are refused while a job runs', async () => {
  const f = make();
  setContext('project', 'k', { lookAtCode: false });
  let release;
  const gate = new Promise((res) => { release = res; });
  const d = { runClaudeImpl: async () => { await gate; return { text: '{"spec":{},"questions":[],"done":true}' }; },
    listModels: async () => [], listProjects: async () => [], workspaceTarget: async () => null,
    openLook: async () => null, openWorkspaceLook: async () => null, onChange: () => {} };
  const p = startOrientation(f.seq, {}, d);
  assert.equal(isBusy(f.seq), true);
  for (const fn of [() => setSection(f.seq, 'rules', 'x'), () => addCriterion(f.seq, 'x'), () => setArchived(f.seq, true)]) {
    assert.throws(fn, (e) => e.code === 'BUSY');
  }
  release();
  await p;
  await settled(f.seq);
});

test('restore returns a finished interview to done', () => {
  const f = make();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  updateFeature(f.seq, { status: 'done' });
  assert.equal(setArchived(f.seq, true).status, 'archived');
  assert.equal(setArchived(f.seq, false).status, 'done');
});

test('assumptions: rejected is settable; releasing a never-edited section is harmless', () => {
  const f = make();
  assert.equal(setAssumption(f.seq, 'A-1', 'rejected').spec.assumptions[0].status, 'rejected');
  const g = releaseSection(f.seq, 'rules');
  assert.equal(g.spec.edited.rules, undefined);
  assert.deepEqual(Object.keys(g.spec.edited), []);
  assert.deepEqual(listTurns(f.seq).at(-1).payload, { section: 'rules', released: true });
});

test('a removed criterion keeps its text on the edit turn, and the next round prompt names it', () => {
  const f = make();
  removeCriterion(f.seq, 'R-po-3');
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual(t.payload, { criterion: 'R-po-3', action: 'removed', text: 'c3' });
  const text = buildRoundPrompt({ feature: getFeature(f.seq), turns: listTurns(f.seq) });
  assert.match(text, /The product owner removed criterion R-po-3: c3/);
});

test('an updated title collapses newlines, so the Markdown heading cannot break', () => {
  const f = make();
  const g = updateHeader(f.seq, { title: 'Refund\n\n# not a heading' });
  assert.equal(g.title, 'Refund # not a heading');
  assert.equal(renderSpecMarkdown(g).split('\n')[0], `# ${g.id}: Refund # not a heading`);
});


test('confirmOpenAssumptions confirms only open ones in one turn; CONFLICT when none', () => {
  const f = make();
  updateFeature(f.seq, { spec: { ...getFeature(f.seq).spec, assumptions: [
    { id: 'A-1', text: 'a', status: 'open' }, { id: 'A-2', text: 'b', status: 'rejected' }, { id: 'A-3', text: 'c', status: 'open' }] } });
  const g = confirmOpenAssumptions(f.seq, { by: 'po' });
  assert.deepEqual(g.spec.assumptions.map((a) => a.status), ['confirmed', 'rejected', 'confirmed']);
  const t = listTurns(f.seq).filter((x) => x.kind === 'assumption');
  assert.equal(t.length, 1);
  assert.deepEqual(t[0].payload, { ids: ['A-1', 'A-3'], status: 'confirmed' });
  assert.throws(() => confirmOpenAssumptions(f.seq), (e) => e.code === 'CONFLICT');
  setArchived(f.seq, true);
  assert.throws(() => confirmOpenAssumptions(f.seq), (e) => e.code === 'CONFLICT');
});

test('scope lock: once started, the project or workspace cannot change; other header edits still can', () => {
  const f = make();
  assert.equal(updateHeader(f.seq, { scopeType: 'project', scopeKey: 'k2' }).scopeKey, 'k2', 'before a start: allowed');
  createStart({ featureSeq: f.seq, version: 1, runId: `lock-${f.seq}`, spec: getFeature(f.seq).spec, title: 't', ready: true });
  const n = listTurns(f.seq).length;
  for (const scope of [{ scopeType: 'project', scopeKey: 'k3' }, { scopeType: 'workspace', scopeKey: 'k2' }]) {
    assert.throws(() => updateHeader(f.seq, { ...scope, title: 'X' }),
      (e) => e.code === 'CONFLICT' && e.message === 'this feature has been started; its project or workspace can no longer change');
  }
  assert.equal(listTurns(f.seq).length, n, 'a refused change appends nothing');
  assert.equal(getFeature(f.seq).title, 't');
  assert.equal(updateHeader(f.seq, { scopeType: 'project', scopeKey: 'k2', title: 'Same scope' }).title, 'Same scope');
});

test('revertToStart: the frozen spec comes back, counters stay, one edit turn; unknown version, busy-free checks', () => {
  const f = make();
  const frozen = getFeature(f.seq).spec;
  createStart({ featureSeq: f.seq, version: 1, runId: `rev-${f.seq}`, spec: frozen, title: 't', ready: true });
  addCriterion(f.seq, 'c4');
  setAssumption(f.seq, 'A-1', 'confirmed');
  setSection(f.seq, 'rules', 'r1');
  const g = revertToStart(f.seq, 1, { by: 'po' });
  assert.deepEqual(g.spec, frozen);
  assert.equal(g.criteriaSeq, 4);
  const t = listTurns(f.seq).at(-1);
  assert.deepEqual([t.kind, t.payload, t.by], ['edit', { reverted: 1 }, 'po']);
  assert.equal(addCriterion(f.seq, 'c5').spec.criteria.at(-1).id, 'R-po-5');
  const n = listTurns(f.seq).length;
  assert.throws(() => revertToStart(f.seq, 2), (e) => e.code === 'NOT_FOUND');
  assert.equal(listTurns(f.seq).length, n);
  setArchived(f.seq, true);
  assert.throws(() => revertToStart(f.seq, 1), (e) => e.code === 'CONFLICT');
});

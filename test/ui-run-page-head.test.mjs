import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { runPositionLabel, groupKindWord, pageModel, runTitleText, buildFacts, syncFacts, setFactText, RUN_FACTS, GROUP_FACTS }
  from '../ui/public/run-page-head.mjs';
import { sliceTitle } from '../src/core/shape/features.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const home = (over = {}) => ({ row: { groupKind: 'feature', groupId: 'feat_1', title: 'Run tags' }, planning: false, position: 2, total: 3, ...over });

test('kind chip: "Run 2 of 3" in a group, "Planning" for planning, "Run" alone', () => {
  assert.equal(runPositionLabel(home()), 'Run 2 of 3');
  assert.equal(runPositionLabel(home({ planning: true, position: null })), 'Planning');
  assert.equal(runPositionLabel(null), 'Run');
  assert.equal(runPositionLabel(home({ position: null })), 'Run');
});

test('group chip: the kind word', () => {
  assert.equal(groupKindWord({ groupKind: 'feature' }), 'Feature');
  assert.equal(groupKindWord({ groupKind: 'chain' }), 'Chain');
  assert.equal(groupKindWord({ groupKind: 'user' }), 'Group');
});

test('pageModel strips the one PR reference from the line, and only that', () => {
  const m = { word: 'Needs you', line: 'Checks failing · PR #821', pr: { number: 821 } };
  assert.equal(pageModel(m).line, 'Checks failing');
  assert.equal(pageModel({ word: 'In review', line: 'In review · PR #759', pr: { number: 759 } }).line, 'In review');
  const plain = { word: 'Working', line: 'Build', pr: null };
  assert.equal(pageModel(plain), plain);                     // untouched object when there is nothing to strip
});

test('facts block: one row per fact, hidden while empty', () => {
  const d = doc();
  const kv = buildFacts(d, GROUP_FACTS);
  assert.deepEqual([...kv.querySelectorAll('.rd-kv-k')].map((k) => k.textContent), ['Project', 'Runs', 'Total cost', 'Labels']);
  setFactText(kv, 'project', 'Acme web');
  setFactText(kv, 'cost', '');
  syncFacts(kv);
  assert.equal(kv.querySelector('[data-fact="project"]').hidden, false);
  assert.equal(kv.querySelector('[data-fact="cost"]').hidden, true);
  assert.equal(kv.querySelector('[data-fact="labels"]').hidden, true);
  assert.deepEqual(RUN_FACTS.map(([k]) => k), ['group', 'project', 'branch', 'labels', 'tags']);
});

test('runTitleText drops "Run N · " only when the chip says the same N', () => {
  const h = { row: { title: 'Run tags' }, position: 2, planning: false };
  assert.equal(runTitleText('Run 2 · Pin charts', h), 'Pin charts');
  assert.equal(runTitleText('Run 3 · Pin charts', h), 'Run 3 · Pin charts');   // chip says 2: keep
  assert.equal(runTitleText('Run 2 · Pin charts', null), 'Run 2 · Pin charts');
  assert.equal(runTitleText('Run 2 · Pin charts', { ...h, planning: true, position: null }), 'Run 2 · Pin charts');
  assert.equal(runTitleText('Fix the tooltip', h), 'Fix the tooltip');
});

test('runTitleText strips the prefix sliceTitle really writes (a reworded sliceTitle fails here)', () => {
  const h = { row: { title: 'Run tags' }, position: 2, planning: false };
  assert.equal(runTitleText(sliceTitle('Run tags', 2, 3, { title: 'Pin charts' }), h), 'Pin charts');
});

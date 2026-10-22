import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { runPositionLabel, groupKindWord, pageModel, runCrumbs, paintCrumbs, buildFacts, syncFacts, setFactText, RUN_FACTS, GROUP_FACTS }
  from '../ui/public/run-page-head.mjs';

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

test('crumbs: Runs › group › Run 2 for a member, Runs › group for a group page, none alone', () => {
  assert.deepEqual(runCrumbs(home()), [{ label: 'Runs', href: '#runs' }, { label: 'Run tags', href: '#feature/feat_1' }, { label: 'Run 2' }]);
  assert.deepEqual(runCrumbs(home({ row: { groupKind: 'chain', groupId: 'p:p0', title: 'Docs chain' } })).at(1), { label: 'Docs chain', href: '#group/p%3Ap0' });
  assert.deepEqual(runCrumbs(null), []);
  const d = doc();
  const nav = d.createElement('nav');
  paintCrumbs(nav, runCrumbs(home()));
  assert.equal(nav.hidden, false);
  assert.deepEqual([...nav.querySelectorAll('.rd-crumb')].map((c) => [c.tagName, c.textContent]), [['A', 'Runs'], ['A', 'Run tags'], ['SPAN', 'Run 2']]);
  assert.equal(nav.querySelector('.rd-crumb:last-child').getAttribute('aria-current'), 'page');
  assert.equal(nav.querySelectorAll('.rd-crumb-sep svg').length, 2);   // the chevron icon, never a typed "›"
  paintCrumbs(nav, []);
  assert.equal(nav.hidden, true);
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

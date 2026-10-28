import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { groupKindWord, pageModel, runCrumbs, paintCrumbs, buildFacts, syncFacts, setFactText, RUN_FACTS, GROUP_FACTS }
  from '../ui/public/run-page-head.mjs';

const doc = () => new JSDOM('<!doctype html><body></body>').window.document;
const home = (over = {}) => ({ row: { groupKind: 'feature', groupId: 'feat_1', title: 'Run tags' }, planning: false, position: 2, total: 3, ...over });

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
  assert.deepEqual(RUN_FACTS.map(([k]) => k), ['project', 'branch', 'labels', 'tags', 'group']);
});

const INDEX = readFileSync(new URL('../ui/public/index.html', import.meta.url), 'utf8');
const CSS = readFileSync(new URL('../ui/public/style.css', import.meta.url), 'utf8');
const tpl = (id) => new JSDOM(INDEX).window.document.getElementById(id).content;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ruleBody = (sel) => {
  const m = CSS.match(new RegExp('^' + reEsc(sel) + '\\{([^}]*)\\}', 'm'));
  return m ? m[1].replace(/\s+/g, ' ') : null;
};

test('run head: no kind chip in either template; the h1 stays the focus target', () => {
  for (const id of ['run-detail-tpl', 'hist-detail-tpl']) {
    const head = tpl(id).querySelector('.rd-glance .rd-page-head');
    assert.equal(head.querySelectorAll('.kind-chip').length, 0, `${id}: no kind chip`);
    const h1 = head.querySelector('.rd-title-row > h1.rd-page-title');
    assert.ok(h1, `${id}: the title row keeps its h1`);
    assert.equal(h1.getAttribute('tabindex'), '-1');
    assert.equal(h1.parentElement.children.length, 1, `${id}: the title is alone in its row`);
  }
});

test('facts block: Group is the last row in both templates', () => {
  for (const id of ['run-detail-tpl', 'hist-detail-tpl']) {
    const kv = tpl(id).querySelector('dl.rd-kv[aria-label="Run facts"]');
    assert.deepEqual([...kv.children].map((r) => r.dataset.fact), ['project', 'labels', 'tags', 'group'], id);
    assert.ok(kv.lastElementChild.querySelector('.rd-group-line'), `${id}: the group line is in the last row`);
  }
});

test('facts block: one divider between shown rows in every hidden/shown combination', () => {
  const sel = CSS.match(/^(\.rd-kv-row:not\(\[hidden\]\) ~ \.rd-kv-row)\{border-top:/m)[1];   // the real rule
  const kv = tpl('run-detail-tpl').querySelector('dl.rd-kv');
  const rows = [...kv.children];
  for (let mask = 0; mask < 1 << rows.length; mask++) {
    rows.forEach((r, i) => { r.hidden = !(mask & (1 << i)); });
    const shown = rows.filter((r) => !r.hidden);
    assert.deepEqual(shown.map((r) => r.matches(sel)), shown.map((_, i) => i > 0), `mask ${mask}`);
  }
});

test('the run title is one line cut with "…": no clamp, same type', () => {
  const b = ruleBody('.rd-page-title');
  for (const d of ['white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis', 'min-width:0', 'font:700 var(--fs-page)/var(--lh-title) var(--sans)']) {
    assert.ok(b.includes(d), `.rd-page-title has ${d}`);
  }
  assert.doesNotMatch(b, /line-clamp|-webkit-box|overflow-wrap/);
  // The group page's title shares the class; its flex base keeps its kind chip beside it.
  assert.equal(ruleBody('.gpage .gpage-title'), 'flex:1 1 160px;min-width:min(100%,160px);');
});

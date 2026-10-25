// test/nav-routes.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES, parseRoute, formatRoute, parentOf, sectionOf, pageKey, tabKey, engineTab, groupRoute,
} from '../ui/public/nav/routes.mjs';
import { panelTabFor } from '../ui/public/chat/run-panel.mjs';
import { groupHrefOf } from '../ui/public/run-page-head.mjs';
import { GROUP_TABS } from '../ui/public/group-page.mjs';
import { PAGE_TITLES } from '../ui/public/topnav.mjs';
import { RUN_TAB_WORDS } from '../src/shared/chip-refs.mjs';

const pick = (r) => { const { known, canonical, ...rest } = r; return rest; };

// [address, expected route, canonical?]
const TABLE = [
  ['#runs', { view: 'runs', param: '' }, true],
  ['#running/r1', { view: 'running', id: 'r1', tab: 'summary' }, true],
  ['#running/r1/diff', { view: 'running', id: 'r1', tab: 'diff' }, true],
  ['#running/r1/qa', { view: 'running', id: 'r1', tab: 'qa' }, true],
  ['#running/r1/details', { view: 'running', id: 'r1', tab: 'summary' }, false],
  ['#running/r1/details/qa', { view: 'running', id: 'r1', tab: 'qa' }, false],
  ['#running/r1/details/overview', { view: 'running', id: 'r1', tab: 'summary' }, false],
  ['#running/r1/clarify', { view: 'running', id: 'r1', tab: 'qa' }, false],
  ['#running/r1/nope', { view: 'running', id: 'r1', tab: 'summary' }, false],
  ['#history/worka-cc/p1', { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'summary' }, true],
  ['#history/worka-cc/p1/logs', { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'logs' }, true],
  ['#history/worka-cc/p1/details', { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'summary' }, false],
  ['#history/worka-cc/p1/details/clarify', { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'qa' }, false],
  ['#history/worka-cc/p1/details/zzz', { view: 'history', projectKey: 'worka-cc', id: 'p1', tab: 'summary' }, false],
  ['#history/workspaces/wk/p1', { view: 'history', projectKey: 'workspaces/wk', id: 'p1', tab: 'summary' }, true],
  ['#history/workspaces/wk/p1/diff', { view: 'history', projectKey: 'workspaces/wk', id: 'p1', tab: 'diff' }, true],
  ['#history/workspaces/wk/p1/details', { view: 'history', projectKey: 'workspaces/wk', id: 'p1', tab: 'summary' }, false],
  ['#history/workspaces/wk/p1/details/diff', { view: 'history', projectKey: 'workspaces/wk', id: 'p1', tab: 'diff' }, false],
  ['#history/proj/diff', { view: 'history', projectKey: 'proj', id: 'diff', tab: 'summary' }, true],   // a 2-part address keeps its id
  ['#feature/feat_1', { view: 'feature', id: 'feat_1', tab: 'runs' }, true],
  ['#feature/feat_1/decisions', { view: 'feature', id: 'feat_1', tab: 'decisions' }, true],
  ['#feature/feat_1/runs', { view: 'feature', id: 'feat_1', tab: 'runs' }, false],
  ['#group/p%3Ap0', { view: 'group', id: 'p:p0', tab: 'runs' }, true],
  ['#group/p:p0/logs', { view: 'group', id: 'p:p0', tab: 'logs' }, false],
];

test('every current and old address parses to its route; canonical ones format back to themselves', () => {
  for (const [hash, want, canonical] of TABLE) {
    const r = parseRoute(hash);
    assert.deepEqual(pick(r), want, hash);
    assert.equal(r.known, true, `${hash} known`);
    assert.equal(r.canonical, canonical, `${hash} canonical`);
    if (canonical) assert.equal(formatRoute(r), hash, `${hash} format`);
    assert.deepEqual(pick(parseRoute(formatRoute(r))), want, `${hash} round trip`);
  }
});

test('scale guard: every ROUTES row has a canonical fixture above, and every section root has a top bar title', () => {
  for (const view of Object.keys(ROUTES)) {
    assert.ok(TABLE.some(([, r, c]) => r.view === view && c), `ROUTES.${view} has no canonical fixture in TABLE`);
    if (ROUTES[view].section) assert.ok(Object.hasOwn(PAGE_TITLES, view), `section ${view} has no PAGE_TITLES label`);
  }
});

test('an address with no id falls back to its section root, non-canonical', () => {
  for (const h of ['#running', '#running/', '#history/proj', '#feature', '#group/']) {
    const r = parseRoute(h);
    assert.equal(r.view, 'runs', h);
    assert.equal(r.canonical, false, h);
  }
});

test('views the table does not know pass through untouched', () => {
  const r = parseRoute('#settings/guardrails');
  assert.deepEqual(r, { view: 'settings', param: 'guardrails', known: false, canonical: true });
  assert.equal(formatRoute(r), '#settings/guardrails');
});

test('parentOf: a grouped run goes up to its group, a lone run and a group page to Runs, Runs to nothing', () => {
  const run = { view: 'history', projectKey: 'k', id: 'p1', tab: 'diff' };
  assert.deepEqual(parentOf(run, { parent: { view: 'feature', id: 'feat_1', title: 'Run tags' } }),
    { view: 'feature', id: 'feat_1', tab: 'runs', title: 'Run tags' });
  assert.equal(formatRoute(parentOf(run, { parent: { view: 'group', id: 'p:p0', title: 'Docs' } })), '#group/p%3Ap0');
  assert.deepEqual(parentOf(run, {}), { view: 'runs' });
  assert.deepEqual(parentOf({ view: 'feature', id: 'feat_1', tab: 'runs' }), { view: 'runs' });
  assert.equal(parentOf({ view: 'runs' }), null);
  assert.equal(parentOf({ view: 'settings' }), null);
});

test('parentOf: a parent with no title yet, or of an unknown view, is skipped', () => {
  const run = { view: 'running', id: 'r1', tab: 'summary' };
  assert.deepEqual(parentOf(run, { parent: { view: 'feature', id: 'feat_1', title: '' } }), { view: 'runs' });
  assert.deepEqual(parentOf(run, { parent: { view: 'nowhere', id: 'x', title: 'X' } }), { view: 'runs' });
});

test('sectionOf and pageKey', () => {
  assert.equal(sectionOf('history'), 'runs');
  assert.equal(sectionOf('group'), 'runs');
  assert.equal(sectionOf('runs'), 'runs');
  assert.equal(pageKey({ view: 'running', id: 'r1', tab: 'diff' }), pageKey({ view: 'running', id: 'r1', tab: 'qa' }));
  assert.notEqual(pageKey({ view: 'running', id: 'r1', tab: 'qa' }), pageKey({ view: 'running', id: 'r2', tab: 'qa' }));
});

test('groupRoute builds the same address the kind chip links (groupHrefOf)', () => {
  for (const row of [{ groupKind: 'feature', groupId: 'f-7c21', title: 'F' }, { groupKind: 'chain', groupId: 'p:p0', title: 'C' },
    { groupKind: 'user', groupId: 'g1', title: 'U' }]) {
    assert.equal(formatRoute({ ...groupRoute(row), tab: 'runs' }), groupHrefOf(row), row.groupKind);
  }
});

test('tab keys: qa and summary in the address; the engines keep overview and clarify, as panelTabFor says', () => {
  assert.equal(tabKey('running', 'clarify'), 'qa');
  assert.equal(tabKey('history', 'overview'), 'summary');
  assert.equal(tabKey('running', 'constructor'), 'summary');
  assert.equal(engineTab('history', 'qa'), 'clarify');
  assert.equal(engineTab('running', 'qa'), 'qa');
  assert.equal(engineTab('running', 'summary'), 'overview');
  assert.equal(engineTab('history', ''), 'overview');
  assert.equal(engineTab('history', 'logs'), 'logs');
  for (const t of ['qa', 'clarify', 'diff']) {
    assert.equal(engineTab('history', t), panelTabFor('saved', t), `saved ${t}`);
    assert.equal(engineTab('running', t), panelTabFor('live', t), `live ${t}`);
  }
  assert.deepEqual([...ROUTES.running.tabs.keys], ['summary', 'diff', 'changes', 'artifacts', 'actions', 'workflow', 'logs', 'agents', 'qa']);
  assert.deepEqual([...ROUTES.feature.tabs.keys], GROUP_TABS.map(([k]) => k));
  assert.equal(tabKey('feature', 'overview'), 'overview');        // aliases are per row: the group's Overview is real
});

test('formatRoute normalises any tab form to the address key (the hand-off: clarify -> /qa)', () => {
  assert.equal(formatRoute({ view: 'history', projectKey: 'k', id: 'p1', tab: 'clarify' }), '#history/k/p1/qa');
  assert.equal(formatRoute({ view: 'history', projectKey: 'k', id: 'p1', tab: 'qa' }), '#history/k/p1/qa');
  assert.equal(formatRoute({ view: 'running', id: 'r1', tab: 'overview' }), '#running/r1');
});

test('the chat chip parser knows exactly the run rows\' tab words (src/shared cannot import ui/public)', () => {
  const words = new Set([...ROUTES.running.tabs.keys, ...Object.keys(ROUTES.running.tabs.aliases),
    ...ROUTES.history.tabs.keys, ...Object.keys(ROUTES.history.tabs.aliases)]);
  assert.deepEqual([...RUN_TAB_WORDS].sort(), [...words].sort());
});

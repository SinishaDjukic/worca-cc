// test/ui-ask-page-chips.test.mjs — Ask worca beside the page (Task 3): the composer's page chips, the context minus the
// chips left out, and the project or workspace a page is about.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageChips, withoutChips, pageScopeOf } from '../ui/public/ask-page-chips.mjs';

const U = '0f0f0f0f-0000-4000-8000-000000000001';
const RUN = { view: 'running', runId: U, pipelineId: 'aaaa1111', projectDir: '/r/w', runPage: 'diff', diffPath: 'scripts/git-diff.mjs (member worca-cc-551183d0)', pinned: false };
const PROJECTS = [{ key: 'worca-cc-551183d0', path: '/r/w', name: 'worca-cc' }];

test('a run page: a Run chip and, on Diff, a File chip under it', () => {
  const chips = pageChips(RUN, { run: 'Projects P5', runStatus: 'done' });
  assert.deepEqual(chips.map((c) => [c.id, c.caption, c.name, c.leaveOut, c.icon]), [
    [`run:${U}`, 'Run', 'Projects P5', 'Leave this run out', 'run'],
    [`file:${U}:scripts/git-diff.mjs (member worca-cc-551183d0)`, 'File', 'scripts/git-diff.mjs', 'Leave this file out', 'diff'],
  ]);
  assert.equal(chips[1].parent, `run:${U}`);
  assert.equal(chips[0].status, 'done');
  assert.equal(pageChips({ view: 'running', runId: U })[0].name, '0f0f0f0f', 'no title known: the short id');
  assert.equal(pageChips({ view: 'history-detail', pipelineId: 'bbbb2222' })[0].name, 'bbbb2222');
});

test('list, project and workspace pages', () => {
  assert.deepEqual(pageChips({ view: 'projects' }).map((c) => [c.id, c.caption, c.name, c.leaveOut]), [['page:projects', 'Page', 'Projects', 'Leave this page out']]);
  assert.deepEqual(pageChips({ view: 'project-detail', projectKey: 'worca-cc-551183d0', pageProjectKey: 'worca-cc-551183d0' }, { project: 'worca-cc' }).map((c) => [c.caption, c.name, c.leaveOut]), [['Project', 'worca-cc', 'Leave this project out']]);
  assert.deepEqual(pageChips({ view: 'workspaces', pageWorkspaceId: 'wks-havn-649ebfe7' }).map((c) => [c.caption, c.name, c.leaveOut]), [['Workspace', 'wks-havn-649ebfe7', 'Leave this workspace out']]);
  assert.deepEqual(pageChips({ view: 'team-metrics', tmRange: 'this-month' })[0].keys, ['view', 'tmScope', 'tmRange', 'tmGroupBy', 'tmFilter', 'tpScope']);
});

test('Chat, Workflows and no view: no chips', () => {
  for (const c of [{ view: 'chat', runId: U }, { view: 'workflows' }, {}, null]) assert.deepEqual(pageChips(c), []);
});

test('chip ids: a live run keeps its id when its pipeline id lands; a file is the file of its run', () => {
  const early = pageChips({ view: 'running', runId: U, runPage: 'diff', diffPath: 'a.mjs' });
  const late = pageChips({ view: 'running', runId: U, pipelineId: 'aaaa1111', runPage: 'diff', diffPath: 'a.mjs' });
  assert.deepEqual(late.map((c) => c.id), early.map((c) => c.id), 'a run left out before its first frame stays out after it');
  assert.equal(pageChips({ view: 'history-detail', pipelineId: 'aaaa1111' })[0].id, 'run:aaaa1111', 'a saved run: its pipeline id');
  const other = pageChips({ view: 'history-detail', pipelineId: 'bbbb2222', runPage: 'diff', diffPath: 'a.mjs' });
  assert.notEqual(other[1].id, late[1].id, 'the same path on another run is another chip');
  assert.equal(other[1].parent, other[0].id);
});

test('withoutChips drops a left-out chip, its keys and its children, and nothing else', () => {
  const chips = pageChips(RUN);
  const noRun = withoutChips(RUN, chips, new Set([`run:${U}`]));
  for (const k of ['runId', 'pipelineId', 'runPage', 'diffPath', 'view']) assert.equal(k in noRun, false, k);
  assert.equal(noRun.projectDir, '/r/w');
  assert.equal(noRun.pinned, false);
  const noFile = withoutChips(RUN, chips, new Set([chips[1].id]));
  assert.equal('diffPath' in noFile, false);
  assert.equal(noFile.runId, U, 'the file alone goes');
  assert.deepEqual(withoutChips(RUN, chips, new Set()), RUN);
  assert.notEqual(withoutChips(RUN, chips, new Set()), RUN, 'a copy');
  const p = { view: 'project-detail', projectKey: 'worca-cc-551183d0', pageProjectKey: 'worca-cc-551183d0' };
  assert.deepEqual(withoutChips(p, pageChips(p), new Set(['project:worca-cc-551183d0'])), { projectKey: 'worca-cc-551183d0' }, 'the scope key stays for scopedContext');
  const nested = [{ id: 'p', keys: ['a'] }, { id: 'c', keys: ['b'], parent: 'p' }];
  assert.deepEqual(withoutChips({ a: 1, b: 2, z: 3 }, nested, new Set(['p'])), { z: 3 }, 'a child goes with its parent, whatever its keys');
  const w = { view: 'workspaces', pageWorkspaceId: 'wks-havn-649ebfe7' };
  assert.deepEqual(withoutChips(w, pageChips(w), new Set(['workspace:wks-havn-649ebfe7'])), {}, 'the workspace chip takes the view with its id, as the project chip does');
});

test('chip names fall back to the whole pipeline id, the project key and the workspace id; a run view with no run is a Page chip', () => {
  assert.equal(pageChips({ view: 'history-detail', pipelineId: 'aaaa1111bbbb2222' }, {})[0].name, 'aaaa1111bbbb2222', 'a saved run with no title: its whole id');
  assert.equal(pageChips({ view: 'project-detail', pageProjectKey: 'worca-cc-551183d0' }, {})[0].name, 'worca-cc-551183d0', 'before the projects load: the key');
  assert.deepEqual(pageChips({ view: 'running' }).map((c) => [c.kind, c.name]), [['page', 'Run']]);
});

test('pageScopeOf: what the page is about, by key or by path', () => {
  assert.deepEqual(pageScopeOf(RUN, PROJECTS), { pinned: true, projectKey: 'worca-cc-551183d0', label: 'worca-cc' });
  assert.deepEqual(pageScopeOf({ view: 'project-detail', pageProjectKey: 'worca-cc-551183d0' }, PROJECTS), { pinned: true, projectKey: 'worca-cc-551183d0', label: 'worca-cc' });
  assert.deepEqual(pageScopeOf({ view: 'workspaces', pageWorkspaceId: 'wks-havn-649ebfe7' }, PROJECTS, [{ id: 'wks-havn-649ebfe7', name: 'Havn' }]), { pinned: true, workspaceId: 'wks-havn-649ebfe7', label: 'Havn' });
  assert.deepEqual(pageScopeOf({ view: 'history-detail', pipelineId: 'aaaa1111', workspaceId: 'wks-havn-649ebfe7' }, PROJECTS, [{ id: 'wks-havn-649ebfe7', name: 'Havn' }]).workspaceId, 'wks-havn-649ebfe7');
  assert.deepEqual(pageScopeOf({ view: 'history-detail', pipelineId: 'aaaa1111', projectKey: 'worca-cc-551183d0' }, PROJECTS).projectKey, 'worca-cc-551183d0');
  assert.deepEqual(pageScopeOf({ view: 'new', projectDir: '/r/w' }, PROJECTS).projectKey, 'worca-cc-551183d0');
  assert.equal(pageScopeOf({ view: 'runs', projectDir: '/r/w', projectSource: 'fallback' }, PROJECTS), null);
  assert.equal(pageScopeOf({ view: 'new', projectDir: '/r/w', projectSource: 'fallback' }, PROJECTS), null);
  assert.equal(pageScopeOf({ view: 'history-detail', pipelineId: 'aaaa1111', projectKey: 'no-project-00000000' }, PROJECTS), null);
  assert.equal(pageScopeOf({ view: 'project-detail', pageProjectKey: 'no-project-00000000' }, [{ key: 'no-project-00000000', name: 'No project', path: '/w' }]), null);
  assert.equal(pageScopeOf({ view: 'running', runId: U, projectDir: '/gone' }, PROJECTS), null);
  assert.equal(pageScopeOf({ view: 'schedules', projectDir: '/r/w' }, PROJECTS), null);
  assert.equal(pageScopeOf({ view: 'project-detail', pageProjectKey: 'gone-00000001' }, PROJECTS), null);
});

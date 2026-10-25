// test/ask-where.test.mjs — whereOf names the page a chat context comes from ("on Run · Diff"), for the server's
// `where` block and the composer's page chip (Ask worca beside the page, Task 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whereOf, WHERE_PAGES, RUN_PART_LABELS } from '../src/shared/ask-where.mjs';
import { ICONS } from '../ui/public/icons.mjs';

const U = '0f0f0f0f-0000-4000-8000-000000000001';

test('run pages name the part on screen', () => {
  assert.deepEqual(whereOf({ view: 'running', runId: U, runPage: 'diff' }), { label: 'Run · Diff', icon: 'diff' });
  assert.deepEqual(whereOf({ view: 'history-detail', pipelineId: 'aaaa1111', runPage: 'glance' }), { label: 'Run', icon: 'run' });
  assert.deepEqual(whereOf({ view: 'running', runId: U, runPage: 'clarify' }), { label: 'Run · Q&A', icon: 'run' });
  assert.deepEqual(whereOf({ view: 'history-detail', pipelineId: 'aaaa1111' }), { label: 'Run', icon: 'run' });
  assert.deepEqual(whereOf({ view: 'history-detail', pipelineId: 'aaaa1111', runPage: 'changes' }), { label: 'Run · Changes', icon: 'run' });
  assert.deepEqual(whereOf({ view: 'running', runId: U, runPage: 'actions' }), { label: 'Run · Actions', icon: 'run' });
});

test('list and detail pages', () => {
  assert.deepEqual(whereOf({ view: 'projects' }), { label: 'Projects', icon: 'project' });
  assert.deepEqual(whereOf({ view: 'project-detail', pageProjectKey: 'worca-cc-551183d0' }), { label: 'Project', icon: 'project' });
  assert.deepEqual(whereOf({ view: 'workspaces' }), { label: 'Workspaces', icon: 'workspace' });
  assert.deepEqual(whereOf({ view: 'workspaces', pageWorkspaceId: 'wks-havn-649ebfe7' }), { label: 'Workspace', icon: 'workspace' });
  assert.deepEqual(whereOf({ view: 'schedules' }), { label: 'Schedules', icon: 'schedule' });
  assert.deepEqual(whereOf({ view: 'runs' }), { label: 'Runs', icon: 'run' });
  assert.deepEqual(whereOf({ view: 'requirements' }), { label: 'Requirements', icon: 'shape' }, 'a page of its own (app.js VIEW_NAMES)');
});

test('no page for Chat, Workflows, an unknown view, no view or no context', () => {
  for (const c of [{ view: 'chat', runId: U }, { view: 'workflows' }, { view: 'nope' }, { view: 'constructor' }, {}, null, 'x']) assert.equal(whereOf(c), null);
  assert.equal(Object.isFrozen(WHERE_PAGES), true);
  assert.equal(Object.isFrozen(WHERE_PAGES.runs), true);
  assert.equal(Object.isFrozen(RUN_PART_LABELS), true);
});

test('every icon is a key of ICONS', () => {
  for (const [view, p] of Object.entries(WHERE_PAGES)) assert.ok(Object.hasOwn(ICONS, p.icon), `${view}: ${p.icon}`);
  assert.ok(Object.hasOwn(ICONS, 'diff'));
});

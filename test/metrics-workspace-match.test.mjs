// test/metrics-workspace-match.test.mjs
// matchesWorkspace: id first (a rename must not orphan history; two same-named workspaces of
// different teammates must not pool), name fallback for records written before workspaceId.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesWorkspace } from '../src/shared/team-metrics/workspace-match.mjs';

const ws = { id: 'wks-iot-sp-0123abcd', name: 'IoT SP Platform' };
const rec = (t) => ({ kind: 'workspace', workspace: 'IoT SP Platform', ...t });

test('id wins over the name in both directions', () => {
  assert.equal(matchesWorkspace(rec({ workspaceId: ws.id, workspace: 'Renamed Platform' }), ws), true, 'renamed: id still matches');
  assert.equal(matchesWorkspace(rec({ workspaceId: 'wks-other-0000ffff' }), ws), false, 'same name, another workspace: excluded');
});

test('records without an id fall back to a case-insensitive name match', () => {
  assert.equal(matchesWorkspace(rec({}), ws), true);
  assert.equal(matchesWorkspace(rec({ workspace: 'iot sp platform' }), ws), true);
  assert.equal(matchesWorkspace(rec({ workspaceId: null, workspace: 'Other WS' }), ws), false);
  assert.equal(matchesWorkspace(rec({ workspaceId: '' }), ws), true, 'an empty id counts as absent');
});

test('never matches a project record, a missing target, or a workspace without identity', () => {
  assert.equal(matchesWorkspace({ kind: 'project', project: 'acme/x' }, ws), false);
  assert.equal(matchesWorkspace(null, ws), false);
  assert.equal(matchesWorkspace(rec({}), { id: '', name: '' }), false);
});

// test/requirements-export-store.test.mjs — the export setup per scope, the ticket link per feature and the `export` turn
// (plans/requirements-a6-design.md §3, D2, D7, D10, D12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import {
  createFeature, appendTurn, listTurns, getExportSetup, upsertExportSetup, setExportSetupDoneStatus, getExportLink, setPendingExport,
  saveExportLink, clearPendingExport, deleteExportLink,
} from '../src/core/requirements/store.mjs';
import { TURN_KINDS } from '../src/core/requirements/spec.mjs';
import { buildRoundPrompt } from '../src/core/requirements/round.mjs';

useTempHome(after, 'worca-req-export-store-');
const CONN = { plugin: 'jira-source', sourceId: 'jira', profile: 'acme' };
const SETUP = { ...CONN, trackerProject: 'SHOP', trackerProjectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story',
  labels: ['worca'], priority: null, priorityName: null, criteria: { target: 'description' }, doneStatus: 'Done' };
const feature = () => createFeature({ scopeType: 'project', scopeKey: 'shop-1', title: 'Cancel order', description: 'Before it ships' });

test('setup: one per project and one per workspace; saving again updates it and keeps who made it; the done status alone', () => {
  assert.equal(getExportSetup('project', 'shop-1'), null);
  const p = upsertExportSetup({ scopeType: 'project', scopeKey: 'shop-1', ...SETUP }, { by: 'po' });
  assert.deepEqual([p.plugin, p.sourceId, p.profile, p.trackerProject, p.trackerProjectName, p.issueType, p.issueTypeName, p.labels, p.priority,
    p.criteria, p.doneStatus, p.createdBy], ['jira-source', 'jira', 'acme', 'SHOP', 'SHOP — Shop web', '10001', 'Story', ['worca'], null,
    { target: 'description' }, 'Done', 'po']);
  const w = upsertExportSetup({ scopeType: 'workspace', scopeKey: 'shop-1', ...SETUP, trackerProject: 'OPS', trackerProjectName: 'OPS — Operations' });
  assert.equal(w.trackerProject, 'OPS');
  assert.equal(getExportSetup('project', 'shop-1').trackerProject, 'SHOP', 'a workspace with the same key is another scope');
  const again = upsertExportSetup({ scopeType: 'project', scopeKey: 'shop-1', ...SETUP, labels: ['worca', 'web'], priority: '3', priorityName: 'Medium',
    criteria: { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' } }, { by: 'ann' });
  assert.deepEqual([again.labels, again.priority, again.priorityName, again.criteria, again.createdBy, again.updatedBy],
    [['worca', 'web'], '3', 'Medium', { target: 'field', field: 'customfield_10070', name: 'Acceptance Criteria' }, 'po', 'ann']);
  setExportSetupDoneStatus('project', 'shop-1', null);
  assert.equal(getExportSetup('project', 'shop-1').doneStatus, null);
  assert.throws(() => getExportSetup('team', 'x'), /scopeType/);
});

test('link: a pending create has no key yet; clearing it removes the row', () => {
  const f = feature();
  assert.equal(getExportLink(f.seq), null);
  const p = setPendingExport(f.seq, { ...CONN, trackerProject: 'SHOP', marker: 'rexp_000000000001' }, { by: 'po' });
  assert.deepEqual([p.key, p.url, p.pendingMarker, p.plugin, p.profile, p.trackerProject], [null, null, 'rexp_000000000001', 'jira-source', 'acme', 'SHOP']);
  assert.ok(p.pendingAt);
  clearPendingExport(f.seq);
  assert.equal(getExportLink(f.seq), null);
});

test('link: saved; a pending new ticket keeps the current key and connection; clearing keeps the link; delete removes it', () => {
  const f = feature();
  setPendingExport(f.seq, { ...CONN, trackerProject: 'SHOP', marker: 'rexp_000000000002' });
  const spec = { ...f.spec, goal: { text: 'Cancel', measure: 'fewer calls' } };
  const s = saveExportLink(f.seq, { ...CONN, trackerProject: 'SHOP', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123',
    createdAt: '2026-10-26T10:42:00.000Z', exportedAt: '2026-10-26T10:42:00.000Z', spec,
    fields: { projectName: 'SHOP — Shop web', issueType: '10001', issueTypeName: 'Story', labels: ['worca'], priority: null, priorityName: null,
      criteria: { target: 'description' } }, fingerprint: 'fp1', junk: 'ignored' }, { by: 'po' });
  assert.deepEqual([s.key, s.url, s.pendingMarker, s.pendingAt, s.fingerprint, s.spec.goal.text, s.fields.issueTypeName, s.updatedBy],
    ['SHOP-123', 'https://acme.test/browse/SHOP-123', null, null, 'fp1', 'Cancel', 'Story', 'po']);
  const pend = setPendingExport(f.seq, { plugin: 'other', sourceId: 'x', profile: null, trackerProject: 'OPS', marker: 'rexp_000000000003' });
  assert.deepEqual([pend.key, pend.plugin, pend.trackerProject, pend.pendingMarker], ['SHOP-123', 'jira-source', 'SHOP', 'rexp_000000000003']);
  clearPendingExport(f.seq);
  assert.deepEqual([getExportLink(f.seq).key, getExportLink(f.seq).pendingMarker], ['SHOP-123', null]);
  const upd = saveExportLink(f.seq, { ...getExportLink(f.seq), exportedAt: '2026-10-27T09:00:00.000Z', fingerprint: 'fp2' });
  assert.deepEqual([upd.createdAt, upd.exportedAt, upd.fingerprint], ['2026-10-26T10:42:00.000Z', '2026-10-27T09:00:00.000Z', 'fp2']);
  assert.equal(deleteExportLink(f.seq), 1);
  assert.equal(getExportLink(f.seq), null);
  assert.equal(deleteExportLink(f.seq), 0);
});

test('turn kind export: stored and listed; a round prompt is byte-identical with or without it', () => {
  assert.ok(TURN_KINDS.includes('export'));
  const f = feature();
  appendTurn(f.seq, { kind: 'round', payload: { questions: [], done: true } });
  const before = buildRoundPrompt({ feature: f, turns: listTurns(f.seq) });
  appendTurn(f.seq, { kind: 'export', payload: { action: 'created', tracker: 'Jira', key: 'SHOP-123', url: 'https://acme.test/browse/SHOP-123',
    at: '2026-10-26T10:42:00.000Z' } }, { by: 'po' });
  const turns = listTurns(f.seq);
  assert.deepEqual([turns.at(-1).kind, turns.at(-1).payload.key, turns.at(-1).by], ['export', 'SHOP-123', 'po']);
  assert.equal(buildRoundPrompt({ feature: f, turns }), before, 'threadText writes no line for an export');
});

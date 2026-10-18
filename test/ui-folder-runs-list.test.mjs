// test/ui-folder-runs-list.test.mjs — Projects, any way (P1b): a Folder project's group in the Runs list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildRunsModel, renderRunsList } from '../ui/public/runs-list.mjs';

const NOW = new Date(2026, 9, 17, 15, 0).getTime();
const at = (h, m) => new Date(2026, 9, 17, h, m).toISOString();
const hist = (id, over = {}) => ({ id, projectKey: 'tax-papers-1a2b3c4d', title: id, status: 'done', pauseReason: null, startedAt: at(14, 10), mtime: 0,
  groupName: 'Tax papers 2026', groupKind: 'folder', by: '', pr: 'PENDING', checks: null, files: 14, changes: { state: 'pending' }, ...over });

test('a Folder project group: the Folder chip on its head; its finished rows read Finished / Applied / Discarded (Finished when nothing changed)', () => {
  const m = buildRunsModel({ now: NOW, history: [
    hist('h1'), hist('h2', { changes: { state: 'applied' } }), hist('h3', { changes: { state: 'discarded' } }),
    hist('h4', { files: 0, changes: { state: 'discarded' } }),
    { id: 'g1', projectKey: 'worca-cc-00000002', title: 'g1', status: 'done', startedAt: at(1, 42), mtime: 0, groupName: 'worca-cc', groupKind: 'git', by: '', pr: 'MERGED' },
    { id: 'u1', projectKey: 'scratch-00000003', title: 'u1', status: 'done', startedAt: at(1, 0), mtime: 0, groupName: 'scratch', by: '', pr: 'MERGED' },
  ] });
  const tax = m.groups.find((g) => g.key === 'tax-papers-1a2b3c4d');
  assert.equal(tax.kind, 'folder');
  assert.deepEqual(tax.rows.map((r) => r.word), ['Finished', 'Applied', 'Discarded', 'Finished']);
  const doc = new JSDOM('<!doctype html><div id="h"></div>').window.document;
  doc.getElementById('h').append(...renderRunsList(doc, m));
  const head = doc.querySelector('.runs-group[data-group-key="tax-papers-1a2b3c4d"] .runs-group-head');
  assert.deepEqual([...head.children].map((c) => c.getAttribute('class')), ['runs-chev', 'runs-group-name', 'kind-chip kind-folder', 'runs-count']);
  assert.equal(head.querySelector('.kind-chip').textContent, 'Folder');
  assert.equal(head.querySelector('.runs-group-name').textContent, 'Tax papers 2026', 'the name stays the name');
  assert.equal(doc.querySelector('.runs-group[data-group-key="worca-cc-00000002"] .kind-chip').textContent, 'Git');
  assert.equal(doc.querySelector('.runs-group[data-group-key="scratch-00000003"] .kind-chip'), null, 'no kind known, no chip');
  const byDate = buildRunsModel({ now: NOW, groupBy: 'date', history: [hist('h1')] });
  assert.equal(byDate.groups[0].kind, undefined, 'date sections carry no project kind');
  const late = buildRunsModel({ now: NOW, history: [hist('x1', { groupKind: '' }), hist('x2')] });
  assert.equal(late.groups[0].kind, 'folder', 'the group takes the kind from the first row that knows it');
  const live = buildRunsModel({ now: NOW, live: [{ runId: 'r1', pipelineId: 'p9', title: 'Sort statements', status: 'running', startedAt: at(14, 55),
    groupKey: 'tax-papers-1a2b3c4d', groupName: 'Tax papers 2026', groupKind: 'folder' }] });
  assert.equal(live.groups[0].kind, 'folder', 'a live run names its group kind too');
});

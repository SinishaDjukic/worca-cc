import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedPipelineRow } from './helpers/db-seed.mjs';
import { getDb } from '../src/core/db.mjs';
import { editRunLabels, changeLabels, readRunLabels, readLabelsFor, labelVocabulary, renameLabel, deleteLabel } from '../src/core/run-labels-store.mjs';

useTempHome(after, 'worca-run-labels-store-');

test('editRunLabels replaces the set, keeps the order of kept labels, a no-op writes nothing', () => {
  seedPipelineRow({ id: 'llll0001' });
  assert.deepEqual(editRunLabels('llll0001', ['Hotfix', 'needs demo'], { now: new Date('2026-10-20T10:00:00Z') }),
    { labels: ['hotfix', 'needs demo'], before: [], changed: true });
  assert.equal(editRunLabels('llll0001', ['needs demo', 'hotfix']).changed, false);
  editRunLabels('llll0001', ['needs demo', 'spike'], { now: new Date('2026-10-20T11:00:00Z') });
  assert.deepEqual(readRunLabels('llll0001'), ['needs demo', 'spike']);
  assert.throws(() => editRunLabels('llll0001', ['']), (e) => e.code === 'BAD_LABELS');
});

test('changeLabels adds to every run once and removes; readLabelsFor skips runs without labels', () => {
  for (const id of ['llll0002', 'llll0003', 'llll0004']) seedPipelineRow({ id });
  editRunLabels('llll0002', ['hotfix']);
  editRunLabels('llll0003', ['hotfix', 'spike']);
  const out = changeLabels(['llll0002', 'llll0003', 'llll0004'], { add: ['hotfix'] });
  assert.deepEqual(out.map((r) => [r.id, r.labels, r.changed]),
    [['llll0002', ['hotfix'], false], ['llll0003', ['hotfix', 'spike'], false], ['llll0004', ['hotfix'], true]]);
  changeLabels(['llll0003'], { remove: ['spike'] });
  assert.deepEqual(readRunLabels('llll0003'), ['hotfix']);
  assert.equal(readLabelsFor(['llll0005']).size, 0);
});

test('labelVocabulary counts active runs only, most used first', () => {
  seedPipelineRow({ id: 'llll0006' });
  editRunLabels('llll0006', ['needs demo']);
  seedPipelineRow({ id: 'llll0007' });
  editRunLabels('llll0007', ['release']);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-10-20T00:00:00Z' WHERE id = 'llll0007'").run();
  const v = labelVocabulary();
  assert.equal(v[0].label, 'hotfix');
  assert.ok(!v.some((x) => x.label === 'release'), 'an archived run\'s label is not suggested');
  assert.deepEqual(readLabelsFor(['llll0007']).get('llll0007'), ['release'], 'archived runs keep their labels');
});

test('renameLabel: every run, archived too; onto an existing label it merges; the same name is a no-op', () => {
  for (const id of ['rnlb0001', 'rnlb0002', 'rnlb0003']) seedPipelineRow({ id });
  editRunLabels('rnlb0001', ['rn-old', 'rn-keep']);
  editRunLabels('rnlb0002', ['rn-old', 'rn-into']);
  editRunLabels('rnlb0003', ['rn-old']);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-10-20T00:00:00Z' WHERE id = 'rnlb0003'").run();
  const out = renameLabel('RN-Old', 'rn-into');
  assert.deepEqual([out.label, [...out.ids].sort(), out.merged], ['rn-into', ['rnlb0001', 'rnlb0002', 'rnlb0003'], true]);
  assert.deepEqual(readRunLabels('rnlb0001'), ['rn-into', 'rn-keep'], 'the renamed label keeps its place');
  assert.deepEqual(readRunLabels('rnlb0002'), ['rn-into'], 'a run that had both keeps one');
  assert.deepEqual(readRunLabels('rnlb0003'), ['rn-into'], 'an archived run follows');
  assert.equal(getDb().prepare("SELECT COUNT(*) AS n FROM run_labels WHERE label = 'rn-old'").get().n, 0);
  assert.deepEqual(renameLabel('rn-into', ' RN-INTO ').ids, []);
  assert.deepEqual(renameLabel('rn-nowhere', 'rn-x').ids, []);
  assert.throws(() => renameLabel('rn-into', ''), (e) => e.code === 'BAD_LABELS');
});

test('deleteLabel removes the label from every run, archived too; other labels stay', () => {
  for (const id of ['dllb0001', 'dllb0002']) seedPipelineRow({ id });
  editRunLabels('dllb0001', ['dl-gone', 'dl-stay']);
  editRunLabels('dllb0002', ['dl-gone']);
  getDb().prepare("UPDATE pipelines SET archived_at = '2026-10-20T00:00:00Z' WHERE id = 'dllb0002'").run();
  assert.deepEqual([...deleteLabel('DL-Gone').ids].sort(), ['dllb0001', 'dllb0002']);
  assert.deepEqual([readRunLabels('dllb0001'), readRunLabels('dllb0002')], [['dl-stay'], []]);
  assert.deepEqual(deleteLabel('dl-gone').ids, []);
});

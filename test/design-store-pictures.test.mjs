// test/design-store-pictures.test.mjs — the Design store's picture rows (design_pictures, D10) and the design's
// Pictures switch (D7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import {
  createDesign, updateDesign, deleteDesign, createBuild, updateBuild, addPicture, listPictures, getPicture,
} from '../src/core/design/store.mjs';

useDesignEnv(after);

test('pictures: on by default, patched like fast, refused when not a boolean', () => {
  const d = newDesign(); assert.equal(d.pictures, true);
  assert.equal(updateDesign(d.id, { pictures: false }).pictures, false);
  assert.throws(() => updateDesign(d.id, { pictures: 'no' }), /pictures must be true or false/);
  assert.equal(createDesign({ kind: 'web', pictures: false }).pictures, false);
});
test('addPicture / listPictures: one row per ask, oldest first, checked, gone with the design', () => {
  const d = newDesign(); const b1 = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const made = addPicture({ designId: d.id, buildId: b1.id, round: 2, name: 'hero', shape: 'wide', prompt: 'p', model: 'm', state: 'made', file: 'assets/made/hero.png', w: 1536, h: 1024, costUsd: 0.04, ms: 9000 });
  addPicture({ designId: d.id, buildId: b1.id, round: 1, name: 'bg', shape: 'tall', prompt: '', state: 'failed', reason: 'say what the picture shows' });
  assert.deepEqual(listPictures(d.id).map((p) => [p.round, p.name, p.state]), [[1, 'bg', 'failed'], [2, 'hero', 'made']]);
  assert.deepEqual([made.costUsd, made.w, made.file, made.reason], [0.04, 1536, 'assets/made/hero.png', null]);
  assert.deepEqual(getPicture(d.id, made.id), made); assert.equal(getPicture(newDesign().id, made.id), null, 'scoped to its design');
  const ok = { designId: d.id, buildId: b1.id, round: 1, name: 'a', shape: 'wide', prompt: 'p', state: 'made', file: 'assets/made/a.png', w: 8, h: 8 };
  assert.doesNotThrow(() => addPicture(ok), 'the base row is good, so each refusal below is its own');
  for (const bad of [{ name: '../x' }, { shape: 'round' }, { state: 'making' }, { file: 'assets/x.png' }, { file: 'assets/made/b.png' }, { file: null }, { state: 'failed' }, { prompt: 'x'.repeat(4001) }, { costUsd: -1 }])
    assert.throws(() => addPicture({ ...ok, ...bad }), (e) => e.code === 'BAD_REQUEST', JSON.stringify(bad));
  updateBuild(b1.id, { status: 'done' }); deleteDesign(d.id); assert.deepEqual(listPictures(d.id), []);
});
test('addPicture: ids, round, sizes, ms, reason and model are checked too; a failed row may keep its cost', () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const ok = { designId: d.id, buildId: b.id, round: 1, name: 'a', shape: 'square', prompt: 'p', state: 'made', file: 'assets/made/a.webp', w: 8, h: 8 };
  for (const bad of [{ designId: 'd_x' }, { buildId: b.id.slice(1) }, { round: 0 }, { round: 1.5 }, { w: 0 }, { w: 2.5 }, { h: null }, { ms: -1 }, { ms: 0.5 }, { reason: 'x'.repeat(301) }, { model: 5 }, { prompt: null }, { file: 'assets/made/a.gif' }])
    assert.throws(() => addPicture({ ...ok, ...bad }), (e) => e.code === 'BAD_REQUEST', JSON.stringify(bad));
  for (const name of ['../x', 'A', '-a', 'a'.repeat(41)]) {
    assert.throws(() => addPicture({ ...ok, state: 'failed', file: null, name }), (e) => e.code === 'BAD_REQUEST', `a failed row named ${name}`);
  }
  const kept = addPicture({ ...ok, state: 'failed', file: null, model: 'm', costUsd: 0.04, w: 1024, h: 1024, ms: 0, reason: 'x'.repeat(300), prompt: 'x'.repeat(4000) });
  assert.deepEqual([kept.state, kept.file, kept.costUsd, kept.ms, kept.reason.length], ['failed', null, 0.04, 0, 300], 'the service was paid even when saving failed');
  assert.deepEqual([getPicture(d.id, 0), getPicture(d.id, String(kept.id)), getPicture('d_x', kept.id), getPicture(undefined, kept.id), listPictures('d_x'), listPictures(undefined)],
    [null, null, null, null, [], []]);
});

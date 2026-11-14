// test/design-pictures-travel.test.mjs — Design pictures (P2 Task B8, SPEC D10a): where a made picture travels. A
// version and dist/ carry `work/assets/made/`; the desk's `work/.pictures/` asks and done files and its dot temps never
// enter either, nor do the kept copies in `<design>/made/` (outside work/); lint and classifyRef refuse a dot segment.
// "Back to before this" puts the version's file back in work/ and leaves the picture rows and the kept copies alone.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { assembleDesign, lintDesign } from '../src/core/design/assemble.mjs';
import { listDistFiles } from '../src/core/design/export.mjs';
import { classifyRef } from '../src/core/design/html-scan.mjs';
import { designWorkDir, distDir, madeDir, versionDir } from '../src/core/design/paths.mjs';
import { keepPicture, readKeptPicture, savePicture } from '../src/core/design/pictures.mjs';
import { addPicture, createBuild, listPictures } from '../src/core/design/store.mjs';
import { restoreVersion, snapshotVersion } from '../src/core/design/versions.mjs';

useDesignEnv(after);
const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));
const plan = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [{ id: 'hero', job: 'Hero', brief: 'b', parts: ['html'], estHeight: 600 }] };
const d = newDesign();
const put = (rel, text) => { const at = join(designWorkDir(d.id), rel); mkdirSync(dirname(at), { recursive: true }); writeFileSync(at, text); };
put('plan.json', JSON.stringify(plan));
put('shell.html', '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>');
put('sections/hero/index.html', '<section data-section="hero"><img src="assets/made/a.png"></section>');
put('.pictures/a.ask.json', JSON.stringify({ name: 'a', shape: 'wide', prompt: 'p' }));
put('.pictures/a.done.json', JSON.stringify({ name: 'a', state: 'made', file: 'assets/made/a.png' }));
put('assets/made/.x.tmp', 'half a picture');
const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
const made = { designId: d.id, buildId: b.id, round: 1, name: 'a', shape: 'wide', prompt: 'p', state: 'made', file: 'assets/made/a.png', w: 8, h: 8 };
const r1 = addPicture(made);
keepPicture({ designId: d.id, id: r1.id, ext: 'png', bytes: png(8, 8) });
const r2 = addPicture({ ...made, w: 16, h: 16 });
keepPicture({ designId: d.id, id: r2.id, ext: 'png', bytes: png(16, 16) });

test('a version and dist carry assets/made and never .pictures; a restore leaves rows and kept copies alone', async () => {
  savePicture({ designId: d.id, name: 'a', ext: 'png', bytes: png(8, 8) });
  await snapshotVersion({ designId: d.id });
  const v1 = versionDir(d.id, 1);
  assert.ok(existsSync(join(v1, 'assets/made/a.png')));
  assert.equal(existsSync(join(v1, '.pictures')) || existsSync(join(v1, 'assets/made/.x.tmp')) || existsSync(join(v1, 'made')), false);
  assembleDesign({ workDir: designWorkDir(d.id), plan, mode: 'dist' });
  const files = listDistFiles(distDir(d.id));
  assert.ok(files.includes('assets/made/a.png')); assert.equal(files.some((f) => f.startsWith('made/')), false);
  assert.equal(existsSync(join(distDir(d.id), 'assets/made/.x.tmp')) || existsSync(join(distDir(d.id), '.pictures')), false, 'on disk: listDistFiles hides dot names');
  assert.equal(lintDesign({ workDir: designWorkDir(d.id), plan }).findings.some((f) => /a\.png/.test(f.message ?? '')), false);
  assert.equal(classifyRef('.pictures/a.done.json').type, 'escaped');
  savePicture({ designId: d.id, name: 'a', ext: 'png', bytes: png(16, 16) });   // a remake after the version
  await restoreVersion({ designId: d.id, n: 1 });
  assert.deepEqual(readFileSync(join(madeDir(d.id), 'a.png')), png(8, 8), 'the version\'s file is back');
  assert.equal(listPictures(d.id).length, 2);
  assert.deepEqual([readKeptPicture(d.id, { id: r1.id, ext: 'png' }), readKeptPicture(d.id, { id: r2.id, ext: 'png' })], [png(8, 8), png(16, 16)]);
});

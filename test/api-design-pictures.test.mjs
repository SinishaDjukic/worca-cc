// test/api-design-pictures.test.mjs
// The two picture routes (SPEC §5, D10a) on a bare Express app: a design's picture rows, oldest first, and the bytes
// of a made picture's kept copy by its row id, whatever later happens to the file in work/. One temp home for the
// file: every lookup goes by id.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import { newDesign, useDesignEnv } from './helpers/design-fixture.mjs';
import { encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { prepare } from '../src/core/db.mjs';
import { madeDir, madeKeptDir } from '../src/core/design/paths.mjs';
import { keepPicture, savePicture } from '../src/core/design/pictures.mjs';
import { createDesignBuilds } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { addPicture, createBuild } from '../src/core/design/store.mjs';

const servers = [];
const registries = [];
after(async () => {
  for (const r of registries) { r.pauseAll(); await r.settled(); }
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
useDesignEnv(after);

/** `mock: true` keeps every spawn on the mock; nothing here starts a build. */
const designBuilds = createDesignBuilds({ broadcast: () => {}, deps: { mock: true, staggerMs: 0, retryDelayMs: 0 } });
registries.push(designBuilds);

/** A bare app with these deps: `call(method, path, body, headers)` -> `{status, json}`, `raw(path)` -> the GET's
 *  `fetch` Response (status, headers and bytes as sent). */
async function mkApp(deps) {
  const app = express();
  app.use(express.json());
  registerDesignRoutes(app, { broadcast: () => {}, deps });
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  servers.push(srv);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, path, body, headers = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  return { call, raw: (path) => fetch(`${base}${path}`) };
}

let call;
let raw;
before(async () => { ({ call, raw } = await mkApp({ designBuilds })); });

const png = (w, h) => Buffer.from(encodePNG(w, h, new Uint8Array(w * h * 3).fill(90)));
const jpg = (w, h) => Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
const madeRow = (d, b, round, name, ext) => addPicture({ designId: d.id, buildId: b.id, round, name, shape: 'wide', prompt: 'p', model: 'm', state: 'made', file: `assets/made/${name}.${ext}`, w: 8, h: 8, costUsd: 0, ms: 1 });
test('1 the list: this design\'s rows, oldest first, no designId', async () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const r2 = madeRow(d, b, 2, 'hero', 'png');
  const r1 = addPicture({ designId: d.id, buildId: b.id, round: 1, name: 'bg', shape: 'wide', prompt: '', state: 'failed', reason: 'say what the picture shows' });
  const res = await call('GET', `/api/design/${d.id}/pictures`);
  assert.equal(res.status, 200); assert.deepEqual(res.json.map((p) => p.id), [r1.id, r2.id]);
  assert.deepEqual(Object.keys(res.json[0]).sort(), ['buildId', 'costUsd', 'createdAt', 'file', 'h', 'id', 'model', 'ms', 'name', 'prompt', 'reason', 'round', 'shape', 'state', 'w']);
});
test('2 a picture by row id: its own kept bytes and type, privately cached, whatever happens in work/', async () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const one = madeRow(d, b, 1, 'hero', 'png'); savePicture({ designId: d.id, name: 'hero', ext: 'png', bytes: png(8, 8) }); keepPicture({ designId: d.id, id: one.id, ext: 'png', bytes: png(8, 8) });
  const two = madeRow(d, b, 1, 'hero', 'jpg'); savePicture({ designId: d.id, name: 'hero', ext: 'jpg', bytes: jpg(8, 8) }); keepPicture({ designId: d.id, id: two.id, ext: 'jpg', bytes: jpg(8, 8) });
  const get = async (id) => { const r = await raw(`/api/design/${d.id}/pictures/${id}`); return [r.status, r.headers.get('content-type'), r.status === 200 ? Buffer.from(await r.arrayBuffer()) : null]; };
  assert.deepEqual(await get(one.id), [200, 'image/png', png(8, 8)], 'the remake did not change the first tile');
  assert.deepEqual(await get(two.id), [200, 'image/jpeg', jpg(8, 8)]);
  const h = (await raw(`/api/design/${d.id}/pictures/${one.id}`)).headers;
  assert.deepEqual([h.get('cache-control'), h.get('x-content-type-options')], ['private, max-age=31536000, immutable', 'nosniff']);
  writeFileSync(join(madeDir(d.id), 'hero.jpg'), '<html>x</html>'); assert.deepEqual(await get(two.id), [200, 'image/jpeg', jpg(8, 8)], 'an agent\'s change');
  rmSync(madeDir(d.id), { recursive: true, force: true }); assert.deepEqual(await get(one.id), [200, 'image/png', png(8, 8)], 'the file removed');
  const failed = addPicture({ designId: d.id, buildId: b.id, round: 1, name: 'x', shape: 'wide', prompt: 'p', state: 'failed', reason: 'the round stopped' });
  const other = newDesign(); const ob = createBuild({ designId: other.id, kind: 'first', brief: 'x' }); const theirs = madeRow(other, ob, 1, 'z', 'png');
  keepPicture({ designId: other.id, id: theirs.id, ext: 'png', bytes: png(1, 1) });
  for (const id of [failed.id, theirs.id, 999999, '0', 'x', `${one.id}.png`, '..%2Fmade%2F1.png']) assert.equal((await get(id))[0], 404, String(id));
  rmSync(join(madeKeptDir(d.id), `${one.id}.png`)); assert.equal((await get(one.id))[0], 404, 'no kept copy: 404');
});
test('3 a row id is its digits only: another spelling of the same number is no picture', async () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const one = madeRow(d, b, 1, 'hero', 'png'); keepPicture({ designId: d.id, id: one.id, ext: 'png', bytes: png(8, 8) });
  const status = async (id) => (await raw(`/api/design/${d.id}/pictures/${id}`)).status;
  assert.equal(await status(one.id), 200);
  for (const id of [`0${one.id}`, `${one.id}e0`, `${one.id}.0`, `0x${one.id.toString(16)}`, `%20${one.id}`, `+${one.id}`]) assert.equal(await status(id), 404, id);
});
test('4 only a made row is served: a failed row that names a file (the store writes none) answers 404', async () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const row = addPicture({ designId: d.id, buildId: b.id, round: 1, name: 'hero', shape: 'wide', prompt: 'p', state: 'failed', reason: 'the round stopped' });
  prepare('UPDATE design_pictures SET file = ?, w = 8, h = 8 WHERE id = ?').run('assets/made/hero.png', row.id);
  keepPicture({ designId: d.id, id: row.id, ext: 'png', bytes: png(8, 8) });
  assert.deepEqual(await call('GET', `/api/design/${d.id}/pictures/${row.id}`), { status: 404, json: { error: 'picture not found' } });
});
test('5 the list is this design\'s alone, oldest first inside a round too; a webp picture is served as image/webp', async () => {
  const d = newDesign(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' });
  const other = newDesign(); const ob = createBuild({ designId: other.id, kind: 'first', brief: 'x' });
  const mine = madeRow(d, b, 1, 'hero', 'webp'); const theirs = madeRow(other, ob, 1, 'hero', 'png');
  const later = madeRow(d, b, 1, 'bg', 'png');
  const ids = async (x) => (await call('GET', `/api/design/${x.id}/pictures`)).json.map((p) => p.id);
  assert.deepEqual([await ids(d), await ids(other)], [[mine.id, later.id], [theirs.id]]);
  const webp = Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP', 'latin1');
  keepPicture({ designId: d.id, id: mine.id, ext: 'webp', bytes: webp });
  const r = await raw(`/api/design/${d.id}/pictures/${mine.id}`);
  assert.deepEqual([r.status, r.headers.get('content-type'), Buffer.from(await r.arrayBuffer())], [200, 'image/webp', webp]);
});

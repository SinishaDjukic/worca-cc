// test/office-lite-fixtures.test.mjs — the committed Office fixtures are exactly what make-fixtures.mjs builds. Compared per
// entry (names in order, declared sizes, decoded bytes), never per archive byte: DOS dates and deflate output may differ.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildFixtures } from './fixtures/office/make-fixtures.mjs';
import { fixture } from './helpers/office-lite-fixtures.mjs';

const JSZip = createRequire(import.meta.url)('jszip');

/** Every chunk an entry inflates to, kept even when JSZip's end-of-entry size check fails (the patched "lie" fixtures). */
const decoded = (file) => new Promise((resolve) => {
  const chunks = [];
  const done = () => resolve(Buffer.concat(chunks));
  file.internalStream('uint8array').on('data', (c) => chunks.push(Buffer.from(c))).on('end', done).on('error', done).resume();
});

async function entries(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  for (const f of Object.values(zip.files)) {
    if (f.dir) continue;
    out.push({ name: f.name, size: f._data.uncompressedSize, bytes: await decoded(f) });
  }
  return out;
}

test('the committed fixtures are what make-fixtures.mjs builds', async () => {
  const built = await buildFixtures();
  assert.ok(Object.keys(built).length >= 14);
  for (const [name, bytes] of Object.entries(built)) {
    const want = await entries(bytes);
    const got = await entries(fixture(name));
    assert.deepEqual(got.map((e) => e.name), want.map((e) => e.name), `${name}: names in order`);
    for (let i = 0; i < want.length; i++) {
      assert.equal(got[i].size, want[i].size, `${name} ${want[i].name}: declared size`);
      assert.ok(got[i].bytes.equals(want[i].bytes), `${name} ${want[i].name}: decoded bytes`);
    }
  }
});

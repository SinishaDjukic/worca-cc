// T-replay-fixture: E7's committed fixture (plan §4.11): shape, no local paths or secrets, every base blob named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SECRET_PATTERNS } from '../lib/redact.mjs';
import { assignHunks, ARMED_TOOLS } from '../lib/replay-tree.mjs';

const GZ = readFileSync(fileURLToPath(new URL('./fixtures/replay-decompose.json.gz', import.meta.url)));
const raw = gunzipSync(GZ).toString('utf8');
const fx = JSON.parse(raw);

test('it gunzips, has the v2 shape and stays within the size cap', () => {
  assert.ok(GZ.length <= 150 * 1024, `${GZ.length} bytes`);
  assert.equal(fx.v, 2);
  assert.equal(typeof fx.source.pipeline, 'string');
  assert.match(fx.source.note, /real base blobs/);
  assert.ok(Array.isArray(fx.phases) && fx.phases.length > 0);
  for (const p of fx.phases) for (const t of p.tasks) assert.ok(typeof t.id === 'string' && Array.isArray(t.files), t.id);
  assert.ok(Array.isArray(fx.calls) && fx.calls.length > 0);
  assert.ok(Array.isArray(fx.review.cycles));
  for (const c of fx.calls) {
    assert.equal(typeof c.t, 'number');
    if (c.tool === 'Bash') assert.equal(c.path, undefined);
    else assert.equal(c.cmd0, undefined);
  }
});

test('no absolute local path and no secret-shaped value anywhere', () => {
  for (const p of ['/Users/', '/home/', 'C:\\\\Users', '/private/var/', '.worca-cc/runs/']) assert.ok(!raw.includes(p), p);
  for (const c of fx.calls) if (c.path) assert.ok(!c.path.startsWith('/'), c.path);
  for (const re of SECRET_PATTERNS) assert.ok(!new RegExp(re.source, re.flags.replace('g', '')).test(raw), String(re));
});

test('every call\'s task exists in phases or is fix', () => {
  const ids = new Set(fx.phases.flatMap((p) => p.tasks.map((t) => t.id)));
  for (const c of fx.calls) {
    if (c.task === 'fix') assert.equal(c.phase, 'fix');
    else {
      assert.ok(ids.has(c.task), c.task);
      assert.equal(fx.phases.find((p) => p.tasks.some((t) => t.id === c.task)).ordinal, c.phase, c.task);
    }
  }
});

test('every modified file has a baseBlob, and every file has a finalBlob', () => {
  assert.ok(fx.files.length > 0);
  for (const f of fx.files) {
    assert.ok(f.status === 'modified' || f.status === 'created', f.path);
    if (f.status === 'modified') assert.match(String(f.baseBlob), /^[0-9a-f]{7,40}$/, f.path);
    else assert.equal(f.baseBlob, null, f.path);
    assert.match(String(f.finalBlob), /^[0-9a-f]{7,40}$/, f.path);
  }
});

test('every armed call\'s path is in files or counted as contentless', () => {
  const paths = new Set(fx.files.map((f) => f.path));
  const assigned = assignHunks(fx);
  fx.calls.forEach((c, i) => {
    if (!ARMED_TOOLS.has(c.tool) || c.phase === 'fix') return;
    if (c.path && paths.has(c.path)) assert.ok(assigned.has(i), `call ${i} ${c.path}`);
    else assert.equal(assigned.has(i), false, `call ${i} has no file in the patch: counted contentless by e7`);
  });
});

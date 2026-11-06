// test/design-store.test.mjs — the Design store: designs and their library folders (plan Task 7).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { statSync, readdirSync, existsSync, mkdirSync, mkdtempSync, writeFileSync, symlinkSync, rmSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { useTempHome } from './helpers/temp-home.mjs';
import { prepare } from '../src/core/db.mjs';
import { recordDesignCostDelta } from '../src/core/cost-budget.mjs';
import { DesignError, DESIGN_ID_RE } from '../src/core/design/ids.mjs';
import { designRoot, designDir, designWorkDir } from '../src/core/design/paths.mjs';
import {
  createDesign, getDesign, requireDesign, listDesigns, updateDesign, deleteDesign,
} from '../src/core/design/store.mjs';

useTempHome(after);
const bad = (code) => (e) => e instanceof DesignError && e.code === code;

test('createDesign: row, folders and defaults; bad input leaves nothing', () => {
  const d = createDesign({ kind: 'web' }, { by: 'alice' });
  assert.match(d.id, DESIGN_ID_RE);
  const { title, kind, fast, status, version, createdBy, costUsd, projectKey, currentBuild } = d;
  assert.deepEqual({ title, kind, fast, status, version, createdBy, costUsd, projectKey, currentBuild },
    { title: 'Untitled design', kind: 'web', fast: false, status: 'empty', version: 0, createdBy: 'alice', costUsd: 0, projectKey: null, currentBuild: null });
  assert.equal(Object.keys(d).some((k) => /budget/i.test(k)), false, 'M13: a design has no spending limit of its own');
  assert.ok(statSync(join(designWorkDir(d.id), 'sections')).isDirectory());
  const before = readdirSync(designRoot()).length;
  assert.throws(() => createDesign({ kind: 'film' }), bad('BAD_REQUEST'));
  assert.throws(() => createDesign({ kind: 'web', title: 'x'.repeat(121) }), bad('BAD_REQUEST'));
  assert.equal(readdirSync(designRoot()).length, before);
  const p = createDesign({ kind: 'pitch', title: '  Line\none  ', fast: true });
  assert.deepEqual([p.title, p.fast], ['Line one', true]);
  assert.equal(createDesign({ kind: 'web', title: ' \n\t ' }).title, 'Untitled design', 'blank falls back');
});

test('updateDesign patches only its fields; an unknown id is NOT_FOUND', () => {
  const d = createDesign({ kind: 'web' });
  const u = updateDesign(d.id, { title: 'Hero page', fast: true, projectKey: 'p-1', threadId: 'ask_1', engine: 'claude', status: 'done', version: 2, id: 'd_nope', kind: 'video' });
  assert.deepEqual([u.title, u.fast, u.projectKey, u.threadId, u.engine, u.status, u.version, u.id, u.kind],
    ['Hero page', true, 'p-1', 'ask_1', 'claude', 'done', 2, d.id, 'web']);
  assert.throws(() => updateDesign(d.id, { status: 'nonsense' }), bad('BAD_REQUEST'));
  assert.throws(() => updateDesign('d_000000000000', { title: 'x' }), bad('NOT_FOUND'));
  assert.equal(getDesign('d_000000000000'), null);
  assert.throws(() => requireDesign('d_000000000000'), bad('NOT_FOUND'));
});

test('listDesigns: newest first, the owner filter, spend from the ledger', () => {
  prepare('DELETE FROM designs').run();
  const a = createDesign({ kind: 'web', title: 'A' }, { by: 'alice' });
  const b = createDesign({ kind: 'web', title: 'B' }, { by: 'bob' });
  const c = createDesign({ kind: 'web', title: 'C' });
  prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', a.id);
  prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run('2026-01-03T00:00:00.000Z', b.id);
  prepare('UPDATE designs SET updated_at = ? WHERE id = ?').run('2026-01-02T00:00:00.000Z', c.id);
  recordDesignCostDelta({ designId: a.id, amountUsd: 0.5 });
  recordDesignCostDelta({ designId: a.id, amountUsd: 0.25 });
  assert.deepEqual(listDesigns().map((d) => d.title), ['B', 'C', 'A']);
  assert.deepEqual(listDesigns({ visibleTo: 'alice' }).map((d) => d.title), ['C', 'A'], 'its own, and unowned');
  assert.equal(listDesigns().at(-1).costUsd, 0.75);
  assert.equal(getDesign(a.id).costUsd, 0.75);
});

test('deleteDesign: folder and rows go; the ledger stays, so a delete never lowers spend', { skip: false }, () => {
  const d = createDesign({ kind: 'web' });
  recordDesignCostDelta({ designId: d.id, amountUsd: 1, tsMs: 5 });
  assert.equal(deleteDesign(d.id), true);
  assert.equal(existsSync(designDir(d.id)), false);
  assert.equal(getDesign(d.id), null);
  assert.equal(prepare('SELECT COUNT(*) AS n FROM design_cost_ledger WHERE design_id = ?').get(d.id).n, 1);
  assert.equal(deleteDesign(d.id), false);
  assert.equal(deleteDesign('../d_000000000000'), false, 'a malformed id never reaches the disk');
  // Each folder a malformed id would name if an anchor of DESIGN_ID_RE went missing: it must survive.
  const canaries = [['../d_0123456789ab', join(designRoot(), '..', 'd_0123456789ab')], ['d_0123456789ab/../../x', join(designRoot(), '..', 'x')],
    ['d_0123456789abc', join(designRoot(), 'd_0123456789abc')]];
  for (const [id, canary] of canaries) {
    mkdirSync(canary, { recursive: true }); writeFileSync(join(canary, 'keep'), 'k');
    assert.equal(deleteDesign(id), false, id);
    assert.ok(existsSync(join(canary, 'keep')), `${id}: nothing outside its own folder is removed`);
    rmSync(canary, { recursive: true, force: true });
  }
});

test('deleteDesign removes a link inside the folder, not what it points at', { skip: process.platform === 'win32' ? 'POSIX' : false }, () => {
  const d = createDesign({ kind: 'web' });
  const keep = mkdtempSync(join(tmpdir(), 'dds-'));
  writeFileSync(join(keep, 'precious.txt'), 'x');
  symlinkSync(keep, join(designWorkDir(d.id), 'assets', 'link'));
  deleteDesign(d.id);
  assert.ok(existsSync(join(keep, 'precious.txt')));
  rmSync(keep, { recursive: true, force: true });
});

test('createDesign: a failed insert removes the folder it made', () => {
  createDesign({ kind: 'web' });
  const before = readdirSync(designRoot()).sort();
  prepare("CREATE TEMP TRIGGER design_store_boom BEFORE INSERT ON designs BEGIN SELECT RAISE(ABORT, 'boom'); END").run();
  try {
    assert.throws(() => createDesign({ kind: 'web' }), /boom/);
  } finally {
    prepare('DROP TRIGGER design_store_boom').run();
  }
  assert.deepEqual(readdirSync(designRoot()).sort(), before);
});

test('deleteDesign: a folder it cannot remove is IO and keeps the rows, so a retry works', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'POSIX, not root' : false,
}, () => {
  const d = createDesign({ kind: 'web' });
  chmodSync(designRoot(), 0o555);
  try {
    assert.throws(() => deleteDesign(d.id), bad('IO'));
  } finally {
    chmodSync(designRoot(), 0o755);
  }
  assert.equal(getDesign(d.id)?.id, d.id);
  assert.equal(deleteDesign(d.id), true);
  assert.equal(existsSync(designDir(d.id)), false);
});

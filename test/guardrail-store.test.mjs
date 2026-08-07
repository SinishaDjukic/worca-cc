// test/guardrail-store.test.mjs
// guardrail-store.mjs stores named guardrail sets in SQLite (table: guardrail_sets);
// the built-ins Permissive/Normal/Strict stay virtual (GUARDRAIL_PRESETS). All
// functions async, reads never throw. Per-test throwaway WORCA_HOME + DB reset
// (the test/workflows-db.test.mjs pattern). Reference kind in the per-run model:
// pipelines.resume_point.guardrailsId pins ONLY — there are no project refs.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  BUILTIN_GUARDRAIL_SET_IDS, isBuiltinGuardrailSetId, listBuiltinGuardrailSets,
  readGuardrailSet, listGuardrailSets, writeGuardrailSet, deleteGuardrailSet,
  guardrailSetReferences, ReferencedError,
} from '../src/core/guardrail-store.mjs';
import { GUARDRAIL_PRESETS, sanitizeGuardrails } from '../src/core/guardrails.mjs';
import { getDb, _resetForTests } from '../src/core/db.mjs';

const homes = [];
async function freshHome() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-grdb-'));
  homes.push(dir);
  _resetForTests();
  process.env.WORCA_HOME = dir;
  return dir;
}
beforeEach(freshHome);
after(async () => {
  _resetForTests();
  delete process.env.WORCA_HOME;
  await Promise.all(homes.map((d) => rm(d, { recursive: true, force: true })));
});

const SETTINGS = {
  honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'],
  protectedPaths: ['.env*'], deny: ['Bash(curl:*)'],
};

test('built-ins are virtual: readGuardrailSet resolves Permissive/Normal/Strict from code, never rows', async () => {
  assert.deepEqual(BUILTIN_GUARDRAIL_SET_IDS, ['permissive', 'normal', 'secure']);
  assert.ok(isBuiltinGuardrailSetId('secure'));
  assert.ok(!isBuiltinGuardrailSetId('gr_org'));
  const strict = await readGuardrailSet('secure');
  assert.equal(strict.name, 'Strict', 'display rename — wire id stays "secure"');
  assert.equal(strict.origin, 'builtin');
  assert.deepEqual(strict.settings, sanitizeGuardrails(GUARDRAIL_PRESETS.secure));
  // Fresh copies each call — mutating a result never corrupts the code table.
  strict.settings.deny.push('Bash(x)');
  assert.deepEqual((await readGuardrailSet('secure')).settings.deny,
    sanitizeGuardrails(GUARDRAIL_PRESETS.secure).deny);
  // Never a DB row.
  assert.equal(getDb().prepare('SELECT 1 FROM guardrail_sets WHERE id = ?').get('secure'), undefined);
  assert.deepEqual(listBuiltinGuardrailSets().map((s) => [s.id, s.name, s.origin]),
    [['permissive', 'Permissive', 'builtin'], ['normal', 'Normal', 'builtin'], ['secure', 'Strict', 'builtin']]);
});

test('writeGuardrailSet mints gr_<slug>, sanitizes settings, roundtrips through readGuardrailSet', async () => {
  const saved = await writeGuardrailSet({ name: 'Org Policy', settings: { ...SETTINGS, deny: ['Bash(curl:*)', 'not a rule'] } });
  assert.equal(saved.id, 'gr_org-policy');
  assert.equal(saved.name, 'Org Policy');
  assert.equal(saved.origin, null, 'user-created rows have NULL origin');
  assert.deepEqual(saved.settings.deny, ['Bash(curl:*)'], 'read-path sanitize drops the invalid rule');
  assert.ok(saved.createdAt && saved.updatedAt, 'timestamps stamped');
  const row = getDb().prepare('SELECT name, settings FROM guardrail_sets WHERE id = ?').get(saved.id);
  assert.equal(row.name, 'Org Policy');
  assert.equal(JSON.parse(row.settings).envScrub, true);
  const got = await readGuardrailSet(saved.id);
  assert.deepEqual(got.settings, saved.settings);
});

test('re-save preserves createdAt, bumps updatedAt, stays a single upserted row', async () => {
  const first = await writeGuardrailSet({ name: 'Org Policy', settings: SETTINGS });
  await new Promise((r) => setTimeout(r, 5));
  const second = await writeGuardrailSet({ id: first.id, name: 'Org Policy v2', settings: { ...SETTINGS, envScrub: false } });
  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt, 'createdAt preserved');
  assert.notEqual(second.updatedAt, first.updatedAt, 'updatedAt bumped');
  assert.equal(getDb().prepare('SELECT count(*) AS n FROM guardrail_sets').get().n, 1);
  assert.equal((await readGuardrailSet(first.id)).name, 'Org Policy v2');
});

test('reserved and unsafe ids: write returns null; reads null; deletes false', async () => {
  for (const id of ['permissive', 'normal', 'secure', 'custom']) {
    assert.equal(await writeGuardrailSet({ id, name: 'Evil', settings: {} }), null, `${id} is reserved`);
  }
  assert.equal(await writeGuardrailSet({ id: '../evil', name: 'Evil', settings: {} }), null);
  assert.equal(await readGuardrailSet('../evil'), null);
  assert.equal(await deleteGuardrailSet('../evil'), false);
});

test('listGuardrailSets: user rows only, newest first; empty store => []', async () => {
  assert.deepEqual(await listGuardrailSets(), []);
  const a = await writeGuardrailSet({ name: 'Alpha', settings: {}, createdAt: '2026-01-01T00:00:00.000Z' });
  const b = await writeGuardrailSet({ name: 'Beta', settings: {}, createdAt: '2026-02-01T00:00:00.000Z' });
  const list = await listGuardrailSets();
  assert.deepEqual(list.map((s) => s.id), [b.id, a.id], 'newest first');
  assert.ok(!list.some((s) => isBuiltinGuardrailSetId(s.id)), 'built-ins never listed by the store');
});

test('deleteGuardrailSet: built-in refused (false), missing false, unreferenced true', async () => {
  assert.equal(await deleteGuardrailSet('secure'), false);
  assert.equal(await deleteGuardrailSet('gr_missing'), false);
  const saved = await writeGuardrailSet({ name: 'Gone Soon', settings: {} });
  assert.equal(await deleteGuardrailSet(saved.id), true);
  assert.equal(await readGuardrailSet(saved.id), null);
});

test('deleteGuardrailSet: pinned by a resume_point -> ReferencedError; the historical guardrails_id COLUMN never blocks', async () => {
  const saved = await writeGuardrailSet({ name: 'Pinned', settings: {} });
  // A paused run pins via its resume point (resume re-reads the set by id)…
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, status, resume_point, guardrails_id) VALUES ('p1', 'k1', 'paused', ?, ?)"
  ).run(JSON.stringify({ version: 1, guardrailsId: saved.id }), saved.id);
  // …while a FINISHED run records the selection in the column only (resume_point NULL).
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, status, guardrails_id) VALUES ('p2', 'k1', 'done', ?)"
  ).run(saved.id);
  await assert.rejects(() => deleteGuardrailSet(saved.id), (err) => {
    assert.equal(err.name, 'ReferencedError');
    assert.equal(err.code, 'REFERENCED');
    assert.deepEqual(err.references, [{ id: saved.id, referencedBy: ['pipeline p1'] }]);
    assert.ok(err instanceof ReferencedError);
    return true;
  });
  assert.ok(await readGuardrailSet(saved.id), 'nothing deleted');
  assert.deepEqual(await guardrailSetReferences(saved.id),
    [{ id: saved.id, referencedBy: ['pipeline p1'] }]);
  // The pinned run finishes (resume point nulled, the done-path behavior): the
  // done rows' guardrails_id columns alone must NOT block — history is a record,
  // not a reference (the id is not a content snapshot; sets stay editable).
  getDb().prepare("UPDATE pipelines SET resume_point = NULL, status = 'done' WHERE id = 'p1'").run();
  assert.deepEqual(await guardrailSetReferences(saved.id), [], 'no pins left');
  assert.equal(await deleteGuardrailSet(saved.id), true, 'historical column references never block deletion');
});

test('an ARCHIVED row releases its pin — archive must not strand a set forever', async () => {
  const saved = await writeGuardrailSet({ name: 'Pinned Then Archived', settings: {} });
  getDb().prepare(
    "INSERT INTO pipelines (id, project_key, status, resume_point) VALUES ('p1', 'k1', 'paused', ?)"
  ).run(JSON.stringify({ version: 1, guardrailsId: saved.id }));
  assert.deepEqual(await guardrailSetReferences(saved.id),
    [{ id: saved.id, referencedBy: ['pipeline p1'] }], 'live paused row pins');
  // History "Archive" soft-deletes (pipeline-delete.mjs stamps archived_at and
  // leaves the row otherwise intact). An archived run is invisible in History and
  // unresumable, so its resume point is no longer a reference — before the archive
  // change the hard DELETE released it, and nothing may pin the set permanently.
  getDb().prepare('UPDATE pipelines SET archived_at = ? WHERE id = ?')
    .run(new Date().toISOString(), 'p1');
  assert.deepEqual(await guardrailSetReferences(saved.id), [], 'archived rows do not pin');
  assert.equal(await deleteGuardrailSet(saved.id), true);
});

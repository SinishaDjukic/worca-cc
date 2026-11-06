// test/worca-levels-store.test.mjs
// src/core/worca-levels/store.mjs — persisted per-person worca-level JSON (I-8).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REAL_HOME = process.env.HOME;
const REAL_USERPROFILE = process.env.USERPROFILE;
const home = mkdtempSync(join(tmpdir(), 'worca-levels-store-'));
process.env.HOME = home;                     // the file lives under HOME/.worca-cc, beside away-people.json
process.env.USERPROFILE = home;

const dir = join(home, '.worca-cc');
const file = join(dir, 'worca-levels.json');
let store;

before(async () => { store = await import('../src/core/worca-levels/store.mjs'); });
after(() => {
  process.env.HOME = REAL_HOME;
  if (REAL_USERPROFILE === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = REAL_USERPROFILE;
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => { rmSync(dir, { recursive: true, force: true }); });

const rec = (over = {}) => ({
  level: 0, celebrated: 0, welcome: { kind: 'new', seenAt: null }, doneAt: {},
  live: { addons: [], spaces: false, statsDays: [], peakParallel: 0 },
  createdAt: 't0', updatedAt: 't0', ...over,
});

test('readPerson answers null when there is no file or no such person', async () => {
  assert.equal(store.readPerson('ann'), null);
  await store.updatePerson('bob', () => rec());
  assert.equal(store.readPerson('ann'), null);
});

test('updatePerson creates the record (fn gets null), persists { version: 1, people } atomically', async () => {
  let seen = 'unset';
  const out = await store.updatePerson('ann', (r) => { seen = r; return rec({ level: 1 }); });
  assert.equal(seen, null);
  assert.equal(out.level, 1);
  assert.deepEqual(store.readPerson('ann'), out);
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.people.ann.level, 1);
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a failed update leaves the stored record untouched even if fn mutated the record it was given', async () => {
  await store.updatePerson('ann', () => rec({ doneAt: { a: 1 } }));
  await assert.rejects(store.updatePerson('ann', (r) => { r.doneAt.b = 2; r.level = 9; throw new Error('nope'); }), /nope/);
  const stored = store.readPerson('ann');
  assert.deepEqual(stored.doneAt, { a: 1 });
  assert.equal(stored.level, 0);
});

test('updatePerson rejects a non-object result and leaves the file as it was', async () => {
  await store.updatePerson('ann', () => rec({ level: 2 }));
  await assert.rejects(store.updatePerson('ann', () => null), { code: 'WORCA_LEVEL_BAD_RECORD' });
  assert.equal(store.readPerson('ann').level, 2);
});

test('prototype and empty keys are rejected with a typed error', async () => {
  for (const k of ['__proto__', 'constructor', 'prototype', '', '   ', null, undefined, 7]) {
    assert.throws(() => store.readPerson(k), { name: 'WorcaLevelKeyError', code: 'WORCA_LEVEL_BAD_KEY' }, `read ${String(k)}`);
    await assert.rejects(store.updatePerson(k, () => rec()), { code: 'WORCA_LEVEL_BAD_KEY' }, `update ${String(k)}`);
    await assert.rejects(store.recordLive(k, {}), { code: 'WORCA_LEVEL_BAD_KEY' }, `live ${String(k)}`);
  }
  assert.equal(existsSync(file), false);
  assert.equal({}.polluted, undefined);
});

test('two parallel updates for a missing key create ONE record and both persist', async () => {
  const bump = (name) => (r) => {
    const base = r ?? rec();
    return { ...base, doneAt: { ...base.doneAt, [name]: 1 } };
  };
  const [a, b] = await Promise.all([store.updatePerson('ann', bump('x')), store.updatePerson('ann', bump('y'))]);
  assert.deepEqual(Object.keys(a.doneAt), ['x']);
  assert.deepEqual(Object.keys(b.doneAt).sort(), ['x', 'y']);
  const disk = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(disk.people), ['ann']);
  assert.deepEqual(Object.keys(disk.people.ann.doneAt).sort(), ['x', 'y']);
});

test('a throwing fn rejects its own call but does not stall the queue', async () => {
  const bad = store.updatePerson('ann', () => { throw new Error('boom'); });
  const good = store.updatePerson('ann', () => rec({ level: 3 }));
  await assert.rejects(bad, /boom/);
  assert.equal((await good).level, 3);
});

test('a corrupt file is renamed to *.corrupt-<ts>, logged, and the store starts empty without throwing', async () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, '{ not json');
  const warns = [];
  const orig = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try {
    assert.equal(store.readPerson('ann'), null);
  } finally { console.warn = orig; }
  assert.equal(warns.length, 1);
  assert.match(warns[0], /worca-levels/);
  const names = readdirSync(dir);
  assert.ok(names.some((n) => /^worca-levels\.json\.corrupt-/.test(n)), names.join(','));
  assert.equal(existsSync(file), false);
  const out = await store.updatePerson('ann', () => rec({ level: 1 }));
  assert.equal(out.level, 1);
});

test('an unreadable (non-ENOENT) file is never overwritten: updatePerson rejects and the bytes stay', async (t) => {
  if (process.getuid?.() === 0 || process.platform === 'win32') return t.skip('permission bits do not block this user');
  await store.updatePerson('ann', () => rec({ level: 3 }));
  const before = readFileSync(file, 'utf8');
  chmodSync(file, 0o000);
  const orig = console.warn; console.warn = () => {};
  try {
    await assert.rejects(store.updatePerson('bob', () => rec({ level: 1 })), (err) => err.code === 'EACCES');
    await assert.rejects(store.recordLive('ann', { addon: 'x' }), (err) => err.code === 'EACCES');
    assert.equal(store.readPerson('ann'), null, 'a reader answers empty and does not throw');
  } finally { console.warn = orig; chmodSync(file, 0o644); }
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(store.readPerson('ann').level, 3);
});

test('a valid-JSON file with the wrong shape is treated as corrupt too', () => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ version: 1, people: [] }));
  const orig = console.warn; console.warn = () => {};
  try { assert.equal(store.readPerson('ann'), null); } finally { console.warn = orig; }
  assert.ok(readdirSync(dir).some((n) => n.includes('.corrupt-')));
});

test('recordLive merges add-ons (deduped), the space flag, stats days (last 30 distinct) and a peakParallel that only rises', async () => {
  const day = (i) => `2026-01-${String(i).padStart(2, '0')}`;
  await store.recordLive('ann', { addon: 'a1' });
  await store.recordLive('ann', { addon: 'a1' });
  let r = await store.recordLive('ann', { addon: 'a2', space: true, peakParallel: 3 });
  assert.deepEqual(r.live.addons, ['a1', 'a2']);
  assert.equal(r.live.spaces, true);
  assert.equal(r.live.peakParallel, 3);
  r = await store.recordLive('ann', { peakParallel: 2 });
  assert.equal(r.live.peakParallel, 3);
  r = await store.recordLive('ann', { peakParallel: 5 });
  assert.equal(r.live.peakParallel, 5);
  r = await store.recordLive('ann', { space: false });
  assert.equal(r.live.spaces, true, 'a space flag never turns back off');

  for (let i = 1; i <= 31; i++) await store.recordLive('ann', { statsDay: day(i) });
  await store.recordLive('ann', { statsDay: day(31) });
  const days = store.readPerson('ann').live.statsDays;
  assert.equal(days.length, 30);
  assert.equal(days[0], day(2));
  assert.equal(days.at(-1), day(31));
});

test('recordLive creates the record when absent and keeps the other fields', async () => {
  const r = await store.recordLive('zed', { addon: 'x' });
  assert.equal(r.level, 0);
  assert.equal(r.welcome.seenAt, null);
  assert.equal(typeof r.createdAt, 'string');
  assert.deepEqual(r.live.addons, ['x']);
  await store.updatePerson('zed', (p) => ({ ...p, level: 2, doneAt: { k: 'd' } }));
  const again = await store.recordLive('zed', { statsDay: '2026-02-01' });
  assert.equal(again.level, 2);
  assert.deepEqual(again.doneAt, { k: 'd' });
});

test('recordLive ignores malformed patch values instead of storing them', async () => {
  const r = await store.recordLive('ann', { addon: 5, statsDay: 'yesterday', peakParallel: -1, space: 'yes' });
  assert.deepEqual(r.live, { addons: [], spaces: false, statsDays: [], peakParallel: 0 });
});

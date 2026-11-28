// test/secrets-os-store-fake.test.mjs — the six-state OS key store fake, in memory and file-backed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  FAKE_STATES, createFakeOsStore, fileFakeOsStore, writeFakeState, readFakeCalls, dropItem, fakeAccounts, peekKey,
} from './helpers/os-store-fake.mjs';

const ROOT = mkdtempSync(join(tmpdir(), 'worca-os-store-fake-'));
after(() => rmSync(ROOT, { recursive: true, force: true, maxRetries: 5 }));
let n = 0;
const statePath = () => join(ROOT, `state-${++n}.json`);
const KEY = randomBytes(32);
const settles = (p, ms = 100) => Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('pending'), ms))]);

// Both backings, built in one state.
const backings = {
  memory: (opts) => {
    const s = createFakeOsStore(opts);
    return { s, calls: () => s.calls, setState: (st) => s.setState(st) };
  },
  file: (opts) => {
    const p = statePath();
    writeFakeState(p, opts);
    const s = fileFakeOsStore(p);
    return { s, calls: () => readFakeCalls(p), setState: (st) => writeFakeState(p, { ...JSON.parse(readFileSync(p, 'utf8')), key: null, state: st }), p };
  },
};

test('the six states', () => assert.deepEqual(FAKE_STATES, ['available', 'unavailable', 'locked', 'item-missing', 'different-key', 'never-answers']));

for (const [name, make] of Object.entries(backings)) {
  test(`${name}: available returns the held key or null, and setKey stores it`, async () => {
    const { s, calls } = make({ state: 'available' });
    assert.equal(s.kind, 'fake');
    assert.equal(await s.getKey(), null);
    await s.setKey(KEY);
    assert.ok((await s.getKey()).equals(KEY));
    assert.deepEqual(calls().map((c) => c.op), ['getKey', 'setKey', 'getKey']);
    assert.ok(calls().every((c) => c.pid === process.pid && Object.keys(c).sort().join() === 'op,pid'));
  });

  test(`${name}: item-missing clears the key on entry, then behaves as available`, async () => {
    const { s } = make({ state: 'item-missing', key: KEY });
    assert.equal(await s.getKey(), null);
    await s.setKey(KEY);
    assert.ok((await s.getKey()).equals(KEY));
  });

  test(`${name}: different-key returns a fixed other key`, async () => {
    const { s } = make({ state: 'different-key' });
    const k = await s.getKey();
    assert.equal(k.length, 32);
    assert.ok(!k.equals(KEY));
    await s.setKey(KEY);
    assert.ok((await s.getKey()).equals(k));
  });

  test(`${name}: setKey is create-only: with an item present it throws exists and keeps the item`, async () => {
    const { s } = make({ state: 'available', key: KEY });
    await assert.rejects(s.setKey(randomBytes(32)), { code: 'exists' });
    assert.ok((await s.getKey()).equals(KEY));
  });

  for (const st of ['unavailable', 'locked']) {
    test(`${name}: ${st} throws that code on both calls`, async () => {
      const { s, calls } = make({ state: st, key: KEY });
      await assert.rejects(s.getKey(), { code: st });
      await assert.rejects(s.setKey(KEY), { code: st });
      assert.equal(calls().length, 2);
    });
  }

  test(`${name}: never-answers never settles`, async () => {
    const { s, calls } = make({ state: 'never-answers', key: KEY });
    assert.equal(await settles(s.getKey()), 'pending');
    assert.equal(await settles(s.setKey(KEY)), 'pending');
    assert.equal(calls().length, 2);
  });

  test(`${name}: each failSetKey mode fails only setKey, and every call is logged`, async () => {
    for (const mode of ['locked', 'never-answers', 'drop']) {
      const { s, calls } = make({ state: 'available', key: KEY, failSetKey: mode });
      assert.ok((await s.getKey()).equals(KEY));
      const other = randomBytes(32);
      if (mode === 'locked') await assert.rejects(s.setKey(other), { code: 'locked' });
      else if (mode === 'never-answers') assert.equal(await settles(s.setKey(other)), 'pending');
      else await s.setKey(other);
      assert.ok((await s.getKey()).equals(KEY), mode);
      assert.deepEqual(calls().map((c) => c.op), ['getKey', 'setKey', 'getKey'], mode);
    }
  });

  test(`${name}: setState switches the answer`, async () => {
    const { s, setState } = make({ state: 'locked' });
    await assert.rejects(s.getKey(), { code: 'locked' });
    setState('available');
    assert.equal(await s.getKey(), null);
  });
}

test('memory: peekKey and returned keys are copies', async () => {
  const s = createFakeOsStore({ key: KEY });
  const k = await s.getKey();
  k.fill(0);
  assert.ok(s.peekKey().equals(KEY));
});

test('file: the state file is 0600 and the call log never holds key bytes', async () => {
  const p = statePath();
  writeFakeState(p, { state: 'available' });
  const s = fileFakeOsStore(p);
  await s.setKey(KEY);
  await s.getKey();
  if (process.platform !== 'win32') assert.equal(statSync(p).mode & 0o777, 0o600);
  const log = readFileSync(`${p}.calls`, 'utf8');
  for (const enc of ['hex', 'base64', 'base64url']) assert.ok(!log.includes(KEY.toString(enc)));
  assert.deepEqual(log.trim().split('\n').map((l) => JSON.parse(l)), [{ op: 'setKey', pid: process.pid }, { op: 'getKey', pid: process.pid }]);
});

test('file: no .calls file reads as no calls; a missing state file is an empty available store', async () => {
  const p = statePath();
  assert.deepEqual(readFakeCalls(p), []);
  assert.equal(await fileFakeOsStore(p).getKey(), null);
  assert.equal(readFakeCalls(p).length, 1);
});

test('file: two items in one state file stay apart, and dropItem removes exactly one', async () => {
  const p = statePath();
  writeFakeState(p, { state: 'available' });
  const a = fileFakeOsStore(p, { item: { service: 'worca-cc', account: 'vault-key-aaaa' } });
  const b = fileFakeOsStore(p, { item: { service: 'worca-cc', account: 'vault-key-bbbb' } });
  const [ka, kb] = [randomBytes(32), randomBytes(32)];
  await a.setKey(ka);
  assert.equal(await b.getKey(), null);
  await b.setKey(kb);
  assert.ok((await a.getKey()).equals(ka));
  assert.ok((await b.getKey()).equals(kb));
  assert.deepEqual(fakeAccounts(p), ['vault-key-aaaa', 'vault-key-bbbb']);
  dropItem(p, { account: 'vault-key-aaaa' });
  assert.deepEqual(fakeAccounts(p), ['vault-key-bbbb']);
  assert.equal(await a.getKey(), null);
  assert.ok(peekKey(p, { account: 'vault-key-bbbb' }).equals(kb));
});

test('memory: a store bound to an item; the legacy key option sets that item', async () => {
  const s = createFakeOsStore({ item: { service: 'worca-cc', account: 'vault-key-cccc' }, key: KEY });
  assert.ok((await s.getKey()).equals(KEY));
  assert.ok(s.peekKey('vault-key-cccc').equals(KEY));
  assert.equal(s.peekKey('other'), null);
});

test('file: delayMs makes getKey answer no sooner than that, with one recorded getKey', async () => {
  const p = statePath();
  writeFakeState(p, { state: 'available', key: KEY, delayMs: 300 });
  const t0 = Date.now();
  const got = await fileFakeOsStore(p).getKey();
  assert.ok(Date.now() - t0 >= 295, `answered after ${Date.now() - t0} ms`);
  assert.ok(got.equals(KEY));
  assert.deepEqual(readFakeCalls(p).map((c) => c.op), ['getKey']);
  writeFakeState(p, { state: 'available' });
  assert.equal(JSON.parse(readFileSync(p, 'utf8')).delayMs, undefined, 'a state without delayMs is written as before');
});

test('file: each failProbe mode throws its code; only delete-failed leaves the probe item', async () => {
  const rows = [['set-locked', 'locked'], ['set-denied', 'unavailable'], ['wrong-value', 'probe-mismatch'], ['missing', 'probe-missing'],
    ['delete-failed', 'probe-delete']];
  for (const [failProbe, code] of rows) {
    const p = statePath();
    writeFakeState(p, { state: 'available', key: KEY, failProbe });
    const s = fileFakeOsStore(p, { probeItem: { service: 'worca-cc', account: 'vault-probe-x' } });
    await assert.rejects(s.probe(), { code }, failProbe);
    assert.deepEqual(fakeAccounts(p), failProbe === 'delete-failed' ? ['default', 'vault-probe-x'] : ['default'], failProbe);
    assert.ok(peekKey(p).equals(KEY), 'the key item is never touched');
  }
  const p = statePath();
  writeFakeState(p, { state: 'available', failProbe: 'timeout' });
  assert.equal(await settles(fileFakeOsStore(p).probe()), 'pending');
  const ok = statePath();
  writeFakeState(ok, { state: 'available' });
  await fileFakeOsStore(ok).probe();
  assert.deepEqual(fakeAccounts(ok), []);
  assert.deepEqual(readFakeCalls(ok).map((c) => c.op), ['probe']);
});

test('memory: probe round-trips on its own item; locked and unavailable states throw', async () => {
  const s = createFakeOsStore({ key: KEY });
  await s.probe();
  assert.equal(s.peekKey('default-probe'), null);
  s.setState('locked');
  await assert.rejects(s.probe(), { code: 'locked' });
  assert.deepEqual(s.calls.map((c) => c.op), ['probe', 'probe']);
});

test('file: keyReadBack returns the stored key before call n and one other key from call n on (default 2)', async () => {
  for (const [keyReadBack, n] of [[{}, 2], [{ differsFromCall: 3 }, 3]]) {
    const p = statePath();
    writeFakeState(p, { state: 'available', key: KEY, keyReadBack });
    const s = fileFakeOsStore(p);
    const got = [];
    for (let i = 1; i <= 4; i++) got.push(await s.getKey());
    got.forEach((k, i) => {
      if (i + 1 < n) assert.ok(k.equals(KEY), `call ${i + 1}`);
      else assert.ok(!k.equals(KEY) && k.equals(got[3]), `call ${i + 1}`);
    });
  }
});

test('deleteKey: removes the bound item and records { op: deleteKey }; false when absent; locked throws', async () => {
  for (const make of Object.values(backings)) {
    const b = make({ state: 'available', key: KEY });
    assert.equal(await b.s.deleteKey(), true);
    assert.equal(await b.s.getKey(), null);
    assert.equal(await b.s.deleteKey(), false);
    assert.deepEqual(b.calls().map((c) => c.op), ['deleteKey', 'getKey', 'deleteKey']);
    assert.ok(b.calls().every((c) => Object.keys(c).sort().join() === 'op,pid'));
    b.setState('locked');
    await assert.rejects(b.s.deleteKey(), { code: 'locked' });
  }
});

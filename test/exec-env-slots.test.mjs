// test/exec-env-slots.test.mjs
// The e2b capacity queue (src/core/exec-env/slots.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acquireSandboxSlot, _resetSlotsForTests } from '../src/core/exec-env/slots.mjs';
test('cap 1: the second acquire waits until the first releases; onWait fires once', async () => {
  _resetSlotsForTests();
  const r1 = await acquireSandboxSlot({ cap: 1 });
  let waited = 0; let got = false;
  const p = acquireSandboxSlot({ cap: 1, onWait: () => { waited += 1; }, pollMs: 10 }).then((r) => { got = true; return r; });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(got, false); assert.equal(waited, 1);
  r1(); const r2 = await p; assert.equal(got, true); r2();
});
test('a remote count at the cap also waits', async () => {
  _resetSlotsForTests();
  let n = 2; setTimeout(() => { n = 1; }, 30);
  let waited = 0;
  const r = await acquireSandboxSlot({ cap: 2, countRunning: async () => n, onWait: () => { waited += 1; }, pollMs: 10 });
  assert.equal(waited, 1); r();
});
test('abort while waiting rejects with AbortError and frees nothing', async () => {
  _resetSlotsForTests();
  const r1 = await acquireSandboxSlot({ cap: 1 });
  const ac = new AbortController();
  const p = acquireSandboxSlot({ cap: 1, signal: ac.signal, pollMs: 10 });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (e) => e.name === 'AbortError');
  r1();
  const r2 = await acquireSandboxSlot({ cap: 1 });   // the aborted waiter took no slot
  r2();
});
test('force acquires past the cap (a reconnecting run already holds its sandbox)', async () => {
  _resetSlotsForTests();
  const r1 = await acquireSandboxSlot({ cap: 1 });
  const r2 = await acquireSandboxSlot({ cap: 1, force: true, countRunning: async () => 99 });
  r2(); r2();                                          // release is idempotent
  r1();
  const r3 = await acquireSandboxSlot({ cap: 1, pollMs: 10 }); r3();
});

test('pools are counted apart: a full e2b pool does not hold a loopback run', async () => {
  _resetSlotsForTests();
  const a = await acquireSandboxSlot({ pool: 'e2b', cap: 1 });
  const b = await acquireSandboxSlot({ pool: 'loopback', cap: 1, pollMs: 10 });   // resolves at once
  let waited = false;
  const c = acquireSandboxSlot({ pool: 'e2b', cap: 1, pollMs: 10, onWait: () => { waited = true; } });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(waited, true);
  a(); (await c)(); b();
});

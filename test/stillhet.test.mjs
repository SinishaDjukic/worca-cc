import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillhetAskOpen, stillhetAnswerHook, STILLHET_ASK_ON, readOldStillhetFlag, readOldStillhetEnv } from '../src/core/stillhet.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFlags } from '../src/core/flags.mjs';
import { FLAGS } from '../src/shared/flags/registry.mjs';

test('stillhetAskOpen: only WORCA_STILLHET_ASK=1 opens the ask switch', () => {
  assert.equal(STILLHET_ASK_ON, false, 'the owner, 2026-11-12: no question until the last slice of feature 3');
  assert.equal(stillhetAskOpen({}), false);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: '1' }), true);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: 'true' }), false);
  assert.equal(stillhetAskOpen({ WORCA_STILLHET_ASK: '0' }), false);
});

test('stillhetAnswerHook: stores the answer only for stillhet: true', async () => {
  const calls = [];
  const hook = stillhetAnswerHook(async (p) => { calls.push(p); });
  await hook({ stillhet: false }); await hook({ stillhet: null }); await hook({ flagsDemo: true });
  assert.equal(calls.length, 0);
  await hook({ stillhet: true });
  assert.deepEqual(calls, [{ stillhetAsked: true }]);
});

test('stillhetAnswerHook: a throwing setPrefs rejects, a catching caller is unaffected', async () => {
  const hook = stillhetAnswerHook(async () => { throw new Error('disk'); });
  await assert.rejects(() => hook({ stillhet: true }), /disk/);
});

function svc(afterSet, order) {
  let stored = {};
  return createFlags({
    registry: FLAGS, env: () => '', read: () => stored,
    write: async (m) => { order.push('write'); stored = m; }, afterSet, warn: () => {},
  });
}

test('afterSet runs once after write and before changed; not for {} or refused patches', async () => {
  const order = [];
  const f = svc(async (p) => { order.push('after:' + JSON.stringify(p)); }, order);
  f.events.on('changed', () => order.push('changed'));
  await f.set({});
  assert.deepEqual(order, []);
  await assert.rejects(() => f.set({ nope: true }));
  assert.deepEqual(order, []);
  await f.set({ stillhet: true });
  assert.deepEqual(order, ['write', 'after:{"stillhet":true}', 'changed']);
});

test('a throwing afterSet still stores the flag, warns once and resolves', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const f = svc(async () => { throw new Error('boom'); }, []);
  const out = await f.set({ stillhet: true });
  assert.equal(out.find((x) => x.key === 'stillhet').on, true);
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0].arguments[0]), /^\[worca\] Stillhet answer not stored: boom/);
});

test('revert safety: a registry without stillhet tolerates a stored stillhet', () => {
  const f = createFlags({ registry: FLAGS.filter((x) => x.key !== 'stillhet'), env: () => '', read: () => ({ stillhet: true }), warn: () => {} });
  assert.ok(Array.isArray(f.list()));
});

// The flag was stored as `rail` before the rename. Settings written then must keep working.
test('the old flag key: a stored rail reads as stillhet, the new key wins, other flags are untouched', () => {
  assert.deepEqual(readOldStillhetFlag({ rail: true, flagsDemo: true }), { flagsDemo: true, stillhet: true });
  assert.deepEqual(readOldStillhetFlag({ rail: false }), { stillhet: false });
  assert.deepEqual(readOldStillhetFlag({ rail: true, stillhet: false }), { stillhet: false });
  const same = { stillhet: true };
  assert.equal(readOldStillhetFlag(same), same);
  assert.deepEqual(readOldStillhetFlag({}), {});
});

test('the old flag key in WORCA_FLAGS: rail and -rail lock stillhet; other tokens pass through', () => {
  assert.equal(readOldStillhetEnv('rail'), 'stillhet');
  assert.equal(readOldStillhetEnv('flagsDemo,-rail'), 'flagsDemo,-stillhet');
  assert.equal(readOldStillhetEnv('guardrail,railX'), 'guardrail,railX');
  assert.equal(readOldStillhetEnv(undefined), '');
  const f = createFlags({ env: () => readOldStillhetEnv('rail'), read: () => ({}), warn: () => {} });
  assert.deepEqual([f.enabled('stillhet'), f.list().find((x) => x.key === 'stillhet').locked], [true, true]);
});

test('the old flag key, end to end: a settings.json with flags.rail turns Stillhet on, and the next write stores flags.stillhet only', () => {
  const home = mkdtempSync(join(tmpdir(), 'stillhet-old-flag-'));
  try {
    mkdirSync(join(home, '.worca-cc'), { recursive: true });
    const file = join(home, '.worca-cc', 'settings.json');
    writeFileSync(file, JSON.stringify({ flags: { rail: true, flagsDemo: true }, theme: 'dark' }));
    const code = `
      const { flagEnabled, setFlags, listFlags } = await import('./src/core/flags.mjs');
      const before = flagEnabled('stillhet');
      await setFlags({ flagsDemo: null });
      console.log(JSON.stringify({ before, after: flagEnabled('stillhet'), locked: listFlags().find((f) => f.key === 'stillhet').locked }));`;
    const env = { ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: join(home, '.worca-cc'), WORCA_FLAGS: '', WORCA_TEST_ALLOW_HOME_FALLBACK: '1' };
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()), { before: true, after: true, locked: false });
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    assert.deepEqual(stored.flags, { stillhet: true }, 'the write kept Stillhet on under the new key and dropped the old one');
    assert.equal(stored.theme, 'dark');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

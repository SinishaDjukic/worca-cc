import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireLock } from '../src/core/metrics/lock.mjs';

const CHILD = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/team-metrics/lock-child.mjs');
const dir = mkdtempSync(join(tmpdir(), 'worca-lock-'));
after(() => rmSync(dir, { recursive: true, force: true }));

// The holder's heartbeat is a plain writeFile — truncate, then write — so a read can land on an
// empty file mid-beat (CI: "Unexpected end of JSON input"). lock.mjs's inspect() tolerates exactly
// that by judging an unparsable file by mtime; a test reading the raw file has to tolerate it too.
async function readLock(file) {
  for (let i = 0; ; i++) {
    try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
      if (i >= 20) throw e;
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

function runChild(lock, log, tag) {
  return new Promise((res, rej) => {
    const c = spawn(process.execPath, [CHILD, lock, log, tag], { stdio: ['ignore', 'ignore', 'inherit'] });
    c.on('exit', (code) => (code === 0 ? res() : rej(new Error(`child ${tag} exited ${code}`))));
  });
}

test('lock file serializes critical sections across two processes', async () => {
  const lock = join(dir, '.lock');
  const log = join(dir, 'log.txt');
  writeFileSync(log, '');
  await Promise.all([runChild(lock, log, 'A'), runChild(lock, log, 'B')]);
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, 8); // 4 enter/exit pairs
  for (let i = 0; i < lines.length; i += 2) {
    const [e, tagE] = lines[i].split(' ');
    const [x, tagX] = lines[i + 1].split(' ');
    assert.equal(e, 'enter'); assert.equal(x, 'exit'); assert.equal(tagE, tagX, `interleaved: ${lines.join(' | ')}`);
  }
});

test('a lock left by a dead pid is taken over', async () => {
  const lock = join(dir, 'stale.lock');
  writeFileSync(lock, JSON.stringify({ pid: 999999, at: new Date().toISOString() }));
  const release = await acquireLock(lock, { timeoutMs: 2000 });
  await release();
});

test('a live foreign lock times out with LOCK_TIMEOUT', async () => {
  const lock = join(dir, 'busy.lock');
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, token: 'x', at: new Date().toISOString() }));
  await assert.rejects(acquireLock(lock, { timeoutMs: 150 }), { code: 'LOCK_TIMEOUT' });
});

test('the holder heartbeats, so a long critical section is not judged stale', async () => {
  const lock = join(dir, 'beat.lock');
  const release = await acquireLock(lock, { heartbeatMs: 20 });
  const first = (await readLock(lock)).at;
  await new Promise((r) => setTimeout(r, 120));
  assert.notEqual((await readLock(lock)).at, first);
  // staleMs must stay several heartbeats wide: at staleMs:60 with heartbeatMs:20 a single missed
  // tick under load flips this from LOCK_TIMEOUT to a successful acquire, i.e. a red test.
  await assert.rejects(acquireLock(lock, { staleMs: 250, timeoutMs: 150 }), { code: 'LOCK_TIMEOUT' });
  await release();
});

test('release never deletes a lock that now belongs to someone else', async () => {
  const lock = join(dir, 'owned.lock');
  const release = await acquireLock(lock);
  writeFileSync(lock, JSON.stringify({ pid: process.ppid, token: 'other', at: new Date().toISOString() })); // simulated takeover
  await release();
  assert.equal(JSON.parse(readFileSync(lock, 'utf8')).token, 'other');
});

test('a heartbeat in flight during release never resurrects the lock', async () => {
  for (let i = 0; i < 200; i++) {
    const lock = join(dir, `race-${i}.lock`);
    const release = await acquireLock(lock, { heartbeatMs: 1 });
    await new Promise((r) => setTimeout(r, i % 3));
    await release();
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(existsSync(lock), false, `lock ${i} came back after release`);
  }
});

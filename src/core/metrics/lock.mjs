// src/core/metrics/lock.mjs
// Cross-process advisory lock: O_EXCL create of a lock file holding {pid, token, at}. The CLI
// and the UI server may both finish runs and flush the same slug (§4.5).
// - The holder HEARTBEATS `at` while it holds the lock, so a long flush (5 × fetch+push) is
//   never mistaken for a stale lock, and a reused pid cannot pin a dead lock forever.
// - Stale = holder pid is dead, or the heartbeat is older than `staleMs`.
// - Breaking a stale lock goes through a `.break` mutex and re-checks the observed content,
//   so two waiters can never both delete-and-recreate (the second would delete a live lock).
// - Release removes the file only if it still carries our token.
//
// Two honest limits (decision 29):
// (a) `acquireLock` does `mkdir(dirname(file), { recursive: true })` unconditionally, and a
//     caller may take this lock before any record exists in the directory it creates — so an
//     enabled project can end up with an empty outbox directory. This is deliberate; do not
//     "fix" it by skipping the mkdir or deferring it.
// (b) `breakStale`'s content re-check is NOT atomic: between reading the observed content and
//     `rm`ing the file, a live holder can heartbeat and have its lock deleted out from under it.
//     The `.break` mutex only removes breaker-vs-breaker races, not holder-vs-breaker; the
//     window is sub-millisecond and only reachable after `staleMs` (2 min) of apparent silence
//     from a live process. Do not attempt to close this window.
import { open, readFile, writeFile, rm, stat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const LOCK_STALE_MS = 2 * 60_000;
export const LOCK_HEARTBEAT_MS = 20_000;
const BREAK_STALE_MS = 30_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** @returns {Promise<{stale:boolean, raw:string|null}>} */
async function inspect(file, staleMs) {
  let raw;
  try { raw = await readFile(file, 'utf8'); } catch { return { stale: false, raw: null } }
  try {
    const { pid, at } = JSON.parse(raw);
    if (Number.isInteger(pid) && pid !== process.pid && !pidAlive(pid)) return { stale: true, raw };
    return { stale: Date.now() - Date.parse(at) > staleMs, raw };
  } catch {
    // Unparsable: possibly mid-write by its creator — judge by mtime only.
    try { return { stale: Date.now() - (await stat(file)).mtimeMs > staleMs, raw }; } catch { return { stale: false, raw } }
  }
}

/** @returns {Promise<boolean>} true when this caller did the break (retry at once), false when someone else holds `.break` (poll). */
async function breakStale(file, observed) {
  const brk = `${file}.break`;
  let fh;
  try { fh = await open(brk, 'wx'); } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const st = await stat(brk).catch(() => null);
    if (st && Date.now() - st.mtimeMs > BREAK_STALE_MS) await rm(brk, { force: true });
    return false; // someone else is breaking it; the caller sleeps and polls again
  }
  try {
    if ((await readFile(file, 'utf8').catch(() => null)) === observed) await rm(file, { force: true });
  } finally {
    await fh.close();
    await rm(brk, { force: true });
  }
  return true;
}

/** @returns {Promise<() => Promise<void>>} release function (idempotent) */
export async function acquireLock(file, { staleMs = LOCK_STALE_MS, heartbeatMs = LOCK_HEARTBEAT_MS, timeoutMs = 120_000, pollMs = 50 } = {}) {
  await mkdir(dirname(file), { recursive: true });
  const deadline = Date.now() + timeoutMs;
  const token = randomBytes(8).toString('hex');
  const body = () => JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() });
  for (;;) {
    try {
      const fh = await open(file, 'wx');
      await fh.writeFile(body());
      await fh.close();
      const ours = async () => {
        try { return JSON.parse(await readFile(file, 'utf8')).token === token; } catch { return false; }
      };
      let released = false;
      let beating = null;
      // One heartbeat at a time, and release() awaits the in-flight one: otherwise a write that
      // finishes after release()'s rm recreates the lock with a live pid and pins the slug for
      // LOCK_STALE_MS (reproduced 11/400 with heartbeatMs:1).
      const beat = setInterval(() => {
        if (released || beating) return;
        beating = ours()
          .then((y) => (y && !released ? writeFile(file, body()) : null))
          .catch(() => {})
          .finally(() => { beating = null; });
      }, heartbeatMs);
      beat.unref?.();
      return async () => {
        if (released) return;
        released = true;
        clearInterval(beat);
        if (beating) await beating;
        if (await ours()) await rm(file, { force: true });
      };
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const { stale, raw } = await inspect(file, staleMs);
      if (stale && raw != null && await breakStale(file, raw)) continue;
      if (Date.now() > deadline) {
        throw Object.assign(new Error(`team metrics lock is busy: ${file}`), { code: 'LOCK_TIMEOUT' });
      }
      await sleep(pollMs + Math.floor(Math.random() * pollMs));
    }
  }
}

export async function withLock(file, fn, opts) {
  const release = await acquireLock(file, opts);
  try { return await fn(); } finally { await release(); }
}

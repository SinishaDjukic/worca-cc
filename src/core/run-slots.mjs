// src/core/run-slots.mjs
// The run queue (Settings › Runs › Machine load, runLimits.maxConcurrentRuns): a counting semaphore of
// files under <worcaHome>/run-slots, one per running run, so the UI server, the CLI and a second server
// on the same home share one limit. A file names its process; a file whose process is gone is free (a
// crash or kill -9 never leaks a slot past its process). Two runs that claim the last slot at once both
// write, then the later one (by claim time, then id) backs off and waits again.

import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { worcaHome } from './projects.mjs';
import { processAlive } from './ui-instance.mjs';

const slotDir = () => join(worcaHome(), 'run-slots');
const POLL_MS = 2000;

/** The live slots, oldest claim first. Removes the files of dead processes. */
export function liveRunSlots() {
  let names;
  try { names = readdirSync(slotDir()).filter((n) => n.endsWith('.json')); } catch { return []; }
  const live = [];
  for (const n of names) {
    const file = join(slotDir(), n);
    let s;
    try { s = JSON.parse(readFileSync(file, 'utf8')); } catch { continue; }   // mid-write: counted next poll
    if (!processAlive(s?.pid)) { try { unlinkSync(file); } catch { /* another process cleared it */ } continue; }
    live.push(s);
  }
  return live.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

const sleep = (ms, signal) => new Promise((resolve) => {
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); signal?.removeEventListener('abort', done); resolve(); }
  signal?.addEventListener('abort', done, { once: true });
});

/**
 * Wait for a free run slot, then hold it until release().
 * @param {{ id:string, max:number, signal?:AbortSignal, check?:() => void, onWait?:(inUse:number) => void, pollMs?:number }} o
 *   check runs before every attempt and may throw (the harness's stop/pause checks); onWait runs on every
 *   attempt that found no slot.
 * @returns {Promise<{ release: () => void, waited: boolean }>}
 */
export async function acquireRunSlot({ id, max, signal, check, onWait, pollMs = POLL_MS }) {
  const file = join(slotDir(), `${id}.json`);
  const release = () => { try { unlinkSync(file); } catch { /* already gone */ } };
  let waited = false;
  for (;;) {
    check?.();
    const others = liveRunSlots().filter((s) => s.id !== id);
    if (others.length < max) {
      mkdirSync(slotDir(), { recursive: true });
      writeFileSync(file, JSON.stringify({ id, pid: process.pid, at: Date.now() }));
      if (liveRunSlots().findIndex((s) => s.id === id) < max) return { release, waited };
      release();   // lost the race for the last slot
    }
    waited = true;
    onWait?.(others.length);
    await sleep(pollMs, signal);
  }
}

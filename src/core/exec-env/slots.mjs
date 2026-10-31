// src/core/exec-env/slots.mjs
// The capacity gate per backend (pool = backend name; clarify: capacity-full): a run QUEUES until a
// slot frees. In-process count (no race inside one server) + the provider's running count (CLI runs,
// other instances, foreign sandboxes). Two processes can still both see cap-1 and both start —
// accepted and documented (plans/e2b-execution-design.md §9).
const inUse = new Map();   // pool -> count
const waiters = new Map(); // pool -> runs queued for a slot (the status chip's "N waiting")
const wakers = new Set();
export function _resetSlotsForTests() { inUse.clear(); waiters.clear(); wakers.clear(); }
const wake = () => { for (const w of [...wakers]) w(); };
const used = (pool) => inUse.get(pool) || 0;
/** Runs of this server waiting for a slot of `pool` right now. */
export const slotWaiters = (pool) => waiters.get(pool) || 0;

function waitTurn(signal, pollMs) {
  return new Promise((resolveP, rejectP) => {
    const done = () => { clearTimeout(t); wakers.delete(done); signal?.removeEventListener?.('abort', onAbort); resolveP(); };
    const onAbort = () => { clearTimeout(t); wakers.delete(done); const e = new Error('aborted'); e.name = 'AbortError'; rejectP(e); };
    const t = setTimeout(done, pollMs);
    wakers.add(done);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

/** Resolves to a release() once a slot of `pool` is free. onWait({inUse, cap}) fires on the first wait only. */
export async function acquireSandboxSlot({ pool = 'e2b', cap, signal = null, onWait = () => {}, countRunning = null, pollMs = 15_000, force = false } = {}) {
  let told = false;
  try {
    while (!force) {
      const mine = used(pool);
      const remote = mine < cap && countRunning ? await countRunning().catch(() => 0) : 0;
      if (mine < cap && remote < cap) break;
      if (!told) { told = true; waiters.set(pool, slotWaiters(pool) + 1); onWait({ inUse: Math.max(mine, remote), cap }); }
      await waitTurn(signal, pollMs);
    }
  } finally {
    if (told) waiters.set(pool, Math.max(0, slotWaiters(pool) - 1));
  }
  inUse.set(pool, used(pool) + 1);
  let released = false;
  return () => { if (released) return; released = true; inUse.set(pool, Math.max(0, used(pool) - 1)); wake(); };
}

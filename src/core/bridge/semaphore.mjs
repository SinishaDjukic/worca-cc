// src/core/bridge/semaphore.mjs
// Per-key counting semaphore for the bridge's upstream concurrency cap
// (model-bridge-design.md §7.4). A request over the cap WAITS in FIFO order;
// it never fails. The cap is read per acquire so a settings edit applies to
// the next request without a restart.

export class KeyedSemaphore {
  constructor() { this.slots = new Map(); }

  _slot(key) {
    let s = this.slots.get(key);
    if (!s) { s = { active: 0, queue: [] }; this.slots.set(key, s); }
    return s;
  }

  /** Number of requests waiting for `key` right now. */
  queued(key) { return this._slot(key).queue.length; }
  /** Number of requests in flight for `key` right now. */
  active(key) { return this._slot(key).active; }

  /**
   * Acquire one slot under `key` with `limit` concurrent holders. Resolves to
   * a release function. `signal` aborts the wait (rejects with AbortError).
   * @param {string} key
   * @param {number} limit
   * @param {{signal?:AbortSignal}} [opts]
   * @returns {Promise<() => void>}
   */
  acquire(key, limit, { signal } = {}) {
    const s = this._slot(key);
    const max = Number.isInteger(limit) && limit > 0 ? limit : 1;
    return new Promise((resolve, reject) => {
      const grant = () => {
        s.active += 1;
        let released = false;
        resolve(() => {
          if (released) return;
          released = true;
          s.active -= 1;
          this._drain(key);
        });
      };
      if (s.active < max) { grant(); return; }
      if (signal && signal.aborted) { reject(abortError()); return; }
      const entry = { limit: max, grant: null };
      const onAbort = () => {
        const i = s.queue.indexOf(entry);
        if (i !== -1) s.queue.splice(i, 1);
        reject(abortError());
      };
      entry.grant = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
        grant();
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      s.queue.push(entry);
    });
  }

  _drain(key) {
    const s = this._slot(key);
    while (s.queue.length && s.active < s.queue[0].limit) {
      const next = s.queue.shift();
      next.grant();
    }
  }
}

function abortError() {
  const e = new Error('aborted while waiting for an upstream slot');
  e.name = 'AbortError';
  return e;
}

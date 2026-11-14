// src/core/design/semaphore.mjs
// The FIFO slot queue of a Design build (P2, L2.5): `n` holders at once, waiters served in arrival order. A waiter
// whose signal aborts leaves the queue and rejects with an AbortError. `resize` changes `n` for what comes next: up
// wakes waiters at once; down touches no holder, so the next `acquire` waits until the holders are below the new size
// (M7: Build fast never kills a running agent).

const size = (n) => (Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1);

function abortError() {
  const e = new Error('aborted while waiting for a build slot');
  e.name = 'AbortError';
  return e;
}

/**
 * @param {number} n holders at once, at least 1
 * @returns {{ acquire: (opts?: { signal?: AbortSignal }) => Promise<void>, release: () => void, resize: (n: number) => void }}
 */
export function createSemaphore(n) {
  let limit = size(n);
  let held = 0;
  /** Waiters in arrival order: { grant, signal, onAbort } */
  const queue = [];

  function pump() {
    while (queue.length && held < limit) {
      const w = queue.shift();
      if (w.signal) w.signal.removeEventListener('abort', w.onAbort);
      held += 1;
      w.grant();
    }
  }

  return {
    acquire({ signal } = {}) {
      if (signal?.aborted) return Promise.reject(abortError());
      if (!queue.length && held < limit) { held += 1; return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const w = { grant: resolve, signal, onAbort: null };
        if (signal) {
          w.onAbort = () => {
            const i = queue.indexOf(w);
            if (i !== -1) queue.splice(i, 1);
            reject(abortError());
          };
          signal.addEventListener('abort', w.onAbort, { once: true });
        }
        queue.push(w);
      });
    },
    release() {
      if (held > 0) held -= 1;
      pump();
    },
    resize(next) {
      limit = size(next);
      pump();
    },
  };
}

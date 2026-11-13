// src/core/executor/backends/in-process.mjs
// A backend for tests: "starts a worker" by running the worker client in THIS process, over a
// real socket to the registry's listener, so the whole path — token, hello, exec frames,
// backpressure, signals, shutdown — runs without a container. The execs are real children of
// the test process.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startWorker } from '../../../worker/client.mjs';
import { workerHomeDir } from '../index.mjs';
import { probeCapabilities } from '../../../worker/capabilities.mjs';

/** `probe`: look for the engines on this machine, as a worker container does (the server's own in-process mode);
 *  without it — a test's backend — the worker reports none it was not handed in `capabilities`. */
export function createInProcessBackend({ homeRoot, capabilities = null, probe = false, log = () => {}, beforeStart = null } = {}) {
  const workers = new Map();   // workerId -> handle
  let probed = null;           // one probe for every worker: they all run in this process
  const started = [];
  return {
    kind: 'in-process',
    started,
    get live() { return [...workers.values()]; },
    async start({ scope, scopeKey, workerId, token, controllerUrl, idleMs, engine = null, signal = null }) {
      if (beforeStart) await beforeStart({ scope, scopeKey, workerId, engine, signal });
      const home = workerHomeDir(scope, homeRoot);
      mkdirSync(home, { recursive: true });
      const caps = capabilities ?? await (probed ||= probeCapabilities(probe ? {} : { engines: [] }));
      const w = startWorker({ url: controllerUrl, token, scope, workerId, home, capabilities: caps, idleMs, log });
      const handle = { workerId, scopeKey, engine, home, worker: w, done: w.done, own: true };   // cannot outlive this process: never an orphan
      workers.set(workerId, handle);
      started.push(handle);
      w.done.then(() => workers.delete(workerId));
      return handle;
    },
    async remove(handle, { reason } = {}) {
      if (!handle) return;
      workers.delete(handle.workerId);
      handle.worker.close(reason || 'removed');
      await handle.done;
    },
    async listWorkers() { return [...workers.values()]; },
    describe() { return { kind: 'in-process', live: workers.size }; },
  };
}

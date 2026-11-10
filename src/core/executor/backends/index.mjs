// src/core/executor/backends/index.mjs
// The backend for an executor kind: what starts and removes worker containers.
//   docker       the controller talks to the Docker Engine (its own container's mounts are the
//                template for every worker)                           — docker.mjs
//   kubernetes   the controller creates a Pod per worker from a template — kubernetes.mjs
// WORCA_EXECUTOR_BACKEND=in-process swaps in the test backend for any kind: the worker runs
// inside the server process over a real socket, with no container at all. For trying the
// controller/worker path on one machine, and for the server's own tests.
import { createInProcessBackend } from './in-process.mjs';

/** `bootId`: the controller's boot id, which the registry also carries, so a worker container's label names
 *  the controller process that started it. */
export async function createBackend(kind, { env = process.env, log = () => {}, homeRoot, bootId } = {}) {
  const override = String(env.WORCA_EXECUTOR_BACKEND || '').trim().toLowerCase();
  if (override === 'in-process') return createInProcessBackend({ homeRoot, log, probe: true });
  if (override) throw new Error(`WORCA_EXECUTOR_BACKEND=${override} is not a backend (in-process is the only override)`);
  if (kind === 'docker') {
    const mod = await import('./docker.mjs').catch((err) => { throw new Error(`the docker executor backend could not be loaded: ${err?.message || err}`, { cause: err }); });
    return mod.createDockerBackend({ env, log, ...(bootId ? { bootId } : {}) });
  }
  if (kind === 'kubernetes') {
    const mod = await import('./kubernetes.mjs').catch((err) => { throw new Error(`the kubernetes executor backend could not be loaded: ${err?.message || err}`, { cause: err }); });
    return mod.createKubernetesBackend({ env, log, ...(bootId ? { bootId } : {}) });
  }
  throw new Error(`no backend for executor kind ${kind}`);
}

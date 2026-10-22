// src/core/exec-env/e2b-env.mjs
// The e2b backend's RemoteExecEnv, built from an SDK + connection (tests, test/e2b-live.test.mjs).
// The harness builds RemoteExecEnv through the registry instead.
import { RemoteExecEnv, SCRIPT_SUPPORT_FILES } from './remote-env.mjs';
import { e2bBackend, e2bClient } from './backends/e2b.mjs';

export { SCRIPT_SUPPORT_FILES };
export const WORK = e2bBackend.workDir;
export class E2bExecEnv extends RemoteExecEnv {
  constructor({ sdk, conn, ...opts }) {
    super({ ...opts, backend: e2bBackend, client: e2bClient(sdk, conn), environment: conn.template });
    this.sdk = sdk; this.conn = conn;
  }
}

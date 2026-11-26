// test/helpers/egress-sidecar.mjs — an egress sidecar (`worca egress`, src/egress/main.mjs) on loopback for the
// tests, in front of the fake corporate proxy (test/helpers/fake-upstream-proxy.mjs). No Docker.
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSidecarConfig, startEgressSidecar } from '../../src/egress/main.mjs';
import { callSidecar } from '../../src/core/egress-sidecar-client.mjs';

export const SECRET = 'e'.repeat(48);

/** A TCP origin that answers every chunk with `echo:<chunk>`. */
export function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port, close: () => new Promise((r) => s.close(() => r())) }));
  });
}

/**
 * Start a sidecar. `env`: extra sidecar env (HTTPS_PROXY = the corporate proxy, WORCA_EGRESS_LOGIN_FILE, ...).
 * Resolves {api(method, path, body), proxyPort, dataDir, logs, side, close}.
 */
export async function startSidecar(env = {}, { dataDir = mkdtempSync(join(tmpdir(), 'worca-egress-')), pollMs = 50 } = {}) {
  const full = { WORCA_EGRESS_SECRET: SECRET, WORCA_EGRESS_DATA_DIR: dataDir, WORCA_EGRESS_PORT: '0', WORCA_EGRESS_API_PORT: '0',
    WORCA_EGRESS_HOST: '127.0.0.1', ...env };
  const { config, errors } = readSidecarConfig(full);
  if (errors.length) throw new Error(errors.join('; '));
  const logs = [];
  const side = await startEgressSidecar({ config, env: full, log: (l) => logs.push(l), pollMs });
  const cfg = side.ports.api ? { url: `http://127.0.0.1:${side.ports.api}`, secret: SECRET } : null;
  return {
    side, logs, dataDir, proxyPort: side.ports.proxy, apiPort: side.ports.api, cfg,
    api: (method, path, body) => callSidecar(cfg, method, path, body),
    close: async () => { await side.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

/** CONNECT through the sidecar and send `ping`; resolves everything read (a refusal ends when the socket closes). */
export function connectVia(port, target, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let out = ''; let sent = false;
    s.on('data', (d) => {
      out += d;
      if (!/^HTTP\/1\.1 200/.test(out)) return;
      if (!sent && out.includes('\r\n\r\n')) { sent = true; s.write('ping'); }
      if (out.includes('echo:ping')) { s.destroy(); resolve(out); }
    });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
    setTimeout(() => { s.destroy(); resolve(out); }, timeoutMs).unref();
  });
}

/** Poll until `cond()` holds; throws after `ms`. */
export async function until(cond, ms = 3000, step = 20) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, step));
  }
}

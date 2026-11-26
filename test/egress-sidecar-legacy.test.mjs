// test/egress-sidecar-legacy.test.mjs — what the hardened setup could do behind a corporate proxy that needs
// a login BEFORE the sidecar learned the handshake (#1619, "To verify"), and what the old single-file entry
// still does today: it is a plain relay. Real sockets, no Docker: the "corporate network" is a fake NTLM
// proxy that tunnels every accepted CONNECT to a local origin, and a host that only the proxy can reach
// (`*.acme.invalid` never resolves, as a public name does not resolve inside a closed corporate LAN).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { useEnvProxy } from '../src/core/env-proxy.mjs';
import { startFakeUpstream } from './helpers/fake-upstream-proxy.mjs';

const ENTRY = fileURLToPath(new URL('../src/core/egress-proxy.mjs', import.meta.url));

function echoOrigin() {
  return new Promise((resolve) => {
    const s = net.createServer((c) => { c.on('error', () => {}); c.on('data', (d) => c.write(`echo:${d}`)); });
    s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }));
  });
}

async function freePort() {
  const s = net.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

/** The old sidecar exactly as compose.egress.yml starts it: the one file, its own process. */
async function startLegacySidecar(env) {
  const port = await freePort();
  const child = spawn(process.execPath, [ENTRY], { env: { PATH: process.env.PATH, WORCA_EGRESS_PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`the sidecar did not start: ${out}`)), 10_000);
    child.stdout.on('data', (d) => { out += d; if (out.includes('listening')) { clearTimeout(t); resolve(); } });
    child.on('exit', (code) => { clearTimeout(t); reject(new Error(`the sidecar exited ${code}: ${out}`)); });
  });
  return { port, out: () => out, close: () => new Promise((r) => { child.once('exit', r); child.kill('SIGTERM'); }) };
}

function connectVia(port, target) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1', () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let out = '';
    s.on('data', (d) => {
      out += d;
      if (/^HTTP\/1\.1 200/.test(out) && out.includes('\r\n\r\n') && !out.includes('echo:')) s.write('ping');
      if (out.includes('echo:ping')) { s.destroy(); resolve(out); }
    });
    s.on('close', () => resolve(out));
    s.on('error', () => resolve(out));
    setTimeout(() => { s.destroy(); resolve(out); }, 8000).unref();
  });
}

test('finding: the plain relay sidecar never contacts the corporate proxy, so nothing gets out behind a login proxy', { timeout: 30_000 }, async () => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ originPort: origin.port });
  // compose.egress.yml + a corporate proxy that needs a login: the login is all the sidecar could be given.
  const side = await startLegacySidecar({ WORCA_EGRESS_ALLOW: '.acme.invalid', HTTPS_PROXY: fake.url('Domain%5CUser:Password@') });
  try {
    const got = await connectVia(side.port, 'origin.acme.invalid:443');
    assert.match(got, /^HTTP\/1\.1 50[24]/, got);   // it dials the host itself, which does not resolve
    assert.equal(fake.stats.sockets, 0, 'the old sidecar has no upstream: it never reaches the corporate proxy');
  } finally {
    await side.close();
    await fake.close();
    origin.server.close();
  }
});

test('finding: fetch() (the broker\'s model calls) cannot log in to an NTLM proxy from a proxy URL', { timeout: 30_000 }, async () => {
  const origin = await echoOrigin();
  const fake = await startFakeUpstream({ originPort: origin.port });
  // The broker would need HTTPS_PROXY with the login in it; undici offers Basic only, which an NTLM proxy refuses.
  const proxyUrl = fake.url('Domain%5CUser:Password@');
  const ep = useEnvProxy({ env: { HTTPS_PROXY: proxyUrl, HTTP_PROXY: proxyUrl }, api: {} });
  try {
    assert.equal(ep.status, 'on');
    await assert.rejects(fetch('https://models.acme.invalid/v1/models', { signal: AbortSignal.timeout(8000) }));
    assert.equal(fake.stats.type3, 0, 'no NTLM login was ever sent');
    assert.ok(fake.stats.heads.some((h) => h.line.startsWith('CONNECT models.acme.invalid:443')));
  } finally {
    ep.restore();
    await fake.close();
    origin.server.close();
  }
});

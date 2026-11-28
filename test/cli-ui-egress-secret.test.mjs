// test/cli-ui-egress-secret.test.mjs
// `worca ui` seals the egress sidecar's shared secret out of its own environment (main()), then starts
// ui/server.mjs. Found in a real hardened box on Docker Desktop: the server never got the secret, so every call it
// makes to the sidecar (Settings › Network proxy, the move of an old in-box login) failed with "WORCA_EGRESS_SECRET
// (or WORCA_EGRESS_SECRET_FILE) is required". The CLI must hand the sealed secret to the server, and only to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { sealEgressSecret, egressSecretChildEnv, _resetSealedEgressSecret } from '../src/core/egress-sidecar-client.mjs';

const CLI = fileURLToPath(new URL('../src/cli/worca-cc.mjs', import.meta.url));
const SECRET = 'e'.repeat(40);

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
    s.on('error', rej);
  });
}

test('egressSecretChildEnv hands back the sealed value, or the file it came from, and nothing when none was sealed', () => {
  try {
    _resetSealedEgressSecret();
    assert.deepEqual(egressSecretChildEnv(), {});
    const env = { WORCA_EGRESS_SECRET: SECRET };
    sealEgressSecret({ env });
    assert.deepEqual(env, {}, 'sealed out of the environment');
    assert.deepEqual(egressSecretChildEnv(), { WORCA_EGRESS_SECRET: SECRET });
    const fileEnv = { WORCA_EGRESS_SECRET_FILE: '/run/secrets/worca_egress_secret' };
    sealEgressSecret({ env: fileEnv, readFile: () => `${SECRET}\n` });
    assert.deepEqual(egressSecretChildEnv(), { WORCA_EGRESS_SECRET_FILE: '/run/secrets/worca_egress_secret' }, 'the file, which the server reads and checks');
  } finally { _resetSealedEgressSecret(); }
});

test('the server `worca ui` starts can use the egress sidecar secret', { skip: process.platform === 'win32', timeout: 60000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'worca-cc-uiegress-'));
  await writeFile(join(home, '.keep'), '');
  const port = await freePort();
  // An API URL nothing answers: the server's error then says "cannot be reached", never "is required".
  const child = spawn(process.execPath, [CLI, 'ui', '--port', String(port), '--mock'], {
    env: { ...process.env, HOME: home, USERPROFILE: home, WORCA_HOME: home, WORCA_EGRESS_API_URL: 'http://127.0.0.1:1', WORCA_EGRESS_SECRET: SECRET },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  try {
    let body = null;
    for (let i = 0; i < 100 && !body; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}/api/proxy/status`); if (r.status === 200) body = await r.json(); } catch { /* not up yet */ }
      if (!body) await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(body, `the UI never answered:\n${log}`);
    assert.equal(body.sidecar, true, JSON.stringify(body));
    assert.doesNotMatch(JSON.stringify(body), /is required with WORCA_EGRESS_API_URL/, JSON.stringify(body));
    assert.doesNotMatch(log, /is required with WORCA_EGRESS_API_URL/, log);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((r) => child.once('exit', r));
      child.kill('SIGTERM');   // forwarded to the server (cli-ui-signal.test.mjs), so it does not outlive the test
      const t = setTimeout(() => child.kill('SIGKILL'), 15000);
      await exited; clearTimeout(t);
    }
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

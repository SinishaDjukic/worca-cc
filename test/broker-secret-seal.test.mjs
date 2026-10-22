// test/broker-secret-seal.test.mjs
// The credential broker's shared secret (WORCA_BROKER_SECRET) never stays where an agent can
// reach it (docs/credential-broker.md "Limits and accepted risks"): the server moves it out of
// process.env before anything spawns, so no child that starts from process.env (a script tool,
// an MCP server, a terminal, a git hook) inherits it; and a multi-mode worca refuses to start
// while agents run as worca itself, where they could read it from worca's process.
import { test, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sealBrokerSecret, resetBrokerClient, brokerInfo, mintSpawnToken } from '../src/core/broker-client.mjs';
import { checkBrokerAtBoot } from '../src/core/broker-boot.mjs';
import { scriptBaseEnv } from '../src/core/graph/script-runner.mjs';

const SECRET = 's'.repeat(40);
let server; let url; let mode = 'single';
const auth = [];
const KEYS = ['WORCA_BROKER_URL', 'WORCA_BROKER_SECRET', 'WORCA_BROKER_SECRET_FILE', 'HOME', 'WORCA_AGENT_USER', 'WORCA_AGENT_HOME', 'WORCA_AGENT_ISOLATION'];
const SAVED = {};
let home;

before(async () => {
  server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      auth.push(req.headers.authorization);
      const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== `Bearer ${SECRET}`) return json(401, {});
      if (req.url === '/internal/info') return json(200, { mode, slots: [{ id: 'anthropic', auth: 'x-api-key', upstream: 'https://api.anthropic.com' }] });
      if (req.url === '/internal/tokens/revoke') return json(200, { revoked: 0 });
      if (req.url === '/internal/tokens') return json(200, { token: `wbt_${'a'.repeat(43)}`, expiresAt: null });
      if (req.url === '/internal/plugin-slots') return json(200, { slots: [] });
      json(404, {});
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());
beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  home = mkdtempSync(join(tmpdir(), 'worca-seal-'));
  process.env.HOME = home;
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME; delete process.env.WORCA_AGENT_ISOLATION;
  process.env.WORCA_BROKER_URL = url;
  process.env.WORCA_BROKER_SECRET = SECRET;
  resetBrokerClient();
  auth.length = 0;
  mode = 'single';
});
afterEach(() => {
  for (const k of KEYS) { if (SAVED[k] === undefined) delete process.env[k]; else process.env[k] = SAVED[k]; }
  resetBrokerClient();
  rmSync(home, { recursive: true, force: true });
});

test('seal: the secret leaves process.env, and worca still signs its broker calls with it', async () => {
  sealBrokerSecret();
  assert.equal(process.env.WORCA_BROKER_SECRET, undefined);
  // A child that starts from the server's env (a script tool with env scrub off) gets no secret.
  assert.equal(scriptBaseEnv({ envScrub: false }).WORCA_BROKER_SECRET, undefined);
  await brokerInfo({ force: true });
  await mintSpawnToken({ billTo: 'local', slots: ['anthropic'] });
  resetBrokerClient();   // forgetting the cached config does not forget the secret
  await brokerInfo({ force: true });
  assert.deepEqual(auth, Array(3).fill(`Bearer ${SECRET}`));
});

test('seal: the first broker call seals it too, and a later value replaces the sealed one', async () => {
  await brokerInfo({ force: true });
  assert.equal(process.env.WORCA_BROKER_SECRET, undefined);
  process.env.WORCA_BROKER_SECRET = 'x'.repeat(40);
  resetBrokerClient();
  await assert.rejects(brokerInfo({ force: true }), /refused worca's secret/);
  assert.equal(process.env.WORCA_BROKER_SECRET, undefined);
});

test('seal: the server seals before anything can spawn', () => {
  const src = readFileSync(new URL('../ui/server.mjs', import.meta.url), 'utf8');
  const seal = src.indexOf('\nsealBrokerSecret();');
  assert.ok(seal > 0, 'ui/server.mjs calls sealBrokerSecret() at the top level');
  for (const first of ['\npreflightNode();', '\nawait gitState();']) assert.ok(seal < src.indexOf(first), `sealed before ${first.trim()}`);
});

test('boot: a sealed secret still passes the boot check', async () => {
  sealBrokerSecret();
  const r = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.deepEqual(r.fatal, []);
  assert.equal(r.on, true);
});

test('boot: multi mode refuses agents that run as worca, unless WORCA_AGENT_ISOLATION=0 accepts it', async () => {
  mode = 'multi';
  const r = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.match(r.fatal.join(' '), /multi mode.*agents run as worca itself.*compose\.isolation\.yml/);

  process.env.WORCA_AGENT_ISOLATION = '0';
  resetBrokerClient();
  const accepted = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.deepEqual(accepted.fatal, []);
  assert.match(accepted.warnings.join(' '), /agents run as worca itself.*WORCA_AGENT_ISOLATION=0/);

  delete process.env.WORCA_AGENT_ISOLATION;
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(home, 'agent');
  resetBrokerClient();
  const isolated = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.deepEqual(isolated.fatal, []);
  assert.doesNotMatch(isolated.warnings.join(' '), /agents run as worca itself/);
});

test('boot: single mode with agents as worca is not refused', async () => {
  const r = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.deepEqual(r.fatal, []);
});

test('X2: WORCA_BROKER_SECRET_FILE is read once and both variables leave process.env; children see neither', async () => {
  delete process.env.WORCA_BROKER_SECRET;
  const file = join(home, 'broker-secret');
  writeFileSync(file, `${SECRET}\n`, { mode: 0o600 });
  process.env.WORCA_BROKER_SECRET_FILE = file;
  process.env.WORCA_BROKER_SECRET = 'y'.repeat(40);   // the file wins, as brokerConfig reads it
  sealBrokerSecret();
  assert.equal(process.env.WORCA_BROKER_SECRET_FILE, undefined);
  assert.equal(process.env.WORCA_BROKER_SECRET, undefined);
  const child = scriptBaseEnv({ envScrub: false });
  assert.equal(child.WORCA_BROKER_SECRET_FILE, undefined, 'a script, terminal or hook never learns the path');
  assert.equal(child.WORCA_BROKER_SECRET, undefined);
  rmSync(file);   // read once: gone from disk, worca still signs with it
  await brokerInfo({ force: true });
  assert.deepEqual(auth, [`Bearer ${SECRET}`]);
});

test('X2: with agents under their own users, a secret file its group or others may read refuses to boot', { skip: process.platform === 'win32' ? 'POSIX modes' : false }, async () => {
  delete process.env.WORCA_BROKER_SECRET;
  const file = join(home, 'broker-secret');
  writeFileSync(file, SECRET);
  chmodSync(file, 0o644);
  process.env.WORCA_BROKER_SECRET_FILE = file;
  process.env.WORCA_AGENT_USER = 'worca-agent';
  process.env.WORCA_AGENT_HOME = join(home, 'agent');
  resetBrokerClient(); sealBrokerSecret();
  const r = await checkBrokerAtBoot({ waitMs: 0, log: () => {} });
  assert.match(r.fatal.join(' '), /WORCA_BROKER_SECRET_FILE is readable by its group or by others \(mode 0644\)/);
  chmodSync(file, 0o600);
  process.env.WORCA_BROKER_SECRET_FILE = file;
  resetBrokerClient(); sealBrokerSecret();
  assert.deepEqual((await checkBrokerAtBoot({ waitMs: 0, log: () => {} })).fatal, [], '0600 boots');
  chmodSync(file, 0o644);
  delete process.env.WORCA_AGENT_USER; delete process.env.WORCA_AGENT_HOME;
  process.env.WORCA_BROKER_SECRET_FILE = file;
  resetBrokerClient(); sealBrokerSecret();
  assert.deepEqual((await checkBrokerAtBoot({ waitMs: 0, log: () => {} })).fatal, [], 'no agent users: no one to keep out');
});

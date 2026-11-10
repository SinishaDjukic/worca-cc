// test/executor-login-seed.test.mjs — the copied Claude sign-in stays usable: a worker copies the seed when its own
// is older, and the controller writes a login the worker refreshed back into the seed (never one whose refresh failed).
import { test, after, afterEach, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, utimesSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { seedClaudeLogin, reclaimClaudeLogin, loginExpiresAt } from '../src/core/executor/login-seed.mjs';
import { createWorkerRegistry } from '../src/core/executor/registry.mjs';
import { createInProcessBackend } from '../src/core/executor/backends/in-process.mjs';
import { reclaimWorkerLogin, workerHomeDir } from '../src/core/executor/index.mjs';
import { worcaHome } from '../src/core/projects.mjs';

const dirs = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'worca-login-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const creds = (expiresAt, refresh = 'r1') => JSON.stringify({ claudeAiOauth: { accessToken: 'a', refreshToken: refresh, expiresAt } });
const at = (file, ms) => utimesSync(file, new Date(ms), new Date(ms));
const T0 = Date.now() - 60_000;

test('seedClaudeLogin copies the login and settings once, again only when the seed is newer', () => {
  const seed = tmp(); const home = tmp();
  writeFileSync(join(seed, '.credentials.json'), creds(1)); writeFileSync(join(seed, 'settings.json'), '{}');
  at(join(seed, '.credentials.json'), T0); at(join(seed, 'settings.json'), T0);
  assert.deepEqual(seedClaudeLogin(home, seed), ['.credentials.json', 'settings.json']);
  assert.equal((statSync(join(home, '.claude', '.credentials.json')).mode & 0o777), 0o600);
  assert.deepEqual(seedClaudeLogin(home, seed), [], 'nothing newer: nothing copied');
  // The HOME's engine refreshed its copy: newer than the seed, it stays.
  writeFileSync(join(home, '.claude', '.credentials.json'), creds(2, 'r2')); at(join(home, '.claude', '.credentials.json'), T0 + 10_000);
  assert.deepEqual(seedClaudeLogin(home, seed), []);
  assert.equal(loginExpiresAt(join(home, '.claude', '.credentials.json')), 2);
  // A login renewed on the controller is newer than the HOME's: copied in again (what a worker does before each spawn).
  writeFileSync(join(seed, '.credentials.json'), creds(3, 'r3')); at(join(seed, '.credentials.json'), T0 + 20_000);
  assert.deepEqual(seedClaudeLogin(home, seed), ['.credentials.json']);
  assert.equal(loginExpiresAt(join(home, '.claude', '.credentials.json')), 3);
  assert.deepEqual(seedClaudeLogin(home, ''), []);
  assert.deepEqual(seedClaudeLogin('', seed), []);
});

test('reclaimClaudeLogin writes a refreshed login back to the seed; a failed refresh, an older or same-expiry copy never', () => {
  const seed = tmp(); const home = tmp(); mkdirSync(join(home, '.claude'), { recursive: true });
  const seedFile = join(seed, '.credentials.json'); const homeFile = join(home, '.claude', '.credentials.json');
  writeFileSync(seedFile, creds(1000)); at(seedFile, T0);
  // Same as the seed (just copied): nothing to write back.
  writeFileSync(homeFile, creds(1000)); at(homeFile, T0);
  assert.equal(reclaimClaudeLogin(home, seed), false);
  // Newer but the refresh FAILED (expiry cleared): the seed is kept.
  writeFileSync(homeFile, creds(0)); at(homeFile, T0 + 5_000);
  assert.equal(reclaimClaudeLogin(home, seed), false);
  assert.equal(loginExpiresAt(seedFile), 1000);
  // Newer and expiring later: the seed is replaced, whole and 0600.
  writeFileSync(homeFile, creds(2000, 'r2')); at(homeFile, T0 + 10_000);
  assert.equal(reclaimClaudeLogin(home, seed), true);
  assert.equal(readFileSync(seedFile, 'utf8'), creds(2000, 'r2'));
  assert.equal((statSync(seedFile).mode & 0o777), 0o600);
  // Newer by mtime but not expiring later (another worker's refresh already landed): kept.
  writeFileSync(homeFile, creds(1500, 'r1b')); at(homeFile, Date.now() + 1_000);
  assert.equal(reclaimClaudeLogin(home, seed), false);
  assert.equal(loginExpiresAt(seedFile), 2000);
  // No seed yet: a HOME's valid login becomes one. No HOME login: nothing.
  const seed2 = tmp();
  assert.equal(reclaimClaudeLogin(home, seed2), true);
  assert.ok(existsSync(join(seed2, '.credentials.json')));
  assert.equal(reclaimClaudeLogin(tmp(), seed2), false);
  assert.equal(reclaimClaudeLogin(home, ''), false);
  // Unreadable JSON in the HOME: never written back.
  writeFileSync(homeFile, 'not json'); at(homeFile, Date.now() + 2_000);
  assert.equal(reclaimClaudeLogin(home, seed), false);
});

// The registry tells the controller when a worker ended (released, idle, lost); the controller reclaims from its HOME.
const RUN = { kind: 'run', id: 'login-run' };
const CHAT = { kind: 'chat', id: 'login-chat' };
const CAPS = { engines: {}, platform: process.platform, node: process.version, user: null };
useTempHome(after);
let backend, registry;
const ended = [];
before(() => {
  backend = createInProcessBackend({ homeRoot: worcaHome(), capabilities: CAPS, log: () => {} });
  registry = createWorkerRegistry({ backend, host: '127.0.0.1', port: 0, startTimeoutMs: 5000, chatIdleMs: 300, pingMs: 200, log: () => {}, onEnded: (scope, { reason }) => ended.push(`${scope.kind}:${scope.id} ${reason}`) });
  return registry.listen();
});
afterEach(async () => { await registry.release(RUN, { reason: 'test' }); await registry.release(CHAT, { reason: 'test' }); });
after(async () => { await registry?.closeAll('test over'); });

test('onEnded fires once per worker, on release and on an idle leave; reclaimWorkerLogin reads the HOME it names', async () => {
  await registry.acquire(RUN);
  const dir = workerHomeDir(RUN);
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', '.credentials.json'), creds(5000, 'fresh'));
  const seed = tmp();
  writeFileSync(join(seed, '.credentials.json'), creds(10)); at(join(seed, '.credentials.json'), T0);
  await registry.release(RUN, { reason: 'done', graceMs: 300 });
  assert.deepEqual(ended, ['run:login-run done']);
  await registry.release(RUN, { reason: 'again' });
  assert.deepEqual(ended, ['run:login-run done'], 'a second release of a gone worker reports nothing');
  assert.equal(reclaimWorkerLogin(RUN, seed), true, 'the released worker HOME still holds the refreshed login');
  assert.equal(loginExpiresAt(join(seed, '.credentials.json')), 5000);
  assert.equal(reclaimWorkerLogin(RUN, null), false, 'nothing seeded: nothing reclaimed');

  ended.length = 0;
  const s = await registry.acquire(CHAT);
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(s.closed, true);
  assert.deepEqual(ended, ['chat:login-chat idle']);
});

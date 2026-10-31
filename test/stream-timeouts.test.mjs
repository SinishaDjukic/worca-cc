// test/stream-timeouts.test.mjs
// A response that sends no bytes for ~5 min is aborted as "Request timed out."
// and retried from scratch: by Bun's own fetch timeout (CLI 2.1.281 lifts it
// only under its stream watchdog, or with API_FORCE_IDLE_TIMEOUT=0), by the CLI
// watchdog where that runs, and by API_TIMEOUT_MS (600s). A gateway that buffers
// the stream (Vertex behind a corporate gateway, 2026-09-28) sends nothing until
// a long xhigh turn is done, so every retry died at the same wall. Every spawn
// routed off first party now lifts Bun's timeout and carries the CLI's ceiling
// (30 min) for the rest, unless the operator's env or the model entry sets one.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withStreamTimeouts, STREAM_TIMEOUT_ENV, STREAM_TIMEOUT_ENV_KEYS, STREAM_TIMEOUT_MS } from '../src/core/model-env.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { checkRows } from './helpers/rows.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script' : false };

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'worca-cc-stream-timeouts-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const withEnv = (kv, fn) => {
  const prev = {};
  for (const [k, v] of Object.entries(kv)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  const restore = () => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } };
  try { const r = fn(); if (r && typeof r.finally === 'function') return r.finally(restore); restore(); return r; } catch (e) { restore(); throw e; }
};

const allRaised = () => ({ ...STREAM_TIMEOUT_ENV });
// The ambient routing a developer shell may export; cleared so each case states its own route.
const FIRST_PARTY = {
  CLAUDE_CODE_USE_VERTEX: undefined, CLAUDE_CODE_USE_BEDROCK: undefined, CLAUDE_CODE_USE_FOUNDRY: undefined,
  ANTHROPIC_BASE_URL: undefined,
  ...Object.fromEntries(['API_FORCE_IDLE_TIMEOUT', 'API_TIMEOUT_MS', 'CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS', 'CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS', 'CLAUDE_STREAM_IDLE_TIMEOUT_MS'].map((k) => [k, undefined])),
};

test('withStreamTimeouts: Vertex, Bedrock, Foundry and a custom base URL count as routed', async () => {
  await checkRows([
    { name: 'withStreamTimeouts: a Vertex-routed env gets every unset key', run: () => {
      const env = { PATH: '/bin', CLAUDE_CODE_USE_VERTEX: '1' };
      assert.deepEqual(withStreamTimeouts(env), { ...env, ...allRaised() });
    } },
    { name: 'withStreamTimeouts: Bedrock, Foundry and a custom ANTHROPIC_BASE_URL count as routed too', run: () => {
      for (const route of [{ CLAUDE_CODE_USE_BEDROCK: 'true' }, { CLAUDE_CODE_USE_FOUNDRY: 'YES' }, { ANTHROPIC_BASE_URL: 'https://gw.example/v1' }]) {
        assert.deepEqual(withStreamTimeouts(route), { ...route, ...allRaised() }, JSON.stringify(route));
      }
    } },
  ]);
});

test('withStreamTimeouts: first party untouched, explicit values kept, input not mutated, no env passes through', async () => {
  await checkRows([
    { name: 'withStreamTimeouts: first party (nothing routed, or the switches off) comes back untouched', run: () => {
      for (const env of [{ PATH: '/bin' }, { CLAUDE_CODE_USE_VERTEX: '0' }, { CLAUDE_CODE_USE_BEDROCK: 'false', CLAUDE_CODE_USE_FOUNDRY: '' }]) {
        assert.equal(withStreamTimeouts(env), env, JSON.stringify(env));
      }
    } },
    { name: 'withStreamTimeouts: an explicit value is never overwritten, and the input is not mutated', run: () => {
      const env = { ANTHROPIC_BASE_URL: 'https://gw.example/v1', API_TIMEOUT_MS: '3000000', CLAUDE_STREAM_IDLE_TIMEOUT_MS: '300000' };
      const snapshot = { ...env };
      const out = withStreamTimeouts(env);
      assert.equal(out.API_TIMEOUT_MS, '3000000');
      assert.equal(out.CLAUDE_STREAM_IDLE_TIMEOUT_MS, '300000');
      assert.equal(out.CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS, STREAM_TIMEOUT_MS);
      assert.equal(out.CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS, STREAM_TIMEOUT_MS);
      assert.equal(out.API_FORCE_IDLE_TIMEOUT, '0');
      assert.deepEqual(env, snapshot);
    } },
    { name: 'withStreamTimeouts: no env passes through', run: () => {
      assert.equal(withStreamTimeouts(undefined), undefined);
      assert.equal(withStreamTimeouts(null), null);
    } },
  ]);
});

/** Fake claude recording the timeout knobs it was spawned with, one KEY=value line each. */
async function fakeBin(dir, envFile) {
  const bin = join(dir, 'fake-claude.sh');
  const lines = STREAM_TIMEOUT_ENV_KEYS.map((k) => `printf '%s=%s\\n' ${k} "\${${k}-unset}" >> ${JSON.stringify(envFile)}`).join('\n');
  await writeFile(bin, `#!/bin/sh\n${lines}\nexit 0\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}
const readKnobs = async (envFile) => Object.fromEntries(
  (await readFile(envFile, 'utf8')).trim().split('\n').map((l) => l.split('=')),
);

test('runClaude: an ambient Vertex route and a routed model env spawn with the raised timeouts (own value wins)', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'runClaude: an ambient Vertex route spawns with the raised timeouts', run: async () => {
      const dir = await tmp();
      const envFile = join(dir, 'env.txt');
      const bin = await fakeBin(dir, envFile);
      await withEnv({ ...FIRST_PARTY, CLAUDE_CODE_USE_VERTEX: '1' }, () => runClaude({ cwd: dir, prompt: 'hi', bin }));
      assert.deepEqual(await readKnobs(envFile), allRaised());
    } },
    { name: 'runClaude: a model env routing to an endpoint spawns with the raised timeouts; its own value wins', run: async () => {
      const dir = await tmp();
      const envFile = join(dir, 'env.txt');
      const bin = await fakeBin(dir, envFile);
      const modelEnv = { ANTHROPIC_BASE_URL: 'https://gw.example/v1', API_TIMEOUT_MS: '3000000' };
      await withEnv(FIRST_PARTY, () => runClaude({ cwd: dir, prompt: 'hi', bin, modelEnv }));
      assert.deepEqual(await readKnobs(envFile), { ...allRaised(), API_TIMEOUT_MS: '3000000' });
    } },
  ]);
});

test('runClaude: an operator knob wins; a first-party spawn keeps the CLI defaults', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'runClaude: an operator-exported knob wins over the default', run: async () => {
      const dir = await tmp();
      const envFile = join(dir, 'env.txt');
      const bin = await fakeBin(dir, envFile);
      await withEnv({ ...FIRST_PARTY, CLAUDE_CODE_USE_VERTEX: '1', CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '600000' },
        () => runClaude({ cwd: dir, prompt: 'hi', bin }));
      assert.deepEqual(await readKnobs(envFile), { ...allRaised(), CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '600000' });
    } },
    { name: 'runClaude: a first-party spawn keeps the CLI defaults (nothing set)', run: async () => {
      const dir = await tmp();
      const envFile = join(dir, 'env.txt');
      const bin = await fakeBin(dir, envFile);
      await withEnv(FIRST_PARTY, () => runClaude({ cwd: dir, prompt: 'hi', bin }));
      assert.deepEqual(await readKnobs(envFile), Object.fromEntries(STREAM_TIMEOUT_ENV_KEYS.map((k) => [k, 'unset'])));
    } },
  ]);
});

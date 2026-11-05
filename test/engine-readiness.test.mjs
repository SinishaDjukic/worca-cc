// test/engine-readiness.test.mjs — which run engines are ready now (engines/readiness.mjs): each adapter's own
// preflight, cached for the TTL; Claude always ready; mock reports every engine ready and spawns nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeReady } from '../src/core/onboarding.mjs';
import { engineReadiness } from '../src/core/engines/readiness.mjs';
import { readyEnginesCached, resetEngineReadiness } from '../src/core/engines/ready-cache.mjs';

test('runs each preflight once per TTL; claude is always ready; a refusal is not ready', async () => {
  resetEngineReadiness();
  let calls = 0;
  const preflights = { codex: async () => { calls++; return {}; }, copilot: async () => { calls++; return { refusal: 'cannot run copilot' }; }, cursor: async () => { calls++; return { refusal: 'cursor-agent is not signed in' }; },
    gemini: async () => { calls++; return {}; },
    goose: async () => { calls++; return { warning: 'could not check goose' }; },
    opencode: async () => { calls++; return { warning: 'no provider credentials' }; },
    qwen: async () => { calls++; return { refusal: 'qwen is not signed in' }; } };
  const a = await engineReadiness({ preflights, now: 1000, mock: false });
  assert.deepEqual(a, [
    { name: 'claude', label: 'Claude', ready: true, reason: null },
    { name: 'codex', label: 'Codex', ready: true, reason: null },
    { name: 'copilot', label: 'Copilot', ready: false, reason: 'cannot run copilot' },
    { name: 'cursor', label: 'Cursor', ready: false, reason: 'cursor-agent is not signed in' },
    { name: 'gemini', label: 'Gemini CLI', ready: true, reason: null },
    { name: 'goose', label: 'Goose', ready: true, reason: 'could not check goose' },
    { name: 'opencode', label: 'OpenCode', ready: true, reason: 'no provider credentials' },
    { name: 'qwen', label: 'Qwen Code', ready: false, reason: 'qwen is not signed in' },
  ]);
  await engineReadiness({ preflights, now: 2000, mock: false });
  assert.equal(calls, 7, 'cached');
  assert.deepEqual(readyEnginesCached(2000), ['claude', 'codex', 'gemini', 'goose', 'opencode']);
  await engineReadiness({ preflights, now: 2000, force: true, mock: false });
  assert.equal(calls, 14);
});

test('mock: every engine ready, nothing spawned', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { cursor: async () => { throw new Error('spawned'); } }, mock: true, force: true });
  assert.ok(list.every((e) => e.ready));
});

test('a preflight that throws is a warning, still ready', async () => {
  resetEngineReadiness();
  const list = await engineReadiness({ preflights: { codex: async () => ({}), copilot: async () => ({}), cursor: async () => { throw new Error('boom'); }, gemini: async () => ({}), goose: async () => ({}), opencode: async () => ({}), qwen: async () => ({}) }, mock: false, force: true });
  assert.deepEqual(list.find((e) => e.name === 'cursor'), { name: 'cursor', label: 'Cursor', ready: true, reason: 'boom' });
});

test('claude: an unspawnable Windows npm shim is not ready, with the same hint the Getting started tile shows', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-cc-readiness-'));
  const saved = { path: process.env.PATH, w: process.env.WORCA_CLAUDE_BIN, o: process.env.ORCH_CLAUDE_BIN, mock: process.env.WORCA_MOCK };
  const platformDesc = Object.getOwnPropertyDescriptor(process, 'platform');
  try {
    writeFileSync(join(dir, 'claude.cmd'), '@echo off\r\n');
    delete process.env.WORCA_CLAUDE_BIN; delete process.env.ORCH_CLAUDE_BIN;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    process.env.PATH = dir;
    const idle = Object.fromEntries(['codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode', 'qwen'].map((n) => [n, async () => ({})]));
    resetEngineReadiness();
    const claude = (await engineReadiness({ preflights: idle, now: 1000, mock: false })).find((e) => e.name === 'claude');
    const tile = claudeReady();
    assert.equal(claude.ready, false);
    assert.ok(tile.hint);
    assert.equal(claude.reason, tile.hint);
    // the cache serves the second ask
    const again = (await engineReadiness({ preflights: idle, now: 2000, mock: false })).find((e) => e.name === 'claude');
    assert.equal(again.reason, tile.hint);
  } finally {
    Object.defineProperty(process, 'platform', platformDesc);
    process.env.PATH = saved.path;
    if (saved.w !== undefined) process.env.WORCA_CLAUDE_BIN = saved.w;
    if (saved.o !== undefined) process.env.ORCH_CLAUDE_BIN = saved.o;
    resetEngineReadiness();
    rmSync(dir, { recursive: true, force: true });
  }
});

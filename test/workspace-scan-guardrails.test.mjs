// test/workspace-scan-guardrails.test.mjs
// The union+expansion helper is unit-tested directly (the engine exposes no
// clean ctx-capture seam); the one-line wiring into the ctx literal is covered
// by review + the existing workspace-scan suite staying green.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';

let a, b, homeDir, prevHome;
before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-wsg-home-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  a = await mkdtemp(join(tmpdir(), 'worca-cc-wsg-a-'));
  b = await mkdtemp(join(tmpdir(), 'worca-cc-wsg-b-'));
});
after(async () => {
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(a, { recursive: true, force: true });
  await rm(b, { recursive: true, force: true });
});

test('resolveScanGuardrails unions member policies deny-safely (preset + custom mix)', async () => {
  const cfg = await import('../src/core/config.mjs');
  const { resolveScanGuardrails } = await import('../src/core/workspace-scan.mjs');
  await cfg.setGuardrails(a, { level: 'normal' });                       // preset member
  await cfg.setGuardrails(b, { level: 'custom', custom: {                // custom scrubbing member
    honorProjectSettings: true, envScrub: true, envAllowlist: ['NPM_TOKEN'],
    protectedPaths: [], deny: ['Bash(curl:*)'],
  } });
  const g = await resolveScanGuardrails([a, b]);
  assert.ok(g.permissionRules.deny.includes('Read(.env*)'), 'normal preset protectedPaths expanded');
  assert.ok(g.permissionRules.deny.includes('Bash(git push)'), 'normal preset deny present');
  assert.ok(g.permissionRules.deny.includes('Bash(curl:*)'), 'custom member deny unioned');
  assert.equal(g.envScrub, true, 'any scrubbing member scrubs the scan');
  assert.deepEqual(g.envAllowlist, ['NPM_TOKEN']);
});

test('resolveScanGuardrails: all-permissive members -> all fields undefined (legacy parity)', async () => {
  const { resolveScanGuardrails } = await import('../src/core/workspace-scan.mjs');
  const c = await mkdtemp(join(tmpdir(), 'worca-cc-wsg-c-'));
  try {
    assert.deepEqual(await resolveScanGuardrails([c]), {
      permissionRules: undefined, envScrub: undefined, envAllowlist: undefined,
    });
  } finally {
    await rm(c, { recursive: true, force: true });
  }
});

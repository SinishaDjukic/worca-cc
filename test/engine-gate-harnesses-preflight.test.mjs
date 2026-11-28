// test/engine-gate-harnesses-preflight.test.mjs — the start checks of a harness a run reaches only through a pinned
// step, with a real (non-mock) preflight: a signed-out codex stand-in (WORCA_CODEX_BIN, read when engines/codex.mjs
// loads, so every src/ import below is dynamic and comes after it is set).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitDir } from './helpers/git-dir.mjs';

const POSIX = process.platform === 'win32' ? { skip: 'POSIX shell fixtures' } : {};
const binDir = mkdtempSync(join(tmpdir(), 'worca-psh-codex-'));
const codexOut = join(binDir, 'codex-out');
writeFileSync(codexOut, '#!/bin/sh\necho "Not logged in"\nexit 1\n');
chmodSync(codexOut, 0o755);
const prevBin = process.env.WORCA_CODEX_BIN;
const prevMock = process.env.WORCA_MOCK;
process.env.WORCA_CODEX_BIN = codexOut;
delete process.env.WORCA_MOCK;
after(() => {
  if (prevBin === undefined) delete process.env.WORCA_CODEX_BIN; else process.env.WORCA_CODEX_BIN = prevBin;
  if (prevMock !== undefined) process.env.WORCA_MOCK = prevMock;
  rmSync(binDir, { recursive: true, force: true });
});
const { useTempHome } = await import('./helpers/temp-home.mjs');
useTempHome(after);
const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
const { createLoopbackBackend } = await import('./helpers/loopback-backend.mjs');
const { _registerExecBackendForTests } = await import('../src/core/exec-env/registry.mjs');
const lbRoot = mkdtempSync(join(tmpdir(), 'worca-psh-loopback-'));
const lb = createLoopbackBackend({ root: lbRoot });
const unregister = _registerExecBackendForTests(lb.backend);
after(() => { unregister(); rmSync(lbRoot, { recursive: true, force: true }); });


test('Review Focus 2: a Claude-default start with a step pinned to Codex while Codex is signed out is refused before the run exists', POSIX, async () => {
  const o = createOrchestrator({ projectDir: gitDir('psh-codex-out'), workflowId: 'wf_default', prompt: 'x', guardrailsId: 'permissive',
    claude: {}, overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } } });
  const r = await o.engineStartRefusal();
  assert.deepEqual([r.overridable, r.engines], [false, ['codex']]);
  assert.match(r.error, /^engine codex \(Plan\): .* is not signed in — run `codex login`/);
});

test('a saved remote default steps aside BEFORE the engine checks: a signed-out pinned Codex still refuses the start', POSIX, async () => {
  const o = createOrchestrator({ projectDir: gitDir('psh-remote-default'), workflowId: 'wf_default', prompt: 'x', guardrailsId: 'permissive',
    claude: {}, execEnv: 'loopback', execEnvDefault: true, overlay: { nodes: { n_plan: { model: 'gpt-5.5', engine: 'codex' } } } });
  const r = await o.engineStartRefusal();
  assert.deepEqual([o.execEnvKind, r?.overridable, r?.engines], ['local', false, ['codex']]);
  assert.match(r.error, /^engine codex \(Plan\): .* is not signed in/);
});

// test/cli-permission-mode.test.mjs
// `dontAsk` is the Ask Worca runner's own permission mode (ask/spawn.mjs), and
// claude-runner.mjs routes EVERY dontAsk mock spawn into the ask mock — pipeline
// markers live in the prompt, so a pipeline role spawned that way writes no
// artifact and the run dies at its first artifact read. The mode is internal, so
// the CLI must not accept it (nor a typo) as a pipeline run's permission mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { ASK_PERMISSION_MODE } from '../src/core/ask/spawn.mjs';

const CLI = resolve(fileURLToPath(import.meta.url), '..', '..', 'src', 'cli', 'worca-cc.mjs');

useTempHome(after);

test('--help lists the permission modes the CLI accepts', () => {
  const out = spawnSync(process.execPath, [CLI, '--help']).stdout.toString();
  assert.match(out, /--permission-mode <m>\s+Claude permission mode/);
  assert.match(out, /acceptEdits/);
  assert.ok(!out.includes(ASK_PERMISSION_MODE), 'the ask runner`s internal mode is not offered');
});

// `dontAsk` is a legitimate headless mode for a REAL run (`--allowedTools` decide
// what runs); rejecting it outright was a regression against the pre-#376 CLI,
// which forwarded any mode verbatim. The value is validated while it is PARSED,
// so `--help` (handled after parseArgs, and the one flag that starts no run) is
// enough to observe acceptance — and a red run of this test cannot spawn a
// pipeline in the developer's cwd.
test('--permission-mode dontAsk is accepted for a real run, in both flag spellings', () => {
  for (const argv of [
    ['--permission-mode', ASK_PERMISSION_MODE],
    [`--permission-mode=${ASK_PERMISSION_MODE}`],
  ]) {
    const r = spawnSync(process.execPath, [CLI, ...argv, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${argv.join(' ')}: accepted (${r.stderr})`);
  }
});

// The MOCK runner is the one place dontAsk means "the Ask Worca recipe"
// (claude-runner.mjs runMock, rule R-F): a mock pipeline role spawned with it
// writes no artifact. The CLI refuses the PAIR before any run starts, and the
// orchestrator refuses it at construction for programmatic callers.
test('--permission-mode dontAsk with --mock is rejected (exit 2) before a run starts', async () => {
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-cli-pm-'));
  try {
    const r = spawnSync(process.execPath, [CLI, '--project', proj, '--prompt', 'x', '--mock', '--yes', '--permission-mode', ASK_PERMISSION_MODE],
      { encoding: 'utf8', env: { ...process.env } });
    assert.equal(r.status, 2, `exits with the usage code (${r.stderr})`);
    assert.match(r.stderr, /dontAsk cannot be combined with --mock/);
    assert.ok(!existsSync(join(proj, '.git')), 'no run was started (no repo/worktree bootstrapped)');
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test('createOrchestrator refuses mock + dontAsk at construction (the programmatic hazard)', async () => {
  const { createOrchestrator } = await import('../src/core/orchestrator.mjs');
  const proj = await mkdtemp(join(tmpdir(), 'worca-cc-orch-pm-'));
  try {
    assert.throws(() => createOrchestrator({ projectDir: proj, prompt: 'x', claude: { mock: true, permissionMode: ASK_PERMISSION_MODE } }), /dontAsk/);
    // a real (non-mock) orchestrator accepts the mode
    const prev = process.env.WORCA_MOCK; delete process.env.WORCA_MOCK;
    try { assert.ok(createOrchestrator({ projectDir: proj, prompt: 'x', claude: { mock: false, permissionMode: ASK_PERMISSION_MODE } })); }
    finally { if (prev !== undefined) process.env.WORCA_MOCK = prev; }
  } finally {
    await rm(proj, { recursive: true, force: true });
  }
});

test('an unknown --permission-mode value is rejected too', () => {
  const r = spawnSync(process.execPath, [CLI, '--permission-mode', 'acceptedits', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /acceptedits/, 'the rejected value is echoed back');
});

test('the real permission modes still parse', () => {
  for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk']) {
    const r = spawnSync(process.execPath, [CLI, '--permission-mode', mode, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${mode}: accepted (${r.stderr})`);
    assert.match(r.stdout, /--permission-mode/);
  }
});

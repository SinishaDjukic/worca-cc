// test/workflow-test-try-guard-probe.test.mjs — workflow tests 3a (D56): the try guard's structured deny is decided on
// the Claude Code the run SPAWNS. The harness's capability probe (`--help` / `--version`) must ask the same binary the
// agent spawn uses (WORCA_CLAUDE_BIN / ORCH_CLAUDE_BIN, engines/claude.mjs DEFAULT_BIN), not a bare `claude` found on
// PATH: an older CLI behind WORCA_CLAUDE_BIN with a newer one on PATH would otherwise get WORCA_TRY_GUARD_JSON=1, answer
// a deny it does not read, and let the command run. A probe that fails (no binary, garbage) is never a throw: no
// version, so the hook blocks with stderr + exit 2.
// Run in a child process: DEFAULT_BIN is read once, when engines/claude.mjs loads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HARNESS = pathToFileURL(join(import.meta.dirname, '..', 'src', 'core', 'run-harness.mjs')).href;
const GUARD_ENV = pathToFileURL(join(import.meta.dirname, '..', 'src', 'core', 'workflow-tests', 'try-guard-env.mjs')).href;

/** What a harness with no explicit claude.bin probes, under `env`. */
function probeUnder(env) {
  const home = mkdtempSync(join(tmpdir(), 'worca-cc-wftprobe-'));
  try {
    const code = `
      const { RunHarness } = await import(${JSON.stringify(HARNESS)});
      const { claudeReadsStructuredDeny } = await import(${JSON.stringify(GUARD_ENV)});
      const h = Object.create(RunHarness.prototype);
      h.claude = {};
      const caps = await h._claudeCaps();
      console.log(JSON.stringify({ caps, structured: claudeReadsStructuredDeny(caps.version), bin: h._claudeBin() }));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      env: { ...process.env, WORCA_HOME: home, ...env }, encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(r.status, 0, `child failed: ${r.stderr}`);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  } finally {
    rmSync(home, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
}

test('the capability probe asks WORCA_CLAUDE_BIN, the binary the agent spawn uses', () => {
  // node itself stands in for the configured CLI: `node --version` is v<semver>, whatever `claude` is on PATH.
  const out = probeUnder({ WORCA_CLAUDE_BIN: process.execPath, ORCH_CLAUDE_BIN: '' });
  assert.equal(out.bin, process.execPath);
  assert.equal(out.caps.version, process.versions.node, 'the version is the configured binary\'s, not PATH claude\'s');
});

test('a probe that fails never throws: no version, so no structured deny (exit-2 fallback)', () => {
  const missing = join(tmpdir(), 'worca-cc-no-such-dir', 'claude.exe');
  const out = probeUnder({ WORCA_CLAUDE_BIN: missing, ORCH_CLAUDE_BIN: '' });
  assert.equal(out.caps.version, null);
  assert.equal(out.caps.mcpConfig, false);
  assert.equal(out.structured, false);
});

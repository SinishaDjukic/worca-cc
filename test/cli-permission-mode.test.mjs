// test/cli-permission-mode.test.mjs
// `dontAsk` is the Ask Worca runner's own permission mode (ask/spawn.mjs), and
// claude-runner.mjs routes EVERY dontAsk mock spawn into the ask mock — pipeline
// markers live in the prompt, so a pipeline role spawned that way writes no
// artifact and the run dies at its first artifact read. The mode is internal, so
// the CLI must not accept it (nor a typo) as a pipeline run's permission mode.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

// The value is rejected while it is PARSED, so `--help` (handled after parseArgs,
// and the one flag that starts no run) is enough to observe it — and a red run of
// this test cannot spawn a pipeline in the developer's cwd.
test('--permission-mode dontAsk is rejected (exit 2), in both flag spellings', () => {
  for (const argv of [
    ['--permission-mode', ASK_PERMISSION_MODE],
    [`--permission-mode=${ASK_PERMISSION_MODE}`],
  ]) {
    const r = spawnSync(process.execPath, [CLI, ...argv, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 2, `${argv.join(' ')}: exits with the usage code`);
    assert.match(r.stderr, /--permission-mode/);
    assert.match(r.stderr, /acceptEdits/, 'and names the modes that are accepted');
  }
});

test('an unknown --permission-mode value is rejected too', () => {
  const r = spawnSync(process.execPath, [CLI, '--permission-mode', 'acceptedits', '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /acceptedits/, 'the rejected value is echoed back');
});

test('the real permission modes still parse', () => {
  for (const mode of ['default', 'acceptEdits', 'plan', 'bypassPermissions']) {
    const r = spawnSync(process.execPath, [CLI, '--permission-mode', mode, '--help'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${mode}: accepted (${r.stderr})`);
    assert.match(r.stdout, /--permission-mode/);
  }
});

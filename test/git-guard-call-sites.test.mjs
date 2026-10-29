// test/git-guard-call-sites.test.mjs — G2 at call sites whose guard the PR #854 review could revert with every test
// still green: the Cursor adapter's git calls in a run checkout (core.fsmonitor runs on any index refresh), and the
// retained-run snapshot diff, which must never run an external diff driver (GIT_EXTERNAL_DIFF in worca's env too).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitState } from '../src/core/git-available.mjs';
import { writeCursorProjectFiles } from '../src/core/engines/cursor.mjs';
import { snapshotWorktreePatch } from '../src/core/worktree.mjs';

useTempHome(after);
const POSIX = { skip: process.platform === 'win32' ? 'the planted commands are POSIX shell' : false };
const root = realpathSync(mkdtempSync(join(tmpdir(), 'worca-g2-sites-')));
after(() => rmSync(root, { recursive: true, force: true }));

function repo(name) {
  const dir = join(root, name);
  execFileSync('git', ['init', '-q', '-b', 'main', dir]);
  const g = (...a) => execFileSync('git', ['-c', 'user.name=a', '-c', 'user.email=a@b', ...a], { cwd: dir, stdio: 'ignore' });
  writeFileSync(join(dir, 'f.txt'), 'one\n');
  g('add', 'f.txt'); g('commit', '-q', '-m', 'i');
  return { dir, g };
}
function marker(dir, name) {
  const mark = join(root, `${name}.ran`);
  const script = join(root, `${name}.sh`);
  writeFileSync(script, `#!/bin/sh\necho ran >> '${mark}'\nexit 0\n`);
  chmodSync(script, 0o755);
  return { mark, script };
}

test('Cursor: writing the run checkout\'s .cursor files runs no planted core.fsmonitor', POSIX, async () => {
  await gitState({ fresh: true });
  const { dir, g } = repo('cursor');
  const { mark, script } = marker(dir, 'fsmonitor');
  g('config', 'core.fsmonitor', script);
  writeCursorProjectFiles(dir, { '.cursor/cli.json': '{"permissions":{"deny":["Shell(rm)"]}}\n' });
  assert.ok(existsSync(join(dir, '.cursor', 'cli.json')));
  assert.equal(existsSync(mark), false, existsSync(mark) ? readFileSync(mark, 'utf8') : '');
});

test('snapshot: the retained run\'s patch is never made by an external diff (GIT_EXTERNAL_DIFF in worca\'s env)', POSIX, async () => {
  const { dir } = repo('snapshot');
  writeFileSync(join(dir, 'f.txt'), 'two\n');
  const { mark, script } = marker(dir, 'extdiff');
  const prev = process.env.GIT_EXTERNAL_DIFF;
  process.env.GIT_EXTERNAL_DIFF = script;
  try {
    const out = join(root, 'snap.patch');
    const r = await snapshotWorktreePatch(dir, out);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.match(readFileSync(out, 'utf8'), /\+two/);
    assert.equal(existsSync(mark), false, 'the external diff ran');
  } finally { if (prev === undefined) delete process.env.GIT_EXTERNAL_DIFF; else process.env.GIT_EXTERNAL_DIFF = prev; }
});

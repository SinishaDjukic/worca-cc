// test/preflight-host.test.mjs
// The UI server refuses to start from a run's own folder, which Worca deletes
// when the run is discarded or archived. Paths are throwaway temp trees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFolderHosting } from '../src/core/preflight-host.mjs';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worca-host-')));
const home = path.join(tmp, '.worca-cc');

test('a code root inside <worcaHome>/runs/<id> names that run folder', () => {
  const root = path.join(home, 'runs', 'b91270e6', 'repos', 'worca-cc');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(runFolderHosting(root, home), path.join(home, 'runs', 'b91270e6'));
});

test('a code root inside a legacy <project>/.worca-cc/worktrees/<id> names that worktree', () => {
  const root = path.join(tmp, 'proj', '.worca-cc', 'worktrees', '4647be0d');
  fs.mkdirSync(root, { recursive: true });
  assert.equal(runFolderHosting(root, home), root);
});

test('a symlink into a run folder is caught through its real path', () => {
  const link = path.join(tmp, 'link');
  fs.symlinkSync(path.join(home, 'runs', 'b91270e6'), link);
  assert.equal(runFolderHosting(path.join(link, 'repos', 'worca-cc'), home), path.join(home, 'runs', 'b91270e6'));
});

test('own clones and Claude worktrees are not run folders', () => {
  assert.equal(runFolderHosting(path.join(tmp, 'worca-cc'), home), null);
  assert.equal(runFolderHosting(path.join(tmp, 'worca-cc', '.claude', 'worktrees', 'x'), home), null);
  assert.equal(runFolderHosting(path.join(home, 'runs-old', 'x'), home), null);
});

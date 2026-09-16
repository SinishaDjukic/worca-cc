// test/metrics-status-undiscovered.test.mjs
// projectMetricsStatus for a registered folder that is not a git repository: it can never
// record (no origin to push to; the workspace scan refuses it), so the status must say so
// instead of leaving hasOrigin null — which made the Projects cell offer "Set up team
// metrics…" for nothing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { projectMetricsStatus } from '../src/core/metrics/sync.mjs';

useTempHome(after);
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); dirs.push(d); return d; };

test('undiscovered projects settle hasOrigin up front: plain folder, git without remote, git with origin', async () => {
  const plain = tmp('worca-tm-nogit-');
  const s = await projectMetricsStatus({ key: 'plain-00000001', name: 'plain', path: plain, exists: true });
  assert.equal(s.hasOrigin, false);
  assert.equal(s.noGit, true);
  assert.equal(s.enabled, false);

  const repo = tmp('worca-tm-git-');
  execFileSync('git', ['init', '-q'], { cwd: repo });
  const r = await projectMetricsStatus({ key: 'repo-00000001', name: 'repo', path: repo, exists: true });
  assert.equal(r.hasOrigin, false, 'a git repo with no origin remote cannot record: say so before any setup attempt');
  assert.equal(r.noGit, undefined, 'it IS a git repo — the cell copy is "no origin remote", not "not a git repository"');

  const withOrigin = tmp('worca-tm-origin-');
  execFileSync('git', ['init', '-q'], { cwd: withOrigin });
  execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/with-origin.git'], { cwd: withOrigin });
  const o = await projectMetricsStatus({ key: 'origin-00000001', name: 'with-origin', path: withOrigin, exists: true });
  assert.equal(o.hasOrigin, true);
  assert.equal(o.enabled, false, 'still Off — origin present, setup is offered');
  assert.equal(o.slug, 'acme/with-origin');

  const gone = await projectMetricsStatus({ key: 'gone-00000001', name: 'gone', path: join(plain, 'missing'), exists: false });
  assert.equal(gone.noGit, undefined, 'a missing folder is reported as missing, not as non-git');
});

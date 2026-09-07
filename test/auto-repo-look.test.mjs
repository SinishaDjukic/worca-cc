// test/auto-repo-look.test.mjs — the throwaway detached checkout the chat's classifier reads.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { openRepoLook, REPO_LOOK_DIRNAME } from '../src/core/auto/repo-look.mjs';
import { runGitCapture } from '../src/core/worktree.mjs';

useTempHome(after);
const base = () => mkdtempSync(join(tmpdir(), 'worca-look-base-'));
// git records the REALPATH of a checkout (`/private/var/…` for a `/var/…` tmpdir on macOS), so
// registrations are matched by the unique dir NAME, never by the path string.
const registered = async (projectDir, cwd) => (await runGitCapture(projectDir, ['worktree', 'list', '--porcelain'])).stdout.includes(basename(cwd));

test('a directory without a git repository yields null (text-only classification)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'worca-look-nogit-'));
  assert.equal(await openRepoLook(dir, base()), null);
  assert.equal(await openRepoLook('', base()), null);
  assert.equal(await openRepoLook(gitDir('look-nobase'), ''), null);
});

test('a git project yields a detached checkout under baseDir that close() removes (idempotent)', async () => {
  const projectDir = gitDir('look');
  const baseDir = base();
  // Deliberately NO signal: a caller without one (tests, a deps bundle built without a lifetime signal)
  // must still get a checkout — spawn rejects `signal: null`, so the module must omit the key (Facts).
  const look = await openRepoLook(projectDir, baseDir);
  assert.ok(look && look.cwd.startsWith(baseDir), 'the checkout lives under baseDir');
  assert.ok(basename(look.cwd).startsWith(`${REPO_LOOK_DIRNAME}-`), 'named auto-look-<hex>');
  assert.ok(readdirSync(baseDir).includes(basename(look.cwd)));
  assert.notEqual(look.cwd, projectDir, 'never the live checkout');
  assert.ok(existsSync(join(look.cwd, '.git')), 'a real worktree (.git is a pointer FILE there)');
  const head = await runGitCapture(look.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  assert.equal(head.stdout.trim(), 'HEAD', 'detached: no branch is created or locked');
  assert.equal(await registered(projectDir, look.cwd), true, 'git knows the worktree');
  await look.close();
  assert.equal(existsSync(look.cwd), false, 'removed');
  assert.equal(await registered(projectDir, look.cwd), false, 'unregistered');
  await look.close();   // a second close is a no-op
  assert.equal(existsSync(look.cwd), false);
});

test('an already-aborted signal yields null and leaves nothing behind', async () => {
  const projectDir = gitDir('look-abort');
  const baseDir = base();
  const ctrl = new AbortController(); ctrl.abort();
  const notes = [];
  assert.equal(await openRepoLook(projectDir, baseDir, { signal: ctrl.signal, log: (m) => notes.push(m) }), null);
  assert.ok(notes.some((m) => /repo look unavailable/.test(m)), 'the fallback is logged');
  assert.ok(!readdirSync(baseDir).some((n) => n.startsWith(`${REPO_LOOK_DIRNAME}-`)), 'no checkout left behind');
  assert.equal(await registered(projectDir, `${REPO_LOOK_DIRNAME}-`), false, 'nothing registered on the project');
});

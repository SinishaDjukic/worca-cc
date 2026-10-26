// test/secret-paths.test.mjs — the one secret-path list (plans/core-protection-layer-design.md §4.6) and the sandbox
// upload overlay that drops matching untracked and changed files (plan Task 12).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SECRET_PATHS, secretPathsFor, isSecretPath, isSecretPathList, maskPlan } from '../src/core/secret-paths.mjs';
import { isProtectedBasename } from '../src/core/ask/tools.mjs';
import { GUARDRAIL_PRESETS } from '../src/core/guardrails.mjs';
import { credentialReason } from '../src/core/ask/show-files.mjs';
import { SECURE_PROTECTED_PATHS } from '../src/core/diff-anchor.mjs';
import { overlayFiles, overlaySecretLines } from '../src/core/exec-env/git-transfer.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { settingEntry } from '../src/core/settings-cascade.mjs';
import { git, scratchDirs, fixture as makeFixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';

const POSIX = { skip: process.platform === 'win32' };
const { tmp, cleanup } = scratchDirs(); after(cleanup);
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('defaults: .env*, *.pem, *.key, .npmrc, .netrc and id_* at any depth; ordinary names are not secrets', () => {
  assert.deepEqual([...DEFAULT_SECRET_PATHS], ['.env*', '*.pem', '*.key', '.npmrc', '.netrc', 'id_*']);
  assert.ok(Object.isFrozen(DEFAULT_SECRET_PATHS));
  for (const hit of ['a/b/.env.local', '.env', 'id_ed25519', 'deploy/key.pem', '.npmrc', 'x/.netrc', 'tls/server.key']) assert.ok(isSecretPath(hit), hit);
  for (const miss of ['src/env.ts', 'README.md', 'key.txt', 'pem', '.env/README.md']) assert.ok(!isSecretPath(miss), miss);
  assert.ok(!isSecretPath('x', []));
  assert.ok(isSecretPath('a/secrets/t.txt', ['**/secrets/**']), 'slash patterns match the whole path');
  assert.ok(!isSecretPath('.ssh/id_rsa', ['~/.ssh/**']), '~/ and // patterns never match a project path');
  assert.ok(isSecretPath('x.key', ['**/x.key']) && isSecretPath('a/b/x.key', ['**/x.key']), 'a leading **/ is any dirs, or none');
  assert.ok(isSecretPath('a/b/c', ['a/**']) && isSecretPath('a/b/c', ['a/*/c']) && !isSecretPath('a/b/d/c', ['a/*/c']), '* stays in one segment');
  assert.ok(!isSecretPath('ab/c', ['a*c']) && isSecretPath('a.b+c', ['a.b+c']) && !isSecretPath('aXb+c', ['a.b+c']), 'regex characters are literal');
});

test('matching ignores case: .ENV, Server.PEM and ID_RSA name the same files on macOS and Windows', () => {
  for (const hit of ['config/.ENV', 'certs/Server.PEM', 'ID_RSA', '.NpmRc']) assert.ok(isSecretPath(hit), hit);
  assert.ok(isSecretPath('Infra/Prod.TFVARS', ['infra/*.tfvars']), 'a project pattern too');
  assert.ok(!isSecretPath('src/Env.ts'));
});

test('matching stays linear: a pattern full of stars against a long name answers at once', () => {
  const name = 'a'.repeat(200);
  const t0 = performance.now();
  assert.ok(!isSecretPath(name, ['*a'.repeat(8) + '*b']));
  assert.ok(!isSecretPath(`d/${name}`, ['**/' + '*a'.repeat(8) + '*b']));
  assert.ok(isSecretPath(name, ['*a'.repeat(8) + '*']));
  assert.ok(performance.now() - t0 < 50, `took ${Math.round(performance.now() - t0)} ms`);
});

test('project additions: secretPathsFor adds the project setting to the defaults, once', () => {
  assert.deepEqual(secretPathsFor({}), [...DEFAULT_SECRET_PATHS]);
  assert.deepEqual(secretPathsFor(null), [...DEFAULT_SECRET_PATHS]);
  const list = secretPathsFor({ secretPaths: ['*.tfvars', '.env*', ' config/prod.json '] });
  assert.ok(list.includes('*.tfvars'));
  assert.ok(list.includes('config/prod.json'));
  assert.equal(list.filter((p) => p === '.env*').length, 1);
  assert.ok(isSecretPath('infra/prod.tfvars', list));
  assert.deepEqual(secretPathsFor({ secretPaths: 'oops' }), [...DEFAULT_SECRET_PATHS], 'a malformed setting adds nothing');
});

test('secretPaths is a project setting: a list of single-line patterns', () => {
  assert.ok(isSecretPathList([]));
  assert.ok(isSecretPathList(['*.tfvars']));
  for (const bad of ['*.tfvars', [''], ['  '], ['a\nb'], [1], Array(201).fill('x')]) assert.ok(!isSecretPathList(bad), JSON.stringify(bad).slice(0, 40));
  // A pattern that can never match a project file is refused, not silently kept: absolute, ./, a folder, a backslash.
  for (const never of ['~/.ssh/x', '/config/x', './x', 'secrets/', 'a\\b']) assert.ok(!isSecretPathList([never]), never);
  assert.ok(isSecretPathList(['.env.local', 'config/**/*.json', 'secrets/**']));
  const entry = settingEntry('secretPaths');
  assert.ok(entry, 'the cascade knows secretPaths');
  assert.deepEqual(entry.default, []);
  assert.ok(entry.validate(['*.tfvars']));
  assert.ok(!entry.validate('*.tfvars'));
});

test('one matcher: ask/tools re-exports it, and every surface builds from the defaults', () => {
  assert.equal(isProtectedBasename, isSecretPath);
  for (const p of DEFAULT_SECRET_PATHS) {
    assert.ok(GUARDRAIL_PRESETS.normal.protectedPaths.includes(p), `normal guardrails: ${p}`);
    assert.ok(GUARDRAIL_PRESETS.secure.protectedPaths.includes(p), `secure guardrails: ${p}`);
    assert.ok(SECURE_PROTECTED_PATHS.includes(p), `diff anchors: ${p}`);
  }
  for (const f of ['.npmrc', 'a/.netrc', 'id_ecdsa', 'k/x.key']) assert.ok(credentialReason(f), `show-files: ${f}`);
});

test('one list: the literal \'*.pem\' appears only in src/core/secret-paths.mjs', () => {
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(m?js|cjs)$/.test(name) && /'\*\.pem'/.test(readFileSync(p, 'utf8'))) hits.push(relative(ROOT, p).split('\\').join('/'));
    }
  };
  walk(join(ROOT, 'src'));
  assert.deepEqual(hits, ['src/core/secret-paths.mjs']);
});

/** A repo with a committed .env, an untracked secret, a changed tracked file and an ordinary untracked file. */
function secretRepo() {
  const repo = tmp('worca-secret-repo-');
  git(repo, 'init', '-q', '-b', 'main'); git(repo, 'config', 'user.email', 't@t'); git(repo, 'config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'base');
  writeFileSync(join(repo, '.env'), 'TOKEN=host-only\n');
  writeFileSync(join(repo, 'a.txt'), 'ordinary\n');
  return repo;
}

test('overlay drops untracked secrets: .env stays home, a.txt goes, and the run log names it once', POSIX, async () => {
  const repo = secretRepo();
  const out = await overlayFiles({ worktreeDir: repo });
  assert.deepEqual(out.files, ['a.txt']);
  assert.deepEqual(out.masked, ['.env']);
  assert.deepEqual(out.trackedSecrets, []);
  assert.deepEqual(overlaySecretLines(out), [{ level: 'warn', text: 'sandbox upload: 1 secret file kept on this machine: .env' }]);
});

test('overlay: changed tracked secrets, project additions and secrets inside a mount stay home too', POSIX, async () => {
  const repo = secretRepo();
  writeFileSync(join(repo, 'prod.tfvars'), 'k=v\n');
  mkdirSync(join(repo, 'mnt'), { recursive: true });
  writeFileSync(join(repo, 'mnt', '.gitignore'), '*\n');
  writeFileSync(join(repo, 'mnt', 'note.md'), 'n\n');
  writeFileSync(join(repo, 'mnt', 'deploy.pem'), 'PEM\n');
  const out = await overlayFiles({ worktreeDir: repo, injected: ['mnt'], secretPaths: secretPathsFor({ secretPaths: ['*.tfvars'] }) });
  assert.deepEqual(out.files, ['a.txt']);
  assert.deepEqual(out.mounts, ['mnt/.gitignore', 'mnt/note.md']);
  assert.deepEqual(out.masked, ['.env', 'mnt/deploy.pem', 'prod.tfvars']);
  assert.match(overlaySecretLines(out)[0].text, /^sandbox upload: 3 secret files kept on this machine: \.env, mnt\/deploy\.pem, prod\.tfvars$/);
});

test('tracked secret is warned about, not masked: a committed .env is in the bundle already', POSIX, async () => {
  const repo = secretRepo();
  git(repo, 'add', '.env'); git(repo, 'commit', '-qm', 'oops');
  let out = await overlayFiles({ worktreeDir: repo });
  assert.deepEqual(out.trackedSecrets, ['.env']);
  assert.deepEqual(out.masked, []);
  const lines = overlaySecretLines(out);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /^sandbox upload: 1 committed file looks like a secret and reaches the sandbox with the git history: \.env\. Deleting a file in a new commit keeps it in the older ones: rewrite the history/);
  writeFileSync(join(repo, '.env'), 'TOKEN=changed\n');                       // changed: the new content stays home
  out = await overlayFiles({ worktreeDir: repo });
  assert.deepEqual(out.masked, ['.env']);
  assert.deepEqual(out.trackedSecrets, ['.env']);
  assert.deepEqual(overlaySecretLines({ masked: [], trackedSecrets: [] }), []);
});

test('a secret committed once and deleted later is named: the bundle carries the branch\'s older commits (audit 2.9)', POSIX, async () => {
  const repo = secretRepo();
  git(repo, 'add', '.env'); git(repo, 'commit', '-qm', 'oops');
  git(repo, 'rm', '-q', '.env'); git(repo, 'commit', '-qm', 'remove the key');
  const out = await overlayFiles({ worktreeDir: repo });
  assert.deepEqual(out.trackedSecrets, []);
  assert.deepEqual(out.historySecrets, ['.env']);
  const lines = overlaySecretLines(out);
  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /^sandbox upload: 1 file that looks like a secret was deleted from the branch but is still in its older commits, which reach the sandbox with the git history: \.env\. Deleting a file in a new commit keeps it in the older ones: rewrite the history/);
  git(repo, 'checkout', '-qb', 'other', 'HEAD~2');                      // a branch that never had it: nothing to name
  assert.deepEqual((await overlayFiles({ worktreeDir: repo })).historySecrets, []);
});

test('overlay: a secret only staged is not in the bundle (HEAD), so it is masked, never called committed; a staged new file goes', POSIX, async () => {
  const repo = secretRepo();
  writeFileSync(join(repo, 'staged.txt'), 'new\n');
  git(repo, 'add', '.env', 'staged.txt');
  const out = await overlayFiles({ worktreeDir: repo });
  assert.deepEqual(out.trackedSecrets, [], 'not committed: not in the git bundle');
  assert.deepEqual(out.masked, ['.env']);
  assert.deepEqual(out.files, ['a.txt', 'staged.txt']);
});

test('later uploads keep secrets home too: a .env written into the pipeline folder, and one in a script folder', POSIX, async () => {
  const f = makeFixture(tmp);
  const logs = [];
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { log: (level, text) => logs.push({ level, text }) }));
  await env.start();
  try {
    writeFileSync(join(f.pipelineDir, '.env'), 'TOKEN=host-only\n');
    writeFileSync(join(f.pipelineDir, 'plan.md'), 'plan\n');
    await env.beforeSpawn();
    assert.equal(readFileSync(join(env.sb(f.pipelineDir), 'plan.md'), 'utf8'), 'plan\n');
    assert.equal(existsSync(join(env.sb(f.pipelineDir), '.env')), false);
    const scripts = tmp('worca-script-dir-');
    writeFileSync(join(scripts, 'run.sh'), 'echo hi\n'); writeFileSync(join(scripts, 'deploy.PEM'), 'PEM\n');
    await env.uploadTrees([scripts]);
    assert.equal(existsSync(join(env.sb(scripts), 'run.sh')), true);
    assert.equal(existsSync(join(env.sb(scripts), 'deploy.PEM')), false);
    assert.equal(logs.filter((l) => /secret file kept on this machine: .*\.env$/.test(l.text)).length, 1);
    await env.beforeSpawn();
    assert.equal(logs.filter((l) => /secret file kept on this machine: .*\.env$/.test(l.text)).length, 1, 'named once');
  } finally { await env.close('test'); }
});

test('the sandbox never receives an untracked secret, and the run log says so once', POSIX, async () => {
  const f = makeFixture(tmp);
  writeFileSync(join(f.repo, '.env.local'), 'TOKEN=host-only\n');
  writeFileSync(join(f.repo, 'id_ed25519'), 'PRIVATE\n');
  const logs = [];
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { log: (level, text) => logs.push({ level, text }) }));
  await env.start();
  try {
    const sbRepo = env.sb(f.repo);
    assert.equal(readFileSync(join(sbRepo, 'new.txt'), 'utf8'), 'untracked\n');
    assert.equal(existsSync(join(sbRepo, '.env.local')), false);
    assert.equal(existsSync(join(sbRepo, 'id_ed25519')), false);
    const lines = logs.filter((l) => l.text.startsWith('sandbox upload:'));
    assert.deepEqual(lines, [{ level: 'warn', text: 'sandbox upload: 2 secret files kept on this machine: .env.local, id_ed25519' }]);
  } finally { await env.close('test'); }
});

test('the project\'s own secretPaths reach the sandbox upload: an untracked prod.tfvars stays home', POSIX, async () => {
  const f = makeFixture(tmp);
  writeFileSync(join(f.repo, 'prod.tfvars'), 'k=v\n');
  const logs = [];
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-') });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, { secretPaths: [...DEFAULT_SECRET_PATHS, '*.tfvars'], log: (level, text) => logs.push({ level, text }) }));
  await env.start();
  try {
    assert.equal(existsSync(join(env.sb(f.repo), 'prod.tfvars')), false);
    assert.deepEqual(logs.filter((l) => l.text.startsWith('sandbox upload:')),
      [{ level: 'warn', text: 'sandbox upload: 1 secret file kept on this machine: prod.tfvars' }]);
  } finally { await env.close('test'); }
});

test('maskPlan lists the existing matching paths, skipping .git and node_modules, never following links', POSIX, async () => {
  const dir = tmp('worca-mask-');
  mkdirSync(join(dir, 'a', 'b'), { recursive: true }); mkdirSync(join(dir, 'node_modules', 'p'), { recursive: true });
  writeFileSync(join(dir, '.env'), 'x'); writeFileSync(join(dir, 'a', 'b', 'k.pem'), 'x'); writeFileSync(join(dir, 'a', 'ok.txt'), 'x');
  writeFileSync(join(dir, 'node_modules', 'p', 'test.key'), 'x');
  const outside = tmp('worca-mask-out-'); writeFileSync(join(outside, 'id_rsa'), 'x');
  symlinkSync(outside, join(dir, 'linked'));
  assert.deepEqual(await maskPlan(dir), ['.env', 'a/b/k.pem']);
  assert.deepEqual(await maskPlan(dir, secretPathsFor({ secretPaths: ['ok.txt'] })), ['.env', 'a/b/k.pem', 'a/ok.txt']);
  assert.deepEqual(await maskPlan(join(dir, 'missing')), []);
});

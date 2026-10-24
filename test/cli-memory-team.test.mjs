// test/cli-memory-team.test.mjs — `worca memory team status|on|off|sync|rm|resolve` against a real bare origin.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { useGitSandbox, makeOrigin, cloneAs, branchFiles, git } from './helpers/metrics-git.mjs';
import { gitDir } from './helpers/git-dir.mjs';
import { addProject } from '../src/core/projects.mjs';
import { memoryRoot, projectScope, writeMemory } from '../src/core/memory-store.mjs';
import { queueTeamChanges, TEAM_MEMORY_BRANCH } from '../src/core/memory-team.mjs';

const skip = process.platform === 'win32' ? 'sh not portable to win32' : false;
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli', 'worca-cc.mjs');
const root = mkdtempSync(join(tmpdir(), 'worca-cli-team-'));
useGitSandbox(before, after);
const home = useTempHome(after);
after(() => rmSync(root, { recursive: true, force: true }));
const runCli = (args) => new Promise((res) => {
  const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, WORCA_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.on('exit', (code) => res({ code, out, err }));
});
let bare, dir, key, noOrigin;
before(async () => {
  bare = makeOrigin(root, 'shop');
  dir = cloneAs(root, 'm', bare, 'shop');
  key = (await addProject({ name: 'shop', path: dir })).find((p) => p.name === 'shop').key;
  noOrigin = gitDir('cli-team-plain');
  await addProject({ name: 'plain', path: noOrigin });
});

test('help and usage', { skip }, async () => {
  assert.equal((await runCli(['memory'])).code, 0);
  assert.equal((await runCli(['memory', 'bogus'])).code, 2);
  assert.match((await runCli(['memory', 'team', 'status', '--project', join(root, 'nowhere')])).err, /not a registered project/);
});

test('on refuses a project without origin; on / status / sync / rm / off round-trip on one with origin', { skip }, async () => {
  const no = await runCli(['memory', 'team', 'on', '--project', noOrigin]);
  assert.equal(no.code, 1);
  assert.match(no.err, /origin.*\(NO_ORIGIN\)/);
  assert.equal((await runCli(['memory', 'team', 'on', '--project', dir])).code, 0);
  assert.equal(JSON.parse((await runCli(['memory', 'team', 'status', '--project', dir, '--json'])).out).load, 'both');
  const only = await runCli(['memory', 'team', 'on', '--team-only', '--project', dir]);
  assert.match(only.out, /runs and chats load team notes only/);
  assert.equal(JSON.parse((await runCli(['memory', 'team', 'status', '--project', dir, '--json'])).out).load, 'team');
  assert.match((await runCli(['memory', 'team', 'status', '--project', dir])).out, /on — runs and chats load team notes only/);
  assert.equal((await runCli(['memory', 'team', 'on', '--project', dir])).code, 0, 'on again: back to local and team notes');
  assert.equal(JSON.parse((await runCli(['memory', 'team', 'status', '--project', dir, '--json'])).out).load, 'both');
  await writeMemory(memoryRoot(), projectScope(key), 'cli-note', '---\nname: cli-note\ndescription: From the CLI test\n---\nBody.\n', { source: 'user' });
  await queueTeamChanges(key, ['cli-note'], { flush: false });
  const s = await runCli(['memory', 'team', 'sync', '--project', dir, '--json']);
  assert.equal(s.code, 0, s.err);
  assert.ok(branchFiles(bare, TEAM_MEMORY_BRANCH).includes('.worca-memory/notes/cli-note.md'));
  const rm = await runCli(['memory', 'team', 'rm', 'cli-note', '--project', dir, '--json']);
  assert.equal(rm.code, 0, rm.err);
  assert.equal(JSON.parse(rm.out).flush.pushed, 1, 'the team delete is pushed by this command');
  assert.ok(!branchFiles(bare, TEAM_MEMORY_BRANCH).includes('.worca-memory/notes/cli-note.md'), 'removed from the team');
  assert.equal((await runCli(['memory', 'team', 'off', '--project', dir])).code, 0);
  assert.equal(JSON.parse((await runCli(['memory', 'team', 'status', '--project', dir, '--json'])).out).enabled, false);
});

test('sync says when the fetch half fails (exit 1, fetchError) — nothing queued, origin unreachable; rm of a name the team never had pushes nothing', { skip }, async () => {
  const { renameSync } = await import('node:fs');
  assert.equal((await runCli(['memory', 'team', 'on', '--project', dir])).code, 0);
  await writeMemory(memoryRoot(), projectScope(key), 'cli-two', '---\nname: cli-two\ndescription: Starts the branch\n---\nBody.\n', { source: 'user' });
  await queueTeamChanges(key, ['cli-two'], { flush: false });
  assert.equal((await runCli(['memory', 'team', 'sync', '--project', dir])).code, 0);
  const rm = await runCli(['memory', 'team', 'rm', 'never-on-the-team', '--project', dir, '--json']);
  assert.equal(rm.code, 0, rm.err);
  assert.equal(JSON.parse(rm.out).flush.pushed, 0, 'nothing on the branch changed');
  renameSync(bare, `${bare}.away`);
  try {
    const s = await runCli(['memory', 'team', 'sync', '--project', dir, '--json']);
    assert.equal(s.code, 1, s.out);
    assert.match(JSON.parse(s.out).fetchError, /git|repository|fatal/i);
  } finally { renameSync(`${bare}.away`, bare); }
  assert.equal((await runCli(['memory', 'team', 'off', '--project', dir])).code, 0);
});

test('resolve: shows both versions, then --take-team replaces mine here and --keep-mine shares mine over the team\'s', { skip }, async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { readMemory } = await import('../src/core/memory-store.mjs');
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Teammate', '-c', 'user.email=t@example.test', ...args], { cwd, encoding: 'utf8' });
  const mate = cloneAs(root, 't', bare, 'shop');
  const teammatePush = (name, body) => {
    git(mate, 'fetch', '-q', 'origin', TEAM_MEMORY_BRANCH);
    git(mate, 'checkout', '-q', '-B', 'wm', 'FETCH_HEAD');
    mkdirSync(join(mate, '.worca-memory', 'notes'), { recursive: true });
    writeFileSync(join(mate, '.worca-memory', 'notes', `${name}.md`), `---\nname: ${name}\ndescription: The team's hook\n---\n${body}\n`);
    git(mate, 'add', '-A');
    git(mate, 'commit', '-q', '-m', `memory: update ${name}`);
    git(mate, 'push', '-q', 'origin', `wm:refs/heads/${TEAM_MEMORY_BRANCH}`);
  };
  const branchText = (name) => execFileSync('git', ['--git-dir', bare, 'show', `${TEAM_MEMORY_BRANCH}:.worca-memory/notes/${name}.md`], { encoding: 'utf8' });
  assert.equal((await runCli(['memory', 'team', 'on', '--project', dir])).code, 0);
  try {
    teammatePush('clash-a', 'Theirs A.');
    teammatePush('clash-b', 'Theirs B.');
    await writeMemory(memoryRoot(), projectScope(key), 'clash-a', '---\nname: clash-a\ndescription: My hook\n---\nMine A.\n', { source: 'user' });
    await writeMemory(memoryRoot(), projectScope(key), 'clash-b', '---\nname: clash-b\ndescription: My hook\n---\nMine B.\n', { source: 'user' });

    const show = await runCli(['memory', 'team', 'resolve', 'clash-a', '--project', dir]);
    assert.equal(show.code, 0, show.err);
    assert.match(show.out, /Mine A\./);
    assert.match(show.out, /Theirs A\./);
    assert.match(show.out, /--keep-mine.*--take-team/s);
    assert.match((await readMemory(memoryRoot(), projectScope(key), 'clash-a')).body, /Mine A\./, 'showing changes nothing');

    const take = await runCli(['memory', 'team', 'resolve', 'clash-a', '--take-team', '--project', dir]);
    assert.equal(take.code, 0, take.err);
    assert.match((await readMemory(memoryRoot(), projectScope(key), 'clash-a')).body, /Theirs A\./, 'my copy is the team\'s now');
    assert.match(branchText('clash-a'), /Theirs A\./, 'the team\'s version is untouched');

    const keep = await runCli(['memory', 'team', 'resolve', 'clash-b', '--keep-mine', '--project', dir, '--json']);
    assert.equal(keep.code, 0, keep.err);
    assert.deepEqual(JSON.parse(keep.out).shared, ['clash-b']);
    assert.match(branchText('clash-b'), /Mine B\./, 'my version replaced the team\'s');

    assert.equal((await runCli(['memory', 'team', 'resolve', 'clash-b', '--keep-mine', '--take-team', '--project', dir])).code, 2, 'one choice only');
    assert.equal((await runCli(['memory', 'team', 'resolve', '--project', dir])).code, 2, 'a name is required');
    const none = await runCli(['memory', 'team', 'resolve', 'no-such-note', '--project', dir]);
    assert.equal(none.code, 1);
    assert.match(none.err, /not a local note/);
  } finally {
    assert.equal((await runCli(['memory', 'team', 'off', '--project', dir])).code, 0);
  }
});

test('E10: `worca add` of a repo whose origin has worca-memory prints one hint and leaves the switch off; others print none', { skip }, async () => {
  const shared = makeOrigin(root, 'cliteam');
  const mate = cloneAs(root, 'mate', shared, 'cliteam');
  git(mate, 'checkout', '-q', '--orphan', TEAM_MEMORY_BRANCH);
  git(mate, 'commit', '-q', '--allow-empty', '-m', 'team memory');
  git(mate, 'push', '-q', 'origin', TEAM_MEMORY_BRANCH);
  const mine = cloneAs(root, 'cli-me', shared, 'cliteam');
  const r = await runCli(['add', 'cliteam', '--path', mine]);
  assert.equal(r.code, 0, r.err);
  const hint = r.out.split('\n').filter((l) => /team memory is available/.test(l));
  assert.deepEqual(hint, [`team memory is available for this repo — \`worca memory team on --project ${JSON.stringify(mine)}\``]);
  assert.equal(JSON.parse((await runCli(['memory', 'team', 'status', '--project', mine, '--json'])).out).enabled, false, 'only a hint');
  const lonely = cloneAs(root, 'cli-me', makeOrigin(root, 'clilonely'), 'clilonely');
  const quiet = await runCli(['add', 'clilonely', '--path', lonely]);
  assert.equal(quiet.code, 0, quiet.err);
  assert.doesNotMatch(quiet.out, /team memory/);
});

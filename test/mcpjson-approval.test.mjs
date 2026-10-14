// test/mcpjson-approval.test.mjs
// A project's committed .mcp.json servers with their status for a non-Claude run, and the Approve
// action that names them in the project's untracked .claude/settings.local.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { committedMcpStatus, approveCommittedMcp, localSettingsTracked } from '../src/core/mcpjson-approval.mjs';

// The machine's own global gitignore must not decide what these repositories ignore.
process.env.GIT_CONFIG_GLOBAL = '/dev/null';

const tmp = (p) => mkdtemp(join(tmpdir(), p));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });

async function project({ servers = { a: { command: 'a' }, b: { command: 'b' }, c: { command: 'c' } }, local, project: committed, repo = true } = {}) {
  const dir = await tmp('worca-mcpjson-');
  const home = await tmp('worca-mcpjson-home-');
  if (repo) git(dir, 'init', '-q');
  await writeFile(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: servers }));
  await mkdir(join(dir, '.claude'), { recursive: true });
  if (committed) await writeFile(join(dir, '.claude', 'settings.json'), JSON.stringify(committed));
  if (local !== undefined) await writeFile(join(dir, '.claude', 'settings.local.json'), typeof local === 'string' ? local : JSON.stringify(local));
  return { dir, home };
}
const statusOf = async (p) => Object.fromEntries((await committedMcpStatus(p.dir, { homeDir: p.home })).servers.map((s) => [s.name, s.status]));
const readLocal = async (p) => JSON.parse(await readFile(join(p.dir, '.claude', 'settings.local.json'), 'utf8'));

test('status: each server approved, unapproved or disabled by the run\'s rules; a committed approval does not count', async () => {
  const p = await project({ project: { enabledMcpjsonServers: ['a'], disabledMcpjsonServers: ['c'] }, local: { enabledMcpjsonServers: ['b'] } });
  assert.deepEqual(await statusOf(p), { a: 'unapproved', b: 'approved', c: 'disabled' });
  assert.equal((await committedMcpStatus(p.dir, { homeDir: p.home })).canApprove, true);
});

test('status: no .mcp.json lists nothing; an invalid one is named', async () => {
  const none = await tmp('worca-mcpjson-none-');
  assert.deepEqual(await committedMcpStatus(none, { homeDir: none }), { servers: [], canApprove: false, error: null });
  const bad = await project();
  await writeFile(join(bad.dir, '.mcp.json'), '{ nope');
  assert.ok((await committedMcpStatus(bad.dir, { homeDir: bad.home })).error);
});

test('approve: writes a new settings.local.json, keeps it out of git, and the server reads approved', async () => {
  const p = await project();
  await approveCommittedMcp(p.dir, ['a']);
  assert.deepEqual(await readLocal(p), { enabledMcpjsonServers: ['a'] });
  assert.equal(git(p.dir, 'check-ignore', '.claude/settings.local.json').trim(), '.claude/settings.local.json', 'excluded through info/exclude');
  assert.equal(git(p.dir, 'status', '--porcelain', '--untracked-files=all').includes('settings.local.json'), false);
  assert.equal((await statusOf(p)).a, 'approved');
});

test('approve: keeps the file\'s other keys and drops the server from its own disabled list', async () => {
  const p = await project({ local: { permissions: { allow: ['Bash(ls)'] }, enabledMcpjsonServers: ['b'], disabledMcpjsonServers: ['a', 'c'] } });
  await approveCommittedMcp(p.dir, ['a']);
  assert.deepEqual(await readLocal(p), { permissions: { allow: ['Bash(ls)'] }, enabledMcpjsonServers: ['b', 'a'], disabledMcpjsonServers: ['c'] });
  assert.deepEqual(await statusOf(p), { a: 'approved', b: 'approved', c: 'disabled' });
});

test('approve: refuses a tracked settings.local.json, an invalid one, and a name the .mcp.json does not define', async () => {
  const tracked = await project({ local: {} });
  git(tracked.dir, 'add', '-f', '.claude/settings.local.json');
  assert.equal(localSettingsTracked(tracked.dir), true);
  assert.equal((await committedMcpStatus(tracked.dir, { homeDir: tracked.home })).canApprove, false);
  await assert.rejects(approveCommittedMcp(tracked.dir, ['a']), { code: 'LOCAL_TRACKED' });
  assert.deepEqual(await readLocal(tracked), {}, 'left as it was');

  const invalid = await project({ local: '[1]' });
  await assert.rejects(approveCommittedMcp(invalid.dir, ['a']), { code: 'LOCAL_INVALID' });
  assert.equal(await readFile(join(invalid.dir, '.claude', 'settings.local.json'), 'utf8'), '[1]');

  const p = await project();
  await assert.rejects(approveCommittedMcp(p.dir, ['zzz']), { code: 'UNKNOWN_SERVER' });
  await assert.rejects(approveCommittedMcp(p.dir, []), { code: 'UNKNOWN_SERVER' });
});

test('approve: outside a git repository it still writes the file', async () => {
  const p = await project({ repo: false });
  assert.equal(localSettingsTracked(p.dir), false);
  await approveCommittedMcp(p.dir, ['b']);
  assert.deepEqual(await readLocal(p), { enabledMcpjsonServers: ['b'] });
});

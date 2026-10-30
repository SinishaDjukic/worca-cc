// test/native-mcp.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { listNativeMcpServers } from '../src/core/native-mcp.mjs';
import { localScopeServers, heldCommittedMcp, mergeMcpConfigs } from '../src/core/run-context.mjs';

const git = (dir, ...args) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'ignore' });
const writeMcp = (dir, mcp) => writeFileSync(join(dir, '.mcp.json'), JSON.stringify({ mcpServers: mcp }));
const fixture = (mcp, claudeJson) => {
  const proj = mkdtempSync(join(tmpdir(), 'nm-p-')), home = mkdtempSync(join(tmpdir(), 'nm-h-'));
  if (mcp) writeMcp(proj, mcp);
  if (claudeJson) writeFileSync(join(home, '.claude.json'), JSON.stringify(claudeJson(proj)));
  return { proj, home };
};
const commit = (proj) => { git(proj, 'init', '-q'); git(proj, 'add', '.mcp.json'); git(proj, 'commit', '-qm', 'init'); };
const approvals = async (proj, home, extra = {}) =>
  (await listNativeMcpServers({ members: [{ dir: proj, workMode: 'git' }], homeDir: home, single: true, managed: [], ...extra })).map((s) => [s.name, s.approval]);

test('project .mcp.json -> project; LOCAL scope -> personal; top-level ~/.claude.json mcpServers are NOT listed (cycle-2 #1)', async () => {
  const { proj, home } = fixture({ linear: {}, sentry: {} }, (p) => ({
    mcpServers: { userwide: {} },                                         // user scope: a run never provides it
    projects: { [resolve(p)]: { mcpServers: { mine: { command: 'x' } } }, '/elsewhere': { mcpServers: { other: {} } } },
  }));
  const out = await listNativeMcpServers({ members: [{ dir: proj, workMode: 'git' }, { dir: join(proj, 'missing'), workMode: 'git' }], homeDir: home });
  assert.deepEqual(out, [
    { name: 'linear', group: 'project', approval: 'approved' },
    { name: 'sentry', group: 'project', approval: 'approved' },
    { name: 'mine', group: 'personal', approval: 'approved' },
  ]);
});

// Cycle-3 M1: the run asks for approval ONLY for a server identical to the worktree's COMMITTED .mcp.json (it is then `nativeOnly`);
// every other server is written into --mcp-config and provided whatever its approval.
test('single mode, UNTRACKED .mcp.json (not a git repo, or never committed): every server is approved — the run provides them all', async () => {
  const { proj, home } = fixture({ linear: {}, wip: {} });
  assert.deepEqual(await approvals(proj, home), [['linear', 'approved'], ['wip', 'approved']]);          // not a git repo
  git(proj, 'init', '-q');                                                                                  // a repo, file still untracked
  assert.deepEqual(await approvals(proj, home), [['linear', 'approved'], ['wip', 'approved']]);
});

test('single mode, COMMITTED and identical: approval decides (unapproved / approved / disabled)', async () => {
  const { proj, home } = fixture({ linear: {}, wip: {} });
  commit(proj);
  assert.deepEqual(await approvals(proj, home), [['linear', 'unapproved'], ['wip', 'unapproved']]);
  mkdirSync(join(proj, '.claude'));
  writeFileSync(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['linear'], disabledMcpjsonServers: ['wip'] }));   // untracked => counts
  assert.deepEqual(await approvals(proj, home), [['linear', 'approved'], ['wip', 'disabled']]);
});

test('single mode, COMMITTED but edited locally: the edited server is provided (approved); an untouched one still needs approval', async () => {
  const { proj, home } = fixture({ linear: {}, wip: {} });
  commit(proj);
  writeMcp(proj, { linear: { command: 'changed' }, wip: {} });                                              // differs from HEAD => generated into --mcp-config
  assert.deepEqual(await approvals(proj, home), [['linear', 'approved'], ['wip', 'unapproved']]);
});

test('workspace mode: every .mcp.json server is generated and provided', async () => {
  const { proj, home } = fixture({ linear: {} });
  commit(proj);
  const ws = await listNativeMcpServers({ members: [{ dir: proj, workMode: 'git' }], homeDir: home, single: false, managed: [] });
  assert.ok(ws.every((s) => s.approval === 'approved'));
});

test('a local-scope server with the same raw name as a held project server, but a DIFFERENT definition, makes the name choosable (the run provides the renamed local copy)', async () => {
  const { proj, home } = fixture({ wip: {} }, (p) => ({ projects: { [resolve(p)]: { mcpServers: { wip: { command: 'mine' } } } } }));
  commit(proj);
  assert.deepEqual(await approvals(proj, home), [['wip', 'approved']]);
});

test('a local-scope server IDENTICAL to the committed entry is held like the project one (cycle-4 m2: both scopes are compared)', async () => {
  // `wip` is committed, then removed from the real-dir .mcp.json, so only the local-scope copy competes for the name
  // (a same-name collision across scopes is renamed by mergeMcpConfigs' `taken` rule — see risk 5).
  const { proj, home } = fixture({ wip: {} }, (p) => ({ projects: { [resolve(p)]: { mcpServers: { wip: {}, mine: { command: 'm' } } } } }));
  commit(proj);
  writeMcp(proj, {});
  assert.deepEqual(await approvals(proj, home), [['mine', 'approved'], ['wip', 'unapproved']]);
  const wt = mkdtempSync(join(tmpdir(), 'nm-wt-'));                                                          // the worktree = the commit
  writeMcp(wt, { wip: {} });
  const merged = await mergeMcpConfigs({ members: [{ projectKey: 'p', projectName: 'p', projectDir: proj, worktreeDir: wt }], homeDir: home, isWorkspace: false });
  assert.ok(merged.nativeOnly.includes('wip'));                                                              // parity: the run gates it too
});

test('folder mode, single: the real-dir .mcp.json is the committed copy (the run copies the folder), so approval applies with git:false (cycle-4 m1)', async () => {
  const { proj, home } = fixture({ linear: {}, wip: {} });                                                   // not a git repo
  const folder = (extra) => listNativeMcpServers({ members: [{ dir: proj, workMode: 'folder' }], homeDir: home, single: true, managed: [], ...extra })
    .then((r) => r.map((s) => [s.name, s.approval]));
  assert.deepEqual(await folder(), [['linear', 'unapproved'], ['wip', 'unapproved']]);
  mkdirSync(join(proj, '.claude'));
  writeFileSync(join(proj, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['linear'] }));
  assert.deepEqual(await folder(), [['linear', 'approved'], ['wip', 'unapproved']]);
});

test('heldCommittedMcp is consistent with mergeMcpConfigs: held names are exactly nativeOnly minus approved, edited/untracked servers are generated', async () => {
  const { proj, home } = fixture({ same: {}, edited: {} });
  commit(proj);
  const wt = mkdtempSync(join(tmpdir(), 'nm-wt-'));                                                          // the run's committed copy (its worktree)
  writeMcp(wt, { same: {}, edited: {} });
  writeMcp(proj, { same: {}, edited: { command: 'x' }, fresh: {} });
  const merged = await mergeMcpConfigs({ members: [{ projectKey: 'p', projectName: 'p', projectDir: proj, worktreeDir: wt }], homeDir: home, isWorkspace: false });
  assert.deepEqual(merged.nativeOnly, ['same']);
  assert.deepEqual(Object.keys(merged.servers).sort(), ['edited', 'fresh']);
  for (const opts of [{ managed: [] }, { managed: [], committedDir: wt }]) {                                 // pre-run (git HEAD) and run-time (worktree file)
    const held = await heldCommittedMcp(proj, home, { workMode: 'git', ...opts });
    assert.deepEqual([...held.project.keys()], ['same']);                                                    // 'edited' and 'fresh' never need approval
    assert.equal(held.personal.size, 0);
  }
});

test('localScopeServers agrees with what mergeMcpConfigs delivers for the same member (parity lock)', async () => {
  const { proj, home } = fixture(null, (p) => ({ projects: { [resolve(p)]: { mcpServers: { mine: { command: 'echo' }, bad: 'x' } } } }));
  const local = await localScopeServers(proj, home, 'git');
  const merged = await mergeMcpConfigs({ members: [{ projectKey: 'p', projectName: 'p', projectDir: proj }], homeDir: home, isWorkspace: false });
  assert.deepEqual(local, { mine: { command: 'echo' } });
  assert.deepEqual(Object.keys(merged.servers), ['mine']);
});

test('folder-mode member inside an enclosing repo: local scope is keyed by the member path, not the git root (cycle-3 m1)', async () => {
  const enclosing = mkdtempSync(join(tmpdir(), 'nm-enc-')), home = mkdtempSync(join(tmpdir(), 'nm-h-'));
  git(enclosing, 'init', '-q');
  const sub = join(enclosing, 'sub'); mkdirSync(sub);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: {
    [realpathSync(enclosing)]: { mcpServers: { rootwide: {} } },                                             // what `git rev-parse --show-toplevel` returns
    [resolve(sub)]: { mcpServers: { here: {} } },
  } }));
  assert.deepEqual(Object.keys(await localScopeServers(sub, home, 'git')), ['rootwide']);
  assert.deepEqual(Object.keys(await localScopeServers(sub, home, 'folder')), ['here']);
  const merged = await mergeMcpConfigs({ members: [{ projectKey: 'p', projectName: 'p', projectDir: sub, workMode: 'folder' }], homeDir: home, isWorkspace: false });
  assert.deepEqual(Object.keys(merged.servers), ['here']);
});

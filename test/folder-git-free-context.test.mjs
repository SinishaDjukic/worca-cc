// test/folder-git-free-context.test.mjs
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { templateRepo } from './helpers/git-dir.mjs';
import { runOpts } from '../src/core/phases.mjs';
import { mcpjsonApproval, shippedSkillNames, mergeMcpConfigs, assembleRunContext } from '../src/core/run-context.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { withNoGit } from './helpers/git-off.mjs';
import { writeCursorProjectFiles, runCursorProcess } from '../src/core/engines/cursor.mjs';
import { fakeCursor } from './helpers/fake-cursor.mjs';
import { runGeminiProcess } from '../src/core/engines/gemini.mjs';
import { fakeGemini } from './helpers/fake-gemini-family.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), `worca-ctxng-${p}-`)); dirs.push(d); return d; };
const repoOf = (tag) => { const d = templateRepo(tag, { branch: 'main', user: true, files: { 'a.txt': 'a\n' } }); dirs.push(d); return d; };
const POSIX = { skip: process.platform === 'win32' ? 'POSIX shell fixtures' : false };
/** Run `fn` against the real runner (not the mock) with the host guard off; env restored after. */
async function realSpawn(fn) {
  const prev = { WORCA_MOCK: process.env.WORCA_MOCK, WORCA_HOST_GUARD: process.env.WORCA_HOST_GUARD };
  delete process.env.WORCA_MOCK; process.env.WORCA_HOST_GUARD = '0';
  try { return await fn(); } finally { for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}

test('runOpts carries noGit for a non-git run only (git spawn opts byte-identical)', () => {
  const base = { projectDir: '/p', claudeOpts: {} };
  const args = { role: 'implementer', prompt: 'p', systemPrompt: 's', allowedTools: [] };
  assert.equal('noGit' in runOpts(base, args), false);
  assert.equal('noGit' in runOpts({ ...base, workMode: 'git' }, args), false);
  assert.equal(runOpts({ ...base, workMode: 'folder' }, args).noGit, true);
  assert.equal(runOpts({ ...base, workMode: 'none' }, args).noGit, true);
});

test('mcpjsonApproval { git: false }: no git asked; a local settings file approves in a plain folder, never inside a repo', async () => {
  const home = tmp('home');
  const plain = tmp('plain'); mkdirSync(join(plain, '.claude'));
  writeFileSync(join(plain, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['s1'] }));
  const repo = repoOf('ctxng');
  const inner = join(repo, 'inner'); mkdirSync(join(inner, '.claude'), { recursive: true });
  writeFileSync(join(inner, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['s1'] }));
  // Untracked: git answers 'approved'; { git: false } walks the folder's ancestors and stays conservative inside a repo.
  // This row fails before the change (the option is ignored today and git answers untracked).
  assert.equal((await mcpjsonApproval(inner, home, () => {}, { managed: [] }))('s1'), 'approved');
  assert.equal((await mcpjsonApproval(inner, home, () => {}, { managed: [], git: false }))('s1'), 'unapproved');
  spawnSync('git', ['-C', repo, 'add', '-A']); spawnSync('git', ['-C', repo, 'commit', '-qm', 'track local settings']);
  assert.equal((await mcpjsonApproval(plain, home, () => {}, { managed: [], git: false }))('s1'), 'approved');
  assert.equal((await mcpjsonApproval(inner, home, () => {}, { managed: [], git: false }))('s1'), 'unapproved');
  assert.equal((await mcpjsonApproval(inner, home, () => {}, { managed: [] }))('s1'), 'unapproved', 'git on: tracked, as today');
  const restore = withNoGit();                                      // git missing: P0's decided flip holds for { git: false } too
  try { assert.equal((await mcpjsonApproval(inner, home, () => {}, { managed: [], git: false }))('s1'), 'approved'); } finally { restore(); }
});

test('shippedSkillNames: the folder\'s own skills, read from the copy-time manifest', () => {
  const files = ['.claude/skills/foo/SKILL.md', '.claude/skills/foo/notes.md', '.claude/skills/bar/SKILL.md', 'notes.txt', '.claude/skillsx/y.md'];
  assert.deepEqual([...shippedSkillNames(files, join('.claude', 'skills'))].sort(), ['bar', 'foo']);
  assert.deepEqual([...shippedSkillNames(undefined, '.claude/skills')], []);
});

test('writeCursorProjectFiles { git: false } inside an enclosing repo writes the file and never touches that repo\'s info/exclude', () => {
  const repo = repoOf('ctxng-cursor');
  const copy = join(repo, 'runs', 'abcd1234', 'repos', 'site-00000001'); mkdirSync(copy, { recursive: true });
  const exclude = join(repo, '.git', 'info', 'exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  writeCursorProjectFiles(copy, { '.cursor/cli.json': '{}\n' }, { git: false });
  assert.equal(readFileSync(join(copy, '.cursor', 'cli.json'), 'utf8'), '{}\n');
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
});

test('writeCursorProjectFiles { root }: a work root inside an enclosing repo gets no line in that repo\'s info/exclude (the git ceiling)', () => {
  const repo = repoOf('ctxng-cursor-root');
  const work = join(repo, 'runs', 'abcd1234', 'work'); mkdirSync(work, { recursive: true });
  const exclude = join(repo, '.git', 'info', 'exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  writeCursorProjectFiles(work, { '.cursor/cli.json': '{}\n' }, { root: work });
  assert.equal(readFileSync(join(work, '.cursor', 'cli.json'), 'utf8'), '{}\n');
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
});

test('runCursorProcess { workRoot }: the run path passes the ceiling to the write and to the restore (enclosing repo\'s info/exclude untouched)', POSIX, async () => {
  const repo = repoOf('ctxng-cursor-wiring');
  const work = join(repo, 'runs', 'abcd1234', 'work'); mkdirSync(work, { recursive: true });
  const exclude = join(repo, '.git', 'info', 'exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  // The agent loosens the deny file, so the restore rewrites it: both writes must stop at the work root.
  const fake = fakeCursor(tmp('cursor-wiring-bin'), 'ok', { sh: `printf '{"permissions":{"deny":[]}}' > .cursor/cli.json` });
  const events = [];
  await realSpawn(() => runCursorProcess({ cwd: work, workRoot: work, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash'] }, onEvent: (e) => events.push(e) }));
  assert.match(fake.record()?.cli || '', /"deny"/, 'the deny rules reached the spawn');
  assert.ok(events.some((e) => e.type === 'stderr' && /changed \.cursor\/cli\.json/.test(e.text)), 'the restore ran');
  assert.deepEqual(JSON.parse(readFileSync(join(work, '.cursor', 'cli.json'), 'utf8')), { permissions: { deny: ['Shell(*)'] } });
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
});

test('runGeminiProcess { workRoot }: the run path passes the ceiling to its .gemini/settings.json write (enclosing repo\'s info/exclude untouched)', POSIX, async () => {
  const repo = repoOf('ctxng-gemini-wiring');
  const work = join(repo, 'runs', 'abcd1234', 'work'); mkdirSync(work, { recursive: true });
  const exclude = join(repo, '.git', 'info', 'exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const mcp = join(tmp('gemini-wiring-mcp'), 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' } } }));
  const fake = fakeGemini(tmp('gemini-wiring-bin'), 'ok');
  await realSpawn(() => runGeminiProcess({ cwd: work, workRoot: work, bin: fake.bin, prompt: 'go', mcpConfigPath: mcp }));
  assert.deepEqual(JSON.parse(fake.record()?.gemini || '{}').mcpServers?.gh?.command, 'gh-mcp', 'the servers reached the spawn');
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
});

// The wiring rows: each one fails when one link of runOpts → runClaude → mcpjson-approval / engine.run → Cursor drops
// the flag, or when run-context's two member gates are removed.
test('runClaude { noGit }: the spawn judges the folder\'s approvals without git (inside a repo the local file counts as tracked)', POSIX, async () => {
  const real = join(repoOf('ctxng-runner'), 'site'); mkdirSync(join(real, '.claude'), { recursive: true });
  writeFileSync(join(real, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['s1'] }));   // untracked
  const cwd = tmp('runner-cwd'); writeFileSync(join(cwd, '.mcp.json'), JSON.stringify({ mcpServers: { s1: { command: 's1' } } }));
  const shim = tmp('runner-bin'); const bin = join(shim, 'fake-claude.sh');
  const disabled = async (extra) => {
    const out = join(shim, `argv-${dirs.length}-${Date.now()}.txt`);
    writeFileSync(bin, `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(out)}; done\nexit 0\n`, { mode: 0o755 });
    await realSpawn(() => runClaude({ cwd, bin, prompt: 'p', mcpjsonProjectDir: real, ...extra }));
    const argv = readFileSync(out, 'utf8').split('\0').filter(Boolean);
    const i = argv.indexOf('--settings');
    return i === -1 ? [] : (JSON.parse(argv[i + 1]).disabledMcpjsonServers || []);
  };
  assert.deepEqual(await disabled({}), [], 'git run: git says untracked, the approval counts');
  assert.deepEqual(await disabled({ noGit: true }), ['s1'], 'non-git run: no git asked');
});

test('runClaude → Cursor { noGit }: engine.run forwards noGit; the .cursor file is written, the enclosing repo\'s info/exclude untouched', POSIX, async () => {
  const repo = repoOf('ctxng-cursor-run');
  const copy = join(repo, 'runs', 'abcd1234', 'repos', 'site-00000001'); mkdirSync(copy, { recursive: true });
  const exclude = join(repo, '.git', 'info', 'exclude');
  const before = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  const fake = fakeCursor(tmp('cursor-bin'), 'ok');
  await realSpawn(() => runClaude({ engine: 'cursor', cwd: copy, bin: fake.bin, prompt: 'go', permissionRules: { deny: ['Bash'] }, noGit: true }));
  assert.match(fake.record()?.cli || '', /"deny"/, 'the deny rules reached the spawn');
  assert.equal(existsSync(exclude) ? readFileSync(exclude, 'utf8') : '', before);
});

test('local-scope MCP key: a non-git member is keyed by its own path, never by the repo around it', async () => {
  const home = tmp('lhome');
  const repo = repoOf('ctxng-local');
  const sub = join(repo, 'site'); mkdirSync(sub);
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [realpathSync(repo)]: { mcpServers: { s1: { command: 'node', args: ['x.mjs'] } } } } }));
  const m = { projectKey: 'site-00000001', projectName: 'site', projectDir: sub };
  const names = async (extra) => Object.keys((await mergeMcpConfigs({ members: [{ ...m, ...extra }], homeDir: home })).servers);
  assert.deepEqual(await names({}), ['s1'], 'git mode: keyed by the git root, as Claude Code writes it');
  assert.deepEqual(await names({ workMode: 'folder' }), [], 'folder mode asks no rev-parse');
});

test('assembleRunContext: a non-git member\'s committed .mcp.json servers are judged without git (attachCommittedMcp)', async () => {
  const home = tmp('attach-home');
  const real = join(repoOf('ctxng-attach'), 'site'); mkdirSync(join(real, '.claude'), { recursive: true });
  writeFileSync(join(real, '.claude', 'settings.local.json'), JSON.stringify({ enabledMcpjsonServers: ['s1'] }));   // untracked
  const names = async (extra) => {
    const runRoot = join(tmp('attach-runs'), 'abcd1234'); const copy = join(runRoot, 'repos', 'site-00000001'); mkdirSync(copy, { recursive: true });
    writeFileSync(join(copy, '.mcp.json'), JSON.stringify({ mcpServers: { s1: { command: 'node', args: ['s1.mjs'] } } }));
    const rc = await assembleRunContext({ runRoot, homeDir: home, engine: 'cursor',
      members: [{ projectKey: 'site-00000001', projectName: 'site', projectDir: real, worktreeDir: copy, ...extra }] });
    return rc.mcpServerNames;
  };
  assert.deepEqual(await names({}), ['s1'], 'git: the untracked local approval counts');
  assert.deepEqual(await names({ workMode: 'folder' }), [], 'folder: inside a repo the local file counts as tracked');
});

test('S31: on an engine that reads .agents/skills, a folder member\'s own skill is copied, never linked to the real folder (skillMount symlink)', POSIX, async () => {
  const { assembleSkills } = await import('../src/core/run-context.mjs');
  const { lstatSync } = await import('node:fs');
  const real = tmp('skreal'); const rel = join('.agents', 'skills');
  mkdirSync(join(real, '.claude', 'skills', 'own'), { recursive: true });
  writeFileSync(join(real, '.claude', 'skills', 'own', 'SKILL.md'), '---\nname: own\n---\nmine\n');
  const mount = async (workMode) => {
    const copy = tmp(`skcopy-${workMode}`);
    const out = await assembleSkills({ target: join(copy, rel), rel, mount: 'symlink',
      members: [{ projectKey: 'f', projectName: 'f', projectDir: real, worktreeDir: copy, workMode }] });
    return { copy, out };
  };
  const folder = await mount('folder');
  assert.deepEqual(folder.out.records.map((r) => [r.path.split('\\').join('/'), r.kind, r.mount ?? 'copy']), [['.agents/skills/own', 'skill', 'copy']]);
  assert.equal(lstatSync(join(folder.copy, rel, 'own')).isSymbolicLink(), false);
  writeFileSync(join(folder.copy, rel, 'own', 'SKILL.md'), 'agent edit\n');
  assert.equal(readFileSync(join(real, '.claude', 'skills', 'own', 'SKILL.md'), 'utf8'), '---\nname: own\n---\nmine\n', 'only Apply writes the folder');
  const git = await mount('git');                                          // a git member keeps the opt-in write-through
  assert.equal(git.out.records[0].mount, 'symlink');
});

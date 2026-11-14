// test/plugin-ai-readiness-probe.test.mjs — the probe measures instruction files, skills,
// frontmatter, commands and each tool's surface, skips worca's own mounts, and reports any
// file a probed command left behind.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeView } from './fixtures/ai-readiness-view.mjs';
import run, { probeRepo, selfSufficient, parseFrontmatter, memberDir, realParentInside, importsAgents, mentionsCommand } from '../plugins/ai-readiness/scripts/readiness-probe.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function repo(files) {
  const d = mkdtempSync(join(tmpdir(), 'air-probe-'));
  dirs.push(d);
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(d, rel, '..'), { recursive: true });
    writeFileSync(join(d, rel), body);
  }
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  spawnSync('git', ['add', '.'], { cwd: d });
  spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-qm', 'init'], { cwd: d });
  return d;
}
const git = (d, ...a) => spawnSync('git', a, { cwd: d, encoding: 'utf8' }).stdout;
const CMDS = [{ id: 'test', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' }];
const VIEW = makeView();
const probe = (d, tools, extra = {}) => probeRepo(d, { map: { tools, commands: CMDS }, runCommands: false, view: VIEW, ...extra });
const CORE = `# Project\n\nRun the tests: node -e "process.exit(0)"\n${'x'.repeat(400)}\n`;

test('selfSufficient: carries every confirmed install/test command; with none, needs substance and no pointer', () => {
  assert.equal(selfSufficient(CORE, CMDS), true);
  assert.equal(selfSufficient('See AGENTS.md.', CMDS), false);
  assert.equal(selfSufficient('See AGENTS.md.', []), false, 'no commands: a pointer is still not enough');
  assert.equal(selfSufficient('x'.repeat(500), []), true);
});

test('parseFrontmatter: name and description are required', () => {
  assert.equal(parseFrontmatter('---\nname: a\ndescription: Use when b\n---\nbody'), null);
  assert.match(parseFrontmatter('---\nname: a\n---\n'), /description/);
  assert.match(parseFrontmatter('no frontmatter'), /frontmatter/);
});

test('surfaces: CLAUDE.md importing AGENTS.md is self-sufficient; Codex reads AGENTS.md; an unselected tool is still measured', () => {
  const d = repo({ 'CLAUDE.md': '@AGENTS.md\n\nClaude notes.\n', 'AGENTS.md': CORE });
  const p = probe(d, ['claude', 'codex']);
  assert.deepEqual(p.selectedTools, ['claude', 'codex']);
  assert.equal(p.tools['claude'].surface, 'self-sufficient');
  assert.equal(p.tools.codex.surface, 'self-sufficient');
  assert.equal(p.tools.copilot.surface, 'self-sufficient', 'Copilot reads AGENTS.md too');
  assert.equal(p.files['CLAUDE.md'].importsAgents, true);
});

test('each engine is self-sufficient through the file the chip says it reads', () => {
  const agents = repo({ 'AGENTS.md': CORE });
  for (const e of ['codex', 'qwen', 'goose', 'opencode', 'cursor', 'copilot']) {
    const t = probe(agents, [e]).tools[e];
    assert.equal(t.surface, 'self-sufficient', e);
    assert.deepEqual(t.files, ['AGENTS.md'], e);
    assert.equal(t.expected, 'AGENTS.md', e);
  }
  const claude = probe(repo({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': CORE }), ['claude']).tools.claude;
  assert.equal(claude.surface, 'self-sufficient');
  assert.equal(claude.expected, 'CLAUDE.md');
  const gemini = probe(repo({ 'GEMINI.md': '@AGENTS.md\n', 'AGENTS.md': CORE }), ['gemini']).tools.gemini;
  assert.equal(gemini.surface, 'self-sufficient');
  assert.equal(gemini.expected, 'GEMINI.md');
  assert.deepEqual(gemini.files, ['GEMINI.md']);
  // Claude and Gemini do not read AGENTS.md on their own.
  assert.equal(probe(agents, ['claude']).tools.claude.surface, 'missing');
  assert.equal(probe(agents, ['gemini']).tools.gemini.surface, 'missing');
});

test('globs match as the chip does: ** is any depth, * stays in one folder', () => {
  const d = repo({ '.cursor/rules/a/b/x.mdc': CORE, '.claude/rules/r.md': CORE, '.claude/rules/deep/n.md': CORE, '.github/instructions/x/y.instructions.md': CORE });
  assert.deepEqual(probe(d, ['cursor']).tools.cursor.files, ['.cursor/rules/a/b/x.mdc']);
  assert.deepEqual(probe(d, ['claude']).tools.claude.files, ['.claude/rules/r.md']);
  assert.deepEqual(probe(d, ['copilot']).tools.copilot.files, ['.github/instructions/x/y.instructions.md']);
});

test('codex reads only the first non-empty of AGENTS.override.md and AGENTS.md', () => {
  const d = repo({ 'AGENTS.override.md': 'override notes\n', 'AGENTS.md': CORE });
  const t = probe(d, ['codex']).tools.codex;
  assert.deepEqual(t.files, ['AGENTS.override.md']);
  assert.equal(t.surface, 'partial');
  const empty = repo({ 'AGENTS.override.md': '', 'AGENTS.md': CORE });
  assert.deepEqual(probe(empty, ['codex']).tools.codex.files, ['AGENTS.md']);
});

test('a file over limits.perFile is overCap and does not count; skills are listed per folder', () => {
  const d = repo({ 'AGENTS.md': CORE + 'y'.repeat(21 * 1024), '.qwen/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n' });
  const p = probe(d, ['codex']);
  assert.ok(p.sizes['AGENTS.md'] > 20480);
  assert.deepEqual(p.overCap.files, ['AGENTS.md']);
  assert.equal(p.tools.codex.surface, 'partial');
  assert.match(p.tools.codex.why, /over/);
  assert.deepEqual(p.skills.qwen, ['s'], '.qwen/skills is listed');
  const q = probe(repo({ '.qwen/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n' }), ['qwen']);
  assert.equal(q.tools.qwen.surface, 'skills-only');
});

test('engines whose files together pass limits.total are overCap', () => {
  const big = (n) => CORE + 'z'.repeat(n);
  const d = repo({ 'CLAUDE.md': big(19000), '.claude/CLAUDE.md': big(19000), 'CLAUDE.local.md': big(19000), '.claude/rules/a.md': big(19000) });
  const p = probe(d, ['claude']);
  assert.deepEqual(p.overCap.engines, ['claude']);
  assert.equal(p.tools.claude.surface, 'partial');
});

test('skills-only through .agents/skills for every engine that reads it', () => {
  const d = repo({ '.agents/skills/s/SKILL.md': '---\nname: s\ndescription: d\n---\n' });
  for (const e of ['codex', 'copilot', 'cursor', 'gemini', 'opencode', 'goose']) assert.equal(probe(d, [e]).tools[e].surface, 'skills-only', e);
});

test('why does not blame a rules file for a missing import', () => {
  const d = repo({ '.claude/rules/x.md': 'notes\n', 'AGENTS.md': CORE });
  const why = probe(d, ['claude']).tools.claude.why;
  assert.doesNotMatch(why, /x\.md does not import/);
  assert.match(why, /CLAUDE\.md is missing/);
});

test('without a view nothing is measured per tool, and the why says so', () => {
  const d = repo({ 'AGENTS.md': CORE });
  const p = probeRepo(d, { map: { tools: ['codex'], commands: CMDS }, runCommands: false });
  assert.equal(p.tools.codex.surface, 'missing');
  assert.deepEqual(p.tools.codex.files, []);
  assert.match(p.tools.codex.why, /no view/);
});

test('a CLAUDE.md that only points at AGENTS.md in words is partial', () => {
  const d = repo({ 'CLAUDE.md': 'See AGENTS.md for everything.\n', 'AGENTS.md': CORE });
  assert.equal(probe(d, ['claude']).tools['claude'].surface, 'partial');
});

test('worca-mounted paths are left out of every inventory', () => {
  const d = repo({ 'README.md': 'r' });
  mkdirSync(join(d, '.claude/skills/readiness-rubric'), { recursive: true });
  writeFileSync(join(d, '.claude/skills/readiness-rubric/SKILL.md'), '---\nname: readiness-rubric\ndescription: d\n---\n');
  mkdirSync(join(d, '.claude/rules/worca'), { recursive: true });
  writeFileSync(join(d, '.claude/rules/worca/a.md'), 'x');
  const p = probe(d, ['claude']);
  assert.deepEqual(p.skills.claude, []);
  assert.equal(p.tools['claude'].surface, 'missing');
});

test('the rubric mounted under .agents/skills on a non-Claude engine is left out too', () => {
  const d = repo({ 'README.md': 'r' });
  mkdirSync(join(d, '.agents/skills/readiness-rubric'), { recursive: true });
  writeFileSync(join(d, '.agents/skills/readiness-rubric/SKILL.md'), '---\nname: readiness-rubric\ndescription: d\n---\n');
  for (const e of ['codex', 'copilot', 'cursor', 'gemini', 'goose', 'opencode']) {
    const p = probe(d, [e]);
    assert.deepEqual(p.skills.agents, [], e);
    assert.equal(p.tools[e].surface, 'missing', e);
  }
});

test('commands: run when confirmed, skipped when slow, wrong or a long-running kind, none in mock', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [
    { id: 'ok', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' },
    { id: 'bad', kind: 'lint', command: 'node -e "process.exit(3)"', verdict: 'correct' },
    { id: 'slow', kind: 'test', command: 'sleep 99', verdict: 'slow' },
    { id: 'wrong', kind: 'test', command: 'nope', verdict: 'wrong' },
    { id: 'srv', kind: 'start', command: 'node server.js', verdict: 'correct' },
  ];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.commands.map((c) => [c.id, c.status]), [['ok', 'pass'], ['bad', 'fail'], ['slow', 'skipped-slow'], ['wrong', 'skipped-wrong'], ['srv', 'skipped-kind']]);
  assert.equal(p.commands[1].exitCode, 3);
  const mock = probeRepo(d, { map: { tools: [], commands }, runCommands: false });
  assert.ok(mock.commands.every((c) => c.status.startsWith('skipped')));
});

test('a command that writes into the checkout is reported under sideEffects', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 't', kind: 'test', command: 'node -e "require(\'fs\').writeFileSync(\'junk.txt\',\'x\')"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, ['junk.txt']);
  assert.equal(existsSync(join(d, 'junk.txt')), false, 'the probe deleted what the command created');
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(p.restored, true);
  assert.deepEqual(p.restoreFailed, []);
});

test('a modified committed file is checked out again and a nested new file is removed with its empty dirs', () => {
  const d = repo({ 'README.md': 'committed\n' });
  const cmd = `node -e "const f=require('fs');f.appendFileSync('README.md','more');f.mkdirSync('out/deep',{recursive:true});f.writeFileSync('out/deep/x.txt','x')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual([...p.sideEffects].sort(), ['README.md', 'out/deep/x.txt']);
  assert.equal(readFileSync(join(d, 'README.md'), 'utf8'), 'committed\n');
  assert.equal(existsSync(join(d, 'out')), false);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(p.restored, true);
  assert.deepEqual(p.restoreFailed, []);
});

test('a file already dirty before the probe that a command edits is listed and put back to its dirty content', () => {
  const d = repo({ 'README.md': 'committed\n' });
  writeFileSync(join(d, 'README.md'), 'dirty\n');
  writeFileSync(join(d, 'seeded.test.js'), 'seeded\n');
  const cmd = `node -e "require('fs').appendFileSync('README.md','cmd'); require('fs').writeFileSync('seeded.test.js','fixed')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual([...p.sideEffects].sort(), ['README.md', 'seeded.test.js']);
  assert.equal(readFileSync(join(d, 'README.md'), 'utf8'), 'dirty\n');
  assert.equal(readFileSync(join(d, 'seeded.test.js'), 'utf8'), 'seeded\n');
  assert.equal(p.restored, true);
});

test('an already-dirty file a command leaves alone is not listed', () => {
  const d = repo({ 'README.md': 'committed\n' });
  writeFileSync(join(d, 'README.md'), 'dirty\n');
  const p = probeRepo(d, { map: { tools: [], commands: CMDS }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, []);
  assert.equal(readFileSync(join(d, 'README.md'), 'utf8'), 'dirty\n');
});

test('a timed-out command takes its whole process group with it', () => {
  const d = repo({ 'README.md': 'r' });
  // The shell starts a child that would write a file after the timeout; killing only the shell leaves it running.
  const late = `node -e "setTimeout(()=>require('fs').writeFileSync('late.txt','x'),1500)"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: `${late}; true`, verdict: 'correct' }] }, runCommands: true, timeoutMs: 400 });
  assert.equal(p.commands[0].status, 'timeout');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
  assert.equal(existsSync(join(d, 'late.txt')), false);
});

test('a background process a passing command leaves behind is stopped', () => {
  const d = repo({ 'README.md': 'r' });
  const bg = `node -e "setTimeout(()=>require('fs').writeFileSync('bg.txt','x'),1500)" &`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: bg, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.equal(p.commands[0].status, 'pass');
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},2000)']);
  assert.equal(existsSync(join(d, 'bg.txt')), false);
});

test('a command cut short by the card budget is skipped-budget, not a timeout', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 'a', kind: 'test', command: 'node -e "setTimeout(()=>{},60000)"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000, deadline: Date.now() + 400 });
  assert.equal(p.commands[0].status, 'skipped-budget');
  assert.equal(p.commands[0].cutByBudget, true);
  assert.ok(p.commands[0].ms > 0);
});

test('mock: nothing is touched and the probe reports restored', () => {
  const d = repo({ 'README.md': 'r' });
  const p = probeRepo(d, { map: { tools: [], commands: CMDS }, runCommands: false });
  assert.equal(p.restored, true);
  assert.deepEqual(p.restoreFailed, []);
  assert.deepEqual(p.sideEffects, []);
});

test('every new path is restored, even past the 50-entry display cap', () => {
  const d = repo({ 'README.md': 'r' });
  const cmd = `node -e "for(let i=0;i<60;i++)require('fs').writeFileSync('g'+i+'.txt','x')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.equal(p.sideEffects.length, 51);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(p.restored, true);
});

test('a glob-looking new path never reverts a tracked file it would match (literal pathspecs)', () => {
  const d = repo({ 'abc.txt': 'committed\n' });
  writeFileSync(join(d, 'abc.txt'), 'my edit\n');
  const cmd = `node -e "require('fs').writeFileSync('a*.txt','x')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, ['a*.txt']);
  assert.equal(readFileSync(join(d, 'abc.txt'), 'utf8'), 'my edit\n');
  assert.equal(existsSync(join(d, 'a*.txt')), false);
  assert.equal(git(d, 'status', '--porcelain'), ' M abc.txt\n');
  assert.equal(p.restored, true);
});

test('a probe dir below the repo toplevel: new files are found relative to the toplevel and removed', () => {
  const d = repo({ 'api/keep.txt': 'k', 'README.md': 'r' });
  const cmd = `node -e "require('fs').writeFileSync('new.txt','x')"`;
  const p = probeRepo(join(d, 'api'), { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, ['api/new.txt']);
  assert.equal(existsSync(join(d, 'api', 'new.txt')), false);
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(p.restored, true);
});

test('a path outside the probe dir is never touched and is reported', () => {
  const d = repo({ 'api/keep.txt': 'k', 'README.md': 'r' });
  const cmd = `node -e "require('fs').writeFileSync('../outside.txt','x')"`;
  const p = probeRepo(join(d, 'api'), { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.equal(existsSync(join(d, 'outside.txt')), true);
  assert.deepEqual(p.restoreFailed, ['outside.txt']);
  assert.equal(p.restored, false);
});

test('a dir that is not a git repo restores nothing and reports nothing touched', () => {
  const d = mkdtempSync(join(tmpdir(), 'air-probe-nogit-'));
  dirs.push(d);
  const p = probeRepo(d, { map: { tools: [], commands: CMDS }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, []);
  assert.equal(p.restored, true);
});

test('300 new files are all removed quickly (batched git calls)', () => {
  const d = repo({ 'README.md': 'r' });
  const cmd = `node -e "for(let i=0;i<300;i++)require('fs').writeFileSync('h'+i+'.txt','x')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.equal(git(d, 'status', '--porcelain'), '');
  assert.equal(p.restored, true);
});

test('a symlinked parent that leaves the repo is not followed: the path goes to restoreFailed', () => {
  const d = repo({ 'README.md': 'r' });
  const outside = mkdtempSync(join(tmpdir(), 'air-probe-out-'));
  dirs.push(outside);
  writeFileSync(join(outside, 'victim.txt'), 'v');
  const cmd = `node -e "require('fs').symlinkSync(${JSON.stringify(outside)},'lnk')"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  assert.equal(readFileSync(join(outside, 'victim.txt'), 'utf8'), 'v');
  assert.equal(existsSync(join(d, 'lnk')), false, 'the symlink itself is removed');
  assert.equal(p.restored, true);
});

test('a path that cannot be removed lands in restoreFailed', () => {
  const d = repo({ 'README.md': 'r' });
  // A directory the command makes read-only cannot lose its file; restored stays false.
  const cmd = `node -e "const f=require('fs');f.mkdirSync('ro');f.writeFileSync('ro/a.txt','x');f.chmodSync('ro',0o555)"`;
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 });
  try {
    if (process.getuid && process.getuid() === 0) return; // root ignores modes
    assert.equal(p.restored, false);
    assert.deepEqual(p.restoreFailed, ['ro/a.txt']);
  } finally { chmodSync(join(d, 'ro'), 0o755); }
});

test('a bare repository (no map lists at all) still probes', () => {
  const d = repo({ 'README.md': 'r' });
  const p = probeRepo(d, { map: {}, runCommands: true });
  assert.deepEqual(p.commands, []);
  assert.deepEqual(p.selectedTools, []);
});

test('memberDir: repos, then workspace.members, then repos/<key>; a null dir falls through', () => {
  const ctx = { cwd: '/w', repos: [{ key: 'a', dir: '/r/a' }], workspace: { members: [{ key: 'a', dir: '/m/a' }, { key: 'b', dir: '/m/b' }, { key: 'c', dir: null }] } };
  assert.equal(memberDir(ctx, 'a'), '/r/a');
  assert.equal(memberDir(ctx, 'b'), '/m/b');
  assert.equal(memberDir(ctx, 'c'), join('/w', 'repos', 'c'));
  assert.equal(memberDir({ cwd: '/w', repos: [{ key: 'a', dir: null }] }, 'a'), join('/w', 'repos', 'a'));
  assert.equal(memberDir({ cwd: '/w' }, 'z'), join('/w', 'repos', 'z'));
});

test('budget: once spent, remaining runnable commands are skipped-budget without running', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [
    { id: 'a', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' },
    { id: 'b', kind: 'lint', command: 'node -e "process.exit(0)"', verdict: 'correct' },
  ];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000, budgetMs: 1 });
  assert.equal(p.commands[1].status, 'skipped-budget');
  assert.equal(p.commands[1].exitCode, null);
  assert.equal(p.commands[1].ms, 0);
});

test('sideEffects: paths with spaces come out verbatim', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 't', kind: 'test', command: 'node -e "require(\'fs\').writeFileSync(\'has space.txt\',\'x\')"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, ['has space.txt']);
});

test('a command that ran and was killed is a timeout, not skipped-budget', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 'a', kind: 'test', command: 'node -e "setTimeout(()=>{},60000)"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 300 });
  assert.equal(p.commands[0].status, 'timeout');
});

test('probeRepo takes a shared deadline; one already past starts nothing', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 'a', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, deadline: Date.now() - 1 });
  assert.equal(p.commands[0].status, 'skipped-budget');
});

test('install commands run first even when listed after a test; output keeps map order', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [
    { id: 't', kind: 'test', command: 'node -e "process.exit(require(\'fs\').existsSync(\'/dev/null\') && require(\'fs\').existsSync(\'installed.flag\') ? 0 : 1)"', verdict: 'correct' },
    { id: 'i', kind: 'install', command: 'node -e "require(\'fs\').writeFileSync(\'installed.flag\',\'x\')"', verdict: 'correct' },
  ];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.commands.map((c) => [c.id, c.status]), [['t', 'pass'], ['i', 'pass']]);
});

test('side effects are capped at 50 with a "+N more" tail', () => {
  const d = repo({ 'README.md': 'r' });
  const commands = [{ id: 't', kind: 'test', command: 'node -e "for(let i=0;i<60;i++)require(\'fs\').writeFileSync(\'f\'+String(i).padStart(2,\'0\')+\'.txt\',\'x\')"', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.equal(p.sideEffects.length, 51);
  assert.equal(p.sideEffects[50], '+10 more');
});

test('a staged rename does not report its old path as a side effect', () => {
  const d = repo({ 'old.txt': 'x', 'README.md': 'r' });
  const commands = [{ id: 't', kind: 'test', command: 'git mv old.txt new.txt', verdict: 'correct' }];
  const p = probeRepo(d, { map: { tools: [], commands }, runCommands: true, timeoutMs: 20000 });
  assert.deepEqual(p.sideEffects, ['new.txt']);
});

test('importsAgents accepts @AGENTS.md and @./AGENTS.md, on their own line or in a sentence', () => {
  for (const imp of ['@AGENTS.md', '@./AGENTS.md', 'Read @AGENTS.md for the commands.', 'Build rules: @./AGENTS.md']) {
    const d = repo({ 'CLAUDE.md': `${imp}\n`, 'AGENTS.md': CORE });
    const p = probe(d, ['claude']);
    assert.equal(p.files['CLAUDE.md'].importsAgents, true, imp);
    assert.equal(p.tools['claude'].surface, 'self-sufficient', imp);
  }
});

test('importsAgents ignores an @AGENTS.md inside code', () => {
  assert.equal(importsAgents('Write `@AGENTS.md` to import it.'), false);
  assert.equal(importsAgents('```\n@AGENTS.md\n```\n'), false);
  assert.equal(importsAgents('mail me@AGENTS.md'), false);
  assert.equal(importsAgents('(@AGENTS.md)'), false);
});

test('mentionsCommand: a whole command only, not part of a longer one', () => {
  assert.equal(mentionsCommand('Run `npm test`.', 'npm test'), true);
  assert.equal(mentionsCommand('Run npm test.', 'npm test'), true);
  assert.equal(mentionsCommand('npm test -- --watch', 'npm test'), true);
  assert.equal(mentionsCommand('Run pnpm test', 'npm test'), false);
  assert.equal(mentionsCommand('Run npm test:fast', 'npm test'), false);
  assert.equal(mentionsCommand('pip install pytest-cov', 'pytest'), false);
  assert.equal(mentionsCommand('Run ./gradlew test', './gradlew test'), true);
  assert.equal(mentionsCommand('Run npm test.js', 'npm test'), false);
});

test('a confirmed command only inside a longer one does not make a file self-sufficient', () => {
  const cmds = [{ id: 't', kind: 'test', command: 'npm test', verdict: 'correct' }];
  assert.equal(selfSufficient(`Run npm test:unit\n${'x'.repeat(400)}`, cmds), false);
  assert.equal(selfSufficient(`Run \`npm test\`\n${'x'.repeat(400)}`, cmds), true);
});

test('cursor rules: nested folders count, a broken symlink is skipped', () => {
  const d = repo({ '.cursor/rules/top.mdc': 'a', '.cursor/rules/backend/api.mdc': 'b', '.cursor/rules/notes.md': 'c' });
  symlinkSync(join(d, 'nowhere.mdc'), join(d, '.cursor/rules/broken.mdc'));
  const p = probe(d, ['cursor']);
  assert.deepEqual(p.cursorRules.mdc, ['.cursor/rules/backend/api.mdc', '.cursor/rules/top.mdc']);
  assert.deepEqual(p.cursorRules.ignoredMd, ['.cursor/rules/notes.md']);
  assert.equal(p.tools.cursor.surface, 'partial', 'rules without the core are partial');
});

test('why names the real cause', () => {
  const alone = repo({ 'CLAUDE.md': 'notes only\n' });
  const whyAlone = probe(alone, ['claude']).tools['claude'].why;
  assert.match(whyAlone, /CLAUDE\.md does not carry the confirmed commands/);
  assert.doesNotMatch(whyAlone, /AGENTS/);
  const none = repo({ 'CLAUDE.md': 'notes only\n', 'AGENTS.md': CORE });
  assert.match(probe(none, ['claude']).tools['claude'].why, /does not import @AGENTS\.md/);
  const imp = repo({ 'CLAUDE.md': '@AGENTS.md\n', 'AGENTS.md': 'short\n' });
  const why = probe(imp, ['claude']).tools['claude'].why;
  assert.match(why, /do not carry the confirmed commands/);
  assert.doesNotMatch(why, /does not import/);
  assert.match(probe(repo({ 'AGENTS.md': CORE }), ['claude']).tools['claude'].why, /no CLAUDE\.md/);
});

function envelope({ map, mock, members, cwd, tests, plan, baseline, out = 'probe.json' }) {
  const pd = mkdtempSync(join(tmpdir(), 'air-probe-env-'));
  dirs.push(pd);
  writeFileSync(join(pd, 'map.json'), JSON.stringify(map));
  const inputs = { map: { path: join(pd, 'map.json') } };
  if (tests !== undefined) { writeFileSync(join(pd, 'tests.json'), JSON.stringify(tests)); inputs.tests = { path: join(pd, 'tests.json') }; }
  if (plan !== undefined) { writeFileSync(join(pd, 'plan.json'), typeof plan === 'string' ? plan : JSON.stringify(plan)); inputs.plan = { path: join(pd, 'plan.json') }; }
  if (baseline !== undefined) writeFileSync(join(pd, 'readiness-probe.json'), JSON.stringify(baseline));
  return { pd, out: join(pd, out), api: { inputs, outputs: { probe: { path: join(pd, out) } }, ctx: { cwd, mock, pipelineDir: pd, workspace: members ? { members } : undefined }, log: () => {} } };
}

test('default export: a workspace probes every member under one shared budget', async () => {
  const a = repo({ 'README.md': 'a' });
  const b = repo({ 'README.md': 'b' });
  const { pd, api } = envelope({ map: { tools: [], members: { api: { commands: [] }, web: { commands: [] } } }, mock: true, cwd: a, members: [{ key: 'api', dir: a }, { key: 'web', dir: b }] });
  await run(api);
  const out = JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
  assert.deepEqual(Object.keys(out.members), ['api', 'web']);
});

test('default export: the seeded tests\' commands run in the final probe; known ones are not repeated', async () => {
  const d = repo({ 'README.md': 'r' });
  const known = 'node -e "process.exit(0)"';
  const seeded = 'node -e "process.exit(0);//seeded"';
  const { pd, api } = envelope({
    map: { tools: [], commands: [{ id: 'test', kind: 'test', command: known, verdict: 'correct' }] },
    mock: false, cwd: d,
    tests: { commands: [{ command: seeded }, { command: known }, seeded, { command: '' }, { nope: 1 }] },
  });
  await run(api);
  const out = JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
  assert.deepEqual(out.commands.map((c) => c.command), [known, seeded]);
  assert.equal(out.commands[1].status, 'pass');
  assert.equal(out.commands[1].kind, 'test');
});

test('default export: a workspace final probe runs each member\'s seeded tests in that member only', async () => {
  const a = repo({ 'README.md': 'a', 'ok.sh': 'exit 0' });
  const b = repo({ 'README.md': 'b' });
  const { pd, api } = envelope({
    map: { tools: [], members: { api: { commands: [] }, web: { commands: [] } } }, mock: false, cwd: a, members: [{ key: 'api', dir: a }, { key: 'web', dir: b }],
    tests: { members: { api: { commands: [{ kind: 'test', command: 'sh ok.sh', status: 'pass' }] }, web: { commands: [] } } },
  });
  await run(api);
  const out = JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
  assert.deepEqual(out.members.api.commands.map((c) => c.command), ['sh ok.sh']);
  assert.equal(out.members.api.commands[0].status, 'pass');
  assert.equal(out.members.web.commands.length, 0);
});

test('default export: a workspace member\'s seeded command it already documents is not repeated', async () => {
  const a = repo({ 'README.md': 'a', 'ok.sh': 'exit 0' });
  const { pd, api } = envelope({
    map: { tools: [], members: { api: { commands: [{ id: 't', kind: 'test', command: 'sh ok.sh', verdict: 'correct' }] } } }, mock: false, cwd: a, members: [{ key: 'api', dir: a }],
    tests: { members: { api: { commands: [{ kind: 'test', command: 'sh ok.sh', status: 'pass' }] } } },
  });
  await run(api);
  const out = JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
  assert.equal(out.members.api.commands.filter((c) => c.command === 'sh ok.sh').length, 1);
});

test('default export: an unreadable tests file is ignored', async () => {
  const d = repo({ 'README.md': 'r' });
  const { pd, api } = envelope({ map: { tools: [], commands: [] }, mock: true, cwd: d, tests: 'not an object' });
  await run(api);
  assert.deepEqual(JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8')).commands, []);
});

test('default export: plan.tools (filtered to the four tools) replaces map.tools as the selected tools', async () => {
  const d = repo({ 'README.md': 'r' });
  const { out, api } = envelope({ map: { tools: ['claude', 'codex', 'copilot'], commands: [] }, mock: true, cwd: d, plan: { tools: ['claude', 'codex', 'bogus'] } });
  await run(api);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).selectedTools, ['claude', 'codex']);
});

test('default export: a plan without a tools array, or unreadable, leaves map.tools', async () => {
  for (const plan of [{ files: [] }, 'not json']) {
    const d = repo({ 'README.md': 'r' });
    const { out, api } = envelope({ map: { tools: ['claude', 'copilot'], commands: [] }, mock: true, cwd: d, plan });
    await run(api);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')).selectedTools, ['claude', 'copilot'], JSON.stringify(plan));
  }
});

test('default export: plan.tools applies to every workspace member', async () => {
  const a = repo({ 'README.md': 'a' });
  const b = repo({ 'README.md': 'b' });
  const { out, api } = envelope({ map: { tools: ['claude', 'copilot'], members: { api: { commands: [] }, web: { commands: [] } } }, mock: true, cwd: a, members: [{ key: 'api', dir: a }, { key: 'web', dir: b }], plan: { tools: ['claude'] } });
  await run(api);
  const p = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(p.members.api.selectedTools, ['claude']);
  assert.deepEqual(p.members.web.selectedTools, ['claude']);
});

test('default export: the final probe records each command\'s baseline status and marks seeded commands', async () => {
  const d = repo({ 'README.md': 'r' });
  const ok = 'node -e "process.exit(0)"';
  const red = 'node -e "process.exit(1)"';
  const fresh = 'node -e "process.exit(0);//fresh"';
  const seeded = 'node -e "process.exit(0);//seeded"';
  const { out, api } = envelope({
    map: { tools: [], commands: [{ id: 'a', kind: 'test', command: ok, verdict: 'correct' }, { id: 'b', kind: 'lint', command: red, verdict: 'correct' }, { id: 'c', kind: 'lint', command: fresh, verdict: 'correct' }] },
    mock: false, cwd: d, tests: { commands: [{ command: seeded }] }, out: 'readiness-probe-final-cycle1.json',
    baseline: { commands: [{ command: ok, status: 'pass' }, { command: red, status: 'fail' }] },
  });
  await run(api);
  const p = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(p.commands.map((c) => [c.command, c.baselineStatus, c.seeded === true]), [[ok, 'pass', false], [red, 'fail', false], [fresh, 'none', false], [seeded, 'none', true]]);
});

test('default export: the baseline probe itself carries no baseline status', async () => {
  const d = repo({ 'README.md': 'r' });
  const { out, api } = envelope({ map: { tools: [], commands: [{ id: 'a', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' }] }, mock: true, cwd: d, out: 'readiness-probe.json' });
  await run(api);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).commands[0].baselineStatus, undefined);
});

test('default export: a final probe with no baseline file adds no baseline status', async () => {
  const d = repo({ 'README.md': 'r' });
  const { out, api } = envelope({ map: { tools: [], commands: [{ id: 'a', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct' }] }, mock: true, cwd: d, out: 'readiness-probe-final-cycle1.json' });
  await run(api);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).commands[0].baselineStatus, undefined);
});

test('default export: a workspace final probe reads each member\'s baseline', async () => {
  const a = repo({ 'README.md': 'a' });
  const b = repo({ 'README.md': 'b' });
  const cmd = 'node -e "process.exit(0)"';
  const member = { commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] };
  const { out, api } = envelope({
    map: { tools: [], members: { api: member, web: member } }, mock: true, cwd: a, members: [{ key: 'api', dir: a }, { key: 'web', dir: b }],
    out: 'readiness-probe-final-cycle1.json', baseline: { members: { api: { commands: [{ command: cmd, status: 'fail' }] } } },
  });
  await run(api);
  const p = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(p.members.api.commands[0].baselineStatus, 'fail');
  assert.equal(p.members.web.commands[0].baselineStatus, 'none');
});

/** Runs fn with a `git` first on PATH that fails `<sub>` and passes everything else to the real git. */
function withFailingGit(sub, fn) {
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  const bin = mkdtempSync(join(tmpdir(), 'air-probe-git-'));
  dirs.push(bin);
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nif [ "$1" = "${sub}" ]; then echo "fatal: injected" >&2; exit 128; fi\nexec "${realGit}" "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const saved = process.env.PATH;
  process.env.PATH = `${bin}:${saved}`;
  try { return fn(); } finally { process.env.PATH = saved; }
}

for (const sub of ['ls-files', 'rev-parse']) {
  test(`a git error in the membership check (${sub}) never deletes: the file stays and is reported`, () => {
    const d = repo({ 'README.md': 'r' });
    const cmd = `node -e "require('fs').writeFileSync('new.txt','x')"`;
    const p = withFailingGit(sub, () => probeRepo(d, { map: { tools: [], commands: [{ id: 't', kind: 'test', command: cmd, verdict: 'correct' }] }, runCommands: true, timeoutMs: 20000 }));
    assert.deepEqual(p.sideEffects, ['new.txt'], 'git status still answered');
    assert.equal(existsSync(join(d, 'new.txt')), true, 'nothing was deleted');
    assert.deepEqual(p.restoreFailed, ['new.txt']);
    assert.equal(p.restored, false);
  });
}

test('realParentInside: a parent that resolves outside the toplevel through a symlinked dir is refused', () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), 'air-probe-top-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'air-probe-out-')));
  dirs.push(top, outside);
  mkdirSync(join(top, 'sub'));
  symlinkSync(outside, join(top, 'lnk'));
  assert.deepEqual(realParentInside(join(top, 'lnk', 'victim.txt'), top), { state: 'outside' });
  assert.deepEqual(realParentInside(join(top, 'sub', 'a.txt'), top), { state: 'inside', parent: join(top, 'sub') });
  assert.deepEqual(realParentInside(join(top, 'a.txt'), top), { state: 'inside', parent: top });
  assert.deepEqual(realParentInside(join(top, 'gone', 'a.txt'), top), { state: 'gone' });
  mkdirSync(`${top}x`); dirs.push(`${top}x`);
  assert.deepEqual(realParentInside(join(`${top}x`, 'a.txt'), top), { state: 'outside' }, 'a sibling sharing the prefix is outside');
});

// F1: a failed or timed-out command keeps the end of its output (outputTail).
const probeCmd = (command, timeoutMs = 60000) => {
  const d = repo({ 'README.md': 'r' });
  return probeRepo(d, { map: { tools: [], commands: [{ id: 'c', kind: 'test', command, verdict: 'correct' }] }, runCommands: true, timeoutMs }).commands[0];
};
const nodeCmd = (js) => `node -e ${JSON.stringify(js)}`;

test('outputTail: a failing command keeps exactly the last 40 lines', () => {
  const c = probeCmd(nodeCmd('for (let i = 1; i <= 100; i++) console.log("line " + i); process.exit(1)'));
  assert.equal(c.status, 'fail');
  const lines = c.outputTail.split('\n');
  assert.equal(lines.length, 40);
  assert.equal(lines[0], 'line 61');
  assert.equal(lines[39], 'line 100');
  assert.ok(!c.outputTail.includes('line 60\n') && !c.outputTail.startsWith('line 60'));
});

test('outputTail: capped to the last 4096 characters, ending with the final characters', () => {
  const c = probeCmd(nodeCmd('for (let i = 1; i <= 40; i++) console.log("L" + i + " " + "y".repeat(200)); console.log("THE-END"); process.exit(1)'));
  assert.equal(c.status, 'fail');
  assert.ok(c.outputTail.length <= 4096);
  assert.ok(c.outputTail.endsWith('THE-END'));
});

test('outputTail: ANSI escapes are stripped and CRLF becomes LF', () => {
  const c = probeCmd(nodeCmd('process.stdout.write("\\u001b[31mred\\u001b[0m text\\r\\nnext\\r\\n"); process.stderr.write("\\u001b[1merr\\u001b[22m\\n"); process.exit(1)'));
  assert.ok(!c.outputTail.includes('\u001b'));
  assert.ok(!c.outputTail.includes('\r'));
  assert.match(c.outputTail, /red text\nnext\n/);
  assert.match(c.outputTail, /err/);
});

test('outputTail: an empty output is an empty string; a passing command has no outputTail key', () => {
  assert.equal(probeCmd(nodeCmd('process.exit(2)')).outputTail, '');
  const ok = probeCmd(nodeCmd('console.log("fine")'));
  assert.equal(ok.status, 'pass');
  assert.ok(!('outputTail' in ok));
});

test('outputTail: more than 2 MiB of output still ends as fail with its exit code (no pipe buffer)', () => {
  const c = probeCmd(nodeCmd('const b = "z".repeat(1023) + "\\n"; for (let i = 0; i < 2300; i++) process.stdout.write(b); console.log("LAST"); process.exit(7)'));
  assert.equal(c.status, 'fail');
  assert.equal(c.exitCode, 7);
  assert.ok(c.outputTail.endsWith('LAST'));
});

test('outputTail: a timed-out command reports timeout with what it printed before the kill', () => {
  const c = probeCmd(nodeCmd('console.log("before-kill"); setTimeout(() => {}, 60000)'), 1500);
  assert.equal(c.status, 'timeout');
  assert.match(c.outputTail, /before-kill/);
});

test('outputTail: skipped commands carry none', () => {
  const d = repo({ 'README.md': 'r' });
  const p = probeRepo(d, { map: { tools: [], commands: [{ id: 'w', kind: 'test', command: 'x', verdict: 'wrong' }] }, runCommands: true });
  assert.ok(!('outputTail' in p.commands[0]));
});

test('a .qwen skill whose frontmatter does not parse is reported', () => {
  const d = repo({ '.qwen/skills/q/SKILL.md': '---\nname: q\n---\n', '.agents/skills/a/SKILL.md': '---\nname: a\n---\n' });
  assert.deepEqual(probe(d, ['qwen']).frontmatter.map((f) => f.path).sort(), ['.agents/skills/a/SKILL.md', '.qwen/skills/q/SKILL.md']);
});

// Item 1: a command Map took from worca memory (it carries an `origin`) runs only when a person answered card A.
// Who answered comes from the host's readiness view (`api.readiness.cardA.by`); without a view, nothing from memory runs.
const MEM_CMDS = [
  { id: 'mem', kind: 'test', command: 'node -e "process.exit(0)"', verdict: 'correct', origin: 'memory:notes.md' },
  { id: 'repo', kind: 'test', command: 'node -e "process.exit(0);//repo"', verdict: 'correct' },
];
const statusesOf = (p) => p.commands.map((c) => [c.id, c.status]);

test('probeRepo: a memory command runs only when card A was answered by a person; a repository command always runs', () => {
  const d = repo({ 'README.md': 'r' });
  const at = (cardA) => probeRepo(d, { map: { tools: [], commands: MEM_CMDS }, runCommands: true, timeoutMs: 20000, ...(cardA !== undefined ? { cardA } : {}) });
  assert.deepEqual(statusesOf(at({ by: 'user' })), [['mem', 'pass'], ['repo', 'pass']]);
  for (const cardA of [{ by: 'away' }, { by: null }, null, undefined]) {
    const p = at(cardA);
    assert.deepEqual(statusesOf(p), [['mem', 'skipped-memory'], ['repo', 'pass']], JSON.stringify(cardA));
    assert.equal(p.commands[0].why, 'from worca memory; nobody confirmed it on card A');
    assert.equal(p.commands[0].exitCode, null);
    assert.equal(p.commands[0].origin, 'memory:notes.md');
  }
});

test('probeRepo: any origin counts, not only memory:', () => {
  const d = repo({ 'README.md': 'r' });
  const p = probeRepo(d, { map: { tools: [], commands: [{ ...MEM_CMDS[0], origin: 'somewhere-else' }] }, runCommands: true, timeoutMs: 20000, cardA: { by: 'away' } });
  assert.equal(p.commands[0].status, 'skipped-memory');
});

test('probeRepo: a memory command nobody confirmed is not required for a self-sufficient file', () => {
  const d = repo({ 'CLAUDE.md': `# Project\n\nRun the tests: node -e "process.exit(0);//repo"\n${'x'.repeat(400)}\n` });
  const p = (cardA) => probeRepo(d, { map: { tools: ['claude'], commands: MEM_CMDS }, runCommands: false, view: VIEW, cardA }).tools.claude.surface;
  assert.equal(p({ by: 'away' }), 'self-sufficient');
  assert.equal(p({ by: 'user' }), 'partial', 'confirmed by a person, the memory command must be written down');
});

for (const [label, readiness, mem] of [
  ['card A answered by a person', { cardA: { by: 'user' } }, 'pass'],
  ['card A answered by Away mode', { cardA: { by: 'away' } }, 'skipped-memory'],
  ['card A never answered', { cardA: { by: null } }, 'skipped-memory'],
  ['an older worca with no readiness view', undefined, 'skipped-memory'],
]) {
  test(`default export: ${label} → the memory command is ${mem}, the repository command runs`, async () => {
    const d = repo({ 'README.md': 'r' });
    const { pd, api } = envelope({ map: { tools: [], commands: MEM_CMDS }, mock: false, cwd: d });
    await run({ ...api, ...(readiness !== undefined ? { readiness } : {}) });
    const out = JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
    assert.deepEqual(statusesOf(out), [['mem', mem], ['repo', 'pass']]);
  });
}

test('default export: a workspace takes card A once, from the top of the view, for every member', async () => {
  const a = repo({ 'README.md': 'a' });
  const b = repo({ 'README.md': 'b' });
  const map = { tools: [], members: { api: { commands: MEM_CMDS }, web: { commands: MEM_CMDS } } };
  const probeWith = async (cardA) => {
    const { pd, api } = envelope({ map, mock: false, cwd: a, members: [{ key: 'api', dir: a }, { key: 'web', dir: b }] });
    await run({ ...api, readiness: { members: { api: {}, web: {} }, workspaceMap: null, cardA } });
    return JSON.parse(readFileSync(join(pd, 'probe.json'), 'utf8'));
  };
  const yes = await probeWith({ by: 'user' });
  for (const k of ['api', 'web']) assert.deepEqual(statusesOf(yes.members[k]), [['mem', 'pass'], ['repo', 'pass']], k);
  const away = await probeWith({ by: 'away' });
  for (const k of ['api', 'web']) assert.deepEqual(statusesOf(away.members[k]), [['mem', 'skipped-memory'], ['repo', 'pass']], k);
});

test('both probe cards ask worca for the readiness view (card A)', () => {
  for (const f of ['readinessProbe.meta.json', 'readinessProbeFinal.meta.json']) {
    const meta = JSON.parse(readFileSync(new URL(`../plugins/ai-readiness/scripts/${f}`, import.meta.url), 'utf8'));
    assert.equal(meta.readiness, true, f);
  }
});

test('Score and Re-score read skipped-memory as not run, like a wrong command', () => {
  for (const f of ['readinessScore.md', 'readinessRescore.md']) {
    const text = readFileSync(new URL(`../plugins/ai-readiness/agents/${f}`, import.meta.url), 'utf8');
    assert.match(text, /skipped-memory/, f);
  }
});

// test/preflight.test.mjs
// Verifies that preflight detection branches the agent instruction by the
// kind of graphify install (cli / skill / output-cached). Wrong wording is
// the root cause of agents never invoking graphify — a CLI instruction makes
// an agent try Bash, a Skill instruction makes it try the Skill tool.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTools, buildInstruction } from '../src/core/preflight.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

const tmpDirs = [];
async function makeTmpDir() {
  const dir = await mkdtemp(join(tmpdir(), 'worca-cc-preflight-'));
  tmpDirs.push(dir);
  return dir;
}
after(async () => {
  await Promise.all(tmpDirs.map((d) => rm(d, { recursive: true, force: true })));
});

test('buildInstruction: skill kind tells the agent to use the Skill tool, not Bash', () => {
  const text = buildInstruction('graphify', 'skill');
  assert.match(text, /Skill/, 'must name the Skill tool');
  assert.match(text, /Skill\(skill:\s*"graphify"/, 'must show the exact Skill invocation');
  assert.match(text, /not.*Bash|do NOT.*run.*Bash/i, 'must warn NOT to run via Bash');
});

test('buildInstruction: cli kind tells the agent to run via Bash', () => {
  const text = buildInstruction('graphify', 'cli');
  assert.match(text, /Bash/, 'must mention Bash');
  assert.match(text, /graphify-out/, 'must point at the output dir');
  assert.doesNotMatch(text, /Skill\(/, 'must not suggest the Skill tool for a CLI install');
});

test('buildInstruction: output-cached kind tells the agent to read the cached graph', () => {
  const text = buildInstruction('graphify', 'output-cached');
  assert.match(text, /graphify-out/, 'must point at the cached output dir');
  assert.match(text, /read|GRAPH_REPORT|graph\.json/i, 'must instruct to READ, not run/invoke');
  assert.doesNotMatch(text, /Skill\(/, 'must not suggest the Skill tool when only output is cached');
  assert.doesNotMatch(text, /\bRun it via Bash\b/, 'must not suggest running a binary');
});

test('buildInstruction: code-review-graph instruction is CLI-shaped', () => {
  const text = buildInstruction('code-review-graph', 'cli');
  assert.match(text, /code-review-graph/);
  assert.match(text, /Bash/);
});

test('buildInstruction: no tool → empty string', () => {
  assert.equal(buildInstruction(null, null), '');
  assert.equal(buildInstruction(undefined, undefined), '');
});

test('buildInstruction: never leaks the literal <projectDir> token', () => {
  for (const kind of ['skill', 'cli', 'output-cached']) {
    const text = buildInstruction('graphify', kind);
    assert.doesNotMatch(text, /<projectDir>/, `${kind} instruction must not contain <projectDir>`);
    assert.match(text, /graphify-out/, `${kind} instruction must still point at graphify-out/`);
  }
});

test('detectTools: project with no tooling returns null tool + empty instruction', async () => {
  const dir = await makeTmpDir();
  // Use a HOME override so detection cannot accidentally find a real skill at
  // ~/.claude/skills/graphify/SKILL.md on the host. detectGraphify reads HOME
  // via os.homedir(), which honors $HOME on POSIX.
  const prevHome = process.env.HOME;
  const prevPath = process.env.PATH;
  process.env.HOME = dir;
  process.env.PATH = ''; // no `which graphify`, no `pipx`, no `pip`
  try {
    const tools = await detectTools(dir);
    assert.equal(tools.tool, null);
    assert.equal(tools.kind, null);
    assert.equal(tools.instruction, '');
    assert.equal(tools.graphify, false);
    assert.equal(tools.codeReviewGraph, false);
  } finally {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
  }
});

test('detectTools: graphify-out/ in project → kind=output-cached, "read" wording', async () => {
  const dir = await makeTmpDir();
  await mkdir(join(dir, 'graphify-out'), { recursive: true });
  const prevHome = process.env.HOME;
  const prevPath = process.env.PATH;
  process.env.HOME = dir; // no skill file under this fake home
  process.env.PATH = '';  // no CLI on PATH
  try {
    const tools = await detectTools(dir);
    assert.equal(tools.tool, 'graphify');
    assert.equal(tools.kind, 'output-cached');
    assert.match(tools.instruction, /graphify-out/);
    assert.match(tools.instruction, /read|GRAPH_REPORT|graph\.json/i);
    assert.doesNotMatch(tools.instruction, /Skill\(/);
  } finally {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
  }
});

test('detectTools: skill file under HOME → kind=skill, Skill-tool wording', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const fakeHome = await makeTmpDir();
  await mkdir(join(fakeHome, '.claude', 'skills', 'graphify'), { recursive: true });
  // SKILL.md must exist for the skill probe to succeed.
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(fakeHome, '.claude', 'skills', 'graphify', 'SKILL.md'), '# graphify\n', 'utf8');
  const prevHome = process.env.HOME;
  const prevPath = process.env.PATH;
  process.env.HOME = fakeHome;
  process.env.PATH = '';
  try {
    const tools = await detectTools(dir);
    assert.equal(tools.tool, 'graphify');
    assert.equal(tools.kind, 'skill');
    assert.match(tools.instruction, /Skill\(skill:\s*"graphify"/);
  } finally {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
  }
});

test('detectTools: CLI on PATH wins over a skill file (priority order)', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const fakeHome = await makeTmpDir();
  await mkdir(join(fakeHome, '.claude', 'skills', 'graphify'), { recursive: true });
  const { writeFile, chmod } = await import('node:fs/promises');
  await writeFile(join(fakeHome, '.claude', 'skills', 'graphify', 'SKILL.md'), '# graphify\n', 'utf8');

  // Fake `which` + `graphify` on a controlled PATH so whichOk('graphify') succeeds
  // without depending on what's installed on the host.
  const binDir = await makeTmpDir();
  const which = '#!/bin/sh\n[ "$1" = graphify ] && echo "' + binDir + '/graphify" && exit 0\nexit 1\n';
  await writeFile(join(binDir, 'which'), which, 'utf8');
  await writeFile(join(binDir, 'graphify'), '#!/bin/sh\nexit 0\n', 'utf8');
  await chmod(join(binDir, 'which'), 0o755);
  await chmod(join(binDir, 'graphify'), 0o755);

  const prevHome = process.env.HOME;
  const prevPath = process.env.PATH;
  process.env.HOME = fakeHome;
  process.env.PATH = binDir;
  try {
    const tools = await detectTools(dir);
    assert.equal(tools.tool, 'graphify');
    assert.equal(tools.kind, 'cli', 'CLI on PATH must win over a skill file');
    assert.match(tools.instruction, /Bash/);
    assert.doesNotMatch(tools.instruction, /Skill\(/);
  } finally {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
  }
});

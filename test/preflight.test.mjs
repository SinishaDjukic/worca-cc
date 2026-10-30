// test/preflight.test.mjs
// Verifies that preflight detection branches the agent instruction by the
// kind of graphify install (cli / skill / output-cached). Wrong wording is
// the root cause of agents never invoking graphify — a CLI instruction makes
// an agent try Bash, a Skill instruction makes it try the Skill tool.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectTools, buildInstruction, _resetToolProbeCache, probeClaudeCapabilities } from '../src/core/preflight.mjs';
import { checkRows } from './helpers/rows.mjs';
import { writeFileSync, chmodSync } from 'node:fs';

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
beforeEach(() => {
  _resetToolProbeCache();
});

test('buildInstruction: wording per install kind (skill → Skill tool, cli → Bash, output-cached → read), code-review-graph, no tool, no <projectDir> token', async () => {
  await checkRows([
    { name: 'buildInstruction: skill kind tells the agent to use the Skill tool, not Bash', run: () => {
      const text = buildInstruction('graphify', 'skill');
      assert.match(text, /Skill/, 'must name the Skill tool');
      assert.match(text, /Skill\(skill:\s*"graphify"/, 'must show the exact Skill invocation');
      assert.match(text, /not.*Bash|do NOT.*run.*Bash/i, 'must warn NOT to run via Bash');
    } },
    { name: 'buildInstruction: cli kind tells the agent to run via Bash', run: () => {
      const text = buildInstruction('graphify', 'cli');
      assert.match(text, /Bash/, 'must mention Bash');
      assert.match(text, /graphify-out/, 'must point at the output dir');
      assert.doesNotMatch(text, /Skill\(/, 'must not suggest the Skill tool for a CLI install');
    } },
    { name: 'buildInstruction: output-cached kind tells the agent to read the cached graph', run: () => {
      const text = buildInstruction('graphify', 'output-cached');
      assert.match(text, /graphify-out/, 'must point at the cached output dir');
      assert.match(text, /read|GRAPH_REPORT|graph\.json/i, 'must instruct to READ, not run/invoke');
      assert.doesNotMatch(text, /Skill\(/, 'must not suggest the Skill tool when only output is cached');
      assert.doesNotMatch(text, /\bRun it via Bash\b/, 'must not suggest running a binary');
    } },
    { name: 'buildInstruction: code-review-graph instruction is CLI-shaped', run: () => {
      const text = buildInstruction('code-review-graph', 'cli');
      assert.match(text, /code-review-graph/);
      assert.match(text, /Bash/);
    } },
    { name: 'buildInstruction: no tool → empty string', run: () => {
      assert.equal(buildInstruction(null, null), '');
      assert.equal(buildInstruction(undefined, undefined), '');
    } },
    { name: 'buildInstruction: never leaks the literal <projectDir> token', run: () => {
      for (const kind of ['skill', 'cli', 'output-cached']) {
        const text = buildInstruction('graphify', kind);
        assert.doesNotMatch(text, /<projectDir>/, `${kind} instruction must not contain <projectDir>`);
        assert.match(text, /graphify-out/, `${kind} instruction must still point at graphify-out/`);
      }
    } },
  ]);
});

test('probeClaudeCapabilities runs `claude --help` and `--version` under Claude\'s run env, never worca\'s whole env', POSIX_SHIM, async () => {
  const dir = await makeTmpDir();
  const bin = join(dir, 'claude');
  // Answers like a capable CLI only when a server-only variable is absent from its env.
  writeFileSync(bin, '#!/bin/sh\n[ -n "$WORCA_TEST_SERVER_SECRET" ] && exit 3\ncase "$1" in --help) echo "--mcp-config <f> --plugin-dir <d>" ;; --version) echo "2.1.300 (Claude Code)" ;; esac\n');
  chmodSync(bin, 0o755);
  process.env.WORCA_TEST_SERVER_SECRET = 'server-only';
  try {
    assert.deepEqual(await probeClaudeCapabilities(bin), { mcpConfig: true, pluginDir: true, version: '2.1.300' });
  } finally { delete process.env.WORCA_TEST_SERVER_SECRET; }
});

test('detectTools: no tooling → null tool; a graphify-out/ dir → output-cached with "read" wording', async () => {
  await checkRows([
    { name: 'detectTools: project with no tooling returns null tool + empty instruction', run: async () => {
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
    } },
    { name: 'detectTools: graphify-out/ in project → kind=output-cached, "read" wording', run: async () => {
      _resetToolProbeCache();   // the file's beforeEach, once per former test
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
    } },
  ]);
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

test('detectTools: CLI probes are memoized per PATH (fs checks stay live); _resetToolProbeCache forgets them', { skip: process.platform === 'win32' }, async () => {
  const dir = await makeTmpDir();
  const binDir = await makeTmpDir();
  const { writeFile, chmod, readFile } = await import('node:fs/promises');
  // A `which` that logs every probe and finds nothing, so no `kind: 'cli'`.
  const log = join(binDir, 'which.log');
  await writeFile(join(binDir, 'which'), '#!/bin/sh\necho "$1" >> "' + log + '"\nexit 1\n', 'utf8');
  await chmod(join(binDir, 'which'), 0o755);
  const graphifyProbes = async () => (await readFile(log, 'utf8')).split('\n').filter((l) => l === 'graphify').length;

  const prevHome = process.env.HOME;
  const prevPath = process.env.PATH;
  process.env.HOME = dir; // no skill file under this fake home
  process.env.PATH = binDir;
  try {
    const first = await detectTools(dir);
    assert.equal(first.tool, null);
    await mkdir(join(dir, 'graphify-out'));
    const second = await detectTools(dir);
    assert.equal(second.kind, 'output-cached', 'the graphify-out check stays live');
    assert.equal(await graphifyProbes(), 1, 'the second call answers from the memo');
    _resetToolProbeCache();
    await detectTools(dir);
    assert.equal(await graphifyProbes(), 2, 'a reset probes again');
  } finally {
    process.env.HOME = prevHome;
    process.env.PATH = prevPath;
  }
});

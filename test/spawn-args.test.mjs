// test/spawn-args.test.mjs
// Phase 3 (§5.3 / §5.5 / V1): the spawn argv for a detached run.
//
// Two layers, deliberately:
//   1. buildClaudeArgs — the pure builder (with and without --mcp-config, grants
//      appended + de-duped, and the NEGATIVE baseline: no --add-dir, no
//      --strict-mcp-config, byte-identical argv when mcpConfigPath is absent).
//   2. runClaude -> runReal — the END-TO-END assertion the plan calls out by name:
//      runClaude explicitly destructures its options and re-lists every field in
//      the runReal call, so a field added only to buildClaudeArgs + runReal is
//      silently DROPPED before runReal ever sees it while a builder-only test
//      still passes. A fake `bin` that records its own argv is what catches that.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile, chmod, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildClaudeArgs, runClaude } from '../src/core/claude-runner.mjs';

const dirs = [];
const tmp = async () => {
  const d = await mkdtemp(join(tmpdir(), 'worca-cc-argv-'));
  dirs.push(d);
  return d;
};
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });

const BASE = { prompt: 'p', permissionMode: 'acceptEdits' };

// ── buildClaudeArgs ──────────────────────────────────────────────────────────

test('buildClaudeArgs: no mcpConfigPath => argv is byte-identical to today', () => {
  const args = buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'] });
  assert.deepEqual(args, [
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Bash',
  ]);
});

test('buildClaudeArgs: mcpConfigPath adds --mcp-config <path> (E5)', () => {
  const args = buildClaudeArgs({ ...BASE, allowedTools: ['Read'], mcpConfigPath: '/run/mcp.json' });
  const i = args.indexOf('--mcp-config');
  assert.ok(i > -1, `--mcp-config present: ${JSON.stringify(args)}`);
  assert.equal(args[i + 1], '/run/mcp.json');
});

test('buildClaudeArgs: mcpServerGrants are unioned into --allowedTools and de-duped (V1 branch (a))', () => {
  const args = buildClaudeArgs({
    ...BASE,
    allowedTools: ['Read', 'Bash', 'mcp__db'],       // already granted by frontmatter
    mcpServerGrants: ['mcp__db', 'mcp__browser'],    // db must NOT be duplicated
  });
  const i = args.indexOf('--allowedTools');
  assert.equal(args[i + 1], 'Read,Bash,mcp__db,mcp__browser');
});

test('buildClaudeArgs: grants alone produce --allowedTools even with no base tools', () => {
  const args = buildClaudeArgs({ ...BASE, mcpServerGrants: ['mcp__db'] });
  const i = args.indexOf('--allowedTools');
  assert.ok(i > -1);
  assert.equal(args[i + 1], 'mcp__db');
});

test('buildClaudeArgs: the baseline carries NO --add-dir and NO --strict-mcp-config', () => {
  const args = buildClaudeArgs({
    ...BASE, allowedTools: ['Read'], mcpConfigPath: '/run/mcp.json', mcpServerGrants: ['mcp__db'],
  });
  assert.ok(!args.includes('--add-dir'), '§5.3: --add-dir is deliberately never passed (E2/E3)');
  assert.ok(!args.includes('--strict-mcp-config'), 'E11: user scope + plugins must keep loading');
});

test('buildClaudeArgs: mcpServerGrants without mcpConfigPath still grants (native-scope servers)', () => {
  const args = buildClaudeArgs({ ...BASE, mcpServerGrants: ['mcp__db'] });
  assert.ok(!args.includes('--mcp-config'));
  assert.equal(args[args.indexOf('--allowedTools') + 1], 'mcp__db');
});

// ── runClaude -> runReal forwarding (the drop-at-runClaude guard) ─────────────

/** A fake `claude` that appends its own argv (NUL-separated) to a file, then exits 0. */
async function fakeBin(dir, outFile) {
  const bin = join(dir, 'fake-claude.sh');
  await writeFile(
    bin,
    '#!/bin/sh\n' +
    `for a in "$@"; do printf '%s\\0' "$a" >> ${JSON.stringify(outFile)}; done\n` +
    'exit 0\n',
    'utf8',
  );
  await chmod(bin, 0o755);
  return bin;
}

test('runClaude FORWARDS mcpConfigPath + mcpServerGrants to runReal (not just buildClaudeArgs)', async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;                       // must reach runReal, not runMock
  try {
    await runClaude({
      cwd: dir, bin, prompt: 'p',
      allowedTools: ['Read'],
      mcpConfigPath: join(dir, 'mcp.json'),
      mcpServerGrants: ['mcp__db', 'mcp__browser'],
    });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK;
    else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--mcp-config');
  assert.ok(i > -1, `--mcp-config reached the spawn: ${JSON.stringify(argv)}`);
  assert.equal(argv[i + 1], join(dir, 'mcp.json'));
  assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Read,mcp__db,mcp__browser');
});

// ── runClaude -> runMock forwarding of workspaceWriteTargets (§8.10, Phase 4) ─
// Same drop-at-runClaude hazard as the MCP fields, on the mock branch: the six-field
// runMock call is a GATE, so a field added to runMock/mockImplementer alone would
// never arrive. The mock's own file writes are the observable proof.

test('runClaude FORWARDS workspaceWriteTargets to runMock -> mockImplementer', async () => {
  const dir = await tmp();
  const t1 = join(dir, 'repos', 'a-1111');
  const t2 = join(dir, 'repos', 'b-2222');
  await mkdir(t1, { recursive: true });
  await mkdir(t2, { recursive: true });
  await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
    workspaceWriteTargets: [t1, t2],
  });
  for (const t of [t1, t2]) {
    assert.ok(existsSync(join(t, 'src', 'feature.mjs')), `mock wrote into ${t}`);
    assert.ok(existsSync(join(t, 'test', 'feature.test.mjs')), `mock wrote the test into ${t}`);
  }
  assert.ok(!existsSync(join(dir, 'src')), 'and NOT into the cwd (the run root)');
});

test('runClaude with empty/absent workspaceWriteTargets falls back to the cwd (byte-identical)', async () => {
  for (const extra of [{}, { workspaceWriteTargets: [] }, { workspaceWriteTargets: undefined }]) {
    const dir = await tmp();
    await runClaude({
      cwd: dir, mock: true, onEvent: () => {},
      prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
      ...extra,
    });
    assert.ok(existsSync(join(dir, 'src', 'feature.mjs')), `cwd fallback for ${JSON.stringify(extra)}`);
  }
});

test('runReal IGNORES workspaceWriteTargets — argv is byte-identical (never a spawn flag)', async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await runClaude({
      cwd: dir, bin, prompt: 'p', allowedTools: ['Read', 'Bash'],
      workspaceWriteTargets: ['/rr/repos/a', '/rr/repos/b'],
    });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK;
    else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  assert.deepEqual(argv, [
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Bash',
  ]);
});

test('runClaude without the two new fields spawns the SAME argv as before (legacy parity)', async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', allowedTools: ['Read', 'Bash'] });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK;
    else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  assert.deepEqual(argv, [
    '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Read,Bash',
  ]);
});

// ── guardrails: permissionRules -> ONE --settings payload ────────────────────
import { buildSettingsArgs, buildHookSettings } from '../src/core/claude-runner.mjs';

test('buildClaudeArgs: permissionRules emit a single --settings with permissions', () => {
  const args = buildClaudeArgs({
    ...BASE, allowedTools: ['Read'],
    permissionRules: { deny: ['Read(.env*)', 'Bash(curl:*)'] },
  });
  const i = args.indexOf('--settings');
  assert.ok(i > -1, `--settings present: ${JSON.stringify(args)}`);
  assert.equal(args.indexOf('--settings', i + 1), -1, 'exactly ONE --settings flag');
  const settings = JSON.parse(args[i + 1]);
  assert.deepEqual(settings.permissions, { deny: ['Read(.env*)', 'Bash(curl:*)'] });
  assert.ok(!('hooks' in settings), 'no hook settings when WORCA_SUBAGENT_HOOKS is off');
});

test('buildClaudeArgs: permissionRules absent/null/empty -> argv byte-identical to today', () => {
  for (const extra of [{}, { permissionRules: null }, { permissionRules: undefined }, { permissionRules: { deny: [] } }]) {
    const args = buildClaudeArgs({ ...BASE, allowedTools: ['Read', 'Bash'], ...extra });
    assert.deepEqual(args, [
      '-p', 'p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
      '--allowedTools', 'Read,Bash',
    ]);
  }
});

test('buildSettingsArgs: telemetry hooks + permissions merge into ONE --settings json', () => {
  const prev = process.env.WORCA_SUBAGENT_HOOKS;
  process.env.WORCA_SUBAGENT_HOOKS = '1';
  try {
    const args = buildSettingsArgs({ deny: ['Bash(curl:*)'] });
    assert.equal(args[0], '--include-hook-events');
    assert.equal(args[1], '--settings');
    assert.equal(args.length, 3);
    const settings = JSON.parse(args[2]);
    assert.deepEqual(settings.permissions, { deny: ['Bash(curl:*)'] });
    assert.ok(settings.hooks?.PostToolUse, 'hook settings preserved in the SAME payload');
  } finally {
    if (prev === undefined) delete process.env.WORCA_SUBAGENT_HOOKS;
    else process.env.WORCA_SUBAGENT_HOOKS = prev;
  }
});

test('buildSettingsArgs: hooks off + no rules -> [] (baseline untouched)', () => {
  assert.deepEqual(buildSettingsArgs(null), []);
  assert.equal(buildHookSettings(), null);
});

test('buildSettingsArgs: malformed rules warn once and fall through; empty stays quiet', () => {
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    // Truthy object, nothing usable: argv must stay baseline AND say so.
    assert.deepEqual(buildSettingsArgs({ deny: 'Bash(curl:*)' }), []);
    assert.equal(warnings.length, 1, `exactly one warn: ${JSON.stringify(warnings)}`);
    assert.match(warnings[0], /permissionRules/);
    // Normal empty/absent shapes are not a problem -> no extra warn.
    warnings.length = 0;
    for (const rules of [null, undefined, {}, { deny: [] }]) {
      assert.deepEqual(buildSettingsArgs(rules), []);
    }
    assert.deepEqual(warnings, [], 'empty/absent permissionRules never warn');
  } finally {
    console.warn = realWarn;
  }
});

test('runClaude FORWARDS permissionRules to runReal (drop-at-gate guard)', async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await runClaude({
      cwd: dir, bin, prompt: 'p', allowedTools: ['Read'],
      permissionRules: { deny: ['Read(.env*)'] },
    });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK;
    else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  const i = argv.indexOf('--settings');
  assert.ok(i > -1, `--settings reached the spawn: ${JSON.stringify(argv)}`);
  assert.deepEqual(JSON.parse(argv[i + 1]).permissions, { deny: ['Read(.env*)'] });
});

test('runClaude mock path is unaffected by permissionRules (no spawn, no error)', async () => {
  const dir = await tmp();
  const r = await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
    permissionRules: { deny: ['Read(.env*)'] },
  });
  assert.equal(r.exitCode, 0);
});

// ── guardrails: env scrub ────────────────────────────────────────────────────
import { buildSpawnEnv } from '../src/core/claude-runner.mjs';

/** A fake `claude` that dumps its own environment (KEY=VALUE lines) to a file. */
async function fakeEnvBin(dir, outFile) {
  const bin = join(dir, 'fake-claude-env.sh');
  await writeFile(bin, '#!/bin/sh\nenv > ' + JSON.stringify(outFile) + '\nexit 0\n', 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

test('buildSpawnEnv: scrub off -> undefined (spawn inherits, byte-identical to today)', () => {
  assert.equal(buildSpawnEnv(false, []), undefined);
  assert.equal(buildSpawnEnv(undefined, undefined), undefined);
});

test('buildSpawnEnv: scrub on -> base + ANTHROPIC_*/CLAUDE_* + allowlist only', () => {
  const prev = { AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY, NPM_TOKEN: process.env.NPM_TOKEN, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
  process.env.AWS_SECRET_ACCESS_KEY = 'leak-me';
  process.env.NPM_TOKEN = 'npm-secret';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  try {
    const env = buildSpawnEnv(true, ['NPM_TOKEN']);
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined, 'cloud creds are scrubbed');
    assert.equal(env.NPM_TOKEN, 'npm-secret', 'allowlisted var passes through');
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-ant-test', 'claude auth survives');
    assert.equal(env.PATH, process.env.PATH, 'base PATH survives');
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});

test('runClaude FORWARDS envScrub/envAllowlist to the spawn env (drop-at-gate guard)', async () => {
  const dir = await tmp();
  const out = join(dir, 'env.txt');
  const bin = await fakeEnvBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  const prevLeak = process.env.WORCA_TEST_LEAK;
  delete process.env.WORCA_MOCK;
  process.env.WORCA_TEST_LEAK = 'should-not-appear';
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', envScrub: true, envAllowlist: [] });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    if (prevLeak === undefined) delete process.env.WORCA_TEST_LEAK; else process.env.WORCA_TEST_LEAK = prevLeak;
  }
  const envDump = await readFile(out, 'utf8');
  assert.ok(!envDump.includes('WORCA_TEST_LEAK'), 'scrubbed var must not reach the child');
  assert.ok(envDump.includes('PATH='), 'the child still got a usable base env');
});

test('runClaude with envScrub off inherits the parent env (legacy parity)', async () => {
  const dir = await tmp();
  const out = join(dir, 'env.txt');
  const bin = await fakeEnvBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  const prevLeak = process.env.WORCA_TEST_LEAK;
  delete process.env.WORCA_MOCK;
  process.env.WORCA_TEST_LEAK = 'inherited';
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p' });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    if (prevLeak === undefined) delete process.env.WORCA_TEST_LEAK; else process.env.WORCA_TEST_LEAK = prevLeak;
  }
  assert.ok((await readFile(out, 'utf8')).includes('WORCA_TEST_LEAK=inherited'));
});

// ── configurable models: modelEnv (design §4.4) ──────────────────────────────
// Same drop-at-runClaude hazard as every other field, PLUS the merge table:
//   scrub off + modelEnv -> { ...process.env, ...modelEnv } (still inherits)
//   scrub on  + modelEnv -> { ...scrubbed, ...modelEnv }   (survives scrub)
//   reserved keys        -> re-dropped defensively at the spawn
//   absent/empty         -> byte-identical env (inherit / scrub as before)

/** Run against the env-dumping fake bin with WORCA_MOCK cleared; returns the dump. */
async function runWithEnvDump(extraOpts, { leak } = {}) {
  const dir = await tmp();
  const out = join(dir, 'env.txt');
  const bin = await fakeEnvBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  const prevLeak = process.env.WORCA_TEST_LEAK;
  delete process.env.WORCA_MOCK;
  if (leak !== undefined) process.env.WORCA_TEST_LEAK = leak;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', ...extraOpts });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
    if (prevLeak === undefined) delete process.env.WORCA_TEST_LEAK; else process.env.WORCA_TEST_LEAK = prevLeak;
  }
  return readFile(out, 'utf8');
}

test('runClaude FORWARDS modelEnv into the spawn env; parent env still inherited (scrub off)', async () => {
  const dump = await runWithEnvDump(
    { modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' } },
    { leak: 'inherited' },
  );
  assert.ok(dump.includes('ANTHROPIC_BASE_URL=https://proxy.test/v1'), 'modelEnv reached the child');
  assert.ok(dump.includes('WORCA_TEST_LEAK=inherited'), 'still inherits process.env around it');
});

test('modelEnv SURVIVES env scrub and WINS collisions with the ambient env', async () => {
  const prevUrl = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = 'https://ambient.example';
  let dump;
  try {
    dump = await runWithEnvDump(
      { envScrub: true, envAllowlist: [], modelEnv: { ANTHROPIC_BASE_URL: 'https://model.example' } },
      { leak: 'should-not-appear' },
    );
  } finally {
    if (prevUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = prevUrl;
  }
  assert.ok(dump.includes('ANTHROPIC_BASE_URL=https://model.example'), 'model env wins the collision');
  assert.ok(!dump.includes('https://ambient.example'), 'ambient value is gone');
  assert.ok(!dump.includes('WORCA_TEST_LEAK'), 'scrub still applies to everything else');
  assert.ok(dump.includes('PATH='), 'scrub base env intact');
});

test('reserved modelEnv keys are re-dropped at the spawn (defense-in-depth, with a warning)', async () => {
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  let dump;
  try {
    dump = await runWithEnvDump({
      modelEnv: { WORCA_MOCK: '1', PATH: '/evil', ANTHROPIC_BASE_URL: 'https://ok.example' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.ok(dump.includes('ANTHROPIC_BASE_URL=https://ok.example'), 'legit key still lands');
  assert.ok(!dump.includes('WORCA_MOCK=1'), 'reserved WORCA_ key dropped (would subvert mock mode)');
  assert.ok(!dump.includes('PATH=/evil'), 'PATH override dropped');
  assert.ok(dump.includes(`PATH=${process.env.PATH}`), 'parent PATH intact');
  assert.equal(warnings.filter((w) => w.includes('modelEnv')).length, 2, `one warn per dropped key: ${JSON.stringify(warnings)}`);
});

test('absent/empty modelEnv keeps the spawn env byte-identical (inherit path)', async () => {
  for (const extra of [{}, { modelEnv: {} }, { modelEnv: undefined }]) {
    const dump = await runWithEnvDump(extra, { leak: 'inherited' });
    assert.ok(dump.includes('WORCA_TEST_LEAK=inherited'), `inherits for ${JSON.stringify(extra)}`);
  }
});

test('runClaude mock path is unaffected by modelEnv (no spawn, no error)', async () => {
  const dir = await tmp();
  const r = await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
    modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test' },
  });
  assert.equal(r.exitCode, 0);
});

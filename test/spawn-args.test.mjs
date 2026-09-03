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
import { buildClaudeArgs, runClaude, debugSpawnEnabled, redactArgvForLog } from '../src/core/claude-runner.mjs';

const POSIX_SHIM = { skip: process.platform === 'win32' ? 'fake claude shim is a POSIX shell script (no .exe stand-in on Windows)' : false };

// The host guard (see host-guard-wiring.test.mjs for its own coverage) adds
// --settings / --append-system-prompt / WORCA_HOST_PID to every real spawn;
// the parity assertions here isolate THIS file's feature, so pin it off.
process.env.WORCA_HOST_GUARD = '0';

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

test('runClaude FORWARDS mcpConfigPath + mcpServerGrants to runReal (not just buildClaudeArgs)', POSIX_SHIM, async () => {
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
// Same drop-at-runClaude hazard as the MCP fields, on the mock branch: the eight-field
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

test('runReal IGNORES workspaceWriteTargets — argv is byte-identical (never a spawn flag)', POSIX_SHIM, async () => {
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

test('runClaude without the two new fields spawns the SAME argv as before (legacy parity)', POSIX_SHIM, async () => {
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

test('runClaude FORWARDS permissionRules to runReal (drop-at-gate guard)', POSIX_SHIM, async () => {
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

test('buildSpawnEnv: scrub on -> base + ANTHROPIC_*/CLAUDE_* + allowlist only', POSIX_SHIM, () => {
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

test('runClaude FORWARDS envScrub/envAllowlist to the spawn env (drop-at-gate guard)', POSIX_SHIM, async () => {
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

test('runClaude with envScrub off inherits the parent env (legacy parity)', POSIX_SHIM, async () => {
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

test('runClaude FORWARDS modelEnv into the spawn env; parent env still inherited (scrub off)', POSIX_SHIM, async () => {
  const dump = await runWithEnvDump(
    { modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' } },
    { leak: 'inherited' },
  );
  assert.ok(dump.includes('ANTHROPIC_BASE_URL=https://proxy.test/v1'), 'modelEnv reached the child');
  assert.ok(dump.includes('WORCA_TEST_LEAK=inherited'), 'still inherits process.env around it');
});

test('modelEnv SURVIVES env scrub and WINS collisions with the ambient env', POSIX_SHIM, async () => {
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

test('reserved modelEnv keys are re-dropped at the spawn (defense-in-depth, with a warning)', POSIX_SHIM, async () => {
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
  assert.equal(warnings.filter((w) => w.includes('modelEnv: dropping')).length, 2, `one warn per dropped key: ${JSON.stringify(warnings)}`);
});

test('absent/empty modelEnv keeps the spawn env byte-identical (inherit path)', POSIX_SHIM, async () => {
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

// ── wire model: ANTHROPIC_MODEL in modelEnv names the id the endpoint sees (#374)
// Without this the key was legal-but-dead: the spawned `--model <catalog-id>`
// always outranked the env var inside the CLI. The rule: the resolved model
// env's ANTHROPIC_MODEL replaces the catalog id in argv (with one warning);
// the catalog id remains worca's handle everywhere else.

/** Run against the argv-dumping fake bin with WORCA_MOCK cleared; returns argv[].
 *  `events` (optional array) collects every runner event, so a test can assert on
 *  the run-stream path — the one that reaches live-log.ndjson and the UI. */
async function runWithArgvDump(extraOpts, { events } = {}) {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  try {
    await runClaude({ cwd: dir, bin, prompt: 'p', ...(events ? { onEvent: (e) => events.push(e) } : {}), ...extraOpts });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  }
  return (await readFile(out, 'utf8')).split('\0').filter(Boolean);
}

test('modelEnv.ANTHROPIC_MODEL replaces the catalog id in --model (wire id), with one warning', POSIX_SHIM, async () => {
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  let argv;
  try {
    argv = await runWithArgvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { CLAUDE_CODE_USE_VERTEX: '1', ANTHROPIC_MODEL: 'claude-opus-4-8' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-opus-4-8', 'wire id reached argv');
  assert.ok(!argv.includes('opus-4-8-vertex'), 'catalog id is not in argv');
  assert.equal(
    warnings.filter((w) => w.includes('wire model')).length, 1,
    `one wire-model warning: ${JSON.stringify(warnings)}`,
  );
});

test('modelEnv without ANTHROPIC_MODEL keeps --model = catalog id (regression guard)', POSIX_SHIM, async () => {
  const argv = await runWithArgvDump({
    model: 'claude-opus-4-8',
    modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' },
  });
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-opus-4-8');
});

test('ANTHROPIC_MODEL as ${VAR}: set -> expanded wire id; unset -> falls back to catalog id', POSIX_SHIM, async () => {
  const prev = process.env.WORCA_TEST_WIRE_MODEL;
  process.env.WORCA_TEST_WIRE_MODEL = 'claude-opus-4-8';
  let argv;
  try {
    argv = await runWithArgvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { ANTHROPIC_MODEL: '${WORCA_TEST_WIRE_MODEL}' },
    });
  } finally {
    if (prev === undefined) delete process.env.WORCA_TEST_WIRE_MODEL;
    else process.env.WORCA_TEST_WIRE_MODEL = prev;
  }
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-opus-4-8', 'expanded ${VAR} is the wire id');

  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  delete process.env.WORCA_TEST_WIRE_MODEL_UNSET; // defensively: this var must be unset
  let argv2;
  try {
    argv2 = await runWithArgvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { ANTHROPIC_MODEL: '${WORCA_TEST_WIRE_MODEL_UNSET}' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(argv2[argv2.indexOf('--model') + 1], 'opus-4-8-vertex', 'unresolvable ref -> catalog id');
  assert.equal(
    warnings.filter((w) => w.includes('configured wire model was dropped')).length, 1,
    `dropped-wire-model warning fires: ${JSON.stringify(warnings)}`,
  );
  assert.equal(
    warnings.filter((w) => w.includes('wire model "')).length, 0,
    'the plain wire-model line does NOT fire on fallback',
  );
});

test('whitespace-only ANTHROPIC_MODEL is dropped -> catalog id, with the dropped-wire-model warning', POSIX_SHIM, async () => {
  const realWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  let argv;
  try {
    argv = await runWithArgvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { ANTHROPIC_MODEL: '   ' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(argv[argv.indexOf('--model') + 1], 'opus-4-8-vertex', 'whitespace-only -> catalog id');
  assert.equal(
    warnings.filter((w) => w.includes('configured wire model was dropped')).length, 1,
    `dropped-wire-model warning fires: ${JSON.stringify(warnings)}`,
  );
});

test('a pasted-with-spaces ANTHROPIC_MODEL is trimmed before reaching --model', POSIX_SHIM, async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  let argv;
  try {
    argv = await runWithArgvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { ANTHROPIC_MODEL: '  claude-opus-4-8  ' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(argv[argv.indexOf('--model') + 1], 'claude-opus-4-8', 'trimmed wire id in argv');
});

test('wire id also lands in the spawn env (harmless: the explicit flag wins in the CLI)', POSIX_SHIM, async () => {
  const realWarn = console.warn;
  console.warn = () => {};
  let dump;
  try {
    dump = await runWithEnvDump({
      model: 'opus-4-8-vertex',
      modelEnv: { ANTHROPIC_MODEL: 'claude-opus-4-8' },
    });
  } finally {
    console.warn = realWarn;
  }
  assert.ok(dump.includes('ANTHROPIC_MODEL=claude-opus-4-8'));
});

// ── debugSpawnEnabled / redactArgvForLog unit tests ──────────────────────────

test('debugSpawnEnabled: off by default; truthy values enable; 0/false disable', () => {
  const prev = process.env.WORCA_DEBUG_SPAWN;
  try {
    delete process.env.WORCA_DEBUG_SPAWN; assert.equal(debugSpawnEnabled(), false);
    process.env.WORCA_DEBUG_SPAWN = '';      assert.equal(debugSpawnEnabled(), false);
    process.env.WORCA_DEBUG_SPAWN = '0';     assert.equal(debugSpawnEnabled(), false);
    process.env.WORCA_DEBUG_SPAWN = 'false'; assert.equal(debugSpawnEnabled(), false);
    process.env.WORCA_DEBUG_SPAWN = '1';     assert.equal(debugSpawnEnabled(), true);
    process.env.WORCA_DEBUG_SPAWN = 'yes';   assert.equal(debugSpawnEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
});

test('debugSpawnEnabled: with the env unset or EMPTY the stored settings.json value applies (CLI runs honour the UI checkbox)', async () => {
  const home = await tmp();
  await mkdir(join(home, '.worca-cc'), { recursive: true });
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, WORCA_DEBUG_SPAWN: process.env.WORCA_DEBUG_SPAWN };
  process.env.HOME = home; process.env.USERPROFILE = home;
  try {
    await writeFile(join(home, '.worca-cc', 'settings.json'), JSON.stringify({ debugSpawnEnabled: true }), 'utf8');
    delete process.env.WORCA_DEBUG_SPAWN; assert.equal(debugSpawnEnabled(), true, 'unset env → stored true');
    process.env.WORCA_DEBUG_SPAWN = '';    assert.equal(debugSpawnEnabled(), true, 'empty env is not an override');
    process.env.WORCA_DEBUG_SPAWN = '0';   assert.equal(debugSpawnEnabled(), false, 'an exported 0 is an explicit OFF');
    await writeFile(join(home, '.worca-cc', 'settings.json'), '{}', 'utf8');
    delete process.env.WORCA_DEBUG_SPAWN;  assert.equal(debugSpawnEnabled(), false, 'default stored → off');
    process.env.WORCA_DEBUG_SPAWN = '1';   assert.equal(debugSpawnEnabled(), true, 'env on wins over default');
  } finally {
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test('redactArgvForLog: truncates ANY long token (prompt, --settings JSON, tool lists); flags & short values verbatim', () => {
  const big = 'x'.repeat(500);
  const settings = JSON.stringify({ permissions: { deny: Array.from({ length: 40 }, (_, i) => `Bash(rm -rf /${i})`) } });
  const argv = ['-p', big, '--output-format', 'stream-json', '--settings', settings, '--append-system-prompt', big];
  const out = redactArgvForLog(argv);
  assert.equal(out.length, argv.length, 'one output token per input token');
  assert.equal(out[0], '-p');
  assert.ok(out[1].startsWith('x'.repeat(64)) && out[1].endsWith('(500 chars)'), out[1]);
  assert.equal(out[2], '--output-format');
  assert.equal(out[3], 'stream-json');
  assert.equal(out[4], '--settings');
  assert.ok(out[5].length < 100 && out[5].endsWith(`(${settings.length} chars)`), 'inline --settings JSON is capped too');
  assert.ok(out[7].endsWith('(500 chars)'), out[7]);
  assert.deepEqual(argv[1], big, 'input not mutated');
  const staged = ['-p', '--output-format', 'stream-json', '--verbose'];
  assert.deepEqual(redactArgvForLog(staged), staged, 'a staged bare -p and its short followers pass through');
});

// ── always-on applied-env confirmation (Step 4) ──────────────────────────────

test('a resolved card whose ANTHROPIC_MODEL equals the catalog id logs its routing env ONCE per process, readable, secrets as <set, N chars>', POSIX_SHIM, async () => {
  const realWarn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  const prevDbg = process.env.WORCA_DEBUG_SPAWN; delete process.env.WORCA_DEBUG_SPAWN; // ungated path
  const opts = {
    model: 'claude-opus-4-8',
    modelEnv: {
      ANTHROPIC_MODEL: 'claude-opus-4-8',                 // EQUALS the catalog id — wire-model line stays silent
      ANTHROPIC_AUTH_TOKEN: 'tok-abcdef123456',
      ANTHROPIC_BASE_URL: 'https://user:pw@gw-once.example/v1',
    },
  };
  try {
    await runWithArgvDump(opts);
    await runWithArgvDump(opts);                            // same card again: NOT logged twice
  } finally {
    console.warn = realWarn;
    if (prevDbg === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevDbg;
  }
  const applied = warnings.filter((w) => w.includes('routing env applied'));
  assert.equal(applied.length, 1, `exactly one applied-env line across two identical spawns: ${JSON.stringify(warnings)}`);
  assert.ok(applied[0].includes('ANTHROPIC_MODEL=claude-opus-4-8'), 'wire id readable');
  assert.ok(applied[0].includes('ANTHROPIC_BASE_URL=https://gw-once.example/v1'), 'endpoint readable, userinfo stripped');
  assert.ok(applied[0].includes('ANTHROPIC_AUTH_TOKEN=<set, 16 chars>'), 'token: presence + length only');
  assert.ok(!applied[0].includes('3456') && !applied[0].includes('user:pw'), 'no secret fragment');
  assert.equal(warnings.filter((w) => w.includes('wire model "')).length, 0, 'plain wire-model line does NOT fire when ids match');
});

test('a model env with no ANTHROPIC_* routing key (the Ask Worca CLAUDE_CODE_* knob) logs nothing', POSIX_SHIM, async () => {
  const realWarn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  const prevDbg = process.env.WORCA_DEBUG_SPAWN; delete process.env.WORCA_DEBUG_SPAWN;
  const events = [];
  try {
    await runWithArgvDump({ model: 'claude-sonnet-4-8', modelEnv: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' } }, { events });
  } finally {
    console.warn = realWarn;
    if (prevDbg === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prevDbg;
  }
  assert.equal(warnings.length, 0, `no console line at all: ${JSON.stringify(warnings)}`);
  assert.equal(events.filter((e) => e.type === 'stderr' && /spawn-debug|routing env/.test(e.text || '')).length, 0, 'no event either');
});

// ── gated spawn-debug (Step 5) ───────────────────────────────────────────────

test('WORCA_DEBUG_SPAWN off: no spawn-debug line on the console or in the run stream', POSIX_SHIM, async () => {
  const realWarn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  const prev = process.env.WORCA_DEBUG_SPAWN; delete process.env.WORCA_DEBUG_SPAWN;
  const events = [];
  try {
    await runWithArgvDump({ allowedTools: ['Read', 'Bash'], modelEnv: { ANTHROPIC_BASE_URL: 'https://gw-off.example/v1' } }, { events });
  } finally {
    console.warn = realWarn;
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
  assert.equal(warnings.filter((w) => w.includes('spawn-debug')).length, 0, 'no debug console output when gate off');
  assert.equal(events.filter((e) => (e.text || '').includes('spawn-debug')).length, 0, 'no debug event when gate off');
});

test('WORCA_DEBUG_SPAWN on: ONE stderr event with bin + argv + routing env; NO secret value leaks on either path', POSIX_SHIM, async () => {
  const SECRET = 'super-secret-token-value-9999';
  const realWarn = console.warn; const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  const prev = process.env.WORCA_DEBUG_SPAWN; process.env.WORCA_DEBUG_SPAWN = '1';
  const events = [];
  try {
    await runWithArgvDump({
      model: 'claude-opus-4-8',
      modelEnv: {
        ANTHROPIC_BASE_URL: 'https://gw-on.example/v1',
        ANTHROPIC_AUTH_TOKEN: SECRET,
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-card-id',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'haiku-card-id',
        ANTHROPIC_CUSTOM_HEADERS: 'x-secret: abc123456789',
      },
    }, { events });
  } finally {
    console.warn = realWarn;
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
  const debugEvents = events.filter((e) => (e.text || '').includes('spawn-debug'));
  assert.equal(debugEvents.length, 1, `exactly one spawn-debug event: ${JSON.stringify(events.map((e) => e.type))}`);
  assert.equal(debugEvents[0].type, 'stderr');
  assert.equal(debugEvents[0].stream, 'err');
  assert.equal(warnings.filter((w) => w.includes('spawn-debug')).length, 0, 'emitted once — not ALSO console.warned');
  const debug = debugEvents[0].text;
  assert.ok(debug.includes('bin=') && debug.includes('argv='), 'bin + argv logged');
  assert.ok(debug.includes('envScrub=') && debug.includes('childEnvKeys='), 'scrub state + env count logged');
  assert.ok(debug.includes('routingEnv=['), 'routing field present');
  assert.ok(!debug.includes('modelEnv'), 'field is not named modelEnv (dropped-key test counts that substring)');
  assert.ok(debug.includes('ANTHROPIC_BASE_URL=https://gw-on.example/v1'), 'endpoint readable');
  assert.ok(debug.includes('ANTHROPIC_DEFAULT_SONNET_MODEL=sonnet-card-id') && debug.includes('ANTHROPIC_DEFAULT_HAIKU_MODEL=haiku-card-id'), 'model ids readable');
  assert.ok(debug.includes(`ANTHROPIC_AUTH_TOKEN=<set, ${SECRET.length} chars>`), 'token: presence + length only');
  assert.ok(debug.includes('ANTHROPIC_CUSTOM_HEADERS=<set,'), 'custom headers treated as secret');
  const all = [...warnings, ...events.map((e) => e.text || '')].join('\n');
  assert.ok(!all.includes(SECRET), 'full token never printed anywhere');
  assert.ok(!all.includes('super-secret-token') && !all.includes('9999'), 'no token prefix or suffix anywhere');
  assert.ok(!all.includes('abc123456789'), 'header secret never printed');
});

test('WORCA_DEBUG_SPAWN on, no model env: routingEnv=[(none)]', POSIX_SHIM, async () => {
  const prev = process.env.WORCA_DEBUG_SPAWN; process.env.WORCA_DEBUG_SPAWN = '1';
  const events = [];
  try {
    await runWithArgvDump({}, { events });
  } finally {
    if (prev === undefined) delete process.env.WORCA_DEBUG_SPAWN; else process.env.WORCA_DEBUG_SPAWN = prev;
  }
  const debug = events.find((e) => (e.text || '').includes('spawn-debug'));
  assert.ok(debug, 'spawn-debug event present');
  assert.ok(debug.text.includes('routingEnv=[(none)]'), debug.text);
});

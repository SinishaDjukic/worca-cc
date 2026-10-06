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
import { buildClaudeArgs, runClaude, debugSpawnEnabled, redactArgvForLog, cleanRunEnv } from '../src/core/claude-runner.mjs';
import { checkRows } from './helpers/rows.mjs';

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

test('buildClaudeArgs: mcpConfigPath adds --mcp-config <path>; never --add-dir or --strict-mcp-config', async () => {
  await checkRows([
    { name: 'buildClaudeArgs: mcpConfigPath adds --mcp-config <path> (E5)', run: () => {
      const args = buildClaudeArgs({ ...BASE, allowedTools: ['Read'], mcpConfigPath: '/run/mcp.json' });
      const i = args.indexOf('--mcp-config');
      assert.ok(i > -1, `--mcp-config present: ${JSON.stringify(args)}`);
      assert.equal(args[i + 1], '/run/mcp.json');
    } },
    { name: 'buildClaudeArgs: the baseline carries NO --add-dir and NO --strict-mcp-config', run: () => {
      const args = buildClaudeArgs({
        ...BASE, allowedTools: ['Read'], mcpConfigPath: '/run/mcp.json', mcpServerGrants: ['mcp__db'],
      });
      assert.ok(!args.includes('--add-dir'), '§5.3: --add-dir is deliberately never passed (E2/E3)');
      assert.ok(!args.includes('--strict-mcp-config'), 'E11: user scope + plugins must keep loading');
    } },
  ]);
});

test('buildClaudeArgs: mcpServerGrants union into --allowedTools (de-duped; alone; without --mcp-config)', async () => {
  // grants alone and grants without mcpConfigPath were the IDENTICAL input: one call serves both rows.
  const alone = buildClaudeArgs({ ...BASE, mcpServerGrants: ['mcp__db'] });
  await checkRows([
    { name: 'buildClaudeArgs: mcpServerGrants are unioned into --allowedTools and de-duped (V1 branch (a))', run: () => {
      const args = buildClaudeArgs({
        ...BASE,
        allowedTools: ['Read', 'Bash', 'mcp__db'],       // already granted by frontmatter
        mcpServerGrants: ['mcp__db', 'mcp__browser'],    // db must NOT be duplicated
      });
      const i = args.indexOf('--allowedTools');
      assert.equal(args[i + 1], 'Read,Bash,mcp__db,mcp__browser');
    } },
    { name: 'buildClaudeArgs: grants alone produce --allowedTools even with no base tools', run: () => {
      const i = alone.indexOf('--allowedTools');
      assert.ok(i > -1);
      assert.equal(alone[i + 1], 'mcp__db');
    } },
    { name: 'buildClaudeArgs: mcpServerGrants without mcpConfigPath still grants (native-scope servers)', run: () => {
      assert.ok(!alone.includes('--mcp-config'));
      assert.equal(alone[alone.indexOf('--allowedTools') + 1], 'mcp__db');
    } },
  ]);
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

test('runClaude FORWARDS every argv field to runReal: mcpConfigPath, mcpServerGrants, permissionRules, addDirs, agents', POSIX_SHIM, async () => {
  const dir = await tmp();
  const out = join(dir, 'argv.txt');
  const bin = await fakeBin(dir, out);
  const agents = { 'worca-investigator': { description: 'd', prompt: 'p', tools: ['Read'], effort: 'high' } };
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;                       // must reach runReal, not runMock
  try {
    await runClaude({
      cwd: dir, bin, prompt: 'p',
      allowedTools: ['Read'],
      mcpConfigPath: join(dir, 'mcp.json'),
      mcpServerGrants: ['mcp__db', 'mcp__browser'],
      permissionRules: { deny: ['Read(.env*)'] },
      addDirs: [join(dir, 'mount')],
      agents,
    });
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK;
    else process.env.WORCA_MOCK = prevMock;
  }
  const argv = (await readFile(out, 'utf8')).split('\0').filter(Boolean);
  await checkRows([
    { name: 'runClaude FORWARDS mcpConfigPath + mcpServerGrants to runReal (not just buildClaudeArgs)', run: () => {
      const i = argv.indexOf('--mcp-config');
      assert.ok(i > -1, `--mcp-config reached the spawn: ${JSON.stringify(argv)}`);
      assert.equal(argv[i + 1], join(dir, 'mcp.json'));
      assert.equal(argv[argv.indexOf('--allowedTools') + 1], 'Read,mcp__db,mcp__browser');
    } },
    { name: 'runClaude FORWARDS permissionRules to runReal (drop-at-gate guard)', run: () => {
      const i = argv.indexOf('--settings');
      assert.ok(i > -1, `--settings reached the spawn: ${JSON.stringify(argv)}`);
      assert.deepEqual(JSON.parse(argv[i + 1]).permissions, { deny: ['Read(.env*)'] });
    } },
    { name: 'runClaude FORWARDS addDirs to runReal (--add-dir reaches the spawn)', run: () => {
      const i = argv.indexOf('--add-dir');
      assert.ok(i > -1, `--add-dir reached the spawn: ${JSON.stringify(argv)}`);
      assert.equal(argv[i + 1], join(dir, 'mount'));
      assert.equal(argv.lastIndexOf('--add-dir'), i, 'one dir ⇒ one flag');
    } },
    { name: 'runClaude FORWARDS agents to runReal (--agents reaches the spawn)', run: () => {
      const i = argv.indexOf('--agents');
      assert.ok(i > -1, `--agents reached the spawn: ${JSON.stringify(argv)}`);
      assert.deepEqual(JSON.parse(argv[i + 1]), agents);
    } },
  ]);
});

// ── runClaude -> runMock forwarding of workspaceWriteTargets (§8.10, Phase 4) ─
// Same drop-at-runClaude hazard as the MCP fields, on the mock branch: the eight-field
// runMock call is a GATE, so a field added to runMock/mockImplementer alone would
// never arrive. The mock's own file writes are the observable proof.

test('workspaceWriteTargets: the mock implementer writes into each target (never the cwd); empty/absent falls back to the cwd', async () => {
  await checkRows([
    { name: 'runClaude FORWARDS workspaceWriteTargets to runMock -> mockImplementer', run: async () => {
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
    } },
    { name: 'runClaude with empty/absent workspaceWriteTargets falls back to the cwd (byte-identical)', run: async () => {
      for (const extra of [{}, { workspaceWriteTargets: [] }, { workspaceWriteTargets: undefined }]) {
        const dir = await tmp();
        await runClaude({
          cwd: dir, mock: true, onEvent: () => {},
          prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
          ...extra,
        });
        assert.ok(existsSync(join(dir, 'src', 'feature.mjs')), `cwd fallback for ${JSON.stringify(extra)}`);
      }
    } },
  ]);
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

// ── guardrails: permissionRules -> ONE --settings payload ────────────────────
import { buildSettingsArgs } from '../src/core/claude-runner.mjs';

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

test('runClaude mock path is unaffected by permissionRules and modelEnv (no spawn, no error)', async () => {
  const dir = await tmp();
  const r = await runClaude({
    cwd: dir, mock: true, onEvent: () => {},
    prompt: 'MOCK_ROLE: implementer\nMOCK_IN: /plan.md',
    permissionRules: { deny: ['Read(.env*)'] },
    modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test' },
  });
  await checkRows([
    { name: 'runClaude mock path is unaffected by permissionRules (no spawn, no error)', run: () => {
      assert.equal(r.exitCode, 0);
    } },
    { name: 'runClaude mock path is unaffected by modelEnv (no spawn, no error)', run: () => {
      assert.equal(r.exitCode, 0);
    } },
  ]);
});

// ── MCP registry §5.5.3: redactValues, forwarded through the runClaude gate ───

/** A fake `claude` that prints a secret on stdout (an assistant event, then the result) and on stderr. */
async function fakeLeakBin(dir, exitCode) {
  const bin = join(dir, `fake-claude-leak-${exitCode}.sh`);
  await writeFile(bin, '#!/bin/sh\n'
    + `echo '{"type":"assistant","message":{"content":[{"type":"text","text":"key s3cret-value-123"}]}}'\n`
    + "echo 'stderr s3cret-value-123' >&2\n"
    // A failure's detail keeps stderr's last 2000 chars: 1990 more put that cut inside the secret.
    + (exitCode ? `echo '${'p'.repeat(1990)}' >&2\n` : `echo '{"type":"result","result":"done s3cret-value-123"}'\n`)
    + `exit ${exitCode}\n`, 'utf8');
  await chmod(bin, 0o755);
  return bin;
}

test('runClaude FORWARDS redactValues: every event, the result text and the error message are redacted', POSIX_SHIM, async () => {
  const dir = await tmp();
  const prevMock = process.env.WORCA_MOCK;
  delete process.env.WORCA_MOCK;
  const events = [];
  const onEvent = (e) => events.push(e);
  // no 8-char piece of the secret either: a cut that splits a value leaves a piece no value matches
  const partial = (s) => [...Array(9).keys()].some((i) => String(s).includes('s3cret-value-123'.slice(i, i + 8)));
  try {
    const ok = await runClaude({ cwd: dir, bin: await fakeLeakBin(dir, 0), prompt: 'p', redactValues: ['s3cret-value-123'], onEvent });
    assert.equal(ok.text, 'done [redacted]');
    await assert.rejects(runClaude({ cwd: dir, bin: await fakeLeakBin(dir, 3), prompt: 'p', redactValues: ['s3cret-value-123'], onEvent }),
      (err) => /exited with code 3/.test(err.message) && !partial(err.message) && !partial(err.stack));
    // Past 8000 chars the stderr buffer keeps its last 4000, which can cut a secret in two; with the lines after it
    // benign (left out of the detail), that piece would be the whole detail.
    const trimBin = join(dir, 'fake-claude-leak-trim.sh');
    await writeFile(trimBin, `#!/bin/sh\necho '${'p'.repeat(4100)}' >&2\necho 'stderr s3cret-value-123' >&2\n`
      + `echo '[claude-code:unrecognized_model] ${'q'.repeat(3951)}' >&2\nexit 5\n`, 'utf8');
    await chmod(trimBin, 0o755);
    await assert.rejects(runClaude({ cwd: dir, bin: trimBin, prompt: 'p', redactValues: ['s3cret-value-123'], onEvent }),
      (err) => /exited with code 5/.test(err.message) && !partial(err.message) && !partial(err.stack));
    // A stdout-borne detail (the result envelope of a failed run) takes the same 2000-char tail cut.
    const resultBin = join(dir, 'fake-claude-leak-result.sh');
    await writeFile(resultBin, `#!/bin/sh\necho '{"type":"result","is_error":true,"result":"err s3cret-value-123${'p'.repeat(1986)}"}'\nexit 6\n`, 'utf8');
    await chmod(resultBin, 0o755);
    await assert.rejects(runClaude({ cwd: dir, bin: resultBin, prompt: 'p', redactValues: ['s3cret-value-123'], onEvent }),
      (err) => /exited with code 6/.test(err.message) && !partial(err.message) && !partial(err.stack));
    // A spawn that fails before any output names its bin in the message: only rejectP's own redaction covers that.
    await assert.rejects(runClaude({ cwd: dir, bin: join(dir, 'no-claude-s3cret-value-123'), prompt: 'p', redactValues: ['s3cret-value-123'], onEvent }),
      (err) => /ENOENT/.test(err.message) && !partial(err.message) && !partial(err.stack));
    const plain = await runClaude({ cwd: dir, bin: await fakeLeakBin(dir, 0), prompt: 'p' });
    assert.equal(plain.text, 'done s3cret-value-123', 'absent ⇒ nothing is redacted');
  } finally {
    if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock;
  }
  assert.ok(events.some((e) => e.type === 'stderr') && events.some((e) => e.type === 'assistant'));
  assert.ok(!JSON.stringify(events).includes('s3cret-value-123'));
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

test('modelEnv reaches the spawn env: inherited around it with scrub off; survives scrub and wins an ambient collision', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'runClaude FORWARDS modelEnv into the spawn env; parent env still inherited (scrub off)', run: async () => {
      const dump = await runWithEnvDump(
        { modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' } },
        { leak: 'inherited' },
      );
      assert.ok(dump.includes('ANTHROPIC_BASE_URL=https://proxy.test/v1'), 'modelEnv reached the child');
      assert.ok(dump.includes('WORCA_TEST_LEAK=inherited'), 'still inherits process.env around it');
    } },
    { name: 'modelEnv SURVIVES env scrub and WINS collisions with the ambient env', run: async () => {
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
    } },
  ]);
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

// ── spawnEnv (wsmap D9): the fan-out concurrency cap ─────────────────────────
// Same drop-at-runClaude hazard as every field above, plus its place in the merge:
//   guardrail env (inherited or scrubbed) < spawnEnv < modelEnv.
const CAP_KEY = 'CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY';

/** runWithEnvDump with the cap key pinned in the parent env for the call (undefined = unset). The
 *  child's env never leaves this helper whole — a failed assertion would print it, host tokens and
 *  all: `line(key)` is that key's line ('' when unset), `has(text)` a boolean. */
async function dumpWithAmbientCap(ambient, extraOpts, opts) {
  const prev = process.env[CAP_KEY];
  if (ambient === undefined) delete process.env[CAP_KEY]; else process.env[CAP_KEY] = ambient;
  let dump;
  try {
    dump = await runWithEnvDump(extraOpts, opts);
  } finally {
    if (prev === undefined) delete process.env[CAP_KEY]; else process.env[CAP_KEY] = prev;
  }
  const lines = dump.split(/\r?\n/);
  return {
    line: (key) => lines.filter((l) => l.startsWith(`${key}=`)).join('\n'),
    has: (text) => dump.includes(text),
  };
}

test('spawnEnv: replaces an ambient value with the parent env inherited, survives scrub, and loses to a model env setting the same key', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'runClaude FORWARDS spawnEnv into the spawn env: it replaces an ambient value, the parent env is still inherited', run: async () => {
      const env = await dumpWithAmbientCap('2', { spawnEnv: { [CAP_KEY]: '8' } }, { leak: 'inherited' });
      assert.equal(env.line(CAP_KEY), `${CAP_KEY}=8`, 'the run-level value replaces the ambient 2');
      assert.ok(env.has('WORCA_TEST_LEAK=inherited'), 'still inherits process.env around it');
    } },
    { name: 'spawnEnv survives env scrub, and a model env that sets the same key wins', run: async () => {
      const scrubbed = await dumpWithAmbientCap(undefined,
        { envScrub: true, envAllowlist: [], spawnEnv: { [CAP_KEY]: '8' } }, { leak: 'should-not-appear' });
      assert.equal(scrubbed.line(CAP_KEY), `${CAP_KEY}=8`);
      assert.ok(!scrubbed.has('WORCA_TEST_LEAK'), 'scrub still applies to everything else');
      const both = await dumpWithAmbientCap(undefined, { spawnEnv: { [CAP_KEY]: '8' }, modelEnv: { [CAP_KEY]: '3' } });
      assert.equal(both.line(CAP_KEY), `${CAP_KEY}=3`, 'the catalog entry wins');
    } },
  ]);
});

test('spawnEnv never sets a reserved key or a non-string; absent keeps the env byte-identical', POSIX_SHIM, async () => {
  const bad = await dumpWithAmbientCap(undefined, { spawnEnv: { PATH: '/evil', WORCA_MOCK: '1', NUMERIC: 8 } });
  assert.ok(!bad.has('PATH=/evil'), 'PATH override dropped');
  assert.ok(bad.has(`PATH=${process.env.PATH}`), 'parent PATH intact');
  assert.ok(!bad.has('WORCA_MOCK=1'), 'reserved WORCA_ key dropped');
  assert.equal(bad.line('NUMERIC'), '', 'non-string dropped');
  for (const extra of [{}, { spawnEnv: undefined }, { spawnEnv: {} }]) {
    const env = await dumpWithAmbientCap(undefined, extra, { leak: 'inherited' });
    assert.equal(env.line(CAP_KEY), '', JSON.stringify(extra));
    assert.ok(env.has('WORCA_TEST_LEAK=inherited'), `inherits for ${JSON.stringify(extra)}`);
  }
});

test('cleanRunEnv: string values only, reserved keys dropped, null when nothing survives', () => {
  assert.deepEqual(cleanRunEnv({ [CAP_KEY]: '8', HOME: '/h', WORCA_X: '1', N: 8 }), { [CAP_KEY]: '8' });
  assert.equal(cleanRunEnv({ PATH: '/x' }), null);
  assert.equal(cleanRunEnv({}), null);
  assert.equal(cleanRunEnv(undefined), null);
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

test('wire model: ANTHROPIC_MODEL replaces the catalog id in --model (one warning); without it --model stays the catalog id', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'modelEnv.ANTHROPIC_MODEL replaces the catalog id in --model (wire id), with one warning', run: async () => {
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
    } },
    { name: 'modelEnv without ANTHROPIC_MODEL keeps --model = catalog id (regression guard)', run: async () => {
      const argv = await runWithArgvDump({
        model: 'claude-opus-4-8',
        modelEnv: { ANTHROPIC_BASE_URL: 'https://proxy.test/v1' },
      });
      assert.equal(argv[argv.indexOf('--model') + 1], 'claude-opus-4-8');
    } },
  ]);
});

test('ANTHROPIC_MODEL whitespace: whitespace-only drops to the catalog id (one dropped-wire-model warning); a padded value is trimmed', POSIX_SHIM, async () => {
  await checkRows([
    { name: 'whitespace-only ANTHROPIC_MODEL is dropped -> catalog id, with the dropped-wire-model warning', run: async () => {
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
    } },
    { name: 'a pasted-with-spaces ANTHROPIC_MODEL is trimmed before reaching --model', run: async () => {
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
    } },
  ]);
});

// ── debugSpawnEnabled / redactArgvForLog unit tests ──────────────────────────

test('debugSpawnEnabled: env truthy/0/false/empty, and the stored settings.json fallback when the env is unset or empty', async () => {
  await checkRows([
    { name: 'debugSpawnEnabled: off by default; truthy values enable; 0/false disable', run: () => {
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
    } },
    { name: 'debugSpawnEnabled: with the env unset or EMPTY the stored settings.json value applies (CLI runs honour the UI checkbox)', run: async () => {
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
    } },
  ]);
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

// ── GitHub credentials never reach claude (src/core/github-credentials.mjs) ──

test('no GitHub or Azure DevOps credential reaches claude: scrub off, scrub on with it allowlisted, or set by a model env', POSIX_SHIM, async () => {
  const ADO_KEYS = ['WORCA_ADO_TOKEN', 'WORCA_ADO_READ_TOKEN', 'WORCA_ADO_WRITE_TOKEN', 'AZURE_DEVOPS_EXT_PAT', 'WORCA_ADO_GIT_TOKEN', 'WORCA_ADO_BOARDS_TOKEN'];
  const keys = ['GH_TOKEN', 'GITHUB_TOKEN', 'WORCA_GH_READ_TOKEN', 'WORCA_GH_WRITE_TOKEN', ...ADO_KEYS];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) process.env[k] = `secret-${k}`;
  try {
    const dumps = [
      await runWithEnvDump({}, { leak: 'x' }),                                              // Permissive / Normal: scrub off
      await runWithEnvDump({ envScrub: true, envAllowlist: keys }),                         // Strict, allowlisted anyway
      await runWithEnvDump({ modelEnv: { GH_TOKEN: 'from-model', ANTHROPIC_BASE_URL: 'http://p' } }),
    ];
    for (const d of dumps) {
      assert.ok(!/secret-|from-model/.test(d), 'no credential in the child env');
      for (const k of ADO_KEYS) assert.ok(!d.includes(`${k}=`), `${k} is not in the child env`);
      assert.ok(d.includes('PATH='), 'the child still got a usable env');
    }
    assert.ok(dumps[0].includes('WORCA_TEST_LEAK=x'), 'scrub off still inherits everything else');
  } finally {
    for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
  }
});

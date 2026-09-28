// test/cli-script.test.mjs
// `worca script <verb>` (spec §6). Harness mirrors test/cli-plugin.test.mjs:
// spawn the REAL CLI with WORCA_MOCK=1 and a throwaway NON-git cwd, so a
// regression that routes `script …` into the bare-positional-prompt path
// degrades to an offline mock run instead of cutting a worktree in THIS repo.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTempHome } from './helpers/temp-home.mjs';
import { userScriptsDir } from '../src/core/script-registry.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(__dirname, '..', 'src', 'cli', 'worca-cc.mjs');

const HOME = useTempHome(after);
const scratchCwd = mkdtempSync(join(tmpdir(), 'worca-cc-cli-script-cwd-'));
after(() => rmSync(scratchCwd, { recursive: true, force: true, maxRetries: 3 }));

export function runCli(args, { cwd } = {}) {
  return new Promise((res) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, WORCA_MOCK: '1', WORCA_HOME: HOME },
      cwd: cwd || scratchCwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('exit', (code) => res({ code: code ?? 0, stdout, stderr }));
  });
}
const run = runCli;

/** A user-layer script written straight to disk — no store import, no server. */
export function writeUserScript(key, over = {}) {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), [
    'export default async function ({ params, inputs, log }) {',
    "  log('info', 'fixture ran');",
    "  return { outputs: { out: { value: '# ' + params.word + '\\n' } }, summary: 'word=' + params.word };",
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, description: 'a fixture', runtime: 'node',
    file: `${key}.mjs`, order: 900,
    params: [{ id: 'word', type: 'string', default: 'hi' }],
    inputs: [{ id: 'plan', type: 'md', required: false }, { id: 'go', type: 'void', required: false }],
    outputs: [{ id: 'out', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }],
    ...over,
  }, null, 2) + '\n');
  return dir;
}

test('script list: one tab row per registry entry, built-ins included; --json is the raw list', async () => {
  writeUserScript('fixtureOne');
  const r = await run(['script', 'list']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^fixtureOne\tfixtureOne\tuser\tnode\t0$/m);
  assert.match(r.stdout, /^shell\t.*\tbuiltin\tshell\t/m, 'the built-in layer is listed too');
  const list = JSON.parse((await run(['script', 'list', '--json'])).stdout);
  assert.ok(list.some((m) => m.key === 'fixtureOne' && m.origin === 'user'));
});

test('script show: the meta block then the source; an unknown key exits 2', async () => {
  writeUserScript('fixtureTwo');
  const r = await run(['script', 'show', 'fixtureTwo']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^key {10}fixtureTwo$/m);
  assert.match(r.stdout, /^description {2}a fixture$/m, 'the longest label still gets its gap');
  assert.match(r.stdout, /^origin {7}user$/m);
  assert.match(r.stdout, /^runtime {6}node$/m);
  assert.match(r.stdout, /^cases {8}0 shipped, 0 yours$/m);
  assert.match(r.stdout, /export default async function/);
  const j = JSON.parse((await run(['script', 'show', 'fixtureTwo', '--json'])).stdout);
  assert.equal(j.meta.key, 'fixtureTwo');
  assert.equal(typeof j.source, 'string');
  const miss = await run(['script', 'show', 'ghostScript']);
  assert.equal(miss.code, 2);
  assert.match(miss.stderr, /worca script show: unknown script "ghostScript"/);
});

test('script new: the template lands in the user layer, LF-only, stamped by the CLI', async () => {
  const r = await run(['script', 'new', 'freshNode']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^created\t.*freshNode\.meta\.json$/m);
  assert.match(r.stdout, /^created\t.*freshNode\.mjs$/m);
  const dir = userScriptsDir();
  const src = readFileSync(join(dir, 'freshNode.mjs'), 'utf8');
  assert.match(src, /export default async function/);
  assert.equal(src.includes('\r'), false, 'a scaffolded .mjs is LF-only on every OS');
  const meta = JSON.parse(readFileSync(join(dir, 'freshNode.meta.json'), 'utf8'));
  assert.equal(meta.runtime, 'node');
  assert.equal(meta.createdBy, 'cli', 'W19: a scaffolded meta is attributable');
  const again = await run(['script', 'new', 'freshNode']);
  assert.equal(again.code, 1, again.stdout);
  assert.match(again.stderr, /^worca script new: /m);
});

test('script new --runtime shell writes the sh + cmd pair; an unknown runtime exits 2', async () => {
  const r = await run(['script', 'new', 'freshShell', '--runtime', 'shell']);
  assert.equal(r.code, 0, r.stderr);
  const dir = userScriptsDir();
  for (const f of ['freshShell.sh', 'freshShell.cmd']) {
    assert.ok(existsSync(join(dir, f)), `${f} must exist so the script runs on every OS`);
  }
  assert.equal(readFileSync(join(dir, 'freshShell.sh'), 'utf8').includes('\r'), false, 'a .sh is LF-only');
  assert.ok(readFileSync(join(dir, 'freshShell.cmd'), 'utf8').includes('\r\n'), 'a .cmd ships CRLF');
  const bad = await run(['script', 'new', 'freshBad', '--runtime', 'perl']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--runtime must be one of node, shell, python \(got perl\)/);
});

test('script new --from copies another script', async () => {
  writeUserScript('copySource');
  const r = await run(['script', 'new', 'copyTarget', '--from', 'copySource']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^created\tcopyTarget\t\(copy of copySource\)$/m);
  assert.ok(existsSync(join(userScriptsDir(), 'copyTarget.meta.json')));
});

test('script rm: a user script goes, a built-in is refused (1), an unknown key is usage (2)', async () => {
  writeUserScript('removeMe');
  const r = await run(['script', 'rm', 'removeMe']);
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'removed\tremoveMe');
  assert.equal(existsSync(join(userScriptsDir(), 'removeMe.meta.json')), false);
  const builtin = await run(['script', 'rm', 'shell']);
  assert.equal(builtin.code, 1, builtin.stdout);
  assert.match(builtin.stderr, /^worca script rm: /m);
  assert.equal((await run(['script', 'rm', 'ghostScript'])).code, 2, 'NOT_FOUND is a usage error');
});

test('script rm never recurses into a name READ OFF the sidecar: a hand-edited "." costs nothing else', async () => {
  // deleteScript removes the names the sidecar ON DISK carries. The validator's
  // basename rule admits ".", and the registry's containment check covers the HOST
  // platform's entry only — so the hostile name sits in the OTHER platform's slot.
  assert.equal((await run(['script', 'new', 'bystander'])).code, 0);
  assert.equal((await run(['script', 'new', 'handEdited', '--runtime', 'shell'])).code, 0);
  const dir = userScriptsDir();
  const sidecar = join(dir, 'handEdited.meta.json');
  const meta = JSON.parse(readFileSync(sidecar, 'utf8'));
  const other = process.platform === 'win32' ? 'linux' : 'win32';
  meta.file = process.platform === 'win32'
    ? { default: 'handEdited.cmd', win32: 'handEdited.cmd', [other]: '.' }
    : { default: 'handEdited.sh', [other]: '.' };
  writeFileSync(sidecar, JSON.stringify(meta, null, 2) + '\n');
  const r = await run(['script', 'rm', 'handEdited']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(existsSync(join(dir, 'bystander.meta.json')), 'another script survives the delete');
  assert.ok(existsSync(join(dir, 'bystander.mjs')));
  assert.equal(existsSync(sidecar), false, 'the script itself is gone');
});

test('script show --json survives a PIPE: a source past the 64 KiB pipe buffer arrives whole', async () => {
  // stdout over a pipe is asynchronous on POSIX and the CLI ends in process.exit():
  // unflushed, everything past the first 65536 bytes was cut and the JSON did not parse.
  const dir = writeUserScript('bigSource');
  const body = `export default async function () { return { summary: 'ok' }; }\n// ${'x'.repeat(150000)}\n`;
  writeFileSync(join(dir, 'bigSource.mjs'), body);
  const r = await run(['script', 'show', 'bigSource', '--json']);
  assert.equal(r.code, 0, r.stderr);
  assert.ok(r.stdout.length > 150000, `stdout was cut at ${r.stdout.length} bytes`);
  assert.equal(JSON.parse(r.stdout).source, body);
  const plain = await run(['script', 'show', 'bigSource']);
  assert.ok(plain.stdout.endsWith(body), 'the plain form prints the whole source too');
});

test('script new --from refuses --runtime: a copy keeps its runtime, a typed flag is never dropped', async () => {
  writeUserScript('fromSource');
  const r = await run(['script', 'new', 'fromTarget', '--from', 'fromSource', '--runtime', 'shell']);
  assert.equal(r.code, 2, r.stdout);
  assert.match(r.stderr, /--runtime cannot be combined with --from: a copy keeps the runtime of "fromSource"/);
  assert.equal(existsSync(join(userScriptsDir(), 'fromTarget.meta.json')), false, 'nothing was written');
});

test('worca script with no verb prints help; an unknown verb exits 2; the top-level help lists it', async () => {
  const h = await run(['script']);
  assert.equal(h.code, 0);
  assert.match(h.stdout, /worca script — registered scripts/);
  assert.match(h.stdout, /worca script test <key>/);
  const bad = await run(['script', 'frobnicate']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /unknown script verb "frobnicate"/);
  assert.match((await run(['help'])).stdout, /script <cmd> \[\.\.\.\]\s+Manage and test scripts/);
});

/** A node script that reports its cwd, its params, which ports were bound and
 *  the first line of the `plan` input it was given. */
function writeProbeScript(key) {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), [
    'export default async function ({ inputs, params, ctx, log }) {',
    "  console.log('probe line');",
    "  log('info', 'bound ' + Object.keys(inputs).sort().join(','));",
    '  const fs = await import("node:fs/promises");',
    '  const planText = inputs.plan ? await fs.readFile(inputs.plan.path, "utf8") : "";',
    '  const body = [ctx.cwd, params.word, Object.keys(inputs).sort().join(","), planText.split("\\n")[0]].join(" | ");',
    "  return { outputs: { out: { value: body + '\\n' } }, summary: body };",
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 900,
    params: [{ id: 'word', type: 'string', default: 'hi' }, { id: 'depth', type: 'number', default: 1 }],
    inputs: [{ id: 'plan', type: 'md', required: false }, { id: 'go', type: 'void', required: false }],
    outputs: [{ id: 'out', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }],
  }, null, 2) + '\n');
}

/** A node script whose frame carries a MAJOR issue: the run is `blocking`. */
function writeBlockingScript(key) {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${key}.mjs`), [
    'export default async function () {',
    '  return {',
    "    outputs: { log: { value: '# log\\n' }, fail: { value: '# fail\\n' } },",
    "    verdict: { issues: [{ severity: 'major', title: 'nope', detail: 'x', location: '' }] },",
    "    summary: 'blocked',",
    '  };',
    '}',
    '',
  ].join('\n'));
  writeFileSync(join(dir, `${key}.meta.json`), JSON.stringify({
    key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`, order: 900,
    inputs: [],
    outputs: [
      { id: 'log', type: 'md', when: 'always', filename: `${key}-log-cycle{cycle}.md` },
      { id: 'fail', type: 'md', when: 'blocking', filename: `${key}-fail-cycle{cycle}.md` },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
    verdict: { filename: `${key}-cycle{cycle}.json` },
  }, null, 2) + '\n');
}

test('script test: params, a file input and a fired void port; lines to stderr, result to stdout', async () => {
  writeProbeScript('probeOne');
  const planFile = join(scratchCwd, 'plan.md');
  writeFileSync(planFile, '# Plan\n\nhello\n');
  const r = await run(['script', 'test', 'probeOne', '--param', 'word=hey', '--input', `plan=@${planFile}`, '--input', 'go=fired']);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stderr, /probe line/, 'streamed lines go to stderr');
  assert.doesNotMatch(r.stdout, /probe line/, 'stdout carries the result alone');
  assert.match(r.stdout, /^probeOne\tnode\tclean\t/m);
  assert.match(r.stdout, /hey \| go,plan \| # Plan/);
  assert.match(r.stdout, /^ {2}fired: out$/m);
});

test('script test: @@ is a literal @, an unknown port, a bad number and a bad void value all exit 2', async () => {
  writeProbeScript('probeTwo');
  const lit = await run(['script', 'test', 'probeTwo', '--input', 'plan=@@notafile']);
  assert.equal(lit.code, 0, lit.stderr);
  assert.match(lit.stdout, /\| @notafile/);
  const badNum = await run(['script', 'test', 'probeTwo', '--param', 'depth=deep']);
  assert.equal(badNum.code, 2);
  assert.match(badNum.stderr, /--param depth: "deep" is not a number/);
  const badPort = await run(['script', 'test', 'probeTwo', '--input', 'ghost=x']);
  assert.equal(badPort.code, 2);
  assert.match(badPort.stderr, /unknown input port "ghost" for script "probeTwo"/);
  const badVoid = await run(['script', 'test', 'probeTwo', '--input', 'go=yes']);
  assert.equal(badVoid.code, 2);
  assert.match(badVoid.stderr, /--input go: a void port takes "fired"/);
  const missing = await run(['script', 'test', 'probeTwo', '--input', `plan=@${join(scratchCwd, 'nope.md')}`]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--input plan: cannot read /);
});

test('script test --cwd runs in that folder', async () => {
  writeProbeScript('probeCwd');
  const where = mkdtempSync(join(tmpdir(), 'worca-cc-cli-script-where-'));
  const r = await run(['script', 'test', 'probeCwd', '--cwd', where]);
  assert.equal(r.code, 0, `${r.stdout}\n${r.stderr}`);
  // basename, not the full path: macOS resolves /var -> /private/var underneath.
  assert.ok(r.stdout.includes(basename(where)), r.stdout);
  rmSync(where, { recursive: true, force: true, maxRetries: 3 });
});

test('script test: a blocking verdict exits 1; --json prints the result and keeps the code', async () => {
  writeBlockingScript('probeBlock');
  const r = await run(['script', 'test', 'probeBlock']);
  assert.equal(r.code, 1, `${r.stdout}\n${r.stderr}`);
  assert.match(r.stdout, /^probeBlock\tnode\tblocking\t/m);
  assert.match(r.stdout, /^ {2}fired: log, fail$/m);
  assert.doesNotMatch(r.stdout, /^ {2}pass\tvoid$/m, 'an output that did not fire is not listed');
  const j = await run(['script', 'test', 'probeBlock', '--json']);
  assert.equal(j.code, 1);
  const result = JSON.parse(j.stdout);
  assert.equal(result.status, 'blocking');
  assert.ok(result.outputs.log.path);
});

test('script test: --case refuses the value flags; --all with no saved cases is green', async () => {
  writeProbeScript('probeThree');
  const clash = await run(['script', 'test', 'probeThree', '--case', 'sample', '--param', 'word=x']);
  assert.equal(clash.code, 2);
  assert.match(clash.stderr, /--param cannot be combined with --case: a saved case carries its own setup/);
  const both = await run(['script', 'test', 'probeThree', '--case', 'sample', '--all']);
  assert.equal(both.code, 2);
  assert.match(both.stderr, /--case and --all are mutually exclusive/);
  const all = await run(['script', 'test', 'probeThree', '--all']);
  assert.equal(all.code, 0, all.stdout);
  assert.match(all.stderr, /no saved cases for "probeThree"/);
  const tiny = await run(['script', 'test', 'probeThree', '--timeout', '0.5']);
  assert.equal(tiny.code, 2, 'the bench would silently ignore a sub-second timeout');
  assert.match(tiny.stderr, /--timeout must be between 1 and 86400 seconds \(got 0\.5\)/);
  const unknown = await run(['script', 'test', 'ghostScript']);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /worca script test: unknown script "ghostScript"/);
});

test('script test --json survives a PIPE: a result past the 64 KiB pipe buffer parses', async () => {
  const dir = userScriptsDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'bigOut.mjs'),
    "export default async function () {\n  return { outputs: { out: { value: 'x'.repeat(200000) + '\\n' } }, summary: 'big' };\n}\n");
  writeFileSync(join(dir, 'bigOut.meta.json'), JSON.stringify({
    key: 'bigOut', metaVersion: 2, displayName: 'bigOut', runtime: 'node', file: 'bigOut.mjs', order: 900,
    inputs: [], outputs: [{ id: 'out', type: 'md', when: 'always', filename: 'bigOut-cycle{cycle}.md' }],
  }, null, 2) + '\n');
  const r = await run(['script', 'test', 'bigOut', '--json']);
  assert.equal(r.code, 0, r.stderr);
  const result = JSON.parse(r.stdout);                  // unflushed: cut at 65536 bytes, a SyntaxError here
  assert.equal(result.outputs.out.bytes, 200001);
  assert.equal(result.outputs.out.text.length, 200001);
});

test('script test: an EMPTY number is refused (Number("") is 0), and an @file over the input cap is named', async () => {
  writeProbeScript('probeFour');
  for (const blank of ['depth=', 'depth=  ']) {
    const r = await run(['script', 'test', 'probeFour', '--param', blank]);
    assert.equal(r.code, 2, r.stdout);
    assert.match(r.stderr, /--param depth: ".*" is not a number/);
  }
  const big = join(scratchCwd, 'over-cap.md');
  writeFileSync(big, 'x'.repeat(262145));
  const over = await run(['script', 'test', 'probeFour', '--input', `plan=@${big}`]);
  assert.equal(over.code, 2, over.stdout);
  assert.match(over.stderr, /--input plan: .*over-cap\.md is over 262144 bytes/);
  writeFileSync(big, 'x'.repeat(262144));
  assert.equal((await run(['script', 'test', 'probeFour', '--input', `plan=@${big}`])).code, 0, 'exactly the cap is fine');
});

// Arms of ONE flow: a loose run, and saved cases WITH an expectation — there a
// stopped run used to exit 1 ("a check failed") because the expectation was read first.
// `quiet` names no verdict, so a stopped run SATISFIES it: it used to print
// `expect: pass` and `1 passed` beside exit code 2.
for (const [label, args, line] of [
  ['a loose run', [], /^sleeper\tnode\tstopped/m],
  ['a saved case with an expectation', ['--case', 'nap'], /^sleeper\tnode\tstopped/m],
  ['a saved case whose expectation a stopped run satisfies', ['--case', 'quiet'], /^sleeper\tnode\tstopped/m],
  ['Run all', ['--all'], /^✗ sleeper\/quiet\tstopped\t[\s\S]*^0 passed, 1 failed, 0 unchecked$/m],
]) test(`script test: SIGTERM stops ${label} like Ctrl+C — status stopped, exit 2, no orphan child`,
  { skip: process.platform === 'win32' ? 'win32 has no deliverable SIGTERM: kill() ends the CLI without running a handler' : false },
  async () => {
    const dir = userScriptsDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'sleeper.mjs'), [
      'export default async function () {',
      "  console.log('sleeper pid ' + process.pid);",
      '  await new Promise((r) => setTimeout(r, 120000));',
      "  return { summary: 'never' };",
      '}',
      '',
    ].join('\n'));
    writeFileSync(join(dir, 'sleeper.meta.json'), JSON.stringify({
      key: 'sleeper', metaVersion: 2, displayName: 'sleeper', runtime: 'node', file: 'sleeper.mjs', order: 900,
      inputs: [], outputs: [],
    }, null, 2) + '\n');
    writeFileSync(join(dir, 'sleeper.tests.json'), JSON.stringify({ version: 1, cases: [
      { id: 'quiet', name: 'quiet', params: {}, inputs: {}, cwd: { kind: 'scratch' }, expect: { fired: [] } },
      { id: 'nap', name: 'nap', params: {}, inputs: {}, cwd: { kind: 'scratch' }, expect: { verdict: 'clean' } },
    ] }, null, 2) + '\n');
    const child = spawn(process.execPath, [CLI, 'script', 'test', 'sleeper', ...args], {
      env: { ...process.env, WORCA_MOCK: '1', WORCA_HOME: HOME }, cwd: scratchCwd, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    const pid = await new Promise((res, rej) => {
      const timer = setTimeout(() => rej(new Error(`the script never started: ${stderr}`)), 30000);
      child.on('exit', () => { clearTimeout(timer); rej(new Error(`the CLI exited before the script started: ${stderr}`)); });
      child.stderr.on('data', (b) => {
        stderr += b.toString();
        const m = /sleeper pid (\d+)/.exec(stderr);
        if (m) { clearTimeout(timer); res(Number(m[1])); }
      });
    });
    try {
      const exited = new Promise((res) => child.on('exit', (code, signal) => res({ code, signal })));
      child.kill('SIGTERM');
      const { code, signal } = await exited;
      assert.equal(signal, null, 'the CLI handled the signal instead of dying on it');
      assert.equal(code, 2, `a stopped run verified nothing — never 1, even under an expectation\n${stdout}`);
      assert.match(stdout, line);
      assert.doesNotMatch(stdout, /expect: pass|^[1-9]\d* passed/m, 'a stopped run never reads as a pass');
      // The script's own process is gone too (give the tree kill a moment).
      let alive = true;
      for (let i = 0; i < 50 && alive; i++) {
        try { process.kill(pid, 0); await new Promise((r) => setTimeout(r, 100)); } catch { alive = false; }
      }
      assert.equal(alive, false, `script process ${pid} outlived the CLI`);
    } finally {
      try { process.kill(pid); } catch { /* already gone — the point of the test */ }   // a RED run must not leave it behind
    }
  });

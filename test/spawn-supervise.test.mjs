// test/spawn-supervise.test.mjs
// The child-process owner's supervision (src/core/spawn.mjs, plans/core-protection-layer-design.md §4.1): a stop
// kills the whole process group locally and, per step, in a sandbox (remote-child.mjs runs the line under setsid and
// signals that group from a second command); argv values never become flags; a run-start check sees the run's env.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { superviseSpawn, argValue, sigkillGraceMs, spawnChild } from '../src/core/spawn.mjs';
import { groupLine, groupKillLine } from '../src/core/exec-env/remote-child.mjs';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { codexPreflight, runCodexProcess } from '../src/core/engines/codex.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE = join(HERE, 'fixtures', 'fake-engine.mjs');
const POSIX = { skip: process.platform === 'win32' ? 'process groups are POSIX-only' : false };
const { tmp, cleanup } = scratchDirs(); after(cleanup);

process.env.WORCA_SIGKILL_GRACE_MS = '200';

const waitFor = async (cond, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = cond(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('timed out waiting');
};
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
const grandPid = (out) => { try { return Number(readFileSync(`${out}.grand`, 'utf8').trim()) || null; } catch { return null; } };

function supervise({ file = process.execPath, args = [FAKE], env, signal, execEnv = null, cwd }) {
  return superviseSpawn({
    file, args, displayBin: 'fake', cwd, env, stdin: null, signal, asAgent: false, stagedDir: null,
    cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {}, stdoutErrorDetail: () => '',
    classify: () => null, spawnError: (err) => err, onDone: (code) => ({ exitCode: code }), execEnv,
  });
}

test('abort kills a backgrounded grandchild', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const out = join(dir, 'rec.json');
  const ac = new AbortController();
  const p = supervise({ env: { ...process.env, FAKE_OUT: out, FAKE_HOLD: '1' }, signal: ac.signal, cwd: dir });
  const gp = await waitFor(() => grandPid(out));
  const rec = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(rec.pgid, rec.pid, 'the engine leads its own process group');
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
});

test('spawnChild refuses a spawn with no env: a child never inherits worca\'s env by default', () => {
  for (const options of [undefined, {}, { env: null }, { cwd: '/' }]) {
    assert.throws(() => spawnChild(process.execPath, ['-e', ''], options), { message: `spawnChild ${process.execPath}: options.env is required` });
  }
});

test('a worca that exits takes its supervised process groups along (the host-exit reaper)', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const pidFile = join(dir, 'pid');
  const spawnUrl = new URL('../src/core/spawn.mjs', import.meta.url).href;
  const child = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  // A worca that supervises one engine, then exits without stopping it (the CLI's hard exit).
  const host = `const { superviseSpawn } = await import(${JSON.stringify(spawnUrl)});
const fs = await import('node:fs');
superviseSpawn({ file: process.execPath, args: ['-e', ${JSON.stringify(child)}], displayBin: 'fake', cwd: ${JSON.stringify(dir)}, env: process.env, stdin: null,
  cleanup: () => {}, onEvent: () => {}, onStdoutLine: () => {}, stdoutErrorDetail: () => '', classify: () => null, spawnError: (e) => e,
  onDone: () => null }).catch(() => {});
const end = Date.now() + 10000;
while (!fs.existsSync(${JSON.stringify(pidFile)}) && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
process.exit(0);`;
  const p = spawnChild(process.execPath, ['--input-type=module', '-e', host], { env: process.env, stdio: 'ignore' });
  const [code] = await new Promise((r) => p.once('exit', (...a) => r(a)));
  assert.equal(code, 0);
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    await waitFor(() => !alive(pid), 2000);
  } finally {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* gone, as it should be */ }
  }
});

test('a grandchild that ignores SIGTERM still gets the SIGKILL after its leader exits: the escalation outlives the leader', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const pidFile = join(dir, 'gp');
  const ac = new AbortController();
  const grand = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000)`;
  // The leader exits on SIGTERM; its grandchild (stdio detached from the spawn's pipes) ignores it.
  const script = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(grand)} >/dev/null 2>&1 & wait`;
  let settled = null;
  supervise({ file: 'bash', args: ['-c', script], env: process.env, signal: ac.signal, cwd: dir })
    .then(() => { settled = 'resolved'; }, (e) => { settled = e; });
  const gp = await waitFor(() => { try { return Number(readFileSync(pidFile, 'utf8')) || null; } catch { return null; } });
  try {
    ac.abort();
    await waitFor(() => settled !== null, 5000);
    assert.equal(settled?.name, 'AbortError');
    assert.equal(alive(gp), true, 'the leader is gone; the grandchild ignored SIGTERM');
    await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
  } finally {
    try { process.kill(gp, 'SIGKILL'); } catch { /* gone, as it should be */ }
  }
});

test('a child that ignores SIGTERM is killed, group and all, after the grace', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const pidFile = join(dir, 'gp');
  const ac = new AbortController();
  const script = `trap '' TERM; sleep 600 & echo $! > ${pidFile}; while :; do sleep 1; done`;
  const p = supervise({ file: 'bash', args: ['-c', script], env: process.env, signal: ac.signal, cwd: dir });
  const gp = await waitFor(() => { try { return Number(readFileSync(pidFile, 'utf8')) || null; } catch { return null; } });
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
});

test('remote line runs under setsid; the stop commands signal its group', () => {
  assert.equal(groupLine("'claude' '-p'"), "exec setsid -w 'claude' '-p'");
  assert.equal(groupKillLine('TERM', 4242), 'kill -TERM -- -4242 2>/dev/null || kill -TERM 4242 2>/dev/null || true');
  assert.equal(groupKillLine('KILL', '17'), 'kill -KILL -- -17 2>/dev/null || kill -KILL 17 2>/dev/null || true');
});

test('abort kills a sandbox grandchild per step; the sandbox and its relay live on', POSIX, async () => {
  const f = fixture(tmp);
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), onCommand: (cmd) => (/^command -v /.test(cmd) ? { lines: ['/usr/local/bin/x'] } : null) });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f));
  await env.start();
  try {
    const out = join(f.repo, 'rec.json');
    const ac = new AbortController();
    const p = supervise({ file: process.execPath, args: [FAKE], env: { FAKE_OUT: env.sb(out), FAKE_HOLD: '1' }, signal: ac.signal, execEnv: env, cwd: f.repo });
    const gp = await waitFor(() => grandPid(env.sb(out)));
    const line = sdk.events.find((e) => e.type === 'command' && e.cmd.includes('fake-engine.mjs'))?.cmd;
    assert.match(line, /^exec setsid -w /, 'the step leads its own group in the sandbox');
    ac.abort();
    await assert.rejects(p, (e) => e.name === 'AbortError');
    await waitFor(() => !alive(gp), sigkillGraceMs() + 1000);
    const kills = sdk.events.filter((e) => e.type === 'command' && /^kill -(TERM|KILL) -- -\d+/.test(e.cmd)).map((e) => e.cmd.split(' ')[1]);
    assert.deepEqual(kills.slice(0, 1), ['-TERM'], 'TERM to the group first');
    assert.equal(env.lost, null, 'the sandbox is still up');
    assert.equal(env.relay.alive, true, 'the model relay command still runs');
    assert.ok(alive(env.relay.handle.pid), 'the relay process was not in the step group');
  } finally {
    await env.close('test');
  }
});

test('argValue refuses flags and empty values', () => {
  assert.throws(() => argValue('-oProxyCommand=x', 'model'), (e) => e.errorClass === 'config' && e.message === 'model "-oProxyCommand=x" cannot start with "-"');
  assert.throws(() => argValue('', 'model'), (e) => e.errorClass === 'config' && e.message === 'model is empty');
  assert.throws(() => argValue('  ', 'branch'), { message: 'branch is empty' });
  assert.equal(argValue('gpt-5', 'model'), 'gpt-5');
});

test('helper model values go through argValue', () => {
  const dir = join(HERE, '..', 'src', 'core', 'engines');
  const bad = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    // Every model or provider value after its flag, wherever it sits in the push (goose: `'--provider', p, '--model', m`).
    for (const m of src.matchAll(/push\([^;]*?'(--model|-m|--provider)'\s*,\s*([^,)]*)/g)) if (!/^argValue\(/.test(m[2].trim())) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('a model that looks like a flag is refused before anything spawns', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const out = join(dir, 'rec.json');
  await assert.rejects(runCodexProcess({ bin: FAKE, cwd: dir, prompt: 'x', model: '-c foo', usageDir: dir, envAllowlist: ['FAKE_OUT'] }),
    (e) => e.errorClass === 'config');
  assert.equal(existsSync(out), false);
});

test('preflight env equals run env', POSIX, async () => {
  const dir = tmp('worca-sup-');
  const pre = join(dir, 'pre.json'); const run = join(dir, 'run.json');
  const stream = join(dir, 'stream.jsonl');
  writeFileSync(stream, [
    JSON.stringify({ type: 'thread.started', thread_id: '00000000-0000-4000-8000-000000000001' }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
  ].join('\n'));
  const allow = ['FAKE_OUT', 'FAKE_STREAM', 'FAKE_GRANDCHILD'];
  const saved = { ...process.env };
  try {
    Object.assign(process.env, { FAKE_STREAM: stream, FAKE_GRANDCHILD: '0', FAKE_OUT: pre, SOME_SERVER_SECRET: 's3' });
    await codexPreflight({ bin: FAKE, spec: { engine: 'codex', allowlist: allow, cwd: dir, root: null } });
    process.env.FAKE_OUT = run;
    await runCodexProcess({ bin: FAKE, cwd: dir, prompt: 'x', model: 'gpt-5', usageDir: dir, envAllowlist: allow, sandbox: 'workspace-write' }).catch(() => {});
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const strip = (e) => { const o = { ...e }; for (const k of ['WORCA_HOST_PID', 'FAKE_OUT', 'CODEX_HOME']) delete o[k]; return o; };
  const a = JSON.parse(readFileSync(pre, 'utf8')).env; const b = JSON.parse(readFileSync(run, 'utf8')).env;
  assert.equal(a.SOME_SERVER_SECRET, undefined, 'the check never sees what the run does not');
  assert.deepEqual(strip(a), strip(b));
});

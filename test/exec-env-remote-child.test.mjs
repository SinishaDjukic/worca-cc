// test/exec-env-remote-child.test.mjs
// The agent spawn seam in e2b mode: superviseSpawn driving a RemoteChild (src/core/exec-env/remote-child.mjs)
// on the loopback fake, and runClaude end to end with a canned claude stream inside the "sandbox".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { superviseSpawn } from '../src/core/engines/spawn.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { scratchDirs, fixture, makeEnvOpts } from './helpers/e2b-fixture.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false };
const { tmp, cleanup } = scratchDirs(); after(cleanup);

/** Resolves once `cond()` holds (polled), or when `p` settles first: an abort waits for the command to really start,
 *  not for a fixed delay that a loaded machine overruns while the pre-step sync is still running. */
const until = (cond, p) => Promise.race([new Promise((r) => { const iv = setInterval(() => { if (cond()) { clearInterval(iv); r(); } }, 5); }),
  p.then(() => {}, () => {})]);

async function started(extra = {}, sdkOpts = {}) {
  const f = fixture(tmp);
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), ...sdkOpts });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, extra));
  await env.start();
  return { f, sdk, env };
}

/** superviseSpawn with the fields every adapter passes; resolves to { lines, result } or rejects. */
function supervise(env, { file = 'bash', args, cwd, stdin = null, signal, stagedDir = null, childEnv = {} }) {
  const lines = [];
  const p = superviseSpawn({
    file, args, displayBin: 'claude', cwd, env: childEnv, stdin, signal, asAgent: false, stagedDir,
    cleanup: () => {}, onEvent: () => {}, onStdoutLine: (l) => lines.push(l), stdoutErrorDetail: () => '',
    classify: () => null, spawnError: (err) => err, onDone: (code) => ({ exitCode: code }), execEnv: env,
  });
  return p.then((result) => ({ lines, result }));
}

test('superviseSpawn on a remote child: lines framed across chunks, step output synced before it resolves', POSIX, async () => {
  const { f, env } = await started();
  const out = env.sb(join(f.pipelineDir, 'out.md'));
  const script = `printf '{"a":'; sleep 0.05; printf '1}\\n'; echo written > '${out}'`;
  const { lines } = await supervise(env, { args: ['-c', script], cwd: f.repo });
  assert.deepEqual(lines, ['{"a":1}']);
  assert.equal(readFileSync(join(f.pipelineDir, 'out.md'), 'utf8'), 'written\n', 'the file reached the host before resolve');
  await env.close('test');
});

test('a non-zero exit rejects with the code and stderr', POSIX, async () => {
  const { f, env } = await started();
  await assert.rejects(supervise(env, { args: ['-c', 'echo boom >&2; exit 3'], cwd: f.repo }), /claude exited with code 3: boom/);
  await env.close('test');
});

test('an abort kills the handle and rejects with AbortError', POSIX, async () => {
  const { f, sdk, env } = await started();
  const ac = new AbortController();
  const p = supervise(env, { args: ['-c', 'sleep 5'], cwd: f.repo, signal: ac.signal });
  await until(() => sdk.events.some((e) => e.type === 'command' && e.cmd.includes('sleep 5')), p);
  const t0 = Date.now();
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(Date.now() - t0 < 4000, 'the sleep was killed');
  assert.ok(sdk.events.some((e) => e.type === 'command' && e.cmd.includes('sleep 5')));
  await env.close('test');
});

test('an abort also ends a handle whose wait() rejects without an exit code', POSIX, async () => {
  const { f, env } = await started();
  let killed = 0; let launched = false;
  const realRun = env.sandbox.commands.run;
  env.sandbox.commands.run = async (cmd, opts) => {
    if (!opts?.background) return realRun(cmd, opts);
    launched = true;
    let fail; const ended = new Promise((_, rej) => { fail = rej; });
    return { pid: 4242, wait: () => ended, kill: async () => { killed += 1; fail(new Error('stream closed')); return true; } };
  };
  const ac = new AbortController();
  const p = supervise(env, { args: ['-c', 'true'], cwd: f.repo, signal: ac.signal });
  await until(() => launched, p);
  ac.abort();
  await assert.rejects(p, (e) => e.name === 'AbortError');
  assert.ok(killed >= 1);
  env.sandbox.commands.run = realRun;
  await env.close('test');
});

test('stdin goes in as a sandbox file, removed afterwards; the staged dir is uploaded first', POSIX, async () => {
  const { f, sdk, env } = await started();
  const staged = tmp('worca-claude-'); writeFileSync(join(staged, 'p.md'), 'staged prompt\n');
  const { lines } = await supervise(env, { args: ['-c', `cat; cat '${env.sb(join(staged, 'p.md'))}'`], cwd: f.repo, stdin: 'hello\n', stagedDir: staged });
  assert.deepEqual(lines, ['hello', 'staged prompt']);
  const cmd = sdk.events.filter((e) => e.type === 'command' && e.cmd.startsWith("'bash'")).at(-1).cmd;
  const file = cmd.match(/< '([^']+stdin-\d+)'$/)?.[1];
  assert.ok(file, cmd);
  for (let i = 0; i < 50 && existsSync(file); i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(existsSync(file), false, 'the stdin file is removed');
  await env.close('test');
});

test('the remote handle has no host pid; remotePid carries the sandbox pid', POSIX, async () => {
  const { f, env } = await started();
  const child = env.spawn('bash', ['-c', 'echo x'], { cwd: f.repo });
  assert.equal(child.pid, undefined);
  assert.equal(child.stdin, null);
  child.stdout.resume(); child.stderr.resume();   // 'close' waits until the streams are drained
  await once(child, 'close');
  assert.equal(child.pid, undefined);
  assert.equal(typeof child.remotePid, 'number');
  assert.equal(child.exitCode, 0);
  await env.close('test');
});

test('a patch that does not apply rejects the spawn and leaves the env fatal', POSIX, async () => {
  const { f, env } = await started();
  writeFileSync(join(f.repo, 'a.txt'), 'host side edit mid-run\n');
  await assert.rejects(supervise(env, { args: ['-c', "echo 'sandbox side' > a.txt"], cwd: f.repo }), (e) => e.code === 'EXEC_ENV_PATCH_REJECTED');
  assert.equal(env.fatalError()?.code, 'EXEC_ENV_PATCH_REJECTED');
  await env.close('test');
});

const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', session_id: '11111111-2222-3333-4444-555555555555' }),
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'hi' }] } }),
  JSON.stringify({ type: 'result', subtype: 'success', result: 'done', total_cost_usd: 0.01 }),
];

function withEnv(vars, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  return fn().finally(() => { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
}

test('runClaude runs claude in the sandbox: no host guard, allowlisted env, never the server credential', POSIX, () =>
  withEnv({ WORCA_MOCK: undefined, ORCH_MOCK: undefined, WORCA_HOST_GUARD: '1', GH_TOKEN: 'ghp_host', WORCA_HOST_PID: String(process.pid),
    WORCA_HEARTBEAT_TOKEN: 'hb', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Bearer x', E2B_API_KEY: 'e2b_k', WORCA_E2B_TEMPLATE: 't' }, async () => {
    let seen;
    const { f, env } = await started({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'oat' } }, { onCommand: (cmd, o) => {
      if (cmd.startsWith("'claude'")) { seen = { cmd, envs: o.envs }; return { lines: STREAM, exitCode: 0 }; }
      return null;
    } });
    const events = [];
    const r = await runClaude({ cwd: f.repo, prompt: 'hello', systemPrompt: 'sys', permissionMode: 'acceptEdits', execEnv: env,
      onEvent: (e) => events.push(e), resumeSessionId: 'abc-session' });
    assert.equal(r.text, 'done');
    assert.ok(events.some((e) => e.type === 'session' && e.sessionId === '11111111-2222-3333-4444-555555555555'));
    assert.match(seen.cmd, /'--resume' 'abc-session'/);
    assert.doesNotMatch(seen.cmd, /host-guard\.mjs/, 'no host guard hook in --settings');
    assert.equal(seen.envs.WORCA_HOST_PID, undefined);
    assert.equal(seen.envs.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'the server credential stays in worca');
    assert.equal(seen.envs.GH_TOKEN, undefined);
    assert.equal(seen.envs.PATH, undefined);
    for (const k of ['WORCA_HEARTBEAT_TOKEN', 'OTEL_EXPORTER_OTLP_HEADERS', 'E2B_API_KEY', 'WORCA_E2B_TEMPLATE']) assert.equal(k in seen.envs, false, k);
    await env.close('test');
  }));

test('a spawn through a model route: no credential in the sandbox, only the relay URL and the route id', POSIX, async (t) => {
  let envs = null;
  const { f, env } = await started({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'oat' } }, { onCommand: (cmd, o) => {
    if (cmd.includes('model-env-probe')) { envs = o.envs; return { lines: [], exitCode: 0 }; }
    return null;
  } });
  t.after(() => env.close('test'));   // also when an assertion fails: no sandbox or relay left running
  const route = env.openModelRoute({ spawnEnv: { CLAUDE_CODE_OAUTH_TOKEN: 'oat', ANTHROPIC_MODEL: 'm' }, modelEnv: null });
  assert.deepEqual(route.secrets, ['oat']);
  const childEnv = env.envFor({ CLAUDE_CODE_OAUTH_TOKEN: 'oat', ANTHROPIC_API_KEY: 'k', ANTHROPIC_BASE_URL: 'http://127.0.0.1:9/bridge',
    ANTHROPIC_MODEL: 'm' }, { keep: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL'], route });
  await supervise(env, { args: ['-c', 'true # model-env-probe'], cwd: f.repo, childEnv });
  assert.equal(envs.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.equal(envs.ANTHROPIC_API_KEY, undefined, 'not even through keep');
  assert.match(envs.ANTHROPIC_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/r\//);
  assert.equal(envs.ANTHROPIC_AUTH_TOKEN, route.id);
  assert.equal(envs.ANTHROPIC_BASE_URL, route.env.ANTHROPIC_BASE_URL);
  assert.equal(envs.ANTHROPIC_MODEL, 'm');
  env.closeModelRoute(route.id);
  assert.equal(env.relay.routes.has(route.id), false);
});

test('a long prompt is staged: the system prompt file exists at its mirrored path when claude starts', POSIX, () =>
  withEnv({ WORCA_MOCK: undefined, ORCH_MOCK: undefined }, async () => {
    let staged = null; let stdinSeen = false;
    const { f, env } = await started({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'oat' } }, { onCommand: (cmd, o) => {
      if (!cmd.startsWith("'claude'")) return null;
      const file = cmd.match(/'--append-system-prompt-file' '([^']+)'/)?.[1];
      staged = file && existsSync(o.sandbox.pathPrefix + file) ? readFileSync(o.sandbox.pathPrefix + file, 'utf8') : null;
      const stdinFile = cmd.match(/< '([^']+)'$/)?.[1];
      stdinSeen = !!stdinFile && readFileSync(stdinFile, 'utf8').length > 20_000;
      return { lines: STREAM, exitCode: 0 };
    } });
    const r = await runClaude({ cwd: f.repo, prompt: 'x'.repeat(25_000), systemPrompt: 'the system prompt', execEnv: env });
    assert.equal(r.text, 'done');
    assert.match(staged || '', /the system prompt/);
    assert.ok(stdinSeen, 'the prompt went in on stdin through a sandbox file');
    await env.close('test');
  }));

test('a remote runClaude on another engine is refused, with and without mock', async () => {
  const execEnv = { remote: true, sandboxId: 'x' };
  await assert.rejects(runClaude({ engine: 'codex', execEnv }), /claude engine only/);
  await assert.rejects(runClaude({ engine: 'codex', execEnv, mock: true }), /claude engine only/);
  await assert.rejects(runClaude({ engine: 'gemini', execEnv, mock: true }), /claude engine only \(this run uses gemini\): Gemini CLI runs locally only for now/);
});

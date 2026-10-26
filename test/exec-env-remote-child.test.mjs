// test/exec-env-remote-child.test.mjs
// The agent spawn seam in e2b mode: superviseSpawn driving a RemoteChild (src/core/exec-env/remote-child.mjs)
// on the loopback fake, and runClaude end to end with a canned claude stream inside the "sandbox".
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createFakeE2b } from '../src/core/exec-env/e2b-fake.mjs';
import { E2bExecEnv } from '../src/core/exec-env/e2b-env.mjs';
import { superviseSpawn } from '../src/core/spawn.mjs';
import { runClaude } from '../src/core/claude-runner.mjs';
import { scratchDirs, fixture, makeEnvOpts, git } from './helpers/e2b-fixture.mjs';
import { worcaHome } from '../src/core/projects.mjs';
import { cursorReplyLines } from './helpers/fake-cursor.mjs';

const POSIX = { skip: process.platform === 'win32' ? 'e2b mode is POSIX-only' : false };
const { tmp, cleanup } = scratchDirs(); after(cleanup);

/** Resolves once `cond()` holds (polled), or when `p` settles first: an abort waits for the command to really start,
 *  not for a fixed delay that a loaded machine overruns while the pre-step sync is still running. */
// The poll stops either way: one left running keeps the whole file from exiting when `p` settles first.
const until = (cond, p) => {
  let iv;
  return Promise.race([new Promise((r) => { iv = setInterval(() => { if (cond()) r(); }, 5); }), p.then(() => {}, () => {})])
    .finally(() => clearInterval(iv));
};

/** An env on a fresh fake sandbox. The template's engine CLIs (RemoteExecEnv.ensureCli probes them) are all there unless
 *  `missing` names one: every probe is answered here, never by the fake's real bash, whose PATH is this machine's (it may
 *  hold a real codex). `probes` lists the CLIs probed, in order. */
async function started(extra = {}, { missing = [], onCommand = null, ...sdkOpts } = {}) {
  const f = fixture(tmp);
  const probes = [];
  const sdk = createFakeE2b({ root: tmp('worca-e2b-root-'), ...sdkOpts, onCommand: (cmd, o) => {
    const cli = cmd.match(/^command -v '([^']+)'/)?.[1];
    if (cli) { probes.push(cli); return { lines: missing.includes(cli) ? [] : [`/usr/local/bin/${cli}`] }; }
    return onCommand ? onCommand(cmd, o) : null;
  } });
  const env = new E2bExecEnv(makeEnvOpts(tmp, sdk, f, extra));
  await env.start();
  return { f, sdk, env, probes };
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

/** Polls `cond` every 10 ms; throws after `ms` instead of hanging. */
const settle = async (cond, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out waiting');
};
const groupKills = (sdk) => sdk.events.filter((e) => e.type === 'command' && /^kill -(TERM|KILL) -- -\d+/.test(e.cmd)).map((e) => e.cmd);

test('a stop after the remote command exited signals no group: its pid may belong to another command by then', POSIX, async () => {
  const { f, sdk, env } = await started();
  try {
    const child = env.spawn('bash', ['-c', 'true'], { cwd: f.repo });
    child.stdout.resume(); child.stderr.resume();
    await once(child, 'close');
    assert.ok(child.remotePid != null, 'the command ran');
    child.kill('SIGTERM'); child.kill('SIGKILL'); child.kill();
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(groupKills(sdk), []);
  } finally { await env.close('test'); }
});

test('a stop with no signal (a script\'s) signals the remote step group, so a backgrounded grandchild dies with it', POSIX, async () => {
  const { f, sdk, env } = await started();
  const prevGrace = process.env.WORCA_SIGKILL_GRACE_MS;
  process.env.WORCA_SIGKILL_GRACE_MS = '100';
  let gp = null;
  try {
    const pidFile = env.sb(join(f.repo, 'gp'));
    const child = env.spawn('bash', ['-c', `sleep 600 & echo $! > '${pidFile}'; wait`], { cwd: f.repo });
    child.stdout.resume(); child.stderr.resume();
    const closed = once(child, 'close');
    await settle(() => { try { gp = Number(readFileSync(pidFile, 'utf8')) || null; } catch { /* not yet */ } return gp && child.remotePid != null; });
    child.kill();
    await settle(() => groupKills(sdk).some((c) => c.startsWith(`kill -TERM -- -${child.remotePid} `)));
    await closed;
    await settle(() => { try { process.kill(gp, 0); return false; } catch (e) { return e.code === 'ESRCH'; } });
  } finally {
    if (prevGrace === undefined) delete process.env.WORCA_SIGKILL_GRACE_MS; else process.env.WORCA_SIGKILL_GRACE_MS = prevGrace;
    if (gp) { try { process.kill(gp, 'SIGKILL'); } catch { /* gone, as it should be */ } }
    await env.close('test');
  }
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
    if (!opts?.background || !cmd.startsWith("exec setsid -w 'bash'")) return realRun(cmd, opts);   // worca's own commands run too (_sh)
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
  const cmd = sdk.events.filter((e) => e.type === 'command' && e.cmd.startsWith("exec setsid -w 'bash'")).at(-1).cmd;
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

test('a remote runClaude on an engine the sandbox does not run is refused, with and without mock', async () => {
  const execEnv = { remote: true, sandboxId: 'x', title: 'E2B' };
  // An object, not a bare RegExp: assert.rejects tests a RegExp against String(err) ("Error: …"), where ^ never matches.
  const gate = { message: /^E2B execution runs the claude, codex, copilot and cursor engines only \(this run uses gemini\): Gemini CLI runs locally only for now\. Pick Local, or switch the engine\.$/ };
  await assert.rejects(runClaude({ engine: 'gemini', execEnv }), gate);
  await assert.rejects(runClaude({ engine: 'gemini', execEnv, mock: true }), gate);
});

const CODEX_STREAM = [
  { type: 'thread.started', thread_id: 't-remote' }, { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'done' } },
  { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 2 } },
].map((l) => JSON.stringify(l));
// The host CLI overrides name nothing: a test that goes red never starts this machine's real codex, copilot or cursor-agent.
const HOSTILE = { WORCA_MOCK: undefined, ORCH_MOCK: undefined, WORCA_HOST_GUARD: '1', WORCA_HOST_PID: String(process.pid), GH_TOKEN: 'ghp_host',
  E2B_API_KEY: 'e2b_k', WORCA_E2B_TEMPLATE: 't', WORCA_HEARTBEAT_TOKEN: 'hb', ANTHROPIC_API_KEY: 'sk-ant-host', CLAUDE_CODE_OAUTH_TOKEN: 'oat-host',
  WORCA_CODEX_BIN: '/nonexistent/worca-test/codex', WORCA_COPILOT_BIN: '/nonexistent/worca-test/copilot', WORCA_CURSOR_BIN: '/nonexistent/worca-test/cursor-agent' };
const NOT_IN_SANDBOX = ['WORCA_HOST_PID', 'GH_TOKEN', 'E2B_API_KEY', 'WORCA_E2B_TEMPLATE', 'WORCA_HEARTBEAT_TOKEN', 'PATH', 'HOME', 'ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN'];

/** A CODEX_HOME on this machine holding a rollout (session file) of `thread` that reports `input` tokens so far. */
function hostCodexHome(thread, input) {
  const home = tmp('worca-codex-host-home-');
  mkdirSync(join(home, 'sessions'), { recursive: true });
  const usage = { input_tokens: input, cached_input_tokens: 0, output_tokens: 40, reasoning_output_tokens: 0, total_tokens: input + 40 };
  writeFileSync(join(home, 'sessions', `rollout-2026-10-21T00-00-00-${thread}.jsonl`),
    `${JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: usage } } })}\n`);
  return home;
}

test('codex runs in the sandbox: the template CLI, the relay provider with a dummy key, no host guard, no host MCP', POSIX, () =>
  withEnv({ ...HOSTILE, OPENAI_API_KEY: 'sk-host-inherited', CODEX_API_KEY: undefined, CODEX_HOME: hostCodexHome('t-remote', 900) }, async () => {
    let seen;
    let reply = { lines: CODEX_STREAM, exitCode: 0 };
    const { f, env } = await started({ env: { CODEX_API_KEY: 'sk-codex-server' } }, { onCommand: (cmd, o) => {
      if (!cmd.startsWith("'codex'")) return null;
      const role = cmd.match(/\.config_file="([^"]+)"/)?.[1];
      seen = { cmd, envs: o.envs, role, roleInSandbox: !!role && existsSync(o.sandbox.pathPrefix + role) };
      return reply;
    } });
    const mcpConfigPath = join(f.runRoot, 'mcp.json');
    writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers: { local: { command: 'node', args: ['/Users/x/s.mjs'] }, web: { type: 'http', url: 'https://mcp.example.com/x' } } }));
    const events = [];
    const r = await runClaude({ engine: 'codex', cwd: f.repo, prompt: 'hello', systemPrompt: 'sys', execEnv: env, mcpConfigPath, bin: '/opt/host/codex',
      permissionRules: { deny: ['Bash(rm:*)'] }, onEvent: (e) => events.push(e),
      allowedTools: ['Read', 'Agent'], agents: { 'worca-investigator': { prompt: 'Investigate.' } } });
    assert.equal(r.text, 'done');
    assert.match(seen.cmd, /^'codex' 'exec'/);
    assert.equal(seen.envs.CODEX_API_KEY, undefined, 'the server key stays in worca');
    assert.equal(seen.envs.OPENAI_API_KEY, undefined, 'the inherited key never passes');
    assert.equal(seen.envs.WORCA_RELAY_KEY, 'worca-relay-no-credential');
    assert.match(seen.cmd, /model_providers\.worca_relay\.base_url="http:\/\/127\.0\.0\.1:\d+\/r\/[A-Za-z0-9_-]{43}"/);
    assert.equal(seen.cmd.includes('sk-codex-server'), false);
    assert.equal(seen.envs.CODEX_HOME, env.sb('/home/user/.codex'));
    for (const k of NOT_IN_SANDBOX) assert.equal(k in seen.envs, false, k);
    // The preamble's heading: tomlString escapes the prompt's newlines in argv, so a multi-line slice would never match.
    assert.doesNotMatch(seen.cmd, /Host process protection/, 'no host guard preamble');
    assert.doesNotMatch(seen.cmd, /mcp_servers/);
    assert.ok(events.some((e) => e.type === 'stderr' && /MCP servers not attached on codex in the E2B sandbox: local \(a command on the worca host\), web \(codex attaches command servers only\)/.test(e.text)));
    assert.ok(events.some((e) => e.type === 'stderr' && /\/opt\/host\/codex \(this machine's binary\) is ignored/.test(e.text)));
    assert.match(readFileSync(join(seen.envs.CODEX_HOME, 'rules', 'worca.rules'), 'utf8'), /prefix_rule\(pattern=\["rm"\]/);
    // No guarded CODEX_HOME on this machine: the rules live in the sandbox HOME only (envFor would hide a host one).
    assert.equal(existsSync(join(worcaHome(), 'engines', 'codex', 'homes')), false, 'no host guarded CODEX_HOME for a remote spawn');
    // The investigator role file went up with the spawn, and is gone from the sandbox after it.
    assert.ok(seen.role && seen.roleInSandbox, `the role file was uploaded: ${seen.role}`);
    await env.beforeSpawn();                                    // the removal is queued on the same chain: flush it
    assert.equal(existsSync(env.sb(dirname(seen.role))), false, 'the role dir is removed from the sandbox');
    // A resumed thread (a paused run reconnecting to its sandbox) lives in the sandbox: no host rollout lookup.
    const sessionId = events.find((e) => e.type === 'session')?.sessionId;
    assert.ok(sessionId, 'the first spawn named its session');
    const again = await runClaude({ engine: 'codex', cwd: f.repo, prompt: 'more', execEnv: env, bin: '/opt/host/codex', resumeSessionId: sessionId });
    assert.equal(again.text, 'done');
    assert.match(seen.cmd, /^'codex' 'exec'.*'resume' 't-remote'/);
    // A turn that ends early (no turn.completed) stays unbooked: its session file is in the sandbox, so this machine's
    // CODEX_HOME rollout of the same thread is never read as its spend.
    reply = { lines: CODEX_STREAM.slice(0, 2), exitCode: 1, stderr: 'codex died' };
    const early = [];
    await assert.rejects(runClaude({ engine: 'codex', cwd: f.repo, prompt: 'once more', execEnv: env, bin: '/opt/host/codex', resumeSessionId: sessionId,
      onEvent: (e) => early.push(e) }), /codex died/);
    assert.equal(early.some((e) => e.type === 'result' && e.usage), false, 'no spend booked from the host rollout');
    await env.close('test');
  }));

test('codex without a server key is refused, even with a ChatGPT sign-in (auth.json) on this machine: none goes into a sandbox', POSIX, () =>
  withEnv({ ...HOSTILE, OPENAI_API_KEY: undefined, CODEX_API_KEY: undefined }, async () => {
    const hostHome = mkdtempSync(join(tmpdir(), 'worca-codex-home-')); writeFileSync(join(hostHome, 'auth.json'), '{"tokens":{"refresh_token":"rt-host"}}');
    let ran = false;
    const { f, env } = await started({ env: { CODEX_HOME: hostHome } }, { onCommand: (cmd) => { if (cmd.startsWith("'codex'")) ran = true; return null; } });
    await assert.rejects(runClaude({ engine: 'codex', cwd: f.repo, prompt: 'hello', execEnv: env, bin: '/nonexistent/codex' }),
      (e) => /Codex in a sandbox needs CODEX_API_KEY or OPENAI_API_KEY/.test(e.message) && e.errorClass === 'config');
    assert.equal(ran, false);
    assert.equal(existsSync(env.sb('/home/user/.codex/auth.json')), false, 'no sign-in file in the sandbox');
    rmSync(hostHome, { recursive: true, force: true });
    await env.close('test');
  }));

const COPILOT_LINES = readFileSync(new URL('./fixtures/copilot/tools.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
const PAT = `github_pat_${'R2d2'.repeat(10)}`;
// The usage file copilot writes: the same helper as test/copilot-adapter.test.mjs USAGE.
const USAGE = (input, output, cached = 0) => ({ modelMetrics: { 'gpt-5.4': { requests: { count: 1, cost: 0 }, usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cached, cacheWriteTokens: 0, reasoningTokens: 0 } } } });
// A command server (runs on the worca host) and a remote url server: only `web` may reach a sandbox.
const MCP_MIX = { mcpServers: { local: { command: 'node', args: ['/x.mjs'] }, web: { type: 'http', url: 'https://mcp.example.com/x' } } };
/** A COPILOT_HOME on this machine whose own MCP config names a server of the user's (userCopilotMcpNames reads it). */
function hostCopilotHome() {
  const home = tmp('worca-copilot-host-home-');
  writeFileSync(join(home, 'mcp-config.json'), JSON.stringify({ mcpServers: { 'my-host-server': { command: 'node', args: ['/x.mjs'] } } }));
  return home;
}

test('copilot runs in the sandbox: offline mode at the relay, no GitHub token, url MCP servers only, its scratch uploaded and removed, the relay`s usage', POSIX, () =>
  withEnv({ ...HOSTILE, COPILOT_GITHUB_TOKEN: 'ghp_inherited_classic_token_value_xx', COPILOT_HOME: hostCopilotHome(), CURSOR_API_KEY: 'crsr-host' }, async () => {
    let seen;
    const { f, env } = await started({ env: { COPILOT_GITHUB_TOKEN: PAT } }, { onCommand: (cmd, o) => {
      if (!cmd.startsWith("'copilot'")) return null;
      const scratch = cmd.match(/'--add-dir' '([^']+)'/)[1];
      const usage = cmd.match(/'--usage-output-file' '([^']+)'/)[1];
      const mcpFile = cmd.match(/'--additional-mcp-config' '@([^']+)'/)?.[1];
      const agent = o.sandbox.pathPrefix + join(scratch, '.github', 'agents', 'worca-node.agent.md');
      seen = { cmd, envs: o.envs, scratch, agent: existsSync(agent) ? readFileSync(agent, 'utf8') : null,
        mcp: mcpFile && existsSync(o.sandbox.pathPrefix + mcpFile) ? JSON.parse(readFileSync(o.sandbox.pathPrefix + mcpFile, 'utf8')) : null };
      // mkdir: with the scratch dir NOT uploaded (guard row 28 reverted) the test must fail on `seen.agent`, not here.
      mkdirSync(dirname(o.sandbox.pathPrefix + usage), { recursive: true });
      writeFileSync(o.sandbox.pathPrefix + usage, JSON.stringify(USAGE(1000, 50, 100)));
      return { lines: COPILOT_LINES, exitCode: 0 };
    } });
    const mcpConfigPath = join(f.runRoot, 'mcp.json'); writeFileSync(mcpConfigPath, JSON.stringify(MCP_MIX));
    const events = [];
    await runClaude({ engine: 'copilot', cwd: f.repo, prompt: 'hello', systemPrompt: 'sys', execEnv: env, mcpConfigPath, bin: '/opt/host/copilot',
      model: 'copilot/gpt-5-mini', onEvent: (e) => events.push(e) });
    assert.equal(seen.envs.COPILOT_GITHUB_TOKEN, undefined, 'neither the server token nor the inherited classic one');
    assert.equal(seen.envs.COPILOT_OFFLINE, 'true');
    assert.match(seen.envs.COPILOT_PROVIDER_BASE_URL, /^http:\/\/127\.0\.0\.1:\d+\/r\/[A-Za-z0-9_-]{43}$/);
    assert.equal(seen.envs.COPILOT_PROVIDER_API_KEY, 'worca-relay-no-credential');
    assert.match(seen.cmd, /'--model' 'gpt-5-mini'/, 'the step\'s model, as copilot names it');
    assert.equal(events.some((e) => e.type === 'stderr' && /no model named/.test(e.text)), false, 'no hidden default');
    assert.equal(seen.envs.COPILOT_HOME, undefined);
    assert.equal(seen.envs.CURSOR_API_KEY, undefined);
    for (const k of NOT_IN_SANDBOX) assert.equal(k in seen.envs, false, k);
    assert.ok(seen.agent, 'the scratch dir (agent file) was uploaded before copilot started');
    assert.doesNotMatch(seen.agent, /Host process protection/, 'no host guard preamble in the agent file');
    assert.deepEqual(Object.keys(seen.mcp?.mcpServers || {}), ['web'], 'only the remote url server reaches the sandbox');
    assert.match(seen.cmd, /^'copilot' /);
    // The sandbox copilot has no config of this machine's: nothing of the user's own is turned off there, nor named.
    assert.doesNotMatch(seen.cmd, /'--disable-mcp-server'|my-host-server/);
    assert.ok(events.some((e) => e.type === 'stderr' && /\/opt\/host\/copilot \(this machine's binary\) is ignored/.test(e.text)));
    // The sandbox's usage.json is its word: it stays there, and the result carries what the relay measured (nothing here).
    assert.equal(events.find((e) => e.type === 'result')?.usage?.input_tokens, 0, 'not the sandbox`s usage.json');
    assert.equal(existsSync(join(seen.scratch, 'usage.json')), false, 'usage.json is never brought home');
    assert.equal(existsSync(env.sb(seen.scratch)), false, 'the sandbox copy of the scratch dir is removed after the spawn');
    await env.close('test');
  }));

test('copilot with a classic or OAuth token in the server env is refused before anything is staged', POSIX, () =>
  withEnv({ ...HOSTILE }, async () => {
    let ran = false;
    const { f, env } = await started({ env: { COPILOT_GITHUB_TOKEN: `ghp_${'x'.repeat(36)}` } }, { onCommand: (cmd) => { if (cmd.startsWith("'copilot'")) ran = true; return null; } });
    const events = [];
    await assert.rejects(runClaude({ engine: 'copilot', cwd: f.repo, prompt: 'x', execEnv: env, bin: '/nonexistent/copilot', model: 'copilot/gpt-5-mini', onEvent: (e) => events.push(e) }), /COPILOT_GITHUB_TOKEN is a classic token/);
    assert.equal(ran, false);
    assert.equal(events.some((e) => e.type === 'session'), false, 'refused before the session is named');
    await env.close('test');
  }));

test('remote copilot with no model is refused before anything is staged', POSIX, () =>
  withEnv({ ...HOSTILE }, async () => {
    const commands = [];
    const { f, env } = await started({ env: { COPILOT_GITHUB_TOKEN: PAT } }, { onCommand: (cmd) => { commands.push(cmd); return null; } });
    const before = commands.length;
    const events = [];
    const err = await runClaude({ engine: 'copilot', cwd: f.repo, prompt: 'x', execEnv: env, bin: '/nonexistent/copilot', onEvent: (e) => events.push(e) }).then(() => null, (e) => e);
    assert.equal(err?.message, 'Copilot in a sandbox needs a model; pick one for this step.');
    assert.equal(err.errorClass, 'config');
    assert.deepEqual(commands.slice(before), [], 'the sandbox ran nothing: no probe, no upload');
    assert.equal(events.some((e) => e.type === 'session'), false);
    assert.equal((await import('../src/core/engines/copilot.mjs')).COPILOT_REMOTE_DEFAULT_MODEL, undefined, 'no hidden default left');
    await env.close('test');
  }));

test('cursor runs in the sandbox: the relay endpoint and a dummy token, url MCP servers only, its .cursor files mirrored, hidden from the sandbox git and never brought back in a patch', POSIX, () =>
  withEnv({ ...HOSTILE, CURSOR_API_KEY: 'crsr-host', COPILOT_GITHUB_TOKEN: 'ghp_x' }, async () => {
    let seen;
    // syncExcludes is the fixture's own (no .cursor entry): the sandbox clone's info/exclude line alone keeps worca's
    // files out of the sync tree, as the harness now relies on (Step 5).
    const { f, env } = await started({ env: { CURSOR_API_KEY: 'crsr-server' } },
      { onCommand: (cmd, o) => {
        if (!cmd.startsWith("'cursor-agent'")) return null;
        const at = (rel) => o.sandbox.pathPrefix + join(f.repo, rel);
        seen = { cmd, envs: o.envs, cli: readFileSync(at('.cursor/cli.json'), 'utf8'), mcp: JSON.parse(readFileSync(at('.cursor/mcp.json'), 'utf8')) };
        writeFileSync(at('.cursor/cli.json'), '{"rewritten":"by the agent"}\n');   // must never reach the host
        writeFileSync(at('a.txt'), 'changed by cursor\n');                          // must reach the host
        // The fake writes each line + '\n': cursorReplyLines gives objects, so serialise them.
        return { lines: cursorReplyLines('done').map((l) => JSON.stringify(l)), exitCode: 0 };
      } });
    const mcpConfigPath = join(f.runRoot, 'mcp.json'); writeFileSync(mcpConfigPath, JSON.stringify(MCP_MIX));
    const events = [];
    const r = await runClaude({ engine: 'cursor', cwd: f.repo, prompt: 'hello', systemPrompt: 'sys', execEnv: env, mcpConfigPath, bin: '/opt/host/cursor-agent',
      permissionRules: { deny: ['Bash(rm:*)'] }, onEvent: (e) => events.push(e) });
    assert.equal(r.text, 'done');
    assert.match(seen.cmd, /^'cursor-agent' /);
    assert.ok(events.some((e) => e.type === 'stderr' && /\/opt\/host\/cursor-agent \(this machine's binary\) is ignored/.test(e.text)));
    assert.equal(seen.envs.CURSOR_API_KEY, undefined, 'the server key stays in worca');
    assert.equal(seen.envs.CURSOR_AUTH_TOKEN, 'worca-relay-no-credential');
    assert.match(seen.envs.CURSOR_API_ENDPOINT, /^http:\/\/127\.0\.0\.1:\d+\/r\/[A-Za-z0-9_-]{43}$/);
    assert.match(readFileSync(join(seen.envs.CURSOR_CONFIG_DIR, 'cli-config.json'), 'utf8'), /"useHttp1ForAgent": true/);
    assert.equal(seen.envs.COPILOT_GITHUB_TOKEN, undefined);
    for (const k of NOT_IN_SANDBOX) assert.equal(k in seen.envs, false, k);
    assert.doesNotMatch(seen.cmd, /Host process protection/, 'no host guard preamble');
    assert.match(seen.cli, /"deny"/, 'the deny rules reached the sandbox checkout');
    assert.deepEqual(Object.keys(seen.mcp.mcpServers || {}), ['web'], 'only the remote url server reaches the sandbox');
    const status = git(env.sb(f.repo), '-c', 'core.excludesFile=/dev/null', 'status', '--porcelain', '--untracked-files=all');
    assert.equal(/\.cursor\//.test(status), false, `worca's .cursor files are hidden from the sandbox git: ${status}`);
    assert.equal(readFileSync(join(f.repo, 'a.txt'), 'utf8'), 'changed by cursor\n', 'the agent`s work came back as a patch');
    assert.match(readFileSync(join(f.repo, '.cursor', 'cli.json'), 'utf8'), /"deny"/, 'worca`s cli.json was never brought back in that patch');
    // G14: the agent's rewrite of the sandbox copy is undone once the spawn ends, so the next spawn there reads worca's rules.
    const sandboxCli = readFileSync(env.sb(join(f.repo, '.cursor', 'cli.json')), 'utf8');
    await env.close('test');
    assert.match(sandboxCli, /"deny"/, 'worca`s cli.json is back in the sandbox');
  }));

test('cursor without CURSOR_API_KEY in the server env is refused before anything reaches the sandbox', POSIX, () =>
  withEnv({ ...HOSTILE, CURSOR_API_KEY: 'crsr-host-inherited' }, async () => {
    let ran = false;
    const { f, env } = await started({ env: {} }, { onCommand: (cmd) => { if (cmd.startsWith("'cursor-agent'")) ran = true; return null; } });
    await assert.rejects(runClaude({ engine: 'cursor', cwd: f.repo, prompt: 'x', execEnv: env, bin: '/nonexistent/cursor-agent', permissionRules: { deny: ['Bash(rm:*)'] } }),
      /CURSOR_API_KEY is not set/);
    assert.equal(ran, false);
    assert.equal(existsSync(env.sb(join(f.repo, '.cursor', 'cli.json'))), false, 'nothing mirrored into the sandbox before the sign-in check');
    await env.close('test');
  }));

const SIGNED_IN = { codex: { CODEX_API_KEY: 'sk-codex-server' }, copilot: { COPILOT_GITHUB_TOKEN: PAT }, cursor: { CURSOR_API_KEY: 'crsr-server' } };
const CLI = { codex: 'codex', copilot: 'copilot', cursor: 'cursor-agent' };

test('a template without the engine`s CLI (built before that engine) fails the step with the rebuild hint before the CLI runs', POSIX, () =>
  withEnv({ ...HOSTILE }, async () => {
    for (const engine of ['codex', 'copilot', 'cursor']) {
      const cli = CLI[engine];
      let ran = 0;
      // The CLI's own command is answered too: with the probe gone, the step must fail on `ran`, never reach a host CLI.
      const { f, env, probes } = await started({ env: SIGNED_IN[engine] }, { missing: [cli],
        onCommand: (cmd) => (cmd.startsWith(`'${cli}'`) ? (ran += 1, { lines: [], stderr: `${cli}: command not found`, exitCode: 127 }) : null) });
      const events = [];
      const step = () => runClaude({ engine, cwd: f.repo, prompt: 'x', execEnv: env, bin: `/nonexistent/${cli}`,
        model: engine === 'copilot' ? 'copilot/gpt-5-mini' : undefined,
        permissionRules: { deny: ['Bash(rm:*)'] }, onEvent: (e) => events.push(e) });
      const stale = { message: new RegExp(`^the E2B template has no ${cli}: rebuild it \\(npm run e2b:build\\)$`) };
      await assert.rejects(step(), stale, engine);
      await assert.rejects(step(), stale, `${engine}, again`);
      assert.equal(ran, 0, `${engine}: the CLI never ran`);
      assert.deepEqual(probes, [cli], `${engine}: one probe per sandbox, its answer kept`);
      assert.equal(events.some((e) => e.type === 'session'), false, `${engine}: refused before the session is named`);
      await env.close('test');
    }
    // A project template names the project page's Rebuild (the harness passes resolveRunEnvironment's hint); a backend
    // without a hint names none.
    for (const [rebuildHint, text] of [['Rebuild environment on the project page', ' (Rebuild environment on the project page)'], [null, '']]) {
      const { env } = await started({ rebuildHint }, { missing: ['codex'] });
      await assert.rejects(env.ensureCli('codex'), { message: `the E2B template has no codex: rebuild it${text}` });
      await env.close('test');
    }
  }));

test('the CLI probe runs once per sandbox and engine, never for claude, again after a reconnect; a probe that failed is not kept', POSIX, () =>
  withEnv({ ...HOSTILE }, async () => {
    const server = { CODEX_API_KEY: 'sk-codex-server', CLAUDE_CODE_OAUTH_TOKEN: 'oat' };
    const { f, sdk, env, probes } = await started({ env: server }, { onCommand: (cmd) => (cmd.startsWith("'codex'") ? { lines: CODEX_STREAM, exitCode: 0 }
      : cmd.startsWith("'claude'") ? { lines: STREAM, exitCode: 0 } : null) });
    const codex = (execEnv) => runClaude({ engine: 'codex', cwd: f.repo, prompt: 'x', execEnv, bin: '/nonexistent/codex' });
    assert.equal((await codex(env)).text, 'done');
    assert.equal((await codex(env)).text, 'done');
    assert.equal((await runClaude({ cwd: f.repo, prompt: 'x', execEnv: env })).text, 'done');
    assert.deepEqual(probes, ['codex'], 'probed before the first codex spawn only');
    // A reconnected env (a resumed run) probes again: the template is the sandbox's, and the answer lives with the env.
    const back = await E2bExecEnv.reconnect(env.resumeRecord(), makeEnvOpts(tmp, sdk, f, { env: server, scratchDir: env.scratchDir }));
    assert.equal((await codex(back)).text, 'done');
    assert.deepEqual(probes, ['codex', 'codex']);
    // A probe the sandbox did not answer (a dropped stream) says nothing about the template: the next spawn asks again.
    const run = back.client.run;
    let drop = true;
    back.client.run = (box, cmd, o) => (drop && cmd.startsWith('command -v') ? (drop = false, Promise.reject(new Error('stream reset'))) : run(box, cmd, o));
    await assert.rejects(back.ensureCli('copilot'), /stream reset/);
    await back.ensureCli('copilot');
    assert.deepEqual(probes, ['codex', 'codex', 'copilot']);
    await back.close('test');
    await env.close('test');
  }));

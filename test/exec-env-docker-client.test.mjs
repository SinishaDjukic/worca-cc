// test/exec-env-docker-client.test.mjs — the Local sandbox (Docker) client (src/core/exec-env/backends/docker.mjs)
// against a stubbed docker runner (every call, the error classes, the size cap), and against the fake docker
// (backends/docker-fake.mjs, real processes) for the kill rule, file writes and the watchdog. No Docker daemon needed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dockerClient, dockerBackend, dockerPreflight, dockerNetwork, sandboxResources, buildProxyArgs, hardeningArgs, assertHardened,
  KEPT_CAPS, SANDBOX_USER, HELPER_USER, ROOT_USER, WATCHDOG_SCRIPT, DEADLINE_SCRIPT, DEADLINE_FILE, cliEnv, dockerProbe,
  _resetDockerProbeForTests, DOCKER_MISSING } from '../src/core/exec-env/backends/docker.mjs';
import { createFakeDocker } from '../src/core/exec-env/backends/docker-fake.mjs';
import { defaultImageName } from '../src/core/exec-env/backends/docker-image.mjs';
import { normalizeEnvSpec } from '../src/core/exec-env/env-spec.mjs';
import { getExecBackend } from '../src/core/exec-env/registry.mjs';
import { assertBackend } from '../src/core/exec-env/backend.mjs';
import { mkdirsScript } from '../src/core/exec-env/shell.mjs';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'worca-docker-client-home-');

const POSIX = { skip: process.platform === 'win32' ? 'the sandbox scripts are POSIX shell' : false };
const scratch = []; after(() => scratch.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (p = 'worca-docker-client-') => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };

/** A runner whose every call answers `reply(args, { env, input })` -> { code, stdout, stderr } (default: exit 0). */
function stubRunner(reply = () => ({ code: 0 })) {
  const calls = [];
  return {
    calls, kind: 'docker', network: false, pathPrefix: () => '',
    spawn(args, { env = {}, stdin = false } = {}) {
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      const call = { args: [...args], env: { ...env }, input: null, killed: null };
      calls.push(call);
      child.kill = (sig) => { call.killed = sig; return true; };
      const answer = () => setImmediate(() => {
        const r = reply(call.args, call) || {};
        if (r.stdout) child.stdout.write(r.stdout);
        if (r.stderr) child.stderr.write(r.stderr);
        child.stdout.end(); child.stderr.end();
        setImmediate(() => child.emit('close', r.code ?? 0, null));
      });
      if (stdin) {
        const parts = [];
        child.stdin = new PassThrough();
        child.stdin.on('data', (d) => parts.push(Buffer.from(d)));
        child.stdin.on('end', () => { call.input = Buffer.concat(parts); answer(); });
      } else { child.stdin = null; answer(); }
      return child;
    },
  };
}
const box = { name: 'worca-r1-abc', prefix: '' };
const verb = (c) => c.args[0];

test('the backend is valid, registered under "docker", and named exactly "Local sandbox (Docker)"', () => {
  assertBackend(dockerBackend);
  assert.equal(getExecBackend('docker'), dockerBackend);
  assert.equal(dockerBackend.label, 'Local sandbox (Docker)');
  assert.equal(dockerBackend.title, 'Docker');
  assert.equal(dockerBackend.environmentNoun, 'image');
  assert.deepEqual(dockerBackend.limitSettings, { maxConcurrent: 'dockerMaxSandboxes', maxWaitMin: 'dockerMaxWaitMin' });
  assert.equal(dockerBackend.capabilities.buildEnvironment, true);
  assert.ok(dockerBackend.secretEnv.test('WORCA_DOCKER_IMAGE'));
  assert.ok(!dockerBackend.secretEnv.test('DOCKER_HOST'), 'a Local run keeps its own Docker settings');
});

test('hardening: no mount, no socket, no privilege; only CHOWN and DAC_OVERRIDE are kept', () => {
  const flags = hardeningArgs({ memory: '6g', cpus: 3, pids: 999, runtime: 'runsc' });
  assert.deepEqual(KEPT_CAPS, ['CHOWN', 'DAC_OVERRIDE']);
  assert.doesNotThrow(() => assertHardened(flags));
  const pair = (n, v) => flags.some((a, i) => a === n && flags[i + 1] === v);
  for (const [n, v] of [['--network', 'none'], ['--cap-drop', 'ALL'], ['--security-opt', 'no-new-privileges'], ['--pids-limit', '999'],
    ['--memory', '6g'], ['--memory-swap', '6g'], ['--cpus', '3'], ['--runtime', 'runsc'], ['--user', HELPER_USER], ['--ipc', 'private']]) {
    assert.ok(pair(n, v), `${n} ${v}`);
  }
  assert.ok(flags.includes('--init'));
  assert.equal(flags.filter((a) => a === '--cap-add').length, 2);
  assert.ok(!hardeningArgs().includes('--runtime'), 'no runtime unless one is set');
  // Anything that crosses into the host is refused, whatever adds it.
  for (const extra of [['-v', '/:/host'], ['--volume', '/x:/y'], ['--mount', 'type=bind,src=/,dst=/h'], ['--privileged'],
    ['--device', '/dev/kvm'], ['--pid', 'host'], ['--userns', 'host'], ['--volumes-from', 'x'], ['-p', '80:80'], ['--add-host', 'h:1.2.3.4'],
    ['--cap-add', 'SYS_ADMIN'], ['--cap-add', 'NET_ADMIN'], ['--security-opt', 'seccomp=unconfined'], ['--security-opt', 'apparmor=unconfined'],
    ['-e', 'X=/var/run/docker.sock'], ['--label', 'x=/run/docker.sock'], ['--group-add', 'docker'], ['--tmpfs', '/x']]) {
    assert.throws(() => assertHardened([...flags, ...extra]), /refusing to start a sandbox container/, extra.join(' '));
  }
  const without = (n) => { const f = [...flags]; const i = f.indexOf(n); f.splice(i, 2); return f; };
  assert.throws(() => assertHardened(without('--cap-drop')), /every capability/);
  assert.throws(() => assertHardened(without('--pids-limit')), /--pids-limit/);
  assert.throws(() => assertHardened(flags.map((a, i) => (flags[i - 1] === '--network' ? 'bridge' : a))), /network must be none/);
  assert.throws(() => assertHardened(flags.map((a, i) => (flags[i - 1] === '--user' ? '0:0' : a))), /must not run as root/);
});

test('create: one `docker run` with the hardening, the run tags as labels, the watchdog as PID 1, nothing mounted', async () => {
  const image = defaultImageName();
  const r = stubRunner((args) => (args[0] === 'run' ? { code: 0, stdout: 'f'.repeat(64) + '\n' } : args[0] === 'image' ? { code: 0, stdout: 'sha256:1\n' } : { code: 0 }));
  const client = dockerClient(r, { resources: { memory: '2g', cpus: 1, pids: 512 } });
  const lines = [];
  const h = await client.create({ environment: image, tags: { worca: '1', worcaInstance: 'abc123', worcaRunId: 'r1', worcaProject: 'p' }, timeoutMs: 1_800_000, onLog: (l) => lines.push(l) });
  assert.match(h.id, /^worca-r1-[0-9a-f]{6}$/);
  assert.equal(h.pathPrefix, '');
  const run = r.calls.find((c) => verb(c) === 'run').args;
  assert.deepEqual(run.slice(0, 3), ['run', '-d', '--rm']);
  const at = run.indexOf(image);
  assert.ok(at > 0);
  assert.doesNotThrow(() => assertHardened(run.slice(1, at).filter((a, i, all) => !(a === '--label' || all[i - 1] === '--label'))));
  for (const l of ['worca.worca=1', 'worca.worcaInstance=abc123', 'worca.worcaRunId=r1', 'worca.worcaProject=p', 'worca.backend=docker']) assert.ok(run.includes(l), l);
  assert.ok(run.includes('--pull') && run[run.indexOf('--pull') + 1] === 'never', 'the default image is never pulled');
  assert.deepEqual(run.slice(at + 1, at + 3), ['-c', WATCHDOG_SCRIPT]);
  assert.deepEqual(run.slice(at + 3), ['worca-watchdog', DEADLINE_FILE, '1800', '5']);
  assert.ok(!run.some((a) => /^(-v|--volume|--mount)$/.test(a) || /docker\.sock/.test(a)));
  assert.ok(lines.some((l) => /2g memory, 1 CPUs, 512 processes, no mounts/.test(l)), lines.join('\n'));
});

test('create builds the default image on first use from the shipped files, with progress lines, once', async () => {
  const fake = createFakeDocker({ root: tmp(), missingImages: true });
  const client = dockerClient(fake.runner, { resources: {} });
  const lines = [];
  const image = defaultImageName();
  const [a, b] = await Promise.all([1, 2].map((n) => client.create({ environment: image, tags: { worca: '1', worcaRunId: `r${n}` }, timeoutMs: 60_000, onLog: (l) => lines.push(l) })));
  assert.equal(fake.calls.filter((c) => c[0] === 'build').length, 1, 'two runs share one build');
  const build = fake.calls.find((c) => c[0] === 'build');
  assert.equal(build.at(-1), '-', 'the Dockerfile goes on stdin: no build context');
  assert.ok(build.includes(image));
  assert.ok(lines.some((l) => /^building the sandbox image worca-local-sandbox:[0-9a-f]{12} on this machine \(first use/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /^image build 2\/9: RUN apt-get update/.test(l)));
  assert.ok(lines.some((l) => /^sandbox image .* built/.test(l)));
  await client.remove(a.id); await client.remove(b.id);
  // A project image that is not on this machine is a setting to fix, not something to pull from a registry.
  await assert.rejects(client.create({ environment: 'worca-local-sandbox-acme-12345678', tags: {}, timeoutMs: 60_000 }), (e) => e.errorClass === 'config' && /Rebuild it on the project page/.test(e.message));
  await assert.rejects(client.create({ environment: '--privileged', tags: {}, timeoutMs: 60_000 }), /not a Docker image reference/);
});

test('run: the env goes as -e NAME with the value in the CLI env, never on the argv; exit codes and stdout', async () => {
  const r = stubRunner((args) => (args.includes('fail') ? { code: 3, stderr: 'boom\n', stdout: 'partial' } : { code: 0, stdout: 'ok\n' }));
  const client = dockerClient(r);
  const out = await client.run(box, 'echo ok', { cwd: '/w', env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/x', MCPSECRET_A: 's3cret', PATH: '/evil', DOCKER_AUTH_TOKEN: 't', 'BAD NAME': 'x' } });
  assert.deepEqual(out, { exitCode: 0, stdout: 'ok\n', stderr: '' });
  const c = r.calls[0];
  assert.deepEqual(c.args.slice(0, 5), ['exec', '-u', SANDBOX_USER, '-e', 'HOME=/home/user']);
  assert.ok(c.args.includes('MCPSECRET_A') && c.env.MCPSECRET_A === 's3cret');
  assert.ok(!c.args.some((a) => a.includes('s3cret')), 'no value on the argv');
  assert.ok(c.args.includes('PATH=/evil'), 'a name the CLI reads itself goes on the argv');
  assert.ok(c.args.includes('DOCKER_AUTH_TOKEN') && c.env.DOCKER_AUTH_TOKEN === 't', 'a name the CLI does not read is passed like any other');
  assert.ok(!c.args.includes('BAD NAME'));
  const tail = c.args.slice(c.args.indexOf(box.name));
  assert.equal(tail[1], 'bash'); assert.equal(tail[2], '-c');
  assert.match(tail[4], /^worca-cmd:[0-9a-f]{24}$/); assert.equal(tail[5], '/w'); assert.equal(tail[6], 'echo ok');
  await assert.rejects(client.run(box, 'fail'), (e) => e.exitCode === 3 && /boom/.test(e.stderr) && client.classifyError(e) === null);
  const bg = await client.run(box, 'fail', { background: true });
  assert.equal(bg.pid, undefined, 'no host pid is handed out');
  await assert.rejects(bg.wait(), (e) => e.exitCode === 3);
  await client.run(box, 'x', { user: 'root' });
  assert.equal(r.calls.at(-1).args[2], ROOT_USER);
  await assert.rejects(client.run(box, 'x', { user: 'nobody' }), /unknown sandbox user/);
  assert.deepEqual(Object.keys(cliEnv({ PATH: '/b', DOCKER_HOST: 'unix:///x', ANTHROPIC_API_KEY: 'k', HOME: '/h' })).sort(), ['DOCKER_HOST', 'HOME', 'PATH']);
});

test('errors: a gone container is "gone", an unreachable daemon "unreachable", and a command that prints the same is neither', async () => {
  let running = 'missing';
  const r = stubRunner((args) => {
    if (args[0] === 'inspect') return running === 'missing' ? { code: 1, stderr: 'Error: No such object: worca-r1-abc\n' } : { code: 0, stdout: `${running === 'yes'}\n` };
    if (args[0] === 'exec') return { code: 1, stderr: 'Error response from daemon: No such container: worca-r1-abc\n' };
    return { code: 0 };
  });
  const client = dockerClient(r);
  await assert.rejects(client.run(box, 'true'), (e) => client.classifyError(e) === 'gone');
  running = 'no';   // stopped (its watchdog ended it): as good as gone
  await assert.rejects(client.run(box, 'true'), (e) => client.classifyError(e) === 'gone');
  running = 'yes';  // the command itself printed it
  await assert.rejects(client.run(box, 'true'), (e) => client.classifyError(e) === null && e.exitCode === 1);
  const down = stubRunner(() => ({ code: 1, stderr: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?\n' }));
  const c2 = dockerClient(down);
  await assert.rejects(c2.run(box, 'true'), (e) => c2.classifyError(e) === 'unreachable');
  await assert.rejects(c2.info('x'), (e) => c2.classifyError(e) === 'unreachable');
  await assert.rejects(c2.list({ worca: '1' }), (e) => c2.classifyError(e) === 'unreachable');
  const missing = { kind: 'docker', network: false, spawn: () => { const c = new EventEmitter(); c.stdout = new PassThrough(); c.stderr = new PassThrough(); setImmediate(() => c.emit('error', Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }))); return c; } };
  const c3 = dockerClient(missing);
  await assert.rejects(c3.run(box, 'true'), (e) => c3.classifyError(e) === 'unreachable' && /not installed/.test(e.message));
  assert.equal(c3.classifyError(new Error('x')), null);
});

test('readFile streams with the maxBytes rule (E_TOO_LARGE), as the sandbox user; a missing file is ENOENT', async () => {
  const r = stubRunner((args) => (args.includes('/big') ? { code: 0, stdout: 'x'.repeat(11) } : args.includes('/none') ? { code: 1, stderr: "head: cannot open '/none' for reading: No such file or directory\n" } : { code: 0, stdout: 'abc' }));
  const client = dockerClient(r);
  assert.equal((await client.readFile(box, '/small')).toString(), 'abc');
  assert.deepEqual(r.calls.at(-1).args.slice(-3), ['cat', '--', '/small']);
  assert.equal((await client.readFile(box, '/small', { maxBytes: 10 })).toString(), 'abc');
  assert.deepEqual(r.calls.at(-1).args.slice(-5), ['head', '-c', '11', '--', '/small'], 'reads one byte past the cap, never the whole file');
  await assert.rejects(client.readFile(box, '/big', { maxBytes: 10 }), (e) => e.code === 'E_TOO_LARGE');
  await assert.rejects(client.readFile(box, '/none', { maxBytes: 10 }), (e) => e.code === 'ENOENT');
  assert.equal(r.calls.at(-1).args[2], SANDBOX_USER);
});

test('writeFile sends the bytes on stdin and makes the parents, with no bind mount (real files through the fake)', POSIX, async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner, { resources: {} });
  const h = await client.create({ environment: 'acme/tools:1', tags: { worca: '1' }, timeoutMs: 60_000 });
  const p = `${h.pathPrefix}/tmp/a b/c/d.bin`;
  const data = Buffer.from([0, 1, 2, 255, 10, 13]);
  await client.writeFile(h.box, p, data);
  assert.deepEqual(readFileSync(p), data);
  assert.deepEqual(await client.readFile(h.box, p, { maxBytes: 100 }), data);
  const w = fake.calls.find((c) => c[0] === 'exec' && c.includes('worca-write'));
  assert.ok(w.includes('-i') && w.includes(SANDBOX_USER));
  await client.remove(h.id);
});

test('setTimeout moves the deadline as the watchdog user; list, info, connect, countRunning and remove go by labels and name', async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner, { resources: {} });
  const h = await client.create({ environment: 'acme/tools:1', tags: { worca: '1', worcaInstance: 'i1', worcaRunId: 'r9' }, timeoutMs: 60_000 });
  const other = await client.create({ environment: 'acme/tools:1', tags: { worca: '1', worcaInstance: 'i2', worcaRunId: 'r8' }, timeoutMs: 60_000 });
  await client.setTimeout(h.box, 90_500);
  const call = fake.calls.findLast((c) => c.includes('worca-deadline'));
  assert.ok(call.includes(HELPER_USER));
  assert.deepEqual(call.slice(-5), ['-c', DEADLINE_SCRIPT, 'worca-deadline', `${h.pathPrefix}${DEADLINE_FILE}`, '91']);
  const t = Number(readFileSync(`${h.pathPrefix}${DEADLINE_FILE}`, 'utf8'));
  assert.ok(Math.abs(t - (Math.floor(Date.now() / 1000) + 91)) <= 2, String(t));
  assert.deepEqual((await client.list({ worca: '1', worcaInstance: 'i1' })).map((x) => x.id), [h.id]);
  assert.deepEqual((await client.list({ worca: '1', worcaInstance: 'i1' }))[0].tags, { worca: '1', worcaInstance: 'i1', worcaRunId: 'r9' });
  assert.deepEqual((await client.info(h.id)).tags.worcaRunId, 'r9');
  assert.equal((await client.connect(h.id)).id, h.id);
  assert.equal(await client.countRunning(), 2);
  assert.equal(await client.remove(h.id), true);
  assert.equal(await client.remove(h.id), false, 'removing twice is not an error');
  await assert.rejects(client.info(h.id), (e) => client.classifyError(e) === 'gone');
  await assert.rejects(client.connect(h.id), (e) => client.classifyError(e) === 'gone');
  await assert.rejects(client.run(h.box, 'true'), (e) => client.classifyError(e) === 'gone');
  assert.equal(await client.countRunning(), 1);
  await client.remove(other.id);
});

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 5000) => { const t0 = Date.now(); while (!fn()) { if (Date.now() - t0 > ms) return false; await new Promise((r) => setTimeout(r, 50)); } return true; };

test('kill() ends the command and its children INSIDE the container; stopping only the host side does not', POSIX, async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner, { resources: {} });
  const h = await client.create({ environment: 'acme/tools:1', tags: { worca: '1' }, timeoutMs: 60_000 });
  const pids = join(h.pathPrefix, 'tmp');
  // A command with a child, a grandchild in its own process group, and a foreground sleep.
  const cmd = (tag) => `echo $$ > ${pids}/${tag}-g; sleep 300 & echo $! > ${pids}/${tag}-a; (set -m; sleep 301 & echo $! > ${pids}/${tag}-b; wait) & sleep 302`;
  const read = (f) => Number(readFileSync(join(pids, f), 'utf8'));
  const started = (tag) => until(() => existsSync(join(pids, `${tag}-a`)) && existsSync(join(pids, `${tag}-b`)));

  // The control: killing the host-side `docker exec` (what a naive kill does) leaves the command running.
  const naive = await client.run(h.box, cmd('n'), { background: true });
  assert.ok(await started('n'));
  const execs = [...fake.containers.get(h.id).children];
  for (const c of execs) c.kill('SIGKILL');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(alive(read('n-a')) && alive(read('n-b')), 'the processes outlive the host side');
  await naive.kill();

  const handle = await client.run(h.box, cmd('k'), { background: true });
  assert.ok(await started('k'));
  const [a, b] = [read('k-a'), read('k-b')];
  assert.ok(alive(a) && alive(b));
  assert.equal(await handle.kill(), true);
  assert.ok(await until(() => !alive(a) && !alive(b)), 'kill() ended the child and the grandchild in its own group');
  await assert.rejects(handle.wait(), (e) => e.exitCode === 137);
  const k = fake.calls.find((c) => c.includes('worca-kill'));
  assert.ok(k.includes(SANDBOX_USER), 'the kill runs as the command\'s own user');
  // Its wrapper was already gone, so only the token in the environment finds what it left (Linux's /proc: a real
  // container always has it; the fake on macOS does not).
  if (existsSync('/proc/self')) assert.ok(await until(() => !alive(read('n-a')) && !alive(read('n-b'))), 'the naive one is gone after its own kill()');
  for (const p of [-read('n-g'), read('n-b')]) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
  await client.remove(h.id);
});

test('a foreground timeout kills the command inside the container and rejects with exit 124', POSIX, async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner, { resources: {} });
  const h = await client.create({ environment: 'acme/tools:1', tags: { worca: '1' }, timeoutMs: 60_000 });
  const f = join(h.pathPrefix, 'tmp', 'p');
  await assert.rejects(client.run(h.box, `sleep 300 & echo $! > ${f}; wait`, { timeoutMs: 400 }), (e) => e.exitCode === 124 && /timed out/.test(e.message));
  assert.ok(await until(() => !alive(Number(readFileSync(f, 'utf8')))));
  await client.remove(h.id);
});

test('stdin: true keeps stdin open (the model relay) and keeps none of its output', POSIX, async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner, { resources: {} });
  const h = await client.create({ environment: 'acme/tools:1', tags: { worca: '1' }, timeoutMs: 60_000 });
  const got = [];
  const handle = await client.run(h.box, 'while read -r l; do echo "echo:$l"; [ "$l" = end ] && exit 0; done', { background: true, stdin: true, onStdout: (d) => got.push(d) });
  await handle.sendStdin('one\n'); await handle.sendStdin('end\n');
  const r = await handle.wait();
  assert.equal(r.exitCode, 0);
  assert.equal(got.join(''), 'echo:one\necho:end\n');
  assert.equal(r.stdout, '', 'a relay\'s bodies are not kept');
  await client.remove(h.id);
});

test('the watchdog ends at its deadline, and a new deadline keeps it alive', POSIX, async () => {
  const d = tmp();
  const f = join(d, 'deadline');
  const wd = spawn('sh', ['-c', WATCHDOG_SCRIPT, 'worca-watchdog', f, '2', '0.2'], { stdio: 'ignore' });
  let exited = false; wd.on('exit', () => { exited = true; });
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(existsSync(f));
  // The heartbeat: push the deadline out twice; the watchdog must still be up after the first one would have hit.
  execFileSync('sh', ['-c', DEADLINE_SCRIPT, 'worca-deadline', f, '6']);
  await new Promise((r) => setTimeout(r, 3000));
  assert.equal(exited, false, 'extended');
  execFileSync('sh', ['-c', DEADLINE_SCRIPT, 'worca-deadline', f, '1']);
  assert.ok(await until(() => exited, 5000), 'ended at the deadline');
  // A deadline file that is missing or garbled ends it at once (nothing to extend).
  const wd2 = spawn('sh', ['-c', WATCHDOG_SCRIPT, 'worca-watchdog', f, '100', '0.2'], { stdio: 'ignore' });
  let e2 = false; wd2.on('exit', () => { e2 = true; });
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(f, 'x');
  assert.ok(await until(() => e2, 3000));
});


test('mkdirsScript hands new dirs over without following a link (chown -h)', () => {
  assert.match(mkdirsScript(['/a/b']), /chown -h user:user "\$p"/);
});

test('preflight: docker present and reachable, the model credential on the server, the generic guards; mock skips Docker', () => {
  const probe = (state) => () => (state === 'up' ? { state, version: '27' } : state === 'down' ? { state, error: 'Cannot connect' } : { state });
  const env = { CLAUDE_CODE_OAUTH_TOKEN: 't' };
  assert.deepEqual(dockerPreflight({ engine: 'claude', env, probe: probe('up') }).errors, []);
  assert.deepEqual(dockerPreflight({ engine: 'claude', env, probe: probe('missing') }).errors, [DOCKER_MISSING]);
  assert.match(dockerPreflight({ engine: 'claude', env, probe: probe('down') }).errors[0], /^Docker is not running: `docker version` could not reach the Docker daemon \(Cannot connect\)/);
  assert.match(dockerPreflight({ engine: 'claude', env: {}, probe: probe('up') }).errors.join(' '), /CLAUDE_CODE_OAUTH_TOKEN/);
  assert.deepEqual(dockerPreflight({ engine: 'claude', env: {}, probe: probe('up'), brokerOn: true }).errors, []);
  assert.match(dockerPreflight({ engine: 'gemini', env, probe: probe('up') }).errors.join(' '), /^Docker execution runs the claude, codex, copilot and cursor engines only/);
  assert.match(dockerPreflight({ isWorkspace: true, env, probe: probe('up') }).errors.join(' '), /single-project runs only/);
  assert.match(dockerPreflight({ platform: 'win32', env, probe: probe('up') }).errors.join(' '), /macOS or Linux/);
  assert.deepEqual(dockerPreflight({ mock: true, env: {}, probe: () => { throw new Error('not called'); } }).errors, []);
  // The probe: a missing CLI, a daemon that does not answer, one that does; cached.
  _resetDockerProbeForTests();
  let n = 0;
  const sp = (answer) => () => { n++; return answer; };
  assert.deepEqual(dockerProbe({ WORCA_DOCKER_BIN: 'd1' }, { spawn: sp({ error: { code: 'ENOENT' } }) }), { state: 'missing' });
  assert.deepEqual(dockerProbe({ WORCA_DOCKER_BIN: 'd2' }, { spawn: sp({ status: 1, stdout: '', stderr: 'Cannot connect to the Docker daemon\n' }) }), { state: 'down', error: 'Cannot connect to the Docker daemon' });
  assert.deepEqual(dockerProbe({ WORCA_DOCKER_BIN: 'd3' }, { spawn: sp({ status: 0, stdout: '27.3.1\n' }) }), { state: 'up', version: '27.3.1' });
  dockerProbe({ WORCA_DOCKER_BIN: 'd3' }, { spawn: sp({ status: 1 }) });
  assert.equal(n, 3, 'cached');
  _resetDockerProbeForTests();
});

test('resolveEnvironment: project setting, then the build, then WORCA_DOCKER_IMAGE, then the default image', () => {
  const r = (o) => dockerBackend.resolveEnvironment(o);
  assert.deepEqual(r({ config: { image: 'acme/a:1' }, build: { name: 'b' }, env: { WORCA_DOCKER_IMAGE: 'acme/e:1' } }), { name: 'acme/a:1', source: 'project', from: 'the project setting' });
  assert.equal(r({ config: {}, build: { name: 'worca-local-sandbox-p-12345678' }, env: { WORCA_DOCKER_IMAGE: 'acme/e:1' } }).source, 'build');
  assert.deepEqual(r({ config: {}, build: null, env: { WORCA_DOCKER_IMAGE: 'acme/e:1' } }), { name: 'acme/e:1', source: 'env', from: 'WORCA_DOCKER_IMAGE' });
  assert.deepEqual(r({ config: {}, build: null, env: { WORCA_DOCKER_IMAGE: '--privileged' } }), { name: defaultImageName(), source: 'default', from: 'the default' });
  const img = dockerBackend.projectFields.find((f) => f.key === 'image');
  for (const ok of ['acme/tools', 'acme/tools:1.2', 'registry.acme.example:5000/team/tools:v1', `acme/t@sha256:${'a'.repeat(64)}`]) assert.ok(img.validate(ok), ok);
  for (const bad of ['-x', 'ACME/Tools', 'a b', 'a;rm', '']) assert.ok(!img.validate(bad), bad);
  assert.equal(dockerBackend.environmentName('acme-12345678'), 'worca-local-sandbox-acme-12345678');
});

test('network: open is null; allow is WORCA_EGRESS_ALLOW (or the default list) minus WORCA_EGRESS_DENY', () => {
  assert.equal(dockerNetwork({ config: {}, env: {} }), null);
  assert.equal(dockerNetwork({ config: { egress: 'open' }, env: {} }), null);
  assert.deepEqual(dockerNetwork({ config: { egress: 'allow' }, env: {} }).allowOut, ['api.anthropic.com', 'github.com', '.github.com', '.githubusercontent.com', 'registry.npmjs.org']);
  const n = dockerNetwork({ config: { egress: 'allow' }, env: { WORCA_EGRESS_ALLOW: 'a.acme.example,.acme.example,b.acme.example', WORCA_EGRESS_DENY: 'b.acme.example,.invalid' } });
  assert.deepEqual(n, { allowOut: ['a.acme.example', '.acme.example'], denyOut: ['b.acme.example'] });
  assert.match(dockerBackend.networkHelp, /raw socket reaches nothing/);
});

test('settings: dockerSandbox memory, cpus, pids and runtime are checked; build proxies never carry a login or loopback', () => {
  assert.deepEqual(sandboxResources(undefined), { resources: { memory: '4g', cpus: 2, pids: 2048, runtime: null }, warnings: [] });
  assert.deepEqual(sandboxResources({ memory: '8G', cpus: 4, pids: 4096, runtime: 'runsc' }).resources, { memory: '8g', cpus: 4, pids: 4096, runtime: 'runsc' });
  const bad = sandboxResources({ memory: '100m', cpus: 0, pids: 1.5, runtime: 'runsc --privileged' });
  assert.deepEqual(bad.resources, { memory: '4g', cpus: 2, pids: 2048, runtime: null });
  assert.equal(bad.warnings.length, 4);
  assert.deepEqual(buildProxyArgs({ HTTPS_PROXY: 'http://proxy.acme.example:8080', HTTP_PROXY: 'http://u:p@proxy.acme.example:8080', https_proxy: 'http://127.0.0.1:3128', NO_PROXY: '.acme.example' }),
    ['--build-arg', 'HTTPS_PROXY=http://proxy.acme.example:8080', '--build-arg', 'NO_PROXY=.acme.example']);
});

test('buildEnvironment builds the project image with `docker build -` and records its id', async () => {
  const fake = createFakeDocker({ root: tmp() });
  const client = dockerClient(fake.runner);
  // A stored spec: the shared renderer (spec-dockerfile.mjs) refuses one whose hash does not match its content.
  const spec = normalizeEnvSpec({ tools: [{ name: 'node', version: '24.21.0' }], apt: ['libpq-dev'] });
  await assert.rejects(client.buildEnvironment({ ...spec, hash: `sha256:${'0'.repeat(64)}` }, { name: 'x' }), /not in its stored form/);
  const lines = [];
  const r = await client.buildEnvironment(spec, { name: 'worca-local-sandbox-acme-12345678', onLog: (l) => lines.push(l) });
  assert.equal(r.name, 'worca-local-sandbox-acme-12345678');
  assert.equal(r.specHash, spec.hash);
  assert.equal(r.baseVersion, dockerBackend.baseVersion());
  assert.match(r.buildId, /^[0-9a-f]{12}$/);
  assert.ok(lines.some((l) => /RUN apt-get update/.test(l)));
  const failing = dockerClient(createFakeDocker({ root: tmp(), failBuild: true }).runner);
  await assert.rejects(failing.buildEnvironment(spec, { name: 'x' }), /docker build of x failed: .*exit code: 1/);
});

test('status in mock mode counts the fake containers', async () => {
  const s = await dockerBackend.status({ mock: true });
  assert.equal(s.state, 'connected');
  assert.ok(Number.isInteger(s.running));
});

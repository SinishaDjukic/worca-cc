// src/core/exec-env/backends/docker-fake.mjs
// A stand-in for the `docker` CLI (mock mode, WORCA_MOCK=1, and the tests): the docker client (docker.mjs) runs
// unchanged against it. A "container" is a host directory exposed as the client's pathPrefix; `docker exec` runs the
// command with real bash on this machine. It is faithful where the client's guarantees live: an exec is its own host
// process in its own session, so killing the host side does NOT end what the command started (as on real Docker),
// and only the client's kill script does; a removed container answers "No such container" with exit 1; an unknown
// image fails `image inspect`. It has no network relay (`network: false`) and enforces no hardening: it records the
// `docker run` arguments, which the tests check.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, rmSync } from 'node:fs';
import { PassThrough } from 'node:stream';
import { delimiter, dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

// docker run / exec flags that take a value (the client's own argv shapes).
const VALUE_FLAGS = new Set(['--name', '--label', '--network', '--ipc', '--user', '-u', '--cap-drop', '--cap-add', '--security-opt',
  '--pids-limit', '--memory', '--memory-swap', '--cpus', '--ulimit', '--hostname', '--runtime', '-e', '--env', '--entrypoint',
  '--pull', '-w', '--workdir', '--filter', '--format', '--type', '-t', '--build-arg']);

/** A child-like object for a CLI call that runs no process: emits `stdout`/`stderr` and closes with `code`. */
function synthetic(code, stdout = '', stderr = '', { onStdin = null } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const chunks = [];
  child.stdin = new PassThrough();
  child.stdin.on('data', (d) => chunks.push(Buffer.from(d)));
  child.kill = () => true;
  const finish = (c, o, e) => setImmediate(() => {
    if (o) child.stdout.write(o);
    if (e) child.stderr.write(e);
    child.stdout.end(); child.stderr.end();
    setImmediate(() => child.emit('close', c, null));
  });
  if (onStdin) child.stdin.on('end', () => { const r = onStdin(Buffer.concat(chunks)); finish(r.code, r.stdout, r.stderr); });
  else finish(code, stdout, stderr);
  return child;
}

export function createFakeDocker({ root, failBuild = false, missingImages = false } = {}) {
  mkdirSync(root, { recursive: true });
  const containers = new Map();   // name -> { name, id, dir, labels, env, running, children: Set }
  const images = new Set();
  const runs = [];                // every `docker run` argv (the hardening tests read them)
  const calls = [];               // every argv
  const prefix = (name) => join(root, name);
  const noSuch = (n) => synthetic(1, '', `Error response from daemon: No such container: ${n}\n`);

  function parse(args) {
    const flags = []; let i = 0;
    for (; i < args.length; i++) {
      const a = args[i];
      if (!a.startsWith('-')) break;
      if (VALUE_FLAGS.has(a)) { flags.push([a, args[++i]]); continue; }
      flags.push([a, true]);
    }
    return { flags, rest: args.slice(i) };
  }
  const all = (flags, name) => flags.filter(([f]) => f === name).map(([, v]) => v);

  function exec(args, { env: cliEnv = {}, stdin = false } = {}) {
    const { flags, rest } = parse(args);
    const [name, file, ...argv] = rest;
    const ct = containers.get(name);
    if (!ct || !ct.running) return noSuch(name);
    const env = { PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH || ''}`, LANG: 'C', ...ct.env };
    for (const e of all(flags, '-e')) {
      const k = e.includes('=') ? e.slice(0, e.indexOf('=')) : e;
      const v = e.includes('=') ? e.slice(e.indexOf('=') + 1) : cliEnv[k];
      if (v === undefined) continue;
      env[k] = k === 'HOME' ? join(ct.dir, v) : v;
    }
    // Its own session: like a process inside a container, it outlives the host side being killed.
    const child = spawn(file, argv, { cwd: ct.dir, env, detached: true, stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    ct.children.add(child);
    child.on('close', () => ct.children.delete(child));
    return child;
  }

  function run(args) {
    runs.push([...args]);
    const { flags, rest } = parse(args.slice(1));
    const image = rest[0];
    if (missingImages && !images.has(image)) return synthetic(125, '', `Unable to find image '${image}' locally\n`);
    const name = all(flags, '--name')[0] || `fake-${randomBytes(4).toString('hex')}`;
    if (containers.has(name)) return synthetic(125, '', `Conflict. The container name "/${name}" is already in use\n`);
    const labels = {};
    for (const l of all(flags, '--label')) labels[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1);
    const env = {};
    for (const e of all(flags, '-e')) if (e.includes('=')) env[e.slice(0, e.indexOf('='))] = e.slice(e.indexOf('=') + 1);
    const dir = prefix(name);
    for (const d of ['home/user', 'run/worca', 'tmp']) mkdirSync(join(dir, d), { recursive: true });
    const id = randomBytes(32).toString('hex');
    containers.set(name, { name, id, dir, labels, env, running: true, children: new Set(), image });
    return synthetic(0, `${id}\n`);
  }

  function inspectOf(ct) {
    return { Id: ct.id, Name: `/${ct.name}`, State: { Running: ct.running, Status: ct.running ? 'running' : 'exited' }, Config: { Labels: { ...ct.labels }, Image: ct.image } };
  }

  function remove(name) {
    const ct = containers.get(name);
    if (!ct) return false;
    ct.running = false;
    for (const c of ct.children) { try { process.kill(-c.pid, 'SIGKILL'); } catch { try { c.kill('SIGKILL'); } catch { /* gone */ } } }
    containers.delete(name);
    rmSync(ct.dir, { recursive: true, force: true });
    return true;
  }

  function matches(ct, filters) {
    return filters.every((f) => {
      const m = /^label=([^=]+)=(.*)$/.exec(f);
      return m ? ct.labels[m[1]] === m[2] : true;
    });
  }

  const runner = {
    kind: 'fake', network: false,
    pathPrefix: (name) => prefix(name),
    spawn(args, opts = {}) {
      calls.push([...args]);
      const [verb, ...rest] = args;
      if (verb === 'exec') return exec(rest, opts);
      if (verb === 'run') return run(args);
      if (verb === 'rm') {
        const names = rest.filter((a) => !a.startsWith('-'));
        const missing = names.filter((n) => !remove(n));
        return missing.length ? synthetic(1, '', missing.map((n) => `Error response from daemon: No such container: ${n}\n`).join('')) : synthetic(0, `${names.join('\n')}\n`);
      }
      if (verb === 'inspect') {
        const { flags, rest: names } = parse(rest);
        const fmt = all(flags, '--format')[0];
        const found = names.map((n) => containers.get(n)).filter(Boolean);
        const err = names.filter((n) => !containers.has(n)).map((n) => `Error: No such object: ${n}\n`).join('');
        const code = err ? 1 : 0;
        if (fmt === '{{.State.Running}}') return synthetic(code, found.map((c) => `${c.running}\n`).join(''), err);
        return synthetic(code, JSON.stringify(found.map(inspectOf)), err);
      }
      if (verb === 'ps') {
        const { flags } = parse(rest);
        const running = !flags.some(([f]) => f === '-a');
        const list = [...containers.values()].filter((c) => (!running || c.running) && matches(c, all(flags, '--filter')));
        const byName = all(flags, '--format')[0] === '{{.Names}}';
        return synthetic(0, list.map((c) => `${byName ? c.name : c.id.slice(0, 12)}\n`).join(''));
      }
      if (verb === 'image' && rest[0] === 'inspect') {
        const name = rest.at(-1);
        return images.has(name) || !missingImages ? synthetic(0, `sha256:${Buffer.from(name).toString('hex').padEnd(64, '0').slice(0, 64)}\n`)
          : synthetic(1, '', `Error response from daemon: No such image: ${name}\n`);
      }
      if (verb === 'build') {
        const { flags } = parse(rest);
        const name = all(flags, '-t')[0];
        return synthetic(0, '', '', { onStdin: (df) => {
          if (failBuild) return { code: 1, stderr: '#5 ERROR: process "/bin/sh -c false" did not complete successfully: exit code: 1\n' };
          images.add(name);
          return { code: 0, stderr: `#1 [internal] load build definition from Dockerfile\n#5 [2/9] RUN apt-get update\n#9 naming to docker.io/library/${name} done\n`, stdout: '', dockerfile: df };
        } });
      }
      if (verb === 'version') return synthetic(0, '27.0.0-fake\n');
      return synthetic(1, '', `fake docker: unsupported command ${verb}\n`);
    },
  };
  return { runner, containers, images, runs, calls, remove };
}

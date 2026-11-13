// test/helpers/loopback-worker-session.mjs
// A worker session that runs its execs as local children of the test process, with the same
// handler contract remote-child.mjs expects of a real session: what a worker does on the far
// side of the socket, minus the socket. Lets the executor seam run end to end in one process.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function createLoopbackSession({ workerId = 'w-loopback', capabilities = null } = {}) {
  const live = new Map();   // exec id -> { child, handlers }
  let n = 0;
  const session = {
    workerId,
    capabilities,   // what a real worker's hello carries ({ engines: { claude: { bin, version } | null, … } }); null = unknown
    specs: [],      // every exec spec received, in order
    signals: [],    // every [id, sig] received
    exec(spec, h) {
      const id = `${workerId}-x${++n}`;
      session.specs.push(spec);
      let child;
      try {
        child = spawn(spec.file, spec.args, {
          cwd: spec.cwd, env: spec.env, windowsHide: true,
          stdio: [spec.stdin != null ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          detached: spec.detached !== false && process.platform !== 'win32',
        });
      } catch (err) {
        queueMicrotask(() => h.onSpawnError({ code: err.code ?? null, message: err.message }));
        return id;
      }
      live.set(id, { child, handlers: h });
      child.on('spawn', () => h.onStarted({ pid: child.pid }));
      child.on('error', (err) => { live.delete(id); h.onSpawnError({ code: err.code ?? null, message: err.message }); });
      for (const [stream, input] of [['out', child.stdout], ['err', child.stderr]]) {
        createInterface({ input }).on('line', (line) => h.onLines({ stream, lines: [line] }));
      }
      child.on('close', (code, signal) => {
        if (!live.has(id)) return;
        live.delete(id);
        h.onExit({ code, signal });
      });
      if (spec.stdin != null) { child.stdin.on('error', () => {}); child.stdin.end(spec.stdin, 'utf8'); }
      return id;
    },
    signal(id, sig) {
      session.signals.push([id, sig]);
      const e = live.get(id);
      if (!e) return;
      try { process.kill(-e.child.pid, sig); } catch { try { e.child.kill(sig); } catch { /* gone */ } }
    },
    /** Simulate the worker going away: every live exec is lost (its child is killed, nothing more is reported). */
    lose(why = 'socket closed') {
      for (const [id, e] of live) {
        live.delete(id);
        try { process.kill(-e.child.pid, 'SIGKILL'); } catch { try { e.child.kill('SIGKILL'); } catch { /* gone */ } }
        e.handlers.onLost(why);
      }
    },
    get liveCount() { return live.size; },
  };
  return session;
}

/** A registry whose acquire hands out one loopback session (or rejects), recording the scopes asked for,
 *  the releases and the touches. */
export function createLoopbackRegistry({ session = createLoopbackSession(), fail = null } = {}) {
  const acquired = [];
  const asked = [];      // per acquire: { engine } — what the spawn named
  const released = [];
  const touched = [];
  return {
    session,
    acquired,
    asked,
    released,
    touched,
    async acquire(scope, { engine = null } = {}) {
      acquired.push(scope);
      asked.push({ engine });
      if (fail) throw fail;
      return session;
    },
    async release(scope, { reason } = {}) { released.push({ scope, reason }); return acquired.length > 0; },
    touch(scope) { touched.push(scope); },
  };
}

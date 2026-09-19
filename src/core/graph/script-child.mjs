// src/core/graph/script-child.mjs
// The `node` runtime harness (spec §5.1, D24). Spawned as
//   process.execPath script-child.mjs <program.mjs>
// with the envelope on stdin. Imports NOTHING from worca: it runs with
// WORCA_HOME stripped, so any store import would resolve the wrong home.
// Protocol: read ONE JSON envelope, import the program, call its default export
// with the api, write ONE JSON frame to stdout, exit 0. stdout is protocol-
// reserved, so console.* is routed to stderr (the run log). The child ALWAYS
// exits 0 after a frame; a non-zero exit means "crashed before the frame" and
// the parent reports "no result frame (exit N)".
import { pathToFileURL } from 'node:url';

// The REAL writers, bound before the program is imported: the exit flush below
// must not call a `process.stderr.write` the user's program replaced (muting a
// noisy dependency is a one-liner, and console.* rides stderr here) — that call
// waits for a callback the program controls, and the setInterval below holds the
// loop open, so the parent's timeout kill was the only way out.
const outWrite = process.stdout.write.bind(process.stdout);
const errWrite = process.stderr.write.bind(process.stderr);
const logs = [];
for (const m of ['log', 'info', 'warn', 'error', 'debug']) {
  console[m] = (...a) => { process.stderr.write(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n'); };
}

async function main() {
  process.stdin.setEncoding('utf8');
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  const envelope = JSON.parse(raw);
  const file = process.argv[2];
  if (!file) throw new Error('script-child: no program file argument');
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default !== 'function') throw new Error(`script module has no default-export function: ${file}`);
  const api = {
    inputs: envelope.inputs || {},
    outputs: envelope.outputs || {},
    params: envelope.params || {},
    ctx: envelope.ctx || {},
    verdictPath: envelope.verdictPath ?? null,
    node: envelope.node || {},
    execution: envelope.execution || {},
    log: (level, msg) => { logs.push({ level: String(level), msg: String(msg) }); },
  };
  const result = await mod.default(api);
  const r = result && typeof result === 'object' ? result : {};
  const frame = { ok: true, logs };
  if (r.outputs && typeof r.outputs === 'object') frame.outputs = r.outputs;
  if (r.verdict !== undefined) frame.verdict = r.verdict;
  if (typeof r.summary === 'string') frame.summary = r.summary;
  return frame;
}

// A pending promise alone does not keep the event loop alive: a hung script with
// no live handles would exit 0 with NO frame. Hold the loop open so a hung script
// stays hung and the parent's timeout kill is the only way out.
setInterval(() => {}, 1 << 30);

main()
  .catch((err) => ({ ok: false, error: { message: err?.message || String(err), stack: err?.stack || '' }, logs }))
  .then((frame) => {
    let text;
    try { text = JSON.stringify(frame); } catch (err) {
      text = JSON.stringify({ ok: false, error: { message: `frame is not serializable: ${err?.message || err}` }, logs });
    }
    // BOTH pipes before the exit. console.* rides STDERR, which is asynchronous on
    // a macOS pipe: exiting on the stdout callback alone discarded every line still
    // queued there, so a chatty script silently lost most of its live output
    // whenever the host drained slower than the child wrote it.
    // BOUNDED, and through the writers captured above: a program that muted or
    // corked stderr never fires the flush callback, and the flush may never
    // outlive the frame it is flushing.
    // The bound is armed FROM the stdout callback, never beside the write: stdout
    // is a pipe with a 64 KiB kernel buffer, so a frame bigger than that waits for
    // the parent to read it — a timer racing the write exits mid-frame whenever the
    // parent's loop is blocked longer than the bound, and the parent then reports
    // `no result frame (exit 0)` for a run that produced one. The bound belongs to
    // the STDERR flush, which is the only part the user's program can stall.
    let exited = false;
    const bye = () => { if (!exited) { exited = true; process.exit(0); } };
    outWrite(text, () => { setTimeout(bye, 1000); errWrite('', bye); });
  });

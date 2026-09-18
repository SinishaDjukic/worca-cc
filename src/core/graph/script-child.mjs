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

const out = process.stdout;
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
    out.write(text, () => process.exit(0));   // write-callback before exit so a piped stdout is fully flushed
  });

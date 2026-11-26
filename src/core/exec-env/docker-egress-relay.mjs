// src/core/exec-env/docker-egress-relay.mjs
// The in-sandbox half of the Local sandbox (Docker) network relay (docs/local-sandbox.md "Network"). The container has
// no network at all (`--network none`); this listens on 127.0.0.1:<port> inside it, where HTTPS_PROXY points, and
// carries each accepted connection over its own stdin/stdout to Worca on the host, which applies the project's network
// policy and dials out (backends/docker-egress.mjs). It decides nothing: whatever it sends, the host checks.
// Node built-ins only: Worca uploads this one file into each container (/run/worca) and runs it as uid 990, so the
// agents (uid 1000) can neither stop it nor read its memory.
//
// Frames are JSON lines. To the host: {ready: port}, {o: id} opened, {d: id, b: base64} data, {e: id} the agent's side
// ended, {c: id} closed, {p: id} / {r: id} pause / resume the host side of id. From the host: d, e, c, p and r for id.
import net from 'node:net';

const port = Number(process.argv[2]) || 0;
const MAX_CONNS = 256;
const MAX_LINE = 8 * 1024 * 1024;
const MAX_PENDING = 16 * 1024 * 1024;   // bytes queued to one agent socket before the host is asked to pause

const conns = new Map();
let seq = 0; let stalled = false;

function send(frame) {
  if (process.stdout.write(`${JSON.stringify(frame)}\n`)) return;
  if (stalled) return;
  stalled = true;
  for (const s of conns.values()) s.pause();
  process.stdout.once('drain', () => { stalled = false; for (const s of conns.values()) if (!s.held) s.resume(); });
}

const server = net.createServer({ allowHalfOpen: true }, (s) => {
  if (conns.size >= MAX_CONNS) { s.destroy(); return; }
  const id = ++seq;
  s.held = false;
  conns.set(id, s);
  send({ o: id });
  if (stalled) s.pause();
  s.on('data', (b) => send({ d: id, b: b.toString('base64') }));
  s.on('end', () => send({ e: id }));
  s.on('drain', () => send({ r: id }));
  s.on('error', () => {});
  s.on('close', () => { if (conns.delete(id)) send({ c: id }); });
});
server.on('error', (err) => { process.stderr.write(`egress relay: ${err.message}\n`); process.exit(2); });
server.listen(port, '127.0.0.1', () => send({ ready: server.address().port }));

function onFrame(f) {
  const id = f.d ?? f.e ?? f.c ?? f.p ?? f.r;
  const s = conns.get(id);
  if (!s) return;
  if (f.d !== undefined) {
    if (typeof f.b !== 'string') return;
    s.write(Buffer.from(f.b, 'base64'));
    if (s.writableLength > MAX_PENDING) send({ p: id });
  } else if (f.e !== undefined) s.end();
  else if (f.c !== undefined) { conns.delete(id); s.destroy(); }
  else if (f.p !== undefined) { s.held = true; s.pause(); }
  else if (f.r !== undefined) { s.held = false; if (!stalled) s.resume(); }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    let f; try { f = JSON.parse(line); } catch { continue; }
    if (f && typeof f === 'object') onFrame(f);
  }
  if (buf.length > MAX_LINE) { process.stderr.write('egress relay: a frame from the host is too long\n'); process.exit(3); }
});
// The host went away (Worca stopped, or the exec stream dropped): nothing can be relayed any more.
process.stdin.on('end', () => process.exit(0));

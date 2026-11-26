// src/core/exec-env/sandbox-relay.mjs
// The in-sandbox half of the model relay (plans/model-relay-design.md §3). Worca uploads this file and
// runs `node <this> [maxBodyBytes] [port]` with stdin open. It listens on 127.0.0.1 (port 0 picks one; a restart
// passes the first one, which spawn envs already name), turns each HTTP request into one JSON line on stdout
// and replays worca's answer frames from stdin. It holds no
// credential and decides nothing: worca (model-relay.mjs) answers every request, the probe included.
// node:* imports only — this runs on whatever Node the sandbox image has.
//
// stdout: {t:'ready', port} | {t:'req', id, method, path, headers, b64, over?} | {t:'close', id}
// stdin:  {t:'head', id, status, headers} | {t:'data', id, b64} | {t:'end', id, error?}
import http from 'node:http';
import readline from 'node:readline';

// Past this many body bytes the body is dropped and the frame says `over` (worca answers 413); it only keeps
// one oversized request from becoming one oversized line.
const MAX_BODY = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 32 << 20;
const PORT = Number.isInteger(Number(process.argv[3])) && Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 0;
const pending = new Map();
let next = 1;
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  let f; try { f = JSON.parse(line); } catch { return; }
  const res = pending.get(f?.id); if (!res) return;
  try {
    if (f.t === 'head') res.writeHead(f.status, f.headers || {});
    else if (f.t === 'data') res.write(Buffer.from(String(f.b64 || ''), 'base64'));
    else if (f.t === 'end') { pending.delete(f.id); if (f.error) res.destroy(); else res.end(); }
  } catch { pending.delete(f.id); res.destroy(); }
}).on('close', () => process.exit(0));   // worca's channel is gone: nothing can answer any more

const server = http.createServer((req, res) => {
  const id = next++;
  const chunks = []; let n = 0; let over = false;
  req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { over = true; chunks.length = 0; } else chunks.push(c); });
  req.on('end', () => {
    pending.set(id, res);
    // The client hung up before worca finished: tell worca, so it stops forwarding (it reads the upstream on, to book it).
    res.on('close', () => { if (pending.delete(id)) out({ t: 'close', id }); });
    out({ t: 'req', id, method: req.method, path: req.url, headers: req.headers,
      b64: over ? '' : Buffer.concat(chunks).toString('base64'), ...(over ? { over: true } : {}) });
  });
});
// A port that cannot be bound ends the relay before `ready`: worca fails the start, never picks another port.
server.on('error', (err) => { process.stderr.write(`cannot listen on 127.0.0.1:${PORT}: ${err.code || err.message}\n`); process.exit(1); });
server.listen(PORT, '127.0.0.1', () => out({ t: 'ready', port: server.address().port }));

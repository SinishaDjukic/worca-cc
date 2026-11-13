// tools/k8s-auth/ws-check.mjs — open worca's WebSocket (/ws) through oauth2-proxy, for
// `node tools/k8s-smoke.mjs --auth`. Runs inside the cluster like login.mjs:
//
//   node - <proxy base URL> [<Cookie header>]
//
// Prints the HTTP status of the upgrade: 101 when the proxy and worca both admit it.
import http from 'node:http';
import { randomBytes } from 'node:crypto';

const [base, cookie = ''] = process.argv.slice(2);
const u = new URL('/ws', base);
const req = http.request({
  host: u.hostname, port: u.port, path: u.pathname, method: 'GET',
  headers: {
    connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13',
    'sec-websocket-key': randomBytes(16).toString('base64'), origin: base, ...(cookie ? { cookie } : {}),
  },
});
const done = (status) => { console.log(String(status)); process.exit(0); };
req.on('upgrade', (res, socket) => { socket.destroy(); done(res.statusCode); });
req.on('response', (res) => { res.resume(); done(res.statusCode); });
req.on('error', (err) => done(`error ${err.message}`));
req.setTimeout(15000, () => done('timeout'));
req.end();

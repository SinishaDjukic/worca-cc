// test/helpers/fake-upstream-proxy.mjs — a corporate proxy for the tests: raw net, so one socket
// carries several heads (http.createServer detaches a CONNECT socket). It speaks NTLM (verifying
// the Type 3 against the known password) or Basic, counts sockets and credential headers, tunnels
// every accepted CONNECT to `origin` (whatever host was asked) and answers plain requests itself.
import net from 'node:net';
import { createHmac, randomBytes } from 'node:crypto';
import { ntHash, ntowfv2, parseType3 } from '../../src/core/ntlm.mjs';

/**
 * @param {{scheme?: 'ntlm'|'basic'|'none', offer?: string[]|null, user?: string, domain?: string, password?: string,
 *   originPort: number, closeOn407?: boolean, silent?: boolean, headNoBody407?: boolean,
 *   afterType3?: null|'close'|'silent', status?: number, statusChallenge?: boolean}} opts
 *   headNoBody407 (default true): a 407 to HEAD declares Content-Length but sends no body, as
 *   RFC 9110 and Squid do; false sends the body anyway (a non-compliant proxy).
 *   afterType3: 'close' destroys the socket right after reading a Type 3, 'silent' never answers it.
 *   status: the status for an accepted request (default 200), for the 5xx tests; 101 answers a
 *   real Switching Protocols (with Upgrade), whatever the request asked.
 *   statusChallenge: that non-200 answer also carries `Proxy-Authenticate: NTLM` (the ambiguous case).
 *   rejectDelayMs: delay before the 407 that refuses wrong credentials (a slow proxy, for the client-abort tests).
 *   holdType3: count each Type 3 in stats.type3 on arrival, then park its answer until release()
 *   (the stale-handshake and single-flight tests); release() sends what would have been sent.
 */
export async function startFakeUpstream({ scheme = 'ntlm', offer = null, user = 'User', domain = 'Domain',
  password = 'Password', originPort, closeOn407 = false, silent = false, headNoBody407 = true,
  afterType3 = null, status = 200, statusChallenge = false, rejectDelayMs = 0, holdType3 = false } = {}) {
  const stats = { sockets: 0, type1: 0, type3: 0, basic: 0, heads: [], authHeaders: [] };
  const sockets = new Set();
  const held = [];
  const want = Buffer.from(`${domain}\\${user}:${password}`).toString('base64');
  const server = net.createServer((sock) => {
    const id = ++stats.sockets;
    sockets.add(sock);
    sock.on('close', () => sockets.delete(sock));
    sock.on('error', () => {});   // ECONNRESET (Windows) or EPIPE (Linux) when a test drops a socket
    let buf = Buffer.alloc(0);
    let challenge = null;
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const end = buf.indexOf('\r\n\r\n');
        if (end < 0) return;
        const [line, ...rest] = buf.subarray(0, end).toString('latin1').split('\r\n');
        const headers = Object.fromEntries(rest.map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
        const len = Number(headers['content-length'] || 0);
        if (buf.length < end + 4 + len) return;
        buf = buf.subarray(end + 4 + len);
        stats.heads.push({ socket: id, line, headers });
        if (silent) return;
        const [method, target] = line.split(' ');
        const authz = headers['proxy-authorization'] || '';
        if (authz) stats.authHeaders.push(authz);
        const reply407 = (h) => {
          const body = 'auth required';
          const sendBody = !(method === 'HEAD' && headNoBody407);
          // One write: head and (optional) body leave in the same packet, like a real proxy.
          sock.write(`HTTP/1.1 407 Proxy Authentication Required\r\n${h}Content-Length: ${body.length}\r\n${closeOn407 ? 'Connection: close\r\n' : ''}\r\n${sendBody ? body : ''}`);
          if (closeOn407) sock.end();
        };
        const refuse = (h) => setTimeout(() => { reply407(h); sock.end(); }, rejectDelayMs);
        const offers = offer || (scheme === 'ntlm' ? ['NTLM'] : ['Basic realm="ACME"']);
        let ok = false;
        if (scheme === 'none') ok = true;
        else if (scheme === 'basic' && authz.startsWith('Basic ')) { stats.basic += 1; ok = authz.slice(6) === want; if (!ok) { refuse('Proxy-Authenticate: Basic realm="ACME"\r\n'); return; } }
        else if (scheme === 'ntlm' && authz.startsWith('NTLM ')) {
          const msg = Buffer.from(authz.slice(5), 'base64');
          if (msg.readUInt32LE(8) === 1) {
            stats.type1 += 1;
            challenge = randomBytes(8);
            reply407(`Proxy-Authenticate: NTLM ${type2For(challenge).toString('base64')}\r\n`);
            continue;
          }
          stats.type3 += 1;
          if (afterType3 === 'close') { sock.destroy(); return; }
          if (afterType3 === 'silent') { sock.off('data', onData); return; }
          const t3 = parseType3(msg);
          const ntowf = ntowfv2(ntHash(password), t3.user, t3.domain);
          const proof = createHmac('md5', ntowf).update(Buffer.concat([challenge, t3.ntChallengeResponse.subarray(16)])).digest();
          ok = !!challenge && proof.equals(t3.ntChallengeResponse.subarray(0, 16)) && t3.user === user;
          if (holdType3) {
            sock.off('data', onData);
            const verdict = ok;
            held.push(() => {
              if (!verdict) { refuse('Proxy-Authenticate: NTLM\r\n'); return; }
              if (answer(method, target) === 'continue') { sock.on('data', onData); onData(Buffer.alloc(0)); }
            });
            return;
          }
          if (!ok) { refuse('Proxy-Authenticate: NTLM\r\n'); return; }
        }
        if (!ok) { reply407(offers.map((o) => `Proxy-Authenticate: ${o}\r\n`).join('')); continue; }
        if (answer(method, target) === 'continue') continue;
        return;
      }
    };
    /** The answer to an accepted request: 'continue' reads the next head, 'return' hands the socket over. */
    function answer(method, target) {
      if (status !== 200) {
        const body = `upstream says ${status}`;
        if (status === 101) { sock.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'); return 'continue'; }
        sock.write(`HTTP/1.1 ${status} Upstream Error\r\n${statusChallenge ? 'Proxy-Authenticate: NTLM\r\n' : ''}Content-Length: ${body.length}\r\n\r\n${body}`);
        return 'continue';
      }
      if (method === 'CONNECT') {
        sock.off('data', onData);
        const o = net.connect(originPort, '127.0.0.1', () => {
          sock.write('HTTP/1.1 200 Connection established\r\n\r\n');
          if (buf.length) o.write(buf);
          sock.pipe(o); o.pipe(sock);
        });
        sockets.add(o);   // close() must drop the origin leg too, or it keeps the test process alive
        o.on('close', () => sockets.delete(o));
        o.on('error', () => sock.destroy());
        return 'return';
      }
      const body = `upstream relayed ${method} ${target}`;
      sock.write(`HTTP/1.1 200 OK\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${method === 'HEAD' ? '' : body}`);
      return 'continue';
    }
    sock.on('data', onData);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    stats,
    port: server.address().port,
    /** Send every parked Type 3 answer (holdType3). */
    release: () => { for (const go of held.splice(0)) go(); },
    url: (auth = '') => `http://${auth}127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

function type2For(challenge) {
  const info = Buffer.concat([Buffer.from([2, 0, 12, 0]), Buffer.from('Domain', 'utf16le'), Buffer.from([0, 0, 0, 0])]);
  const b = Buffer.alloc(48 + info.length);
  Buffer.from('NTLMSSP\0', 'latin1').copy(b, 0);
  b.writeUInt32LE(2, 8);
  b.writeUInt32LE(48, 16);
  b.writeUInt32LE(0xe28a8235 >>> 0, 20);
  challenge.copy(b, 24);
  b.writeUInt16LE(info.length, 40); b.writeUInt16LE(info.length, 42); b.writeUInt32LE(48, 44);
  info.copy(b, 48);
  return b;
}

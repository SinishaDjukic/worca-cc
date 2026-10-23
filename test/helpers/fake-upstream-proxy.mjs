// test/helpers/fake-upstream-proxy.mjs — a corporate proxy for the tests: raw net, so one socket
// carries several heads (http.createServer detaches a CONNECT socket). It speaks NTLM (verifying
// the Type 3 against the known password) or Basic, counts sockets and credential headers, tunnels
// every accepted CONNECT to `origin` (whatever host was asked) and answers plain requests itself.
// Like a real NTLM proxy, it logs in a CONNECTION: later requests on a logged-in socket need no header.
import net from 'node:net';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { ntHash, ntowfv2, parseType3 } from '../../src/core/ntlm.mjs';

/**
 * @param {{scheme?: 'ntlm'|'negotiate'|'digest'|'basic'|'none', offer?: string[]|null, user?: string, domain?: string, password?: string,
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
 *   scheme 'negotiate': NTLM tokens inside Negotiate; an `NTLM ` Type 1 gets a 407 offering only Negotiate.
 *   scheme 'digest': RFC 7616 with qop=auth, verified with its own maths. algorithm: Digest algorithm
 *   (default 'SHA-256'). realm: Digest realm (default 'ACME').
 *   forgetAuthAfter: null (default) = a logged-in NTLM/Negotiate socket stays logged in; n >= 0 = after n
 *   credential-free requests on it, the next one gets a 407 and the socket must log in again ("the proxy
 *   forgot the login"). The login handshake itself (the requests that carry a Type 1 or Type 3) is never
 *   counted, so forgetAuthAfter: 1 serves exactly one pooled request per login.
 *   forgetDelayMs: delay before that forgetting 407 (the login-swap race test).
 *   staleOnce: the first CORRECT Digest answer gets a 407 with a fresh nonce and stale=true (RFC 7616 §3.3);
 *   later ones pass.
 */
export async function startFakeUpstream({ scheme = 'ntlm', offer = null, user = 'User', domain = 'Domain',
  password = 'Password', originPort, closeOn407 = false, silent = false, headNoBody407 = true,
  afterType3 = null, status = 200, statusChallenge = false, rejectDelayMs = 0, holdType3 = false,
  algorithm = 'SHA-256', realm = 'ACME', forgetAuthAfter = null, forgetDelayMs = 0, staleOnce = false } = {}) {
  const stats = { sockets: 0, closed: 0, type1: 0, type3: 0, basic: 0, digest: 0, stale: 0, heads: [], authHeaders: [] };
  const sockets = new Set();
  const held = [];
  const want = Buffer.from(`${domain}\\${user}:${password}`).toString('base64');
  let nonce = randomBytes(12).toString('hex');   // `let`: staleOnce rotates it
  const ntlmish = scheme === 'ntlm' || scheme === 'negotiate';
  const prefix = scheme === 'negotiate' ? 'Negotiate ' : 'NTLM ';
  const digestChallenge = () => `Digest realm="${realm}", qop="auth", algorithm=${algorithm}, nonce="${nonce}", opaque="op"`;
  /** Built per request: the Digest challenge carries the current nonce. */
  const defaultOffers = () => ({ ntlm: ['NTLM'], negotiate: ['Negotiate'], digest: [digestChallenge()] })[scheme];
  /** Independent Digest check (not the module's code), including the uri against the request-target. */
  function digestOk(authz, method, target) {
    const p = Object.fromEntries([...authz.slice(7).matchAll(/(\w+)=(?:"((?:[^"\\]|\\.)*)"|([^,\s]+))/g)]
      .map((m) => [m[1], (m[2] ?? m[3]).replace(/\\(.)/g, '$1')]));
    const h = algorithm.startsWith('SHA-256') ? 'sha256' : 'md5';
    const H = (s) => createHash(h).update(s).digest('hex');
    const ha1 = H(`${domain}\\${user}:${realm}:${password}`);
    const wantResp = H(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:auth:${H(`${method}:${p.uri}`)}`);
    return p.username === `${domain}\\${user}` && p.nonce === nonce && p.uri === target && p.response === wantResp;
  }
  const server = net.createServer((sock) => {
    const id = ++stats.sockets;
    sockets.add(sock);
    sock.on('close', () => { sockets.delete(sock); stats.closed += 1; });
    sock.on('error', () => {});   // ECONNRESET (Windows) or EPIPE (Linux) when a test drops a socket
    let buf = Buffer.alloc(0);
    let challenge = null;
    let authed = false;   // this connection is logged in (NTLM/Negotiate)
    let served = 0;       // credential-free requests served since the login
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
        const offers = offer || defaultOffers() || ['Basic realm="ACME"'];
        // A logged-in connection needs no header, until the fake "forgets" the login.
        if (ntlmish && authed && !authz) {
          if (forgetAuthAfter !== null && served >= forgetAuthAfter) {
            authed = false; served = 0;
            const forget = () => reply407(offers.map((o) => `Proxy-Authenticate: ${o}\r\n`).join(''));
            if (forgetDelayMs) { sock.off('data', onData); setTimeout(() => { forget(); sock.on('data', onData); onData(Buffer.alloc(0)); }, forgetDelayMs); return; }
            forget();
            continue;
          }
          served += 1;
          if (answer(method, target) === 'continue') continue;
          return;
        }
        let ok = false;
        if (scheme === 'none') ok = true;
        else if (scheme === 'basic' && authz.startsWith('Basic ')) { stats.basic += 1; ok = authz.slice(6) === want; if (!ok) { refuse('Proxy-Authenticate: Basic realm="ACME"\r\n'); return; } }
        else if (scheme === 'digest' && authz.startsWith('Digest ')) {
          stats.digest += 1;
          ok = digestOk(authz, method, target);
          if (!ok) { refuse(`Proxy-Authenticate: ${digestChallenge()}\r\n`); return; }
          if (staleOnce && stats.stale === 0) {   // a correct answer to a nonce the fake now calls stale
            stats.stale += 1;
            nonce = randomBytes(12).toString('hex');
            reply407(`Proxy-Authenticate: ${digestChallenge()}, stale=true\r\n`);
            continue;
          }
        } else if (ntlmish && authz.startsWith(prefix)) {
          const msg = Buffer.from(authz.slice(prefix.length), 'base64');
          if (msg.readUInt32LE(8) === 1) {
            stats.type1 += 1;
            challenge = randomBytes(8);
            reply407(`Proxy-Authenticate: ${prefix}${type2For(challenge).toString('base64')}\r\n`);
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
              if (!verdict) { refuse(`Proxy-Authenticate: ${prefix.trim()}\r\n`); return; }
              authed = true; served = 0;
              if (answer(method, target) === 'continue') { sock.on('data', onData); onData(Buffer.alloc(0)); }
            });
            return;
          }
          if (!ok) { refuse(`Proxy-Authenticate: ${prefix.trim()}\r\n`); return; }
          authed = true; served = 0;   // the login request itself is not counted
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
        sock.write(`HTTP/1.1 ${status} Upstream Error\r\n${statusChallenge ? 'Proxy-Authenticate: NTLM\r\n' : ''}Content-Length: ${body.length}\r\n\r\n${method === 'HEAD' ? '' : body}`);
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

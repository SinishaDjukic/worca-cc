// src/core/exec-env/backends/docker-egress.mjs
// The host half of the Local sandbox (Docker) network (docs/local-sandbox.md "Network"). A sandbox container has no
// network (`--network none`): a raw socket in it reaches nothing, not the internet, not this machine, not the local
// network. Its HTTPS_PROXY points at the in-container relay (../docker-egress-relay.mjs), which carries each connection
// over `docker exec` stdio to here. Here, the egress proxy of src/core/egress-proxy.mjs applies the project's policy
// (open, or allow listed hosts only, from WORCA_EGRESS_ALLOW / WORCA_EGRESS_DENY) and this module's connector dials:
//
// - Never an address of this machine (loopback, its own interfaces), link-local (cloud metadata) or multicast, after
//   resolving the name and pinning the address it checked. Worca's own server and its local proxy listen on loopback.
// - In open mode, no private address either (10/8, 172.16/12, 192.168/16, 100.64/10, fc00::/7): the local network,
//   and Docker Desktop's way to the host. In allow mode a listed host may be private: someone listed it.
// - When this process's env names a proxy (HTTPS_PROXY), through that proxy. With a corporate proxy that needs a
//   login that is Worca's local proxy on 127.0.0.1, which does the login: the login stays in Worca, never reaches the
//   container, and nothing listens beyond loopback.
//
// Lazily imported (inside the docker client): node built-ins, egress-proxy.mjs and env-proxy.mjs only.
import net from 'node:net';
import http from 'node:http';
import dns from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import { createProxy, normalizeHost, hostMatches } from '../../egress-proxy.mjs';
import { httpsProxyFor, withoutProxyLogin } from '../../env-proxy.mjs';

const ALWAYS_V4 = [['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['224.0.0.0', 4], ['240.0.0.0', 4]];
const ALWAYS_V6 = [['::', 128], ['::1', 128], ['fe80::', 10], ['ff00::', 8]];
const PRIVATE_V4 = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10], ['198.18.0.0', 15], ['192.0.0.0', 24]];
const PRIVATE_V6 = [['fc00::', 7]];
const block = (v4, v6) => { const b = new net.BlockList(); for (const [a, n] of v4) b.addSubnet(a, n, 'ipv4'); for (const [a, n] of v6) b.addSubnet(a, n, 'ipv6'); return b; };
const ALWAYS = block(ALWAYS_V4, ALWAYS_V6);
const PRIVATE = block(PRIVATE_V4, PRIVATE_V6);
// Names that mean this machine or the container platform, refused before any lookup.
const LOCAL_NAME = /^(localhost|.*\.localhost|(?:.*\.)?docker\.internal|host-gateway)$/i;
const LOOKUP_TIMEOUT_MS = 5_000;
const CONNECT_TIMEOUT_MS = 30_000;

/** An IPv4-mapped IPv6 address as its IPv4 address ('::ffff:127.0.0.1', '::ffff:7f00:1'); others unchanged. */
export function unmapAddress(addr) {
  const a = String(addr).toLowerCase().replace(/^\[|\]$/g, '');
  const m = /^(?:(?:0{1,4}:){5}|::)ffff:(.+)$/.exec(a);
  if (!m) return a;
  if (net.isIPv4(m[1])) return m[1];
  const g = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(m[1]);
  if (!g) return a;
  const hi = parseInt(g[1], 16); const lo = parseInt(g[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** This machine's own addresses: a sandbox must never dial one (a server bound to 0.0.0.0 listens there). */
function ownAddresses() {
  const out = new Set();
  try { for (const list of Object.values(networkInterfaces())) for (const i of list || []) out.add(unmapAddress(i.address.split('%')[0])); } catch { /* none readable */ }
  return out;
}

/** Why `addr` may not be dialled under `mode` ('open' | 'allow'), or null when it may. */
export function addressRefusal(addr, mode, own = ownAddresses()) {
  const a = unmapAddress(addr);
  const family = net.isIPv4(a) ? 'ipv4' : net.isIPv6(a) ? 'ipv6' : null;
  if (!family) return 'it is not an IP address';
  if (own.has(a)) return 'it is an address of this machine';
  if (ALWAYS.check(a, family)) return 'it is a loopback, link-local or multicast address';
  if (mode !== 'allow' && PRIVATE.check(a, family)) return 'it is on a private network, which only a listed host in Allow mode reaches';
  return null;
}

const refuse = (status, message) => Object.assign(new Error(message), { status });

/**
 * Where a connection to `host` goes: { address } (direct, to the address checked) or { proxy } (through the proxy the
 * server's env names, which resolves the name itself), or a thrown { status, message }.
 * `lookup` and `env` are injectable for tests; `env` is read at each call (a new proxy applies to new connections).
 */
export async function routeFor(host, { mode = 'open', env = process.env, lookup = (h) => dns.lookup(h, { all: true, verbatim: true }), port = 443, own } = {}) {
  const h = normalizeHost(host);
  if (!h) throw refuse(400, 'no host');
  const ownSet = own || ownAddresses();
  const literal = net.isIP(unmapAddress(h)) ? unmapAddress(h) : null;
  if (!literal && LOCAL_NAME.test(h)) throw refuse(403, `the sandbox may not reach ${h}: it names this machine or the container platform`);
  const proxy = httpsProxyFor(h, { env: withoutProxyLogin(env), port });
  if (literal) {
    const why = addressRefusal(literal, mode, ownSet);
    if (why) throw refuse(403, `the sandbox may not reach ${h}: ${why}`);
    return proxy ? { proxy } : { address: literal };
  }
  let addrs = null;
  try {
    addrs = await Promise.race([lookup(h), new Promise((_, rej) => setTimeout(() => rej(new Error('lookup timed out')), LOOKUP_TIMEOUT_MS).unref?.())]);
  } catch (err) {
    // Behind a corporate proxy this machine often cannot resolve outside names: the proxy does.
    if (proxy) return { proxy };
    throw refuse(502, `${h} could not be resolved (${err?.code || err?.message || err})`);
  }
  const list = (Array.isArray(addrs) ? addrs : [addrs]).map((x) => (typeof x === 'string' ? x : x?.address)).filter(Boolean);
  if (!list.length) { if (proxy) return { proxy }; throw refuse(502, `${h} has no address`); }
  for (const a of list) {
    const why = addressRefusal(a, mode, ownSet);
    if (why) throw refuse(403, `the sandbox may not reach ${h} (${unmapAddress(a)}): ${why}`);
  }
  return proxy ? { proxy } : { address: list[0] };
}

/** A CONNECT tunnel through `proxyUrl` (credential-free: env-proxy.mjs withoutProxyLogin) to host:port. */
function tunnelVia(proxyUrl, host, port) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(proxyUrl); } catch { reject(refuse(502, 'HTTPS_PROXY is not a valid URL')); return; }
    const target = `${host.includes(':') ? `[${host}]` : host}:${port}`;
    const req = http.request({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 80, method: 'CONNECT', path: target,
      headers: { host: target }, timeout: CONNECT_TIMEOUT_MS });
    req.on('timeout', () => req.destroy(refuse(504, `the proxy did not answer for ${target}`)));
    req.on('error', (err) => reject(err.status ? err : refuse(502, `the proxy could not be reached (${err.code || err.message})`)));
    req.on('connect', (res, socket, head) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(refuse(res.statusCode === 407 ? 407 : 502, `the proxy refused ${target} (${res.statusCode})`)); return; }
      resolve({ socket, rest: head });
    });
    req.end();
  });
}

function dialDirect(address, port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port });
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(refuse(504, `${address}:${port} did not answer`)));
    socket.once('connect', () => { socket.setTimeout(0); resolve({ socket }); });
    socket.once('error', (err) => reject(err.status ? err : refuse(502, `${address}:${port} could not be reached (${err.code || err.message})`)));
  });
}

/** The egress-proxy connector (egress-proxy.mjs createProxy `connector`): every allowed host goes through routeFor. */
export function sandboxConnector({ mode, env = process.env, lookup, onRefuse = () => {} } = {}) {
  const route = async (host, port) => {
    try { return await routeFor(host, { mode, env, lookup, port }); }
    catch (err) { if (err.status === 403) onRefuse(host, err.message); throw err; }
  };
  return {
    route: () => 'upstream',
    async tunnel({ host, port }) {
      const r = await route(host, port);
      return r.proxy ? tunnelVia(r.proxy, host, port) : dialDirect(r.address, port);
    },
    forward(req, res, { host, port, url }) {
      route(host, port).then((r) => {
        let target;
        if (r.proxy) { const u = new URL(r.proxy); target = { host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port) || 80, path: url.href }; }
        else target = { host: r.address, port, path: url.pathname + url.search };
        const headers = { ...req.headers }; delete headers['proxy-authorization']; delete headers['proxy-connection'];
        const up = http.request({ ...target, method: req.method, headers, timeout: CONNECT_TIMEOUT_MS });
        up.on('timeout', () => up.destroy(new Error('timeout')));
        up.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' }).end(`bad gateway: ${host} did not answer\n`); else res.destroy(); });
        up.on('response', (ur) => { try { res.writeHead(ur.statusCode, ur.headers); } catch { res.destroy(); up.destroy(); return; } ur.pipe(res); });
        res.on('close', () => { if (!res.writableFinished) up.destroy(); });
        req.pipe(up);
      }, (err) => {
        const body = `Worca: ${err.message}\n`;
        res.writeHead(err.status || 502, { 'content-type': 'text/plain; charset=utf-8', 'content-length': Buffer.byteLength(body) }).end(body);
      });
    },
    close() {},
  };
}

/** The egress-proxy policy of a sandbox: open, or allow `allow` (worca's list: ".x" is x and its subdomains) minus
 *  `deny` ("x" that name only, ".x" its subdomains), the meaning sandbox-egress.mjs gives the E2B allow list. */
export function sandboxPolicy(network) {
  if (!network) return { mode: 'open', allow: [], deny: [] };
  const allow = [];
  for (const e of network.allowOut || []) for (const v of e.startsWith('.') ? [e, e.slice(1)] : [e]) if (v && !allow.includes(v)) allow.push(v);
  return { mode: 'allow', allow, deny: [...(network.denyOut || [])] };
}

/** Is `host` refused by the policy's deny list (for the tests and the run log)? */
export const deniedBy = (host, policy) => (policy.deny || []).some((d) => hostMatches(host, d, { subdomainsOnly: true }));

const MAX_LINE = 8 * 1024 * 1024;
const MAX_CONNS = 256;
const MAX_PENDING = 16 * 1024 * 1024;

/**
 * One container's network relay, host side. `exec()` starts `node <relay> <port>` in the container with stdin open
 * and resolves a child-like process ({ stdin, stdout, stderr, on('close'), kill() }). The relay's connections go into
 * a policy proxy on 127.0.0.1 here (createProxy, never on another interface). start() resolves once the in-container
 * relay listens; `onExit` fires when it ends without stop().
 */
export class EgressRelay {
  constructor({ exec, network = null, env = process.env, lookup, log = () => {}, onExit = () => {} }) {
    Object.assign(this, { exec, env, lookup, log, onExit });
    this.policy = sandboxPolicy(network);
    this.conns = new Map(); this.child = null; this.server = null; this.port = null; this._stopped = false; this._stalled = false;
    this._refused = new Set();
  }

  async start() {
    const onRefuse = (host, why) => {
      if (this._refused.has(host) || this._refused.size > 50) return;
      this._refused.add(host);
      this.log(`sandbox network: refused ${host}: ${why}`);
    };
    const connector = sandboxConnector({ mode: this.policy.mode, env: this.env, lookup: this.lookup, onRefuse });
    this.server = createProxy({ policy: this.policy, connector, log: (line) => {
      const m = / DENY \S+ (\S+)$/.exec(line);
      if (m) onRefuse(m[1].replace(/:\d+$/, ''), this.policy.mode === 'allow' ? 'it is not on the allow list (WORCA_EGRESS_ALLOW), or WORCA_EGRESS_DENY names it' : 'WORCA_EGRESS_DENY names it');
    } });
    await new Promise((res, rej) => { this.server.once('error', rej); this.server.listen(0, '127.0.0.1', () => { this.server.off('error', rej); res(); }); });
    this.proxyPort = this.server.address().port;
    const child = this.child = await this.exec();
    let ready; let fail;
    const readyP = new Promise((res, rej) => { ready = res; fail = rej; });
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        let f; try { f = JSON.parse(line); } catch { continue; }
        if (f && typeof f === 'object') { if (Number.isInteger(f.ready)) { this.port = f.ready; ready(); } else this._frame(f); }
      }
      if (buf.length > MAX_LINE) { this.log('sandbox network: the relay sent a frame that is too long; it is stopped'); this._kill(); }
    });
    let err = '';
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (d) => { err = (err + d).slice(-2000); });
    child.stdin.on('error', () => {});
    child.on('close', (code) => {
      for (const s of this.conns.values()) s.destroy();
      this.conns.clear();
      fail(new Error(`the sandbox network relay exited (${code ?? 'killed'}) before it was ready${err.trim() ? `: ${err.trim().split('\n').pop()}` : ''}`));
      if (this.child === child) this.child = null;
      if (!this._stopped) this.onExit(code);
    });
    const timer = setTimeout(() => fail(new Error('the sandbox network relay did not start within 20 s')), 20_000);
    try { await readyP; } catch (e) { await this.stop(); throw e; } finally { clearTimeout(timer); }
  }

  _send(frame) {
    const c = this.child;
    if (!c?.stdin?.writable) return;
    if (c.stdin.write(`${JSON.stringify(frame)}\n`) || this._stalled) return;
    this._stalled = true;
    for (const s of this.conns.values()) s.pause();
    c.stdin.once('drain', () => { this._stalled = false; for (const s of this.conns.values()) if (!s.held) s.resume(); });
  }

  _frame(f) {
    if (f.o !== undefined) {
      if (!Number.isSafeInteger(f.o) || this.conns.has(f.o) || this.conns.size >= MAX_CONNS) { this._send({ c: f.o }); return; }
      const id = f.o;
      const s = net.connect({ host: '127.0.0.1', port: this.proxyPort, allowHalfOpen: true });
      s.held = false;
      this.conns.set(id, s);
      if (this._stalled) s.pause();
      s.on('data', (b) => this._send({ d: id, b: b.toString('base64') }));
      s.on('end', () => this._send({ e: id }));
      s.on('drain', () => this._send({ r: id }));
      s.on('error', () => {});
      s.on('close', () => { if (this.conns.delete(id)) this._send({ c: id }); });
      return;
    }
    const id = f.d ?? f.e ?? f.c ?? f.p ?? f.r;
    const s = this.conns.get(id);
    if (!s) return;
    if (f.d !== undefined) {
      if (typeof f.b !== 'string') return;
      s.write(Buffer.from(f.b, 'base64'));
      if (s.writableLength > MAX_PENDING) this._send({ p: id });
    } else if (f.e !== undefined) s.end();
    else if (f.c !== undefined) { this.conns.delete(id); s.destroy(); }
    else if (f.p !== undefined) { s.held = true; s.pause(); }
    else if (f.r !== undefined) { s.held = false; if (!this._stalled) s.resume(); }
  }

  get alive() { return !!this.child && !this._stopped; }
  _kill() { const c = this.child; this.child = null; try { c?.stdin?.end(); } catch { /* gone */ } try { c?.kill('SIGKILL'); } catch { /* gone */ } }
  async stop() {
    this._stopped = true;
    for (const s of this.conns.values()) s.destroy();
    this.conns.clear();
    this._kill();
    const srv = this.server; this.server = null;
    if (srv) await new Promise((r) => srv.close(() => r()));
  }
}

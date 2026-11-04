// src/core/pac-worker.mjs — evaluates one PAC script, run by pac-eval.mjs in a child `node --permission`
// (no file system beyond this file, no child processes or workers), a small heap and a kill timer.
// A PAC file is JavaScript from the network, so it never runs in the server process, and here it gets three walls:
//   1. Its context holds no object from this realm: created with DONT_CONTEXTIFY, the helpers defined from source
//      inside it, string code generation off. `this.constructor.constructor('return process')` has nothing to climb.
//   2. Only a string comes back out (typeof-checked, parsed here), so no object of its making runs code on this side.
//   3. Before it runs, this process drops what --permission leaves open on Node 22 (network, signals): the builtin
//      loader, bindings, kill, dlopen, fetch and WebSocket, and the stdio sockets (I/O goes through fds 0 and 1).
//
// stdin: one JSON object { script, url, host, dns: { [host]: ip|null }, myIp }.
// stdout: one JSON line { result } | { needDns: host } | { error }.
// DNS is the parent's job: a dnsResolve() for a host not in `dns` stops the run with needDns; the parent
// looks it up and runs the script again with the answer added (a PAC script has no side effects to repeat).
import fs from 'node:fs';
import vm from 'node:vm';

const input = fs.readFileSync(0, 'utf8');
const exit = process.exit.bind(process);
const writeOut = (obj) => fs.writeSync(1, `${JSON.stringify(obj)}\n`);

// Wall 3: nothing below needs these, and an escaped script must not find them.
for (const k of ['getBuiltinModule', 'binding', '_linkedBinding', 'kill', 'dlopen', 'mainModule', 'report']) {
  try { Object.defineProperty(process, k, { value: undefined, configurable: false, writable: false }); } catch { /* not present */ }
}
for (const k of ['stdin', 'stdout', 'stderr', 'channel']) {
  try { Object.defineProperty(process, k, { get: () => undefined, configurable: false }); } catch { /* not present */ }
}
for (const k of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'navigator', 'Request', 'Response', 'Headers', 'BroadcastChannel', 'MessageChannel', 'Worker']) {
  try { delete globalThis[k]; } catch { /* not configurable */ }
}

// The standard PAC helpers, as source run inside the context (wall 1). `__in` is set from a JSON string below.
const HELPERS = String.raw`
var __needDns = null;
function __resolve(h) {
  h = String(h);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
  if (!Object.prototype.hasOwnProperty.call(__in.dns, h)) { __needDns = h; throw new Error('needDns'); }
  return __in.dns[h];
}
function __ipNum(ip) { return String(ip).split('.').reduce(function (n, p) { return (n * 256) + (Number(p) & 255); }, 0) >>> 0; }
var __DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function __inRange(v, a, b) { return a <= b ? v >= a && v <= b : v >= a || v <= b; }
function isPlainHostName(h) { return String(h).indexOf('.') < 0; }
function dnsDomainIs(h, d) { h = String(h).toLowerCase(); d = String(d).toLowerCase(); return h.length >= d.length && h.slice(h.length - d.length) === d; }
function localHostOrDomainIs(h, hd) { var a = String(h).toLowerCase(), b = String(hd).toLowerCase(); return a === b || (a.indexOf('.') < 0 && b.indexOf(a + '.') === 0); }
function isResolvable(h) { return __resolve(h) != null; }
function isResolvableEx(h) { return __resolve(h) != null; }
function dnsResolve(h) { return __resolve(h); }
function dnsResolveEx(h) { return __resolve(h) || ''; }
function myIpAddress() { return __in.myIp; }
function myIpAddressEx() { return __in.myIp; }
function isInNet(h, pattern, mask) { var ip = __resolve(h); return ip != null && (__ipNum(ip) & __ipNum(mask)) === (__ipNum(pattern) & __ipNum(mask)); }
function convert_addr(ip) { return __ipNum(ip); }
function dnsDomainLevels(h) { return (String(h).match(/\./g) || []).length; }
function shExpMatch(str, pattern) { return new RegExp('^' + String(pattern).replace(/[.+^$\{\}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i').test(String(str)); }
function weekdayRange(a, b) { var d = new Date().getDay(), i = __DAYS.indexOf(String(a).toUpperCase()), j = b && __DAYS.indexOf(String(b).toUpperCase()) >= 0 ? __DAYS.indexOf(String(b).toUpperCase()) : i; return __inRange(d, i, j); }
function dateRange() { return true; }   // date and time windows are no routing fact Worca can act on: always in range
function timeRange() { return true; }
function alert() {}
function __run() {
  try {
    if (typeof FindProxyForURL !== 'function') return JSON.stringify({ error: 'the PAC file has no FindProxyForURL function' });
    return JSON.stringify({ result: String(FindProxyForURL(__in.url, __in.host)) });
  } catch (e) {
    if (__needDns !== null) return JSON.stringify({ needDns: String(__needDns) });
    return JSON.stringify({ error: 'the PAC file failed (' + String(e && e.message).slice(0, 200) + ')' });
  }
}
`;

function evaluate(raw) {
  let req;
  try { req = JSON.parse(raw); } catch { return { error: 'bad input' }; }
  const data = JSON.stringify({ url: String(req.url), host: String(req.host), dns: req.dns || {}, myIp: String(req.myIp || '127.0.0.1') });
  const context = vm.createContext(vm.constants.DONT_CONTEXTIFY, { codeGeneration: { strings: false, wasm: false } });
  try {
    vm.runInContext(`var __in = JSON.parse(${JSON.stringify(data)});${HELPERS}`, context, { timeout: 1000 });
    vm.runInContext(String(req.script), context, { timeout: 1000 });
    const out = vm.runInContext('__run()', context, { timeout: 1000 });
    if (typeof out !== 'string') return { error: 'the PAC file failed (bad answer)' };
    const parsed = JSON.parse(out);
    const pick = (k) => (typeof parsed[k] === 'string' ? parsed[k] : undefined);
    if (pick('needDns') !== undefined) return { needDns: pick('needDns') };
    if (pick('result') !== undefined) return { result: pick('result') };
    return { error: pick('error') || 'the PAC file failed' };
  } catch (err) {
    // vm's timeout error comes from the context's realm (instanceof Error is false), so read its own code value; a
    // getter or Proxy a script threw runs only its own sandboxed code, and the parent's kill timer bounds it.
    let code;
    try { code = err && typeof err === 'object' ? Object.getOwnPropertyDescriptor(err, 'code')?.value : undefined; } catch { /* a hostile object */ }
    return { error: code === 'ERR_SCRIPT_EXECUTION_TIMEOUT' ? 'the PAC file took too long' : 'the PAC file failed' };
  }
}

// Exit at once: nothing the script queued (a promise, a timer) runs after the answer.
writeOut(evaluate(input));
exit(0);

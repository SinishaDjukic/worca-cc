// src/core/pac-eval.mjs — ask a PAC script which proxy it picks for one URL, without running it in this process.
// The script runs in pac-worker.mjs under `node --permission` (only that file readable, no child processes or
// workers), a 64 MB heap and a kill timer. This side answers its DNS lookups and parses the answer.
import { spawnChild } from './spawn.mjs';
import { lookup } from 'node:dns/promises';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const WORKER = fileURLToPath(new URL('./pac-worker.mjs', import.meta.url));
const MAX_DNS_ROUNDS = 16;

/** The first non-internal IPv4 address, which PAC scripts read as myIpAddress(). */
export function myIpv4(ifaces = os.networkInterfaces()) {
  for (const list of Object.values(ifaces || {})) for (const a of list || []) if (a && a.family === 'IPv4' && !a.internal) return a.address;
  return '127.0.0.1';
}

/** "PROXY a:1; HTTPS b:2; DIRECT" → [{ type: 'proxy', host, port } | { type: 'direct' } | { type: 'other', value }]. */
export function parsePacResult(text) {
  return String(text || '').split(';').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [kind, addr = ''] = entry.split(/\s+/, 2);
    const k = kind.toUpperCase();
    if (k === 'DIRECT') return { type: 'direct' };
    if (['PROXY', 'HTTP', 'HTTPS'].includes(k)) {
      const m = /^\[?([^\]\s]+?)\]?(?::(\d{1,5}))?$/.exec(addr);
      if (m) return { type: 'proxy', host: m[1], port: m[2] ? Number(m[2]) : (k === 'HTTPS' ? 443 : 80) };
    }
    return { type: 'other', value: entry };   // SOCKS and the like: not a proxy Worca can chain to
  });
}

function runWorker(payload, { timeoutMs, execPath }) {
  return new Promise((resolve) => {
    const child = spawnChild(execPath, ['--permission', `--allow-fs-read=${WORKER}`, '--max-old-space-size=64', WORKER],
      // No inherited env (no token or proxy login reaches the script); Windows needs SystemRoot for Node to start.
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, env: process.platform === 'win32' && process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {} });
    let out = ''; let done = false;
    const finish = (v) => { if (done) return; done = true; clearTimeout(timer); resolve(v); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish({ error: 'the PAC file took too long' }); }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => { out += c; if (out.length > 64 * 1024) { child.kill('SIGKILL'); finish({ error: 'the PAC file answered too much' }); } });
    child.on('error', () => finish({ error: 'the PAC file could not be evaluated' }));
    child.on('close', () => { try { finish(JSON.parse(out.trim().split('\n').pop() || '{}')); } catch { finish({ error: 'the PAC file could not be evaluated' }); } });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

/**
 * @returns {Promise<{entries: Array<object>, raw: string} | {error: string}>}
 */
export async function evaluatePac(script, url, { dnsLookup = async (h) => { try { return (await lookup(h, { family: 4 })).address; } catch { return null; } },
  myIp = myIpv4(), timeoutMs = 4000, execPath = process.execPath } = {}) {
  const host = new URL(url).hostname;
  const dns = {};
  for (let round = 0; round <= MAX_DNS_ROUNDS; round++) {
    const r = await runWorker({ script, url, host, dns, myIp }, { timeoutMs, execPath });
    if (r.needDns) { dns[r.needDns] = await dnsLookup(r.needDns); continue; }
    if (r.error) return { error: r.error };
    return { entries: parsePacResult(r.result), raw: r.result };
  }
  return { error: 'the PAC file asked for too many DNS lookups' };
}

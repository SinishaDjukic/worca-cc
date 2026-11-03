// tools/parity/routes.mjs — #919 slice 2: list a target's /api routes and probe them signed in and signed out.
import http from 'node:http';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shapeKey } from './shape.mjs';
import { buildEnv, SIGNED_OUT_HOST } from './launch.mjs';

const json = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
export const PUBLIC_ROUTES = json('./public-routes.json');
export const ROUTE_CLASSES = json('./route-classes.json');
export const PLACEHOLDER = 'parity-missing';
export const classOf = (key) => ROUTE_CLASSES[key]?.class ?? 'unclassified';
const REDUCED_HEALTH = '{"name":"string","version":"string"}';

/** Express 4 mount regexp (`^\/api\/x\/?(?=\/|$)`, or fast_slash for '/') → its literal prefix; null when it is not literal. */
export function mountPrefix(mount) {
  if (!mount || mount.fastSlash) return '';
  const m = /^\^(.*)\\\/\?\(\?=\\\/\|\$\)$/.exec(mount.source);
  if (!m) return null;
  const lit = m[1].replace(/\\\//g, '/');
  return /[\\^$.*+?()[\]{}|]/.test(lit) ? null : lit;
}

export function routesFromStack(stack, prefix = '', seen = new Map()) {
  for (const l of stack) {
    if (l.handle?.stack) {   // a nested router (app.use(path, router)): resolve it with its mount prefix (D6)
      const p = mountPrefix(l.mount);
      if (p === null) throw new Error(`route list: cannot read the mount path of router "${l.name}" (${l.mount?.source})`);
      routesFromStack(l.handle.stack, prefix + p, seen);
      continue;
    }
    if (!l.route) continue;
    for (const raw of [l.route.path].flat()) {
      if (typeof raw !== 'string') {
        if (/api/.test(prefix + String(raw?.source ?? raw))) throw new Error(`route list: /api path ${raw?.source ?? raw} is not a string`);
        continue;
      }
      const path = prefix + raw;
      if (!path.startsWith('/api')) continue;
      for (const m of Object.keys(l.route.methods)) seen.set(`${m.toUpperCase()} ${path}`, { method: m.toUpperCase(), path });
    }
  }
  return prefix ? [] : [...seen.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, r]) => r);
}

/** Runs inside the target's own node: imports its server (no listen: isMain is false) and prints the stack, nested routers included. */
export const LIST_ROUTES_SCRIPT = `
const { pathToFileURL } = await import('node:url');
const { app } = await import(pathToFileURL(process.env.PARITY_SERVER).href);
const ser = (stack) => stack.map((l) => ({ name: l.name,
  mount: l.regexp ? { source: l.regexp.source, fastSlash: !!l.regexp.fast_slash } : undefined,
  handle: l.handle && Array.isArray(l.handle.stack) ? { stack: ser(l.handle.stack) } : undefined,
  route: l.route ? { path: l.route.path instanceof RegExp ? { source: l.route.path.source } : l.route.path, methods: l.route.methods } : undefined }));
// exit only once the pipe has drained: a piped stdout is async, and an early exit cuts the line at 64 KB
process.stdout.write('PARITY_ROUTES ' + JSON.stringify(ser(app._router.stack)) + '\\n', () => process.exit(0));`;

/** execFileSync with stderr captured: a server that throws at load is one short error with its stderr tail, not the whole command. */
function runLister(what, file, args, opts) {
  try { return execFileSync(file, args, { ...opts, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) {
    const tail = String(e.stderr ?? '').trim().split('\n').slice(-10).join('\n');
    throw new Error(`route list: ${what} failed to load (exit ${e.status ?? e.signal ?? e.code})${tail ? `\n${tail}` : ''}`);
  }
}

export function listRoutes(target) {
  const args = ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', LIST_ROUTES_SCRIPT];
  let text;
  if (target.kind === 'docker') {
    const q = (a) => `'${a.replaceAll("'", `'\\''`)}'`;
    text = runLister(`${target.ref} ui/server.mjs`, 'docker', ['run', '--rm', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
      '--entrypoint', 'sh', '-e', 'WORCA_MOCK=1', target.ref, '-c',
      `PARITY_SERVER="$(npm root -g)/@worca/app/ui/server.mjs" HOME=/tmp/h WORCA_HOME=/tmp/h node ${args.map(q).join(' ')}`], {});
  } else {
    const home = mkdtempSync(join(tmpdir(), 'parity-list-'));
    try {
      const server = join(target.root, 'ui', 'server.mjs');
      text = runLister(server, process.execPath, args, { env: { ...buildEnv(process.env, { home, port: 0 }), PARITY_SERVER: server } });
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
  const line = text.split('\n').find((l) => l.startsWith('PARITY_ROUTES '));
  if (!line) throw new Error('route list: the target printed no PARITY_ROUTES line');
  return routesFromStack(JSON.parse(line.slice('PARITY_ROUTES '.length)));
}

const PARAM_BY_PREFIX = [
  [/^\/api\/ask\/threads\/:id/, { id: 'threadId' }],
  [/^\/api\/ask\/runs\/:id/, { id: 'runId' }],
  [/^\/api\/runs\/:id/, { id: 'runId' }],
  [/^\/api\/history\//, { key: 'projectKey', id: 'pipelineId', pid: 'pipelineId' }],
  [/^\/api\/projects\/:key/, { key: 'projectKey' }],
];

export function fillPath(method, path, seed) {
  const map = method === 'GET' ? (PARAM_BY_PREFIX.find(([re]) => re.test(path))?.[1] ?? {}) : {};
  return path.replace(/:(\w+)\??/g, (_, name) => encodeURIComponent(map[name] && seed[map[name]] ? seed[map[name]] : PLACEHOLDER));
}

/** node:http, not fetch: fetch replaces the Host header (D10). Never throws; a dropped socket is `crashed`. */
export function request(t, method, path, { host, body, timeoutMs = 15_000 } = {}) {
  const u = new URL(t.base);
  const payload = method === 'GET' || method === 'HEAD' ? undefined : (body ?? '{}');
  return new Promise((ok) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, timeout: timeoutMs,
      headers: { host: host ?? u.host, ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}) } },
    (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const ct = res.headers['content-type'] || '';
        let parsed; if (ct.includes('json')) { try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch {} }
        ok({ status: res.statusCode, shape: shapeKey(parsed, ct) });
      });
      res.on('error', () => ok({ status: 'crashed', shape: null }));
    });
    req.on('timeout', () => { req.destroy(); ok({ status: 'timeout', shape: null }); });
    req.on('error', () => ok({ status: 'crashed', shape: null }));
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Signed in, on the probe server only (D8). GETs twice (volatile detection), then non-GETs; `skip` routes recorded,
 * not called. A crash restarts the target through `restart()` → { t, seed } and the row stays `crashed` (D9).
 */
export async function probeSignedIn(target, routes, seed, { restart, log = () => {} } = {}) {
  let t = target; let s = seed; const out = [];
  const one = async (method, url) => {
    const r = await request(t, method, url);
    if ((r.status === 'crashed' || r.status === 'timeout') && !t.alive()) { ({ t, seed: s } = await restart()); }
    return r;
  };
  for (const r of routes) {
    const key = `${r.method} ${r.path}`;
    const cls = classOf(key);
    if (cls !== 'probe') { out.push({ ...r, skipped: cls }); continue; }
    const url = fillPath(r.method, r.path, s);
    const a = await one(r.method, url);
    if (a.status === 'crashed') log(`route ${key} crashed the server (restarted); classify it skip`);
    const b = r.method === 'GET' && a.status !== 'crashed' ? await one('GET', fillPath('GET', r.path, s)) : a;
    out.push({ ...r, status: a.status, shape: a.shape, volatile: a.status !== b.status || a.shape !== b.shape });
  }
  return { rows: out, t };
}

export function judgeSignedOut(row, pub = PUBLIC_ROUTES) {
  const isPublic = pub.some((p) => p.method === row.method && p.path === row.path);
  if (!isPublic) return row.status === 401 ? null : `expected 401, got ${row.status}`;
  if (row.status === 401) return 'public route answered 401';
  if (row.path.startsWith('/api/ingress/') && !(row.status >= 400 && row.status < 500)) return `ingress without a valid token answered ${row.status}, not a 4xx`;
  if (row.method === 'GET' && row.path === '/api/health' && row.shape !== REDUCED_HEALTH) return `health did not answer the reduced body (${row.shape})`;
  return null;
}

/** Signed out: canary first, then every route (the 401 middleware answers before any handler). */
export async function probeSignedOut(t, routes) {
  const canary = await request(t, 'GET', '/api/projects', { host: SIGNED_OUT_HOST });
  if (canary.status !== 401) throw new Error(`signed-out canary GET /api/projects answered ${canary.status}: the probe was treated as local`);
  const out = [];
  for (const r of routes) {
    const { status, shape } = await request(t, r.method, fillPath(r.method, r.path, {}), { host: SIGNED_OUT_HOST });
    out.push({ ...r, status, problem: judgeSignedOut({ ...r, status, shape }) });
  }
  return out;
}

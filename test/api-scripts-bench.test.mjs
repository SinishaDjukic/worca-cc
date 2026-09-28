// test/api-scripts-bench.test.mjs
// The bench's server surface (workbench spec §4.2–§4.3): POST /api/scripts/bench
// is fire-and-forget like POST /api/agents/generate — it registers a
// kind:'scriptbench' entry in the SAME runs Map, wires the scriptbench-* family
// onto the WS bus, and answers {benchId}. Also pinned here: ?benchId= replay,
// the idempotent stop, the output route (whose path comes from the stored
// RESULT, never from the URL), the `scripts-changed` broadcast every mutation
// sends, and the boot sweep.
// The script fixture is written straight into the user layer and runs for real
// through process.execPath (no sleep/true/false: Windows CI).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { _resetForTests } from '../src/core/db.mjs';

let homeDir, srv, base, wsBase, runs, prevHome, bootMaintenance, benchRoot;
const JSONH = { 'Content-Type': 'application/json' };

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-benchapi-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  const user = join(homeDir, '.worca-cc', 'scripts');
  await mkdir(user, { recursive: true });
  await writeFile(join(user, 'echoes.mjs'), `
import { openSync, ftruncateSync, closeSync } from 'node:fs';
export default async function ({ params, outputs }) {
  console.log('bench line ' + params.tag);
  if (params.tag === 'huge') {
    const fd = openSync(outputs.log.path, 'w');      // 2 GiB, sparse: no disk, no write
    ftruncateSync(fd, 2147483648);
    closeSync(fd);
    return { summary: 'huge' };
  }
  return { summary: 'echoed ' + params.tag, outputs: { log: { value: '# output\\n' } } };
}
`);
  await writeFile(join(user, 'echoes.meta.json'), JSON.stringify({
    key: 'echoes', metaVersion: 2, displayName: 'Echoes', runtime: 'node', file: 'echoes.mjs', timeoutMs: 20000,
    params: [{ id: 'tag', type: 'string', default: 'x' }],
    inputs: [{ id: 'done', type: 'void', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'echo-{cycle}.md' },
      { id: 'pass', type: 'void', when: 'clean' }],
    verdict: { filename: 'echo-{cycle}.json' },
  }));
  const mod = await import('../ui/server.mjs');
  runs = mod.runs;
  bootMaintenance = mod.bootMaintenance;
  ({ benchRoot } = await import('../src/core/script-bench.mjs'));
  // Listen on the MODULE's server: that is the one the WebSocketServer is
  // attached to (path:'/ws'); a fresh http.createServer(app) would 404 on /ws.
  srv = mod.server;
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}/ws`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  for (const r of runs.values()) { try { r.orch?.stop?.(); } catch { /* best-effort */ } }
  runs.clear();
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true, maxRetries: 3 });
});

const post = (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(body) });
function openWs(query = '') {
  const ws = new WebSocket(`${wsBase}${query}`, { headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' } });
  const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch { /* ignore */ } });
  const opened = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return { ws, msgs, opened };
}
function waitFor(pred, timeoutMs = 20000) {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tick = () => {
      const v = pred();
      if (v) return res(v);
      if (Date.now() - t0 > timeoutMs) return rej(new Error('waitFor timed out'));
      setTimeout(tick, 15);
    };
    tick();
  });
}

test('POST /api/scripts/bench -> {benchId}; a kind:scriptbench entry streams lines and one done', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  const r = await post('/api/scripts/bench', { key: 'echoes', params: { tag: 'alpha' }, inputs: { done: { fired: true } } });
  assert.equal(r.status, 200);
  const { benchId } = await r.json();
  assert.match(benchId, /^bench_[0-9a-f-]{36}$/);
  const entry = runs.get(benchId);
  assert.equal(entry.kind, 'scriptbench');
  assert.equal(entry.title, 'bench: echoes');
  await waitFor(() => ['done', 'error'].includes(entry.status));
  assert.equal(entry.status, 'done');
  assert.equal(entry.result.status, 'clean');
  assert.equal(entry.result.summary, 'echoed alpha');
  await waitFor(() => msgs.some((m) => m.type === 'scriptbench-done' && m.benchId === benchId));
  const line = msgs.find((m) => m.type === 'scriptbench-line' && m.benchId === benchId);
  assert.equal(line.text, 'bench line alpha');
  assert.equal(line.stream, 'out');
  assert.equal(line.caseId, null);
  ws.close();
});

test('WS ?benchId= and {type:"subscribe",benchId} both replay the buffer', async () => {
  const { benchId } = await (await post('/api/scripts/bench', { key: 'echoes', params: { tag: 'replay' } })).json();
  await waitFor(() => ['done', 'error'].includes(runs.get(benchId).status));
  const a = openWs(`?benchId=${encodeURIComponent(benchId)}`);
  await a.opened;
  await waitFor(() => a.msgs.some((m) => m.type === 'scriptbench-done' && m.benchId === benchId));
  assert.ok(a.msgs.some((m) => m.type === 'scriptbench-line' && m.benchId === benchId));
  a.ws.close();
  const b = openWs();
  await b.opened;
  b.ws.send(JSON.stringify({ type: 'subscribe', benchId }));
  await waitFor(() => b.msgs.some((m) => m.type === 'scriptbench-done' && m.benchId === benchId));
  b.ws.close();
});

test('GET /api/scripts/bench/:benchId/output/:port reads the path from the stored result', async () => {
  const { benchId } = await (await post('/api/scripts/bench', { key: 'echoes', params: { tag: 'out' } })).json();
  await waitFor(() => ['done', 'error'].includes(runs.get(benchId).status));
  const ok = await fetch(`${base}/api/scripts/bench/${benchId}/output/log`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') || '', /text\/plain/);
  assert.equal(await ok.text(), '# output\n');
  assert.equal((await fetch(`${base}/api/scripts/bench/${benchId}/output/pass`)).status, 404, 'a void port has no file');
  assert.equal((await fetch(`${base}/api/scripts/bench/${benchId}/output/nope`)).status, 404);
  assert.equal((await fetch(`${base}/api/scripts/bench/${benchId}/output/..%2F..%2Fetc%2Fpasswd`)).status, 404);
  assert.equal((await fetch(`${base}/api/scripts/bench/bench_nope/output/log`)).status, 404);
});

test('the output route STREAMS the file: a 2 GiB output is 200 + Content-Length, not a phantom 404', async () => {
  const { benchId } = await (await post('/api/scripts/bench', { key: 'echoes', params: { tag: 'huge' } })).json();
  await waitFor(() => ['done', 'error'].includes(runs.get(benchId).status));
  // readFile(path, 'utf8') threw ERR_FS_FILE_TOO_LARGE here and the catch answered
  // "output not found"; below 2 GiB it buffered the whole file into one string.
  const res = await fetch(`${base}/api/scripts/bench/${benchId}/output/log`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-length'), '2147483648');
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.ok(first.value && first.value.length > 0, 'the first chunk arrives without buffering the file');
  await reader.cancel();
});

test('POST /api/scripts/bench: a bad key shape is 404; an unknown key is a WS error, not an HTTP one', async () => {
  assert.equal((await post('/api/scripts/bench', { key: '../etc' })).status, 404);
  assert.equal((await post('/api/scripts/bench', {})).status, 404);
  const { ws, msgs, opened } = openWs();
  await opened;
  const { benchId } = await (await post('/api/scripts/bench', { key: 'ghost' })).json();
  await waitFor(() => msgs.some((m) => m.type === 'scriptbench-error' && m.benchId === benchId));
  const ev = msgs.find((m) => m.type === 'scriptbench-error' && m.benchId === benchId);
  assert.equal(ev.message, 'script not found: ghost');
  assert.equal(runs.get(benchId).status, 'error');
  // A prototype key passes the key regex; the registry is a plain object. It is still NOT a script.
  const proto = await (await post('/api/scripts/bench', { key: 'constructor' })).json();
  await waitFor(() => msgs.some((m) => m.type === 'scriptbench-error' && m.benchId === proto.benchId));
  assert.equal(msgs.find((m) => m.type === 'scriptbench-error' && m.benchId === proto.benchId).message, 'script not found: constructor');
  ws.close();
});

test('frames carry a monotonic seq (the page de-duplicates live + replayed with it); a bench never shows up as a run', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  const { benchId } = await (await post('/api/scripts/bench', { key: 'echoes', params: { tag: 'seq' } })).json();
  await waitFor(() => msgs.some((m) => m.type === 'scriptbench-done' && m.benchId === benchId));
  const seqs = msgs.filter((m) => m.benchId === benchId).map((m) => m.seq);
  assert.ok(seqs.length >= 2 && seqs.every((n, i) => Number.isInteger(n) && (i === 0 || n > seqs[i - 1])), `monotonic: ${seqs}`);
  ws.close();
  // W15: the hello snapshot lists RUNS. A bench shares the runs Map for the replay plumbing only.
  const fresh = openWs();
  await fresh.opened;
  await waitFor(() => fresh.msgs.some((m) => m.type === 'hello'));
  const hello = fresh.msgs.find((m) => m.type === 'hello');
  assert.equal((hello.runs || []).some((r) => r.kind === 'scriptbench'), false);
  fresh.ws.close();
});

test('finished bench entries are evicted past the newest 8', async () => {
  for (let i = 0; i < 10; i += 1) {
    const { benchId } = await (await post('/api/scripts/bench', { key: 'ghost' })).json();
    await waitFor(() => runs.get(benchId) && runs.get(benchId).status === 'error');
  }
  assert.ok([...runs.values()].filter((e) => e.kind === 'scriptbench').length <= 9, 'the newest 8 + the one just started');
});

test('POST /api/scripts/bench/stop is idempotent and stops a live bench', async () => {
  let stopped = false;
  const { EventEmitter } = await import('node:events');
  const entry = {
    id: 'bench_stop-1', benchId: 'bench_stop-1', kind: 'scriptbench',
    orch: Object.assign(new EventEmitter(), { stop() { stopped = true; } }),
    projectDir: null, title: 'bench: x', status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null, result: null,
  };
  runs.set(entry.id, entry);
  try {
    const r = await post('/api/scripts/bench/stop', { benchId: 'bench_stop-1' });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(stopped, true);
    assert.equal(entry.status, 'stopped');
  } finally { runs.delete(entry.id); }
  assert.equal((await post('/api/scripts/bench/stop', { benchId: 'bench_unknown' })).status, 200);
  assert.equal((await post('/api/scripts/bench/stop', {})).status, 200);
});

test('every script mutation broadcasts scripts-changed with its action', async () => {
  const { ws, msgs, opened } = openWs();
  await opened;
  const meta = { metaVersion: 2, key: 'poker', displayName: 'Poker', runtime: 'node',
    inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'p-{cycle}.md' }] };
  await post('/api/scripts', { meta, source: 'export default async () => ({ summary: "p" });\n' });
  await waitFor(() => msgs.some((m) => m.type === 'scripts-changed' && m.action === 'created'));
  await fetch(`${base}/api/scripts/poker/cases`, { method: 'PUT', headers: JSONH, body: JSON.stringify({ cases: [] }) });
  await waitFor(() => msgs.some((m) => m.type === 'scripts-changed' && m.action === 'cases'));
  await fetch(`${base}/api/scripts/poker`, { method: 'DELETE' });
  await waitFor(() => msgs.some((m) => m.type === 'scripts-changed' && m.action === 'deleted'));
  ws.close();
});

test('boot maintenance sweeps bench folders older than 24 h', async () => {
  const root = benchRoot();
  const old = join(root, 'bench_old');
  mkdirSync(old, { recursive: true });
  const long = Date.now() / 1000 - 3 * 24 * 3600;
  utimesSync(old, long, long);
  const summary = await bootMaintenance();
  assert.ok(summary.bench.removed >= 1);
  assert.equal(existsSync(old), false);
});

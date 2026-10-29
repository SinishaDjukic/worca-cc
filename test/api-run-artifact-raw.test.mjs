// test/api-run-artifact-raw.test.mjs
// The raw-bytes artifact route (GET /api/runs/:id/artifact-raw/*, plus the
// history and workspace twins): `rel` still only SELECTS among the run's indexed
// rows, the Content-Type comes from the shared mime table, scriptable markup is
// served under a sandbox CSP, and an oversize file is refused with 413.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _resetForTests } from '../src/core/db.mjs';
import { recordArtifact } from '../src/core/artifacts.mjs';
import { seedPipeline } from './helpers/db-seed.mjs';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

let homeDir, srv, base, prevHome, proj, key, id, dir;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-rawart-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  _resetForTests();
  proj = await mkdtemp(join(tmpdir(), 'worca-rawart-proj-'));
  ({ id, key, dir } = await seedPipeline(proj, { title: 'A', status: 'done' }));
  await mkdir(join(dir, 'deck'), { recursive: true });
  await mkdir(join(dir, 'shots'), { recursive: true });
  await writeFile(join(dir, 'deck', 'deck.html'), '<!DOCTYPE html><deck-stage></deck-stage>', 'utf8');
  await writeFile(join(dir, 'deck', 'deck-stage.js'), '/* kit */\n', 'utf8');
  await writeFile(join(dir, 'deck', 'thing.xyz'), 'unknown', 'utf8');
  await writeFile(join(dir, 'deck', 'poppins-400.woff2'), 'FONTBYTES');
  await writeFile(join(dir, 'shots', 's01.png'), PNG);
  await writeFile(join(dir, '..', 'outside.html'), '<b>never</b>', 'utf8');
  const fh = await open(join(dir, 'big.pdf'), 'w');
  await fh.truncate(26 * 1024 * 1024);
  await fh.close();
  recordArtifact(id, 'deck', 'deck/deck.html');
  // Indexed under the UNLISTED subresource kind: deck.html's <script src> must
  // still stream, or the stored deck is unviewable. The raw route resolves rows
  // by rel_path alone — this pins that it stays kind-agnostic.
  recordArtifact(id, 'deck-asset', 'deck/deck-stage.js');
  recordArtifact(id, 'deck', 'deck/thing.xyz');
  recordArtifact(id, 'deck-asset', 'deck/poppins-400.woff2');
  recordArtifact(id, 'deck-shot', 'shots/s01.png');
  recordArtifact(id, 'pdf', 'big.pdf');
  recordArtifact(id, 'evil', '../outside.html');
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  _resetForTests();
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  await rm(homeDir, { recursive: true, force: true });
  await rm(proj, { recursive: true, force: true });
});

async function raw(path) {
  const res = await fetch(`${base}${path}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const headers = Object.fromEntries(res.headers.entries());
  return { status: res.status, headers, body: buf, text: buf.toString('utf8') };
}

test('streams an indexed png with the right headers', async () => {
  const r = await raw(`/api/runs/${id}/artifact-raw/shots/s01.png`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'image/png');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(r.headers['content-disposition'], /^inline; filename="s01\.png"$/);
  assert.equal(r.headers['cache-control'], 'no-store');
  assert.deepEqual([...r.body.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('html is served with a sandboxing CSP and its relative siblings stream too', async () => {
  const r = await raw(`/api/runs/${id}/artifact-raw/deck/deck.html`);
  assert.equal(r.status, 200);
  assert.equal(r.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(r.headers['content-security-policy'], 'sandbox allow-scripts');
  const js = await raw(`/api/runs/${id}/artifact-raw/deck/deck-stage.js`);
  assert.equal(js.status, 200);
  // No fetch metadata: served as text, never as a script (V16); the deck's own frame is pinned below.
  assert.equal(js.headers['content-type'], 'text/plain; charset=utf-8');
});

test('unknown extension → 415, unindexed path → 404, traversal row → 404, oversize → 413', async () => {
  assert.equal((await raw(`/api/runs/${id}/artifact-raw/deck/thing.xyz`)).status, 415);
  assert.equal((await raw(`/api/runs/${id}/artifact-raw/not/indexed.png`)).status, 404);
  assert.equal((await raw(`/api/runs/${id}/artifact-raw/../outside.html`)).status, 404);
  const big = await raw(`/api/runs/${id}/artifact-raw/big.pdf`);
  assert.equal(big.status, 413);
  assert.deepEqual(JSON.parse(big.text), { error: 'artifact too large to preview', rel: 'big.pdf', size: 26 * 1024 * 1024 });
});

test('the history twin exists and its key is guarded', async () => {
  assert.equal((await raw(`/api/history/${key}/${id}/artifact-raw/shots/s01.png`)).status, 200);
  assert.equal((await raw(`/api/history/${encodeURIComponent('bad key')}/${id}/artifact-raw/shots/s01.png`)).status, 404);
});

// The viewer frames a deck with sandbox="allow-scripts" and no allow-same-origin,
// so it has an opaque origin and every @font-face fetch is CORS-mode. Without an
// allow-origin header the deck renders in fallback type — on the very path the
// builder contract mandates. Scoped to fonts/media: scripts and styles are not
// CORS-gated, and a broader header would let the framed script read bytes it can
// currently only execute.
// The localhost-only guard is the product's security boundary, and every part of
// a sandboxed iframe's request is attacker-controllable: any page can produce
// `Origin: null` from `<iframe sandbox="allow-scripts">`, and `Host:
// localhost:PORT` is just what the browser sends when fetching localhost. An
// exemption for it — added here to make a previewed deck's webfonts load — meant
// any site the user visited while worca was running could read a run's
// font/media bytes and probe artifact paths. The typography is not worth it: the
// PDF and the standalone embed their fonts, and only the in-app preview falls
// back.
test('an opaque-origin or a real cross-site origin request is refused, however local it claims to be', async () => {
  for (const [origin, rel] of [['null', 'deck/poppins-400.woff2'], ['null', 'deck/deck.html'], ['null', 'shots/s01.png'],
    ['https://evil.example', 'deck/poppins-400.woff2']]) {
    const res = await fetch(`${base}/api/runs/${id}/artifact-raw/${rel}`, { headers: { Origin: origin } });
    assert.equal(res.status, 403, `${rel} must not be reachable from Origin: ${origin}`);
  }
});

test('no artifact response carries a wildcard allow-origin header', async () => {
  for (const rel of ['deck/poppins-400.woff2', 'deck/deck.html', 'deck/deck-stage.js', 'shots/s01.png']) {
    const r = await raw(`/api/runs/${id}/artifact-raw/${rel}`);
    assert.equal(r.status, 200, rel);
    assert.equal(r.headers['access-control-allow-origin'], undefined, rel);
  }
});


// V16: the shell's CSP `script-src 'self'` admits any script on this origin, so agent-written JS served from
// the artifact route would run in the shell if a script tag could be injected. A script load from this very
// origin is refused; a sandboxed deck frame (opaque origin = cross-site) and the viewer's text fetch still work.
function rawWith(path, headers) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${path}`, { headers }, (res) => {
      const parts = [];
      res.on('data', (c) => parts.push(c));
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], text: Buffer.concat(parts).toString('utf8') }));
    }).on('error', reject);
  });
}

test('V16: artifact JS is not served to a script load from the worca origin itself', async () => {
  const url = `/api/runs/${id}/artifact-raw/deck/deck-stage.js`;
  for (const dest of ['script', 'worker', 'sharedworker', 'serviceworker']) {
    const r = await rawWith(url, { 'sec-fetch-dest': dest, 'sec-fetch-site': 'same-origin' });
    assert.equal(r.status, 403, dest);
  }
  const deck = await rawWith(url, { 'sec-fetch-dest': 'script', 'sec-fetch-site': 'cross-site' });
  assert.deepEqual([deck.status, deck.type], [200, 'text/javascript; charset=utf-8'], 'a sandboxed deck frame runs it');
  const viewer = await rawWith(url, { 'sec-fetch-dest': 'empty', 'sec-fetch-site': 'same-origin' });
  assert.deepEqual([viewer.status, viewer.type], [200, 'text/plain; charset=utf-8'], 'the viewer reads it as text');
  // A browser that sends no fetch metadata cannot be told apart from the worca page: text, which nosniff never runs.
  const bare = await rawWith(url, {});
  assert.deepEqual([bare.status, bare.type], [200, 'text/plain; charset=utf-8'], 'no fetch metadata: never a script');
  assert.equal((await rawWith(`${url}?download=1`, { 'sec-fetch-site': 'same-origin' })).status, 200);
});

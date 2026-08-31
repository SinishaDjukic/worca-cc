import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { useTempHome } from './helpers/temp-home.mjs';

// MIN-108: express.json() used to be mounted BEFORE the DNS-rebinding guard, so a
// malformed body answered with express's default HTML error page — thrown stack,
// absolute node_modules paths — and did so even for a request the guard would have
// refused. Everything on these routes must answer { error } as JSON.
//
// Sandbox boot lifted from test/api-workflows-graph.test.mjs:17-37 (only the
// mkdtemp prefix differs). node's fetch() silently DROPS a Host header (it is a
// forbidden header name), so the guard cases go through http.request directly.
useTempHome(after);

let homeDir, srv, base, prevHome, port;

before(async () => {
  homeDir = await mkdtemp(join(tmpdir(), 'worca-cc-bodyerr-'));
  prevHome = process.env.WORCA_HOME;
  process.env.WORCA_HOME = homeDir;
  process.env.WORCA_MOCK = '1';                       // keep /api/run offline
  const { app } = await import('../ui/server.mjs');   // imported => no port bind
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  port = srv.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  if (prevHome === undefined) delete process.env.WORCA_HOME; else process.env.WORCA_HOME = prevHome;
  delete process.env.WORCA_MOCK;
  await rm(homeDir, { recursive: true, force: true });
});

/** POST a RAW body with full control of Host/Origin. Returns the status, the
 *  content-type and the untouched text, so the HTML-vs-JSON claim is testable. */
const raw = (body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port, path: '/api/workflows', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers },
  }, (res) => {
    let text = '';
    res.setEncoding('utf8');
    res.on('data', (c) => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'] || '', text }));
  });
  req.on('error', reject);
  req.end(body);
});

const assertCleanJson = (r) => {
  assert.match(r.type, /application\/json/, `content-type was ${r.type}`);
  assert.equal(r.text.includes('<!DOCTYPE'), false, 'never an HTML error page');
  assert.equal(/node_modules|\/Users\/|\/private\/tmp|\bat \w+ \(/.test(r.text), false,
    `no stack / absolute path leaked: ${r.text.slice(0, 200)}`);
  return JSON.parse(r.text);
};

test('a malformed JSON body answers 400 { error } as JSON, not an HTML stack trace', async () => {
  const r = await raw('{ not json');
  assert.equal(r.status, 400);
  assert.deepEqual(assertCleanJson(r), { error: 'malformed JSON body' });
});

test('the loopback guard runs BEFORE the body parser: a bad Host 403s even on a malformed body', async () => {
  const r = await raw('{ not json', { Host: 'evil.example.com' });
  assert.equal(r.status, 403, 'the guard, not the parser, answers');
  assert.deepEqual(assertCleanJson(r), { error: 'forbidden: worca is a localhost-only tool' });
});

test('the guard keeps its Origin half: a bad Origin 403s on a malformed body too', async () => {
  const r = await raw('{ not json', { Origin: 'http://evil.example.com' });
  assert.equal(r.status, 403);
  assert.deepEqual(assertCleanJson(r), { error: 'forbidden: worca is a localhost-only tool' });
});

test('a body past the 8mb cap answers 413 { error } as JSON', async () => {
  const r = await raw(JSON.stringify({ version: 2, name: 'x', pad: 'a'.repeat(9 * 1024 * 1024) }));
  assert.equal(r.status, 413);
  assert.deepEqual(assertCleanJson(r), { error: 'request body too large' });
});

test('a well-formed body still reaches the route (the parser is not bypassed)', async () => {
  const r = await raw(JSON.stringify({ version: 2 }));
  assert.equal(r.status, 400);
  assert.deepEqual(assertCleanJson(r), { error: 'name is required' });
  const ok = await fetch(`${base}/api/workflows`);
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray((await ok.json()).workflows));
});

// test/design-export-routes.test.mjs — Design P6 Task 5: `POST /api/design/:id/export` on a bare Express app over the
// real store. The `design` gate (the route is outside DESIGN_ROUTES, so this file walks its gate), each format's answer,
// refusals as JSON the dialog can show, a stopped round refusing every format, the PDF at the queue's front, and a
// closed connection stopping the zip and the print.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync } from 'fflate';
import express from 'express';
import { useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { exportApp, PLAN, seedDone } from './helpers/design-export-seed.mjs';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { ExportRefusal, zipDist } from '../src/core/design/export.mjs';
import { designWorkDir, distDir, thumbFile } from '../src/core/design/paths.mjs';
import { RESTORE_RUNNING, ROUND_STARTING } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { deleteDesign, updateDesign } from '../src/core/design/store.mjs';

const servers = [];
after(async () => {
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
const home = useDesignEnv(after);

/** A rig built with `over`, listening on 127.0.0.1. */
async function listen(over = {}) {
  const srv = exportApp(over).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  servers.push(srv);
  return { port: srv.address().port };
}
async function postTo(port, id, body) {
  const r = await fetch(`http://127.0.0.1:${port}/api/design/${id}/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null;
  try { json = JSON.parse(buf.toString()); } catch { /* a file, not JSON */ }
  return { status: r.status, headers: r.headers, buf, json };
}
let rig = null;
/** One shared rig, so a second copy into `p1` meets the first. */
async function post(id, body) {
  rig ??= await listen();
  return postTo(rig.port, id, body);
}
async function postWith(over, id, body) {
  return postTo((await listen(over)).port, id, body);
}

test('flag off: the new routes answer the gate 404', async () => {
  const d = seedDone(); writeFileSync(thumbFile(d.id), 'PNG'); rig ??= await listen();
  delete process.env.WORCA_FLAGS;
  try {
    assert.deepEqual((await post(d.id, { format: 'html' })).json, { error: 'not found' });
    const thumb = await fetch(`http://127.0.0.1:${rig.port}/api/design/${d.id}/thumb`);
    assert.deepEqual([thumb.status, await thumb.json()], [404, { error: 'not found' }]);
  } finally { process.env.WORCA_FLAGS = 'design'; }
});
test('html: a download, with its problems in a header', async () => {
  const r = await post(seedDone().id, { format: 'html' });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="ship-radar\.html"/);
  assert.equal(r.headers.get('content-security-policy'), 'sandbox');
  assert.deepEqual(JSON.parse(decodeURIComponent(r.headers.get('x-worca-export-problems'))), { total: 1, shown: [{ ref: 'https://x.dev/a.png', why: 'remote' }] });
  assert.equal(r.buf.toString().includes(BRIDGE_MARKER), false);
});
test('zip: real bytes', async () => {
  const r = await post(seedDone().id, { format: 'zip' });
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.ok('ship-radar/index.html' in unzipSync(new Uint8Array(r.buf)));
});
test('project: copies to design/<stem> by default; refusals are JSON the dialog can show', async () => {
  const d = seedDone();
  assert.deepEqual((await post(d.id, { format: 'project', projectKey: 'p1' })).json, { ok: true, target: 'design/ship-radar', files: 3, projectKey: 'p1' });
  const again = await post(d.id, { format: 'project', projectKey: 'p1' });
  assert.equal(again.status, 409); assert.equal(again.json.code, 'exists'); assert.equal(again.json.total, 3);
  assert.equal((await post(d.id, { format: 'project', projectKey: 'p1', overwrite: true, collisionsKey: again.json.collisionsKey })).status, 200);
  assert.equal((await post(d.id, { format: 'project', projectKey: 'nope' })).json.code, 'no-project');
  assert.equal((await post(d.id, { format: 'project', projectKey: 'p1', subdir: '.git/x' })).json.code, 'git-folder');
});
// Review cycle 2, C1: Replace these files replaces only the list the person was shown.
test('project: overwrite replaces only the collisions it was shown; a list that grew is a new 409 and writes nothing', async () => {
  const d = seedDone(); const proj = mkdtempSync(join(home, 'proj-')); const t = join(proj, 'design/ship-radar');
  const { port } = await listen({ listProjects: async () => [{ key: 'p1', name: 'One', path: proj, exists: true }] });
  mkdirSync(t, { recursive: true }); writeFileSync(join(t, 'index.html'), 'MINE');
  const first = await postTo(port, d.id, { format: 'project', projectKey: 'p1' });
  assert.deepEqual([first.status, first.json.code, first.json.collisions, first.json.total], [409, 'exists', ['index.html'], 1]);
  assert.match(first.json.collisionsKey, /^[0-9a-f]{64}$/);
  mkdirSync(join(t, 'assets')); writeFileSync(join(t, 'assets/logo.png'), 'MINE TOO');   // collides now, never listed
  const grown = await postTo(port, d.id, { format: 'project', projectKey: 'p1', overwrite: true, collisionsKey: first.json.collisionsKey });
  assert.deepEqual([grown.status, grown.json.code, grown.json.collisions, grown.json.total], [409, 'exists', ['assets/logo.png', 'index.html'], 2]);
  assert.notEqual(grown.json.collisionsKey, first.json.collisionsKey);
  assert.deepEqual([readFileSync(join(t, 'index.html'), 'utf8'), readFileSync(join(t, 'assets/logo.png'), 'utf8')], ['MINE', 'MINE TOO'], 'nothing replaced');
  assert.equal(existsSync(join(t, 'sections')), false, 'nothing written');
  const ok = await postTo(port, d.id, { format: 'project', projectKey: 'p1', overwrite: true, collisionsKey: grown.json.collisionsKey });
  assert.deepEqual(ok.json, { ok: true, target: 'design/ship-radar', files: 3, projectKey: 'p1' });
  assert.equal(readFileSync(join(t, 'assets/logo.png'), 'utf8'), 'PNG');
});
test('bad input: overwrite without the collisions key is a 400 with words, and nothing is written', async () => {
  const d = seedDone(); const proj = mkdtempSync(join(home, 'proj-'));
  const { port } = await listen({ listProjects: async () => [{ key: 'p1', name: 'One', path: proj, exists: true }] });
  for (const extra of [{}, { collisionsKey: 5 }, { collisionsKey: '' }]) {
    const r = await postTo(port, d.id, { format: 'project', projectKey: 'p1', overwrite: true, ...extra });
    assert.deepEqual([r.status, r.json], [400, { error: 'overwrite needs the collisionsKey of the list it replaces' }], JSON.stringify(extra));
  }
  assert.equal(existsSync(join(proj, 'design')), false);
});
test('bad input', async () => {
  const d = seedDone();
  assert.equal((await post(d.id, { format: 'mp4' })).status, 400);
  assert.equal((await post(d.id, { format: 'project', projectKey: 'p1', overwrite: 'yes' })).status, 400);
  assert.equal((await post('d_000000000000', { format: 'html' })).status, 404);
});
test('a stopped round refuses every format', async () => {
  const d = seedDone({}); updateDesign(d.id, { status: 'stopped' });
  writeFileSync(join(designWorkDir(d.id), 'sections/hero/index.html'), '<section data-section="hero">half an edit');
  for (const format of ['html', 'zip', 'pdf', 'project']) {
    const r = await post(d.id, { format, projectKey: 'p1' });
    assert.deepEqual([r.status, r.json.code], [409, 'not-done'], format);
  }
});
test('pdf: runs through the queue at the front; a refusal is JSON', async () => {
  const fronts = []; const queue = { run: (fn, o) => { fronts.push(o?.front); return fn(); } };
  const d = updateDesign(seedDone().id, { status: 'done' });
  const r = await postWith({ queue, print: async () => { throw new ExportRefusal(422, 'no-chrome', 'x'); } }, d.id, { format: 'pdf' });
  assert.deepEqual([r.status, r.json.code], [422, 'no-chrome']); assert.deepEqual(fronts, [true]);
});
test('a closed connection stops the zip and the print', async () => {
  const seen = {};
  const srv = await listen({ zip: (o) => { seen.zip = o.signal; return zipDist(o); }, print: (o) => new Promise((_, rej) => { seen.print = o.signal; o.signal.addEventListener('abort', () => { seen.cleaned = true; rej(Object.assign(new Error('x'), { name: 'AbortError' })); }); }) });
  const d = seedDone({ 'assets/big.bin': randomBytes(2 * 1024 * 1024).toString('hex') }); assembleDesign({ workDir: designWorkDir(d.id), plan: PLAN, mode: 'dist' });
  const zipReq = http.request({ host: '127.0.0.1', port: srv.port, path: `/api/design/${d.id}/export`, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => res.once('data', () => zipReq.destroy()));
  zipReq.on('error', () => {}); zipReq.end(JSON.stringify({ format: 'zip' }));
  await waitUntil(() => seen.zip?.aborted);
  const pdfReq = http.request({ host: '127.0.0.1', port: srv.port, path: `/api/design/${d.id}/export`, method: 'POST', headers: { 'content-type': 'application/json' } });
  pdfReq.on('error', () => {}); pdfReq.end(JSON.stringify({ format: 'pdf' }));
  await waitUntil(() => seen.print); pdfReq.destroy();
  await waitUntil(() => seen.cleaned);
});

// Beyond the plan's rows: each pins a part of the route the rows above leave open (the mutation check).
test('html: the download is never sniffed or cached', async () => {
  const r = await post(seedDone().id, { format: 'html' });
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('zip: the attachment is named after the design and holds every dist file under one folder', async () => {
  const r = await post(seedDone().id, { format: 'zip' });
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="ship-radar\.zip"/);
  assert.deepEqual(Object.keys(unzipSync(new Uint8Array(r.buf))).sort(), ['ship-radar/assets/logo.png', 'ship-radar/index.html', 'ship-radar/sections/hero/assets/é a.svg']);
});
test('pdf: the printed file is sent with its problems, the print gets the plan and Chrome, and its folder goes after', async () => {
  const dir = mkdtempSync(join(home, 'pdf-')); const file = join(dir, 'deck.pdf'); writeFileSync(file, '%PDF-1.4 x');
  const got = {}; let cleaned = 0;
  const print = async (o) => { Object.assign(got, o); return { file, name: 'ship-radar.pdf', pages: 1, slides: 1, problems: [{ ref: 'a.png', why: 'missing' }], cleanup: () => { cleaned += 1; } }; };
  const r = await postWith({ print, chrome: () => '/x/chrome' }, seedDone().id, { format: 'pdf' });
  assert.deepEqual([r.status, r.headers.get('content-type'), r.buf.toString()], [200, 'application/pdf', '%PDF-1.4 x']);
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="ship-radar\.pdf"/);
  assert.deepEqual(JSON.parse(decodeURIComponent(r.headers.get('x-worca-export-problems'))), { total: 1, shown: [{ ref: 'a.png', why: 'missing' }] });
  assert.equal(got.chrome, '/x/chrome'); assert.deepEqual(got.plan.sections.map((s) => s.id), ['hero']); assert.equal(got.design.title, 'Ship Radar');
  assert.ok(got.signal instanceof AbortSignal);
  await waitUntil(() => cleaned === 1);
  assert.equal(existsSync(file), true, 'the route leaves the removing to cleanup()');
});
test('project: an absent folder is no-project with words; a subdir is honoured', async () => {
  const d = seedDone();
  const gone = await postWith({ listProjects: async () => [{ key: 'p1', name: 'One', path: '/nope', exists: false }] }, d.id, { format: 'project', projectKey: 'p1' });
  assert.deepEqual([gone.status, gone.json], [422, { error: 'That project is not available.', code: 'no-project' }]);
  assert.equal((await post(d.id, { format: 'project', projectKey: 1 })).json.code, 'no-project');
  assert.deepEqual((await post(d.id, { format: 'project', projectKey: 'p1', subdir: 'site/out' })).json, { ok: true, target: 'site/out', files: 3, projectKey: 'p1' });
});
test('bad input: the 400s say what is wrong; a body-less request is a format 400', async () => {
  const d = seedDone();
  assert.deepEqual((await post(d.id, { format: 'mp4' })).json, { error: 'format must be html, zip, pdf or project' });
  assert.deepEqual((await post(d.id, { format: 'project', projectKey: 'p1', overwrite: 'yes' })).json, { error: 'overwrite must be true or false' });
  assert.equal((await post(d.id, { format: 'html', overwrite: false })).status, 200);
  const port = rig.port;
  const r = await fetch(`http://127.0.0.1:${port}/api/design/${d.id}/export`, { method: 'POST' });
  assert.deepEqual([r.status, await r.json()], [400, { error: 'format must be html, zip, pdf or project' }]);
});
test('a person leaving ends the zip (a destroyed socket never drains) and is not logged as a failure', async () => {
  const seen = {}; const logged = []; const orig = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    // 1 MiB writes back to back: every write waits on `drain`, so the socket closes during that wait.
    const big = new Uint8Array(1024 * 1024);
    const srv = await listen({
      zip: async (o) => { try { for (let i = 0; i < 64; i += 1) await o.write(big); } finally { seen.zipEnded = true; } },
      print: (o) => new Promise((_, rej) => { seen.print = true; o.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))); }),
    });
    const d = seedDone({ 'assets/big.bin': randomBytes(2 * 1024 * 1024).toString('hex') });
    const send = (format, onRes) => {
      const req = http.request({ host: '127.0.0.1', port: srv.port, path: `/api/design/${d.id}/export`, method: 'POST', headers: { 'content-type': 'application/json' } }, onRes);
      req.on('error', () => {}); req.end(JSON.stringify({ format })); return req;
    };
    const zipReq = send('zip', (res) => res.once('data', () => zipReq.destroy()));
    await waitUntil(() => seen.zipEnded);
    const pdfReq = send('pdf');
    await waitUntil(() => seen.print); pdfReq.destroy();
    await new Promise((r) => setTimeout(r, 50));
  } finally { console.error = orig; }
  assert.deepEqual(logged, []);
});
test('a print that finishes after the person left is not sent, and its folder still goes', async () => {
  const dir = mkdtempSync(join(home, 'pdf-')); const file = join(dir, 'deck.pdf'); writeFileSync(file, '%PDF-1.4 x');
  const seen = {}; let cleaned = 0; const logged = []; const orig = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    const srv = await listen({ print: (o) => new Promise((done) => { seen.print = true; o.signal.addEventListener('abort', () => done({ file, name: 'x.pdf', problems: [], cleanup: () => { cleaned += 1; } })); }) });
    const req = http.request({ host: '127.0.0.1', port: srv.port, path: `/api/design/${seedDone().id}/export`, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { seen.answered = res.statusCode; });
    req.on('error', () => {}); req.end(JSON.stringify({ format: 'pdf' }));
    await waitUntil(() => seen.print); req.destroy();
    await waitUntil(() => cleaned === 1);
    await new Promise((r) => setTimeout(r, 50));
  } finally { console.error = orig; }
  assert.deepEqual([cleaned, seen.answered, logged], [1, undefined, []]);
});
test('in the real registration: the same gate, designFor and the real project list', async () => {
  const app = express(); app.use(express.json());
  registerDesignRoutes(app, { deps: { designBuilds: {} } });
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r)); servers.push(srv);
  const at = (id, body) => postTo(srv.address().port, id, body);
  const d = seedDone();
  delete process.env.WORCA_FLAGS;
  try { assert.deepEqual((await at(d.id, { format: 'html' })).json, { error: 'not found' }); } finally { process.env.WORCA_FLAGS = 'design'; }
  assert.deepEqual((await at('d_000000000000', { format: 'html' })).json, { error: 'design not found' });
  assert.equal((await at(d.id, { format: 'project', projectKey: 'nope' })).json.code, 'no-project');
  assert.equal((await at(d.id, { format: 'html' })).status, 200);
});
// Review cycle 1, M4 and M6: a round, a restore or a hand-off that begins while an export waits or reads.
test('a print checks the round again when its turn in the queue comes, and prints nothing for a changed one', async () => {
  let release = null;
  const queue = { run: (fn) => new Promise((ok, no) => { release = () => { try { Promise.resolve(fn()).then(ok, no); } catch (e) { no(e); } }; }) };
  let printed = 0; let busy = null;
  const print = async () => { printed += 1; throw new ExportRefusal(422, 'no-chrome', 'x'); };
  const { port } = await listen({ queue, print, held: () => busy });
  const d = seedDone();
  const first = postTo(port, d.id, { format: 'pdf' });
  await waitUntil(() => release);
  updateDesign(d.id, { status: 'building' }); writeFileSync(join(designWorkDir(d.id), 'sections/hero/index.html'), '<section data-section="hero">half an edit');
  release();
  const r = await first;
  assert.deepEqual([r.status, r.json.code], [409, 'not-done'], 'a round began while it waited');
  release = null;
  const second = postTo(port, seedDone().id, { format: 'pdf' });
  await waitUntil(() => release);
  busy = 'A restore is running: try again in a moment';
  release();
  const s = await second;
  assert.deepEqual([s.status, s.json], [409, { error: busy, code: 'busy' }], 'a restore began while it waited');
  busy = null; release = null;
  const gone = seedDone(); const third = postTo(port, gone.id, { format: 'pdf' });
  await waitUntil(() => release);
  deleteDesign(gone.id);
  release();
  const t = await third;
  assert.deepEqual([t.status, t.json], [404, { error: 'design not found', code: 'not-found' }], 'deleted while it waited');
  assert.equal(printed, 0);
});
test('a print whose person left while it waited in the queue never starts', async () => {
  let release = null; let printed = 0; let closed = false;
  const queue = { run: (fn) => new Promise((ok, no) => { release = () => { try { Promise.resolve(fn()).then(ok, no); } catch (e) { no(e); } }; }) };
  const srv = exportApp({ queue, print: async () => { printed += 1; throw new ExportRefusal(422, 'no-chrome', 'x'); } }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r)); servers.push(srv);
  // Registered after the server's own: when it runs, the response has closed and the request's signal is aborted.
  srv.on('connection', (sock) => sock.on('close', () => { closed = true; }));
  const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: `/api/design/${seedDone().id}/export`, method: 'POST', headers: { 'content-type': 'application/json' } });
  req.on('error', () => {}); req.end(JSON.stringify({ format: 'pdf' }));
  await waitUntil(() => release);
  req.destroy();
  await waitUntil(() => closed);
  release(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(printed, 0);
});
test('a restore or a hand-off holding the design refuses every format at once', async () => {
  const d = seedDone(); const seen = [];
  const { port } = await listen({ held: (id) => { seen.push(id); return 'A round is starting: try again in a moment'; } });
  for (const format of ['html', 'zip', 'pdf', 'project']) {
    const r = await postTo(port, d.id, { format, projectKey: 'p1' });
    assert.deepEqual([r.status, r.json], [409, { error: 'A round is starting: try again in a moment', code: 'busy' }], format);
  }
  assert.ok(seen.every((id) => id === d.id));
});
test('zip and copy read the round they were asked for: a dist written meanwhile does not reach them', async () => {
  const d = seedDone(); const proj = mkdtempSync(join(home, 'proj-')); const seen = {};
  let openZip; const zipGate = new Promise((r) => { openZip = r; });
  let openList; const listGate = new Promise((r) => { openList = r; });
  const { port } = await listen({
    zip: async (o) => { seen.dist = o.dist; await zipGate; return zipDist(o); },
    listProjects: async () => { seen.listed = true; await listGate; return [{ key: 'p1', name: 'One', path: proj, exists: true }]; },
  });
  const nextRound = () => {
    writeFileSync(join(designWorkDir(d.id), 'sections/hero/index.html'), '<section data-section="hero">THE NEXT ROUND</section>');
    assembleDesign({ workDir: designWorkDir(d.id), plan: PLAN, mode: 'dist' });
  };
  const zipping = postTo(port, d.id, { format: 'zip' });
  await waitUntil(() => seen.dist);
  assert.notEqual(seen.dist, distDir(d.id), 'the zip reads a copy');
  nextRound(); openZip();
  const z = await zipping;
  const page = Buffer.from(unzipSync(new Uint8Array(z.buf))['ship-radar/index.html']).toString();
  assert.ok(page.includes('logo.png') && !page.includes('THE NEXT ROUND'), 'one round in the zip');
  assert.equal(existsSync(seen.dist), false, 'its copy goes afterwards');
  writeFileSync(join(designWorkDir(d.id), 'sections/hero/index.html'), '<section data-section="hero"><img src="assets/logo.png"></section>');
  assembleDesign({ workDir: designWorkDir(d.id), plan: PLAN, mode: 'dist' });
  const copying = postTo(port, d.id, { format: 'project', projectKey: 'p1' });
  await waitUntil(() => seen.listed);
  nextRound(); openList();
  assert.equal((await copying).status, 200);
  const copied = readFileSync(join(proj, 'design/ship-radar/index.html'), 'utf8');
  assert.ok(copied.includes('logo.png') && !copied.includes('THE NEXT ROUND'), 'one round in the project');
});
test('in the real registration: a restore or a hand-off of the design refuses the export', async () => {
  const d = seedDone(); const state = { restoring: false, starting: false };
  const app = express(); app.use(express.json());
  registerDesignRoutes(app, { deps: { designBuilds: { restoring: (id) => id === d.id && state.restoring, starting: (id) => id === d.id && state.starting } } });
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r)); servers.push(srv);
  const at = (body) => postTo(srv.address().port, d.id, body);
  state.restoring = true;
  assert.deepEqual((await at({ format: 'html' })).json, { error: RESTORE_RUNNING, code: 'busy' });
  state.restoring = false; state.starting = true;
  assert.deepEqual((await at({ format: 'zip' })).json, { error: ROUND_STARTING, code: 'busy' });
  state.starting = false;
  assert.equal((await at({ format: 'html' })).status, 200);
});
test('an unexpected failure is a 500 with words; the log keeps the message', async () => {
  const logged = []; const orig = console.error; console.error = (...a) => { logged.push(a.join(' ')); };
  try {
    const r = await postWith({ zip: async () => { throw new Error('EACCES /srv/secret'); } }, seedDone().id, { format: 'zip' });
    assert.deepEqual([r.status, r.json, r.headers.get('content-disposition')], [500, { error: 'Could not make the file.' }, null]);
  } finally { console.error = orig; }
  assert.ok(logged.some((l) => l.includes('EACCES /srv/secret')), logged.join('\n'));
});

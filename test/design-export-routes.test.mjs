// test/design-export-routes.test.mjs — Design P6 Task 5: `POST /api/design/:id/export` on a bare Express app over the
// real store. The `design` gate (the route is outside DESIGN_ROUTES, so this file walks its gate), each format's answer,
// refusals as JSON the dialog can show, a stopped round refusing every format, the PDF at the queue's front, and a
// closed connection stopping the zip and the print.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { unzipSync } from 'fflate';
import express from 'express';
import { useDesignEnv, waitUntil } from './helpers/design-fixture.mjs';
import { exportApp, PLAN, SHELL, seedDone } from './helpers/design-export-seed.mjs';
import { assembleDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { ExportRefusal, zipDist } from '../src/core/design/export.mjs';
import { designWorkDir, distDir, kitDir, thumbFile } from '../src/core/design/paths.mjs';
import { RESTORE_RUNNING, ROUND_STARTING } from '../src/core/design/registry.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import { createDesign, deleteDesign, updateDesign } from '../src/core/design/store.mjs';
import { createFilmExports } from '../src/core/design/film-mp4.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';

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
  process.env.WORCA_FLAGS = '-design';
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
  assert.equal((await post(d.id, { format: 'gif' })).status, 400);
  assert.equal((await post(d.id, { format: 'project', projectKey: 'p1', overwrite: 'yes' })).status, 400);
  assert.equal((await post('d_000000000000', { format: 'html' })).status, 404);
});
test('a stopped round refuses every format', async () => {
  const d = seedDone({}); updateDesign(d.id, { status: 'stopped' });
  writeFileSync(join(designWorkDir(d.id), 'sections/hero/index.html'), '<section data-section="hero">half an edit');
  for (const format of ['html', 'zip', 'pdf', 'mp4', 'project']) {
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
  assert.deepEqual((await post(d.id, { format: 'gif' })).json, { error: 'format must be html, zip, pdf, mp4 or project' });
  assert.deepEqual((await post(d.id, { format: 'project', projectKey: 'p1', overwrite: 'yes' })).json, { error: 'overwrite must be true or false' });
  assert.equal((await post(d.id, { format: 'html', overwrite: false })).status, 200);
  const port = rig.port;
  const r = await fetch(`http://127.0.0.1:${port}/api/design/${d.id}/export`, { method: 'POST' });
  assert.deepEqual([r.status, await r.json()], [400, { error: 'format must be html, zip, pdf, mp4 or project' }]);
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
  process.env.WORCA_FLAGS = '-design';
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
  for (const format of ['html', 'zip', 'pdf', 'mp4', 'project']) {
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
// Review M10: a deck from before P7 has no work/.kit, so exportHtml rejects: the route answers its 422 `kit` as JSON.
test('html: a deck whose kit is gone is a 422 kit with words, not a download', async () => {
  const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [{ id: 's1', job: 'One', brief: 'b', parts: ['html'] }] };
  const d = createDesign({ kind: 'pitch', title: 'Old deck' }, { by: 'local' }); const w = designWorkDir(d.id);
  const put = (rel, t) => { mkdirSync(join(w, rel, '..'), { recursive: true }); writeFileSync(join(w, rel), t); };
  put('plan.json', JSON.stringify(DECK)); put('shell.html', SHELL); put('sections/s1/index.html', '<section data-section="s1" data-label="One">1</section>');
  for (const name of ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js']) put(`.kit/${name}`, '');
  assembleDesign({ workDir: w, plan: DECK, mode: 'dist' }); updateDesign(d.id, { status: 'done' });
  rmSync(kitDir(d.id), { recursive: true, force: true });
  // Bounded: an export route that loses the rejection never answers.
  rig ??= await listen();
  const r = await fetch(`http://127.0.0.1:${rig.port}/api/design/${d.id}/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ format: 'html' }), signal: AbortSignal.timeout(5000) });
  assert.deepEqual([r.status, await r.json(), r.headers.get('content-disposition')],
    [422, { error: 'The kit file deck-stage.js is missing. Start a new round to stage it again.', code: 'kit' }, null]);
});

test('the route prints through printDesignPdf: a document gets its PDF, a web page the pdf-kinds refusal', { skip: process.platform === 'win32' ? 'a shebang fake Chrome' : false }, async () => {
  // A fake Chrome: it writes a two-page PDF where --print-to-pdf points, as the real one does.
  const bin = join(mkdtempSync(join(home, 'chrome-')), 'chrome');
  writeFileSync(bin, `#!${process.execPath}\nconst a = process.argv.find((x) => x.startsWith('--print-to-pdf='));\nrequire('node:fs').writeFileSync(a.slice(15), '%PDF-1.7\\n<< /Type /Page >>\\n<< /Type /Page >>\\n');\n`, { mode: 0o755 });
  const doc = seedDone({ 'sections/hero/index.html': '<section data-section="hero"><h2 id="hero-title">Hero</h2></section>' }, { kind: 'document' });
  const { port } = await listen({ chrome: () => bin });
  const r = await postTo(port, doc.id, { format: 'pdf' });
  assert.equal(r.status, 200, r.buf.toString());
  assert.equal(r.headers.get('content-type'), 'application/pdf');
  assert.ok(r.buf.toString().startsWith('%PDF'));
  const web = await postTo(port, seedDone().id, { format: 'pdf' });
  assert.deepEqual([web.status, web.json?.code, web.json?.error], [422, 'pdf-kinds', 'PDF is for decks and documents.']);
});

// A video exports as an MP4 (film-mp4.mjs): a render takes about as long as the film runs, so the route starts a job
// and answers its status; the dialog asks again until the file is ready, then fetches it by the round's key.
const FILM_PLAN = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '',
  sections: [{ id: 'a', job: 'a', brief: 'b', parts: ['html', 'css', 'js'], duration: 2 }] };
/** A finished video titled `Clay Day`: one scene, `dist/` assembled. */
async function seedFilm() {
  const d = createDesign({ kind: 'video', title: 'Clay Day' }, { by: 'local' }); const w = designWorkDir(d.id);
  writeFileSync(join(w, 'plan.json'), JSON.stringify(FILM_PLAN)); writeFileSync(join(w, 'shell.html'), SHELL);
  mkdirSync(join(w, 'sections/a'), { recursive: true }); writeFileSync(join(w, 'sections/a/index.html'), '<div data-section="a" data-scene><b>A</b></div>');
  await stageDesignKit({ kind: 'video', workDir: w });
  assembleDesign({ workDir: w, plan: FILM_PLAN, mode: 'dist' });
  return updateDesign(d.id, { status: 'done' });
}
/** The jobs as the route sees them, recorded: `over` replaces any answer. */
function fakeFilms(over = {}) {
  const calls = [];
  const films = {
    start: async (design) => { calls.push(['start', design.id]); return { state: 'rendering', done: 0, total: 120, key: 'k1' }; },
    status: (id) => { calls.push(['status', id]); return { state: 'rendering', done: 60, total: 120, key: 'k1' }; },
    stop: (id) => { calls.push(['stop', id]); },
    file: (design, key) => { calls.push(['file', design.id, key]); return null; },
    ...over,
  };
  return { films, calls };
}
const mp4Url = (port, id, rest = '') => `http://127.0.0.1:${port}/api/design/${id}/export/mp4${rest}`;

test('mp4: only a video; a web page gets the refusal and no job starts', async () => {
  const { films, calls } = fakeFilms();
  const r = await postWith({ films }, seedDone().id, { format: 'mp4' });
  assert.deepEqual([r.status, r.json], [422, { error: 'Only a video exports as MP4.', code: 'not-video' }]);
  assert.deepEqual(calls, []);
});
test('mp4: the POST starts the job and answers its status: 202 while it renders, 200 when the file is ready', async () => {
  const d = await seedFilm();
  const running = fakeFilms();
  const r = await postWith({ films: running.films }, d.id, { format: 'mp4' });
  assert.deepEqual([r.status, r.json, r.headers.get('cache-control')], [202, { state: 'rendering', done: 0, total: 120, key: 'k1' }, 'no-store']);
  assert.deepEqual(running.calls, [['start', d.id]]);
  const ready = { state: 'ready', key: 'k1', bytes: 9, frames: 120, seconds: 2, problems: { total: 0, shown: [] } };
  const done = await postWith({ films: fakeFilms({ start: async () => ready }).films }, d.id, { format: 'mp4' });
  assert.deepEqual([done.status, done.json], [200, ready]);
});
test('mp4: a refusal of the job (no ffmpeg) is JSON the dialog can show; any other failure is a 500 with words', async (t) => {
  const d = await seedFilm();
  const refuse = fakeFilms({ start: async () => { throw new ExportRefusal(422, 'no-ffmpeg', 'Video needs ffmpeg on this machine. brew install ffmpeg.'); } });
  const r = await postWith({ films: refuse.films }, d.id, { format: 'mp4' });
  assert.deepEqual([r.status, r.json], [422, { error: 'Video needs ffmpeg on this machine. brew install ffmpeg.', code: 'no-ffmpeg' }]);
  const logged = t.mock.method(console, 'error', () => {});
  const boom = await postWith({ films: fakeFilms({ start: async () => { throw new Error('ENOSPC /Users/x/secret'); } }).films }, d.id, { format: 'mp4' });
  assert.deepEqual([boom.status, boom.json], [500, { error: 'Could not make the file.' }]);
  assert.match(String(logged.mock.calls[0].arguments[0]), /ENOSPC/);
});
test('mp4: status, stop and the file each go to the design\'s own job', async () => {
  const d = await seedFilm();
  const kept = join(mkdtempSync(join(home, 'film-')), 'film.mp4'); writeFileSync(kept, 'MP4 BYTES');
  const { films, calls } = fakeFilms({ file: (design, key) => { calls.push(['file', design.id, key]); return key === 'k1' ? { path: kept, bytes: 9, name: 'clay-day.mp4' } : null; } });
  const { port } = await listen({ films });
  const status = await fetch(mp4Url(port, d.id));
  assert.deepEqual([status.status, await status.json(), status.headers.get('cache-control')], [200, { state: 'rendering', done: 60, total: 120, key: 'k1' }, 'no-store']);
  const file = await fetch(mp4Url(port, d.id, '/file?key=k1'));
  assert.deepEqual([file.status, file.headers.get('content-type'), file.headers.get('content-length'), file.headers.get('x-content-type-options'), file.headers.get('cache-control')],
    [200, 'video/mp4', '9', 'nosniff', 'no-store']);
  assert.match(file.headers.get('content-disposition'), /^attachment; filename="clay-day\.mp4"/);
  assert.equal(await file.text(), 'MP4 BYTES');
  for (const rest of ['/file?key=other', '/file']) {
    const gone = await fetch(mp4Url(port, d.id, rest));
    assert.deepEqual([gone.status, await gone.json()], [404, { error: 'That video is no longer there. Export it again.', code: 'no-film' }], rest);
  }
  const stopped = await fetch(mp4Url(port, d.id), { method: 'DELETE' });
  assert.deepEqual([stopped.status, await stopped.json()], [200, { state: 'none' }]);
  assert.deepEqual(calls, [['status', d.id], ['file', d.id, 'k1'], ['file', d.id, 'other'], ['file', d.id, undefined], ['stop', d.id]]);
});
test('mp4: the new routes sit behind the gate and the design\'s owner check', async () => {
  const d = await seedFilm(); const { films, calls } = fakeFilms(); const { port } = await listen({ films });
  const each = [[mp4Url(port, d.id), 'GET'], [mp4Url(port, d.id, '/file?key=k1'), 'GET'], [mp4Url(port, d.id), 'DELETE']];
  process.env.WORCA_FLAGS = '-design';
  try {
    for (const [url, method] of each) { const r = await fetch(url, { method }); assert.deepEqual([r.status, await r.json()], [404, { error: 'not found' }], `${method} ${url}`); }
  } finally { process.env.WORCA_FLAGS = 'design'; }
  for (const [url, method] of each) assert.equal((await fetch(url.replace(d.id, 'd_000000000000'), { method })).status, 404, `${method} unknown design`);
  assert.deepEqual(calls, []);
});
test('mp4, end to end over the real jobs: start, ask until ready, fetch the file by its key', async () => {
  const d = await seedFilm();
  const render = async ({ dir, onProgress }) => { onProgress({ done: 120, total: 120 }); writeFileSync(join(dir, 'film.mp4'), 'REAL JOB BYTES'); return { frames: 120, seconds: 2, bytes: 14, violations: [] }; };
  const { port } = await listen({ films: createFilmExports({ render, chrome: () => '/bin/chrome', ffmpeg: () => '/bin/ffmpeg' }) });
  const started = await postTo(port, d.id, { format: 'mp4' });
  assert.equal(started.status, 202);
  let status = started.json;
  for (let i = 0; i < 400 && status.state !== 'ready'; i++) { await new Promise((r) => setTimeout(r, 10)); status = await (await fetch(mp4Url(port, d.id))).json(); }
  assert.deepEqual(status, { state: 'ready', key: started.json.key, bytes: 14, frames: 120, seconds: 2, problems: { total: 0, shown: [] } });
  const file = await fetch(mp4Url(port, d.id, `/file?key=${status.key}`));
  assert.deepEqual([file.status, await file.text()], [200, 'REAL JOB BYTES']);
  assert.deepEqual([(await postTo(port, d.id, { format: 'mp4' })).status, existsSync(join(distDir(d.id), 'index.html'))], [200, true], 'the same round again is ready at once');
});
test('in the real registration: the MP4 routes and the design\'s delete share the jobs; a delete stops the render before the folder goes', async () => {
  const d = await seedFilm(); const { films, calls } = fakeFilms();
  films.forget = async (id) => { calls.push(['forget', id, existsSync(designWorkDir(id))]); };
  const app = express(); app.use(express.json());
  registerDesignRoutes(app, { deps: { designBuilds: { restoring: () => false, starting: () => false }, films } });
  const srv = app.listen(0, '127.0.0.1'); await new Promise((r) => srv.once('listening', r)); servers.push(srv);
  const port = srv.address().port;
  assert.equal((await postTo(port, d.id, { format: 'mp4' })).status, 202);
  const gone = await fetch(`http://127.0.0.1:${port}/api/design/${d.id}`, { method: 'DELETE' });
  assert.deepEqual([gone.status, await gone.json()], [200, { ok: true }]);
  assert.deepEqual(calls, [['start', d.id], ['forget', d.id, true]]);
  assert.equal(existsSync(designWorkDir(d.id)), false);
});

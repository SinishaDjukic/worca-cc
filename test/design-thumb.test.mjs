// test/design-thumb.test.mjs — Design P6 Task 6: thumbnails. `createThumbs` renders a finished design's standalone
// page with scripts off, sized by its canvas, once per newer dist, and stays quiet with no Chrome, after a failure and
// for a design deleted mid-render. `GET /api/design/:id/thumb` serves the PNG, and the list rows carry `thumb` and
// `costKnown`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { useDesignEnv } from './helpers/design-fixture.mjs';
import { exportApp, PLAN, seedDone } from './helpers/design-export-seed.mjs';
import { assembleDesign } from '../src/core/design/assemble.mjs';
import { patchFs } from './helpers/fs-gate.mjs';
import { createThumbs, needsThumb, thumbUrl, thumbViewport } from '../src/core/design/thumb.mjs';
import { designDir, designWorkDir, distDir, thumbFile } from '../src/core/design/paths.mjs';
import { registerDesignRoutes } from '../src/core/design/routes.mjs';
import {
  createAgent, createBuild, createDesign, deleteDesign, designsWithUnknownCost, updateAgent, updateBuild, updateDesign,
} from '../src/core/design/store.mjs';

const servers = [];
after(async () => {
  for (const srv of servers) {
    srv.closeAllConnections?.();
    await Promise.race([new Promise((r) => srv.close(r)), new Promise((r) => setTimeout(r, 500))]);
  }
});
useDesignEnv(after);   // the thumb route sits behind the design gate

async function listen(app) {
  const srv = app.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
let exportBase = null;
/** A GET on one listening `exportApp()`: `{status, headers, body}` with the body read. */
async function get(path) {
  exportBase ??= await listen(exportApp());
  const r = await fetch(`${exportBase}${path}`);
  return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
}

const shoot = (calls) => async (chrome, args, o) => { calls.push({ chrome, args, doc: readFileSync(fileURLToPath(args.at(-1)), 'utf8'), timeoutMs: o.timeoutMs }); writeFileSync(o.outFile, 'PNG'); return { ok: true }; };
const inline = { run: (fn) => fn() };
const settle = () => new Promise((r) => setTimeout(r, 30));
function rig(over = {}) { const calls = []; const frames = []; const t = createThumbs({ chrome: () => '/c', queue: inline, run: shoot(calls), notify: (f) => frames.push(f), ...over }); return { t, calls, frames }; }

test('no Chrome: nothing happens, and it is looked for again later', async () => {
  const d = seedDone(); let lookups = 0; let clock = 1000;
  const { t } = rig({ chrome: () => { lookups += 1; return null; }, now: () => clock });
  t.ensure(d); t.ensure(d); await settle();
  assert.equal(thumbUrl(d.id), null); assert.equal(lookups, 1);
  clock += 60_001; t.ensure(d); await settle(); assert.equal(lookups, 2);
});
test('a finished design: scripts off, sized by the canvas, one frame, no repeat', async () => {
  const d = seedDone({ 'sections/hero/script.js': 'MODELJS()' }); const { t, calls, frames } = rig();
  t.ensure(d); t.ensure(d); await settle();
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('--window-size=1440,900'));
  assert.equal(calls[0].timeoutMs, 30000);
  assert.ok(calls[0].doc.includes("script-src 'none'"));
  assert.equal(calls[0].doc.includes('<script'), false);
  assert.match(thumbUrl(d.id), new RegExp(`^/api/design/${d.id}/thumb\\?v=\\d+`));
  assert.deepEqual(frames.map((f) => [f.type, f.designId, f.thumb]), [['design-thumb', d.id, thumbUrl(d.id)]]);
  assert.equal(needsThumb(d.id), false);
  t.ensure(d); await settle(); assert.equal(calls.length, 1);
});
test('thumbViewport: 16:10 of the canvas', () => {
  assert.deepEqual(thumbViewport({ canvas: { w: 1920, h: 1080 } }), { width: 1920, height: 1200 });
});
test('only a finished design; a newer dist redoes it and the old one stays until then', async () => {
  const d = seedDone(); const { t, calls } = rig();
  t.ensure({ ...d, status: 'building' }); await settle(); assert.equal(calls.length, 0);
  t.ensure(d); await settle();
  const later = new Date(Date.now() + 5000); utimesSync(join(distDir(d.id), 'index.html'), later, later);
  const old = thumbUrl(d.id); assert.equal(needsThumb(d.id), true);
  const fail = rig({ run: async () => ({ ok: false, reason: 'x' }) });
  fail.t.ensure(d); await settle();
  assert.equal(thumbUrl(d.id), old, 'a failure keeps the old picture');
  t.ensure(d); await settle(); assert.equal(calls.length, 2);
});
test('a failure waits ten minutes; a throw in assembly counts as one and never escapes', async () => {
  let clock = 1000; let runs = 0;
  const d = seedDone();
  const { t } = rig({ now: () => clock, run: async () => { runs += 1; return { ok: false, reason: 'crash' }; } });
  t.ensure(d); await settle(); t.ensure(d); await settle(); assert.equal(runs, 1);
  clock += 600_001; t.ensure(d); await settle(); assert.equal(runs, 2);
  const bad = seedDone(); writeFileSync(join(designWorkDir(bad.id), 'shell.html'), '<p>no markers');   // after seeding: seedDone's own dist assembly would throw BAD_SHELL
  rig().t.ensure(bad); await settle();
  assert.equal(thumbUrl(bad.id), null);
});
test('deleted in flight: no folder comes back, no frame', async () => {
  const d = seedDone(); const frames = [];
  const t = createThumbs({ chrome: () => '/c', queue: inline, notify: (f) => frames.push(f), run: async (c, a, o) => { writeFileSync(o.outFile, 'PNG'); deleteDesign(d.id); return { ok: true }; } });
  t.ensure(d); await settle();
  assert.equal(existsSync(designDir(d.id)), false); assert.deepEqual(frames, []);
});
test('the route: PNG, cached by its version, 404 when absent', async () => {
  const d = seedDone(); writeFileSync(thumbFile(d.id), 'PNG');
  const r = await get(`/api/design/${d.id}/thumb?v=1`);
  assert.deepEqual([r.status, r.headers.get('content-type'), r.headers.get('x-content-type-options')], [200, 'image/png', 'nosniff']);
  assert.match(r.headers.get('cache-control'), /^private, max-age=31536000, immutable/);
  assert.equal((await get(`/api/design/${seedDone().id}/thumb`)).status, 404);
});
test('list rows: thumb, and costKnown false once any agent has an unknown cost', async () => {
  const d = seedDone(); const b = createBuild({ designId: d.id, kind: 'first', brief: 'x' }, { by: 'local' });
  updateBuild(b.id, { status: 'done' });
  const a = createAgent({ buildId: b.id, role: 'lead', job: 'Lead', engine: 'gemini' }); updateAgent(a.id, { costKnown: false });
  assert.ok(designsWithUnknownCost().has(d.id));
});

// Beyond the plan's rows: each pins a part of thumb.mjs, the route or the list the rows above leave open.
test('a folder removed under a live row: the copy never recreates it, and nothing is sent or warned', async () => {
  const d = seedDone(); const frames = []; const warned = []; const orig = console.warn; console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    const t = createThumbs({ chrome: () => '/c', queue: inline, notify: (f) => frames.push(f), run: async (c, a, o) => { writeFileSync(o.outFile, 'PNG'); rmSync(designDir(d.id), { recursive: true, force: true }); return { ok: true }; } });
    t.ensure(d); await settle();
  } finally { console.warn = orig; }
  assert.deepEqual([existsSync(designDir(d.id)), frames, warned], [false, [], []]);
});
test('the render runs at the back of the queue, unsandboxed only when asked, and its temp folder goes', async () => {
  const d = seedDone(); const calls = []; const fronts = []; const frames = [];
  const queue = { run: (fn, o) => { fronts.push(o?.front === true); return fn(); } };
  const prev = process.env.CHROME_NO_SANDBOX; process.env.CHROME_NO_SANDBOX = '1';
  try { createThumbs({ chrome: () => '/c', queue, run: shoot(calls), notify: (f) => frames.push(f) }).ensure(d); await settle(); } finally {
    if (prev === undefined) delete process.env.CHROME_NO_SANDBOX; else process.env.CHROME_NO_SANDBOX = prev;
  }
  assert.deepEqual(fronts, [false]);
  assert.equal(typeof frames[0]?.ts, 'number');
  assert.equal(calls[0].chrome, '/c');
  assert.ok(calls[0].args.includes('--no-sandbox'));
  assert.equal(existsSync(dirname(fileURLToPath(calls[0].args.at(-1)))), false, 'the temp folder is removed');
  assert.equal(readFileSync(thumbFile(d.id), 'utf8'), 'PNG');
});
test('a failure inside the window is retried at once for a newer dist; each failure warns once', async () => {
  const d = seedDone(); let runs = 0; const warned = []; const orig = console.warn; console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    const { t } = rig({ now: () => 1000, run: async (c, args) => { runs += 1; return { ok: false, reason: `crash ${args.length}` }; } });
    t.ensure(d); await settle(); t.ensure(d); await settle();
    assert.deepEqual([runs, warned.length], [1, 1]);
    const later = new Date(Date.now() + 5000); utimesSync(join(distDir(d.id), 'index.html'), later, later);
    t.ensure(d); await settle();
    assert.deepEqual([runs, warned.length], [2, 2]);
  } finally { console.warn = orig; }
  assert.ok(warned.every((w) => w.includes(d.id)), warned.join('\n'));
});
test('a throw anywhere stays inside ensure', async () => {
  const warned = []; const orig = console.warn; console.warn = (...a) => { warned.push(a.join(' ')); };
  try {
    const t = createThumbs({ chrome: () => '/c', queue: inline, notify: () => {}, run: async () => { throw new Error('spawn EACCES'); } });
    assert.doesNotThrow(() => t.ensure(seedDone())); await settle();
    assert.equal(warned.length, 1);
    const e = seedDone();
    createThumbs({ chrome: () => '/c', queue: inline, notify: () => { throw new Error('socket gone'); }, run: shoot([]) }).ensure(e); await settle();
    assert.equal(readFileSync(thumbFile(e.id), 'utf8'), 'PNG', 'the picture is kept');
    for (const bad of [null, undefined, {}, { id: '../x', status: 'done' }]) assert.doesNotThrow(() => t.ensure(bad));
    assert.doesNotThrow(() => createThumbs({ chrome: () => { throw new Error('lookup'); }, queue: inline, run: shoot([]), notify: () => {} }).ensure(seedDone()));
    assert.doesNotThrow(() => createThumbs({ chrome: () => '/c', queue: { run: () => { throw new Error('queue'); } }, run: shoot([]), notify: () => {} }).ensure(seedDone()));
    await settle();
  } finally { console.warn = orig; }
});
test('a render checks the round again when its turn comes: a round begun, a newer dist or a restore draws nothing', async () => {
  const pending = []; const calls = []; let busy = false;
  const queue = { run: (fn) => new Promise((ok, no) => { pending.push(() => Promise.resolve().then(fn).then(ok, no)); }) };
  const t = createThumbs({ chrome: () => '/c', queue, run: shoot(calls), notify: () => {}, held: () => busy });
  const a = seedDone(); t.ensure(a);
  updateDesign(a.id, { status: 'building' }); writeFileSync(join(designWorkDir(a.id), 'sections/hero/index.html'), '<section data-section="hero">HALF AN EDIT');
  pending.shift()(); await settle();
  assert.deepEqual([calls.length, thumbUrl(a.id)], [0, null], 'a round began while it waited');
  updateDesign(a.id, { status: 'stopped' });
  assert.equal(needsThumb(a.id), true, 'after a stopped round nothing stale counts as fresh');
  const b = seedDone(); t.ensure(b);
  const later = new Date(Date.now() + 5000); utimesSync(join(distDir(b.id), 'index.html'), later, later);
  pending.shift()(); await settle();
  assert.equal(calls.length, 0, 'a newer dist landed while it waited: its own ensure draws it');
  const c = seedDone(); t.ensure(c); busy = true;
  pending.shift()(); await settle();
  assert.equal(calls.length, 0, 'a restore or a hand-off holds the design');
  busy = false; t.ensure(c);
  pending.shift()(); await settle();
  assert.deepEqual([calls.length, thumbUrl(c.id) !== null], [1, true], 'the same round, nothing holding it: drawn');
});
test('a dist rebuilt while Chrome runs (a restore): the old round never lands, and the next ensure draws the new one', async () => {
  const d = seedDone(); const w = designWorkDir(d.id); const frames = [];
  const past = new Date(Date.now() - 60_000); utimesSync(join(distDir(d.id), 'index.html'), past, past);   // the queued stamp: a coarse clock cannot give the rebuild the same one
  const t = createThumbs({ chrome: () => '/c', queue: inline, notify: (f) => frames.push(f), run: async (c, a, o) => {
    writeFileSync(join(w, 'sections/hero/index.html'), '<section data-section="hero">BACK TO BEFORE</section>');
    assembleDesign({ workDir: w, plan: PLAN, mode: 'dist' });   // "Back to before this": work/ and dist/ rewritten, still done
    writeFileSync(o.outFile, 'PNG'); return { ok: true };
  } });
  t.ensure(d); await settle();
  assert.deepEqual([needsThumb(d.id), thumbUrl(d.id), frames], [true, null, []]);
  assert.deepEqual(readdirSync(designDir(d.id)).filter((n) => n.startsWith('thumb.png')), [], 'no part file is left');
  const { t: next, calls } = rig(); next.ensure(d); await settle();
  assert.ok(calls[0]?.doc.includes('BACK TO BEFORE'), 'the restored page is the one drawn');
  assert.equal(needsThumb(d.id), false);
});
test('a round or a restore begun while Chrome runs: its picture never lands', async () => {
  let busy = false;
  for (const begin of [(id) => updateDesign(id, { status: 'building' }), () => { busy = true; }]) {
    const d = seedDone(); const frames = [];
    createThumbs({ chrome: () => '/c', queue: inline, notify: (f) => frames.push(f), held: () => busy, run: async (c, a, o) => { begin(d.id); writeFileSync(o.outFile, 'PNG'); return { ok: true }; } }).ensure(d);
    await settle();
    assert.deepEqual([thumbUrl(d.id), frames], [null, []], String(begin));
  }
});
test('a dist rebuilt while the picture is copied in: the old round never lands, and no part file stays', async () => {
  const d = seedDone(); const w = designWorkDir(d.id); const frames = [];
  const past = new Date(Date.now() - 60_000); utimesSync(join(distDir(d.id), 'index.html'), past, past);
  let rebuilt = false;
  const restore = patchFs('copyFile', (orig) => async (src, dst, ...a) => {
    if (!rebuilt && String(dst).startsWith(`${thumbFile(d.id)}.tmp-`)) {   // after every check before the copy, before the part file is written
      rebuilt = true; writeFileSync(join(w, 'sections/hero/index.html'), '<section data-section="hero">NEW</section>'); assembleDesign({ workDir: w, plan: PLAN, mode: 'dist' });
    }
    return orig(src, dst, ...a);
  });
  try { rig({ notify: (f) => frames.push(f) }).t.ensure(d); await settle(); } finally { restore(); }
  assert.deepEqual([rebuilt, needsThumb(d.id), thumbUrl(d.id), frames], [true, true, null, []]);
  assert.deepEqual(readdirSync(designDir(d.id)).filter((n) => n.startsWith('thumb.png')), [], 'no part file is left');
});
test('nothing awaits between the last check and the rename: a dist rebuilt in an awaited rename would send the old picture', async () => {
  const d = seedDone(); const w = designWorkDir(d.id); const frames = [];
  const past = new Date(Date.now() - 60_000); utimesSync(join(distDir(d.id), 'index.html'), past, past);
  let rebuilt = false;
  const restore = patchFs('rename', (orig) => async (src, dst) => {   // reached only by an awaited fs/promises rename
    if (!rebuilt && dst === thumbFile(d.id)) { rebuilt = true; writeFileSync(join(w, 'sections/hero/index.html'), '<section data-section="hero">NEW</section>'); assembleDesign({ workDir: w, plan: PLAN, mode: 'dist' }); }
    return orig(src, dst);
  });
  try { rig({ notify: (f) => frames.push(f) }).t.ensure(d); await settle(); } finally { restore(); }
  assert.deepEqual([rebuilt, needsThumb(d.id), frames.length], [false, false, 1]);
});
test('needsThumb and thumbUrl: nothing to draw without a dist, and a bad id is just false and null', () => {
  const blank = createDesign({ kind: 'web', title: 'Blank' }, { by: 'local' });
  assert.deepEqual([needsThumb(blank.id), thumbUrl(blank.id)], [false, null]);
  const d = seedDone(); rmSync(join(distDir(d.id), 'index.html'));
  assert.equal(needsThumb(d.id), false);
  assert.deepEqual([needsThumb('../x'), thumbUrl('../x'), needsThumb(undefined)], [false, null, false]);
});
test('thumbViewport: a web canvas is its width at 16:10', () => {
  assert.deepEqual(thumbViewport({ canvas: { w: 1440 } }), { width: 1440, height: 900 });
  assert.deepEqual(thumbViewport({ kind: 'document', canvas: { w: 794 } }), { width: 794, height: 496 }, 'a document: its printed column');
  assert.deepEqual(thumbViewport({ canvas: { w: 1001 } }), { width: 1001, height: 626 });
});
test('the route: the PNG bytes, a bad or unknown id is the design 404, a missing file is a 404 with words', async () => {
  const d = seedDone(); writeFileSync(thumbFile(d.id), 'PNG');
  assert.equal((await get(`/api/design/${d.id}/thumb`)).body.toString(), 'PNG');
  assert.equal((await get('/api/design/d_000000000000/thumb')).status, 404);
  assert.deepEqual(JSON.parse((await get('/api/design/d_000000000000/thumb')).body.toString()), { error: 'design not found' });
  const none = await get(`/api/design/${seedDone().id}/thumb`);
  assert.deepEqual(JSON.parse(none.body.toString()), { error: 'thumbnail not found' });
});
test('in the real list: each row has its thumb URL and costKnown, and every row is handed to thumbs.ensure', async () => {
  const unknown = seedDone(); writeFileSync(thumbFile(unknown.id), 'PNG');
  const b = createBuild({ designId: unknown.id, kind: 'first', brief: 'x' }, { by: 'local' }); updateBuild(b.id, { status: 'done' });
  updateAgent(createAgent({ buildId: b.id, role: 'lead', job: 'Lead', engine: 'gemini' }).id, { costKnown: false });
  const known = seedDone();
  const kb = createBuild({ designId: known.id, kind: 'first', brief: 'x' }, { by: 'local' }); updateBuild(kb.id, { status: 'done' });
  createAgent({ buildId: kb.id, role: 'lead', job: 'Lead', engine: 'claude' });
  assert.equal(designsWithUnknownCost().has(known.id), false, 'a known cost is not unknown');
  const ensured = [];
  const app = express(); app.use(express.json());
  registerDesignRoutes(app, { deps: { designBuilds: {}, thumbs: { ensure: (x) => ensured.push([x.id, x.status]) } } });
  const rows = await (await fetch(`${await listen(app)}/api/design`)).json();
  const row = (id) => rows.find((x) => x.id === id);
  assert.deepEqual([row(unknown.id).thumb, row(unknown.id).costKnown], [thumbUrl(unknown.id), false]);
  assert.deepEqual([row(known.id).thumb, row(known.id).costKnown], [null, true]);
  assert.deepEqual(ensured.map(([id]) => id).sort(), rows.map((x) => x.id).sort());
  assert.ok(ensured.some(([id, status]) => id === known.id && status === 'done'));
});

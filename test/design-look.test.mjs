// test/design-look.test.mjs — the Look kit (assets/design-kit/look.mjs): how a Design lead sees what was built before
// it judges it. One command shoots every section as it stands (the build page: finished state, no model script) and
// lists each picture its frame cuts. The geometry and the page are plain Node; the browser cases skip without Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cropLine, cutLine, look, lookDoc, shown } from '../assets/design-kit/look.mjs';
import { decodePNG, encodePNG } from '../assets/promo-kit/tools/analyze.mjs';
import { findChrome } from '../assets/promo-kit/tools/find-tools.mjs';
import { LOOK_KIT } from '../src/core/design/paths.mjs';
import { integratePrompt } from '../src/core/design/prompts.mjs';
import { DESIGN_MAX_TURNS } from '../src/core/design/spawn-options.mjs';

const noChrome = findChrome() ? false : 'no Chrome-family browser on this host (set WORCA_CHROME)';
const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';

/** A two-slide deck in a temp work folder: `whole` fits its 200×100 picture in a box; `zoomed` shows 2/9 of it.
 *  `extra` adds four slides of a 200×100 picture with `object-fit: cover`: `fill` (made, in a 400×400 box, so cover
 *  alone cuts it), `plain` (the same under assets/), `framed` (made, its 300×150 box past a 100×100 frame) and
 *  `exact` (made, in a box of its own shape, so nothing cuts it). */
function deck({ extra = false } = {}) {
  const more = extra ? ['fill', 'plain', 'framed', 'exact'] : [];
  const work = join(mkdtempSync(join(tmpdir(), 'worca-look-')), 'work');
  const put = (rel, text) => { mkdirSync(join(work, rel, '..'), { recursive: true }); writeFileSync(join(work, rel), text); };
  const plan = { v: 1, kind: 'presentation', title: 'T', canvas: { w: 1920, h: 1080 }, notes: 'n',
    sections: ['whole', 'zoomed', 'later', ...more].map((id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'] })) };
  put('plan.json', JSON.stringify(plan));
  put('shell.html', SHELL);
  put('tokens.css', ':root{--bg:#fff}');
  put('global.css', 'body{background:var(--bg)}');
  put('.crew.json', JSON.stringify([{ id: 'whole', status: 'done' }, { id: 'zoomed', status: 'done' }, { id: 'later', status: 'working' }, ...more.map((id) => ({ id, status: 'done' }))]));
  put('assets/shot.png', Buffer.from(encodePNG(200, 100, new Uint8Array(200 * 100 * 3).fill(120))));
  put('sections/whole/index.html', '<section data-section="whole" data-label="Whole"><div class="box"><img src="assets/shot.png" width="200" height="100" alt="The run"></div></section>');
  put('sections/whole/style.css', '[data-section="whole"] .box{position:absolute;left:160px;top:140px;width:1600px;height:800px;overflow:hidden}\n[data-section="whole"] img{display:block;width:100%;height:100%;object-fit:contain}');
  put('sections/zoomed/index.html', '<section data-section="zoomed" data-label="Zoomed"><div class="win"><img src="assets/shot.png" width="200" height="100" alt="The run"></div></section>');
  put('sections/zoomed/style.css', '[data-section="zoomed"] .win{position:absolute;left:160px;top:140px;width:400px;height:400px;overflow:hidden}\n[data-section="zoomed"] img{position:absolute;left:-400px;top:0;width:1200px;height:600px;max-width:none}');
  put('sections/later/index.html', '<section data-section="later" data-label="Later"></section>');
  if (extra) {
    const bg = Buffer.from(encodePNG(200, 100, new Uint8Array(200 * 100 * 3).fill(60)));
    put('assets/made/bg.png', bg);
    put('assets/bg.png', bg);
    const slide = (id, html, css) => {
      put(`sections/${id}/index.html`, `<section data-section="${id}" data-label="${id}">${html}</section>`);
      put(`sections/${id}/style.css`, css);
    };
    const img = (src) => `<img src="${src}" width="200" height="100" alt="A field">`;
    const at = (id, w, h) => `[data-section="${id}"] img{position:absolute;left:160px;top:140px;width:${w}px;height:${h}px;max-width:none;object-fit:cover}`;
    slide('fill', img('assets/made/bg.png'), at('fill', 400, 400));
    slide('plain', img('assets/bg.png'), at('plain', 400, 400));
    slide('framed', `<div class="frame">${img('assets/made/bg.png')}</div>`,
      '[data-section="framed"] .frame{position:absolute;left:160px;top:140px;width:100px;height:100px;overflow:hidden}\n[data-section="framed"] img{display:block;width:300px;height:150px;max-width:none;object-fit:cover}');
    slide('exact', img('assets/made/bg.png'), at('exact', 200, 100));
  }
  return { work, plan };
}

test('shown: the share of a picture that its clipping boxes and its fit leave on screen', () => {
  const box = { x: 100, y: 100, w: 400, h: 200 };
  const natural = { w: 800, h: 400 };
  assert.equal(shown({ box, clips: [], natural, fit: 'fill' }), 1);
  assert.equal(shown({ box, clips: [{ x: 0, y: 0, w: 1000, h: 1000 }], natural, fit: 'contain' }), 1);
  assert.equal(shown({ box, clips: [{ x: 300, y: 0, w: 1000, h: 1000 }], natural, fit: 'fill' }), 0.5, 'the left half lies outside');
  assert.equal(shown({ box, clips: [{ x: 0, y: 0, w: 1000, h: 1000 }, { x: 300, y: 200, w: 1000, h: 1000 }], natural, fit: 'fill' }), 0.25, 'every clipping box counts');
  assert.equal(shown({ box, clips: [{ x: 900, y: 900, w: 10, h: 10 }], natural, fit: 'fill' }), 0, 'wholly outside');
  assert.equal(shown({ box: { x: 0, y: 0, w: 100, h: 100 }, clips: [], natural: { w: 200, h: 100 }, fit: 'cover' }), 0.5, 'cover crops a wide picture in a square box');
  assert.equal(shown({ box: { x: 0, y: 0, w: 200, h: 100 }, clips: [], natural: { w: 200, h: 100 }, fit: 'cover' }), 1, 'cover in a box of the same shape cuts nothing');
  assert.equal(shown({ box: { x: 0, y: 0, w: 0, h: 0 }, clips: [], natural, fit: 'fill' }), null, 'a picture with no box is not judged');
  assert.equal(shown({ box, clips: [], natural: { w: 0, h: 0 }, fit: 'fill' }), null, 'a picture that did not load is not judged');
});

test('cutLine: one plain line the lead can act on', () => {
  assert.equal(cutLine({ section: 'result', src: 'assets/project/diff.png', natural: { w: 2190, h: 1516 }, shown: 0.4912, by: 'div.frame-view' }),
    'cut: assets/project/diff.png (2190×1516) shows 49% of itself: div.frame-view cuts it');
  assert.equal(cutLine({ section: 'a', src: 'assets/x.png', natural: { w: 10, h: 10 }, shown: 0.5, by: null }),
    'cut: assets/x.png (10×10) shows 50% of itself: `object-fit: cover` cuts it');
});

test('lookDoc: the build page of the work folder, loading from it, with no script and the board at one size', () => {
  const { work, plan } = deck();
  try {
    const d = lookDoc({ workDir: work, plan });
    assert.ok(d.html.includes(`<base href="${pathToFileURL(`${work}/`).href}">`), 'relative URLs load from work/');
    assert.ok(d.html.indexOf('<base ') < d.html.indexOf('tokens.css') || !d.html.includes('tokens.css'), 'the base comes before anything it resolves');
    assert.doesNotMatch(d.html, /<script/i, 'no script runs: each section stands in its finished state');
    assert.match(d.html, /--worca-board-s:0\.6666667;/);
    assert.match(d.html, /--worca-board-cols:\s*1/);
    assert.deepEqual(d.ids, ['whole', 'zoomed'], 'the sections that are built');
    assert.deepEqual(d.waiting, ['later'], 'a section not finished yet is named, not shot');
    assert.deepEqual(d.size, { w: 1280, h: 720 });
  } finally { rmSync(join(work, '..'), { recursive: true, force: true }); }
});

test('look: one picture per built section, and the picture its frame cuts is listed', { skip: noChrome }, async () => {
  const { work } = deck();
  const out = mkdtempSync(join(tmpdir(), 'worca-look-out-'));
  try {
    const r = await look({ workDir: work, outDir: out });
    assert.deepEqual(r.shots.map((s) => s.id), ['whole', 'zoomed']);
    for (const s of r.shots) {
      const png = decodePNG(readFileSync(s.file));
      assert.deepEqual([png.width, png.height], [1280, 720], `${s.id}: the slide at two thirds`);
    }
    assert.deepEqual(r.waiting, ['later']);
    assert.equal(r.cuts.length, 1, 'only the zoomed picture is cut');
    const [cut] = r.cuts;
    assert.equal(cut.section, 'zoomed');
    assert.equal(cut.src, 'assets/shot.png');
    assert.equal(cut.by, 'div.win');
    assert.ok(Math.abs(cut.shown - 2 / 9) < 0.02, `two ninths show, got ${cut.shown}`);
    const only = await look({ workDir: work, outDir: out, ids: ['whole'] });
    assert.deepEqual(only.shots.map((s) => s.id), ['whole'], 'named sections only');
    assert.equal(only.cuts.length, 0);
  } finally {
    rmSync(join(work, '..'), { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('the command prints where each picture is and what is cut, and writes nothing into work/', { skip: noChrome }, () => {
  const { work } = deck();
  const out = mkdtempSync(join(tmpdir(), 'worca-look-out-'));
  try {
    const before = readFileSync(join(work, '.crew.json'), 'utf8');
    const r = spawnSync(process.execPath, [LOOK_KIT, work, out], { encoding: 'utf8', timeout: 120000 });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^whole {2}${join(out, 'whole.png').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
    assert.match(r.stdout, /^ {2}cut: assets\/shot\.png \(200×100\) shows 22% of itself: div\.win cuts it$/m);
    assert.match(r.stdout, /^later {2}not built yet$/m);
    assert.match(r.stdout, /^2 sections shot, 1 picture cut\.$/m);
    assert.ok(existsSync(join(out, 'zoomed.png')));
    assert.equal(readFileSync(join(work, '.crew.json'), 'utf8'), before);
    assert.ok(!existsSync(join(work, 'page.html')) && !existsSync(join(work, 'whole.png')), 'nothing lands in work/');
  } finally {
    rmSync(join(work, '..'), { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test('cropLine: one plain line for a made picture that fills its box', () => {
  assert.equal(cropLine({ src: 'assets/made/bg.png', natural: { w: 200, h: 100 }, shown: 0.5 }), 'cropped: assets/made/bg.png (200×100) fills its box and shows 50% of itself');
});
test('look: a made picture that only cover cuts is cropped; the same under assets/ or inside a cutting frame is cut', { skip: noChrome }, async () => {
  const { work } = deck({ extra: true });   // deck() gains sections `fill` (assets/made/bg.png 200×100 in a 400×400 box, object-fit: cover),
  // `plain` (the same picture as assets/bg.png), `framed` (assets/made/bg.png inside a 100×100 overflow:hidden frame) and `exact` (cover in its own 200×100 shape)
  const out = mkdtempSync(join(tmpdir(), 'worca-look-out-'));
  try {
    const r = await look({ workDir: work, outDir: out });
    assert.deepEqual(r.crops.map((c) => [c.section, c.src]), [['fill', 'assets/made/bg.png']]);
    assert.ok(Math.abs(r.crops[0].shown - 0.5) < 0.02);
    assert.deepEqual(r.cuts.map((c) => c.section).sort(), ['framed', 'plain', 'zoomed']);
    const cmd = spawnSync(process.execPath, [LOOK_KIT, work, out], { encoding: 'utf8', timeout: 120000 });
    assert.match(cmd.stdout, /^ {2}cropped: assets\/made\/bg\.png \(200×100\) fills its box and shows 50% of itself$/m);
    assert.match(cmd.stdout, /^6 sections shot, 3 pictures cut, 1 cropped\.$/m);
  } finally { rmSync(join(work, '..'), { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});

test('look: a made picture is known by where its src lands however it is written; an inline picture keeps the cut rule', { skip: noChrome }, async () => {
  const { work } = deck({ extra: true });
  const dot = Buffer.from(encodePNG(2, 1, new Uint8Array(2 * 3).fill(90))).toString('base64');
  writeFileSync(join(work, 'sections/exact/index.html'), `<section data-section="exact" data-label="exact"><img class="a" src="./assets/made/bg.png" alt="A field"><img class="b" src="data:image/png;base64,${dot}" alt="A dot"></section>`);
  writeFileSync(join(work, 'sections/exact/style.css'), '[data-section="exact"] img{position:absolute;top:140px;width:400px;height:400px;max-width:none;object-fit:cover}\n[data-section="exact"] .a{left:160px}\n[data-section="exact"] .b{left:700px}');
  const out = mkdtempSync(join(tmpdir(), 'worca-look-out-'));
  try {
    const r = await look({ workDir: work, outDir: out, ids: ['exact'] });
    assert.deepEqual(r.crops.map((c) => c.src), ['./assets/made/bg.png'], 'the path as classifyRef reads it, not as written');
    assert.deepEqual(r.cuts.map((c) => c.src.slice(0, 15)), ['data:image/png;'], 'a picture that is no file of work/ is cut, and does not stop the kit');
  } finally { rmSync(join(work, '..'), { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); }
});
test('the command says how to call it when the work folder or the out folder is missing', () => {
  const r = spawnSync(process.execPath, [LOOK_KIT], { encoding: 'utf8', timeout: 30000 });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /node .*look\.mjs <work folder> <out folder> \[section id …\]/);
});

test('the lead\'s last pass is told to look first, with the kit\'s path, and has the turns for it', () => {
  assert.equal(LOOK_KIT, fileURLToPath(new URL('../assets/design-kit/look.mjs', import.meta.url)));
  const p = integratePrompt({ findings: [], integrationFile: '/w/integration.json', lookKit: '/k/look.mjs' });
  assert.ok(p.split('\n').includes('Look kit: /k/look.mjs'));
  assert.match(p, /First look at what was built\. Run `node "<Look kit>" \. "\$\(mktemp -d\)"` in work\/, with the Look kit's path/);
  assert.match(p, /it saves one picture of every section as it stands, prints where, and lists each picture that its frame cuts/);
  assert.match(p, /Read the pictures before you judge/);
  assert.ok(p.indexOf('First look at what was built') < p.indexOf('Then check the sections against the Craft rules'), 'looking comes before judging');
  const bare = integratePrompt({ findings: [], integrationFile: '/w/integration.json' });
  assert.doesNotMatch(bare, /Look kit|First look at what was built/, 'no kit, no line');
  assert.equal(DESIGN_MAX_TURNS['lead:integrate'], 40);
});

// test/promo-kit-film.test.mjs
// The promo kit's film runtime (assets/promo-kit/film) and the two tools that set a film up:
// initFilm (copy the kit + gsap + fonts into a run's film dir, copy-if-missing) and buildData
// (timeline.json + plates/manifest.json + film/scenes/*.js → film/data.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { initFilm } from '../assets/promo-kit/tools/init-film.mjs';
import { buildData } from '../assets/promo-kit/tools/build-data.mjs';

const KIT = fileURLToPath(new URL('../assets/promo-kit/', import.meta.url));
const tmp = (p) => mkdtempSync(join(tmpdir(), p));

/** Evaluate a generated data.js and return its window.FILM_DATA. */
function loadData(file) {
  const window = {};
  vm.runInNewContext(readFileSync(file, 'utf8'), { window });
  return JSON.parse(JSON.stringify(window.FILM_DATA));   // out of the vm realm (deepEqual compares prototypes)
}

const TIMELINE = {
  version: 1, duration: 8, fps: 60, narrated: false, music: false,
  vo: {
    v01: { text: 'Meet the app.', scene: 'hook', start: 0.6, dur: 1.4, speechStart: 0, speechEnd: 1.3,
      words: [{ w: 'Meet', key: 'meet', t0: 0.05, t1: 0.3 }, { w: 'the', key: 'the', t0: 0.35, t1: 0.5 }, { w: 'app.', key: 'app', t0: 0.55, t1: 1.3 }] },
    v02: { text: 'It just works.', scene: 'close', start: 4.2, dur: 1.5, speechStart: 0.02, speechEnd: 1.45,
      words: [{ w: 'It', key: 'it', t0: 0.02, t1: 0.2 }, { w: 'just', key: 'just', t0: 0.25, t1: 0.6 }, { w: 'works.', key: 'works', t0: 0.65, t1: 1.45 }] },
  },
  scenes: [{ id: 'hook', start: 0, end: 3.6 }, { id: 'close', start: 3.6, end: 8, chapter: { num: '01', title: 'It just works.' } }],
};

const MANIFEST = {
  version: 1,
  plates: {
    'hook-composer': { desc: 'Composer box', dsf: 3, pad: 28, states: { default: { file: 'plates/hook-composer/default.png', w: 640, h: 220 } }, anchors: {}, seqs: {} },
  },
};

function fixturePromo() {
  const promo = tmp('promo-kit-film-');
  mkdirSync(join(promo, 'film', 'scenes'), { recursive: true });
  mkdirSync(join(promo, 'plates'), { recursive: true });
  writeFileSync(join(promo, 'timeline.json'), JSON.stringify(TIMELINE));
  writeFileSync(join(promo, 'plates', 'manifest.json'), JSON.stringify(MANIFEST));
  writeFileSync(join(promo, 'film', 'scenes', 'hook.js'), "F.scene({ id: 'hook', build(S) {} });\n");
  return promo;
}

test('initFilm copies the kit, gsap and the fonts into an empty dir; a second call copies nothing and keeps edits', () => {
  const dir = tmp('promo-kit-init-');
  const filmDir = join(dir, 'film');
  try {
    const first = initFilm({ filmDir });
    for (const f of ['index.html', 'kit.js', 'film.css', 'main.js', 'mascot.js', 'mascot.css', 'vendor/gsap.min.js',
      'fonts/poppins-latin-400-normal.woff2', 'fonts/jetbrains-mono-latin-400-normal.woff2']) {
      assert.ok(first.copied.includes(f), `copied ${f}`);
      assert.ok(existsSync(join(filmDir, f)), `${f} exists`);
    }
    assert.ok(existsSync(join(filmDir, 'scenes')), 'scenes/ dir created');
    assert.match(readFileSync(join(filmDir, 'vendor', 'gsap.min.js'), 'utf8').slice(0, 200), /GSAP/);
    assert.deepEqual(readFileSync(join(filmDir, 'kit.js')), readFileSync(join(KIT, 'film', 'kit.js')));

    writeFileSync(join(filmDir, 'mascot.js'), '/* re-skinned */\n');
    const second = initFilm({ filmDir });
    assert.deepEqual(second.copied, []);
    assert.equal(readFileSync(join(filmDir, 'mascot.js'), 'utf8'), '/* re-skinned */\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('buildData writes film/data.js: absolute word times, plates, scene files, layout from the timeline', () => {
  const promo = fixturePromo();
  try {
    const r = buildData({ promoDir: promo });
    assert.equal(r.scenes, 2);
    assert.equal(r.plates, 1);
    assert.equal(r.voLines, 2);
    const D = loadData(join(promo, 'film', 'data.js'));
    assert.equal(D.vo.v01.words[0].t0, TIMELINE.vo.v01.start + TIMELINE.vo.v01.words[0].t0);
    assert.equal(D.vo.v02.words.at(-1).t1, TIMELINE.vo.v02.start + 1.45);
    assert.equal(D.vo.v01.end, 0.6 + 1.3);
    assert.deepEqual(D.sceneFiles, ['scenes/hook.js']);
    assert.deepEqual(D.sceneCss, []);
    assert.deepEqual(D.layout.vo, { v01: 0.6, v02: 4.2 });
    assert.equal(D.layout.duration, 8);
    assert.equal(D.layout.fps, 60);
    assert.deepEqual(D.layout.scenes.map((s) => s.id), ['hook', 'close']);
    assert.deepEqual(D.layout.scenes[1].chapter, { num: '01', title: 'It just works.' });
    assert.equal(D.plates['hook-composer'].states.default.file, 'plates/hook-composer/default.png');
    // no temp file left behind (atomic write)
    assert.deepEqual(readdirSync(join(promo, 'film')).filter((f) => f.startsWith('.data.')), []);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('buildData orders scene files, lists css siblings, tolerates a missing or flat manifest, and warns on overlapping lines', () => {
  const promo = fixturePromo();
  try {
    writeFileSync(join(promo, 'film', 'scenes', 'hook.css'), '[data-scene="hook"] .x { color: red; }\n');
    writeFileSync(join(promo, 'film', 'scenes', 'close.js'), "F.scene({ id: 'close', build(S) {} });\n");
    writeFileSync(join(promo, 'film', 'scenes', '_shared.js'), 'window.SHARED = 1;\n');
    // a flat manifest (name → plate) is accepted too
    writeFileSync(join(promo, 'plates', 'manifest.json'), JSON.stringify(MANIFEST.plates));
    let r = buildData({ promoDir: promo });
    let D = loadData(join(promo, 'film', 'data.js'));
    // helpers first, then scene files in TIMELINE order (hook before close): a scene may use an earlier file's helpers
    assert.deepEqual(D.sceneFiles, ['scenes/_shared.js', 'scenes/hook.js', 'scenes/close.js']);
    assert.deepEqual(D.sceneCss, ['scenes/hook.css']);
    assert.equal(r.plates, 1);

    rmSync(join(promo, 'plates'), { recursive: true, force: true });
    const tl = structuredClone(TIMELINE);
    tl.vo.v02.start = 1.0;                                  // starts before v01 ends
    writeFileSync(join(promo, 'timeline.json'), JSON.stringify(tl));
    r = buildData({ promoDir: promo });
    D = loadData(join(promo, 'film', 'data.js'));
    assert.deepEqual(D.plates, {});
    assert.ok(r.warnings.some((w) => /v01/.test(w) && /v02/.test(w)), r.warnings.join('\n'));
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('buildData without a timeline throws a clear error', () => {
  const promo = tmp('promo-kit-film-');
  try {
    assert.throws(() => buildData({ promoDir: promo }), /timeline\.json/);
  } finally { rmSync(promo, { recursive: true, force: true }); }
});

test('film/index.html loads scene files from FILM_DATA, not a hard-coded list', () => {
  const html = readFileSync(join(KIT, 'film', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src="scenes\//);
  assert.doesNotMatch(html, /<link[^>]+href="scenes\//);
  assert.match(html, /sceneFiles/);
  const order = ['vendor/gsap.min.js', 'data.js', 'kit.js', 'mascot.js', 'main.js'].map((f) => html.indexOf(`src="${f}"`));
  assert.ok(order.every((i) => i > 0), 'every runtime script is loaded');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'in dependency order');
  // main.js waits for the injected scenes before it builds
  assert.match(readFileSync(join(KIT, 'film', 'main.js'), 'utf8'), /__filmScenes/);
});

test('the kit keeps the runtime fixes: display:none scenes, t+1µs seek, master priming, chapter pre-roll + drift', () => {
  const kit = readFileSync(join(KIT, 'film', 'kit.js'), 'utf8');
  assert.match(kit, /display: 'none'/);
  assert.doesNotMatch(kit, /visibility: 'hidden'/);
  assert.match(kit, /t \+ 1e-6/);
  assert.match(kit, /progress\(1, true\)\.progress\(0, true\)/);
  assert.match(kit, /yPercent: 62/);           // chapter words pre-risen: frame 0 is never bare paper
  assert.match(kit, /scale: 1\.045/);          // the chapter title drifts: never a frozen hold
  // project-neutral
  for (const f of ['kit.js', 'main.js', 'film.css', 'mascot.js', 'mascot.css', 'index.html', 'mascot-demo.html']) {
    const src = readFileSync(join(KIT, 'film', f), 'utf8');
    assert.doesNotMatch(src, /worca|marketing\/promo-film|\/Users\//i, f);
  }
});

test('CONTRACT.md is product-neutral and carries the film rules agents rely on', () => {
  const c = readFileSync(join(KIT, 'CONTRACT.md'), 'utf8');
  for (const bad of [/\/Users\//, /marketing\//, /scratchpad/i, /\b44\d\d\b/, /\b4317\b/, /\bowner\b/i, /\bsips\b|\bafinfo\b|swift/i]) assert.doesNotMatch(c, bad);
  for (const rule of [/one concrete component at a time/i, /zoom to what is named/i, /every arrival has motion and a sound cue/i,
    /frozen hold longer than 1\.2 s/i, /no humans/i, /no arms and no hands/i, /nose tip/i, /never cover the text/i,
    /no app chrome/i, /<sceneId>-<component>/, /<P>\/promo\/plates\/manifest\.json/, /<P>\/promo-kit\//]) assert.match(c, rule);
  for (const tool of ['build-data.mjs', 'snap.mjs', 'fluency.mjs', 'sheet.mjs']) assert.ok(c.includes(`promo-kit/tools/${tool}`), tool);
});

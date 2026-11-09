// test/design-assemble-film.test.mjs — Design P7 Task 5: outside build, `video` assembles as a film. The scenes sit in
// `<div data-film>`, and the foot runs FILM_PLAN, gsap, film.js, global.js, one `F.scene` per scene, then `F.start()`,
// each its own script, so a scene with a syntax error loses only its own timeline. Lint's `film-determinism` names
// what breaks a seek, on video only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM, VirtualConsole } from 'jsdom';
import { assembleDesign, lintDesign } from '../src/core/design/assemble.mjs';
import { FILM_BASE_CSS, filmPlanScript } from '../src/core/design/kinds.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { checkRows } from './helpers/rows.mjs';

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const BRIDGE = '<script data-worca-bridge>B</script>';
const slide = (id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'] });
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [slide('s1'), slide('s2')] };
const DECK_FILES = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.js': 'window.G=1;',
  'sections/s1/index.html': '<section data-section="s1" data-label="One"><h1>One</h1></section>', 'sections/s1/style.css': '[data-section="s1"] h1{top:0}',
  'sections/s2/index.html': '<section data-section="s2" data-label="Two"><h1>Two</h1></section>', 'sections/s2/style.css': '[data-section="s2"] h1{top:0}' };
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function seed(files) { const d = mkdtempSync(join(tmpdir(), 'dfilm-')); dirs.push(d); const work = join(d, 'work'); mkdirSync(work); for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); } return work; }
async function world(files = DECK_FILES, kind = 'pitch') { const work = seed(files); await stageDesignKit({ kind, workDir: work }); return work; }
const ordered = (html, parts) => parts.reduce((at, p) => { const i = html.indexOf(p, at); assert.ok(i >= 0, `after ${at}: ${p}`); return i + p.length; }, 0);

const scene = (id, duration) => ({ id, job: id, brief: 'b', parts: ['html', 'css', 'js'], duration });
const FILM = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [scene('a', 2), scene('b', 3)] };
const BASE = { 'shell.html': SHELL, 'sections/a/index.html': '<div data-section="a" data-scene><b>A</b></div>', 'sections/a/script.js': 'window.__a=S.dur;',
  'sections/b/index.html': '<div data-section="b" data-scene><b>B</b></div>', 'sections/b/script.js': 'window.__b=S.dur;' };
test('run: plan, gsap, film.js, global, one F.scene per scene, then start', async () => {
  const { html } = assembleDesign({ workDir: await world(BASE, 'video'), plan: FILM, mode: 'run', bridge: BRIDGE });
  ordered(html, ['<div data-film>\n<div data-section="a"', '</div>\n</div>', 'window.FILM_PLAN={"w":1920,"h":1080,"fps":60,"embedded":true,"scenes":[{"id":"a","duration":2},{"id":"b","duration":3}]};', 'GSAP', 'window.F', 'F.scene("a",function(root,S){\nwindow.__a=S.dur;\n});', 'F.scene("b",function(root,S){\nwindow.__b=S.dur;\n});', 'F.start();']);
  assert.ok(html.includes(FILM_BASE_CSS));
  assert.equal(html.includes('(function(root){'), false, 'a scene is not P1\'s IIFE');
  assert.equal(html.includes('.kit/'), false);
  // global.js runs after the kit and before the first scene; every piece is its own script element, escaped as P1's.
  const g = assembleDesign({ workDir: await world({ ...BASE, 'global.js': 'window.G=1;', 'sections/b/script.js': 'window.__b="</script><!--";' }, 'video'), plan: FILM, mode: 'run' }).html;
  ordered(g, ['window.F = {', '</script>\n<script>window.G=1;</script>\n<script>F.scene("a"', '});</script>\n<script>F.scene("b",function(root,S){\nwindow.__b="<\\/script><\\!--";\n});</script>\n<script>F.start();</script>']);
  // FILM_PLAN is JSON in a script: a `<` never reaches the page as itself.
  const odd = filmPlanScript({ plan: { ...FILM, sections: [scene('a</script>', 1)] }, mode: 'run' });
  assert.equal(odd.includes('<'), false);
  assert.equal(JSON.parse(odd.slice('window.FILM_PLAN='.length, -1)).scenes[0].id, 'a</script>');
});
test('only the run doc is embedded; dist and standalone carry no worca attribute', async () => {
  const work = await world(BASE, 'video');
  // A shell slot does not apply to a film either: emptied, the scene still in the film.
  const slotted = await world({ ...BASE, 'shell.html': SHELL.replace('<!--worca:sections-->', '<div class="x"><div data-worca-slot="b"></div></div><!--worca:sections-->') }, 'video');
  for (const mode of ['dist', 'standalone']) {
    const { html } = assembleDesign({ workDir: work, plan: FILM, mode });
    assert.ok(html.includes('"embedded":false'), mode);
    assert.equal(html.includes('data-worca-'), false, mode);
    const out = assembleDesign({ workDir: slotted, plan: FILM, mode }).html;
    assert.ok(out.includes('<div class="x"></div>') && out.includes('<div data-section="b" data-scene>'), `${mode}: the slot is emptied`);
    assert.equal(out.includes('data-worca-'), false, mode);
  }
});
test('a scene with a syntax error loses only its own timeline; a missing scene keeps its window', async () => {
  const noB = { ...BASE, 'sections/a/script.js': 'this is not js (' }; delete noB['sections/b/index.html']; delete noB['sections/b/script.js'];
  const c = scene('c', 1);
  const files = { ...noB, 'sections/c/index.html': '<div data-section="c" data-scene>C</div>', 'sections/c/script.js': 'window.__c=S.dur;' };
  const { html } = assembleDesign({ workDir: await world(files, 'video'), plan: { ...FILM, sections: [scene('a', 2), scene('b', 3), c] }, mode: 'dist' });
  const vc = new VirtualConsole();
  const win = new JSDOM(html, { url: 'http://localhost/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc, beforeParse(w) { w.matchMedia = () => ({ matches: true }); } }).window;
  after(() => win.close());
  assert.equal(win.F.DUR, 6);
  assert.equal(win.__c, 1, 'the next scene still built');
  win.F.seek(1); assert.equal(win.document.querySelector('[data-section="a"]').style.display, 'block', 'the composed state shows');
  win.F.seek(5.5); assert.equal(win.document.querySelector('[data-section="c"]').style.display, 'block');
  win.F.pause();
});
test('standalone embeds assets; the film needs nothing beside it', async () => {
  const work = await world({ ...BASE, 'sections/a/index.html': '<div data-section="a" data-scene><img src="assets/x.png"></div>', 'assets/x.png': 'P' }, 'video');
  const r = assembleDesign({ workDir: work, plan: FILM, mode: 'standalone' });
  assert.deepEqual(r.problems, []);
  assert.ok(r.html.includes('src="data:image/png;base64,'));
  assert.doesNotMatch(r.html, /<script[^>]+src=/);
});
test('lint: the film rules name what breaks a seek', async () => {
  const lintWith = async (js, css = '', html = '<div data-section="a" data-scene></div>') => lintDesign({ workDir: await world({ ...BASE, 'sections/a/index.html': html, 'sections/a/script.js': js, 'sections/a/style.css': css }, 'video'), plan: FILM }).findings.filter((f) => f.rule === 'film-determinism').length;
  await checkRows([
    ['setTimeout(f,1)', '', 1], ['setInterval(f,1)', '', 1], ['requestAnimationFrame(f)', '', 1], ['new Date()', '', 1], ['Date.now()', '', 1], ['performance.now()', '', 1], ['Math.random()', '', 1],
    ['gsap.from(root,{})', '', 1], ['S.tl.from(root,{})', '', 1], ['fetch("x")', '', 1], ['await x', '', 1],
    ['', '@keyframes a-x{from{top:0}}', 1], ['', '[data-section="a"]{transition:top 1s}', 1], ['', '[data-section="a"]{animation-name:x}', 1],
    ['S.tl.fromTo(root,{x:0},{x:1},0)', '', 0], ['Array.from(root.children)', '', 0], ['// setTimeout is banned\nS.tl.set(root,{x:0},0)', '', 0], ['/* Math.random() */', '', 0],
    // One finding per distinct hit per file; a `//` inside a string is no comment.
    ['setTimeout(a,1);setTimeout (b,2)', '', 1], ['setTimeout(a,1);Math.random()', '', 2], ['var u="http://x";setTimeout(f,1)', '', 1],
    ['', '/* transition:top 1s */[data-section="a"]{top:0}', 0],
  ].map(([js, css, want]) => ({ name: js + css, run: async () => assert.equal(await lintWith(js, css), want) })));
  assert.equal(await lintWith('', '', '<div data-section="a" data-scene><video src="assets/x.webm"></video></div>'), 1);
  assert.equal(await lintWith('', '', '<div data-section="a" data-scene><audio src="assets/x.mp3"></audio></div>'), 1);
  assert.equal(await lintWith('', '', '<div data-section="a" data-scene><video><source src="assets/x.webm"></video></div>'), 1, 'a video holding only a source');
  const one = lintDesign({ workDir: await world({ ...BASE, 'sections/a/script.js': 'setTimeout(f,1)' }, 'video'), plan: FILM }).findings.filter((f) => f.rule === 'film-determinism');
  assert.deepEqual(one.map(({ severity, section, file }) => [severity, section, file]), [['error', 'a', 'sections/a/script.js']]);
  assert.match(one[0].message, /setTimeout.* breaks a seek: the film must be a pure function of time$/);
});
test('beyond the plan (p8t1 live proof): will-change breaks a seek too, in a scene and in the lead\'s CSS', async () => {
  // A real film's global.css gave every word `will-change: transform, opacity`: Chrome then rasterizes those layers by
  // their history, so the same time sought out of order painted 21,773 pixels differently. Off, the frames were equal.
  const film = (files) => lintDesign({ workDir: seed({ ...BASE, ...files }), plan: FILM }).findings.filter((f) => f.rule === 'film-determinism');
  const css = film({ 'sections/a/style.css': '[data-section="a"] b{will-change:transform,opacity}' });
  assert.deepEqual(css.map(({ section, file, message }) => [section, file, message]), [['a', 'sections/a/style.css', 'will-change breaks a seek: the film must be a pure function of time']]);
  assert.deepEqual(film({ 'sections/a/script.js': 'S.tl.set(root,{willChange:"transform"},0)' }).map((f) => f.message.split(' ')[0]), ['willChange']);
  const lead = film({ 'tokens.css': ':root{--a:1}', 'global.css': '[data-scene] .word{display:inline-block;will-change:transform}\n[data-scene] p{transition:opacity .2s}\n@keyframes spin{to{top:0}}\n[data-scene] i{will-change:opacity}' });
  assert.deepEqual(lead.map(({ severity, section, file, message }) => [severity, section, file, message.split(' breaks')[0]]),
    [['error', null, 'global.css', '@keyframes spin'], ['error', null, 'global.css', 'will-change'], ['error', null, 'global.css', 'transition']]);
  assert.deepEqual(film({ 'global.css': '/* will-change: transform */ b{top:0}' }), []);
  const deck = await world({ ...DECK_FILES, 'global.css': 'h1{will-change:transform;transition:top 1s}' }, 'pitch');
  assert.equal(lintDesign({ workDir: deck, plan: DECK }).findings.filter((f) => f.rule === 'film-determinism').length, 0, 'a deck keeps its CSS');
});
test('a deck is not held to the film rules', async () => {
  const plan = { ...DECK, sections: [{ ...DECK.sections[0], parts: ['html', 'css', 'js'] }, DECK.sections[1]] };
  const w = await world({ ...DECK_FILES, 'sections/s1/script.js': 'setTimeout(f,1)' }, 'pitch');
  assert.equal(lintDesign({ workDir: w, plan }).findings.filter((f) => f.rule === 'film-determinism').length, 0);
});

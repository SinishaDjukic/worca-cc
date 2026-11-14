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
import { _testing, assembleDesign, lintDesign } from '../src/core/design/assemble.mjs';
import { FILM_BASE_CSS, filmPlanScript } from '../src/core/design/kinds.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { clipKey, musicKey } from '../src/core/design/sound.mjs';
import { silentWav } from '../src/core/sound.mjs';
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

// Design sound (B7): a film opened alone carries its voice and music as the foot's `<audio>` elements, which film.js
// plays. `filmWork` is a video whose open and close scenes speak, with (or without) the round's files in assets/sound/.
const SAY_OPEN = 'Every pot starts as a lump of clay.';
const SAY_CLOSE = 'Come and make one.';
const FILM_SOUND = { ...FILM, sections: [{ ...scene('open', 5.7), say: SAY_OPEN }, scene('mid', 6), { ...scene('close', 3), say: SAY_CLOSE }] };
const VOICE = { id: 'voice-test', name: 'Test', model: 'eleven_multilingual_v2' };
const soundClip = (id, text, seconds) => ({ id, file: `voice-${id}.wav`, key: clipKey({ voiceId: VOICE.id, model: VOICE.model, text }), at: 0.35, seconds, text, cues: [{ t: 0.35, text }] });
async function filmWork({ sound }) {
  const files = { 'shell.html': SHELL };
  for (const { id } of FILM_SOUND.sections) files[`sections/${id}/index.html`] = `<div data-section="${id}" data-scene><b>${id}</b></div>`;
  if (sound) {
    const music = { file: 'music.wav', key: musicKey({ prompt: 'warm piano', model: 'music_v2_5' }), seconds: 14.7, gain: 0.16, prompt: 'warm piano' };
    files['assets/sound/sound.json'] = JSON.stringify({ v: 1, voice: VOICE, clips: [soundClip('open', SAY_OPEN, 4.82), soundClip('close', SAY_CLOSE, 2)], music });
    files['assets/sound/voice-open.wav'] = silentWav(4.82);
    files['assets/sound/voice-close.wav'] = silentWav(2);
    files['assets/sound/music.wav'] = silentWav(14.7);
  }
  return world(files, 'video');
}
test('dist and standalone carry the film\'s sound; run and build do not', async () => {
  const work = await filmWork({ sound: true });
  const dist = assembleDesign({ workDir: work, plan: FILM_SOUND, mode: 'dist', kind: 'video' }).html;
  assert.match(dist, /<audio data-film-clip="open" data-start="0\.35" data-seconds="4\.82" preload="auto" src="assets\/sound\/voice-open\.wav"><\/audio>\n<audio data-film-clip="close" data-start="12\.05" data-seconds="2" preload="auto" src="assets\/sound\/voice-close\.wav"><\/audio>\n<audio data-film-music data-seconds="14\.7" data-gain="0\.16" preload="auto" loop src="assets\/sound\/music\.wav"><\/audio>\n<script>window\.FILM_PLAN=/);
  for (const mode of ['run', 'build']) assert.doesNotMatch(assembleDesign({ workDir: work, plan: FILM_SOUND, mode, kind: 'video' }).html, /<audio/);
  const silent = await filmWork({ sound: false });
  assert.doesNotMatch(assembleDesign({ workDir: silent, plan: FILM_SOUND, mode: 'dist', kind: 'video' }).html, /<audio/);
});
test('the single HTML file holds the sound itself; a still never does', async () => {
  const work = await filmWork({ sound: true });
  const html = assembleDesign({ workDir: work, plan: FILM_SOUND, mode: 'standalone', kind: 'video' }).html;
  assert.equal((html.match(/<audio [^>]*src="data:audio\/wav;base64,/g) || []).length, 3);
  assert.doesNotMatch(html, /src="assets\/sound\//);
  assert.doesNotMatch(assembleDesign({ workDir: work, plan: FILM_SOUND, mode: 'standalone', kind: 'video', sound: false }).html, /<audio/);
});
test('every value a sound line writes is escaped (the manifest is an agent\'s file)', () => {
  const odd = { clips: [{ id: 'a"b', file: 'x&<y>.wav', start: 1.5, seconds: 2 }], music: { file: "m'.wav", seconds: 3, gain: 0.16 } };
  assert.equal(_testing.filmAudioText(odd), '<audio data-film-clip="a&quot;b" data-start="1.5" data-seconds="2" preload="auto" src="assets/sound/x&amp;&lt;y&gt;.wav"></audio>\n'
    + '<audio data-film-music data-seconds="3" data-gain="0.16" preload="auto" loop src="assets/sound/m&#39;.wav"></audio>');
  assert.equal(_testing.filmAudioText(null), '');
});
test('a plan that does not name its kind finds the film\'s sound by the kind passed in', async () => {
  const html = assembleDesign({ workDir: await filmWork({ sound: true }), plan: { ...FILM_SOUND, kind: undefined }, mode: 'dist', kind: 'video' }).html;
  assert.match(html, /<audio data-film-clip="open" [^\n]*\n<audio data-film-clip="close" [^\n]*\n<audio data-film-music /);
});

// MP4 export: the frame capture reads the standalone film held still, so it is assembled `embedded` (film.js then adds
// no bar and starts nothing by itself). Nothing else about the page changes.
test('embedded: a standalone film assembles held still for the frame capture, and is otherwise the same page', async () => {
  const work = await world(BASE, 'video');
  const alone = assembleDesign({ workDir: work, plan: FILM, mode: 'standalone', kind: 'video' }).html;
  const held = assembleDesign({ workDir: work, plan: FILM, mode: 'standalone', kind: 'video', embedded: true }).html;
  assert.match(alone, /"embedded":false/);
  assert.match(held, /"embedded":true/);
  assert.equal(held.replace('"embedded":true', '"embedded":false'), alone);
  assert.match(filmPlanScript({ plan: FILM, mode: 'dist', embedded: true }), /"embedded":true/);
  assert.match(filmPlanScript({ plan: FILM, mode: 'dist' }), /"embedded":false/);
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { gsapPath } from '../assets/promo-kit/tools/init-film.mjs';

const GSAP = readFileSync(gsapPath(), 'utf8');
const FILM = readFileSync(new URL('../assets/design-kit/video/film.js', import.meta.url), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));   // out of the jsdom realm: deepEqual compares prototypes
const r6 = (x) => Math.round(x * 1e6) / 1e6;
// The table soundAt (src/shared/sound-services.mjs) is pinned by too: film.js carries the same rule.
const cases = JSON.parse(readFileSync(new URL('./fixtures/film-sound-cases.json', import.meta.url), 'utf8'));
const windows = []; after(() => { for (const w of windows) w.close(); });
// The audio elements the assembler writes into a dist or standalone film, after the stage and before the scripts.
const audioHtml = ({ clips = [], music = null }) => [
  ...clips.map((c) => `<audio data-film-clip="${c.id}" data-start="${c.start}" data-seconds="${c.seconds}" preload="auto" src="assets/sound/${c.file}"></audio>`),
  ...(music ? [`<audio data-film-music data-seconds="${music.seconds}" data-gain="${music.gain}" preload="auto" loop src="assets/sound/${music.file}"></audio>`] : []),
].join('\n');
// jsdom plays nothing: its play() and pause() are stubs returning undefined and its paused is a getter, so each element
// gets its own paused, and a play and a pause that flip it and record the call.
function playable(el) {
  Object.defineProperty(el, 'paused', { value: true, writable: true });
  el.calls = [];
  el.play = () => { el.paused = false; el.calls.push('play'); return Promise.resolve(); };
  el.pause = () => { el.paused = true; el.calls.push('pause'); };
  return el;
}
function boot({ scenes = [['a', 2], ['b', 3]], html, css = '', scripts = {}, embedded = true, hash = '', start = true, reduced = false, tracks } = {}) {
  const body = html ?? scenes.map(([id]) => `<div data-section="${id}" data-scene><b id="${id}-b">${id}</b></div>`).join('');
  const sound = tracks ? '\n' + audioHtml(tracks) : '';
  const win = new JSDOM(`<!doctype html><html><head><style>${css}</style></head><body><div data-film>${body}</div>${sound}</body></html>`, { url: `http://localhost/x${hash}`, runScripts: 'outside-only', pretendToBeVisual: true }).window;
  windows.push(win);
  const audio = { clips: [...win.document.querySelectorAll('audio[data-film-clip]')].map(playable), music: win.document.querySelector('audio[data-film-music]') };
  if (audio.music) playable(audio.music);
  const raf = []; let now = 0;
  win.requestAnimationFrame = (f) => raf.push(f); win.cancelAnimationFrame = () => { raf.length = 0; };
  Object.defineProperty(win.performance, 'now', { value: () => now });
  win.matchMedia = () => ({ matches: reduced });
  win.FILM_PLAN = { w: 1920, h: 1080, fps: 60, embedded, scenes: scenes.map(([id, duration]) => ({ id, duration })) };
  win.eval(GSAP); win.eval(FILM);
  for (const [id, js] of Object.entries(scripts)) win.eval(`F.scene(${JSON.stringify(id)},function(root,S){\n${js}\n});`);
  if (start) win.F.start();
  return { win, doc: win.document, F: win.F, audio, $: (id) => win.document.querySelector(`[data-section="${id}"]`), advance(ms) { now += ms; for (const f of raf.splice(0)) f(now); } };
}
test('windows come from the plan, in order', () => {
  const { F } = boot();
  assert.equal(F.DUR, 5);
  assert.deepEqual(plain(F.scenes.map((s) => [s.id, s.start, s.end, s.dur])), [['a', 0, 2, 2], ['b', 2, 5, 3]]);
});
test('a frame is a pure function of time: any seek order gives the same frame', () => {
  const tween = "const el=root.querySelector('b');S.tl.set(el,{opacity:0},0).to(el,{opacity:1,duration:1,ease:'none'},1);";
  const { F, doc } = boot({ scripts: { a: tween, b: tween } });
  const op = (id) => Number(doc.querySelector(`#${id}-b`).style.opacity);
  F.seek(1.5); const first = op('a');
  assert.ok(Math.abs(first - 0.5) < 0.01);
  F.seek(4); F.seek(0.2); assert.equal(op('a'), 0);
  F.seek(1.5); assert.ok(Math.abs(op('a') - first) < 1e-3);
  F.seek(3.5); assert.ok(Math.abs(op('b') - 0.5) < 0.01);
});
test('only the scene under the playhead shows, with the display its author gave it; the last frame holds', () => {
  const { F, $ } = boot({ css: '[data-section="b"]{display:flex}' });
  F.seek(1); assert.deepEqual([$('a').style.display, $('b').style.display], ['block', 'none']);
  F.seek(3); assert.deepEqual([$('a').style.display, $('b').style.display], ['none', 'flex']);
  F.seek(5); assert.equal($('b').style.display, 'flex', 'the end holds the last scene, never black');
  F.seek(2); assert.equal($('b').style.display, 'flex', 'a seek back onto a boundary shows the later scene');
  F.seek(1.9); assert.equal($('a').style.display, 'block');
});
test('one bad scene stays one bad scene', () => {
  const { F, $ } = boot({ scenes: [['a', 2], ['b', 3], ['c', 1]], html: '<div data-section="b" data-scene>b</div><div data-section="c" data-scene>c</div>', scripts: { b: 'throw new Error("boom")' } });
  assert.equal(F.DUR, 6, 'a section with no element keeps its window');
  F.seek(1); assert.equal($('b').style.display, 'none');
  F.seek(3); assert.equal($('b').style.display, 'block', 'a throwing build leaves the composed state');
  F.seek(5.5); assert.equal($('c').style.display, 'block', 'no script: the composed state');
  assert.ok(plain(F.violations).some((v) => /scene b build failed: .*boom/s.test(v)));
});
// Review M1: a hook runs on every frame of every scene, its localT below 0 too, so one that throws must stay in its scene.
test('a throwing onFrame hook is one violation; the film still starts, renders and tells the parent', () => {
  const { F, doc, $, win } = boot({ start: false, scenes: [['a', 2], ['b', 3], ['c', 1]], scripts: {
    a: "S.tl.set(root.querySelector('b'),{opacity:0.25},0);",
    b: "S.onFrame((l)=>{throw new Error('hook at '+l);});",
    c: 'window.__c=[];S.onFrame((l)=>window.__c.push(l));',
  } });
  const times = []; doc.addEventListener('filmtime', (e) => times.push(plain(e.detail)));
  F.start();
  assert.equal(doc.querySelector('[data-film]').style.visibility, 'visible', 'the first render reached the end of start()');
  assert.deepEqual(times, [{ t: 0, playing: false, dur: 6 }]);
  assert.deepEqual([$('a').style.display, doc.querySelector('#a-b').style.opacity], ['block', '0.25'], 'scene a renders');
  assert.deepEqual(plain(win.__c), [-5], 'a later scene\'s hook still runs');
  F.seek(3); F.seek(5.5);
  assert.deepEqual([$('b').style.display, $('c').style.display, times.at(-1)], ['none', 'block', { t: 5.5, playing: false, dur: 6 }]);
  assert.deepEqual(plain(win.__c), [-5, -2, 0.5]);
  assert.equal(F.violations.length, 1, 'once per scene, though each frame throws a different message');
  assert.match(F.violations[0], /^scene b onFrame failed: Error: hook at -2/);
});
test('a build that throws after touching S.tl leaves no partial timeline and no hooks', () => {
  const { F, $, win } = boot({ scripts: { a: 'window.__a=0;S.onFrame(()=>{window.__a++;});', b: "window.__n=0;S.onFrame(()=>{window.__n++;});S.tl.set(root,{opacity:0},0);throw new Error('x');" } });
  const before = win.__a;
  for (const t of [3, 0.5, 4.9, 2, 3.5]) { F.seek(t); assert.equal($('b').style.opacity, '', `t=${t}: the composed state, no partial timeline`); }
  assert.equal($('b').style.display, 'block');
  assert.equal(win.__n, 0, 'the failed build\'s hooks never run');
  assert.equal(win.__a - before, 5, 'an earlier scene\'s hooks stay');
  assert.equal(F.violations.length, 1);
  assert.match(F.violations[0], /^scene b build failed: Error: x/);
});
test('each scene whose hook throws is its own violation', () => {
  const { F } = boot({ scripts: { a: "S.onFrame(()=>{throw new Error('a');});", b: "S.onFrame(()=>{throw new Error('b');});" } });
  F.seek(3); F.seek(1);
  assert.deepEqual(plain(F.violations).map((v) => v.split(':')[0]), ['scene a onFrame failed', 'scene b onFrame failed']);
  // Review cycle 3 (f10): the key is the scene and the kind, so one scene's hook and its tween callback are two.
  const two = boot({ scripts: { b: "S.onFrame(()=>{throw new Error('h');});S.tl.to({v:0},{v:1,duration:1,onUpdate:()=>{throw new Error('u');}},0.5);" } });
  two.F.seek(3); two.F.seek(3.2); two.F.seek(1);
  assert.deepEqual(plain(two.F.violations).map((v) => v.split(':')[0]), ['scene b onFrame failed', 'scene b onUpdate failed']);
});
// Review M1, cycle 2: GSAP runs a tween's callbacks inside the master's render with no try, so one that threw stopped
// every seek, the start and the play loop. A count-up whose element is missing is the usual one.
const SCENES3 = [['a', 2], ['b', 3], ['c', 1]];
test('a count-up whose element is missing stays in its scene: seeks, play and the stage go on', () => {
  const { F, doc, $, advance } = boot({ scenes: SCENES3, scripts: { b: "const o={v:0};const el=root.querySelector('.missing');S.tl.to(o,{v:100,duration:1,onUpdate:()=>{el.textContent=Math.round(o.v);}},0.5);" } });
  assert.equal(doc.querySelector('[data-film]').style.visibility, 'visible');
  const shown = () => ['a', 'b', 'c'].filter((id) => $(id).style.display !== 'none');
  for (const [t, id] of [[3, 'b'], [5.5, 'c'], [1, 'a']]) { F.seek(t); assert.deepEqual(shown(), [id], `seek(${t})`); }
  F.seek(2); F.play(); advance(1000); advance(500);
  assert.deepEqual([F.t, F.playing, shown()], [3.5, true, ['b']]);
  advance(1500); assert.deepEqual([F.t, F.playing, shown()], [5, true, ['c']], 'play ran past b');
  assert.equal(F.violations.length, 1, 'once, though each frame throws');
  assert.match(F.violations[0], /^scene b onUpdate failed: TypeError/);
});
test('an onStart that throws at the film\'s start is one violation; the film starts and tells the parent', () => {
  const { F, doc, $ } = boot({ start: false, scenes: SCENES3, scripts: { a: "S.tl.to(root,{opacity:0.5,duration:1,onStart:()=>{throw new Error('s');}},0);" } });
  const times = []; doc.addEventListener('filmtime', (e) => times.push(plain(e.detail)));
  F.start();
  assert.equal(doc.querySelector('[data-film]').style.visibility, 'visible');
  assert.deepEqual(times, [{ t: 0, playing: false, dur: 6 }]);
  F.seek(1); assert.equal($('a').style.opacity, '0.5', 'the tween itself still runs');
  assert.deepEqual(plain(F.violations).map((v) => v.split('\n')[0]), ['scene a onStart failed: Error: s']);
});
test('tl.call, keyframe and stagger callbacks are guarded too; a function value that throws fails its build', () => {
  const { F, $ } = boot({ scenes: [['a', 2], ['b', 3], ['c', 1], ['d', 1]], html: ['a', 'b', 'c', 'd'].map((id) => `<div data-section="${id}" data-scene>${id}</div>`).join(''), scripts: {
    a: "S.tl.call(()=>{throw new Error('call');},null,0.5);",
    b: "S.tl.to({v:0},{keyframes:[{v:1,duration:0.2,onStart(){throw new Error('key');}},{v:2,duration:0.2}]},0.5);",
    c: "S.tl.to([{v:0},{v:0}],{v:1,duration:0.2,stagger:{each:0.1,onComplete(){throw new Error('stag');}}},0.1);",
    d: "S.tl.to(root,{opacity:()=>{throw new Error('fn');},duration:0.5},0.2);",
  } });
  for (const t of [1, 3, 4.9, 6.5, 0]) assert.doesNotThrow(() => F.seek(t), `seek(${t})`);
  F.seek(6.5); assert.equal($('d').style.display, 'block');
  assert.deepEqual(plain(F.violations).map((v) => v.split('\n')[0]).sort(), ['scene a onComplete failed: Error: call', 'scene b onStart failed: Error: key',
    'scene c onComplete failed: Error: stag', 'scene d build failed: Error: fn']);
});
// Review cycle 3, issue 1: GSAP starts a scene's tweens up (and runs its function values) when a render first reaches
// them, so the scene's root must already be shown there: a value that measures layout read 0, one that threw broke start().
// The stage is still at its own size then (fit comes after the prime), so a measure is in stage pixels.
test('a scene\'s function values run with its root shown and the stage unscaled, in any seek order', () => {
  const { F, win, doc } = boot({ start: false, scenes: SCENES3, scripts: {
    a: "window.__tf=[];S.onFrame(()=>window.__tf.push(document.querySelector('[data-film]').style.transform));",
    b: "const el=root.querySelector('b');S.tl.to(el,{x:()=>{if(getComputedStyle(root).display==='none')throw new Error('hidden');return document.querySelector('[data-film]').style.transform?99:10;},duration:1,ease:'none'},0.5);",
  } });
  assert.doesNotThrow(() => F.start());
  assert.match(win.__tf[0], /scale\(0\.5333/, 'start\'s own first frame already sees the fitted stage');
  const x = () => win.gsap.getProperty(doc.querySelector('#b-b'), 'x');
  for (const [t, want] of [[3.5, 10], [0, 0], [5.5, 10], [3, 5], [1, 0], [4, 10], [2.6, 1]]) { F.seek(t); assert.ok(Math.abs(x() - want) < 1e-6, `t=${t}: ${x()}`); }
  assert.deepEqual(plain(F.violations), []);
  assert.match(doc.querySelector('[data-film]').style.transform, /scale\(0\.5333/, 'fitted after the prime');
});
test('a target two scenes animate starts each tween where the scene before left it, in any seek order', () => {
  const { F, win } = boot({ scripts: { a: "window.G={x:0};S.tl.to(G,{x:100,duration:1,ease:'none'},0);", b: "S.tl.to(G,{x:200,duration:1,ease:'none'},0);" } });
  for (const [t, x] of [[2.5, 150], [1.5, 100], [0.5, 50], [2.5, 150], [4, 200], [0, 0]]) { F.seek(t); assert.ok(Math.abs(win.G.x - x) < 1e-3, `t=${t}: ${win.G.x}`); }
});
test('the nets: a frame that throws outside any scene guard still shows the stage and keeps play going', () => {
  const first = boot({ start: false, scripts: { a: "F.master.call(()=>{throw new Error('m0');},null,0);" } });
  assert.throws(() => first.F.start(), /m0/);
  assert.equal(first.doc.querySelector('[data-film]').style.visibility, 'visible', 'shown whatever threw');
  // Review cycle 3, issue 1: a throw in the prime itself (a value that fails on its second run) still fits the stage.
  const prime = boot({ start: false, scripts: { a: "let n=0;S.tl.to(root,{x:()=>{if(n++)throw new Error('twice');return 1;},duration:1},0);" } });
  assert.throws(() => prime.F.start(), /twice/);
  const st = prime.doc.querySelector('[data-film]');
  assert.deepEqual([st.style.visibility, /scale\(0\.5333/.test(st.style.transform)], ['visible', true], 'shown and fitted');
  prime.win.innerWidth = 960; prime.win.dispatchEvent(new prime.win.Event('resize'));
  assert.match(st.style.transform, /scale\(0\.5\)/, 'and refitted on a resize');
  const { F, advance } = boot({ scripts: { a: "F.master.call(()=>{throw new Error('m1');},null,1);" } });
  F.play(); advance(500);
  assert.throws(() => advance(1000), /m1/);
  advance(1000); assert.deepEqual([F.t, F.playing], [2.5, true], 'the next frame was asked for');
});
test('a hook that throws inside its own window does not stop play', () => {
  const { F, doc, advance } = boot({ scripts: { b: "S.onFrame((l)=>{if(l>=0&&l<S.dur)throw new Error('mid');});" } });
  const times = []; doc.addEventListener('filmtime', (e) => times.push(plain(e.detail)));
  F.play(); advance(1000); advance(1500);
  assert.deepEqual([F.t, F.playing], [2.5, true]);
  advance(1000); assert.deepEqual([F.t, F.playing], [3.5, true], 'the next frame was scheduled');
  advance(5000); assert.deepEqual([F.t, F.playing], [5, false]);
  assert.deepEqual(times.at(-1), { t: 5, playing: false, dur: 5 });
  assert.equal(F.violations.length, 1); assert.match(F.violations[0], /^scene b onFrame failed: Error: mid/);
});
test('a timeline past its window, and a script for an unknown scene, are violations', () => {
  const { F } = boot({ scripts: { a: 'S.tl.to({x:0},{x:1,duration:9},0);', ghost: '' } });
  assert.ok(plain(F.violations).some((v) => v.includes('scene a timeline runs 9.00s > its 2.00s window')));
  assert.ok(plain(F.violations).some((v) => v.includes('script for unknown scene ghost')));
});
test('onFrame gets local and film time; filmtime fires on every render, filmscene when the scene changes', () => {
  const { F, doc, win } = boot({ start: false, scripts: { b: 'window.__f=[];S.onFrame((l,t)=>window.__f.push([l,t]));' } });
  const times = []; const seen = [];
  doc.addEventListener('filmtime', (e) => times.push(plain(e.detail))); doc.addEventListener('filmscene', (e) => seen.push(e.detail.id));
  F.start(); F.seek(3); F.seek(3.5); F.seek(1);
  assert.deepEqual(seen, ['a', 'b', 'a']);
  assert.deepEqual(times.at(-1), { t: 1, playing: false, dur: 5 });
  assert.deepEqual(plain(win.__f).at(-2), [1.5, 3.5]);
});
test('play advances by wall time, stops at the end on the last frame, and restarts from zero', () => {
  const { F, advance } = boot();
  F.play(); assert.equal(F.playing, true);
  advance(1000); assert.ok(Math.abs(F.t - 1) < 1e-6);
  F.seek(4); advance(500); assert.ok(Math.abs(F.t - 4.5) < 1e-6, 'a seek while playing carries on from there');
  advance(5000); assert.deepEqual([F.t, F.playing], [5, false]);
  F.play(); assert.equal(F.t, 0);
  F.pause(); advance(1000); assert.equal(F.t, 0);
});
test('a pause and the stop at the end each tell the parent the film stopped', () => {
  const { F, doc, advance } = boot();
  const times = []; doc.addEventListener('filmtime', (e) => times.push(plain(e.detail)));
  F.play(); assert.equal(times.at(-1).playing, true);
  F.pause(); assert.equal(times.at(-1).playing, false);
  F.play(); advance(9000); assert.deepEqual(times.at(-1), { t: 5, playing: false, dur: 5 });
});
test('in worca the film waits for the parent; opened alone it plays, with keys and a bar', () => {
  const inside = boot({ embedded: true });
  assert.equal(inside.F.playing, false); assert.equal(inside.doc.querySelector('[data-film-bar]'), null);
  const alone = boot({ embedded: false });
  assert.equal(alone.F.playing, true); assert.ok(alone.doc.querySelector('[data-film-bar]'));
  const key = (o) => alone.doc.dispatchEvent(new alone.win.KeyboardEvent('keydown', { bubbles: true, ...o }));
  key({ key: ' ' }); assert.equal(alone.F.playing, false);
  alone.F.seek(1); key({ key: 'ArrowRight' }); assert.equal(alone.F.t, 2);
  key({ key: 'ArrowLeft', shiftKey: true }); assert.ok(Math.abs(alone.F.t - (2 - 1 / 60)) < 1e-6);
  key({ key: 'Home' }); assert.equal(alone.F.t, 0);
  // Review m6: a browser shortcut is not a seek, and keeps its default.
  for (const mod of ['metaKey', 'altKey', 'ctrlKey']) {
    alone.F.seek(2); const e = new alone.win.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft', [mod]: true });
    alone.doc.dispatchEvent(e); assert.deepEqual([alone.F.t, e.defaultPrevented], [2, false], mod);
  }
  const held = boot({ embedded: false, hash: '#t=3' });
  assert.deepEqual([held.F.t, held.F.playing], [3, false]);
  assert.equal(boot({ embedded: false, reduced: true }).F.playing, false);
  assert.equal(boot({ embedded: true, hash: '#t=3' }).F.t, 0, 'the run doc hash is the frame nonce, never a time');
});
test('the stage fits the window, letterboxed, and shows once started', () => {
  const { doc } = boot(); const st = doc.querySelector('[data-film]');
  assert.match(st.style.transform, /translate\(0px, 96px\) scale\(0\.5333/);
  assert.equal(st.style.visibility, 'visible');
});
test('S.random is seeded; no plate, mascot, camera, sound or caption API exists', () => {
  const { F, win } = boot({ scripts: { a: 'window.__S=S;' } });
  assert.equal(win.__S.random(7)(), win.__S.random(7)());
  assert.notEqual(win.__S.random(7)(), win.__S.random(8)());
  for (const n of ['plate', 'seq', 'mascot', 'camera', 'cursor', 'sfx', 'vo', 'word', 'caption', 'chapter']) assert.equal(n in win.__S, false, n);
  for (const n of ['plateUrl', 'vo', 'word', 'sfxAt', 'SFX', 'cues', 'D']) assert.equal(n in F, false, n);
  assert.doesNotMatch(FILM, /new Audio|<audio|<video|\.mp4|localStorage|\.kit\/|data-worca-|<script|gsap\.ticker\.add/);   // Task 5 checks the run doc's raw text for the first four
});
test('film.js plays by the shared table', () => {
  const { F, audio } = boot({ embedded: false, scenes: [['a', 5], ['b', 5]], tracks: cases.tracks });   // a 10 s film, as the table's
  assert.equal(F.playing, false);                                                       // no autoplay with sound
  F.play();
  assert.deepEqual(audio.clips[1].calls.slice(0, 2), ['play', 'pause']);                // the unlock: b starts at 5.35, outside the click
  for (const c of cases.cases.filter((x) => x.t < cases.dur)) {
    F.seek(c.t);
    assert.deepEqual(audio.clips.map((a) => !a.paused), c.clips.map(([on]) => on), `clips at ${c.t}`);
    assert.equal(!audio.music.paused, c.music[0], `music at ${c.t}`);
    assert.equal(r6(audio.music.volume), c.music[2], `volume at ${c.t}`);
  }
  F.seek(1); assert.deepEqual([r6(audio.clips[0].currentTime), r6(audio.music.currentTime)], [0.65, 1]);
  F.seek(1.5); assert.equal(r6(audio.clips[0].currentTime), 1.15);                       // a playing clip 0.5 s off is set right
  F.seek(1.6); assert.equal(r6(audio.clips[0].currentTime), 1.15);                       // 0.1 s off is left alone (SOUND_DRIFT)
  F.pause();
  assert.deepEqual([...audio.clips, audio.music].map((a) => a.paused), [true, true, true]);
  F.seek(6);
  assert.equal(audio.clips[1].paused, true);                                            // a seek while paused starts nothing
});
test('the film\'s end stops every element, the looping music too', () => {
  const { F, audio, advance } = boot({ embedded: false, scenes: [['a', 5], ['b', 5]], tracks: cases.tracks });
  F.play(); F.seek(9.5);
  assert.equal(audio.music.paused, false);                                              // red before B7: something to stop
  advance(1000);
  assert.equal(F.playing, false);
  assert.deepEqual([...audio.clips, audio.music].map((a) => a.paused), [true, true, true]);
});
test('a silent film opened alone still autoplays', () => {
  assert.equal(boot({ embedded: false }).F.playing, true);
});
test('the unlock is the first play\'s alone; the music loops in place and its volume never passes 1', () => {
  const tracks = { ...cases.tracks, music: { ...cases.tracks.music, gain: 2 } };
  const { F, audio } = boot({ embedded: false, scenes: [['a', 5], ['b', 5]], tracks });
  F.play(); F.pause(); F.play();
  assert.deepEqual(audio.music.calls, ['play', 'pause', 'play', 'pause', 'play']);      // the unlock, then play, pause, play
  assert.deepEqual(audio.clips[1].calls, ['play', 'pause']);                            // b is never on before 5.35
  F.seek(5); assert.equal(audio.music.volume, 1);                                       // a gain of 2, clamped: an audio element refuses past 1
  F.seek(9); assert.deepEqual([r6(audio.music.currentTime), r6(audio.music.volume)], [1, 1]);   // 9 % 8
  assert.deepEqual(plain(F.violations), []);
});
test('a sound that throws is the sound\'s alone: play goes on, and it is reported once', () => {
  const tracks = { clips: [], music: { ...cases.tracks.music, seconds: 0 } };            // t % 0 is NaN, which currentTime refuses
  const { F, advance } = boot({ embedded: false, scenes: [['a', 5], ['b', 5]], tracks });
  assert.doesNotThrow(() => F.play());
  advance(1000); assert.deepEqual([F.t, F.playing], [1, true]);
  assert.equal(F.violations.length, 1); assert.match(F.violations[0], /^sound failed: /);
});

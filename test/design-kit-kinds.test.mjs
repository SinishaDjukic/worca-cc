// test/design-kit-kinds.test.mjs — Design P7 Task 3: stageDesignKit stages the kit of each design kind into
// `work/.kit/` (the deck CONTRACT plus OpenDeck's three runtime scripts byte for byte, the film CONTRACT with film.js
// and gsap), and the two CONTRACTs pin what the assembler, the lint and the player enforce.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { gsapPath } from '../assets/promo-kit/tools/init-film.mjs';

const R = new URL('../', import.meta.url);
const text = (p) => readFileSync(new URL(p, R), 'utf8');
const bytes = (p) => readFileSync(new URL(p, R));
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), "dkit 'q-")); dirs.push(d); return d; };
test('presentation and pitch stage the deck kit, byte for byte, and nothing else of it', async () => {
  for (const kind of ['presentation', 'pitch']) {
    const w = tmp();
    assert.equal(await stageDesignKit({ kind, workDir: w }), true);
    assert.deepEqual(readdirSync(join(w, '.kit')).sort(), ['CONTRACT.md', 'deck-enhance.js', 'deck-pipeline.js', 'deck-stage.js']);
    for (const f of ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js']) assert.deepEqual(readFileSync(join(w, '.kit', f)), bytes(`assets/deck-kit/${f}`), f);
    assert.equal(readFileSync(join(w, '.kit/CONTRACT.md'), 'utf8'), text('assets/design-kit/deck/CONTRACT.md'));
  }
});
test('video stages the film kit with gsap', async () => {
  const w = tmp();
  assert.equal(await stageDesignKit({ kind: 'video', workDir: w }), true);
  assert.deepEqual(readdirSync(join(w, '.kit')).sort(), ['CONTRACT.md', 'film.js', 'gsap.min.js']);
  assert.deepEqual(readFileSync(join(w, '.kit/gsap.min.js')), readFileSync(gsapPath()));
});
test('a new round repairs a changed kit file; web is untouched; a folder name is not a kind', async () => {
  const w = tmp();
  await stageDesignKit({ kind: 'pitch', workDir: w });
  writeFileSync(join(w, '.kit/deck-stage.js'), 'tampered');
  await stageDesignKit({ kind: 'pitch', workDir: w });
  assert.deepEqual(readFileSync(join(w, '.kit/deck-stage.js')), bytes('assets/deck-kit/deck-stage.js'));
  const web = tmp();
  assert.equal(await stageDesignKit({ kind: 'web', workDir: web }), true);
  assert.deepEqual(readdirSync(join(web, '.kit')), ['CONTRACT.md']);
  for (const k of ['deck', 'nope', '../x']) assert.equal(await stageDesignKit({ kind: k, workDir: tmp() }), false, k);
});
test('a link at a runtime file is replaced, never written through', { skip: process.platform === 'win32' }, async () => {
  for (const [kind, name] of [['presentation', 'deck-stage.js'], ['video', 'gsap.min.js']]) {
    const w = tmp();
    mkdirSync(join(w, 'out'));
    writeFileSync(join(w, 'out/keep.js'), 'mine');
    mkdirSync(join(w, 'work/.kit'), { recursive: true });
    symlinkSync(join(w, 'out/keep.js'), join(w, 'work/.kit', name));
    assert.equal(await stageDesignKit({ kind, workDir: join(w, 'work') }), true);
    assert.equal(readFileSync(join(w, 'out/keep.js'), 'utf8'), 'mine', name);
    assert.equal(lstatSync(join(w, 'work/.kit', name)).isSymbolicLink(), false, name);
  }
});
test('the CONTRACTs pin what the assembler, the lint and the player enforce', () => {
  const deck = text('assets/design-kit/deck/CONTRACT.md'); const film = text('assets/design-kit/video/CONTRACT.md');
  for (const c of [deck, film]) {
    for (const must of ['<!--worca:head-->', '<!--worca:sections-->', '<!--worca:foot-->', '[data-section="<id>"]', 'plan.json', 'one `Write`', 'assets/x.png', 'No external URLs', '.asks/<agentId>.json', '"w":1920,"h":1080', 'at most 40']) assert.ok(c.includes(must), must);
    assert.doesNotMatch(c, /worca-cc|replay|https?:\/\/|data-worca-slot"/i);
  }
  for (const must of ['data-label', '<section data-section="<id>" data-label="<job>">', 'data-step', 'data-deck-anim="rise|draw|wipe|pop|count"', 'data-deck-caption', 'data-deck-skip', '36px', '56px', '20px', '4.5:1', '30 words', 'deck-stage', '"kind":"presentation"']) assert.ok(deck.includes(must), must);
  for (const must of ['<div data-section="<id>" data-scene>', 'composed state', '(root, S)', 'S.tl', 'S.dur', 'S.onFrame', 'S.enter', 'S.exit', 'S.random', 'setTimeout', 'requestAnimationFrame', 'Date', 'Math.random', 'gsap.from', '"fps":60', '"duration"', 'pure function of film time']) assert.ok(film.includes(must), must);
  assert.doesNotMatch(film, /plate|mascot|narrat|voice|mp4|sfx/i);
  // Beyond the plan (p8t1 live proof): what the real deck and film broke, now in the rules they read.
  assert.ok(deck.includes('Nothing reaches past the canvas') && deck.includes('`overflow:hidden`'), 'a bleeding shape is clipped inside the slide');
  assert.ok(film.includes('CSS has no `@keyframes`, `animation`, `transition` or `will-change`, in `tokens.css` and `global.css` too'), 'film CSS rules');
});

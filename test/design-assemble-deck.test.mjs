// test/design-assemble-deck.test.mjs — Design P7 Task 4: presentation and pitch assemble on the real OpenDeck
// `deck-stage`. The kit scripts are inlined from `work/.kit/` by a fixed list, so no doc references `.kit/` by URL;
// shell slots do not apply to decks, and lint says so (`shell-slot-kind`, `shell-stage`).
// Text checks on a doc that inlines the kit go through `parse`: deck-stage.js's own comments hold the stage markup.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, symlinkSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { assembleDesign, lintDesign, BRIDGE_MARKER } from '../src/core/design/assemble.mjs';
import { classifyRef } from '../src/core/design/html-scan.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';

const DECK_KIT = fileURLToPath(new URL('../assets/deck-kit/', import.meta.url));
const KIT_SCRIPTS = ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js'];

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const BRIDGE = '<script data-worca-bridge>B</script>';
const slide = (id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'] });
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [slide('s1'), slide('s2')] };
const BASE = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.js': 'window.G=1;',
  'sections/s1/index.html': '<section data-section="s1" data-label="One"><h1>One</h1></section>', 'sections/s1/style.css': '[data-section="s1"] h1{top:0}',
  'sections/s2/index.html': '<section data-section="s2" data-label="Two"><h1>Two</h1></section>', 'sections/s2/style.css': '[data-section="s2"] h1{top:0}' };
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function seed(files) { const d = mkdtempSync(join(tmpdir(), 'ddeck-')); dirs.push(d); const work = join(d, 'work'); mkdirSync(work); for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); } return work; }
async function world(files = BASE, kind = 'pitch') { const work = seed(files); await stageDesignKit({ kind, workDir: work }); return work; }
/** BASE with `shell`, and the three deck kit scripts copied in by hand, for rows that must stay sync. */
function stagedSync(shell) { const work = seed({ ...BASE, 'shell.html': shell }); mkdirSync(join(work, '.kit')); for (const name of KIT_SCRIPTS) copyFileSync(join(DECK_KIT, name), join(work, '.kit', name)); return work; }
const parse = (html) => new JSDOM(html).window.document;
const ordered = (html, parts) => parts.reduce((at, p) => { const i = html.indexOf(p, at); assert.ok(i >= 0, `after ${at}: ${p}`); return i + p.length; }, 0);
const count = (html, p) => html.split(p).length - 1;

test('run: the real stage wraps the slides, its rail off; kit scripts inline and first, then global, then each section', async () => {
  const r = assembleDesign({ workDir: await world(), plan: DECK, mode: 'run', bridge: BRIDGE });
  assert.ok(r.html.includes('<deck-stage width="1920" height="1080" no-rail>\n<section data-section="s1"'));
  assert.ok(r.html.includes('</section>\n</deck-stage>'));
  const d = parse(r.html);
  assert.ok([...d.querySelectorAll('head > style')].some((s) => s.textContent === 'deck-stage:not(:defined){visibility:hidden}'));
  ordered(r.html, [BRIDGE, 'customElements.define(\'deck-stage\'', 'window.__DECK_PIPELINE', '__deckEnhanceRan', 'window.G=1;']);
  assert.equal([...d.querySelectorAll('[src],[href]')].some((e) => /(^|\/)\.kit\//.test(e.getAttribute('src') ?? e.getAttribute('href'))), false);
  assert.equal(d.querySelectorAll('script[src]').length, 0);
  // One element per kit script, then global.js: four scripts after the bridge, each kit file's text escaped once.
  assert.equal(d.querySelectorAll('body > script').length, 4);
  assert.equal(count(r.html, 'customElements.define(\'deck-stage\''), 1);
  assert.equal(count(r.html, '<!--worca:sections-->'), 0);
});
test('dist and standalone keep the kit\'s own rail, with no worca attribute at all', async () => {
  const work = await world();
  for (const mode of ['dist', 'standalone']) {
    const { html } = assembleDesign({ workDir: work, plan: DECK, mode });
    const st = parse(html).querySelector('body deck-stage');
    assert.deepEqual([st.getAttribute('width'), st.getAttribute('height'), st.hasAttribute('no-rail')], ['1920', '1080', false]);
    assert.equal(html.includes('data-worca-'), false);
    assert.equal(html.includes(BRIDGE_MARKER), false);
  }
  assert.equal(existsSync(join(dirname(work), 'dist', '.kit')), false);
});
test('the dist file really mounts: slides are the stage\'s direct children, the first is active', async () => {
  const { html } = assembleDesign({ workDir: await world(), plan: DECK, mode: 'dist' });
  const win = new JSDOM(html, { url: 'http://localhost/index.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) { w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} }; w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }; } }).window;
  after(() => win.close());
  for (let i = 0; i < 40 && !win.document.querySelector('[data-deck-active]'); i++) await new Promise((res) => setTimeout(res, 5));
  assert.equal(win.document.querySelector('deck-stage > section[data-deck-active]').getAttribute('data-section'), 's1');
  assert.equal(win.document.querySelector('deck-stage').children.length, 2);
});
test('shell slots do not apply: every slide sits in the stage, in plan order; the marker is required', async () => {
  const slotted = SHELL.replace('<!--worca:sections-->', '<div class="x"><div data-worca-slot="s2"></div></div><!--worca:sections-->');
  const { html } = assembleDesign({ workDir: await world({ ...BASE, 'shell.html': slotted }), plan: DECK, mode: 'run' });
  assert.deepEqual([...parse(html).querySelector('body deck-stage').children].map((e) => e.getAttribute('data-section')), ['s1', 's2']);
  assert.ok(html.includes('<div class="x"></div>'), 'the slot is emptied');
  const all = '<!doctype html><html><head><!--worca:head--></head><body><div data-worca-slot="s1"></div><div data-worca-slot="s2"></div><!--worca:foot--></body></html>';
  assert.throws(() => assembleDesign({ workDir: stagedSync(all), plan: DECK, mode: 'run' }), (e) => e.code === 'BAD_SHELL');
  // Every board kind, in every mode, with or without a plan: a slot left in a build doc would be the bridge's place
  // for that section, outside the board.
  const work = stagedSync(slotted);
  for (const [plan, kind] of [[null, 'pitch'], [{ ...DECK, kind: 'video' }, null], [DECK, null]]) {
    assert.ok(assembleDesign({ workDir: work, plan, kind, mode: 'build', bridge: BRIDGE }).html.includes('<div class="x"></div>'), `${plan?.kind ?? kind} build`);
  }
  // dist and standalone open with no worca around them: the slot goes there too, and no worca attribute is left.
  for (const mode of ['dist', 'standalone']) {
    const out = assembleDesign({ workDir: work, plan: DECK, mode }).html;
    assert.ok(out.includes('<div class="x"></div>'), `${mode}: the slot is emptied`);
    assert.equal(out.includes('data-worca-'), false, mode);
  }
  // Two markers are refused as one fault, as on the web.
  const twice = SHELL.replace('<!--worca:sections-->', '<!--worca:sections--><!--worca:sections-->');
  assert.throws(() => assembleDesign({ workDir: stagedSync(twice), plan: DECK, mode: 'dist' }), (e) => e.code === 'BAD_SHELL');
});
test('a missing kit file stops the strict modes, naming it; build does not need the kit', async () => {
  const work = await world(); rmSync(join(work, '.kit', 'deck-enhance.js'));
  for (const mode of ['run', 'dist', 'standalone']) assert.throws(() => assembleDesign({ workDir: work, plan: DECK, mode }), (e) => e.code === 'IO' && /deck-enhance\.js/.test(e.message), mode);
  const built = assembleDesign({ workDir: work, plan: DECK, mode: 'build', bridge: BRIDGE }).html;
  assert.ok(built);
  assert.equal(built.includes('deck-stage:not(:defined)'), false, 'the build doc never upgrades the stage');
  assert.equal(parse(built).querySelectorAll('deck-stage:not([data-worca-board])').length, 0, 'no run stage in a build doc');
  // The caller maps the error by its field, never by its text; dist leaves no folder behind.
  assert.throws(() => assembleDesign({ workDir: work, plan: DECK, mode: 'dist' }), (e) => e.kitFile === 'deck-enhance.js');
  assert.equal(existsSync(join(dirname(work), 'dist')), false);
});
test('a link in .kit and a reference to .kit', { skip: process.platform === 'win32' ? 'symlinks' : false }, async () => {
  const work = await world();
  const secret = join(dirname(work), 'secret.txt'); writeFileSync(secret, 'TOKEN-abc');
  rmSync(join(work, '.kit/deck-enhance.js')); symlinkSync(secret, join(work, '.kit/deck-enhance.js'));
  assert.throws(() => assembleDesign({ workDir: work, plan: DECK, mode: 'dist' }), (e) => e.code === 'IO');
  const refs = await world({ ...BASE, 'sections/s1/index.html': '<section data-section="s1" data-label="One"><script src=".kit/deck-stage.js"></script><img src=".kit/deck-stage.js"></section>' });
  const st = assembleDesign({ workDir: refs, plan: DECK, mode: 'standalone' });
  assert.deepEqual(st.problems, [{ ref: '.kit/deck-stage.js', why: 'escaped' }]);
  assert.equal(st.html.includes(`data:text/javascript;base64,${readFileSync(join(refs, '.kit/deck-stage.js')).toString('base64').slice(0, 40)}`), false);
  assert.ok(lintDesign({ workDir: refs, plan: DECK }).findings.some((f) => f.rule === 'escapes-work'));
  assert.equal(classifyRef('.kit/deck-stage.js').type, 'escaped');
});
test('lint: a slot or the stage in a deck shell is an error', async () => {
  const rules = async (shell) => lintDesign({ workDir: await world({ ...BASE, 'shell.html': shell }), plan: DECK }).findings.map((f) => f.rule);
  assert.deepEqual(await rules(SHELL), []);
  assert.deepEqual(await rules(SHELL.replace('<!--worca:foot-->', '<div data-worca-slot="s1"></div><!--worca:foot-->')), ['shell-slot-kind']);
  assert.deepEqual(await rules(SHELL.replace('<!--worca:sections-->', '<deck-stage><!--worca:sections--></deck-stage>')), ['shell-stage']);
  assert.deepEqual(await rules(SHELL.replace('<!--worca:sections-->', '')), ['shell-marker']);
  // A nested film wrapper counts too, and any number of stages is one error; a duplicate or unknown slot is still one
  // shell-slot-kind per slot, and a missing marker is one shell-marker however many slots there are.
  assert.deepEqual(await rules(SHELL.replace('<!--worca:sections-->', '<main><section><div data-film></div></section></main><!--worca:sections-->')), ['shell-stage']);
  assert.deepEqual(await rules(SHELL.replace('<!--worca:sections-->', '<deck-stage></deck-stage><main><deck-stage><!--worca:sections--></deck-stage></main>')), ['shell-stage']);
  const slots = '<div data-worca-slot="s1"></div><div data-worca-slot="s1"></div><div data-worca-slot="zz"></div>';
  assert.deepEqual(await rules(SHELL.replace('<!--worca:sections-->', slots)), ['shell-marker', 'shell-slot-kind', 'shell-slot-kind', 'shell-slot-kind']);
  const shellRules = (plan, shell) => lintDesign({ workDir: seed({ ...BASE, 'shell.html': shell }), plan }).findings.filter((f) => f.file === 'shell.html').map((f) => f.rule);
  assert.deepEqual(shellRules({ ...DECK, kind: 'video' }, SHELL.replace('<!--worca:sections-->', '<div data-worca-slot="s1"></div><div data-worca-slot="s2"></div>')), ['shell-marker', 'shell-slot-kind', 'shell-slot-kind'], 'video is a board kind too');
  assert.deepEqual(shellRules({ ...DECK, kind: 'web' }, SHELL.replace('<!--worca:sections-->', '<deck-stage><!--worca:sections--></deck-stage>')), [], 'the web takes no board rule');
});
test('the plan\'s kind wins over the kind argument: a web plan takes no board branch', async () => {
  const WEB = { v: 1, kind: 'web', title: 'T', canvas: { w: 1440 }, notes: '', sections: [{ id: 's1', job: 's1', brief: 'b', parts: ['html', 'css'], estHeight: 100 }] };
  const w = await world(BASE, 'web');
  for (const mode of ['build', 'run', 'dist']) assert.equal(assembleDesign({ workDir: w, plan: WEB, mode, kind: 'pitch' }).html, assembleDesign({ workDir: w, plan: WEB, mode }).html, mode);
});

// test/design-assemble-board.test.mjs — Design P7 Task 6: the deck and video build doc is a board of tiles. In build
// mode a deck's fills sit in `<deck-stage data-worca-board>` and a video's in `<div data-film data-worca-board>`, each
// holding the sections comment, with the board style last in the head block. No kit and no film script runs there:
// the bridge is the only script. With no plan yet, the board comes from the `kind` argument.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { assembleDesign } from '../src/core/design/assemble.mjs';
import { boardCss, FILM_BASE_CSS } from '../src/core/design/kinds.mjs';
import { renderPreviewDoc } from '../src/core/design/preview-doc.mjs';
import { stageDesignKit } from '../src/core/design/kit.mjs';
import { bootBridge } from './helpers/design-bridge.mjs';

const DECK_KIT = fileURLToPath(new URL('../assets/deck-kit/', import.meta.url));
const KIT_SCRIPTS = ['deck-stage.js', 'deck-pipeline.js', 'deck-enhance.js'];

const SHELL = '<!doctype html><html><head><meta charset="utf-8"><!--worca:head--></head><body><!--worca:sections--><!--worca:foot--></body></html>';
const BRIDGE = '<script data-worca-bridge>B</script>';
const slide = (id) => ({ id, job: id, brief: 'b', parts: ['html', 'css'] });
const DECK = { v: 1, kind: 'pitch', title: 'T', canvas: { w: 1920, h: 1080 }, notes: '', sections: [slide('s1'), slide('s2')] };
const BASE = { 'shell.html': SHELL, 'tokens.css': ':root{--a:1}', 'global.js': 'window.G=1;',
  'sections/s1/index.html': '<section data-section="s1" data-label="One"><h1>One</h1></section>', 'sections/s1/style.css': '[data-section="s1"] h1{top:0}',
  'sections/s2/index.html': '<section data-section="s2" data-label="Two"><h1>Two</h1></section>', 'sections/s2/style.css': '[data-section="s2"] h1{top:0}' };
const scene = (id, duration) => ({ id, job: id, brief: 'b', parts: ['html', 'css', 'js'], duration });
const FILM = { v: 1, kind: 'video', title: 'F', canvas: { w: 1920, h: 1080, fps: 60 }, notes: '', sections: [scene('a', 2), scene('b', 3)] };
const FILM_BASE = { 'shell.html': SHELL, 'sections/a/index.html': '<div data-section="a" data-scene><b>A</b></div>', 'sections/a/script.js': 'window.__a=S.dur;',
  'sections/b/index.html': '<div data-section="b" data-scene><b>B</b></div>', 'sections/b/script.js': 'window.__b=S.dur;' };
const dirs = []; after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
function seed(files) { const d = mkdtempSync(join(tmpdir(), 'dboard-')); dirs.push(d); const work = join(d, 'work'); mkdirSync(work); for (const [rel, text] of Object.entries(files)) { mkdirSync(dirname(join(work, rel)), { recursive: true }); writeFileSync(join(work, rel), text); } return work; }
async function world(files = BASE, kind = 'pitch') { const work = seed(files); await stageDesignKit({ kind, workDir: work }); return work; }
/** BASE with `shell`, and the three deck kit scripts copied in by hand, for rows that must stay sync. */
function stagedSync(shell) { const work = seed({ ...BASE, 'shell.html': shell }); mkdirSync(join(work, '.kit')); for (const name of KIT_SCRIPTS) copyFileSync(join(DECK_KIT, name), join(work, '.kit', name)); return work; }
const parse = (html) => new JSDOM(html).window.document;
const ordered = (html, parts) => parts.reduce((at, p) => { const i = html.indexOf(p, at); assert.ok(i >= 0, `after ${at}: ${p}`); return i + p.length; }, 0);
const count = (html, p) => html.split(p).length - 1;

test('build: every section is a slot or a finished tile on the board, the only script is the bridge', async () => {
  const work = await world({ ...BASE, '.crew.json': JSON.stringify([{ id: 's1', status: 'done', summary: '' }, { id: 's2', status: 'writing', summary: '' }]) });
  const r = assembleDesign({ workDir: work, plan: DECK, mode: 'build', bridge: BRIDGE });
  assert.ok(r.html.includes('<deck-stage data-worca-board width="1920" height="1080">'));
  assert.ok(r.html.includes(`<style data-worca-board-css>${boardCss()}</style>`));
  assert.ok(r.html.indexOf('data-worca-css="s1"') < r.html.indexOf('data-worca-board-css'), 'after the section CSS');
  assert.ok(r.html.includes('<div data-worca-slot="s2"></div><!--worca:sections--></deck-stage>') || r.html.includes('<div data-worca-slot="s2"></div>\n<!--worca:sections--></deck-stage>'));
  assert.equal(count(r.html, '<script'), 1);
  assert.equal(r.html.includes('customElements.define'), false);
  assert.deepEqual(r.sections.map((s) => s.state), ['included', 'slot']);
  // The board style is the head block's last word, and the finished slide is the board's own child.
  ordered(r.html, ['data-worca-css="s1"', `<style data-worca-board-css>${boardCss()}</style></head>`]);
  assert.deepEqual([...parse(r.html).querySelector('body > deck-stage[data-worca-board]').children].map((e) => e.getAttribute('data-section') ?? e.getAttribute('data-worca-slot')), ['s1', 's2']);
});
test('video tiles are the composed state, with no film script', async () => {
  const r = assembleDesign({ workDir: await world(FILM_BASE, 'video'), plan: FILM, mode: 'build', bridge: BRIDGE });
  assert.ok(r.html.includes('<div data-film data-worca-board>'));
  for (const no of ['FILM_PLAN', 'F.scene', 'F.start', FILM_BASE_CSS]) assert.equal(r.html.includes(no), false, no);
  assert.ok(r.html.includes(`<style data-worca-board-css>${boardCss()}</style>`));
  assert.equal(count(r.html, '<script'), 1);
});
test('planning: with no plan yet the board is already there, from the kind', async () => {
  const r = assembleDesign({ workDir: await world({}), plan: null, kind: 'pitch', mode: 'build', bridge: BRIDGE });
  assert.ok(r.html.includes('<deck-stage data-worca-board width="1920" height="1080"><!--worca:sections--></deck-stage>'));
  assert.deepEqual(r.sections, []);
  // The shell's own marker went through the board: it is the doc's one sections comment.
  assert.equal(count(r.html, '<!--worca:sections-->'), 1);
  const film = assembleDesign({ workDir: stagedSync(SHELL), plan: null, kind: 'video', mode: 'build', bridge: BRIDGE }).html;
  assert.ok(film.includes('<div data-film data-worca-board><!--worca:sections--></div>'));
  assert.ok(film.includes(`<style data-worca-board-css>${boardCss()}</style>`));
  // The web takes no board, with or without a plan.
  const web = assembleDesign({ workDir: stagedSync(SHELL), plan: null, kind: 'web', mode: 'build', bridge: BRIDGE }).html;
  assert.equal(web.includes('data-worca-board'), false);
});
test('the board never leaves the build doc', async () => {
  const work = await world();
  for (const mode of ['run', 'dist', 'standalone']) {
    const { html } = assembleDesign({ workDir: work, plan: DECK, mode, ...(mode === 'run' ? { bridge: BRIDGE } : {}) });
    assert.equal(html.includes('data-worca-board'), false, mode);
    assert.equal(html.includes('worca:sections'), false, mode);
  }
  const film = await world(FILM_BASE, 'video');
  for (const mode of ['run', 'dist', 'standalone']) {
    const { html } = assembleDesign({ workDir: film, plan: FILM, mode, ...(mode === 'run' ? { bridge: BRIDGE } : {}) });
    assert.equal(html.includes('data-worca-board'), false, `video ${mode}`);
    assert.equal(html.includes('worca:sections'), false, `video ${mode}`);
  }
});
test('the served doc keeps the board through stripBuildDoc, and passes the kind when there is no plan', async () => {
  const work = await world({});
  const html = renderPreviewDoc({ workDir: work, kind: 'video', mode: 'build', nonce: 'nnnnnnnn' });
  assert.ok(html.includes('<div data-film data-worca-board>'));
  assert.ok(html.includes('data-worca-board-css'));
});
test('the bridge creates missing slots on the board, in plan order, and fills them there', async () => {
  const { html } = assembleDesign({ workDir: await world({}), plan: null, kind: 'pitch', mode: 'build', bridge: BRIDGE });
  const b = bootBridge({ html: html.replace(BRIDGE, '') });
  b.send('hello', { mode: 'build', kind: 'pitch', canvas: { w: 1920, h: 1080 } });
  b.send('plan', { sections: [{ id: 's1' }, { id: 's2' }, { id: 's3' }] });
  assert.deepEqual([...b.doc.querySelectorAll('[data-worca-board] > [data-worca-slot]')].map((e) => e.getAttribute('data-worca-slot')), ['s1', 's2', 's3']);
  b.send('section', { id: 's2', rev: 1, html: '<section data-label="T"><h1>x</h1></section>', final: true });
  b.clock.tick(125);
  assert.ok(b.doc.querySelector('[data-worca-board] > section[data-section="s2"]'));
  assert.ok(b.doc.querySelector('[data-worca-board] > [data-section="s2"] + [data-worca-slot="s3"]'));
  assert.equal(b.of('applied').length, 1);
});

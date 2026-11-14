import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPicture, createPictureLog, pictureSrc, factsLine, madeWords, failedWords } from '../ui/public/design/pictures.mjs';
import { JSDOM } from 'jsdom';
import { createPictureStrip, openPictureViewer } from '../ui/public/design/pictures.mjs';
import { createBuildNarration } from '../ui/public/design/narration.mjs';

const D = 'd_00000000a001';
/** A finished frame carries its row's id; a making frame carries none. */
const pic = (o = {}) => ({ type: 'design-picture', designId: D, buildId: 'b_1', round: 1, id: 1, name: 'hero-studio', shape: 'wide',
  state: 'made', prompt: 'A small pottery studio in cool morning light, no text', file: 'assets/made/hero-studio.png',
  w: 1536, h: 1024, model: 'gpt-image-2.6-flare', costUsd: 0.04, ms: 11400, ...o });
const making = (o = {}) => pic({ id: undefined, state: 'making', file: undefined, w: undefined, h: undefined, model: undefined, costUsd: undefined, ms: undefined, ...o });
/** The GET row of the same ask: no type or designId, a time. */
const row = (id, o = {}) => { const { type, designId, ...r } = pic({ id, ...o }); return { ...r, reason: r.reason ?? null, createdAt: `2026-11-11T10:00:0${id}.000Z` }; };

test('a picture is read whole or not at all; the address is the made ask\'s id, never its name or file', () => {
  const p = readPicture(row(7));
  assert.deepEqual([p.id, p.buildId, p.round, p.name, p.shape, p.state, p.w, p.h, p.costUsd], [7, 'b_1', 1, 'hero-studio', 'wide', 'made', 1536, 1024, 0.04]);
  assert.equal(pictureSrc(D, p), `/api/design/${D}/pictures/7`);
  for (const [name, file] of [['../x', '../../etc/passwd'], ['a', 'assets\\made\\hero-studio.png'], ['a', 'assets/made/other.webp']]) {
    assert.equal(pictureSrc(D, { ...p, name, file }), `/api/design/${D}/pictures/7`, file);
  }
  assert.equal(pictureSrc('d_x/../y', p), '/api/design/d_x%2F..%2Fy/pictures/7');
  assert.equal(pictureSrc(D, { ...p, id: '7/../8' }), null, 'only an integer id makes an address');
  assert.equal(pictureSrc(D, readPicture(making())), null, 'a picture in the making has no address');
  assert.equal(pictureSrc(D, readPicture(pic({ state: 'failed', file: undefined, reason: 'x' }))), null, 'a failed ask has no picture');
  for (const bad of [{ round: 0 }, { state: 'done' }, { buildId: '' }, { name: '' }, { name: '../x' }, { name: 'Hero' }, { name: 'a'.repeat(41) },
    { shape: 'round' }, { id: undefined }, { state: 'failed', id: 0 }]) {
    assert.equal(readPicture(pic(bad)), null, JSON.stringify(bad));
  }
  assert.equal(readPicture(making()).id, null, 'a making frame has no id');
  const f = readPicture(pic({ id: 2, state: 'failed', file: undefined, costUsd: undefined, reason: 'the image service refused this description: mock' }));
  assert.deepEqual([f.id, f.file, f.reason], [2, null, 'the image service refused this description: mock'], 'a failed ask keeps its row');
});
test('one ask is one entry: a row and its frame, in either order, count once by id; making never brings a finished ask back', () => {
  const a = createPictureLog({ designId: D });
  assert.equal(a.push(making()), true);
  assert.equal(a.push(pic()), true, 'the finished frame ends the quiet tile of its name');
  assert.deepEqual(a.shown(1, { live: true }).map((p) => [p.state, p.id]), [['made', 1]]);
  assert.equal(a.load([row(1)]), false, 'its row is the same ask');
  assert.deepEqual(a.tally(1), { made: 1, failed: 0, usd: 0.04 });
  const b = createPictureLog({ designId: D });
  b.load([row(1)]);
  assert.equal(b.push(pic()), false, 'a frame landing after its row adds nothing');
  assert.equal(b.push(pic({ id: 2 })), true, 'a remake under the same name is a second ask');
  assert.equal(b.push(making()), true);
  assert.equal(b.tally(1).made, 2, 'a making frame never brings a finished ask back');
  for (const x of [{ ...pic({ id: 3 }), designId: 'd_other' }, { ...pic({ id: 3 }), type: 'design-file' }]) assert.equal(b.push(x), false);
  assert.equal(b.push(making({ name: '../x' })), false, 'a making frame is read too: no quiet tile for a bad name');
  const lost = pic({ id: null, state: 'failed', file: null, costUsd: null, reason: 'the image service answered 500' });
  assert.equal(b.push(lost), true, 'a finished frame with no id (no row written) still ends its quiet tile');
  assert.deepEqual([b.shown(1, { live: true }).map((p) => p.state), b.tally(1)], [['made'], { made: 2, failed: 0, usd: 0.08 }], 'and is counted nowhere');
  assert.equal(b.push(lost), false, 'nothing left to end');
  assert.equal(b.load('not an array'), false);
});
test('shown: the latest ask of each name; a quiet tile only while its round runs; a remake is a new address', () => {
  const log = createPictureLog({ designId: D });
  log.load([row(1)]);
  log.push(making());
  assert.deepEqual(log.shown(1, { live: true }).map((p) => [p.name, p.state]), [['hero-studio', 'making']]);
  assert.deepEqual(log.shown(1, { live: false }).map((p) => [p.state, p.id]), [['made', 1]]);
  log.push(pic({ id: 2, ms: 9000 }));
  const remade = log.shown(1, { live: true })[0];
  assert.deepEqual([remade.id, pictureSrc(D, remade)], [2, `/api/design/${D}/pictures/2`], 'a remake is a new address');
  assert.equal(pictureSrc(D, readPicture(row(1))), `/api/design/${D}/pictures/1`, 'the first ask keeps its own');
  log.push(making());
  log.push(pic({ id: 3, state: 'failed', file: undefined, costUsd: undefined, ms: 180000, reason: 'the image service did not answer in 180 s' }));
  assert.equal(log.shown(1, { live: true })[0].id, 2, 'a failed remake keeps the last picture');
  assert.deepEqual(log.tally(1), { made: 2, failed: 1, usd: 0.08 });
  log.push(pic({ id: 4, name: 'kiln', state: 'failed', file: undefined, reason: 'the picture could not be saved' }));
  assert.deepEqual(log.tally(1), { made: 2, failed: 2, usd: 0.12 }, 'a paid ask whose save failed is booked: its dollars count');
  log.push(making({ name: 'wheel', shape: 'tall' }));
  assert.deepEqual(log.shown(1, { live: true }).map((p) => [p.name, p.state]), [['hero-studio', 'made'], ['wheel', 'making']], 'by first id, then names only in the making');
  for (let i = 0; i < 3; i += 1) log.push(pic({ id: 10 + i, round: 2, buildId: 'b_2', name: `n${i}`, file: `assets/made/n${i}.png`, costUsd: 0.05 }));
  assert.deepEqual(log.tally(2), { made: 3, failed: 0, usd: 0.15 }, 'rounded, never 0.15000000000000002');
  assert.deepEqual(log.ofRound(2).map((p) => p.name), ['n0', 'n1', 'n2']);
  assert.deepEqual(log.shown(1, { live: false }).map((p) => p.id), [2], 'round 1 shows its own pictures, round 2 its own');
});
test('a socket gap drops the quiet tiles it may have orphaned, at once; a making frame after the gap stays through the load', () => {
  const log = createPictureLog({ designId: D });
  log.push(making());
  assert.equal(log.gap(), true);
  log.push(making({ name: 'after' }));
  log.load([row(1)]);
  assert.deepEqual(log.shown(1, { live: true }).map((p) => [p.name, p.state]), [['hero-studio', 'made'], ['after', 'making']]);
});
test('subscribers hear a change once, never a repeat', () => {
  const log = createPictureLog({ designId: D });
  let n = 0;
  const off = log.subscribe(() => { n += 1; });
  log.load([row(1)]); log.load([row(1)]); log.push(pic());
  off(); log.push(pic({ id: 2, name: 'other', file: 'assets/made/other.png' }));
  assert.equal(n, 1);
});
test('the words', () => {
  assert.equal(factsLine(readPicture(pic())), 'gpt-image-2.6-flare · 1536×1024 · 11 s · $0.04');
  assert.equal(factsLine(readPicture(pic({ ms: 200 }))), 'gpt-image-2.6-flare · 1536×1024 · 1 s · $0.04', 'pictureSeconds: never 0 s');
  assert.equal(factsLine(readPicture(pic({ model: null, ms: null }))), '1536×1024 · $0.04');
  assert.deepEqual([madeWords(1), madeWords(3), failedWords(1), failedWords(2)], ['made 1 picture', 'made 3 pictures', '1 picture failed', '2 pictures failed']);
});

const dom = () => { const d = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' }); return { win: d.window, doc: d.window.document }; };

test('the strip: a real button per picture with its name, a quiet tile of its shape while one is made, no tile for a failure', () => {
  const { doc, win } = dom();
  const opened = [];
  const strip = createPictureStrip({ doc, designId: D, onOpen: (p, b) => opened.push([p.name, b]),
    pictures: [readPicture(row(3)), readPicture(row(4, { name: 'odd-one', state: 'failed', file: null, reason: 'x' })), readPicture(making({ name: 'team-mood', shape: 'square' }))] });
  assert.deepEqual([strip.className, strip.getAttribute('role'), strip.getAttribute('aria-label'), strip.children.length], ['dsc-pics', 'group', 'Pictures', 2]);
  const [a, b] = strip.children;
  assert.deepEqual([a.tagName, a.type, a.className, a.textContent, a.dataset.pic], ['BUTTON', 'button', 'dsc-pic is-wide', 'hero-studio', '1|hero-studio']);
  assert.deepEqual([a.querySelector('img').getAttribute('src'), a.querySelector('img').alt], [`/api/design/${D}/pictures/3`, '']);
  assert.deepEqual([b.tagName, b.className, b.getAttribute('role'), b.getAttribute('aria-label'), b.querySelector('img')],
    ['DIV', 'dsc-pic is-square is-making', 'img', 'Making a picture: team-mood', null]);
  a.click();
  assert.deepEqual(opened, [['hero-studio', a]]);
  a.querySelector('img').dispatchEvent(new win.Event('error'));
  assert.ok(a.classList.contains('is-missing'), 'a copy the route answers 404 for');
});
test('the viewer: the picture, What it shows, one facts line; Escape closes it and the tile has the focus again', () => {
  const { doc, win } = dom();
  const tile = doc.body.appendChild(doc.createElement('button'));
  const v = openPictureViewer({ doc, designId: D, picture: readPicture(row(3)), opener: tile });
  const m = doc.querySelector('.viewer-modal.dz-pic-modal');
  const h2 = m.querySelector('h2');
  assert.deepEqual([m.getAttribute('role'), m.getAttribute('aria-modal'), m.getAttribute('aria-labelledby'), h2.textContent], ['dialog', 'true', h2.id, 'hero-studio']);
  assert.equal(m.querySelector('img.dz-pic-full').getAttribute('src'), `/api/design/${D}/pictures/3`);
  assert.deepEqual([...m.querySelectorAll('.dz-pic-h, .dz-pic-desc, .dz-pic-facts')].map((n) => n.textContent),
    ['What it shows', 'A small pottery studio in cool morning light, no text', 'gpt-image-2.6-flare · 1536×1024 · 11 s · $0.04']);
  assert.equal(doc.activeElement.getAttribute('aria-label'), 'Close');
  doc.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.deepEqual([doc.querySelector('.dz-pic-modal'), doc.activeElement], [null, tile]);
  v.close();   // runs once: a second close does nothing
  openPictureViewer({ doc, designId: D, picture: readPicture(row(3)), opener: tile });
  const m2 = doc.querySelector('.dz-pic-modal');
  for (const type of ['mousedown', 'click']) m2.dispatchEvent(new win.MouseEvent(type, { bubbles: true }));
  assert.equal(doc.querySelector('.dz-pic-modal'), null, 'a backdrop click closes it');
});
test('a description is text, never markup; a tile repainted away hands the focus to refocus', () => {
  const { doc } = dom();
  const tile = doc.body.appendChild(doc.createElement('button'));
  const twin = doc.body.appendChild(doc.createElement('button'));
  openPictureViewer({ doc, designId: D, picture: readPicture(pic({ prompt: '<img src=x onerror=alert(1)>', model: '<b>m</b>' })), opener: tile, refocus: () => twin.focus() });
  assert.equal(doc.querySelector('.dz-pic-desc').textContent, '<img src=x onerror=alert(1)>');
  assert.deepEqual([doc.querySelectorAll('.dz-pic-modal img').length, doc.querySelector('.dz-pic-modal b')], [1, null], 'the model the person typed is text too');
  tile.remove();
  doc.querySelector('.dz-pic-modal button[aria-label="Close"]').click();
  assert.equal(doc.activeElement, twin);
});
test('the viewer: close({restore: false}) hands no focus back; a facts line with nothing known is hidden', () => {
  const { doc } = dom();
  const tile = doc.body.appendChild(doc.createElement('button'));
  let asked = 0;
  const v = openPictureViewer({ doc, designId: D, picture: readPicture(row(5, { model: null, w: null, h: null, ms: null, costUsd: null })),
    opener: tile, refocus: () => { asked += 1; } });
  assert.equal(doc.querySelector('.dz-pic-facts').hidden, true);
  v.close({ restore: false });
  v.close();   // runs once: the second close hands nothing back either
  assert.deepEqual([doc.querySelector('.dz-pic-modal'), doc.activeElement === tile, asked], [null, false, 0], 'the chat going away takes the focus nowhere');
});

test('the live line names the picture being made; a failure is a line of the round in its own words', () => {
  const n = createBuildNarration({ designId: D, kind: 'web' });
  const b = { designId: D, buildId: 'b_1' };
  n.push({ ...b, type: 'design-build', status: 'planning', round: 2, kind: 'first', waiting: 0 });
  n.push(making({ round: 2 }));
  assert.deepEqual([n.view().phase, n.view().round], ['Making a picture: hero-studio', 2]);
  n.push(making({ round: 2, name: 'team-mood' }));
  assert.equal(n.view().phase, 'Making a picture: team-mood');
  n.push(pic({ round: 2, name: 'team-mood', state: 'failed', file: undefined, costUsd: undefined, reason: 'the image service did not answer in 180 s' }));
  assert.equal(n.view().phase, 'Making a picture: hero-studio');
  assert.deepEqual(n.view().lines.at(-1), { key: 'pic:team-mood', text: 'team-mood: the image service did not answer in 180 s', tone: 'fail' });
  n.push({ ...b, type: 'design-build', status: 'planning', round: 2, kind: 'first', waiting: 1 });
  assert.equal(n.view().phase, 'The crew is waiting for your answer', 'a question wins');
  n.push({ ...b, type: 'design-build', status: 'planning', round: 2, kind: 'first', waiting: 0 });
  n.push(pic({ round: 2 }));
  assert.equal(n.view().phase, 'The lead is planning the page');
  n.push(making({ buildId: 'b_0', name: 'old' }));
  assert.equal(n.view().phase, 'The lead is planning the page', 'another build is not this one');
});
test('the live line: a name asked again is the last one, a made picture ends its failure line, a snapshot starts over', () => {
  const n = createBuildNarration({ designId: D, kind: 'web' });
  const b = { designId: D, buildId: 'b_1' };
  n.push({ ...b, type: 'design-build', status: 'building', round: 3, kind: 'first', waiting: 0 });
  for (const name of ['a', 'b', 'a']) n.push(making({ round: 3, name }));
  assert.equal(n.view().phase, 'Making a picture: a', 'asked again, it is the last one');
  n.push(pic({ round: 3, name: 'a', state: 'failed', file: undefined, costUsd: undefined }));
  assert.deepEqual([n.view().phase, n.view().lines.at(-1)], ['Making a picture: b', { key: 'pic:a', text: 'a failed.', tone: 'fail' }], 'no reason: the sections\' own form');
  n.push(pic({ round: 3, name: 'a', id: 2 }));
  assert.equal(n.view().lines.some((l) => l.key === 'pic:a'), false, 'a remake that lands ends the failure line');
  n.push({ ...b, type: 'design-build', status: 'building', waiting: 0 });
  assert.equal(n.view().round, 3, 'a frame that does not say the round keeps it');
  n.push({ ...b, type: 'design-snapshot', build: { status: 'building', round: 4, kind: 'first', waiting: 0 }, sections: [], agents: [] });
  assert.deepEqual([n.view().round, n.view().phase], [4, 'The lead is planning the page'], 'a snapshot starts the pictures in the making over');
});

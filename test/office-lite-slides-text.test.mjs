// test/office-lite-slides-text.test.mjs — the simplified preview's slide and text readers (office-slides.mjs, office-text.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { readPptx, readOdp } from '../ui/public/artifacts/office-slides.mjs';
import { readOdt } from '../ui/public/artifacts/office-text.mjs';
import { openCappedZip } from '../ui/public/artifacts/office-zip.mjs';
import { OFFICE_LITE_LIMITS } from '../src/shared/artifact-kinds.mjs';
import { fixture } from './helpers/office-lite-fixtures.mjs';

const JSZip = createRequire(import.meta.url)('jszip');
const { DOMParser } = new JSDOM('').window;
const L = OFFICE_LITE_LIMITS;
const open = (name) => openCappedZip(JSZip, fixture(name), L);
const plain = (slides) => slides.map(({ n, title, hidden, paragraphs }) => ({ n, title, hidden, paragraphs }));

test('T-P1 deck.pptx: the JPEG thumbnail; slides in sldIdLst order; group shapes and tables included; the hidden one flagged', async () => {
  const m = await readPptx(await open('deck.pptx'), DOMParser, L);
  assert.equal(m.format, 'slides');
  assert.equal(m.thumbnail.type, 'image/jpeg');
  assert.ok(m.thumbnail instanceof Uint8Array && m.thumbnail[0] === 0xff);
  assert.deepEqual(plain(m.slides), [
    { n: 1, title: 'Intro', hidden: false, paragraphs: ['Welcome all', 'Grouped text'] },
    { n: 2, title: 'Data', hidden: false, paragraphs: ['Q1', 'Q2'] },
    { n: 3, title: 'Backup', hidden: true, paragraphs: ['Line one\nLine two'] },
  ]);
});

test('T-P2 deck.odp: the PNG thumbnail, titles in page order, speaker notes absent', async () => {
  const m = await readOdp(await open('deck.odp'), DOMParser, L);
  assert.equal(m.thumbnail.type, 'image/png');
  assert.deepEqual(plain(m.slides), [
    { n: 1, title: 'Hello deck', hidden: false, paragraphs: ['First point'] },
    { n: 2, title: 'Second page', hidden: false, paragraphs: ['Shape text', 'Body text'] },
  ]);
  assert.ok(!JSON.stringify(m.slides).includes('Speaker secret'));
});

test('T-P3 deck-wmf.pptx: a WMF thumbnail is ignored (thumbnail null), the slide still reads', async () => {
  const m = await readPptx(await open('deck-wmf.pptx'), DOMParser, L);
  assert.equal(m.thumbnail, null);
  assert.deepEqual(plain(m.slides), [{ n: 1, title: 'Only slide', hidden: false, paragraphs: [] }]);
});

test('T-O1 notes.odt: headings (level clamped), spaces and tabs kept, list items, table and section paragraphs; notes and annotations absent', async () => {
  const m = await readOdt(await open('notes.odt'), DOMParser, L);
  assert.equal(m.format, 'text');
  assert.deepEqual(m.blocks, [
    { tag: 'h', level: 1, text: 'Release notes' },
    { tag: 'h', level: 2, text: 'What changed' },
    { tag: 'p', text: 'a   b\tc' },
    { tag: 'p', text: 'See the note here.' },
    { tag: 'li', text: 'one' },
    { tag: 'li', text: 'two' },
    { tag: 'li', text: 'two-a' },
    { tag: 'p', text: 'cell text' },
    { tag: 'p', text: 'In a section' },
    { tag: 'h', level: 6, text: 'Deep' },
  ]);
});

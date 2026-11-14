// test/design-look-source.test.mjs — the `Look source:` line a document's lead writes first in brand.md: the forms it
// accepts, and every refusal's exact text (the plan gate and the lint rule hand these to the lead).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOOK_SOURCES, LOOK_LINE, readLookSource } from '../src/core/design/look-source.mjs';

test('the four sources and the line the prompts quote', () => {
  assert.deepEqual(LOOK_SOURCES, ['brief', 'project', 'skill', 'worca']);
  assert.equal(LOOK_LINE, 'Look source: <brief|project|skill|worca> — <why>');
});

test('accepted forms: plain, bold, a list item, a heading, any case, a colon or any dash before the why', () => {
  const rows = [
    ['Look source: worca — the brief names no style and no skill or project file does', 'worca', 'the brief names no style and no skill or project file does'],
    ['**Look source:** worca — x', 'worca', 'x'],
    ['- Look source: Brief: x', 'brief', 'x'],
    ['# Look source: skill – the brand skill sets Inter', 'skill', 'the brand skill sets Inter'],
    ['Look source: PROJECT - CLAUDE.md names the design system', 'project', 'CLAUDE.md names the design system'],
    ['# Brand\n\nVoice: calm.\nLook source: brief —   "make it look like the Stripe docs"  \n', 'brief', '"make it look like the Stripe docs"'],
  ];
  for (const [text, source, why] of rows) {
    assert.deepEqual(readLookSource(text), { ok: true, source, why }, text);
  }
});

test('refusals, each with its exact text', () => {
  const rows = [
    [undefined, {}, 'brand.md was not written: its first line is "Look source: <brief|project|skill|worca> — <why>"'],
    [null, {}, 'brand.md was not written: its first line is "Look source: <brief|project|skill|worca> — <why>"'],
    ['# Brand\nCalm and clear.', {}, 'brand.md has no "Look source:" line: write "Look source: <brief|project|skill|worca> — <why>" as its first line'],
    ['Look source: worca — a\nLook source: brief — b', {}, 'brand.md has 2 "Look source:" lines: keep one'],
    ['Look source: mine — I liked it', {}, 'brand.md: Look source must be brief, project, skill or worca, found "mine"'],
    ['Look source:', {}, 'brand.md: Look source must be brief, project, skill or worca, found ""'],
    ['Look source: worca', {}, 'brand.md: the Look source line says why after the dash'],
    ['Look source: worca —   ', {}, 'brand.md: the Look source line says why after the dash'],
    ['Look source: project — CLAUDE.md', { hasProject: false }, 'brand.md: Look source is project, but your task has no Project line: name the brief, a skill or worca'],
  ];
  for (const [text, opts, error] of rows) {
    assert.deepEqual(readLookSource(text, opts), { ok: false, errors: [error] }, String(text));
  }
});

test('project needs a Project line; the others never do', () => {
  assert.equal(readLookSource('Look source: project — CLAUDE.md', { hasProject: true }).ok, true);
  assert.equal(readLookSource('Look source: project — CLAUDE.md').ok, true, 'hasProject defaults to true');
  for (const s of ['brief', 'skill', 'worca']) assert.equal(readLookSource(`Look source: ${s} — x`, { hasProject: false }).ok, true, s);
});

test('only the first 64 KiB is read, and the why is capped at 300 characters', () => {
  const late = `${'a'.repeat(70 * 1024)}\nLook source: worca — x`;
  assert.deepEqual(readLookSource(late).errors, ['brand.md has no "Look source:" line: write "Look source: <brief|project|skill|worca> — <why>" as its first line']);
  const long = readLookSource(`Look source: worca — ${'w'.repeat(500)}`);
  assert.equal(long.ok, true);
  assert.equal(long.why.length, 300);
});

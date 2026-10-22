// test/ui-icons.test.mjs — the one stroke icon set (ui/public/icons.mjs) and the chat home's re-export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { ICONS, icon, iconSvg } from '../ui/public/icons.mjs';
import { HOME_ICONS, homeIcon } from '../ui/public/chat/home-icons.mjs';

test('every icon is a 2px round-capped stroke on a 24x24 box, aria-hidden', () => {
  for (const name of Object.keys(ICONS)) {
    const svg = iconSvg(name, 14);
    assert.match(svg, /viewBox="0 0 24 24"[^>]*stroke-width="2"[^>]*stroke-linecap="round"[^>]*aria-hidden="true"/, name);
    assert.match(svg, /width="14" height="14"/, name);
    assert.match(svg, /<(?:path|circle|rect) /, name);   // `more` is three filled dots
  }
});

test('the set has the replacements for the removed glyphs', () => {
  for (const name of ['x', 'more', 'check', 'chevron', 'chevron-left', 'chevron-down', 'chevron-up', 'play', 'plus', 'pause', 'arrow-up',
    'arrow-down', 'copy', 'refresh']) assert.ok(Object.hasOwn(ICONS, name), name);
});

test('the set has the run-state symbols and the PR state icons (runs redesign §2.1, §2.1a)', () => {
  for (const name of ['question', 'alert', 'pull-request', 'pull-request-draft', 'pull-request-closed', 'merge']) {
    assert.ok(Object.hasOwn(ICONS, name), name);
  }
});

test('stepped-out is the walking person (the away badge, the away row); away stays the moon', () => {
  assert.match(ICONS['stepped-out'], /^<path d="M14 2\.2a1\.8 1\.8 0 1 1 0 3\.6/);
  assert.equal((ICONS['stepped-out'].match(/<path /g) || []).length, 5);
  assert.match(ICONS.away, /^<path d="M19\.5 14\.5A8 8/);
});

test('an unknown or inherited name renders an empty box, as homeIcon did', () => {
  for (const name of ['nope', 'constructor']) assert.doesNotMatch(iconSvg(name), /<path/, name);
});

test('home-icons is the same set; homeIcon keeps its sized, aria-hidden chat-ic span', () => {
  const doc = new JSDOM('<body></body>').window.document;
  assert.equal(HOME_ICONS, ICONS);
  const span = homeIcon(doc, 'run', 16);
  assert.equal(span.className, 'chat-ic');
  assert.equal(span.getAttribute('aria-hidden'), 'true');
  assert.equal(span.style.width, '16px');
  assert.equal(span.querySelector('svg').getAttribute('stroke-width'), '2');
  assert.equal(icon(doc, 'x', 12).className, 'ic');
});

test('the set has the Marketplace glyphs (marketplace CONTRACT §3.2); cube is the model cube; script stays the code glyph (L20)', () => {
  for (const name of ['search', 'key', 'external', 'git', 'folder', 'link', 'shield', 'pulse', 'gear', 'trash', 'spinner', 'bag',
    'tray', 'chat', 'plug', 'cube', 'agent', 'skill', 'layers', 'none']) assert.ok(Object.hasOwn(ICONS, name), name);
  assert.equal(ICONS.cube, ICONS.model);
  assert.equal(ICONS.script, '<path d="M8.5 8 4.5 12l4 4M15.5 8l4 4-4 4M13.5 5.5l-3 13"></path>');
  assert.equal(ICONS.none, '<rect x="5" y="5" width="14" height="14" rx="3" stroke-dasharray="3 3"></rect>');
  assert.equal(ICONS.tray, '<path d="M4 13h4l1.5 2.5h5L16 13h4"></path><path d="M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z"></path>');
  assert.equal(ICONS.bag, '<path d="M5 8h14l-1.2 12H6.2L5 8z"></path><path d="M9 10V6.5a3 3 0 0 1 6 0V10"></path>');
});

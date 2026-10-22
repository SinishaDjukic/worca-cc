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

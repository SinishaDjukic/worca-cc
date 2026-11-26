// test/verify-show-order-cdp.test.mjs — Shaper small runs slice 10 (R-ux-3, R-qa-3): the 2x light and dark proof of
// "Show order" is the `order` surface of tools/verify-run-status-rows-cdp.mjs, which needs Chrome, so it is not part of
// `npm test`. This needle test pins what the surface proves, so a change that drops a world, a shot or a check fails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = () => readFileSync(new URL('../tools/verify-run-status-rows-cdp.mjs', import.meta.url), 'utf8');

test('s10: it adds the order surface (SURFACE=order) and the WORLDS filter skips the row worlds for it', () => {
  const s = src();
  assert.match(s, /process\.env\.SURFACE === 'order'/, 'the section is guarded by SURFACE=order');
  const worlds = s.split('\n').find((l) => l.startsWith('const WORLDS =')) || '';
  for (const surface of ['order', 'links', 'map']) assert.ok(worlds.includes(`SURFACE !== '${surface}'`), `WORLDS skips SURFACE=${surface}`);
});

test('s10: it shoots order-closed and order-open per world and theme at 2x, and one 360px light shot', () => {
  const s = src();
  assert.match(s, /order-closed-(?:\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'order-closed-{world}-{theme}.png');
  assert.match(s, /order-open-(?:\$\{[A-Za-z.]+\})-\$\{[A-Za-z.]+\}\.png/, 'order-open-{world}-{theme}.png');
  assert.ok(s.includes('order-open-busy-360-light.png'), 'the narrow shot');
  assert.match(s, /\b360\b/);
  assert.match(s, /deviceScaleFactor: 2/);
  assert.match(s, /THEMES = \['light', 'dark'\]/);
});

test('s10: it checks closed-first after a reload, Hide order with focus kept, 16 dots, aria-hidden and the right-aligned toggle', () => {
  const s = src();
  assert.match(s, /location\.reload\(\)|Page\.reload/, 'each pass starts from a fresh mount');
  for (const t of ['Show order', 'Hide order', 'gpage-order-toggle', 'aria-expanded', 'activeElement', 'rom-run', 'aria-hidden']) {
    assert.ok(s.includes(t), t);
  }
  assert.match(s, /\.rom-run[^\n]*\b16\b|\b16\b[^\n]*\.rom-run/, '16 dots');
  assert.match(s, /Input\.dispatchMouseEvent/, 'real input clicks the toggle');
  assert.match(s, /gpage-order[\s\S]*getBoundingClientRect|getBoundingClientRect[\s\S]*gpage-order/, 'the rects are read');
});

test('s10: it checks it is closed after #runs and back, and no drawing on the card or the Runs list', () => {
  const s = src();
  assert.match(s, /closed (?:again )?(?:on|after) (?:the )?return|closed (?:again )?after #runs/i, 'a check named for the return');
  assert.match(s, /no drawing[^\n]*(?:card|Runs list)|(?:card|Runs list)[^\n]*no drawing/i, 'a check named for the card and the list');
  assert.ok(s.includes('.chat-rc'), 'the Chat card is read');
  assert.match(s, /scrollWidth/, 'the 360px pass reads the horizontal scroll');
});

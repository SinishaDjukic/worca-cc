// test/desktop-badge.test.mjs — desktop/src/badge.mjs: the page's "needs you" badge as main mirrors it (the Dock text,
// the Windows taskbar overlay bitmap, the Linux launcher count, the tray tooltip) and the IPC payload check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BADGE_CHANNEL, MAX_BADGE_COUNT, NO_BADGE, BADGE_COLOR, parseBadgeState, badgeKind, dockBadgeText, overlayLabel,
  badgeDescription, trayToolTip, linuxBadgeCount, badgeBitmap,
} from '../desktop/src/badge.mjs';

const S = (count, dot = false) => ({ count, dot });

test('parseBadgeState: valid {count, dot} pass, extra keys are dropped; non-objects, arrays, class instances, string/NaN/Infinity/fractional/negative/over-max counts, non-boolean dot and missing keys → null', () => {
  assert.equal(BADGE_CHANNEL, 'worca:badge');
  assert.equal(MAX_BADGE_COUNT, 99999);
  assert.deepEqual(NO_BADGE, { count: 0, dot: false });
  assert.ok(Object.isFrozen(NO_BADGE));
  assert.deepEqual(parseBadgeState({ count: 0, dot: false }), { count: 0, dot: false });
  assert.deepEqual(parseBadgeState({ count: 2, dot: true }), { count: 2, dot: true });
  assert.deepEqual(parseBadgeState({ count: MAX_BADGE_COUNT, dot: false }), { count: MAX_BADGE_COUNT, dot: false });
  const extra = parseBadgeState({ count: 3, dot: false, evil: 'x', __proto__: null });
  assert.deepEqual(Object.keys(extra), ['count', 'dot']);
  assert.deepEqual({ ...extra }, { count: 3, dot: false });
  class Fake { constructor() { this.count = 1; this.dot = false; } }
  const inherited = Object.create({ count: 1, dot: false });
  const bad = [
    null, undefined, 1, 'x', true, [], [1, false], new Fake(), inherited,
    { count: '2', dot: false }, { count: NaN, dot: false }, { count: Infinity, dot: false }, { count: 2.5, dot: false },
    { count: -1, dot: false }, { count: MAX_BADGE_COUNT + 1, dot: false },
    { count: 1, dot: 'true' }, { count: 1, dot: 1 }, { count: 1 }, { dot: true }, {},
  ];
  for (const v of bad) assert.equal(parseBadgeState(v), null, String(JSON.stringify(v)));
  const throwing = { get count() { throw new Error('boom'); }, dot: false };
  assert.doesNotThrow(() => parseBadgeState(throwing));
  assert.equal(parseBadgeState(throwing), null);
});

test("badgeKind / dockBadgeText: 0 → '' , 2 → '2', 0+dot → '•', 2+dot → '2'", () => {
  assert.deepEqual([S(0), S(2), S(0, true), S(2, true)].map(badgeKind), ['none', 'count', 'dot', 'count']);
  assert.deepEqual([S(0), S(2), S(0, true), S(2, true)].map(dockBadgeText), ['', '2', '•', '2']);
  assert.equal(dockBadgeText(S(12345)), '12345');
});

test("overlayLabel: 0 → null, 1 → '1', 9 → '9', 10 and 12345 → '9+', dot-only → '•'", () => {
  assert.deepEqual([S(0), S(1), S(9), S(10), S(12345), S(0, true), S(3, true)].map(overlayLabel), [null, '1', '9', '9+', '9+', '•', '3']);
});

test("badgeDescription and trayToolTip: 1 run (singular), 2 runs, problems only, none → 'Worca'", () => {
  assert.deepEqual([S(0), S(1), S(2), S(0, true), S(2, true)].map(badgeDescription), ['', '1 run needs you', '2 runs need you', 'Unread schedule problems', '2 runs need you']);
  assert.equal(trayToolTip(S(0)), 'Worca');
  assert.equal(trayToolTip(S(1)), 'Worca — 1 run needs you');
  assert.equal(trayToolTip(S(2)), 'Worca — 2 runs need you');
  assert.equal(trayToolTip(S(0, true)), 'Worca — unread schedule problems');
  assert.equal(trayToolTip(S(2), 'Other'), 'Other — 2 runs need you');
  assert.equal(trayToolTip(S(0), 'Other'), 'Other');
});

test('linuxBadgeCount: the count; dot-only → 0', () => {
  assert.deepEqual([S(0), S(2), S(0, true), S(7, true)].map(linuxBadgeCount), [0, 2, 0, 7]);
});

const px = (bmp, x, y) => [...bmp.buffer.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4)];
const isWhite = (p) => p[0] === 0xff && p[1] === 0xff && p[2] === 0xff && p[3] === 0xff;
const inDisc = (x, y) => (x + 0.5 - 16) ** 2 + (y + 0.5 - 16) ** 2 <= 256;
function whites(bmp) {
  const out = [];
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (isWhite(px(bmp, x, y))) out.push([x, y]);
  return out;
}

test("badgeBitmap: null for null and unknown labels; 32×32×4 BGRA; corners transparent; '•' centre is #e5484d opaque with no white pixel; '2' has white pixels inside the disc only; '2', '3' and '9+' buffers differ", () => {
  for (const l of [null, undefined, '', '10', '99', 'x', '9++', '-1', 2]) assert.equal(badgeBitmap(l), null, String(l));
  const labels = ['•', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '9+'];
  for (const l of labels) {
    const b = badgeBitmap(l);
    assert.ok(Buffer.isBuffer(b.buffer), l);
    assert.equal(b.buffer.length, 32 * 32 * 4, l);
    assert.deepEqual([b.width, b.height, b.scaleFactor], [32, 32, 2], l);
    for (const [x, y] of [[0, 0], [31, 0], [0, 31], [31, 31]]) assert.deepEqual(px(b, x, y), [0, 0, 0, 0], `${l} corner ${x},${y}`);
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const p = px(b, x, y);
        if (!inDisc(x, y)) assert.deepEqual(p, [0, 0, 0, 0], `${l} outside ${x},${y}`);
        else assert.ok(isWhite(p) || (p[0] === 0x4d && p[1] === 0x48 && p[2] === 0xe5 && p[3] === 0xff), `${l} inside ${x},${y}: ${p}`);
      }
    }
    if (l !== '•') assert.ok(whites(b).length > 0, `${l} draws a glyph`);
  }
  const dot = badgeBitmap('•');
  assert.deepEqual(px(dot, 16, 16), [0x4d, 0x48, 0xe5, 0xff]);
  assert.deepEqual(whites(dot), []);
  const two = badgeBitmap('2');
  assert.ok(whites(two).every(([x, y]) => inDisc(x, y)));
  const bufs = ['2', '3', '9+'].map((l) => badgeBitmap(l).buffer);
  assert.ok(!bufs[0].equals(bufs[1]) && !bufs[0].equals(bufs[2]) && !bufs[1].equals(bufs[2]));
  // Single glyphs at scale 4 (12×20) and '9+' at scale 3 (21×15) are centred.
  const box = (ws) => [Math.min(...ws.map((w) => w[0])), Math.min(...ws.map((w) => w[1])), Math.max(...ws.map((w) => w[0])), Math.max(...ws.map((w) => w[1]))];
  assert.deepEqual(box(whites(badgeBitmap('8'))), [10, 6, 21, 25]);
  assert.deepEqual(box(whites(badgeBitmap('9+'))), [5, 8, 25, 22]);
});

test("BADGE_COLOR equals the page's favicon dot colour", () => {
  const alerts = readFileSync(new URL('../ui/public/alerts.mjs', import.meta.url), 'utf8');
  const m = /const DOT_COLOR = '([^']+)';/.exec(alerts);
  assert.ok(m, 'alerts.mjs declares DOT_COLOR');
  assert.equal(BADGE_COLOR, m[1]);
});

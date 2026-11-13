// desktop/src/badge.mjs — the page's "needs you" badge as the desktop app mirrors it (docs/desktop.md "How it behaves"):
// the preload reads the page's "(N) " title prefix and its dotted favicon and sends { count, dot } over BADGE_CHANNEL;
// main shows it as the macOS Dock text, a Windows taskbar overlay (a bitmap drawn here, no image assets), the Linux
// launcher count and the tray tooltip. `dot` alone means unread schedule problems and no waiting run. Pure: no imports
// (Buffer is a global in main).

/** The renderer's badge report; the sandboxed preload repeats the literal. */
export const BADGE_CHANNEL = 'worca:badge';
/** The largest count accepted (the preload clamps to it, main refuses anything above). */
export const MAX_BADGE_COUNT = 99999;
export const NO_BADGE = Object.freeze({ count: 0, dot: false });
/** The page's favicon dot colour (ui/public/alerts.mjs DOT_COLOR). */
export const BADGE_COLOR = '#e5484d';

const DOT = '•';

const isPlainObject = (v) => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
const own = (o, k) => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);

/** A renderer's badge message → { count, dot }, or null for anything else. Extra keys are dropped; never throws. */
export function parseBadgeState(value) {
  try {
    if (!isPlainObject(value)) return null;
    const count = own(value, 'count');
    const dot = own(value, 'dot');
    if (!Number.isInteger(count) || count < 0 || count > MAX_BADGE_COUNT || typeof dot !== 'boolean') return null;
    return { count, dot };
  } catch {
    return null;
  }
}

/** 'count' when runs wait, 'dot' for unread schedule problems only, else 'none'. */
export function badgeKind(state) {
  if (state.count > 0) return 'count';
  return state.dot ? 'dot' : 'none';
}

/** The macOS Dock text: '' clears it. */
export function dockBadgeText(state) {
  const kind = badgeKind(state);
  if (kind === 'count') return String(state.count);
  return kind === 'dot' ? DOT : '';
}

/** The Windows overlay's label: null for none, '1'…'9', '9+' from 10, '•' for problems only. */
export function overlayLabel(state) {
  const kind = badgeKind(state);
  if (kind === 'count') return state.count >= 10 ? '9+' : String(state.count);
  return kind === 'dot' ? DOT : null;
}

/** What the badge means in words (the overlay's accessibility text); '' for none. */
export function badgeDescription(state) {
  const kind = badgeKind(state);
  if (kind === 'count') return state.count === 1 ? '1 run needs you' : `${state.count} runs need you`;
  return kind === 'dot' ? 'Unread schedule problems' : '';
}

export function trayToolTip(state, appName = 'Worca') {
  const kind = badgeKind(state);
  if (kind === 'none') return appName;
  const text = badgeDescription(state);
  return `${appName} — ${kind === 'dot' ? text.charAt(0).toLowerCase() + text.slice(1) : text}`;
}

/** Linux has no dot form: problems alone show nothing (the tooltip still says it). */
export function linuxBadgeCount(state) {
  return state.count;
}

// A 3×5 pixel font: one string of three 0/1 columns per row.
const FONT = Object.freeze({
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '001', '001'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
});
const SIZE = 32;
const RADIUS = 16;
const GLYPH_W = 3;
const GLYPH_H = 5;
const DISC = [0x4d, 0x48, 0xe5, 0xff];   // BADGE_COLOR as BGRA, opaque
const WHITE = [0xff, 0xff, 0xff, 0xff];

function glyphsFor(label) {
  if (label === DOT) return [];
  if (label === '9+') return ['9', '+'];
  if (typeof label === 'string' && /^[0-9]$/.test(label)) return [label];
  return null;
}

/**
 * The overlay image for a label: a BADGE_COLOR disc with white glyphs, 32×32 BGRA at scale factor 2 (16 DIP, the
 * overlay size), for nativeImage.createFromBitmap. null for null or an unknown label.
 */
export function badgeBitmap(label) {
  if (label === null || label === undefined) return null;
  const glyphs = glyphsFor(label);
  if (!glyphs) return null;
  const buffer = Buffer.alloc(SIZE * SIZE * 4);
  const put = (x, y, bgra) => { buffer.set(bgra, (y * SIZE + x) * 4); };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if ((x + 0.5 - RADIUS) ** 2 + (y + 0.5 - RADIUS) ** 2 <= RADIUS * RADIUS) put(x, y, DISC);
    }
  }
  if (glyphs.length) {
    const scale = glyphs.length === 1 ? 4 : 3;
    // Glyphs one font column apart.
    const width = (glyphs.length * GLYPH_W + (glyphs.length - 1)) * scale;
    const left = Math.floor((SIZE - width) / 2);
    const top = Math.floor((SIZE - GLYPH_H * scale) / 2);
    glyphs.forEach((g, i) => {
      const x0 = left + i * (GLYPH_W + 1) * scale;
      FONT[g].forEach((row, r) => {
        for (let c = 0; c < GLYPH_W; c++) {
          if (row[c] !== '1') continue;
          for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) put(x0 + c * scale + dx, top + r * scale + dy, WHITE);
        }
      });
    });
  }
  return { buffer, width: SIZE, height: SIZE, scaleFactor: 2 };
}

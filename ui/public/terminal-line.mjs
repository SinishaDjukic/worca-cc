// ui/public/terminal-line.mjs — line editing for a terminal running over pipes (issue #573, D10).
// Without a tty the shell neither echoes nor edits, so the pane does: local echo, Backspace, Ctrl+U,
// Enter sends the line, Ctrl+C asks for Stop, Ctrl+D on an empty line sends EOF (\x04). Tab stays in the
// line. Escape sequences (arrows) are dropped: no history here. A pasted CRLF is one line end, not two.
// The line is kept as grapheme clusters, so Backspace removes a whole emoji or accented letter and erases
// as many cells as the terminal drew for it.
const ESCAPES = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|O.|.)/g;

// Cell widths as xterm.js draws them by default (its Unicode 6 table): zero-width marks, East Asian wide
// and fullwidth ranges take two cells, everything else one (an emoji is one cell there).
const ZERO = [[0x0300, 0x036f], [0x0483, 0x0489], [0x0591, 0x05bd], [0x0610, 0x061a], [0x064b, 0x065f], [0x0e31, 0x0e31],
  [0x0e34, 0x0e3a], [0x0e47, 0x0e4e], [0x1160, 0x11ff], [0x1ab0, 0x1aff], [0x1dc0, 0x1dff], [0x200b, 0x200f], [0x202a, 0x202e],
  [0x2060, 0x2063], [0x206a, 0x206f], [0x20d0, 0x20ef], [0x302a, 0x302f], [0x3099, 0x309a], [0xfe00, 0xfe0f], [0xfe20, 0xfe23],
  [0xfeff, 0xfeff], [0xe0001, 0xe0001], [0xe0020, 0xe007f], [0xe0100, 0xe01ef]];
const WIDE = [[0x1100, 0x115f], [0x2329, 0x232a], [0x2e80, 0x303e], [0x3040, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x2fffd], [0x30000, 0x3fffd]];
const inRanges = (cp, ranges) => ranges.some(([a, z]) => cp >= a && cp <= z);

/** Cells a code point takes in the terminal. */
export function codePointWidth(cp) {
  if (cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return 0;
  if (inRanges(cp, ZERO)) return 0;
  return inRanges(cp, WIDE) ? 2 : 1;
}

/** Cells a string takes in the terminal (the sum of its code points, as xterm lays them out). */
export function cellWidth(s) {
  let w = 0;
  for (const ch of String(s)) w += codePointWidth(ch.codePointAt(0));
  return w;
}

const graphemes = (s) => {
  const Seg = globalThis.Intl?.Segmenter;
  if (!Seg) return [...s];
  return Array.from(new Seg(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment);
};

export function createLineEditor() {
  let buf = [];
  let lastCR = false;
  const erase = (cluster) => '\b \b'.repeat(cluster === '\t' ? 1 : cellWidth(cluster));
  return {
    feed(data) {
      let echo = '';
      let send = '';
      let interrupt = false;
      for (const g of graphemes(String(data).replace(ESCAPES, ''))) {
        // CR LF is one grapheme cluster; a lone LF right after a CR (split across feeds) is its tail.
        const ch = g === '\r\n' ? '\r' : g;
        const crlf = lastCR && ch === '\n';
        lastCR = g === '\r';
        if (crlf) continue;
        if (ch === '\r' || ch === '\n') { echo += '\r\n'; send += `${buf.join('')}\n`; buf = []; }
        else if (ch === '\x7f' || ch === '\b') { if (buf.length) echo += erase(buf.pop()); }
        else if (ch === '\x15') { echo += buf.map(erase).join(''); buf = []; }
        else if (ch === '\x03') { interrupt = true; buf = []; echo += '^C\r\n'; }
        else if (ch === '\x04') { if (!buf.length) send += '\x04'; }              // EOF only at the start of a line, like a tty
        else if (ch === '\t') { buf.push('\t'); echo += ' '; }                    // one cell drawn, so Backspace erases one
        else if (ch >= ' ' && ch !== '\x7f') { buf.push(g); echo += g; }
      }
      return { echo, send, interrupt };
    },
    get pending() { return buf.join(''); },
  };
}

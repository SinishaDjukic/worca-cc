// The Design stage's reveal (SPEC C2, L4.10, L4.11): a section's draft text reaches the build doc as a run of true
// prefixes, cut only between tags or at a space in a long text run, at least REVEAL_MIN_STEP_MS apart, and every piece
// lands within REVEAL_MAX_MS of arriving. It reaches the timers and the clock only through its arguments, and does
// nothing until `push` or `flush`.
//
// Each key (a draft path) keeps the text it was given, what was last sent (`out`) and its own rev counter. An Edit
// inside text already shown (P2: a delete splice, then the new text) keeps what is shown: the steps after it pace only
// the growth, each at least the first cut at or past what was shown when the new text came. Every
// emission is `onPrefix({key, sectionId, rev, text, final})` with `rev` one above the key's last, across pushes, flushes
// and drops (P3 drops a `section` rev at or below the last it saw, bridge.js), and `final` a boolean that is true only
// on the emission that carries the whole of a final text.

export const REVEAL_MAX_MS = 3000;
export const REVEAL_MIN_STEP_MS = 125;

// A long text run also cuts after a space once this many characters have passed since the last cut (L4.10).
const RUN_CUT_CHARS = 24;

const TEXT = 0;
const TAG = 1;
const COMMENT = 2;

const isSpace = (ch) => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f';

/**
 * Where `text` may be cut after `from`: right after each tag's `>`, after a space in a text run once 24 characters
 * have passed since the last cut, and always at the end. A `>` inside a quoted attribute value or a comment ends
 * nothing, and any `<` opens a tag, so a cut never falls inside one.
 * @param {string} text
 * @param {number} [from]
 * @returns {number[]} ascending indexes above `from`
 */
export function cutPoints(text, from = 0) {
  const s = typeof text === 'string' ? text : '';
  const start = Math.max(0, Math.floor(Number(from) || 0));
  const cuts = [];
  if (start >= s.length) return cuts;
  let last = start;
  const cut = (c) => {
    if (c <= start) return;
    cuts.push(c);
    last = c;
  };
  let mode = TEXT;
  let quote = '';
  let afterEq = false;
  let commentAt = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (mode === COMMENT) {
      // `-->`, `--!>`, and the abrupt `<!-->` and `<!--->` all end a comment.
      if (ch !== '>') continue;
      const dashes = s.startsWith('--', i - 2) && i - 2 >= commentAt;
      const bang = s.startsWith('--!', i - 3) && i - 3 >= commentAt;
      if (dashes || bang || i === commentAt || (i === commentAt + 1 && s[i - 1] === '-')) {
        mode = TEXT;
        cut(i + 1);
      }
      continue;
    }
    if (mode === TAG) {
      if (quote) {
        if (ch === quote) quote = '';
      } else if (ch === '>') {
        mode = TEXT;
        afterEq = false;
        cut(i + 1);
      } else if (ch === '=') {
        afterEq = true;
      } else if (afterEq && (ch === '"' || ch === "'")) {
        quote = ch;
        afterEq = false;
      } else if (!isSpace(ch)) {
        afterEq = false;
      }
      continue;
    }
    if (ch === '<') {
      if (s.startsWith('<!--', i)) {
        mode = COMMENT;
        commentAt = i + 4;
        i += 3;
      } else {
        mode = TAG;
      }
    } else if (isSpace(ch) && i + 1 - last >= RUN_CUT_CHARS) {
      cut(i + 1);
    }
  }
  if (cuts.at(-1) !== s.length) cuts.push(s.length);
  return cuts;
}

function commonPrefix(a, b) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * Paces section text into `section` messages (Task 14 sends each `onPrefix` as `section {id, rev, html, final}`).
 * `push` paces a new text; `flush` sends it whole at once; `finalize` sends what the key holds, whole, as final;
 * `drop` forgets a key; `shown(key)` is the text last sent for it.
 * @param {{ setTimer: Function, clearTimer: Function, now: () => number, reduced?: () => boolean,
 *   onPrefix: (p: { key: string, sectionId: string, rev: number, text: string, final: boolean }) => void }} opts
 */
export function createReveal({ setTimer, clearTimer, now, reduced = () => false, onPrefix }) {
  const entries = new Map();
  const revs = new Map();
  let dead = false;

  const entryOf = (key, sectionId) => {
    let e = entries.get(key);
    if (!e) {
      e = {
        key, sectionId, text: '', final: false, out: '', outFinal: false, shown: 0, base: 0, floor: 0, burstAt: 0,
        done: false, timer: null,
      };
      entries.set(key, e);
    }
    e.sectionId = sectionId;
    return e;
  };

  const disarm = (e) => {
    if (e.timer === null) return;
    clearTimer(e.timer);
    e.timer = null;
  };

  const arm = (e) => {
    if (e.timer !== null) return;
    e.timer = setTimer(() => {
      e.timer = null;
      step(e);
    }, REVEAL_MIN_STEP_MS);
  };

  // Sends the first `end` characters of the key's text, unless that is exactly what was last sent (`force`: always).
  const emit = (e, end, force = false) => {
    const text = e.text.slice(0, end);
    const final = e.final && end === e.text.length;
    if (!force && text === e.out && final === e.outFinal) return;
    e.out = text;
    e.outFinal = final;
    e.shown = end;
    if (final) e.done = true;
    const rev = (revs.get(e.key) ?? 0) + 1;
    revs.set(e.key, rev);
    onPrefix({ key: e.key, sectionId: e.sectionId, rev, text, final });
  };

  // One step: as far as the time since the burst began says (all of it at REVEAL_MAX_MS), at least the next cut, and
  // after an Edit inside the shown text at least the first cut at or past what was shown (`floor`).
  const step = (e) => {
    const len = e.text.length;
    let end = len;
    if (e.shown < len) {
      const cuts = cutPoints(e.text, e.base);
      const k = Math.min(1, Math.max(0, (now() - e.burstAt) / REVEAL_MAX_MS));
      const paced = cuts[Math.ceil(k * cuts.length) - 1] ?? e.base;
      const next = cuts.find((c) => c > e.shown) ?? len;
      const floor = e.floor > e.shown ? cuts.find((c) => c >= e.floor) ?? len : 0;
      end = Math.max(paced, next, floor);
    }
    emit(e, end);
    if (e.shown < len) arm(e);
    else disarm(e);
  };

  const flush = ({ key, sectionId, text, final }) => {
    if (dead) return;
    const e = entryOf(key, sectionId);
    e.text = typeof text === 'string' ? text : '';
    e.final = final === true;
    e.done = false;
    disarm(e);
    emit(e, e.text.length, true);
  };

  const push = (input) => {
    if (dead) return;
    if (reduced() === true) {
      flush(input);
      return;
    }
    const e = entryOf(input.key, input.sectionId);
    const text = typeof input.text === 'string' ? input.text : '';
    if (e.done && text === e.text) return;
    e.done = false;
    const idle = e.timer === null;
    const p = commonPrefix(e.out, text);
    e.text = text;
    e.final = input.final === true;
    if (text.length < e.out.length) {
      // Shorter than what the frame shows (a clear, a delete): sent at once, and nothing is left to pace.
      disarm(e);
      emit(e, text.length);
      return;
    }
    e.shown = p;
    // What the frame shows now: an Edit before its end re-paces only what grew past it.
    e.floor = e.out.length;
    if (idle) {
      e.burstAt = now();
      e.base = p;
      step(e);
    } else {
      e.base = Math.min(e.base, p);
    }
  };

  const finalize = (key) => {
    const e = entries.get(key);
    if (dead || !e || e.done) return;
    e.final = true;
    disarm(e);
    emit(e, e.text.length, true);
  };

  const drop = (key) => {
    const e = entries.get(key);
    if (!e) return;
    disarm(e);
    entries.delete(key);
  };

  return {
    push,
    flush,
    finalize,
    drop,
    shown: (key) => entries.get(key)?.out ?? '',
    destroy() {
      dead = true;
      for (const e of entries.values()) disarm(e);
      entries.clear();
      revs.clear();
    },
  };
}

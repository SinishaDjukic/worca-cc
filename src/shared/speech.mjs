// src/shared/speech.mjs
// Ask Worca voice mode (docs/speech.md): pure helpers shared by the browser
// (served from /src/shared) and the server (the STT connection test sends a
// silent WAV). No DOM, no Node APIs, no module state.

const FENCE_RE = /^\s*(```|~~~)/;
const URL_RE = /\bhttps?:\/\/[^\s)>\]]*[^\s)>\].,;:!?'"]/gi;
const ABBREV_RE = /(^|\s)(e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|no|approx)\.$/i;
const SENTENCE_END_RE = /[.!?…]+["')\]]*\s+/g;
const INLINE_CODE_MAX = 32;

/** One line fragment of markdown → plain speakable text (inline syntax only). */
export function speakableInline(s) {
  return String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(URL_RE, ' ')
    .replace(/`([^`]+)`/g, (_, c) => (c.length <= INLINE_CODE_MAX ? c : ' '))
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/[*`#>|]+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A whole markdown line → { text, breakAfter }; breakAfter ends the sentence at the line end. */
function lineToSpeech(line) {
  const t = line.trim();
  if (!t) return { text: '', breakAfter: true };
  if (t.startsWith('|') || /^(-{3,}|\*{3,}|_{3,})$/.test(t)) return { text: '', breakAfter: true };
  const heading = t.match(/^#{1,6}\s+(.*)$/);
  if (heading) return { text: speakableInline(heading[1]), breakAfter: true };
  const isItem = /^([-*+]|\d+[.)])\s+/.test(t);
  const body = t.replace(/^>\s?/, '').replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '');
  return { text: speakableInline(body), breakAfter: isItem };
}

/**
 * Streaming sentence chunker. push(rawSoFar, final?) takes the WHOLE accumulated
 * markdown each time and returns the sentences completed since the last call.
 * Invariants: nothing is spoken twice; a fence's or table's content is never
 * spoken; a partial line that could still become a fence/table waits.
 */
export function createSpeechChunker({ maxChars = 280 } = {}) {
  let seen = '';
  let inFence = false;
  let midLine = false;
  let pending = '';
  let out = [];

  const emit = (s) => { const t = s.trim(); if (t && /[\p{L}\p{N}]/u.test(t)) out.push(t); };

  function splitPending(final) {
    SENTENCE_END_RE.lastIndex = 0;
    let last = 0;
    let m;
    while ((m = SENTENCE_END_RE.exec(pending))) {
      const end = m.index + m[0].length;
      if (ABBREV_RE.test(pending.slice(last, end).trim())) continue;
      emit(pending.slice(last, end));
      last = end;
    }
    pending = pending.slice(last);
    while (pending.length > maxChars) {
      const head = pending.slice(0, maxChars);
      const cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
      const at = cut > maxChars / 3 ? cut + 1 : Math.max(head.lastIndexOf(' '), 1);
      emit(pending.slice(0, at));
      pending = pending.slice(at).trimStart();
    }
    if (final) { emit(pending); pending = ''; }
  }

  function take(piece, lineEnded) {
    if (!midLine && FENCE_RE.test(piece)) { inFence = !inFence; midLine = !lineEnded; return; }
    if (inFence) { midLine = !lineEnded; return; }
    const { text, breakAfter } = midLine ? { text: speakableInline(piece), breakAfter: false } : lineToSpeech(piece);
    const tail = lineEnded || /\s$/.test(piece) ? ' ' : '';
    if (text) pending += (pending && !/\s$/.test(pending) ? ' ' : '') + text + tail;
    splitPending(false);
    if (lineEnded && breakAfter && pending.trim()) {
      const p = pending.trim();
      emit(/[.!?…:]$/.test(p) ? p : `${p}.`);
      pending = '';
    }
    midLine = !lineEnded;
  }

  function realign(raw) {
    seen = raw;
    pending = '';
    inFence = raw.split('\n').filter((l) => FENCE_RE.test(l)).length % 2 === 1;
    midLine = raw.length > 0 && !raw.endsWith('\n');
  }

  function push(raw, final = false) {
    out = [];
    const text = String(raw ?? '');
    if (!text.startsWith(seen)) {
      if (seen.startsWith(text)) { if (final) splitPending(true); return out; }   // replay rewind: wait until it catches up
      realign(text);                               // diverged (adoption heal): skip ahead
      return out;
    }
    let rest = text.slice(seen.length);
    while (rest) {
      const nl = rest.indexOf('\n');
      if (nl < 0 && !final) {
        if (inFence) break;
        if (!midLine && /^\s*([`~|]|$)/.test(rest)) break;   // could still open a fence/table
        let cut = -1;
        SENTENCE_END_RE.lastIndex = 0;
        for (let m; (m = SENTENCE_END_RE.exec(rest));) cut = m.index + m[0].length;
        if (cut < 0) break;
        take(rest.slice(0, cut), false);
        seen += rest.slice(0, cut);
        rest = rest.slice(cut);
        break;
      }
      const line = nl < 0 ? rest : rest.slice(0, nl);
      take(line, true);
      seen += nl < 0 ? rest : rest.slice(0, nl + 1);
      rest = nl < 0 ? '' : rest.slice(nl + 1);
    }
    if (final) splitPending(true);
    return out;
  }

  return { push };
}

// Read aloud in hands-free when a reply has no spoken version and its opening cannot be read (docs/speech.md).
export const SPOKEN_FALLBACK_LINE = 'The full answer is on screen.';
const LIST_LINE_RE = /^\s*([-*+]|\d+[.)])\s/;
const TABLE_LINE_RE = /^\s*\|/;
const INDENTED_CODE_RE = /^( {4}|\t)/;
// A first line this short could still become a list item, a fence or a table: wait for more.
const MAYBE_OPENING_RE = /^\s{0,3}(\d+[.)]?|[-*+]|`{1,2}|~{1,2})?$/;

/**
 * Hands-free reply with no spoken version: read at most maxSentences prose sentences (maxChars in all),
 * or `line` instead when the first one is too long or the reply opens with a list, code or a table.
 * push(rawSoFar, flush?) takes the same accumulated markdown as createSpeechChunker and returns the
 * pieces to read; once the budget is spent (or the line was given) it returns [] for the rest of the
 * turn. One instance per turn.
 */
export function createSpokenFallback({ maxSentences = 2, maxChars = 240, line = SPOKEN_FALLBACK_LINE } = {}) {
  const chunker = createSpeechChunker();
  let opening = null;              // null = not decided yet, 'prose', or 'line'
  let done = false;
  let count = 0;
  let total = 0;

  /** Decide from the first non-blank line once it can no longer change meaning. */
  function decide(raw, flush) {
    const lines = String(raw ?? '').split('\n');
    const i = lines.findIndex((l) => l.trim());
    if (i < 0) return null;
    const first = lines[i];
    const complete = flush || i < lines.length - 1;
    if (LIST_LINE_RE.test(first) || FENCE_RE.test(first) || TABLE_LINE_RE.test(first) || INDENTED_CODE_RE.test(first)) return 'line';
    if (!complete && MAYBE_OPENING_RE.test(first)) return null;
    return 'prose';
  }

  function push(text, flush = false) {
    if (done) return [];
    if (!opening) opening = decide(text, flush);
    if (!opening) return [];
    if (opening === 'line') { done = true; return [line]; }
    const out = [];
    for (const piece of chunker.push(text, flush)) {
      if (count >= maxSentences || total + piece.length > maxChars) {
        done = true;
        if (!count) out.push(line);
        break;
      }
      out.push(piece);
      count += 1;
      total += piece.length;
    }
    if (count >= maxSentences) done = true;
    return out;
  }

  return { push };
}

/** Whole-document convenience (tests, and any non-streaming use). */
export function speakableText(md) {
  return createSpeechChunker().push(String(md ?? ''), true).join(' ');
}

/** Float32 mono samples in [-1, 1] → 16-bit PCM WAV bytes. */
export function encodeWav(samples, sampleRate = 16000) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, Number(samples[i]) || 0));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** whisper.cpp / Whisper non-speech markers ("[BLANK_AUDIO]", "(silence)", "[ Music ]") → ''. */
export function cleanTranscript(t) {
  return String(t ?? '').replace(/\[[^\]]*\]|\((?:silence|music|noise|inaudible)[^)]*\)/gi, ' ').replace(/\s+/g, ' ').trim();
}

// ── turn-taking (docs/speech.md "Using it") ──
// The pause setting is the wait after a finished sentence; unfinished words wait longer.
export const DEFAULT_PAUSE_S = 0.7;
export const UNFINISHED_PAUSE_FACTOR = 2.5;
export const FIXED_PAUSE_FLOOR_S = 1.2;
const PAUSE_MIN_S = 0.3;
const PAUSE_MAX_S = 5;
// After an unfinished ending ("Do you know how...") a conversation waits this long for more words before
// sending, on every speech-to-text path. Fixed: not scaled by the pause setting (docs/speech.md).
export const UNFINISHED_HOLD_MS = 5000;

/**
 * Settings › Speech › Pause before sending (seconds) → the three silences, in ms:
 * finishedMs after a finished sentence, unfinishedMs after unfinished words (2.5×, at most 5 s),
 * fixedMs for the single-shot paths (Dictate, "Your server": the setting, at least 1.2 s), and
 * heldMs, the silence after an unfinished final transcript before it is sent anyway (UNFINISHED_HOLD_MS).
 * Missing, 0 or not a number = the default; anything else is clamped to 0.3–5 s.
 */
export function pauseProfile(pauseS) {
  const n = Number(pauseS);
  const s = !Number.isFinite(n) || n === 0 ? DEFAULT_PAUSE_S : Math.min(PAUSE_MAX_S, Math.max(PAUSE_MIN_S, n));
  const finishedMs = Math.round(1000 * s);
  const unfinishedMs = Math.max(finishedMs, Math.round(1000 * Math.min(PAUSE_MAX_S, UNFINISHED_PAUSE_FACTOR * s)));
  const fixedMs = Math.round(1000 * Math.max(s, FIXED_PAUSE_FLOOR_S));
  return { finishedMs, unfinishedMs, fixedMs, heldMs: Math.max(finishedMs, UNFINISHED_HOLD_MS) };
}

// Words a sentence does not end on (English only; other languages rely on punctuation).
const TRAILING_WORDS = new Set([
  'and', 'or', 'but', 'so', 'because', 'cause', 'um', 'uh', 'er', 'erm', 'hmm', 'like', 'then', 'if', 'when', 'while',
  'with', 'of', 'to', 'for', 'from', 'the', 'a', 'an', 'my', 'your', 'our', 'their', 'this', 'that', 'which', 'who',
  'is', 'are', 'was', 'were', 'also', 'plus', 'about', 'in', 'on', 'at', 'into', 'than',
]);
// A question that has not got to its point yet: these words (or pairs) at the end mean more is coming,
// whatever punctuation Whisper put after them ("Do you know how?" is a cut-off). English only.
const OPEN_WORDS = new Set(['how', 'what', 'why', 'where', 'whether', 'when', 'which', 'who']);
const OPEN_PAIRS = new Set([
  'do you', 'does it', 'did you', 'can you', 'could you', 'would you', 'will you', 'are you', 'is it', 'is there',
]);
// Backchannel sounds, and what Whisper writes for noise: never a message of their own.
const FILLER_WORDS = new Set([
  'mm', 'mmm', 'mhm', 'mm-hm', 'mm-hmm', 'uh-huh', 'uh', 'huh', 'um', 'hm', 'hmm', 'ah', 'oh', 'er', 'erm', 'yeah', 'yes',
  'ok', 'okay', 'right', 'sure', 'thanks', 'thank', 'you', 'bye',
]);

/** Lowercased words with the punctuation at their edges stripped (inner hyphens and apostrophes kept). */
function wordsOf(text) {
  return String(text ?? '').toLowerCase().split(/\s+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter(Boolean);
}

/** True when the text is empty or only filler sounds ("Mm-hm.", "Thank you."). */
export function fillerOnly(text) {
  const words = wordsOf(text);
  return words.every((w) => FILLER_WORDS.has(w));
}

/**
 * Does the transcript sound unfinished? No end punctuation, a trailing comma / dash / ellipsis,
 * a last word a sentence does not end on ("…and." counts: Whisper often adds the period), or an
 * open question word or pair at the end ("how", "do you"), whatever the punctuation.
 * A short standalone question ("What?", "Do you?": two words at most, ending in "?") is finished.
 * Empty or filler-only text is unfinished.
 */
export function sentenceUnfinished(text) {
  const t = String(text ?? '').trim();
  if (!t || fillerOnly(t)) return true;
  if (/(\.\.\.|[,;:\-–…])["')\]]*$/.test(t)) return true;
  if (!/[.?!。？！]["')\]]*$/.test(t)) return true;
  const words = wordsOf(t);
  if (words.length <= 2 && /[?？]["')\]]*$/.test(t)) return false;
  const last = words[words.length - 1];
  return TRAILING_WORDS.has(last) || OPEN_WORDS.has(last) || OPEN_PAIRS.has(words.slice(-2).join(' '));
}

/** One message from two transcripts: "Show me the runs." + "and the failed ones." → "Show me the runs and the failed ones." */
export function joinTranscripts(a, b) {
  let x = String(a ?? '').trim();
  const y = String(b ?? '').trim();
  if (!x) return y;
  if (!y) return x;
  if (/[^.]\.$/.test(x) && /^\p{Ll}/u.test(y)) x = x.slice(0, -1);
  return `${x} ${y}`;
}

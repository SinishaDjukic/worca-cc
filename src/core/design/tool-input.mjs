// src/core/design/tool-input.mjs
// Incremental reader for a tool's streamed arguments (P2 Task 3). The CLI streams a Write or Edit input as
// `input_json_delta` slices cut anywhere, inside a key, an escape or a surrogate pair. This character state machine
// reads the top-level object only and reports the four string fields a stage draws from as decoded text, so the
// draft store can splice a file while the agent is still writing it. Every other key and every nested value is
// skipped by depth and string tracking, so a `content` inside a nested object is never mistaken for the field.
// The first structural violation stops the reader for good; it never throws on input.

const TARGETS = new Set(['file_path', 'content', 'old_string', 'new_string']);
const SIMPLE_ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const PRIMITIVE = /[0-9A-Za-z+\-.]/;
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;

const START = 0; // before the top-level `{`
const OPEN = 1; // after `{`: a key or `}`
const KEY_NEXT = 2; // after `,`: a key
const COLON = 3; // after a key
const VALUE = 4; // after `:`
const STRING = 5; // inside a string, see `sink`
const NESTED = 6; // inside a nested object or array value
const PRIM = 7; // inside a number or a literal
const AFTER = 8; // after a value: `,` or `}`
const DONE = 9; // after the top-level `}`

/**
 * @param {{onField: (call: {field: 'file_path'|'content'|'old_string'|'new_string', chunk: string, done: boolean}) => void}} opts
 * @returns {{feed: (partialJson: string) => void, end: () => void}}
 *
 * - `file_path` is reported once, whole, with `done:true`. Every other field's calls are held until it arrives,
 *   then flushed in order right after it; without a `file_path` by `end()` they are dropped.
 * - A field's text decoded in one `feed` makes at most one call `{chunk, done:false}` with a non-empty chunk; its
 *   closing quote adds `{chunk:'', done:true}`. A field is reported at most once.
 * - A trailing high surrogate, raw or from `\uD83D`, is held until the next code unit, so no chunk ends inside a pair.
 * - `end()` closes a value the stream cut short, dropping a partial escape or a held lone surrogate. It is idempotent.
 */
export function createToolInputReader({ onField }) {
  let state = START;
  let dead = false;
  let ended = false;
  /** Where decoded string text goes: 'key', 'path', 'text', or null to skip it. */
  let sink = null;
  /** The state a skipped string returns to: AFTER at the top level, NESTED inside a nested value. */
  let strReturn = AFTER;
  let esc = 0; // 0 none, 1 after a backslash, 2 inside \uXXXX
  let hex = 0;
  let hexDigits = 0;
  let key = '';
  let field = null;
  let pathText = '';
  let pending = '';
  const stack = [];
  const seen = new Set();
  let pathSent = false;
  let queue = [];

  const emit = (call) => { if (pathSent) onField(call); else queue.push(call); };
  const put = (t) => {
    if (sink === 'text') pending += t;
    else if (sink === 'path') pathText += t;
    else if (sink === 'key') key += t;
  };
  const openString = (to, ret) => { sink = to; strReturn = ret; esc = 0; state = STRING; };

  function closeString() {
    if (sink === 'key') { state = COLON; return; }
    if (sink === 'path') {
      onField({ field: 'file_path', chunk: pathText, done: true });
      pathSent = true;
      const held = queue;
      queue = [];
      for (const call of held) onField(call);
    } else if (sink === 'text') {
      if (pending) emit({ field, chunk: pending, done: false });
      pending = '';
      emit({ field, chunk: '', done: true });
    }
    sink = null;
    state = strReturn;
  }

  /** Reads string body characters from `i`; returns the index after the last one it consumed. */
  function readString(s, i) {
    while (i < s.length) {
      if (esc === 0) {
        let j = i;
        while (j < s.length) { const c = s.charCodeAt(j); if (c === 0x22 || c === 0x5c) break; j++; }
        if (j > i) put(s.slice(i, j));
        if (j === s.length) return j;
        if (s.charCodeAt(j) === 0x22) { closeString(); return j + 1; }
        esc = 1;
        i = j + 1;
        continue;
      }
      const ch = s[i++];
      if (esc === 1) {
        if (ch === 'u') { esc = 2; hex = 0; hexDigits = 0; continue; }
        const decoded = SIMPLE_ESCAPES[ch];
        if (decoded === undefined) { dead = true; return s.length; }
        put(decoded);
        esc = 0;
        continue;
      }
      const digit = parseInt(ch, 16);
      if (Number.isNaN(digit)) { dead = true; return s.length; }
      hex = hex * 16 + digit;
      if (++hexDigits === 4) { put(String.fromCharCode(hex)); esc = 0; }
    }
    return i;
  }

  /** Handles one structural character; false on a violation. */
  function step(c) {
    switch (state) {
      case START:
        if (c === '{') { state = OPEN; return true; }
        return isSpace(c);
      case OPEN:
        if (c === '}') { state = DONE; return true; }
      // falls through: after `{` a key is as welcome as after `,`
      case KEY_NEXT:
        if (c === '"') { key = ''; openString('key', COLON); return true; }
        return isSpace(c);
      case COLON:
        if (c === ':') { state = VALUE; return true; }
        return isSpace(c);
      case VALUE:
        if (c === '"') {
          if (TARGETS.has(key) && !seen.has(key)) {
            seen.add(key);
            field = key;
            if (key === 'file_path') { pathText = ''; openString('path', AFTER); } else { pending = ''; openString('text', AFTER); }
          } else openString(null, AFTER);
          return true;
        }
        if (c === '{' || c === '[') { stack.push(c); state = NESTED; return true; }
        if (PRIMITIVE.test(c)) { state = PRIM; return true; }
        return isSpace(c);
      case NESTED:
        if (c === '"') { openString(null, NESTED); return true; }
        if (c === '{' || c === '[') { stack.push(c); return true; }
        if (c === '}' || c === ']') {
          if (stack.pop() !== (c === '}' ? '{' : '[')) return false;
          if (!stack.length) state = AFTER;
        }
        return true;
      case PRIM:
        if (PRIMITIVE.test(c)) return true;
        state = AFTER;
        return step(c);
      case AFTER:
        if (c === ',') { state = KEY_NEXT; return true; }
        if (c === '}') { state = DONE; return true; }
        return isSpace(c);
      default: // DONE: nothing after the object is read
        return true;
    }
  }

  /** At the end of a feed, reports the open field's text, holding back a trailing high surrogate. */
  function flushFeed() {
    if (state !== STRING || sink !== 'text' || !pending) return;
    let text = pending;
    pending = '';
    if (isHighSurrogate(text.charCodeAt(text.length - 1))) { pending = text.slice(-1); text = text.slice(0, -1); }
    if (text) emit({ field, chunk: text, done: false });
  }

  return {
    feed(partialJson) {
      if (dead || ended || typeof partialJson !== 'string' || partialJson === '') return;
      const s = partialJson;
      let i = 0;
      while (i < s.length && !dead) {
        if (state === STRING) i = readString(s, i);
        else if (!step(s[i++])) dead = true;
      }
      flushFeed();
    },
    end() {
      if (ended) return;
      ended = true;
      if (!pathSent) { queue = []; return; }
      if (state === STRING && sink === 'text') {
        pending = '';
        emit({ field, chunk: '', done: true });
      }
    },
  };
}

// Hands-free voice replies: the model opens its answer with a short version for listening,
// `<spoken>…</spoken>`. This pure splitter takes that block out of a main assistant message as it
// streams, so the shown/stored text never holds it and the voice controller can read it aloud.
//
// The marker counts only at the START of a message (after optional whitespace). A message that does not
// begin with it passes through byte for byte. At most a marker-prefix tail is ever held back.

export const SPOKEN_OPEN = '<spoken>';
export const SPOKEN_CLOSE = '</spoken>';
export const SPOKEN_MAX_CHARS = 600;

const LEAD_WS = /^\s+/;

/** Length of the longest suffix of `s` that is a proper prefix of `marker`. */
function heldTail(s, marker) {
  for (let n = Math.min(s.length, marker.length - 1); n > 0; n--) {
    if (marker.startsWith(s.slice(s.length - n))) return n;
  }
  return 0;
}

/**
 * One splitter per main message. `push(chunk)` and `end()` return the increments to emit.
 * States: lead (waiting to see whether the message opens with the marker), inside (the spoken block),
 * after (dropping the whitespace right after the close), pass (all text).
 */
export function createSpokenSplitter({ maxChars = SPOKEN_MAX_CHARS } = {}) {
  let state = 'lead';
  let lead = '';          // lead: the raw chunks so far
  let content = '';       // inside: everything since the opener (close not yet seen)
  let emitted = 0;        // inside: how much of `content` went out as spoken
  let ended = false;

  const out = (spoken, text) => ({ spoken, text });

  function afterText(chunk) {
    const rest = chunk.replace(LEAD_WS, '');
    if (!rest) return '';
    state = 'pass';
    return rest;
  }

  function inside(chunk) {
    const searchFrom = Math.max(0, content.length - (SPOKEN_CLOSE.length - 1));
    content += chunk;
    const at = content.indexOf(SPOKEN_CLOSE, searchFrom);
    if (at !== -1 && at <= maxChars) {
      const spoken = content.slice(emitted, at);
      const rest = content.slice(at + SPOKEN_CLOSE.length);
      content = '';
      emitted = 0;
      state = 'after';
      return out(spoken, afterText(rest));
    }
    const keep = at === -1 ? heldTail(content, SPOKEN_CLOSE) : 0;
    if (at !== -1 || content.length - keep > maxChars) {
      // abandon: no close within the cap — everything since the opener is text; what was spoken stays spoken
      const text = content;
      content = '';
      emitted = 0;
      state = 'pass';
      return out('', text);
    }
    const upto = content.length - keep;
    const spoken = content.slice(emitted, upto);
    emitted = upto;
    return out(spoken, '');
  }

  function push(chunk) {
    const c = typeof chunk === 'string' ? chunk : '';
    if (ended) return out('', c);
    if (!c) return out('', '');
    switch (state) {
      case 'lead': {
        lead += c;
        const l = lead.replace(LEAD_WS, '');
        if (l.startsWith(SPOKEN_OPEN)) {
          lead = '';
          state = 'inside';
          return inside(l.slice(SPOKEN_OPEN.length));
        }
        if (l === '' || SPOKEN_OPEN.startsWith(l)) return out('', '');
        const text = lead;
        lead = '';
        state = 'pass';
        return out('', text);
      }
      case 'inside': return inside(c);
      case 'after': return out('', afterText(c));
      default: return out('', c);
    }
  }

  function end() {
    if (ended) return out('', '');
    ended = true;
    if (state === 'lead') { const text = lead; lead = ''; state = 'pass'; return out('', text); }
    if (state === 'inside') { const spoken = content.slice(emitted); content = ''; emitted = 0; state = 'pass'; return out(spoken, ''); }
    return out('', '');
  }

  return { push, end };
}

/** Whole-text split: one push + end of a fresh splitter, so it can never drift from the streamed result. */
export function splitSpoken(raw, opts) {
  const s = createSpokenSplitter(opts);
  const a = s.push(raw);
  const b = s.end();
  return { spoken: a.spoken + b.spoken, text: a.text + b.text };
}

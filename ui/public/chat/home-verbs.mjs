// ui/public/chat/home-verbs.mjs — the Chat home's hero, "What should worca <verb>?": the verb is typed and deleted, a
// letter at a time behind a blinking cursor, through what a chat can start (create, design, research, fix, analyse, test). The
// sentence never moves: the verb sits in a slot as wide as the widest verb (a hidden sizer in the slot's one grid cell),
// so only the typed letters change. Screen readers hear one steady sentence (the h1's aria-label); the slot is
// aria-hidden. With reduced motion the verb stays "do", with no cursor. The page starts the typing on a visit and stops
// it on a leave, on its own clock (unref'd under node:test).

export const HERO_SENTENCE = 'What should worca do?';
export const HERO_VERBS = Object.freeze(['create', 'design', 'research', 'fix', 'analyse', 'test']);
/** One letter typed, one deleted; how long a typed verb stays; the pause before the next one starts. */
export const TYPE_MS = 75;
export const DELETE_MS = 40;
export const VERB_HOLD_MS = 1300;
export const VERB_GAP_MS = 220;

/** The hero's h1: "What should worca " + the verb slot (typed letters, the cursor, "?"). */
export function createHeroTitle({ doc, win, clock = win }) {
  const make = (cls, text) => { const n = doc.createElement('span'); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const title = doc.createElement('h1');
  title.className = 'chat-home-title';
  title.setAttribute('aria-label', HERO_SENTENCE);
  const lead = make('', 'What should worca ');
  lead.setAttribute('aria-hidden', 'true');
  const slot = make('chat-home-verb');
  slot.setAttribute('aria-hidden', 'true');
  const widest = HERO_VERBS.reduce((a, w) => (w.length > a.length ? w : a), '');
  const sizer = make('chat-home-verb-size', widest);   // the slot's width (the widest verb, a cursor, "?"), never seen
  sizer.append(make('chat-home-cursor'), doc.createTextNode('?'));
  const line = make('chat-home-verb-line');
  const typed = make('chat-home-verb-typed');
  const cursor = make('chat-home-cursor');
  line.append(typed, cursor, make('chat-home-q', '?'));   // the sentence's own mark, in the title's ink
  slot.append(sizer, line);
  title.append(lead, slot);

  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let i = 0, timer = null;
  const later = (fn, ms) => { timer = clock.setTimeout(() => { timer = null; if (title.isConnected) fn(); }, ms); };
  const plain = () => { typed.textContent = 'do'; cursor.hidden = true; };
  function type(word, n) {
    typed.textContent = word.slice(0, n);
    if (n < word.length) later(() => type(word, n + 1), TYPE_MS);
    else later(() => erase(word, n), VERB_HOLD_MS);
  }
  function erase(word, n) {
    if (reduced()) { plain(); return; }
    typed.textContent = word.slice(0, n);
    if (n > 0) later(() => erase(word, n - 1), DELETE_MS);
    else { i = (i + 1) % HERO_VERBS.length; later(() => type(HERO_VERBS[i], 1), VERB_GAP_MS); }
  }
  function stop() { if (timer != null) { clock.clearTimeout(timer); timer = null; } }
  plain();
  return {
    el: title,
    /** A visit: the first verb is shown whole, then the typing goes round (never with reduced motion). */
    start() {
      stop();
      if (reduced()) { plain(); return; }
      cursor.hidden = false;
      i = 0;
      typed.textContent = HERO_VERBS[0];
      later(() => erase(HERO_VERBS[0], HERO_VERBS[0].length), VERB_HOLD_MS);
    },
    /** A leave or a destroy: nothing left running. */
    stop,
  };
}

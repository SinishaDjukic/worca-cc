// ui/public/chat/home-verbs.mjs — the Chat home's hero, "What should worca <verb>?": the verb slowly fades from one to
// the next through what a chat can start (create, design, research, fix, analyse, test), each held for a few seconds,
// so the headline never competes with the composer below it (#1556). The sentence never moves: the verb sits in a slot
// as wide as the widest verb (a hidden sizer in the slot's one grid cell). Screen readers hear one steady sentence (the
// h1's aria-label); the slot is aria-hidden. With reduced motion the verb stays "do". The page starts the typing on a visit and stops
// it on a leave, on its own clock (unref'd under node:test).

export const HERO_SENTENCE = 'What should worca do?';
export const HERO_VERBS = Object.freeze(['create', 'design', 'research', 'fix', 'analyse', 'test']);
/** How long a verb stays; how long it (with its "?", so the mark never jumps) fades out — the next fades in as long, in CSS. */
export const VERB_HOLD_MS = 4000;
export const FADE_MS = 500;

/** The hero's h1: "What should worca " + the verb slot (the verb, then "?"). */
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
  const sizer = make('chat-home-verb-size', `${widest}?`);   // the slot's width (the widest verb and "?"), never seen
  const line = make('chat-home-verb-line');
  const word = make('chat-home-verb-word');
  line.append(word, make('chat-home-q', '?'));   // the sentence's own mark, in the title's ink
  slot.append(sizer, line);
  title.append(lead, slot);

  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let i = 0, timer = null;
  const later = (fn, ms) => { timer = clock.setTimeout(() => { timer = null; if (title.isConnected) fn(); }, ms); };
  const plain = () => { word.textContent = 'do'; line.classList.remove('is-out'); };
  function show(n) {
    i = n;
    word.textContent = HERO_VERBS[i];
    line.classList.remove('is-out');
    later(fadeOut, VERB_HOLD_MS);
  }
  function fadeOut() {
    if (reduced()) { plain(); return; }
    line.classList.add('is-out');
    later(() => show((i + 1) % HERO_VERBS.length), FADE_MS);
  }
  function stop() { if (timer != null) { clock.clearTimeout(timer); timer = null; } }
  plain();
  return {
    el: title,
    /** A visit: the first verb shows, then the verbs take turns (never with reduced motion). */
    start() {
      stop();
      if (reduced()) { plain(); return; }
      show(0);
    },
    /** A leave or a destroy: nothing left running. */
    stop,
  };
}

// ui/public/chat/home-verbs.mjs — the Chat home's hero, "What should worca <verb>?": the verb crossfades through what a
// chat can start (create, design, research, fix, analyse, test, then round again). Two stacked layers share the slot's
// one grid cell with a hidden "research?" sizer: the leaving layer fades out while the next fades in (chat-home.css,
// opacity and a 2px blur, FADE_MS), nothing moves, and each verb stays fully shown for HOLD_MS. The sentence never moves:
// the slot is as wide as the widest verb. Screen readers hear one steady sentence (the h1's aria-label); the slot is
// aria-hidden. The loop waits while the tab is hidden or the composer is focused or holds text, and resumes with a full
// hold once that ends; only one timer exists at a time. With reduced motion the verb stays "do" and nothing is timed.
// The page starts the loop on a visit and stops it on a leave, on its own clock (unref'd under node:test).

export const HERO_SENTENCE = 'What should worca do?';
export const HERO_VERBS = Object.freeze(['create', 'design', 'research', 'fix', 'analyse', 'test']);
/** The crossfade between two verbs (chat-home.css --verb-fade is the same), and how long each verb stays fully shown. */
export const FADE_MS = 650;
export const HOLD_MS = 4600;

/**
 * The hero's h1: "What should worca " + the verb slot (the sizer and two layers, each a verb and "?").
 * @param {{ doc: Document, win: Window, clock?: { setTimeout, clearTimeout }, composer?: () => HTMLElement|null }} o
 *   composer: looked up on every check (the composer may be built after the hero).
 */
export function createHeroTitle({ doc, win, clock = win, composer = () => null }) {
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
  const layer = () => { const n = make('chat-home-verb-layer'); n.append(doc.createTextNode(''), make('chat-home-q', '?')); return n; };
  const layers = [layer(), layer()];   // each verb with the sentence's own mark, in the title's ink
  slot.append(sizer, ...layers);
  title.append(lead, slot);

  const reduced = () => !!win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  let i = 0, on = 0, timer = null;
  const later = (fn, ms) => { timer = clock.setTimeout(() => { timer = null; if (title.isConnected) fn(); }, ms); };
  const clear = () => { if (timer != null) { clock.clearTimeout(timer); timer = null; } };
  /** The shown layer takes the word in place: no fade (the first verb of a visit, "do"). */
  const put = (word) => {
    layers[on].firstChild.data = word;
    layers[on].classList.add('is-on');
    layers[1 - on].classList.remove('is-on');
  };
  /** The other layer takes the word and fades in while the shown one fades out. */
  const swap = (word) => { on = 1 - on; put(word); };
  const plain = () => put('do');
  const busy = () => {
    if (doc.hidden) return true;
    const c = composer();
    return !!c && (doc.activeElement === c || String(c.value ?? '').trim() !== '');
  };
  function turn() {
    if (reduced()) { plain(); return; }
    if (busy()) return;   // a wake resumes it
    i = (i + 1) % HERO_VERBS.length;
    swap(HERO_VERBS[i]);
    later(turn, FADE_MS + HOLD_MS);
  }
  /** The tab shown or hidden, the composer focused, blurred or typed in: wait while busy, else a full hold. */
  function wake() {
    if (busy()) clear();
    else if (timer == null) later(turn, HOLD_MS);
  }
  const onEvent = (e) => { if (e.type === 'visibilitychange' || (e.target && e.target === composer())) wake(); };
  const EVENTS = ['visibilitychange', 'focusin', 'focusout', 'input'];
  function stop() {
    clear();
    for (const t of EVENTS) doc.removeEventListener(t, onEvent);
  }
  plain();
  return {
    el: title,
    /** A visit: the first verb is shown whole, then the crossfades go round (never with reduced motion). */
    start() {
      stop();
      if (reduced()) { plain(); return; }
      i = 0;
      put(HERO_VERBS[0]);
      for (const t of EVENTS) doc.addEventListener(t, onEvent);
      wake();
    },
    /** A leave or a destroy: no timer, no listener. */
    stop,
  };
}

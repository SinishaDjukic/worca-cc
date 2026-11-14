// A video's voice and music in the preview (SPEC D12, D13, U5; L6, L8, L14). The frame is sandboxed with no right to
// autoplay and the play click happens in this page, so the page plays the sound: one `<audio>` per clip and one for the
// music, never attached, following the frame's `time` messages. The rule is the one film.js keeps for a film opened
// alone (`soundAt`, a playing element more than SOUND_DRIFT off is set right), except that a clip starts up to 0.1 s
// early, from its beginning: the frame reports film time only every 0.1 s. Every element is handled in its own try,
// so one that throws never stops the others, and never the play click that unlocks them.

import { SOUND_DRIFT, soundAt } from '../../../src/shared/sound-services.mjs';

// Seconds before its start a clip may begin.
const EARLY_S = 0.1;
// The mute choice is kept for the browser (L14): '1' or '0'.
const MUTE_KEY = 'worca.design.mute';

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** play() answers a promise that rejects when the browser refuses or a pause cuts it short: neither is an error. */
function playEl(el) {
  const p = el.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

/** One element at its place: started where it should be, set right past the drift, or stopped. */
function keep(el, on, local) {
  if (!on) {
    if (!el.paused) el.pause();
    return;
  }
  if (el.paused) {
    el.currentTime = local;
    playEl(el);
  } else if (Math.abs(el.currentTime - local) > SOUND_DRIFT) {
    el.currentTime = local;
  }
}

function each(els, fn) {
  for (const el of els) {
    try {
      fn(el);
    } catch {
      // That element's own failure: the rest go on.
    }
  }
}

/**
 * The preview's sound player. `fileUrl(name)` is where the page fetches a file the tracks name.
 * @param {{doc: Document, fileUrl: (name: string) => string}} deps
 * @returns {{load: (tracks: object|null) => void, hasSound: () => boolean, unlock: () => void,
 *   onTime: (o: {t: number, playing: boolean, dur: number}) => void, setMuted: (on: boolean) => void,
 *   isMuted: () => boolean, silence: () => void, destroy: () => void, _elements: () => HTMLAudioElement[]}}
 */
export function createFilmSound({ doc, fileUrl }) {
  const win = doc.defaultView;
  // What GET …/sound said: `{ clips: [{ id, file, start, seconds }], music: { file, seconds, gain } | null }`.
  let tracks = null;
  let clips = [];
  let music = null;
  // Elements started and stopped inside a play click already.
  let unlocked = new WeakSet();
  let destroyed = false;
  let muted = false;
  try {
    muted = win.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // No storage for this page: the choice lasts as long as the player.
  }

  const elements = () => clips.map((c) => c.el).concat(music ? [music] : []);

  function make(file, loop) {
    const el = doc.createElement('audio');
    el.preload = 'auto';
    el.loop = loop;
    el.muted = muted;
    el.src = fileUrl(file);
    return el;
  }

  // An unattached `<audio>` plays on until it is paused, and fetches on until its source is gone.
  function drop() {
    each(elements(), (el) => {
      el.pause();
      el.removeAttribute('src');
      el.load();
    });
    tracks = null;
    clips = [];
    music = null;
    unlocked = new WeakSet();
  }

  function silence() {
    each(elements(), (el) => {
      if (!el.paused) el.pause();
    });
  }

  return {
    /** The tracks of the film on screen; null, or no clip and no music, is no sound. */
    load(next) {
      drop();
      if (destroyed) return;
      const list = Array.isArray(next?.clips) ? next.clips.filter((c) => typeof c?.file === 'string') : [];
      const m = typeof next?.music?.file === 'string' ? next.music : null;
      if (list.length === 0 && !m) return;
      tracks = { clips: list, music: m };
      clips = list.map((c) => ({ el: make(c.file, false), start: c.start, seconds: c.seconds }));
      music = m ? make(m.file, true) : null;
    },
    hasSound: () => tracks !== null,
    /**
     * Inside the play click: each element not yet unlocked and not playing is started and stopped at once, so one
     * that starts later, from a `time` message with no click, may still play.
     */
    unlock() {
      each(elements(), (el) => {
        if (unlocked.has(el) || !el.paused) return;
        unlocked.add(el);
        playEl(el);
        el.pause();
      });
    },
    /** What the frame's `time` said: while playing, each clip and the music where the rule puts them; else nothing. */
    onTime({ t, playing, dur } = {}) {
      if (!tracks) return;
      if (playing !== true || !Number.isFinite(t)) {
        silence();
        return;
      }
      for (const c of clips) {
        each([c.el], (el) => keep(el, t >= c.start - EARLY_S && t < c.start + c.seconds, Math.max(0, t - c.start)));
      }
      if (!music) return;
      each([music], (el) => {
        const at = soundAt(tracks, t, dur).music;
        // The gain is an agent's number: a volume above 1 throws.
        const volume = clamp01(at.volume);
        if (Number.isFinite(volume) && el.volume !== volume) el.volume = volume;
        keep(el, at.on, at.local);
      });
    },
    setMuted(on) {
      muted = on === true;
      each(elements(), (el) => {
        el.muted = muted;
      });
      try {
        win.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // Kept for this player only.
      }
    },
    isMuted: () => muted,
    silence,
    destroy() {
      destroyed = true;
      drop();
    },
    _elements: elements,
  };
}

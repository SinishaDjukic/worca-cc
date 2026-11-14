// The deck and video chrome (M9, L5, L7.23): what P4's stage has no place for. P4's model already lays the frame out
// and draws the tiles, their tags, guides and labels; this holds the `board` message the build doc lays its tiles out
// by, a finished deck's rail (deck-rail.mjs), and a video's timeline and transport (film-transport.mjs). It reaches the
// DOM and the frame only through its arguments, and does nothing until `update`. A video given `loadTracks` and
// `fileUrl` also plays its voice and music here (film-sound.mjs; SPEC D12): the frame may not, the page may.

import { createDeckRail } from './deck-rail.mjs';
import { createFilmBar } from './film-transport.mjs';
import { createFilmSound } from './film-sound.mjs';

/**
 * @param {{doc: Document, wrap: HTMLElement, kind: string, post: (t: string, fields: object) => boolean,
 *   openRailFrame?: Function, colorOf?: (agentId: string) => string|null,
 *   loadTracks?: () => Promise<object|null>, fileUrl?: (name: string) => string}} deps `post` is the frame host's
 *   `send`, which takes nothing before the doc's `ready`; `wrap` is the stage's `.dz-wrap`; `loadTracks` answers the
 *   design's sound tracks (null for none) and `fileUrl` where a track's file is fetched
 * @returns {{update: (view: object) => void, onFrameMessage: (msg: {t: string}) => void, pause: () => void,
 *   silence: () => void, destroy: () => void}}
 */
export function createKindChrome({ doc, wrap, kind, post, openRailFrame, colorOf, loadTracks, fileUrl }) {
  // The last board message, as sent and as JSON, whether or not the frame took it.
  let lastBoard = null;
  let lastJson = '';
  let destroyed = false;
  // The last view, the rail while one is up, and whether the run doc on screen still owes one (L7.30): set by its
  // `ready`, cleared when a rail opens. What that run doc said of its slides: its own order and the one in view.
  let view = null;
  let rail = null;
  let fresh = false;
  let runIds = null;
  let visibleId = null;
  // A video's one film bar and its mode: `run` only over the run doc with nothing live (L7.22), `build` otherwise.
  let film = null;
  let filmMode = 'build';
  // A video's sound: one player for the stage's life, whether the run doc on screen has sound and whether it is muted
  // (kept here too, since the bar is made later), and the newest doc's load, so an older one lands nowhere.
  const player = kind === 'video' && typeof loadTracks === 'function' && typeof fileUrl === 'function'
    ? createFilmSound({ doc, fileUrl })
    : null;
  let sound = { on: false, muted: player ? player.isMuted() : false };
  let loadSeq = 0;

  function setSound(next) {
    sound = next;
    film?.setSound(sound);
  }

  // A run doc's tracks; a newer `ready` since makes them nobody's (a destroyed player loads nothing).
  async function loadSound(seq) {
    let tracks = null;
    try {
      tracks = await loadTracks();
    } catch {
      tracks = null;
    }
    if (seq !== loadSeq) return;
    player.load(tracks);
    setSound({ on: player.hasSound(), muted: player.isMuted() });
  }

  // A hidden tab stops the frame's clock, and with no `time` message the looping music would play on.
  function onVisibility() {
    if (doc.visibilityState === 'hidden') player.silence();
  }
  if (player) doc.addEventListener('visibilitychange', onVisibility);

  function postBoard() {
    post('board', { ...lastBoard });
  }

  // L7.22: the rail and its `goto` live only while the frame holds the run doc and nothing is live, on a stage wide
  // enough for one (L7.24).
  const railFits = (v) => Boolean(v && v.regions?.rail && v.docMode === 'run' && !v.live);

  function closeRail() {
    if (!rail) return;
    rail.destroy();
    rail = null;
  }

  function feedRail() {
    rail.setSections(view.sections);
    rail.layout({ ch: view.regions.rail.h });
  }

  function openRail() {
    fresh = false;
    rail = createDeckRail({
      doc, host: wrap, openRailFrame,
      onGoto: (index) => { if (rail && railFits(view)) post('goto', { index }); },
    });
    feedRail();
    rail.setRunIds(runIds);
    if (visibleId !== null) rail.setVisible(visibleId);
  }

  // A live round takes the rail away at once (L7.21). A stage too narrow for one drops it too, but its run doc still
  // stands, so it owes the rail again when the stage widens. Otherwise only a run doc's `ready` arms one.
  function syncRail() {
    if (railFits(view)) {
      if (rail) feedRail();
      else if (fresh) openRail();
      return;
    }
    if (!rail) return;
    if (view && !view.live && view.docMode === 'run') fresh = true;
    closeRail();
  }

  function makeFilm() {
    const bar = createFilmBar({
      doc, host: wrap, colorOf,
      onSeek: (t) => post('seek', { at: t }),
      // Inside the click: the sound is unlocked before the frame is told to play.
      onPlay: () => {
        player?.unlock();
        post('play', {});
      },
      onPause: () => post('pause', {}),
      onMute: (muted) => {
        if (!player) return;
        player.setMuted(muted);
        setSound({ on: sound.on, muted: player.isMuted() });
      },
    });
    bar.setSound(sound);
    return bar;
  }

  // A video always has its timeline. A round turning live takes the transport and the scrub away at once (L7.21), and
  // stops a film the run doc is still playing: the swap to the build doc comes later. Leaving the run doc for any
  // reason stops its sound at once.
  function syncFilm() {
    if (kind !== 'video' || !view?.regions?.timeline) return;
    film ??= makeFilm();
    film.setSections(view.sections);
    const next = view.docMode === 'run' && !view.live ? 'run' : 'build';
    if (next === filmMode) return;
    if (filmMode === 'run' && view.live) post('pause', {});
    if (filmMode === 'run') player?.silence();
    filmMode = next;
    film.setMode(next);
  }

  // The run doc's film time and scene reach the bar only while it is `run`; the wire's `at` is the bar's `t`. The
  // sound follows the same time once that doc's tracks are in.
  function onFilmMessage(msg) {
    if (!film || filmMode !== 'run') return;
    if (msg.t === 'time') {
      film.setTime({ t: msg.at, playing: msg.playing, dur: msg.dur });
      if (sound.on) player.onTime({ t: msg.at, playing: msg.playing, dur: msg.dur });
    } else if (msg.t === 'visible' && typeof msg.id === 'string') film.setVisible(msg.id);
  }

  function onRunDocMessage(msg) {
    onFilmMessage(msg);
    if (view?.docMode !== 'run') return;
    if (msg.t === 'rects') {
      runIds = Array.isArray(msg.sections) ? msg.sections.map((s) => s?.id).filter((id) => typeof id === 'string') : [];
      rail?.setRunIds(runIds);
    } else if (msg.t === 'visible' && typeof msg.id === 'string') {
      visibleId = msg.id;
      rail?.setVisible(msg.id);
    }
  }

  return {
    /**
     * A `kindChromeView` result, after every input the stage reduced. A board that differs from the last goes down;
     * no board (the run doc, no section, a stage not measured) forgets the last, so a change round's build doc gets
     * its board again even when it is the same. The rail follows the view; an update opens one only for a run doc
     * that still owes it.
     */
    update(next) {
      if (destroyed) return;
      view = next ?? null;
      syncRail();
      syncFilm();
      const board = view?.board ?? null;
      if (!board) {
        lastBoard = null;
        lastJson = '';
        return;
      }
      const json = JSON.stringify(board);
      if (json === lastJson) return;
      lastBoard = { ...board };
      lastJson = json;
      postBoard();
    },
    /**
     * A C-6 message the model has reduced (L7.30). A build doc's `ready` gets the board again, since `send` dropped
     * what came before it; a run doc's `ready` is a new deck, which may hold other slides: its rail is a fresh one.
     */
    onFrameMessage(msg) {
      if (destroyed || typeof msg?.t !== 'string') return;
      if (msg.t !== 'ready') {
        onRunDocMessage(msg);
        return;
      }
      closeRail();
      runIds = null;
      visibleId = null;
      // A new doc's film waits at 0, paused, and what it said at boot came before its `ready`: start the bar there.
      film?.setTime({ t: 0, playing: false });
      film?.setVisible(null);
      // A new doc plays nothing of the last one's sound; a run doc then loads its own tracks.
      if (player) {
        loadSeq += 1;
        player.silence();
        setSound({ on: false, muted: player.isMuted() });
        if (msg.mode === 'run') void loadSound(loadSeq);
      }
      fresh = msg.mode === 'run';
      if (fresh) syncRail();
      else if (msg.mode === 'build' && lastBoard) postBoard();
    },
    /** The person picks elements: a film playing over the run doc stops, and its sound at once. */
    pause() {
      if (destroyed) return;
      player?.silence();
      if (film && filmMode === 'run') post('pause', {});
    },
    /** The stage lost its frame: no more `time` messages come, so the sound stops here. */
    silence() {
      if (!destroyed) player?.silence();
    },
    destroy() {
      destroyed = true;
      if (player) {
        doc.removeEventListener('visibilitychange', onVisibility);
        player.destroy();
      }
      closeRail();
      film?.destroy();
      film = null;
      lastBoard = null;
      lastJson = '';
    },
  };
}

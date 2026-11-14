// A video's timeline and transport (M9, L5, L7.7, L7.18, L7.21): the mockup's timeline (`canvas/src/engine.js`
// `_blockRect`, `_renderTimeline`) in the bottom 128 px of the well. The parent draws one block per scene from the
// plan's durations, with its status and, while building, its agent's crew colour; it cannot read the frames, so no
// block holds a picture (L7.7). Only over the run doc with nothing live (`run`) does the bar gain the transport, a
// playhead, pointer scrub and slider keys, and its film time comes only from the frame's `time` messages: nothing here
// moves by itself. kind-chrome.mjs decides the mode.

import { icon } from '../icons.mjs';

// `_blockRect` (engine.js:1707): the lane's margin on either side of the bar.
const MARGIN = 16;
// A tick every `step` seconds, the smallest step that keeps a film under 16 ticks: the mockup's 4 s at 52 s, and the
// longest film (40 scenes of 600 s) still fits.
const TICK_STEPS = Object.freeze([1, 2, 4, 8, 15, 30, 60, 120, 300, 600, 1800]);
const TICKS_MAX = 16;
// Positions are percentages kept to 4 decimals (`0.3 * 100` is `30.000000000000004`).
const PCT_STEPS = 1e4;
// Shift and an arrow move one frame of the 60 fps film; an arrow alone one second.
const FRAME_S = 1 / 60;
const STEP_S = 1;
const ICON_PX = 14;

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100 * PCT_STEPS) / PCT_STEPS : 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const lengthOf = (s) => (Number.isFinite(s?.duration) && s.duration > 0 ? s.duration : 0);

/** `m:ss` of the whole seconds in `s`; anything not above 0 reads `0:00`. */
export function fmtClock(s) {
  const whole = Number.isFinite(s) && s > 0 ? Math.floor(s) : 0;
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The timeline of a film from its plan: each scene's window in seconds (running sums of the durations, in plan order)
 * and its place in the lane in percent, and the ticks along the top, every other one labelled. A scene with no length
 * gets an empty window; a film with none has no ticks and every place 0.
 * @param {{id: string, job: string, status: string, agentId?: string|null, duration?: number|null}[]} sections
 * @returns {{dur: number, blocks: {id: string, job: string, status: string, agentId: string|null, start: number,
 *   end: number, left: number, width: number}[], ticks: {t: number, left: number, label: string|null}[]}}
 */
export function filmTimeline(sections) {
  const list = Array.isArray(sections) ? sections : [];
  const dur = list.reduce((sum, s) => sum + lengthOf(s), 0);
  let start = 0;
  const blocks = list.map((s) => {
    const len = lengthOf(s);
    const block = {
      id: s.id, job: s.job, status: s.status, agentId: typeof s.agentId === 'string' ? s.agentId : null,
      start, end: start + len, left: pct(start, dur), width: pct(len, dur),
    };
    start += len;
    return block;
  });
  const ticks = [];
  if (dur > 0) {
    const step = TICK_STEPS.find((x) => dur / x < TICKS_MAX) ?? Math.ceil(dur / (TICKS_MAX - 1));
    for (let i = 0; i * step <= dur; i += 1) {
      const t = i * step;
      ticks.push({ t, left: pct(t, dur), label: i % 2 === 0 ? fmtClock(t) : null });
    }
  }
  return { dur, blocks, ticks };
}

/** The film time under `x` px of a bar `width` px wide: the lane runs between the 16 px margins, clamped to its ends. */
export function seekFromX({ x, width, dur }) {
  const room = width - 2 * MARGIN;
  if (!(room > 0) || !(dur > 0) || !Number.isFinite(x)) return 0;
  return clamp((x - MARGIN) / room, 0, 1) * dur;
}

/** The block whose window holds `t`, else the last one; null with none. */
export function sceneAt(blocks, t) {
  if (!Array.isArray(blocks) || blocks.length === 0) return null;
  return blocks.find((b) => b.start <= t && t < b.end) ?? blocks[blocks.length - 1];
}

/**
 * The bar, built into `host` (the stage's `.dz-wrap`). It starts in `build`: the blocks only. `run` adds the transport
 * (play or pause, the scene's job, `0:07 / 0:20`), the playhead, and the bar as a slider a press or a key seeks.
 * `onSeek(t)`, `onPlay()` and `onPause()` go to the frame; the bar shows only what the frame's `time` said back. A film
 * with sound (`setSound`) adds a `Mute` / `Unmute` button after play (SPEC U5); a press asks `onMute(muted)` and the
 * button shows only what `setSound` says back.
 * @param {{doc: Document, host: HTMLElement, onSeek: (t: number) => void, onPlay: () => void, onPause: () => void,
 *   onMute?: (muted: boolean) => void, colorOf?: (agentId: string) => string|null}} deps
 * @returns {{setSections: (sections: object[]) => void, setMode: (mode: 'build'|'run') => void,
 *   setTime: (o: {t: number, playing: boolean, dur?: number}) => void, setVisible: (id: string|null) => void,
 *   setSound: (o: {on: boolean, muted: boolean}) => void, destroy: () => void}}
 */
export function createFilmBar({ doc, host, onSeek, onPlay, onPause, onMute, colorOf }) {
  const make = (tag, cls) => {
    const el = doc.createElement(tag);
    el.className = cls;
    return el;
  };
  const setText = (el, text) => {
    if (el.textContent !== text) el.textContent = text;
  };
  const setAttr = (el, name, value) => {
    if (el.getAttribute(name) !== value) el.setAttribute(name, value);
  };

  const bar = make('div', 'dz-film-timeline');
  const tickRow = make('div', 'dz-tl-ticks');
  const lane = make('div', 'dz-tl-lane');
  bar.append(tickRow, lane);
  host.append(bar);

  let mode = 'build';
  let destroyed = false;
  let sectionsKey = null;
  let model = filmTimeline([]);
  // One `{el, block}` per scene, in plan order.
  let blocks = [];
  // What the frame last said: its film time, whether it plays, and its length (the plan's until a `time` says it).
  let t = 0;
  let playing = false;
  let heardDur = null;
  let visibleId = null;
  // A press on the bar: held until it lets go, and whether the film played when it began.
  let held = false;
  let wasPlaying = false;
  let pointerId = null;
  let head = null;
  let transport = null;
  // Whether the film has sound and whether it is muted: kept here, since build mode throws the transport away.
  let sound = { on: false, muted: false };

  const dur = () => heardDur ?? model.dur;
  // The scene in view: the one the frame named, else the one under the playhead.
  const current = () => model.blocks.find((b) => b.id === visibleId) ?? sceneAt(model.blocks, t);

  function rebuild() {
    for (const { el } of blocks) el.remove();
    blocks = model.blocks.map((block) => {
      const el = make('div', 'dz-tl-block');
      el.dataset.id = block.id;
      el.style.left = `${block.left}%`;
      el.style.width = `calc(${block.width}% - 3px)`;
      const name = make('span', 'dz-tl-name');
      name.textContent = block.job;
      el.append(name);
      return { el, block };
    });
    const els = blocks.map((b) => b.el);
    if (head) head.before(...els);
    else lane.append(...els);
    tickRow.replaceChildren(...model.ticks.map((k) => {
      const el = make('div', k.label === null ? 'dz-tl-tick' : 'dz-tl-tick has-label');
      el.style.left = `${k.left}%`;
      if (k.label !== null) {
        const label = doc.createElement('span');
        label.textContent = k.label;
        el.append(label);
      }
      return el;
    }));
  }

  // The status classes: planned and writing are the build's, done and failed hold in both. A planned scene carries the
  // mockup's plus, drawn as a CSS cross.
  function paintStatus() {
    const building = mode === 'build';
    for (const { el, block } of blocks) {
      const planned = building && block.status === 'planned';
      el.classList.toggle('is-planned', planned);
      el.classList.toggle('is-writing', building && block.status === 'writing');
      el.classList.toggle('is-done', block.status === 'done');
      el.classList.toggle('is-failed', block.status === 'failed');
      const plus = el.querySelector('.dz-tl-plus');
      if (planned && !plus) el.append(make('i', 'dz-tl-plus'));
      else if (!planned && plus) plus.remove();
    }
  }

  // The crew colour, while building only: the finished film draws no crew (`_renderTimeline`, engine.js:1742).
  function paintCrew() {
    for (const { el, block } of blocks) {
      const crew = mode === 'build' && block.agentId !== null && typeof colorOf === 'function' ? colorOf(block.agentId) : null;
      const want = typeof crew === 'string' ? crew : '';
      if (el.style.getPropertyValue('--dz-crew') === want) continue;
      if (want) el.style.setProperty('--dz-crew', want);
      else el.style.removeProperty('--dz-crew');
    }
  }

  function paintSelected() {
    const id = mode === 'run' ? current()?.id : undefined;
    for (const { el, block } of blocks) el.classList.toggle('is-selected', block.id === id);
  }

  function makeTransport() {
    const el = make('div', 'dz-transport');
    const button = make('button', 'btn btn-sm btn-quiet btn-icon');
    button.type = 'button';
    button.addEventListener('click', toggle);
    const job = doc.createElement('b');
    const meta = make('span', 'dz-meta');
    el.append(button, job, meta);
    host.append(el);
    return { el, button, job, meta, label: null, mute: null, muteLabel: null };
  }

  function pressMute() {
    onMute?.(!sound.muted);
  }

  // The sound button sits right after play, and only while the film has sound.
  function paintMute() {
    if (!transport) return;
    if (!sound.on) {
      if (transport.mute) {
        transport.mute.removeEventListener('click', pressMute);
        transport.mute.remove();
        transport.mute = null;
        transport.muteLabel = null;
      }
      return;
    }
    if (!transport.mute) {
      transport.mute = make('button', 'btn btn-sm btn-quiet btn-icon dz-mute');
      transport.mute.type = 'button';
      transport.mute.addEventListener('click', pressMute);
      transport.button.after(transport.mute);
    }
    const label = sound.muted ? 'Unmute' : 'Mute';
    if (transport.muteLabel === label) return;
    transport.muteLabel = label;
    transport.mute.setAttribute('aria-label', label);
    transport.mute.title = label;
    transport.mute.replaceChildren(icon(doc, sound.muted ? 'volume-off' : 'volume', ICON_PX));
  }

  // Over the run doc: the playhead, the transport and the slider's values, each written only when it changed.
  function paintRun() {
    paintSelected();
    if (mode !== 'run') return;
    if (!head) {
      head = make('div', 'dz-tl-head');
      lane.append(head);
    }
    const d = dur();
    const left = `${pct(t, d)}%`;
    if (head.style.left !== left) head.style.left = left;
    transport ??= makeTransport();
    const label = playing ? 'Pause' : 'Play';
    if (transport.label !== label) {
      transport.label = label;
      transport.button.setAttribute('aria-label', label);
      transport.button.title = label;
      transport.button.replaceChildren(icon(doc, playing ? 'pause' : 'play', ICON_PX));
    }
    paintMute();
    setText(transport.job, current()?.job ?? '');
    const clock = `${fmtClock(t)} / ${fmtClock(d)}`;
    setText(transport.meta, clock);
    setAttr(bar, 'aria-valuemax', String(Math.round(d * 100) / 100));
    setAttr(bar, 'aria-valuenow', String(Math.round(t * 100) / 100));
    setAttr(bar, 'aria-valuetext', `${fmtClock(t)} of ${fmtClock(d)}`);
  }

  // The button and the keys exist only in `run`.
  function toggle() {
    if (playing) onPause();
    else onPlay();
  }

  const timeAt = (e) => {
    const r = bar.getBoundingClientRect();
    return seekFromX({ x: e.clientX - r.left, width: r.width, dur: dur() });
  };

  // A press seeks and pauses the film while it is held; letting go resumes it if it played. The press is the bar's
  // until it lets go, wherever the pointer goes.
  function onDown(e) {
    held = true;
    wasPlaying = playing;
    pointerId = e.pointerId;
    if (playing) onPause();
    onSeek(timeAt(e));
    try {
      bar.setPointerCapture?.(e.pointerId);
    } catch {
      // A synthetic or already ended pointer has nothing to capture; the press still scrubs.
    }
  }

  function onMove(e) {
    if (held) onSeek(timeAt(e));
  }

  function release() {
    try {
      if (pointerId !== null && pointerId !== undefined) bar.releasePointerCapture?.(pointerId);
    } catch {
      // The capture already ended with the pointer.
    }
    held = false;
    pointerId = null;
  }

  function onUp() {
    if (!held) return;
    const resume = wasPlaying;
    wasPlaying = false;
    release();
    if (resume) onPlay();
  }

  // The slider's keys, counted from the last time the frame said: arrows a second, Shift and an arrow a frame, Home
  // and End the ends, Space plays or pauses. A key with Alt, Ctrl or Meta stays the browser's.
  function onKey(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const d = dur();
    let to;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') to = t + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? FRAME_S : STEP_S);
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = d;
    else if (e.key === ' ') to = null;
    else return;
    e.preventDefault();
    if (to === null) toggle();
    else onSeek(clamp(to, 0, d));
  }

  const HANDLERS = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onUp], ['keydown', onKey]];
  const SLIDER_ATTRS = ['role', 'tabindex', 'aria-label', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow', 'aria-valuetext'];

  function enterRun() {
    for (const [type, fn] of HANDLERS) bar.addEventListener(type, fn);
    bar.setAttribute('role', 'slider');
    bar.setAttribute('tabindex', '0');
    bar.setAttribute('aria-label', 'Film position');
    bar.setAttribute('aria-valuemin', '0');
  }

  function leaveRun() {
    for (const [type, fn] of HANDLERS) bar.removeEventListener(type, fn);
    for (const name of SLIDER_ATTRS) bar.removeAttribute(name);
    if (held) release();
    wasPlaying = false;
    playing = false;
    head?.remove();
    head = null;
    if (transport) {
      transport.button.removeEventListener('click', toggle);
      transport.mute?.removeEventListener('click', pressMute);
      transport.el.remove();
      transport = null;
    }
  }

  return {
    /** The plan's scenes (removed ones left out); the blocks and ticks are rebuilt only when a scene's facts changed. */
    setSections(list) {
      if (destroyed) return;
      const next = Array.isArray(list) ? list : [];
      const key = JSON.stringify(next.map((s) => [s?.id, s?.job, s?.status, s?.agentId ?? null, s?.duration ?? null]));
      if (key !== sectionsKey) {
        sectionsKey = key;
        model = filmTimeline(next);
        rebuild();
        paintStatus();
        t = clamp(t, 0, dur());
        paintRun();
      }
      paintCrew();
    },
    /** `run` only over the run doc with nothing live; `build` takes the transport, the playhead and every input away. */
    setMode(next) {
      if (destroyed) return;
      const m = next === 'run' ? 'run' : 'build';
      if (m === mode) return;
      mode = m;
      if (m === 'run') enterRun();
      else leaveRun();
      paintStatus();
      paintCrew();
      paintRun();
    },
    /**
     * What the frame's `time` said, film time clamped to the film. A `dur` that is not above 0 leaves the plan's
     * length: a new run doc starts at 0, paused, before it said anything.
     */
    setTime({ t: at, playing: on, dur: d } = {}) {
      if (destroyed) return;
      heardDur = Number.isFinite(d) && d > 0 ? d : null;
      playing = on === true;
      t = clamp(Number.isFinite(at) ? at : 0, 0, dur());
      paintRun();
    },
    /** The scene the frame shows (its `visible`); null forgets it, and the scene under the playhead stands in. */
    setVisible(id) {
      if (destroyed) return;
      visibleId = typeof id === 'string' ? id : null;
      paintRun();
    },
    /** Whether the film on screen has sound, and whether it is muted: the button follows only this. */
    setSound({ on, muted } = {}) {
      if (destroyed) return;
      sound = { on: on === true, muted: muted === true };
      paintMute();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      leaveRun();
      bar.remove();
    },
  };
}

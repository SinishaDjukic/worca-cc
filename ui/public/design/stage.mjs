// The Design stage controller (SPEC section 3, C-5, C-6, C-8, M11): it feeds C-5 frames, C-6 messages and the
// person's actions through the pure model (stage-model.mjs), runs the effects it returns against the frame host, the
// reveal, the overlay and the socket, and paints the model at most once per animation frame (twice a second under
// reduced motion) into the stage head, the `.frame-box`, the overlay, the HUD and the Agents popover. Nothing runs at
// load time: only `createStage` touches `win`, and only through its arguments.

import {
  KIND_STAGE, LIVE_BUILD, initialStage, reduceFrame, reduceBridge, reduceUser, cameraStep, selectLayout, selectCursors,
  placeCursors, selectMarks, pruneGuides, selectHud, selectAgentRows, selectPlanRows, selectKindChrome, crewOf,
} from './stage-model.mjs';
import { createFrameHost } from './frame-host.mjs';
import { createKindChrome } from './kind-chrome.mjs';
import { BOARD_CANVAS } from './kind-view.mjs';
import { createReveal } from './reveal.mjs';
import { createOverlay } from './overlay.mjs';
import { createHud } from './hud.mjs';
import { createAgentsPanel, createDotTip } from './agents-panel.mjs';
import { icon } from '../icons.mjs';

// L4.9: the desktop page width before a plan names its canvas. A deck or a video is always 1920×1080 (a video at 60
// fps), so its first `hello` has a height too.
const CANVAS_FALLBACK = Object.freeze({ w: 1280 });
const FILM_FPS = 60;
const canvasFallback = (kind) => {
  if (!KIND_STAGE[kind]?.board) return CANVAS_FALLBACK;
  return kind === 'video' ? { ...BOARD_CANVAS, fps: FILM_FPS } : { ...BOARD_CANVAS };
};
// Under reduced motion the stage paints at 2 Hz, as the mock does.
const REDUCED_PAINT_MS = 500;
const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
// A cached preview token is not used for a fetch this long before the server's `expiresAt` (as the frame host).
const TOKEN_MARGIN_MS = 60000;
const VIEWPORT_BUTTONS = Object.freeze([['desktop', 'Desktop'], ['tablet', 'Tablet'], ['phone', 'Phone']]);

const isObject = (v) => typeof v === 'object' && v !== null;
const count = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
const money = (v) => (Number.isFinite(v) ? v : 0);
const enc = encodeURIComponent;

/**
 * `GET /api/design/:id` (C-8, Contract issue 6) as model input: the store's `build` row becomes a `design-build`
 * (`seq` 0, C-5's 10 `stats` keys, `elapsedMs` from `startedAt` to `endedAt ?? now`, the section counts from the
 * top-level records), and a plan becomes a `design-plan` (`planRev` 1) whose sections carry their record's `status`,
 * `agentId` and `summary`, so `band`, `estHeight` and `duration` come along.
 * @param {{design?: {id?: string}, plan?: {canvas?: object, sections?: object[]}|null, build?: object|null,
 *   sections?: object[]}} detail
 * @param {number} [now] epoch ms, for a round still running
 * @returns {object[]}
 */
export function detailToFrames(detail, now = Date.now()) {
  const d = isObject(detail) ? detail : {};
  const row = isObject(d.build) && typeof d.build.id === 'string' && d.build.id ? d.build : null;
  const designId = d.design?.id ?? row?.designId ?? null;
  const records = new Map();
  for (const r of Array.isArray(d.sections) ? d.sections : []) {
    if (isObject(r) && typeof r.id === 'string' && r.id && !records.has(r.id)) records.set(r.id, r);
  }
  const frames = [];
  if (row) {
    const list = [...records.values()];
    const started = Date.parse(row.startedAt);
    const ended = typeof row.endedAt === 'string' ? Date.parse(row.endedAt) : now;
    const elapsedMs = Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : 0;
    frames.push({
      type: 'design-build', designId, buildId: row.id, seq: 0,
      status: row.status, round: row.round, kind: row.kind, reason: row.reason ?? null, waiting: 0,
      stats: {
        agentsNow: 0,
        agentsTotal: count(row.agentsTotal),
        sectionsDone: list.filter((r) => r.status === 'done').length,
        sectionsPlanned: list.length,
        failed: list.filter((r) => r.status === 'failed').length,
        layers: count(row.layers),
        costUsd: money(row.costUsd),
        estimatedUsd: 0,
        costKnown: row.costKnown !== false,
        elapsedMs,
      },
    });
  }
  if (isObject(d.plan) && Array.isArray(d.plan.sections)) {
    frames.push({
      type: 'design-plan', designId, buildId: row?.id ?? null, seq: 0, planRev: 1, canvas: d.plan.canvas ?? null,
      sections: d.plan.sections.filter(isObject).map((s) => {
        const r = records.get(s.id);
        return { ...s, status: r?.status ?? 'planned', agentId: r?.agentId ?? null, summary: r?.summary ?? '' };
      }),
    });
  }
  return frames;
}

/**
 * The stage of one design, built into `host` (the view's `section.dz-stage`): the head (state word, viewport switch on
 * a web stage, `exportSlot`), and the well holding the frame, the overlay, the empty and lost lines, the dot tip, the
 * Agents popover and the HUD. `fetch` reaches C-8's routes, `sendWs` the socket. `onPicked(pin)` gets each element the
 * person pins, `onPlan(rows)` the Plan list's rows at every paint, `onExport` the HUD's Export (disabled without it),
 * `onFrameLost({mode})` a frame that could not come back. `prompt` is never called: Resume asks nothing (M13).
 * @param {{doc: Document, win: Window, host: HTMLElement, design: {id: string, kind: string, version?: number},
 *   fetch: Function, sendWs: (msg: object) => void, prompt?: Function, onPicked?: (pin: object) => void,
 *   onExport?: () => void, onPlan?: (rows: object) => void, onFrameLost?: (lost: {mode: string}) => void}} deps
 */
export function createStage({ doc, win, host, design, fetch: fetchFn, sendWs, onPicked, onExport, onPlan, onFrameLost }) {
  const designId = design.id;
  const kind = design.kind;
  const reduced = win.matchMedia?.(REDUCED_QUERY)?.matches === true;
  // The reducers read the monotonic clock; a preview token's `expiresAt` is epoch ms, so the token clock is the wall.
  const clock = () => win.performance.now();
  const wallNow = () => (win.performance.timeOrigin || 0) + win.performance.now();
  const base = `/api/design/${enc(designId)}`;

  const board = KIND_STAGE[kind]?.board === true;
  let state = initialStage({ designId, kind, canvas: canvasFallback(kind), reduced });
  let destroyed = false;
  let opened = false;
  let version = Number.isFinite(design.version) ? design.version : 0;
  let hidden = false;
  let paintId = null;
  let settleId = null;
  let easeH = null;
  let boxH = null;
  let preview = null;
  let lastLoad = null;
  let lostMode = null;

  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The head: the state word, the viewport switch (web only), and the slot P6's Export menu takes.
  const head = make('div', 'dz-stage-head');
  const stateEl = make('span', 'dz-state');
  const stateWord = doc.createTextNode('');
  stateEl.append(make('i', 'dz-state-dot'), stateWord);
  head.append(stateEl, make('span', 'dz-spacer'));
  const segButtons = [];
  if (KIND_STAGE[kind]?.viewport) {
    const seg = make('div', 'seg dz-seg');
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Viewport');
    for (const [name, label] of VIEWPORT_BUTTONS) {
      const b = make('button');
      b.type = 'button';
      b.setAttribute('aria-label', label);
      b.title = label;
      b.append(icon(doc, name));
      b.addEventListener('click', () => setViewport(name));
      segButtons.push([name, b]);
      seg.append(b);
    }
    head.append(seg);
  }
  const exportSlot = make('div', 'dz-menu-anchor');
  head.append(exportSlot);

  // The well. The frames get their own first child of `.frame-box`, so every new iframe stays under the overlay. A
  // video's well raises the HUD, its tip and the Agents popover above the timeline.
  const wrap = make('div', 'dz-wrap');
  if (kind === 'video') wrap.classList.add('is-film');
  const frameBox = make('div', 'frame-box');
  const frameMount = make('div');
  frameBox.append(frameMount);
  const empty = make('div', 'dz-empty', 'Nothing built yet');
  empty.hidden = true;
  const lost = make('div', 'dz-lost');
  lost.hidden = true;
  const reload = make('button', 'btn btn-sm', 'Reload');
  reload.type = 'button';
  lost.append(make('span', null, 'The page left its preview'), reload);
  wrap.append(frameBox, empty, lost);
  host.append(head, wrap);

  async function post(url, body) {
    const res = await fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = new Error(typeof data?.error === 'string' && data.error ? data.error : `Request failed (${res.status})`);
      if (typeof data?.code === 'string') err.code = data.code;
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // Every frame host mint goes to the route; the answer is kept for the stage's own fetches of draft files.
  async function mint() {
    const token = await post(`${base}/preview-token`, {});
    if (isObject(token) && typeof token.base === 'string' && Number.isFinite(token.expiresAt)) {
      preview = { base: token.base, expiresAt: token.expiresAt };
    }
    return token;
  }
  async function previewBase() {
    if (preview && wallNow() < preview.expiresAt - TOKEN_MARGIN_MS) return preview.base;
    preview = null;
    await mint();
    if (!preview) throw new Error('preview token: bad answer');
    return preview.base;
  }

  const frame = createFrameHost({
    doc, win, mount: frameMount, mint, now: wallNow,
    onMessage: (msg) => onFrameMessage(msg),
    onSwap: () => { lost.hidden = true; lostMode = null; },
    onLost: ({ mode }) => {
      lostMode = mode;
      lost.hidden = false;
      onFrameLost?.({ mode });
    },
  });

  const reveal = createReveal({
    setTimer: (fn, ms) => win.setTimeout(fn, ms),
    clearTimer: (id) => win.clearTimeout(id),
    now: clock,
    reduced: () => reduced,
    onPrefix: ({ sectionId, rev, text, final }) => { frame.send('section', { id: sectionId, rev, html: text, final }); },
  });

  const overlay = createOverlay({ doc, win, host: frameBox, reduced: () => reduced, onCursor: (id) => showAgent(id) });

  /**
   * A finished deck's rail thumbnails (L7.6): a second frame host on the build doc in `mount`, laid out by the rail's
   * own `board`. None of its messages reach the model; its `ready` gets the build doc's `hello`, then `onReady`.
   * @param {HTMLElement} mount
   * @param {{onReady: () => void}} o
   * @returns {{post: (t: string, fields?: object) => boolean, destroy: () => void}}
   */
  function openRailFrame(mount, { onReady }) {
    const rail = createFrameHost({
      doc, win, mount, mint, now: wallNow,
      onMessage: (m) => {
        if (m.t !== 'ready') return;
        rail.send('hello', { mode: 'build', kind, canvas: { ...BOARD_CANVAS } });
        onReady();
      },
      onSwap() {},
      onLost() {},
    });
    rail.load('build').catch(() => {});
    return { post: rail.send, destroy: rail.destroy };
  }

  // A deck or a video (L7.23): the board message the build doc lays its tiles out by, and a finished deck's rail. An
  // agent's colour is its crew token; one with no record (opened from detail frames) has none, and the CSS falls back.
  const chrome = board ? createKindChrome({
    doc, wrap, kind,
    post: (t, f) => frame.send(t, f),
    openRailFrame,
    colorOf: (agentId) => {
      const a = typeof agentId === 'string' && Object.hasOwn(state.agents, agentId) ? state.agents[agentId] : null;
      return a ? `var(${crewOf(a)})` : null;
    },
  }) : null;
  const tip = createDotTip({ doc, host: wrap });
  const panel = createAgentsPanel({
    doc, host: wrap,
    onStopAgent: (agentId) => post(`${base}/builds/${enc(state.buildId)}/agents/${enc(agentId)}/stop`, {}),
  });
  const hud = createHud({
    doc, host: wrap,
    onStop: async () => {
      dispatch(reduceUser, { type: 'stopping', on: true });
      try {
        await post(`${base}/builds/${enc(state.buildId)}/stop`, {});
      } catch (err) {
        dispatch(reduceUser, { type: 'stopping', on: false });
        throw err;
      }
    },
    onResume: () => resume(),
    onExport,
    onFollow: () => follow(),
    onHide: () => {
      hidden = !hidden;
      schedulePaint();
    },
    onDot: (id) => showAgent(id),
    onDotHover: (id) => {
      const row = id === null ? null : selectAgentRows(state).rows.find((r) => r.agentId === id);
      if (row) tip.show(row);
      else tip.hide();
    },
  });

  reload.addEventListener('click', () => { loadDoc(lostMode ?? frame.mode() ?? 'build', { fresh: true }); });

  /** One input through its reducer, then the camera; the effects run in order, then a paint is due. */
  function dispatch(reducer, input) {
    if (destroyed) return;
    const now = clock();
    const before = state;
    const r = reducer(state, input, now);
    const c = cameraStep(r.state, now);
    const changed = c.state !== state;
    state = c.state;
    // A new round loads a new build doc: what the reveal sent the old one says nothing of it, so the same text written
    // again in this round is sent, not skipped as already shown.
    if (state.buildId !== before.buildId) for (const key of Object.keys(before.drafts)) reveal.drop(key);
    const effects = [...r.effects, ...c.effects];
    for (const e of effects) runEffect(e);
    // A Continue that lands after `done` and before the run doc's `ready` leaves the run doc on its way: a live round
    // shows the build doc.
    if (LIVE_BUILD.includes(state.status) && lastLoad === 'run') loadDoc('build');
    if (changed || effects.length) schedulePaint();
    // At once, so a live status reaches the chrome before the next input; it compares before it posts or rebuilds.
    chrome?.update(selectKindChrome(state));
  }

  function runEffect(e) {
    switch (e.type) {
      case 'subscribe': sendWs({ type: 'subscribe', designBuildId: e.buildId }); break;
      case 'load': loadDoc(e.mode); break;
      case 'bridge': frame.send(e.t, e.fields); break;
      case 'feed': reveal.push({ key: e.key, sectionId: e.sectionId, text: e.text, final: e.final }); break;
      case 'flush': reveal.flush({ key: e.key, sectionId: e.sectionId, text: e.text, final: e.final }); break;
      case 'finalize': reveal.finalize(e.key); break;
      case 'drop': reveal.drop(e.key); break;
      case 'fetchFile': void fetchFile(e); break;
      case 'leave': overlay.leave(e, selectLayout(state)); break;
      case 'picked': onPicked?.(e.pin); break;
      case 'camera': applyCamera(e); break;
      case 'refresh': void refresh(); break;
      default: break;
    }
  }

  // A doc already on its way is not asked for twice; a fresh load (Reload, a server reboot) always goes.
  function loadDoc(mode, { fresh = false } = {}) {
    if (destroyed) return;
    if (!fresh && frame.pendingMode() === mode) return;
    lastLoad = mode;
    frame.load(mode, { fresh }).catch(() => {});
  }

  /** A draft too big for its frame (C-5): the gate serves the work dir from disk. Its text applies only when it is the
   *  size the frame said; otherwise the disk has moved on, and a snapshot catches up. */
  async function fetchFile(e) {
    let text = null;
    try {
      const at = await previewBase();
      const res = await fetchFn(`${at}/build/${String(e.path).split('/').map(enc).join('/')}`);
      if (res.ok) text = await res.text();
    } catch {
      text = null;
    }
    if (destroyed) return;
    if (typeof text === 'string' && new TextEncoder().encode(text).length === e.bytes) {
      dispatch(reduceFrame, {
        type: 'design-file', designId, buildId: e.buildId, seq: e.seq, path: e.path, rev: e.rev, text,
      });
    } else {
      dispatch(reduceUser, { type: 'rejoin' });
    }
  }

  async function refresh() {
    try {
      const res = await fetchFn(base);
      if (!res.ok) return;
      const detail = await res.json();
      if (destroyed) return;
      for (const f of detailToFrames(detail, wallNow())) dispatch(reduceFrame, f);
    } catch {
      // The next frame or hello catches up.
    }
  }

  // A C-6 message the frame host passed: `zoom` is the person's ctrl or meta wheel over the frame, in its viewport px.
  // Only the build doc's bridge sends it; one from a run doc is the page's own script, and zooms nothing. The chrome
  // sees a message after the model reduced it (L7.30): only `ready`'s reducer sets `docMode`, which the chrome reads.
  function onFrameMessage(msg) {
    if (msg.t === 'zoom') {
      if (frame.mode() === 'build') dispatch(reduceUser, { type: 'zoom', dy: msg.dy, stageY: msg.y * selectLayout(state).s });
      return;
    }
    dispatch(reduceBridge, msg);
    if (!destroyed) chrome?.onFrameMessage(msg);
  }

  function writeHeight(h) {
    if (!Number.isFinite(h)) return;
    boxH = h;
    frameBox.style.height = `${h}px`;
  }

  /** `.frame-box` from `selectLayout` (M11); while a move eases, never shorter than before it (L4.26). */
  function writeBox(layout) {
    if (!(layout.s > 0)) return;
    frameBox.style.width = `${layout.pageW}px`;
    frameBox.style.transform = `translate(${layout.ox}px, ${layout.oy}px) scale(${layout.s})`;
    frameBox.style.setProperty('--s', String(layout.s));
    frameBox.classList.toggle('is-narrow', layout.narrow);
    frameBox.classList.toggle('is-zoomed', layout.zoomed);
    if (board) frameBox.classList.toggle('is-fitted', layout.framed);
    writeHeight(easeH === null ? layout.viewH : Math.max(layout.viewH, easeH));
  }

  function cancelSettle() {
    if (settleId === null) return;
    win.clearTimeout(settleId);
    settleId = null;
  }

  // The camera's move: the box eases by `--cam-ms`, the frame scrolls in the bridge's own tween (L4.27). A box growing
  // takes its height at once; one shrinking keeps the taller height until the ease ends.
  function applyCamera(e) {
    const ms = Number.isFinite(e.ms) && e.ms > 0 ? e.ms : 0;
    const layout = selectLayout(state);
    cancelSettle();
    if (ms > 0) {
      easeH = Math.max(boxH ?? 0, layout.viewH);
      settleId = win.setTimeout(() => {
        settleId = null;
        easeH = null;
        if (!destroyed) writeHeight(selectLayout(state).viewH);
      }, ms);
    } else {
      easeH = null;
    }
    frameBox.style.setProperty('--cam-ms', `${ms}ms`);
    writeBox(layout);
    frame.send('scroll', { y: e.y, behavior: ms ? 'smooth' : 'auto', ...(ms ? { ms } : {}) });
  }

  function schedulePaint() {
    if (destroyed || paintId !== null) return;
    paintId = reduced ? win.setTimeout(paint, REDUCED_PAINT_MS) : win.requestAnimationFrame(paint);
  }
  function cancelPaint() {
    if (paintId === null) return;
    if (reduced) win.clearTimeout(paintId);
    else win.cancelAnimationFrame(paintId);
    paintId = null;
  }

  function paint() {
    paintId = null;
    if (destroyed) return;
    const now = clock();
    state = pruneGuides(state, now);
    const layout = selectLayout(state);
    if (layout.s > 0) {
      writeBox(layout);
      const cursors = placeCursors(selectCursors(state), {
        scrollY: state.scroll.y, s: layout.s, ox: layout.ox, oy: layout.oy,
        stageW: layout.stageW, stageH: layout.stageH, frameW: layout.frameW,
      });
      overlay.paint({ cursors, marks: selectMarks(state, now), layout, scroll: state.scroll, hidden });
    }
    const model = selectHud(state);
    hud.paint(model, { hidden });
    if (panel.isOpen()) panel.paint(selectAgentRows(state));
    onPlan?.(selectPlanRows(state));
    stateEl.className = model.wordClass ? `dz-state ${model.wordClass}` : 'dz-state';
    if (stateWord.data !== model.word) stateWord.data = model.word;
    stateEl.hidden = !model.word;
    for (const [name, b] of segButtons) {
      const on = name === state.view.viewport;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    empty.hidden = !(opened && !state.buildId && !(version > 0));
  }

  function measure() {
    dispatch(reduceUser, { type: 'resize', stageW: wrap.clientWidth, stageH: wrap.clientHeight });
  }
  const Observer = typeof win.ResizeObserver === 'function' ? win.ResizeObserver : null;
  const ro = Observer ? new Observer(() => measure()) : null;
  if (ro) ro.observe(wrap);
  else win.addEventListener('resize', measure);

  // L4.21: a ctrl or meta wheel over the well zooms about the pointer; a plain one is the page's.
  function onWheel(e) {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    dispatch(reduceUser, { type: 'zoom', dy: e.deltaY, stageY: e.clientY - wrap.getBoundingClientRect().top });
  }
  wrap.addEventListener('wheel', onWheel, { passive: false });

  // Esc from anywhere in the well closes the Agents popover, also once the person moved the focus out of it (back to a
  // HUD dot, say). The HUD's Stop question and the popover itself take their Esc first.
  function onWellKey(e) {
    if (e.key !== 'Escape' || !panel.isOpen()) return;
    e.stopPropagation();
    panel.close();
  }
  wrap.addEventListener('keydown', onWellKey);

  function showAgent(agentId) {
    if (destroyed) return;
    hud.closeConfirm();
    panel.paint(selectAgentRows(state));
    panel.open(agentId);
  }
  function setViewport(name) { dispatch(reduceUser, { type: 'viewport', name }); }
  function follow() { dispatch(reduceUser, { type: 'follow' }); }

  /** C-8 `continue` with only the fields given; a refusal rejects with the server's `error` and shows in the HUD. */
  async function resume({ sections } = {}) {
    if (!state.buildId) throw new Error('There is no round to resume');
    await post(`${base}/builds/${enc(state.buildId)}/continue`, sections === undefined ? {} : { sections });
  }

  return {
    /** The detail's frames, and nothing else: the model's own effects load the doc and subscribe. */
    async open(detail) {
      if (destroyed) return;
      opened = true;
      const v = detail?.design?.version;
      if (Number.isFinite(v)) version = v;
      measure();
      for (const f of detailToFrames(detail, wallNow())) dispatch(reduceFrame, f);
      if (!isObject(detail?.build) && version > 0) loadDoc('run');
      schedulePaint();
    },
    pushFrame(f) { dispatch(reduceFrame, f); },
    // The socket said hello again: a rebooted server minted new tokens, so the frame reloads fresh; an open build asks
    // for a snapshot.
    onHello({ rebooted = false } = {}) {
      if (destroyed) return;
      const mode = frame.pendingMode() ?? frame.mode();
      if (rebooted && mode) loadDoc(mode, { fresh: true });
      dispatch(reduceUser, { type: 'rejoin' });
    },
    setPick(on) {
      if (on) chrome?.pause();
      dispatch(reduceUser, { type: 'pick', on: Boolean(on) });
    },
    loadRunDoc() { loadDoc('run'); },
    unpin(id, path) { dispatch(reduceUser, { type: 'unpin', id, path }); },
    resume,
    setViewport,
    follow,
    showAgent,
    exportSlot,
    model: () => state,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelPaint();
      cancelSettle();
      wrap.removeEventListener('wheel', onWheel, { passive: false });
      wrap.removeEventListener('keydown', onWellKey);
      if (ro) ro.disconnect();
      else win.removeEventListener('resize', measure);
      frame.destroy();
      chrome?.destroy();
      reveal.destroy();
      overlay.destroy();
      hud.destroy();
      panel.destroy();
      tip.destroy();
      head.remove();
      wrap.remove();
    },
  };
}

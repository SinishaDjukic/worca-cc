// ui/public/design/library.mjs — the Design Library on `#design` (P6, mockup board 1, canvas build.mjs:307-330): the
// designs as a grid of tiles, a picture or the kind's icon, the name, and one meta line. The Library is just the items
// (BRIEF): no stacked cards, no empty-state prose. Loading and failure follow docs/design-system.md › Empty, loading,
// error: nothing for 300 ms, then one line; `Could not load designs` in red with `Nothing changed.` and Try again.
// Above the grid sits the start composer (canvas build.mjs:308-323): the brief, its files, a project, Build fast and the
// kind. Send creates the design, keeps the message for its chat (takeStart) and opens it; the title is the brief's first
// line, never a model's (L6.13). Also the studio chat head's More (L6.16): Rename and Delete. Every string reaches the
// DOM through `textContent`. Nothing runs at load time: the window's timers are reached only through `win`.

import { createFlyout } from '../side-flyout.mjs';
import { icon } from '../icons.mjs';
import { makeSwitch } from '../switch.mjs';
import { ATTACH_ACCEPT, bytesToBase64, carriesFiles, checkAttachment, createPasteNamer, pastedFiles } from '../attach-files.mjs';
import { DESIGN_FAST_LABEL, DESIGN_KIND_LABELS } from '../../../src/shared/design-names.mjs';
import { openEngineGateDialog } from './engine-gate-dialog.mjs';
import { createModelPills } from './model-pills.mjs';

const LOADING_DELAY_MS = 300;
const REFETCH_MS = 200;
const LIST_URL = '/api/design';
/** The server's Build fast caps (P8, M6): `{fast, calm}`. */
const LIMITS_URL = '/api/design/limits';
const DAY_MS = 86_400_000;
const TITLE_MAX = 60;
/** What a Delete loses, said on every Delete confirm (a re-opened one too). */
const DELETE_LOSS = 'Its files and chat go. What it cost stays in Statistics.';
const KINDS = Object.freeze(['web', 'presentation', 'pitch', 'video']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A tile's state word for a design that is not finished; any other status shows its time. */
const STATE_WORDS = Object.freeze({
  planning: 'Building', building: 'Building', integrating: 'Building', paused: 'Paused',
  stopped: 'Stopped', error: 'Failed', interrupted: 'Interrupted',
});
/** The store's OPEN_BUILD_STATUSES (store.mjs): a delete is refused under one, and its frame moves the tile in place. */
const OPEN_BUILD = Object.freeze(['planning', 'building', 'integrating', 'paused']);
/** A design-build frame that ends a round: the list comes again (cost, time, picture). */
const ROUND_ENDS = Object.freeze(['done', 'stopped', 'error', 'interrupted']);
/** The codes of POST /api/design's 409 that open the engine gate's dialog; any other 409 is the line under the box. */
const GATE_CODES = Object.freeze(['engine-gated', 'engine-refused']);

// The four kind icons (canvas build.mjs:346-349), drawn with the mockup's 1.75 stroke: a tile with no picture, and
// the start composer's kind chips.
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
const KIND_ICONS = Object.freeze({
  web: `${SVG_OPEN}<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/></svg>`,
  presentation: `${SVG_OPEN}<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M9 20h6M12 16v4"/></svg>`,
  pitch: `${SVG_OPEN}<path d="M4 20h16M7 16v-4M12 16V7M17 16v-6"/></svg>`,
  video: `${SVG_OPEN}<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M10.5 9.5v5l4-2.5z"/></svg>`,
});
// The composer's project button, as the mockup draws it (canvas build.mjs:112): a 13px folder and a 12px chevron.
const SCOPE_FOLDER = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18z"/></svg>';
const SCOPE_CHEVRON = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

/** The composer's first messages by the design each created, until that design's chat takes its own (takeStart). */
const starts = new Map();

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const errorOf = (body, fallback) => (isObject(body) && typeof body.error === 'string' && body.error ? body.error : fallback);
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** A design kind as people read it: the tile's meta and the studio's kind chip. @param {unknown} kind @returns {string} */
export function kindWord(kind) {
  return typeof kind === 'string' && Object.hasOwn(DESIGN_KIND_LABELS, kind) ? DESIGN_KIND_LABELS[kind] : 'Design';
}

/**
 * A new design's name from its brief, never from a model (L6.13, SPEC L30): the first line, cut at the end of its first
 * sentence; past 60 characters cut at the last space at or before the 60th, else at 60; no trailing `,;:` or space.
 * @param {unknown} text
 * @returns {string}
 */
export function titleFromBrief(text) {
  const line = String(text ?? '').trim().split(/\r?\n/, 1)[0];
  const end = line.search(/[.!?](\s|$)/);
  let title = end >= 0 ? line.slice(0, end) : line;
  if (title.length > TITLE_MAX) {
    const space = title.lastIndexOf(' ', TITLE_MAX);
    title = space > 0 ? title.slice(0, space) : title.slice(0, TITLE_MAX);
  }
  return title.replace(/[\s,;:]+$/, '');
}

/**
 * The composer's message for the design it just created, once: the studio hands it to the chat as `initial`, and a
 * second call (another open of the same design) gets null.
 * @param {string} designId
 * @returns {{text: string, files: object[]}|null}
 */
export function takeStart(designId) {
  const start = starts.get(designId);
  if (!start) return null;
  starts.delete(designId);
  return start;
}

/**
 * When a design last changed, as the mockup's tiles read it, by local calendar days: `Just now`, `12m ago`, `2h ago`
 * (the same day), `Yesterday`, a weekday for 2 to 5 days back, then `Oct 30`, and `Oct 30, 2025` in another year.
 * A time that is not one reads `''`.
 * @param {unknown} iso
 * @param {number} [now]
 * @returns {string}
 */
export function tileTime(iso, now = Date.now()) {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return '';
  const ago = now - t;
  if (ago < 60_000) return 'Just now';
  if (ago < 3_600_000) return `${Math.floor(ago / 60_000)}m ago`;
  const then = new Date(t);
  const today = new Date(now);
  // Rounded, so a day that a clock change made 23 or 25 hours long still counts as one.
  const days = Math.round((midnight(today) - midnight(then)) / DAY_MS);
  if (days <= 0) return `${Math.floor(ago / 3_600_000)}h ago`;
  if (days === 1) return 'Yesterday';
  if (days <= 5) return WEEKDAYS[then.getDay()];
  const day = `${MONTHS[then.getMonth()]} ${then.getDate()}`;
  return then.getFullYear() === today.getFullYear() ? day : `${day}, ${then.getFullYear()}`;
}

/**
 * A tile's meta line: the kind, then the state of an unfinished design or the time of a finished one, then the true
 * cost. Nothing spent shows no cost; an unknown cost reads `cost unknown`, never `$0`.
 * @param {object} row  a `GET /api/design` row
 * @param {number} [now]
 * @returns {string}
 */
export function tileMeta(row, now = Date.now()) {
  const r = isObject(row) ? row : {};
  const state = typeof r.status === 'string' && Object.hasOwn(STATE_WORDS, r.status) ? STATE_WORDS[r.status] : tileTime(r.updatedAt, now);
  let cost = '';
  if (r.costKnown === false) cost = 'cost unknown';
  else if (Number.isFinite(r.costUsd) && r.costUsd > 0) cost = `$${r.costUsd.toFixed(2)}`;
  return [kindWord(r.kind), state, cost].filter(Boolean).join(' · ');
}

/**
 * The Library, appended to `host`: `div.dz-lib > .dz-lib-in > .dz-hero + .dz-lib-body > h2.dz-lib-h + .dz-grid`, one
 * `a.dz-tile` per design, and the start composer in `.dz-hero` (createStart). `open()` loads the list (again) and resolves once it is painted. A tile click with no
 * modifier key opens its design through `navigate('#design/<id>')`. `pushFrame(f)` takes the C-5 frames: a thumbnail
 * or an open build's status changes its tile in place, and a round's end or a restore loads the list once more.
 * @param {{doc: Document, win: Window, host: HTMLElement, fetch: Function, navigate: (hash: string) => void,
 *   now?: () => number}} deps
 * @returns {{open: () => Promise<void>, pushFrame: (f: object) => void, destroy: () => void}}
 */
export function createLibrary({ doc, win, host, fetch: fetchFn, navigate, now = () => Date.now() }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // `.dz-hero` holds the start composer; the body stays hidden until a list with designs in it comes.
  const el = make('div', 'dz-lib');
  const inner = make('div', 'dz-lib-in');
  const hero = make('div', 'dz-hero');
  const body = make('div', 'dz-lib-body');
  const grid = make('div', 'dz-grid');
  body.append(make('h2', 'dz-lib-h', 'Designs'), grid);
  body.hidden = true;
  inner.append(hero, body);
  el.append(inner);
  host.append(el);
  const start = createStart({ doc, win, hero, fetch: fetchFn, navigate });

  let destroyed = false;
  let seq = 0;
  let loadingTimer = null;
  let refetchTimer = null;
  let loadLine = null;     // p.dz-lib-load, while a load is out past 300 ms
  let errLine = null;      // p.dz-lib-err, after a failed load until the next answer
  let rows = [];           // the designs the grid shows; a frame changes them in place
  let painted = null;      // JSON of `rows`: an answer that equals it paints nothing
  const tiles = new Map(); // design id -> { row, thumb, meta }

  function noPicture(kind) {
    const none = make('span', 'dz-thumb-none');
    none.innerHTML = Object.hasOwn(KIND_ICONS, kind) ? KIND_ICONS[kind] : KIND_ICONS.web;
    return none;
  }

  /** The tile's picture, or the kind's icon when there is none or it does not load. */
  function paintThumb(span, row) {
    if (typeof row.thumb !== 'string' || !row.thumb) {
      span.replaceChildren(noPicture(row.kind));
      return;
    }
    const img = make('img');
    img.setAttribute('alt', '');
    img.setAttribute('loading', 'lazy');
    img.addEventListener('error', () => {
      if (img.parentNode === span) span.replaceChildren(noPicture(row.kind));
    });
    img.setAttribute('src', row.thumb);
    span.replaceChildren(img);
  }

  function tileFor(row) {
    const href = `#design/${encodeURIComponent(row.id)}`;
    const tile = make('a', 'dz-tile');
    tile.setAttribute('href', href);
    const thumb = make('span', 'dz-thumb');
    const meta = make('span', 'dz-tile-m', tileMeta(row, now()));
    tile.append(thumb, make('span', 'dz-tile-t', typeof row.title === 'string' && row.title ? row.title : 'Untitled design'), meta);
    paintThumb(thumb, row);
    tile.addEventListener('click', (e) => {
      // A modifier or another button keeps the browser's own behaviour (a new tab, a new window).
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate?.(href);
    });
    tiles.set(row.id, { row, thumb, meta });
    return tile;
  }

  function paintList(list) {
    const next = list.filter((d) => isObject(d) && typeof d.id === 'string' && d.id);
    const json = JSON.stringify(next);
    if (json === painted) return;
    rows = next;
    painted = json;
    tiles.clear();
    grid.replaceChildren(...rows.map(tileFor));
    body.hidden = rows.length === 0;
  }

  /** A frame's change to one tile, in place; the list's JSON follows, so an answer equal to it paints nothing. */
  function patchRow(designId, patch) {
    const t = tiles.get(designId);
    if (!t) return;
    Object.assign(t.row, patch);
    painted = JSON.stringify(rows);
    if ('status' in patch) t.meta.textContent = tileMeta(t.row, now());
    if ('thumb' in patch) paintThumb(t.thumb, t.row);
  }

  function showFailure() {
    const retry = make('button', 'btn btn-sm', 'Try again');
    retry.type = 'button';
    retry.addEventListener('click', () => { void load(); });
    const acts = make('span', 'el-acts');
    acts.append(retry);
    const line = make('p', 'empty-line is-err dz-lib-err');
    line.setAttribute('role', 'alert');
    line.append(make('span', 'el-t', 'Could not load designs'), make('span', null, 'Nothing changed.'), acts);
    errLine?.remove();
    errLine = line;
    inner.append(line);
  }

  function showLoading() {
    loadingTimer = null;
    errLine?.remove();
    errLine = null;
    loadLine = make('p', 'empty-line dz-lib-load', 'Loading designs…');
    loadLine.setAttribute('aria-busy', 'true');
    inner.append(loadLine);
  }

  function endLoading() {
    if (loadingTimer !== null) win.clearTimeout(loadingTimer);
    loadingTimer = null;
    loadLine?.remove();
    loadLine = null;
  }

  async function load() {
    if (destroyed) return;
    const my = ++seq;
    // One line for every load that is out: a newer load keeps the line or the timer an older one started.
    if (!loadLine && loadingTimer === null) loadingTimer = win.setTimeout(showLoading, LOADING_DELAY_MS);
    let list = null;
    try {
      const res = await fetchFn(LIST_URL);
      list = res.ok ? await res.json() : null;
    } catch {
      list = null;
    }
    if (destroyed || my !== seq) return;
    endLoading();
    if (Array.isArray(list)) {
      errLine?.remove();
      errLine = null;
      paintList(list);
    } else {
      showFailure();
    }
  }

  /** One load for any number of round ends and restores within 200 ms. */
  function refetchSoon() {
    if (refetchTimer !== null) return;
    refetchTimer = win.setTimeout(() => {
      refetchTimer = null;
      void load();
    }, REFETCH_MS);
  }

  return {
    open: () => load(),
    pushFrame(f) {
      if (destroyed || !isObject(f)) return;
      if (f.type === 'design-build') {
        if (OPEN_BUILD.includes(f.status)) patchRow(f.designId, { status: f.status });
        else if (ROUND_ENDS.includes(f.status)) refetchSoon();
      } else if (f.type === 'design-thumb') {
        if (typeof f.thumb === 'string' || f.thumb === null) patchRow(f.designId, { thumb: f.thumb });
      } else if (f.type === 'design-restored') {
        refetchSoon();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      start.destroy();
      endLoading();
      if (refetchTimer !== null) win.clearTimeout(refetchTimer);
      refetchTimer = null;
      tiles.clear();
      el.remove();
    },
  };
}

let menuSeq = 0;   // ids for the More and project menus on one page

/**
 * The start composer in `hero` (canvas build.mjs:308-323): `h1.chat-home-title`, then `.ask-composer >
 * .ask-composer-box` holding the file chips, `textarea.dz-input` and the row (Attach, the project, Build fast, Send),
 * the refusal line under the box, then the kind chips. Send waits for files still being read, POSTs
 * `{kind, fast, title}` (plus `projectKey` when one is picked) and on its 201 keeps `{text, files}` for takeStart,
 * resets all but the kind and opens `#design/<id>`. A refusal shows the server's words and keeps everything. The
 * engine gate's 409 (`engine-gated`, `engine-refused`) opens its dialog instead (engine-gate-dialog.mjs), Send busy
 * until it closes: Allow unguarded re-posts the body with `{allowUnguarded: true, engine}` naming the 409's engine,
 * Use Claude with `{engine: 'claude'}`; a refusal of that second post is the line under the box.
 * @param {{doc: Document, win: Window, hero: HTMLElement, fetch: Function, navigate?: (hash: string) => void}} deps
 * @returns {{destroy: () => void}}
 */
function createStart({ doc, win, hero, fetch: fetchFn, navigate }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const iconBtn = (cls, label, name) => {
    const b = make('button', cls);
    b.type = 'button';
    b.title = label;
    b.setAttribute('aria-label', label);
    b.append(icon(doc, name, 16));
    return b;
  };

  const heading = make('h1', 'chat-home-title', 'What should we design?');
  const fileRow = make('div', 'dz-start-files');
  fileRow.setAttribute('role', 'group');
  fileRow.setAttribute('aria-label', 'Attachments');
  fileRow.hidden = true;
  const input = make('textarea', 'dz-input');
  input.rows = 2;
  input.placeholder = 'A landing page, a deck, a pitch, a film';
  input.setAttribute('aria-label', 'What should we design?');
  const attachBtn = iconBtn('btn btn-quiet btn-icon', 'Attach files', 'plus');
  const fileInput = make('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.accept = ATTACH_ACCEPT;
  fileInput.hidden = true;
  // The project button, as the real scope button: the folder, the name, the chevron; its name says the pick.
  const scopeBtn = make('button', 'btn btn-sm btn-quiet ask-scope-btn');
  scopeBtn.type = 'button';
  scopeBtn.setAttribute('aria-haspopup', 'menu');
  scopeBtn.setAttribute('aria-expanded', 'false');
  const scopeLabel = make('span', 'ask-scope-label');
  scopeBtn.insertAdjacentHTML('beforeend', SCOPE_FOLDER);
  scopeBtn.append(scopeLabel);
  scopeBtn.insertAdjacentHTML('beforeend', SCOPE_CHEVRON);
  const menu = make('div', 'menu dz-start-menu');
  menu.id = `dz-start-menu-${++menuSeq}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Project');
  menu.hidden = true;
  scopeBtn.setAttribute('aria-controls', menu.id);
  // Build fast as the dock's switch; its crew label (M6) shows only while it is on (L6.17). P8: the server's cap, once
  // it has answered (loadLimits); DESIGN_FAST_LABEL until then.
  const sw = makeSwitch(doc, { label: 'Build fast', rowClass: 'dz-fast', inputClass: 'dz-fast-input' });
  const capEl = make('span', 'dz-fast-cap dz-fast-n', DESIGN_FAST_LABEL);
  sw.row.append(capEl);
  const sendBtn = iconBtn('btn btn-primary btn-icon ask-send', 'Send', 'arrow-up');
  // The lead's and the builders' models, on the engine a design made now would build on (the project's or the user's
  // Default engine): a project pick may move it, so the choices load again.
  let project = null;          // {key, name} of the picked project, or none
  const pills = createModelPills({ doc, win, fetch: fetchFn, mode: 'down',
    url: () => `${LIST_URL}/models${project ? `?projectKey=${encodeURIComponent(project.key)}` : ''}` });
  const row = make('div', 'ask-composer-row');
  row.append(attachBtn, fileInput, scopeBtn, menu, pills.el, make('span', 'dz-spacer'), sw.row, sendBtn);
  const box = make('div', 'ask-composer-box');
  box.append(fileRow, input, row);
  const errEl = make('p', 'dz-start-err');
  errEl.setAttribute('role', 'alert');
  errEl.hidden = true;
  const composer = make('div', 'ask-composer');
  composer.append(box, errEl);
  const kinds = make('div', 'dz-kinds');
  kinds.setAttribute('role', 'group');
  kinds.setAttribute('aria-label', 'Kind');
  const kindBtns = KINDS.map((k) => {
    const b = make('button', 'dz-kind-btn');
    b.type = 'button';
    b.dataset.kind = k;
    b.innerHTML = KIND_ICONS[k];
    b.append(DESIGN_KIND_LABELS[k]);
    return b;
  });
  kinds.append(...kindBtns);
  hero.append(heading, composer, kinds);

  let destroyed = false;
  let kind = KINDS[0];
  let fast = false;
  let projects = [];           // the projects there, from the last load; null when it failed
  let projectSeq = 0;
  let busy = false;            // the create is on its way (and the files it waits for, and the engine gate's dialog)
  let gate = null;             // the engine gate's dialog while it is open
  let pendingFiles = [];       // {name, bytes, dataBase64, attKind, mime}, as the dock's
  let adding = Promise.resolve();

  const setErr = (text) => {
    errEl.textContent = text || '';
    errEl.hidden = !text;
  };
  const paintSend = () => { sendBtn.disabled = busy || !input.value.trim(); };
  function paintKinds() {
    for (const b of kindBtns) {
      const on = b.dataset.kind === kind;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  function paintFast() {
    sw.input.checked = fast;
    capEl.hidden = !fast;
  }
  function paintScope() {
    scopeLabel.textContent = project ? project.name : 'No project';
    scopeBtn.setAttribute('aria-label', project ? `Project: ${project.name}` : 'Project: none');
  }

  // ── the project menu: No project, then each project there, loaded at every open ─────────────────────────────────
  const fly = createFlyout({ doc, win, trigger: scopeBtn, menu, mode: 'down', onOpen: () => { void loadProjects(); } });
  // The flyout closes by itself only for [data-nav] items: a pick closes it first.
  const closeFrom = (e) => fly.close(e.detail === 0 ? {} : { blur: true });
  function radio(label, on, onPick) {
    const b = make('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(on));
    const slot = make('span', 'ask-scope-check');
    slot.setAttribute('aria-hidden', 'true');
    if (on) {
      const check = make('span', 'ask-model-check');
      check.append(icon(doc, 'check', 12));
      slot.append(check);
    }
    b.append(make('span', null, label), slot);
    b.addEventListener('click', (e) => {
      closeFrom(e);
      onPick();
    });
    return b;
  }
  function paintMenu() {
    const rows = [radio('No project', !project, () => pick(null))];
    if (projects === null) {
      const failed = make('button', 'menu-item');
      failed.type = 'button';
      failed.setAttribute('role', 'menuitem');
      failed.disabled = true;
      failed.append(make('span', null, 'Could not load projects'));
      rows.push(failed);
    } else {
      for (const p of projects) rows.push(radio(p.name, project?.key === p.key, () => pick(p)));
    }
    menu.replaceChildren(...rows);
  }
  function pick(p) {
    const moved = (project?.key ?? null) !== (p?.key ?? null);
    project = p;
    paintScope();
    paintMenu();
    if (moved) void pills.load();
  }
  async function loadProjects() {
    const my = ++projectSeq;
    let list = null;
    try {
      const res = await fetchFn('/api/projects');
      const body = res.ok ? await res.json() : null;
      list = isObject(body) && Array.isArray(body.projects)
        ? body.projects.filter((p) => isObject(p) && p.exists && typeof p.key === 'string' && p.key)
          .map((p) => ({ key: p.key, name: typeof p.name === 'string' && p.name ? p.name : p.key }))
        : null;
    } catch {
      list = null;
    }
    if (destroyed || my !== projectSeq) return;
    projects = list;
    // The rows are new: a keyboard that was in the menu lands on the pick again, never on <body>.
    const hadFocus = menu.contains(doc.activeElement);
    paintMenu();
    if (!fly.isOpen()) return;
    fly.reposition();
    if (hadFocus) (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.menu-item'))?.focus();
  }

  // ── files: the picker, a paste and a drop, through Ask's checks (attach-files.mjs), as the dock's ───────────────
  const namePasted = createPasteNamer((parts, name, opts) => new win.File(parts, name, opts));
  function renderFiles() {
    fileRow.replaceChildren(...pendingFiles.map((f) => {
      const chip = make('span', 'dz-start-file');
      chip.title = f.name;
      const x = make('button', 'dz-start-file-x');
      x.type = 'button';
      x.setAttribute('aria-label', `Remove ${f.name}`);
      x.append(icon(doc, 'x', 12));
      x.addEventListener('click', () => removeFile(f));
      chip.append(make('span', null, f.name), x);
      return chip;
    }));
    fileRow.hidden = !pendingFiles.length;
  }
  /** The × leaves the DOM with its chip: the keyboard moves to the × now in its place, else the one before, else the brief. */
  function removeFile(f) {
    const at = pendingFiles.indexOf(f);
    pendingFiles = pendingFiles.filter((p) => p !== f);
    renderFiles();
    const xs = [...fileRow.querySelectorAll('.dz-start-file-x')];
    (xs[Math.min(at, xs.length - 1)] || input).focus({ preventScroll: true });
  }
  /** One batch at a time: a batch reads its files before the next one checks the caps. */
  function addFiles(list) {
    const batch = [...(list || [])];
    if (!batch.length) return adding;
    adding = adding.then(() => addBatch(batch)).catch(() => {});
    return adding;
  }
  async function addBatch(batch) {
    setErr('');
    for (const f of batch) {
      const v = checkAttachment(f, { pending: pendingFiles });
      if (!v.ok) { setErr(v.error); continue; }
      let dataBase64 = '';
      try { dataBase64 = bytesToBase64(new Uint8Array(await f.arrayBuffer()), (str) => win.btoa(str)); }
      catch { setErr(`could not read ${v.name}`); continue; }
      if (destroyed) return;
      pendingFiles = [...pendingFiles.filter((p) => p.name !== v.name), { name: v.name, bytes: f.size, dataBase64, attKind: v.attKind, mime: v.mime }];
    }
    if (!destroyed) renderFiles();
  }

  // ── send ───────────────────────────────────────────────────────────────────────────────────────────────────────
  async function send() {
    const text = input.value.trim();
    if (destroyed || !text || busy) return;
    busy = true;
    paintSend();
    setErr('');
    await adding;                                       // a file still being read rides this message
    if (destroyed) return;
    const files = pendingFiles.slice();
    // `fast` is always a boolean: the store answers 400 on anything else.
    const models = pills.picks();
    const body = { kind, fast, title: titleFromBrief(text), ...(project ? { projectKey: project.key } : {}),
      ...(Object.keys(models).length ? { models } : {}) };
    await create(body, { text, files }, true);
  }
  /** One POST /api/design: `{ok, status, answer}`; a request that never got an answer is status 0. */
  async function post(body) {
    try {
      const res = await fetchFn(LIST_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      let answer = null;
      try { answer = await res.json(); } catch { answer = null; }
      return { ok: res.ok, status: res.status, answer };
    } catch {
      return { ok: false, status: 0, answer: null };
    }
  }
  /**
   * Post `body` and settle Send: a 201 hands `start` over and opens the design; the engine gate's 409 opens its dialog
   * (only when `mayAsk`: the first post), and Send stays busy until the dialog closes; anything else is the line under
   * the box, with everything kept.
   */
  async function create(body, start, mayAsk) {
    const { ok, status, answer } = await post(body);
    if (destroyed) return;
    if (mayAsk && status === 409 && isObject(answer) && GATE_CODES.includes(answer.code) && typeof answer.engine === 'string' && answer.engine) {
      askGate(body, start, answer);
      return;
    }
    busy = false;
    const id = ok && isObject(answer) && isObject(answer.design) && typeof answer.design.id === 'string' && answer.design.id ? answer.design.id : null;
    if (!id) {
      setErr(errorOf(answer, 'Could not create the design. Nothing changed.'));
      paintSend();
      return;
    }
    opened(id, start);
  }
  /** The gate's dialog. Its consent binds to the engine the 409 named (L8.25), never one re-read from Settings. */
  function askGate(body, start, answer) {
    const again = (extra) => {
      gate = null;
      const next = { ...body, ...extra };
      // Use Claude moves the design to another engine: picks made for the first one do not run there.
      if (extra.engine && extra.engine !== pills.engine()) delete next.models;
      void create(next, start, false);
    };
    gate = openEngineGateDialog({
      doc,
      label: typeof answer.label === 'string' && answer.label ? answer.label : answer.engine,
      overridable: answer.overridable === true,
      reasons: Array.isArray(answer.reasons) && answer.reasons.length ? answer.reasons : [errorOf(answer, '')],
      notes: answer.notes,
      onAllow: () => again({ allowUnguarded: true, engine: answer.engine }),
      ...(answer.engine !== 'claude' ? { onClaude: () => again({ engine: 'claude' }) } : {}),
      onCancel: () => {
        gate = null;
        busy = false;
        paintSend();
      },
    });
  }
  /** A design was made: keep the message for its chat (takeStart), reset all but the kind, and open it. */
  function opened(id, { text, files }) {
    starts.set(id, { text, files });
    input.value = '';
    pendingFiles = [];
    renderFiles();
    fast = false;
    paintFast();
    const hadProject = project !== null;
    project = null;
    paintScope();
    pills.reset();
    if (hadProject) void pills.load();
    paintSend();
    navigate?.(`#design/${encodeURIComponent(id)}`);
  }

  for (const b of kindBtns) {
    b.addEventListener('click', () => {
      kind = b.dataset.kind;
      paintKinds();
    });
  }
  sw.input.addEventListener('change', () => {
    fast = sw.input.checked;
    paintFast();
  });
  input.addEventListener('input', paintSend);
  input.addEventListener('keydown', (ev) => {
    // An IME's Enter picks a candidate (Safari can send it with isComposing false and keyCode 229).
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229) {
      ev.preventDefault();
      void send();
    }
  });
  sendBtn.addEventListener('click', () => { void send(); });
  attachBtn.addEventListener('click', () => { fileInput.click(); });
  fileInput.addEventListener('change', () => { void addFiles(fileInput.files); fileInput.value = ''; });
  box.addEventListener('paste', (ev) => {
    const list = pastedFiles(ev.clipboardData);
    if (!list) return;                                  // a text paste goes ahead natively
    ev.preventDefault();
    void addFiles(namePasted(list));
  });
  // Only drags carrying files are taken: a text drag into the brief keeps its default.
  const takeDrag = (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    try { ev.dataTransfer.dropEffect = 'copy'; } catch { /* read-only in some engines */ }
  };
  box.addEventListener('dragenter', takeDrag);
  box.addEventListener('dragover', takeDrag);
  box.addEventListener('drop', (ev) => {
    if (!carriesFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    input.focus({ preventScroll: true });
    void addFiles(ev.dataTransfer.files);
  });

  /** P8 (M6): the crew Build fast allows on this server, asked once per Library. An answer without whole `fast` and
   *  `calm` numbers, or none, leaves DESIGN_FAST_LABEL. */
  async function loadLimits() {
    let body = null;
    try {
      const res = await fetchFn(LIMITS_URL);
      body = res.ok ? await res.json() : null;
    } catch {
      body = null;
    }
    if (destroyed || !isObject(body) || !Number.isInteger(body.fast) || !Number.isInteger(body.calm)) return;
    capEl.textContent = `up to ${body.fast}`;
  }

  paintKinds();
  paintFast();
  paintScope();
  paintMenu();
  paintSend();
  void loadLimits();
  void pills.load();
  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      gate?.close();                                    // else it stays on document.body after the Library goes
      gate = null;
      fly.destroy();
      menu.remove();
      pills.destroy();
    },
  };
}

/**
 * The studio chat head's More (L6.16): Rename and Delete, in a menu under `button`. Rename asks for the name in the
 * page's prompt, then PATCHes it and hands the row to `onRenamed(row)`. Delete asks in the page's confirm, then
 * DELETEs and goes to `navigate('#design')`. A refusal re-opens the same dialog with the server's text in red. Delete
 * is off while `buildLive()` (the store refuses it under an open build, L6.18), and a click on it then does nothing.
 * @param {{doc: Document, win: Window, button: HTMLButtonElement, getDesign: () => {id: string, title?: string},
 *   fetch: Function, confirm?: (o: object) => Promise<boolean>, prompt?: (o: object) => Promise<object|null>,
 *   navigate?: (hash: string) => void, buildLive?: () => boolean, onRenamed?: (row: object) => void}} deps
 * @returns {{destroy: () => void}}
 */
export function designMoreMenu({ doc, win, button, getDesign, fetch: fetchFn, confirm, prompt, navigate, buildLive, onRenamed }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const item = (label) => {
    const b = make('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(make('span', null, label));
    return b;
  };

  const menu = make('div', 'menu dz-more');
  menu.id = `dz-more-${++menuSeq}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'More');
  menu.hidden = true;
  const renameItem = item('Rename');
  const deleteItem = item('Delete');
  menu.append(renameItem, deleteItem);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', menu.id);
  if (button.parentNode) button.after(menu);
  else doc.body.append(menu);

  let destroyed = false;

  /** Delete follows the build each time the menu opens or the item is pressed; returns true while it is off. */
  const deleteOff = () => {
    const off = !!buildLive?.();
    if (off) {
      deleteItem.setAttribute('aria-disabled', 'true');
      deleteItem.title = 'A build is running';
      deleteItem.classList.remove('is-danger');
    } else {
      deleteItem.removeAttribute('aria-disabled');
      deleteItem.removeAttribute('title');
      deleteItem.classList.add('is-danger');
    }
    return off;
  };
  deleteOff();
  const fly = createFlyout({ doc, win, trigger: button, menu, mode: 'down', onOpen: deleteOff });

  async function send(url, init) {
    try {
      const res = await fetchFn(url, init);
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { ok: res.ok, body };
    } catch {
      return { ok: false, body: null };
    }
  }

  const designUrl = (d) => `/api/design/${encodeURIComponent(d.id)}`;
  const current = () => {
    const d = getDesign?.();
    return isObject(d) && typeof d.id === 'string' && d.id ? d : null;
  };

  async function rename() {
    const d = current();
    if (!d) return;
    let value = typeof d.title === 'string' ? d.title : '';
    let refusal = null;
    for (;;) {
      let got = null;
      try {
        got = await prompt?.({
          title: 'Rename design',
          ...(refusal ? { message: refusal, messageTone: 'err' } : {}),
          fields: [{ id: 'title', label: 'Name', value, required: true }],
          confirmLabel: 'Rename',
        });
      } catch {
        got = null;
      }
      const title = isObject(got) && typeof got.title === 'string' ? got.title.trim() : '';
      if (!title || destroyed) return;
      const res = await send(designUrl(d), { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
      if (destroyed) return;
      if (res.ok) {
        if (isObject(res.body)) onRenamed?.(res.body);
        return;
      }
      value = title;
      refusal = errorOf(res.body, 'Could not rename the design. Nothing changed.');
    }
  }

  async function remove() {
    const d = current();
    if (!d) return;
    let refusal = null;
    for (;;) {
      let yes = false;
      try {
        yes = (await confirm?.({
          title: 'Delete this design?',
          // A re-opened confirm still says what is lost: the refusal first, then the loss line.
          message: refusal === null ? DELETE_LOSS : `${/[.!?]$/.test(refusal) ? refusal : `${refusal}.`} ${DELETE_LOSS}`,
          ...(refusal ? { messageTone: 'err' } : {}),
          confirmLabel: 'Delete',
          danger: true,
        })) === true;
      } catch {
        yes = false;
      }
      if (!yes || destroyed) return;
      const res = await send(designUrl(d), { method: 'DELETE' });
      if (destroyed) return;
      if (res.ok) {
        navigate?.('#design');
        return;
      }
      refusal = errorOf(res.body, 'Could not delete the design. Nothing changed.');
    }
  }

  // The flyout closes by itself only for [data-nav] items: each handler closes it first.
  const closeFrom = (e) => fly.close(e.detail === 0 ? {} : { blur: true });
  renameItem.addEventListener('click', (e) => {
    closeFrom(e);
    void rename();
  });
  deleteItem.addEventListener('click', (e) => {
    if (deleteOff()) return;
    closeFrom(e);
    void remove();
  });

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      fly.destroy();
      menu.remove();
    },
  };
}

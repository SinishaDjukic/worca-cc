// ui/public/design/library.mjs — what the design start (studio.mjs createDesignStartPage) and its tiles
// (designs-grid.mjs) share: the row of kind buttons and their icons, a tile's words (tileTime, tileMeta, kindWord), and
// makeDesign, which makes a new design (the engine gate's dialog included) and keeps its first message for its chat
// (keepStart, takeStart); a design's title is the brief's first line, never a model's (L6.13). Also the studio chat
// head's More (L6.16): Rename and Delete. Every string reaches the DOM through `textContent`. Nothing runs at load time.

import { createFlyout } from '../side-flyout.mjs';
import { DESIGN_KIND_LABELS, titleFromBrief } from '../../../src/shared/design-names.mjs';

export { titleFromBrief };
import { openEngineGateDialog } from './engine-gate-dialog.mjs';

const LIST_URL = '/api/design';
const DAY_MS = 86_400_000;
/** What a Delete loses, said on every Delete confirm (a re-opened one too). */
const DELETE_LOSS = 'Its files go; its chat stays. What it cost stays in Statistics.';
const KINDS = Object.freeze(['web', 'presentation', 'pitch', 'video', 'document']);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A tile's state word for a design that is not finished; any other status shows its time. */
const STATE_WORDS = Object.freeze({
  planning: 'Building', building: 'Building', integrating: 'Building', paused: 'Paused',
  stopped: 'Stopped', error: 'Failed', interrupted: 'Interrupted',
});
/** The codes of POST /api/design's 409 that open the engine gate's dialog; any other 409 is the line under the box. */
const GATE_CODES = Object.freeze(['engine-gated', 'engine-refused']);

// The kind icons (canvas build.mjs:346-349, and a document's page with a folded corner and three lines), drawn with
// the mockup's 1.75 stroke: a tile with no picture, and the design start's kind buttons.
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
export const KIND_ICONS = Object.freeze({
  web: `${SVG_OPEN}<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9h17"/></svg>`,
  presentation: `${SVG_OPEN}<rect x="3.5" y="5" width="17" height="11" rx="2"/><path d="M9 20h6M12 16v4"/></svg>`,
  pitch: `${SVG_OPEN}<path d="M4 20h16M7 16v-4M12 16V7M17 16v-6"/></svg>`,
  video: `${SVG_OPEN}<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M10.5 9.5v5l4-2.5z"/></svg>`,
  document: `${SVG_OPEN}<path d="M6 3.5h8.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1-1.5z"/><path d="M14.5 3.5V8H19M8.5 12h7M8.5 15h7M8.5 18h4"/></svg>`,
});
/** The row of kind buttons (Web page, Presentation, Pitch deck, Video, Document) under the design start's composer.
 *  `onPick(kind)` on a click; `set(kind)` paints the pressed one. */
export function createKindRow(doc, { value = KINDS[0], onPick = () => {} } = {}) {
  const el = doc.createElement('div');
  el.className = 'dz-kinds';
  el.setAttribute('role', 'group');
  el.setAttribute('aria-label', 'Kind');
  const btns = KINDS.map((k) => {
    const b = doc.createElement('button');
    b.className = 'btn btn-lg dz-kind-btn';   // the Chat home's quick-action size (home-actions.mjs)
    b.type = 'button';
    b.dataset.kind = k;
    b.innerHTML = KIND_ICONS[k];
    b.append(DESIGN_KIND_LABELS[k]);
    b.addEventListener('click', () => { set(k); onPick(k); });
    return b;
  });
  el.append(...btns);
  function set(kind) {
    for (const b of btns) {
      const on = b.dataset.kind === kind;
      b.classList.toggle('is-on', on);
      b.classList.toggle('btn-primary', on);   // the pressed kind is the dark one
      b.setAttribute('aria-pressed', String(on));
    }
  }
  set(value);
  return { el, set, buttons: btns };
}

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

let menuSeq = 0;   // ids for the More menus on one page

/**
 * One new design: `POST /api/design` with `body`. The engine gate's 409 (`engine-gated`, `engine-refused`) opens its
 * dialog (engine-gate-dialog.mjs; `onGate` gets it, null once it closes): Allow unguarded posts again with
 * `{allowUnguarded: true, engine}` naming the 409's engine, Use Claude with `{engine: 'claude'}` (and without `models`
 * when that moves the design off `engine()`, the engine its picks were made for). The design start (studio.mjs
 * createDesignStartPage) makes its designs here.
 * @returns {Promise<{ok: true, id: string} | {ok: false, error: string, canceled?: true}>}
 */
export async function makeDesign({ doc, fetch: fetchFn, body, engine = () => null, onGate = () => {} }) {
  const post = async (b) => {
    try {
      const res = await fetchFn(LIST_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      let answer = null;
      try { answer = await res.json(); } catch { answer = null; }
      return { ok: res.ok, status: res.status, answer };
    } catch {
      return { ok: false, status: 0, answer: null };
    }
  };
  const settle = ({ ok, answer }) => {
    const id = ok && isObject(answer) && isObject(answer.design) && typeof answer.design.id === 'string' && answer.design.id ? answer.design.id : null;
    return id ? { ok: true, id } : { ok: false, error: errorOf(answer, 'Could not create the design. Nothing changed.') };
  };
  const first = await post(body);
  const { status, answer } = first;
  if (!(status === 409 && isObject(answer) && GATE_CODES.includes(answer.code) && typeof answer.engine === 'string' && answer.engine)) return settle(first);
  // The gate's dialog. Its consent binds to the engine the 409 named (L8.25), never one re-read from Settings.
  return new Promise((resolve) => {
    const again = async (extra) => {
      onGate(null);
      const next = { ...body, ...extra };
      if (extra.engine && extra.engine !== engine()) delete next.models;
      resolve(settle(await post(next)));
    };
    onGate(openEngineGateDialog({
      doc,
      label: typeof answer.label === 'string' && answer.label ? answer.label : answer.engine,
      overridable: answer.overridable === true,
      reasons: Array.isArray(answer.reasons) && answer.reasons.length ? answer.reasons : [errorOf(answer, '')],
      notes: answer.notes,
      onAllow: () => { void again({ allowUnguarded: true, engine: answer.engine }); },
      ...(answer.engine !== 'claude' ? { onClaude: () => { void again({ engine: 'claude' }); } } : {}),
      onCancel: () => { onGate(null); resolve({ ok: false, error: '', canceled: true }); },
    }));
  });
}

/** The models a new design could build with: on the engine of `projectKey`'s project, or the Default engine. */
export const startModelsUrl = (projectKey) => `${LIST_URL}/models${projectKey ? `?projectKey=${encodeURIComponent(projectKey)}` : ''}`;

/** The message a design was made with, for its chat (takeStart). */
export function keepStart(id, start) { starts.set(id, start); }

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
export function designMoreMenu({ doc, win, button, getDesign, fetch: fetchFn, confirm, prompt, navigate, buildLive, onRenamed, onDeleted = null, library = false }) {
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
  // `library`: a design chat's ⋯ also leads to every design (`#design`, the design start with all of them shown), first.
  const libraryItem = library ? item('All designs') : null;
  menu.append(...[libraryItem, renameItem, deleteItem].filter(Boolean));
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
        // In its chat: the chat stays, without the design (onDeleted); else `#design`, every design.
        if (typeof onDeleted === 'function') onDeleted(); else navigate?.('#design');
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
  libraryItem?.addEventListener('click', (e) => {
    closeFrom(e);
    navigate?.('#design');
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

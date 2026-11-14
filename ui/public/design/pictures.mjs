// ui/public/design/pictures.mjs — the log of the pictures a Design round asked for (SPEC §5, plan Part C): the
// `design-picture` frames and the rows of `GET /api/design/:id/pictures`, read alike. One ask is one entry: a
// finished ask (made or failed) is keyed by its row's id, so a row and its frame count once in either order; a
// picture in the making is keyed by build and name, and only its finished frame ends it (also one with no row id,
// which is then counted nowhere). A picture's address is built from a made ask's integer id alone: never its name or
// its file, and the route serves that row's kept copy, so an earlier round's tile keeps its own picture. Nothing runs
// at import time. The log is pure; the strip of tiles and the viewer (built like the engine gate's dialog, guarded as
// a viewer) touch only the document they are handed, and every string reaches the page as text.

import { IMAGE_SHAPES, pictureSeconds } from '../../../src/shared/image-services.mjs';
import { DESIGN_PICTURE_NAME_RE } from '../../../src/shared/design-names.mjs';
import { icon } from '../icons.mjs';
import { layoutDialog } from '../dialog-layout.mjs';
import { guardModal } from '../modal-guard.mjs';

/** The shapes a picture can take (the shared list itself, not a copy). */
export const PICTURE_SHAPES = IMAGE_SHAPES;

const STATES = new Set(['making', 'made', 'failed']);
const SEP = ' · ';

const isId = (v) => Number.isSafeInteger(v) && v >= 1;
const posInt = (v) => (Number.isSafeInteger(v) && v > 0 ? v : null);
const nonNeg = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const text = (v) => (typeof v === 'string' && v !== '' ? v : null);

/**
 * One picture, read whole or not at all: a frame or a GET row. A finished ask (made or failed) needs its row's id;
 * a picture in the making has none (`id` is null). `file` is kept for what it says, never for an address.
 * @param {unknown} v
 * @returns {{id: number|null, buildId: string, round: number, name: string, shape: string, state: string,
 *   prompt: string, file: string|null, w: number|null, h: number|null, model: string|null, costUsd: number|null,
 *   ms: number|null, reason: string|null} | null}
 */
export function readPicture(v) {
  if (!v || typeof v !== 'object') return null;
  if (typeof v.buildId !== 'string' || v.buildId === '') return null;
  if (!isId(v.round)) return null;
  if (typeof v.name !== 'string' || !DESIGN_PICTURE_NAME_RE.test(v.name)) return null;
  if (!PICTURE_SHAPES.includes(v.shape)) return null;
  if (!STATES.has(v.state)) return null;
  const finished = v.state !== 'making';
  if (finished && !isId(v.id)) return null;
  return {
    id: finished ? v.id : null,
    buildId: v.buildId,
    round: v.round,
    name: v.name,
    shape: v.shape,
    state: v.state,
    prompt: typeof v.prompt === 'string' ? v.prompt : '',
    file: text(v.file),
    w: posInt(v.w),
    h: posInt(v.h),
    model: text(v.model),
    costUsd: nonNeg(v.costUsd),
    ms: nonNeg(v.ms),
    reason: text(v.reason),
  };
}

/**
 * The log of one design's pictures. `push`, `gap` and `load` each answer whether what the log shows changed, and a
 * change calls every subscriber once.
 * @param {{designId: string}} opts
 */
export function createPictureLog({ designId }) {
  /** @type {Map<number, NonNullable<ReturnType<typeof readPicture>>>} a finished ask by its row id */
  const done = new Map();
  /** @type {Map<string, NonNullable<ReturnType<typeof readPicture>>>} a picture in the making by `buildId|name`, in arrival order */
  const making = new Map();
  const subs = new Set();

  const ofRound = (r) => [...done.values()].filter((p) => p.round === r).sort((a, b) => a.id - b.id);
  const makingOf = (r) => [...making.values()].filter((p) => p.round === r);
  const sig = (r) => JSON.stringify([ofRound(r).map((p) => [p.id, p.state]), makingOf(r).map((p) => [p.name, p.shape])]);

  /** Runs `change` and answers whether the rounds it may touch now show something else; a change is heard once. */
  function settle(rounds, change) {
    const touched = [...new Set(rounds)];
    const before = touched.map(sig);
    change();
    const moved = touched.some((r, i) => sig(r) !== before[i]);
    if (moved) for (const fn of [...subs]) fn();
    return moved;
  }

  function push(frame) {
    if (!frame || typeof frame !== 'object' || frame.type !== 'design-picture' || frame.designId !== designId) return false;
    const p = readPicture(frame);
    if (frame.state === 'making') {
      if (!p) return false;
      return settle([p.round], () => { making.set(`${p.buildId}|${p.name}`, p); });
    }
    if (frame.state !== 'made' && frame.state !== 'failed') return false;
    const key = typeof frame.buildId === 'string' && typeof frame.name === 'string' ? `${frame.buildId}|${frame.name}` : null;
    const ended = key === null ? undefined : making.get(key);
    const rounds = [];
    if (p) rounds.push(p.round);
    if (ended) rounds.push(ended.round);
    return settle(rounds, () => {
      if (ended) making.delete(key);
      if (p) done.set(p.id, p);
    });
  }

  function gap() {
    if (making.size === 0) return false;
    return settle([...making.values()].map((p) => p.round), () => { making.clear(); });
  }

  function load(rows) {
    if (!Array.isArray(rows)) return false;
    const read = rows.map(readPicture).filter((p) => p && p.state !== 'making');
    return settle(read.map((p) => p.round), () => { for (const p of read) done.set(p.id, p); });
  }

  /** Round `r`'s strip, one tile per name: its picture in the making while the round runs, else its last made one. */
  function shown(r, { live } = {}) {
    const fin = ofRound(r);
    const liveByName = new Map(live ? makingOf(r).map((p) => [p.name, p]) : []);
    const names = [...new Set(fin.map((p) => p.name))];
    for (const p of makingOf(r)) if (!names.includes(p.name)) names.push(p.name);
    const out = [];
    for (const name of names) {
      const now = liveByName.get(name);
      if (now) { out.push(now); continue; }
      const last = fin.filter((p) => p.name === name && p.state === 'made').pop();
      if (last) out.push(last);
    }
    return out;
  }

  function tally(r) {
    let made = 0;
    let failed = 0;
    let usd = 0;
    for (const p of ofRound(r)) {
      if (p.state === 'made') made += 1; else failed += 1;
      if (p.costUsd !== null) usd += p.costUsd;
    }
    return { made, failed, usd: Math.round(usd * 1e6) / 1e6 };
  }

  function subscribe(fn) {
    subs.add(fn);
    return () => { subs.delete(fn); };
  }

  return { push, gap, load, ofRound, shown, tally, sig, subscribe };
}

/**
 * A made picture's address: its row's kept copy, by the integer id alone (the bytes never change, so no query).
 * Reads only `state` and `id`; a picture in the making or a failed ask has none.
 * @param {string} designId
 * @param {{state?: string, id?: unknown} | null | undefined} p
 */
export function pictureSrc(designId, p) {
  if (p?.state !== 'made' || !isId(p.id)) return null;
  return `/api/design/${encodeURIComponent(designId)}/pictures/${p.id}`;
}

/** The facts under a picture: model, size, seconds and dollars, each only when known. */
export function factsLine(p) {
  const parts = [];
  if (p.model) parts.push(p.model);
  if (p.w != null && p.h != null) parts.push(`${p.w}×${p.h}`);
  if (p.ms != null) parts.push(`${pictureSeconds(p.ms)} s`);
  if (p.costUsd != null) parts.push(`$${p.costUsd.toFixed(2)}`);
  return parts.join(SEP);
}

/** SPEC §7: `made N picture(s)`. */
export function madeWords(n) {
  return n === 1 ? `made ${n} picture` : `made ${n} pictures`;
}

/** SPEC §7: `N picture(s) failed`. */
export function failedWords(n) {
  return n === 1 ? `${n} picture failed` : `${n} pictures failed`;
}

const el = (doc, tag, cls, txt) => {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (txt != null) n.textContent = txt;
  return n;
};

/**
 * A round's pictures as small tiles. A made picture is a real button holding its kept copy and its name (a click
 * calls `onOpen(pic, button)`); one in the making is a quiet tile of its shape with no picture; a failed ask has no
 * tile. A copy that does not load marks its tile `is-missing`.
 * @param {{doc: Document, designId: string, pictures: Array<ReturnType<typeof readPicture>>,
 *   onOpen?: (pic: NonNullable<ReturnType<typeof readPicture>>, tile: HTMLButtonElement) => void}} opts
 * @returns {HTMLElement}
 */
export function createPictureStrip({ doc, designId, pictures, onOpen }) {
  const strip = el(doc, 'div', 'dsc-pics');
  strip.setAttribute('role', 'group');
  strip.setAttribute('aria-label', 'Pictures');
  for (const p of Array.isArray(pictures) ? pictures : []) {
    if (!p || (p.state !== 'made' && p.state !== 'making')) continue;
    const box = el(doc, 'span', 'dsc-pic-box');
    const label = el(doc, 'span', 'dsc-pic-name', p.name);
    if (p.state === 'making') {
      const quiet = el(doc, 'div', `dsc-pic is-${p.shape} is-making`);
      quiet.setAttribute('role', 'img');
      quiet.setAttribute('aria-label', `Making a picture: ${p.name}`);
      quiet.append(box, label);
      strip.append(quiet);
      continue;
    }
    const tile = el(doc, 'button', `dsc-pic is-${p.shape}`);
    tile.type = 'button';
    tile.dataset.pic = `${p.round}|${p.name}`;
    tile.title = p.name;
    const src = pictureSrc(designId, p);
    if (src) {
      const img = el(doc, 'img');
      img.alt = '';
      img.setAttribute('loading', 'lazy');
      img.addEventListener('error', () => { tile.classList.add('is-missing'); });
      img.src = src;
      box.append(img);
    }
    tile.append(box, label);
    tile.addEventListener('click', () => { if (typeof onOpen === 'function') onOpen(p, tile); });
    strip.append(tile);
  }
  return strip;
}

let seq = 0;   // ids for the viewer titles on one page

/**
 * Open the viewer of one made picture on `doc.body`: its name, the picture, `What it shows` with the description,
 * and one facts line (hidden when nothing is known). Close, Escape and a backdrop click close it; Close has the
 * focus. `close()` runs once and hands the focus back to `opener` while it is still on the page, else to
 * `refocus()` (the tile was painted again); `close({restore: false})` skips that hand-back.
 * @param {{doc: Document, designId: string, picture: NonNullable<ReturnType<typeof readPicture>>,
 *   opener?: HTMLElement|null, refocus?: (() => void)|null}} opts
 * @returns {{close: (opts?: {restore?: boolean}) => void}}
 */
export function openPictureViewer({ doc, designId, picture, opener = null, refocus = null }) {
  const p = picture;
  const card = el(doc, 'div', 'card dz-pic-card');
  const head = el(doc, 'div', 'dz-pic-head');
  const h = el(doc, 'h2', null, p.name);
  h.id = `dz-pic-title-${++seq}`;
  const shut = el(doc, 'button', 'btn btn-quiet btn-icon');
  shut.type = 'button';
  shut.setAttribute('aria-label', 'Close');
  shut.title = 'Close';
  shut.append(icon(doc, 'x'));
  head.append(h, shut);
  card.append(head);
  const src = pictureSrc(designId, p);
  if (src) {
    const img = el(doc, 'img', 'dz-pic-full');
    img.alt = '';
    img.src = src;
    card.append(img);
  }
  card.append(el(doc, 'h3', 'dz-pic-h', 'What it shows'), el(doc, 'p', 'dz-pic-desc', p.prompt));
  const facts = el(doc, 'p', 'dz-pic-facts', factsLine(p));
  facts.hidden = facts.textContent === '';
  card.append(facts);
  layoutDialog(card, { head: [head] });
  const modal = el(doc, 'div', 'viewer-modal dz-pic-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', h.id);
  modal.append(card);

  let open = true;
  let guard = null;
  function close({ restore = true } = {}) {
    if (!open) return;
    open = false;
    guard.release();
    modal.remove();
    if (restore === false) return;
    if (opener && opener.isConnected) opener.focus();
    else if (typeof refocus === 'function') refocus();
  }
  shut.addEventListener('click', () => close());
  guard = guardModal(modal, { kind: 'viewer', close: () => close() });
  doc.body.append(modal);
  guard.opened();
  shut.focus();
  return { close };
}

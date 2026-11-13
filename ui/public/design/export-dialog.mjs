// ui/public/design/export-dialog.mjs — Design P6 (L6.4, L6.5, BRIEF C4): the stage head's Export menu and the dialogs
// behind it. The menu is the mockup's (board 6a): Standalone HTML, Zip of the folder, PDF (decks and documents only,
// and no row at all on a video), then Copy into a project. A download opens a dialog only when it has something to say: still running
// after `showAfterMs`, a refusal, or what was left out of the file (the X-Worca-Export-Problems header). Copy into a
// project is a dialog of its own, with the collision choice inside it. Every server string reaches the page as text.
// A video also has Video (MP4): the server renders it as a job (film-mp4.mjs), so its dialog opens at once, asks the
// job how far it is every `pollMs` (a bar from 0 to 100 %), and saves the file when it is ready. Stop, or closing the dialog, stops the render.

import { createFlyout } from '../side-flyout.mjs';
import { layoutDialog } from '../dialog-layout.mjs';
import { guardModal } from '../modal-guard.mjs';
import { icon } from '../icons.mjs';
import { PDF_KINDS, exportStem } from '../../../src/shared/design-names.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
// The mockup's own icons (canvas build.mjs:114), drawn at 16px with its 1.75 stroke.
const MENU_ICONS = {
  html: [['path', { d: 'M12 4v11M7 11l5 5 5-5M5 20h14' }]],
  zip: [['rect', { x: '4', y: '3.5', width: '16', height: '17', rx: '2' }], ['path', { d: 'M12 3.5v3M12 8.5v2M12 12.5v2' }]],
  pdf: [['path', { d: 'M8 3.5h6l4 4V20.5H6V5.5a2 2 0 0 1 2-2zM14 3.5v4h4' }]],
  mp4: [['rect', { x: '3.5', y: '5.5', width: '17', height: '13', rx: '2.5' }], ['path', { d: 'M10.5 9.5v5l4-2.5z' }]],
  project: [['path', { d: 'M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.2H19.5A1.5 1.5 0 0 1 21 9.7v8.3A1.5 1.5 0 0 1 19.5 19.5h-15A1.5 1.5 0 0 1 3 18zM12 11v5M9.5 13.5h5' }]],
};
const SVG_ATTRS = {
  viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75',
  'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
};
const LABELS = { html: 'Standalone HTML', zip: 'Zip of the folder', pdf: 'PDF', mp4: 'Video (MP4)', project: 'Copy into a project' };
const EXT = { html: 'html', zip: 'zip', pdf: 'pdf' };
const FILM_STARTING = 'Getting the video ready…';
const FILM_WAITING = 'Waiting for another video to finish…';
const FILM_SAVING = 'Saving the video…';
const FILM_RENDERING = 'Rendering the video…';
const WHY = { missing: 'Not found', escaped: 'Outside the design', remote: 'On the web, left as a link', 'too-large': 'Too large' };
const BUSY = 'Making the file…';
const DROPPED = 'Could not finish the file';
const NO_PROJECTS = 'No projects yet';

let seq = 0;   // ids for the menus and dialog titles on one page

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const errorOf = (body, fallback) => (isObject(body) && typeof body.error === 'string' && body.error ? body.error : fallback);

/**
 * How far a video's render is, as the dialog's bar shows it: whole per cent of its frames, rounded down (100 only
 * when every frame is shot), never under 0 or over 100. Anything that is not a count is 0.
 * @param {number} done frames shot
 * @param {number} total frames in the video
 * @returns {number} 0 to 100
 */
export function filmPercent(done, total) {
  if (typeof done !== 'number' || typeof total !== 'number' || !(done > 0) || !(total > 0)) return 0;
  return Math.min(100, Math.floor((done / total) * 100));
}

/**
 * The menu's rows for a design kind: PDF is a row on every kind but video, enabled only for a deck or a document
 * (`PDF_KINDS`, the list the server's PDF dispatcher reads). A video has Video (MP4) in its place.
 * @param {string} kind
 * @returns {Array<{id: string, label: string, disabled?: boolean, note?: string} | {sep: true}>}
 */
export function exportMenuItems(kind) {
  const items = [{ id: 'html', label: LABELS.html }, { id: 'zip', label: LABELS.zip }];
  if (kind === 'video') {
    items.push({ id: 'mp4', label: LABELS.mp4 });
  } else {
    items.push(PDF_KINDS.includes(kind) ? { id: 'pdf', label: LABELS.pdf } : { id: 'pdf', label: LABELS.pdf, disabled: true, note: 'Decks and documents only' });
  }
  items.push({ sep: true }, { id: 'project', label: LABELS.project });
  return items;
}

/**
 * The X-Worca-Export-Problems header: `{total, shown: [{ref, why}]}` as percent-encoded JSON. Anything else, or no
 * header, is nothing left out. `total` counts every problem, so it is never below the entries shown.
 * @param {string | null | undefined} header
 * @returns {{total: number, shown: Array<{ref: string, why: string}>}}
 */
export function decodeProblems(header) {
  if (typeof header !== 'string' || !header) return readProblems(null);
  let v;
  try { v = JSON.parse(decodeURIComponent(header)); } catch { return readProblems(null); }
  return readProblems(v);
}

/** `{total, shown: [{ref, why}]}` as the server sends it (the header's JSON, a video job's `problems`); anything else
 *  is nothing left out. */
function readProblems(v) {
  if (!isObject(v) || !Number.isInteger(v.total) || v.total < 0 || !Array.isArray(v.shown)) return { total: 0, shown: [] };
  const shown = v.shown.filter((p) => isObject(p) && typeof p.ref === 'string')
    .map((p) => ({ ref: p.ref, why: typeof p.why === 'string' ? p.why : '' }));
  return { total: Math.max(v.total, shown.length), shown };
}

/**
 * The file name a Content-Disposition carries: the exact UTF-8 `filename*` first, then the ASCII `filename`, else
 * `fallback`. Only the last path segment counts.
 * @param {string | null | undefined} header
 * @param {string} fallback
 * @returns {string}
 */
export function dispositionName(header, fallback) {
  const h = typeof header === 'string' ? header : '';
  let name = '';
  const star = /\bfilename\*\s*=\s*UTF-8''([^;\s]+)/i.exec(h);
  if (star) {
    try { name = decodeURIComponent(star[1]); } catch { name = ''; }
  }
  if (!name) {
    const plain = /\bfilename\s*=\s*"([^"]*)"/i.exec(h) || /\bfilename\s*=\s*([^;\s]+)/i.exec(h);
    name = plain ? plain[1] : '';
  }
  return name.split(/[\\/]/).pop().trim() || fallback;
}

/**
 * Hand `blob` to the browser as a download named `name`: a hidden `a[download]`, clicked, its object URL let go of a
 * second later (Firefox drops a download whose URL is revoked at once, as app.js's patch download notes).
 * @param {string} name
 * @param {Blob} blob
 * @param {Document} [doc]
 */
export function saveBlob(name, blob, doc = globalThis.document) {
  const win = doc.defaultView;
  const href = win.URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = href;
  a.download = name;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  win.setTimeout(() => win.URL.revokeObjectURL(href), 1000);
}

/**
 * The stage head's Export: its trigger in `anchor` (hidden until `setReady(true)`, as only a finished round exports,
 * L6.3), the menu under it, and the dialogs. `getDesign()` is read at each use (`{id, kind, title, projectKey}`).
 * `toggle()` is also the HUD's end-state Export; a click inside `.dz-hud` counts as inside the menu.
 * @param {{doc: Document, win: Window, fetch: Function, getDesign: () => object, anchor: HTMLElement,
 *   showAfterMs?: number, pollMs?: number, save?: (name: string, blob: Blob, doc?: Document) => void}} deps
 *   `pollMs` is how often a video's dialog asks its render how far it is
 * @returns {{toggle: () => void, setReady: (on: boolean) => void, run: (format: string) => Promise<void>,
 *   openProject: () => Promise<void>, destroy: () => void}}
 */
export function createDesignExport({ doc, win, fetch: fetchFn, getDesign, anchor, showAfterMs = 300, pollMs = 1000, save = saveBlob }) {
  const Abort = win?.AbortController ?? globalThis.AbortController;
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text, onClick) => {
    const b = make('button', cls, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };
  const design = () => {
    const d = getDesign?.();
    return isObject(d) ? d : {};
  };
  const post = (body, signal) => fetchFn(`/api/design/${encodeURIComponent(design().id)}/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  });

  let ready = false;
  let destroyed = false;
  let job = null;   // the download in flight: { format, ctl, timer }
  let film = null;  // a video's MP4 in flight: { ctl, timer, base }, from its start until its file is saved
  let dlg = null;   // the open dialog: { type, modal, h, body, status, actions, guard, opener, ... }

  // The head's trigger and its menu (canvas build.mjs:164-181).
  const trigger = make('button', 'btn');
  trigger.type = 'button';
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.hidden = true;
  trigger.append('Export', icon(doc, 'chevron-down', 12));
  const menu = make('div', 'menu dz-export');
  menu.id = `dz-export-${++seq}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Export');
  menu.hidden = true;
  trigger.setAttribute('aria-controls', menu.id);
  for (const item of exportMenuItems(design().kind)) {
    if (item.sep) {
      menu.append(make('div', 'menu-sep'));
      continue;
    }
    const b = make('button', 'menu-item');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    b.append(menuIcon(item.id), make('span', null, item.label));
    if (item.disabled) {
      b.setAttribute('aria-disabled', 'true');
      b.title = item.note;
      b.append(make('small', null, item.note));
    }
    b.addEventListener('click', (e) => {
      if (item.disabled) return;
      // The flyout closes by itself only for [data-nav] items.
      fly.close(e.detail === 0 ? {} : { blur: true });
      if (item.id === 'project') void openProject();
      else void run(item.id);   // `mp4` goes on to runFilm
    });
    menu.append(b);
  }
  anchor.append(trigger, menu);
  const fly = createFlyout({ doc, win, trigger, menu, mode: 'down', inside: (t) => !!t.closest?.('.dz-hud') });

  function menuIcon(id) {
    const svg = doc.createElementNS(SVG_NS, 'svg');
    for (const [k, v] of Object.entries(SVG_ATTRS)) svg.setAttribute(k, v);
    for (const [tag, attrs] of MENU_ICONS[id]) {
      const n = doc.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      svg.append(n);
    }
    return svg;
  }

  /** A `.viewer-modal > .card` dialog: the title on top, the status line and the buttons at the foot. `busy()` (the
   *  guard's rule) holds Escape and the dialog's own Cancel while a request that writes is out. */
  function openDialog(type, heading, { kind, close, busy }) {
    shut({ refocus: false });
    const card = make('div', 'card dsx-card');
    const h = make('h2', null, heading);
    h.id = `dsx-title-${++seq}`;
    const body = make('div', 'dsx-body');
    const status = make('p', 'dlg-status');
    status.setAttribute('role', 'status');
    const actions = make('div', 'confirm-actions');
    card.append(h, body, status, actions);
    layoutDialog(card, { head: [h], foot: [status, actions] });
    const modal = make('div', 'viewer-modal confirm-modal dsx-modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', h.id);
    modal.append(card);
    const d = { type, modal, h, body, status, actions, opener: doc.activeElement, guard: guardModal(modal, { kind, close, ...(busy ? { busy } : {}) }) };
    dlg = d;
    doc.body.append(modal);
    d.guard.opened();
    return d;
  }

  /** The open dialog goes; focus goes back where it was when the dialog opened, if that is still on the page. */
  function shut({ refocus = true } = {}) {
    if (!dlg) return;
    const d = dlg;
    dlg = null;
    d.guard.release();
    d.modal.remove();
    const back = d.opener;
    if (refocus && back && back !== doc.body && back.isConnected) back.focus?.();
  }

  const setStatus = (d, text, err = false) => {
    d.status.textContent = text;
    d.status.classList.toggle('is-err', err && !!text);
  };
  /** Focus the dialog's primary, else its first button, unless focus is already inside it. */
  const focusIn = (d) => {
    if (d.modal.contains(doc.activeElement)) return;
    (d.actions.querySelector('.btn-primary:not([disabled])') || d.actions.querySelector('button:not([disabled])'))?.focus();
  };

  // A download's dialog: one at a time, reused by Try again, and closing it is a Cancel.
  const downloadDialog = (format) => (dlg?.type === 'download' ? dlg : openDialog('download', LABELS[format], { kind: 'decision', close: cancel }));

  function paintBusy(d, format) {
    d.h.textContent = LABELS[format];
    d.body.replaceChildren();
    setStatus(d, BUSY);
    d.actions.replaceChildren(button('btn', 'Cancel', cancel));
    focusIn(d);
  }
  function paintRefusal(d, format, text) {
    d.h.textContent = LABELS[format];
    d.body.replaceChildren();
    setStatus(d, text, true);
    d.actions.replaceChildren(button('btn', 'Close', () => shut()), button('btn btn-primary', 'Try again', () => { void run(format); }));
    focusIn(d);
  }
  /** The bar of a video's render at `pct` of 100. It is made once per dialog and kept from answer to answer, so its
   *  fill glides. The bar tells a screen reader its value; the number beside it is for the eye. */
  function filmBar(d, pct) {
    let bar = d.body.querySelector('.dsx-bar');
    if (!bar) {
      bar = make('div', 'dsx-bar');
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', LABELS.mp4);
      bar.setAttribute('aria-valuemin', '0');
      bar.setAttribute('aria-valuemax', '100');
      bar.append(make('i'));
      const number = make('span', 'dsx-pct');
      number.setAttribute('aria-hidden', 'true');
      const row = make('div', 'dsx-progress');
      row.append(bar, number);
      d.body.replaceChildren(row);
    }
    bar.setAttribute('aria-valuenow', String(pct));
    bar.firstElementChild.style.width = `${pct}%`;
    bar.nextElementSibling.textContent = `${pct}%`;
  }
  /** A video's render, as its job says it stands: `null` before the job has answered. */
  function paintFilm(d, status) {
    d.h.textContent = LABELS.mp4;
    filmBar(d, status ? filmPercent(status.done, status.total) : 0);
    const line = !status ? FILM_STARTING : status.state === 'queued' ? FILM_WAITING : FILM_RENDERING;
    if (d.status.textContent !== line) setStatus(d, line);
    if (d.actions.firstChild?.textContent !== 'Stop') d.actions.replaceChildren(button('btn', 'Stop', cancel));
    focusIn(d);
  }
  function paintProblems(d, problems) {
    d.h.textContent = 'Left out of the file';
    const list = make('ul', 'dsx-list');
    for (const p of problems.shown) {
      const row = make('li');
      row.append(make('span', 'dsx-ref', p.ref));
      if (WHY[p.why]) row.append(make('small', null, WHY[p.why]));
      list.append(row);
    }
    d.body.replaceChildren(list);
    const more = problems.total - problems.shown.length;
    if (more > 0) d.body.append(make('p', 'dsx-more', `and ${more} more`));
    setStatus(d, '');
    d.actions.replaceChildren(button('btn btn-primary', 'Close', () => shut()));
    focusIn(d);
  }

  /** Cancel: the request is aborted and its dialog goes at once; its late answer paints nothing. Its dialog is on
   *  screen, so its timer has already fired. A video's render is stopped on the server too. */
  function cancel() {
    const j = job;
    job = null;
    j?.ctl.abort();
    dropFilm({ stop: true });
    shut();
  }

  /** A video's MP4 in flight is let go of: no more asking, its requests aborted. With `stop`, the server's render
   *  too: the dialog's Stop. Without (the page goes), the render finishes and its file waits for the next export. */
  function dropFilm({ stop = false } = {}) {
    const f = film;
    if (!f) return;
    film = null;
    win.clearTimeout(f.timer);
    f.ctl.abort();
    if (!stop) return;
    try {
      Promise.resolve(fetchFn(`${f.base}/mp4`, { method: 'DELETE' })).catch(() => { /* the render ends by itself */ });
    } catch { /* the same */ }
  }

  /** Video (MP4): start the render (or join the one that runs), follow it, save its file. */
  async function runFilm() {
    const mine = { ctl: new Abort(), timer: 0, base: `/api/design/${encodeURIComponent(design().id)}/export` };
    film = mine;
    const live = () => film === mine;
    const refuse = (text) => {
      if (!live()) return;
      dropFilm();
      paintRefusal(downloadDialog('mp4'), 'mp4', text);
    };
    const bodyOf = async (res) => { try { return await res.json(); } catch { return null; } };
    /** One answer of the job: go on asking, fetch the file, or say what went wrong. */
    async function onStatus(res) {
      const body = await bodyOf(res);
      if (!live()) return;
      if (!res.ok) { refuse(errorOf(body, DROPPED)); return; }
      const state = isObject(body) ? body.state : null;
      if (state === 'queued' || state === 'rendering') {
        paintFilm(downloadDialog('mp4'), body);
        mine.timer = win.setTimeout(async () => {
          try {
            const next = await fetchFn(`${mine.base}/mp4`, { signal: mine.ctl.signal });
            if (live()) await onStatus(next);
          } catch { refuse(DROPPED); }
        }, pollMs);
        return;
      }
      if (state !== 'ready' || typeof body.key !== 'string') { refuse(state === 'failed' ? errorOf(body, DROPPED) : DROPPED); return; }
      const d = downloadDialog('mp4');
      filmBar(d, 100);
      setStatus(d, FILM_SAVING);
      const res2 = await fetchFn(`${mine.base}/mp4/file?key=${encodeURIComponent(body.key)}`, { signal: mine.ctl.signal });
      if (!live()) return;
      if (!res2.ok) { refuse(errorOf(await bodyOf(res2), DROPPED)); return; }
      const blob = await res2.blob();
      if (!live()) return;
      dropFilm();
      save(dispositionName(res2.headers?.get('content-disposition'), `${exportStem(design().title)}.mp4`), blob, doc);
      const problems = readProblems(body.problems);
      if (problems.total > 0) paintProblems(downloadDialog('mp4'), problems);
      else if (dlg?.type === 'download') shut();
    }
    // A render always takes a while, so its dialog is there from the start.
    paintFilm(downloadDialog('mp4'), null);
    try {
      await onStatus(await post({ format: 'mp4' }, mine.ctl.signal));
    } catch {
      refuse(DROPPED);
    }
  }

  async function run(format) {
    if (destroyed || job || film) return;
    if (format === 'mp4') { await runFilm(); return; }
    if (!EXT[format]) return;
    const mine = { format, ctl: new Abort(), timer: 0 };
    job = mine;
    const settle = () => {
      win.clearTimeout(mine.timer);
      if (job === mine) job = null;
    };
    // Try again repaints the open dialog at once; a first try shows one only if it is still going after showAfterMs.
    if (dlg?.type === 'download') paintBusy(dlg, format);
    else mine.timer = win.setTimeout(() => { paintBusy(downloadDialog(format), format); }, showAfterMs);
    try {
      const res = await post({ format }, mine.ctl.signal);
      if (job !== mine) return;
      if (!res.ok) {
        let body = null;
        try { body = await res.json(); } catch { body = null; }
        if (job !== mine) return;
        settle();
        paintRefusal(downloadDialog(format), format, errorOf(body, DROPPED));
        return;
      }
      const blob = await res.blob();
      if (job !== mine) return;
      settle();
      const headers = res.headers;
      save(dispositionName(headers?.get('content-disposition'), `${exportStem(design().title)}.${EXT[format]}`), blob, doc);
      const problems = decodeProblems(headers?.get('x-worca-export-problems'));
      if (problems.total > 0) paintProblems(downloadDialog(format), problems);
      else if (dlg?.type === 'download') shut();
    } catch {
      if (job !== mine) return;   // cancelled or destroyed: nothing to paint
      settle();
      paintRefusal(downloadDialog(format), format, DROPPED);
    }
  }

  async function openProject() {
    if (destroyed) return;
    let state = 'idle';    // idle | busy | exists | done
    // The copy writes into the person's project whatever happens to the page: its answer must be shown, so nothing
    // closes the dialog while it is out (modal-guard's busy rule).
    const d = openDialog('project', LABELS.project, { kind: 'form', close: () => shut(), busy: () => state === 'busy' });
    const projectId = `dsx-project-${++seq}`;
    const folderId = `dsx-folder-${seq}`;
    const projectField = make('div', 'field');
    const projectLabel = make('label', null, 'Project');
    projectLabel.htmlFor = projectId;
    const sel = make('select', 'input');
    sel.id = projectId;
    sel.disabled = true;
    const selWrap = make('div', 'select-wrap');
    selWrap.append(sel);
    projectField.append(projectLabel, selWrap);
    const folderField = make('div', 'field');
    const folderLabel = make('label', null, 'Folder');
    folderLabel.htmlFor = folderId;
    const folder = make('input', 'input');
    folder.type = 'text';
    folder.id = folderId;
    folder.spellcheck = false;
    folder.autocomplete = 'off';
    folder.value = `design/${exportStem(design().title)}`;
    folderField.append(folderLabel, folder);
    const list = make('ul', 'dsx-list');
    list.hidden = true;
    const replaceRow = make('label', 'check-row dsx-replace-row');
    replaceRow.hidden = true;
    const box = make('input', 'dsx-replace');
    box.type = 'checkbox';
    replaceRow.append(box, make('span', null, 'Replace these files'));
    d.body.append(projectField, folderField, list, replaceRow);

    let projects = null;   // the projects that exist, once loaded
    let asked = null;      // the {projectKey, subdir} the shown collisions were found for, and their list's key
    const cancelBtn = button('btn', 'Cancel', () => d.guard.cancel());
    const go = button('btn btn-primary', 'Copy', () => {
      if (state === 'done') shut();
      else void copy();
    });
    d.actions.replaceChildren(cancelBtn, go);
    const paintGo = () => {
      const done = state === 'done';
      go.textContent = done ? 'Done' : 'Copy';
      go.disabled = !done && (state === 'busy' || !projects?.length || (state === 'exists' && !box.checked));
      cancelBtn.hidden = done;
      cancelBtn.disabled = state === 'busy';
      // The target is fixed while its copy is asked: an answer is only ever about the folder on screen.
      folder.disabled = state === 'busy';
      sel.disabled = state === 'busy' || !projects?.length;
    };
    const target = () => ({ projectKey: sel.value, subdir: folder.value.trim() });
    const sameTarget = (t) => !!t && t.projectKey === sel.value && t.subdir === folder.value.trim();
    const clearCollisions = () => {
      list.hidden = true;
      list.replaceChildren();
      replaceRow.hidden = true;
      box.checked = false;
      asked = null;
    };
    // Editing the target drops a collision answer, since it was about the old folder. The select and the input only:
    // a listener on the card would hear the checkbox too.
    const edited = () => {
      if (state === 'busy') return;
      state = 'idle';
      clearCollisions();
      setStatus(d, projects && !projects.length ? NO_PROJECTS : '');
      paintGo();
    };
    sel.addEventListener('change', edited);
    folder.addEventListener('input', edited);
    box.addEventListener('change', paintGo);
    paintGo();

    async function copy() {
      if (state === 'busy' || !sel.value) return;
      const body = { format: 'project', ...target() };
      // Replace only the files listed, in the folder they were found in: the key names that list and that real folder,
      // and a list or a folder that changed since comes back as a new 409 with nothing written.
      if (state === 'exists' && box.checked && sameTarget(asked)) {
        body.overwrite = true;
        body.collisionsKey = asked.key;
      }
      state = 'busy';
      setStatus(d, '');
      paintGo();
      let res = null;
      let answer = null;
      try {
        res = await post(body);
        try { answer = await res.json(); } catch { answer = null; }
      } catch {
        res = null;
      }
      if (dlg !== d) return;
      clearCollisions();
      if (res?.ok && isObject(answer) && answer.ok === true) {
        state = 'done';
        const n = Number(answer.files) || 0;
        setStatus(d, `Copied ${n} ${n === 1 ? 'file' : 'files'} to ${String(answer.target ?? body.subdir)}`);
      } else if (res?.status === 409 && isObject(answer) && answer.code === 'exists' && !sameTarget(body)) {
        // The target changed while it was asked (the fields are fixed meanwhile, so only a script can): the answer is
        // about a folder no longer on screen.
        state = 'idle';
        setStatus(d, '');
      } else if (res?.status === 409 && isObject(answer) && answer.code === 'exists') {
        state = 'exists';
        asked = { projectKey: body.projectKey, subdir: body.subdir, key: typeof answer.collisionsKey === 'string' ? answer.collisionsKey : null };
        const names = Array.isArray(answer.collisions) ? answer.collisions.filter((c) => typeof c === 'string') : [];
        for (const c of names) list.append(make('li', null, c));
        const more = (Number.isInteger(answer.total) ? answer.total : names.length) - names.length;
        if (more > 0) list.append(make('li', 'dsx-more', `and ${more} more`));
        list.hidden = false;
        replaceRow.hidden = false;
        setStatus(d, errorOf(answer, 'Some of these files already exist.'), true);
      } else {
        state = 'idle';
        setStatus(d, errorOf(answer, 'Could not copy the files'), true);
      }
      paintGo();
      focusIn(d);
    }

    try {
      const res = await fetchFn('/api/projects');
      const body = res.ok ? await res.json() : null;
      projects = isObject(body) && Array.isArray(body.projects)
        ? body.projects.filter((p) => isObject(p) && p.exists && typeof p.key === 'string' && p.key)
        : null;
    } catch {
      projects = null;
    }
    if (dlg !== d) return;
    if (!projects) {
      projects = [];
      setStatus(d, 'Could not load the projects', true);
    } else if (!projects.length) {
      setStatus(d, NO_PROJECTS);
    }
    for (const p of projects) {
      const o = make('option', null, typeof p.name === 'string' && p.name ? p.name : p.key);
      o.value = p.key;
      sel.append(o);
    }
    const own = design().projectKey;
    sel.value = projects.some((p) => p.key === own) ? own : (projects[0]?.key ?? '');
    paintGo();
    d.guard.markClean();
    if (!d.modal.contains(doc.activeElement)) (projects.length ? sel : cancelBtn).focus();
  }

  return {
    toggle() {
      if (ready && !destroyed) fly.toggle();
    },
    setReady(on) {
      ready = !!on;
      trigger.hidden = !ready;
      if (!ready) fly.close();
    },
    run,
    openProject,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      const j = job;
      job = null;
      if (j) {
        win.clearTimeout(j.timer);
        j.ctl.abort();
      }
      dropFilm();
      shut({ refocus: false });
      fly.destroy();
      trigger.remove();
      menu.remove();
    },
  };
}

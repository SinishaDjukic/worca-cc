// ui/public/design/designs-grid.mjs — the designs under a new design's start (studio.mjs createDesignStartPage): the
// newest nine as tiles (a picture or the kind's icon, the name, one meta line), Show all designs under them to list
// every design in place and Show fewer to fold them again, and a Search designs field beside the heading that looks
// through every design by its title and its kind. No designs: no heading, no search, no prose. Loading and failure
// follow docs/design-system.md › Empty, loading, error: nothing for 300 ms, then one line; `Could not load designs` in
// red with `Nothing changed.` and Try again. Every string reaches the DOM through `textContent`. Nothing runs at load
// time: the window's timers are reached only through `win`.

import { KIND_ICONS, kindWord, tileMeta } from './library.mjs';

/** The designs shown before Show all designs: three full rows of three. */
export const COLLAPSED = 9;

const LOADING_DELAY_MS = 300;
const REFETCH_MS = 200;
const LIST_URL = '/api/design';
/** The store's OPEN_BUILD_STATUSES (store.mjs): its frame moves the tile in place. */
const OPEN_BUILD = Object.freeze(['planning', 'building', 'integrating', 'paused']);
/** A design-build frame that ends a round: the list comes again (cost, time, picture). */
const ROUND_ENDS = Object.freeze(['done', 'stopped', 'error', 'interrupted']);

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A tile's title: the design's own, else `Untitled design`. */
const titleOf = (row) => (isObject(row) && typeof row.title === 'string' && row.title ? row.title : 'Untitled design');

let gridSeq = 0;   // ids for the grids on one page (the button's aria-controls)

/**
 * Rows whose title and kind word hold every whitespace-separated word of `query`, ignoring case. A blank query keeps
 * all. The query is plain text: matched with `includes`, never as a pattern.
 * @param {object[]} rows
 * @param {string} query
 * @returns {object[]}
 */
export function filterDesigns(rows, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows.slice();
  return rows.filter((row) => {
    const hay = `${titleOf(row)} ${kindWord(isObject(row) ? row.kind : null)}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/**
 * What the grid draws and what its button says. A non-blank query: every match, no button. No more rows than `limit`:
 * all of them, no button. `all`: every row and Show fewer; else the first `limit` and Show all designs.
 * @param {object[]} rows
 * @param {{query?: string, all?: boolean, limit?: number}} [opts]
 * @returns {{list: object[], more: 'none' | 'all' | 'fewer'}}
 */
export function shownDesigns(rows, { query = '', all = false, limit = COLLAPSED } = {}) {
  if (String(query ?? '').trim()) return { list: filterDesigns(rows, query), more: 'none' };
  if (rows.length <= limit) return { list: rows.slice(), more: 'none' };
  if (all) return { list: rows.slice(), more: 'fewer' };
  return { list: rows.slice(0, limit), more: 'all' };
}

/**
 * The designs block: `div.dz-designs > .dz-lib-body > (.dz-lib-head > h2.dz-lib-h + input.dz-find) + .dz-grid +
 * .dz-lib-foot`, one `a.dz-tile` per shown design, then the loading or failure line after the body. `open()` loads the
 * list (again) and resolves once it is painted. A tile click with no modifier key opens its design through
 * `navigate('#design/<id>')`. `all` starts with every design shown; Show all designs and Show fewer call
 * `onAll(all)`. `pushFrame(f)` takes the C-5 frames: a thumbnail or an open build's status changes its row (and its
 * tile, when it is drawn) in place, and a round's end or a restore loads the list once more.
 * @param {{doc: Document, win: Window, fetch: Function, navigate: (hash: string) => void, now?: () => number,
 *   all?: boolean, onAll?: (all: boolean) => void}} deps
 * @returns {{el: HTMLElement, open: () => Promise<void>, pushFrame: (f: object) => void, destroy: () => void}}
 */
export function createDesignsGrid({ doc, win, fetch: fetchFn, navigate, now = () => Date.now(), all = false, onAll = () => {} }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // The body stays hidden until a list with designs in it comes.
  const el = make('div', 'dz-designs');
  const body = make('div', 'dz-lib-body');
  const head = make('div', 'dz-lib-head');
  const find = make('input', 'input dz-find');
  find.type = 'search';
  find.placeholder = 'Search designs';
  find.setAttribute('aria-label', 'Search designs');
  head.append(make('h2', 'dz-lib-h', 'Designs'), find);
  const grid = make('div', 'dz-grid');
  grid.id = `dz-grid-${++gridSeq}`;
  const none = make('p', 'empty-line dz-find-none');   // while a query matches nothing
  const foot = make('div', 'dz-lib-foot');
  const button = make('button', 'btn btn-sm');
  button.type = 'button';
  button.setAttribute('data-dz-show-all', '');
  button.setAttribute('aria-controls', grid.id);
  foot.append(button);
  body.append(head, grid, foot);
  body.hidden = true;
  el.append(body);

  let destroyed = false;
  let seq = 0;
  let loadingTimer = null;
  let refetchTimer = null;
  let loadLine = null;     // p.dz-lib-load, while a load is out past 300 ms
  let errLine = null;      // p.dz-lib-err, after a failed load until the next answer
  let rows = [];           // every design, newest first; a frame changes them in place
  let painted = null;      // JSON of `rows`, frames' changes in it: an answer that equals it paints nothing
  const tiles = new Map(); // design id -> { row, thumb, meta }, for the shown rows only

  function noPicture(kind) {
    const icon = make('span', 'dz-thumb-none');
    icon.innerHTML = Object.hasOwn(KIND_ICONS, kind) ? KIND_ICONS[kind] : KIND_ICONS.web;
    return icon;
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
    tile.append(thumb, make('span', 'dz-tile-t', titleOf(row)), meta);
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

  /** The tiles, the no-match line and the button, for the rows, the query and `all` as they are now. */
  function paint() {
    const query = find.value.trim();
    const { list, more } = shownDesigns(rows, { query, all });
    tiles.clear();
    grid.replaceChildren(...list.map(tileFor));
    body.hidden = rows.length === 0;
    if (query && !list.length) {
      none.textContent = `No designs match “${query}”.`;
      if (none.previousElementSibling !== grid) grid.after(none);
    } else {
      none.remove();
    }
    foot.hidden = more === 'none';
    button.textContent = all ? 'Show fewer' : 'Show all designs';
    button.setAttribute('aria-expanded', String(all));
  }

  function paintList(list) {
    const next = list.filter((d) => isObject(d) && typeof d.id === 'string' && d.id);
    const json = JSON.stringify(next);
    if (json === painted) return;
    rows = next;
    painted = json;
    paint();
  }

  /** A frame's change to one design, drawn or not; its tile, when drawn, changes in place. The JSON follows, so an
   *  answer equal to it paints nothing. */
  function patchRow(designId, patch) {
    const row = rows.find((r) => r.id === designId);
    if (!row) return;
    Object.assign(row, patch);
    painted = JSON.stringify(rows);
    const t = tiles.get(designId);
    if (!t) return;
    if ('status' in patch) t.meta.textContent = tileMeta(row, now());
    if ('thumb' in patch) paintThumb(t.thumb, row);
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
    el.append(line);
  }

  function showLoading() {
    loadingTimer = null;
    errLine?.remove();
    errLine = null;
    loadLine = make('p', 'empty-line dz-lib-load', 'Loading designs…');
    loadLine.setAttribute('aria-busy', 'true');
    el.append(loadLine);
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

  find.addEventListener('input', paint);
  find.addEventListener('keydown', (e) => {
    // Something before the search took this Escape (a composer popover, an open flyout): one Escape closes one thing.
    // An empty search leaves Escape to the page, and an IME keeps its own (mid-composition, or WebKit's committing
    // keydown: keyCode 229).
    if (e.key !== 'Escape' || e.isComposing || e.keyCode === 229 || e.defaultPrevented || find.value === '') return;
    find.value = '';
    paint();
    e.preventDefault();
  });
  button.addEventListener('click', () => {
    all = !all;
    paint();
    onAll(all);
    // Show fewer folds the list away from under the button: it stays in view.
    if (!all) button.scrollIntoView?.({ block: 'nearest' });
  });
  paint();

  return {
    el,
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
      endLoading();
      if (refetchTimer !== null) win.clearTimeout(refetchTimer);
      refetchTimer = null;
      tiles.clear();
      el.remove();
    },
  };
}

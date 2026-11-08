// ui/public/design/library.mjs — the Design library on `#design`, a stub (L4.16): the designs as rows, and `New design`
// for a web page only. P6 replaces it with the grid and every kind, keeping `createLibrary`. Loading, empty and failure
// follow docs/design-system.md › Empty, loading, error: nothing for 300 ms, then one line; one empty line under the
// header's `New design`; `Could not load designs` in red with `Nothing changed.` and Try again. Every string reaches the
// DOM through `textContent`. Nothing runs at load time: the window's timers are reached only through `win`.

const LOADING_DELAY_MS = 300;
const LIST_URL = '/api/design';

/** A design kind as people read it: the library's meta and the studio's kind chip. */
const KIND_WORDS = Object.freeze({ web: 'Web page', presentation: 'Presentation', pitch: 'Pitch deck', video: 'Video' });

/** @param {unknown} kind @returns {string} */
export function kindWord(kind) {
  return typeof kind === 'string' && Object.hasOwn(KIND_WORDS, kind) ? KIND_WORDS[kind] : 'Design';
}

const isObject = (v) => typeof v === 'object' && v !== null;

/** A row's meta: the kind, then what the design has cost, when it has cost anything. */
function metaOf(d) {
  const cost = Number.isFinite(d.costUsd) && d.costUsd > 0 ? [`$${d.costUsd.toFixed(2)}`] : [];
  return [kindWord(d.kind), ...cost].join(' · ');
}

/**
 * The library, appended to `host`. `show()` loads the list (again) and resolves once it is painted; a row opens its
 * design through `route(id)`, and `New design` creates a web page and routes to it.
 * @param {{doc: Document, win: Window, host: HTMLElement, fetch: Function, route: (id: string) => void}} deps
 * @returns {{show: () => Promise<void>, destroy: () => void}}
 */
export function createLibrary({ doc, win, host, fetch: fetchFn, route }) {
  const make = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const button = (cls, text) => {
    const b = make('button', cls, text);
    b.type = 'button';
    return b;
  };
  /** The house failure line: what failed in red, then each further sentence, then the actions. */
  const failLine = (title, sentences, actions = []) => {
    const line = make('div', 'empty-line is-err');
    line.setAttribute('role', 'alert');
    line.append(make('span', 'el-t', title));
    for (const s of sentences) line.append(make('span', null, s));
    if (actions.length) {
      const acts = make('span', 'el-acts');
      acts.append(...actions);
      line.append(acts);
    }
    return line;
  };

  const el = make('div', 'dz-lib');
  const head = make('div', 'dz-lib-head');
  const add = button('btn btn-primary', 'New design');
  head.append(make('h2', 'section-title', 'Designs'), add);
  // A New design refusal says so here, between the header and the list, until the next try.
  const note = make('div');
  note.hidden = true;
  const body = make('div', 'dz-lib-body');
  el.append(head, note, body);
  host.append(el);

  let destroyed = false;
  let seq = 0;
  let loadingTimer = null;
  let creating = false;

  const clearLoading = () => {
    if (loadingTimer === null) return;
    win.clearTimeout(loadingTimer);
    loadingTimer = null;
  };

  function paintList(list) {
    const rows = list.filter((d) => isObject(d) && typeof d.id === 'string' && d.id);
    if (!rows.length) {
      body.replaceChildren(make('p', 'empty-line', 'No designs yet'));
      return;
    }
    const wrap = make('div', 'drows');
    for (const d of rows) {
      const row = button('row-btn drow');
      row.append(make('span', 'dz-lib-name', typeof d.title === 'string' && d.title ? d.title : 'Untitled design'), make('span', 'dz-meta', metaOf(d)));
      row.addEventListener('click', () => { route?.(d.id); });
      wrap.append(row);
    }
    body.replaceChildren(wrap);
  }

  function paintFailure() {
    const retry = button('btn btn-sm', 'Try again');
    retry.addEventListener('click', () => { void load(); });
    body.replaceChildren(failLine('Could not load designs', ['Nothing changed.'], [retry]));
  }

  async function load() {
    if (destroyed) return;
    const my = ++seq;
    body.setAttribute('aria-busy', 'true');
    // Every new load and every answer clears it, and so does destroy: when it fires, this load is still out.
    clearLoading();
    loadingTimer = win.setTimeout(() => {
      loadingTimer = null;
      body.replaceChildren(make('p', 'empty-line', 'Loading designs…'));
    }, LOADING_DELAY_MS);
    let list = null;
    try {
      const res = await fetchFn(LIST_URL);
      list = res.ok ? await res.json() : null;
    } catch {
      list = null;
    }
    if (destroyed || my !== seq) return;
    clearLoading();
    body.removeAttribute('aria-busy');
    if (Array.isArray(list)) paintList(list);
    else paintFailure();
  }

  async function create() {
    if (destroyed || creating) return;
    creating = true;
    add.disabled = true;
    note.hidden = true;
    note.replaceChildren();
    let id = null;
    let reason = null;
    try {
      const res = await fetchFn(LIST_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'web' }) });
      let data = null;
      try { data = await res.json(); } catch { data = null; }
      if (res.ok && typeof data?.design?.id === 'string' && data.design.id) id = data.design.id;
      else if (typeof data?.error === 'string' && data.error) reason = data.error;
    } catch {
      reason = null;
    }
    creating = false;
    if (destroyed) return;
    add.disabled = false;
    if (id) {
      route?.(id);
      return;
    }
    note.replaceChildren(failLine('Could not create a design', [...(reason ? [reason] : []), 'Nothing changed.']));
    note.hidden = false;
  }
  add.addEventListener('click', () => { void create(); });

  return {
    show: () => load(),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      clearLoading();
      el.remove();
    },
  };
}

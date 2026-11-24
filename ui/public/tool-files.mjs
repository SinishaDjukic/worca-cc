// ui/public/tool-files.mjs — the Files tool (issue 1064): a read-only browser of the tab's folder (a project's own, a run
// member's, a chat's). One folder level at a time and one file as text; nothing here writes. The server keeps every
// path inside the folder (src/core/tool-folder.mjs) and resolves the folder from the tab's ids.
import { icon } from './icons.mjs';
import { scopeQuery } from './tool-tabs.mjs';
import { previewKindFor } from './artifacts/common.mjs';
import { loadPreview, NO_PREVIEW } from './artifacts/stage.mjs';
import { downloadArtifact } from './artifacts/viewer.mjs';
import { fileViewerUrls } from './chat/files-card.mjs';

export const fmtSize = (n) => {
  if (!Number.isFinite(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const last = (p) => String(p || '').split('/').filter(Boolean).at(-1) || '';

/** The shared viewer's URL set over the tool folder routes (artifacts/stage.mjs loadPreview). The raw route takes the
 *  scope as ONE path segment, so a framed deck's relative assets resolve under the same folder. */
export function toolFileUrls(scope, member = '', root = '') {
  const seg = encodeURIComponent(scopeQuery(scope, { member, root }));
  const rawOf = (rel, q = '') => `/api/tools/raw/${seg}/${String(rel).split('/').filter(Boolean).map(encodeURIComponent).join('/')}${q}`;
  return {
    text: (rel) => `/api/tools/file?${scopeQuery(scope, { path: rel, member, root })}`,
    raw: (rel) => rawOf(rel),
    download: (rel) => rawOf(rel, '?download=1'),
    pdf: (rel) => rawOf(rel, '?as=pdf'),
  };
}

/** Marks `line` (and the end of a range) in the code view's <pre>: a zero-width anchor at the line's start, a band over
 *  the range, and scrolls it into the middle. A line past the end marks the last line. → the anchor, or null. */
export function markLine(stage, line, endLine = null) {
  const pre = stage.querySelector('pre');
  if (!pre || !Number.isInteger(line) || line < 1) return null;
  const doc = pre.ownerDocument;
  const text = pre.textContent;
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0 && i < text.length - 1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const first = Math.min(line, starts.length);
  const last = Number.isInteger(endLine) && endLine > first ? Math.min(endLine, starts.length) : first;
  const anchor = (offset, cls, ln) => {
    const walker = doc.createTreeWalker(pre, 4);
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (seen + n.data.length >= offset) {
        const m = doc.createElement('span');
        m.className = cls;
        m.dataset.line = String(ln);
        m.setAttribute('aria-hidden', 'true');
        const rest = n.splitText(offset - seen);
        rest.parentNode.insertBefore(m, rest);
        return m;
      }
      seen += n.data.length;
    }
    return null;
  };
  const mark = anchor(starts[first - 1], 'tool-line-mark', first);
  if (!mark) return null;
  const end = last > first ? anchor(starts[last - 1], 'tool-line-mark is-end', last) : null;
  const band = doc.createElement('div');
  band.className = 'tool-line-band';
  band.setAttribute('aria-hidden', 'true');
  band.dataset.start = String(first);
  band.dataset.end = String(last);
  const lh = parseFloat(doc.defaultView?.getComputedStyle?.(pre).lineHeight) || 18;
  pre.style.position = 'relative';   // FIRST: the marks' offsetTop must be measured against the <pre> (jsdom reads 0 either way)
  pre.style.isolation = 'isolate';   // the band's z-index:-1 paints above the <pre>'s background but under its text
  band.style.top = `${mark.offsetTop}px`;
  band.style.height = `${(end ? end.offsetTop - mark.offsetTop : 0) + lh}px`;
  pre.append(band);
  if (typeof mark.scrollIntoView === 'function') mark.scrollIntoView({ block: 'center' });
  return mark;
}

export function createFilesKind({ doc, fetch, previewDeps = () => ({}) }) {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const button = (cls, text) => { const b = make('button', cls, text); b.type = 'button'; return b; };
  const epochs = new Map();     // tab id → draw number: a later draw (or the tab leaving) wins over an answer in flight
  async function getJson(url) {
    const r = await fetch(url);
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) throw Object.assign(new Error((j && j.error) || `HTTP ${r.status}`), { status: r.status, code: j && j.code });
    return j;
  }

  /** `focus`: a step the user took (a row, a crumb, Back, the member pick) — the redraw replaces the focused control, so
   *  the focus waits on the tool while it loads and then lands on the first row (or Back), never on <body>. */
  async function draw(tab, host, api, { focus = false } = {}) {
    const epoch = (epochs.get(tab.id) || 0) + 1;
    epochs.set(tab.id, epoch);
    const live = () => epochs.get(tab.id) === epoch && api.isMounted(tab.id);
    const go = (patch) => { api.setTabState(tab.id, patch); const t = api.tab(tab.id); if (t) draw(t, host, api, { focus: true }); };
    const path = typeof tab.state.path === 'string' ? tab.state.path : '';
    const file = typeof tab.state.file === 'string' ? tab.state.file : '';
    const member = typeof tab.state.member === 'string' ? tab.state.member : '';
    const root = typeof tab.state.root === 'string' ? tab.state.root : '';
    const wrap = make('div', 'tool-files');
    const crumbs = make('nav', 'tool-crumbs');
    crumbs.setAttribute('aria-label', 'Folder');
    const main = make('div', 'tool-files-main');
    main.append(make('p', 'tool-note', 'Loading…'));
    wrap.append(crumbs, main);
    main.tabIndex = -1;
    host.replaceChildren(wrap);
    if (focus) main.focus();
    if (typeof tab.state.att === 'string' && tab.state.att) {
      const scope = api.scopeFor(tab);
      const urls = fileViewerUrls(scope.id);   // ./chat/files-card.mjs: the same raw/download/text/pdf URLs the card's viewer uses
      const name = typeof tab.state.attName === 'string' ? tab.state.attName : 'file';
      const out = { path: `${tab.state.att}/${name}`, size: Number(tab.state.attBytes) || 0, truncated: false, text: undefined, binary: undefined };
      crumbs.replaceChildren(make('span', 'tool-file-copy', 'Chat copy'));
      crumbs.firstChild.title = 'A copy the chat stored when it showed this file; the original may have changed since.';
      const view = fileView(out, null, { tab, api, urls, live, copy: { name, kind: typeof tab.state.attKind === 'string' ? tab.state.attKind : null } });
      main.replaceChildren(view.el);
      return;
    }
    try {
      const scope = api.scopeFor(tab);
      const out = file
        ? await getJson(`/api/tools/file?${scopeQuery(scope, { path: file, member, root })}`)
        : await getJson(`/api/tools/files?${scopeQuery(scope, { path, member, root })}`);
      if (!live()) return;
      paintCrumbs(crumbs, out.root, file ? file.split('/').slice(0, -1).join('/') : path, go, !file);
      if (file) {
        const view = fileView(out, () => go({ file: undefined, line: undefined, endLine: undefined }), { tab, api, urls: toolFileUrls(scope, member, root), live });
        main.replaceChildren(view.el);
        if (focus) (main.querySelector('.tool-file-back') || main).focus();
      } else {
        main.replaceChildren(listView(out, path, go));
        if (focus) (main.querySelector('.tool-files-row:not(:disabled)') || main).focus();
      }
    } catch (e) {
      if (!live()) return;
      if (e.code === 'SCOPE_GONE') { api.close(tab.id); return; }
      main.replaceChildren(make('p', 'tool-note tool-error', e.message));
    }
  }

  function paintCrumbs(nav, root, path, go, atFolder) {
    nav.replaceChildren();
    const parts = path ? path.split('/') : [];
    const crumb = (text, rel, current) => {
      const b = button('tool-crumb', text);
      if (current) b.setAttribute('aria-current', 'location');
      else b.addEventListener('click', () => go({ path: rel || undefined, file: undefined, line: undefined, endLine: undefined }));
      return b;
    };
    nav.append(crumb(root?.label || 'Folder', '', atFolder && !parts.length));
    parts.forEach((seg, i) => {
      nav.append(make('span', 'tool-crumb-sep', '/'));
      nav.append(crumb(seg, parts.slice(0, i + 1).join('/'), atFolder && i === parts.length - 1));
    });
    if (Array.isArray(root?.members) && root.members.length > 1) {
      const sel = make('select', 'tool-member');
      sel.setAttribute('aria-label', 'Project');
      for (const m of root.members) { const o = make('option', null, m.projectName); o.value = m.projectKey; o.selected = m.projectKey === root.member; sel.append(o); }
      sel.addEventListener('change', () => go({ member: sel.value, path: undefined, file: undefined }));
      nav.append(sel);
    }
  }

  function listView(out, path, go) {
    const box = make('div', 'tool-files-listbox');
    const list = make('ul', 'tool-files-list');
    if (path) {
      const li = make('li', 'tool-files-item');
      const up = button('tool-files-row is-up');
      up.append(icon(doc, 'arrow-up', 14), make('span', 'tool-files-name', 'Up one folder'));
      up.addEventListener('click', () => go({ path: path.split('/').slice(0, -1).join('/') || undefined }));
      li.append(up);
      list.append(li);
    }
    for (const e of out.entries || []) {
      const isDir = e.type === 'dir' || (e.type === 'link' && e.target === 'dir');
      const isFile = e.type === 'file' || (e.type === 'link' && e.target === 'file');
      const li = make('li', 'tool-files-item');
      const b = button(`tool-files-row is-${e.type}`);
      b.disabled = !isDir && !isFile;
      if (e.type === 'link' && !e.target) b.title = 'This link leads outside the folder';
      b.append(icon(doc, isDir ? 'folder' : 'file', 14), make('span', 'tool-files-name', e.name));
      if (e.type === 'file' && Number.isFinite(e.size)) b.append(make('span', 'tool-files-size', fmtSize(e.size)));
      const rel = path ? `${path}/${e.name}` : e.name;
      b.addEventListener('click', () => go(isDir ? { path: rel, file: undefined, line: undefined, endLine: undefined } : { file: rel, line: undefined, endLine: undefined }));
      li.append(b);
      list.append(li);
    }
    box.append(list);
    if (!(out.entries || []).length) box.append(make('p', 'tool-note', 'This folder is empty.'));
    if (out.truncated) box.append(make('p', 'tool-note', `Showing the first ${out.entries.length} entries.`));
    return box;
  }

  /** One file in the shared viewer (artifacts/stage.mjs): the head (Folder, path, size and, for markdown, Preview /
   *  Source), the stage, and the cut note. → { el, ready } — `ready` settles once the first preview has rendered. */
  function fileView(out, back, { tab, api, urls, live, copy = null }) {
    const v = make('div', 'tool-file');
    const head = make('div', 'tool-file-head');
    if (back) {
      const b = button('btn btn-sm btn-quiet tool-file-back');
      b.append(icon(doc, 'chevron-left', 14), make('span', null, 'Folder'));
      b.addEventListener('click', back);
      head.append(b);
    }
    const name = make('span', 'tool-file-path mono', copy ? copy.name : out.path);
    name.title = copy ? copy.name : out.path;
    head.append(name);
    const line = Number.isInteger(tab.state.line) && tab.state.line > 0 ? tab.state.line : null;
    const endLine = line && Number.isInteger(tab.state.endLine) && tab.state.endLine > line ? tab.state.endLine : null;
    if (line) head.append(make('span', 'tool-file-line', endLine ? `Lines ${line}–${endLine}` : `Line ${line}`));
    const isMd = previewKindFor(copy?.kind || null, copy ? copy.name : out.path) === 'markdown';
    let toggle = null;
    if (isMd) {
      toggle = make('div', 'seg tool-file-mode');
      toggle.setAttribute('role', 'group');
      toggle.setAttribute('aria-label', 'Markdown view');
      for (const [mode, label] of [['preview', 'Preview'], ['source', 'Source']]) {
        const m = button(null, label);
        m.dataset.mode = mode;
        toggle.append(m);
      }
      head.append(toggle);
    }
    head.append(make('span', 'tool-files-size', fmtSize(out.size)));
    let seq = 0;
    let stage = make('div', 'tool-file-stage artifact-view');
    stage.tabIndex = 0;                                   // keyboard scrolling
    v.append(head, stage);
    if (out.truncated) v.append(make('p', 'tool-note', `Showing the first ${fmtSize(out.shown)} of ${fmtSize(out.size)}.`));
    const paint = async () => {
      const mine = ++seq;
      const ok = () => live() && mine === seq;            // a later toggle (or draw) wins over a load in flight
      const source = isMd && (tab.state.mdView === 'source' || (Number.isInteger(tab.state.line) && tab.state.mdView !== 'preview'));
      if (toggle) for (const m of toggle.children) m.setAttribute('aria-pressed', String((m.dataset.mode === 'source') === source));
      // A fresh stage per paint (as the popup's show()): renderPreview never re-checks `live`, so a load still in flight
      // must render into a detached node, never over a newer view.
      const s = make('div', 'tool-file-stage artifact-view');
      s.tabIndex = 0;
      s.append(make('p', 'tool-note', 'Loading…'));
      stage.replaceWith(s);
      stage = s;
      let res;
      try {
        res = await loadPreview({ artifact: { kind: null, relPath: out.path, ...(source ? { previewKind: 'code' } : copy?.kind ? { previewKind: copy.kind } : {}) },
          stage: s, urls, fetch, deps: previewDeps(), live: ok, size: out.size, ...(copy ? {} : { known: { text: out.text, binary: out.binary } }) });
      } catch { res = { state: 'error', message: 'Could not load' }; }
      if (!ok() || res.state === 'stale') return;
      if (res.state === 'info') s.replaceChildren(infoBox(res.reason, out.path, urls));
      else if (res.state === 'error') s.replaceChildren(make('p', 'tool-note tool-error', res.message));
      else if (res.media) {
        const dead = () => { if (ok()) s.replaceChildren(infoBox(NO_PREVIEW, out.path, urls)); };
        res.media.addEventListener('error', dead, { once: true });
        if (res.media.error) dead();
      }
      // Rendered markdown has no line map: mark only a code or text view (else the first fenced block's <pre> took it).
      if (line && !(isMd && !source) && res.state !== 'info' && res.state !== 'error') markLine(s, line, endLine);
    };
    if (toggle) toggle.addEventListener('click', (e) => {
      const m = e.target.closest('button[data-mode]');
      if (!m || m.getAttribute('aria-pressed') === 'true') return;
      api.setTabState(tab.id, { mdView: m.dataset.mode === 'source' ? 'source' : 'preview' });
      paint().then(() => { if (live() && m.isConnected) m.focus(); });
    });
    return { el: v, ready: paint() };
  }

  /** No preview here: why, and Download (the viewer's probe-then-save: a 404 is never saved as the file). */
  function infoBox(reason, rel, urls) {
    const box = make('div', 'tool-file-info');
    box.append(make('p', 'tool-note', reason));
    const dl = button('btn btn-sm', 'Download');
    const msg = make('p', 'tool-note tool-error');
    msg.hidden = true;
    dl.addEventListener('click', async () => {
      const r = await downloadArtifact({ doc, fetch, url: urls.download(rel), name: last(rel) });
      if (!r.ok) { msg.textContent = `Download failed: ${r.error}`; msg.hidden = false; }
    });
    box.append(dl, msg);
    return box;
  }

  return {
    kind: 'files', label: 'Files', icon: 'folder', order: 30,
    shortcut: { code: 'KeyE', key: 'E', ctrl: true, shift: true, label: 'Ctrl+Shift+E' },
    title: (tab) => tab.state.attName || last(tab.state.file) || last(tab.state.path) || 'Files',
    mount: (tab, host, api) => draw(tab, host, api),
    focus: () => { const h = doc.querySelector('.tool-panel .tool-body[data-kind="files"] .tool-file-stage, .tool-panel .tool-body[data-kind="files"] .tool-files-row:not(:disabled)'); h?.focus(); },
    unmount: (tab) => { epochs.set(tab.id, (epochs.get(tab.id) || 0) + 1); },
  };
}

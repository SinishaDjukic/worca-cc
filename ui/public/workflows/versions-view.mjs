// ui/public/workflows/versions-view.mjs — the Versions page of a workflow (plans/workflow-tests-plan.md Task 8;
// canvas board 7). Pure DOM: app.js owns data and actions. Words per D10.
const SOURCE_TEXT = { save: 'Saved', defaults: 'Step defaults changed', restore: 'Restored', delete: 'Deleted', version: 'Version saved' };

const el = (doc, tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const btn = (doc, label, onClick, cls = 'btn btn-sm') => { const b = el(doc, 'button', cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
/** Row buttons share a short label; the accessible name says which version or save it acts on. */
const named = (b, label) => { b.setAttribute('aria-label', label); return b; };
/** A data-focus-key per button: app.js puts the focus back on it after a repaint, and a closing dialog finds it (layers.mjs). */
const keyed = (b, key) => { b.dataset.focusKey = key; return b; };
const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };

/**
 * @param {HTMLElement} root
 * @param {{name:string, liveVersionNo:number|null, draft:null|{changed:boolean, changes:string[]}, versions:Array, history:Array}} o
 * @param {{saveVersion:Function, useVersion:Function, restore:Function, openCanvas:Function}} actions
 * @param {{doc: Document, error?: string|null}} ctx  error: why there is no overview (the server's reason, or no answer)
 */
export function renderVersionsPage(root, o, actions, { doc, error = null }) {
  root.replaceChildren();
  const wrap = el(doc, 'div', 'wfv-vpage');
  wrap.append(el(doc, 'p', 'subtitle', 'Your changes stay in a draft until you choose Save version. Every run remembers which version it used, so you can always go back.'));

  if (!o && error) {
    const box = el(doc, 'div', 'card wfv-vempty');
    box.append(el(doc, 'h2', '', 'Versions are not available'), el(doc, 'p', 'hint', error));
    wrap.append(box);
  } else if (!o || !Array.isArray(o.versions) || !o.versions.length) {
    const empty = el(doc, 'div', 'card wfv-vempty');
    empty.append(el(doc, 'h2', '', 'No versions yet'),
      el(doc, 'p', 'hint', 'New runs use what you last saved. Save a version to keep this state; after that, you choose when new runs get your changes.'),
      keyed(btn(doc, 'Save version', () => actions.saveVersion(), 'btn btn-primary'), 'vp:save'));
    wrap.append(empty);
  } else {
    const table = el(doc, 'div', 'card wfv-vt');
    const draft = el(doc, 'div', 'wfv-vt-draft');
    const d = o.draft;
    const what = d && d.changed ? d.changes.join(' · ') : `Same as v${o.liveVersionNo}`;
    draft.append(el(doc, 'span', 'wfv-vt-no', 'Draft'),
      (() => { const c = el(doc, 'span', 'wfv-vt-main'); c.append(el(doc, 'b', '', 'Your draft'), el(doc, 'span', 'hint', what)); return c; })(),
      keyed(btn(doc, 'Save version', () => actions.saveVersion(), 'btn btn-sm btn-primary'), 'vp:save'));
    table.append(draft);
    for (const v of o.versions) {
      const row = el(doc, 'div', 'wfv-vt-row');
      const main = el(doc, 'span', 'wfv-vt-main');
      const head = el(doc, 'span', 'wfv-vt-head');
      head.append(el(doc, 'b', '', v.note || v.changes[0] || `Version ${v.versionNo}`));
      if (v.inUse) head.append(el(doc, 'span', 'badge wfv-inuse', 'New runs use this'));
      main.append(head, el(doc, 'span', 'hint', [when(v.createdAt), v.by].filter(Boolean).join(' · ')),
        el(doc, 'span', 'hint', v.changes.join(' · ')));
      const used = el(doc, 'span', 'wfv-vt-used', v.runs === 1 ? 'Used once' : `Used ${v.runs} times`);
      const acts = el(doc, 'span', 'wfv-vt-acts');
      if (!v.inUse) acts.append(keyed(named(btn(doc, 'Use for new runs', () => actions.useVersion(v.versionNo)), `Use v${v.versionNo} for new runs`), `vp:use:${v.versionNo}`));
      acts.append(keyed(named(btn(doc, 'Restore into draft', () => actions.restore(v.id, `v${v.versionNo}`), 'btn btn-sm btn-quiet'), `Restore v${v.versionNo} into draft`), `vp:restore:${v.id}`));
      row.append(el(doc, 'span', 'wfv-vt-no', `v${v.versionNo}`), main, used, acts);
      table.append(row);
    }
    wrap.append(table);
  }

  if (o && Array.isArray(o.history) && o.history.length) {
    const hist = el(doc, 'section', 'wfv-vh');
    hist.setAttribute('aria-label', 'Every save');
    hist.append(el(doc, 'h2', '', 'Every save'), el(doc, 'p', 'hint', 'Worca keeps the last 50 saves of this workflow, so any change can be undone.'));
    for (const h of o.history) {
      const row = el(doc, 'div', 'wfv-vh-row');
      const text = `${SOURCE_TEXT[h.source] || 'Saved'}${h.by ? ` by ${h.by}` : ''}`;
      row.append(el(doc, 'span', 'wfv-vh-when', when(h.createdAt)), el(doc, 'span', 'wfv-vh-what', text),
        keyed(named(btn(doc, 'Restore', () => actions.restore(h.id, `the save of ${when(h.createdAt)}`), 'btn btn-sm btn-quiet'), `Restore the save of ${when(h.createdAt)} into draft`), `vp:history:${h.id}`));
      hist.append(row);
    }
    wrap.append(hist);
  }
  root.append(wrap);
}

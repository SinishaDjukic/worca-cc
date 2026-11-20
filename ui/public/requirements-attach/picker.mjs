// Multi-select attach picker: a form-kind dialog (a backdrop click never closes it) with a search box, native
// checkboxes and an "Attach N" button. It only reads through the injected `searchFn` and writes to the injected
// store; it never POSTs a run or a message.
import { createDocumentModal } from '../feature-pull/modal.mjs';
import { MAX_ATTACHED } from './store.mjs';

const MSG_LIMIT = `You can attach up to ${MAX_ATTACHED} features.`;
const MSG_EMPTY = 'No features to attach.';
const MSG_NO_SCOPE = 'Pick a project first.';
const MSG_LOAD_FAILED = 'The features could not be loaded.';
const LABEL_NOT_READY = 'Not Ready yet';
const SEARCH_DEBOUNCE_MS = 150;

function h(doc, tag, attrs = {}, ...kids) {
  const node = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

/**
 * Open the picker. `scope` is `{scopeType, scopeKey}`, null (unset), or a function returning either — re-read after
 * `onProject`, so the caller can apply the chosen project and the picker then searches it. `projects` is
 * `[{key, name}]` for the inline chooser. `searchFn({scopeType, scopeKey, q, exclude})` resolves `{features}`.
 * Resolves `{attached}` once the dialog ends.
 */
export function openAttachPicker({
  store, scope, searchFn, onProject, projects = [], modal, trigger = null, doc = globalThis.document,
}) {
  const dialogs = modal || createDocumentModal({ document: doc });
  const currentScope = () => (typeof scope === 'function' ? scope() : scope) || null;

  return new Promise((resolve) => {
    let settled = false;
    let features = [];
    let selected = new Map();     // seq -> feature item
    let seq = 0;                  // search generation: only the latest response paints
    let timer = null;
    let loading = false;
    let failed = false;

    const search = h(doc, 'input', { type: 'search', class: 'input', 'data-ui': 'attach-pick-search', 'aria-label': 'Search features', placeholder: 'Search features' });
    const list = h(doc, 'div', { class: 'feature-pick-list', 'data-ui': 'attach-pick-list' });
    const limit = h(doc, 'p', { class: 'hint', role: 'alert', 'data-ui': 'attach-pick-limit', hidden: true, text: MSG_LIMIT });
    const attach = h(doc, 'button', { type: 'button', class: 'btn btn-primary', 'data-ui': 'attach-pick-attach', disabled: true, text: 'Attach 0' });
    const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'attach-pick-cancel', text: 'Cancel' });
    const chooser = h(doc, 'div', { class: 'feature-pick-project', 'data-ui': 'attach-pick-project-wrap', hidden: true });
    const card = h(doc, 'div', { class: 'req-dlg feature-pick', role: 'dialog', 'aria-label': 'Attach features from Requirements' },
      h(doc, 'h3', { text: 'Attach features from Requirements' }), chooser, search, list, limit,
      h(doc, 'div', { class: 'req-dlg-btns' }, cancel, attach));

    const overLimit = () => store.get().items.length + selected.size > MAX_ATTACHED;

    function finish(attached) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ attached });
    }

    function syncFooter() {
      const over = overLimit();
      attach.textContent = `Attach ${selected.size}`;
      attach.disabled = selected.size === 0 || over;
      limit.hidden = !over;
    }

    const note = (text) => list.replaceChildren(h(doc, 'p', { class: 'hint', 'data-ui': 'attach-pick-note', text }));

    function row(f) {
      const startable = f.startable !== false;
      const id = `attach-pick-${f.seq}`;
      const box = h(doc, 'input', { type: 'checkbox', id, disabled: !startable });
      box.checked = startable && selected.has(f.seq);
      box.addEventListener('change', () => {
        if (!startable) { box.checked = false; return; }
        selected = new Map(selected);
        if (box.checked) selected.set(f.seq, f); else selected.delete(f.seq);
        syncFooter();
      });
      const meta = [f.id, Number.isInteger(f.criteriaCount) ? `${f.criteriaCount} ${f.criteriaCount === 1 ? 'criterion' : 'criteria'}` : null].filter(Boolean).join(' · ');
      return h(doc, 'label', { class: 'feature-pick-row', 'data-ui': 'attach-pick-row', 'aria-disabled': startable ? null : 'true', for: id },
        box, ' ',
        h(doc, 'span', { class: 'feature-pick-title', text: String(f.title || '') }), ' ',
        meta ? h(doc, 'span', { class: 'hint', text: meta }) : null,
        startable ? null : h(doc, 'span', { class: 'badge', text: f.label || LABEL_NOT_READY }));
    }

    function paint() {
      if (!currentScope()) { note(MSG_NO_SCOPE); return; }
      if (loading) { note('Loading…'); return; }
      if (failed) { note(MSG_LOAD_FAILED); return; }
      if (!features.length) { note(MSG_EMPTY); return; }
      list.replaceChildren(...features.map(row));
    }

    async function load() {
      const sc = currentScope();
      const mine = ++seq;
      if (!sc) { features = []; loading = false; failed = false; paint(); return; }
      loading = true; failed = false; paint();
      try {
        const data = await searchFn({
          scopeType: sc.scopeType, scopeKey: sc.scopeKey, q: search.value.trim(),
          exclude: store.get().items.map((i) => i.seq),
        });
        if (settled || mine !== seq) return;
        features = Array.isArray(data?.features) ? data.features : [];
      } catch (err) {
        if (settled || mine !== seq) return;
        console.warn('[worca] attach search failed', err);
        features = [];
        failed = true;
      }
      loading = false;
      paint();
    }

    function buildChooser() {
      if (currentScope()) { chooser.hidden = true; chooser.replaceChildren(); return; }
      const select = h(doc, 'select', { class: 'input', 'data-ui': 'attach-pick-project', 'aria-label': 'Project' },
        h(doc, 'option', { value: '', text: 'Choose a project' }),
        projects.map((p) => h(doc, 'option', { value: p.key, text: p.name || p.key })));
      select.addEventListener('change', async () => {
        if (!select.value) return;
        try {
          await onProject?.(select.value);
        } catch (err) {
          console.warn('[worca] choosing a project failed', err);
        }
        if (settled) return;
        buildChooser();
        void load();
      });
      chooser.replaceChildren(select);
      chooser.hidden = false;
    }

    search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => { void load(); }, SEARCH_DEBOUNCE_MS);
    });
    cancel.addEventListener('click', () => { dialogs.close(true); });
    attach.addEventListener('click', () => {
      if (attach.disabled) return;
      const res = store.add([...selected.values()]);
      if (!res.ok) { syncFooter(); return; }
      finish(true);
      dialogs.close(true);
    });

    buildChooser();
    syncFooter();
    dialogs.open(card, { trigger, first: search, canClose: () => true, onClose: () => finish(false) });
    void load();
  });
}

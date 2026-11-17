// The "pull from Requirements" picker: a modal list of the scope's active features, searchable by name.
import { STATE, readyText } from './labels.mjs';

const MSG_EMPTY = 'No active features in Requirements yet.';
const MSG_NO_MATCH = 'No features match';
const MSG_NO_SCOPE = 'Pick a project or workspace first';
const MSG_LOAD_FAILED = 'The features could not be loaded.';

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
 * Open the picker in `modal` (an adapter `{open, close}`). `fetchJson(url)` resolves the parsed JSON body.
 * `onPick(summary)` gets the chosen feature, after the picker has closed; `onClose({ picked })` fires once, on every way the picker ends.
 * `trigger` is the button focus returns to.
 */
export function openFeaturePicker({ modal, fetchJson, scope, trigger = null, onPick, onClose, document: doc = globalThis.document }) {
  let closed = false;
  let features = [];
  let query = '';
  let loading = false;

  const search = h(doc, 'input', { type: 'search', class: 'input', 'data-ui': 'feature-pick-search', 'aria-label': 'Search features', placeholder: 'Search features' });
  const list = h(doc, 'div', { class: 'feature-pick-list', 'data-ui': 'feature-pick-list' });
  const cancel = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'feature-pick-cancel', text: 'Cancel' });
  const card = h(doc, 'div', { class: 'req-dlg feature-pick', role: 'dialog', 'aria-label': 'Pull a feature from Requirements' },
    h(doc, 'h3', { text: 'Pull a feature from Requirements' }), search, list, h(doc, 'div', { class: 'req-dlg-btns' }, cancel));

  function finish(picked = false) {
    if (closed) return false;
    closed = true;
    if (typeof onClose === 'function') onClose({ picked });
    return true;
  }
  function pick(summary) {
    if (closed) return;
    if (finish(true)) modal.close(false);
    if (typeof onPick === 'function') Promise.resolve().then(() => onPick(summary)).catch((err) => console.warn('[worca] picking a feature failed', err));
  }
  const note = (text, ...extra) => list.replaceChildren(h(doc, 'p', { class: 'hint', 'data-ui': 'feature-pick-note', text }), ...extra);

  function paint() {
    if (!scope) { note(MSG_NO_SCOPE); return; }
    if (loading) { note('Loading…'); return; }
    if (!features.length) { note(MSG_EMPTY); return; }
    const q = query.trim().toLowerCase();
    const shown = q ? features.filter((f) => String(f.title || '').toLowerCase().includes(q)) : features;
    if (!shown.length) { note(MSG_NO_MATCH); return; }
    list.replaceChildren(...shown.map((f) => {
      const row = h(doc, 'button', { type: 'button', class: 'feature-pick-row', 'data-ui': 'feature-pick-row' },
        h(doc, 'span', { class: 'feature-pick-title', text: String(f.title || '') }), ' ',
        h(doc, 'span', { class: `badge ${(STATE[f.state] && STATE[f.state].cls) || ''}`.trim(), text: (STATE[f.state] && STATE[f.state].label) || String(f.state || '') }), ' ',
        h(doc, 'span', { class: 'hint', text: readyText(f) }));
      row.addEventListener('click', () => pick(f));
      return row;
    }));
  }

  async function load() {
    loading = true; paint();
    const url = `/api/requirements?scopeType=${encodeURIComponent(scope.scopeType)}&scopeKey=${encodeURIComponent(scope.scopeKey)}`;
    try {
      const data = await fetchJson(url);
      if (closed) return;
      features = ((data && data.features) || []).filter((f) => f && f.status !== 'archived' && f.state !== 'archived');
      loading = false; paint();
    } catch {
      if (closed) return;
      loading = false;
      const retry = h(doc, 'button', { type: 'button', class: 'btn', 'data-ui': 'feature-pick-retry', text: 'Retry' });
      retry.addEventListener('click', () => { void load(); });
      note(MSG_LOAD_FAILED, retry);
    }
  }

  search.addEventListener('input', () => { query = search.value; if (!loading && features.length) paint(); });
  cancel.addEventListener('click', () => { if (finish()) modal.close(true); });

  modal.open(card, { trigger, first: search, canClose: () => true, onClose: () => { finish(); } });
  if (scope) void load(); else paint();
}

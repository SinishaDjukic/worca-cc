// `#` search popover for a composer textarea. Typing `#query` lists matching Requirements features; Enter attaches
// the highlighted one. While open it claims ArrowUp/Down, Enter, Tab and Esc through handleKey(), so Enter can
// never send a message or start a run. It reads through the injected `searchFn` and writes to the injected store.
import { MAX_ATTACHED } from './store.mjs';
import { findHashToken, stripToken } from './hash-token.mjs';

const MSG_NO_SCOPE = 'Pick a project first. Press Tab to choose one.';
const MSG_EMPTY = 'No matching features.';
const MSG_LOADING = 'Loading…';
const MSG_FAILED = 'The features could not be loaded.';
const MSG_LIMIT = `You can attach up to ${MAX_ATTACHED} features.`;
const LABEL_NOT_READY = 'Not Ready yet';

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
 * `getScope()` returns `{scopeType, scopeKey}` or null. `searchFn({scopeType, scopeKey, q, exclude})` resolves
 * `{features}`. `position(textarea, caret)` returns `{top, left}` (numbers, px) for the popover. `onProjectCycle()`
 * is the host's scope-guarded project switch.
 * @returns {{handleKey(e): boolean, onInput(): void, close(): void}}
 */
export function attachHashSearch({
  textarea, getScope, store, searchFn, onProjectCycle, position, doc = globalThis.document,
}) {
  let popup = null;
  let features = [];
  let sel = 0;
  let note = '';
  let limitHit = false;
  let seq = 0;            // search generation: only the latest response paints

  const isOpen = () => popup !== null;
  const scope = () => (typeof getScope === 'function' ? getScope() : null) || null;
  const tokenNow = () => findHashToken(textarea.value, textarea.selectionStart);

  function place() {
    const pos = position?.(textarea, textarea.selectionStart);
    if (!pos) return;
    if (Number.isFinite(pos.top)) popup.style.top = `${pos.top}px`;
    if (Number.isFinite(pos.left)) popup.style.left = `${pos.left}px`;
  }

  function close() {
    seq += 1;
    popup?.remove();
    popup = null;
    features = [];
    sel = 0;
    note = '';
    limitHit = false;
  }

  function attachAt(index) {
    const item = features[index];
    const tok = tokenNow();
    if (!item || item.startable === false || !tok) return;
    const res = store.add([item]);
    if (!res.ok) {
      limitHit = true;
      paint();
      return;
    }
    const next = stripToken(textarea.value, tok);
    textarea.value = next.text;
    textarea.setSelectionRange(next.caret, next.caret);
    close();
    const View = doc.defaultView;
    textarea.dispatchEvent(new View.Event('input', { bubbles: true }));
  }

  function row(f, index) {
    const startable = f.startable !== false;
    const meta = [f.id, Number.isInteger(f.criteriaCount) ? `${f.criteriaCount} ${f.criteriaCount === 1 ? 'criterion' : 'criteria'}` : null].filter(Boolean).join(' · ');
    const el = h(doc, 'div', {
      class: `mention-item${index === sel ? ' sel' : ''}`, role: 'option', 'data-ui': 'attach-hash-row',
      'aria-selected': index === sel ? 'true' : 'false', 'aria-disabled': startable ? null : 'true',
    }, String(f.title || ''), meta ? ` ${meta}` : null, startable ? null : ` ${f.label || LABEL_NOT_READY}`);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      sel = index;
      attachAt(index);
    });
    return el;
  }

  function paint() {
    if (!popup) return;
    const children = note
      ? [h(doc, 'p', { class: 'hint', 'data-ui': 'attach-hash-note', text: note })]
      : features.map(row);
    if (limitHit) children.push(h(doc, 'p', { class: 'hint', role: 'alert', 'data-ui': 'attach-hash-limit', text: MSG_LIMIT }));
    popup.replaceChildren(...children);
    place();
  }

  function ensurePopup() {
    if (popup) return;
    popup = h(doc, 'div', { class: 'mention-popup', role: 'listbox', 'aria-label': 'Requirements features', 'data-ui': 'attach-hash-popup' });
    doc.body.append(popup);
  }

  async function load(q) {
    const sc = scope();
    const mine = ++seq;
    if (!sc) { features = []; note = MSG_NO_SCOPE; paint(); return; }
    note = MSG_LOADING;
    paint();
    try {
      const data = await searchFn({
        scopeType: sc.scopeType, scopeKey: sc.scopeKey, q,
        exclude: store.get().items.map((i) => i.seq),
      });
      if (mine !== seq) return;
      features = Array.isArray(data?.features) ? data.features : [];
      note = features.length ? '' : MSG_EMPTY;
    } catch (err) {
      if (mine !== seq) return;
      console.warn('[worca] hash search failed', err);
      features = [];
      note = MSG_FAILED;
    }
    sel = 0;
    paint();
  }

  function onInput() {
    const tok = tokenNow();
    if (!tok) { close(); return; }
    ensurePopup();
    limitHit = false;
    void load(tok.query);
  }

  function move(delta) {
    if (!features.length) return;
    sel = Math.min(features.length - 1, Math.max(0, sel + delta));
    paint();
  }

  function handleKey(e) {
    if (!isOpen()) return false;
    if (!tokenNow()) { close(); return false; }   // the caret left the `#` token without an input event: the keys are the page's again
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); return true;
      case 'ArrowUp': e.preventDefault(); move(-1); return true;
      case 'Enter': e.preventDefault(); attachAt(sel); return true;
      case 'Tab':
        e.preventDefault();
        onProjectCycle?.();
        if (isOpen()) onInput();
        return true;
      case 'Escape': e.preventDefault(); close(); return true;
      default: return false;
    }
  }

  return { handleKey, onInput, close };
}

// ui/public/ask/form-renderer.mjs
// The host renderer for a `kind:'form'` ask (ask-forms design §6). It owns the
// ANSWER state, `when` visibility, the error slots and disposal; the widget
// tables own the drawing. Module convention (ui/public/script-forms.mjs): `doc`
// arrives via opts, the tree is detached, nothing fetches and no listener is
// added outside the returned tree.
//
// Depth 3 from ui/public/: `../../../src/shared/forms/<file>.mjs` is the URL the
// /src/shared mount serves AND the disk path — test/shared-graph-purity.test.mjs
// pins that equality. Never copy a shared function here.
import { ASK_CATALOG_VERSION } from '../../../src/shared/forms/catalog.mjs';
import { effectiveItem, whenOk, visibleFields } from '../../../src/shared/forms/layout.mjs';
import { collectAnswer } from '../../../src/shared/forms/answer.mjs';
import { h } from './dom.mjs';
import { INPUT_WIDGETS_TABLE, EMPTY } from './widgets-input.mjs';
import { DISPLAY_WIDGETS_TABLE } from './widgets-display.mjs';
import { LAYOUT_WIDGETS_TABLE } from './widgets-layout.mjs';

// Every mount gets its own id prefix: the run card and the run detail hold a
// panel for the SAME ask at once, and duplicate ids would cross-wire their labels.
let mountSeq = 0;

// `gallery` lives in both tables and is the SAME function (widgetClass pins
// "input iff item.field"); the input table is applied last so its entries win
// for any other name that ever collides.
const WIDGETS = Object.assign(Object.create(null),
  DISPLAY_WIDGETS_TABLE, LAYOUT_WIDGETS_TABLE, INPUT_WIDGETS_TABLE);

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function seedDefaults(props) {
  const out = Object.create(null);           // `__proto__` as a field name must not set a prototype
  for (const [k, s] of Object.entries(props || {})) {
    if (s && s.default !== undefined) out[k] = clone(s.default);
  }
  return out;
}

/**
 * @param {object} ask  the P2 envelope: { layout, answerSchema, data, files, … }
 * @param {object} opts
 *   doc            target document (required in practice)
 *   fileUrl        (index) => string  — GET …/ask-files/:askId/:index
 *   readonly       History renders the stored answer, disabled
 *   values         pre-set values (History, or a re-render)
 *   onChange       ({ values, errors }) => void, after every edit
 *   loadText       (index) => Promise<string> — the HOST's fetch seam (W5)
 *   markdown       (text) => { kind: 'md', frag } | { kind: 'plain' }
 *   highlight      (el) => Promise<void>
 *   catalogVersion host askCatalog version for `requires` / `fallback`
 */
export function renderAskForm(ask, {
  doc = globalThis.document,
  fileUrl = null, readonly = false, values = null, onChange = null,
  loadText = null, markdown = null, highlight = null,
  catalogVersion = ASK_CATALOG_VERSION,
} = {}) {
  const schema = (ask && ask.answerSchema) || { type: 'object', properties: {} };
  const props = schema.properties || {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const layout = Array.isArray(ask && ask.layout) ? ask.layout : [];
  const files = Array.isArray(ask && ask.files) ? ask.files : [];
  const base = `af${(mountSeq += 1)}-`;
  const ro = Boolean(readonly);

  // A null-prototype object: a field named `constructor` or `__proto__` (agent
  // vocabulary gate 1 admits as an own answer property) must neither read an
  // inherited function back into a control nor rewrite the prototype on write.
  const state = Object.assign(Object.create(null),
    values && typeof values === 'object' ? clone(values) : seedDefaults(props));
  const conds = [];          // { el, when }
  const slots = new Map();   // field -> role=alert element
  const mdBoxes = [];        // { el, text }
  const disposers = [];
  let disposed = false;

  function clearError(field) {
    const slot = slots.get(field);
    if (!slot) return;
    slot.textContent = '';
    slot.hidden = true;
    const fld = slot.parentNode;
    if (fld && fld.classList) fld.classList.remove('af-bad');
  }

  function setValue(field, v) {
    if (ro || disposed) return;
    if (EMPTY(v)) delete state[field]; else state[field] = v;
    clearError(field);
    refresh();
  }

  const ctx = {
    doc,
    ask: ask || {},
    data: (ask && ask.data) || {},
    base,
    readonly: ro,
    catalogVersion,
    props,
    required,
    values: state,
    // The field's OWN answer schema, or {} — never an inherited `constructor`.
    schemaOf: (field) => (Object.hasOwn(props, field) ? props[field] : {}),
    idFor: (suffix) => `${base}${String(suffix).replace(/[^A-Za-z0-9_-]/g, '_')}`,
    get: (field) => state[field],
    set: setValue,
    isRequired: (field) => required.includes(field),
    errSlot(field) {
      const el = h(doc, 'div', 'af-err');
      el.setAttribute('role', 'alert');
      el.hidden = true;
      slots.set(field, el);
      return el;
    },
    // X14: BOTH may come back empty. `files` is [] in P5's Agents-view preview (an
    // `example` was never snapshotted), and agent data can name a rel the manifest
    // lacks. A file widget draws its .af-nofile tile rather than a broken <img>.
    fileFor: (rel) => files.find((f) => f && f.rel === rel) || null,
    fileUrl: (index) => {
      if (typeof fileUrl !== 'function') return null;
      const u = fileUrl(index);
      return typeof u === 'string' && u !== '' ? u : null;
    },
    // W5: the module declares WHAT it needs; the host decides HOW to get it. The
    // host is called SYNCHRONOUSLY (a widget asks at mount, and the tests assert the
    // ask before they await); whatever it returns or throws becomes a promise.
    loadText: typeof loadText === 'function'
      ? (index) => { try { return Promise.resolve(loadText(index)); } catch (e) { return Promise.reject(e); } }
      : null,
    markdown: typeof markdown === 'function' ? markdown : null,
    highlight: typeof highlight === 'function' ? highlight : null,
    own(fn) { if (typeof fn === 'function' && !disposed) disposers.push(fn); },
    isDisposed: () => disposed,
    // The ONE markdown painter (W4): plain text now, the host pipeline as soon as it
    // can render — immediately when it already can, else when paintMarkdown() runs.
    // Tracked by node, so a file-bound box is re-tracked when its text arrives.
    trackMarkdown(el, text) {
      let box = mdBoxes.find((b) => b.el === el);
      if (!box) { box = { el, text: '', done: false }; mdBoxes.push(box); }
      box.text = String(text == null ? '' : text);
      box.done = false;
      el.classList.remove('artifact-markdown');
      el.textContent = box.text;
      paintBox(box);
    },
    render: renderItems,
  };

  /** Draw a list of layout items. W10: an item with no effective widget draws NOTHING. */
  function renderItems(items) {
    const out = [];
    for (const raw of Array.isArray(items) ? items : []) {
      const item = effectiveItem(raw, catalogVersion);
      if (!item || !item.widget) continue;
      const make = WIDGETS[item.widget];
      if (typeof make !== 'function') continue;
      const el = make(item, ctx);
      if (!el) continue;
      if (item.when) {
        conds.push({ el, when: item.when });
        el.hidden = !whenOk(item.when, state);
      }
      out.push(el);
    }
    return out;
  }

  function collect() {
    // CR1 (satisfied): collectAnswer reads only `.layout` off its first argument,
    // so the ask ENVELOPE is a legal carrier — it has `layout` and `answerSchema`
    // but no `answer` / `data` / `example`. It strips unknown keys, settles `when`
    // to a fixpoint and narrows `required` to the visible set (P1 C6).
    return collectAnswer(ask || { layout }, schema, state);
  }

  function progress() {
    const vis = new Set(visibleFields(layout, state));
    const req = required.filter((f) => vis.has(f));
    const done = req.filter((f) => {
      const v = state[f];
      return !EMPTY(v) && !(Array.isArray(v) && v.length === 0);
    }).length;
    return { done, total: req.length };
  }

  function refresh() {
    // Toggle `hidden` on the EXISTING node: a remount would blow away focus and
    // every half-typed value in the subtree.
    for (const c of conds) c.el.hidden = !whenOk(c.when, state);
    if (typeof onChange === 'function') {
      try { onChange(collect()); } catch { /* a host callback never breaks the form */ }
    }
  }

  function setErrors(errors) {
    for (const field of slots.keys()) clearError(field);
    for (const e of Array.isArray(errors) ? errors : []) {
      const field = String((e && e.path) || '').split(/[.[]/)[0];
      const slot = slots.get(field);
      if (!slot) continue;
      slot.textContent = String((e && e.message) || (e && e.code) || 'Invalid.');
      slot.hidden = false;
      const fld = slot.parentNode;
      if (fld && fld.classList) fld.classList.add('af-bad');
    }
  }

  /** Render one tracked box through the host pipeline. False while it cannot
   *  (no pipeline yet, or it answered `plain`); a box is painted at most once per text. */
  function paintBox(box) {
    if (disposed || box.done || typeof ctx.markdown !== 'function') return false;
    let out = null;
    try { out = ctx.markdown(box.text); } catch { out = null; }
    if (!out || out.kind !== 'md') return false;
    box.el.replaceChildren(out.frag);
    box.el.classList.add('artifact-markdown');
    box.done = true;
    if (ctx.highlight) { try { void ctx.highlight(box.el); } catch { /* highlighting is cosmetic */ } }
    return true;
  }

  function paintMarkdown() {
    for (const box of mdBoxes) paintBox(box);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const fn of disposers.splice(0)) { try { fn(); } catch { /* never block a repaint */ } }
    conds.length = 0;
    mdBoxes.length = 0;
    slots.clear();
  }

  const el = h(doc, 'div', ro ? 'af-form af-readonly' : 'af-form');
  for (const node of renderItems(layout)) el.appendChild(node);

  return {
    el,
    collect,
    setErrors,
    dispose,
    progress,
    paintMarkdown,
    setValue,
    own: ctx.own,
    snapshot: () => clone(state),
  };
}

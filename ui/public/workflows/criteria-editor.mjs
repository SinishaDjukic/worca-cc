// ui/public/workflows/criteria-editor.mjs — the example editor's "Your criteria" and "Checked with" (plans/workflow-tests-part4-plan.md
// Task 18; canvas boards 2 and 32, and P4-M2's states). The rows are sentence boxes with their trust line under them; Switch offers
// an exact check (D94).
import { el, btn, iconBtn, field, testDialog } from './test-ui.mjs';
import { exactAlternative } from '../../../src/shared/workflow-tests/exact-checks.mjs';
import { TRUST_BADGE, NOT_CHECKED, trustLine, exactLine } from '../../../src/shared/workflow-tests/criteria-text.mjs';

const HINT = 'Write each one as a short sentence that is true of a good result. Worca reads the result, answers yes or no for each sentence, and says why.';
const HINT_PROJECT = 'Write each one as a short sentence that is true of a good result. Worca reads what changed, answers yes or no for each sentence, and says why.';
const JUDGE_HINT = 'Worca suggests an AI model that this workflow does not use to write, so it does not mark its own work. Changing it starts the trust tests for these criteria again. After each model: who pays for its checks, as far as Worca can tell.';
// P4-M2: the undrawn states' words.
const PLACEHOLDER = 'A sentence that is true of a good result';
const SAVE_FIRST = 'Save the example first. Then Worca can check this criterion.';
const CONFIRM_WHY = 'so Worca knows it judges it your way.';

/**
 * `models` = GET …/judge-models ({ models: [{ id, label, pays }], suggested }); `trust` = { [criterionId]: trust } from
 * GET …/examples/:ex/criteria, or null for an example not saved yet ("Not checked yet"). `onConfirm(criterion)` opens Check the
 * checker (Task 22; null: no link). `onSwitch(criterion, alt)` and `onAddExact()` belong to the editor, which owns the checks
 * (review I8): it calls `remove(criterion)` once the exact check is saved. `onAddExact` null: no "Add an exact check".
 * @returns {{ el: HTMLElement, read: () => { criteria: object[], judge: object|null }, remove: (criterion: object) => void, setProject: (on: boolean) => void }}
 */
export function renderCriteriaSection(doc, draft, { models = { models: [], suggested: null }, trust = {}, onConfirm = null, onSwitch = () => {},
  onAddExact = null, project = false } = {}) {
  const list = (draft.criteria || []).map((c) => ({ ...c }));
  let judge = draft.judge || (models.suggested ? { model: models.suggested.id } : null);
  const sect = el(doc, 'div', 'wft-sect wft-crit-sect');
  const lines = el(doc, 'div', 'wft-lines wft-crit-lines');
  // Task 22 fix round 1: Confirm 4 results and Fix it wait (all of them) while the one pressed is out: one round at a time.
  const links = [];
  const confirmBtn = (label, c, cls) => {
    const b = btn(doc, label, () => {
      if (b.disabled) return;
      for (const x of links) x.disabled = true;
      let out;
      try { out = onConfirm(c); } catch { out = null; }
      void Promise.resolve(out).catch(() => {}).finally(() => { for (const x of links) x.disabled = false; });
    }, cls);
    links.push(b);
    return b;
  };
  const trustMeta = (c, t) => {
    const meta = el(doc, 'span', 'wft-crit-meta');
    if (t.state === 'confirm') {   // M10 (P4-C1), P4-M2: "Confirm 4 results" is the amber link itself, then why
      if (onConfirm) meta.append(confirmBtn('Confirm 4 results', c, 'badge amber wft-confirm'), doc.createTextNode(` ${CONFIRM_WHY}`));
      else meta.append(doc.createTextNode(trustLine(t)));
      return meta;
    }
    const [cls, words] = TRUST_BADGE[t.state] || TRUST_BADGE.collecting;
    meta.append(el(doc, 'span', cls, words), doc.createTextNode(` ${trustLine(t)}`));   // the space: a screen reader reads two phrases
    if (onConfirm && t.state === 'unreliable') meta.append(doc.createTextNode(' '), confirmBtn('Fix it', c, 'wft-linkbtn wft-fix'));
    return meta;
  };
  const paint = () => {
    lines.replaceChildren();
    links.length = 0;
    list.forEach((c, i) => {
      const row = el(doc, 'div', 'wft-crit');
      const box = el(doc, 'div', 'wft-crit-in');
      const input = el(doc, 'input');
      input.type = 'text'; input.value = c.text || ''; input.maxLength = 300; input.placeholder = PLACEHOLDER;
      input.setAttribute('aria-label', `Criterion ${i + 1}`);
      const rmLabel = () => ((c.text || '').trim() ? `Remove "${c.text.trim()}"` : 'Remove this criterion');
      const rm = iconBtn(doc, 'trash', rmLabel(), () => { remove(c); add.focus(); }, 'btn btn-sm btn-quiet btn-icon wft-crit-rm');
      input.addEventListener('input', () => { c.text = input.value; rm.setAttribute('aria-label', rmLabel()); });
      box.append(input, rm);
      row.append(box);
      const alt = exactAlternative(c.text);
      const t = c.id && trust ? trust[c.id] : null;
      if (alt) {   // board 2's violet line: an exact check could stand in (D94); user decision 2: never a trust mark beside it
        const exact = el(doc, 'span', 'wft-crit-meta is-exact');
        exact.append(doc.createTextNode(`${exactLine(alt)} `));
        const sw = btn(doc, 'Switch', () => onSwitch(c, alt), 'wft-linkbtn wft-switch');
        sw.setAttribute('aria-label', `Switch "${c.text}" to an exact check`);
        exact.append(sw);
        row.append(exact);
      } else if (t) row.append(trustMeta(c, t));
      else if (!trust && (c.text || '').trim()) {   // P4-M2: an example not saved yet
        const meta = el(doc, 'span', 'wft-crit-meta');
        meta.append(el(doc, 'span', 'badge', NOT_CHECKED.pending), doc.createTextNode(` ${SAVE_FIRST}`));
        row.append(meta);
      }
      lines.append(row);
    });
    const adds = el(doc, 'div', 'wft-crit-adds');
    adds.append(add);
    if (onAddExact) adds.append(btn(doc, 'Add an exact check', () => onAddExact(), 'btn btn-sm wft-add-exact'));
    lines.append(adds);
  };
  const add = btn(doc, 'Add a criterion', () => {
    list.push({ text: '' });
    paint();
    lines.querySelectorAll('.wft-crit input')[list.length - 1].focus();
  }, 'btn btn-sm wft-add-crit');
  paint();
  const sel = el(doc, 'select');
  sel.id = 'wft-judge';
  const sugg = models.suggested && models.suggested.suggested ? models.suggested.id : null;
  for (const m of models.models || []) {
    // P4-Q17, P4-M2: who pays for its checks after each model's name, then the suggestion.
    const o = el(doc, 'option', '', [m.label, m.pays, m.id === sugg ? 'suggested' : null].filter(Boolean).join(' · '));
    o.value = m.id;
    sel.append(o);
  }
  // A saved model that left the list (hidden since) stays picked, under its id, rather than switching silently.
  if (judge && ![...sel.options].some((o) => o.value === judge.model)) { const o = el(doc, 'option', '', judge.model); o.value = judge.model; sel.append(o); }
  if (judge) sel.value = judge.model;
  sel.addEventListener('change', () => { judge = { model: sel.value }; });
  const wrap = el(doc, 'div', 'select-wrap');
  wrap.append(sel);
  const hint = el(doc, 'p', 'wft-grp-hint', project ? HINT_PROJECT : HINT);
  sect.append(el(doc, 'p', 'wft-grp', 'Your criteria'), hint, lines,
    field(doc, 'Checked with', wrap, { id: 'wft-judge', hint: JUDGE_HINT }));
  /** I8 (Switch): take a criterion out of the section's own list, by its id or (unsaved) by the row object, and repaint. */
  function remove(c) {
    const i = c ? list.findIndex((x) => x === c || (c.id && x.id === c.id)) : -1;
    if (i >= 0) { list.splice(i, 1); paint(); }
  }
  /** Board 32: a project example's hint ("what changed"); the editor calls it when the Project select changes. */
  const setProject = (on) => { hint.textContent = on ? HINT_PROJECT : HINT; };
  return { el: sect, remove, setProject, read: () => ({ criteria: list.map(({ id, text }) => ({ ...(id ? { id } : {}), text: text || '' })), judge }) };
}

// Task 24 (boards 2, 32; P4-M2): "A result you liked", under the criteria. Its own route saves it at once (D101).
const LIKED_HINT = 'When two versions are compared, Worca also says which result is closer to this one.';
const LIKED_HINT_PROJECT = 'When two versions are compared, Worca also says which changes are closer to these.';
const LIKED_MAX = 2 * 1024 * 1024;

/** `liked` = the example's `liked` ({ kind, name, size }, Task 12); null: P4-M2's empty row. `saved` false: an example not saved yet,
 *  whose "Add a result you liked" waits for its first save. */
export function likedRow(doc, liked, { project = false, saved = true, onReplace, onRemove }) {
  const sect = el(doc, 'div', 'wft-sect wft-liked');
  const g = el(doc, 'p', 'wft-grp', 'A result you liked ');
  g.append(el(doc, 'span', 'wft-opt', '· optional'));
  sect.append(g, el(doc, 'p', 'wft-grp-hint', project ? LIKED_HINT_PROJECT : LIKED_HINT));
  // The dialog gives the focus back by this key, to whichever button the repainted row has.
  const opener = (label, cls) => { const b = btn(doc, label, () => onReplace(), cls); b.dataset.focusKey = 'wft-liked-open'; return b; };
  if (!liked) {
    const add = opener('Add a result you liked', 'btn btn-sm wft-liked-add');
    add.disabled = !saved;
    sect.append(add);
    if (!saved) sect.append(el(doc, 'span', 'hint', 'Save the example first.'));
    return sect;
  }
  const line = el(doc, 'div', 'wft-liked-line');
  const rm = iconBtn(doc, 'trash', project || liked.kind === 'changes' ? 'Remove the changes you liked' : 'Remove the result you liked', async () => {
    if (rm.disabled) return;   // one removal at a time
    rm.disabled = true;
    try { await onRemove(); } finally { rm.disabled = false; }
  }, 'btn btn-sm btn-quiet btn-icon wft-liked-rm', 15);
  line.append(el(doc, 'span', `wft-file wft-liked-file${liked.kind === 'changes' ? ' is-plain' : ''}`, liked.name),
    opener('Replace', 'btn btn-sm wft-liked-replace'), rm);
  sect.append(line);
  return sect;
}

/** P4-M2's dialog: upload a text file (`onFile(file)`), or keep a try's result (`onTry(tryId)`); each resolves { ok } or { ok: false, error }
 *  in the server's words, which stay in the dialog. `tries` = [{ id, label }], newest first. */
export function openLikedDialog({ doc, win, tries = [], onFile, onTry }) {
  const file = el(doc, 'input');
  file.type = 'file'; file.id = 'wft-liked-file'; file.accept = '.md,.txt,.csv,.json,.html';
  const pick = el(doc, 'select');
  pick.id = 'wft-liked-try';
  for (const t of tries) { const o = el(doc, 'option', '', t.label); o.value = String(t.id); pick.append(o); }
  const wrap = el(doc, 'div', 'select-wrap');
  wrap.append(pick);
  return testDialog({ doc, win, title: 'A result you liked', confirmLabel: 'Keep it',
    body: [field(doc, 'Upload a file', file, { id: file.id, hint: 'A text file, at most 2 MB.' }),
      ...(tries.length ? [field(doc, "Or use a try's result", wrap, { id: pick.id })] : [])],
    onConfirm: async () => {
      const f = file.files && file.files[0];
      if (f) return f.size > LIKED_MAX ? { ok: false, error: 'Pick a file of at most 2 MB.' } : onFile(f);
      if (tries.length) return onTry(Number(pick.value));
      return { ok: false, error: 'Pick a file first.' };
    } });
}

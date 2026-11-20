// ui/public/workflows/criteria-editor.mjs — the example editor's "Your criteria" and "Checked with" (plans/workflow-tests-part4-plan.md
// Task 18; canvas boards 2 and 32). The rows are sentence boxes with their trust line under them; Switch offers an exact check (D94).
import { el, btn, field } from './test-ui.mjs';
import { exactAlternative } from '../../../src/shared/workflow-tests/exact-checks.mjs';
import { TRUST_BADGE, trustLine, exactLine } from '../../../src/shared/workflow-tests/criteria-text.mjs';

const HINT = 'Write each one as a short sentence that is true of a good result. Worca reads the result, answers yes or no for each sentence, and says why.';
const HINT_PROJECT = 'Write each one as a short sentence that is true of a good result. Worca reads what changed, answers yes or no for each sentence, and says why.';
const JUDGE_HINT = 'Worca suggests an AI model that this workflow does not use to write, so it does not mark its own work. Changing it starts the trust tests for these criteria again.';

/**
 * `models` = GET …/judge-models ({ models: [{ id, label, pays }], suggested }); `trust` = { [criterionId]: trust } from
 * GET …/examples/:ex/criteria. `onConfirm(criterion)` opens Check the checker (Task 22; null: no link). `onSwitch(criterion, alt)`
 * belongs to the editor, which owns the checks (review I8): it calls `remove(criterion)` once the exact check is saved.
 * @returns {{ el: HTMLElement, read: () => { criteria: object[], judge: object|null }, remove: (criterion: object) => void, setProject: (on: boolean) => void }}
 */
export function renderCriteriaSection(doc, draft, { models = { models: [], suggested: null }, trust = {}, onConfirm = null, onSwitch = () => {}, project = false } = {}) {
  const list = (draft.criteria || []).map((c) => ({ ...c }));
  let judge = draft.judge || (models.suggested ? { model: models.suggested.id } : null);
  const sect = el(doc, 'div', 'wft-sect wft-crit-sect');
  const lines = el(doc, 'div', 'wft-lines wft-crit-lines');
  const trustMeta = (c, t) => {
    const meta = el(doc, 'span', 'wft-crit-meta');
    if (t.state === 'confirm') {   // M10 (P4-C1): "Confirm 4 results" is the amber link itself
      meta.append(onConfirm ? btn(doc, 'Confirm 4 results', () => onConfirm(c), 'wft-linkbtn wft-confirm') : doc.createTextNode(trustLine(t)));
      return meta;
    }
    const [cls, words] = TRUST_BADGE[t.state] || TRUST_BADGE.collecting;
    meta.append(el(doc, 'span', cls, words), doc.createTextNode(trustLine(t)));
    if (onConfirm && t.state === 'unreliable') meta.append(btn(doc, 'Fix it', () => onConfirm(c), 'wft-linkbtn wft-fix'));
    return meta;
  };
  const paint = () => {
    lines.replaceChildren();
    list.forEach((c, i) => {
      const row = el(doc, 'div', 'wft-crit');
      const input = el(doc, 'input');
      input.type = 'text'; input.value = c.text || ''; input.maxLength = 300;
      input.setAttribute('aria-label', `Criterion ${i + 1}`);
      input.addEventListener('input', () => { c.text = input.value; });
      row.append(input);
      const alt = exactAlternative(c.text);
      const t = c.id ? trust[c.id] : null;
      if (alt) {   // board 2's violet line: an exact check could stand in (D94); user decision 2: never a trust mark beside it
        const exact = el(doc, 'span', 'wft-crit-meta is-exact');
        exact.append(doc.createTextNode(`${exactLine(alt)} `));
        const sw = btn(doc, 'Switch', () => onSwitch(c, alt), 'wft-linkbtn wft-switch');
        sw.setAttribute('aria-label', `Switch "${c.text}" to an exact check`);
        exact.append(sw);
        row.append(exact);
      } else if (t) row.append(trustMeta(c, t));
      lines.append(row);
    });
    const add = btn(doc, 'Add a criterion', () => {
      list.push({ text: '' });
      paint();
      lines.querySelectorAll('.wft-crit input')[list.length - 1].focus();
    }, 'btn btn-sm wft-add-crit');
    lines.append(add);
  };
  paint();
  const sel = el(doc, 'select');
  sel.id = 'wft-judge';
  const sugg = models.suggested && models.suggested.suggested ? models.suggested.id : null;
  for (const m of models.models || []) {
    const o = el(doc, 'option', '', m.id === sugg ? `${m.label} · suggested` : m.label);
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
  const remove = (c) => {
    const i = c ? list.findIndex((x) => x === c || (c.id && x.id === c.id)) : -1;
    if (i >= 0) { list.splice(i, 1); paint(); }
  };
  /** Board 32: a project example's hint ("what changed"); the editor calls it when the Project select changes. */
  const setProject = (on) => { hint.textContent = on ? HINT_PROJECT : HINT; };
  return { el: sect, remove, setProject, read: () => ({ criteria: list.map(({ id, text }) => ({ ...(id ? { id } : {}), text: text || '' })), judge }) };
}

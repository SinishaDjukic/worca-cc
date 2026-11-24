// ui/public/shape/req-change.mjs — Shaper small runs C4: the one renderer of a requirement change mid-build. The
// feature card's notice (Build step), and the "How a change lands" fold the notice, the requirement stop card and the
// chat card share. Words from src/shared/shape/req-change.mjs; rows, marks and fold from check-row.mjs inside the
// shared `.srows` layout (shape-it.css), no style of its own.
import { buildCheckFold } from './check-row.mjs';
import { CHANGE_RULE_LINE, changeRuleRows, reqChangeHead, reqChangeNotice } from '../../../src/shared/shape/req-change.mjs';

/** The fold, open: 3 rows, the mark on `caseKey`'s row (none for `none`). */
export function renderChangeRule(doc, caseKey) {
  const box = doc.createElement('div');
  box.className = 'srows req-change-rule';
  const f = buildCheckFold(doc, { items: changeRuleRows(caseKey) }, 'Shape', { open: true, text: () => CHANGE_RULE_LINE });
  box.append(f.line, f.rows);
  return box;
}

/** HH:MM of an ISO time, in the page's zone. */
export const changeTime = (at) => {
  const d = new Date(at);
  return Number.isFinite(d.getTime()) ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : '';
};

/** The notice: head, one `.cap` line and the fold. Told, not asked: no question and no button. */
export function renderReqChange(doc, change, { time = changeTime(change && change.at) } = {}) {
  const box = doc.createElement('div');
  box.className = 'plan-body req-change';
  const head = doc.createElement('div');
  head.className = 'ask-mcard-head step-head';
  const t = doc.createElement('b');
  t.className = 'ask-mcard-title';
  t.textContent = reqChangeHead(change);
  head.appendChild(t);
  const cap = doc.createElement('div');
  cap.className = 'cap';
  cap.textContent = reqChangeNotice(change, { time });
  box.append(head, cap, renderChangeRule(doc, change.case));
  return box;
}

/** The feature card's notice slot: drawn on the Build step while `view.change` lands, else emptied. */
export function paintReqChange(doc, host, { step = null, change = null } = {}) {
  const show = step === 'build' && !!change;
  const sig = show ? JSON.stringify(change) : '';
  if (host.dataset.sig === sig) return;
  host.dataset.sig = sig;
  host.replaceChildren(...(show ? [renderReqChange(doc, change)] : []));
  host.hidden = !show;
}

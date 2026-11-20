// ui/public/workflows/criteria-rows.mjs — "Your criteria · checked by Worca" in one example side by side (plans/workflow-tests-part4-plan.md
// Task 20; boards 6 and 36, P4-M6): each criterion's verdict per version, and under the row, for the version whose verdict is shown (the one
// that missed it, else B): why, the proof Worca found, how far its checking is trusted, and Agree / Disagree (D96).
import { el, btn } from './test-ui.mjs';
import { trustLine } from '../../../src/shared/workflow-tests/criteria-text.mjs';
import { inSentence } from '../../../src/shared/workflow-tests/project-text.mjs';

export const CRITERIA_GROUP = 'Your criteria · checked by Worca';
/** Boards 6 and P4-M6 draw this note in the pair question's block (Task 24), not under the criteria rows. */
export const DISAGREE_NOTE = 'When you disagree, Worca notes it. Over time this shows how far Worca\'s checking can be trusted.';
const trustSentence = (t) => (t && t.state === 'reliable' ? `Worca's checking of this criterion is reliable: it agrees with people ${t.agree} of ${t.n} times.` : trustLine(t));
/** A real verdict (met or not met) that can be answered; a "Not checked" one (met null) never can. */
const verdictOf = (it) => !!it && (it.met === true || it.met === false);

function cell(doc, it, label) {
  const span = el(doc, 'span', 'wft-res');
  span.dataset.label = label;   // H2: on a phone each version's cell is its own line, named
  if (!verdictOf(it)) { span.classList.add('is-none'); span.textContent = it ? it.value : '—'; return span; }
  if (!it.met) span.classList.add('is-bad');
  const d = el(doc, 'span', `wft-dot ${it.met ? 'ok' : 'no'}`);
  d.setAttribute('aria-hidden', 'true');
  span.append(d, el(doc, 'span', 'wft-res-v', it.value));
  return span;
}

function whyBlock(doc, it, versionLabel, actions) {
  const box = el(doc, 'div', `wft-crit-why${it.met ? '' : ' is-bad'}`);
  const words = el(doc, 'p', '');
  words.append(el(doc, 'b', '', `Why Worca says ${it.met ? 'yes' : 'no'} for ${inSentence(versionLabel)}: `), doc.createTextNode(`"${it.reason}"`));
  const proof = el(doc, 'p', '');
  proof.append(el(doc, 'b', '', 'Proof from the result: '), doc.createTextNode(`"${it.proof}" `), el(doc, 'span', 'hint', '· found in the result'));
  const txt = el(doc, 'div', 'wft-crit-txt');
  txt.append(words, proof, el(doc, 'p', 'hint', trustSentence(it.trust)));
  box.append(txt);
  if (it.judgementId && actions.answer) {
    const acts = el(doc, 'div', 'wft-acts');
    const send = (agree) => actions.answer(it.judgementId, agree);
    acts.append(btn(doc, 'Agree', () => send(true), 'btn btn-sm wft-agree'), btn(doc, 'Disagree', () => send(false), 'btn btn-sm wft-disagree'));
    box.append(acts);
  }
  return box;
}

/** The group title and its rows for try `cur` ({ n, a, b }: the try views); `labels` = { a, b } version labels. */
export function criteriaGroup(doc, cur, labels, { once = false, actions = {} } = {}) {
  const ids = [];
  for (const v of [once ? null : cur.a, cur.b]) for (const it of (v && v.verdict && v.verdict.criteria) || []) if (!ids.some((x) => x.id === it.id)) ids.push(it);
  if (!ids.length) return [];
  const out = [el(doc, 'div', 'wft-crow-grp', CRITERIA_GROUP)];
  const pick = (v, id) => (v && v.verdict ? (v.verdict.criteria || []).find((x) => x.id === id) || null : null);
  for (const c of ids) {
    const row = el(doc, 'div', `wft-crow is-crit${once ? ' is-one' : ''}`);
    row.append(el(doc, 'span', '', c.label));
    const A = once ? null : pick(cur.a, c.id);
    const B = pick(cur.b, c.id);
    if (!once) row.append(cell(doc, A, `${labels.a} · try ${cur.n}`));
    row.append(cell(doc, B, `${labels.b} · try ${cur.n}`));
    // The block explains the version that missed it (board 6: "Why Worca says no for v5"), else B's verdict; a "Not checked" cell has none.
    const shown = B && B.met === false ? [B, labels.b] : A && A.met === false ? [A, labels.a] : B && B.met === true ? [B, labels.b] : null;
    if (shown) row.append(whyBlock(doc, shown[0], shown[1], actions));
    out.push(row);
  }
  return out;
}

// ui/public/workflows/criteria-rows.mjs — "Your criteria · checked by Worca" in one example side by side (plans/workflow-tests-part4-plan.md
// Task 20; boards 6 and 36, P4-M6): each criterion's verdict per version, and under the row, for the version whose verdict is shown (the one
// that missed it, else B): why, the proof Worca found (a project try's from its changes, in code font), how far its checking is trusted,
// and Agree / Disagree (D96), which turn into "You agreed." / "You disagreed: Worca notes it." with Undo.
import { el, btn } from './test-ui.mjs';
import { notify } from '../feedback.mjs';
import { icon } from '../icons.mjs';
import { splitPatchSections } from '../diff-view.mjs';
import { trustLine } from '../../../src/shared/workflow-tests/criteria-text.mjs';
import { inSentence } from '../../../src/shared/workflow-tests/project-text.mjs';
import { proofFound } from '../../../src/shared/workflow-tests/exact-checks.mjs';

export const CRITERIA_GROUP = 'Your criteria · checked by Worca';
/** Boards 6 and P4-M6 draw this note in the pair question's block (Task 24), not under the criteria rows. */
export const DISAGREE_NOTE = 'When you disagree, Worca notes it. Over time this shows how far Worca\'s checking can be trusted.';
const AGREED = 'You agreed.';
const DISAGREED = 'You disagreed: Worca notes it.';

/** Boards 6, 36: the trust line under the proof. The other states keep P4-C1's line. */
export function trustSentence(t) {
  if (t && t.state === 'reliable') return `Worca's checking of this criterion is reliable: it agrees with people ${t.agree} of ${t.n} times.`;
  if (t && t.state === 'collecting') return `Worca's checking of this criterion needs your answers: Worca has ${t.n} of the 10 answers it needs.`;
  return trustLine(t);
}
/** A real verdict (met or not met) that can be answered; a "Not checked" one (met null) never can. */
const verdictOf = (it) => !!it && (it.met === true || it.met === false);

// Board 36: the changed file whose diff holds the proof (D89's rule, the same one the server applied: proofFound), or null.
function proofFileIn(proof, patch) {
  if (typeof patch !== 'string' || !patch || typeof proof !== 'string') return null;
  const sec = splitPatchSections(patch).find((s) => s.path && proofFound(proof, s.raw));
  return sec ? sec.path : null;
}

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

/** Agree / Disagree, or (after an answer, also one given before a reload: `it.answer`) what was said and Undo (agree: null). */
function answerArea(doc, it, actions, trustEl, txt, name = '') {
  const area = el(doc, 'div', 'wft-acts wft-crit-acts');
  // Pre-merge QA (P12): each button says what it answers ("Agree: Quotes a real customer · v1"), where five pairs were
  // all named "Agree" / "Disagree"; the visible word comes first, so a spoken command still finds it.
  const keyed = (b, k) => { b.dataset.focusKey = `wft-crit-${it.judgementId}-${k}`; if (name) b.setAttribute('aria-label', `${b.textContent}: ${name}`); return b; };
  let send;
  const paint = (focus) => {
    area.replaceChildren();
    let first;
    if (it.answer === true || it.answer === false) {
      const said = el(doc, 'span', `wft-said ${it.answer ? 'is-agree' : 'is-dis'}`);
      said.setAttribute('role', 'status');
      if (it.answer) said.append(icon(doc, 'check', 14));
      first = keyed(btn(doc, 'Undo', () => send(null), 'wft-linkbtn'), 'undo');
      said.append(doc.createTextNode(it.answer ? AGREED : DISAGREED), first);
      area.append(said);
    } else {
      first = keyed(btn(doc, 'Agree', () => send(true), 'btn btn-sm wft-agree'), 'agree');
      area.append(first, keyed(btn(doc, 'Disagree', () => send(false), 'btn btn-sm wft-disagree'), 'disagree'));
    }
    if (focus) first.focus();
  };
  send = async (agree) => {
    const had = area.contains(doc.activeElement);
    const bs = [...area.querySelectorAll('button')];
    if (bs.some((b) => b.disabled)) return;
    for (const b of bs) b.disabled = true;
    let r;
    try { r = await actions.answer(it.judgementId, agree); } catch (e) {
      r = undefined;   // the same path as a failed answer: the buttons come back; the person is told
      notify({ tone: 'err', title: 'Not saved', detail: e && e.message ? e.message : String(e) }, { doc });
    }
    if (r && typeof r === 'object') {
      it.answer = r.answer === true || r.answer === false ? r.answer : null;
      if (r.trust) { it.trust = r.trust; trustEl.textContent = trustSentence(r.trust); if (!trustEl.isConnected) txt.append(trustEl); }
    }
    paint(had);
  };
  paint(false);
  return area;
}

function whyBlock(doc, it, versionLabel, v, actions, patches) {
  const box = el(doc, 'div', `wft-crit-why${it.met ? '' : ' is-bad'}`);
  const words = el(doc, 'p', '');
  words.append(el(doc, 'b', '', `Why Worca says ${it.met ? 'yes' : 'no'} for ${inSentence(versionLabel)}: `), doc.createTextNode(`"${it.reason}"`));
  const proof = el(doc, 'p', 'wft-crit-proof');
  const file = v && v.project && patches ? proofFileIn(it.proof, patches.get(v.tryId)) : null;
  if (file) {   // board 36: quoted from the changes, in code font, under the file it is in
    proof.append(el(doc, 'b', '', 'Proof from the changes: '), el(doc, 'span', 'hint', `${file} · found in the changes`), el(doc, 'span', 'wft-crit-code', it.proof));
  } else {
    proof.append(el(doc, 'b', '', 'Proof from the result: '), doc.createTextNode(`"${it.proof}" `), el(doc, 'span', 'hint', '· found in the result'));
  }
  const trustText = trustSentence(it.trust);
  const trust = el(doc, 'p', 'hint wft-crit-trust', trustText);   // answers can fill it in later, so the element stays
  const txt = el(doc, 'div', 'wft-crit-txt');
  txt.append(words, proof);
  if (trustText) txt.append(trust);
  box.append(txt);
  if (it.judgementId && actions.answer) box.append(answerArea(doc, it, actions, trust, txt, [it.label || it.text, versionLabel].filter(Boolean).join(' · ')));
  return box;
}

/** The group title and its rows for try `cur` ({ n, a, b }: the try views); `labels` = { a, b } version labels; `patches`: each
 *  project try's diff by try id, once read (the side by side's). */
export function criteriaGroup(doc, cur, labels, { once = false, actions = {}, patches = null } = {}) {
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
    // The block explains the version that missed it (board 6: "Why Worca says no for v5"), else B's verdict; a "Not checked" cell has
    // none (P4-M6), so it is never answered.
    const shown = B && B.met === false ? [B, labels.b, cur.b] : A && A.met === false ? [A, labels.a, cur.a] : B && B.met === true ? [B, labels.b, cur.b] : null;
    if (shown) row.append(whyBlock(doc, shown[0], shown[1], shown[2], actions, patches));
    out.push(row);
  }
  return out;
}

/** Task 14: the pair's reason names the sides as the checker saw them in its first ask ("result A" first, "result B" second, lowercased
 *  at a sentence start; or "the first / second result"). Here they become the versions: "v4's result", and a possessive ("result A's")
 *  just "v4's", never "v4's result's". */
export function pairReasonText(reason, labels) {
  const of = (k, owns) => (owns ? `${labels[k]}'s` : `${labels[k]}'s result`);
  return String(reason || '')
    .replace(/\b(?:[Tt]he\s+)?[Rr]esult\s+([AB])(['’]s)?\b/g, (_m, s, owns) => of(s === 'A' ? 'a' : 'b', !!owns))
    .replace(/\b(?:[Tt]he\s+)?(first|second)\s+result(['’]s)?\b/gi, (_m, w, owns) => of(w.toLowerCase() === 'first' ? 'a' : 'b', !!owns));
}

/** Board 6 and P4-M6 (D100): "Which result is better overall?", or with a result you liked "closer to" it, above the try tabs. Worca
 *  never decides by it. A decided pair takes Agree / Disagree (the criteria rows' answers), with the note on disagreeing; "Worca could
 *  not decide" takes none. `labels` = { a, b } version labels. */
export function pairBlock(doc, pair, labels, { onAnswer = null } = {}) {
  const box = el(doc, 'section', 'card wft-pair');
  const txt = el(doc, 'div', 'wft-pair-txt');
  const h = el(doc, 'h2', '', pair.question === 'liked' ? 'Which result is closer to the one you liked?' : 'Which result is better overall?');
  h.id = `wft-pair-${pair.judgementId}`;
  box.setAttribute('aria-labelledby', h.id);
  const said = el(doc, 'p', 'wft-pair-said');
  const decided = pair.winner === 'a' || pair.winner === 'b' || pair.winner === 'tie';
  if (decided) {
    said.append(el(doc, 'b', '', pair.winner === 'tie' ? 'They are about the same.' : `${labels[pair.winner]}'s result.`));
    const why = pairReasonText(pair.reason, labels).trim();
    if (why) said.append(doc.createTextNode(` ${why}`));
  } else said.textContent = 'Worca could not decide: it answered differently when the order changed.';
  txt.append(h, el(doc, 'p', 'hint', 'Worca read both without knowing which version wrote which. It compared the first try of each version.'), said);
  box.append(txt);
  if (decided && pair.judgementId && onAnswer) {
    box.append(answerArea(doc, pair, { answer: onAnswer }, el(doc, 'p', 'hint wft-crit-trust'), txt, h.textContent),
      el(doc, 'p', 'hint wft-pair-note', DISAGREE_NOTE));
  }
  return box;
}

// ui/public/shape/role-rows.mjs — the ONE role-rows component (#990 slice 3): the plan card's per-role fold (one check
// row per role with its fixed / disputed / open counts, Show over its findings) and one decision card per conflict, in
// the Clarify card grammar (`.qblock`, `.qtext`, keyed `.qopt` tiles, ui/public/chat/question.mjs). The cards have no
// submit of their own: the plan card's Approve carries the picks.
import { roleSummaries, reviewedLine, currentPass } from '../../../src/shared/shape/role-review.mjs';
import { fold, buildCheckFold } from './check-row.mjs';

const el = (doc, tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const button = (doc, cls, text) => { const b = el(doc, 'button', cls, text); b.type = 'button'; return b; };

function statusOf(f) {
  if (f.status === 'fixed') return { cls: ' fixed', text: Number.isFinite(f.fixedIn) ? `fixed in v${f.fixedIn}` : 'fixed' };
  if (f.status === 'disputed') return { cls: ' disputed', text: 'disputed' };
  return { cls: '', text: 'open' };
}

/** A role's findings: a 2px severity chip, the plan section, the one-line fix, its status, and a disputed one's reason. */
function findingList(doc, findings, sectionFallback) {
  const list = el(doc, 'ul', 'plan-findings'); list.hidden = true;
  for (const f of findings) {
    const s = statusOf(f);
    const li = el(doc, 'li', 'plan-finding');
    li.append(el(doc, 'span', `plan-sev plan-sev-${f.severity}`, f.severity),
      el(doc, 'span', 'plan-finding-section', f.section || sectionFallback),
      el(doc, 'span', 'plan-finding-fix', f.fix || f.title),
      el(doc, 'span', `plan-finding-status${s.cls}`, s.text));
    if (f.status === 'disputed' && f.reason) li.appendChild(el(doc, 'span', 'plan-finding-reason', f.reason));
    list.appendChild(li);
  }
  return list;
}

/** The folded role line (`Reviewed by N roles · K open`) and its rows; null without a review. A row gets `!` when a
 *  critical or major finding is open, and a Show folded over its findings. */
export function buildRoleFold(doc, roleReviews, { sectionFallback = 'Plan' } = {}) {
  const roles = roleSummaries(roleReviews);
  if (!roles.length) return null;
  const f = buildCheckFold(doc, { items: roles.map((r) => ({ id: r.key, label: r.text, pass: r.open === 0 })) });
  f.line.classList.add('plan-role-line');
  f.rows.classList.add('plan-roles');
  f.line.querySelector('.plan-fold-text').textContent = reviewedLine(roleReviews);
  [...f.rows.children].forEach((row, i) => {
    const r = roles[i];
    if (r.open) {
      const mark = row.querySelector('.plan-check-mark');
      mark.textContent = '!'; mark.setAttribute('aria-label', 'open issues');
    }
    if (!r.findings.length) return;
    const list = findingList(doc, r.findings, sectionFallback);
    const show = fold(button(doc, 'btn btn-sm plan-check-show', 'Show'), list);
    show.addEventListener('click', (e) => { e.stopPropagation(); show.textContent = list.hidden ? 'Show' : 'Hide'; });
    row.appendChild(show);
    row.after(list);
  });
  return { line: f.line, rows: f.rows };
}

/** One decision card per conflict of the last round: "Security and UX disagree on Rollout", the question and its
 *  options. `picks()` is what Approve sends; `firstUnanswered()` the card still waiting for a pick. Null without one. */
export function buildConflictCards(doc, roleReviews, { labelOf = (k) => k } = {}) {
  const conflicts = currentPass(roleReviews)?.rounds.at(-1)?.conflicts;
  if (!Array.isArray(conflicts) || !conflicts.length) return null;
  const box = el(doc, 'div', 'plan-decisions');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'Decisions needed');
  const chosen = new Map();
  const cards = conflicts.map((c, i) => {
    const card = el(doc, 'div', 'plan-decision');
    card.tabIndex = -1;
    card.dataset.conflict = c.id;
    const roles = (c.roles || []).map(labelOf);
    card.appendChild(el(doc, 'div', 'plan-decision-src', `${roles.join(' and ')} disagree on ${c.section || 'Plan'}`));
    const block = el(doc, 'div', 'qblock');
    const text = el(doc, 'div', 'qtext');
    text.append(el(doc, 'span', 'qn', String(i + 1)), el(doc, 'span', 'qtext-t', c.question));
    const group = el(doc, 'div', 'qopts');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', c.question);
    const tiles = c.options.map((o, k) => {
      const tile = button(doc, 'qopt');
      tile.dataset.key = String.fromCharCode(65 + k);
      tile.dataset.value = o;
      tile.setAttribute('aria-pressed', 'false');
      const name = el(doc, 'span', 'chat-q-opt-name');
      name.appendChild(el(doc, 'span', 'chat-q-opt-label', o));
      const txt = el(doc, 'span', 'qopt-txt');
      txt.appendChild(name);
      tile.appendChild(txt);
      group.appendChild(tile);
      return tile;
    });
    for (const tile of tiles) {
      tile.addEventListener('click', (e) => {
        e.stopPropagation();
        chosen.set(c.id, tile.dataset.value);
        for (const t of tiles) { t.classList.toggle('sel', t === tile); t.setAttribute('aria-pressed', String(t === tile)); }
      });
    }
    block.append(text, group);
    card.appendChild(block);
    box.appendChild(card);
    return { id: c.id, card };
  });
  return {
    el: box,
    picks: () => cards.filter((x) => chosen.has(x.id)).map((x) => ({ id: x.id, choice: chosen.get(x.id) })),
    firstUnanswered: () => cards.find((x) => !chosen.has(x.id))?.card || null,
  };
}

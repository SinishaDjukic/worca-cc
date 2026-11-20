// ui/public/shape/attached-body.mjs — the Requirements card when the run asks for agreement on attached features
// (`plan.attached.features`): one row per feature, the agreed ones marked, and ONE Agree that answers for the rest.
// Only existing row and button classes are used; plan-body.mjs owns the head, the error line and the send guard.

const countText = (n) => `${n} requirement${n === 1 ? '' : 's'}`;

/** The features of an attached ask, ignoring anything that is not a feature row. */
const featuresOf = (plan) => {
  const list = plan && plan.attached && Array.isArray(plan.attached.features) ? plan.attached.features : [];
  return list.filter((f) => f && Number.isInteger(f.seq));
};

/** The seqs one Agree answers for: every feature not yet agreed, or all of them when none is pending. */
export function agreedSeqsFor(features) {
  const pending = features.filter((f) => !f.agreed).map((f) => f.seq);
  return pending.length ? pending : features.map((f) => f.seq);
}

/** The body element; `onAnswer({ decision: 'approve', agreedSeqs })` runs on Agree. */
export function renderAttachedBody(doc, plan, { onAnswer } = {}) {
  const features = featuresOf(plan);
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const body = h('div', 'plan-body plan-card shape-reqs shape-attached');
  const pending = features.filter((f) => !f.agreed).length;
  body.appendChild(h('div', 'plan-sub', pending === 1 ? '1 feature needs your agreement' : `${pending} features need your agreement`));

  const list = h('div', 'shape-attached-list');
  for (const f of features) {
    const row = h('div', 'attached-feature');
    row.dataset.seq = String(f.seq);
    row.append(h('span', 'attached-feature-title', String(f.title || f.id || `Feature ${f.seq}`)),
      h('span', 'attached-feature-count', ` · ${countText(Number(f.criteriaCount) || 0)}`));
    if (f.agreed) row.appendChild(h('span', 'attached-feature-agreed', ' · Agreed'));
    list.appendChild(row);
  }
  body.appendChild(list);

  const foot = h('div', 'qpanel-foot plan-actions');
  const agree = h('button', 'btn btn-sm btn-primary plan-approve attached-agree', 'Agree and plan');
  agree.type = 'button';
  agree.addEventListener('click', (e) => {
    e.stopPropagation();
    if (typeof onAnswer === 'function') onAnswer({ decision: 'approve', agreedSeqs: agreedSeqsFor(features) });
  });
  foot.appendChild(agree);
  body.appendChild(foot);
  return body;
}

// ui/public/shape/changes-card.mjs — Shaper s5: the "Changes to …" proposal card (type 'changes'). Chrome: .ask-mcard.
const errorOf = (e) => String((e && e.body && e.body.error) || (e && e.message) || e || 'Something went wrong');
const APPLIED = {
  round: (r) => `Round ${r.round} started · ${r.pr ? `push it to update PR #${r.pr}` : "it reports into the run's card"}`,
  'next-plan': (r) => `Added to Run ${r.index}'s plan`,
  'extra-run': (r) => `Run ${r.index} added`,
  'follow-up': (r) => (r.index ? `Run ${r.index} added` : 'Follow-up started'),
};

export function renderChangesCard(doc, { state, card }, { onStart, onNotNow }) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const l = card.landing;
  if (state === 'declined') { const s = h('div', 'ask-card-stub ask-actcard-stub', `Not now: ${l.title}`); s.dataset.changesCard = 'declined'; return s; }
  const root = h('div', `ask-card ask-mcard ask-changescard is-${state}`);
  root.dataset.changesCard = state; root.dataset.landing = l.kind;
  const head = h('div', 'ask-mcard-head');
  head.append(h('span', 'ask-mcard-kind', 'Changes'), h('span', 'ask-mcard-title', l.title));
  const body = h('div', 'ask-mcard-body');
  root.append(head, body);
  if (state === 'applied') { body.appendChild(h('div', 'ask-changescard-done', (APPLIED[l.kind] || (() => 'Done'))(card.result || {}))); return root; }
  body.appendChild(h('blockquote', 'ask-changescard-quote', card.text));
  if (l.kind === 'round') body.appendChild(h('div', 'ask-changescard-where', [`Branch ${l.target.sourceBranch}`, l.target.pr && l.target.pr.number ? `PR #${l.target.pr.number}` : ''].filter(Boolean).join(' · ')));
  const err = h('div', 'ask-card-err'); err.setAttribute('aria-live', 'polite');
  const actions = h('div', 'ask-mcard-actions');
  actions.appendChild(h('span', 'ask-card-actions-spacer'));
  const nn = h('button', 'btn btn-sm btn-quiet ask-card-not-now', 'Not now'); nn.type = 'button';
  const go = h('button', 'btn btn-sm btn-primary', l.start); go.type = 'button';
  const lock = (on) => { nn.disabled = on; go.disabled = on; };
  const act = (fn) => async () => { lock(true); err.textContent = ''; try { await fn(); } catch (e) { err.textContent = errorOf(e); lock(false); } };
  nn.addEventListener('click', act(onNotNow));
  go.addEventListener('click', act(onStart));            // success stays locked: the flip frame rebuilds the card (Ship card rule)
  actions.append(nn, go);
  root.append(err, actions);
  return root;
}

export function buildChangesChatCard(block, ctx) {
  const card = { ...(block.card || {}), result: block.card && block.card.result };
  const el = renderChangesCard(ctx.doc, { state: block.state === 'applied' || block.state === 'declined' ? block.state : 'proposed', card }, {
    onStart: () => ctx.postCard(block, { verb: 'start' }),
    onNotNow: () => ctx.postCard(block, { verb: 'not-now' }),
  });
  return { el };
}

// ui/public/shape/route-card.mjs — Shaper s5: "Where does this go?" (type 'route', chip Route). One choice of three;
// the primary button names it (routeLabel).
import { routeLabel } from '../../../src/shared/shape/route.mjs';

const errorOf = (e) => String((e && e.body && e.body.error) || (e && e.message) || e || 'Something went wrong');
const DONE = { next: (r) => `Added to Run ${r.index}'s plan`, extra: (r) => `Run ${r.index} added`, own: () => 'Started its own run', save: () => 'Saved for the next checkpoint' };
let seq = 0;

export function renderRouteCard(doc, { state, card }, { onChoose, onNotNow, onOpenRun = null }) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (state === 'declined') return h('div', 'ask-card-stub ask-actcard-stub', 'Not now: kept in the chat');
  const root = h('div', `ask-card ask-mcard ask-routecard is-${state}`);
  root.dataset.routeCard = state;
  const head = h('div', 'ask-mcard-head');
  head.append(h('span', 'ask-mcard-kind', 'Route'), h('span', 'ask-mcard-title', 'Where does this go?'));
  const body = h('div', 'ask-mcard-body');
  root.append(head, body);
  body.appendChild(h('blockquote', 'ask-routecard-quote', card.text));
  if (state === 'applied') {
    const r = card.result || {};
    const key = r.verb === 'add' ? r.where : r.verb;
    const done = h('div', 'ask-routecard-done', (DONE[key] || (() => 'Done'))(r));
    if (r.runId && onOpenRun) { const a = h('button', 'ask-routecard-open', 'Open run'); a.type = 'button'; a.addEventListener('click', () => onOpenRun(r.runId)); done.append(' · ', a); }
    body.appendChild(done);
    return root;
  }
  body.appendChild(h('div', 'ask-routecard-guess', `Worca's guess: ${routeLabel(card.guess.choice, card.featureTitle)} (${card.guess.reason})`));
  const name = `route-${++seq}`;
  const group = h('div', 'ask-routecard-options'); group.setAttribute('role', 'radiogroup');
  const where = h('select', 'ask-routecard-where'); where.setAttribute('aria-label', 'Where in the feature');
  for (const [v, t] of [...(card.hasNext ? [['next', 'into the next run\'s plan']] : []), ['extra', 'as an extra run']]) { const o = h('option', null, t); o.value = v; where.appendChild(o); }
  where.value = card.guess.where === 'extra' || !card.hasNext ? 'extra' : 'next';
  const SUB = { own: 'from dev, own PR, runs alongside', save: 'shown at the next checkpoint' };
  let choice = card.guess.choice;
  const primary = h('button', 'btn btn-sm btn-primary', routeLabel(choice, card.featureTitle)); primary.type = 'button';
  for (const c of ['add', 'own', 'save']) {
    const lab = h('label', 'ask-routecard-option');
    const r = h('input'); r.type = 'radio'; r.name = name; r.value = c; r.checked = c === choice;
    r.addEventListener('change', () => { choice = c; primary.textContent = routeLabel(c, card.featureTitle); });
    r.addEventListener('click', () => { choice = c; primary.textContent = routeLabel(c, card.featureTitle); });
    lab.append(r, h('span', 'ask-routecard-label', routeLabel(c, card.featureTitle)));
    if (c === 'add') lab.appendChild(where); else lab.appendChild(h('span', 'ask-routecard-sub', SUB[c]));
    group.appendChild(lab);
  }
  body.appendChild(group);
  const err = h('div', 'ask-card-err'); err.setAttribute('aria-live', 'polite');
  const actions = h('div', 'ask-mcard-actions');
  actions.appendChild(h('span', 'ask-card-actions-spacer'));
  const nn = h('button', 'btn btn-sm btn-quiet ask-card-not-now', 'Not now'); nn.type = 'button';
  const lock = (on) => { nn.disabled = on; primary.disabled = on; };
  const act = (fn) => async () => { lock(true); err.textContent = ''; try { await fn(); } catch (e) { err.textContent = errorOf(e); lock(false); } };
  nn.addEventListener('click', act(onNotNow));
  primary.addEventListener('click', act(() => onChoose(choice === 'add' ? { verb: 'add', where: where.value } : { verb: choice })));
  actions.append(nn, primary);
  root.append(err, actions);
  return root;
}

export function buildRouteChatCard(block, ctx) {
  const state = block.state === 'applied' || block.state === 'declined' ? block.state : 'proposed';
  const el = renderRouteCard(ctx.doc, { state, card: { ...(block.card || {}), result: block.card && block.card.result } }, {
    onChoose: (v) => ctx.postCard(block, v), onNotNow: () => ctx.postCard(block, { verb: 'not-now' }),
    onOpenRun: (runId) => (typeof ctx.openRunPanel === 'function' ? ctx.openRunPanel({ runId }) : null),
  });
  return { el };
}

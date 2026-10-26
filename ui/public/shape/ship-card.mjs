// ui/public/shape/ship-card.mjs — Shaper s4: the Ship card. One renderer for the chat card (type 'ship') and the
// group page / Plans tab (feature-view.mjs shipBlock). Chrome: .ask-card .ask-mcard (style.css "Chat P2: Action cards").
import { CREATE_PR_LABEL, VIEW_PR_LABEL } from '../ship-words.mjs';
import { icon } from '../icons.mjs';
import { renderAskChanges } from '../chat/ask-changes.mjs';
import { shapeFirstOn } from '../chat/shape-gate.mjs';

const MINUS = '\u2212';
const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const errorOf = (e) => String((e && e.body && e.body.error) || (e && e.message) || e || 'Something went wrong');

/** '3 runs · 12 files · +840 −120'; unknown counts are left out. */
export function shipSummaryLine({ runs, files = null, added = null, deleted = null }) {
  const parts = [count(runs, 'run', 'runs')];
  if (Number.isFinite(files)) parts.push(count(files, 'file', 'files'));
  if (Number.isFinite(added) || Number.isFinite(deleted)) parts.push(`+${added || 0} ${MINUS}${deleted || 0}`);
  return parts.join(' · ');
}
export function shipReason(suggested, added) {
  if (suggested === 'one') return `This feature adds ${added || 0} lines: one PR is easier to review.`;
  if (suggested === 'stacked') return `This feature adds ${added || 0} lines: stacked PRs keep each review small.`;
  return '';
}

// One ship flow: app.js registers the shared Create PR dialog on every boot (the last boot wins); every Ship card's
// Create PR opens it.
let openShipDialog = null;
export function setShipDialogOpener(fn) { openShipDialog = typeof fn === 'function' ? fn : null; }

/**
 * model: { phase:'waiting'|'ready'|'applied'|'declined', featureId, title, runs, files, added, deleted, suggested, result }
 * handlers: { onNotNow?() → Promise, onAskChanges?(text) }  (no onNotNow → no Not now button). The ready card's Create PR
 * opens the dialog setShipDialogOpener registered, with the button and the card (D20: focus after it closes).
 */
export function renderShipCard(doc, m, handlers = {}) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  if (m.phase === 'waiting') {
    const w = h('div', 'ask-shipcard-wait', `Ship card comes when all ${m.runs} runs are done, here and in the chat.`);
    w.setAttribute('data-ship-card', 'waiting');
    return w;
  }
  if (m.phase === 'declined') {
    const s = h('div', 'ask-card-stub ask-actcard-stub ask-shipcard-stub', 'Not shipped yet · ship it from the feature page');
    s.setAttribute('data-ship-card', 'declined');
    return s;
  }
  const root = h('div', `ask-card ask-mcard ask-shipcard is-${m.phase}`);
  root.setAttribute('data-ship-card', m.phase);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Ship: ${m.title || ''}`);
  if (m.featureId) root.dataset.shipFeature = m.featureId;   // D20: the dialog finds the card again after it re-renders
  const head = h('div', 'ask-mcard-head');
  const title = h('span', 'ask-mcard-title', m.title || ''); title.title = m.title || '';
  head.append(h('span', 'ask-mcard-kind', m.phase === 'applied' ? 'Shipped' : 'Ship'), title);
  const body = h('div', 'ask-mcard-body');
  root.append(head, body);
  if (m.phase === 'applied') {
    const r = m.result || {};
    // The kind chip says Shipped: the line says how.
    const done = h('div', 'ask-shipcard-done', r.mode === 'one' ? 'As one PR' : 'As stacked PRs');
    if (r.prUrl) {
      const a = h('a', 'ask-shipcard-pr', VIEW_PR_LABEL);
      a.href = r.prUrl; a.target = '_blank'; a.rel = 'noopener';
      done.append(' · ', a);
    }
    body.appendChild(done);
    if (r.closed > 0) body.appendChild(h('div', 'ask-shipcard-closed', `Closed ${count(r.closed, 'draft', 'drafts')}`));
    if (r.release) body.appendChild(releaseLine(h, r.release));
    if (handlers.onAskChanges) body.appendChild(renderAskChanges(doc, { onSend: handlers.onAskChanges }).el);   // Shaper s5
    return root;
  }
  // ready: the kind chip says Ship; the line is the facts.
  body.appendChild(h('div', 'ask-shipcard-stats', shipSummaryLine(m)));
  const why = shipReason(m.suggested, m.added);
  if (why) body.appendChild(h('div', 'ask-shipcard-why', why));
  if (handlers.onAskChanges) body.appendChild(renderAskChanges(doc, { onSend: handlers.onAskChanges }).el);     // Shaper s5
  const err = h('div', 'ask-card-err'); err.setAttribute('aria-live', 'polite');
  root.appendChild(err);
  const actions = h('div', 'ask-mcard-actions');
  actions.appendChild(h('span', 'ask-card-actions-spacer'));
  const buttons = [];
  const button = (cls, text, act) => { const b = h('button', cls, text); b.type = 'button'; b.dataset.act = act; buttons.push(b); actions.appendChild(b); return b; };
  const lock = (on) => { for (const b of buttons) b.disabled = on; };
  if (handlers.onNotNow) {
    const nn = button('btn btn-sm btn-quiet ask-card-not-now', 'Not now', 'ship-not-now');
    nn.addEventListener('click', async () => {
      lock(true); err.textContent = '';
      try { await handlers.onNotNow(); } catch (e) { err.textContent = errorOf(e); lock(false); }
    });
  }
  const create = button('btn btn-sm btn-primary', null, 'ship-create');
  create.append(icon(doc, 'pr-create', 14), h('span', null, CREATE_PR_LABEL));
  create.addEventListener('click', () => {
    if (create.disabled) return;
    err.textContent = '';
    if (!openShipDialog) { err.textContent = 'Open the feature page to create its PR'; return; }
    // D20: busy until the dialog is open (or the load failed), so a double click opens one dialog.
    create.disabled = true;
    create.setAttribute('aria-busy', 'true');
    Promise.resolve().then(() => openShipDialog(m.featureId, { opener: create, card: root }))
      .catch((e) => { err.textContent = errorOf(e); })
      .finally(() => { create.disabled = false; create.removeAttribute('aria-busy'); });
  });
  root.appendChild(actions);
  return root;
}

function releaseLine(h, rel) {
  if (rel.url) {
    const d = h('div', 'ask-shipcard-rel', `Draft release ${rel.version} · `);
    const a = h('a', null, 'open it'); a.href = rel.url; a.target = '_blank'; a.rel = 'noopener';
    d.appendChild(a);
    return d;
  }
  if (rel.error) return h('div', 'ask-shipcard-rel is-failed', `Draft release ${rel.version} failed: ${rel.error}`);
  return h('div', 'ask-shipcard-rel', `Release ${rel.version} · draft after merge`);
}

/** The chat card (registerChatCard('ship', …)): verbs go to POST /api/ask/threads/:id/cards/:cardId. */
export function buildShipChatCard(block, ctx) {
  const c = block.card || {};
  const phase = block.state === 'applied' ? 'applied' : block.state === 'declined' ? 'declined' : 'ready';
  const say = (t) => { if (ctx && typeof ctx.announce === 'function') ctx.announce(t); };
  const el = renderShipCard(ctx.doc, { phase, featureId: c.featureId, title: c.title, runs: c.runs, files: c.files, added: c.added,
    deleted: c.deleted, suggested: c.suggested, result: c.result || null }, {
    onNotNow: async () => { await ctx.postCard(block, { verb: 'not-now' }); say('Ship card dismissed'); },
    ...(shapeFirstOn(ctx.doc) && typeof ctx.postChanges === 'function' ? { onAskChanges: (t) => ctx.postChanges({ featureId: c.featureId }, t) } : {}),
  });
  return { el };
}

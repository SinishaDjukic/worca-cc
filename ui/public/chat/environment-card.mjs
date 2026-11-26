// ui/public/chat/environment-card.mjs — the environment card (docs/environment-spec.md "From Chat"; card type
// `environment`, src/core/ask/env-proposal.mjs). Chat proposes a project's environment spec, a build of its template
// or image, or its sandbox network and template / image field; the user applies or declines it here. It is built in the
// grammar of the other applied-change cards (the proxy card: .ask-mcard, a before → after list, Keep as is / Apply) and
// answers `{ state: 'applied' | 'declined' }` on the existing card route. The route flips the block; this card re-renders.
import { registerChatCard } from './extensions.mjs';

export const ENV_CARD_TYPE = 'environment';

const TITLES = Object.freeze({ spec: 'Change the environment spec?', build: 'Build the sandbox environment?', config: 'Change the sandbox settings?' });

/** build(block, ctx) for the chat card registry (CONTRACT §2) → { el }. */
export function buildEnvironmentCard(block, ctx) {
  const doc = ctx.doc;
  const make = (tag, cls, text) => {
    const el = doc.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = String(text);
    return el;
  };
  const card = (block && block.card) || {};
  const summary = card.summary || 'Environment change';
  if (block.state === 'declined') return { el: make('div', 'ask-card-stub', `Declined: ${summary}`) };
  const rootEl = make('div', `ask-card ask-mcard ask-envcard is-${block.state}`);
  rootEl.setAttribute('data-ask-envcard', block.state);
  rootEl.dataset.cardId = block.id || '';
  const head = make('div', 'ask-mcard-head');
  head.appendChild(make('span', 'ask-mcard-title', TITLES[card.kind] || 'Change the sandbox environment?'));
  rootEl.appendChild(head);
  const body = make('div', 'ask-mcard-body');
  // Dynamic names go in the target line, never the title (docs/design-system.md, Card head).
  const target = [`project ${card.projectName || card.projectKey || ''}`, card.backendLabel || ''].filter(Boolean).join(' · ');
  body.appendChild(make('div', 'ask-mcard-target', target));
  if (card.note) body.appendChild(make('div', 'ask-mcard-note', card.note));
  const list = make('ul', 'ask-mcard-changes');
  for (const c of Array.isArray(card.changes) ? card.changes : []) {
    const li = make('li');
    li.appendChild(make('span', 'ask-mcard-change-label', c.label || ''));
    const val = make('span', 'ask-mcard-change-val');
    if (c.before) {
      val.appendChild(make('span', `ask-mcard-before${c.before === 'none' ? ' is-unset' : ''}`, c.before));
      val.appendChild(make('span', 'ask-mcard-arrow', '→'));
    }
    val.appendChild(make('span', `ask-mcard-after${c.after === 'none' ? ' is-unset' : ''}`, c.after ?? ''));
    li.appendChild(val);
    list.appendChild(li);
  }
  body.appendChild(list);
  const result = card.result || null;
  if (block.state === 'failed') body.appendChild(make('div', 'ask-mcard-failed', `Could not apply: ${block.error || (result && result.error) || 'unknown error'}`));
  else if (block.state === 'applied') body.appendChild(make('div', 'ask-awcard-saved', result && result.detail ? result.detail : 'Saved.'));
  else {
    const hint = card.buildNote || card.rebuildNote || card.networkNote || '';
    if (hint) body.appendChild(make('div', 'ask-mcard-hint', hint));
  }
  rootEl.appendChild(body);
  const err = make('div', 'ask-card-err');   // a refused POST is written here (every card has one)
  rootEl.appendChild(err);
  if (block.state === 'proposed') {
    const actions = make('div', 'ask-mcard-actions');
    const btn = (cls, text, attr) => { const b = make('button', cls, text); b.type = 'button'; b.setAttribute(attr, ''); return b; };
    const keep = btn('btn btn-sm btn-quiet ask-card-not-now', 'Keep as is', 'data-ask-env-decline');
    const apply = btn('btn btn-sm btn-primary', card.kind === 'build' ? 'Build' : 'Apply', 'data-ask-env-apply');
    // The flip frame rebuilds the card on success; a refusal keeps it and says why (as the built-in cards' postCard).
    const post = async (state) => {
      err.textContent = '';
      keep.disabled = true; apply.disabled = true;
      try {
        const out = await ctx.postCard(block, { state });
        if (out && out.turn && out.turn.error) err.textContent = `Chat could not reply: ${out.turn.error}`;
      } catch (e) {
        const msg = e && e.message ? e.message : 'failed';
        err.textContent = e && e.status === 409 && msg === 'turn in flight' ? 'Chat is still replying. Try again once the answer lands.' : msg;
      } finally { keep.disabled = false; apply.disabled = false; }
    };
    keep.addEventListener('click', () => post('declined'));
    apply.addEventListener('click', () => post('applied'));
    actions.append(make('span', 'ask-card-actions-spacer'), keep, apply);
    rootEl.appendChild(actions);
  }
  return { el: rootEl };
}

/** Registers the card type (app.js, before the chat mounts). Calling it again replaces the builder. */
export function registerEnvironmentCard() {
  registerChatCard(ENV_CARD_TYPE, buildEnvironmentCard);
}

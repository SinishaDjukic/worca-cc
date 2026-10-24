// ui/public/chat/action-cards.mjs — worca Chat P2 (CONTRACT §4): the chat's three action cards, built from the block
// and the card ctx (CONTRACT §2) alone.
//  - receipt: an action worca already applied (a setting, pause, resume, Away mode, a schedule, a direction) — what
//    it changed, before → after, and Revert (R6).
//  - run-stop: the stop warning itself (R7) — "Keep running" or the red "Stop run".
//  - pull-request: a finished run's pull request offer (R9) — its button opens the Create PR dialog with the card's link.
// The chrome is the Ask card's (.ask-card, .ask-mcard-*, .ask-card-not-now / -err); style.css
// "Chat P2: Action cards" adds the rest. Emphasis is a background wash, never an edge line.
import { CREATE_PR_LABEL, PR_CREATED, VIEW_PR_LABEL } from '../ship-words.mjs';
import { icon } from '../icons.mjs';
import { registerChatCard } from './extensions.mjs';
import { buildShipChatCard } from '../shape/ship-card.mjs';
import { buildChangesChatCard } from '../shape/changes-card.mjs';
import { buildRouteChatCard } from '../shape/route-card.mjs';
import { prWatchTooltip } from './pr-watch-words.mjs';
import { renderAskChanges } from './ask-changes.mjs';
import { shapeFirstOn } from './shape-gate.mjs';

export const RECEIPT_CHIPS = Object.freeze({
  setting: 'Setting', pause: 'Paused', resume: 'Resumed', 'away-now': 'Away mode', 'run-away': 'Away mode',
  'schedule-pause': 'Schedule paused', 'schedule-resume': 'Schedule resumed', direction: 'Direction sent',
});

function make(doc, tag, cls, text) {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}
function makeButton(doc, cls, text, attr) {
  const b = make(doc, 'button', cls, text);
  b.type = 'button';
  if (attr) b.setAttribute(attr, '');
  return b;
}
const errorOf = (err) => String((err && err.body && err.body.error) || (err && err.message) || err || 'Something went wrong');
const announce = (ctx, text) => { if (ctx && typeof ctx.announce === 'function') ctx.announce(text); };
const shortKey = (key) => String(key || '').replace(/-[0-9a-f]{8}$/, '');
/** The head's title: one line, cut with an ellipsis (style.css), the whole text on hover. */
function titleSpan(doc, text) {
  const span = make(doc, 'span', 'ask-mcard-title', text);
  span.title = String(text ?? '');
  return span;
}

/** The receipt's title: the setting's label, or what the action acted on (a run, a schedule). Away now has none: its
 *  chip already says "Away mode". */
function receiptTitle(card) {
  const t = card.target || {};
  if (card.kind === 'away-now') return '';
  if (card.kind === 'setting') return card.label || 'Setting';
  return t.title || card.label || '';
}
function receiptWhere(card) {
  const t = card.target || {};
  if (card.kind === 'setting') return t.scope === 'project' ? `Project ${t.title || t.projectKey || ''}`.trim() : 'Your settings';
  if (card.kind === 'run-away') return 'This run only';
  return '';
}

export function buildReceiptCard(block, ctx) {
  const doc = ctx.doc;
  const card = block.card || {};
  const result = card.result || {};
  const state = block.state || 'applied';
  const reverted = state === 'reverted';
  const chip = RECEIPT_CHIPS[card.kind] || 'Change';
  const title = receiptTitle(card);
  const name = title || chip;                          // what aria-labels and announcements call it
  const root = make(doc, 'div', `ask-card ask-mcard ask-rcard is-${state}`);
  root.setAttribute('data-chat-receipt', state);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', title ? `${chip}: ${title}` : chip);
  const head = make(doc, 'div', 'ask-mcard-head');
  head.appendChild(make(doc, 'span', 'ask-mcard-kind', chip));
  if (title) head.appendChild(titleSpan(doc, title));
  root.appendChild(head);
  const body = make(doc, 'div', 'ask-mcard-body');
  const where = receiptWhere(card);
  if (where) body.appendChild(make(doc, 'div', 'ask-mcard-target', where));
  if (card.kind === 'direction') body.appendChild(make(doc, 'div', 'ask-rcard-text', card.after));
  else {
    const change = make(doc, 'div', 'ask-rcard-change');
    change.append(make(doc, 'span', 'ask-mcard-before', card.before), make(doc, 'span', 'ask-mcard-arrow', '→'), make(doc, 'span', 'ask-mcard-after', card.after));
    body.appendChild(change);
  }
  const note = make(doc, 'div', 'ask-rcard-note');   // no live region: ctx.announce speaks each outcome once
  if (reverted) note.textContent = 'Reverted';
  else if (result.code === 'CHANGED_SINCE') note.textContent = 'Not reverted: it changed since';
  body.appendChild(note);
  root.appendChild(body);
  const err = make(doc, 'div', 'ask-card-err');
  err.setAttribute('aria-live', 'polite');
  root.appendChild(err);
  if (!reverted && card.revertible === true) {
    const actions = make(doc, 'div', 'ask-mcard-actions');
    const revert = makeButton(doc, 'btn btn-sm btn-quiet ask-card-not-now ask-rcard-revert', 'Revert', 'data-chat-revert');
    revert.setAttribute('aria-label', `Revert ${name}`);
    if (result.code === 'CHANGED_SINCE') revert.disabled = true;
    revert.addEventListener('click', async () => {
      if (revert.disabled) return;
      revert.disabled = true; revert.textContent = 'Reverting…'; err.textContent = '';
      try {
        await ctx.postCard(block, { state: 'reverted' });
        revert.textContent = 'Revert';
        note.textContent = 'Reverted';
        actions.hidden = true;                         // the server's frame rebuilds the card as reverted
        announce(ctx, `Reverted ${name}`);
      } catch (e) {
        const code = e && e.body && e.body.code;
        revert.textContent = 'Revert';
        if (code === 'CHANGED_SINCE' || code === 'ALREADY_REVERTED') {   // stays disabled (R6)
          note.textContent = code === 'CHANGED_SINCE' ? 'Not reverted: it changed since' : 'Already reverted';
          announce(ctx, note.textContent);
          return;
        }
        err.textContent = errorOf(e);
        revert.disabled = false;
      }
    });
    actions.append(make(doc, 'span', 'ask-card-actions-spacer'), revert);
    root.appendChild(actions);
  }
  return { el: root };
}

export function buildRunStopCard(block, ctx) {
  const doc = ctx.doc;
  const card = block.card || {};
  const title = card.title || card.pipelineId || 'this run';
  if (block.state === 'declined') return { el: make(doc, 'div', 'ask-card-stub ask-actcard-stub', `Not stopped: ${title}`) };
  const root = make(doc, 'div', `ask-card ask-mcard ask-stopcard is-${block.state}`);
  root.setAttribute('data-chat-run-stop', block.state);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Stop this run?');
  const head = make(doc, 'div', 'ask-mcard-head');
  head.appendChild(make(doc, 'span', 'ask-mcard-title', 'Stop this run?'));
  root.appendChild(head);
  const body = make(doc, 'div', 'ask-mcard-body');
  const ident = make(doc, 'div', 'ask-stopcard-ident');
  const name = make(doc, 'div', 'ask-stopcard-title', title);
  if (card.branch) name.title = card.branch;
  ident.appendChild(name);
  body.appendChild(ident);
  body.appendChild(make(doc, 'div', 'ask-stopcard-copy', "A stopped run can't be resumed. Its work so far stays on its branch."));
  if (block.state === 'applied') body.appendChild(make(doc, 'div', 'ask-stopcard-done', 'Stopped'));
  if (block.state === 'failed') body.appendChild(make(doc, 'div', 'ask-mcard-failed', `Could not stop: ${block.error || (card.result && card.result.error) || 'unknown error'}`));
  root.appendChild(body);
  const err = make(doc, 'div', 'ask-card-err');
  err.setAttribute('aria-live', 'polite');
  root.appendChild(err);
  if (block.state === 'proposed') {
    const actions = make(doc, 'div', 'ask-mcard-actions');
    // Like #stop-modal: the way out keeps a paused run paused.
    const keep = makeButton(doc, 'btn btn-sm btn-quiet ask-card-not-now', card.status === 'paused' ? 'Keep paused' : 'Keep running', 'data-chat-stop-keep');
    const stop = makeButton(doc, 'btn btn-sm btn-danger', 'Stop run', 'data-chat-stop-confirm');
    const busy = (on, label = 'Stop run') => { keep.disabled = on; stop.disabled = on; stop.textContent = label; };
    keep.addEventListener('click', async () => {
      busy(true); err.textContent = '';
      try { await ctx.postCard(block, { state: 'declined' }); } catch (e) { err.textContent = errorOf(e); busy(false); }
    });
    stop.addEventListener('click', async () => {
      busy(true, 'Stopping…'); err.textContent = '';
      try {
        // The route answers 200 with the card flipped to failed when the stop was refused (an interrupted run).
        const out = await ctx.postCard(block, { state: 'applied' });
        const b = out && out.block;
        announce(ctx, b && b.state === 'failed' ? `Could not stop: ${b.error || 'unknown error'}` : `Stopping ${title}`);
      }
      catch (e) { err.textContent = errorOf(e); busy(false); }
    });
    actions.append(make(doc, 'span', 'ask-card-actions-spacer'), keep, stop);
    root.appendChild(actions);
  }
  return { el: root };
}

/** The watch tooltips of applied pull-request cards' links (one per PR), live while their card is: refreshChatPrWatch
 *  re-reads the ones a pr-watch-changed frame names; a card's dispose drops them. Shaper s5 (D23): the watch is the
 *  link's tooltip, never a line under the card. */
const watchLines = new Set();

function paintWatchLine(line, view) {
  line.el.title = prWatchTooltip(line.number, view);
}
/** GET /api/pr/watch for one line; a change announced while a read is out reads once more after it. */
function loadWatchLine(line) {
  if (line.dead) return;
  if (line.loading) { line.again = true; return; }
  line.loading = true;
  const q = new URLSearchParams({ id: line.pipelineId, projectKey: line.projectKey, ...(line.memberKey ? { memberKey: line.memberKey } : {}) });
  // The read goes out now (a throw becomes a rejection); its answer paints later.
  new Promise((resolve) => resolve(line.fetch(`/api/pr/watch?${q}`)))
    .then((r) => (r && r.ok ? r.json() : null))
    .catch(() => null)
    .then((view) => {
      line.loading = false;
      if (line.dead) return;
      if (line.again) { line.again = false; loadWatchLine(line); return; }
      paintWatchLine(line, view);
    });
}
/** pr-watch-changed (app.js): re-read every chat watch line for that run's PR — the frame names the run that opened it
 *  and, on a workspace run, the member. → the number of lines re-read */
export function refreshChatPrWatch(frame) {
  if (!frame || typeof frame.pipelineId !== 'string') return 0;
  let n = 0;
  for (const line of watchLines) {
    if (line.pipelineId !== frame.pipelineId || (line.memberKey || '') !== (frame.memberKey || '')) continue;
    loadWatchLine(line);
    n += 1;
  }
  return n;
}

export function buildPullRequestCard(block, ctx) {
  const doc = ctx.doc;
  const card = block.card || {};
  const title = card.title || card.pipelineId || 'this run';
  if (block.state === 'declined') return { el: make(doc, 'div', 'ask-card-stub ask-actcard-stub', `Not now: ${title}`) };
  const root = make(doc, 'div', `ask-card ask-mcard ask-prcard is-${block.state}`);
  root.setAttribute('data-chat-pr', block.state);
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', `Pull request: ${title}`);
  const head = make(doc, 'div', 'ask-mcard-head');
  head.append(make(doc, 'span', 'ask-mcard-kind', 'Pull request'), titleSpan(doc, title));
  root.appendChild(head);
  const body = make(doc, 'div', 'ask-mcard-body');
  if (card.branch) {
    const br = make(doc, 'div', 'ask-prcard-branch');
    br.appendChild(make(doc, 'code', null, card.branch));
    if (card.base) br.append(make(doc, 'span', 'ask-mcard-arrow', '→'), make(doc, 'code', null, card.base));
    body.appendChild(br);
  }
  if (Number.isFinite(card.filesChanged)) {
    const files = `${card.filesChanged} file${card.filesChanged === 1 ? '' : 's'}`;
    body.appendChild(make(doc, 'div', 'ask-prcard-stat', `${files} · +${Number(card.additions) || 0} −${Number(card.deletions) || 0}`));   // U+2212: a count
  }
  const result = card.result || null;
  const lines = [];
  if (block.state === 'applied' && result) {
    const links = make(doc, 'div', 'ask-prcard-links');
    const entries = Array.isArray(result.members) && result.members.length ? result.members : [result];
    const anchors = new Map();
    for (const m of entries) {
      if (!m || !m.url) continue;
      const a = make(doc, 'a', 'ask-card-link ask-prcard-link', entries.length > 1 && m.memberKey ? `${VIEW_PR_LABEL} · ${shortKey(m.memberKey)}` : VIEW_PR_LABEL);
      a.href = m.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      links.appendChild(a);
      anchors.set(m, a);
      if (m.draft) links.appendChild(make(doc, 'span', 'ask-mcard-kind', 'Draft'));
    }
    body.appendChild(links);
    // Watch PR: each link's tooltip says whether its PR is watched (the run page keeps the switch).
    if (card.pipelineId && typeof ctx.fetch === 'function') {
      for (const [m, el] of anchors) {
        const line = { el, number: String(m.url).split('/').filter(Boolean).pop(), fetch: ctx.fetch, pipelineId: card.pipelineId,
          projectKey: card.projectKey || '', memberKey: m.memberKey || null, loading: false, again: false, dead: false };
        watchLines.add(line);
        lines.push(line);
        loadWatchLine(line);
      }
    }
    // Shaper s5: Ask for changes on the opened PR's run (the server mints the changes card).
    if (card.pipelineId && !card.workspaceId && shapeFirstOn(doc) && typeof ctx.postChanges === 'function') {   // a workspace run has no single branch to change
      body.appendChild(renderAskChanges(doc, { onSend: (t) => ctx.postChanges({ pipelineId: card.pipelineId }, t) }).el);
    }
  }
  if (block.state === 'failed') body.appendChild(make(doc, 'div', 'ask-mcard-failed', `Could not open: ${block.error || (result && result.error) || 'unknown error'}`));
  root.appendChild(body);
  const err = make(doc, 'div', 'ask-card-err');
  err.setAttribute('aria-live', 'polite');
  root.appendChild(err);
  if (block.state === 'proposed') {
    const actions = make(doc, 'div', 'ask-mcard-actions');
    actions.dataset.needsGit = '';
    const later = makeButton(doc, 'btn btn-sm btn-quiet ask-card-not-now', 'Not now', 'data-chat-pr-decline');
    const create = makeButton(doc, 'btn btn-sm btn-primary', CREATE_PR_LABEL, 'data-chat-pr-create');
    create.prepend(icon(doc, 'pr-create', 14));      // PR controls (design system): the glyph leads
    const lock = (on) => { later.disabled = on; create.disabled = on; };
    later.addEventListener('click', async () => {
      lock(true); err.textContent = '';
      try { await ctx.postCard(block, { state: 'declined' }); } catch (e) { err.textContent = errorOf(e); lock(false); }
    });
    create.addEventListener('click', async () => {
      err.textContent = '';
      if (typeof ctx.openShipIt !== 'function') { err.textContent = 'Could not open the Create PR dialog.'; return; }
      lock(true);                                      // one dialog per card, until it closes
      let r = null;
      try {
        // P1's ctx delegates to app.js chatDeps.openShipIt (openShipItFor) at call time; it settles when the dialog closes.
        r = await ctx.openShipIt({ pipelineId: card.pipelineId, projectKey: card.projectKey, ...(card.workspaceId ? { workspaceId: card.workspaceId } : {}) },
          { askThreadId: ctx.threadId(), askCardId: block.id });
      } catch (e) { r = { opened: false, error: errorOf(e) }; }
      if (!r || typeof r !== 'object') r = { opened: false, error: 'Could not open the Create PR dialog.' };   // no opener assigned yet
      if (r.error) err.textContent = r.error;
      if (r.opened) { announce(ctx, PR_CREATED); return; }   // POST /api/pr flipped the card; it rebuilds as applied
      lock(false);
      // The dialog took the focus: give it back to the button that opened it (Chrome drops it on <body>, jsdom on the hidden dialog).
      const a = doc.activeElement;
      if (!a || a === doc.body || (typeof a.closest === 'function' && a.closest('.hidden'))) create.focus();
    });
    actions.append(make(doc, 'span', 'ask-card-actions-spacer'), later, create);
    root.appendChild(actions);
  }
  return { el: root, dispose: () => { for (const l of lines) { l.dead = true; watchLines.delete(l); } } };
}

/** Register the three cards (and the Shaper's Ship card) with the chat's card registry (CONTRACT §2) — app.js calls it before the chat mounts. A second
 *  call replaces the first (P1 registry rule): app.js is re-evaluated on every jsdom boot. */
export function registerChatActionCards() {
  registerChatCard('receipt', (block, ctx) => buildReceiptCard(block, ctx));
  registerChatCard('run-stop', (block, ctx) => buildRunStopCard(block, ctx));
  registerChatCard('pull-request', (block, ctx) => buildPullRequestCard(block, ctx));
  registerChatCard('ship', (block, ctx) => buildShipChatCard(block, ctx));   // Shaper s4 (ui/public/shape/ship-card.mjs)
  registerChatCard('changes', (block, ctx) => buildChangesChatCard(block, ctx));   // Shaper s5 (ui/public/shape/changes-card.mjs)
  registerChatCard('route', (block, ctx) => buildRouteChatCard(block, ctx));       // Shaper s5 (ui/public/shape/route-card.mjs)
}

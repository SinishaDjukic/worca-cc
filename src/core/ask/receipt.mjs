// src/core/ask/receipt.mjs
// worca Chat P2 (U1, R6–R9): the chat's action cards as data — the receipt a direct action posts (applied →
// reverted), one-line summaries for the [worca context] block, the actor a chat action is recorded as, and
// POST /api/pr's ask-link rules for the pull-request card. Pure and import-free: settings-registry.mjs,
// action-deps.mjs and ui/server.mjs share it.

export const RECEIPT_KINDS = Object.freeze(['setting', 'pause', 'resume', 'away-now', 'run-away', 'schedule-pause', 'schedule-resume', 'direction']);

/** A receipt card (CONTRACT §4). `before` / `after` are display strings; `raw` holds what a Revert writes back —
 *  never a secret (the settings registry never reaches one). */
export function receiptCard({ kind, label, target = {}, before = '', after = '', raw = {}, revertible = true } = {}) {
  if (!RECEIPT_KINDS.includes(kind)) throw new Error(`unknown receipt kind "${kind}"`);
  return {
    type: 'receipt', kind, label: String(label ?? ''),
    target: target && typeof target === 'object' ? { ...target } : {},
    before: String(before ?? ''), after: String(after ?? ''),
    raw: raw && typeof raw === 'object' ? { ...raw } : {},
    revertible: revertible === true,
  };
}

/** The [worca context] line of a receipt, a stop warning, a pull-request offer or a Ship card (ui/server.mjs resolveAskContext). */
/** Shaper s5: an applied changes card's outcome. A round's number is the one taken at Start (result.round). */
function changesDone(c) {
  const r = c.result || {};
  const kind = c.landing && c.landing.kind;
  if (kind === 'round') return `Round ${r.round} started`;
  if (kind === 'next-plan') return `Added to Run ${r.index}'s plan`;
  return r.index ? `Run ${r.index} added` : 'Follow-up started';
}
/** Shaper s5: an applied Route card's outcome. */
function routeDone(r) {
  if (r.verb === 'save') return 'Saved for the next checkpoint';
  if (r.verb === 'own') return 'Started its own run';
  return r.where === 'next' ? `Added to Run ${r.index}'s plan` : `Run ${r.index} added`;
}

export function chatActionSummary(card) {
  const c = card && typeof card === 'object' ? card : {};
  const t = c.target && typeof c.target === 'object' ? c.target : {};
  const where = t.title && !(c.kind === 'setting' && t.scope !== 'project') ? ` (${t.title})` : '';
  if (c.type === 'receipt') return c.kind === 'direction' ? `Direction${where}: ${c.after}` : `${c.label}${where}: ${c.before} → ${c.after}`;
  if (c.type === 'run-stop') return `Stop ${c.title || c.pipelineId || 'run'}`;
  if (c.type === 'pull-request') return `Pull request for ${c.title || c.pipelineId || 'run'}${c.result && c.result.url ? `: ${c.result.url}` : ''}`;
  if (c.type === 'ship') return `Ship ${c.title || c.featureId || 'feature'}${c.result && c.result.mode ? `: shipped as ${c.result.mode === 'one' ? 'one PR' : 'stacked PRs'}` : ''}`;
  if (c.type === 'changes') return `${(c.landing && c.landing.title) || 'Changes'}${c.result ? `: ${changesDone(c)}` : ''}`;
  if (c.type === 'route') return `Where does this go: ${c.text || ''}${c.result ? `: ${routeDone(c.result)}` : ''}`;
  return '';
}

/** Who a chat action is recorded as (audit lines, lastAction): "<person> via worca chat", or "worca chat" when nobody
 *  in particular is signed in. byActor() then reads " by worca chat". */
export function askActorFor(person) {
  const who = typeof person === 'string' ? person.trim() : '';
  return who && who !== 'local' ? `${who} via worca chat` : 'worca chat';
}

/** POST /api/pr's ask link (CONTRACT §4): the pull-request card a PR is opened from must name this run and still be
 *  proposed — except that a workspace's later member PRs find it applied by the first one, which is allowed.
 *  @returns {{status:number, error:string}|null} why not, or null */
export function prCardLinkRefusal(block, { id, memberKey = null } = {}) {
  const card = block && block.card;
  if (!card || card.type !== 'pull-request') return { status: 400, error: 'unknown askCardId' };
  if (card.pipelineId !== id) return { status: 400, error: 'askCardId belongs to another run' };
  if (block.state === 'proposed') return null;
  if (block.state === 'applied' && memberKey) return null;
  return { status: 409, error: `card is ${block.state}` };
}

/** The pull-request card's result after one more opened PR: the first sets {url, draft, existed}; a workspace's
 *  member PRs also collect in `members` (each {url, draft, existed, memberKey}). */
export function prCardResult(block, entry) {
  const prev = block && block.state === 'applied' && block.card && block.card.result ? block.card.result : null;
  const one = { url: entry.url, draft: entry.draft === true, existed: entry.existed === true, ...(entry.memberKey ? { memberKey: entry.memberKey } : {}) };
  if (!prev) return { url: one.url, draft: one.draft, existed: one.existed, ...(one.memberKey ? { members: [one] } : {}) };
  // The same card applied twice (two tabs pressed Create): the first PR stands — one link per project run, one per member.
  const members = Array.isArray(prev.members) ? prev.members : [];
  if (!one.memberKey || members.some((m) => m && m.memberKey === one.memberKey)) return prev;
  return { ...prev, members: [...members, one] };
}

// src/core/ask/composer-payload.mjs
// The composer chat's per-message canvas (D11) and its cards (D13). Pure: the messages route validates the
// canvas with validateComposerPayload, turn.mjs builds cards with composerCardFrom, and the cards route checks
// the clicks with composerCardPatch (no event turn: the next message carries the canvas anyway).
import { normalizeTemplate } from '../../shared/graph/template.mjs';
import { KINDS, NODE_ID_RE } from '../../shared/graph/constants.mjs';
import { MARKER_RE } from '../../shared/graph/canvas-summary.mjs';

export const COMPOSER_SESSION_RE = /^cs_[a-z0-9]{8}$/;
export const COMPOSER_DOC_RE = /^d_[a-z0-9]{8}$/;
// wires ≤ LIMITS.maxWires (200, constants.mjs): past it validateGraph returns ONLY V1, so every later batch would
// look like it added a "new" error and be refused.
export const COMPOSER_LIMITS = Object.freeze({ nodes: 80, wires: 200, drafts: 8, bytes: 262144, card: 200000 });
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const arr = (v) => (Array.isArray(v) ? v : []);
const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const int = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

/** @returns {{ok:true, value:object} | {ok:false, error:string}} */
export function validateComposerPayload(raw) {
  if (!isObj(raw)) return { ok: false, error: 'composer must be an object' };
  let size = 0;
  try { size = JSON.stringify(raw).length; } catch { return { ok: false, error: 'composer is not JSON' }; }
  if (size > COMPOSER_LIMITS.bytes) return { ok: false, error: `composer is larger than ${COMPOSER_LIMITS.bytes} bytes` };
  if (!COMPOSER_SESSION_RE.test(String(raw.sessionId || ''))) return { ok: false, error: 'composer.sessionId is invalid' };
  if (!COMPOSER_DOC_RE.test(String(raw.docToken || ''))) return { ok: false, error: 'composer.docToken is invalid' };
  if (!isObj(raw.graph)) return { ok: false, error: 'composer.graph is required' };
  const g = raw.graph;
  if (!Array.isArray(g.nodes) || !Array.isArray(g.wires)) return { ok: false, error: 'composer.graph needs nodes and wires' };
  if (g.nodes.length > COMPOSER_LIMITS.nodes || g.wires.length > COMPOSER_LIMITS.wires) return { ok: false, error: 'composer.graph is too large' };
  // The shapes validateGraph assumes, which V2/V3 hold every saved canvas to: a node whose kind is an Object.prototype
  // name crashed V17 (`KNOWN_CONFIG[kind].has`) — a 500 after the user's message was stored. Wire ids are NOT held to
  // WIRE_ID_RE on Save (V6 checks duplicates only), so any non-empty string passes; the summary flattens it.
  const badNode = g.nodes.findIndex((n) => !isObj(n) || typeof n.id !== 'string' || !NODE_ID_RE.test(n.id) || !KINDS.includes(n.kind)
    || !Number.isFinite(n.x) || !Number.isFinite(n.y) || (n.config !== undefined && !isObj(n.config)));
  if (badNode >= 0) return { ok: false, error: `composer.graph: malformed node at index ${badNode}` };
  const badWire = g.wires.findIndex((w) => !isObj(w) || typeof w.id !== 'string' || !w.id || !isObj(w.from) || !isObj(w.to));
  if (badWire >= 0) return { ok: false, error: `composer.graph: malformed wire at index ${badWire}` };
  let graph;
  try {
    graph = normalizeTemplate({ id: typeof g.id === 'string' ? g.id.slice(0, 80) : '', name: str(g.name, 120), version: 2,
      domain: str(g.domain, 60), nodes: g.nodes, wires: g.wires });
  } catch (e) { return { ok: false, error: `composer.graph: ${e && e.message ? e.message : e}` }; }
  const s = raw.selection;
  // A selection names a node or wire ON this canvas, or nothing: its id rides the [composer canvas] block.
  const pool = isObj(s) && s.kind === 'node' ? graph.nodes : isObj(s) && s.kind === 'wire' ? graph.wires : [];
  const selection = pool.some((x) => x.id === s.id) ? { kind: s.kind, id: s.id } : null;
  const drafts = [];
  for (const d of arr(raw.drafts).slice(0, COMPOSER_LIMITS.drafts)) {
    if (!isObj(d) || (d.kind !== 'agent' && d.kind !== 'script') || !KEY_RE.test(String(d.key || '')) || !isObj(d.meta)) continue;
    drafts.push({ kind: d.kind, key: d.key, meta: d.meta });
  }
  return { ok: true, value: { sessionId: raw.sessionId, docToken: raw.docToken, graph, selection, dirty: raw.dirty === true, drafts } };
}

/** The four tools whose RESULT is a card (events.mjs hook → turn.mjs). */
export const COMPOSER_TOOL_CARDS = Object.freeze({
  mcp__worca__edit_canvas: 'canvas-edit',
  mcp__worca__build_workflow: 'workflow-build',
  mcp__worca__draft_agent: 'agent-draft',
  mcp__worca__draft_script: 'script-draft',
});

/** A tool result → its card payload (null = no card: an error, a foreign tool, an oversized result). */
export function composerCardFrom(toolName, out, session) {
  const type = COMPOSER_TOOL_CARDS[toolName];
  if (!type || !isObj(out) || out.ok !== true) return null;
  const base = { type, sessionId: (session && session.sessionId) || null, docToken: (session && session.docToken) || null };
  let card;
  if (type === 'canvas-edit') {
    card = { ...base, summary: str(out.summary, 160), ops: arr(out.ops), added: arr(out.added), removed: arr(out.removed),
      todo: int(out.todo), warnings: arr(out.warnings).slice(0, 8) };
  } else if (type === 'workflow-build') {
    if (!isObj(out.workflow)) return null;
    card = { ...base, name: str(out.name, 60), domain: str(out.domain, 60), reasoning: str(out.reasoning, 600),
      workflow: { nodes: arr(out.workflow.nodes), wires: arr(out.workflow.wires) }, counts: isObj(out.counts) ? out.counts : {},
      loops: arr(out.loops).slice(0, 20), drafts: arr(out.drafts).slice(0, 8), todo: int(out.todo), warnings: arr(out.warnings).slice(0, 8) };
  } else {
    if (!isObj(out.draft)) return null;
    card = { ...base, draft: out.draft, then: isObj(out.then) ? { ops: arr(out.then.ops) } : null };
  }
  try { if (JSON.stringify(card).length > COMPOSER_LIMITS.card) return null; } catch { return null; }
  return card;
}

const TRANSITIONS = Object.freeze({
  'canvas-edit': { proposed: ['applied', 'failed', 'declined'], applied: ['undone'] },
  'workflow-build': { proposed: ['applied', 'declined', 'failed'], applied: ['undone'] },
  'agent-draft': { proposed: ['saved', 'added', 'declined', 'failed'], saved: ['added'] },
  'script-draft': { proposed: ['saved', 'added', 'declined', 'failed'], saved: ['added'] },
});
export const isComposerCard = (card) => Boolean(card && Object.prototype.hasOwnProperty.call(TRANSITIONS, card.type));

/** A composer card's row in the [worca context] `cards:` line (resolveAskContext): its type, state and one name, so the
 *  model knows which drafts the user saved or declined — never the run-card shape `(<workflowId> on <target>)`. */
export function composerHeaderCard(b) {
  if (!b || !isComposerCard(b.card)) return null;
  const c = b.card;
  const d = isObj(c.draft) ? c.draft : {};
  const name = c.type === 'canvas-edit' ? c.summary : c.type === 'workflow-build' ? c.name : ((isObj(d.meta) && d.meta.displayName) || d.key);
  // A model-written name never spells a block marker: this line sits just before the real [composer canvas] block.
  return { id: b.id, type: c.type, state: b.state, summary: str(name, 160).replace(MARKER_RE, '($1)') };
}

/** A click on a composer card → the store patch, or why not. */
export function composerCardPatch(card, fromState, body) {
  const next = body && body.state;
  const all = [...new Set(Object.values(TRANSITIONS[card.type]).flat())];
  if (!all.includes(next)) return { ok: false, status: 400, error: `state must be one of ${all.join(', ')}` };
  if (!(TRANSITIONS[card.type][fromState] || []).includes(next)) return { ok: false, status: 409, error: `card is ${fromState}` };
  const patch = { state: next };
  if (next === 'failed') patch.error = typeof body.error === 'string' && body.error.trim() ? body.error.trim().slice(0, 300) : 'failed';
  const sub = {};
  if (isObj(body.card) && typeof body.card.savedKey === 'string' && KEY_RE.test(body.card.savedKey)) sub.savedKey = body.card.savedKey;
  if (isObj(body.card) && body.card.added === true) sub.added = true;
  if (Object.keys(sub).length) patch.card = sub;
  return { ok: true, patch };
}

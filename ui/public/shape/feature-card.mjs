// ui/public/shape/feature-card.mjs — Shaper s2: the feature card the planning run's Chat run card becomes. A pure model
// over the run's own snapshot, GET /api/shape/pipelines/:pid/card and the members' live snapshots: the step log, the
// open step, the controls, the saved-notes line and a stopped watch. The run model (src/shared/run-model.mjs) owns the
// head, status line, bars and member rows. Plus the painter for the run card's step log slot. s3: it owns
// SLICE_STATE_LABELS and the controls feature-actions.mjs paints.
import { stepKind, isRequirementsAsk } from './step-card.mjs';
import { watchStoppedText } from '../chat/pr-watch-words.mjs';
import { icon } from '../icons.mjs';
import { FEATURE_KIND } from '../run-status-card.mjs';
import { prototypeDetail } from './prototype-body.mjs';
import { REQUIREMENTS_AGREED } from '../../../src/shared/shape/feature-log.mjs';

export const SLICE_STATE_LABELS = Object.freeze({
  planned: 'Planned', starting: 'Starting', shaping: 'Planning', questions: 'Waiting for your answers', approval: 'Waiting for your plan approval',
  running: 'Building', paused: 'Paused', done: 'Done', stopped: 'Stopped', error: 'Stopped with an error',
  failed: 'Could not start', missed: 'Waiting', canceled: 'Canceled', held: 'Waiting',
});

export const ICON_WORD = Object.freeze({ ask: 'Needs you', fail: 'Failed', stop: 'Stopped', paused: 'Paused', run: 'Running', start: 'Running', scheduled: 'Waiting', done: 'Done' });
const CURRENT = new Set(['approval', 'questions', 'running', 'shaping', 'starting', 'paused', 'held']);

const isLive = (m) => !!m && m.source === 'live' && !m.terminal;
const asks = (m) => isLive(m) && !!m.pendingQuestion;
const stepOf = (index, m) => ({ index, runId: m.runId || null, pipelineId: m.pipelineId || null, kind: stepKind(m.pendingQuestion), id: m.pendingQuestion.id || null, snap: m });

// A slice state's run status when this tab holds no snapshot of the run (the Pause/Stop target).
const TARGET_STATUS = Object.freeze({ starting: 'starting', shaping: 'running', running: 'running', approval: 'running', questions: 'running', paused: 'paused' });

/** s3: what the feature's controls act on (feature-actions.mjs). `cur` is the run the status line names. */
function controlsOf(view, cur, m) {
  const active = view.status === 'active';
  return {
    featureId: view.id, active, halted: active && !!view.halted, rest: active && !!(view.open || view.halted),
    approveEach: view.approveEach !== false, planPipelineId: view.originPipelineId || null,
    held: view.held ? { index: view.held.index } : null,
    target: cur ? { index: cur.index, runId: (m && m.runId) || cur.runId || null, pipelineId: cur.pipelineId || null,
      status: m ? String(m.status || '') : TARGET_STATUS[cur.state] || null,
      // A run waiting at a question still reports `running`: it asks (Pause is off) while this tab sees its ask or the
      // server says the slice waits for an approval or answers.
      asks: (m && asks(m)) || cur.state === 'approval' || cur.state === 'questions' } : null,
  };
}

/** D16: before the split (or for a run that never splits) the card is its own run's. */
function shapingModel(own, log) {
  return { phase: 'shaping', log, step: asks(own) ? stepOf(null, own) : null, controls: null, notesLine: null, watch: null };
}

/**
 * @param {{own: object|null, card: {pipelineId: string, feature: object|null, log: object[]}|null, snapOf?: (pipelineId: string) => object|null}} input
 * @returns {{phase: 'shaping'|'feature', log: object[],
 *   step: {index: number|null, runId: string|null, pipelineId: string|null, kind: string, id: string|null, snap: object|null}|null,
 *   controls: {featureId: string, active: boolean, halted: boolean, rest: boolean, approveEach: boolean, planPipelineId: string|null,
 *     held: {index: number}|null,
 *     target: {index: number, runId: string|null, pipelineId: string|null, status: string|null, asks: boolean}|null}|null,
 *   notesLine: string|null, watch: {text: string, prUrl: string|null}|null}}
 */
export function featureCardModel({ own = null, card = null, snapOf = () => null } = {}) {
  const view = (card && card.feature) || null;
  if (!view) return shapingModel(own, (card && card.log) || []);
  const slices = view.slices || [];
  const pid = (own && own.pipelineId) || view.originPipelineId || null;
  const snap = (s) => (s && s.pipelineId ? (s.pipelineId === pid ? own : snapOf(s.pipelineId)) : null);
  const cur = (view.halted && slices[view.halted.index - 1]) || slices.find((s) => CURRENT.has(s.state)) || slices.find((s) => s.state !== 'done') || null;
  const m = cur ? snap(cur) : null;
  // D11: the open step is the asking member this tab follows, else the server's pointer (chatPaintQuestion resolves it).
  // s3 (D16): while re-planning, the Re-plan the rest run's Split ask is this card's open step.
  const rp = view.status === 'replanning' && view.replan && view.replan.pipelineId ? snapOf(view.replan.pipelineId) : null;
  const liveAsk = slices.find((s) => asks(snap(s)));
  const step = liveAsk ? stepOf(liveAsk.index, snap(liveAsk))
    : asks(rp) ? stepOf(null, rp)
    : view.ask ? { index: view.ask.index, runId: view.ask.runId || null, pipelineId: view.ask.pipelineId || null, kind: view.ask.kind, id: view.ask.id || null, snap: null } : null;
  // s5: ideas saved from the chat (D11), and a watch that gave up on a run's PR (D23)
  const ideas = (view.notes && view.notes.ideas) || 0;
  const watched = slices.find((s) => s.watch);
  const lastFix = watched ? [...(watched.rounds || [])].reverse().find((r) => r.by === 'watch') : null;
  const wText = watched ? watchStoppedText(watched.watch, lastFix ? lastFix.kinds : []) : null;
  // The slice rows' Requirements folds: each reviewed slice's check, keyed as renderMemberRows keys a member.
  const requirementChecks = Object.fromEntries(slices.filter((s) => s.requirements && s.requirements.check && (s.pipelineId || s.ticketId))
    .map((s) => [s.pipelineId || s.ticketId, s.requirements.check]));
  return { phase: 'feature',
    log: view.log || [], step, controls: controlsOf(view, cur, m), requirementChecks,
    notesLine: ideas ? `${ideas} ${ideas === 1 ? 'idea' : 'ideas'} saved for the next checkpoint` : null,
    watch: wText ? { text: wText, prUrl: watched.watch.prUrl || null } : null };
}

/** Shaper small runs B1: the one card's steps. `start` is B2's; B1 draws none (D11). */
export const ONE_CARD_STEPS = Object.freeze(['start', 'requirements', 'prototype', 'split', 'build', 'done']);

/** A run that ended (run-card.mjs RESULT_STATUS; not imported: run-card imports this module). */
const ENDED = new Set(['done', 'complete', 'completed', 'failed', 'stopped', 'error', 'aborted']);
const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const SPLIT_WORKING = 'The Planner proposes the runs';
const SPLIT_PROPOSED = 'Runs proposed, one after another · check, then approve';
/** The state line's detail per state (Screens and states). k and n: runs done and runs; q: the open ask's questions. */
const ONE_DETAIL = Object.freeze({
  // B2 (D18): the Start step, asking (the Care ask is open) or working (Worca sizes it before the ask opens).
  S0: ({ start }) => (start ? 'Pick the Care, then the roles write the requirements' : 'Worca sizes the feature'),
  S1: ({ q }) => `${plural(q, 'decision')}, then you agree the requirements`,
  S2: () => 'The roles write the requirements',
  S3: () => 'Agree the requirements, then the Split',
  S4: () => SPLIT_WORKING,
  // C1 (D21): the Prototype step's detail per moment, from its open ask or the card's saved state.
  SP: ({ proto }) => prototypeDetail(proto),
  S5: () => 'Check the plan, then the Planner proposes the runs',       // until B4 removes plan approval
  S6: () => SPLIT_PROPOSED,
  S7: ({ asking }) => (asking ? SPLIT_PROPOSED : SPLIT_WORKING),
  S8: ({ k, n }) => `${k} of ${plural(n, 'run')} done`,
  S9: ({ n }) => `${plural(n, 'run')} done · ship from the feature page`,
});

/** The open ask's question, when this tab holds it (the pointer-only step of a slice has none). */
const pqOf = (step) => (step && step.snap && step.snap.pendingQuestion) || null;

/** Which state the card is in: the first rule that matches wins (B1, Implementation steps, Step 3). */
function oneState(view, step, log, card, ended = false) {
  if (view) {
    const slices = view.slices || [];
    if (slices.length && slices.every((s) => s.state === 'done')) return ['S9', 'done'];
    if (view.status === 'replanning') return ['S7', 'split'];
    return ['S8', 'build'];
  }
  const pq = pqOf(step);
  if (pq && pq.kind === 'care') return ['S0', 'start'];
  // B2: a marked planning run with no saved Care, no open ask and nothing decided yet is still at the Start step.
  if (!step && !card.care && !log.length) return ['S0', 'start'];
  // C1 (D21): the Prototype step, while it asks or runs; confirmed and skipped fall through to the Split's line, and so
  // does the saved state of a run that ended (a stopped run's step is not running).
  const proto = ended ? null : card.prototype;
  if ((pq && pq.kind === 'prototype') || (proto && proto.state !== 'confirmed' && proto.state !== 'skipped')) return ['SP', 'prototype'];
  const plan = pq && pq.kind === 'plan' ? pq.plan : null;
  if (plan && plan.outline) return ['S6', 'split'];
  if (plan && !isRequirementsAsk(pq)) return ['S5', 'split'];
  if (log.some((l) => l && (l.text === REQUIREMENTS_AGREED || String(l.text || '').startsWith('Plan approved')))) return ['S4', 'split'];
  if (step) return [isRequirementsAsk(pq) ? 'S3' : 'S1', 'requirements'];
  return ['S2', 'requirements'];
}

/**
 * Shaper small runs B1 (D4): the one card per feature, for a card whose planning run was marked when it started
 * (`card.smallRuns`, never the live flag). null otherwise, so dev's card draws from featureCardModel unchanged.
 * @param {{own: object|null, card: object|null, snapOf?: (pipelineId: string) => object|null}} input
 * @returns {null|{state: string, step: string, detail: string, question: object|null, receipts: object[], runs: boolean,
 *   kindWord: string, base: object}}
 */
export function oneCardModel({ own = null, card = null, snapOf = () => null } = {}) {
  if (!card || card.smallRuns !== true) return null;
  // A planning run that ended without a split has no feature page: dev's card, with its result and Ship, or its failure.
  if (!card.feature && own && ENDED.has(String(own.status || ''))) return null;
  let base = featureCardModel({ own, card, snapOf });
  const view = card.feature || null;
  // D9: while re-planning, the re-plan run's ask is the one question, over any member's.
  const rp = view && view.status === 'replanning' && view.replan && view.replan.pipelineId ? snapOf(view.replan.pipelineId) : null;
  if (asks(rp)) base = { ...base, step: stepOf(null, rp) };
  const question = base.step || null;
  const [state, step] = oneState(view, question, base.log || [], card, !!own && ENDED.has(String(own.status || '')));
  const pq = pqOf(question);
  const detail = ONE_DETAIL[state]({
    start: !!pq && pq.kind === 'care',
    proto: pq && pq.kind === 'prototype' ? pq.prototype : card.prototype || null,
    k: view ? view.done || 0 : 0, n: view ? view.total || 0 : 0,
    q: pq && Array.isArray(pq.questions) ? pq.questions.length : 0,
    asking: !!question && (asks(rp) || (!!view && !!view.ask && view.ask.index == null)),
  });
  return { state, step, detail, question, receipts: base.log, runs: !!view, kindWord: FEATURE_KIND, base };
}

const sigOf = (host, list) => { const sig = JSON.stringify(list); if (host.dataset.sig === sig) return false; host.dataset.sig = sig; return true; };
/** Give the focus back to the same row's control after a rebuild (rule: app-js-repaint-drops-focus). */
function keepFocus(doc, host, sel, rebuild) {
  const a = doc.activeElement;
  const key = a && host.contains(a) ? a.closest('[data-key]')?.dataset.key : null;
  rebuild();
  if (key) { const again = host.querySelector(`[data-key="${key}"] ${sel}`); if (again && !again.disabled) again.focus(); }
}

/** The step log (D17): a check, the run tag, the named decision; Show unfolds what was answered, in place. */
export function paintFeatureLog(doc, host, lines) {
  const list = Array.isArray(lines) ? lines : [];
  if (!sigOf(host, list)) return;
  const open = host.__open || (host.__open = new Set());
  keepFocus(doc, host, '.chat-rc-log-show', () => {
    host.replaceChildren();
    host.hidden = !list.length;
    for (const line of list) {
      const li = doc.createElement('li'); li.className = 'chat-rc-log-row'; li.dataset.key = line.key;
      const ic = doc.createElement('span'); ic.className = 'chat-rc-log-check'; ic.appendChild(icon(doc, 'check', 12));
      li.appendChild(ic);
      if (line.run) { const r = doc.createElement('span'); r.className = 'chat-rc-log-run'; r.textContent = `Run ${line.run}`; li.appendChild(r); }
      const t = doc.createElement('span'); t.className = 'chat-rc-log-text'; t.textContent = line.text;
      li.appendChild(t);
      if (Array.isArray(line.detail) && line.detail.length) {
        const body = doc.createElement('ul'); body.className = 'chat-rc-log-detail';
        for (const d of line.detail) { const x = doc.createElement('li'); x.textContent = d; body.appendChild(x); }
        const show = doc.createElement('button'); show.type = 'button'; show.className = 'chat-rc-log-show';
        const set = (on) => { body.hidden = !on; show.textContent = on ? 'Hide' : 'Show'; show.setAttribute('aria-expanded', String(on)); if (on) open.add(line.key); else open.delete(line.key); };
        show.addEventListener('click', () => set(body.hidden));
        set(open.has(line.key));
        li.append(show, body);
      }
      host.appendChild(li);
    }
  });
}

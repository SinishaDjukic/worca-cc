// ui/public/shape/feature-card.mjs — Shaper s2: the feature card the planning run's Chat run card becomes. A pure model
// over the run's own snapshot, GET /api/shape/pipelines/:pid/card and the members' live snapshots: the step log, the
// open step, the controls, the saved-notes line and a stopped watch. The run model (src/shared/run-model.mjs) owns the
// head, status line, bars and member rows. Plus the painter for the run card's step log slot. s3: it owns
// SLICE_STATE_LABELS and the controls feature-actions.mjs paints.
import { stepKind, isRequirementsAsk } from './step-card.mjs';
import { watchStoppedText } from '../chat/pr-watch-words.mjs';
import { icon } from '../icons.mjs';
import { buildCheckRows } from './check-row.mjs';
import { FEATURE_KIND } from '../run-status-card.mjs';
import { prototypeDetail } from './prototype-body.mjs';
import { REQUIREMENTS_AGREED } from '../../../src/shared/shape/feature-log.mjs';
import { VERIFY_WORDS } from '../../../src/shared/shape/verifier.mjs';
import { runStatus } from '../../../src/shared/shape/run-status.mjs';
import { stopLinesOf } from './stop-list.mjs';

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
  // Slice 8 (d8-7): the halted run's Resume would wait for run N (the server's preview); the Verifier's has no slice.
  const haltedSlice = view.halted && Array.isArray(view.slices) ? view.slices[view.halted.index - 1] : null;
  const resumeAfter = haltedSlice && Number.isInteger(haltedSlice.resumeAfter) ? haltedSlice.resumeAfter : null;
  return {
    // C5: a halted Verifier is Resume too (resumeFeature starts a fresh check); Re-plan the rest stays the runs'.
    featureId: view.id, active, halted: active && (!!view.halted || (!!view.verify && view.verify.state === 'halted')),
    rest: active && !!(view.open || view.halted),
    approveEach: view.approveEach !== false, planPipelineId: view.originPipelineId || null,
    held: view.held ? { index: view.held.index, ...(view.held.reason ? { reason: view.held.reason } : {}) } : null,
    target: cur ? { index: cur.index, runId: (m && m.runId) || cur.runId || null, pipelineId: cur.pipelineId || null,
      status: m ? String(m.status || '') : TARGET_STATUS[cur.state] || null,
      // A run waiting at a question still reports `running`: it asks (Pause is off) while this tab sees its ask or the
      // server says the slice waits for an approval or answers.
      asks: (m && asks(m)) || cur.state === 'approval' || cur.state === 'questions' } : null,
    ...(resumeAfter !== null ? { resumeAfter } : {}),
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
 *     held: {index: number}|null, resumeAfter?: number,
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
  // Small runs C5: the Verifier run's bound stop is the card's open step once every run is done.
  const vf = view.verify && view.verify.pipelineId ? snapOf(view.verify.pipelineId) : null;
  const liveAsk = slices.find((s) => asks(snap(s)));
  // Slice 6 (D16): with the stop list, the pointer is the first open stop; a failed run never is. With no run entry, a
  // Re-plan or Verifier ask (index null) stays the pointer (D11).
  const ptr = Array.isArray(view.asks) ? (view.asks.find((a) => a && !a.failed) || (view.ask && view.ask.index == null ? view.ask : null)) : view.ask;
  const step = liveAsk ? stepOf(liveAsk.index, snap(liveAsk))
    : asks(rp) ? stepOf(null, rp)
    : asks(vf) ? stepOf(null, vf)
    : ptr ? { index: ptr.index, runId: ptr.runId || null, pipelineId: ptr.pipelineId || null, kind: ptr.kind, id: ptr.id || null, snap: null } : null;
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

/** Shaper small runs B1: the one card's steps. `start` is B2's; B1 draws none (D11). Feature D1: the last is `ship`. */
export const ONE_CARD_STEPS = Object.freeze(['start', 'requirements', 'prototype', 'split', 'build', 'ship']);

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
  // Feature D1 (D16): S9 (no Verifier check) and SR ship from the one card: the prototype's words.
  S9: ({ view }) => shipDetail(view),
  // Small runs C5 (D12): the Verifier checks the whole feature (SV); once it is through, Ready to ship is the word (SR).
  SV: ({ k, n }) => `the Verifier walks the main flow · ${k} of ${plural(n, 'run')} done`,
  SR: ({ view }) => shipDetail(view),
});
/** Fail closed: the ship ledger holds an agreed requirement with no run and no person (ship-ledger.mjs). */
const unownedOf = (sr) => !!(sr && Array.isArray(sr.unowned) && sr.unowned.length);
/** Feature D1 (D16): the ship step's detail: `waiting for Compliance` while a confirmed requirement waits (role labels
 *  joined by "and"), the Ship card mounted or not (the owner's call: the state detail says who it waits for); the ledger's
 *  reason while a requirement has no run and no person;
 *  `N PRs open` once shipped, else `Ready to ship`. */
function shipDetail(view) {
  const ship = (view && view.ship) || {};
  const sr = ship.smallRuns || null;
  if (ship.mode) {
    const prs = sr ? sr.order.filter((o) => o.pr) : [];
    // Shipped as One: every run holds the same PR, counted once.
    const n = !sr ? (view.slices || []).filter((s) => s.pr && s.pr.url).length : ship.mode === 'one' ? new Set(prs.map((o) => o.pr.url)).size : prs.length;
    return `${plural(n, 'PR')} open`;
  }
  if (unownedOf(sr)) return sr.reason;
  if (sr && sr.blocked) {
    const labels = [...new Set(sr.confirmed.filter((c) => c.state === 'waiting').map((c) => c.roleLabel))];
    return `waiting for ${labels.join(' and ')}`;
  }
  return 'Ready to ship';
}
/** C5: a stopped or failed Verifier run's line: the card's Resume starts a fresh check (resumeFeature). */
const VERIFY_HALTED = 'The Verifier stopped · Resume checks again';
const VERIFY_WAIT = Object.freeze({ verifying: 'The Verifier is checking the feature', gaps: 'The Verifier found a gap', asking: 'The Verifier waits for your answer',
  paused: 'The Verifier is paused', halted: VERIFY_HALTED, clean: 'Worca is finishing a run', accepted: 'Worca is finishing a run' });
/** Why a small-runs feature whose runs are done cannot ship yet (featureView's `ship.ready` is false), for the feature
 *  page's head; '' when it is ready (a missing mark blocks through the ledger instead). */
export function shipWaitText(view) {
  const ship = (view && view.ship) || {};
  if (!view || ship.ready) return '';
  if (unownedOf(ship.smallRuns)) return ship.smallRuns.reason;
  if (ship.mode) return 'Already shipped';
  if (view.status === 'replanning') return 'The rest is being re-planned';
  return VERIFY_WAIT[view.verify && view.verify.state] || 'The Verifier has not checked the feature yet';
}

/** Shaper small runs slice 7 (D4): the who-must-act lines of the run-order mock, when no run works and none has the turn. */
const MUST_ACT = 'Nothing can go on until you act';
const PERSON_ACTS = new Set(['paused', 'stopped']);

/**
 * Slice 7 (D1 to D5): the feature's state line, the one producer for the Chat card and the feature page. The working
 * runs (shared runStatus mark `live`) in run order, then the run with the server's `nextTurn`; with neither, who must
 * act. null unless the view carries `asks` (flag on, marked) and is active, and null once every run is done, so each surface
 * keeps today's line.
 * @param {object|null} view featureView's payload
 * @param {{snapOf?: (pipelineId: string) => object|null}} [opts]
 * @returns {string|null}
 */
export function featureStateLine(view, { snapOf = () => null } = {}) {
  if (!view || !Array.isArray(view.asks) || view.status !== 'active') return null;
  const all = Array.isArray(view.slices) ? view.slices : [];
  // Every run done: the Verifier and ship words own the line (shipWaitText on the page, the runs-done figure on the card).
  if (all.length && all.every((s) => s.state === 'done')) return null;
  const slices = new Map(all.map((s) => [s.index, s]));
  const working = [...all].sort((a, b) => a.index - b.index).flatMap((s) => {
    const st = runStatus({ slice: s, slices, snap: s.pipelineId ? snapOf(s.pipelineId) : null });
    if (st.mark !== 'live') return [];
    return [`${s.index} ${st.word || (Object.hasOwn(SLICE_STATE_LABELS, s.state) ? SLICE_STATE_LABELS[s.state] : '').toLowerCase()}`];
  });
  const work = working.map((w, i) => `${i ? 'run' : 'Run'} ${w}`).join(', ');
  const nx = all.find((s) => s.nextTurn === true);
  const next = nx ? `next: run ${nx.index}` : '';
  if (work || next) return [work, next].filter(Boolean).join(' · ');
  if (view.asks.length || all.some((s) => PERSON_ACTS.has(s.state) || s.cannotStart)) return MUST_ACT;
  // A clash hold names its reason once, on the held row; here it only reads held.
  if (view.held && Number.isInteger(view.held.index)) return `Run ${view.held.index} ${view.held.reason ? 'is held' : 'waiting for you to start'}`;
  return VERIFY_WAIT.clean;
}

/** Slice 7 (D6): the head's count of stop lines; '' (no chip) at zero. */
export function needYouText(n) {
  if (!Number.isInteger(n) || n <= 0) return '';
  return n === 1 ? '1 needs you' : `${n} need you`;
}

/** The open ask's question, when this tab holds it (the pointer-only step of a slice has none). */
const pqOf = (step) => (step && step.snap && step.snap.pendingQuestion) || null;

/** Which state the card is in: the first rule that matches wins (B1, Implementation steps, Step 3). */
function oneState(view, step, log, card, ended = false) {
  if (view) {
    const slices = view.slices || [];
    const allDone = slices.length && slices.every((s) => s.state === 'done');
    // C5: with a Verifier check, every run done reads by the check: verifying, through, or S8 (gaps, its stop, paused, halted).
    const v = view.verify && view.verify.state;
    if (allDone && (v === 'clean' || v === 'accepted')) return ['SR', 'ship'];
    if (allDone && v === 'verifying') return ['SV', 'build'];
    if (allDone && v) return ['S8', 'build'];
    if (allDone) return ['S9', 'ship'];
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
    k: view ? view.done || 0 : 0, n: view ? view.total || 0 : 0, view,
    q: pq && Array.isArray(pq.questions) ? pq.questions.length : 0,
    asking: !!question && (asks(rp) || (!!view && !!view.ask && view.ask.index == null)),
  });
  // C5 (D12): the Verifier's word, and the halted line in place of S8's; only with a check (no key otherwise).
  const vs = view && view.verify ? view.verify.state : null;
  const verify = state === 'SV' || state === 'SR' || (state === 'S8' && vs && !['clean', 'accepted', 'verifying'].includes(vs)) ? view.verify : null;
  // Fail closed: the Verifier's own "Ready to ship" gives way while a requirement has no run and no person.
  const heldShip = state === 'SR' && unownedOf(view.ship && view.ship.smallRuns);
  const vx = verify ? { verify, word: heldShip ? ICON_WORD.scheduled : VERIFY_WORDS[verify.state] || null } : {};
  // Slice 7 (D5): S8 leads with the feature's state line and keeps its runs-done figure after it.
  const stateLine = state === 'S8' ? featureStateLine(view, { snapOf }) : null;
  const line = verify && verify.state === 'halted' && state === 'S8' ? VERIFY_HALTED : stateLine ? `${stateLine} · ${detail}` : detail;
  const need = Array.isArray(view && view.asks) ? { need: stopLinesOf(view, { snapOf }).length } : {};
  // Small runs C4 (D17): the requirement change the Build step's notice shows, while its landing run is not done.
  return { state, step, detail: line, question, receipts: base.log, runs: !!view, kindWord: FEATURE_KIND, base, change: (view && view.change) || null, ...vx, ...need };
}

const sigOf = (host, list) => { const sig = JSON.stringify(list); if (host.dataset.sig === sig) return false; host.dataset.sig = sig; return true; };
/** Give the focus back to the same row's control after a rebuild (rule: app-js-repaint-drops-focus). */
function keepFocus(doc, host, sel, rebuild) {
  const a = doc.activeElement;
  const key = a && host.contains(a) ? a.closest('[data-key]')?.dataset.key : null;
  rebuild();
  if (key) { const again = host.querySelector(`[data-key="${key}"] ${sel}`); if (again && !again.disabled) again.focus(); }
}

/** C5 (owner direction d86d13181): a Verifier receipt is the shared .srows row (buildCheckRows), its pass mark in the
 *  mark column on the first text line and its text where the gap rows' text starts (an empty id column). */
function verifyRow(doc, li, text) {
  li.classList.add('chat-rc-log-verify', 'srows');
  const [row] = buildCheckRows(doc, { items: [{ id: '', idCol: true, label: text, pass: true, mark: 'check', ariaLabel: 'done' }] });
  row.querySelector('.plan-check-label').classList.add('chat-rc-log-text');
  li.appendChild(row);
  return li;
}

/** Small runs D3 (D10): a log line as the shared .srows row (buildCheckRows, as verifyRow): the `Run N` tag in the id
 *  column (empty, the column kept, for a feature line), ✓ named `decided`, the text. */
function srowsLine(doc, li, line) {
  const [row] = buildCheckRows(doc, { items: [{ id: line.run ? `Run ${line.run}` : '', idCol: true, label: line.text, pass: true, mark: 'check', ariaLabel: 'decided' }] });
  li.appendChild(row);
  return row;
}

/** The step log (D17): a check, the run tag, the named decision; Show unfolds what was answered, in place.
 *  `opts.srows` (small runs D3, the feature page's Decisions): each line is a .srows row (srowsLine) with Show at its
 *  end; without it the log is the chat card's and Overview's, unchanged. */
export function paintFeatureLog(doc, host, lines, opts = {}) {
  const list = Array.isArray(lines) ? lines : [];
  if (!sigOf(host, list)) return;
  const open = host.__open || (host.__open = new Set());
  /** Show unfolds a line's detail in place: `{ show, body }`, or null for a line without one. */
  const detailFold = (line, cls) => {
    if (!Array.isArray(line.detail) || !line.detail.length) return null;
    const body = doc.createElement('ul'); body.className = 'chat-rc-log-detail';
    for (const d of line.detail) { const x = doc.createElement('li'); x.textContent = d; body.appendChild(x); }
    const show = doc.createElement('button'); show.type = 'button'; show.className = cls;
    const set = (on) => { body.hidden = !on; show.textContent = on ? 'Hide' : 'Show'; show.setAttribute('aria-expanded', String(on)); if (on) open.add(line.key); else open.delete(line.key); };
    show.addEventListener('click', () => set(body.hidden));
    set(open.has(line.key));
    return { show, body };
  };
  keepFocus(doc, host, '.chat-rc-log-show', () => {
    host.replaceChildren();
    host.hidden = !list.length;
    for (const line of list) {
      const li = doc.createElement('li'); li.className = 'chat-rc-log-row'; li.dataset.key = line.key;
      if (opts.srows) {
        li.className = 'shape-feature-decision';
        const row = srowsLine(doc, li, line);
        const d = detailFold(line, 'btn btn-sm btn-quiet chat-rc-log-show');
        if (d) { row.appendChild(d.show); li.appendChild(d.body); }
        host.appendChild(li);
        continue;
      }
      if (line.kind === 'verify') { host.appendChild(verifyRow(doc, li, line.text)); continue; }
      const ic = doc.createElement('span'); ic.className = 'chat-rc-log-check'; ic.appendChild(icon(doc, 'check', 12));
      li.appendChild(ic);
      if (line.run) { const r = doc.createElement('span'); r.className = 'chat-rc-log-run'; r.textContent = `Run ${line.run}`; li.appendChild(r); }
      const t = doc.createElement('span'); t.className = 'chat-rc-log-text'; t.textContent = line.text;
      li.appendChild(t);
      const d = detailFold(line, 'chat-rc-log-show');
      if (d) li.append(d.show, d.body);
      host.appendChild(li);
    }
  });
}

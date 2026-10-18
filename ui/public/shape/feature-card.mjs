// ui/public/shape/feature-card.mjs — Shaper s2: the feature card the planning run's Chat run card becomes. A pure model
// over the run's own snapshot, GET /api/shape/pipelines/:pid/card and the members' live snapshots, composed only
// from today's helpers (runs-list.mjs liveRowState / renderRowIcon, run-progress.mjs chainProgress); plus the painters
// for two of the run card's slots: the step log and the member rows. s3: it owns SLICE_STATE_LABELS (feature-view.mjs
// imports this module) and the controls feature-actions.mjs paints.
import { liveRowState, renderRowIcon } from '../runs-list.mjs';
import { chainProgress } from '../../../src/shared/run-progress.mjs';
import { stepKind } from './step-card.mjs';
import { watchStoppedText } from '../chat/pr-watch-words.mjs';

export const SLICE_STATE_LABELS = Object.freeze({
  planned: 'Planned', starting: 'Starting', shaping: 'Planning', questions: 'Waiting for your answers', approval: 'Waiting for your plan approval',
  running: 'Building', paused: 'Paused', done: 'Done', stopped: 'Stopped', error: 'Stopped with an error',
  failed: 'Could not start', missed: 'Waiting', canceled: 'Canceled',
});

export const ICON_WORD = Object.freeze({ ask: 'Needs you', fail: 'Failed', stop: 'Stopped', paused: 'Paused', run: 'Running', start: 'Running', scheduled: 'Waiting', done: 'Done' });
const STATE_ICON = Object.freeze({ approval: 'ask', questions: 'ask', paused: 'paused', stopped: 'stop', canceled: 'stop', error: 'fail',
  failed: 'fail', running: 'run', shaping: 'run', starting: 'start', planned: 'scheduled', missed: 'scheduled', done: 'done' });
const STATE_STAGE = Object.freeze({ shaping: 'Plan', questions: 'Plan', approval: 'Plan', running: 'Build' });
const CURRENT = new Set(['approval', 'questions', 'running', 'shaping', 'starting', 'paused']);
const BROKEN = new Set(['stopped', 'error', 'failed', 'canceled']);

const isLive = (m) => !!m && m.source === 'live' && !m.terminal;
const asks = (m) => isLive(m) && !!m.pendingQuestion;
/** The runs-list glyph name: the run's own state when this tab has its snapshot, else its slice state. */
const iconOf = (slice, m) => (m ? liveRowState({ status: m.status, ask: asks(m) }).icon : STATE_ICON[slice.state] || 'run');
const stepOf = (index, m) => ({ index, runId: m.runId || null, pipelineId: m.pipelineId || null, kind: stepKind(m.pendingQuestion), id: m.pendingQuestion.id || null, snap: m });

function prWords(pr) {
  const st = String(pr.state || '').toUpperCase();
  const n = pr.number ? ` #${pr.number}` : '';
  if (st === 'MERGED') return 'Merged';
  if (st === 'CLOSED') return 'PR closed';
  return pr.draft ? `Draft PR${n}` : `PR${n} open`;
}
// A slice state's run status when this tab holds no snapshot of the run (the Pause/Stop target).
const TARGET_STATUS = Object.freeze({ starting: 'starting', shaping: 'running', running: 'running', approval: 'running', questions: 'running', paused: 'paused' });

/** s3: what the feature's controls act on (feature-actions.mjs). `cur` is the run the status line names. */
function controlsOf(view, cur, m) {
  const active = view.status === 'active';
  return {
    featureId: view.id, active, halted: active && !!view.halted, rest: active && !!(view.open || view.halted),
    approveEach: view.approveEach !== false, planPipelineId: view.originPipelineId || null,
    target: cur ? { index: cur.index, runId: (m && m.runId) || cur.runId || null, pipelineId: cur.pipelineId || null,
      status: m ? String(m.status || '') : TARGET_STATUS[cur.state] || null,
      // A run waiting at a question still reports `running`: it asks (Pause is off) while this tab sees its ask or the
      // server says the slice waits for an approval or answers.
      asks: (m && asks(m)) || cur.state === 'approval' || cur.state === 'questions' } : null,
  };
}

function part(slice, m) {
  if (slice.state === 'done') return { state: 'done' };
  if (BROKEN.has(slice.state)) return { state: 'failed' };
  if (CURRENT.has(slice.state)) return { state: 'current', progress: (m && m.stageProgress) || null, needs: asks(m) || slice.state === 'approval' || slice.state === 'questions' };
  return { state: 'waiting' };
}

/** D16: before the split (or for a run that never splits) the card is its own run's. */
function shapingModel(own, log) {
  const sh = own && own.shaping;
  const open = !!sh && !sh.approved;
  const icon = own ? liveRowState({ status: own.status, ask: asks(own) }).icon : 'start';
  return { phase: 'shaping', chip: open ? 'Shaping' : null, icon, word: ICON_WORD[icon] || '',
    status: open ? `${ICON_WORD[icon] || 'Running'} · ${(own.stageProgress && own.stageProgress.label) || 'Plan'}` : null,
    run: (own && own.stageProgress) || null, group: null, log, step: asks(own) ? stepOf(null, own) : null, members: [], controls: null };
}

/**
 * @param {{own: object|null, card: {pipelineId: string, feature: object|null, log: object[]}|null, snapOf?: (pipelineId: string) => object|null}} input
 * @returns {{phase: 'shaping'|'feature', chip: string|null, icon: string, word: string, status: string|null, run: object|null,
 *   group: object|null, log: object[], step: {index: number|null, runId: string|null, pipelineId: string|null, kind: string, id: string|null, snap: object|null}|null,
 *   members: Array<{key: string, label: string, state: string, runId: string|null, pipelineId: string|null}>,
 *   controls: {featureId: string, active: boolean, halted: boolean, rest: boolean, approveEach: boolean, planPipelineId: string|null,
 *     target: {index: number, runId: string|null, pipelineId: string|null, status: string|null, asks: boolean}|null}|null}}
 */
export function featureCardModel({ own = null, card = null, snapOf = () => null } = {}) {
  const view = (card && card.feature) || null;
  if (!view) return shapingModel(own, (card && card.log) || []);
  const slices = view.slices || [];
  const total = view.total || slices.length;
  const pid = (own && own.pipelineId) || view.originPipelineId || null;
  const snap = (s) => (s && s.pipelineId ? (s.pipelineId === pid ? own : snapOf(s.pipelineId)) : null);
  const done = slices.filter((s) => s.state === 'done').length;
  const cur = (view.halted && slices[view.halted.index - 1]) || slices.find((s) => CURRENT.has(s.state)) || slices.find((s) => s.state !== 'done') || null;
  const m = cur ? snap(cur) : null;
  // s5 (D16): a live round of a run is what the card is doing now; rounds never add member rows.
  const roundNow = (() => {
    for (const s of slices) for (const r of (s.rounds || [])) {
      const rm = snapOf(r.pipelineId);
      if ((rm && isLive(rm)) || (!rm && (r.status === 'running' || r.status === 'starting'))) return { s, r, m: rm };
    }
    return null;
  })();
  let icon;
  let status;
  if (view.status === 'canceled') { icon = 'stop'; status = `Canceled · ${done}/${total}`; }
  else if (view.status === 'replanning' || view.status === 'replanned') { icon = 'run'; status = `Re-planning · ${done}/${total}`; }
  else if (roundNow && (!cur || cur.state === 'done')) {
    icon = roundNow.m ? liveRowState({ status: roundNow.m.status, ask: asks(roundNow.m) }).icon : 'run';
    // A Watch PR fix round says what it fixes; any other round names its stage (D21).
    const doing = roundNow.r.by === 'watch' ? roundNow.r.request : (roundNow.m && roundNow.m.stageProgress && roundNow.m.stageProgress.label) || 'Build';
    status = [ICON_WORD[icon] || 'Running', `Round ${roundNow.r.round}`, doing].join(' · ');
  }
  else if (!cur) { icon = 'done'; status = `${view.ship && view.ship.mode ? 'Shipped' : 'Ready to ship'} · ${done}/${total}`; }
  else {
    icon = iconOf(cur, m);
    status = [ICON_WORD[icon] || 'Running', `Run ${cur.index}`, (m && m.stageProgress && m.stageProgress.label) || STATE_STAGE[cur.state] || ''].filter(Boolean).join(' · ');
  }
  // D11: the open step is the asking member this tab follows, else the server's pointer (chatPaintQuestion resolves it).
  // s3 (D16): while re-planning, the Re-plan the rest run's Split ask is this card's open step.
  const rp = view.status === 'replanning' && view.replan && view.replan.pipelineId ? snapOf(view.replan.pipelineId) : null;
  const liveAsk = slices.find((s) => asks(snap(s)));
  const step = liveAsk ? stepOf(liveAsk.index, snap(liveAsk))
    : asks(rp) ? stepOf(null, rp)
    : view.ask ? { index: view.ask.index, runId: view.ask.runId || null, pipelineId: view.ask.pipelineId || null, kind: view.ask.kind, id: view.ask.id || null, snap: null } : null;
  const chain = chainProgress([{ state: 'done' }, ...slices.map((s) => part(s, snap(s)))]);
  const waiting = new Set((view.halted && view.halted.waiting) || []);
  const members = [
    { key: 'planning', label: 'Planning', state: SLICE_STATE_LABELS.done, runId: (own && own.runId) || null, pipelineId: pid },
    ...slices.map((s) => ({ key: `run-${s.index}`, label: `${s.index} · ${s.title}`,
      state: s.pr && s.pr.url ? prWords(s.pr) : waiting.has(s.index) ? 'Waiting' : SLICE_STATE_LABELS[s.state] || s.state,
      runId: s.runId || null, pipelineId: s.pipelineId || null })),
  ];
  // s5: ideas saved from the chat (D11), and a watch that gave up on a run's PR (D23)
  const ideas = (view.notes && view.notes.ideas) || 0;
  const watched = slices.find((s) => s.watch);
  const lastFix = watched ? [...(watched.rounds || [])].reverse().find((r) => r.by === 'watch') : null;
  const wText = watched ? watchStoppedText(watched.watch, lastFix ? lastFix.kinds : []) : null;
  return { phase: 'feature', chip: `Feature · ${cur ? cur.index : total}/${total}`, icon, word: ICON_WORD[icon] || '', status,
    run: cur && isLive(m) ? m.stageProgress || null : null,
    group: { ...chain, text: cur ? `Run ${cur.index} of ${total}` : `${done} of ${total} runs done` },
    log: view.log || [], step, members, controls: controlsOf(view, cur, m),
    notesLine: ideas ? `${ideas} ${ideas === 1 ? 'idea' : 'ideas'} saved for the next checkpoint` : null,
    watch: wText ? { text: wText, prUrl: watched.watch.prUrl || null } : null };
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
      const ic = doc.createElement('span'); ic.className = 'runs-ic runs-ic-done chat-rc-log-check'; ic.appendChild(renderRowIcon(doc, 'done'));
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

/** The member rows: "Planning · Done", then "n · title · state or PR state"; a press opens the run (deps.open). */
export function paintFeatureMembers(doc, host, rows, { open }) {
  const list = Array.isArray(rows) ? rows : [];
  if (!sigOf(host, list)) return;
  keepFocus(doc, host, '.chat-rc-member-open', () => {
    host.replaceChildren();
    host.hidden = !list.length;
    for (const row of list) {
      const li = doc.createElement('li'); li.className = 'chat-rc-member'; li.dataset.key = row.key;
      const b = doc.createElement('button'); b.type = 'button'; b.className = 'chat-rc-member-open';
      b.disabled = !(row.runId || row.pipelineId);
      const label = doc.createElement('span'); label.className = 'chat-rc-member-label'; label.textContent = row.label;
      const state = doc.createElement('span'); state.className = 'chat-rc-member-state'; state.textContent = row.state;
      b.append(label, doc.createTextNode(' · '), state);
      b.addEventListener('click', () => open(row));
      li.appendChild(b);
      host.appendChild(li);
    }
  });
}

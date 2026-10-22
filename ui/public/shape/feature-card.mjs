// ui/public/shape/feature-card.mjs — Shaper s2: the feature card the planning run's Chat run card becomes. A pure model
// over the run's own snapshot, GET /api/shape/pipelines/:pid/card and the members' live snapshots: the step log, the
// open step, the controls, the saved-notes line and a stopped watch. The run model (src/shared/run-model.mjs) owns the
// head, status line, bars and member rows. Plus the painter for the run card's step log slot. s3: it owns
// SLICE_STATE_LABELS and the controls feature-actions.mjs paints.
import { stepKind } from './step-card.mjs';
import { watchStoppedText } from '../chat/pr-watch-words.mjs';
import { icon } from '../icons.mjs';

export const SLICE_STATE_LABELS = Object.freeze({
  planned: 'Planned', starting: 'Starting', shaping: 'Planning', questions: 'Waiting for your answers', approval: 'Waiting for your plan approval',
  running: 'Building', paused: 'Paused', done: 'Done', stopped: 'Stopped', error: 'Stopped with an error',
  failed: 'Could not start', missed: 'Waiting', canceled: 'Canceled',
});

export const ICON_WORD = Object.freeze({ ask: 'Needs you', fail: 'Failed', stop: 'Stopped', paused: 'Paused', run: 'Running', start: 'Running', scheduled: 'Waiting', done: 'Done' });
const CURRENT = new Set(['approval', 'questions', 'running', 'shaping', 'starting', 'paused']);

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
  return { phase: 'feature',
    log: view.log || [], step, controls: controlsOf(view, cur, m),
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

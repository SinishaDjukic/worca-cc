// ui/public/shape/step-card.mjs — one chrome for every Shaper step card (shaper-cards spec §2.2): head = title + kind
// chip (.ask-mcard-*), body, one action row. Every button here binds its own click and stops propagation, so no host
// delegate is needed (the feature page has none) and none double-posts.
import { askKindOf } from '../ask/registry.mjs';
import { isShapingRun } from './plan-text.mjs';

export const SEND_FAILED = 'Could not send your answer. Try again.';
const CHIP = { clarify: 'Clarify', plan: 'Plan', outline: 'Runs', gate: 'Gate', recovery: 'Recovery' };

/** 'outline' for a plan ask carrying an outline (the Split card), else the registry kind. */
export function stepKind(pq) {
  const k = askKindOf(pq);
  return k === 'plan' && pq.plan && pq.plan.outline ? 'outline' : k;
}

/** Which asks draw as step cards: plan, gate and recovery always; Clarify only for a shaping run with the gate on. */
export function isStepCard(pq, run, gateOn) {
  const k = askKindOf(pq);
  if (k === 'plan' || k === 'gate' || k === 'recovery') return true;
  return k === 'clarify' && !!gateOn && isShapingRun(run);
}

/** D15: `Plan · run k` once the run belongs to a split feature (index is 1-based), else the kind's chip. */
export function stepChip(pq, run) {
  const k = stepKind(pq);
  const f = run && run.shaping && run.shaping.feature;
  if (k === 'plan' && f && Number.isInteger(f.index) && f.index >= 1) return `Plan · run ${f.index}`;
  return CHIP[k] || '';
}

/** The visible title; `who` is the step label (nodeLabel), '' when unknown. */
export function stepTitle(pq, who = '') {
  switch (stepKind(pq)) {
    case 'clarify': return 'A few questions before the plan';
    case 'plan': return 'Your turn: approve the plan';
    case 'outline': return 'Your turn: approve the runs';
    case 'gate': return who ? `${who} needs a decision` : 'A decision is needed';
    case 'recovery': return who ? `${who} failed` : 'A step failed';
    default: return '';
  }
}

/** Run 4 (D4): the control a waiting question takes the focus on — the card's own primary (Approve 2 runs, Approve and
 *  build) when it has an enabled one, else its first control that is not a menu trigger (a run row's ⋯). */
export function questionFocusTarget(root) {
  if (!root) return null;
  return root.querySelector('.qpanel:not(.hidden) .plan-actions .btn-primary:not([disabled])')
    || root.querySelector('.qpanel:not(.hidden) :is(button, input, textarea, [tabindex]):not([disabled]):not([aria-haspopup])');
}

export function stepHead(doc, title, chip) {
  const head = doc.createElement('div');
  head.className = 'ask-mcard-head step-head';
  const t = doc.createElement('b'); t.className = 'ask-mcard-title'; t.textContent = title;
  const c = doc.createElement('span'); c.className = 'ask-mcard-kind'; c.textContent = chip;
  head.append(t, c);
  return head;
}

/** The one `send` every step card uses: one post at a time; a failure says why, keeps the input and the focus. */
export function stepSender(deps, err, { after = () => {} } = {}) {
  let busy = false;
  const doc = deps.doc;
  const show = (msg) => { err.classList.remove('ok'); err.textContent = msg; err.hidden = false; };
  return (payload) => {
    if (busy) return Promise.resolve(false);
    busy = true; err.hidden = true;
    // Chromium blurs a focused button when setPanelBusy disables it: remember it BEFORE the submit (focus-after-disable).
    const pressed = doc && doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : null;
    const refocus = () => { if (pressed && pressed.isConnected && (!doc.activeElement || doc.activeElement === doc.body)) pressed.focus(); };
    // new Promise(...) so a submit that throws synchronously cannot leave `busy` stuck on
    return new Promise((resolve) => resolve(deps.submit(payload)))
      .then((out) => {
        // a 422 has already painted its field errors through setErrors (err is showing): keep them
        if (out !== true && err.hidden) show(typeof out === 'string' && out ? `Not sent: ${out}` : SEND_FAILED);
        if (out !== true) refocus();
        return out === true;
      }, () => { if (err.hidden) show(SEND_FAILED); refocus(); return false; })
      .finally(() => { busy = false; after(); });
  };
}

const errLine = (doc) => {
  const err = doc.createElement('div'); err.className = 'plan-err'; err.hidden = true; err.setAttribute('role', 'alert');
  return err;
};
const ownButton = (doc, cls, text, onClick) => {
  const b = doc.createElement('button'); b.type = 'button'; b.className = `btn ${cls}`; b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); if (!b.disabled) onClick(); });
  return b;
};

/** The gate's open issues: severity, title, detail and location per row. */
function issueList(doc, issues) {
  const list = doc.createElement('ul');
  list.className = 'issues';
  issues.forEach((iss) => {
    const sev = String((iss && iss.severity) || 'suggestion').toLowerCase();
    const li = doc.createElement('li');
    li.className = `issue sev-${sev}`;

    const ihead = doc.createElement('div');
    ihead.className = 'issue-head';
    const sevEl = doc.createElement('span');
    sevEl.className = 'issue-sev';
    sevEl.textContent = sev;
    const titleEl = doc.createElement('span');
    titleEl.className = 'issue-title';
    titleEl.textContent = (iss && iss.title) || '(untitled issue)';
    ihead.append(sevEl, titleEl);
    li.appendChild(ihead);

    if (iss && iss.detail) {
      const det = doc.createElement('div');
      det.className = 'issue-detail';
      det.textContent = iss.detail;
      li.appendChild(det);
    }
    if (iss && iss.location) {
      const loc = doc.createElement('div');
      loc.className = 'issue-loc';
      loc.textContent = iss.location;
      li.appendChild(loc);
    }
    list.appendChild(li);
  });
  return list;
}

/** Recovery's body: the cause, the error, and the network note while worca waits to retry by itself. */
function appendRecoveryBody(doc, panel, rec) {
  const intro = doc.createElement('div');
  intro.className = 'gate-intro';
  const hint = rec.cls === 'auth'
    ? 'Re-authenticate (e.g. run `claude setup-token` or `/login`), then Retry.'
    : 'Fix the problem (wait out a limit, restore connectivity, top up credit), then Retry.';
  intro.textContent = `This step could not reach the model. ${hint} Or pause the run and come back later. Only Stop ends it.`;
  panel.appendChild(intro);

  if (rec.message) {
    const msg = doc.createElement('div');
    msg.className = 'issue-detail';
    msg.textContent = rec.message;
    panel.appendChild(msg);
  }

  if (rec.network && typeof rec.network === 'object') {
    const note = doc.createElement('div');
    note.className = 'gate-intro recovery-network';
    const until = new Date(rec.network.until).toTimeString().slice(0, 5);
    note.textContent = `Waiting for network… ${rec.network.host} is unreachable. worca picks Retry by itself when it answers again (until ${until}). You can still Retry now or Pause.`;
    panel.appendChild(note);
  }
}

/** Gate (cycle limit). deps: { doc, title, chip, wireCopy, tagLevel(el, level), submit }. */
export function renderGateCard(panel, pq, deps) {
  const { doc } = deps;
  const issues = Array.isArray(pq.issues) ? pq.issues : [];
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const intro = doc.createElement('div');
  intro.className = 'gate-intro';
  intro.textContent = `This cycle reached its limit${deps.wireCopy || ''}${issues.length ? ' with open issues' : ''}. Run another cycle to keep iterating, or accept the result as is.`;
  deps.tagLevel(intro, 'advanced');
  // Simple mode reads the same decision without the vocabulary (docs/ui-levels.md: a blocking
  // prompt is never hidden, only simplified). Twin elements, so a mode change needs no re-render.
  const plain = doc.createElement('div');
  plain.className = 'gate-intro';
  plain.dataset.maxLevel = 'simple';
  plain.textContent = issues.length
    ? 'The agents reviewed their own work and still see problems. Let them try once more, or carry on with what they have?'
    : 'The agents have used the attempts they are allowed. Let them try once more, or carry on with what they have?';
  panel.append(intro, plain);
  if (issues.length) panel.appendChild(issueList(doc, issues));
  const err = errLine(doc);
  const send = stepSender(deps, err);
  const foot = doc.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  foot.append(
    ownButton(doc, 'btn-quiet gate-continue', 'Accept as is', () => send({ decision: 'continue' })),
    ownButton(doc, 'btn-primary gate-another', 'Run another cycle', () => send({ decision: 'another' })));
  panel.append(err, foot);
}

/** Recovery. One give-up button from the prompt's options (the engine maps any non-retry to the policy's give-up). */
export function renderRecoveryCard(panel, pq, deps) {
  const { doc } = deps;
  const rec = pq.recovery || {};
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  appendRecoveryBody(doc, panel, rec);
  // The give-up option comes from the failure policy's row (options ride the
  // prompt): 'pause' parks the run, 'abort' ends it. Older payloads carry none.
  const giveUp = (Array.isArray(rec.options) && rec.options.find((o) => o && o.id !== 'retry')) || { id: 'pause' };
  const abort = giveUp.id === 'abort';
  const err = errLine(doc);
  const send = stepSender(deps, err);
  const quit = ownButton(doc, abort ? 'recovery-abort' : 'recovery-pause', abort ? 'Abort' : 'Pause',
    () => send({ decision: abort ? 'abort' : 'pause' }));
  quit.title = abort ? 'End the run here with this error. The worktree is torn down.'
    : 'Park the run here with this error as the reason. Nothing is discarded. Resume retries the step later.';
  const foot = doc.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  foot.append(quit, ownButton(doc, 'btn-primary recovery-retry', 'Retry', () => send({ decision: 'retry' })));
  panel.append(err, foot);
}

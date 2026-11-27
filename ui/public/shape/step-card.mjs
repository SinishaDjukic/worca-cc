// ui/public/shape/step-card.mjs — one chrome for every Shaper step card (shaper-cards spec §2.2): head = title + kind
// chip (.ask-mcard-*), body, one action row. Every button here binds its own click and stops propagation, so no host
// delegate is needed (the feature page has none) and none double-posts.
import { verifyGapItems } from '../../../src/shared/shape/verifier.mjs';
import { askKindOf } from '../ask/registry.mjs';
import { isShapingRun } from './plan-text.mjs';
import { buildRoleFold } from './role-rows.mjs';
import { splitBlockers } from '../../../src/shared/shape/slices.mjs';
import { stopDoneText } from '../../../src/shared/shape/run-stops.mjs';
import { buildChatQuestion } from '../chat/question.mjs';
import { buildCheckRows } from './check-row.mjs';
import { buildNoteBody } from './note-body.mjs';
import { noteTitle } from '../../../src/shared/shape/outline-note.mjs';
import { paintFeatureLog } from './feature-card.mjs';
import { renderChangeRule } from './req-change.mjs';

export const SEND_FAILED = 'Could not send your answer. Try again.';
const CHIP = { care: 'Start', prototype: 'Prototype', clarify: 'Clarify', plan: 'Plan', outline: 'Runs', gate: 'Gate', recovery: 'Recovery' };

/** 'outline' for a plan ask carrying an outline (the Split card), else the registry kind. */
export function stepKind(pq) {
  const k = askKindOf(pq);
  return k === 'plan' && pq.plan && pq.plan.outline ? 'outline' : k;
}

/** The Requirements step's ask: a `plan` kind carrying the criteria check, its load error or the attached features (the plan ask carries none). */
export const isRequirementsAsk = (pq) => !!pq && askKindOf(pq) === 'plan' && !!pq.plan && !!(pq.plan.criteria || pq.plan.error || pq.plan.attached);

/** Which asks draw as step cards: care (B2's Start step), plan, gate and recovery always; Clarify only for a shaping run
 *  with the gate on. */
export function isStepCard(pq, run, gateOn) {
  const k = askKindOf(pq);
  if (k === 'care' || k === 'prototype' || k === 'plan' || k === 'gate' || k === 'recovery') return true;
  return k === 'clarify' && !!gateOn && isShapingRun(run);
}

/** D15: `Plan · run k` once the run belongs to a split feature (index is 1-based), else the kind's chip. */
export function stepChip(pq, run) {
  // Small runs C3 (D11): a stop's chip names its kind only; the run number is in its head.
  // Small runs C5: the Verifier's stop names itself in its head ("Verifier · 1 gap still open"): no chip repeats it.
  if (pq && pq.stop && pq.stop.node === 'n_verify') return '';
  if (pq && pq.stop) return pq.stop.reason === 'objection' ? CHIP.gate : CHIP.plan;
  if (isRequirementsAsk(pq)) return 'Requirements';
  const k = stepKind(pq);
  const f = run && run.shaping && run.shaping.feature;
  if (k === 'plan' && f && Number.isInteger(f.index) && f.index >= 1) return `Plan · run ${f.index}`;
  return CHIP[k] || '';
}

/** C1: the Prototype step's head per moment (Section 3's table). */
export const PROTOTYPE_TITLES = Object.freeze({ offered: 'Prototype the screens first?', built: 'Your turn: look, remark, confirm',
  remark: 'Change the requirement?', failed: 'The prototype did not build', building: "Design's agents are building",
  reviewing: 'Design and Product check the prototype', matching: 'Reading your remark' });
export const prototypeTitle = (p) => PROTOTYPE_TITLES[(p && (p.moment || p.state)) || ''] || '';

export const SPLIT_APPROVE_TITLE = 'Your turn: approve the runs';
export const SPLIT_FIX_TITLE = 'Your turn: fix the split';
/** Small runs B4 (D12): whether a small-runs Split fails a rule nobody can waive (ownership, coverage, confirmRole): the
 *  server's own gate (`splitBlockers`), on the outline plus the card's edits. */
export function splitRefused(outline, care, edits = []) {
  if (!outline || !Array.isArray(outline.slices)) return false;
  return !splitBlockers(outline, edits, { smallRuns: true, care }).ok;
}

/** The visible title; `who` is the step label (nodeLabel), '' when unknown. */
export function stepTitle(pq, who = '') {
  if (pq && pq.stop) return pq.stop.head;   // Small runs C3 (D11)
  if (isRequirementsAsk(pq)) return 'Your turn: agree the requirements';
  switch (stepKind(pq)) {
    case 'care': return 'Your turn: how much care?';
    case 'prototype': return prototypeTitle(pq.prototype);
    case 'clarify': return 'A few questions before the plan';
    case 'plan': return 'Your turn: approve the plan';
    case 'outline': return pq.plan.smallRuns === true && splitRefused(pq.plan.outline, pq.plan.care) ? SPLIT_FIX_TITLE : SPLIT_APPROVE_TITLE;
    case 'gate': return who ? `${who} needs a decision` : 'A decision is needed';
    case 'recovery': return who ? `${who} failed` : 'A step failed';
    default: return '';
  }
}

/** The waiting card has hidden its foot for its open Ask for changes field (the Requirements card): the field's Send
 *  changes is the only primary, so the host's bar must not draw Answer as one. A refused Split (small runs B4) has no
 *  primary at all and marks its foot `data-no-primary`: the bar draws none either. */
export const answerFieldOpen = (root) => !!root && !!root.querySelector('.qpanel:not(.hidden) .plan-actions[hidden], .qpanel:not(.hidden) .plan-actions[data-no-primary]');

/** The small-runs marker, read from the open ask alone, never from the live flag: the orchestrator stamps
 *  `plan.smallRuns` on a marked run's plan, requirements and split asks, and asks Care only on a marked run. Under it
 *  the step draws its own primary, so a host's bar draws its step button plain (as the chat card's `oneNow`). */
export const smallRunsAsk = (pq) => !!pq && (pq.kind === 'care' || pq.kind === 'prototype' || !!pq.stop || (!!pq.plan && pq.plan.smallRuns === true));

/** Run 4 (D4): the control a waiting question takes the focus on — the card's own primary (Approve 2 runs, Approve and
 *  build) when it has an enabled one in a foot that shows, else its open Ask for changes field, else its first control
 *  that is not a menu trigger (a run row's ⋯). */
export function questionFocusTarget(root) {
  if (!root) return null;
  return root.querySelector('.qpanel:not(.hidden) .plan-actions:not([hidden]) .btn-primary:not([disabled])')
    || root.querySelector('.qpanel:not(.hidden) .plan-typed:not([hidden]) textarea')
    || root.querySelector('.qpanel:not(.hidden) :is(button, input, textarea, [tabindex]):not([disabled]):not([aria-haspopup])');
}

export function stepHead(doc, title, chip) {
  const head = doc.createElement('div');
  head.className = 'ask-mcard-head step-head';
  const t = doc.createElement('b'); t.className = 'ask-mcard-title'; t.textContent = title;
  const c = doc.createElement('span'); c.className = 'ask-mcard-kind'; c.textContent = chip;
  head.append(t, ...(chip ? [c] : []));
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

export const errLine = (doc) => {
  const err = doc.createElement('div'); err.className = 'plan-err'; err.hidden = true; err.setAttribute('role', 'alert');
  return err;
};
export const ownButton = (doc, cls, text, onClick) => {
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

/** A requirement stop's one finding: the concern's title (when given) and detail, unranked. */
function concernFinding(doc, title, detail) {
  const list = doc.createElement('ul');
  list.className = 'issues';
  const li = doc.createElement('li');
  li.className = 'issue';
  if (title) {
    const head = doc.createElement('div');
    head.className = 'issue-head';
    const t = doc.createElement('span');
    t.className = 'issue-title';
    t.textContent = title;
    head.appendChild(t);
    li.appendChild(head);
  }
  if (detail) {
    const d = doc.createElement('div');
    d.className = 'issue-detail';
    d.textContent = detail;
    li.appendChild(d);
  }
  list.appendChild(li);
  return list;
}

/** An outline change as the one finding: the note's title heads it (else the stop's line) and the rest of the note is
 *  its body. */
function outlineFinding(doc, pq, stop) {
  const text = pq.plan?.outlineChange || '';
  const list = concernFinding(doc, noteTitle(text) || stop.findingsLine);
  const note = buildNoteBody(doc, text, { key: `finding:${pq.id}`, dropTitle: true });
  if (note) list.firstElementChild.appendChild(note.el);
  return list;
}

/** Small runs C5 (D12): the Verifier's open gaps as one check list (✕, the id, why). */
function verifyGapList(doc, gaps) {
  const el = doc.createElement('div');
  el.className = 'plan-checks srows verify-gaps';
  el.append(...buildCheckRows(doc, { items: verifyGapItems(gaps) }));
  return el;
}
const stopGaps = (stop) => (stop.reason === 'check' && Array.isArray(stop.gaps) && stop.gaps.length ? stop.gaps : null);

/** Small runs C3 (D12): the one findings list of a stop, on every surface that draws it: the open issues of an objection,
 *  the failing check rows, the Verifier's gaps, or the requirement concern. It holds no count: the card's question says
 *  how many. `answerable`: the card's question already names a concern's title, so its row carries the detail only
 *  (none without a detail). */
function stopFindings(doc, pq, opts = {}) {
  const stop = pq.stop;
  const issues = Array.isArray(pq.issues) ? pq.issues : [];
  if (stopGaps(stop)) return verifyGapList(doc, stop.gaps);
  if (pq.kind === 'gate') {
    if (issues.length) return issueList(doc, issues);
    const fold = pq.roleReviews?.rounds?.length ? buildRoleFold(doc, pq.roleReviews, { sectionFallback: 'Diff', node: pq.nodeId }) : null;
    if (!fold) return null;
    const box = doc.createElement('div');
    box.append(fold.line, fold.rows);
    return box;
  }
  const plan = pq.plan || {};
  if (stop.reason === 'check') {
    const box = doc.createElement('div');
    box.className = 'plan-checks';
    const items = plan.check && Array.isArray(plan.check.items) ? plan.check.items.filter((i) => i && !i.pass) : [];
    box.append(...buildCheckRows(doc, { items: items.length ? items : [{ label: stop.findingsLine, pass: false }] }));
    return box;
  }
  if (pq.concern && opts.answerable) return pq.concern.detail ? concernFinding(doc, '', pq.concern.detail) : null;
  return pq.concern ? concernFinding(doc, pq.concern.title, pq.concern.detail) : outlineFinding(doc, pq, stop);
}

/** Small runs C3 (D11, D13): a marked run's stop. The card asks one question (who wants what and why; two options, each
 *  saying what it does; Worca's pick recommended and preselected; one primary naming the pick), on every surface: the
 *  feature card, the feature page, the run page and the run side panel (`runPage`: the head's one-column marker). With
 *  the flag off the run page and panel are `readOnly` and draw only the stop's findings; with it on (`findings`) every
 *  surface lists them under the question. A held answer (`held` = {value}) draws the one answered line. */
function renderStopCard(panel, pq, deps) {
  const { doc } = deps;
  const stop = pq.stop;
  if (deps.readOnly) {
    const list = stopFindings(doc, pq);
    if (list) panel.appendChild(list);
    return;
  }
  // A held answer is one finished-step row (the feature card's step log row), with no head, chip or box: the row's
  // own text is the only "Run 8" in the stop's area (owner review d0ab08b1b).
  const held = deps.held && stop.options.find((o) => o.value === deps.held.value);
  if (held) {
    const log = doc.createElement('ol');
    log.className = 'chat-rc-log';
    log.setAttribute('aria-label', 'Steps');
    paintFeatureLog(doc, log, [{ key: `stop-${pq.id}`, run: stop.run, text: stopDoneText(stop, held.payload).replace(/^Run \d+: /, '') }]);
    panel.appendChild(log);
  } else {
    const head = panel.appendChild(stepHead(doc, deps.title, deps.chip));
    if (deps.runPage) head.dataset.stop = '';                // shape-it.css: one column from the first paint
  }
  if (held) return;
  const optionOf = (v) => stop.options.find((o) => o.value === v) || stop.options.find((o) => o.value === stop.pick);
  const q = buildChatQuestion(doc, {
    id: `stop-${pq.id}`, heading: stop.head, head: false, numbers: false,
    questions: [{ id: 'stop', text: stop.text,
      options: stop.options.map((o) => ({ value: o.value, label: o.label, sub: o.sub, ...(o.value === stop.pick ? { recommended: true } : {}) })) }],
    preset: new Map([['stop', optionOf(deps.pick).value]]),
    submitLabel: (picks) => optionOf(picks.get('stop')).go,
    onSubmit: async (picks) => {
      const out = await deps.submit(optionOf(picks.get('stop')).payload);
      if (out !== true) throw new Error(typeof out === 'string' && out ? `Not sent: ${out}` : SEND_FAILED);
    },
  });
  // A pick the person made before a repaint (deps.pick) is theirs, not Worca's preset.
  if (deps.pick && deps.pick !== stop.pick) for (const t of q.el.querySelectorAll('.qopt[data-preset]')) delete t.dataset.preset;
  // The focus rule (questionFocusTarget) takes the foot's primary: the one that names Worca's pick.
  const foot = q.el.querySelector('.qpanel-foot');
  if (foot) foot.classList.add('plan-actions');
  // An outline change: the question is one line; the rest of the Planner's note folds between it and the options.
  const outlineShown = stop.reason === 'requirement' && !pq.concern && !!pq.plan?.outlineChange;
  if (outlineShown) {
    const note = buildNoteBody(doc, pq.plan.outlineChange, { key: `stop:${pq.id}`, dropTitle: true });
    if (note) q.el.querySelector('.qopts').before(note.el);
  }
  // R-ux-4: the stop's one findings list, above the foot (and above a proposed change's texts). With small runs on
  // (`findings`) it is the full list; with the flag off only a Verifier stop lists its open gaps (C5, D12: the card's own
  // gap list is not drawn meanwhile). An outline change's note is already its finding.
  const list = outlineShown ? null : deps.findings ? stopFindings(doc, pq, { answerable: true })
    : stopGaps(stop) ? verifyGapList(doc, stop.gaps) : null;
  if (list) { if (foot) foot.before(list); else q.el.appendChild(list); }
  // Small runs C4 (D16): a proposed requirement change shows every new text in full (what Change it applies), then how
  // it lands, below the options.
  if (stop.reason === 'requirement' && Array.isArray(stop.change)) {
    const texts = doc.createElement('div');
    texts.className = 'plan-checks srows req-change-texts';
    texts.append(...buildCheckRows(doc, { items: stop.change.map((c) => ({ id: c.id, idCol: true, label: `“${c.to}”`, pass: true, mark: 'none', ariaLabel: 'new text' })) }));
    const rule = renderChangeRule(doc, stop.landsAs || 'none');
    for (const el of [texts, rule]) { if (foot) foot.before(el); else q.el.appendChild(el); }
  }
  // Slice 3 (D11): a held answer the take-in refused was dropped; the open stop says why, above its options.
  if (deps.refused) {
    const err = errLine(doc);
    err.textContent = `Not sent: ${deps.refused}`;
    err.hidden = false;
    const opts = q.el.querySelector('.qopts');
    if (opts) opts.before(err); else if (foot) foot.before(err); else q.el.prepend(err);
  }
  panel.appendChild(q.el);
}

/** Gate (cycle limit). deps: { doc, title, chip, wireCopy, tagLevel(el, level), submit, readOnly?, runPage?, findings?, held?, pick?, refused? }. A small runs
 *  stop (`pq.stop`, a gate or a plan ask) draws as renderStopCard. */
export function renderGateCard(panel, pq, deps) {
  if (pq && pq.stop) return renderStopCard(panel, pq, deps);
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
  // A role-review loop (the code roles on Shaper's Review): one row per role, whose Show lists the findings, in place of
  // the issue list that would repeat them.
  const fold = pq.roleReviews?.rounds?.length ? buildRoleFold(doc, pq.roleReviews, { sectionFallback: 'Diff', node: pq.nodeId }) : null;
  if (fold) panel.append(fold.line, fold.rows);
  else if (issues.length) panel.appendChild(issueList(doc, issues));
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

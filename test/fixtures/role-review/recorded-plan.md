# Shaper as chat cards — slice 1 of 5: one step card per Shaper ask, with receipts that name the decision

Slice 1 of the approved outline (`slices.json`). Later slices (feature card, feature controls and page reuse, Ship
card, iterate in the chat) are not planned here.

## 1. Problem and goal

Today every Shaper ask is drawn by `renderQpanel` (`ui/public/app.js:5610`) through the ask registry
(`ui/public/ask/registry.mjs`), so the chat run card, the run page and the feature page already share one *function*.
But the step *layouts* are split and the answers bypass the card:

- `ui/public/shape/plan-body.mjs` renders 2 layouts: `renderCard` (gate on) and `renderHeld` (gate off), which show
  different primaries ("Approve and build" vs "Run this plan").
- `ui/public/shape/outline-body.mjs` renders the same 2 layouts (the held one shows "Plan slice 1 anyway" and Stop;
  the card has no Stop at all).
- Check rows are drawn in 3 places: the held list in `ui/public/shape/plan-body.mjs:77`, chips in
  `ui/public/shape/check-row.mjs`, and a `paintChecks` copy in `ui/public/shape/outline-body.mjs:179`; `fold()` is
  defined 2 times (`ui/public/shape/plan-body.mjs:45`, `ui/public/shape/outline-body.mjs:46`).
- 3 buttons (plan, outline, Clarify "Skip") post through `deps.submit` directly, so the chat run card
  (`ui/public/chat/run-card.mjs:121` `answerReceipt`) shows "Answered · …" after them.
- The feature page host (`ui/public/app.js:464` `featurePageDeps.mountAsk`) has 0 click delegates, so its 2 gate
  buttons, 2 recovery buttons and the Clarify Answer button post nothing.
- A failed answer shows only "Could not send your answer. Try again." and 0 words of the server's reason.

Goal (measurable):

- Every one of the 6 step kinds (Clarify, Plan, Split, run-k Plan, Gate, Recovery) renders through exactly 1 layout
  with a `.ask-mcard-head` (title + `.ask-mcard-kind` chip), a body and one action row, with the gate flag on and off.
- The kind chip reads `Clarify`, `Plan`, `Runs`, `Plan · run 2`, `Gate` or `Recovery`.
- The receipt after an answer names the decision: `Plan approved`, `Split into 3 runs`, `Another cycle approved`,
  `Clarify · 2 answers`, and 0 receipts read "Answered" when the answer was sent from this tab.
- `ui/public/shape/` holds exactly 1 check-row renderer and 1 `fold()`; 0 held layouts remain.
- A failed answer (HTTP 409 with `{ error }`) keeps the typed text and shows `Not sent: ` followed by the server's error.
- Gate, recovery and Clarify buttons post from every host, including the feature page (0 dead buttons).
- `node tools/test.mjs` returns exit code 0.

## 2. Decisions

| # | Decision | Where |
|---|---|---|
| D1 | One layout per kind: delete `renderHeld` from both bodies; the gate flag only removes the controls whose routes are gated (inline Full plan text → popup via `openFull`, plan summary, perspectives edit, Save to plans/, Open in New run). | `ui/public/shape/plan-body.mjs`, `ui/public/shape/outline-body.mjs` |
| D2 | Gate and recovery bodies move out of app.js into one module with the shared step chrome; `renderGateBody`/`renderRecoveryBody` are deleted from app.js. | `ui/public/shape/step-card.mjs` (new) |
| D3 | Gate and recovery are one registry kind each for every run, so the step card replaces them for non-Shaper runs too (one layout per kind); their labels become the spec's (`Continue with what you have` / `Approve another cycle`, `Pause` or `Abort` / `Retry`). | `ui/public/app.js`, `ui/public/shape/step-card.mjs` (new) |
| D4 | Every step card binds its own buttons and calls `e.stopPropagation()`; the delegated selectors drop the gate/recovery classes (`Q_BUTTONS` becomes `.qpanel .btn-go`, `DECISIONS` goes). This fixes the dead feature-page buttons. | `ui/public/chat/run-card.mjs`, `ui/public/app.js` |
| D5 | Receipts are named in one pure function `stepReceipt(pq, payload, { shaping })`; `postAnswer` notes the named receipt per question id BEFORE the POST and forgets it on failure; the chat card reads it first. The run card's own gate arm in `answerReceipt` is deleted. | `ui/public/shape/step-receipt.mjs` (new), `ui/public/app.js`, `ui/public/chat/run-card.mjs` |
| D6 | An answer from another tab or device still shows the "Answered" fallback in this slice; the engine-derived step log (slice 2) replaces it. | `ui/public/chat/run-card.mjs` |
| D7 | One check-row component and one `fold()`: `check-row.mjs` exports `fold`, `buildCheckRows` and `buildCheckFold` (neutral ✓ / ✕ rows, folded behind one check line); the chip renderer `buildCheckRow` is deleted. | `ui/public/shape/check-row.mjs` |
| D8 | Fix all lives in the ⋯ menu on both Plan and Split (spec table for Plan; the spec is silent for Split, so the same place is used for one control in one place). | `ui/public/shape/plan-body.mjs`, `ui/public/shape/outline-body.mjs` |
| D9 | Stop is in the step card's ⋯ on Plan and Split (spec table), confirmed with today's `confirm` dialog. | `ui/public/shape/plan-body.mjs`, `ui/public/shape/outline-body.mjs` |
| D10 | Plan approve label is `Approve and build`: in today's engine the order is clarify → split → plan (`src/core/orchestrator.mjs:1350` `_outlineLoop` runs before the plan hold), so every plan approval starts a build and the spec's `Approve the plan` case does not occur; flagged in the PR and in Open questions. | `ui/public/shape/plan-text.mjs` |
| D11 | Split approve label is `Approve N runs` (N after edits); with fewer than 2 runs it stays today's `Plan it as one` (spec silent). | `ui/public/shape/outline-body.mjs` |
| D12 | Recovery shows one give-up button, `Pause` or `Abort`, picked from the prompt's options as today, plus `Retry`: the engine maps any non-retry to the policy's give-up (`src/core/failure-policy.mjs:150`), so showing both would mislabel one. | `ui/public/shape/step-card.mjs` (new) |
| D13 | A step card's failure says why: `deps.submit` resolves `true` or the server's reason string (`stepPost` wraps `postAnswer` with a new `onFail` callback); a bare `false` keeps `SEND_FAILED`; focus returns to the pressed control when the disable dropped it to `body`. | `ui/public/app.js`, `ui/public/shape/step-card.mjs` (new) |
| D14 | UI says "run" for a slice in every step card (`3 runs`, `Merge with next`, `Don't split`, `Ask me before each run`); engine, payloads and server error texts keep "slice". | `ui/public/shape/outline-body.mjs` |
| D15 | The chip is `Plan · run k` whenever the run carries `shaping.feature.index` (1-based, `src/core/orchestrator.mjs:1445`), so the planning run's plan after the split reads `Plan · run 1`; a plan before any split reads `Plan`. | `ui/public/shape/step-card.mjs` (new) |
| D16 | Hosts hide their own question heading for a step card (the card's head says it once): `chatPaintQuestion` returns `stepCard: true`; the run page heading is emptied for step kinds. | `ui/public/app.js`, `ui/public/chat/run-card.mjs` |
| D17 | No restyle: the head reuses `.ask-mcard-head/-title/-kind`; the only CSS added lets the title wrap inside a `.qpanel` at 375px and pushes the per-run ⋯ right; the Split row number stays the existing CSS counter (no second number in the markup). | `ui/public/style.css` |

### Checklist
- [ ] R-arch-1 `renderHeld` and `paintChecks` do not exist anywhere under `ui/public`.
- [ ] R-arch-2 `renderGateBody` and `renderRecoveryBody` do not exist in `ui/public/app.js`; gate and recovery register `renderGateCard`/`renderRecoveryCard`.
- [ ] R-arch-3 `ui/public/chat/run-card.mjs` `Q_BUTTONS` equals `'.qpanel .btn-go'` and has no `DECISIONS` map.
- [ ] R-arch-4 `stepReceipt` is the only function that names a step decision; `answerReceipt` reads `namedAnswer` first and has no `kind === 'gate'` arm.
- [ ] R-arch-5 `postAnswer` calls `noteAnswer` before the fetch and `forgetAnswer` on every failure branch.
- [ ] R-arch-6 No engine, server route or payload shape changes in this slice (`git diff --stat` lists no `src/core` or `ui/server.mjs` file).

## 3. Screens and states

Every step card has the same anatomy in all three hosts (chat run card `.chat-rc-qbody`, run page `.rd-questions`,
feature page `.shape-feature-ask`):

```
┌ .qpanel ───────────────────────────────────────────────┐
│ .ask-mcard-head   [title ...............] [kind chip]  │
│ body                                                    │
│ .plan-err (role=alert, hidden until a failure)          │
│ .qpanel-foot   [quiet …] [primary]            [⋯]       │
└─────────────────────────────────────────────────────────┘
```

| Step | Title | Chip | Body | Foot (left → right) | ⋯ |
|---|---|---|---|---|---|
| Clarify (shaping run, gate on) | `A few questions before the plan` | `Clarify` | today's Clarify body (options + free text) | `Use defaults` · `Answer` (primary) | — |
| Plan (no split yet) | `Your turn: approve the plan` | `Plan` | sub line `title · v2`; summary; folded check line `Shape 4/5 · 1 to fix` → rows; perspectives line; Full plan view (gate on) | `Ask for changes` · `Full plan` · `Approve and build` (primary) | Fix all (revisable, unmet) · Save to plans/ (gate on) · Open in New run (gate on, Advanced) · Stop |
| Run k plan | same | `Plan · run 2` (`Plan · run 1` in the planning run after the split) | as Plan + `The planner says this run can't be built as outlined:` note when set | as Plan | as Plan |
| Split | `Your turn: approve the runs` | `Runs` | summary `3 runs · v2 · why`; list `1. title · estimate` + goal, per row ⋯; `Undo edits` (only with edits); `Ask me before each run` switch (off); folded check line `Outline 4/5` | `Ask for changes` · `Approve 3 runs` (primary) | Fix all (revisable, unmet) · Don't split (plan it as one) · Stop |
| Gate | `Review needs a decision` (step label) | `Gate` | intro (Advanced / Simple twins as today); issues with severity | `Continue with what you have` · `Approve another cycle` (primary) | — |
| Recovery | `Build failed` (step label) | `Recovery` | intro, the error, network note when set | `Pause` or `Abort` · `Retry` (primary) | — |

States for every card:

- **Open:** as above, the error line hidden.
- **Sending:** every control disabled (`setPanelBusy`), a second click posts nothing.
- **Failed (non-422):** controls re-enabled, the typed text and edits kept, `.plan-err` shows
  `Not sent: this question is no longer pending` (the server's `error`), or `Could not send your answer. Try again.`
  when there is no reason; focus is back on the pressed control.
- **Rejected (422):** field errors painted by `setErrors` (Plan/Split `.plan-err`), input kept.
- **Answered (chat card):** the card collapses into one receipt line, named (table in §5); the answers list unfolds
  under it for Clarify.
- **Gate flag off:** the same card; Full plan opens the artifact popup instead of unfolding; no plan summary (the plan
  text route is gated); no perspectives `edit`, no Save / Open in New run in ⋯. Labels and the foot are identical.
- **Not revisable (last round):** no `Ask for changes`, no Fix all.
- **Split with 1 run left after edits:** primary reads `Plan it as one`; per-row ⋯ has no Remove; the last row has no
  Merge with next.
- **Workspace run:** Plan ⋯ holds only Fix all and Stop.
- **Non-Shaper run:** Gate and Recovery show the same step card (D3).
- **375px:** the head title wraps, the chip stays beside or under it without overflow, the foot wraps; no horizontal
  scroll inside the card.

### Checklist
- [ ] R-ux-1 Each of the 6 step kinds shows a `.ask-mcard-head` whose `.ask-mcard-kind` reads the chip in the table.
- [ ] R-ux-2 The chat card's `.chat-rc-q-head` and the run page's question heading are empty for a step card (the title shows once).
- [ ] R-ux-3 Plan and Split show the same foot buttons with the gate flag on and off.
- [ ] R-ux-4 A failed answer shows `Not sent: ` plus the server's reason and keeps the typed feedback text.
- [ ] R-ux-5 Split shows `Approve 3 runs` for 3 runs, `Approve 2 runs` after one Merge with next, `Plan it as one` for 1.
- [ ] R-ux-6 The chat receipt line reads the named decision (`Plan approved`, `Split into 3 runs`, `Another cycle approved`).
- [ ] R-ux-7 At 375px the step head title wraps (`white-space: normal`) and never overflows the card.
- [ ] R-ux-8 Each Split row shows its number once (the CSS counter), no `.outline-slice-n` element.

## 4. Code layout

| File | Change |
|---|---|
| `ui/public/shape/step-card.mjs` (new) | `SEND_FAILED`, `stepHead`, `stepKind`, `stepChip`, `stepTitle`, `isStepCard`, `stepSender`, `renderGateCard`, `renderRecoveryCard` |
| `ui/public/shape/step-receipt.mjs` (new) | `stepReceipt`, `noteAnswer`, `forgetAnswer`, `namedAnswer` |
| `ui/public/shape/check-row.mjs` | `fold`, `buildCheckRows`, `buildCheckFold`; `buildCheckRow` deleted |
| `ui/public/shape/plan-body.mjs` | one layout; head; ⋯ with Fix all / Save / Open in New run / Stop; uses `stepSender`, `fold`, `buildCheckFold`; re-exports `SEND_FAILED` |
| `ui/public/shape/outline-body.mjs` | one layout; head; per-row ⋯; `Approve N runs`; `Ask me before each run`; run vocabulary; Edit slices mode goes |
| `ui/public/shape/questions.mjs` | head; `Answer` / `Use defaults`; own click handlers through `ctx.collect` + `ctx.submit`; imports `SEND_FAILED` from step-card |
| `ui/public/shape/plan-text.mjs` | `approveLabel` returns `Approve and build` for every plan ask (the outline label lives in outline-body) |
| `ui/public/app.js` | `postAnswer` `onFail` + note/forget; `stepPost`; `stepDeps`; registrations for gate/recovery/plan/clarify pass step deps; `askHeading` uses `stepTitle`; `chatPaintQuestion` returns `stepCard`; run page heading empty for step kinds; delete `renderGateBody`, `renderRecoveryBody` and the gate/recovery arms of `onRdDelegatedClick`; `window.__shapeFeature.paintAsk` test seam |
| `ui/public/chat/run-card.mjs` | `Q_BUTTONS`, no `DECISIONS`; `answerReceipt` reads `namedAnswer`, gate arm deleted; a named answer counts as "mine" for the receipt; `qHead` hidden for a step card |
| `ui/public/style.css` | `.qpanel .step-head` rules (wrap title, spacing), `.outline-row-more` |
| `docs/ui-levels.md`, `docs/shape-it-first.md` | rows that name the old labels |

### 4.1 `ui/public/shape/step-receipt.mjs` (new)

```js
// ui/public/shape/step-receipt.mjs — the receipt a step card leaves once answered (shaper-cards spec §2.2): the decision,
// named ("Plan approved", "Split into 3 runs", "Another cycle approved"), never "Answered". Pure naming + a per-tab note
// keyed by question id, written by app.js postAnswer BEFORE its POST (question-resolved can land before the 200).
import { applyOutlineEdits } from '../../../src/shared/shape/slices.mjs';
import { askKindOf } from '../ask/registry.mjs';

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
const NAMED = new Map();          // question id → { text, answers }
const NAMED_MAX = 200;

/** The named decision for an answer to `pq`, or null when the kind has no step name (a non-shaping Clarify, a form). */
export function stepReceipt(pq, payload, { shaping = false } = {}) {
  if (!pq) return null;
  const p = payload || {};
  const d = p.decision;
  const kind = askKindOf(pq);
  if (kind === 'gate') return d === 'another' ? 'Another cycle approved' : 'Continued with what you have';
  if (kind === 'recovery') return d === 'retry' ? 'Retried' : d === 'abort' ? 'Aborted' : 'Paused';
  if (kind === 'plan') {
    const plan = pq.plan || {};
    if (plan.outline) {
      if (d === 'approve') {
        const r = applyOutlineEdits(plan.outline, Array.isArray(p.edits) ? p.edits : []);
        const n = (r.ok ? r.outline : plan.outline).slices.length;
        return n < 2 ? 'Planned as one run' : `Split into ${n} runs`;
      }
      if (d === 'flat') return 'Not split · planned as one run';
      if (d === 'stop') return 'Stopped at the split';
      return 'Changes asked · Runs';
    }
    if (d === 'approve') {
      const k = (Number(plan.round) || 1) - 1;
      return k > 0 ? `Plan approved · after ${plural(k, 'round')} of changes` : 'Plan approved';
    }
    if (d === 'stop') return 'Stopped at the plan';
    return Array.isArray(p.perspectives) ? 'Changes asked · perspectives' : 'Changes asked · Plan';
  }
  if (kind === 'clarify' && shaping && Array.isArray(p.answers)) {
    const k = p.answers.filter((a) => a && typeof a.choice === 'string' && a.choice.trim()).length;
    return k ? `Clarify · ${plural(k, 'answer')}` : 'Clarify · no answers';
  }
  return null;
}

/** Remember what this tab is sending for `pq` (called before the POST). */
export function noteAnswer(pq, payload, opts) {
  if (!pq || !pq.id) return;
  const text = stepReceipt(pq, payload, opts);
  if (!text) return;
  NAMED.delete(pq.id);
  NAMED.set(pq.id, { text, answers: Array.isArray(payload && payload.answers) ? payload.answers : [] });
  if (NAMED.size > NAMED_MAX) NAMED.delete(NAMED.keys().next().value);
}
export const forgetAnswer = (id) => { NAMED.delete(id); };
export const namedAnswer = (id) => (id ? NAMED.get(id) || null : null);
```

### 4.2 `ui/public/shape/step-card.mjs` (new)

```js
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

/** Gate (cycle limit). deps: { doc, title, chip, wireCopy, tagLevel(el, level), submit }. */
export function renderGateCard(panel, pq, deps) {
  const { doc } = deps;
  const issues = Array.isArray(pq.issues) ? pq.issues : [];
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const intro = doc.createElement('div');
  intro.className = 'gate-intro';
  intro.textContent = `This cycle reached its limit${deps.wireCopy || ''}${issues.length ? ' with open issues' : ''}. Approve another cycle to keep iterating, or continue with what you have.`;
  deps.tagLevel(intro, 'advanced');
  const plain = doc.createElement('div');
  plain.className = 'gate-intro';
  plain.dataset.maxLevel = 'simple';
  plain.textContent = issues.length
    ? 'The agents reviewed their own work and still see problems. Let them try once more, or carry on with what they have?'
    : 'The agents have used the attempts they are allowed. Let them try once more, or carry on with what they have?';
  panel.append(intro, plain);
  if (issues.length) panel.appendChild(issueList(doc, issues));     // today's ul.issues markup, moved from app.js
  const err = errLine(doc);
  const send = stepSender(deps, err);
  const foot = doc.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  foot.append(
    ownButton(doc, 'gate-continue', 'Continue with what you have', () => send({ decision: 'continue' })),
    ownButton(doc, 'btn-primary gate-another', 'Approve another cycle', () => send({ decision: 'another' })));
  panel.append(err, foot);
}

/** Recovery. One give-up button from the prompt's options (the engine maps any non-retry to the policy's give-up). */
export function renderRecoveryCard(panel, pq, deps) {
  const { doc } = deps;
  const rec = pq.recovery || {};
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  // intro, rec.message (.issue-detail) and the rec.network note: today's text and classes, moved from app.js:5918
  appendRecoveryBody(doc, panel, rec);
  const giveUp = (Array.isArray(rec.options) && rec.options.find((o) => o && o.id !== 'retry')) || { id: 'pause' };
  const abort = giveUp.id === 'abort';
  const err = errLine(doc);
  const send = stepSender(deps, err);
  const quit = ownButton(doc, abort ? 'recovery-abort' : 'recovery-pause', abort ? 'Abort' : 'Pause',
    () => send({ decision: abort ? 'abort' : 'pause' }));
  quit.title = abort ? 'End the run here with this error. The worktree is torn down.'
    : 'Park the run here with this error as the reason. Nothing is discarded — Resume retries the step later.';
  const foot = doc.createElement('div');
  foot.className = 'qpanel-foot gate-actions';
  foot.append(quit, ownButton(doc, 'btn-primary recovery-retry', 'Retry', () => send({ decision: 'retry' })));
  panel.append(err, foot);
}
```

`issueList(doc, issues)` and `appendRecoveryBody(doc, panel, rec)` are private functions in the same file holding the
markup now in `renderGateBody` (`ui/public/app.js:5848`) and `renderRecoveryBody` (`ui/public/app.js:5918`), unchanged
apart from `document` → `doc` and the button labels above.

### 4.3 `ui/public/shape/check-row.mjs` (rewritten)

```js
// ui/public/shape/check-row.mjs — the ONE check-row component and the ONE fold() (shaper-cards spec §2.2): a check line
// (`Shape 4/5 · 1 to fix`) that unfolds neutral ✓ / ✕ rows. Plan and Split cards both use it; nothing else draws checks.
import { checkLine } from './plan-text.mjs';

/** A control that shows/hides `region` (folded by default). */
export function fold(b, region, onOpen) {
  b.setAttribute('aria-expanded', 'false');
  b.addEventListener('click', () => {
    region.hidden = !region.hidden;
    b.setAttribute('aria-expanded', String(!region.hidden));
    if (!region.hidden && onOpen) onOpen();
  });
  return b;
}

/** The rows of a check: one `.plan-check-row` per item, ✓ met / ✕ unmet with its detail. */
export function buildCheckRows(doc, check) {
  const h = (tag, cls, text) => { const e = doc.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
  return (check && Array.isArray(check.items) ? check.items : []).map((it) => {
    const row = h('div', `plan-check-row${it.pass ? ' ok' : ''}`);
    const mark = h('span', 'plan-check-mark', it.pass ? '✓' : '✕');
    mark.setAttribute('aria-label', it.pass ? 'met' : 'unmet');
    row.append(mark, h('span', 'plan-check-label', it.label));
    if (!it.pass && it.detail) row.appendChild(h('span', 'plan-check-detail', it.detail));
    return row;
  });
}

/** The folded check: `{ line, rows, update(check) }`; update repaints in place, so an open fold stays open. */
export function buildCheckFold(doc, check, name = 'Shape') {
  const rows = doc.createElement('div'); rows.className = 'plan-checks'; rows.hidden = true;
  const line = doc.createElement('button'); line.type = 'button'; line.className = 'btn plan-fold plan-check-line';
  const text = doc.createElement('span'); text.className = 'plan-fold-text';
  const chev = doc.createElement('span'); chev.className = 'plan-chev'; chev.textContent = '›'; chev.setAttribute('aria-hidden', 'true');
  line.append(text, chev);
  fold(line, rows);
  const update = (c) => { text.textContent = checkLine(c, name); rows.replaceChildren(...buildCheckRows(doc, c)); };
  update(check);
  return { line, rows, update };
}
```

### 4.4 `ui/public/shape/plan-body.mjs` (one layout)

`renderHeld` and the `if (deps.extras) renderCard(); else renderHeld();` switch go, and so do the local `fold` and
`send`. The card body below replaces both; `deps.extras` (gate on) only gates the controls that call gated routes.
`deps.doc` is `ctx.doc` (today `planBodyDeps` passes `document`; both are the same object in every host).

```js
import { buildPerspectiveChips } from './chips.mjs';
import { planStats, perspectiveChangeFeedback, fixAllFeedback, sectionOwners, planSummary, unmetLine,
  approveLabel } from './plan-text.mjs';
import { perspectiveByKey, PERSPECTIVES } from '../../../src/shared/shape/perspectives.mjs';
import { levelAtLeast } from '../ui-level.mjs';
import { toggleMenu } from '../workflows/menu.mjs';
import { fold, buildCheckFold } from './check-row.mjs';
import { SEND_FAILED, stepHead, stepSender } from './step-card.mjs';
export { SEND_FAILED };

export function renderPlanBody(panel, pq, deps) {
  const { doc } = deps;
  // plan / check / items / perspectives / h / btn / score / fileName / planText / meta / summary: as today
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const body = h('div', 'plan-body plan-card');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  let afterSubmit = () => {};                     // re-derives controls setPanelBusy re-enabled (F32)
  const send = stepSender(deps, err, { after: () => afterSubmit() });
  // sub line, summary, outlineChange note (now "The planner says this run can't be built as outlined:"): as today's renderCard
  if (items.length) { const f = buildCheckFold(doc, check, 'Shape'); body.append(f.line, f.rows); }
  // perspectives line; `edit` + chips + Update plan only when deps.extras && plan.revisable (posts perspectives)
  // Full plan view + paintPlan(md) only when deps.extras (fetchPlan is gated); summary therefore only with the gate on
  const typed = plan.revisable ? typedRow() : null;   // typedRow's Send changes calls send({ decision:'revise', feedback })
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }
  const foot = h('div', 'qpanel-foot plan-actions');
  if (typed) foot.appendChild(fold(btn('plan-ask-changes', 'Ask for changes'), typed.row, () => typed.typed.focus()));
  foot.appendChild(fullButton());
  const approve = btn('btn-primary plan-approve', approveLabel(plan));
  approve.addEventListener('click', (e) => { e.stopPropagation(); send({ decision: 'approve' }); });
  foot.appendChild(approve);
  foot.appendChild(moreButton());
  body.append(err, foot);
  if (check && check.ok === false && unmetLine(check)) body.appendChild(h('div', 'plan-unmet', unmetLine(check)));
  panel.appendChild(body);

  /** Gate on: today's inline fold (Full plan / Hide plan). Gate off: the artifact popup. Same label either way. */
  function fullButton() {
    if (!deps.extras) {
      const b = btn('plan-full', 'Full plan');
      b.addEventListener('click', (e) => { e.stopPropagation(); deps.openFull(); });
      return b;
    }
    const b = fold(btn('plan-full', 'Full plan'), fullView);
    b.addEventListener('click', () => { b.textContent = fullView.hidden ? 'Full plan' : 'Hide plan'; });
    return b;
  }
  function moreButton() {
    const more = btn('btn-ghost plan-more', '⋯');
    more.setAttribute('aria-label', 'More for this plan');
    more.setAttribute('aria-haspopup', 'menu');
    const ws = !!(deps.run && deps.run.workspaceId);
    more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu({ doc, anchor: more, align: 'end', label: 'More for this plan', items: [
      ...(plan.revisable && items.some((it) => !it.pass) ? [{ label: 'Fix all', onSelect: () => send({ decision: 'revise', feedback: fixAllFeedback(items) }) }] : []),
      ...(deps.extras && !ws ? [{ label: 'Save to plans/', onSelect: () => savePlan(false) }] : []),
      ...(deps.extras && !ws && levelAtLeast('advanced', doc) ? [{ label: 'Open in New run', onSelect: openInNewRun }] : []),
      { label: 'Stop', onSelect: stopRun },
    ] }); });
    return more;
  }
  async function stopRun() {
    if (await deps.confirm({ title: 'Stop this run', message: 'The plan stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
  }
  // typedRow, savePlan, openInNewRun, paintPlan, setErrors: as today
  panel.__plan = { setErrors };
}
```

`approveLabel` in `ui/public/shape/plan-text.mjs` becomes `export const approveLabel = () => 'Approve and build';`
(the outline label is computed by outline-body, D10/D11).

### 4.5 `ui/public/shape/outline-body.mjs` (one layout, run vocabulary)

The Edit slices mode, `renderHeld`, `paintChecks`, the local `fold`/`send` and the held acceptance lists go. Merge with
next / Remove move into a per-row ⋯ (spec table); `Undo edits` shows whenever there are edits.

```js
import { applyOutlineEdits, checkSlices, outlineFixAllFeedback } from '../../../src/shared/shape/slices.mjs';
import { fold, buildCheckFold } from './check-row.mjs';
import { stepHead, stepSender } from './step-card.mjs';
import { toggleMenu } from '../workflows/menu.mjs';

/** "3 runs · v2 · why" — the round only after the first, the why when set. */
export function outlineSummary(outline, round = 1) {
  const n = Array.isArray(outline && outline.slices) ? outline.slices.length : 0;
  const why = String((outline && outline.why) || '').trim();
  return [`${n} ${n === 1 ? 'run' : 'runs'}`, round > 1 ? `v${round}` : '', why].filter(Boolean).join(' · ');
}
export const approveRunsLabel = (n) => (n < 2 ? 'Plan it as one' : `Approve ${n} runs`);

export function renderOutlineBody(panel, pq, deps) {
  const { doc } = deps;
  const plan = pq.plan || {};
  const asked = plan.outline || { why: '', slices: [] };
  // h / btn as today; carried edits (plan.edits) now apply with the gate on AND off
  const carried = Array.isArray(plan.edits) ? plan.edits.filter((e) => e && (e.op === 'merge' || e.op === 'remove') && typeof e.id === 'string') : [];
  let edits = carried.length && applyOutlineEdits(asked, carried).ok ? carried : [];
  panel.appendChild(stepHead(doc, deps.title, deps.chip));
  const body = h('div', 'plan-body plan-card outline-body');
  const err = h('div', 'plan-err'); err.hidden = true; err.setAttribute('role', 'alert');
  const send = stepSender(deps, err);
  const summary = h('p', 'plan-summary outline-summary');
  const list = h('ol', 'outline-slices');
  const undo = btn('outline-undo', 'Undo edits');
  undo.addEventListener('click', (e) => { e.stopPropagation(); edits = []; paint(); });
  const each = h('label', 'outline-approve-each');
  const eachBox = h('input'); eachBox.type = 'checkbox'; eachBox.checked = plan.approveEach === true;   // decision 2: off
  each.append(eachBox, doc.createTextNode(' Ask me before each run'));
  const under = h('div', 'outline-under'); under.append(undo, each);
  const checks = buildCheckFold(doc, checkSlices(asked), 'Outline');
  body.append(summary, list, under, checks.line, checks.rows);
  const typed = plan.revisable ? typedRow() : null;   // placeholder "Ask for changes to the runs in your own words…"
  if (typed) { typed.row.hidden = true; body.appendChild(typed.row); }
  const approve = btn('btn-primary outline-approve', '');
  approve.addEventListener('click', (e) => { e.stopPropagation();
    send({ decision: 'approve', ...(edits.length ? { edits } : {}), approveEach: eachBox.checked }); });
  const foot = h('div', 'qpanel-foot plan-actions');
  if (typed) foot.appendChild(fold(btn('plan-ask-changes', 'Ask for changes'), typed.row, () => typed.typed.focus()));
  foot.append(approve, moreButton());
  body.append(err, foot);
  if (plan.error) { err.hidden = false; err.textContent = plan.error; }
  panel.appendChild(body);
  paint();

  function currentOutline() { const r = applyOutlineEdits(asked, edits); return r.ok ? r.outline : asked; }

  function paint() {
    let r = applyOutlineEdits(asked, edits);
    if (!r.ok) { setErrors([{ path: 'edits', message: r.error }]); edits = edits.slice(0, -1); r = applyOutlineEdits(asked, edits); }
    const outline = r.ok ? r.outline : asked;
    const n = outline.slices.length;
    list.replaceChildren(...outline.slices.map((s, i) => runItem(s, i, n)));
    summary.textContent = outlineSummary(outline, plan.round || 1);
    checks.update(checkSlices(outline));
    undo.hidden = !edits.length;
    approve.textContent = approveRunsLabel(n);
  }

  // The number is the existing `.outline-slice-title::before` CSS counter: no second number in the markup.
  function runItem(s, i, n) {
    const li = h('li', 'outline-slice'); li.dataset.slice = s.id;
    const head = h('div', 'outline-slice-head');
    head.appendChild(h('b', 'outline-slice-title', s.title));
    if (s.estimate) head.appendChild(h('span', `outline-est ${s.estimate}`, s.estimate));
    const tools = [
      ...(i + 1 < n ? [{ label: 'Merge with next', onSelect: () => { edits = [...edits, { op: 'merge', id: s.id }]; paint(); } }] : []),
      ...(n > 1 ? [{ label: 'Remove', onSelect: () => { edits = [...edits, { op: 'remove', id: s.id }]; paint(); } }] : []),
    ];
    if (tools.length) {
      const more = btn('btn-ghost outline-row-more', '⋯');
      more.setAttribute('aria-label', `More for run ${i + 1}`);
      more.setAttribute('aria-haspopup', 'menu');
      more.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu({ doc, anchor: more, align: 'end', label: `More for run ${i + 1}`, items: tools }); });
      head.appendChild(more);
    }
    li.appendChild(head);
    if (s.goal) li.appendChild(h('div', 'outline-goal', s.goal));
    return li;
  }

  function moreButton() {
    const more = btn('btn-ghost plan-more', '⋯');
    more.setAttribute('aria-label', 'More for these runs');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', (e) => { e.stopPropagation(); const c = checkSlices(currentOutline());
      toggleMenu({ doc, anchor: more, align: 'end', label: 'More for these runs', items: [
        ...(plan.revisable && c.items.some((it) => !it.pass) ? [{ label: 'Fix all', onSelect: () => send({ decision: 'revise', feedback: outlineFixAllFeedback(c.items) }) }] : []),
        { label: 'Don\'t split (plan it as one)', onSelect: () => send({ decision: 'flat' }) },
        { label: 'Stop', onSelect: async () => {
          if (await deps.confirm({ title: 'Stop this run', message: 'The outline stays in the run\'s artifacts.', confirmLabel: 'Stop', danger: true })) send({ decision: 'stop' });
        } },
      ] }); });
    return more;
  }
  // typedRow / setErrors as today (typedRow's Send changes calls send)
  panel.__plan = { setErrors };
}
```

Change from today: `approveEach` is now always posted (the switch is always shown), `false` unless ticked —
`validateOutlineAnswer` already accepts and defaults it (`src/core/shape/run.mjs:120`).

### 4.6 `ui/public/shape/questions.mjs` (Clarify step card)

```js
import { defaultAnswers } from './plan-text.mjs';
import { stepHead, stepSender } from './step-card.mjs';

/** ctx: { doc, title, chip, collect(): payload|null, submit(payload): Promise<true|string|false> } */
export function decorateShapingQuestions(panel, pq, ctx) {
  const foot = panel.querySelector('.qpanel-foot');
  const answer = foot && foot.querySelector('.btn-go');
  if (!foot || !answer) return;
  const head = panel.querySelector('.qpanel-head');
  const top = stepHead(ctx.doc, ctx.title, ctx.chip);
  if (head) head.after(top); else panel.prepend(top);
  const label = [...answer.childNodes].find((n) => n.nodeType === 3);
  if (label) label.textContent = 'Answer';
  const err = ctx.doc.createElement('div');
  err.className = 'plan-err'; err.setAttribute('role', 'alert'); err.hidden = true;
  const send = stepSender(ctx, err);
  // Own handler: no host delegate sees this click (the feature page has none; the chat card and run page would double-post).
  answer.addEventListener('click', (e) => { e.stopPropagation(); const p = ctx.collect(); if (p) send(p); });
  const defaults = ctx.doc.createElement('button');
  defaults.type = 'button';
  defaults.className = 'btn clarify-defaults';
  defaults.textContent = 'Use defaults';
  defaults.addEventListener('click', (e) => { e.stopPropagation(); send(defaultAnswers(pq)); });
  foot.insertBefore(defaults, answer);
  foot.before(err);
}
```

### 4.7 `ui/public/app.js`

```js
import { stepChip, stepTitle, isStepCard, renderGateCard, renderRecoveryCard } from './shape/step-card.mjs';
import { noteAnswer, forgetAnswer } from './shape/step-receipt.mjs';

/** A step card's submit: true on 200, else the server's reason (a string) or false (D13). */
function stepPost(r, payload, opts = {}) {
  let why = '';
  return postAnswer(r, payload, { ...opts, onFail: (m) => { why = m; } }).then((ok) => (ok ? true : (why || false)));
}
/** What every step card gets on top of the host ctx. */
function stepDeps(ctx, pq) {
  const r = ctx.run;
  const who = pq.nodeId ? nodeLabel(r.stepper, pq.nodeId) : '';
  return { doc: ctx.doc || document, run: r, title: stepTitle(pq, who), chip: stepChip(pq, r) };
}

registerAskRenderer('gate', {
  title: () => 'Cycle gate',
  render: (panel, pq, ctx) => renderGateCard(panel, pq, { ...stepDeps(ctx, pq),
    wireCopy: gateWireCopy(ctx.run, pq.wireId), tagLevel, submit: (p) => stepPost(ctx.run, p) }),
});
registerAskRenderer('recovery', {
  title: (pq) => `${(((pq.recovery || {}).cls) || 'recoverable').replace('_', ' ')} error — action needed`,
  render: (panel, pq, ctx) => renderRecoveryCard(panel, pq, { ...stepDeps(ctx, pq), submit: (p) => stepPost(ctx.run, p) }),
});
// clarify render:
//   renderClarifyBody(ctx.run, panel, pq);
//   if (isStepCard(pq, ctx.run, shapeFirstOn())) decorateShapingQuestions(panel, pq, { ...ctx, ...stepDeps(ctx, pq),
//     collect: () => askRendererFor('clarify').collect(panel), submit: (p) => stepPost(ctx.run, p) });
// planBodyDeps / outlineBodyDeps: spread stepDeps(ctx, ctx.run.pendingQuestion) first and
//   submit: (payload) => stepPost(r, payload, { plan: shapeFirstOn() })     // the route still chosen at post time (D12 of shape-it-first)

// postAnswer gains `onFail` and the receipt note (everything not shown stays as today):
async function postAnswer(r, payload, { plan = false, onFail = null } = {}) {
  if (!r || !r.pendingQuestion) { if (onFail) onFail('this run is not waiting for an answer'); return false; }
  if (r._answering) return false;
  if (r._finished || isTerminalStatus(r.status)) { if (onFail) onFail('this run is over'); return false; }
  const id = r.pendingQuestion.id;
  noteAnswer(r.pendingQuestion, payload, { shaping: shapeFirstOn() && isShapingRun(r) });   // before the POST (D5)
  // ... setPanelBusy / _answering as today
  try {
    // ... fetch as today
    if (res.status === 422) { forgetAnswer(id); /* ... as today */ return false; }
    if (!res.ok) {
      const err = await safeJson(res);
      forgetAnswer(id);
      // ... run log line as today
      if (onFail) onFail((err && err.error) || `the server answered ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    forgetAnswer(id);
    // ... run log line as today
    if (onFail) onFail('the server could not be reached');
    return false;
  }
}

// chatPaintQuestion's return (D16):
//   return { id: pq.id || null, kind: askKindOf(pq), heading: askHeading(r, pq),
//     step: pq.nodeId ? nodeLabel(r.stepper, pq.nodeId) : '', stepCard: isStepCard(pq, r, shapeFirstOn()) };
// askHeading: for a step card return stepTitle(pq, who) (one wording, gate on and off).
// paintRdQuestions: if (head) head.textContent = pq && !isStepCard(pq, r, shapeFirstOn()) ? askHeading(r, pq) : '';
// onRdDelegatedClick: selector '.qpanel .btn-go' only; the five gate/recovery arms are deleted.
// test seam: window.__shapeFeature = { ...today, paintAsk: (ref, host) => chatPaintQuestion(ref, host) };
```

`renderGateBody` (`app.js:5848`) and `renderRecoveryBody` (`app.js:5918`) are deleted.

### 4.8 `ui/public/chat/run-card.mjs` (receipt and selectors only)

```js
import { namedAnswer } from '../shape/step-receipt.mjs';

const Q_BUTTONS = '.qpanel .btn-go';   // step cards bind their own buttons (shaper-cards D4)

/** The receipt line a question collapses into: the named decision this tab sent, else today's wording. */
export function answerReceipt(sent, painted) {
  const named = painted && painted.id ? namedAnswer(painted.id) : null;
  if (named) return named.text;
  const step = (painted && (painted.step || painted.heading)) || '';
  const tail = (t) => (step ? `${t} · ${step}` : t);
  if (sent && sent.payload && Array.isArray(sent.payload.answers)) {
    const n = sent.payload.answers.length;
    const k = sent.payload.answers.filter((a) => a && typeof a.choice === 'string' && a.choice.trim()).length;
    return tail(!k ? 'Sent without answers' : k === n ? `${n} answer${n === 1 ? '' : 's'} sent` : `${k} of ${n} answered`);
  }
  return tail(sent ? 'Answer sent' : 'Answered');
}
```

In the click delegate the `DECISIONS` lookup goes (the payload always comes from `renderer.collect`). In
`paintQuestion`: `painted` keeps `stepCard: !!q.stepCard`, and `qHead.hidden = !painted.heading || painted.stepCard;`.
Where the question goes away:

```js
const named = namedAnswer(was.id);
const mine = (sent && sent.id === was.id ? sent : null)
  || (named ? { id: was.id, kind: was.kind, payload: { answers: named.answers } } : null);
```

so a recovery `Pause` sent from the step card keeps its `Paused` receipt through the `pausing` frame (today's rule
for `mine`). `showReceipt` lists `payload.answers` as today.

### 4.9 `ui/public/style.css`

```css
/* Shaper step cards (shaper-cards spec §2.2): the metrics card head, inside a question panel. */
.qpanel .step-head{height:auto;min-height:24px;flex-wrap:wrap;margin-bottom:8px;}
.qpanel .step-head .ask-mcard-title{white-space:normal;min-width:0;flex:1 1 auto;overflow-wrap:anywhere;}
.outline-row-more{margin-left:auto;}
```

### 4.10 Docs

`docs/ui-levels.md` rows 174–178 and 325 take the new labels (`Approve and build` / `Ask for changes` / `Full plan` /
⋯ with Fix all, Save to plans/, Stop; `Approve N runs` / `Ask me before each run` / per-run ⋯ Merge with next, Remove;
`Use defaults` / `Answer`); "with the gate off: Run this plan / Send changes / Stop" is removed. `docs/shape-it-first.md`
lines 33, 50–51 and 79 get the same label changes.

## 5. Testing

Receipt table asserted by `stepReceipt` (each row a test case):

| Ask | Payload | Receipt |
|---|---|---|
| plan, round 1 | `{decision:'approve'}` | `Plan approved` |
| plan, round 2 | `{decision:'approve'}` | `Plan approved · after 1 round of changes` |
| plan | `{decision:'revise', feedback}` | `Changes asked · Plan` |
| plan | `{decision:'revise', perspectives}` | `Changes asked · perspectives` |
| plan | `{decision:'stop'}` | `Stopped at the plan` |
| outline of 3 | `{decision:'approve'}` | `Split into 3 runs` |
| outline of 3 | `{decision:'approve', edits:[merge s1]}` | `Split into 2 runs` |
| outline | `{decision:'flat'}` | `Not split · planned as one run` |
| gate | `another` / `continue` | `Another cycle approved` / `Continued with what you have` |
| recovery | `retry` / `pause` / `abort` | `Retried` / `Paused` / `Aborted` |
| clarify, shaping | 2 of 2 answered | `Clarify · 2 answers` |
| clarify, not shaping | any | `null` (today's wording) |

New test files:

- `test/ui-shape-step-receipt.test.mjs` (new): the table above returns each named string; 0 rows return `Answered`;
  `noteAnswer` then `namedAnswer` returns `{ text, answers }`; `forgetAnswer` clears it; the 201st note evicts the first.
- `test/ui-shape-step-card.test.mjs` (new): `stepChip` returns `Plan · run 2` for `run.shaping.feature.index === 2`,
  `Plan · run 1` for index 1, `Plan` with no feature and `Runs` for an outline; `isStepCard` returns false for a
  non-shaping Clarify; the gate card shows `Continue with what you have` and `Approve another cycle` and posts
  `{decision:'continue'}`/`{decision:'another'}`; the recovery card shows `Abort` when `options` names abort, else
  `Pause`, never both; a click on any step button inside a parent with a click listener does not reach the parent
  (stopPropagation); `stepSender` with `submit → 'this question is no longer pending'` shows
  `Not sent: this question is no longer pending`, with `false` shows `SEND_FAILED`, with a synchronous throw shows
  `SEND_FAILED` and accepts the next click; a second click while busy posts nothing; after a failed send the pressed
  button has focus again under the `blurOnDisable` setter recipe from `test/ui-limit-reset.test.mjs`.

Existing suites (extend; rewrite the named cases that pin removed behaviour):

- `test/ui-shape-plan-body.test.mjs`: the "extras off" case (`:280`) and the "no Stop" card case (`:89`) are
  rewritten: gate on and gate off list the same head and foot buttons (`Ask for changes`, `Full plan`,
  `Approve and build`, `⋯`); gate off Full plan calls `openFull` and makes 0 `fetchPlan` calls; ⋯ lists `Fix all`,
  `Save to plans/`, `Open in New run`, `Stop` (gate on, Advanced, unmet, revisable) and `Fix all`, `Stop` (gate
  off); Stop confirms then posts `{decision:'stop'}`; a submit resolving a string keeps the typed feedback and shows
  `Not sent: …` (failing first: today the text is `SEND_FAILED`); no `Run this plan` text exists.
- `test/ui-shape-outline-body.test.mjs`: the gate-off cases (`:54`, `:241`, `:248`, `:259`, `:312`) and the Edit
  slices cases (`:151`, `:177`) are rewritten: gate on and off render the same card; the primary reads
  `Approve 3 runs`, `Approve 2 runs` after a per-row ⋯ Merge with next, `Plan it as one` for one run; per-row ⋯ of
  the last row has no Merge with next; each row has 0 `.outline-slice-n` elements; `Undo edits` shows only with
  edits and posts nothing; `Ask me before each run` starts unticked and the approve posts `approveEach:false`/`true`;
  ⋯ lists `Don't split (plan it as one)` (posts `flat`) and `Stop`; `outlineSummary` returns `3 runs · v2 · why`;
  no visible text contains "slice".
- `test/ui-shape-check-row.test.mjs`: the `buildCheckRow` cases are replaced: `buildCheckFold` returns a line reading
  `Shape 4/5 · 1 to fix` and 5 `.plan-check-row` rows, `update()` repaints with the fold left open; `fold()` toggles
  `aria-expanded`. Scan cases (walk `ui/public` `.mjs`/`.js` files only, comments stripped): the string
  `plan-check-row` appears only in `ui/public/shape/check-row.mjs`; under `ui/public/shape/`, `function fold(` or
  `const fold = (` appears only in `ui/public/shape/check-row.mjs`; `renderHeld`, `paintChecks`, `buildCheckRow(`
  and `Run this plan` appear in 0 files; `gate-another` is created only in `ui/public/shape/step-card.mjs` (new).
- `test/ui-shape-questions.test.mjs`: the submit reads `Answer` (keeping its icon), `Use defaults` sits before it;
  the head chip reads `Clarify`; Answer posts `ctx.collect()`'s payload through `ctx.submit`; a parent click listener
  receives 0 clicks; a failing Use defaults shows `.plan-err` (was `.clarify-defaults-err`).
- `test/ui-question-shaping.test.mjs` (booted app, real `app.js`): the label cases change to `Answer` / `Use defaults`;
  for each of the 6 kinds the run page panel and the `window.__shapeFeature.paintAsk` host (the path the chat card and
  feature page use) give the same head title, chip, body text and button labels; a gate click in the paintAsk host
  (no delegate, the feature page case) posts `/api/answer` with `{decision:'another'}` exactly once (failing first);
  Use defaults posts every question's default.
- `test/ui-chat-run-card.test.mjs`: the stubbed gate cases (`:265`, `:758`) and the `answerReceipt` gate row (`:405`)
  change to the named receipts. The receipt cases mount the REAL step cards: the `questionStub` `paintQuestion` calls
  `renderGateCard` / `renderPlanBody` / `renderOutlineBody` into the panel with a `submit` that calls
  `noteAnswer(pq, payload, …)` and resolves `true` (what `postAnswer` does), and returns `stepCard: true`. Approving a
  plan, an outline of 3 and another gate cycle then leaves the receipts `Plan approved`, `Split into 3 runs`,
  `Another cycle approved`; none reads `Answered`; a recovery `Pause` keeps `Paused` after a `pausing` frame;
  `answerReceipt` returns the named text when `namedAnswer` has one; `.chat-rc-q-head` is hidden when
  `paintQuestion` returns `stepCard: true`; CSS case: `.qpanel .step-head .ask-mcard-title` has `white-space:normal`.
- `test/ui-shape-app-wiring.test.mjs` (booted app): `Approve 3 runs` posts the gated route; gate off posts
  `/api/answer`; when the fetch stub for the answer runs, `namedAnswer(id)` already returns `Split into 3 runs`
  (noted before the POST); a 409 `{ error: 'this question is no longer pending' }` on `/api/runs/:id/answer` leaves
  the feedback textarea's value, shows `Not sent: this question is no longer pending` (failing first) and
  `namedAnswer(id)` returns `null` afterwards.
- `test/ui-shape-plan-text.test.mjs`: `approveLabel` returns `Approve and build` for every plan (the `:158`
  outline row changes).
- `test/ui-running-detail.test.mjs:423`: the recovery give-up reads `Pause` (was `Pause run`).
- `test/ui-question.test.mjs:213` runs unchanged: the gate click on the run page posts `{decision:'another'}` once.
- `test/shape-vocabulary-scan.test.mjs` runs unchanged and returns 0 hits.

Fixtures use real shapes: the plan ask from `ui-shape-plan-body` (`kind:'plan'`, `check`, `perspectives`), the outline
from `ui-shape-outline-body`, the recovery `options` built by `promptOptions` in `src/core/failure-policy.mjs`, and
`run.shaping.feature` as `src/core/orchestrator.mjs:1445` writes it (`{ id, index, total }`).

Verify: `npm ci --ignore-scripts --no-audit --no-fund`, then
`node --test test/ui-shape-*.test.mjs test/ui-question-shaping.test.mjs test/ui-question.test.mjs test/ui-chat-run-card.test.mjs test/ui-running-detail.test.mjs`
returns `fail 0`, then `node tools/test.mjs` (background, logged) returns exit code 0.

### Checklist
- [ ] R-qa-1 `stepReceipt` returns the named string for each of the 14 table rows and never `Answered`.
- [ ] R-qa-2 Plan and Split cards list identical foot buttons with the gate flag on and off.
- [ ] R-qa-3 The scan finds `plan-check-row` and `fold` defined only in `ui/public/shape/check-row.mjs` and 0 held layouts.
- [ ] R-qa-4 The chat run card shows `Plan approved`, `Split into 3 runs` and `Another cycle approved` after those answers.
- [ ] R-qa-5 A 409 with an `error` keeps the typed feedback, shows `Not sent: ` plus that error and forgets the named receipt.
- [ ] R-qa-6 A gate button in the feature-page host (no delegate) posts `/api/answer` exactly once.
- [ ] R-qa-7 The run page host and the paintAsk host give the same title, chip, body text and buttons for all 6 kinds.
- [ ] R-qa-8 `node tools/test.mjs` exits 0.

## 6. Out of scope

- The feature card: step log, `Show`, member rows, status line, bars, the `Shaping` / `Feature · n/N` chip (slice 2).
- Engine-derived receipts for answers sent from another tab or device (slice 2's step log).
- Feature-level actions, the group page and Plans tab reuse, the feature view's three modes (slice 3).
- The Ship card and the draft release (slice 4); Ask for changes on finished cards, rounds, the Route card (slice 5).
- Restyling tokens, buttons, the amber tint, the status line or progress (Runs redesign).
- The Runs list's ask word (`ui/public/runs-list.mjs:91`, `Approve the slices`) and the feature view's
  `Approve each slice's plan` menu item: Runs redesign and slice 3 own those surfaces.
- Server error texts that say "slice" (`src/core/shape/run.mjs:108`): the engine keeps "slice".
- The CLI and Away-mode gate wording (`I approve another cycle` in the terminal): not a card.

## 7. Open questions

- The spec's Plan row offers `Approve the plan` while shaping. In today's engine the split is asked before any plan
  (`src/core/orchestrator.mjs:1350`), so every plan approval starts a build and this slice always shows
  `Approve and build` (D10). If the spec intends a plan-before-split order, that is an engine change outside §0.
- The planning run's plan after the split reads `Plan · run 1` (D15); the spec only shows `Plan · run 2`.
- Fix all on the Split card: the spec places it only for Plan; this slice puts it in ⋯ on both for consistency (D8).
- Recovery shows one give-up button (Pause or Abort, from the policy) rather than both (D12).
- Gate and Recovery cards change for non-Shaper runs too (D3), since the registry has one renderer per kind.

## Clarifications (Q&A)

- **runs-redesign-dependency** — The Runs redesign (status line, continuous group bar, group page layout) is not on dev yet, but the feature card relies on it. How should this feature handle those pieces? → **Build on dev now: compose the status line and group bar from today's status/progress helpers (no restyle), and let the Runs redesign restyle them later**
- **draft-release-timing** — No release code exists today. When should the optional draft GitHub release be created? → **Store the release choice on the feature at Ship, and create the draft when existing PR-state polling sees the ship PR merged (the last PR, for stacked)**
- **single-run-release-scope** — Runs spec 3.5 also puts the release row in a single run's 'Ship it' dialog and an 'Add to group…' row on the run page. Are those in this feature? → **Yes: add the release row to the single-run Ship it dialog too, reusing the same component. The run page's Group row (Part of / Add to group…) stays with the Runs redesign. Needs you and Failed show a ? / ! icon instead of a plain dot (runs spec §2.1); the feature card head uses whatever the shared dot helper returns, so no extra work beyond not hard-coding a dot.**
- **outline-review** — Outline review asked for a fifth run (s5: Ask for changes, rounds, the Route card, base merge) after s4; s1–s4 kept as they were. → **Applied: slices.json has s1–s5; this plan is s1.**

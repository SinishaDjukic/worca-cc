// ui/public/prompt-check/chip-host.mjs — the prompt check chip in today's UI (docs/prompt-check.md, "The chip"). One
// controller per text field: it owns the chip node, the grader, the kind menu, the polite announcement and the kind
// correction. The surfaces (Chat composer, the Shaper task, New run, a run card's brief) only call it.
// The chip is the library's SentencePicker (the kind) and Chip (the grade), built once per mount and then patched in
// place: a re-check never empties, remounts or moves it. It never touches the field's or the send button's state.
import { KIND_LABELS, GRADE_LABELS, PROMPT_KINDS } from '../../../src/shared/prompt-check/assessment.mjs';
import { createPromptGrader } from './grader.mjs';
import { createImproveView } from './improve-view.mjs';
import { sentencePicker } from '../design-system/components/settings-row.mjs';
import { chip } from '../design-system/components/chip.mjs';
import { button } from '../design-system/components/button.mjs';
import { toElement } from '../design-system/components/html.mjs';
import { toggleMenu, closeMenus } from '../workflows/menu.mjs';
import { announce as feedbackAnnounce } from '../feedback.mjs';
import { iconSvg } from '../icons.mjs';

const URL_CORRECTION = '/api/prompt-check/kind-correction';
/** Skips that mean "nothing changed enough to check again": the chip keeps its last state. */
const KEEP_SKIPS = new Set(['same-text', 'small-change']);
const TIP = 'What kind of task this is. Pick another to check it again';

let pref = false;
const mounts = new Set();

/** The chat pref `promptCheck` as the browser knows it. Off hides every chip and cancels its check at once; on checks
 *  the text already in every mounted field. */
export function setPromptCheckPref(on) {
  const was = pref;
  pref = on === true;
  if (!pref) for (const m of mounts) m.off();
  else if (!was) for (const m of mounts) m.on();   // fields mounted while it was off (a card at boot) are checked now
}

export function promptCheckOn() {
  return pref;
}

const sayOf = (kind, grade) => `Prompt check: ${KIND_LABELS[kind]}${grade ? `, ${GRADE_LABELS[grade].toLowerCase()}` : ''}`;

/**
 * @param {{doc:Document, host:HTMLElement, before?:Node|null, surface:{kind:string,id:string},
 *   ids?:{threadId?:string, cardId?:string}, forceTask?:boolean, deferCorrection?:boolean|(()=>boolean),
 *   held?:{proposedKind:string, chosenKind:string}|null, announce?:(text:string)=>void, fetchImpl?:Function, timers?:object,
 *   field?:{read:()=>string, write:(text:string)=>void, focus?:()=>void}, project?:()=>(string|{projectDir:string}|null),
 *   engine?:()=>string|null, chatModel?:()=>string|null, onAssessment?:(a:object)=>void}} o
 * `field` wires Improve (docs/prompt-check.md, "Improve"): without it the chip never shows the Improve button.
 * `onAssessment` (the run card's proposed perspectives) is called once per accepted grade, never for a stale or failed one.
 */
export function mountPromptCheckChip({
  doc, host, before = null, surface, ids = {}, forceTask = false, deferCorrection = false, held = null,
  announce = null, fetchImpl = (...a) => fetch(...a), timers, field = null, project = null, engine = null, chatModel = null,
  onAssessment = null,
}) {
  const say = typeof announce === 'function' ? announce : (text) => feedbackAnnounce(text, doc);
  const el = doc.createElement('span');
  el.className = 'pcheck';
  el.setAttribute('data-prompt-check', '');
  el.dataset.kind = '';
  el.dataset.grade = '';
  const btn = toElement(doc, sentencePicker({ id: `pcheck-${surface.kind}`, text: '', label: 'Prompt kind', tip: TIP, chevron: iconSvg('chevron-down', 12) }));
  const pick = btn.querySelector('button');
  pick.prepend(doc.createTextNode(''));   // the kind's words, patched in place before the ▾
  const badge = toElement(doc, chip({ text: '', cls: 'pcheck-grade' }));
  el.appendChild(btn);

  let kind = null;
  let grade = null;
  let proposedKind = null;     // the first kind graded for this draft, before any correction
  // `deferCorrection` may be a function, read at each pick: a chip can stop holding once its id exists.
  const defers = () => (typeof deferCorrection === 'function' ? deferCorrection() === true : !!deferCorrection);
  let lastInput = null;        // {text, answering} of the last input(), re-checked when the setting turns on
  let pending = held && defers() ? { proposedKind: held.proposedKind, chosenKind: held.chosenKind } : null;   // a held
  // correction {proposedKind, chosenKind}, until its id exists (or its send is taken); '' or dispose drops it
  let lastSaid = null;
  let silentNext = false;      // the next applied result is the mount-time check: shown, never announced
  let disposed = false;
  let openDecisions = [];      // the last assessment's open questions: hints for Improve

  // Improve (D11): only a surface that hands over its field gets the button and the view.
  const view = field ? createImproveView({
    doc, surface, field, project, engine, chatModel, fetchImpl, announce: (t) => say(t),
    onState: (st) => { if (st === 'hidden') view.el.remove(); syncImprove(); },
  }) : null;
  const improveBtn = view ? toElement(doc, button({ label: 'Improve', kind: 'quiet', cls: 'pcheck-improve-btn', attrs: { 'data-prompt-improve-open': '' } })) : null;
  function syncImprove() {
    if (!view) return;
    const st = view.state();
    if (shown() && grade === 'needs-detail' && (st === 'hidden' || st === 'busy')) {
      if (improveBtn.parentNode !== el || el.lastChild !== improveBtn) el.appendChild(improveBtn);
      improveBtn.disabled = st === 'busy';
    } else improveBtn.remove();
  }
  improveBtn?.addEventListener('click', () => {
    if (!kind || grade !== 'needs-detail' || view.state() === 'busy') return;
    if (view.el.parentNode !== host) el.after(view.el);   // directly under the chip, inside its host
    view.open(kind, openDecisions);
  });

  const shown = () => el.parentNode === host;
  function show() {
    if (shown()) return;
    host.insertBefore(el, before && before.parentNode === host ? before : null);
  }
  function hide() {
    if (pick.getAttribute('aria-expanded') === 'true') closeMenus();
    view?.close();
    el.remove();
  }
  function paint(k, g) {
    kind = k;
    grade = g;
    pick.firstChild.textContent = KIND_LABELS[k];
    pick.setAttribute('aria-label', `Prompt kind: ${KIND_LABELS[k]}`);
    el.dataset.kind = k;
    el.dataset.grade = g || '';
    if (g) {
      badge.textContent = GRADE_LABELS[g];
      badge.classList.toggle('is-clear', g === 'clear');
      badge.classList.toggle('is-needs-detail', g === 'needs-detail');
      if (badge.parentNode !== el) el.appendChild(badge);
    } else badge.remove();
    syncImprove();
  }

  function onResult(r) {
    if (disposed || !pref) return;
    const silent = silentNext;
    silentNext = false;
    if (r.skip) { if (!KEEP_SKIPS.has(r.skip)) { hide(); grader.forget(); } return; }   // hidden: the same text checks again
    const a = r.assessment;
    if (!a || !a.isTask || !PROMPT_KINDS.includes(a.kind)) { hide(); return; }
    const g = a.grade === 'clear' || a.grade === 'needs-detail' ? a.grade : null;
    if (proposedKind === null) proposedKind = a.kind;
    openDecisions = Array.isArray(a.openDecisions) ? a.openDecisions.filter((d) => typeof d === 'string') : [];
    // A regrade that leaves Needs detail closes a busy or ready rewrite (a used one keeps its Undo).
    if (view && g !== 'needs-detail' && (view.state() === 'busy' || view.state() === 'ready')) view.close();
    paint(a.kind, g);
    show();
    syncImprove();
    const key = `${a.kind}|${g || ''}`;
    if (key !== lastSaid && !silent) say(sayOf(a.kind, g));
    lastSaid = key;
    // The run card's proposed perspectives (flag proposedPerspectives): once per accepted grade, after the chip.
    if (typeof onAssessment === 'function') { try { onAssessment(a); } catch { /* a proposal never breaks the chip */ } }
  }

  const grader = createPromptGrader({ surface, enabled: () => pref, fetchImpl, timers, onResult, forceTask });

  function post(body) {
    try {
      Promise.resolve(fetchImpl(URL_CORRECTION, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
        .catch(() => { /* a lost correction is never shown and never blocks */ });
    } catch { /* same */ }
  }

  function choose(k) {
    if (k === kind || !pref) return;
    const from = proposedKind ?? kind;
    paint(k, null);
    grader.regrade(k);
    if (k === from) { if (defers()) pending = null; return; }
    const correction = { proposedKind: from, chosenKind: k };
    if (defers()) pending = correction;
    else post({ surface: surface.kind, ...idsOf(ids), ...correction });
  }

  pick.addEventListener('click', () => {
    if (!kind) return;
    toggleMenu({ doc, anchor: pick, label: 'Prompt kind', items: PROMPT_KINDS.map((k) => ({
      label: KIND_LABELS[k], checked: k === kind, onSelect: () => choose(k),
    })) });
  });

  const mount = {
    off() { grader.cancel(); hide(); grader.forget(); },
    /** The setting turned on: the text already in the field is checked, like a mount-time check (never announced). */
    on() {
      if (disposed || !lastInput || !lastInput.text.trim()) return;
      silentNext = true;
      grader.input(lastInput.text, { answering: lastInput.answering });
    },
  };
  mounts.add(mount);

  return {
    el,
    input(text, { answering = false, silent = false } = {}) {
      if (disposed) return;
      const t = String(text ?? '');
      view?.fieldEdited(t);
      lastInput = { text: t, answering };
      if (!t.trim()) { proposedKind = null; pending = null; hide(); grader.forget(); }   // a cleared draft takes its held correction with it
      silentNext = silent;
      grader.input(t, { answering });
    },
    sent(text) {
      if (disposed) return;
      grader.sent(text);
      lastInput = null;
      proposedKind = null;
      hide();
    },
    pendingCorrection() {
      return pending ? { ...pending } : null;
    },
    /** Record the held correction with `id`. `which` (a pendingCorrection() snapshot taken at submit) records that one
     *  instead, and leaves a later pick held for the draft still in the field. */
    async flushCorrection(id = {}, which) {
      const c = which === undefined ? pending : which;
      if (!c) return;
      if (pending && pending.proposedKind === c.proposedKind && pending.chosenKind === c.chosenKind) pending = null;
      post({ surface: surface.kind, ...idsOf(ids), ...idsOf(id), proposedKind: c.proposedKind, chosenKind: c.chosenKind });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pending = null;
      grader.dispose();
      hide();
      view?.dispose();
      mounts.delete(mount);
    },
  };
}

/** Only the ids that are set: a correction carries ids and kinds, never text. */
function idsOf(o) {
  const out = {};
  for (const k of ['threadId', 'cardId', 'runId']) if (typeof o?.[k] === 'string' && o[k]) out[k] = o[k];
  return out;
}

// ui/public/workflows/test-progress.mjs — While the test runs, stopped and done (canvas boards 20, 27, 28;
// plans/workflow-tests-part2-plan.md Task 13, C7, C9, G8, D39). Pure DOM: app.js reads GET …/runs/:run and repaints on
// every workflow-tests-changed frame, so a repaint keeps the focus (data-focus-key) and one live line says what changed.
import { el, btn, startInto, mockNote } from './test-ui.mjs';
import { fmtUsd, fmtUsdFine, parseUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { aboutUsd, fmtDuration } from '../../../src/shared/workflow-tests/compare.mjs';
import { icon } from '../icons.mjs';
import { DISK_IN_USE, diskInUseSub, fmtGb, PHASES, PHASE_SUB, PHASES_TITLE, phasesShownFor, nowText, forMinutes, RUNNING_LEAD, FROM_LEAD,
  SETUP_STOP_REST, SETUP_STOP_HINT, SEE_SETUP_OUTPUT, setupWhere, SETUP_FIX_HINT, SETUP_EDITED_HINT, START_NEW_TEST, SETUP_NO_OUTPUT, EDIT_EXAMPLE, TRY_AGAIN,
  worcaStoppedText, worcaBeforeStoppedText, madeAgainText, BEFORE_NOW_TITLE, BEFORE_NOW_LEAD, beforeNowRest, BEFORE_PHASE, BEFORE_NOW_WHY, PHASES_BEFORE_HINT } from '../../../src/shared/workflow-tests/project-text.mjs';

const DOT = { passed: 'ok', failed: 'no', running: 'run' };
/** A stored detail is one line with no full stop (runner.mjs pauseVerdict, quickCheck); a server refusal may have one. */
const full = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
/** C7: why a test stopped. Drain and budget store no detail: their sentences are fixed. */
const STOPPED = {
  cap: (p) => `Stopped: the cost went over ${fmtUsd(p.capUsd)}.`,   // a limit is exact: only estimates say "about"
  person: () => 'You stopped the test.',
  budget: () => 'Stopped: the spending limit is reached.',
  'quick-check': (p) => `The free quick check did not pass: ${full(p.run.stopDetail || 'a step is not connected')}`,
  restart: () => 'Stopped when Worca restarted.',
  drain: () => 'Stopped: Worca is shutting down.',
  refused: (p) => `Stopped: ${full(p.run.stopDetail || 'a try did not start')}`,
  changed: (p) => p.run.stopDetail || 'Something this test uses changed: start a new test.',   // D27: the C18 sentence
  error: (p) => `Stopped: ${full(p.run.stopDetail || 'something went wrong')}`,
  setup: (p) => full(p.run.stopDetail || 'the setup step failed'),   // D55, board 35 (the box below says more)
  worca: (p) => worcaStoppedText(p.run.stopDetail),   // U-T2: the same try failed in Worca twice; Finish the rest makes it again
  'worca-before': (p) => worcaBeforeStoppedText(p.run.stopDetail, p.done > 0),   // final review M1: before any try; Finish the rest
};
const stoppedText = (p) => (STOPPED[p.run.stopReason] || STOPPED.error)(p);

/** The row's dots in words. Once the test is over, a try that never finished is "not tried" (board 27). */
function dotsLabel(dots, over) {
  const n = (...s) => dots.filter((d) => s.includes(d)).length;
  const parts = [];
  if (n('passed')) parts.push(`${n('passed')} passed`);
  if (n('failed')) parts.push(`${n('failed')} not passed`);
  if (!over && n('running')) parts.push(`${n('running')} trying`);
  const left = over ? n('waiting', 'running', 'stopped') : 0;
  if (!parts.length) return over ? 'Not tried' : 'Waiting';
  if (left) parts.push(`${left} not tried`);
  return parts.join(', ');
}
function fact(doc, label, value, sub = null, cls = '') {
  const f = el(doc, 'div', `wft-fact${cls ? ` ${cls}` : ''}`);
  f.append(el(doc, 'span', '', label), el(doc, 'b', '', value));
  if (sub) f.append(el(doc, 'span', '', sub));
  return f;
}
/** root → { runId, key } of the Stop testing / Finish the rest whose action is still out. */
const BUSY = new WeakMap();
/** root → the last paint's arguments: a stop that answers while the test still runs repaints from the latest data. */
const LAST = new WeakMap();
const STOP_KEY = 'wft-pg-stop';
/** U-T8 (F19): the pill and the Stop button from the click until the server says stopped. */
const STOPPING = 'Stopping…';
/** root → the run id whose setup output is open: a repaint keeps it open. */
const LOG_OPEN = new WeakMap();
/** root → the timer that repaints "for N minutes" once a minute while a try is working (a frame repaints sooner). */
const TICK = new WeakMap();
const TICK_MS = 60000;
const keyed = (root, key) => [...root.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key) || null;

/** Board 35's Now column: a running project try's phase and what it is doing; any other row its Part 2 summary. Only a
 *  project example has `now` (service.progressOf), so a no-project try never reads "Preparing a copy of the project". */
function nowCell(doc, r, tried, over) {
  if (!r.now || over) return el(doc, 'span', tried ? '' : 'wft-prow-quiet', r.summary);
  const cell = el(doc, 'span', 'wft-now');
  const sub = el(doc, 'span', 's');
  if (r.now.phase === 'checking' && r.now.checking) sub.append(doc.createTextNode(RUNNING_LEAD), el(doc, 'span', 'code', r.now.checking));
  else if (r.now.phase === 'setup' && r.now.setupCmd) sub.append(el(doc, 'span', 'code', r.now.setupCmd));
  else if (r.now.phase === 'working' && r.now.startedMs) sub.textContent = forMinutes(Date.now() - r.now.startedMs);
  cell.append(el(doc, 'span', '', nowText(r.now)));
  if (sub.childNodes.length) cell.append(sub);
  return cell;
}

/** Board 35: why the test stopped when the setup failed (D55), its output on request, and where it ran. Grey, as the
 *  Stopped pill: nothing the workflow did failed. */
function setupStopCard(doc, root, runId, ss, costUsd) {
  const card = el(doc, 'section', 'card wft-setup-stop');
  card.setAttribute('aria-label', 'Why the test stopped');
  const box = el(doc, 'p', 'wft-stopbox');   // no role="alert": the page's polite live line says it once
  const b = el(doc, 'b');
  b.append(doc.createTextNode('The setup step failed: '), el(doc, 'span', 'code', ss.cmd), doc.createTextNode(' ended with an error.'));
  const words = el(doc, 'span');
  words.append(b, doc.createTextNode(SETUP_STOP_REST));
  box.append(icon(doc, 'stop', 16), words);
  const hint = el(doc, 'p', 'hint wft-setup-hint', SETUP_STOP_HINT);
  hint.append(el(doc, 'span', 'code', fmtUsdFine(costUsd)), doc.createTextNode('.'));
  const log = el(doc, 'pre', 'wft-outlog', ss.tail || SETUP_NO_OUTPUT);
  log.id = 'wft-pg-setup-log';
  log.hidden = LOG_OPEN.get(root) !== runId;
  const see = btn(doc, SEE_SETUP_OUTPUT, () => {
    log.hidden = !log.hidden;
    see.setAttribute('aria-expanded', log.hidden ? 'false' : 'true');
    if (log.hidden) LOG_OPEN.delete(root); else LOG_OPEN.set(root, runId);
  }, 'wft-linkbtn wft-setup-see');
  see.setAttribute('aria-expanded', log.hidden ? 'false' : 'true');
  see.setAttribute('aria-controls', log.id);
  see.dataset.focusKey = 'wft-pg-setup-see';
  const line = el(doc, 'div', 'wft-setup-line');
  line.append(see, el(doc, 'span', 'hint wft-setup-where', setupWhere(ss.exampleName, ss.label, ss.tryNo)));
  card.append(box, hint, line, log, el(doc, 'p', 'hint wft-setup-fix', ss.edited ? SETUP_EDITED_HINT : SETUP_FIX_HINT));
  return card;
}

/** Board 35: what one try goes through, for the first try that runs (D55, D61). Setup only when the example has one. Board 42:
 *  before any try (`ph.before`, the before phase runs), the same steps with none current, and the board's hint. */
function phasesCard(doc, ph, dateText) {
  const c = el(doc, 'section', 'card wft-phases');
  const h = el(doc, 'h2', '', PHASES_TITLE);
  h.id = 'wft-pg-phases';
  c.setAttribute('aria-labelledby', h.id);
  const list = el(doc, 'ol', 'wft-ph-list');
  const steps = PHASES.filter(([k]) => k !== 'setup' || ph.setupCmd);
  const at = ph.before ? -1 : Math.max(0, steps.findIndex(([k]) => k === ph.phase));
  steps.forEach(([k, label], i) => {
    const li = el(doc, 'li', `wft-ph${i < at ? ' is-done' : i === at ? ' is-now' : ''}`);
    if (i === at) li.setAttribute('aria-current', 'step');
    const n = el(doc, 'span', 'wft-ph-dot', String(i + 1));
    n.setAttribute('aria-hidden', 'true');
    const words = el(doc, 'span', 'wft-ph-words');
    const sub = el(doc, 'span', 's');
    if (k === 'preparing') {
      const st = ph.start || {};
      sub.append(doc.createTextNode(FROM_LEAD));
      startInto(doc, sub, st, dateText);
    } else if (k === 'setup') sub.append(el(doc, 'span', 'code', ph.setupCmd));
    else sub.textContent = PHASE_SUB[k];
    words.append(el(doc, 'b', '', label), sub);
    if (i < at) words.append(el(doc, 'span', 'sr-only', ', done'));
    li.append(n, words);
    list.append(li);
  });
  c.append(h, list, el(doc, 'p', 'hint', ph.before ? PHASES_BEFORE_HINT : phasesShownFor(ph.exampleName, ph.label, ph.tryNo)));
  return c;
}

/** U3 (board 42, D75): the before phase: which command runs on which start point, what it is doing now, and why. */
function beforeNowCard(doc, b) {
  const c = el(doc, 'section', 'card wft-before-now');
  c.setAttribute('aria-live', 'polite');
  const h = el(doc, 'h2', '', BEFORE_NOW_TITLE);
  h.id = 'wft-pg-before';
  c.setAttribute('aria-labelledby', h.id);
  const now = el(doc, 'div', 'wft-bnow');
  const dot = el(doc, 'span', 'wft-bnow-dot');
  dot.setAttribute('aria-hidden', 'true');
  const words = el(doc, 'span', 'wft-bnow-words');
  const line = el(doc, 'span', 'wft-before-now-line');
  line.append(doc.createTextNode(BEFORE_NOW_LEAD), el(doc, 'span', 'code', b.cmd), doc.createTextNode(beforeNowRest(b)));
  words.append(line, el(doc, 'span', 'hint wft-before-now-phase', BEFORE_PHASE[b.phase] || BEFORE_PHASE.command));
  now.append(dot, words);
  c.append(h, now, el(doc, 'p', 'hint wft-before-now-why', BEFORE_NOW_WHY));
  return c;
}

/**
 * @param {HTMLElement} root
 * @param {object} p GET /api/workflows/:id/tests/runs/:run (service.progressOf)
 * @param {{back:Function, stop:Function, continue:(capUsd:number|null)=>void, open:Function, editExample?:(exampleId:number)=>void}} actions
 * @param {{doc: Document, dateText?: (iso: string) => string}} ctx
 */
export function renderTestProgress(root, p, actions, { doc, dateText = (s) => s, mock = false }) {
  clearTimeout(TICK.get(root));
  TICK.delete(root);
  LAST.set(root, { p, actions, ctx: { doc, dateText, mock } });
  // What the repaint takes away: the focused control (by its key), a cost limit typed for this test, the live line.
  const active = doc.activeElement;
  const hadFocus = !!active && active !== root && root.contains(active);
  const focusKey = hadFocus && active.dataset ? active.dataset.focusKey || null : null;
  const page0 = root.querySelector('.wft-progress');
  const oldCap = root.querySelector('#wft-pg-cap');
  const keepCap = page0 && page0.dataset.runId === String(p.run.id) && oldCap && oldCap.value !== oldCap.defaultValue ? oldCap.value : null;
  const live = root.querySelector('.wft-pg-live') || el(doc, 'p', 'sr-only wft-pg-live');
  live.setAttribute('aria-live', 'polite');
  root.replaceChildren();

  const page = el(doc, 'div', 'wft-page wft-progress');
  page.dataset.runId = String(p.run.id);
  const st = p.run.status;
  const over = st !== 'running';
  const count = `${p.done} of ${p.total} ${p.total === 1 ? 'try' : 'tries'} done`;
  // U-T8 (F19): stopping while this page's stop is out (optimistic) or while the server says so (p.stopping).
  const held0 = BUSY.get(root);
  const stopping = st === 'running' && (p.stopping === true || (!!held0 && held0.runId === p.run.id && held0.key === STOP_KEY));
  // D39: board 20's status pill in every state, its dot still once the test is over (green done, grey stopped).
  const pill = el(doc, 'span', st === 'running' ? 'pill-run peach wft-pill' : st === 'done' ? 'pill-run green wft-pill is-parked' : 'pill-run wft-pill is-stopped is-parked');
  const pillText = stopping ? STOPPING : `${st === 'running' ? 'Running' : st === 'done' ? 'Done' : 'Stopped'} · ${count}`;
  const pdot = el(doc, 'span', 'pdot');
  pdot.setAttribute('aria-hidden', 'true');
  pill.append(pdot, doc.createTextNode(pillText));
  const head = el(doc, 'div', 'wft-crumbs wft-pg-head');
  const left = el(doc, 'div', 'wft-pg-titles');
  const crumb = btn(doc, 'Tests', () => actions.back(), 'wft-crumb');
  crumb.dataset.focusKey = 'wft-pg-back';
  left.append(crumb, el(doc, 'h2', 'wft-title', p.title), pill);
  const acts = el(doc, 'div', 'wft-acts');
  /** A button that is disabled while its action is out, so a second click sends nothing. The busy state lives on the
   *  root (BUSY), not the button: a frame that repaints the page meanwhile paints the new button busy too. U-T8 (F19):
   *  Stop testing reads "Stopping…" at once (pill too), and when its answer comes with the page still running (the stop
   *  failed), the page repaints from its latest data instead of keeping the click's words. */
  const act = (label, fn, cls, key) => {
    const b = btn(doc, label, null, cls);
    b.dataset.focusKey = key;
    const held = BUSY.get(root);
    if (held && held.runId === p.run.id && held.key === key) b.disabled = true;
    b.addEventListener('click', () => {
      if (b.disabled) return;
      b.disabled = true;
      const mine = { runId: p.run.id, key };
      BUSY.set(root, mine);
      if (key === STOP_KEY) {
        b.textContent = STOPPING;
        pill.lastChild.textContent = STOPPING;
        live.textContent = STOPPING;
      }
      let out;
      try { out = fn(); } catch { out = null; }
      Promise.resolve(out).catch(() => {}).finally(() => {
        if (BUSY.get(root) !== mine) return;
        BUSY.delete(root);
        const now = keyed(root, key);   // this button, or the one a repaint put in its place
        const last = LAST.get(root);
        if (now && key === STOP_KEY && last && last.p.run.id === mine.runId) {
          renderTestProgress(root, last.p, last.actions, last.ctx);
          return;
        }
        if (now) now.disabled = false;
      });
    });
    return b;
  };
  if (st === 'running') {
    const stop = act(stopping ? STOPPING : 'Stop testing', () => actions.stop(), 'btn btn-danger', STOP_KEY);
    if (p.stopping === true) stop.disabled = true;   // the server is stopping it: nothing to send again
    acts.append(stop);
  } else if (st === 'done') acts.append(act(p.run.kind === 'once' ? 'See the result' : 'See the comparison', () => actions.open(), 'btn btn-primary', 'wft-pg-open'));
  else if (p.run.stopReason === 'setup') {   // board 35: the setup failed: edit the example or try again; no cost limit to change
    const where = p.project && p.project.setupStop;
    if (where && actions.editExample) acts.append(act(EDIT_EXAMPLE, () => actions.editExample(where.exampleId), 'btn', 'wft-pg-edit'));
    // P36: Try again is Finish the rest, which is refused once an example of the test was edited: then a new test instead.
    if (where && where.edited && actions.startNew) acts.append(act(START_NEW_TEST, () => actions.startNew(), 'btn btn-primary', 'wft-pg-new'));
    else acts.append(act(TRY_AGAIN, () => actions.continue(null), 'btn btn-primary', 'wft-pg-finish'));   // Finish the rest (it checks the disk again)
  } else if (p.run.stopReason === 'changed') {   // N5: after a change, Finish the rest would only be refused
    if (actions.startNew) acts.append(act(START_NEW_TEST, () => actions.startNew(), 'btn btn-primary', 'wft-pg-new'));   // U-T8 (F17)
  } else {
    let capInput = null;
    // Board 27: the start dialog's cost limit beside Finish the rest, raised when the cap stopped it. Try it once now
    // has no limit to change.
    if (p.run.stopReason === 'cap' || p.run.kind !== 'once') {
      capInput = el(doc, 'input', 'wft-cap');
      capInput.type = 'text'; capInput.inputMode = 'decimal'; capInput.id = 'wft-pg-cap';
      capInput.dataset.focusKey = 'wft-pg-cap';
      const suggested = p.run.stopReason === 'cap' ? `$${Math.ceil(Math.max((p.capUsd || 0) * 1.5, p.costUsd + 5) / 5) * 5}`
        : p.capUsd == null ? '' : Number.isInteger(p.capUsd) ? `$${p.capUsd}` : fmtUsd(p.capUsd);
      capInput.defaultValue = suggested;
      capInput.value = keepCap ?? suggested;
      const lab = el(doc, 'label', 'wft-cap-label', 'Stop if the cost goes over');
      lab.htmlFor = capInput.id;
      acts.append(lab, capInput);
    }
    /** I2: "15,50" is $15.50. Not a cost → NaN, which the action refuses; an empty box keeps a test that had no limit. */
    const capOf = () => {
      const v = parseUsd(capInput.value);
      if (v === null && p.capUsd == null) return null;
      return v > 0 ? v : Number.NaN;
    };
    acts.append(act('Finish the rest', () => actions.continue(capInput ? capOf() : null), 'btn btn-primary', 'wft-pg-finish'));
  }
  head.append(left, acts);
  page.append(head);
  if (mock) page.append(mockNote(doc));   // F52

  const prog = el(doc, 'section', 'card wft-prog');
  prog.setAttribute('aria-label', 'Progress');
  const bar = el(doc, 'div', `wft-bar${st === 'done' ? ' is-done' : over ? ' is-stopped' : ''}`);
  for (const [k, v] of Object.entries({ role: 'progressbar', 'aria-label': 'Tries done', 'aria-valuemin': '0', 'aria-valuemax': String(p.total),
    'aria-valuenow': String(p.done), 'aria-valuetext': count })) bar.setAttribute(k, v);
  const fill = el(doc, 'span');
  fill.style.width = `${p.total ? Math.round((p.done / p.total) * 100) : 0}%`;
  bar.append(fill);
  const costSub = [p.estimateUsd != null ? `of about ${aboutUsd(p.estimateUsd)}` : null, p.capUsd != null ? `stops at ${fmtUsd(p.capUsd)}` : null].filter(Boolean).join(' · ');
  // Board 28's one-try panel: Try it once now has no estimate or limit to weigh the cost against, only the cost.
  const costLine = p.run.kind === 'once' ? null : costSub || null;
  const q = p.quick;
  const word = 'wft-fact-word';   // a word in the stat face's place: the sans face (board 20)
  const quickFact = !q ? fact(doc, 'Free quick check', 'Off', null, word)
    : q.status === 'passed' ? fact(doc, 'Free quick check', 'Passed', 'every step is connected', `${word} is-ok`)
      : q.status === 'failed' ? fact(doc, 'Free quick check', 'Not passed', q.detail || null, `${word} is-bad`)
        : fact(doc, 'Free quick check', over ? 'Not done' : 'Checking…', null, word);
  // Board 35 (P15): a running test with a project example says the disk its copies use (once it is over, they are gone).
  const dk = st === 'running' && p.project ? p.project.disk : null;
  const inUse = dk && dk.inUseBytes != null ? (dk.inUseBytes < 0.05 * 2 ** 30 ? '0 GB' : fmtGb(dk.inUseBytes)) : null;   // fmtGb never says less than 0.1
  const diskFact = inUse ? fact(doc, DISK_IN_USE, inUse, dk.needBytes != null && dk.freeBytes != null ? diskInUseSub(dk.needBytes, dk.freeBytes) : null) : null;
  const facts = el(doc, 'div', `wft-facts${diskFact ? ' is-four' : ''}`);
  // Boards 27/28: once it is over, how long it took (service.takenMs). U-T8 (F29): seconds under a minute ("3 s").
  const timeFact = over
    ? fact(doc, 'Time taken', Number.isFinite(p.takenMs) ? fmtDuration(p.takenMs) : 'not known')
    : fact(doc, 'Time left', p.minutesLeft ? `about ${p.minutesLeft} min` : 'not known yet');
  facts.append(timeFact, fact(doc, over ? 'Cost' : 'Cost so far', fmtUsdFine(p.costUsd), costLine), ...(diskFact ? [diskFact] : []), quickFact);   // board 35's order
  prog.append(bar, facts);
  let stopped = null;
  let setupCard = null;
  if (st === 'running') {
    prog.append(el(doc, 'p', 'hint', `You can close this page or keep working. Worca tells you when the results are ready.${p.run.tries > 1
      ? ` Results so far are not final: wait for all ${p.run.tries} tries of an example.` : ''}`));
  } else if (st === 'stopped') {
    stopped = stoppedText(p);
    const ss = p.run.stopReason === 'setup' && p.project ? p.project.setupStop : null;
    if (ss) setupCard = setupStopCard(doc, root, p.run.id, ss, p.costUsd);   // board 35: its own card, under the title
    else prog.append(el(doc, 'p', 'wft-stopped', stopped));
  }
  if (setupCard) page.append(setupCard);
  page.append(prog);
  if (st === 'running' && p.before) page.append(beforeNowCard(doc, p.before));   // U3: the run before the change, before any try
  if (st === 'running' && p.project && p.project.phases) page.append(phasesCard(doc, p.project.phases, dateText));   // P15

  const table = el(doc, 'section', 'card wft-table');
  table.setAttribute('aria-label', 'Tries per example');
  const headRow = el(doc, 'div', 'wft-prow is-head');
  const nowCol = !over && p.rows.some((r) => r.now);   // board 35: what each project try is doing now
  headRow.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', 'Tries'), el(doc, 'span', '', st === 'done' ? 'Result' : nowCol ? 'Now' : 'So far'));
  table.append(headRow);
  for (const r of p.rows) {
    const row = el(doc, 'div', 'wft-prow');
    const dots = el(doc, 'span', 'wft-tries');
    dots.setAttribute('role', 'img');
    dots.setAttribute('aria-label', dotsLabel(r.dots, over));
    for (const d of r.dots) dots.append(el(doc, 'span', DOT[d] && !(over && d === 'running') ? `wft-try-dot ${DOT[d]}` : 'wft-try-dot'));   // a round mark: `-dot`
    const name = el(doc, 'span', 'wft-prow-name', r.name);
    if (r.label) name.append(el(doc, 'span', 'wft-prow-use', ` · ${r.label}`));
    const tried = r.dots.some((d) => d === 'passed' || d === 'failed' || d === 'running');
    row.append(name, dots, nowCell(doc, r, tried, over));
    table.append(row);
  }
  page.append(table);
  // Not after a setup stop (final review): no try was done, and the setup card says what to do. U-T2: the tries made again
  // after a problem in Worca, in the same hint (its own once the test is done).
  const hints = [];
  // U-T8 (F24): one try has no rest to finish.
  // Final review UI 2: nor after a change, where only Start a new test is offered (Finish the rest would be refused).
  if (st !== 'done' && p.run.stopReason !== 'setup' && p.run.stopReason !== 'changed' && p.run.kind !== 'once') hints.push('Stop testing keeps the tries that are done. You can finish the rest later without paying for them twice.');
  if (p.madeAgain > 0) hints.push(madeAgainText(p.madeAgain));
  if (hints.length) page.append(el(doc, 'p', 'hint', hints.join(' ')));
  root.append(page, live);
  const said = stopped ? `${pillText}. ${stopped}` : pillText;
  if (live.textContent !== said) live.textContent = said;   // only a change is news

  // "for 6 minutes" stays true: while a try is working, repaint this same page once a minute. A newer paint, or another
  // page in its place, ends it.
  if (!over && p.rows.some((r) => r.now && r.now.phase === 'working' && r.now.startedMs)) {
    const t = setTimeout(() => {
      TICK.delete(root);
      if (page.isConnected && root.contains(page)) renderTestProgress(root, p, actions, { doc, dateText, mock });   // final review UI 1: keeps the mock note
    }, TICK_MS);
    if (t && typeof t.unref === 'function') t.unref();   // never keeps a test process alive
    TICK.set(root, t);
  }
  if (hadFocus && !root.contains(doc.activeElement)) {
    const again = focusKey ? keyed(root, focusKey) : null;
    (again && !again.disabled ? again : root).focus({ preventScroll: true });   // never <body>, where the canvas keys answer
  }
}

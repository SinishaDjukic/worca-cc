// ui/public/workflows/test-progress.mjs — While the test runs, stopped and done (canvas boards 20, 27, 28;
// plans/workflow-tests-part2-plan.md Task 13, C7, C9, G8, D39). Pure DOM: app.js reads GET …/runs/:run and repaints on
// every workflow-tests-changed frame, so a repaint keeps the focus (data-focus-key) and one live line says what changed.
import { el, btn } from './test-ui.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { aboutUsd } from '../../../src/shared/workflow-tests/compare.mjs';

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
const keyed = (root, key) => [...root.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key) || null;

/**
 * @param {HTMLElement} root
 * @param {object} p GET /api/workflows/:id/tests/runs/:run (service.progressOf)
 * @param {{back:Function, stop:Function, continue:(capUsd:number|null)=>void, open:Function}} actions
 */
export function renderTestProgress(root, p, actions, { doc }) {
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
  // D39: board 20's status pill in every state, its dot still once the test is over (green done, grey stopped).
  const pill = el(doc, 'span', st === 'running' ? 'pill-run peach wft-pill' : st === 'done' ? 'pill-run green wft-pill is-parked' : 'pill-run wft-pill is-stopped is-parked');
  const pillText = `${st === 'running' ? 'Testing' : st === 'done' ? 'Done' : 'Stopped'} · ${count}`;
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
   *  root (BUSY), not the button: a frame that repaints the page meanwhile paints the new button busy too. */
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
      let out;
      try { out = fn(); } catch { out = null; }
      Promise.resolve(out).catch(() => {}).finally(() => {
        if (BUSY.get(root) !== mine) return;
        BUSY.delete(root);
        const now = keyed(root, key);   // this button, or the one a repaint put in its place
        if (now) now.disabled = false;
      });
    });
    return b;
  };
  if (st === 'running') acts.append(act('Stop testing', () => actions.stop(), 'btn btn-danger', 'wft-pg-stop'));
  else if (st === 'done') acts.append(act(p.run.kind === 'once' ? 'See the result' : 'See what changed', () => actions.open(), 'btn btn-primary', 'wft-pg-open'));
  else if (p.run.stopReason !== 'changed') {   // N5: after a change, Finish the rest would only be refused
    let capInput = null;
    if (p.run.stopReason === 'cap') {
      capInput = el(doc, 'input', 'wft-cap');
      capInput.type = 'text'; capInput.inputMode = 'decimal'; capInput.id = 'wft-pg-cap';
      capInput.dataset.focusKey = 'wft-pg-cap';
      const suggested = `$${Math.ceil(Math.max((p.capUsd || 0) * 1.5, p.costUsd + 5) / 5) * 5}`;
      capInput.defaultValue = suggested;
      capInput.value = keepCap ?? suggested;
      const lab = el(doc, 'label', 'wft-cap-label', 'Stop if the cost goes over');
      lab.htmlFor = capInput.id;
      acts.append(lab, capInput);
    }
    acts.append(act('Finish the rest', () => actions.continue(capInput ? Number(capInput.value.replace(/[^0-9.]/g, '')) || null : null),
      'btn btn-primary', 'wft-pg-finish'));
  }
  head.append(left, acts);
  page.append(head);

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
  const facts = el(doc, 'div', 'wft-facts');
  // Boards 27/28: once it is over, how long it took (service.takenMs), in the time left's minutes ("35 min").
  const timeFact = over
    ? fact(doc, 'Time taken', Number.isFinite(p.takenMs) ? `${Math.max(1, Math.round(p.takenMs / 60000))} min` : 'not known')
    : fact(doc, 'Time left', p.minutesLeft ? `about ${p.minutesLeft} min` : 'not known yet');
  facts.append(timeFact,
    fact(doc, 'Cost so far', fmtUsd(p.costUsd), costLine), quickFact);
  prog.append(bar, facts);
  let stopped = null;
  if (st === 'running') {
    prog.append(el(doc, 'p', 'hint', `You can close this page or keep working. Worca tells you when the results are ready.${p.run.tries > 1
      ? ` Results so far are not final: wait for all ${p.run.tries} tries of an example.` : ''}`));
  } else if (st === 'stopped') {
    stopped = stoppedText(p);
    prog.append(el(doc, 'p', 'wft-stopped', stopped));
  }
  page.append(prog);

  const table = el(doc, 'section', 'card wft-table');
  table.setAttribute('aria-label', 'Tries per example');
  const headRow = el(doc, 'div', 'wft-prow is-head');
  headRow.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', 'Tries'), el(doc, 'span', '', st === 'done' ? 'Result' : 'So far'));
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
    row.append(name, dots, el(doc, 'span', tried ? '' : 'wft-prow-quiet', r.summary));
    table.append(row);
  }
  page.append(table);
  if (st !== 'done') page.append(el(doc, 'p', 'hint', 'Stop testing keeps the tries that are done. You can finish the rest later without paying for them twice.'));
  root.append(page, live);
  const said = stopped ? `${pillText}. ${stopped}` : pillText;
  if (live.textContent !== said) live.textContent = said;   // only a change is news

  if (hadFocus && !root.contains(doc.activeElement)) {
    const again = focusKey ? keyed(root, focusKey) : null;
    (again && !again.disabled ? again : root).focus({ preventScroll: true });   // never <body>, where the canvas keys answer
  }
}

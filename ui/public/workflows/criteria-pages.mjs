// ui/public/workflows/criteria-pages.mjs — Part 4's pages (plans/workflow-tests-part4-plan.md Tasks 21–23): Compare by criterion
// (board 12) and its tabs and line in Compare (board 5); Check the checker (board 11) and How reliable is Worca's checking (board 13)
// follow. Pure DOM, text only.
import { el, btn } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { TRUST_BADGE, trustLine, checkingSentence, BY_EXAMPLE, BY_CRITERION, SEE_BY_CRITERION, NOT_CHECKED, CRITERIA_CHANGED_TEXT, CHECK_THEM, NOT_EVERY_TRY,
  CHECKING_CRITERIA_TEXT, CHECKED_CRITERIA_TEXT, CAP_CHECKS_TEXT, ADDED_AFTER_TEXT, NO_CHECKED_TRY, notEveryTryText, unreliableOnlyText, unreliableWhyText }
  from '../../../src/shared/workflow-tests/criteria-text.mjs';

const LEGEND = [
  ['reliable', 'Worca agrees with people almost every time and catches the mistakes planted on purpose.'],
  ['confirm', 'New criterion. It counts, but you have not confirmed that Worca judges it right.'],
  ['unreliable', 'After at least 10 answers, Worca often judges differently from people. It still runs and is shown, but does not decide better or worse until you fix it.'],
];
const FOOT = 'Rows with a coloured background changed between the versions. If a change shows only in unreliable criteria, Compare says so instead of calling it better or worse.';
const CHECKING = "Worca's checking";
const nOf = (x) => (x && x.of ? `${x.met} of ${x.of}` : '—');
/** Board 12's line under the badge: the column already says whose checking, so a reliable one reads "Agrees with people …". */
const rowLine = (t) => (t && t.state === 'reliable' ? `Agrees with people ${t.agree} of ${t.n} times` : trustLine(t));
const badgeOf = (doc, state) => { const [cls, words] = TRUST_BADGE[state] || TRUST_BADGE.collecting; return el(doc, 'span', cls, words); };

function trustCell(doc, r) {
  const c = el(doc, 'span', 'wft-bc-trust');
  c.append(badgeOf(doc, r.trust ? r.trust.state : 'collecting'));
  if (r.exact) c.append(el(doc, 'span', 'wft-exact', 'Can be checked exactly'));
  // P4-M5: a criterion not checked on every try decides nothing yet; one added after the test says so instead.
  if (r.uneven) c.append(el(doc, 'small', '', r.reason === 'new' ? ADDED_AFTER_TEXT : NOT_EVERY_TRY));
  else if (!r.exact && r.trust && r.trust.state !== 'confirm') c.append(el(doc, 'small', '', rowLine(r.trust)));
  return c;
}
/** A side's count; P4-M5: "—" when the side has no checked try, "Not checked yet" for a criterion added after the test. */
function countCell(doc, r, x, cls) {
  if (r.uneven && r.reason === 'new') return el(doc, 'span', `${cls} is-none`, NOT_CHECKED.pending);
  if (x && x.of) return el(doc, 'span', cls, nOf(x));
  const n = el(doc, 'span', `${cls} is-none`, '—');
  n.setAttribute('role', 'img');
  n.setAttribute('aria-label', NO_CHECKED_TRY);
  return n;
}

/** Board 12. `data` = GET …/runs/:run/criteria; `labels` = { a, b } (a is null for Try it once). */
export function renderByCriterion(root, data, { doc, labels, onTrust = null }) {
  root.replaceChildren();
  const one = !labels.a;
  const legend = el(doc, 'section', 'card wft-bc-legend');
  const lh = el(doc, 'h2', '', "Can you trust Worca's checking of each criterion?");
  lh.id = 'wft-bc-legend-h';
  legend.setAttribute('aria-labelledby', lh.id);
  const grid = el(doc, 'div', 'wft-bc-legend-grid');
  for (const [state, words] of LEGEND) { const d = el(doc, 'div'); d.append(badgeOf(doc, state), el(doc, 'span', '', words)); grid.append(d); }
  legend.append(lh, grid);
  const table = el(doc, 'section', 'card wft-table wft-bc');
  table.setAttribute('aria-label', 'Results per criterion');
  const scroll = el(doc, 'div', 'wft-scroll');
  const inner = el(doc, 'div', `wft-bc-rows${one ? ' is-one' : ''}`);
  const head = el(doc, 'div', 'wft-bc-row is-head');
  head.append(el(doc, 'span', '', 'Criterion'), ...(one ? [] : [el(doc, 'span', '', `${labels.a} met`)]), el(doc, 'span', '', `${labels.b} met`), el(doc, 'span', '', CHECKING));
  inner.append(head);
  for (const r of data.rows) {
    const row = el(doc, 'div', `wft-bc-row${r.changed ? ` is-${r.changed}` : ''}`);
    const name = el(doc, 'span', 'wft-bc-name');
    name.append(el(doc, 'b', '', r.label), el(doc, 'span', 'wft-bc-ex', r.exampleName));
    row.append(name, ...(one ? [] : [countCell(doc, r, r.a, 'wft-bc-n')]), countCell(doc, r, r.b, 'wft-bc-n is-b'), trustCell(doc, r));
    inner.append(row);
  }
  if (data.more) {   // the collapsed rows are all reliable (criteria-report.mjs byCriterionModel)
    const row = el(doc, 'div', 'wft-bc-row is-more');
    const tc = el(doc, 'span', 'wft-bc-trust');
    tc.append(badgeOf(doc, 'reliable'));
    row.append(el(doc, 'span', 'wft-bc-more', `${data.more} more ${data.more === 1 ? 'criterion' : 'criteria'}, all met in every try by both versions`),
      ...(one ? [] : [el(doc, 'span')]), el(doc, 'span'), tc);
    inner.append(row);
  }
  scroll.append(inner);
  table.append(scroll);
  const foot = el(doc, 'p', 'hint wft-bc-foot', FOOT);
  if (onTrust) { const a = btn(doc, 'How Worca tests its own checking', () => onTrust(), 'wft-linkbtn'); foot.append(doc.createTextNode(' '), a); }
  root.append(legend, table, foot);
}

/** root → the test whose Compare shows By criterion: a repaint (a frame, a poll) keeps the tab. */
const BY_CRIT = new WeakMap();

/**
 * Board 5 (Task 21): the "By example · By criterion" tabs over Compare's table, the box board 12 paints into, and the line
 * "Worca's checking … See by criterion" for the changes card. `criteria` = GET …/runs/:run/criteria. Call `done(hide)` once the page
 * is built: `hide` are the parts board 12 leaves out (the tiles, In short, the changes card), so By criterion takes the page.
 */
export function compareCriteriaParts(doc, { root, runId, criteria, labels, table, onTrust = null }) {
  const tabs = el(doc, 'div', 'seg wft-by-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Show results');
  const tab = (label, on, id) => {
    const t = btn(doc, label, () => show(on), '');
    t.setAttribute('role', 'tab');
    t.id = id;
    t.dataset.focusKey = id;   // test-compare.mjs giveFocusBack: a repaint keeps the focus on the tab
    t.addEventListener('keydown', (e) => {   // two tabs: either arrow, Home or End moves to the other one
      const to = e.key === 'Home' ? false : e.key === 'End' ? true : e.key === 'ArrowRight' || e.key === 'ArrowLeft' ? !crit : null;
      if (to === null) return;
      e.preventDefault();
      show(to);
      (to ? cr : ex).focus();
    });
    return t;
  };
  const box = el(doc, 'div', 'wft-by-crit');
  let hide = [];
  let crit = false;
  const show = (on) => {
    crit = on;
    if (on) BY_CRIT.set(root, runId); else BY_CRIT.delete(root);
    for (const [t, sel] of [[ex, !on], [cr, on]]) { t.classList.toggle('on', sel); t.setAttribute('aria-selected', sel ? 'true' : 'false'); t.tabIndex = sel ? 0 : -1; }
    table.hidden = on;
    box.hidden = !on;
    for (const n of hide) n.hidden = on;
    if (on) renderByCriterion(box, criteria, { doc, labels, onTrust });
    else box.replaceChildren();
  };
  const ex = tab(BY_EXAMPLE, false, 'wft-by-ex');
  const cr = tab(BY_CRITERION, true, 'wft-by-cr');
  tabs.append(ex, cr);
  for (const [t, panel, pid] of [[ex, table, 'wft-by-ex-panel'], [cr, box, 'wft-by-cr-panel']]) {
    panel.id = pid;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', t.id);
    t.setAttribute('aria-controls', pid);
  }
  const line = el(doc, 'p', 'hint wft-check-line');
  line.append(el(doc, 'b', '', CHECKING), doc.createTextNode(`${checkingSentence(criteria.counts).slice(CHECKING.length)} `),
    btn(doc, SEE_BY_CRITERION, () => { show(true); cr.focus(); }, 'wft-linkbtn'));
  return { tabs, box, line, done: (h) => { hide = h.filter(Boolean); show(BY_CRIT.get(root) === runId); } };
}

/** root → { runId, was, done }: whether "Check them on these tries" was running at the last paint, and has ended since. */
const CHECKED = new WeakMap();

/**
 * P4-M5: Compare's criteria lines. `c` = the compare read with its criteria; `act(label, fn, cls, key, opts)` = test-compare.mjs's
 * button (busy across repaints). Returns the band above In short (checking, checked, at the cost limit, or criteria changed after the
 * test with the price of checking them), the fair-comparison line for criteria not checked on every try, In short's sentence and
 * each example row's line for a change only in unreliable criteria.
 */
export function compareCriteriaNotes(doc, c, { root, act, testAgain, checkCriteria }) {
  const crit = c.criteria || null;
  const notes = c.notes || {};
  const checking = !!(crit && crit.checking);
  const was = CHECKED.get(root);
  const mine = was && was.runId === c.run.id ? was : { runId: c.run.id, was: false, done: false };
  if (mine.was && !checking) mine.done = true;
  mine.was = checking;
  CHECKED.set(root, mine);
  const notChecked = Array.isArray(notes.notChecked) ? notes.notChecked : [];
  const fresh = notChecked.filter((n) => n.reason === 'new');
  const unchecked = notChecked.filter((n) => n.reason !== 'new');
  // The test's own cap (criteria-routes.mjs refuses the check at it): Test again, never a press that is refused.
  const atCap = c.run.capUsd != null && Number(c.costUsd) >= Number(c.run.capUsd);
  const canCheck = !checking && !atCap && typeof checkCriteria === 'function';
  const band = (tone, iconName, words, role = null) => {
    const b = el(doc, 'section', `wft-crit-band is-${tone}`);
    if (role) b.setAttribute('role', role);
    const l = el(doc, 'span', 'wft-crit-band-l');
    l.append(icon(doc, iconName, 15), el(doc, 'span', '', words));
    b.append(l);
    return b;
  };
  let top = null;
  if (checking) top = band('plain', 'spinner', CHECKING_CRITERIA_TEXT, 'status');
  else if (notChecked.length && atCap) {
    top = band('amber', 'alert', CAP_CHECKS_TEXT);
    top.setAttribute('aria-label', 'Your criteria were not checked');
    top.append(act('Test again', () => testAgain(), 'btn btn-sm', 'wft-crit-again'));
  } else if (fresh.length) {
    top = band('amber', 'alert', CRITERIA_CHANGED_TEXT);
    top.setAttribute('aria-label', 'Your criteria changed');
    if (canCheck) {
      const usd = crit && typeof crit.checkUsd === 'number' && Number.isFinite(crit.checkUsd) ? crit.checkUsd : null;
      const b = act(CHECK_THEM, () => checkCriteria(), 'btn btn-sm', 'wft-crit-check', { busy: true, busyKey: 'wft-crit-check' });
      if (usd === null) b.textContent = `${CHECK_THEM} (cost not known yet)`;   // P4-C6
      else b.replaceChildren(doc.createTextNode(`${CHECK_THEM} (about `), el(doc, 'span', 'code', fmtUsd(usd)), doc.createTextNode(')'));
      top.append(b);
    }
  } else if (mine.done) top = band('ok', 'check', CHECKED_CRITERIA_TEXT, 'status');
  let fair = null;
  if (unchecked.length) {   // also when the limit or the cap left a criterion unchecked on every try (the run can still end done)
    fair = el(doc, 'p', 'wft-fair');
    const words = el(doc, 'span', '', notEveryTryText(unchecked));
    if (canCheck) words.append(doc.createTextNode(' '), act(CHECK_THEM, () => checkCriteria(), 'wft-linkbtn', 'wft-crit-check-line', { busy: true, busyKey: 'wft-crit-check' }));
    fair.append(icon(doc, 'alert', 14), words);
  }
  const only = Array.isArray(notes.unreliableOnly) ? notes.unreliableOnly : [];
  const short = only.length && c.labels.a ? unreliableOnlyText(c.labels.a, c.labels.b, only.map((x) => x.name)) : null;
  const rows = (crit && Array.isArray(crit.rows)) ? crit.rows : [];
  const whyOf = (exampleId) => (only.some((x) => x.id === exampleId)
    ? unreliableWhyText(rows.filter((r) => r.unreliableChange && String(r.key).split('|')[0] === String(exampleId)).map((r) => r.label)) : null);
  return { band: top, fair, short, whyOf, checking };
}

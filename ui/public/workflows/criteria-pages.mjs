// ui/public/workflows/criteria-pages.mjs — Part 4's pages (plans/workflow-tests-part4-plan.md Tasks 21–23): Compare by criterion
// (board 12) and its tabs and line in Compare (board 5); Check the checker (board 11) and How reliable is Worca's checking (board 13)
// follow. Pure DOM, text only.
import { el, btn } from './test-ui.mjs';
import { TRUST_BADGE, trustLine, checkingSentence, BY_EXAMPLE, BY_CRITERION, SEE_BY_CRITERION } from '../../../src/shared/workflow-tests/criteria-text.mjs';

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
  else if (r.trust && r.trust.state !== 'confirm') c.append(el(doc, 'small', '', rowLine(r.trust)));
  return c;
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
    row.append(name, ...(one ? [] : [el(doc, 'span', 'wft-bc-n', nOf(r.a))]), el(doc, 'span', 'wft-bc-n is-b', nOf(r.b)), trustCell(doc, r));
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

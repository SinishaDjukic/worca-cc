// ui/public/workflows/criteria-pages.mjs — Part 4's pages (plans/workflow-tests-part4-plan.md Tasks 21–23): Compare by criterion
// (board 12) and its tabs and line in Compare (board 5); Check the checker (board 11 and P4-M3's states, Task 22); How reliable is
// Worca's checking (board 13 and P4-M4's early states, Task 23). Pure DOM, text only.
import { el, btn } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { plainText } from '../../../src/shared/workflow-tests/plain-text.mjs';
import { TRUST_BADGE, trustLine, checkingRest, BY_EXAMPLE, BY_CRITERION, SEE_BY_CRITERION, NOT_CHECKED, CRITERIA_CHANGED_TEXT, CHECK_THEM, NOT_EVERY_TRY,
  CHECKING_TEXT, STOP_CHECKING, stoppedCheckText, CHECKED_CRITERIA_TEXT, CAP_CHECKS_TEXT, ADDED_AFTER_TEXT, NO_CHECKED_TRY, COST_UNKNOWN_NOTE, notEveryTryText, unreliableOnlyText,
  unreliableWhyText, ROUND_NOT_FINISHED_TEXT, TRUST_TESTS, trustTestLine, trustTestBadge, answersText }
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
/** A button that waits (disabled) while the promise its press returns is out: one request per press. */
function busyBtn(doc, label, fn, cls) {
  const b = btn(doc, label, () => {
    if (b.disabled) return;
    b.disabled = true;
    let out;
    try { out = fn(); } catch { out = null; }
    void Promise.resolve(out).catch(() => {}).finally(() => { b.disabled = false; });
  }, cls);
  return b;
}

/** Board 12's row key `<example>|k:<criterion>` → the criterion Check the checker opens for (null: an exact check's row). */
const criterionOfRow = (r) => { const m = /^(\d+)\|k:(.+)$/.exec(String(r.key || '')); return m ? { exampleId: Number(m[1]), id: m[2] } : null; };

function trustCell(doc, r, onConfirm = null) {
  const c = el(doc, 'span', 'wft-bc-trust');
  const state = r.trust ? r.trust.state : 'collecting';
  // Task 22 (board 12): "Confirm 4 results" is the amber link itself, and an unreliable row's line ends in "Fix it"; both open Check the checker.
  const crit = onConfirm && !r.exact ? criterionOfRow(r) : null;
  const open = crit ? () => onConfirm(crit.exampleId, { id: crit.id, text: r.label, exampleName: r.exampleName }) : null;
  c.append(open && state === 'confirm' ? busyBtn(doc, TRUST_BADGE.confirm[1], open, `${TRUST_BADGE.confirm[0]} wft-confirm`) : badgeOf(doc, state));
  if (r.exact) c.append(el(doc, 'span', 'wft-exact', 'Can be checked exactly'));
  // P4-M5: a criterion not checked on every try decides nothing yet; one added after the test says so instead.
  if (r.uneven) c.append(el(doc, 'small', '', r.reason === 'new' ? ADDED_AFTER_TEXT : NOT_EVERY_TRY));
  else if (!r.exact && r.trust && r.trust.state !== 'confirm') {
    const line = el(doc, 'small', '', rowLine(r.trust));
    if (open && state === 'unreliable') line.append(doc.createTextNode(' '), busyBtn(doc, 'Fix it', open, 'wft-linkbtn wft-fix'));
    c.append(line);
  }
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

/** Board 12. `data` = GET …/runs/:run/criteria; `labels` = { a, b } (a is null for Try it once). `onConfirm(exampleId, criterion)`
 *  opens Check the checker (Task 22; null: no links). */
export function renderByCriterion(root, data, { doc, labels, onTrust = null, onConfirm = null }) {
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
    row.append(name, ...(one ? [] : [countCell(doc, r, r.a, 'wft-bc-n')]), countCell(doc, r, r.b, 'wft-bc-n is-b'), trustCell(doc, r, onConfirm));
    inner.append(row);
  }
  if (data.more) {   // the collapsed rows are all reliable (criteria-report.mjs byCriterionModel)
    const row = el(doc, 'div', 'wft-bc-row is-more');
    const tc = el(doc, 'span', 'wft-bc-trust');
    tc.append(badgeOf(doc, 'reliable'));
    row.append(el(doc, 'span', 'wft-bc-more', `${data.more} more ${data.more === 1 ? 'criterion' : 'criteria'}, all met in every try${one ? '' : ' by both versions'}`),
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
export function compareCriteriaParts(doc, { root, runId, criteria, labels, table, onTrust = null, onConfirm = null }) {
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
    if (on) renderByCriterion(box, criteria, { doc, labels, onTrust, onConfirm });
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
  line.append(el(doc, 'b', '', CHECKING), doc.createTextNode(`${checkingRest(criteria.counts)} `),
    btn(doc, SEE_BY_CRITERION, () => { show(true); cr.focus(); }, 'wft-linkbtn'));
  return { tabs, box, line, done: (h) => { hide = h.filter(Boolean); show(BY_CRIT.get(root) === runId); } };
}

/** root → { runId, was, done }: whether "Check them on these tries" was running at the last paint, and has ended since. */
const CHECKED = new WeakMap();

/**
 * P4-M5: Compare's criteria lines. `c` = the compare read with its criteria; `act(label, fn, cls, key, opts)` = test-compare.mjs's
 * button (busy across repaints). Returns the band above In short (checking, checked, at the cost limit, or criteria changed after the
 * test with the price of checking them), the fair-comparison line for criteria not checked on every try, In short's sentence and
 * each example row's line for a change only in unreliable criteria. Board 59 C: `stopCheck()` = "Stop checking" on the band of a
 * check of these tries (`criteria.stoppable`); `stopped` = { runId, done, of } after a stop of this test's check, its line.
 */
export function compareCriteriaNotes(doc, c, { root, act, testAgain, checkCriteria, stopCheck = null, stopped = null }) {
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
    if (iconName) l.append(icon(doc, iconName, 15));
    l.append(el(doc, 'span', '', words));
    b.append(l);
    return b;
  };
  let top = null;
  const stoppedHere = !!stopped && stopped.runId === c.run.id;
  const counted = stoppedHere && Number.isFinite(stopped.done) && Number.isFinite(stopped.of);   // runner.stop's `checked`, else none
  if (checking) {
    top = band('plain', 'spinner', CHECKING_TEXT, 'status');
    if (crit.stoppable && typeof stopCheck === 'function') top.append(act(STOP_CHECKING, () => stopCheck(), 'btn btn-sm', 'wft-crit-stop', { busy: true }));
  } else if (stoppedHere && counted && canCheck) {   // board 59 C: until a new check or test starts, or the page is left
    top = band('plain', null, stoppedCheckText(stopped.done, stopped.of), 'status');
    // Review M6: it takes the Stop button's focus key, so a keyboard user's focus moves here after the stop, not to the page body.
    top.append(act(CHECK_THEM, () => checkCriteria(), 'btn btn-sm', 'wft-crit-stop', { busy: true, busyKey: 'wft-crit-check' }));
  } else if (notChecked.length && atCap) {
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
  } else if (mine.done && !notChecked.length) top = band('ok', 'check', CHECKED_CRITERIA_TEXT, 'status');   // never beside "not checked on every try"
  let fair = null;
  if (unchecked.length) {   // also when the limit or the cap left a criterion unchecked on every try (the run can still end done)
    fair = el(doc, 'p', 'wft-fair');
    const words = el(doc, 'span', '', notEveryTryText(unchecked));
    if (canCheck) words.append(doc.createTextNode(' '), act(CHECK_THEM, () => checkCriteria(), 'wft-linkbtn', 'wft-crit-check-line', { busy: true, busyKey: 'wft-crit-check' }));
    fair.append(icon(doc, 'alert', 14), words);
  }
  // Round 5 review M6: a stop with no count draws the usual band; it takes the Stop button's focus key (its first button, else the band
  // itself, else the fair line's button), so a keyboard user's focus moves there, never to the page body.
  if (stoppedHere && !checking && !(counted && canCheck)) {
    const to = (top && top.querySelector('button')) || top || (fair && fair.querySelector('button'));
    if (to) {
      to.dataset.focusKey = 'wft-crit-stop';
      if (to === top) top.setAttribute('tabindex', '-1');
    }
  }
  const only = Array.isArray(notes.unreliableOnly) ? notes.unreliableOnly : [];
  const short = only.length && c.labels.a ? unreliableOnlyText(c.labels.a, c.labels.b, only.map((x) => x.name)) : null;
  const rows = (crit && Array.isArray(crit.rows)) ? crit.rows : [];
  const whyOf = (exampleId) => (only.some((x) => x.id === exampleId)
    ? unreliableWhyText(rows.filter((r) => r.unreliableChange && String(r.key).split('|')[0] === String(exampleId)).map((r) => r.label)) : null);
  return { band: top, fair, short, whyOf, checking };
}

// ---- Check the checker (Task 22): board 11 (ready, done) and P4-M3's states; board 58's words for a failed round ----
const CC_SUB = 'Before Worca uses your new criterion, make sure it judges results the way you would. Worca took a good result and broke it on purpose in a few ways.';
const AUTO = [['same', 'Gives the same verdict when asked 3 times'], ['padding', 'Adding filler text does not change the verdict'],
  ['proof', 'Quotes the part of the result each verdict is based on, and the quote is really there']];
const CC_CARDS = 4;   // a round's cards: the good result and three broken on purpose (checker.mjs)
const CC_LEAVE = 'You can leave this page. Worca keeps going and shows the results here.';

/** A card's head: how Worca broke it on purpose, or where the result came from and its version and date ("From a real result · v4, 14 Oct"). */
function ccHead(v, c, dateText) {
  if (c.planted) return `Broken on purpose: ${c.planted}`;
  const s = v.source || {};
  const when = [s.useLabel, s.at ? dateText(s.at) : null].filter(Boolean).join(', ');
  return `${s.label || 'From a real result'}${when ? ` · ${when}` : ''}`;
}
const ccSource = (doc, v, c, dateText) => el(doc, 'span', c.planted ? 'wft-cc-planted' : 'wft-cc-src', ccHead(v, c, dateText));

/** One result card: its head and excerpt; `verdict` adds Worca's verdict and the person's answer (or Right / Wrong). */
function ccCard(doc, v, c, { verdict = true, answer = null, busy = false, dateText = (s) => s } = {}) {
  const card = el(doc, 'div', 'wft-cc-card');
  card.append(ccSource(doc, v, c, dateText));
  // Board 59 D: plain text. Fix round 6 (review M1): a copy that only removed lines changed none of its own, so no empty box is drawn.
  if (String(c.excerpt ?? '').trim()) card.append(el(doc, 'div', 'wft-cc-excerpt', plainText(c.excerpt)));
  if (!verdict) return card;
  const line = el(doc, 'div', 'wft-cc-verdict');
  const dot = el(doc, 'span', `wft-dot ${c.met ? 'ok' : 'no'}`);
  dot.setAttribute('aria-hidden', 'true');
  const words = el(doc, 'span');
  words.append(el(doc, 'b', '', `Worca says: ${c.met ? 'met' : 'not met'}.`), doc.createTextNode(` ${c.reason || ''}`));
  line.append(dot, words);
  card.append(line);
  if (c.answer === null && answer) {
    // One answer per press: both buttons wait until it is saved (the page then repaints); a refusal gives them back.
    const press = (right) => {
      if (r.disabled) return;
      for (const b of [r, w]) b.disabled = true;
      void Promise.resolve(answer(c.judgementId, right)).finally(() => { for (const b of [r, w]) b.disabled = false; });
    };
    const r = btn(doc, 'Right', () => press(true), 'btn btn-sm wft-cc-right');
    const w = btn(doc, 'Wrong', () => press(false), 'btn btn-sm wft-cc-wrong');
    const head = ccHead(v, c, dateText);
    r.setAttribute('aria-label', `Right: ${head}`);
    w.setAttribute('aria-label', `Wrong: ${head}`);
    // Fix round 1: while any answer or Worca's clearer words are out, no card takes another answer (the controller repaints).
    r.disabled = busy;
    w.disabled = busy;
    card.append(ccActs(doc, r, w));
  } else if (c.answer !== null) card.append(el(doc, 'span', `wft-cc-done${c.answer ? '' : ' is-wrong'}`, `You said: ${c.answer ? 'right' : 'wrong'}`));
  return card;
}

let ccBoxSeq = 0;
/** A P4-M3 box: it stands where "Did Worca get these right?" stands; `head` is its h2 (named by it), else `label` names it. */
function ccBox(doc, { head = null, label = null, live = false }) {
  const box = el(doc, 'section', 'card wft-cc-state');
  if (live) box.setAttribute('aria-live', 'polite');
  if (head) {
    const h = el(doc, 'h2', '', head);
    h.id = `wft-cc-box-${++ccBoxSeq}`;
    box.setAttribute('aria-labelledby', h.id);
    box.append(h);
  } else box.setAttribute('aria-label', label);
  return box;
}
/** P4-M3's stop line: red when Worca failed, amber at the spending limit. The words are the server's. */
function ccStop(doc, tone, words) {
  const s = el(doc, 'div', `wft-cc-stop is-${tone}`);
  s.setAttribute('role', tone === 'err' ? 'alert' : 'status');
  s.append(icon(doc, 'alert', 15), el(doc, 'span', '', words));
  return s;
}
function ccActs(doc, ...buttons) { const a = el(doc, 'div', 'wft-acts'); a.append(...buttons); return a; }
const usdSpan = (doc, usd) => el(doc, 'span', 'code', fmtUsd(usd));

/** P4-M3 "while Worca prepares": making the broken results (no card yet), then checking them. */
function ccPreparing(doc, v, dateText) {
  const checking = v.cards.length > 0;
  const box = ccBox(doc, { label: checking ? 'Worca is checking' : 'Worca is preparing', live: true });
  const wait = el(doc, 'div', 'wft-cc-wait');
  wait.append(icon(doc, 'spinner', 20),
    el(doc, 'span', '', checking ? `Checking ${Math.max(CC_CARDS, v.cards.length)} results…` : 'Worca is breaking a good result in a few ways…'));
  box.append(wait);
  if (checking) {
    const grid = el(doc, 'div', 'wft-cc-cards');
    for (const c of v.cards) grid.append(ccCard(doc, v, c, { verdict: false, dateText }));
    box.append(grid);
  } else {
    const ghosts = el(doc, 'div', 'wft-cc-ghosts');
    ghosts.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < CC_CARDS; i += 1) ghosts.append(el(doc, 'span', 'wft-cc-ghost'));
    box.append(ghosts);
  }
  box.append(el(doc, 'p', 'hint', CC_LEAVE));
  return box;
}

/** P4-M3 "after a Wrong": the cards you said were wrong, and Worca's clearer words (or why there are none, in the server's words). */
function ccReworded(doc, v, reworded, actions, { rewording = false, dateText = (s) => s } = {}) {
  const box = ccBox(doc, { label: 'After a wrong answer' });
  for (const c of v.cards.filter((x) => x.answer === false)) box.append(ccCard(doc, v, c, { dateText }));
  if (rewording) {   // fix round 1: the words are being written (the coordinator's words, in the style of "Worca is reading your note…")
    const wait = el(doc, 'div', 'wft-cc-wait');
    wait.setAttribute('role', 'status');
    wait.append(icon(doc, 'spinner', 20), el(doc, 'span', '', 'Worca is writing clearer words…'));
    box.append(wait);
    return box;
  }
  const keep = btn(doc, 'Keep my words', () => actions.keepWords(), 'btn btn-sm');
  if (reworded.error) {
    box.append(ccStop(doc, reworded.limit ? 'limit' : 'err', reworded.error), ccActs(doc, btn(doc, 'Try again', () => actions.reword(), 'btn btn-sm'), keep));
    return box;
  }
  const sugg = el(doc, 'div', 'wft-sugg wft-cc-reword');
  const use = busyBtn(doc, 'Use these words and check again', () => actions.useWords(reworded.text), 'btn btn-sm btn-primary');
  const est = el(doc, 'span', 'hint', `Checking again makes ${CC_CARDS} new results to confirm, about `);
  // Fix round 5: the round's own calls (its three whole-copy calls and its checks; checker.mjs againUsd), not the clearer words' call.
  est.append(usdSpan(doc, typeof v.againUsd === 'number' ? v.againUsd : v.costUsd), doc.createTextNode('.'));
  sugg.append(el(doc, 'span', 'wft-sugg-tag', 'Worca suggests clearer words'), el(doc, 'span', 'wft-cc-words', `"${reworded.text}"`), ccActs(doc, use, keep), est);
  box.append(sugg);
  return box;
}

/**
 * Board 11 (ready and done) and P4-M3's states. `v` = GET …/checker/:round, or null with `empty` = { kind: 'none' | 'tried' | 'limit' | 'long', text }
 * (no round: no good result yet, board 59 A's tried but no try passed, or the spending limit; `criterion` = { text } names it then). `reworded` = { text } (Worca's clearer
 * words after a Wrong) or { error, limit } (the reword route's refusal). actions: answer(judgementId, right), reword(), back(), use(), example() (the crumb; back() when absent),
 * useWords(text), keepWords(), retry() (a new round of the criterion), tryOnce() (Try your draft once now), pickLiked() (board 59 A: the
 * example's "A result you liked"). `busy`: an answer or the
 * clearer words are out, so no Right / Wrong takes a press; `rewording`: Worca is writing the clearer words. `dateText` formats the
 * good result's date (tests-app.mjs wftDate).
 */
export function renderChecker(root, v, actions, { doc, exampleName, criterion = null, empty = null, reworded = null, busy = false, rewording = false,
  dateText = (s) => s }) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-cc');
  const head = el(doc, 'div', 'wft-titles');
  const name = exampleName || (v && v.exampleName) || '';
  head.append(btn(doc, name ? `Example: ${name}` : 'Example', () => (actions.example || actions.back)(), 'wft-crumb'), el(doc, 'h2', 'wft-title', 'Check the checker'),
    el(doc, 'p', 'subtitle', CC_SUB));
  const crit = el(doc, 'section', 'card wft-cc-head');
  crit.append(el(doc, 'span', 'hint', 'Your criterion'), el(doc, 'span', 'wft-cc-crit', (v ? v.criterion : criterion && criterion.text) || ''));
  page.append(head, crit);
  root.append(page);
  const back = () => btn(doc, 'Back', () => actions.back(), 'btn btn-sm');
  if (!v) {   // P4-M3: no round, so no cards
    const limit = !!empty && empty.kind === 'limit';
    const long = !!empty && empty.kind === 'long';
    const box = ccBox(doc, { head: limit || long ? 'Check the checker did not start' : 'Worca needs a good result first' });
    if (limit) box.append(ccStop(doc, 'limit', empty.text || ''), ccActs(doc, back(), busyBtn(doc, 'Try again', () => actions.retry(), 'btn btn-sm')));
    // User decision 2026-11-22: a result too long to break on purpose. Back only: a new try of the same result can never work.
    else if (long) box.append(el(doc, 'p', 'wft-cc-say', empty.text || ''), ccActs(doc, back()));
    else if (empty && empty.kind === 'tried') {   // board 59 A: tried, but no try passed
      box.append(el(doc, 'p', 'wft-cc-say', empty.text || ''),
        ccActs(doc, back(), btn(doc, 'Pick a result you liked', () => actions.pickLiked(), 'btn btn-sm btn-primary')));
    } else {
      box.append(el(doc, 'p', 'wft-cc-say', (empty && empty.text) || ''),
        ccActs(doc, back(), busyBtn(doc, 'Try your draft once now', () => actions.tryOnce(), 'btn btn-sm btn-primary')));
    }
    page.append(box);
    return;
  }
  const status = v.round && v.round.status;
  if (status === 'making') { page.append(ccPreparing(doc, v, dateText)); return; }
  if (status === 'failed') {
    const box = ccBox(doc, { head: 'Check the checker did not finish' });
    const cost = el(doc, 'p', 'hint', 'Nothing is counted from this round. This round cost ');
    cost.append(usdSpan(doc, v.costUsd), doc.createTextNode('.'));
    box.append(ccStop(doc, 'err', v.round.detail || ROUND_NOT_FINISHED_TEXT), cost,
      ccActs(doc, back(), busyBtn(doc, 'Try again', () => actions.retry(), 'btn btn-sm btn-primary')));
    page.append(box);
    return;
  }
  if (reworded || rewording) page.append(ccReworded(doc, v, reworded || {}, actions, { rewording, dateText }));
  else {
    const panel = el(doc, 'section', 'qpanel wft-cc-panel');
    panel.setAttribute('aria-labelledby', 'wft-cc-q');
    const ph = el(doc, 'div', 'qpanel-head');
    const q = el(doc, 'b', '', 'Did Worca get these right?');
    q.id = 'wft-cc-q';
    ph.append(q, el(doc, 'span', 'qcount', `${v.left} of ${v.cards.length} left`));
    const grid = el(doc, 'div', 'wft-cc-cards');
    for (const c of v.cards) grid.append(ccCard(doc, v, c, { answer: actions.answer, busy, dateText }));
    panel.append(ph, grid, el(doc, 'p', 'hint', 'If you say "wrong", Worca suggests clearer words for the criterion and asks again.'));
    page.append(panel);
  }
  const auto = el(doc, 'section', 'card wft-cc-auto');
  const ah = el(doc, 'h2', '', 'Worca also tested its own checking');
  ah.id = 'wft-cc-auto-h';
  auto.setAttribute('aria-labelledby', ah.id);
  auto.append(ah, el(doc, 'p', 'hint', 'No answers needed from you.'));
  for (const [k, words] of AUTO) {
    const r = el(doc, 'div', 'wft-cc-auto-row');
    const x = (v.auto && v.auto[k]) || { n: 0, of: 0 };
    // Fix round 1: nothing to count yet (0 of 0) is grey, not a failure.
    r.append(el(doc, 'span', '', words), el(doc, 'span', !x.of ? 'badge' : x.n === x.of ? 'badge green' : 'badge red', `${x.n} of ${x.of}`));
    auto.append(r);
  }
  const foot = el(doc, 'div', 'wft-cc-foot');
  const use = btn(doc, 'Use this criterion', () => actions.use(), 'btn btn-primary wft-cc-use');
  use.disabled = !v.canUse;
  const cost = el(doc, 'span', 'hint', 'This check cost ');
  cost.append(usdSpan(doc, v.costUsd), doc.createTextNode(v.costUnknown ? ` · ${COST_UNKNOWN_NOTE}, so Worca cannot count them in your spending limit.` : '.'),
    doc.createTextNode(" Your answers also count toward how far Worca's checking is trusted."));
  foot.append(cost, ccActs(doc, btn(doc, 'Back', () => actions.back(), 'btn'), use));
  page.append(auto, foot);
}

// ---- Board 13 (Task 23): How reliable is Worca's checking? P4-M4 draws its early states (no criteria, no answers yet). ----
const TR_SUB = 'Worca uses AI to check your criteria. AI can be wrong, so Worca tests its own checking in six ways. The results show where you can trust it and where you should not.';
const TR_RERUN = 'They run again whenever the checking model or a criterion changes.';
function trTile(doc, label, value, sub) {
  const t = el(doc, 'section', 'card wft-tile');
  t.append(el(doc, 'div', 'wft-tile-label', label), el(doc, 'div', `wft-tile-value${value === '—' ? ' is-none' : ''}`, value), el(doc, 'small', 'wft-tile-sub', sub));
  return t;
}
function trTiles(doc, { agree, planted, trusted }, people) {
  const tiles = el(doc, 'div', 'wft-tiles');
  const missed = planted.of - planted.caught;
  const on = new Set(planted.missedOn).size;
  tiles.append(
    trTile(doc, 'Agrees with people', agree.n ? `${people.pct}%` : '—', agree.n ? `of ${answersText(agree.n)}` : 'no answers yet'),   // the people test's share
    trTile(doc, 'Planted mistakes caught', planted.of ? `${planted.caught} of ${planted.of}` : '—', !planted.of ? 'not tested yet'
      : missed ? `the ${missed} missed ${missed === 1 ? 'is' : 'are'} on ${on === 1 ? 'one criterion' : `${on} criteria`}` : 'none missed'),
    trTile(doc, 'Criteria you can trust', trusted.of ? `${trusted.n} of ${trusted.of}` : '—',   // fix round 1: nothing counted is P4-M4's "—"
      [trusted.unreliable ? `${trusted.unreliable} unreliable (shown, does not decide)` : null,
        trusted.waiting ? `${trusted.waiting} ${trusted.waiting === 1 ? 'waits' : 'wait'} for your answers` : null].filter(Boolean).join(', ')
        || (trusted.of && trusted.n === trusted.of ? 'all of them' : '')));
  return tiles;
}
function trTests(doc, m, dateText) {
  const sec = el(doc, 'section', 'card wft-tr-tests');
  const h = el(doc, 'h2', '', 'The six tests');
  h.id = 'wft-tr-tests-h';
  sec.setAttribute('aria-labelledby', h.id);
  const hint = el(doc, 'p', 'hint', TR_RERUN);
  if (m.lastAt) hint.append(doc.createTextNode(` Last run ${dateText(m.lastAt)} · cost `), usdSpan(doc, m.costUsd), doc.createTextNode('.'));
  else if (m.tests.every((t) => t.state === 'none')) hint.append(doc.createTextNode(' Not run yet.'));   // P4-M4
  sec.append(h, hint);
  m.tests.forEach((t, i) => {
    const row = el(doc, 'div', 'wft-tr-test');
    const [title, words] = TRUST_TESTS[t.key];
    const body = el(doc, 'div', 'wft-tr-body');
    body.append(el(doc, 'b', '', title), el(doc, 'p', '', words));
    const out = el(doc, 'span', 'wft-tr-out');
    const [cls, badge] = trustTestBadge(t);   // user decision 4: a problem is counted ("2 missed")
    out.append(el(doc, 'span', cls, badge));
    if (t.state !== 'none') out.append(el(doc, 'span', 'wft-tr-line', trustTestLine(t)));   // P4-M4: not run yet is the badge alone
    const n = el(doc, 'span', 'wft-tr-dot', String(i + 1));
    n.setAttribute('aria-hidden', 'true');
    row.append(n, body, out);
    sec.append(row);
  });
  return sec;
}
function trTodo(doc, todo, actions) {
  const sec = el(doc, 'section', 'card wft-tr-todo');
  const h = el(doc, 'h2', '', 'What to do');
  h.id = 'wft-tr-todo-h';
  sec.setAttribute('aria-labelledby', h.id);
  sec.append(h);
  for (const x of todo) {
    const r = el(doc, 'div', 'wft-tr-todo-row');
    const words = el(doc, 'span', '');
    words.append(el(doc, 'b', '', `"${x.text}"`), doc.createTextNode(x.kind === 'fix' ? ' is unreliable.' : ' is new. Confirm 4 results so Worca knows it judges it your way.'));
    const more = { text: x.text, exampleName: x.exampleName || null };   // Check the checker names the criterion before its round reads
    // Both open Check the checker of the criterion (Task 22); "Confirm 4 results" is the amber badge itself, as on board 12.
    r.append(words, x.kind === 'fix' ? busyBtn(doc, 'Fix the criterion', () => actions.fix(x.exampleId, x.criterionId, more), 'btn btn-sm wft-tr-fix')
      : busyBtn(doc, TRUST_BADGE.confirm[1], () => actions.confirm(x.exampleId, x.criterionId, more), `${TRUST_BADGE.confirm[0]} wft-confirm wft-tr-confirm`));
    sec.append(r);
  }
  return sec;
}
/**
 * Board 13 and P4-M4. `m` = GET …/trust (trustReportModel). `actions`: `fix(exampleId, criterionId, { text, exampleName })` and
 * `confirm(…)` open Check the checker of that criterion; `back()` is the Tests list. Colleagues' reviews come with Part 5 (`m.colleagues`).
 */
export function renderTrustReport(root, m, actions, { doc, dateText = (s) => s }) {
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-tr');
  const head = el(doc, 'div', 'wft-titles');
  head.append(btn(doc, 'Tests', () => actions.back(), 'wft-crumb'), el(doc, 'h2', 'wft-title', "How reliable is Worca's checking?"), el(doc, 'p', 'subtitle', TR_SUB));
  page.append(head);
  root.append(page);
  if (m.state === 'no-criteria') {   // P4-M4 1: the Tests list shows no card then; this page opens only from its address
    const box = el(doc, 'section', 'card wft-tr-none');
    const h = el(doc, 'h2', '', 'No criteria yet');
    h.id = 'wft-tr-none-h';
    box.setAttribute('aria-labelledby', h.id);
    box.append(h, el(doc, 'p', '', 'Worca tests its own checking once an example has criteria. Add one to an example in your own words, for example "names a goal with a number".'),
      btn(doc, 'Go to the examples', () => actions.back(), 'btn btn-sm wft-tr-go'));
    page.append(box);
    return;
  }
  const todo = m.todo.length ? [trTodo(doc, m.todo, actions)] : [];
  const people = m.tests.find((t) => t.key === 'people');
  if (m.state === 'no-answers') {   // P4-M4 2: the blue box, the tiles, What to do, then the six tests
    const info = el(doc, 'section', 'wft-tr-info');
    const h = el(doc, 'h2', '', 'Worca needs your answers first: confirm each new criterion.');
    h.id = 'wft-tr-info-h';
    info.setAttribute('aria-labelledby', h.id);
    const words = el(doc, 'div', '');
    words.append(h, el(doc, 'span', '', 'Each one takes 4 answers. Until then, the tests below have little to go on.'));
    info.append(words);
    page.append(info, trTiles(doc, m.tiles, people), ...todo, trTests(doc, m, dateText));
    return;
  }
  page.append(trTiles(doc, m.tiles, people), trTests(doc, m, dateText), ...todo);
}

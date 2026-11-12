// ui/public/workflows/test-compare.mjs — Compare (canvas board 5) and one example side by side (boards 6, 31; board 28's
// G2 one column; board 29's empty states), plus Read the whole result (plans/workflow-tests-part2-plan.md Task 14; C2,
// C10, C19, G2, G3, G9, G15). Pure DOM: app.js reads the server's models (service.compareOf / sideBySide) and owns the
// actions. A repaint keeps the focus on the same control (data-focus-key), and a button whose action is out stays busy
// across repaints (BUSY), as the progress page does.
import { el, btn, startInto, checkWords, mockNote } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { createDialog } from '../marketplace/layers.mjs';
import { fmtUsd, fmtUsdFine } from '../../../src/shared/workflow-tests/checks.mjs';
import { estimateOf, aboutUsd, agoText, countsText, fmtDuration, pctDelta, durationDelta, countDelta, fmtTimes } from '../../../src/shared/workflow-tests/compare.mjs';
import { serverName } from '../../../src/shared/workflow-tests/connector-name.mjs';
import { splitPatchSections, parseFileSection } from '../diff-view.mjs';
import { changesTitle, changeCountText, FILE_BADGE, READ_ALL_CHANGES, BOTH_STARTED_FROM, DEV_CAPTION, DEV_SBS_HINT, DEV_START_LEAD, DEV_SETUP_LEAD,
  changesLine, notMetFor, COMMAND_ENDED, COMMAND_TIMED_OUT, SEE_COMMAND_OUTPUT, NOTHING_PUSHED_TEXT, REAL_BLOCKED_TEXT, EACH_ANSWERED_TEXT,
  EACH_STOPPED_ANSWERED_TEXT, READING_CHANGES, inSentence,
  FAILED_LEAD, splitTestName, moreNamesText, NO_FILE_DIFF_TEXT, BINARY_FILE_TEXT, CHANGES_UNREAD_TEXT, DIFF_SHORTENED_TEXT, moreFilesText, NO_DIFF_TEXT, madeAgainText,
  metFor, MET_DESPITE_TEXT, metWhyText,
  BEFORE_HEADING, beforeExitText, beforeNotRunText, BEFORE_GROUPS, FAILURES_ONLY_NOTE, EXIT_ONLY_NOTE, passedCountsText, skippedCountsText, TESTS_CUT_NOTE, addedRest, DEV_BEFORE_LEAD, devBeforeRest }
  from '../../../src/shared/workflow-tests/project-text.mjs';

const RESULT = { better: ['badge green', 'Better'], worse: ['badge red', 'Worse'], same: ['badge', 'Same'] };
const usdOr = (n) => (typeof n === 'number' && Number.isFinite(n) ? fmtUsdFine(n) : '—');
const timeOr = (ms) => (typeof ms === 'number' && Number.isFinite(ms) ? fmtDuration(ms) : '—');
const wrote = (label) => `What ${inSentence(label)} wrote`;
const plural = (w) => (/(?:s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);
/** A test tries an example at most this often (src/core/workflow-tests/store.mjs MAX_TRIES): Try 3 more has no room above. */
const MAX_TRIES = 10;
const SAME_WORDS = 'about the same';
const STARTED_FROM = ' · started from ';   // one version (Try it once now): "both" would be wrong
/** The picked file's diff shows at most this many lines; Read all the changes has the rest. */
const DIFF_LINES_MAX = 400;
const BADGE_CLASS = { added: 'badge green', removed: 'badge wft-badge-rm' };   // "Changed" and "Renamed" are plain

/** N3: the count beside "Would have sent": "1 message, 1 issue", by what each call makes. */
export function sentCount(calls) {
  const by = new Map();
  for (const c of calls) by.set(c.noun, (by.get(c.noun) || 0) + 1);
  return [...by].map(([noun, n]) => `${n} ${n === 1 ? noun : plural(noun)}`).join(', ');
}

/** root → Map(busy key → { runId }) of the buttons whose action is still out (Try 3 more on two examples at once, say). */
const BUSY = new WeakMap();
const busyOf = (root) => { let m = BUSY.get(root); if (!m) { m = new Map(); BUSY.set(root, m); } return m; };
const keyed = (root, key) => [...root.querySelectorAll('[data-focus-key]')].find((n) => n.dataset.focusKey === key) || null;
/** What a repaint takes away: the focused control, by its key. */
function heldFocus(root, doc) {
  const a = doc.activeElement;
  const had = !!a && a !== root && root.contains(a);
  return { had, key: had && a.dataset ? a.dataset.focusKey || null : null };
}
function giveFocusBack(root, doc, held) {
  if (!held.had || root.contains(doc.activeElement)) return;
  const again = held.key ? keyed(root, held.key) : null;
  (again && !again.disabled ? again : root).focus({ preventScroll: true });   // never <body>, where the canvas keys answer
}
/** A button with a focus key; with `busy`, disabled while its action is out, also on a page a frame repainted meanwhile.
 *  `busyKey` (default: the focus key) names the action: Read the whole result is busy per try, its focus per column. */
function act(doc, root, runId, label, fn, cls, key, { busy = false, busyKey = key } = {}) {
  const b = btn(doc, label, null, cls);
  b.dataset.focusKey = key;
  if (busy) b.dataset.busyKey = busyKey;
  const out0 = busyOf(root).get(busyKey);
  if (busy && out0 && out0.runId === runId) b.disabled = true;
  b.addEventListener('click', () => {
    if (b.disabled) return;
    if (!busy) { fn(); return; }
    b.disabled = true;
    const mine = { runId };
    busyOf(root).set(busyKey, mine);
    let out;
    try { out = fn(); } catch { out = null; }   // a throw gives the button back too
    Promise.resolve(out).catch(() => {}).finally(() => {
      const map = busyOf(root);
      if (map.get(busyKey) !== mine) return;
      map.delete(busyKey);
      // This button, or the one a repaint put in its place (none while another try shows).
      for (const n of root.querySelectorAll('[data-busy-key]')) if (n.dataset.busyKey === busyKey) n.disabled = false;
    });
  });
  return b;
}

const modeNote = (doc, name, text) => {
  const p = el(doc, 'p', 'wft-mode');
  p.append(icon(doc, name, 14), el(doc, 'span', '', text));
  return p;
};

/** Board 31: what one pretend try would have sent (C19), or what a real try did. null when the column has no try.
 *  Board 37 (3a, D68): a project try also lists what the outward guard stopped, in both modes. */
function sentCard(doc, v, key, { project = false } = {}) {
  if (!v) return null;
  const sent = v.wouldHaveSent || [];
  const realNote = () => modeNote(doc, 'plug', 'Connectors: real. This try used your real connectors.');
  if (v.connectors === 'real' && !sent.length) {   // a real try that the guard never had to stop: Part 2's note
    const c = el(doc, 'section', 'card wft-sent-real');
    c.append(realNote());
    return c;
  }
  const c = el(doc, 'section', 'card wft-sent');
  const head = el(doc, 'div', 'wft-sent-head');
  const h = el(doc, 'h2', '', 'Would have sent');
  h.id = `wft-sent-${key}`;
  c.setAttribute('aria-labelledby', h.id);
  head.append(h);
  if (sent.length) head.append(el(doc, 'span', 'hint', sentCount(sent)));
  c.append(head);
  if (v.connectors === 'real') c.append(realNote());   // Fix 1: a Real try the guard stopped still says it used real connectors
  for (const call of sent) {
    const d = el(doc, 'details', 'wft-call');
    const sum = el(doc, 'summary');
    const chev = icon(doc, 'chevron', 12, 'ic wft-call-chev');
    const line = el(doc, 'span', 'wft-call-line');
    if (call.guard) {   // 3a D68: what the outward guard stopped, by the command's own name ("git", "GitHub CLI")
      line.append(el(doc, 'b', '', call.server), el(doc, 'span', 'wft-call-what', ` · ${call.tool} · `), el(doc, 'span', 'wft-call-prev', call.preview));
      sum.append(chev, line);
      const full = el(doc, 'div', 'wft-call-full');
      full.append(el(doc, 'span', 'wft-call-cap', call.cap), doc.createTextNode(call.full));
      if (call.cmd) full.append(el(doc, 'span', 'wft-call-cmd', call.cmd));
      d.append(sum, full);
      c.append(d);
      continue;
    }
    line.append(el(doc, 'b', '', serverName(call.server)), el(doc, 'span', 'wft-call-what', ` · ${call.tool} · `),
      el(doc, 'span', 'wft-call-prev', call.to ? `to ${call.to}: "${call.preview}"` : `"${call.preview}"`));
    sum.append(chev, line);
    const full = el(doc, 'div', 'wft-call-full');
    full.append(el(doc, 'span', 'wft-call-cap', call.to ? `Full text · to ${call.to}` : 'Full text'), doc.createTextNode(call.full));
    d.append(sum, full);
    c.append(d);
  }
  if (!sent.length) c.append(el(doc, 'p', 'wft-sent-foot', project ? `Nothing would have been sent. ${NOTHING_PUSHED_TEXT}` : 'Nothing would have been sent.'));
  else if (project) c.append(el(doc, 'p', 'wft-sent-foot', v.connectors === 'real' ? EACH_STOPPED_ANSWERED_TEXT : EACH_ANSWERED_TEXT));   // board 37
  for (const r of v.answeredReads || []) {
    c.append(el(doc, 'p', 'wft-sent-foot', `Worca also answered ${r.n === 1 ? '1 request' : `${r.n} requests`} in ${serverName(r.server)}: ${r.n === 1 ? 'it' : 'they'} came back empty.`));
  }
  return c;
}

/** How one question was answered. 'unusable': the example had an answer, but it fits no option (and free text is off). */
function askedAnswer(doc, a) {
  const how = a && a.how;
  if (how === 'example') return el(doc, 'span', 'wft-q-ans', `· your answer: "${a.answer}"`);
  if (how === 'picked') {
    return el(doc, 'span', 'wft-q-ans', a.answer === '' || a.answer == null ? '· not in the example: Worca left it empty'
      : `· not in the example: Worca picked "${a.answer}"`);
  }
  if (how === 'unusable') {
    return a.answer == null ? el(doc, 'span', 'wft-q-failed', '· your answer could not be used: the try counts as failed')
      : el(doc, 'span', 'wft-q-ans', `· your answer could not be used: Worca picked "${a.answer}"`);
  }
  return el(doc, 'span', 'wft-q-failed', '· not in the example: the try counts as failed');
}

/** U-T12 (F23, board 47): what Worca asked in one try, in the order asked, and how each was answered. Questions and
 *  answers are the workflow's and the example's text: set as text, never markup; long ones wrap, never cut. */
function questionsCard(doc, asked, key) {
  const c = el(doc, 'section', 'card wft-qs-card');
  const head = el(doc, 'div', 'wft-qs-head');
  const h = el(doc, 'h2', '', 'Questions');
  h.id = `wft-qs-${key}`;
  c.setAttribute('aria-labelledby', h.id);
  head.append(h);
  c.append(head);
  if (!asked.length) { c.append(el(doc, 'p', 'wft-qs-none', 'Worca asked nothing in this try.')); return c; }
  head.append(el(doc, 'span', 'hint', asked.length === 1 ? '1 question' : `${asked.length} questions`));
  const ul = el(doc, 'ul', 'wft-qs');
  for (const a of asked) {
    const li = el(doc, 'li', '', `Worca asked "${a && a.question}" `);
    li.append(askedAnswer(doc, a));
    ul.append(li);
  }
  c.append(ul);
  return c;
}

function passed(doc, r) {
  const span = el(doc, 'span', 'wft-res');
  if (!r || !r.total) { span.classList.add('is-none'); span.textContent = 'Not tried'; return span; }
  const dot = el(doc, 'span', `wft-dot ${r.passed === r.total ? 'ok' : r.passed === 0 ? 'no' : 'mix'}`);
  dot.setAttribute('aria-hidden', 'true');
  span.append(dot, doc.createTextNode(`${r.passed} of ${r.total}`));
  return span;
}
const badge = (doc, result) => (result ? el(doc, 'span', RESULT[result][0], RESULT[result][1]) : el(doc, 'span', 'hint', '—'));

function tile(doc, label, value, sub, delta = null, note = null) {
  const t = el(doc, 'section', 'card wft-tile');
  const l = el(doc, 'div', 'wft-tile-label');
  l.append(el(doc, 'span', '', label));
  if (delta) l.append(el(doc, 'span', 'wft-tile-delta', delta));
  t.append(l, el(doc, 'div', 'wft-tile-value', value), el(doc, 'small', 'wft-tile-sub', sub));
  if (note) t.append(el(doc, 'small', 'wft-tile-note', note));
  return t;
}

/** The crumb above the title and its hint (boards 5, 6). */
function titles(doc, crumb, nameEl, hint) {
  const t = el(doc, 'div', 'wft-titles');
  t.append(crumb, nameEl, hint);
  return t;
}

/**
 * Board 5. `c` = GET …/runs/:run/compare: { run, title, labels: {a, b}, examples, costUsd, model, changes, fair }.
 * @param {{back:Function, testAgain:Function, open:(exampleId:number)=>void, tryMore:(exampleId:number)=>void|Promise}} actions
 */
export function renderCompare(root, c, actions, { doc, now = Date.now(), mock = false }) {
  const held = heldFocus(root, doc);
  root.replaceChildren();
  const runId = c.run.id;
  const page = el(doc, 'div', 'wft-page wft-compare');
  const m = c.model;
  const A = c.labels.a || '—';
  const B = c.labels.b;
  const head = el(doc, 'div', 'wft-crumbs wft-pg-head');
  const when = c.run.status === 'stopped' ? 'stopped early' : `ready ${agoText(c.run.finishedAt, now)}`;
  const meta = el(doc, 'span', 'hint', `${countsText(c.examples, c.run.tries)} · ${when} · cost `);
  meta.append(el(doc, 'span', 'code', fmtUsd(c.costUsd)));
  head.append(titles(doc, act(doc, root, runId, 'Tests', () => actions.back(), 'wft-crumb', 'wft-cmp-back'), el(doc, 'h2', 'wft-title', c.title), meta));
  const acts = el(doc, 'div', 'wft-acts');
  acts.append(act(doc, root, runId, 'Test again', () => actions.testAgain(), 'btn', 'wft-cmp-again', { busy: true }));
  head.append(acts);
  page.append(head);
  if (mock) page.append(mockNote(doc));   // F52

  if (m.inShort.length) {   // C2: the model's sentences; none when nothing compares (D38)
    const s = el(doc, 'section', 'wft-short');
    const box = el(doc, 'div');
    const h = el(doc, 'h2', '', 'In short');
    h.id = 'wft-short-h';
    s.setAttribute('aria-labelledby', h.id);
    const p = el(doc, 'p', '', m.inShort.join(' '));
    if (m.look) p.append(doc.createTextNode(` ${m.look.before}`), el(doc, 'b', '', m.look.name), doc.createTextNode(m.look.after));
    box.append(h, p);
    s.append(box);
    if (m.look) s.append(act(doc, root, runId, 'Look at it', () => actions.open(m.look.exampleId), 'btn', 'wft-cmp-look'));
    page.append(s);
  }

  const a = m.tiles.a || { passed: { passed: 0, total: 0 }, costPerTry: null, timePerTry: null, sentBack: null, steady: { n: 0, of: 0 } };
  const diff = m.tiles.diff || { cost: 'same', time: 'same', sentBack: 'same' };   // an older model has none: no gap is claimed
  const finite = (x) => typeof x === 'number' && Number.isFinite(x);
  // D5: the same rule as In short (compare.mjs differs): 'same' is "about the same"; null (cannot tell) shows no delta.
  const isDiff = (v) => v === 'more' || v === 'less';
  const gap = (v, x, y, text) => (isDiff(v) ? text() : v === 'same' && finite(x) && finite(y) ? SAME_WORDS : null);
  const sentDelta = (d) => { const v = Math.round(Math.abs(b.sentBack - a.sentBack) * 10) / 10; return `${v} ${d === 'more' ? 'more' : 'fewer'}`; };
  const b = m.tiles.b;
  // The passed tile counts every finished try; the per-try tiles only the examples both versions finished. When the two
  // differ (a test stopped before every example was compared), the passed tile says so.
  const compared = m.examples.filter((r) => r.result !== null);
  const sum = (k) => compared.reduce((n, r) => n + r[k].total, 0);
  const apart = !!m.tiles.a && (sum('a') !== a.passed.total || sum('b') !== b.passed.total);
  const tiles = el(doc, 'div', 'wft-tiles');
  tiles.append(
    tile(doc, 'Tries passed', `${b.passed.passed} of ${b.passed.total}`, `${A}: ${a.passed.passed} of ${a.passed.total}`, countDelta(a.passed.passed, b.passed.passed),
      apart ? 'Counts every finished try.' : null),   // controller-approved copy (2026-10-27)
    tile(doc, 'Cost per try', usdOr(b.costPerTry), `${A}: ${usdOr(a.costPerTry)}`, gap(diff.cost, a.costPerTry, b.costPerTry, () => pctDelta(a.costPerTry, b.costPerTry) || diff.cost)),
    tile(doc, 'Time per try', timeOr(b.timePerTry), `${A}: ${timeOr(a.timePerTry)}`, gap(diff.time, a.timePerTry, b.timePerTry, () => durationDelta(a.timePerTry, b.timePerTry) || null)),
    tile(doc, 'Sent back for fixes', fmtTimes(b.sentBack) || '—', `per try, on average · ${A}: ${fmtTimes(a.sentBack) || '—'}`,
      gap(diff.sentBack, a.sentBack, b.sentBack, () => sentDelta(diff.sentBack))),
    tile(doc, 'Passed every try', `${b.steady.n} of ${b.steady.of}`, `examples that passed in every try · ${A}: ${a.steady.n} of ${a.steady.of}`),
  );
  page.append(tiles);

  const cols = el(doc, 'div', 'wft-cmp-cols');   // board 5: By example beside What you changed
  const by = el(doc, 'section', 'wft-by');   // G9: one view, a heading, no one-tab switch
  const hb = el(doc, 'h2', 'wft-by-title', 'By example');
  hb.id = 'wft-by-h';
  by.setAttribute('aria-labelledby', hb.id);
  const table = el(doc, 'div', 'card wft-table');
  const scroll = el(doc, 'div', 'wft-scroll');
  const inner = el(doc, 'div', 'wft-crows2');
  const hr = el(doc, 'div', 'wft-crow2 is-head');
  hr.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', `${A} passed`), el(doc, 'span', '', `${B} passed`), el(doc, 'span', '', 'Result'));
  inner.append(hr);
  for (const r of m.examples) {
    const row = el(doc, 'div', 'wft-crow2');
    const cell = el(doc, 'span', 'wft-crow2-res');
    cell.append(badge(doc, r.result));
    // H1: on a phone the row stacks and each count names its column (style.css .wft-crow2 [data-label]).
    const [pa, pb] = [passed(doc, r.a), passed(doc, r.b)];
    pa.dataset.label = `${A} passed`;
    pb.dataset.label = `${B} passed`;
    row.append(act(doc, root, runId, r.name, () => actions.open(r.id), 'wft-ex-open', `wft-cmp-ex-${r.id}`), pa, pb, cell);
    if (r.luck) {
      const why = el(doc, 'span', 'wft-why');
      const most = Math.max(r.a.total, r.b.total);
      const luck = `Might be luck: only ${most} ${most === 1 ? 'try' : 'tries'}.`;   // final review UI 4: one try each is common
      if (c.run.tries >= MAX_TRIES) why.textContent = luck;   // the most a test tries: the note stays, the button goes
      else {
        why.append(doc.createTextNode(`${luck} `),
          act(doc, root, runId, `Try ${Math.min(3, MAX_TRIES - c.run.tries)} more`, () => actions.tryMore(r.id), 'wft-linkbtn', `wft-cmp-more-${r.id}`, { busy: true }));
      }
      row.append(why);
    } else if (r.why) {
      row.append(el(doc, 'span', 'wft-why', r.why));
    }
    inner.append(row);
  }
  scroll.append(inner);
  table.append(scroll);
  by.append(hb, table);
  cols.append(by);

  const ch = el(doc, 'section', 'card wft-changes');
  const hc = el(doc, 'h2', '', `What you changed since ${A}`);
  hc.id = 'wft-chg-h';
  ch.setAttribute('aria-labelledby', hc.id);
  ch.append(hc);
  if (c.changes.length) {
    for (const t of c.changes) {
      const line = el(doc, 'div', 'wft-chg');
      const ico = el(doc, 'span', 'wft-chg-ico');
      ico.setAttribute('aria-hidden', 'true');
      ico.append(icon(doc, 'diff', 13));
      line.append(ico, el(doc, 'span', '', t));
      ch.append(line);
    }
  } else {
    ch.append(el(doc, 'p', 'hint wft-nochange', 'No steps or settings changed.'));
  }
  const fair = el(doc, 'p', 'hint wft-fair-head');
  fair.append(el(doc, 'b', '', 'A fair comparison.'), doc.createTextNode(` Both versions were tried on the same ${c.examples === 1 ? 'example' : `${c.examples} examples`} and checked the same way. If that changes, for example after an example is edited, Worca says so here.`));
  ch.append(fair);
  for (const f of [...c.fair, ...(c.madeAgain > 0 ? [madeAgainText(c.madeAgain)] : [])]) {   // U-T2: one more fair-comparison line
    const p = el(doc, 'p', 'wft-fair');
    p.append(icon(doc, 'alert', 14), el(doc, 'span', '', f));
    ch.append(p);
  }
  cols.append(ch);
  page.append(cols);
  root.append(page);
  giveFocusBack(root, doc, held);
}

/** A result's text into `box`: rendered (and sanitized) by `renderMarkdown` when the app gives one, else as text. */
function resultInto(box, text, renderMarkdown) {
  if (typeof renderMarkdown === 'function') renderMarkdown(text, box);
  else box.textContent = text;
  return box;
}

/** Board 36's "For developers": the start, the setup, and how big each version's change was. */
function devCard(doc, s, cur, once, dateText) {
  const c = el(doc, 'section', 'card wft-dev-card');
  const h = el(doc, 'h2', '', DEV_CAPTION);
  h.id = 'wft-sbs-dev';
  c.setAttribute('aria-labelledby', h.id);
  const facts = el(doc, 'div', 'wft-dev-facts');
  facts.append(startInto(doc, el(doc, 'span', '', DEV_START_LEAD), s.start, dateText, { dev: true }));   // F26: the commit id lives here
  if (s.start.setupCmd) {
    const su = el(doc, 'span', '', DEV_SETUP_LEAD);
    su.append(el(doc, 'span', 'code', s.start.setupCmd));
    if (s.start.setupMs) su.append(doc.createTextNode(` · ${fmtDuration(s.start.setupMs)}`));
    facts.append(su);
  }
  // U1 (board 40): the command's run on the start point (the first command check that ran one); none when it did not run.
  const withBefore = [cur.b, once ? null : cur.a].flatMap((v) => (v && v.verdict && v.verdict.checks) || [])
    .find((x) => x && x.kind === 'command' && typeof x.cmd === 'string' && x.before && x.before.ran);
  if (withBefore) {
    const f = el(doc, 'span');
    const b = withBefore.before;
    f.append(doc.createTextNode(DEV_BEFORE_LEAD), el(doc, 'span', 'code', withBefore.cmd), doc.createTextNode(devBeforeRest(b, b.at ? dateText(b.at) : null)));
    facts.append(f);
  }
  for (const [label, v] of once ? [[s.labels.b, cur.b]] : [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    if (v && v.project && v.project.changes) facts.append(el(doc, 'span', '', changesLine(label, v.project.changes)));
  }
  c.append(h, el(doc, 'p', 'hint', DEV_SBS_HINT), facts);
  return c;
}

/**
 * Board 6 (G2: one column after Try it once now). `s` = GET …/runs/:run/examples/:ex.
 * 3a (boards 36, 37): a project example's columns show what each try changed in the project (the picked file's diff
 * below the list), the command check's output, what the guard stopped, and the "For developers" facts.
 * @param {{back:Function, pick:(index:number)=>void, readWhole:(tryId:number, title:string)=>void|Promise,
 *   loadChanges?:(tryId:number)=>void, pickFile?:(side:'a'|'b', path:string)=>void, readChanges?:(tryId:number, title:string)=>void|Promise,
 *   commandOutput?:(title:string, output:string)=>void}} actions
 * @param {{renderMarkdown?: (text:string, mount:HTMLElement)=>void, patches?: Map<number, string|null|undefined>,
 *   picked?: {a?:string, b?:string}, dateText?: (iso:string)=>string}} o the app's sandboxed markdown (ask-markdown.mjs), board
 *   31's excerpt; each try's diff (undefined: not read yet, null: could not be read); the file picked per column
 */
export function renderSideBySide(root, s, actions, { doc, tryIndex = 0, renderMarkdown = null, patches = new Map(), picked = {}, dateText = (x) => x, mock = false }) {
  const held = heldFocus(root, doc);
  const live = root.querySelector('.wft-sbs-live') || el(doc, 'p', 'sr-only wft-sbs-live');
  live.setAttribute('aria-live', 'polite');
  root.replaceChildren();
  const runId = s.run.id;
  const page = el(doc, 'div', 'wft-page wft-detail');
  const once = s.run.kind === 'once' || !s.labels.a;
  const i = Math.min(Math.max(0, tryIndex), Math.max(0, s.tries.length - 1));
  const cur = s.tries[i] || null;
  const head = el(doc, 'div', 'wft-crumbs wft-pg-head');
  const name = el(doc, 'div', 'wft-detail-name');
  name.append(el(doc, 'h2', 'wft-title', s.example.name));
  if (!once && s.row.result) name.append(badge(doc, s.row.result));
  const counts = once
    ? `${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total} ${s.row.b.total === 1 ? 'try' : 'tries'}`
    : `${s.labels.a} passed ${s.row.a.passed} of ${s.row.a.total} ${s.row.a.total === 1 ? 'try' : 'tries'} · ${s.labels.b} passed ${s.row.b.passed} of ${s.row.b.total}`;
  const countsEl = el(doc, 'span', 'hint', counts);
  if (s.start) startInto(doc, (countsEl.append(doc.createTextNode(once ? STARTED_FROM : BOTH_STARTED_FROM)), countsEl), s.start, dateText);   // board 36
  head.append(titles(doc, act(doc, root, runId, once ? 'Tests' : s.compareTitle, () => actions.back(), 'wft-crumb', 'wft-sbs-back'),
    name, countsEl));
  if (s.tries.length > 1) {
    const tabs = el(doc, 'div', 'seg wft-sbs-tabs');
    tabs.setAttribute('role', 'tablist');
    tabs.setAttribute('aria-label', 'Which try');
    const last = s.tries.length - 1;
    s.tries.forEach((t, k) => {
      const b = act(doc, root, runId, `Try ${t.n}`, () => actions.pick(k), k === i ? 'on' : '', `wft-sbs-try-${k}`);
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', k === i ? 'true' : 'false');
      b.tabIndex = k === i ? 0 : -1;   // one tab stop; the arrow keys move between the tries
      b.addEventListener('keydown', (e) => {
        const to = e.key === 'ArrowRight' ? (k === last ? 0 : k + 1) : e.key === 'ArrowLeft' ? (k === 0 ? last : k - 1)
          : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
        if (to === null) return;
        e.preventDefault();
        actions.pick(to);
        // The repaint gave the focus back to the key it had (this tab, now out of the tab order): move it to the picked one.
        const next = keyed(root, `wft-sbs-try-${to}`);
        if (next) next.focus({ preventScroll: true });
      });
      tabs.append(b);
    });
    head.append(tabs);
  }
  page.append(head);
  if (mock) page.append(mockNote(doc));   // F52
  // Board 31's pretend note; board 37 adds the lock note below it (a project try never pushes, in either mode), the two
  // close together.
  const notes = s.nothingPushed ? el(doc, 'div', 'wft-modes') : page;
  if (s.connectors === 'pretend') notes.append(modeNote(doc, 'shield', 'Connectors: pretend. Nothing was posted or sent.'));
  if (s.nothingPushed) {
    const p = el(doc, 'p', 'wft-mode');
    const words = el(doc, 'span');
    words.append(el(doc, 'b', '', NOTHING_PUSHED_TEXT));
    if (s.connectors === 'real') words.append(doc.createTextNode(REAL_BLOCKED_TEXT));
    p.append(icon(doc, 'lock', 14), words);
    notes.append(p);
    page.append(notes);
  }
  if (!cur) {   // board 29
    page.append(el(doc, 'p', 'hint wft-empty-sbs', 'No finished try of this example in this test.'));
    root.append(page, live);
    if (live.textContent) live.textContent = '';
    giveFocusBack(root, doc, held);
    return;
  }

  const outs = el(doc, 'div', `wft-outs${once ? ' is-one' : ''}`);
  const out = (label, v, sideKey) => {
    const c = el(doc, 'section', 'card wft-card wft-out-card');
    const h = el(doc, 'h2', '', wrote(label));
    h.id = `wft-out-${sideKey}`;
    c.setAttribute('aria-labelledby', h.id);
    const ch = el(doc, 'div', 'wft-card-head');
    ch.append(h);
    if (v && v.text) {   // C10
      ch.append(act(doc, root, runId, 'Read the whole result', () => actions.readWhole(v.tryId, wrote(label)), 'wft-linkbtn', `wft-sbs-read-${sideKey}`,
        { busy: true, busyKey: `wft-sbs-read-${sideKey}-${v.tryId}` }));
    }
    c.append(ch);
    if (!v) c.append(el(doc, 'p', 'hint', 'No try of this version here.'));
    else if (!v.text) c.append(el(doc, 'p', 'hint', 'This try left no result.'));
    else {
      c.append(resultInto(el(doc, 'div', 'wft-out'), v.text, renderMarkdown));
      if (v.truncated) c.append(el(doc, 'p', 'hint', 'Shortened here: read the whole result.'));
    }
    return c;
  };
  // Board 36: what one project try changed. The files are buttons; the picked one's diff shows below the list (read once
  // per try through actions.loadChanges; the page repaints when it lands).
  const changesCard = (label, v, key) => {
    const c = el(doc, 'section', 'card wft-card wft-chgcard');
    const h = el(doc, 'h2', '', changesTitle(label));
    h.id = `wft-chg-${key}`;
    c.setAttribute('aria-labelledby', h.id);
    const ch = v.project.changes || { files: [], total: 0, counts: { added: 0, changed: 0, removed: 0 } };
    const head = el(doc, 'div', 'wft-chg-head');
    head.append(h, el(doc, 'span', 'hint', changeCountText(ch.counts)));
    c.append(head);
    const files = Array.isArray(ch.files) ? ch.files : [];
    if (!files.length) return c;
    const sel = picked[key] && files.some((f) => f.path === picked[key]) ? picked[key] : files[0].path;
    const regionId = `wft-diff-${key}`;
    const ul = el(doc, 'ul', 'wft-files-list');
    ul.setAttribute('aria-label', `Files ${label} changed`);
    for (const f of files) {
      const li = el(doc, 'li');
      const b = btn(doc, null, () => actions.pickFile(key, f.path), `wft-fbtn${f.path === sel ? ' is-sel' : ''}`);
      b.setAttribute('aria-pressed', f.path === sel ? 'true' : 'false');
      b.setAttribute('aria-controls', regionId);
      b.dataset.focusKey = `wft-f-${key}-${f.path}`;
      b.append(el(doc, 'span', BADGE_CLASS[f.status] || 'badge', FILE_BADGE[f.status] || FILE_BADGE.changed), el(doc, 'span', 'p', f.path));
      li.append(b);
      ul.append(li);
    }
    c.append(ul);
    const more = Number(ch.total) - files.length;   // D67: the list keeps the first 50 files
    if (more > 0) c.append(el(doc, 'p', 'hint wft-chg-more', moreFilesText(more)));
    const patch = patches.get(v.tryId);
    if (patch === undefined) actions.loadChanges(v.tryId);
    const region = el(doc, 'div', 'wft-diff');
    region.id = regionId;
    region.setAttribute('role', 'region');
    region.setAttribute('aria-label', `Changes in ${sel}, ${label}`);
    region.tabIndex = 0;   // it scrolls sideways: the keys reach it
    region.append(el(doc, 'span', 'wft-diff-cap', sel));
    const section = typeof patch === 'string' && patch ? splitPatchSections(patch).find((x) => x.path === sel) : null;
    const parsed = section ? parseFileSection(section.raw) : null;
    if (parsed && parsed.binary) region.append(el(doc, 'span', 'wft-diff-note', BINARY_FILE_TEXT));
    else if (parsed && parsed.hunks.length) {
      let n = 0;
      let cut = parsed.truncated;
      for (const [k, hk] of parsed.hunks.entries()) {
        for (const [j, line] of hk.lines.entries()) {
          if (n >= DIFF_LINES_MAX) { cut = true; break; }
          n += 1;
          // Text, never markup: a diff line is the project's data.
          const lead = line.kind === 'add' ? '+ ' : line.kind === 'del' ? '- ' : '  ';
          const row = el(doc, 'span', `wft-dl ${line.kind}`, `${lead}${line.text}`);
          if (k > 0 && j === 0) row.classList.add('is-hunk');   // a gap in the file: a rule above the next part
          region.append(row);
        }
        if (n >= DIFF_LINES_MAX && k < parsed.hunks.length - 1) { cut = true; break; }
      }
      if (cut) region.append(el(doc, 'span', 'wft-diff-note', DIFF_SHORTENED_TEXT));
    } else {
      region.append(el(doc, 'span', 'wft-diff-note', patch === undefined ? READING_CHANGES : patch === null ? CHANGES_UNREAD_TEXT
        : patch === '' ? NO_DIFF_TEXT : NO_FILE_DIFF_TEXT));
    }
    const all = act(doc, root, runId, READ_ALL_CHANGES, () => actions.readChanges(v.tryId, changesTitle(label)), 'wft-linkbtn', `wft-chg-all-${key}`,
      { busy: true, busyKey: `wft-chg-all-${key}-${v.tryId}` });
    all.setAttribute('aria-label', `${READ_ALL_CHANGES}, ${label}`);
    const foot = el(doc, 'div', 'wft-chg-foot');
    foot.append(all);
    c.append(region, foot);
    return c;
  };
  // Board 31: each column is what that version wrote, then what it would have sent. Boards 36, 37: a project try's column
  // is what it changed, then what it wrote (only when it left a result, P7), then what it would have sent. Board 47
  // (U-T12): then what Worca asked; when neither version asked anything there is no Questions block, and a try older
  // than the list (no `asked`) has none, as we do not know.
  const knows = (v) => !!v && Array.isArray(v.asked);
  const anyAsked = [once ? null : cur.a, cur.b].some((v) => knows(v) && v.asked.length > 0);
  const column = (label, v, key) => {
    const col = el(doc, 'div', 'wft-outcol');
    const project = !!(v && v.project);
    if (project) col.append(changesCard(label, v, key));
    if (!project || v.text) col.append(out(label, v, key));
    const sent = sentCard(doc, v, key, { project: !!s.nothingPushed });
    if (sent) col.append(sent);
    if (anyAsked && knows(v)) col.append(questionsCard(doc, v.asked, key));
    return col;
  };
  if (!once) outs.append(column(s.labels.a, cur.a, 'a'));
  outs.append(column(s.labels.b, cur.b, 'b'));
  page.append(outs);

  const sec = el(doc, 'section', 'card wft-table wft-checked');
  sec.setAttribute('aria-label', `What was checked in try ${cur.n}`);
  const scroll = el(doc, 'div', 'wft-scroll');
  const inner = el(doc, 'div', `wft-crows${once ? ' is-one' : ''}`);
  const cls = once ? 'wft-crow is-one' : 'wft-crow';
  const hr = el(doc, 'div', `${cls} is-head`);
  hr.append(el(doc, 'span', '', 'What was checked'));
  if (!once) hr.append(el(doc, 'span', '', `${s.labels.a} · try ${cur.n}`));
  hr.append(el(doc, 'span', '', `${s.labels.b} · try ${cur.n}`));
  inner.append(hr);
  const cell = (v, key, label, column) => {
    const it = v && v.verdict ? (v.verdict[key] || []).find((x) => x.label === label) : null;
    const span = el(doc, 'span', 'wft-res');
    span.dataset.label = column;   // H2: on a phone each version's cell is its own line, named (style.css .wft-crow [data-label])
    if (!it) { span.classList.add('is-none'); span.textContent = '—'; return span; }
    if (!it.met) span.classList.add('is-bad');
    const d = el(doc, 'span', `wft-dot ${it.met ? 'ok' : 'no'}`);
    d.setAttribute('aria-hidden', 'true');
    span.append(d, doc.createTextNode(it.value));
    // Final review UI 7: met or not met never by colour alone (the dot is hidden, red is colour): hidden words, unless the
    // value says it already ("Met", "Not met").
    if (!/^(not )?met\b/i.test(String(it.value ?? ''))) span.append(el(doc, 'span', 'sr-only', it.met ? ' · met' : ' · not met'));
    return span;
  };
  for (const [title, key] of [['Basics', 'basics'], ['Automatic checks', 'checks']]) {
    const labels = [];
    for (const v of [cur.a, cur.b]) for (const it of (v && v.verdict && v.verdict[key]) || []) if (!labels.includes(it.label)) labels.push(it.label);
    if (!labels.length) continue;
    inner.append(el(doc, 'div', 'wft-crow-grp', title));
    for (const label of labels) {
      const row = el(doc, 'div', cls);
      // Final review M5: a check is set in code, as the editor writes it (checkWords), from the kind and the values its result
      // carries (result.mjs checkTry); 3b adds the folders and patterns of the file-scope checks. An older try shows its label.
      const worded = (x) => x && x.label === label && ((x.kind === 'command' && typeof x.cmd === 'string')
        || (x.kind === 'under' && Array.isArray(x.dirs)) || (x.kind === 'unchanged' && Array.isArray(x.patterns)));
      const check = key === 'checks' ? [cur.a, cur.b].flatMap((v) => (v && v.verdict && v.verdict.checks) || []).find(worded) || null : null;
      row.append(check ? checkWords(doc, check, label) : el(doc, 'span', '', label));
      if (!once) row.append(cell(cur.a, key, label, `${s.labels.a} · try ${cur.n}`));
      row.append(cell(cur.b, key, label, `${s.labels.b} · try ${cur.n}`));
      // Board 36: a command not met says so under its row, and opens its output (the last 40 lines; P6: no "Failed:" line).
      if (key === 'checks') {
        for (const [side, vl, v] of [['a', s.labels.a, once ? null : cur.a], ['b', s.labels.b, cur.b]]) {
          const it = v && v.verdict ? (v.verdict.checks || []).find((x) => x.label === label) : null;
          // U4 (D82, board 44): met although the command ended with an error: a neutral note in the red box's place, never the box.
          if (it && it.met && it.metWhy && it.metWhy.why === 'nothing-broke') {
            const note = el(doc, 'div', 'wft-met-note');
            note.append(el(doc, 'b', '', metFor(inSentence(vl))), doc.createTextNode(MET_DESPITE_TEXT));
            row.append(note);
            continue;
          }
          // U4: a "breaks nothing" check says why it was not met, also when the command passed and kept no output (a runner
          // that threw never ran it: no reason to give, as in 3a).
          if (!it || it.met || (typeof it.output !== 'string' && !it.timedOut && !(it.metWhy && !it.worcaProblem))) continue;
          const why = el(doc, 'div', 'wft-why-cmd');
          const words = el(doc, 'span');
          words.append(el(doc, 'b', '', notMetFor(inSentence(vl))),
            doc.createTextNode(it.metWhy ? metWhyText(it.metWhy) : it.timedOut ? COMMAND_TIMED_OUT : COMMAND_ENDED));
          const col = el(doc, 'span', 'wft-why-col');
          col.append(words);
          if (Array.isArray(it.failed) && it.failed.length) col.append(failedLine(doc, it));   // P45
          why.append(col);
          if (typeof it.output === 'string' && it.output.trim()) {
            why.append(act(doc, root, runId, SEE_COMMAND_OUTPUT, () => actions.commandOutput(`${it.label} · ${vl}`, it.output), 'btn btn-sm',
              `wft-cmd-out-${side}-${it.id || label}`));
          }
          row.append(why);
        }
        // U1 (board 40): the command before and after the change, per version, after the red "Not met" boxes.
        for (const [vl, v] of [[s.labels.a, once ? null : cur.a], [s.labels.b, cur.b]]) {
          const it = v && v.verdict ? (v.verdict.checks || []).find((x) => x.label === label) : null;
          if (it && it.kind === 'command' && it.before) row.append(beforeBlock(doc, vl, it.before));
        }
      }
      inner.append(row);
    }
  }
  scroll.append(inner);
  sec.append(scroll);
  page.append(sec);
  // Why a Basic was not met (a failed step, a question asked), as the server words it.
  for (const [label, v] of [[s.labels.a, cur.a], [s.labels.b, cur.b]]) {
    for (const it of (v && v.verdict && v.verdict.basics) || []) if (!it.met && it.detail) page.append(el(doc, 'p', 'hint wft-detail-why', `${label}: ${it.detail}`));
  }
  if (s.start) page.append(devCard(doc, s, cur, once, dateText));   // board 36
  root.append(page, live);
  const said = s.tries.length > 1 ? `Try ${cur.n} of ${s.tries.length}` : '';
  if (live.textContent !== said) live.textContent = said;   // only a change is news
  giveFocusBack(root, doc, held);
}

/** P45: board 36's "Failed: <file> · "<test>"" line: up to three names the command's output gave, then "and N more". */
function failedLine(doc, it) {
  const line = el(doc, 'span', 'wft-failed-line');
  line.append(doc.createTextNode(FAILED_LEAD));
  const shown = it.failed.slice(0, 3);
  shown.forEach((name, i) => {
    if (i) line.append(doc.createTextNode('; '));
    const { file, test } = splitTestName(name);
    if (file) line.append(el(doc, 'span', 'code', file), doc.createTextNode(` · "${test}"`));
    else line.append(doc.createTextNode(`"${test}"`));
  });
  const more = Number(it.failedCount || it.failed.length) - shown.length;
  if (more > 0) line.append(doc.createTextNode(` ${moreNamesText(more)}`));
  return line;
}

/** U1 (board 40 and its polish): the command before and after the change, for one version's try (before-after.mjs). The
 *  first 5 names, then "and N more"; each count in bold; a line that says something broke is red, and so is the block. */
function beforeBlock(doc, label, b) {
  const fewer = (c) => !!(c && c.before && c.after && typeof c.before.passed === 'number' && typeof c.after.passed === 'number' && c.after.passed < c.before.passed);
  const skips = (c) => (c && c.before && c.after ? [c.before.skipped || 0, c.after.skipped || 0] : null);
  const moreSkipped = (c) => { const s = skips(c); return !!s && s[1] > s[0]; };   // commandMet's 'more-skipped'
  // A cut list proves nothing went missing (commandMet): its "no longer run" is neither red nor said.
  const lost = !b.truncated && !!(b.lostPass && b.lostPass.n > 0);
  const exitBroke = b.beforeOk && !b.beforeTimedOut && !b.afterOk;
  const bad = !!b.ran && ((b.level === 'tests' && (b.broke.n > 0 || lost))
    || (b.level === 'failures' && (b.failingNow.n > 0 || fewer(b.counts) || moreSkipped(b.counts)))
    || (b.level === 'exit' && exitBroke));
  const box = el(doc, 'div', `wft-before${bad ? ' is-bad' : ''}`);
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', `${BEFORE_HEADING} · ${label}`);
  box.append(el(doc, 'span', 'wft-before-h', `${BEFORE_HEADING} · ${label}`));
  if (!b.ran) { box.append(el(doc, 'span', '', beforeNotRunText(b))); return box; }
  const row = (key, group, { red = false, rest = '' } = {}) => {
    const r = el(doc, 'span', `wft-before-row${red ? ' wft-before-broke' : ''}`);
    r.append(doc.createTextNode(`${BEFORE_GROUPS[key]}: `), el(doc, 'b', 'wft-before-n', String(group.n)));
    if (rest) r.append(doc.createTextNode(rest));
    const names = Array.isArray(group.names) ? group.names.slice(0, 5) : [];
    if (names.length) {
      r.append(doc.createTextNode(` · ${names.map((nm) => `"${nm}"`).join(', ')}`));
      const more = group.n - names.length;
      if (more > 0) r.append(doc.createTextNode(` ${moreNamesText(more)}`));
    }
    return r;
  };
  if (b.level === 'tests') {   // polish 1: broke first
    box.append(row('broke', b.broke, { red: b.broke.n > 0 }), row('madePass', b.madePass), row('stillPass', b.stillPass));
    if (b.stillFailing.n) box.append(row('stillFailing', b.stillFailing));
    if (b.added.n) box.append(row('added', { n: b.added.n }, { rest: addedRest(b.added.failing) }));
    if (b.truncated) box.append(el(doc, 'span', 'hint', TESTS_CUT_NOTE));
    else if (b.gone.n) box.append(row('gone', b.gone, { red: lost }));
  } else if (b.level === 'failures') {
    box.append(row('failingNow', b.failingNow, { red: b.failingNow.n > 0 }), row('noLongerFail', b.noLongerFail));
    if (b.stillFailing.n) box.append(row('stillFailing', b.stillFailing));
    const c = b.counts;
    if (c && c.before && c.after) {
      box.append(el(doc, 'span', `wft-before-row${fewer(c) ? ' wft-before-broke' : ''}`, passedCountsText(c.before.passed, c.after.passed)));
      const [sb, sa] = skips(c);
      if (sb || sa) box.append(el(doc, 'span', `wft-before-row${sa > sb ? ' wft-before-broke' : ''}`, skippedCountsText(sb, sa)));
    }
    box.append(el(doc, 'span', 'hint', FAILURES_ONLY_NOTE));
  } else {
    box.append(el(doc, 'span', exitBroke ? 'wft-before-broke' : '', beforeExitText(b)), el(doc, 'span', 'hint', EXIT_ONLY_NOTE));   // polish 3
  }
  return box;
}

/** "Read the whole result" (C10): the main result in full, in a large dialog. */
export function openWholeResult({ doc, win, title, name = null, text = null, renderMarkdown = null }) {
  const dlg = createDialog({ doc, win, width: 'lg', kind: 'viewer' });
  const h = el(doc, 'h2', 'mk-dialog-title', title);
  h.id = 'mk-dialog-title';
  const body = [];
  if (name) body.push(el(doc, 'p', 'hint', name));
  if (!text) body.push(el(doc, 'p', 'hint', 'This try left no result.'));
  else body.push(renderMarkdown ? resultInto(el(doc, 'div', 'wft-whole'), text, renderMarkdown) : el(doc, 'pre', 'wft-whole', text));
  dlg.replace({ head: [h], body, foot: [btn(doc, 'Close', () => dlg.close(), 'btn')] });
  dlg.open();
  return dlg;
}

/**
 * U-T6 (F12, D6): "Try 3 more" asks before it spends. Reads the plan for this example at tries+3 (capped at MAX_TRIES), reusing
 * the tries made on both sides, and confirms with the cost. Resolves {tries, capUsd} to start with, or null when the person
 * cancels (no POST). The cap is the test's own, or the dialog's default when the new spend would pass it.
 */
export async function askMoreTries({ run, labels, exampleId, exampleName, loadPlan, confirm }) {
  const tries = Math.min(MAX_TRIES, run.tries + 3);
  const q = { examples: String(exampleId), tries: String(tries), connectors: run.connectors === 'real' ? 'real' : 'pretend' };
  if (run.a != null) q.a = String(run.a);
  q.b = String(run.b);
  let plan = null;
  try { plan = await loadPlan(q); } catch { plan = null; }
  const est = plan ? estimateOf(plan, { reuseA: true, reuseB: true }) : null;
  const extra = tries - run.tries;
  const n = est && est.total ? est.total : extra * (run.a != null ? 2 : 1);
  const cap = est && est.usd !== null && !(est.usd <= run.capUsd) ? est.capUsd : (run.capUsd ?? (est ? est.capUsd : 10));
  const versions = labels.a && run.a != null ? `${labels.b} and ${labels.a}` : labels.b;
  const cost = est && est.usd !== null ? `about ${aboutUsd(est.usd)}` : 'the cost is not known yet';   // an estimate: the page's "about"
  // U-T8: the ten-try ceiling may let only 1 or 2 more run on each version: the title says so.
  const ok = await confirm({ title: `Try ${exampleName} ${extra} more ${extra === 1 ? 'time' : 'times'}?`,
    message: `${n} more ${n === 1 ? 'try' : 'tries'} of ${versions}: ${cost}. The test stops if the cost goes over ${fmtUsd(cap)}.`,
    confirmLabel: `Start ${n} ${n === 1 ? 'try' : 'tries'}`, cancelLabel: 'Cancel' });
  return ok ? { tries, capUsd: cap } : null;
}

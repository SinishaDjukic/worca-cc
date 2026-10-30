// ui/public/workflows/tests-view.mjs — the Tests page of a workflow (plans/workflow-tests-part2-plan.md Task 10): the list
// of examples (canvas board 1) and first use (board 19). 3a (boards 38, 39; D62): every workflow can be tested, so an
// example's row says which project it works on, where it starts and whether a test leaves it out.
// Pure DOM: app.js owns data and actions.
import { el, btn, iconBtn, BUSY_HINT, runStatusBadge, refusedRun } from './test-ui.mjs';
import { withButton } from '../feedback.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { agoText, countsText } from '../../../src/shared/workflow-tests/compare.mjs';
import { NO_PROJECT_YET_HINT, WITH_CHANGES_HINT, MOVED_BADGE, behindText, PICK_FIRST_TEXT, CANT_TRY_TEXT, LIST_FOOT_HINT, firstUseNoneText,
  refusedRunsCount }
  from '../../../src/shared/workflow-tests/project-text.mjs';

export const HOW_HIDDEN_KEY = 'worca.workflowTests.howHidden';
const HOW = Object.freeze({
  collect: 'Real requests this workflow gets. Add one from a past run, or write one.',
  collectFirst: 'Real requests this workflow gets. Start below with past runs.',
  needs: 'Pick the Basics it must meet and add automatic checks, for example "has the sections Problem and Risks".',   // C1
  test: 'Worca tries every example 3 times and shows what got better or worse.',
});
const defaultDate = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};
const howHidden = (storage) => { try { return !!storage && storage.getItem(HOW_HIDDEN_KEY) === '1'; } catch { return false; } };
/** Keep the focus inside the page (#wfv-tests, tabindex -1, the canvas-keys fence) when what held it went away. */
const holdFocus = (root, doc) => { if (!root.contains(doc.activeElement)) root.focus({ preventScroll: true }); };
const hideHow = (storage) => { try { if (storage) storage.setItem(HOW_HIDDEN_KEY, '1'); } catch { /* blocked storage: it shows again next time */ } };

function howCard(doc, { first, onHide }) {
  const c = el(doc, 'section', 'card wft-how');
  let head = null;
  if (first) c.setAttribute('aria-label', 'How testing works');   // board 19: no heading, no Hide
  else {
    head = el(doc, 'div', 'wft-how-head');
    const h = el(doc, 'h2', '', 'How testing works');
    h.id = 'wft-how-h';
    c.setAttribute('aria-labelledby', h.id);
    head.append(h);
    if (onHide) head.append(btn(doc, 'Hide', onHide));
  }
  const steps = el(doc, 'div', 'wft-steps');
  [['Collect examples', first ? HOW.collectFirst : HOW.collect], ['Say what a good result needs', HOW.needs], ['Test a new version', HOW.test]]
    .forEach(([bold, text], i) => {
      const st = el(doc, 'div', 'wft-step');
      const words = el(doc, 'div');
      words.append(el(doc, 'b', '', bold), el(doc, 'span', '', text));
      st.append(el(doc, 'span', 'wft-step-dot', String(i + 1)), words);   // a round mark: `-dot` (the radius rule's ROUND)
      steps.append(st);
    });
  if (head) c.append(head);
  c.append(steps);
  return c;
}

/** What follows an example's start: where it came from, its note (Part 2; a project example too, after its start point). */
const hintTail = (e, dateText) => [e.hasRequest && e.fromAt ? `from a run on ${dateText(e.fromAt)}` : null, e.hasRequest && e.note ? e.note : null]
  .filter(Boolean).map((x) => ` · ${x}`).join('');

/** The hint under an example's name: what it has, where it came from, its note. */
export function exampleHint(e, { dateText = defaultDate } = {}) {
  return `${!e.hasRequest ? 'No request yet' : e.files && e.files.length ? `Request + ${e.files.join(', ')}` : 'Request only'}${hintTail(e, dateText)}`;
}

/** Board 38: the hint under an example's name, with its project and start point; an example left out says so. */
export function exampleHintEl(doc, e, { dateText = defaultDate } = {}) {
  const h = el(doc, 'span', 'hint');
  if (e.reason === 'pick-project') { h.textContent = NO_PROJECT_YET_HINT; return h; }
  if (!e.project) { h.textContent = exampleHint(e, { dateText }); return h; }
  const lead = !e.hasRequest ? 'No request yet' : e.files && e.files.length ? `Request + ${e.files.join(', ')}` : 'Request';
  h.append(doc.createTextNode(`${lead} · ${e.project.name} · from `), el(doc, 'span', 'code', e.project.short));
  if (e.project.changes) h.append(doc.createTextNode(WITH_CHANGES_HINT));
  const tail = hintTail(e, dateText);   // the run it came from and its note, as Part 2 says them
  if (tail) h.append(doc.createTextNode(tail));
  return h;
}

/** A result cell (C14): "3 of 3 passed" with a dot (green all, grey some, red none), a past verdict (D29), "Not tried". */
export function cellView(doc, cell) {
  const span = el(doc, 'span', 'wft-res');
  if (!cell) { span.classList.add('is-none'); span.textContent = 'Not tried'; return span; }
  const dot = (tone) => { const d = el(doc, 'span', `wft-dot ${tone}`); d.setAttribute('aria-hidden', 'true'); return d; };
  if (cell.past) {
    if (cell.past !== 'good') span.classList.add('is-bad');
    span.append(dot(cell.past === 'good' ? 'ok' : 'no'), doc.createTextNode(cell.past === 'good' ? 'Good · a past run' : 'Not good · a past run'));
    return span;
  }
  const tone = cell.passed === cell.total ? 'ok' : cell.passed === 0 ? 'no' : 'mix';
  if (tone === 'no') span.classList.add('is-bad');
  if (cell.stale) span.classList.add('is-stale');
  span.append(dot(tone), doc.createTextNode(`${cell.passed} of ${cell.total} passed${cell.stale ? ' · before a change' : ''}`));
  return span;
}

function latestCard(doc, l, actions, now) {
  const c = btn(doc, null, () => actions.openLatest(l.runId), 'card wft-latest');
  const main = el(doc, 'span', 'wft-latest-main');
  const meta = el(doc, 'span', 'hint', `${agoText(l.finishedAt, now)} · ${countsText(l.examples, l.tries)} · cost `);
  meta.append(el(doc, 'span', 'code', fmtUsd(l.costUsd)));
  main.append(el(doc, 'span', 'wft-latest-title', l.title), meta);
  const badges = el(doc, 'span', 'wft-badges');
  badges.append(el(doc, 'span', 'badge green', `${l.counts.better} better`), el(doc, 'span', 'badge red', `${l.counts.worse} worse`),
    el(doc, 'span', 'badge', `${l.counts.same} same`));
  if (l.status === 'stopped') badges.append(el(doc, 'span', 'badge', 'Stopped early'));
  c.append(main, badges, el(doc, 'span', 'wft-link', 'See what changed'));
  return c;
}

function table(doc, o, actions, dateText) {
  const sec = el(doc, 'section', 'card wft-table');
  sec.setAttribute('aria-label', 'Test examples');
  const scroll = el(doc, 'div', 'wft-scroll');
  const grid = el(doc, 'div', `wft-grid${o.columns.length === 1 ? ' is-one' : ''}`);
  const head = el(doc, 'div', 'wft-row wft-row-head');
  head.append(el(doc, 'span', '', 'Example'), el(doc, 'span', '', 'What is checked'), ...o.columns.map((c) => el(doc, 'span', '', c.label)), el(doc, 'span', ''));
  grid.append(head);
  for (const e of o.examples) {
    const row = el(doc, 'div', 'wft-row');
    const name = el(doc, 'span', 'wft-ex');
    name.append(btn(doc, e.name, () => actions.openExample(e.id), 'wft-ex-open'), exampleHintEl(doc, e, { dateText }));
    if (e.project && e.project.behind > 0 && e.project.startRef) {   // board 38: the branch moved on (D63)
      const moved = el(doc, 'span', 'wft-moved-line');
      moved.append(el(doc, 'span', 'badge amber', MOVED_BADGE), el(doc, 'span', '', behindText(e.project.behind, e.project.startRef)));
      name.append(moved);
    }
    // P27, P33: left out for another reason than "no project yet" (its folder is missing, a Folder project, no longer
    // registered): the row says why, in the server's words (board 39's cards).
    const blocked = e.ready === false && e.reason !== 'pick-project';
    if (blocked && e.readyText) name.append(el(doc, 'span', 'hint wft-left-line', e.readyText));
    const kinds = el(doc, 'span', 'wft-kinds');
    kinds.append(el(doc, 'span', 'wft-kind', `Basics ${e.basics}`));
    if (e.checks) kinds.append(el(doc, 'span', 'wft-kind', `Automatic ${e.checks}`));
    const more = iconBtn(doc, 'more', `More for ${e.name}`, null, 'btn btn-sm btn-quiet btn-icon wft-more');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => actions.exampleMenu(more, e));
    // H1: each result names its column, for the stacked phone layout (style.css .wft-row [data-label]).
    const results = o.columns.map((c) => {   // D62, board 38: an example a test leaves out has no result
      const v = e.ready === false ? el(doc, 'span', 'wft-res is-none', blocked ? CANT_TRY_TEXT : PICK_FIRST_TEXT) : cellView(doc, e.cells[String(c.use)] || null);
      v.dataset.label = c.label;
      return v;
    });
    row.append(name, kinds, ...results, more);
    grid.append(row);
  }
  scroll.append(grid);
  sec.append(scroll);
  return sec;
}

function list(doc, page, o, actions, { root, storage, dateText, now }) {
  const head = el(doc, 'div', 'wft-head');
  const acts = el(doc, 'div', 'wft-acts');
  const testBtn = btn(doc, 'Test a version', () => actions.testVersion(), 'btn btn-primary');
  testBtn.dataset.focusKey = 'wft-test-version';   // the Test a version dialog's focusBack finds it after a repaint
  const fromRun = btn(doc, 'Add from a past run', () => actions.addFromRun(), 'btn');
  fromRun.dataset.focusKey = 'wft-add-from-run';   // the G7 dialog's focusBack finds it after a repaint (layers.mjs refind)
  acts.append(fromRun, btn(doc, 'New example', () => actions.newExample(), 'btn'), testBtn);
  head.append(el(doc, 'p', 'subtitle', 'Test examples show what this workflow must do well. Before you share a change, try it on the examples and see what got better or worse.'), acts);
  if (o.running) {   // G19, D37: one test per workflow at a time
    testBtn.disabled = true;
    testBtn.setAttribute('aria-describedby', 'wft-busy');
    const busy = el(doc, 'p', 'hint wft-busy', BUSY_HINT);
    busy.id = 'wft-busy';
    head.append(busy);
  }
  page.append(head);
  if (!howHidden(storage)) {
    const how = howCard(doc, { first: false, onHide: () => { hideHow(storage); how.remove(); holdFocus(root, doc); } });
    page.append(how);
  }
  if (o.running) {
    const r = btn(doc, null, () => actions.openRun(o.running.runId), 'card wft-latest wft-running');
    const main = el(doc, 'span', 'wft-latest-main');
    main.append(el(doc, 'span', 'wft-latest-title', `${o.running.title} · ${o.running.done} of ${o.running.total} tries done`),
      el(doc, 'span', 'hint', 'Worca tells you when the results are ready.'));
    const dot = el(doc, 'span', 'wft-run-dot');   // peach = running (board 26); round: `-dot`
    dot.setAttribute('aria-hidden', 'true');
    r.append(dot, main, el(doc, 'span', 'wft-link', 'See progress'));
    page.append(r);
  }
  if (o.latest) page.append(latestCard(doc, o.latest, actions, now));
  page.append(table(doc, o, actions, dateText));
  const foot = el(doc, 'p', 'hint wft-foot');
  foot.append(el(doc, 'b', '', 'Why 3 tries?'), doc.createTextNode(' AI can give a different answer each time, so one good try can be luck. A try passes when everything checked is met.'));
  page.append(foot);
  if (o.examples.some((e) => e.project)) page.append(el(doc, 'p', 'hint wft-foot-start', LIST_FOOT_HINT));   // board 38
}

function firstUse(doc, page, o, actions, { dateText }) {
  const head = el(doc, 'div', 'wft-first-head');
  head.append(el(doc, 'h2', 'wft-title', 'Test this workflow before you change it'),
    el(doc, 'p', 'subtitle', 'Test examples are real requests with a note on what a good result needs. Once you have a few, every change can be tried on them, so you see what got better or worse before your team does.'));
  page.append(head, howCard(doc, { first: true, onHide: null }));
  const pick = el(doc, 'section', 'card wft-pick');
  const h = el(doc, 'h2', '', 'Start with past runs');
  h.id = 'wft-pick-h';
  pick.setAttribute('aria-labelledby', h.id);
  const runs = o.pastRuns || [];
  const refused = runs.filter((r) => r.refusal).length;   // P34: listed, but not usable
  pick.append(h, el(doc, 'p', 'hint', runs.length
    ? `Worca found ${runs.length} recent ${runs.length === 1 ? 'run' : 'runs'} of ${o.name}${refused ? refusedRunsCount(refused) : ''}. Pick different kinds of requests, and include ones where the result was not good: they show what must improve.`
    : firstUseNoneText(o.name, { needsProject: !!o.needsProject })));   // board 39 (P16)
  const boxes = [];
  let ticked = 0;
  for (const r of runs) {
    const row = el(doc, 'label', 'wft-pick-row');
    const box = el(doc, 'input', 'wft-pick-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: picks runs
    box.type = 'checkbox';
    box.value = r.pipelineId;
    box.checked = !r.refusal && !r.sameAs && ticked < 3;
    if (box.checked) ticked += 1;
    const text = el(doc, 'span', 'wft-pick-text');
    const detail = [r.project, dateText(r.at), r.files ? (r.files === 1 ? '1 file' : `${r.files} files`) : null,
      r.sameAs ? `the same request as "${r.sameAs}"` : null].filter(Boolean).join(' · ');
    text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${detail}`));
    // Board 39: a Folder or workspace run is listed, but cannot be picked.
    if (r.refusal) refusedRun(doc, { row, input: box, text, reason: r.refusalText, id: `wft-pick-why-${boxes.length}` });
    row.append(box, text, runStatusBadge(doc, r));
    pick.append(row);
    boxes.push(box);
  }
  page.append(pick);
  const foot = el(doc, 'div', 'wft-first-foot');
  const hint = el(doc, 'span', 'hint');
  hint.append(doc.createTextNode('3 to 10 examples are a good start. You add what a good result needs in the next step. '),
    btn(doc, 'Or write an example yourself', () => actions.newExample(), 'wft-linkbtn'));
  const picked = () => boxes.filter((b) => b.checked && !b.disabled).map((b) => b.value);
  // One post at a time: busy (disabled) until the action answers {ok}; a refusal gives the button back (feedback.mjs).
  const add = btn(doc, '', async () => {
    await withButton(add, () => actions.addPastRuns(picked()), { busy: 'Adding…', done: 'Added', idleDisabled: () => !picked().length });
    paint();
  }, 'btn btn-primary');
  const paint = () => {
    if (add.dataset.fbState) return;   // busy or done: withButton owns the label, and paint() runs again after
    const n = picked().length;
    add.textContent = n === 1 ? 'Add 1 example' : `Add ${n} examples`;
    add.disabled = n === 0;
  };
  for (const b of boxes) b.addEventListener('change', paint);
  paint();
  foot.append(hint, add);
  page.append(foot);
}

/**
 * @param {HTMLElement} root
 * @param {object|null} o the overview (GET /api/workflows/:id/tests), null while loading or after an error
 * @param {object} actions see the Interfaces of Task 10
 */
export function renderTestsPage(root, o, actions, { doc, storage = null, loading = false, error = null, dateText = defaultDate, now = Date.now() } = {}) {
  const hadFocus = root.contains(doc.activeElement) && doc.activeElement !== root;
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page');
  if (!o && loading) {
    page.append(el(doc, 'p', 'hint', 'Reading the tests…'));
  } else if (!o) {
    const box = el(doc, 'div', 'card wft-empty');
    box.append(el(doc, 'h2', '', 'Tests are not available'), el(doc, 'p', 'hint', error || 'Worca did not answer.'));
    page.append(box);
  } else if (!o.examples.length) {
    firstUse(doc, page, o, actions, { dateText });
  } else {
    list(doc, page, o, actions, { root, storage, dateText, now });
  }
  root.append(page);
  if (hadFocus) holdFocus(root, doc);   // the repaint took the focused control: the page holds the focus
}

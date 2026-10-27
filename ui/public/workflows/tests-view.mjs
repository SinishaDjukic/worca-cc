// ui/public/workflows/tests-view.mjs — the Tests page of a workflow (plans/workflow-tests-part2-plan.md Task 10): the list
// of examples (canvas board 1), first use (board 19) and the sentence for a workflow that needs a project (D20, C8).
// Pure DOM: app.js owns data and actions.
import { el, btn, iconBtn, BUSY_HINT, runStatusBadge } from './test-ui.mjs';
import { withButton } from '../feedback.mjs';
import { fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { agoText, countsText } from '../../../src/shared/workflow-tests/compare.mjs';

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

/** The hint under an example's name: what it has, where it came from, its note. */
export function exampleHint(e, { dateText = defaultDate } = {}) {
  const parts = [!e.hasRequest ? 'No request yet' : e.files && e.files.length ? `Request + ${e.files.join(', ')}` : 'Request only'];
  if (e.hasRequest && e.fromAt) parts.push(`from a run on ${dateText(e.fromAt)}`);
  if (e.hasRequest && e.note) parts.push(e.note);
  return parts.join(' · ');
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
    name.append(btn(doc, e.name, () => actions.openExample(e.id), 'wft-ex-open'), el(doc, 'span', 'hint', exampleHint(e, { dateText })));
    const kinds = el(doc, 'span', 'wft-kinds');
    kinds.append(el(doc, 'span', 'wft-kind', `Basics ${e.basics}`));
    if (e.checks) kinds.append(el(doc, 'span', 'wft-kind', `Automatic ${e.checks}`));
    const more = iconBtn(doc, 'more', `More for ${e.name}`, null, 'btn btn-sm btn-quiet btn-icon wft-more');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => actions.exampleMenu(more, e));
    row.append(name, kinds, ...o.columns.map((c) => cellView(doc, e.cells[String(c.use)] || null)), more);
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
  pick.append(h, el(doc, 'p', 'hint', runs.length
    ? `Worca found ${runs.length} recent ${runs.length === 1 ? 'run' : 'runs'} of ${o.name}. Pick different kinds of requests, and include ones where the result was not good: they show what must improve.`
    : `Worca found no runs of ${o.name} without a project yet. Write an example yourself, or run the workflow once and come back.`));
  const boxes = [];
  let ticked = 0;
  for (const r of runs) {
    const row = el(doc, 'label', 'wft-pick-row');
    const box = el(doc, 'input', 'wft-pick-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: picks runs
    box.type = 'checkbox';
    box.value = r.pipelineId;
    box.checked = !r.sameAs && ticked < 3;
    if (box.checked) ticked += 1;
    const text = el(doc, 'span', 'wft-pick-text');
    const detail = [dateText(r.at), r.files ? (r.files === 1 ? '1 file' : `${r.files} files`) : null,
      r.sameAs ? `the same request as "${r.sameAs}"` : null].filter(Boolean).join(' · ');
    text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${detail}`));
    row.append(box, text, runStatusBadge(doc, r));
    pick.append(row);
    boxes.push(box);
  }
  page.append(pick);
  const foot = el(doc, 'div', 'wft-first-foot');
  const hint = el(doc, 'span', 'hint');
  hint.append(doc.createTextNode('3 to 10 examples are a good start. You add what a good result needs in the next step. '),
    btn(doc, 'Or write an example yourself', () => actions.newExample(), 'wft-linkbtn'));
  const picked = () => boxes.filter((b) => b.checked).map((b) => b.value);
  // One post at a time: busy (disabled) until the action answers {ok}; a refusal gives the button back (feedback.mjs).
  const add = btn(doc, '', async () => {
    await withButton(add, () => actions.addPastRuns(picked()), { busy: 'Adding…', done: 'Added', idleDisabled: () => !picked().length });
    paint();
  }, 'btn btn-primary');
  const paint = () => {
    if (add.dataset.fbState) return;   // busy or done: withButton owns the label, and paint() runs again after
    const n = boxes.filter((b) => b.checked).length;
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
  } else if (!o.testable) {
    const box = el(doc, 'div', 'card wft-empty wft-not-testable');
    box.append(el(doc, 'h2', '', 'Tests are for workflows without a project, for now'),
      el(doc, 'p', 'hint', "This workflow works on a project's code. Worca can test workflows that run without a project today; testing workflows that change a project comes next."));
    page.append(box);
  } else if (!o.examples.length) {
    firstUse(doc, page, o, actions, { dateText });
  } else {
    list(doc, page, o, actions, { root, storage, dateText, now });
  }
  root.append(page);
  if (hadFocus) holdFocus(root, doc);   // the repaint took the focused control: the page holds the focus
}

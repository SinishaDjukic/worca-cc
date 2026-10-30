// ui/public/workflows/test-dialogs.mjs — the workflow tests dialogs (plans/workflow-tests-part2-plan.md Tasks 12–13):
// pick a past run (G7), use this run as a test example (board 3), and test a version with its connectors (boards 4, 30). Pure DOM.
import { el, seg, field, testDialog, runStatusBadge, refusedRun } from './test-ui.mjs';
import { icon } from '../icons.mjs';
import { fmtUsd, andList, parseUsd } from '../../../src/shared/workflow-tests/checks.mjs';
import { estimateOf, fmtUsdRange, aboutUsd } from '../../../src/shared/workflow-tests/compare.mjs';
import { serverName } from '../../../src/shared/workflow-tests/connector-name.mjs';
import { allOnProject, leftOutText, leftOutBlockedText, NONE_READY_TEXT, LOCK_LEAD, LOCK_REST, REAL_BLOCKED_HINT, DISK_KEY, TIME_KEY, diskRow, aboutDuration, SETUP_TAKES_LEAD, setupTakesRest,
  pickerNoneText, fromRunIntro, WHERE_TITLE, STARTS_FROM_RUN, pastRunProjectNote, DEV_CAPTION, SETUP_LABEL, SETUP_HINT_PAST }
  from '../../../src/shared/workflow-tests/project-text.mjs';

/** Auto's id (src/core/graph/builtin-workflows.mjs AUTO_WORKFLOW_ID; the browser cannot load /src/core, and the dialogs
 *  test pins this to the server's constant). An Auto run that matched no saved workflow keeps it (auto/proposal.mjs). */
const AUTO_WORKFLOW_ID = 'wf_auto';

/** G6 (3a: a project run too): the run page's More menu offers "Use as test example" for a finished run without a project
 *  or a finished single-project git run (D65) of a saved user workflow. Folder and workspace runs are refused by the server,
 *  so the item is not offered for them. A plugin's workflow (`wfp_<plugin>_<slug>`, plugin-workflows.mjs) has no tests
 *  (review M7), nor has Auto when it matched no saved workflow: the item would only be refused. */
export function canUseAsExample({ flag, noProject, projectRun = false, status, templateId, reserved }) {
  return !!flag && (!!noProject || !!projectRun) && ['done', 'stopped', 'error'].includes(String(status || '')) && !!templateId && !reserved
    && templateId !== AUTO_WORKFLOW_ID && !/^wfp_/.test(String(templateId));
}

/** G7: the Tests list's "Add from a past run" — which run, then board 3. */
export function openPickRunDialog({ doc, win, workflowName, runs = [], dateText, onPick, needsProject = false }) {
  const body = [];
  if (!runs.length) {
    body.push(el(doc, 'p', 'hint', pickerNoneText(workflowName, { needsProject })));   // board 39 (P16)
  } else {
    body.push(el(doc, 'p', 'hint', `Pick a run of ${workflowName} to keep as an example.`));
    const list = el(doc, 'div', 'wft-pick-list');
    list.setAttribute('role', 'radiogroup');
    list.setAttribute('aria-label', 'Past runs');
    for (const r of runs) {
      const row = el(doc, 'label', 'wft-pick-row');
      const radio = el(doc, 'input');
      radio.type = 'radio'; radio.name = 'wft-pick-run'; radio.value = r.pipelineId;
      const text = el(doc, 'span', 'wft-pick-text');
      if (r.project || r.refusal) {   // boards 38, 39: the title and its badge, then the project and the date
        const top = el(doc, 'span', 'wft-pick-top');
        top.append(el(doc, 'b', '', r.title), runStatusBadge(doc, r));
        text.append(top, el(doc, 'span', 'wft-pick-sub', [r.project, dateText(r.at)].filter(Boolean).join(' · ')));
      } else {
        text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${dateText(r.at)} · `), runStatusBadge(doc, r));   // C11: an exactly equal request says so, as on the Tests page
      }
      row.append(radio, text);
      // Board 39: a Folder or workspace run is listed, disabled, with its reason.
      if (r.refusal) refusedRun(doc, { row, input: radio, text, reason: r.refusalText, id: `wft-pick-run-why-${list.children.length}` });
      list.append(row);
    }
    body.push(list);
  }
  const dlg = testDialog({
    doc, win, title: 'Add from a past run', confirmLabel: 'Next', body,
    onConfirm: () => {
      const hit = [...doc.querySelectorAll('input[name="wft-pick-run"]')].find((x) => x.checked && !x.disabled);
      if (!hit) return { ok: false, error: 'Pick a run first.' };
      onPick(hit.value);
      return { ok: true };
    },
  });
  if (!runs.length) dlg.okButton.disabled = true;   // board 25: nothing to pick
  return dlg;
}

function keepRow(doc, id, text, detail = null) {
  const l = el(doc, 'label', 'wft-chk');
  const box = el(doc, 'input', 'wft-keep-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: picks what to keep
  box.type = 'checkbox'; box.id = id; box.checked = true;
  const words = el(doc, 'span', 'wft-keep-text', text);   // one line of text that wraps beside the box (board 3)
  if (detail) words.append(el(doc, 'span', 'hint', detail));
  l.append(box, words);
  return { row: l, box };
}

/** Board 3: "Use this run as a test example" (C4: the verdict is the version's result until it is tested, D29). Board 38
 *  (D65): a project run's example starts where the run started, and its setup is filled in from the project's. */
export function openFromRunDialog({ doc, win, past, onSubmit, dateText = (s) => s }) {
  const name = el(doc, 'input');
  name.type = 'text'; name.id = 'wft-fr-name'; name.maxLength = 120; name.value = past.title || '';
  const nf = past.files.length;
  const nq = past.qa.length;
  const keep = el(doc, 'div', 'wft-keep');
  const keepLabel = el(doc, 'span', 'label', 'Keep from this run');
  keepLabel.id = 'wft-fr-keep-label';
  keep.setAttribute('role', 'group');
  keep.setAttribute('aria-labelledby', keepLabel.id);
  keep.append(keepLabel);
  const req = keepRow(doc, 'wft-fr-request', nf ? `The request and its ${nf === 1 ? 'file' : `${nf} files`} ` : 'The request',
    nf ? `(${past.files.join(', ')})` : null);
  keep.append(req.row);
  const ans = nq ? keepRow(doc, 'wft-fr-answers', nq === 1
    ? 'The question Worca asked and your answer, so the test can run without you'
    : `The ${nq} questions Worca asked and your answers, so the test can run without you`) : null;
  if (ans) keep.append(ans.row);
  let verdict = null;
  const hint = el(doc, 'p', 'hint wft-fr-hint');
  hint.hidden = true;
  hint.setAttribute('aria-live', 'polite');   // what the picked verdict means is announced
  const paintHint = () => {
    const v = past.useLabel;
    hint.textContent = verdict === 'not-good'
      ? `This result came from ${v} and was not good enough, so ${v} shows as not good on this example until it is tested.`
      : verdict === 'good' ? `This result came from ${v} and was good, so ${v} shows as good on this example until it is tested.` : '';
    hint.hidden = !verdict;
  };
  const how = seg(doc, 'How was this result', [['good', 'Good: keep it like this'], ['not-good', 'Not good enough']], null, (v) => { verdict = v; paintHint(); });
  const note = el(doc, 'textarea');
  note.id = 'wft-fr-note'; note.rows = 3; note.maxLength = 2000;
  let startBox = null;
  let setup = null;
  let devBox = null;
  if (past.project) {
    startBox = el(doc, 'div', 'wft-startbox');
    const where = el(doc, 'span');
    where.append(doc.createTextNode(STARTS_FROM_RUN), el(doc, 'b', '', past.project.startRef || past.project.short), doc.createTextNode(' at '),
      el(doc, 'span', 'code', past.project.short), doc.createTextNode(` · ${dateText(past.project.startAt)}`));
    startBox.append(el(doc, 'span', 'label', WHERE_TITLE), where, el(doc, 'span', 'hint', pastRunProjectNote(past.project.name)));
    setup = el(doc, 'input');
    setup.type = 'text'; setup.id = 'wft-fr-setup'; setup.className = 'wft-mono'; setup.maxLength = 4000; setup.value = past.project.setupCmd || '';
    devBox = el(doc, 'div', 'wft-dev');
    devBox.append(el(doc, 'span', 'wft-dev-cap', DEV_CAPTION), field(doc, SETUP_LABEL, setup, { id: setup.id, hint: SETUP_HINT_PAST }));
  }
  return testDialog({
    doc, win, title: 'Use this run as a test example', confirmLabel: 'Add example',
    body: [
      el(doc, 'p', 'wft-fr-intro', past.project ? fromRunIntro(past.workflowName)
        : `Worca keeps the request and files, so every new version of ${past.workflowName} can be tried on exactly the same thing.`),
      field(doc, 'Name of the example', name, { id: name.id }), ...(startBox ? [startBox] : []), keep, ...(devBox ? [devBox] : []),
      field(doc, 'How was this result?', how),
      field(doc, 'What should a good result have?', note, { id: note.id, opt: 'in your own words' }),
      hint,
    ],
    onConfirm: () => {
      if (!name.value.trim()) return { ok: false, error: 'Give the example a name.' };
      return onSubmit({ name: name.value.trim(), keepRequest: req.box.checked, keepAnswers: ans ? ans.box.checked : false, verdict,
        note: note.value.trim() || null, ...(setup ? { setupCmd: setup.value.trim() } : {}) });
    },
  });
}

// ── Test a version (boards 4, 30) ──

/** Board 30's sentences, copied from src/core/workflow-tests/connectors.mjs (the browser cannot load /src/core); the
 *  dialogs test pins them to the server's. */
export const engineNoteLine = (label) => `Steps on ${label} can still use connectors from ${label}'s own settings. Pretend can't stop those.`;
export const fileServerOffLine = (name) => `${name} is switched off: Worca can't pretend for servers from a project file.`;
const PREVIEW_ERROR_LINE = 'Worca could not list your connectors just now.';   // controller-approved copy (2026-10-27)

/**
 * C19: the script steps a try runs as in a normal run, in both modes. null when there is none. `quick` = the ones the
 * free quick check runs for real too (no mock of their own; final review M2), counted only while it is ticked.
 */
export function scriptCaution(names, quick = []) {
  if (!names || !names.length) return null;
  const inQuick = names.filter((n) => (quick || []).includes(n));
  const all = inQuick.length === names.length;
  const where = all ? 'every try and in the free quick check' : 'every try';
  const more = inQuick.length && !all ? { lead: ' The free quick check runs ', name: andList(inQuick), rest: ' as in a normal run too.' } : null;
  return names.length === 1
    ? { lead: 'The script step ', name: names[0], rest: ` runs as in a normal run. If it posts or sends something, it does it in ${where}.`, more }
    : { lead: 'The script steps ', name: andList(names), rest: ` run as in a normal run. If they post or send something, they do it in ${where}.`, more };
}
const useOfValue = (v) => (v === 'draft' ? 'draft' : Number(v));

/** Board 4's reuse sentence (C6 for a partial reuse). */
function reuseWords(s, other, dateText) {
  const when = s.reusableAt ? dateText(s.reusableAt) : 'earlier';
  const saves = typeof s.savesUsd === 'number' && s.savesUsd > 0 ? ` This saves about ${aboutUsd(s.savesUsd)}.` : '';
  const otherShort = other ? other.short : 'the other version';
  return s.reusable >= s.want
    ? { lead: `Use ${s.short}'s results from ${when}. `, rest: `Nothing in ${s.short} or in the examples has changed since, so only ${otherShort} needs to be tried.${saves}` }
    : { lead: `Use ${s.short}'s ${s.reusable} results from ${when}. `, rest: `Nothing in ${s.short} or in those examples has changed since, so only the other tries are made.${saves}` };
}

/** An opt-in row: the box, then one span of text that wraps beside it (the lead in ink, the rest as a hint). */
function optInRow(doc, box, lead, rest) {
  const row = el(doc, 'label', 'wft-chk wft-tv-chk');
  const words = el(doc, 'span', 'wft-keep-text', lead);
  words.append(el(doc, 'span', 'hint', rest));
  row.append(box, words);
  return row;
}

/**
 * Boards 4 and 30: Test a version (G10, G12, G16, C6, C12, C16, C19). The plan comes from the server per pick (loadPlan);
 * the estimate, the default cost cap, the connectors' notes and "Start N tries" follow it live.
 * 3a (board 34, D60, D62, P13, P14, P27, P28): `examples[].ready` false = left out (named under Examples, by `reason`), `projectName` = the
 * example's project; a plan with a project adds the disk and time rows and the lock line, and refuses too little free disk.
 */
export function openTestVersionDialog({ doc, win, options = [], a = null, b = 'draft', examples = [], exampleIds = null, connectors = 'pretend',
  dateText, loadPlan, onStart }) {
  const versions = options.filter((o) => o.use !== 'draft');
  const selA = el(doc, 'select');
  selA.id = 'wft-tv-a';
  if (!versions.length) { const o = el(doc, 'option', '', 'No saved version yet'); o.value = ''; selA.append(o); selA.disabled = true; }
  for (const o of versions) { const x = el(doc, 'option', '', o.label); x.value = String(o.use); selA.append(x); }
  if (a != null && versions.some((o) => o.use === a)) selA.value = String(a);
  const selB = el(doc, 'select');
  selB.id = 'wft-tv-b';
  selB.setAttribute('aria-label', 'Second version');   // its label is not shown (board 4)
  for (const o of options) { const x = el(doc, 'option', '', o.label); x.value = String(o.use); selB.append(x); }
  selB.value = String(b);
  const pickEx = el(doc, 'select');
  pickEx.id = 'wft-tv-examples';
  // D62: only the examples that can be tried are offered; the others stay listed, disabled, and are named in the hint.
  const ready = examples.filter((e) => e.ready !== false);
  const oneProject = ready.length && ready.every((e) => e.projectName && e.projectName === ready[0].projectName) ? ready[0].projectName : null;
  const allOpt = el(doc, 'option', '', oneProject ? allOnProject(ready.length, oneProject) : `All ${ready.length}`);   // P14
  allOpt.value = 'all';
  pickEx.append(allOpt);
  for (const e of examples) { const x = el(doc, 'option', '', e.name); x.value = String(e.id); x.disabled = e.ready === false; pickEx.append(x); }
  if (Array.isArray(exampleIds) && exampleIds.length === 1 && ready.some((e) => e.id === exampleIds[0])) pickEx.value = String(exampleIds[0]);
  const chosen = () => (pickEx.value === 'all' ? ready : ready.filter((e) => String(e.id) === pickEx.value));
  const leftHint = el(doc, 'p', 'hint wft-tv-left');
  leftHint.setAttribute('aria-live', 'polite');
  leftHint.hidden = true;
  const startTries = () => { const t = Math.max(1, ...chosen().map((e) => e.tries || 3)); return [1, 3, 5].includes(t) ? t : 3; };   // G10
  let tries = startTries();
  let triesTouched = false;
  const triesSeg = seg(doc, 'Tries per example', [[1, '1 · quick look'], [3, '3'], [5, '5']], tries, (v) => { tries = Number(v); triesTouched = true; void refresh(); });
  const setTries = (v) => { for (const x of triesSeg.children) { const on = x.dataset.value === String(v); x.classList.toggle('on', on); x.setAttribute('aria-checked', on ? 'true' : 'false'); } };
  // Opt-ins next to the estimate: checkboxes, listed in test/ui-shared-controls.test.mjs JS_CHECKBOX_OK (token wft-tv-optin).
  const boxA = el(doc, 'input', 'wft-tv-optin'); boxA.type = 'checkbox'; boxA.id = 'wft-tv-reuse-a'; boxA.checked = true;
  const boxB = el(doc, 'input', 'wft-tv-optin'); boxB.type = 'checkbox'; boxB.id = 'wft-tv-reuse-b'; boxB.checked = false;
  /** M3 (board 4): the older version's results are reused by default, the newer one is tried again (the draft is the newest). */
  const pickReuse = () => {
    const [x, y] = [useOfValue(selA.value), useOfValue(selB.value)];
    const older = x === 'draft' ? 'b' : y === 'draft' ? 'a' : x <= y ? 'a' : 'b';
    boxA.checked = older === 'a';
    boxB.checked = older === 'b';
  };
  pickReuse();
  const reuse = el(doc, 'div', 'wft-reuse');
  const quick = el(doc, 'input', 'wft-tv-optin'); quick.type = 'checkbox'; quick.id = 'wft-tv-quick'; quick.checked = true;
  quick.addEventListener('change', () => paintConnectors(estimate));   // the script caution counts the quick check (M2)
  const quickRow = optInRow(doc, quick, 'Do a free quick check first.', ' Worca makes sure every step of the workflow is connected, without using AI.');
  // D21 with D35: the promise holds only with Pretend connectors, so it shows only then.
  const safe = el(doc, 'div', 'wft-safe');
  safe.append(icon(doc, 'shield', 16), el(doc, 'b', '', 'Tests never touch real work through your connectors.'));
  // Board 34 (P13): a test with a project example says it never pushes, in both modes, in the shield line's place.
  const lock = el(doc, 'div', 'wft-lock');
  const lockWords = el(doc, 'span');
  lockWords.append(el(doc, 'b', '', LOCK_LEAD), doc.createTextNode(LOCK_REST));
  lock.append(icon(doc, 'lock', 16), lockWords);
  lock.hidden = true;
  // Board 34's aside (D60): too little free disk. Amber: the person can free some up, or pick fewer examples.
  const refuse = el(doc, 'p', 'wft-refuse');
  refuse.id = 'wft-tv-refuse';
  refuse.setAttribute('role', 'alert');
  refuse.hidden = true;
  // ── Connectors (board 30, C19, D35) ──
  let mode = connectors === 'real' ? 'real' : 'pretend';
  const conn = el(doc, 'fieldset', 'wft-conn');
  conn.append(el(doc, 'legend', '', 'Connectors'));
  const option = (value, title) => {
    const l = el(doc, 'label', 'radio-card');
    const r = el(doc, 'input');
    r.type = 'radio'; r.name = 'wft-tv-conn'; r.value = value; r.id = `wft-tv-conn-${value}`; r.checked = mode === value;
    const words = el(doc, 'span', 'radio-card-text');
    const hint = el(doc, 'span', 'hint');
    words.append(el(doc, 'b', '', title), hint);
    l.append(r, words);
    r.addEventListener('change', () => { if (r.checked) { mode = value; void refresh(); } });
    return { l, hint };
  };
  const pretendOpt = option('pretend', 'Pretend');
  pretendOpt.hint.textContent = 'Your connectors are replaced by stand-ins. Nothing is posted or sent, and Worca shows what would have been sent. Anything the workflow reads from them comes back empty.';
  const realOpt = option('real', 'Real');
  const notes = el(doc, 'ul', 'wft-conn-notes');
  notes.setAttribute('aria-label', 'Connectors in this workflow');
  const caution = el(doc, 'p', 'wft-caution');
  caution.setAttribute('role', 'note');
  conn.append(pretendOpt.l, notes, realOpt.l, caution);
  const est = el(doc, 'div', 'wft-est');
  est.setAttribute('aria-live', 'polite');
  const cap = el(doc, 'input');
  cap.type = 'text'; cap.inputMode = 'decimal'; cap.id = 'wft-tv-cap'; cap.className = 'wft-cap';
  let capTouched = false;
  cap.addEventListener('input', () => { capTouched = true; });
  const note = el(doc, 'p', 'hint wft-tv-note');
  note.id = 'wft-tv-note';
  note.setAttribute('aria-live', 'polite');
  let plan = null;
  let estimate = null;
  let seq = 0;
  let posting = false;   // Start is busy: a repaint meanwhile (a box ticked) never gives the button back early
  const vs = el(doc, 'div', 'wft-vs');
  const second = field(doc, 'Second version', selB, { id: selB.id });
  second.classList.add('wft-vs-second');   // board 4: the label keeps the row aligned but is not shown; "with" reads it
  vs.append(field(doc, 'Compare', selA, { id: selA.id }), el(doc, 'span', 'wft-vs-with', 'with'), second);
  const triesField = field(doc, 'Tries per example', triesSeg);
  triesField.classList.add('wft-tv-tries');
  const row2 = el(doc, 'div', 'wft-row2');
  row2.append(field(doc, 'Examples', pickEx, { id: pickEx.id }), triesField);
  row2.firstChild.append(leftHint);   // under the Examples field (board 34)
  const reused = (side) => !!(plan && plan[side] && plan[side].reusable) && (side === 'a' ? boxA : boxB).checked;
  const projectTest = () => !!(plan && plan.project && plan.project.names && plan.project.names.length);

  const capField = field(doc, 'Stop if the cost goes over', cap, { id: cap.id, hint: 'Tests count in your spending limit. You can close this page: Worca tells you when the results are ready.' });
  const dlg = testDialog({
    doc, win, title: 'Test a version', confirmLabel: 'Start',
    body: [vs, reuse, row2, conn, quickRow, safe, lock, est, refuse, capField, note],
    onConfirm: async () => {
      // testDialog gives the button back after a refusal: a pick made meanwhile may have nothing to start.
      if (!estimate || !estimate.total || !versions.length || selA.value === selB.value) return { ok: false, error: note.textContent || 'Wait for the estimate, then start.' };
      const capUsd = parseUsd(cap.value);   // I2: "15,50" is $15.50, not $1,550
      if (!(capUsd > 0)) return { ok: false, error: 'Give the cost limit in dollars, such as $15.' };
      posting = true;
      try {
        return await onStart({ a: useOfValue(selA.value), b: useOfValue(selB.value), exampleIds: chosen().map((e) => e.id), tries,
          reuseA: reused('a'), reuseB: reused('b'), quickCheck: quick.checked, capUsd, connectors: mode });
      } finally { posting = false; }
    },
  });

  function paint() {
    const held = [boxA, boxB].find((x) => x === doc.activeElement) || null;   // the rows are rebuilt: a ticked box keeps the focus
    reuse.replaceChildren();
    est.replaceChildren();
    const noA = !versions.length;
    const same = !noA && selA.value === selB.value;
    if (plan) {
      for (const [side, box, other] of [['a', boxA, 'b'], ['b', boxB, 'a']]) {
        const s = plan[side];
        if (!s || !s.reusable) continue;
        const words = reuseWords(s, plan[other], dateText);
        reuse.append(optInRow(doc, box, words.lead, words.rest));
      }
    }
    if (held && held.isConnected && doc.activeElement !== held) held.focus();
    const e = plan && !same ? estimateOf(plan, { reuseA: reused('a'), reuseB: reused('b') }) : null;
    estimate = e;
    let timeShown = false;
    if (e) {
      // Board 34: a test on a project says the disk it needs and the time it takes first, then the costs and "Total".
      const pj = projectTest() ? plan.project : null;
      if (pj && pj.disk) {
        const r = el(doc, 'div', 'wft-est-row is-disk');
        r.append(el(doc, 'span', 'wft-est-k', DISK_KEY), el(doc, 'span', '', diskRow(pj.disk.needBytes, pj.disk.freeBytes)));
        est.append(r);
      }
      timeShown = !!(pj && e.minutes);
      if (timeShown) {
        const r = el(doc, 'div', 'wft-est-row is-time');
        const v = el(doc, 'span', '', aboutDuration(e.minutes * 60000));
        if (pj.setupCmd && pj.setupMs) v.append(doc.createTextNode(SETUP_TAKES_LEAD), el(doc, 'span', 'code', pj.setupCmd), doc.createTextNode(setupTakesRest(pj.setupMs)));
        r.append(el(doc, 'span', 'wft-est-k', TIME_KEY), v);
        est.append(r);
      }
      const line = (left, right, cls = '') => {
        const r = el(doc, 'div', `wft-est-row${cls ? ` ${cls}` : ''}`);
        r.append(el(doc, 'span', '', left), el(doc, 'span', 'wft-est-usd', right));
        est.append(r);
      };
      const priced = (s, n) => (s && typeof s.perTryUsd === 'number' && Number.isFinite(s.perTryUsd) ? `about ${fmtUsd(n * s.perTryUsd)}` : 'cost not known yet');   // C12
      const triesN = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;
      if (e.toRun.b) line(`${triesN(e.toRun.b)} of ${plan.b.short}`, priced(plan.b, e.toRun.b));
      if (plan.a && e.toRun.a) line(`${triesN(e.toRun.a)} of ${plan.a.short}`, priced(plan.a, e.toRun.a));
      for (const side of ['a', 'b']) {
        if (reused(side)) line(`${plan[side].short} results from ${plan[side].reusableAt ? dateText(plan[side].reusableAt) : 'earlier'}`, '$0.00');
      }
      line(timeShown ? 'Total' : e.minutes ? `Total · ready in about ${e.minutes} minutes` : 'Total', e.usd === null ? 'cost not known yet' : fmtUsdRange(e.low, e.high), 'is-total');
      if (!capTouched) cap.value = `$${e.capUsd}`;
    }
    const total = e ? e.total : 0;
    // C16: a disabled Start for no saved version or the same version twice reads just "Start"; "Start 0 tries" only when all is reused.
    dlg.okButton.textContent = noA || same || !e ? 'Start' : `Start ${total} ${total === 1 ? 'try' : 'tries'}`;
    dlg.okButton.disabled = posting || noA || same || !e || total === 0;
    // Board 34's aside: too little free disk keeps "Start 30 tries", disabled, and says why (D60).
    const disk = !noA && !same && projectTest() && plan.project.disk ? plan.project.disk : null;
    refuse.replaceChildren();
    refuse.hidden = !(disk && disk.enough === false && disk.text);
    if (!refuse.hidden) {
      refuse.append(icon(doc, 'alert', 14), el(doc, 'span', '', disk.text));
      dlg.okButton.disabled = true;
    }
    // D62: the examples this test leaves out: not ready for the draft (here), or not on the other version (the plan's).
    // P27: "pick its project first" only when that is the reason; any other reason points at the Tests list's row.
    const why = new Map();
    if (pickEx.value === 'all') for (const x of examples) if (x.ready === false) why.set(x.name, x.reason || null);
    const fromPlan = plan && plan.project ? (plan.project.leftOutWhy || (plan.project.leftOut || []).map((name) => ({ name, reason: null }))) : [];
    for (const x of fromPlan) if (!why.has(x.name)) why.set(x.name, x.reason || null);
    const pickFirst = [...why].filter(([, r]) => r === 'pick-project').map(([n]) => n);
    const blocked = [...why].filter(([, r]) => r !== 'pick-project').map(([n]) => n);
    const leftText = [pickFirst.length ? leftOutText(pickFirst) : '', blocked.length ? leftOutBlockedText(blocked) : ''].filter(Boolean).join(' ');
    if (leftHint.textContent !== leftText) leftHint.textContent = leftText;   // aria-live: only a change is news
    leftHint.hidden = !leftText || noA;
    paintConnectors(e);
    // M6 (board 29): with no saved version only the two selects and the sentence are shown.
    for (const n of [reuse, row2, conn, quickRow, est, capField]) n.hidden = noA;
    if (noA) { safe.hidden = true; lock.hidden = true; }
    // P28: nothing to estimate and no cost limit to set; nor tries, connectors or a quick check to choose. The selects,
    // "All 0" with its hint, the note and the disabled Start stay.
    const noneReady = !noA && !ready.length;
    triesField.hidden = noneReady;
    if (noneReady) { for (const n of [reuse, conn, quickRow, est, capField, safe, lock]) n.hidden = true; }
    const text = noA ? 'Save a version first: a test compares two versions. Try it once now tries one example on your draft.'   // C16
      : noneReady ? NONE_READY_TEXT : same ? 'Pick two different versions.' : e && total === 0 ? 'Nothing to try: both versions have results for these examples.' : '';
    if (note.textContent !== text) note.textContent = text;   // aria-live: only a change is news
    // A disabled Start says why: the disk refusal, else the note (P28, C16).
    const why2 = !refuse.hidden ? refuse.id : dlg.okButton.disabled && text ? note.id : null;
    if (why2) dlg.okButton.setAttribute('aria-describedby', why2); else dlg.okButton.removeAttribute('aria-describedby');
  }

  /** Board 30: the Real sentence names how often a post would go out; Pretend lists each connector; the script caution stays. */
  function paintConnectors(e) {
    const n = e ? e.total : null;
    realOpt.hint.textContent = `Tries use your real connectors. If the workflow posts or sends something, it does it in every try${!n ? '' : n === 1 ? ': once in this test' : `: ${n} times in this test`}.${projectTest() ? REAL_BLOCKED_HINT : ''}`;   // nothing to try: no count
    const c = plan && plan.connectors;
    notes.replaceChildren();
    const line = (name, parts) => {
      const li = el(doc, 'li');
      const words = el(doc, 'span');
      words.append(...parts.map((p) => (typeof p === 'string' ? doc.createTextNode(p) : p)));
      li.append(icon(doc, name, 13), words);
      notes.append(li);
    };
    if (c && mode === 'pretend') {
      if (c.previewError) line('alert', [PREVIEW_ERROR_LINE]);
      if (c.pretend && c.pretend.length) line('check', [`${c.pretend.map(serverName).join(', ')}: pretend`]);
      for (const off of c.off || []) {
        const o = { ...off, name: serverName(off.name) };   // as board 31 names them (connector-name.mjs)
        if (o.reason === 'claude-ai') line('x', [`${o.name} is switched off: Worca can't pretend for claude.ai connectors.`]);
        else if (o.reason === 'own-settings') line('x', [`${o.name} is switched off: Worca can't pretend for servers in your own Claude Code settings.`]);
        else if (o.reason === 'file-server') line('x', [fileServerOffLine(o.name)]);
        else if (o.reason === 'no-tools') {
          const link = el(doc, 'a', '', 'test it once in Connectors');
          link.href = '#connectors';
          line('x', [`${o.name} is switched off: `, link, ' so Worca knows its tools.']);
        } else line('x', [`${o.name} is switched off for this test.`]);   // a reason a newer server added (controller-approved copy)
      }
      for (const label of c.engines || []) line('alert', [engineNoteLine(label)]);
    }
    notes.hidden = !notes.children.length;
    const sc = scriptCaution(c ? c.scripts : [], c && quick.checked ? c.quickScripts : []);
    caution.replaceChildren();
    caution.hidden = !sc;
    if (sc) {
      const words = el(doc, 'span');
      words.append(doc.createTextNode(sc.lead), el(doc, 'b', '', sc.name), doc.createTextNode(sc.rest));
      if (sc.more) words.append(doc.createTextNode(sc.more.lead), el(doc, 'b', '', sc.more.name), doc.createTextNode(sc.more.rest));
      caution.append(icon(doc, 'alert', 14), words);
    }
    lock.hidden = !projectTest();
    safe.hidden = mode !== 'pretend' || projectTest();   // P13
  }

  async function refresh() {
    const my = (seq += 1);
    plan = null;
    paint();
    if (!selA.value || selA.value === selB.value || !ready.length) return;   // P28: an empty list would plan every example
    let p = null;
    try {
      p = await loadPlan({ a: selA.value, b: selB.value, examples: chosen().map((e) => e.id).join(','), tries: String(tries), connectors: mode });
    } catch { p = null; }
    if (my !== seq) return;   // a newer pick asked meanwhile: its answer paints
    plan = p;
    paint();
    if (!p) note.textContent = 'Worca could not work out this test just now. Change a choice to try again.';
  }

  selA.addEventListener('change', () => { pickReuse(); void refresh(); });
  selB.addEventListener('change', () => { pickReuse(); void refresh(); });
  pickEx.addEventListener('change', () => { if (!triesTouched) { tries = startTries(); setTries(tries); } void refresh(); });
  boxA.addEventListener('change', paint);
  boxB.addEventListener('change', paint);
  void refresh();
  return dlg;
}

// ui/public/workflows/example-editor.mjs — Edit an example (canvas boards 2, 24; plans/workflow-tests-part2-plan.md Task 11):
// what Worca gets, your answers to its questions, what a good result needs (Basics + automatic checks; "Your criteria"
// is Part 3), how many tries. Plus the two small dialogs: a question and its answer, and an automatic check (G1).
// Pure DOM; app.js saves.
import { el, btn, iconBtn, seg, field, card, testDialog, sentence, BUSY_HINT, startInto, checkWords } from './test-ui.mjs';
import { makeSwitch } from '../switch.mjs';
import { icon } from '../icons.mjs';
import { withButton } from '../feedback.mjs';
import {
  CHECK_KINDS, PROJECT_KINDS, CHECK_KIND_LABELS, DEFAULT_BASICS, PROJECT_FILE_KIND_LABEL, COMMAND_TIMEOUTS, checkLabel, normaliseCheck, normaliseBasics, fmtUsd, parseUsd,
} from '../../../src/shared/workflow-tests/checks.mjs';
import {
  WHERE_TITLE, WHERE_HINT, START_HINT, START_LABEL, PROJECT_LABEL, CHANGE_BUTTON, behindText, LATEST_BUTTON, LATEST_HINT, CHANGES_LABEL,
  CHANGES_HINT, DEV_CAPTION, SETUP_LABEL, SETUP_HINT, CARD1_HINT_PROJECT, CHECKS_HINT_PROJECT, NO_PROJECT_OPTION, PICK_PROJECT_OPTION,
  PICK_PROJECT_TITLE, pickProjectText, PICK_THE_FOLDER, FOLDER_MISSING_TITLE, folderMissingText, FOLDER_PROJECT_TITLE, folderProjectText,
  UNSUPPORTED_TITLE, START_DIALOG_TITLE, START_DIALOG_HINT, START_DIALOG_OK, CHECK_DIALOG_HINT_PROJECT, GROUP_RESULT, GROUP_PROJECT,
  COMMAND_LABEL, COMMAND_HINT, TIMEOUT_LABEL, TIMEOUT_HINT, timeoutText, READ_FROM_LEGEND, READ_FROM_RESULT, READ_FROM_RESULT_SUB,
  READ_FROM_FILE, ADD_CHECK, lfsText, submodulesText, MISSING_FOLDER_ADD_AGAIN, notRegisteredText, PROJECTS_UNREAD_TEXT,
  NOT_ON_BRANCH_TEXT, changesMovesText, FILE_NAME_NEEDED, NO_BRANCHES_TEXT, startNowText, startWillBeText, PICK_BRANCH_FIRST, BRANCHES_UNREAD_TEXT,
  START_NOT_MOVED_TEXT, FILE_IN_PROJECT_LABEL, DISK_TITLE, DISK_KEY, diskRow, FOLDERS_LABEL, FOLDERS_HINT, FILES_LABEL, FILES_HINT_LEAD,
  FILES_HINT_CODE, FILES_HINT_REST, MOST_FILES_LABEL, MOST_FILES_HINT, MET_WHEN_LEGEND, MET_WHEN_PASSES, MET_WHEN_PASSES_SUB, MET_WHEN_NOTHING,
  MET_WHEN_NOTHING_SUB, MET_WHEN_HINT,
} from '../../../src/shared/workflow-tests/project-text.mjs';

export const BLANK_EXAMPLE = Object.freeze({
  id: null, name: '', request: '', answers: [], otherwise: 'pick', basics: { ...DEFAULT_BASICS }, checks: [], tries: 3, files: [], note: null,
  project: null,
});
const clone = (v) => JSON.parse(JSON.stringify(v));
/** U-T8 (F21): the Save button while the save pins a start point (Worca copies the project), withButton's busy label. */
const COPYING_PROJECT = 'Copying the project…';
const GONE_TEXT = 'This script is no longer in the Library.';
/** A script check whose script left the Library. `scripts` null: the Library did not load, so no claim either way. */
const scriptGone = (scripts, key) => Array.isArray(scripts) && !!key && !scripts.some((s) => s.key === key);
/** A select in the shared .select-wrap, whose ::after draws the chevron (boards 32, 33). */
const skinned = (doc, select, cls = '') => { const w = el(doc, 'div', `select-wrap${cls ? ` ${cls}` : ''}`); w.append(select); return w; };

const P2_CARD1_HINT = 'The same request and files are used every time this example is tried.';
const P2_CHECKS_HINT = 'Counted exactly, without AI. Pick a ready check, or a script from the Library.';   // C3
const TEXT_KIND_SET = new Set(['words', 'sections', 'mentions', 'not-mentions']);
/** A check as its line shows it. The line's text is a flex column, so the words go in one inline span. */
function checkLineEl(doc, c, label) {
  const s = el(doc, 'span', 'wft-line-text');
  s.append(checkWords(doc, c, label));
  return s;
}

/** P2 (not drawn): the start point, from the project's local branches; the one its folder is on comes first. */
export function openStartDialog({ doc, win, branches = [], current = null, dateText = (s) => s, onPick }) {
  const list = el(doc, 'div', 'wft-pick-list');
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', START_DIALOG_TITLE);
  for (const b of branches) {
    const row = el(doc, 'label', 'wft-pick-row');
    const radio = el(doc, 'input');
    radio.type = 'radio'; radio.name = 'wft-start-ref'; radio.value = b.name; radio.checked = b.name === current;
    const text = el(doc, 'span', 'wft-pick-text');
    text.append(el(doc, 'b', '', b.name), el(doc, 'span', 'hint', ' · '), el(doc, 'span', 'code', b.short), el(doc, 'span', 'hint', ` · ${dateText(b.at)}`));
    row.append(radio, text);
    list.append(row);
  }
  return testDialog({
    doc, win, title: START_DIALOG_TITLE, confirmLabel: START_DIALOG_OK, body: [el(doc, 'p', 'hint', START_DIALOG_HINT), list],
    onConfirm: () => {
      const hit = [...list.querySelectorAll('input[name="wft-start-ref"]')].find((x) => x.checked);
      if (!hit) return { ok: false, error: PICK_BRANCH_FIRST };
      onPick(branches.find((b) => b.name === hit.value));
      return { ok: true };
    },
  });
}

export function openAnswerDialog({ doc, win, pair = null, onSave, onRemove = null }) {
  const q = el(doc, 'textarea');
  q.id = 'wft-qa-question'; q.rows = 2; q.maxLength = 500; q.value = pair ? pair.question : '';
  const a = el(doc, 'textarea');
  a.id = 'wft-qa-answer'; a.rows = 3; a.maxLength = 2000; a.value = pair ? pair.answer : '';
  return testDialog({
    doc, win, title: pair ? 'Edit the question and answer' : 'Add a question and answer', confirmLabel: 'Save',
    body: [el(doc, 'p', 'hint', 'Write the question as Worca asks it. Case, spacing and punctuation do not matter.'),
      field(doc, 'Question', q, { id: q.id }), field(doc, 'Your answer', a, { id: a.id })],
    onRemove: pair && onRemove ? onRemove : null,
    onConfirm: () => {
      const question = q.value.trim();
      const answer = a.value.trim();
      if (!question || !answer) return { ok: false, error: 'Write both the question and your answer.' };
      onSave({ question, answer });
      return { ok: true };
    },
  });
}

/** G1: Add an automatic check — the kind, its fields, and the label it will have. `scripts` null: the Library did not load.
 *  `project`: the example works on a project (board 33): the kinds go in two groups, the command check joins, and a text
 *  check can read a file in the project. */
export function openCheckDialog({ doc, win, check = null, scripts = [], project = false, onSave, onRemove = null }) {
  const listed = scripts;
  scripts = Array.isArray(scripts) ? scripts : [];
  const kind = el(doc, 'select');
  kind.id = 'wft-ck-kind';
  const opt = (k, label = CHECK_KIND_LABELS[k]) => { const o = el(doc, 'option', '', label); o.value = k; return o; };
  // An edited script check keeps its kind, also when the Library lists none.
  // The project checks (3a D57, 3b D73) are their own group.
  const resultKinds = CHECK_KINDS.filter((k) => !PROJECT_KINDS.includes(k) &&
     !(k === 'script' && !scripts.length && !(check && check.kind === 'script')));
  if (project) {
    const g1 = el(doc, 'optgroup'); g1.label = GROUP_RESULT;
    for (const k of resultKinds) g1.append(opt(k, k === 'file' ? PROJECT_FILE_KIND_LABEL : undefined));   // D59, board 33
    const g2 = el(doc, 'optgroup'); g2.label = GROUP_PROJECT;
    for (const k of PROJECT_KINDS) g2.append(opt(k));   // board 33's order: the command, then the three file-scope checks
    kind.append(g1, g2);
  } else {
    for (const k of resultKinds) kind.append(opt(k));
    if (check && PROJECT_KINDS.includes(check.kind)) kind.append(opt(check.kind));   // an edited project check keeps its kind
  }
  kind.value = check ? check.kind : 'words';
  const fields = el(doc, 'div', 'wft-ck-fields');
  const preview = el(doc, 'p', 'hint wft-ck-preview');
  preview.setAttribute('aria-live', 'polite');
  const scriptName = (k) => (scripts.find((s) => s.key === k) || {}).displayName || k;
  let read = () => ({ kind: kind.value });
  let refuse = () => null;   // a refusal the check's own rules do not make (paintFields sets it)
  const paintPreview = () => {
    const { check: ok } = normaliseCheck(read());
    preview.replaceChildren();
    if (ok) preview.append(checkWords(doc, ok, checkLabel(ok, { scriptName: ok.kind === 'script' ? scriptName(ok.key) : null })));
  };
  const input = (id, type, value, extra = {}) => {
    const i = el(doc, 'input');
    i.id = id; i.type = type; i.value = value ?? '';
    Object.assign(i, extra);
    i.addEventListener('input', paintPreview);
    return i;
  };
  const paintFields = () => {
    fields.replaceChildren();
    refuse = () => null;
    const c = check && check.kind === kind.value ? check : {};
    if (kind.value === 'words') {
      const min = input('wft-ck-min', 'number', c.min ?? '', { min: '0' });
      const max = input('wft-ck-max', 'number', c.max ?? '', { min: '0' });
      fields.append(field(doc, 'At least, in words', min, { id: min.id }), field(doc, 'At most, in words', max, { id: max.id, hint: 'Leave one empty for no limit on that side.' }));
      read = () => ({ kind: 'words', min: min.value === '' ? null : Number(min.value), max: max.value === '' ? null : Number(max.value) });
    } else if (kind.value === 'sections') {
      const names = input('wft-ck-names', 'text', Array.isArray(c.names) ? c.names.join(', ') : '');
      fields.append(field(doc, 'Section names', names, { id: names.id, hint: 'Separate them with commas, for example Problem, Users, Risks. A section is a heading in the result.' }));
      read = () => ({ kind: 'sections', names: names.value });
    } else if (kind.value === 'mentions' || kind.value === 'not-mentions') {
      const text = input('wft-ck-text', 'text', c.text ?? '', { maxLength: 200 });
      fields.append(field(doc, 'Text', text, { id: text.id, hint: 'Case and spacing do not matter.' }));
      read = () => ({ kind: kind.value, text: text.value });
    } else if (kind.value === 'file') {
      const name = input('wft-ck-file', 'text', c.name ?? '', { maxLength: 200 });
      fields.append(field(doc, 'File name', name, { id: name.id, hint: 'A file the result must have, such as summary.md.' }));
      read = () => ({ kind: 'file', name: name.value });
    } else if (kind.value === 'command') {
      const cmd = input('wft-ck-cmd', 'text', c.cmd ?? '', { maxLength: 500, className: 'wft-mono' });
      const time = el(doc, 'select');
      time.id = 'wft-ck-timeout';
      for (const n of COMMAND_TIMEOUTS) { const o = el(doc, 'option', '', timeoutText(n)); o.value = String(n); time.append(o); }
      time.value = String(c.timeoutMin ?? 10);
      time.addEventListener('change', paintPreview);
      // U4 (D82, board 43): when the check is met. Radios, as "Read from" (3a P17); the hint describes them; the default
      // ('passes') is not stored (normaliseCheck).
      const mw = el(doc, 'fieldset', 'wft-rads wft-ck-metwhen');
      mw.append(el(doc, 'legend', '', MET_WHEN_LEGEND));
      const pickMw = (value, label, sub) => {
        const l = el(doc, 'label', 'wft-rad');
        const r = el(doc, 'input');
        r.type = 'radio'; r.name = 'wft-ck-metwhen'; r.value = value; r.checked = (c.metWhen || 'passes') === value;
        const words = el(doc, 'span', '', label);
        words.append(el(doc, 'span', 'wft-rad-sub', sub));
        l.append(r, words);
        r.addEventListener('change', paintPreview);
        return l;
      };
      mw.append(pickMw('passes', MET_WHEN_PASSES, MET_WHEN_PASSES_SUB), pickMw('breaks-nothing', MET_WHEN_NOTHING, MET_WHEN_NOTHING_SUB));
      const mwHint = el(doc, 'p', 'hint wft-ck-metwhen-hint', MET_WHEN_HINT);
      mwHint.id = 'wft-ck-metwhen-hint';
      mw.setAttribute('aria-describedby', mwHint.id);
      const mwWrap = el(doc, 'div', 'wft-ck-metwhen-wrap');
      mwWrap.append(mw, mwHint);
      fields.append(field(doc, COMMAND_LABEL, cmd, { id: cmd.id, hint: COMMAND_HINT }), field(doc, TIMEOUT_LABEL, skinned(doc, time, 'wft-ck-time'), { id: time.id, hint: TIMEOUT_HINT }),
        mwWrap);
      read = () => ({ kind: 'command', cmd: cmd.value, timeoutMin: Number(time.value), metWhen: (mw.querySelector('input:checked') || {}).value || 'passes' });
    } else if (kind.value === 'under') {
      const dirs = input('wft-ck-dirs', 'text', Array.isArray(c.dirs) ? c.dirs.join(', ') : '', { maxLength: 2000, className: 'wft-mono' });
      fields.append(field(doc, FOLDERS_LABEL, dirs, { id: dirs.id, hint: FOLDERS_HINT }));
      read = () => ({ kind: 'under', dirs: dirs.value });
    } else if (kind.value === 'unchanged') {
      const pats = input('wft-ck-keep', 'text', Array.isArray(c.patterns) ? c.patterns.join(', ') : '', { maxLength: 2000, className: 'wft-mono' });
      const f = field(doc, FILES_LABEL, pats, { id: pats.id, hint: FILES_HINT_LEAD });
      f.querySelector('.hint').replaceChildren(doc.createTextNode(FILES_HINT_LEAD), el(doc, 'span', 'code', FILES_HINT_CODE), doc.createTextNode(FILES_HINT_REST));
      fields.append(f);
      read = () => ({ kind: 'unchanged', patterns: pats.value });
    } else if (kind.value === 'max-files') {
      const most = input('wft-ck-max', 'text', c.max ?? '', { maxLength: 5, inputMode: 'numeric', className: 'wft-ck-num' });
      fields.append(field(doc, MOST_FILES_LABEL, most, { id: most.id, hint: MOST_FILES_HINT }));
      read = () => ({ kind: 'max-files', max: most.value.trim() });
    } else {
      const sel = el(doc, 'select');
      sel.id = 'wft-ck-script';
      const offer = c.key && !scripts.some((s) => s.key === c.key) ? [...scripts, { key: c.key }] : scripts;   // a script no longer listed stays picked
      for (const s of offer) { const o = el(doc, 'option', '', s.displayName || s.key); o.value = s.key; sel.append(o); }
      if (c.key) sel.value = c.key;
      const gone = el(doc, 'p', 'hint wft-gone', GONE_TEXT);
      const paintGone = () => { gone.hidden = !scriptGone(listed, sel.value); };
      sel.addEventListener('change', () => { paintPreview(); paintGone(); });
      paintGone();
      fields.append(field(doc, 'Script', sel, { id: sel.id, hint: 'For developers: the check is met when the script finds no problems in the result.' }), gone);
      read = () => ({ kind: 'script', key: sel.value, params: c.params || {} });
    }
    if (project && TEXT_KIND_SET.has(kind.value)) {   // board 33, P17: a text check reads the final result or a file in the project
      const rads = el(doc, 'fieldset', 'wft-rads');
      rads.append(el(doc, 'legend', '', READ_FROM_LEGEND));
      const from = input('wft-ck-from-file', 'text', c.file ?? '', { maxLength: 200, className: 'wft-mono' });
      from.setAttribute('aria-label', FILE_IN_PROJECT_LABEL);
      const rad = (value, label, sub = null) => {
        const l = el(doc, 'label', 'wft-rad');
        const r = el(doc, 'input'); r.type = 'radio'; r.name = 'wft-ck-from'; r.value = value;
        const words = el(doc, 'span', '', label);
        if (sub) words.append(el(doc, 'span', 'wft-rad-sub', sub));
        l.append(r, words);
        r.addEventListener('change', () => { from.disabled = value !== 'file'; paintPreview(); });
        return { l, r };
      };
      const res = rad('result', READ_FROM_RESULT, READ_FROM_RESULT_SUB);
      const fil = rad('file', READ_FROM_FILE);
      res.r.checked = !c.file; fil.r.checked = !!c.file; from.disabled = !c.file;
      rads.append(res.l, fil.l);
      fields.append(rads, from);
      const base = read;
      read = () => ({ ...base(), ...(fil.r.checked && from.value.trim() ? { file: from.value.trim() } : {}) });
      refuse = () => (fil.r.checked && !from.value.trim() ? FILE_NAME_NEEDED : null);   // P24: "A file in the project" needs its name
    } else if (c.file && TEXT_KIND_SET.has(kind.value)) {   // the project was unpicked: an edited check keeps the file it reads
      const base = read;
      read = () => ({ ...base(), file: c.file });
    }
    paintPreview();
  };
  kind.addEventListener('change', paintFields);
  paintFields();
  return testDialog({
    doc, win, title: check ? 'Edit the automatic check' : 'Add an automatic check', confirmLabel: check ? 'Save check' : ADD_CHECK,
    body: [el(doc, 'p', 'hint', project ? CHECK_DIALOG_HINT_PROJECT : 'Counted exactly, without AI.'), field(doc, 'What to check', skinned(doc, kind), { id: kind.id }), fields, preview],
    onRemove: check && onRemove ? onRemove : null,
    onConfirm: () => {
      const own = refuse();
      if (own) return { ok: false, error: own };
      const { check: ok, error } = normaliseCheck({ ...read(), ...(check && check.id ? { id: check.id } : {}) });
      if (!ok) return { ok: false, error: sentence(error) };
      onSave(ok);
      return { ok: true };
    },
  });
}

/** A Basic is on or off, so a switch (docs/design-system.md › Switch). `extra` (a field) and `after` ("times") sit beside
 *  the switch's label, never in it: a click in the box must not flip the switch. */
function basicRow(doc, id, text, on, extra = null, after = null) {
  const wrap = el(doc, 'div', 'wft-basic');
  const { row, input } = makeSwitch(doc, { label: text, checked: !!on, rowClass: 'wft-chk' });
  input.id = id;
  wrap.append(row);
  if (extra) {
    // M5 (boards 2, 24): the box and "times" stay together beside the switch; the box stays shown while it is off.
    const val = el(doc, 'span', 'wft-basic-val');
    val.append(extra);
    if (after) val.append(el(doc, 'span', 'wft-basic-after', after));
    wrap.append(val);
  }
  return { wrap, input };
}

/**
 * @param {HTMLElement} root
 * @param {object} ex an example (the store's shape) or BLANK_EXAMPLE
 * @param {{back:Function, save:Function, tryOnce:Function, addFiles:Function, removeFile:Function}} actions
 *   each → Promise<{ok, error?, example?}>; an `example` with an error (a partly done upload) is still shown
 *   3a: also branches(key) → {ok, data: {branches}} and startLatest() → {ok, example}
 * @param {{doc: Document, win: Window, scripts?: Array<{key:string, displayName?:string}>|null, perTryUsd?: number|null,
 *   draftLabel?: string, testRunning?: boolean, projects?: Array<object>|null, needsProject?: boolean, workflowName?: string,
 *   projectView?: object|null, dateText?: (iso: string) => string}} ctx  scripts null: the Library did not load; testRunning:
 *   a test of this workflow runs, so Try it once now waits (G19); projects: GET /api/workflow-tests/projects (null: not
 *   read); needsProject: the workflow changes a project's code (D62); projectView: the overview's view of the example's
 *   project (its drift, D63)
 * @returns {{value: () => object}}
 */
export function renderExampleEditor(root, ex, actions, { doc, win, scripts = [], perTryUsd = null, draftLabel = 'your draft', testRunning = false,
  projects = null, needsProject = false, workflowName = '', projectView = null, dateText = (s) => s }) {
  const listed = scripts;
  const lib = Array.isArray(scripts) ? scripts : [];
  const draft = clone({ ...BLANK_EXAMPLE, ...ex });
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-editor');
  const error = el(doc, 'p', 'hint err wft-error');
  error.setAttribute('aria-live', 'polite');
  const failed = (r, fallback) => { if (!r || !r.ok) error.textContent = sentence((r && r.error) || fallback); };

  // One editor action at a time: Save, Try it once now and the file controls wait while one runs (no second post).
  let busyN = 0;
  let tryBlocked = false;   // board 39: the example's project cannot be tried, or the workflow needs one (paintWhere)
  const paintBusy = () => {
    const on = busyN > 0;
    saveBtn.disabled = on;
    tryBtn.disabled = on || testRunning || tryBlocked;
    // G19 pattern: a Try that waits says why (the busy hint, or the notice of "Where it starts").
    const why = testRunning ? 'wft-busy' : tryBlocked && !notice.hidden ? notice.id : null;
    if (why) tryBtn.setAttribute('aria-describedby', why); else tryBtn.removeAttribute('aria-describedby');
    picker.disabled = on;
    for (const b of files.querySelectorAll('button')) b.disabled = on;
    for (const b of startField.querySelectorAll('button')) b.disabled = on;   // Change, Start from the latest
  };
  const busyWhile = async (fn) => {
    busyN += 1;
    paintBusy();
    try { return await fn(); } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) }; } finally {
      busyN -= 1;
      paintBusy();
    }
  };

  // ── header ──
  const head = el(doc, 'div', 'wft-crumbs');
  const crumbs = el(doc, 'div', 'wft-crumbs-left');
  const title = el(doc, 'h2', 'wft-title');
  const paintTitle = () => { title.textContent = draft.name.trim() ? `Example: ${draft.name.trim()}` : 'New example'; };
  paintTitle();
  crumbs.append(btn(doc, 'Tests', () => actions.back(), 'wft-crumb'), title);
  const acts = el(doc, 'div', 'wft-acts');
  const run = async (fn) => {
    if (busyN) return { ok: false };
    error.textContent = '';
    page.querySelector('.wft-refusal')?.remove();
    const problem = limitsProblem();
    if (problem) { error.textContent = problem; return { ok: false }; }
    const r = await busyWhile(() => fn(value()));
    if (!unsupported(r)) failed(r, 'That did not work. Try again.');
    if (r && !r.ok && r.body && r.body.code === 'NO_DISK' && r.body.disk) {   // board 39: Try it once now, not enough free disk
      const c = card(doc, DISK_TITLE, 'wft-ex-disk-h', null, 'wft-refusal');
      const est = el(doc, 'div', 'wft-est');
      const row = el(doc, 'div', 'wft-est-row is-disk');
      row.append(el(doc, 'span', 'wft-est-k', DISK_KEY), el(doc, 'span', '', diskRow(r.body.disk.needBytes, r.body.disk.freeBytes)));
      est.append(row);
      const why = el(doc, 'p', 'hint', r.error);
      why.setAttribute('role', 'alert');   // the card replaces the error line, so it says it
      c.append(est, why);
      error.textContent = '';
      error.after(c);
    }
    return r;
  };
  /** U-T8 (F21): whether this save pins a start point, so Worca copies the project (service resolveProjectInput: a
   *  project picked anew, another branch, Start from the latest, or the changes switched). A kept pin copies nothing. */
  const pinsStart = (pr) => !!pr && (!stored || stored.key !== pr.key || pr.repin === true
    || (pr.ref != null && pr.ref !== stored.startRef) || (pr.includeChanges !== undefined && pr.includeChanges !== !!stored.changesSha256));
  // Save and Try it once now both save first: the one that was pressed says "Copying the project…" when that save copies.
  const saving = (button, action) => () => {
    if (busyN) return;
    if (pinsStart(value().project)) void withButton(button(), () => run(action), { busy: COPYING_PROJECT });
    else void run(action);
  };
  const tryBtn = btn(doc, 'Try it once now', saving(() => tryBtn, (v) => actions.tryOnce(v)), 'btn');
  const saveBtn = btn(doc, 'Save example', saving(() => saveBtn, (v) => actions.save(v)), 'btn btn-primary');
  acts.append(btn(doc, 'Cancel', () => actions.back(), 'btn'), tryBtn, saveBtn);
  head.append(crumbs, acts);
  if (testRunning) {   // G19, D37: one test per workflow at a time
    tryBtn.disabled = true;
    tryBtn.setAttribute('aria-describedby', 'wft-busy');
    const busy = el(doc, 'p', 'hint wft-busy', BUSY_HINT);
    busy.id = 'wft-busy';
    head.append(busy);
  }
  page.append(head, error);

  // ── 1. What Worca gets (G5: the name field) ──
  const name = el(doc, 'input');
  name.type = 'text'; name.id = 'wft-ex-name'; name.maxLength = 120; name.value = draft.name;
  name.addEventListener('input', () => { draft.name = name.value; paintTitle(); });
  const request = el(doc, 'textarea');
  request.id = 'wft-ex-request'; request.rows = 6; request.value = draft.request;
  request.addEventListener('input', () => { draft.request = request.value; });
  const files = el(doc, 'div', 'wft-files');
  const picker = el(doc, 'input');
  picker.type = 'file'; picker.multiple = true; picker.hidden = true; picker.id = 'wft-ex-file';
  let addFileBtn = null;
  const showFiles = (r) => { if (r && r.example) { draft.id = r.example.id ?? draft.id; draft.files = r.example.files; paintFiles(); } };
  const paintFiles = () => {
    files.replaceChildren();
    for (const f of draft.files) {
      const pill = el(doc, 'span', 'wft-file');
      const x = iconBtn(doc, 'x', `Remove ${f.name}`, async () => {
        if (busyN) return;
        error.textContent = '';
        const r = await busyWhile(() => actions.removeFile(f.name));
        showFiles(r);
        failed(r, 'The file was not removed.');
        if (r && r.ok) addFileBtn.focus();   // the pill and its × are gone
      }, 'wft-file-x', 12);
      pill.append(el(doc, 'span', '', f.name), x);
      files.append(pill);
    }
    addFileBtn = btn(doc, 'Add file', () => picker.click());
    files.append(addFileBtn, picker);
    paintBusy();
  };
  // The store refuses a case-only twin of another file (a try's folder on Windows could not hold both): say so first.
  const caseTwin = (list) => {
    const seen = draft.files.map((f) => f.name);
    for (const f of list) {
      const n = String(f.name || '').trim();
      const twin = seen.find((s) => s !== n && s.toLowerCase() === n.toLowerCase());
      if (twin) return twin;
      seen.push(n);
    }
    return null;
  };
  picker.addEventListener('change', async () => {
    const list = [...(picker.files || [])];
    try { picker.value = ''; } catch { /* jsdom */ }   // the same file can be picked again
    if (!list.length || busyN) return;
    error.textContent = '';
    const twin = caseTwin(list);
    if (twin) { error.textContent = `A file named ${twin} is already here.`; return; }
    const problem = draft.id == null ? limitsProblem() : null;   // G17: an example never saved is saved first
    if (problem) { error.textContent = problem; return; }
    const r = await busyWhile(() => actions.addFiles(list, value()));
    showFiles(r);   // also after a partly done upload: the files that went up
    failed(r, 'The file was not added.');
  });
  const c1 = card(doc, '1. What Worca gets', 'wft-c1-h', P2_CARD1_HINT, 'wft-c1');
  c1.append(field(doc, 'Name of the example', name, { id: name.id }), field(doc, 'Request', request, { id: request.id }), field(doc, 'Files', files));
  const c1Hint = c1.querySelector(':scope > .hint');
  let checksHint = null;   // card 3's Automatic checks hint (below)

  // ── 1b. Where it starts (board 32; board 39's states; D41, D63, P2–P4) ──
  const reg = (key) => (Array.isArray(projects) ? projects.find((p) => p.key === key) : null) || null;
  let stored = draft.project || null;                    // the store's pin
  let view = projectView;                                // the overview's view of it (state, behind)
  const pick = { key: stored ? stored.key : '', ref: undefined, branch: null, repin: false };
  const where = el(doc, 'div', 'wft-sect wft-where');
  const projectSel = el(doc, 'select');
  projectSel.id = 'wft-ex-project';
  const startField = el(doc, 'div', 'field wft-start-field');
  const notice = el(doc, 'div', 'wft-notice');
  notice.id = 'wft-ex-notice';
  notice.setAttribute('role', 'note');
  notice.setAttribute('aria-live', 'polite');
  const status = el(doc, 'p', 'hint wft-start-status');   // "The start point is now …" after Change or Start from the latest (P26)
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  let changeBtn = null;
  let latestBtn = null;
  const changesRow = el(doc, 'label', 'wft-uncommitted');   // not .wft-chk: on this page every .wft-chk is a switch (Part 2)
  const changesBox = el(doc, 'input', 'wft-changes-box');   // test/ui-shared-controls.test.mjs JS_CHECKBOX_OK: opts in to keeping uncommitted changes
  changesBox.type = 'checkbox';
  changesBox.checked = !!(stored && stored.changesSha256);
  changesRow.append(changesBox, el(doc, 'span', '', CHANGES_LABEL));
  const changesHint = el(doc, 'span', 'hint wft-changes-hint', CHANGES_HINT);
  const changesMoves = el(doc, 'span', 'wft-changes-moves');   // P23: said only when switching on would move the start
  changesHint.append(changesMoves);
  const setup = el(doc, 'input');
  setup.type = 'text'; setup.id = 'wft-ex-setup'; setup.className = 'wft-mono'; setup.maxLength = 4000;
  setup.addEventListener('input', () => { setup.dataset.touched = '1'; });
  const dev = el(doc, 'div', 'wft-dev');
  dev.append(el(doc, 'span', 'wft-dev-cap', DEV_CAPTION), field(doc, SETUP_LABEL, setup, { id: setup.id, hint: SETUP_HINT }));
  /** A project no longer registered keeps its name (Task 8: never the internal key while a name is known). */
  const nameOf = (key) => (view && view.key === key && view.name) || (stored && stored.key === key && stored.name) || key;
  const fillProjects = () => {
    projectSel.replaceChildren();
    const first = el(doc, 'option', '', needsProject ? PICK_PROJECT_OPTION : NO_PROJECT_OPTION);
    first.value = '';
    projectSel.append(first);
    for (const p of Array.isArray(projects) ? projects : []) { const o = el(doc, 'option', '', p.name); o.value = p.key; projectSel.append(o); }
    if (pick.key && !reg(pick.key)) { const o = el(doc, 'option', '', nameOf(pick.key)); o.value = pick.key; projectSel.append(o); }   // it stays picked
    projectSel.value = pick.key;
  };
  /** The start point the row shows: a branch picked in Change, the stored pin, else the branch the folder is on (none
   *  when the folder is not on a branch: P22). */
  const startShown = () => {
    if (pick.branch) return { ref: pick.branch.name, short: pick.branch.short, at: pick.branch.at };
    if (stored && stored.key === pick.key) return { ref: stored.startRef, short: stored.startSha.slice(0, 7), at: stored.startAt };
    const r = reg(pick.key);
    return r && r.current && r.current.branch ? { ref: r.current.branch, short: r.current.short, at: r.current.at } : null;
  };
  /** Board 39: a save or Start from the latest refused because the project keeps files with Git LFS or holds submodules.
   *  Said in the notice only (not also on the error line). Matched on the shared sentences, not on a pattern. */
  function unsupported(r) {
    if (!r || r.ok || !pick.key) return false;
    const name = (reg(pick.key) || {}).name || nameOf(pick.key);
    const said = sentence(r.error);   // app.js's wftCall already makes it a sentence ("Worca-cc keeps …")
    const text = [lfsText(name), submodulesText(name)].find((t) => sentence(t) === said);
    if (!text) return false;
    // The shared sentence itself, so the project's name keeps its own case.
    notice.replaceChildren(el(doc, 'p', 'wft-notice-title', UNSUPPORTED_TITLE), el(doc, 'p', 'hint', text));
    notice.hidden = false;
    paintBusy();
    return true;
  }
  /** "Worca can't find gone in /code/gone. …" with the folder in code (board 39); the words stay project-text's. */
  const missingEl = (r) => {
    const p = el(doc, 'p', 'hint');
    const text = folderMissingText(r.name, r.path);
    const at = r.path ? text.indexOf(` in ${r.path}.`) : -1;
    if (at < 0) { p.textContent = text; return p; }
    const from = at + 4;
    p.append(doc.createTextNode(text.slice(0, from)), el(doc, 'span', 'code', r.path), doc.createTextNode(text.slice(from + r.path.length)));
    return p;
  };
  const paintWhere = () => {
    const r = reg(pick.key);
    const st = startShown();
    startField.replaceChildren();
    notice.replaceChildren();
    notice.hidden = true;
    changeBtn = null;
    latestBtn = null;
    const say = (title, parts, button = null) => {
      notice.hidden = false;
      if (title) notice.append(el(doc, 'p', 'wft-notice-title', title));
      notice.append(...parts);
      if (button) { const foot = el(doc, 'div', 'wft-notice-foot'); foot.append(button); notice.append(foot); }
    };
    const only = (text) => [el(doc, 'p', 'wft-notice-text', text)];   // a notice the boards draw no title for (P20–P22)
    if (!Array.isArray(projects)) { if (needsProject || pick.key) say(null, only(PROJECTS_UNREAD_TEXT)); }   // P21: only when a project matters here
    else if (!pick.key) { if (needsProject) say(PICK_PROJECT_TITLE, [el(doc, 'p', 'hint', pickProjectText(workflowName))]); }
    else if (!r) say(null, only(notRegisteredText(nameOf(pick.key))));   // P20
    else if (!r.exists) {   // board 39, P4, P19
      say(FOLDER_MISSING_TITLE, [missingEl(r), el(doc, 'p', 'hint', MISSING_FOLDER_ADD_AGAIN)], btn(doc, PICK_THE_FOLDER, () => projectSel.focus()));
    } else if (r.vcs !== 'git') say(FOLDER_PROJECT_TITLE, [el(doc, 'p', 'hint', folderProjectText(r.name))]);
    else if (!st) say(null, only(NOT_ON_BRANCH_TEXT));   // P22
    const usableProject = !!(pick.key && r && r.exists && r.vcs === 'git' && st);
    tryBlocked = pick.key ? !usableProject : needsProject;
    if (usableProject) {
      const row = el(doc, 'div', 'wft-start');
      const words = el(doc, 'span');
      startInto(doc, words, st, dateText, { bold: true });
      changeBtn = btn(doc, CHANGE_BUTTON, () => void changeStart());
      changeBtn.dataset.focusKey = 'wft-start-change';   // the start point dialog's focusBack finds the repainted twin
      row.append(words, changeBtn);
      startField.append(el(doc, 'span', 'label', START_LABEL), row, el(doc, 'span', 'hint', START_HINT));
      // D63: the overview counted the drift of this very pin; a pin moved since then has none to show.
      const samePin = !!(view && stored && stored.key === pick.key && !pick.branch && (!view.startSha || view.startSha === stored.startSha));
      const behind = samePin && view.behind > 0 && view.startRef ? view.behind : 0;
      if (behind) {
        const moved = el(doc, 'div', 'wft-moved');
        moved.setAttribute('role', 'note');
        const top = el(doc, 'span', 'wft-moved-top');
        top.append(icon(doc, 'alert', 14), el(doc, 'span', '', behindText(behind, view.startRef)));
        const act = el(doc, 'span', 'wft-moved-act');
        latestBtn = btn(doc, LATEST_BUTTON, () => void latest());
        latestBtn.dataset.focusKey = 'wft-start-latest';
        act.append(latestBtn, el(doc, 'span', 'hint', LATEST_HINT));
        moved.append(top, act);
        startField.append(moved);
      }
    }
    startField.hidden = !usableProject;
    const onCurrent = usableProject && !!(r.current && st.ref && st.ref === r.current.branch);   // P3
    changesRow.hidden = !onCurrent;
    changesHint.hidden = !onCurrent;
    // P23: switching the changes on pins again from the branch's newest commit; say so when that is not the kept start.
    const moves = onCurrent && !pick.branch && !!stored && stored.key === pick.key && !stored.changesSha256 && r.current.sha !== stored.startSha;
    changesMoves.textContent = moves ? ` ${changesMovesText(r.current.branch)}` : '';
    dev.hidden = !usableProject;
    // The kept pin's setup (null: none, as cleared); a project picked anew starts with the project's own.
    if (usableProject && !setup.dataset.touched) setup.value = stored && stored.key === pick.key ? (stored.setupCmd || '') : (r.setupCmd || '');
    c1Hint.textContent = pick.key ? CARD1_HINT_PROJECT : P2_CARD1_HINT;
    if (checksHint) checksHint.textContent = pick.key ? CHECKS_HINT_PROJECT : P2_CHECKS_HINT;
    paintBusy();
  };
  /** A start button's load: disabled by paintBusy (busyWhile), and aria-busy while it runs. */
  const loading = async (button, fn) => {
    if (button) button.setAttribute('aria-busy', 'true');
    try { return await busyWhile(fn); } finally { if (button) button.removeAttribute('aria-busy'); }
  };
  /** After a new start point: say it (P26) and keep the focus on Change. A Change pick is kept only when the example is
   *  saved ("will be"); Start from the latest is already stored ("is now"). */
  const startMoved = (saved) => {
    const st = startShown();
    status.textContent = st ? (saved ? startNowText : startWillBeText)(st.ref || st.short, st.short) : '';
    if (changeBtn) changeBtn.focus();
  };
  async function changeStart() {
    if (busyN) return;
    error.textContent = '';
    const r = await loading(changeBtn, () => actions.branches(pick.key));
    if (!r || !r.ok) { failed(r, BRANCHES_UNREAD_TEXT); return; }
    const branches = r.data && Array.isArray(r.data.branches) ? r.data.branches : [];
    if (!branches.length) { error.textContent = NO_BRANCHES_TEXT; return; }   // P25: no dialog with nothing to pick
    const st = startShown();
    openStartDialog({ doc, win, branches, current: st ? st.ref : null, dateText,
      onPick: (b) => { pick.branch = b; pick.ref = b.name; pick.repin = true; paintWhere(); startMoved(false); } });
  }
  async function latest() {
    if (busyN) return;
    error.textContent = '';
    const r = await loading(latestBtn, () => actions.startLatest());
    if (!r || !r.ok) { if (!unsupported(r)) failed(r, START_NOT_MOVED_TEXT); return; }
    stored = r.example.project;
    draft.project = stored;
    view = view ? { ...view, behind: 0 } : view;
    pick.branch = null; pick.ref = undefined; pick.repin = false;
    paintWhere();
    startMoved(true);
  }
  projectSel.addEventListener('change', () => {
    pick.key = projectSel.value; pick.ref = undefined; pick.branch = null; pick.repin = false;
    setup.dataset.touched = '';
    status.textContent = '';
    paintWhere();
  });
  fillProjects();
  where.append(el(doc, 'p', 'wft-grp', WHERE_TITLE), el(doc, 'p', 'wft-grp-hint', WHERE_HINT),
    field(doc, PROJECT_LABEL, skinned(doc, projectSel), { id: projectSel.id }), notice, startField, status, changesRow, changesHint, dev);
  c1.append(where);

  // ── 2. Your answers to Worca's questions ──
  const qa = el(doc, 'div', 'wft-lines');
  let addQa = null;
  const paintQa = () => {
    qa.replaceChildren();
    draft.answers.forEach((p, i) => {
      const line = el(doc, 'div', 'wft-line');
      const words = el(doc, 'span', 'wft-line-text');
      words.append(el(doc, 'b', '', p.question), el(doc, 'span', '', p.answer));
      const edit = btn(doc, 'Edit', () => openAnswerDialog({ doc, win, pair: p,
        onSave: (np) => { draft.answers[i] = np; paintQa(); }, onRemove: () => { draft.answers.splice(i, 1); paintQa(); return addQa; } }));
      edit.setAttribute('aria-label', `Edit the answer to ${p.question}`);
      edit.dataset.focusKey = `qa-${i}`;   // the dialog's focusBack finds the repainted twin (layers.mjs refind)
      line.append(words, edit);
      qa.append(line);
    });
    addQa = btn(doc, 'Add a question and answer', () => openAnswerDialog({ doc, win, onSave: (np) => { draft.answers.push(np); paintQa(); } }));
    addQa.dataset.focusKey = 'qa-add';
    qa.append(addQa);
  };
  paintQa();
  const c2 = card(doc, "2. Your answers to Worca's questions", 'wft-c2-h', 'Nobody watches while a test runs. If Worca asks one of these questions, it gets your answer.', 'wft-c2');
  c2.append(qa, field(doc, 'If Worca asks something else', seg(doc, 'If Worca asks something else',
    [['pick', 'Worca picks a sensible answer'], ['fail', 'The try counts as failed']], draft.otherwise, (v) => { draft.otherwise = v; })));

  // ── 4. How many tries ──
  const est = el(doc, 'p', 'hint wft-estimate');
  const known = typeof perTryUsd === 'number' && Number.isFinite(perTryUsd);
  const paintEst = () => {
    est.textContent = known
      ? `About ${fmtUsd(perTryUsd)} a try with ${draftLabel}, so about ${fmtUsd(perTryUsd * draft.tries)} for this example.`
      : 'Worca does not know the cost of a try yet: it learns it from the first tries.';   // C12
  };
  const c4 = card(doc, '4. How many tries', 'wft-c4-h', 'AI can answer differently each time. More tries give a surer result, and cost more.', 'wft-c4');
  c4.append(seg(doc, 'How many tries', [[1, '1'], [3, '3'], [5, '5']], draft.tries, (v) => { draft.tries = Number(v); paintEst(); }), est);
  paintEst();

  // ── 3. What a good result needs ──
  const c3 = card(doc, '3. What a good result needs', 'wft-c3-h', 'A try passes only when everything below is met.', 'wft-c3');
  const b = draft.basics || DEFAULT_BASICS;
  const cost = el(doc, 'input');
  cost.type = 'text'; cost.inputMode = 'decimal'; cost.className = 'wft-num'; cost.id = 'wft-b-cost-usd';
  cost.setAttribute('aria-label', 'Cost limit');
  // G11: off for a new example; the box is pre-filled with twice the usual cost, rounded up to $0.50.
  cost.value = b.maxCostUsd != null ? fmtUsd(b.maxCostUsd) : known ? fmtUsd(Math.ceil(perTryUsd * 4) / 2) : '';
  const fix = el(doc, 'input');
  fix.type = 'number'; fix.min = '0'; fix.max = '50'; fix.className = 'wft-num'; fix.id = 'wft-b-fix-n';
  fix.setAttribute('aria-label', 'Fix limit');
  fix.value = String(b.maxSentBack ?? 2);
  const rows = {
    noError: basicRow(doc, 'wft-b-error', 'Finishes without an error', b.noError),
    noHelp: basicRow(doc, 'wft-b-help', 'Finishes without needing help from someone', b.noHelp),
    cost: basicRow(doc, 'wft-b-cost', 'Costs at most', b.maxCostUsd != null, cost),
    fix: basicRow(doc, 'wft-b-fix', 'Sent back for fixes at most', b.maxSentBack != null, fix, 'times'),
  };
  c3.append(el(doc, 'p', 'wft-grp', 'Basics'), rows.noError.wrap, rows.noHelp.wrap, rows.cost.wrap, rows.fix.wrap);
  const lines = el(doc, 'div', 'wft-lines');
  const scriptName = (k) => (lib.find((s) => s.key === k) || {}).displayName || k;
  let addCk = null;
  const repaintCheckRows = () => {
    lines.replaceChildren();
    draft.checks.forEach((c, i) => {
      const line = el(doc, 'div', 'wft-line');
      const label = checkLabel(c, { scriptName: c.kind === 'script' ? scriptName(c.key) : null });
      const edit = btn(doc, 'Edit', () => openCheckDialog({ doc, win, check: c, scripts: listed, project: !!pick.key,
        onSave: (nc) => { draft.checks[i] = nc; repaintCheckRows(); }, onRemove: () => { draft.checks.splice(i, 1); repaintCheckRows(); return addCk; } }));
      edit.setAttribute('aria-label', `Edit ${label}`);
      edit.dataset.focusKey = `ck-${c.id || i}`;
      const main = el(doc, 'div', 'wft-line-main');
      main.append(checkLineEl(doc, c, label));
      if (c.kind === 'script' && scriptGone(listed, c.key)) main.append(el(doc, 'span', 'hint wft-gone', GONE_TEXT));
      line.append(main, edit);
      lines.append(line);
    });
    addCk = btn(doc, 'Add an automatic check', () => openCheckDialog({ doc, win, scripts: listed, project: !!pick.key, onSave: (nc) => { draft.checks.push(nc); repaintCheckRows(); } }));
    addCk.dataset.focusKey = 'ck-add';
    lines.append(addCk);
  };
  repaintCheckRows();
  const sect = el(doc, 'div', 'wft-sect');
  checksHint = el(doc, 'p', 'wft-grp-hint', P2_CHECKS_HINT);   // C3; a project example's is board 32's (paintWhere)
  sect.append(el(doc, 'p', 'wft-grp', 'Automatic checks'), checksHint, lines);
  c3.append(sect);

  const cols = el(doc, 'div', 'wft-cols');
  const left = el(doc, 'div', 'wft-col');
  left.append(c1, c2, c4);
  cols.append(left, c3);
  page.append(cols);
  root.append(page);
  paintFiles();
  paintWhere();

  /** The cost box in dollars (parseUsd): "$1.50", "1,50" → 1.5; empty → null; not a number → NaN. */
  const readMoney = () => parseUsd(cost.value);
  function readFix() {
    const t = String(fix.value).trim();
    return t === '' ? null : Number(t);
  }
  /** A limit switched on with an empty or wrong box: the store's own sentence, before anything is sent (null = off there). */
  function limitsProblem() {
    const { error: e } = normaliseBasics({
      maxCostUsd: rows.cost.input.checked ? (readMoney() ?? Number.NaN) : null,
      maxSentBack: rows.fix.input.checked ? (readFix() ?? Number.NaN) : null,
    });
    return e ? sentence(e) : null;
  }
  const orNull = (n) => (n === null || !Number.isFinite(n) ? null : n);
  function value() {
    return {
      name: draft.name.trim(), request: draft.request, answers: draft.answers, otherwise: draft.otherwise,
      basics: {
        noError: rows.noError.input.checked,
        noHelp: rows.noHelp.input.checked,
        maxCostUsd: rows.cost.input.checked ? orNull(readMoney()) : null,
        maxSentBack: rows.fix.input.checked ? orNull(readFix()) : null,
      },
      checks: draft.checks, tries: draft.tries, note: draft.note,
      // D41, P2–P4: the server keeps the pin unless the key, the branch (`ref`), `repin` or the changes switch say otherwise.
      // The setup only while "For developers" shows: '' clears it; left out, the server keeps the pin's.
      project: !pick.key ? null : {
        key: pick.key, ...(!dev.hidden ? { setupCmd: setup.value.trim() } : {}),
        ...(pick.ref !== undefined ? { ref: pick.ref } : {}), ...(pick.repin ? { repin: true } : {}),
        ...(!changesRow.hidden ? { includeChanges: changesBox.checked } : {}),
      },
    };
  }
  return { value };
}

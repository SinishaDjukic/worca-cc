// ui/public/workflows/example-editor.mjs — Edit an example (canvas boards 2, 24; plans/workflow-tests-part2-plan.md Task 11):
// what Worca gets, your answers to its questions, what a good result needs (Basics + automatic checks; "Your criteria"
// is Part 3), how many tries. Plus the two small dialogs: a question and its answer, and an automatic check (G1).
// Pure DOM; app.js saves.
import { el, btn, iconBtn, seg, field, card, testDialog, sentence, BUSY_HINT } from './test-ui.mjs';
import { makeSwitch } from '../switch.mjs';
import { CHECK_KINDS, CHECK_KIND_LABELS, DEFAULT_BASICS, checkLabel, normaliseCheck, normaliseBasics, fmtUsd } from '../../../src/shared/workflow-tests/checks.mjs';

export const BLANK_EXAMPLE = Object.freeze({
  id: null, name: '', request: '', answers: [], otherwise: 'pick', basics: { ...DEFAULT_BASICS }, checks: [], tries: 3, files: [], note: null,
});
const clone = (v) => JSON.parse(JSON.stringify(v));
const GONE_TEXT = 'This script is no longer in the Library.';
/** A script check whose script left the Library. `scripts` null: the Library did not load, so no claim either way. */
const scriptGone = (scripts, key) => Array.isArray(scripts) && !!key && !scripts.some((s) => s.key === key);

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

/** G1: Add an automatic check — the kind, its fields, and the label it will have. `scripts` null: the Library did not load. */
export function openCheckDialog({ doc, win, check = null, scripts = [], onSave, onRemove = null }) {
  const listed = scripts;
  scripts = Array.isArray(scripts) ? scripts : [];
  const kind = el(doc, 'select');
  kind.id = 'wft-ck-kind';
  for (const k of CHECK_KINDS) {
    if (k === 'script' && !scripts.length && !(check && check.kind === 'script')) continue;   // an edited script check keeps its kind
    const o = el(doc, 'option', '', CHECK_KIND_LABELS[k]);
    o.value = k;
    kind.append(o);
  }
  kind.value = check ? check.kind : 'words';
  const fields = el(doc, 'div', 'wft-ck-fields');
  const preview = el(doc, 'p', 'hint wft-ck-preview');
  preview.setAttribute('aria-live', 'polite');
  const scriptName = (k) => (scripts.find((s) => s.key === k) || {}).displayName || k;
  let read = () => ({ kind: kind.value });
  const paintPreview = () => {
    const { check: ok } = normaliseCheck(read());
    preview.textContent = ok ? checkLabel(ok, { scriptName: ok.kind === 'script' ? scriptName(ok.key) : null }) : '';
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
    paintPreview();
  };
  kind.addEventListener('change', paintFields);
  paintFields();
  return testDialog({
    doc, win, title: check ? 'Edit the automatic check' : 'Add an automatic check', confirmLabel: 'Save check',
    body: [el(doc, 'p', 'hint', 'Counted exactly, without AI.'), field(doc, 'What to check', kind, { id: kind.id }), fields, preview],
    onRemove: check && onRemove ? onRemove : null,
    onConfirm: () => {
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
  if (extra) wrap.append(extra);
  if (after) wrap.append(el(doc, 'span', 'wft-basic-after', after));
  return { wrap, input };
}

/**
 * @param {HTMLElement} root
 * @param {object} ex an example (the store's shape) or BLANK_EXAMPLE
 * @param {{back:Function, save:Function, tryOnce:Function, addFiles:Function, removeFile:Function}} actions
 *   each → Promise<{ok, error?, example?}>; an `example` with an error (a partly done upload) is still shown
 * @param {{doc: Document, win: Window, scripts?: Array<{key:string, displayName?:string}>|null, perTryUsd?: number|null,
 *   draftLabel?: string, testRunning?: boolean}} ctx  scripts null: the Library did not load; testRunning: a test of
 *   this workflow runs, so Try it once now waits (G19)
 * @returns {{value: () => object}}
 */
export function renderExampleEditor(root, ex, actions, { doc, win, scripts = [], perTryUsd = null, draftLabel = 'your draft', testRunning = false }) {
  const listed = scripts;
  const lib = Array.isArray(scripts) ? scripts : [];
  const draft = clone({ ...BLANK_EXAMPLE, ...ex });
  root.replaceChildren();
  const page = el(doc, 'div', 'wft-page wft-editor');
  const error = el(doc, 'p', 'hint err wft-error');
  error.setAttribute('aria-live', 'polite');
  const failed = (r, fallback) => { if (!r || !r.ok) error.textContent = (r && r.error) || fallback; };

  // One editor action at a time: Save, Try it once now and the file controls wait while one runs (no second post).
  let busyN = 0;
  const paintBusy = () => {
    const on = busyN > 0;
    saveBtn.disabled = on;
    tryBtn.disabled = on || testRunning;
    picker.disabled = on;
    for (const b of files.querySelectorAll('button')) b.disabled = on;
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
    if (busyN) return;
    error.textContent = '';
    const problem = limitsProblem();
    if (problem) { error.textContent = problem; return; }
    failed(await busyWhile(() => fn(value())), 'That did not work. Try again.');
  };
  const tryBtn = btn(doc, 'Try it once now', () => void run(actions.tryOnce), 'btn');
  const saveBtn = btn(doc, 'Save example', () => void run(actions.save), 'btn btn-primary');
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
  const c1 = card(doc, '1. What Worca gets', 'wft-c1-h', 'The same request and files are used every time this example is tried.', 'wft-c1');
  c1.append(field(doc, 'Name of the example', name, { id: name.id }), field(doc, 'Request', request, { id: request.id }), field(doc, 'Files', files));

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
  const paintChecks = () => {
    lines.replaceChildren();
    draft.checks.forEach((c, i) => {
      const line = el(doc, 'div', 'wft-line');
      const label = checkLabel(c, { scriptName: c.kind === 'script' ? scriptName(c.key) : null });
      const edit = btn(doc, 'Edit', () => openCheckDialog({ doc, win, check: c, scripts: listed,
        onSave: (nc) => { draft.checks[i] = nc; paintChecks(); }, onRemove: () => { draft.checks.splice(i, 1); paintChecks(); return addCk; } }));
      edit.setAttribute('aria-label', `Edit ${label}`);
      edit.dataset.focusKey = `ck-${c.id || i}`;
      const main = el(doc, 'div', 'wft-line-main');
      main.append(el(doc, 'span', 'wft-line-text', label));
      if (c.kind === 'script' && scriptGone(listed, c.key)) main.append(el(doc, 'span', 'hint wft-gone', GONE_TEXT));
      line.append(main, edit);
      lines.append(line);
    });
    addCk = btn(doc, 'Add an automatic check', () => openCheckDialog({ doc, win, scripts: listed, onSave: (nc) => { draft.checks.push(nc); paintChecks(); } }));
    addCk.dataset.focusKey = 'ck-add';
    lines.append(addCk);
  };
  paintChecks();
  const sect = el(doc, 'div', 'wft-sect');
  sect.append(el(doc, 'p', 'wft-grp', 'Automatic checks'), el(doc, 'p', 'wft-grp-hint', 'Counted exactly, without AI. Pick a ready check, or a script from the Library.'), lines);   // C3
  c3.append(sect);

  const cols = el(doc, 'div', 'wft-cols');
  const left = el(doc, 'div', 'wft-col');
  left.append(c1, c2, c4);
  cols.append(left, c3);
  page.append(cols);
  root.append(page);
  paintFiles();

  /** The cost box in dollars: "$1.50", "1,50" (a decimal comma) → 1.5; empty → null; not a number → NaN. */
  function readMoney() {
    let t = String(cost.value).trim().replace(/[^0-9.,]/g, '');
    if (t === '') return null;
    t = t.includes('.') ? t.replace(/,/g, '') : t.replace(',', '.');
    return Number(t);
  }
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
    };
  }
  return { value };
}

// ui/public/workflows/test-dialogs.mjs — the workflow tests dialogs (plans/workflow-tests-part2-plan.md Tasks 12–13):
// pick a past run (G7), use this run as a test example (board 3), and test a version (board 4, Task 13). Pure DOM.
import { el, seg, field, testDialog, runStatusBadge } from './test-ui.mjs';

/** Auto's id (src/core/graph/builtin-workflows.mjs AUTO_WORKFLOW_ID; the browser cannot load /src/core, and the dialogs
 *  test pins this to the server's constant). An Auto run that matched no saved workflow keeps it (auto/proposal.mjs). */
const AUTO_WORKFLOW_ID = 'wf_auto';

/** G6: the run page's More menu offers "Use as test example" for a finished no-project run of a saved user workflow. A
 *  plugin's workflow (`wfp_<plugin>_<slug>`, plugin-workflows.mjs) has no tests (review M7), nor has Auto when it matched no
 *  saved workflow: the item would only be refused. */
export function canUseAsExample({ flag, noProject, status, templateId, reserved }) {
  return !!flag && !!noProject && ['done', 'stopped', 'error'].includes(String(status || '')) && !!templateId && !reserved
    && templateId !== AUTO_WORKFLOW_ID && !/^wfp_/.test(String(templateId));
}

/** G7: the Tests list's "Add from a past run" — which run, then board 3. */
export function openPickRunDialog({ doc, win, workflowName, runs = [], dateText, onPick }) {
  const body = [];
  if (!runs.length) {
    body.push(el(doc, 'p', 'hint', `Worca found no runs of ${workflowName} without a project yet. Run the workflow once, or write an example yourself.`));
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
      text.append(el(doc, 'b', '', r.title), el(doc, 'span', 'hint', ` · ${dateText(r.at)} · `), runStatusBadge(doc, r));   // C11: an exactly equal request says so, as on the Tests page
      row.append(radio, text);
      list.append(row);
    }
    body.push(list);
  }
  const dlg = testDialog({
    doc, win, title: 'Add from a past run', confirmLabel: 'Next', body,
    onConfirm: () => {
      const hit = [...doc.querySelectorAll('input[name="wft-pick-run"]')].find((x) => x.checked);
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

/** Board 3: "Use this run as a test example" (C4: the verdict is the version's result until it is tested, D29). */
export function openFromRunDialog({ doc, win, past, onSubmit }) {
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
  return testDialog({
    doc, win, title: 'Use this run as a test example', confirmLabel: 'Add example',
    body: [
      el(doc, 'p', 'wft-fr-intro', `Worca keeps the request and files, so every new version of ${past.workflowName} can be tried on exactly the same thing.`),
      field(doc, 'Name of the example', name, { id: name.id }), keep,
      field(doc, 'How was this result?', how),
      field(doc, 'What should a good result have?', note, { id: note.id, opt: 'in your own words' }),
      hint,
    ],
    onConfirm: () => {
      if (!name.value.trim()) return { ok: false, error: 'Give the example a name.' };
      return onSubmit({ name: name.value.trim(), keepRequest: req.box.checked, keepAnswers: ans ? ans.box.checked : false, verdict,
        note: note.value.trim() || null });
    },
  });
}

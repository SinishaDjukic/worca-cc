// test/ui-script-forms.test.mjs — the shared script forms (scripts-workbench C3):
// the params form, the port editor and the param-definition editor, plus their
// collectors. Pure jsdom; the composer's inspector uses the SAME functions
// (test/ui-inspector-script.test.mjs pins them through renderNodeInspector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderParamsForm, collectParams, renderPortEditor, collectPorts, applyPortEdit,
  PARAMS_CAPTION,
  PARAM_EDITOR_LANGUAGE, paramEditorLanguage, paramEditorHook,
} from '../ui/public/script-forms.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const mount = (el) => { const host = doc.createElement('div'); host.appendChild(el); return host; };

const META = {
  key: 'runTests', displayName: 'Run tests', runtime: 'node', timeoutMs: 20000,
  verdict: { filename: 'tests-cycle{cycle}.json' },
  params: [
    { id: 'passAt', type: 'number', label: 'Pass at', default: 0 },
    { id: 'stat', type: 'boolean', default: false },
    { id: 'mode', type: 'enum', options: ['fast', 'full'], default: 'fast' },
    { id: 'note', type: 'string' },
    { id: 'source', type: 'code', language: 'js', required: true },
  ],
};

test('renderParamsForm: one control per declared type, the effective value, one caption', () => {
  const host = mount(renderParamsForm(META, { params: { passAt: 2, note: 'x' } }, { doc }));
  assert.equal(host.querySelector('.ins-zone').textContent, 'Params');
  assert.equal(host.querySelector('[data-field="param:passAt"]').type, 'number');
  assert.equal(host.querySelector('[data-field="param:passAt"]').value, '2');
  assert.equal(host.querySelector('[data-field="param:stat"]').type, 'checkbox');
  assert.equal(host.querySelector('[data-field="param:stat"]').checked, false);
  assert.equal(host.querySelector('[data-field="param:mode"]').value, 'fast', 'the sidecar default shows');
  assert.equal(host.querySelector('[data-field="param:note"]').value, 'x');
  assert.equal(host.querySelector('textarea[data-field="param:source"]').rows, 8);
  assert.ok(host.querySelector('textarea[data-field="param:source"]').closest('.ins-f').classList.contains('ins-missing'));
  assert.equal(host.querySelectorAll('.ins-caption').length, 1);
  assert.equal(host.querySelector('.ins-caption').textContent, PARAMS_CAPTION);
  assert.equal(PARAMS_CAPTION, "Runs with worca's privileges.");
  assert.equal(mount(renderParamsForm({ params: [] }, {}, { doc })).children.length, 0, 'no params, no zone');
});

test('renderParamsForm: editorFor replaces the code/command textarea, keeping the data-field control', () => {
  const asked = [];
  const editorFor = (param, value) => {
    asked.push([param.id, value]);
    if (param.type !== 'code') return null;
    const box = doc.createElement('div');
    box.className = 'fake-editor';
    const ta = doc.createElement('textarea');
    ta.dataset.field = `param:${param.id}`;
    ta.value = value == null ? '' : String(value);
    box.appendChild(ta);
    return box;
  };
  const host = mount(renderParamsForm(META, { params: { source: 'export default () => {};' } }, { doc, editorFor }));
  assert.deepEqual(asked, [['source', 'export default () => {};']], 'only command/code params are offered an editor');
  assert.ok(host.querySelector('.fake-editor'));
  assert.equal(host.querySelectorAll('textarea.ins-textarea').length, 0, 'the plain textarea is gone');
  assert.equal(host.querySelector('[data-field="param:source"]').value, 'export default () => {};');
  assert.equal(host.querySelectorAll('.ins-caption').length, 1, 'the caption still rides with it');
});

test('paramEditorLanguage: command is a shell, code follows its declared language', () => {
  assert.deepEqual(PARAM_EDITOR_LANGUAGE, { command: 'bash', js: 'javascript', python: 'python' });
  assert.equal(paramEditorLanguage({ id: 'c', type: 'command' }), 'bash');
  assert.equal(paramEditorLanguage({ id: 's', type: 'code', language: 'js' }), 'javascript');
  assert.equal(paramEditorLanguage({ id: 's', type: 'code', language: 'python' }), 'python');
  assert.equal(paramEditorLanguage({ id: 's', type: 'code' }), 'javascript', 'no language declared');
  assert.equal(paramEditorLanguage({ id: 's', type: 'code', language: 'brainfuck' }), 'javascript', 'no grammar for it');
  assert.equal(paramEditorLanguage(null), 'javascript');
});

test('paramEditorHook builds ONE editor per command/code param and hands the handle back', async () => {
  const editors = [];
  const host = mount(renderParamsForm(META, { params: { source: 'const a = 1;' } },
    { doc, editorFor: paramEditorHook({ doc, highlight: async (t) => t, editors }) }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(editors.length, 1);
  assert.equal(host.querySelectorAll('.code-editor').length, 1);
  assert.equal(host.querySelector('.code-editor').dataset.language, 'javascript');
  assert.equal(host.querySelector('.code-editor textarea').dataset.field, 'param:source');
  assert.equal(host.querySelector('.code-editor textarea').rows, 8);
  assert.equal(host.querySelectorAll('textarea.ins-textarea').length, 0);
  assert.equal(host.querySelectorAll('.ins-caption').length, 1);
  editors.forEach((e) => e.destroy());
  const none = mount(renderParamsForm(META, {}, { doc, editorFor: paramEditorHook({ doc, highlight: null, editors: [] }) }));
  assert.equal(none.querySelector('.code-editor'), null, 'no highlighter, no editor');
  assert.ok(none.querySelector('textarea.ins-textarea[data-field="param:source"]'));
});

test('paramEditorHook gives a command param three rows of bash', async () => {
  const editors = [];
  const meta = { params: [{ id: 'command', type: 'command', label: 'Command', default: 'npm test' }] };
  const host = mount(renderParamsForm(meta, {}, { doc, editorFor: paramEditorHook({ doc, highlight: async (t) => t, editors }) }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(host.querySelector('.code-editor').dataset.language, 'bash');
  assert.equal(host.querySelector('.code-editor textarea').rows, 3);
  assert.equal(host.querySelector('.code-editor textarea').value, 'npm test');
  editors.forEach((e) => e.destroy());
});

test('collectParams: types, blanks, and the two error sources', () => {
  const host = mount(renderParamsForm(META, { params: { passAt: 2, note: 'x', source: 'code' } }, { doc }));
  host.querySelector('[data-field="param:stat"]').checked = true;
  host.querySelector('[data-field="param:note"]').value = '  ';
  const out = collectParams(host, META);
  assert.deepEqual(out.values, { passAt: 2, stat: true, mode: 'fast', note: '  ', source: 'code' });
  assert.deepEqual(out.errors, []);
  host.querySelector('[data-field="param:passAt"]').value = '';
  host.querySelector('textarea[data-field="param:source"]').value = '';
  const blank = collectParams(host, META);
  assert.equal('passAt' in blank.values, false, 'a blank number is absent, not NaN');
  assert.deepEqual(blank.errors, ['source is required.'], 'the required code param, by its label');
  host.querySelector('textarea[data-field="param:source"]').value = '   ';
  assert.deepEqual(collectParams(host, META).errors, ['source is required.'],
    'a blanks-only code/command value is NO value (the runner trims it) — the composer`s coerceParam rule');
});

test('renderPortEditor + collectPorts round-trip the storage rules', () => {
  const raw = {
    inputs: [{ id: 'in', type: 'md', required: false }, { id: 'again', type: 'md', required: true, loop: true }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
  };
  const ed = renderPortEditor(raw, { doc, hasVerdict: true });
  const host = mount(ed);
  assert.deepEqual([...ed.querySelectorAll('.ins-prow')].map((r) => [r.dataset.dir, r.dataset.index]),
    [['inputs', '0'], ['inputs', '1'], ['outputs', '0'], ['outputs', '1']]);
  assert.equal(ed.querySelector('[data-field="port:inputs:1:loop"]').checked, true);
  assert.equal(ed.querySelector('[data-field="port:outputs:1:filename"]').hidden, true);
  assert.deepEqual([...ed.querySelectorAll('[data-port-add]')].map((b) => b.dataset.portAdd), ['inputs', 'outputs']);
  assert.deepEqual(collectPorts(host), raw, 'what it rendered is what it reads back');
  ed.querySelector('[data-field="port:outputs:0:filename"]').value = '';
  assert.equal('filename' in collectPorts(host).outputs[0], false, 'a blank filename is absent, not ""');
});

test('renderPortEditor: no sidecar verdict locks `when`; readOnly disables and drops the buttons', () => {
  const raw = { inputs: [], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'x.md' }] };
  const locked = renderPortEditor(raw, { doc, hasVerdict: false });
  assert.equal(locked.querySelector('[data-field="port:outputs:0:when"]').disabled, true);
  assert.equal(locked.querySelector('[data-field="port:outputs:0:when"]').closest('.ins-f').title, 'needs a sidecar verdict');
  const ro = renderPortEditor(raw, { doc, hasVerdict: true, readOnly: true });
  assert.equal(ro.querySelector('[data-port-add]'), null, 'omitted, not hidden');
  assert.equal(ro.querySelector('[data-port-remove]'), null);
  assert.equal(ro.querySelector('[data-field="port:outputs:0:id"]').disabled, true);
  assert.equal(ro.querySelector('[data-field="port:outputs:0:when"]').disabled, true);
});

test('renderPortEditor surfaces the shared reader`s errors', () => {
  const bad = renderPortEditor({ inputs: [{ id: 'await', type: 'md' }], outputs: [] }, { doc, hasVerdict: true });
  assert.match(bad.querySelector('.ins-perr').textContent, /port id "await" is reserved/);
});

test('applyPortEdit is pure and mints the composer`s ids and filenames', () => {
  const raw = { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [] };
  const added = applyPortEdit(raw, { add: 'outputs' });
  assert.deepEqual(added.outputs, [{ id: 'out', type: 'md', when: 'always', filename: 'out-cycle{cycle}.md' }]);
  assert.deepEqual(raw.outputs, [], 'the argument is untouched');
  assert.notEqual(added.inputs[0], raw.inputs[0], 'rows are cloned one level deep');
  const twice = applyPortEdit(added, { add: 'outputs' });
  assert.deepEqual(twice.outputs.map((p) => p.id), ['out', 'out2']);
  const more = applyPortEdit(twice, { add: 'inputs' });
  assert.deepEqual(more.inputs.map((p) => p.id), ['in', 'in2']);
  assert.deepEqual(applyPortEdit(twice, { remove: 'outputs:0' }).outputs.map((p) => p.id), ['out2']);
  assert.deepEqual(applyPortEdit(twice, { remove: 'outputs:9' }).outputs.map((p) => p.id), ['out', 'out2'], 'an unknown index is a no-op');
  assert.deepEqual(applyPortEdit(undefined, { add: 'inputs' }), { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [] });
});

test('paramEditorHook mounts a python code param with the python grammar (workbench §7)', async () => {
  // The shape the built-in `py` card ships: type code, language python, 8 rows.
  const editors = [];
  const meta = { key: 'py', displayName: 'Python', runtime: 'python',
    params: [{ id: 'source', type: 'code', language: 'python', label: 'Source', required: true }] };
  const host = mount(renderParamsForm(meta, { params: { source: 'def main(api):\n    return {}\n' } },
    { doc, editorFor: paramEditorHook({ doc, highlight: async (t) => t, editors }) }));
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(host.querySelector('.code-editor').dataset.language, 'python');
  assert.equal(host.querySelector('.code-editor textarea').dataset.field, 'param:source');
  assert.equal(host.querySelector('.code-editor textarea').value, 'def main(api):\n    return {}\n');
  assert.equal(host.querySelector('.code-editor textarea').rows, 8);
  assert.equal(host.querySelectorAll('textarea.ins-textarea').length, 0, 'the plain textarea is replaced');
  assert.equal(host.querySelectorAll('.ins-caption').length, 1, 'the privileges caption still rides with it');
  assert.equal(paramEditorLanguage(meta.params[0]), PARAM_EDITOR_LANGUAGE.python);
  editors.forEach((e) => e.destroy());
});

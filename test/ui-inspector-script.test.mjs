// test/ui-inspector-script.test.mjs — the script inspector (spec §10.3): pure DOM, no composer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderNodeInspector } from '../ui/public/graph/inspector.mjs';
import { portsFnFor } from '../src/shared/graph/ports.mjs';

const doc = new JSDOM('<!doctype html><body></body>').window.document;
const SHELL = { key: 'shell', displayName: 'Shell', description: 'Runs a command.', origin: 'builtin', runtime: 'shell', color: 'amber', ports: 'config', timeoutMs: 600000,
  verdict: { filename: 'shell-cycle{cycle}.json' },
  defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] },
  params: [{ id: 'command', type: 'command', label: 'Command', required: true }] };
const TESTS = { key: 'runTests', displayName: 'Run tests', origin: 'user', runtime: 'node', color: 'violet', timeoutMs: 20000,
  inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }],
  params: [{ id: 'passAt', type: 'number', label: 'Pass at', default: 0 }, { id: 'stat', type: 'boolean', default: false }, { id: 'mode', type: 'enum', options: ['fast', 'full'], default: 'fast' }, { id: 'note', type: 'string' }, { id: 'source', type: 'code', language: 'js', required: true }] };
const portsFn = portsFnFor({}, { shell: SHELL, runTests: TESTS });
const tpl = { nodes: [], wires: [] };

test('a sidecar-ported script: head, chips, one control per param type, timeout in seconds, await, read-only ports', () => {
  const node = { id: 'n_t', kind: 'script', key: 'runTests', config: { params: { passAt: 2, note: 'x' }, timeoutMs: 5000 } };
  const el = renderNodeInspector(node, { template: tpl, portsFn, meta: TESTS, doc });
  assert.ok(el.classList.contains('ins-script'));
  assert.equal(el.querySelector('.ins-name').textContent, 'Run tests');
  assert.equal(el.querySelector('.ins-sub').textContent, 'runTests · n_t');
  assert.equal(el.querySelector('.ins-chiprow .badge').textContent, 'user');
  assert.equal(el.querySelector('.ins-chiprow .chip.rt').textContent, 'node');
  assert.equal(el.querySelector('[data-field="param:passAt"]').type, 'number');
  assert.equal(el.querySelector('[data-field="param:passAt"]').value, '2');
  assert.equal(el.querySelector('[data-field="param:stat"]').type, 'checkbox');
  assert.equal(el.querySelector('[data-field="param:stat"]').checked, false);
  assert.deepEqual([...el.querySelector('[data-field="param:mode"]').options].map((o) => o.value), ['fast', 'full']);
  assert.equal(el.querySelector('[data-field="param:mode"]').value, 'fast', 'the sidecar default shows when the card sets nothing');
  assert.equal(el.querySelector('[data-field="param:note"]').value, 'x');
  const code = el.querySelector('textarea[data-field="param:source"]');
  assert.equal(code.rows, 8);
  assert.ok(code.closest('.ins-f').classList.contains('ins-missing'), 'a required param with no value and no default is flagged');
  assert.equal(el.querySelectorAll('.ins-caption').length, 1);
  assert.equal(el.querySelector('.ins-caption').textContent, "Runs with worca's privileges.");
  assert.equal(el.querySelector('[data-field="timeoutMs"]').value, '5');
  assert.ok(el.querySelector('[data-field="awaitAll"]'));
  assert.equal(el.querySelector('[data-field="model"]'), null);
  assert.equal(el.querySelector('[data-field="fanOut"]'), null);
  assert.ok(el.querySelector('.ins-ports') && !el.querySelector('.ins-port-editor'), 'sidecar ports are read-only');
  assert.deepEqual([...el.querySelectorAll('.ins-pitem .pn')].map((n) => n.textContent), ['done', 'await', 'log']);
  const dflt = renderNodeInspector({ id: 'n_t', kind: 'script', key: 'runTests', config: {} }, { template: tpl, portsFn, meta: TESTS, doc });
  assert.equal(dflt.querySelector('[data-field="timeoutMs"]').value, '20', 'the sidecar timeout when the card sets none');
});

test('a config-ported script gets the port editor with rows, add/remove controls and the reader`s errors', () => {
  const node = { id: 'n_s', kind: 'script', key: 'shell', config: { params: { command: 'npm test' },
    ports: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] } } };
  const el = renderNodeInspector(node, { template: tpl, portsFn, meta: SHELL, doc });
  const ed = el.querySelector('.ins-port-editor');
  assert.ok(ed);
  assert.equal(el.querySelector('textarea[data-field="param:command"]').rows, 3);
  assert.equal(el.querySelector('textarea[data-field="param:command"]').value, 'npm test');
  const rows = [...ed.querySelectorAll('.ins-prow')].map((r) => [r.dataset.dir, r.dataset.index]);
  assert.deepEqual(rows, [['inputs', '0'], ['outputs', '0'], ['outputs', '1']]);
  assert.equal(ed.querySelector('[data-field="port:inputs:0:id"]').value, 'in');
  assert.equal(ed.querySelector('[data-field="port:inputs:0:required"]').checked, false);
  assert.ok(ed.querySelector('[data-field="port:inputs:0:loop"]'));
  assert.equal(ed.querySelector('[data-field="port:outputs:0:when"]').value, 'always');
  assert.equal(ed.querySelector('[data-field="port:outputs:0:filename"]').value, 'shell-cycle{cycle}.md');
  assert.equal(ed.querySelector('[data-field="port:outputs:1:filename"]').hidden, true, 'a void output has no filename');
  assert.equal(ed.querySelector('[data-field="port:outputs:1:when"]').value, 'clean');
  assert.deepEqual([...ed.querySelectorAll('[data-port-add]')].map((b) => b.dataset.portAdd), ['inputs', 'outputs']);
  assert.deepEqual([...ed.querySelectorAll('[data-port-remove]')].map((b) => b.dataset.portRemove), ['inputs:0', 'outputs:0', 'outputs:1']);
  assert.equal(ed.querySelector('.ins-perr'), null);
  const bad = renderNodeInspector({ ...node, config: { ...node.config, ports: { inputs: [{ id: 'await', type: 'md' }], outputs: [] } } }, { template: tpl, portsFn, meta: SHELL, doc });
  assert.match(bad.querySelector('.ins-perr').textContent, /port id "await" is reserved/);
  const noVerdict = renderNodeInspector({ ...node, config: { ...node.config, ports: { inputs: [], outputs: [{ id: 'log', type: 'md', filename: 'x.md' }] } } }, { template: tpl, portsFn, meta: { ...SHELL, verdict: undefined }, doc });
  assert.equal(noVerdict.querySelector('[data-field="port:outputs:0:when"]').disabled, true, 'no sidecar verdict: when is locked to always');
});

test('interface mode: what the card runs is never gated; timeout, await and ports are expert, kept when set', () => {
  const lvl = (el) => [el.dataset.minLevel || '', el.dataset.levelKeep || ''];
  const plain = renderNodeInspector({ id: 'n_s', kind: 'script', key: 'shell', config: { params: { command: 'npm test' }, ports: SHELL.defaultPorts } }, { template: tpl, portsFn, meta: SHELL, doc });
  assert.deepEqual(lvl(plain.querySelector('[data-field="param:command"]').closest('.ins-f')), ['', '']);
  assert.deepEqual(lvl(plain.querySelector('.ins-chiprow')), ['', '']);
  assert.deepEqual(lvl(plain.querySelector('.ins-timeout')), ['expert', '']);
  assert.deepEqual(lvl(plain.querySelector('.ins-awaitall')), ['expert', '']);
  assert.deepEqual(lvl(plain.querySelector('.ins-port-editor')), ['expert', '']);
  const tuned = renderNodeInspector({ id: 'n_s', kind: 'script', key: 'shell', config: { timeoutMs: 5000, awaitAll: true, ports: SHELL.defaultPorts } }, { template: tpl, portsFn, meta: SHELL, doc });
  assert.deepEqual(lvl(tuned.querySelector('.ins-timeout')), ['expert', '1']);
  assert.deepEqual(lvl(tuned.querySelector('.ins-awaitall')), ['expert', '1']);
  assert.equal(tuned.querySelector('[data-field="timeoutMs"]').max, '86400');
});

test('an enum param with no value and no default shows a blank option, never a choice the config does not hold', () => {
  const meta = { ...TESTS, params: [{ id: 'mode', type: 'enum', options: ['fast', 'full'], required: true }] };
  const el = renderNodeInspector({ id: 'n_t', kind: 'script', key: 'runTests', config: {} }, { template: tpl, portsFn, meta, doc });
  const sel = el.querySelector('[data-field="param:mode"]');
  assert.deepEqual([...sel.options].map((o) => o.value), ['', 'fast', 'full']);
  assert.equal(sel.value, '');
  assert.ok(sel.closest('.ins-f').classList.contains('ins-missing'));
});

test('editorFor replaces the code/command textarea and keeps the routed control', () => {
  const built = [];
  const editorFor = (param, value) => {
    built.push([param.id, param.type, value]);
    const box = doc.createElement('div');
    box.className = 'stub-editor';
    const ta = doc.createElement('textarea');
    ta.dataset.field = `param:${param.id}`;
    ta.value = value == null ? '' : String(value);
    box.appendChild(ta);
    return box;
  };
  const node = { id: 'n_t', kind: 'script', key: 'runTests', config: { params: { source: 'export default () => {};' } } };
  const el = renderNodeInspector(node, { template: tpl, portsFn, meta: TESTS, doc, editorFor });
  assert.deepEqual(built, [['source', 'code', 'export default () => {};']], 'only code/command params are offered one');
  assert.ok(el.querySelector('.stub-editor'));
  assert.equal(el.querySelectorAll('textarea.ins-textarea').length, 0);
  assert.equal(el.querySelector('[data-field="param:source"]').value, 'export default () => {};');
  assert.equal(el.querySelectorAll('.ins-caption').length, 1, 'the privileges caption still rides with it');
  const plain = renderNodeInspector(node, { template: tpl, portsFn, meta: TESTS, doc });
  assert.equal(plain.querySelector('textarea.ins-textarea[data-field="param:source"]').rows, 8,
    'no hook: the plain textarea, unchanged');
});

test('the params-port toggle shows only where a wire has something to set, lists what it can set, and the port list badges the engine port', () => {
  const node = { id: 'n_t', kind: 'script', key: 'runTests', config: { paramsPort: true } };
  const el = renderNodeInspector(node, { template: tpl, portsFn, meta: TESTS, doc });
  const box = el.querySelector('[data-field="paramsPort"]');
  assert.equal(box.type, 'checkbox');
  assert.equal(box.checked, true);
  assert.equal(box.closest('.ins-tog').querySelector('.ins-tog-t').textContent, 'Params from a wire');
  assert.equal(box.closest('.ins-tog').querySelector('.ins-tog-h').textContent, 'json sets: passAt, stat, mode, note', 'the code param is not listed');
  assert.deepEqual([...el.querySelectorAll('.ins-pitem .pn')].map((n) => n.textContent), ['done', 'params', 'await', 'log']);
  const row = [...el.querySelectorAll('.ins-pitem')].find((r) => r.querySelector('.pn').textContent === 'params');
  assert.equal(row.querySelector('.pt').textContent, 'json · engine');
  assert.equal(row.classList.contains('gate'), false, 'an ordinary row, not the await gate');
  const off = renderNodeInspector({ id: 'n_t', kind: 'script', key: 'runTests', config: {} }, { template: tpl, portsFn, meta: TESTS, doc });
  assert.equal(off.querySelector('[data-field="paramsPort"]').checked, false);
  const sh = renderNodeInspector({ id: 'n_s', kind: 'script', key: 'shell', config: { ports: SHELL.defaultPorts } }, { template: tpl, portsFn, meta: SHELL, doc });
  assert.equal(sh.querySelector('[data-field="paramsPort"]'), null, 'a command-only card has nothing to wire');
  const stuck = renderNodeInspector({ id: 'n_s', kind: 'script', key: 'shell', config: { ports: SHELL.defaultPorts, paramsPort: true } }, { template: tpl, portsFn, meta: SHELL, doc });
  assert.equal(stuck.querySelector('[data-field="paramsPort"]').checked, true, 'a ticked box always renders: the opt-in V22 refuses can still be un-ticked');
  assert.equal(stuck.querySelector('[data-field="paramsPort"]').closest('.ins-tog').querySelector('.ins-tog-h').textContent, 'json sets: nothing');
});

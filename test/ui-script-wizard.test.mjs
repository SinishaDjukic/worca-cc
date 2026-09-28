// test/ui-script-wizard.test.mjs — the two steps' pixels (script-wizard plan S1, S9, S11, S16, S20): pure renderers, jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  renderRuntimeStep, renderWorkspace, renderInterfacePanel, renderTile, collectScriptDraft, EDITOR_LANGUAGE, IFACE_HINTS,
} from '../ui/public/script-wizard.mjs';
import { SCRIPT_ICONS, iconSvgOf, SCRIPT_GLYPH } from '../src/shared/graph/script-icons.mjs';
import { SCRIPT_COLORS } from '../src/shared/graph/script-meta.mjs';
import { inferInterface, mergeInterface } from '../src/shared/graph/script-infer.mjs';
import { blankScriptMeta, SCRIPT_TEMPLATES, SCRIPT_EXAMPLES } from '../src/shared/graph/script-templates.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const RUNTIMES = { node: { ok: true, version: '22.13.0' }, shell: { ok: true, path: '/bin/sh' },
  python: { ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' } };
const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];
const field = (root, name) => q(root, `[data-field="${name}"]`);
const dispose = (root) => (root._editors || []).forEach((e) => e.destroy());

const USER_META = {
  key: 'diffGate', metaVersion: 2, displayName: 'Diff gate', description: 'Blocks wide diffs.', domain: 'coding', color: 'teal',
  icon: iconSvgOf('funnel'), order: 20, origin: 'user', runtime: 'node', file: 'diffGate.mjs', timeoutMs: 120000,
  params: [{ id: 'maxFiles', type: 'number', default: 10, required: false }, { id: 'mode', type: 'enum', options: ['a', 'b'], default: 'a', required: false }],
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'report', type: 'md', when: 'blocking', filename: 'r-{cycle}.md' }],
  verdict: { filename: 'dg-{cycle}.json' },
};
const USER = { meta: USER_META, source: SCRIPT_EXAMPLES.node.source, sourceWin32: '', sourcePath: '/home/u/.worca-cc/scripts/diffGate.mjs',
  sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
const rowsFor = (data) => mergeInterface({ inferred: inferInterface(data.source, data.meta.runtime), saved: data.meta });

test('renderRuntimeStep: three cards, the picked one pressed and ticked, python disabled with the probe`s reason, Continue live', () => {
  const root = renderRuntimeStep({ doc, runtimes: RUNTIMES, picked: 'node' });
  assert.equal(root.dataset.step, '1');
  const cards = qa(root, '.rt');
  assert.deepEqual(cards.map((c) => c.dataset.runtime), ['node', 'shell', 'python']);
  assert.equal(cards[0].getAttribute('aria-pressed'), 'true');
  assert.ok(q(cards[0], '.rt-check'));
  assert.equal(cards[2].disabled, true);
  assert.equal(cards[2].title, RUNTIMES.python.reason);
  assert.match(q(cards[0], '.rt-probe').textContent, /Node 22\.13\.0 · ready/);
  assert.equal(q(cards[2], '.rt-probe').textContent, 'python not found');
  assert.equal(q(cards[1], '.rt-probe').textContent, 'sh · cmd.exe on Windows');
  assert.equal(q(root, '.wz-continue').disabled, false);
  assert.ok(q(root, '.wz-cancel'));
  assert.equal(qa(root, 'p').length, 0);
  const py = renderRuntimeStep({ doc, runtimes: RUNTIMES, picked: 'python' });
  assert.equal(q(py, '.wz-continue').disabled, true, 'a disabled runtime cannot be continued with');
});

test('renderTile: the card as the palette shows it — name or Untitled, key, runtime chip, $0, the tile colour and icon', () => {
  const t = renderTile({ doc, name: '', key: '', runtime: 'shell', color: 'amber', icon: '' });
  assert.equal(q(t, '.pv-name').textContent, 'Untitled script');
  assert.ok(q(t, '.pv-name').classList.contains('muted'));
  assert.equal(q(t, '.pv-key').textContent, 'key');
  assert.equal(q(t, '.chip-rt').textContent, 'Shell');
  assert.ok(qa(t, '.chip').some((c) => c.textContent === '$0 per run'));
  assert.ok(q(t, '.tile').classList.contains('tile-amber'));
  // jsdom re-serializes a self-closed <path/> as <path></path>, so the svg carries the NAME it was built from.
  assert.equal(q(t, '.tile svg').dataset.iconName, 'glyph', 'no icon = the ƒ');
  assert.ok(q(t, '.tile svg path'));
  const named = renderTile({ doc, name: 'Run tests', key: 'runTests', runtime: 'node', color: 'teal', icon: iconSvgOf('bolt') });
  assert.equal(q(named, '.pv-name').textContent, 'Run tests');
  assert.ok(q(named, '.tile').classList.contains('tile-teal'));
  assert.equal(q(named, '.tile svg').dataset.iconName, 'bolt');
  const custom = renderTile({ doc, name: 'x', key: 'x', runtime: 'node', color: 'nope', icon: '<path d="M1 1"/><script>1</script>' });
  assert.ok(q(custom, '.tile').classList.contains('tile-amber'), 'an unknown colour falls back');
  assert.equal(q(custom, '.tile svg').dataset.iconName, 'glyph', 'an icon the allowlist rejects is the glyph, never raw');
  assert.equal(q(custom, '.tile svg script'), null);
  const hand = renderTile({ doc, name: 'x', key: 'x', runtime: 'node', color: 'blue', icon: '<path d="M1 1"/>' });
  assert.equal(q(hand, '.tile svg').dataset.iconName, 'custom', 'a hand-written icon that passes the allowlist renders as-is');
  assert.equal(q(hand, '.tile svg path').getAttribute('d'), 'M1 1');
  assert.equal(SCRIPT_GLYPH.length > 0, true);
});

test('renderWorkspace: header, tile, identity (12 swatches, 20 icons, the picked ones), interface, advanced closed, editor, test mount', () => {
  const rows = rowsFor(USER);
  const root = renderWorkspace(USER, { doc, runtimes: RUNTIMES, rows, verdict: true, highlight: async (t) => t });
  assert.equal(root.dataset.scriptKey, 'diffGate');
  assert.equal(root.dataset.step, '2');
  assert.ok(q(root, '.script-back'));
  const pill = q(root, '.wz-step-pill[data-step="1"]');
  assert.equal(pill.disabled, false);
  assert.equal(q(pill, '.chip-rt').textContent, 'Node.js');
  assert.ok(q(root, '.script-duplicate') && q(root, '.script-delete') && q(root, '.script-save'));
  assert.equal(q(root, '.script-save').disabled, false);
  assert.equal(q(root, '.script-dirty').hidden, true);
  assert.equal(q(root, '.wz-tile .pv-name').textContent, 'Diff gate');
  assert.equal(field(root, 'meta:displayName').value, 'Diff gate');
  assert.equal(field(root, 'meta:key').disabled, true, 'a saved key is immutable');
  assert.equal(field(root, 'meta:description').value, 'Blocks wide diffs.');
  assert.equal(qa(root, '.sw').length, 12);
  assert.deepEqual(qa(root, '.sw').map((b) => b.dataset.swatch), [...SCRIPT_COLORS]);
  assert.ok(q(root, '.sw-teal').classList.contains('sel'));
  assert.equal(qa(root, '.ico').length, 20);
  assert.deepEqual(qa(root, '.ico').map((b) => b.dataset.icon), SCRIPT_ICONS.map((i) => i.name));
  assert.ok(q(root, '.ico[data-icon="funnel"]').classList.contains('sel'));
  assert.equal(field(root, 'meta:color').value, 'teal');
  assert.equal(field(root, 'meta:icon').value, iconSvgOf('funnel'));
  assert.equal(field(root, 'meta:runtime').value, 'node');
  assert.ok(q(root, '.wz-iface'));
  assert.equal(q(root, '.wz-adv-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(q(root, '.wz-adv-body').hidden, true);
  assert.equal(q(root, '.wz-adv-sum').textContent, '2 min timeout · coding · order 20');
  assert.equal(field(root, 'meta:timeoutSec').value, '120');
  assert.equal(q(root, '.wz-verdict-file').textContent, 'dg-{cycle}.json');
  assert.equal(q(root, '.wz-file').textContent, 'diffGate.mjs');
  assert.ok(q(root, '.wz-example'));
  assert.equal(field(root, 'script:source').value, SCRIPT_EXAMPLES.node.source);
  assert.equal(q(root, '.code-editor').dataset.language, 'javascript');
  assert.ok(q(root, '.script-test-mount'));
  assert.equal(qa(root, 'p').length, 0);
  assert.equal(root._editors.length, 1);
  dispose(root);
});

test('renderInterfacePanel (node): rows in code order with type chips and hidden mirrors, a stale saved row with × and its chip, when chips only with a verdict, a fixed enum param', () => {
  const rows = rowsFor(USER);
  const panel = renderInterfacePanel({ doc, runtime: 'node', key: 'diffGate', rows, verdict: true });
  const prows = qa(panel, '.wz-prow');
  assert.deepEqual(prows.map((r) => `${r.dataset.side}:${r.dataset.id}`), ['inputs:plan', 'inputs:diff', 'inputs:done', 'outputs:report', 'params:maxFiles', 'params:mode']);
  const plan = prows[0];
  assert.equal(q(plan, '[data-chip="in:plan:type"]').textContent, 'md');
  assert.equal(q(plan, '[data-chip="in:plan:mode"]').textContent, 'optional');
  assert.equal(field(plan, 'iface:in:plan:type').value, 'md');
  assert.equal(field(plan, 'iface:in:plan:inCode').value, '1');
  assert.equal(q(plan, '[data-remove]'), null, 'a port the code reads has no ×');
  const done = prows[2];
  assert.ok(done.classList.contains('stale'));
  assert.equal(q(done, '.chip-warn').textContent, 'not in code');
  assert.equal(q(done, '[data-remove]').dataset.remove, 'inputs:done');
  assert.equal(field(done, 'iface:in:done:inCode').value, '');
  const report = prows[3];
  assert.equal(q(report, '[data-chip="out:report:when"]').textContent, 'on fail');
  assert.equal(field(report, 'iface:out:report:filename').value, 'r-{cycle}.md');
  assert.match(q(panel, '.wz-verdict-chip').textContent, /returned by the script/);
  const mode = prows[5];
  assert.equal(q(mode, '[data-chip="param:mode:type"]').disabled, true, 'enum needs the sidecar: the chip is inert');
  assert.equal(field(mode, 'iface:param:mode:default').value, 'a');
  assert.deepEqual(JSON.parse(field(mode, 'iface:param:mode:extra').value), { required: false, options: ['a', 'b'], fixed: true });
  assert.equal(field(prows[4], 'iface:param:maxFiles:default').value, '10');
  assert.equal(field(panel, 'iface:verdict').value, '1');
  assert.equal(field(panel, 'iface:verdictFilename').value, '', 'the renderer is told the saved filename explicitly');
  const none = renderInterfacePanel({ doc, runtime: 'node', key: 'diffGate', rows, verdict: false });
  assert.equal(q(none, '[data-chip="out:report:when"]'), null);
  assert.equal(q(none, '.wz-verdict-chip'), null);
  const empty = renderInterfacePanel({ doc, runtime: 'python', key: 'x', rows: { inputs: [], outputs: [], params: [] }, verdict: false });
  assert.deepEqual(qa(empty, '.empty').map((e) => e.textContent), [IFACE_HINTS.python.in, IFACE_HINTS.python.out, IFACE_HINTS.python.param]);
});

test('renderInterfacePanel (shell): the routing switch, the exit-code verdict chip; (config) inert rows and `ports per card`', () => {
  const rows = mergeInterface({ inferred: inferInterface(SCRIPT_EXAMPLES.shell.source, 'shell') });
  const on = renderInterfacePanel({ doc, runtime: 'shell', key: 'runTests', rows, verdict: false, routing: true });
  const sw = q(on, '[data-routing]');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.ok(sw.classList.contains('on'));
  assert.match(q(on, '.wz-verdict-chip').textContent, /from the exit code/);
  assert.equal(field(on, 'iface:routing').value, '1');
  assert.equal(q(on, '[data-chip="out:log:when"]').textContent, 'always');
  const off = renderInterfacePanel({ doc, runtime: 'shell', key: 'runTests', rows, verdict: false, routing: false });
  assert.equal(q(off, '[data-routing]').getAttribute('aria-checked'), 'false');
  assert.equal(q(off, '.wz-verdict-chip'), null);
  const cfg = renderInterfacePanel({ doc, runtime: 'shell', key: 'shell', rows: { inputs: [], outputs: [], params: [{ id: 'command', type: 'command', fixed: false, inCode: true }] },
    configPorts: true, defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }] } });
  assert.ok(qa(cfg, '.chip').some((c) => c.textContent === 'ports per card'));
  assert.deepEqual(qa(cfg, '.wz-prow').map((r) => r.dataset.id), ['in', 'log', 'command']);
  assert.equal(q(cfg, '[data-chip="in:in:type"]').disabled, true);
  assert.equal(q(cfg, '[data-routing]'), null);
  assert.equal(field(cfg, 'iface:param:command:default').disabled, false, 'a config script`s params stay editable');
  assert.deepEqual(JSON.parse(field(cfg, 'iface:config').value).outputs[0].id, 'log');
});

test('read-only: every control disabled, no Save, no Load example, no runtime change, the path and Copy', () => {
  const data = { ...USER, meta: { ...USER_META, origin: 'builtin' } };
  const root = renderWorkspace(data, { doc, runtimes: RUNTIMES, rows: rowsFor(data), verdict: true, readOnly: true, highlight: async (t) => t });
  // the code editor's textarea is READ-ONLY (createCodeEditor's own rule), not disabled: it stays scrollable and selectable
  for (const c of qa(root, 'input:not([type="hidden"]),textarea:not(.code-editor-ta),.sw,.ico,.tchip,[data-routing]')) assert.equal(c.disabled, true, c.outerHTML.slice(0, 60));
  assert.equal(q(root, '.code-editor-ta').readOnly, true);
  assert.equal(q(root, '.script-save'), null);
  assert.equal(q(root, '.wz-example'), null);
  assert.equal(q(root, '.wz-step-pill[data-step="1"]').disabled, true);
  assert.equal(q(root, '.script-path').textContent, USER.sourcePath);
  assert.ok(q(root, '.script-copy'));
  assert.ok(q(root, '.code-editor').classList.contains('ro'));
  dispose(root);
});

test('the create page: an editable key, no Duplicate/Delete, Save disabled until there is a name, the template in the editor', () => {
  const data = { meta: blankScriptMeta('python'), source: SCRIPT_TEMPLATES.python, sourceWin32: '' };
  const root = renderWorkspace(data, { doc, runtimes: { ...RUNTIMES, python: { ok: true, version: '3.12.1' } }, isNew: true,
    rows: rowsFor(data), verdict: false, highlight: async (t) => t });
  assert.equal(field(root, 'meta:key').disabled, false);
  assert.equal(q(root, '.script-duplicate'), null);
  assert.equal(q(root, '.script-delete'), null);
  assert.equal(q(root, '.script-save').disabled, true);
  assert.equal(q(root, '.script-save').textContent, 'Save script');
  assert.equal(q(root, '.wz-file').textContent, 'script.py');
  assert.equal(q(root, '.code-editor').dataset.language, EDITOR_LANGUAGE.python);
  assert.equal(field(root, 'meta:color').value, 'blue');
  assert.ok(q(root, '.ico[data-icon="flask"]').classList.contains('sel'));
  dispose(root);
});

test('collectScriptDraft (node): the POST body — identity, minted and saved filenames, the verdict, typed defaults, a removed row is gone', () => {
  const rows = rowsFor(USER);
  const root = renderWorkspace(USER, { doc, runtimes: RUNTIMES, rows, verdict: true, highlight: async (t) => t });
  const d = collectScriptDraft(root);
  assert.equal(d.meta.key, 'diffGate');
  assert.equal(d.meta.color, 'teal');
  assert.equal(d.meta.icon, iconSvgOf('funnel'));
  assert.equal(d.meta.timeoutMs, 120000);
  assert.deepEqual(d.meta.inputs, [{ id: 'plan', type: 'md', required: false }, { id: 'diff', type: 'md', required: false }, { id: 'done', type: 'void', required: false }]);
  assert.deepEqual(d.meta.outputs, [{ id: 'report', type: 'md', when: 'blocking', filename: 'r-{cycle}.md' }]);
  assert.deepEqual(d.meta.params, [{ id: 'maxFiles', type: 'number', default: 10, required: false }, { id: 'mode', type: 'enum', default: 'a', required: false, options: ['a', 'b'] }]);
  assert.deepEqual(d.meta.verdict, { filename: 'dg-{cycle}.json' }, 'the workspace hands the panel the sidecar`s verdict filename');
  assert.equal(d.meta.ports, null);
  assert.equal(d.meta.command, null);
  assert.equal(d.source, SCRIPT_EXAMPLES.node.source);
  assert.equal(d.sourceWin32, '');
  // a panel painted WITHOUT the saved filename (a new script) mints one from the key
  q(root, '.wz-iface').replaceWith(renderInterfacePanel({ doc, runtime: 'node', key: 'diffGate', rows, verdict: true }));
  assert.deepEqual(collectScriptDraft(root).meta.verdict, { filename: 'diffGate-cycle{cycle}.json' });
  // drop the stale row from the DOM (what the controller does on ×): the draft no longer carries it
  q(root, '.wz-prow[data-id="done"]').remove();
  assert.deepEqual(collectScriptDraft(root).meta.inputs.map((p) => p.id), ['plan', 'diff']);
  dispose(root);
});

test('collectScriptDraft (shell): routing mints pass/fail, exit codes ride, Command mode sends a command and no file', () => {
  const meta = { ...blankScriptMeta('shell'), key: 'runTests', displayName: 'Run tests', exitCodes: { clean: [0], blocking: [1, 2] } };
  const data = { meta, source: SCRIPT_EXAMPLES.shell.source, sourceWin32: '' };
  const rows = rowsFor(data);
  const root = renderWorkspace(data, { doc, runtimes: RUNTIMES, isNew: true, rows, routing: true, srcMode: 'file', highlight: async (t) => t });
  const d = collectScriptDraft(root);
  assert.deepEqual(d.meta.outputs.map((p) => [p.id, p.when]), [['log', 'always'], ['pass', 'clean'], ['fail', 'blocking']]);
  assert.deepEqual(d.meta.verdict, { filename: 'runTests-cycle{cycle}.json' });
  assert.deepEqual(d.meta.exitCodes, { clean: [0], blocking: [1, 2] });
  assert.deepEqual(d.meta.params, [{ id: 'command', type: 'string', default: 'npm test', required: false }]);
  assert.equal(d.source, SCRIPT_EXAMPLES.shell.source);
  dispose(root);
  const cmd = { meta: { ...meta, command: 'npm test', file: null }, source: '', sourceWin32: '' };
  const croot = renderWorkspace(cmd, { doc, runtimes: RUNTIMES, isNew: true, rows: rowsFor({ ...cmd, source: 'npm test' }), routing: true, srcMode: 'command', highlight: async (t) => t });
  const c = collectScriptDraft(croot);
  assert.equal(c.meta.command, 'npm test');
  assert.equal(c.source, '');
  assert.equal(q(croot, '.wz-file').textContent, 'command');
  dispose(croot);
});

test('collectScriptDraft (config): ports:"config" and the defaultPorts pass through untouched, the sidecar`s verdict too', () => {
  const meta = { key: 'shellCopy', metaVersion: 2, displayName: 'Shell copy', origin: 'user', runtime: 'shell', color: 'amber', icon: '', order: 99, timeoutMs: 600000,
    ports: 'config', defaultPorts: { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }] },
    verdict: { filename: 'shell-cycle{cycle}.json' }, params: [{ id: 'command', type: 'command', required: true }] };
  const data = { meta, source: '', sourceWin32: '' };
  const root = renderWorkspace(data, { doc, runtimes: RUNTIMES, rows: rowsFor({ ...data, source: 'x' }), srcMode: 'command', highlight: async (t) => t });
  const d = collectScriptDraft(root);
  assert.equal(d.meta.ports, 'config');
  assert.deepEqual(d.meta.defaultPorts, meta.defaultPorts);
  assert.equal(d.meta.inputs, null);
  assert.deepEqual(d.meta.verdict, { filename: 'shell-cycle{cycle}.json' });
  assert.deepEqual(d.meta.params, [{ id: 'command', type: 'command', required: true }]);
  dispose(root);
});

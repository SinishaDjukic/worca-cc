// test/ui-script-detail.test.mjs — the workspace controller (script-wizard plan S1–S17): the two
// steps of a new script, live inference off the editor, chips, the bench for a draft, Save,
// the dirty leave-guard, read-only built-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  createScriptsController, collectScriptDraft, scriptPayload, blankScriptMeta, SCRIPT_TEMPLATES, SHELL_COMMAND_TEMPLATE,
} from '../ui/public/scripts-view.mjs';
import { iconSvgOf } from '../src/shared/graph/script-icons.mjs';
import { SCRIPT_EXAMPLES } from '../src/shared/graph/script-templates.mjs';

const win = new JSDOM('<!doctype html><body></body>').window;
const doc = win.document;
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async (n = 6) => { for (let i = 0; i < n; i += 1) await tick(); };
const RUNTIMES = { node: { ok: true, version: '22.13.0' }, shell: { ok: true, path: '/bin/sh' },
  python: { ok: false, reason: 'no python 3.8 or newer found (tried python3, python)' } };
const ok = (data) => ({ ok: true, status: 200, data });
const q = (root, sel) => root.querySelector(sel);
const qa = (root, sel) => [...root.querySelectorAll(sel)];
const field = (root, name) => q(root, `[data-field="${name}"]`);
const type = (el, value) => { el.value = value; el.dispatchEvent(new win.Event('input', { bubbles: true })); };

const USER_META = {
  key: 'diffGate', metaVersion: 2, displayName: 'Diff gate', description: 'Blocks wide diffs.', domain: 'coding', color: 'teal',
  icon: iconSvgOf('funnel'), order: 20, origin: 'user', runtime: 'node', file: 'diffGate.mjs', timeoutMs: 120000,
  params: [{ id: 'maxFiles', type: 'number', default: 10, required: false }],
  inputs: [{ id: 'done', type: 'void', required: false }],
  outputs: [{ id: 'report', type: 'md', when: 'blocking', filename: 'r-{cycle}.md' }],
  verdict: { filename: 'dg-{cycle}.json' },
};
const USER = { meta: USER_META, source: SCRIPT_EXAMPLES.node.source, sourceWin32: '', sourcePath: '/home/u/.worca-cc/scripts/diffGate.mjs',
  sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
const SHELL_META = { key: 'lint', metaVersion: 2, displayName: 'Lint', description: '', domain: '', color: 'amber', icon: '', order: 30,
  origin: 'user', runtime: 'shell', file: { default: 'lint.sh', win32: 'lint.cmd' }, timeoutMs: 600000,
  exitCodes: { clean: [0], blocking: [1, 2] }, params: [], inputs: [],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'lint-cycle{cycle}.md' }], verdict: { filename: 'lint-cycle{cycle}.json' } };
const SHELL = { meta: SHELL_META, source: '#!/bin/sh\nnpm run lint > "$WORCA_OUT_LOG"\n', sourceWin32: '@echo off\r\nnpm.cmd run lint\r\n',
  sourcePath: '/home/u/.worca-cc/scripts/lint.sh', sourceTruncated: false, cases: [], userCases: [], casesWritable: true };
const BUILTIN = { meta: { ...USER_META, key: 'gitDiff', displayName: 'Git diff', origin: 'builtin' }, source: '// built in\n', sourceWin32: '',
  sourcePath: '/repo/scripts/git-diff.mjs', sourceTruncated: false, cases: [{ id: 'c1', name: 'shipped' }], userCases: [], casesWritable: true };

function mountCtl(apiOver = {}, over = {}) {
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const msgEl = doc.createElement('div');
  const nav = [];
  const asked = [];
  const calls = [];
  const api = {
    calls,
    list: async () => ok({ scripts: [{ ...USER_META, portSummary: '', caseCount: 0 }, { ...SHELL_META, portSummary: '', caseCount: 0 }] }),
    read: async (k) => { calls.push(['read', k]); return ok(k === 'lint' ? SHELL : (k === 'gitDiff' ? BUILTIN : USER)); },
    create: async (b) => { calls.push(['create', b]); return ok({ meta: b.meta, source: b.source }); },
    update: async (k, b) => { calls.push(['update', k, b]); return ok({ meta: b.meta, warnings: [] }); },
    remove: async (k) => { calls.push(['remove', k]); return ok({ ok: true }); },
    duplicate: async (k, n) => { calls.push(['duplicate', k, n]); return ok({ meta: { key: n } }); },
    writeCases: async () => ok({ cases: [] }),
    runtimes: async () => ok(RUNTIMES),
    bench: async (req) => { calls.push(['bench', req]); return ok({ benchId: 'b1' }); },
    benchStop: async () => ok({ ok: true }),
    benchOutput: (id, p) => `/api/scripts/bench/${id}/output/${p}`,
    history: async () => ok({ pipelines: [] }),
    runArtifacts: async () => ok({ artifacts: [] }),
    runArtifact: async () => ok({ rel: '', text: '' }),
    projects: async () => ok({ projects: [] }),
    ...apiOver,
  };
  const ctl = createScriptsController({
    host, msgEl, api, doc, inferDelayMs: 0,
    navigate: (hash) => nav.push(hash),
    confirm: async (opts) => { asked.push(opts); return true; },
    highlight: async (t) => t,
    ws: { send: () => {} },
    ...over,
  });
  return { host, msgEl, nav, asked, api, ctl, cleanup: () => { ctl.destroy(); host.remove(); } };
}
const draftOf = (c) => collectScriptDraft(q(c.host, '.script-detail'));

test('#scripts/new paints the runtime step; a card click repaints the pick; Continue navigates to the runtime`s step 2', async () => {
  const c = mountCtl();
  await c.ctl.route('new');
  await flush();
  assert.equal(q(c.host, '.wz').dataset.step, '1');
  assert.equal(q(c.host, '.rt[data-runtime="node"]').getAttribute('aria-pressed'), 'true');
  q(c.host, '.rt[data-runtime="shell"]').click();
  assert.equal(q(c.host, '.rt[data-runtime="shell"]').getAttribute('aria-pressed'), 'true');
  q(c.host, '.wz-continue').click();
  assert.deepEqual(c.nav, ['scripts/new/shell']);
  q(c.host, '.wz-cancel').click();
  assert.deepEqual(c.nav, ['scripts/new/shell', 'scripts']);
  assert.equal(qa(c.host, 'p').length, 0);
  c.cleanup();
});

test('#scripts/new/node: the workspace with the node template, the runtime`s colour and icon, no bench until there is a key', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.equal(root.dataset.step, '2');
  assert.equal(field(root, 'script:source').value, SCRIPT_TEMPLATES.node);
  assert.equal(field(root, 'meta:color').value, 'violet');
  assert.equal(field(root, 'meta:icon').value, iconSvgOf('code'));
  assert.equal(q(root, '.script-save').disabled, true);
  assert.equal(q(root, '.script-test-mount .bench'), null, 'no key, nothing to bench');
  assert.equal(c.ctl.isDirty(), false, 'the template is the baseline');
  c.cleanup();
});

test('typing a name derives the key, lights the tile, enables Save and mounts the bench as an unsaved draft; a typed key stops following', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:displayName'), 'Diff gate v2');
  await flush();
  assert.equal(field(root, 'meta:key').value, 'diffGateV2');
  assert.equal(q(root, '.wz-tile .pv-name').textContent, 'Diff gate v2');
  assert.equal(q(root, '.wz-tile .pv-key').textContent, 'diffGateV2');
  assert.equal(q(root, '.wz-file').textContent, 'diffGateV2.mjs');
  assert.equal(q(root, '.script-save').disabled, false);
  assert.ok(q(root, '.script-test-mount .bench'), 'the bench mounts for a draft');
  assert.equal(q(root, '.script-test-mount .bench').dataset.unsaved, 'true');
  assert.equal(q(root, '.bench-save-case').disabled, true);
  assert.equal(c.ctl.isDirty(), true);
  type(field(root, 'meta:key'), 'gate2');
  type(field(root, 'meta:displayName'), 'Another name');
  assert.equal(field(root, 'meta:key').value, 'gate2', 'a touched key is the user`s');
  type(field(root, 'meta:displayName'), '');
  assert.equal(q(root, '.script-save').disabled, true, 'no name, no Save');
  c.cleanup();
});

test('a reserved or invalid key gates Save and the bench', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:displayName'), 'New');
  await flush();
  assert.equal(field(root, 'meta:key').value, 'new');
  assert.equal(q(root, '.script-save').disabled, true, '`new` is a reserved key');
  assert.equal(q(root, '.script-test-mount .bench'), null);
  type(field(root, 'meta:key'), 'bad key');
  assert.equal(q(root, '.script-save').disabled, true);
  type(field(root, 'meta:key'), 'goodKey');
  await flush();
  assert.equal(q(root, '.script-save').disabled, false);
  assert.ok(q(root, '.script-test-mount .bench'));
  type(field(root, 'meta:key'), 'bad key');
  assert.equal(q(root, '.script-test-mount .bench'), null, 'the draft bench leaves with the key: nothing to run under a key the store refuses');
  type(field(root, 'meta:key'), 'goodKey');
  await flush();
  assert.ok(q(root, '.script-test-mount .bench'), 'and comes back with a valid one');
  c.cleanup();
});

test('the create hashes reached FROM a saved script`s workspace (browser Back after a save) paint a fresh draft and never throw', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  type(field(q(c.host, '.script-detail'), 'meta:displayName'), 'Made here');
  await flush();
  q(c.host, '.script-save').click();
  await flush();
  assert.deepEqual(c.nav, ['scripts/madeHere']);
  await c.ctl.route('madeHere');                          // what app.js does with the new hash (the fake read answers USER)
  await flush();
  assert.equal(field(q(c.host, '.script-detail'), 'meta:key').disabled, true, 'a SAVED script`s workspace is up');
  await c.ctl.route('new/node');                          // Back: st.data was a saved script's and the tree still showed it
  await flush();
  let d = draftOf(c);
  assert.equal(d.meta.key, '', 'a fresh draft, not the saved script read as one');
  assert.equal(d.source, SCRIPT_TEMPLATES.node);
  assert.equal(c.ctl.isDirty(), false);
  await c.ctl.route('diffGate');
  await flush();
  await c.ctl.route('new');                               // the picker, from a saved workspace
  await flush();
  assert.equal(q(c.host, '.wz').dataset.step, '1');
  await c.ctl.route('new/shell');
  await flush();
  d = draftOf(c);
  assert.equal(d.meta.runtime, 'shell');
  assert.equal(d.meta.key, '');
  c.cleanup();
});

test('a re-fired route to the hash the workspace already shows keeps every typed byte', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:displayName'), 'Probe one');
  await flush();
  type(field(root, 'script:source'), SCRIPT_TEMPLATES.node + 'export const x = (api) => api.inputs.extra.path;\n');
  await flush();
  assert.ok(q(root, '.wz-prow[data-id="extra"]'));
  await c.ctl.route('new/node');
  await flush();
  assert.equal(q(c.host, '.script-detail'), root, 'the same tree: no repaint from a stale st.data');
  const d = draftOf(c);
  assert.equal(d.meta.displayName, 'Probe one');
  assert.ok(d.source.includes('inputs.extra'));
  assert.equal(c.ctl.isDirty(), true);
  c.cleanup();
});

test('typing code adds interface rows live (debounced), the bench follows, and a saved-only port shows as stale', async () => {
  const c = mountCtl();
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.deepEqual(qa(root, '.wz-prow').map((r) => `${r.dataset.side}:${r.dataset.id}`),
    ['inputs:plan', 'inputs:diff', 'inputs:done', 'outputs:report', 'params:maxFiles']);
  assert.ok(q(root, '.wz-prow[data-id="done"]').classList.contains('stale'));
  assert.deepEqual(qa(root, '.bench-port').map((p) => p.dataset.port), ['plan', 'diff', 'done']);
  type(field(root, 'script:source'), SCRIPT_EXAMPLES.node.source + "\nexport const extra = (api) => api.inputs.notes.path + api.outputs.stats.path;\n");
  await flush();
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['plan', 'diff', 'notes', 'done', 'report', 'stats', 'maxFiles']);
  assert.deepEqual(qa(root, '.bench-port').map((p) => p.dataset.port), ['plan', 'diff', 'notes', 'done'], 'the bench`s rows follow the declaration');
  assert.equal(c.ctl.isDirty(), true);
  const d = draftOf(c);
  assert.deepEqual(d.meta.outputs.map((p) => [p.id, p.filename]), [['report', 'r-{cycle}.md'], ['stats', 'diffGate-stats-cycle{cycle}.md']]);
  c.cleanup();
});

test('chips: a type cycles, `when` cycles, a mode cycles, a param type cycles; × removes a stale row for good', async () => {
  const c = mountCtl();
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  q(root, '[data-chip="in:plan:type"]').click();
  assert.equal(q(root, '[data-chip="in:plan:type"]').textContent, 'json');
  assert.equal(draftOf(c).meta.inputs[0].type, 'json');
  q(root, '[data-chip="in:plan:mode"]').click();
  assert.equal(draftOf(c).meta.inputs[0].required, true);
  q(root, '[data-chip="in:plan:mode"]').click();
  assert.equal(draftOf(c).meta.inputs[0].loop, true);
  q(root, '[data-chip="out:report:when"]').click();
  assert.equal(q(root, '[data-chip="out:report:when"]').textContent, 'always');
  assert.equal(draftOf(c).meta.outputs[0].when, 'always');
  q(root, '[data-chip="param:maxFiles:type"]').click();
  assert.equal(draftOf(c).meta.params[0].type, 'boolean');
  q(root, '[data-remove="inputs:done"]').click();
  assert.equal(q(root, '.wz-prow[data-id="done"]'), null);
  assert.deepEqual(draftOf(c).meta.inputs.map((p) => p.id), ['plan', 'diff']);
  // the removed row does not come back on the next inference pass
  type(field(root, 'script:source'), SCRIPT_EXAMPLES.node.source + '\n');
  await flush();
  assert.equal(q(root, '.wz-prow[data-id="done"]'), null);
  assert.equal(q(root, '[data-chip="in:plan:type"]').textContent, 'json', 'an override sticks across a re-inference');
  c.cleanup();
});

test('the verdict follows the code: dropping it turns every `when` to always and hides the chips', async () => {
  const c = mountCtl();
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.ok(q(root, '[data-chip="out:report:when"]'));
  type(field(root, 'script:source'), SCRIPT_EXAMPLES.node.source.replace('verdict: { issues }', 'issues'));
  await flush();
  assert.equal(q(root, '[data-chip="out:report:when"]'), null);
  assert.equal(draftOf(c).meta.verdict, null);
  assert.equal(draftOf(c).meta.outputs[0].when, 'always');
  assert.equal(q(root, '.wz-verdict-file').textContent, '—');
  c.cleanup();
});

test('shell: the routing switch mints pass/fail and a verdict; off, the outputs are always; exit codes ride from Advanced', async () => {
  const c = mountCtl();
  await c.ctl.route('lint');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.equal(q(root, '[data-routing]').getAttribute('aria-checked'), 'true', 'a saved verdict = routing on');
  let d = draftOf(c);
  assert.deepEqual(d.meta.outputs.map((p) => [p.id, p.when]), [['log', 'always'], ['pass', 'clean'], ['fail', 'blocking']]);
  assert.deepEqual(d.meta.verdict, { filename: 'lint-cycle{cycle}.json' });
  assert.deepEqual(d.meta.exitCodes, { clean: [0], blocking: [1, 2] });
  q(root, '[data-routing]').click();
  d = draftOf(c);
  assert.deepEqual(d.meta.outputs.map((p) => p.id), ['log']);
  assert.equal(d.meta.verdict, null);
  assert.equal(c.ctl.isDirty(), true);
  c.cleanup();
});

// The wizard MINTS `pass` / `fail` at collect time, so every shell script it saves meets them
// again on reload as ordinary saved-only rows. Off must own them there too, or they stay on
// disk as outputs that fire `always` — both branches of a gate on every run.
test('shell: routing off drops a SAVED pass/fail the code never names, and a re-inference does not bring them back', async () => {
  const ROUTED = { ...SHELL, meta: { ...SHELL_META, outputs: [...SHELL_META.outputs,
    { id: 'pass', type: 'void', when: 'clean' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'lint-fail-cycle{cycle}.md' }] } };
  const c = mountCtl({ read: async (k) => ok(k === 'lint' ? ROUTED : USER) });
  await c.ctl.route('lint');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.deepEqual(qa(root, '.wz-prow[data-side="outputs"]').map((r) => r.dataset.id), ['log', 'pass', 'fail'], 'the sidecar`s two rows are there, not in code');
  assert.deepEqual(draftOf(c).meta.outputs.map((p) => [p.id, p.when]), [['log', 'always'], ['pass', 'clean'], ['fail', 'blocking']]);
  q(root, '[data-routing]').click();
  let d = draftOf(c);
  assert.deepEqual(d.meta.outputs.map((p) => [p.id, p.when]), [['log', 'always']], 'off un-mints what on minted');
  assert.equal(d.meta.verdict, null);
  type(field(root, 'script:source'), '#!/bin/sh\nnpm run lint > "$WORCA_OUT_LOG"\necho done\n');
  await flush();
  assert.deepEqual(draftOf(c).meta.outputs.map((p) => p.id), ['log'], 'st.removed holds them out of the merge');
  q(root, '[data-routing]').click();
  d = draftOf(c);
  assert.deepEqual(d.meta.outputs.map((p) => [p.id, p.when]), [['log', 'always'], ['pass', 'clean'], ['fail', 'blocking']], 'on mints both again');
  assert.deepEqual(d.meta.verdict, { filename: 'lint-cycle{cycle}.json' });
  c.cleanup();
});

test('Save: a new script POSTs the wizard body and routes to it; a saved one PUTs and rebases; the bench keeps its state', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  let root = q(c.host, '.script-detail');
  type(field(root, 'meta:displayName'), 'Diff gate v2');
  await flush();
  q(root, '.script-save').click();
  await flush();
  const created = c.api.calls.find((x) => x[0] === 'create')[1];
  assert.equal(created.meta.key, 'diffGateV2');
  assert.equal(created.meta.displayName, 'Diff gate v2');
  assert.equal(created.source, SCRIPT_TEMPLATES.node);
  assert.deepEqual(created.meta.inputs, []);
  assert.deepEqual(c.nav, ['scripts/diffGateV2']);
  c.cleanup();
  const s = mountCtl();
  await s.ctl.route('diffGate');
  await flush();
  root = q(s.host, '.script-detail');
  q(root, '.bench-result-body').dataset.marker = 'kept';
  type(field(root, 'meta:description'), 'Changed.');
  assert.equal(s.ctl.isDirty(), true);
  q(root, '.script-save').click();
  await flush();
  const updated = s.api.calls.find((x) => x[0] === 'update');
  assert.equal(updated[1], 'diffGate');
  assert.equal(updated[2].meta.description, 'Changed.');
  assert.equal(s.ctl.isDirty(), false);
  assert.equal(s.msgEl.textContent, 'Saved "diffGate".');
  assert.equal(q(root, '.bench-result-body').dataset.marker, 'kept', 'a save never remounts the bench');
  s.cleanup();
});

test('a rejected save shows the server`s sentence and keeps every byte', async () => {
  const c = mountCtl({ update: async () => ({ ok: false, status: 400, data: { error: 'outputs.report: md outputs require a filename template' } }) });
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:description'), 'Changed.');
  q(root, '.script-save').click();
  await flush();
  assert.equal(c.msgEl.textContent, 'outputs.report: md outputs require a filename template');
  assert.equal(field(root, 'meta:description').value, 'Changed.');
  assert.equal(c.ctl.isDirty(), true);
  c.cleanup();
});

test('colour and icon clicks update the hidden fields and the tile; Advanced opens in place', async () => {
  const c = mountCtl();
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  q(root, '.sw[data-swatch="pink"]').click();
  assert.equal(field(root, 'meta:color').value, 'pink');
  assert.ok(q(root, '.wz-tile .tile').classList.contains('tile-pink'));
  assert.ok(q(root, '.sw-pink').classList.contains('sel'));
  q(root, '.ico[data-icon="bolt"]').click();
  assert.equal(field(root, 'meta:icon').value, iconSvgOf('bolt'));
  assert.equal(q(root, '.wz-tile svg').dataset.iconName, 'bolt');
  assert.equal(c.ctl.isDirty(), true);
  q(root, '.wz-adv-toggle').click();
  assert.equal(q(root, '.wz-adv-body').hidden, false);
  assert.equal(q(root, '.wz-adv-toggle').getAttribute('aria-expanded'), 'true');
  type(field(root, 'meta:timeoutSec'), '30');
  assert.equal(draftOf(c).meta.timeoutMs, 30000);
  assert.equal(q(root, '.wz-adv-sum').textContent, '1 min timeout · coding · order 20', 'the summary follows the timeout as it is typed');
  type(field(root, 'meta:domain'), 'review');
  type(field(root, 'meta:order'), '7');
  assert.equal(q(root, '.wz-adv-sum').textContent, '1 min timeout · review · order 7');
  type(field(root, 'meta:domain'), '');
  assert.equal(q(root, '.wz-adv-sum').textContent, '1 min timeout · general · order 7', 'a blank domain reads general');
  c.cleanup();
});

test('Load example fills identity and source (asking first when dirty); the runtime pill goes back to step 1 and the draft survives', async () => {
  const c = mountCtl();
  await c.ctl.route('new/python');
  await flush();
  let root = q(c.host, '.script-detail');
  q(root, '.wz-example').click();
  await flush();
  root = q(c.host, '.script-detail');                       // Load example repaints the tree
  assert.equal(c.asked.length, 0, 'a clean template asks nothing');
  assert.equal(field(root, 'meta:displayName').value, 'TODO gate');
  assert.equal(field(root, 'meta:key').value, 'todoGate');
  assert.equal(field(root, 'script:source').value, SCRIPT_EXAMPLES.python.source);
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['diff', 'report', 'limit']);
  type(field(root, 'meta:description'), 'mine');
  q(root, '.wz-example').click();
  await flush();
  assert.equal(c.asked.length, 1, 'a dirty page asks');
  root = q(c.host, '.script-detail');
  q(root, '.wz-step-pill[data-step="1"]').click();
  assert.deepEqual(c.nav, ['scripts/new']);
  await c.ctl.route('new');
  await flush();
  assert.equal(q(c.host, '.wz').dataset.step, '1');
  assert.equal(q(c.host, '.rt[data-runtime="python"]').getAttribute('aria-pressed'), 'true');
  await c.ctl.route('new/python');
  await flush();
  root = q(c.host, '.script-detail');
  assert.equal(field(root, 'meta:displayName').value, 'TODO gate', 'a step hop never resets the draft');
  assert.equal(c.ctl.isDirty(), true);
  c.cleanup();
});

test('changing the runtime through the picker swaps the template only while the source is untouched', async () => {
  const c = mountCtl();
  await c.ctl.route('new/node');
  await flush();
  await c.ctl.route('new');
  await flush();
  q(c.host, '.rt[data-runtime="shell"]').click();
  await c.ctl.route('new/shell');
  await flush();
  let root = q(c.host, '.script-detail');
  assert.equal(field(root, 'meta:runtime').value, 'shell');
  assert.equal(q(root, '.script-source').dataset.srcMode, 'command');
  assert.equal(field(root, 'meta:command').value, SHELL_COMMAND_TEMPLATE);
  assert.equal(field(root, 'meta:color').value, 'amber', 'the colour follows while it was the runtime default');
  type(field(root, 'meta:command'), 'npm run lint > "$WORCA_OUT_LOG"');
  await flush();
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['log'], 'inference reads the command text (pass/fail are minted at collect time, never rows)');
  assert.deepEqual(draftOf(c).meta.outputs.map((p) => p.id), ['log', 'pass', 'fail']);
  await c.ctl.route('new');
  await flush();
  q(c.host, '.rt[data-runtime="node"]').click();
  await c.ctl.route('new/node');
  await flush();
  root = q(c.host, '.script-detail');
  assert.equal(field(root, 'meta:runtime').value, 'node');
  assert.equal(field(root, 'script:source').value, SCRIPT_TEMPLATES.node, 'a shell COMMAND is not a node program: the template comes back');
  c.cleanup();
});

test('a saved shell script: the Command | File control and the sh | win32 tabs still work, inference reads the visible default half', async () => {
  const c = mountCtl();
  await c.ctl.route('lint');
  await flush();
  let root = q(c.host, '.script-detail');
  assert.equal(q(root, '.script-source').dataset.srcMode, 'file');
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['log']);
  q(root, '.script-src-plat button[data-src-mode], .script-src-plat button[data-src-tab="win32"]').click();
  await flush();
  assert.equal(q(c.host, '.script-detail'), root, 'an editor-only hop keeps the tree (the bench under it too)');
  assert.equal(q(root, '.code-editor-ta').dataset.field, 'script:sourceWin32', 'the editor now holds the .cmd half');
  assert.equal(field(root, 'script:sourceWin32').value, '@echo off\nnpm.cmd run lint\n');
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['log'], 'the win32 half is not scanned');
  q(root, '.script-src-mode button[data-src-mode="command"]').click();
  await flush();
  assert.equal(q(c.host, '.script-source').dataset.srcMode, 'command');
  assert.equal(draftOf(c).source, '', 'Command mode sends no file');
  c.cleanup();
});

test('leaving a dirty page asks first, one macrotask later; Cancel stays; Escape in the chrome is the same exit', async () => {
  const c = mountCtl({}, { confirm: async () => false });
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:description'), 'Changed.');
  q(root, '.script-back').click();
  await flush();
  assert.deepEqual(c.nav, [], 'Cancel stays put');
  root.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await flush();
  assert.deepEqual(c.nav, []);
  c.cleanup();
  const d = mountCtl();
  await d.ctl.route('diffGate');
  await flush();
  q(d.host, '.script-back').click();
  await flush();
  assert.deepEqual(d.nav, ['scripts'], 'a clean page leaves without asking');
  assert.equal(d.asked.length, 0);
  d.cleanup();
});

test('a built-in opens read-only with a live bench and the path row; the runtime pill is inert', async () => {
  const c = mountCtl();
  await c.ctl.route('gitDiff');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.equal(q(root, '.script-save'), null);
  assert.equal(field(root, 'meta:displayName').disabled, true);
  // `// built in` reads nothing, so the only rows are the sidecar's (stale, inert, and with no ×)
  assert.deepEqual(qa(root, '.wz-prow').map((r) => r.dataset.id), ['done', 'report', 'maxFiles']);
  assert.equal(q(root, '[data-chip="in:done:type"]').disabled, true);
  assert.equal(q(root, '[data-remove]'), null);
  assert.equal(q(root, '.wz-step-pill[data-step="1"]').disabled, true);
  assert.equal(q(root, '.script-path').textContent, '/repo/scripts/git-diff.mjs');
  assert.ok(q(root, '.script-test-mount .bench'));
  assert.equal(q(root, '.script-test-mount .bench').dataset.unsaved, undefined);
  assert.equal(q(root, '.script-origin').textContent, 'built-in');
  c.cleanup();
});

test('a scripts-changed poke never clobbers an unsaved draft; destroy tears the editors and the bench down', async () => {
  const c = mountCtl();
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:description'), 'Changed.');
  c.ctl.onChanged();
  await flush();
  assert.equal(field(q(c.host, '.script-detail'), 'meta:description').value, 'Changed.');
  assert.deepEqual(c.api.calls.filter((x) => x[0] === 'read').length, 1);
  c.ctl.destroy();
  assert.equal(c.host.childNodes.length, 0);
  c.host.remove();
});

test('after a code keystroke and a chip click the page is still the user`s: Save PUTs, and the bench keeps its writable layer', async () => {
  const wrote = [];                                        // mountCtl's default writeCases records nothing
  const c = mountCtl({ writeCases: async (k, cases) => { wrote.push([k, cases]); return ok({ cases }); } });
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'script:source'), SCRIPT_EXAMPLES.node.source + '\n');
  await flush();
  q(root, '[data-chip="in:plan:type"]').click();
  q(root, '[data-chip="in:plan:mode"]').click();
  assert.equal(field(root, 'iface:in:plan:mode').value, 'required', 'the second chip click still lands');
  q(root, '.script-save').click();
  await flush();
  const updated = c.api.calls.find((x) => x[0] === 'update');
  assert.ok(updated, 'Save still writes');
  assert.equal(updated[2].meta.inputs[0].required, true);
  type(field(root, 'bench:caseName'), 'first');
  q(root, '.bench-save-case').click();
  await flush();
  assert.equal(wrote.length, 1, 'a case write still goes out');
  assert.equal(wrote[0][0], 'diffGate');
  assert.equal(wrote[0][1][0].name, 'first');
  assert.equal(q(root, '.bench-lock'), null, 'the user`s own case is never shown as shipped (origin survived the re-declaration)');
  assert.ok(q(root, '.bench-case-row[data-case-id="first"] .bench-case-rename'), 'and it is writable');
  c.cleanup();
});

test('a saved verdict the code does not declare survives a Save that touched only the description, and follows the code once it is edited', async () => {
  const quiet = { ...USER, source: '// no verdict in this program\nexport default async ({ inputs, outputs }) => { inputs.plan; outputs.report; return { summary: \'ok\' }; };\n' };
  const c = mountCtl({ read: async () => ok(quiet) });
  await c.ctl.route('diffGate');
  await flush();
  const root = q(c.host, '.script-detail');
  assert.deepEqual(draftOf(c).meta.verdict, { filename: 'dg-{cycle}.json' });
  assert.equal(draftOf(c).meta.outputs[0].when, 'blocking');
  assert.ok(q(root, '[data-chip="out:report:when"]'));
  type(field(root, 'meta:description'), 'Changed.');
  q(root, '.script-save').click();
  await flush();
  const updated = c.api.calls.find((x) => x[0] === 'update');
  assert.deepEqual(updated[2].meta.verdict, { filename: 'dg-{cycle}.json' }, 'an unrelated Save keeps the declaration');
  type(field(root, 'script:source'), quiet.source + '\n');
  await flush();
  assert.equal(draftOf(c).meta.verdict, null, 'once the program is edited, the code decides');
  assert.equal(q(root, '[data-chip="out:report:when"]'), null);
  c.cleanup();
});

test('an editor-only hop (sh | win32, Command | File) swaps the editor and leaves the bench alone: a run in flight is not stopped, the result stays', async () => {
  const stops = [];
  const c = mountCtl({ benchStop: async (id) => { stops.push(id); return ok({ ok: true }); } });
  await c.ctl.route('lint');
  await flush();
  const root = q(c.host, '.script-detail');
  const bench = q(root, '.script-test-mount .bench');
  q(root, '.bench-run').click();
  await flush();
  assert.equal(q(root, '.bench-run').disabled, true, 'a run is in flight');
  q(root, '.bench-result-body').dataset.marker = 'kept';
  q(root, '.script-src-plat button[data-src-tab="win32"]').click();
  await flush();
  assert.equal(q(c.host, '.script-detail'), root, 'the page tree is the same node');
  assert.equal(q(root, '.code-editor-ta').dataset.field, 'script:sourceWin32', 'the editor swapped halves');
  assert.equal(q(root, '.wz-file').textContent, 'lint.cmd');
  assert.equal(q(root, '.script-test-mount .bench'), bench, 'the bench tree is the same node');
  assert.deepEqual(stops, [], 'no bench/stop went out');
  assert.equal(q(root, '.bench-result-body').dataset.marker, 'kept');
  assert.equal(q(root, '.bench-run').disabled, true, 'still running');
  q(root, '.script-src-mode button[data-src-mode="command"]').click();
  await flush();
  assert.equal(q(root, '.script-source').dataset.srcMode, 'command');
  assert.equal(q(root, '.script-test-mount .bench'), bench, 'a mode hop keeps it too');
  assert.equal(draftOf(c).source, '', 'Command mode sends no file');
  assert.deepEqual(stops, []);
  c.cleanup();
  assert.deepEqual(stops, ['b1'], 'leaving the page is what stops the run');
});

test('a draft bench never mounts under a key that turned invalid while the projects call was in flight', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const c = mountCtl({ projects: async () => { await gate; return ok({ projects: [] }); } });
  await c.ctl.route('new/node');
  await flush();
  const root = q(c.host, '.script-detail');
  type(field(root, 'meta:displayName'), 'N');            // key `n`: the mount starts and awaits the projects list
  await flush(2);
  type(field(root, 'meta:displayName'), 'New');          // key `new`: reserved while the call is still out
  release();
  await flush();
  assert.equal(q(root, '.script-save').disabled, true);
  assert.equal(q(root, '.script-test-mount .bench'), null, 'the late answer mounts nothing under a key the store refuses');
  type(field(root, 'meta:displayName'), 'Newer');
  await flush();
  assert.ok(q(root, '.script-test-mount .bench'), 'and a valid key mounts it');
  c.cleanup();
});

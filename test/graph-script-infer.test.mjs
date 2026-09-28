// test/graph-script-infer.test.mjs — the interface a program declares by reading it (script-wizard plan S3–S7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  keyFromName, upperSnake, lowerCamel, stripComments, inferInterface, savedRows, mergeInterface,
  cycleValue, typedDefault, interfaceToMeta, PORT_TYPES, WHEN_CYCLE, INPUT_MODES, CHIP_PARAM_TYPES,
} from '../src/shared/graph/script-infer.mjs';
import { validateScriptMetaV2 } from '../src/shared/graph/script-meta.mjs';

const NODE = `// Reads the plan and the diff, writes a report, blocks when the diff is too wide.
import { readFileSync, writeFileSync } from 'node:fs';

export default async function ({ inputs, outputs, params, ctx, log }) {
  const plan = readFileSync(inputs.plan.path, 'utf8');
  const diff = readFileSync(inputs.diff.path, 'utf8');
  const limit = Number(params.maxFiles ?? 40);
  const strict = params.strict === true;
  const files = diff.match(/^\\+\\+\\+ b\\/(.+)$/gm) ?? [];
  writeFileSync(outputs.report.path, \`# Diff report\\n\\n\${files.length} files changed, limit \${limit}\\n\`);
  writeFileSync(outputs.stats.path, JSON.stringify({ files: files.length }));
  const issues = files.length > limit ? [{ severity: 'major', title: 'too wide' }] : [];
  return { summary: \`\${files.length} files\`, verdict: { issues } };
}
`;
const PY = `# Counts the TODOs a diff adds.
import re

def main(api):
    diff = open(api.inputs.diff.path, encoding='utf-8').read()
    limit = int(api.params.limit or 5)
    label = api.params.get('label') or 'todo'
    todos = re.findall(r'^\\+.*\\bTODO\\b', diff, re.M)
    with open(api.outputs.report.path, 'w', encoding='utf-8') as f:
        f.write('# TODO report')
    issues = [{'severity': 'major', 'title': 'over'}] if len(todos) > limit else []
    return {'summary': f'{len(todos)} TODOs', 'verdict': {'issues': issues} }
`;
const SH = `#!/bin/sh
# Runs the test command in the run's checkout.
cd "$WORCA_CWD"
CMD="\${WORCA_PARAM_COMMAND:-npm test}"
echo "running: $CMD" # $WORCA_IN_NOTHING (a comment)
sh -c "$CMD" > "$WORCA_OUT_LOG" 2>&1
cat "\${WORCA_IN_PLAN_MD}" >> "$WORCA_OUT_LOG"
`;
const CMD = '@echo off\r\ntype "%WORCA_IN_PLAN%" > "%WORCA_OUT_LOG%"\r\n';

test('keyFromName: lowerCamel, a letter first, 64 chars, empty for nothing', () => {
  assert.equal(keyFromName('Run tests'), 'runTests');
  assert.equal(keyFromName('  diff-gate v2 '), 'diffGateV2');
  assert.equal(keyFromName('2fast'), 's2fast');
  assert.equal(keyFromName(''), '');
  assert.equal(keyFromName('x'.repeat(80)).length, 64);
});

test('upperSnake and lowerCamel round-trip the runner`s env naming', () => {
  assert.equal(upperSnake('planMd'), 'PLAN_MD');
  assert.equal(lowerCamel('PLAN_MD'), 'planMd');
  assert.equal(lowerCamel(upperSnake('log')), 'log');
  assert.equal(lowerCamel('OUT_2'), 'out2');       // digits join without an underscore (PORT_ID_RE has none)
});

test('stripComments: node line + block comments, python/shell hashes, never a URL or a quote', () => {
  assert.equal(stripComments('a // b\nhttp://x /* c */ d', 'node').replace(/\s+/g, ' ').trim(), 'a http://x d');
  assert.equal(stripComments('x = 1 # y\ns = "#not"\n', 'python'), 'x = 1 \ns = "#not"\n');
  assert.equal(stripComments('echo ${#V} # c', 'shell'), 'echo ${#V} ');
});

test('inferInterface(node): dotted ids, a json output, typed params with defaults, the verdict', () => {
  const r = inferInterface(NODE, 'node');
  assert.deepEqual(r.inputs, [{ id: 'plan', type: 'md' }, { id: 'diff', type: 'md' }]);
  assert.deepEqual(r.outputs, [{ id: 'report', type: 'md' }, { id: 'stats', type: 'json' }]);
  assert.deepEqual(r.params, [{ id: 'maxFiles', type: 'number', default: 40 }, { id: 'strict', type: 'boolean' }]);
  assert.equal(r.verdict, true);
});

test('inferInterface(python): api.inputs.x, api.params.get("x"), `or` defaults, the dict verdict', () => {
  const r = inferInterface(PY, 'python');
  assert.deepEqual(r.inputs, [{ id: 'diff', type: 'md' }]);
  assert.deepEqual(r.outputs, [{ id: 'report', type: 'md' }]);
  assert.deepEqual(r.params, [{ id: 'limit', type: 'number', default: 5 }, { id: 'label', type: 'string', default: 'todo' }]);
  assert.equal(r.verdict, true);
});

test('inferInterface(shell): $VAR, ${VAR}, %VAR%, lowerCamel ids, :- defaults, comments ignored, no verdict', () => {
  const r = inferInterface(SH, 'shell');
  assert.deepEqual(r.inputs, [{ id: 'planMd', type: 'md' }]);
  assert.deepEqual(r.outputs, [{ id: 'log', type: 'md' }]);
  assert.deepEqual(r.params, [{ id: 'command', type: 'string', default: 'npm test' }]);
  assert.equal(r.verdict, false);
  const w = inferInterface(CMD, 'shell');
  assert.deepEqual(w.inputs.map((p) => p.id), ['plan']);
  assert.deepEqual(w.outputs.map((p) => p.id), ['log']);
  assert.equal(inferInterface('echo x > "$WORCA_VERDICT"', 'shell').verdict, true);
});

test('inferInterface: bracket forms, optional chaining, ids that fail PORT_ID_RE are skipped, the header is not a read', () => {
  const r = inferInterface("export default async ({ inputs, outputs, params }) => { inputs?.a; inputs['b']; outputs[\"c\"]; params.Bad; params.d_e; }", 'node');
  assert.deepEqual(r.inputs.map((p) => p.id), ['a', 'b']);
  assert.deepEqual(r.outputs.map((p) => p.id), ['c']);
  assert.deepEqual(r.params, []);
  assert.deepEqual(inferInterface('', 'node'), { inputs: [], outputs: [], params: [], verdict: false });
});

test('inferInterface: a verdict returned by SHORTHAND (`return { summary, verdict }`, `{ ...base, verdict }`) is a verdict too', () => {
  assert.equal(inferInterface('const { summary, verdict } = await run(); return { summary, verdict };', 'node').verdict, true);
  assert.equal(inferInterface('export default async () => { return { ...base, verdict }; }', 'node').verdict, true);
  assert.equal(inferInterface("log('info', 'no verdict here'); return { summary: 1 };", 'node').verdict, false);
  assert.equal(inferInterface('if (x.verdict === 1) {} return { summary }', 'node').verdict, false);
  assert.equal(inferInterface("    return {'summary': s, 'verdict': v}", 'python').verdict, true);
});

test('savedRows: the sidecar as rows; ports:"config" has no port rows; loop/required become a mode', () => {
  const rows = savedRows({
    inputs: [{ id: 'fix', type: 'md', required: false, loop: true }, { id: 'plan', type: 'md', required: true }, { id: 'await', type: 'any', synthetic: true }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' }, { id: 'pass', type: 'void', when: 'clean' }],
    params: [{ id: 'mode', type: 'enum', options: ['a', 'b'], default: 'a', required: false }],
  });
  assert.deepEqual(rows.inputs.map((r) => [r.id, r.mode]), [['fix', 'loop'], ['plan', 'required']]);
  assert.deepEqual(rows.outputs.map((r) => [r.id, r.when, r.filename]), [['log', 'always', 'tests-cycle{cycle}.md'], ['pass', 'clean', '']]);
  assert.equal(rows.params[0].fixed, true);
  assert.deepEqual(savedRows({ ports: 'config', defaultPorts: { inputs: [{ id: 'in', type: 'md' }], outputs: [] }, params: [] }).inputs, []);
});

test('mergeInterface: code ids first in code order, saved-only rows after with inCode:false, overrides stick, untouched follows the code, removed stays gone', () => {
  const saved = { inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'report', type: 'md', when: 'always', filename: 'r-{cycle}.md' }], params: [{ id: 'maxFiles', type: 'number', default: 10 }] };
  const inferred = inferInterface(NODE, 'node');
  const first = mergeInterface({ inferred, saved });
  assert.deepEqual(first.inputs.map((r) => [r.id, r.type, r.inCode]), [['plan', 'md', true], ['diff', 'md', true], ['done', 'void', false]]);
  assert.equal(first.outputs[0].filename, 'r-{cycle}.md', 'a saved filename rides along');
  assert.equal(first.params[0].default, 10, 'a saved default wins over the inferred 40');
  // an override on a code row sticks across the next merge
  const over = { ...first, outputs: first.outputs.map((r) => (r.id === 'report' ? { ...r, type: 'json' } : r)) };
  const second = mergeInterface({ inferred, saved, rows: over });
  assert.equal(second.outputs[0].type, 'json');
  // an untouched inferred default follows the code
  const inf2 = inferInterface(NODE.replace('?? 40', '?? 50'), 'node');
  const fresh = mergeInterface({ inferred: inferInterface(NODE, 'node') });
  assert.equal(fresh.params[0].default, 40);
  assert.equal(mergeInterface({ inferred: inf2, rows: fresh }).params[0].default, 50);
  // a typed default does not follow the code
  const typed = { ...fresh, params: fresh.params.map((r) => ({ ...r, default: 7 })) };
  assert.equal(mergeInterface({ inferred: inf2, rows: typed }).params[0].default, 7);
  // removed
  assert.deepEqual(mergeInterface({ inferred, saved, removed: new Set(['inputs:done']) }).inputs.map((r) => r.id), ['plan', 'diff']);
});

test('cycleValue wraps; typedDefault stores the declared type and drops a blank', () => {
  assert.equal(cycleValue(PORT_TYPES, 'void'), 'md');
  assert.equal(cycleValue(WHEN_CYCLE, 'always'), 'clean');
  assert.equal(cycleValue(INPUT_MODES, 'loop'), 'optional');
  assert.equal(cycleValue(CHIP_PARAM_TYPES, 'command'), 'string');
  assert.equal(typedDefault('number', '40'), 40);
  assert.equal(typedDefault('number', 'x'), undefined);
  assert.equal(typedDefault('boolean', 'true'), true);
  assert.equal(typedDefault('string', ''), undefined);
  assert.equal(typedDefault('string', 'npm test'), 'npm test');
});

test('interfaceToMeta: sidecar-shaped ports that the validator accepts, filenames minted, when gated by the verdict', () => {
  const rows = mergeInterface({ inferred: inferInterface(NODE, 'node') });
  rows.outputs[0].when = 'blocking';
  const withVerdict = interfaceToMeta(rows, { key: 'diffGate', runtime: 'node', verdict: true });
  assert.deepEqual(withVerdict.outputs[0], { id: 'report', type: 'md', when: 'blocking', filename: 'diffGate-report-cycle{cycle}.md' });
  assert.deepEqual(withVerdict.outputs[1], { id: 'stats', type: 'json', when: 'always', filename: 'diffGate-stats-cycle{cycle}.json' });
  assert.deepEqual(withVerdict.verdict, { filename: 'diffGate-cycle{cycle}.json' });
  assert.deepEqual(withVerdict.inputs[0], { id: 'plan', type: 'md', required: false });
  assert.deepEqual(withVerdict.params, [{ id: 'maxFiles', type: 'number', default: 40, required: false }, { id: 'strict', type: 'boolean', required: true }]);
  const meta = { key: 'diffGate', metaVersion: 2, displayName: 'Diff gate', runtime: 'node', file: 'diffGate.mjs', ...withVerdict };
  assert.deepEqual(validateScriptMetaV2(meta).errors, []);
  const noVerdict = interfaceToMeta(rows, { key: 'diffGate', runtime: 'node', verdict: false });
  assert.equal(noVerdict.outputs[0].when, 'always');
  assert.equal(noVerdict.verdict, null);
});

test('interfaceToMeta(shell): routing synthesizes pass/fail and a verdict; a loop input; a fixed enum param survives', () => {
  const rows = mergeInterface({ inferred: inferInterface(SH, 'shell'), saved: { inputs: [], outputs: [], params: [{ id: 'mode', type: 'enum', options: ['a', 'b'], default: 'a', required: false, label: 'Mode' }] } });
  rows.inputs[0].mode = 'loop';
  const on = interfaceToMeta(rows, { key: 'runTests', runtime: 'shell', verdict: false, routing: true });
  assert.deepEqual(on.outputs.map((p) => [p.id, p.type, p.when]), [['log', 'md', 'always'], ['pass', 'void', 'clean'], ['fail', 'md', 'blocking']]);
  assert.equal(on.outputs[2].filename, 'runTests-fail-cycle{cycle}.md');
  assert.deepEqual(on.inputs[0], { id: 'planMd', type: 'md', required: false, loop: true });
  assert.deepEqual(on.params.find((p) => p.id === 'mode'), { id: 'mode', type: 'enum', default: 'a', required: false, label: 'Mode', options: ['a', 'b'] });
  assert.deepEqual(validateScriptMetaV2({ key: 'runTests', metaVersion: 2, runtime: 'shell', file: 'runTests.sh', ...on }).errors, []);
  const off = interfaceToMeta(rows, { key: 'runTests', runtime: 'shell', verdict: false, routing: false });
  assert.deepEqual(off.outputs.map((p) => p.id), ['log']);
  assert.equal(off.verdict, null);
});

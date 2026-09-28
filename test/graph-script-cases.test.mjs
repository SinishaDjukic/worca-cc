// test/graph-script-cases.test.mjs
// Saved test cases (workbench spec §3.2, W5/W9/W18). One normalizer behind the
// store's hard 400, the plugin validator and the bench UI, so this table IS the
// contract: ids, the 32/80/256KiB limits, port-set resolution (sidecar ports or
// the case's own set for a ports:"config" script), typed inputs, the scratch/
// project cwd rule (shipped cases are scratch-only) and the expectation reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCases, casePortSet, evaluateExpect,
  CASES_VERSION, MAX_CASES, MAX_CASE_NAME, MAX_CASE_INPUT_BYTES, CASE_ID_RE, EXPECT_VERDICTS,
} from '../src/shared/graph/script-cases.mjs';

/** A normalized sidecar meta (normalizeScriptMeta output shape, P1a Task 3). */
const META = {
  key: 'runTests', metaVersion: 2, displayName: 'Run tests', runtime: 'shell',
  params: [
    { id: 'command', type: 'command', required: true, default: 'npm test' },
    { id: 'passAt', type: 'number', required: false },
  ],
  inputs: [{ id: 'done', type: 'void', required: false }, { id: 'plan', type: 'md', required: false },
    { id: 'facts', type: 'json', required: false }],
  outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'tests-cycle{cycle}.md' },
    { id: 'fail', type: 'md', when: 'blocking', filename: 'tests-cycle{cycle}.md' },
    { id: 'pass', type: 'void', when: 'clean' }],
  verdict: { filename: 'tests-cycle{cycle}.json' },
};
const CONFIG_META = {
  key: 'shell', metaVersion: 2, displayName: 'Shell', runtime: 'shell', params: [],
  ports: 'config',
  defaultPorts: {
    inputs: [{ id: 'in', type: 'md', required: false }],
    outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-{cycle}.md' }],
  },
  verdict: { filename: 'shell-{cycle}.json' },
};
const file = (cases) => ({ version: 1, cases });
const one = (over = {}) => file([{ id: 'c1', ...over }]);
const errsOf = (raw, meta = META, opts) => normalizeCases(raw, meta, opts).errors;

test('constants and the empty/absent file', () => {
  assert.equal(CASES_VERSION, 1);
  assert.equal(MAX_CASES, 32);
  assert.equal(MAX_CASE_NAME, 80);
  assert.equal(MAX_CASE_INPUT_BYTES, 262144);
  assert.deepEqual([...EXPECT_VERDICTS], ['clean', 'blocking', 'error']);
  assert.ok(CASE_ID_RE.test('c_failing') && CASE_ID_RE.test('A-1') && !CASE_ID_RE.test('9x') && !CASE_ID_RE.test('a b'));
  assert.deepEqual(normalizeCases(undefined, META), { cases: [], errors: [] });
  assert.deepEqual(normalizeCases(null, META), { cases: [], errors: [] });
  assert.deepEqual(errsOf('x'), ['cases file must be an object { version: 1, cases: [...] }']);
  assert.deepEqual(errsOf({ version: 2, cases: [] }), ['cases file requires version 1']);
  assert.deepEqual(errsOf({ version: 1 }), ['cases must be an array']);
  assert.deepEqual(errsOf(file(Array.from({ length: 33 }, (_, i) => ({ id: `c${i}` })))), ['at most 32 cases (got 33)']);
});

test('a full case normalizes with every field defaulted', () => {
  const { cases, errors } = normalizeCases(file([{
    id: 'c_failing', name: 'failing suite',
    params: { command: 'npm test' },
    ports: null,
    inputs: { plan: { text: '# Plan\n' }, done: { fired: true } },
    cwd: { kind: 'scratch' },
    timeoutMs: null,
    expect: { verdict: 'blocking', fired: ['log', 'fail'] },
  }, { id: 'c_bare' }]), META);
  assert.deepEqual(errors, []);
  assert.deepEqual(cases[0], {
    id: 'c_failing', name: 'failing suite',
    params: { command: 'npm test' }, ports: null,
    inputs: { plan: { text: '# Plan\n' }, done: { fired: true } },
    cwd: { kind: 'scratch' }, timeoutMs: null,
    expect: { verdict: 'blocking', fired: ['log', 'fail'] },
  });
  assert.deepEqual(cases[1], {
    id: 'c_bare', name: 'c_bare', params: {}, ports: null, inputs: {},
    cwd: { kind: 'scratch' }, timeoutMs: null, expect: null,
  });
});

test('ids: regex, duplicates, and a broken case is dropped from cases[]', () => {
  assert.deepEqual(errsOf(file(['x'])), ['cases[0]: each case must be an object']);
  assert.deepEqual(errsOf(file([{ id: '9x' }])), ['cases[0]: bad case id "9x"']);
  assert.deepEqual(errsOf(file([{ id: 'c1' }, { id: 'c1' }])), ['cases[1]: duplicate case id "c1"']);
  const r = normalizeCases(file([{ id: 'ok' }, { id: 'bad', timeoutMs: 10 }]), META);
  assert.deepEqual(r.cases.map((c) => c.id), ['ok'], 'a case with an error is not returned');
  assert.deepEqual(r.errors, ['case "bad": timeoutMs must be an integer >= 1000']);
});

test('name, params and timeoutMs', () => {
  assert.equal(normalizeCases(one({ name: '  trimmed  ' }), META).cases[0].name, 'trimmed');
  assert.deepEqual(errsOf(one({ name: 'x'.repeat(81) })), ['case "c1": name must be 80 characters or fewer']);
  assert.deepEqual(errsOf(one({ params: 'x' })), ['case "c1": params must be an object']);
  assert.deepEqual(errsOf(one({ params: { nope: 1 } })),
    ['case "c1": unknown param "nope" — script "runTests" declares command, passAt']);
  assert.deepEqual(errsOf(one({ params: { passAt: 'two' } })),
    ['case "c1": param "passAt" must be a finite number (got "two")']);
  assert.deepEqual(errsOf(one({ params: { command: 'x' } }), { ...META, params: [] }),
    ['case "c1": unknown param "command" — script "runTests" declares no params']);
  assert.equal(normalizeCases(one({ timeoutMs: 5000 }), META).cases[0].timeoutMs, 5000);
  assert.deepEqual(errsOf(one({ timeoutMs: 1.5 })), ['case "c1": timeoutMs must be an integer >= 1000']);
});

test('inputs: declared ports only, void is fired, md/json text, the 256 KiB cap, json must parse', () => {
  assert.deepEqual(errsOf(one({ inputs: [] })), ['case "c1": inputs must be an object keyed by input port id']);
  assert.deepEqual(errsOf(one({ inputs: { nope: { text: 'x' } } })),
    ['case "c1": "nope" is not an input port of script "runTests"']);
  assert.deepEqual(errsOf(one({ inputs: { plan: 'x' } })), ['case "c1": input "plan" must be { text } or { fired: true }']);
  assert.deepEqual(errsOf(one({ inputs: { done: { text: 'x' } } })), ['case "c1": input "done" is a void port — use { fired: true }']);
  assert.deepEqual(errsOf(one({ inputs: { plan: { fired: true } } })), ['case "c1": input "plan" must be { text }']);
  assert.deepEqual(errsOf(one({ inputs: { plan: { text: 'x'.repeat(MAX_CASE_INPUT_BYTES + 1) } } })),
    ['case "c1": input "plan" is over 262144 bytes']);
  assert.deepEqual(errsOf(one({ inputs: { facts: { text: '{oops' } } })), ['case "c1": input "facts" is not valid JSON']);
  assert.deepEqual(normalizeCases(one({ inputs: { facts: { text: '{"a":1}' } } }), META).cases[0].inputs,
    { facts: { text: '{"a":1}' } });
  // A multi-byte string is measured in BYTES, not characters (W9's cap is bytes).
  const near = '€'.repeat(90000);                                   // 270 000 bytes, 90 000 chars
  assert.deepEqual(errsOf(one({ inputs: { plan: { text: near } } })), ['case "c1": input "plan" is over 262144 bytes']);
  // A port that is not listed is unbound, exactly as in a run.
  assert.deepEqual(Object.keys(normalizeCases(one({}), META).cases[0].inputs), []);
});

test('cwd: scratch by default, a project key, never a path; a shipped case is scratch-only', () => {
  assert.deepEqual(normalizeCases(one({ cwd: { kind: 'project', projectKey: 'worca' } }), META).cases[0].cwd,
    { kind: 'project', projectKey: 'worca' });
  assert.deepEqual(errsOf(one({ cwd: { kind: 'abs', path: '/tmp' } })),
    ['case "c1": cwd must be { kind: "scratch" } or { kind: "project", projectKey }']);
  assert.deepEqual(errsOf(one({ cwd: { kind: 'project' } })), ['case "c1": cwd: a project folder needs a projectKey']);
  assert.deepEqual(errsOf(one({ cwd: { kind: 'project', projectKey: 'worca' } }), META, { shipped: true }),
    ['case "c1": a shipped case must run in the scratch folder']);
  assert.deepEqual(errsOf(one({ cwd: { kind: 'scratch' } }), META, { shipped: true }), []);
});

test('expect: verdict enum, fired against the declared outputs, summaryIncludes', () => {
  assert.deepEqual(errsOf(one({ expect: 'x' })), ['case "c1": expect must be an object { verdict?, fired?, summaryIncludes? }']);
  assert.deepEqual(errsOf(one({ expect: { verdict: 'stopped' } })), ['case "c1": expect.verdict must be one of clean, blocking, error']);
  assert.deepEqual(errsOf(one({ expect: { fired: 'log' } })), ['case "c1": expect.fired must be a list of output port ids']);
  assert.deepEqual(errsOf(one({ expect: { fired: ['log', 'nope'] } })), ['case "c1": expect.fired names nope, which is not an output port']);
  assert.deepEqual(errsOf(one({ expect: { summaryIncludes: '' } })), ['case "c1": expect.summaryIncludes must be a non-empty string']);
  assert.equal(normalizeCases(one({ expect: {} }), META).cases[0].expect, null, 'an empty expect is no expectation');
  assert.deepEqual(normalizeCases(one({ expect: { summaryIncludes: '3 failing' } }), META).cases[0].expect, { summaryIncludes: '3 failing' });
});

test('casePortSet: sidecar ports, or the case`s own set for a ports:"config" script', () => {
  assert.deepEqual(casePortSet(META, {}), { inputs: META.inputs, outputs: META.outputs, verdict: META.verdict });
  const dflt = casePortSet(CONFIG_META, {});
  assert.deepEqual(dflt.inputs.map((p) => p.id), ['in']);
  assert.deepEqual(dflt.outputs.map((p) => p.id), ['log']);
  const own = casePortSet(CONFIG_META, { ports: { inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'out', type: 'json', filename: 'o-{cycle}.json' }] } });
  assert.deepEqual(own.inputs, [{ id: 'plan', type: 'md', required: true }]);
  assert.deepEqual(own.outputs.map((p) => p.id), ['out']);
  assert.deepEqual(casePortSet(CONFIG_META, { ports: { inputs: [{ id: 'in', type: 'md', as: 'file' }], outputs: [] } }).errors,
    ['inputs.in: as is a prompt-side field — a script input does not take it']);
});

test('a ports:"config" case carries its own normalized port set; a sidecar-ported one refuses ports', () => {
  const { cases, errors } = normalizeCases(file([{ id: 'c1', inputs: { in: { text: '# hi' } } }]), CONFIG_META);
  assert.deepEqual(errors, []);
  assert.deepEqual(cases[0].ports.inputs, [{ id: 'in', type: 'md', required: false }]);
  assert.deepEqual(cases[0].ports.outputs.map((p) => p.id), ['log']);
  assert.deepEqual(errsOf(one({ ports: { inputs: [], outputs: [] } })),
    ['case "c1": ports is only legal for a script that declares ports: "config"']);
  assert.deepEqual(errsOf(file([{ id: 'c1', ports: 'x' }]), CONFIG_META),
    ['case "c1": ports must be an object { inputs: [...], outputs: [...] }']);
  assert.deepEqual(errsOf(file([{ id: 'c1', inputs: { nope: { text: 'x' } } }]), CONFIG_META),
    ['case "c1": "nope" is not an input port of script "shell"']);
});

test('evaluateExpect: null without an expectation, diffs name what differed', () => {
  const result = { status: 'blocking', fired: ['log', 'fail'], summary: '212 passing, 3 failing' };
  assert.equal(evaluateExpect(null, result), null);
  assert.equal(evaluateExpect(undefined, result), null);
  assert.deepEqual(evaluateExpect({ verdict: 'blocking', fired: ['fail', 'log'], summaryIncludes: '3 failing' }, result),
    { pass: true, diffs: [] });
  assert.deepEqual(evaluateExpect({ verdict: 'clean' }, result), { pass: false, diffs: ['expected clean, got blocking'] });
  assert.deepEqual(evaluateExpect({ fired: ['log'] }, result), { pass: false, diffs: ['expected fired log, got fail, log'] });
  assert.deepEqual(evaluateExpect({ fired: [] }, { status: 'error', fired: [] }), { pass: true, diffs: [] });
  assert.deepEqual(evaluateExpect({ fired: ['log'] }, { status: 'error', fired: [] }),
    { pass: false, diffs: ['expected fired log, got (none)'] });
  assert.deepEqual(evaluateExpect({ summaryIncludes: 'all green' }, result),
    { pass: false, diffs: ['expected the summary to contain "all green"'] });
  assert.deepEqual(evaluateExpect({ verdict: 'clean' }, { status: 'timeout', fired: [], summary: '' }),
    { pass: false, diffs: ['expected clean, got timeout'] });
});

test('lenient (the READ path): a case survives a sidecar edit — what the script no longer declares is skipped', () => {
  const stale = file([{ id: 'c1', name: 'old', params: { command: 'npm test', gone: 1 },
    inputs: { plan: { text: '# p' }, removed: { text: 'x' } }, expect: { verdict: 'blocking', fired: ['log', 'vanished'] } }]);
  assert.equal(normalizeCases(stale, META).cases.length, 0, 'strict (the WRITE path) refuses it');
  assert.equal(normalizeCases(stale, META).errors.length, 3);
  const { cases, errors } = normalizeCases(stale, META, { lenient: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(cases[0].params, { command: 'npm test' });
  assert.deepEqual(cases[0].inputs, { plan: { text: '# p' } });
  assert.deepEqual(cases[0].expect, { verdict: 'blocking', fired: ['log'] });
  assert.deepEqual(stale.cases[0].expect.fired, ['log', 'vanished'], 'pure: the input is not mutated');
  // Everything else is still an error, lenient or not.
  assert.deepEqual(normalizeCases(file([{ id: 'c1', timeoutMs: 10 }]), META, { lenient: true }).errors,
    ['case "c1": timeoutMs must be an integer >= 1000']);
});

test('lenient: a declaration that CHANGED under a stored value is skipped, not a dropped case', () => {
  // The param and the ports are still declared — their SHAPE changed (an enum option
  // dropped on the Overview tab, a port retyped). Dropping the whole case blanks the
  // page's list, and its next case action (it writes the full list it was given)
  // deletes the case for good — the very loss the lenient read exists to prevent.
  const retyped = { ...META,
    params: [{ id: 'mode', type: 'enum', required: false, options: ['b'] }],
    inputs: [{ id: 'plan', type: 'void', required: false }, { id: 'facts', type: 'json', required: false }] };
  const stale = file([{ id: 'c1', name: 'old', params: { mode: 'a' },
    inputs: { plan: { text: '# p' }, facts: { text: 'not json' } } }]);
  assert.equal(normalizeCases(stale, retyped).cases.length, 0, 'strict (the WRITE path) refuses it');
  assert.equal(normalizeCases(stale, retyped).errors.length, 3);
  const { cases, errors } = normalizeCases(stale, retyped, { lenient: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(cases.map((c) => c.id), ['c1']);
  assert.deepEqual(cases[0].params, {}, 'the value is skipped like an undeclared param');
  assert.deepEqual(cases[0].inputs, {});
  // The other direction: a void port that grew a type keeps nothing, never the { fired } spec.
  const grew = { ...META, inputs: [{ id: 'done', type: 'md', required: false }] };
  const fired = normalizeCases(file([{ id: 'c1', inputs: { done: { fired: true } } }]), grew, { lenient: true });
  assert.deepEqual(fired.errors, []);
  assert.deepEqual(fired.cases[0].inputs, {});
});

test('lenient: a case written for a ports:"config" script survives the sidecar losing that mode', () => {
  const own = { inputs: [{ id: 'in', type: 'md', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: 'shell-{cycle}.md' }] };
  const kase = { id: 'c1', ports: own, inputs: { in: { text: '# hi' } } };
  // The script swapped ports:"config" for declared ports: the stored set is now illegal.
  const flat = { ...CONFIG_META, ports: undefined, defaultPorts: undefined, inputs: own.inputs, outputs: own.outputs };
  assert.deepEqual(normalizeCases(file([kase]), flat).cases, [], 'strict (the WRITE path) still refuses it');
  const lenient = normalizeCases(file([kase]), flat, { lenient: true });
  assert.deepEqual(lenient.errors, []);
  assert.equal(lenient.cases[0].ports, null, 'the stale set is dropped, the sidecar`s ports stand');
  assert.deepEqual(lenient.cases[0].inputs, { in: { text: '# hi' } });
  // And a stored set that no longer validates (the verdict went away, so a conditional output is illegal).
  const conditional = { ...own, outputs: [...own.outputs, { id: 'fail', type: 'md', when: 'blocking', filename: 'shell-{cycle}.md' }] };
  const noVerdict = { ...CONFIG_META, verdict: undefined };
  const kept = normalizeCases(file([{ id: 'c1', ports: conditional, inputs: { in: { text: '# hi' } } }]), noVerdict, { lenient: true });
  assert.deepEqual(kept.errors, []);
  assert.deepEqual(kept.cases[0].ports.outputs.map((p) => p.id), ['log'], 'back to the sidecar`s defaultPorts');
});

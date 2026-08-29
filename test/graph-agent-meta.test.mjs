import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAgentMeta, validateMetaV2, indexByKey, derivePortSummary } from '../src/shared/graph/agent-meta.mjs';

const ROLES = new Set(['reviewer', 'generic-producer']);
const base = (over = {}) => ({ metaVersion: 2, key: 'docs', displayName: 'Docs', runnerType: 'producer',
  inputs: [{ id: 'plan', type: 'md' }], outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }], order: 8, ...over });
const errs = (raw, opts) => validateMetaV2(raw, opts).errors;

test('a valid v2 sidecar normalizes with materialized defaults', () => {
  const { meta, errors } = normalizeAgentMeta(base(), { mockWriterRoles: ROLES });
  assert.deepEqual(errors, []);
  assert.equal(meta.metaVersion, 2);
  assert.equal(meta.color, 'amber', 'an unknown/absent color fails safe');
  assert.equal(meta.domain, 'general');
  assert.equal(meta.scope, 'project');
  assert.deepEqual(meta.inputs, [{ id: 'plan', type: 'md', required: true, as: 'file' }]);
  assert.deepEqual(meta.outputs, [{ id: 'notes', type: 'md', when: 'always', filename: 'notes.md',
    store: 'run', artifactKind: 'notes' }]);
  assert.equal(meta.portSummary, 'Reads plan; produces notes.');
  assert.equal('verdict' in meta, false, 'absent capabilities stay ABSENT (a v2 entry diffs against its sidecar)');
  assert.equal('sideEffect' in meta, false);
  assert.equal('placeable' in meta, false);
});

test('metaVersion, key, runnerType and order', () => {
  assert.deepEqual(errs(null), ['meta must be an object']);
  assert.ok(errs(base({ key: '' })).includes('key is required'));
  assert.ok(errs(base({ key: '9bad' })).includes('key "9bad" is not a valid agent key'));
  assert.ok(errs(base({ metaVersion: 1 })).includes('sidecar requires metaVersion 2'));
  assert.ok(errs(base({ metaVersion: undefined })).includes('sidecar requires metaVersion 2'));
  assert.ok(errs(base({ runnerType: 'wizard' })).includes('runnerType must be one of producer, verifier, clarifier'));
  assert.ok(errs(base({ order: 'x' })).includes('order must be a number'));
  assert.deepEqual(errs(base({ order: undefined })), [], 'order is optional (agents land last)');
});

test('port ids: reserved await, shape, regex, duplicates, ≤ 8 per side', () => {
  assert.ok(errs(base({ inputs: [{ id: 'await', type: 'md' }] })).includes(
    'inputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node'));
  assert.ok(errs(base({ outputs: [{ id: 'await', type: 'md', filename: 'a.md' }] })).includes(
    'outputs: port id "await" is reserved — the engine synthesizes the await gate port on every agent node'));
  assert.ok(errs(base({ inputs: [{ id: 'Bad', type: 'md' }] })).includes('inputs: bad port id "Bad"'));
  assert.ok(errs(base({ inputs: [{ id: 'a', type: 'md' }, { id: 'a', type: 'md' }] }))
    .includes('inputs: duplicate port id "a"'));
  assert.ok(errs(base({ inputs: ['nope'] })).includes('inputs: each port must be an object'));
  assert.ok(errs(base({ inputs: 'nope' })).includes('inputs must be an array'));
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, type: 'md' }));
  assert.ok(errs(base({ inputs: nine })).includes('inputs: at most 8 ports per side (got 9)'));
});

test('types, void ports, expands and the `as` renderers', () => {
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'code' }] })).includes('inputs.p: type must be one of md, json, void'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'void', filename: 'x.md' }] }))
    .includes('inputs.p: void ports carry no filename or store'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', expands: true }] }))
    .includes('inputs.p: expands is only legal on json inputs'));
  assert.deepEqual(errs(base({ inputs: [{ id: 'p', type: 'json', expands: true }] })), []);
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'nope' }] }))
    .includes('inputs.p: as must be one of file, answers, fix-review, worktree'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'answers' }] }))
    .includes('inputs.p: as "answers" requires a json port (got md)'));
  assert.ok(errs(base({ inputs: [{ id: 'p', type: 'md', as: 'worktree' }] }))
    .includes('inputs.p: as "worktree" requires a void port (got md)'));
  const { meta } = normalizeAgentMeta(base({ inputs: [{ id: 'p', type: 'void' }] }));
  assert.equal('as' in meta.inputs[0], false, 'a void input gets no default renderer');
});

test('loop inputs are coerced optional, with a warning', () => {
  const warnings = [];
  const { meta, errors } = normalizeAgentMeta(base({ inputs: [{ id: 'fix', type: 'md', loop: true, required: true }] }),
    { warn: (m) => warnings.push(m) });
  assert.deepEqual(errors, []);
  assert.deepEqual(meta.inputs[0], { id: 'fix', type: 'md', required: false, loop: true, as: 'file' });
  assert.deepEqual(warnings, ['[agent-registry] inputs.fix: loop:true forces required:false (a loop receiver is never a barrier)']);
});

test('outputs: filenames, tokens, stores, when + verdict, shared templates', () => {
  assert.ok(errs(base({ outputs: [] })).includes('at least one output port is required'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md' }] })).includes('outputs.o: md outputs require a filename template'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '../x.md' }] }))
    .includes('outputs.o: filename "../x.md" must be a plain basename'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '{nope}.md' }] }))
    .includes('outputs.o: filename "{nope}.md" uses unknown token(s) {nope}'));
  assert.deepEqual(errs(base({ outputs: [{ id: 'o', type: 'md', filename: '{base}{vsuffix}-c{cycle}.md' }] })), []);
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', store: 'nowhere' }] }))
    .includes('outputs.o: store must be one of run, project'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', when: 'nope' }] }))
    .includes('outputs.o: when must be one of always, blocking, clean'));
  assert.ok(errs(base({ outputs: [{ id: 'o', type: 'md', filename: 'o.md', when: 'blocking' }] }))
    .includes('outputs.o: when "blocking" requires the agent to declare verdict: { filename }'));
  assert.ok(errs(base({ outputs: [{ id: 'a', type: 'md', filename: 'p.md' }, { id: 'b', type: 'json', filename: 'p.md' }] }))
    .includes('outputs: filename template "p.md" is shared by ports of different types'));
  // the refiner's two arms legitimately share ONE template (same type => one path)
  assert.deepEqual(errs(base({ verdict: { filename: 'r.json' },
    outputs: [{ id: 'plan', type: 'md', when: 'clean', filename: '{base}{vsuffix}.md' },
      { id: 'revise', type: 'md', when: 'blocking', filename: '{base}{vsuffix}.md', artifactKind: 'plan' }] })), []);
});

test('runner obligations and verdict shape', () => {
  assert.ok(errs(base({ runnerType: 'verifier' })).includes('runnerType "verifier" requires verdict: { filename }'));
  assert.ok(errs(base({ verdict: {} })).includes('verdict must be an object with a filename'));
  assert.ok(errs(base({ verdict: { filename: 'sub/r.json' } }))
    .includes('verdict filename "sub/r.json" must be a plain basename'));
  assert.ok(errs(base({ runnerType: 'clarifier' })).includes('runnerType "clarifier" requires at least one json output port'));
  assert.deepEqual(errs(base({ runnerType: 'clarifier',
    outputs: [{ id: 'answers', type: 'json', filename: 'clarify.json' }] })), []);
});

test('capability fields', () => {
  assert.ok(errs(base({ sideEffect: 'files' })).includes('sideEffect must be "code" when present'));
  assert.ok(errs(base({ workspaceStrategy: 'ponder' }))
    .includes('workspaceStrategy must be one of explore, task, review'));
  assert.ok(errs(base({ workspaceVariantOf: '9x' })).includes('workspaceVariantOf must be an agent key'));
  assert.ok(errs(base({ workspaceVariantOf: 'docs', scope: 'workspace-only' }))
    .includes('workspaceVariantOf must not reference the agent itself'));
  assert.ok(errs(base({ workspaceVariantOf: 'reviewer' }))
    .includes('workspaceVariantOf requires scope "workspace-only"'));
  const { meta } = normalizeAgentMeta(base({ scope: 'workspace-only', workspaceVariantOf: 'reviewer',
    sideEffect: 'code', wantsRequest: true, workspaceFanOut: true, workspaceStrategy: 'review', placeable: false }));
  assert.equal(meta.workspaceVariantOf, 'reviewer');
  assert.equal(meta.sideEffect, 'code');
  assert.equal(meta.wantsRequest, true);
  assert.equal(meta.workspaceFanOut, true);
  assert.equal(meta.workspaceStrategy, 'review');
  assert.equal(meta.placeable, false);
});

test('mockRole is validated against the injected vocabulary — unknown warns and drops', () => {
  const warnings = [];
  const okMeta = normalizeAgentMeta(base({ mockRole: 'reviewer' }), { mockWriterRoles: ROLES, warn: (m) => warnings.push(m) });
  assert.equal(okMeta.meta.mockRole, 'reviewer');
  const bad = normalizeAgentMeta(base({ mockRole: 'nope' }), { mockWriterRoles: ROLES, warn: (m) => warnings.push(m) });
  assert.deepEqual(bad.errors, [], 'an unknown mock role is NEVER a 400');
  assert.equal('mockRole' in bad.meta, false);
  assert.deepEqual(warnings, ['[agent-registry] docs.mockRole: unknown mock role "nope"; ignored (the generic mock chain applies)']);
  const noVocab = normalizeAgentMeta(base({ mockRole: 'anything' }));
  assert.equal(noVocab.meta.mockRole, 'anything', 'with no vocabulary injected the role rides through');
});

test('questions coherence: an agent that cannot ask is neither locked nor default-on', () => {
  const { meta } = normalizeAgentMeta(base({ asksQuestions: false, questionsLocked: true, questionsDefault: true }));
  assert.deepEqual([meta.asksQuestions, meta.questionsLocked, meta.questionsDefault], [false, false, false]);
});

test('derivePortSummary and indexByKey', () => {
  assert.equal(derivePortSummary({ inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'review', type: 'md' }, { id: 'pass', type: 'void' }] }), 'Reads plan; produces review.');
  assert.equal(derivePortSummary({ inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void' }],
    outputs: [{ id: 'done', type: 'void' }] }), 'Reads plan; produces done.', 'an all-void side falls back to its ids');
  assert.equal(derivePortSummary({ inputs: [], outputs: [{ id: 'plan', type: 'md' }] }), 'Produces plan.');
  assert.equal(derivePortSummary({ inputs: [{ id: 'x', type: 'md' }], outputs: [] }), 'Reads x.');
  assert.equal(derivePortSummary(null), '');
  assert.deepEqual(indexByKey([{ key: 'a' }, { key: 'b' }, null, { key: '' }]), { a: { key: 'a' }, b: { key: 'b' } });
  assert.deepEqual(indexByKey(null), {});
});

test('agentFile is a path field: plain basename only (C-1)', () => {
  // Same rule as verdict.filename / outputs[].filename — the registry joins
  // agentFile onto the layer dir and reads it as the agent's system prompt.
  assert.ok(errs(base({ agentFile: '../../../etc/passwd' }))
    .includes('agentFile "../../../etc/passwd" must be a plain basename'));
  assert.ok(errs(base({ agentFile: '/etc/passwd' }))
    .includes('agentFile "/etc/passwd" must be a plain basename'));
  assert.ok(errs(base({ agentFile: 'sub/docs.md' }))
    .includes('agentFile "sub/docs.md" must be a plain basename'));
  assert.ok(errs(base({ agentFile: 'sub\\docs.md' }))
    .includes('agentFile "sub\\docs.md" must be a plain basename'));
  // a plain basename that is NOT <key>.md stays legal (the built-ins use
  // worca-cc-<role>.md), and an absent agentFile is legal too.
  assert.deepEqual(errs(base({ agentFile: 'worca-cc-docs.md' })), []);
  assert.deepEqual(errs(base({ agentFile: undefined })), []);
  assert.equal(normalizeAgentMeta(base({ agentFile: 'worca-cc-docs.md' })).meta.agentFile, 'worca-cc-docs.md');
});

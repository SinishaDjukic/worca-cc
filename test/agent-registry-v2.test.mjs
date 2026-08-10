// test/agent-registry-v2.test.mjs
// Sidecar meta v2 (spec §5 + Amendments d/f): typed ports, capability flags, the
// reserved `await` port id, materialized port defaults, the derived portSummary,
// and the TEMPORARY v1-compat shim that keeps the live v1 engine's channel view
// (consumes/optionalConsumes/produces/connectsTo/channelDefs/uiPhase) working
// until the engine swap. v1 sidecars (no metaVersion:2) are skipped with a loud,
// actionable warning rather than bricking the registry.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAgentRegistry, normalizeMeta, validateMetaV2 } from '../src/core/agent-registry.mjs';

const scratch = [];
function tmp() { const d = mkdtempSync(join(tmpdir(), 'worca-cc-v2-')); scratch.push(d); return d; }
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

/** A minimal VALID v2 sidecar; spread `extra` to break exactly one rule. */
function v2(extra = {}) {
  return {
    metaVersion: 2, key: 'demo', displayName: 'Demo', description: 'd', color: 'blue',
    icon: '<path d="M0 0"/>', agentFile: null, runnerType: 'producer', order: 1,
    inputs: [{ id: 'plan', type: 'md' }],
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }],
    ...extra,
  };
}

/** Write a sidecar + a non-empty agent body into a layer dir. */
function writeAgent(dir, meta) {
  const m = { agentFile: `${meta.key}.md`, ...meta };
  writeFileSync(join(dir, `${m.key}.meta.json`), JSON.stringify(m, null, 2));
  if (m.agentFile) writeFileSync(join(dir, m.agentFile), `---\nname: ${m.key}\n---\n\n# ${m.key}\n`);
  return m;
}

function load(dir) { return loadAgentRegistry(dir, { userAgentsDir: null, includePlugins: false }); }

/** Run `fn` with console.warn captured; returns the joined warning lines. */
function capturingWarnings(fn) {
  const warned = [];
  const orig = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try { fn(); } finally { console.warn = orig; }
  return warned;
}

const errorsFor = (meta) => validateMetaV2(meta).errors;
const rejects = (meta, re) => {
  const errs = errorsFor(meta);
  assert.ok(errs.some((e) => re.test(e)), `expected an error matching ${re}, got ${JSON.stringify(errs)}`);
};

// ── loading ─────────────────────────────────────────────────────────────────

test('a v2 sidecar loads with its typed ports', () => {
  const dir = tmp();
  writeAgent(dir, v2({ key: 'specWriter' }));
  const m = load(dir).specWriter;
  assert.equal(m.metaVersion, 2);
  assert.deepEqual(m.inputs, [{ id: 'plan', type: 'md', required: true, as: 'file' }]);
  assert.deepEqual(m.outputs, [
    { id: 'spec', type: 'md', when: 'always', filename: 'spec.md', store: 'run', artifactKind: 'spec' },
  ]);
});

test('a v1 sidecar is skipped with a warning naming metaVersion 2', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'legacy.meta.json'), JSON.stringify({
    key: 'legacy', displayName: 'Legacy', color: 'amber', runnerType: 'producer', order: 1,
    agentFile: null, consumes: ['userPrompt'], produces: ['plan'], connectsTo: '*',
  }));
  const warned = capturingWarnings(() => {
    assert.deepEqual(Object.keys(load(dir)), []);
  });
  assert.ok(warned.some((w) => w.includes('requires metaVersion 2')), JSON.stringify(warned));
  assert.ok(warned.some((w) => w.includes('legacy')));
});

test('a v2 sidecar whose agentFile body is missing or empty is skipped with a warning', () => {
  const dir = tmp();
  // declared body never written
  writeFileSync(join(dir, 'noBody.meta.json'), JSON.stringify(v2({ key: 'noBody', agentFile: 'noBody.md' })));
  // declared body present but blank
  writeFileSync(join(dir, 'blank.meta.json'), JSON.stringify(v2({ key: 'blank', agentFile: 'blank.md' })));
  writeFileSync(join(dir, 'blank.md'), '   \n\n');
  const warned = capturingWarnings(() => {
    assert.deepEqual(Object.keys(load(dir)), []);
  });
  assert.ok(warned.some((w) => /noBody/.test(w) && /missing or empty/.test(w)), JSON.stringify(warned));
  assert.ok(warned.some((w) => /blank/.test(w) && /missing or empty/.test(w)), JSON.stringify(warned));
});

// ── §5 validation rules ─────────────────────────────────────────────────────

test('a valid v2 sidecar produces no validation errors', () => {
  assert.deepEqual(errorsFor(v2()), []);
});

test('§5: metaVersion, key, runnerType and the port arrays are required', () => {
  rejects({ ...v2(), metaVersion: 1 }, /requires metaVersion 2/);
  rejects({ ...v2(), key: 'not a key!' }, /not a valid agent key/);
  rejects({ ...v2(), runnerType: 'wizard' }, /runnerType must be one of/);
  rejects({ ...v2(), inputs: 'nope' }, /inputs must be an array/);
  rejects({ ...v2(), outputs: {} }, /outputs must be an array/);
  rejects({ ...v2(), outputs: [] }, /at least one output port/);
});

test('§5: port ids are validated, unique per side, and capped at 8 per side', () => {
  rejects(v2({ inputs: [{ id: 'Plan', type: 'md' }] }), /bad port id "Plan"/);
  rejects(v2({ inputs: [{ id: 'plan', type: 'md' }, { id: 'plan', type: 'md' }] }), /duplicate port id "plan"/);
  rejects(v2({
    outputs: [
      { id: 'a', type: 'md', filename: 'a.md' },
      { id: 'a', type: 'json', filename: 'b.json' },
    ],
  }), /duplicate port id "a"/);
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, type: 'md' }));
  rejects(v2({ inputs: nine }), /at most 8 ports per side/);
});

test('§5 ⟨f⟩: port id "await" is reserved on BOTH sides', () => {
  rejects(v2({ inputs: [{ id: 'await', type: 'md' }] }), /"await" is reserved/);
  rejects(v2({ outputs: [{ id: 'await', type: 'md', filename: 'a.md' }] }), /"await" is reserved/);
});

test('§5: the port type set is closed (md | json | void); `any` is undeclarable', () => {
  rejects(v2({ inputs: [{ id: 'plan', type: 'any' }] }), /type must be one of md, json, void/);
  rejects(v2({ outputs: [{ id: 'spec', type: 'text', filename: 'spec.md' }] }), /type must be one of md, json, void/);
});

test('§5: void ports carry no filename or store', () => {
  rejects(v2({ outputs: [{ id: 'done', type: 'void', filename: 'done.md' }] }), /void ports carry no filename or store/);
  rejects(v2({ inputs: [{ id: 'done', type: 'void', store: 'run' }] }), /void ports carry no filename or store/);
});

test('§5: md|json outputs need a basename-only filename with known tokens', () => {
  rejects(v2({ outputs: [{ id: 'spec', type: 'md' }] }), /require a filename/);
  rejects(v2({ outputs: [{ id: 'spec', type: 'md', filename: '../etc/passwd' }] }), /plain basename/);
  rejects(v2({ outputs: [{ id: 'spec', type: 'md', filename: '{nope}.md' }] }), /unknown token/);
  assert.deepEqual(errorsFor(v2({
    outputs: [{ id: 'plan', type: 'md', filename: '{base}{vsuffix}-cycle{cycle}.md' }],
  })), []);
});

test('§5: a verifier requires a verdict, and a non-always `when` requires one too', () => {
  rejects(v2({ runnerType: 'verifier' }), /requires verdict/);
  rejects(v2({ outputs: [{ id: 'spec', type: 'md', filename: 'spec.md', when: 'clean' }] }), /requires the agent to declare verdict/);
  rejects(v2({ outputs: [{ id: 'spec', type: 'md', filename: 'spec.md', when: 'sometimes' }] }), /when must be one of/);
  assert.deepEqual(errorsFor(v2({
    runnerType: 'verifier',
    verdict: { filename: 'impl-review-cycle{cycle}.json' },
    outputs: [
      { id: 'review', type: 'md', filename: 'r.md', when: 'blocking' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  })), []);
});

test('§5: a clarifier requires at least one json output', () => {
  rejects(v2({ runnerType: 'clarifier' }), /clarifier.*json output/);
  assert.deepEqual(errorsFor(v2({
    runnerType: 'clarifier',
    outputs: [{ id: 'answers', type: 'json', filename: 'clarify.json' }],
  })), []);
});

test('§5: `expands` is json-only', () => {
  rejects(v2({ inputs: [{ id: 'task', type: 'md', expands: true }] }), /expands is only legal on json inputs/);
  assert.deepEqual(errorsFor(v2({ inputs: [{ id: 'task', type: 'json', expands: true }] })), []);
});

test('§5: two outputs may share a filename template only with identical type', () => {
  rejects(v2({
    verdict: { filename: 'v.json' },
    outputs: [
      { id: 'plan', type: 'md', filename: '{base}.md', when: 'clean' },
      { id: 'revise', type: 'json', filename: '{base}.md', when: 'blocking' },
    ],
  }), /shared by ports of different types/);
  assert.deepEqual(errorsFor(v2({
    verdict: { filename: 'v.json' },
    outputs: [
      { id: 'plan', type: 'md', filename: '{base}.md', when: 'clean' },
      { id: 'revise', type: 'md', filename: '{base}.md', when: 'blocking' },
    ],
  })), []);
});

test('§5: `loop: true` coerces `required: false` and warns rather than rejecting', () => {
  const raw = v2({ inputs: [{ id: 'fix', type: 'md', required: true, loop: true }] });
  assert.deepEqual(errorsFor(raw), []);
  let meta;
  const warned = capturingWarnings(() => { meta = normalizeMeta(raw); });
  assert.deepEqual(meta.inputs, [{ id: 'fix', type: 'md', required: false, loop: true, as: 'file' }]);
  assert.ok(warned.some((w) => /loop/.test(w) && /required/.test(w)), JSON.stringify(warned));
});

// ── Amendment d capability fields ───────────────────────────────────────────

test('⟨d⟩ `as` renderers are type-checked', () => {
  rejects(v2({ inputs: [{ id: 'answers', type: 'md', as: 'answers' }] }), /as "answers" requires a json port/);
  rejects(v2({ inputs: [{ id: 'done', type: 'json', as: 'worktree' }] }), /as "worktree" requires a void port/);
  rejects(v2({ inputs: [{ id: 'fix', type: 'json', as: 'fix-review' }] }), /as "fix-review" requires a md port/);
  rejects(v2({ inputs: [{ id: 'plan', type: 'md', as: 'sideways' }] }), /as must be one of/);
  assert.deepEqual(errorsFor(v2({ inputs: [{ id: 'answers', type: 'json', as: 'answers' }] })), []);
});

test('⟨d⟩ void inputs: no DEFAULT `as`, but an explicit `as: worktree` is kept', () => {
  const bare = normalizeMeta(v2({ inputs: [{ id: 'done', type: 'void', required: false }] }));
  assert.deepEqual(bare.inputs, [{ id: 'done', type: 'void', required: false }]);
  assert.ok(!Object.hasOwn(bare.inputs[0], 'as'), 'a void input carries no `as` key at all');

  const worktree = normalizeMeta(v2({ inputs: [{ id: 'done', type: 'void', required: false, as: 'worktree' }] }));
  assert.deepEqual(worktree.inputs, [{ id: 'done', type: 'void', required: false, as: 'worktree' }]);

  // the reverse direction: the worktree renderer is void-only
  rejects(v2({ inputs: [{ id: 'done', type: 'md', as: 'worktree' }] }), /as "worktree" requires a void port/);
  // and a void input may not take any other renderer
  rejects(v2({ inputs: [{ id: 'done', type: 'void', as: 'file' }] }), /as "file" requires a non-void port/);
});

test('⟨d⟩ workspaceStrategy is a closed set', () => {
  rejects(v2({ workspaceStrategy: 'bogus' }), /workspaceStrategy must be one of/);
  assert.deepEqual(errorsFor(v2({ workspaceStrategy: 'review' })), []);
});

test('⟨d⟩ workspaceVariantOf rejects self-reference and non-workspace-only agents', () => {
  rejects(v2({ key: 'wsReviewer', scope: 'workspace-only', workspaceVariantOf: 'wsReviewer' }), /itself/);
  rejects(v2({ key: 'wsReviewer', workspaceVariantOf: 'reviewer' }), /requires scope "workspace-only"/);
  assert.deepEqual(errorsFor(v2({ key: 'wsReviewer', scope: 'workspace-only', workspaceVariantOf: 'reviewer' })), []);
});

test('⟨d⟩ sideEffect is "code" or absent', () => {
  rejects(v2({ sideEffect: 'network' }), /sideEffect/);
  assert.equal(normalizeMeta(v2({ sideEffect: 'code' })).sideEffect, 'code');
});

test('⟨d⟩ an unknown mockRole warns and is dropped; a known one is kept', () => {
  let meta;
  const warned = capturingWarnings(() => { meta = normalizeMeta(v2({ mockRole: 'not-a-writer' })); });
  assert.ok(!Object.hasOwn(meta, 'mockRole'), 'unknown mockRole is dropped so the fallback chain applies');
  assert.ok(warned.some((w) => /mockRole/.test(w) && /not-a-writer/.test(w)), JSON.stringify(warned));
  assert.deepEqual(errorsFor(v2({ mockRole: 'not-a-writer' })), []); // a warning, never a 400
  assert.equal(normalizeMeta(v2({ mockRole: 'implementer' })).mockRole, 'implementer');
});

test('⟨d⟩ agent-level defaults are applied at READ time, never written into the entry', () => {
  const plain = normalizeMeta(v2());
  for (const f of ['wantsRequest', 'workspaceFanOut', 'workspaceStrategy', 'workspaceVariantOf', 'placeable', 'verdict', 'sideEffect', 'mockRole']) {
    assert.ok(!Object.hasOwn(plain, f), `${f} must be absent when unset`);
  }
  const full = normalizeMeta(v2({ wantsRequest: true, workspaceFanOut: true, placeable: false }));
  assert.equal(full.wantsRequest, true);
  assert.equal(full.workspaceFanOut, true);
  assert.equal(full.placeable, false);
});

// ── materialized defaults + derived text ────────────────────────────────────

test('normalization materializes the port defaults', () => {
  const m = normalizeMeta(v2({
    inputs: [{ id: 'plan', type: 'md' }, { id: 'task', type: 'json', required: false, expands: true }],
    outputs: [{ id: 'spec', type: 'md', filename: 'spec.md' }, { id: 'notes', type: 'json', filename: 'n.json', store: 'project', artifactKind: 'note' }],
  }));
  assert.deepEqual(m.inputs, [
    { id: 'plan', type: 'md', required: true, as: 'file' },
    { id: 'task', type: 'json', required: false, expands: true, as: 'file' },
  ]);
  assert.deepEqual(m.outputs, [
    { id: 'spec', type: 'md', when: 'always', filename: 'spec.md', store: 'run', artifactKind: 'spec' },
    { id: 'notes', type: 'json', when: 'always', filename: 'n.json', store: 'project', artifactKind: 'note' },
  ]);
});

test('normalizeMeta NEVER synthesizes the await port (that is the graph ports layer)', () => {
  const m = normalizeMeta(v2());
  assert.ok(!m.inputs.some((p) => p.id === 'await'));
  assert.ok(!m.outputs.some((p) => p.id === 'await'));
});

test('portSummary is derived text, and descriptionDerived keeps its boolean meaning', () => {
  const implementer = normalizeMeta(v2({
    key: 'implementer', sideEffect: 'code',
    inputs: [{ id: 'plan', type: 'md' }, { id: 'fix', type: 'md', loop: true, as: 'fix-review' }],
    outputs: [{ id: 'done', type: 'void' }],
  }));
  assert.equal(implementer.portSummary, 'Reads plan, fix; produces done.');
  // non-void ids win whenever a side has any (a void-only side falls back to its
  // declared ids, so the sentence is never empty)
  const reviewer = normalizeMeta(v2({
    runnerType: 'verifier', verdict: { filename: 'v.json' },
    inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void', required: false, as: 'worktree' }],
    outputs: [{ id: 'review', type: 'md', filename: 'r.md', when: 'blocking' }, { id: 'pass', type: 'void', when: 'clean' }],
  }));
  assert.equal(reviewer.portSummary, 'Reads plan; produces review.');
  const source = normalizeMeta(v2({ inputs: [] }));
  assert.equal(source.portSummary, 'Produces spec.');
  assert.ok(!Object.hasOwn(implementer, 'descriptionDerived'));
});

// ── v1-compat shim ──────────────────────────────────────────────────────────

test('shim: a v2 reviewer yields the v1 channel view the live engine reads', () => {
  const m = normalizeMeta(v2({
    key: 'reviewer', runnerType: 'verifier', verdict: { filename: 'impl-review-cycle{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md' }, { id: 'done', type: 'void', required: false, as: 'worktree' }],
    outputs: [
      { id: 'review', type: 'md', filename: '{base}-impl-review.md', store: 'project', when: 'blocking' },
      { id: 'pass', type: 'void', when: 'clean' },
    ],
  }));
  assert.deepEqual(m.consumes, ['plan']);
  assert.deepEqual(m.optionalConsumes, ['code']);   // done:void optional -> the v1 `code` channel
  assert.deepEqual(m.produces, ['review']);         // pass:void is dropped
  assert.equal(m.connectsTo, '*');
  assert.equal(m.uiPhase, 'review');
});

test('shim: duplicate output channels dedupe (refiner plan+revise -> produces [plan])', () => {
  const m = normalizeMeta(v2({
    key: 'refiner', verdict: { filename: 'refine-review-cycle{cycle}.json' },
    inputs: [{ id: 'plan', type: 'md' }, { id: 'revise', type: 'md', loop: true }],
    outputs: [
      { id: 'plan', type: 'md', filename: '{base}{vsuffix}.md', store: 'project', when: 'clean' },
      { id: 'revise', type: 'md', filename: '{base}{vsuffix}.md', store: 'project', when: 'blocking' },
    ],
  }));
  assert.deepEqual(m.produces, ['plan']);
  assert.deepEqual(m.consumes, ['plan']);
  assert.deepEqual(m.optionalConsumes, ['review']);
  assert.equal(m.uiPhase, 'refine');
});

test('shim: sideEffect code keeps the v1 `code` channel on produces', () => {
  const m = normalizeMeta(v2({
    key: 'implementer', sideEffect: 'code',
    inputs: [
      { id: 'plan', type: 'md' },
      { id: 'fix', type: 'md', loop: true, as: 'fix-review' },
      { id: 'task', type: 'json', required: false, expands: true },
    ],
    outputs: [{ id: 'done', type: 'void' }],
  }));
  assert.deepEqual(m.consumes, ['plan']);
  assert.deepEqual(m.optionalConsumes, ['review', 'decomposition']);
  assert.deepEqual(m.produces, ['code']);
  assert.equal(m.uiPhase, 'implement');
});

test('shim: an md `task` input is the v1 userPrompt channel', () => {
  const m = normalizeMeta(v2({ key: 'planner', inputs: [{ id: 'task', type: 'md' }, { id: 'answers', type: 'json', required: false, as: 'answers' }] }));
  assert.deepEqual(m.consumes, ['userPrompt']);
  assert.deepEqual(m.optionalConsumes, ['clarify']);
  assert.equal(m.uiPhase, 'plan');
});

test('shim: custom port ids stay custom channels, and define themselves', () => {
  const m = normalizeMeta(v2({
    key: 'specWriter',
    inputs: [{ id: 'plan', type: 'md' }, { id: 'blueprint', type: 'json', required: false }],
    outputs: [{ id: 'spec', type: 'json', filename: 'api-spec.json' }],
  }));
  assert.deepEqual(m.consumes, ['plan']);
  assert.deepEqual(m.optionalConsumes, ['blueprint']);
  assert.deepEqual(m.produces, ['spec']);
  assert.deepEqual(m.channelDefs, [{ id: 'spec', kind: 'json', filename: 'api-spec.json' }]);
  assert.equal(m.uiPhase, null);   // no v1 phase for a custom key
});

test('shim: built-in channels are never redefined by channelDefs', () => {
  const warned = capturingWarnings(() => {
    const m = normalizeMeta(v2({ key: 'planner', outputs: [{ id: 'plan', type: 'md', filename: '{base}{vsuffix}.md', store: 'project' }] }));
    assert.deepEqual(m.channelDefs, []);
  });
  assert.deepEqual(warned, []);   // deriving is not authoring: no redefinition warning
});

test('shim: a void input with no v1 channel is dropped entirely', () => {
  const m = normalizeMeta(v2({ inputs: [{ id: 'plan', type: 'md' }, { id: 'gate', type: 'void', required: false }] }));
  assert.deepEqual(m.consumes, ['plan']);
  assert.deepEqual(m.optionalConsumes, []);
});

// ── dead v1 fields ──────────────────────────────────────────────────────────

test('the dead v1 fields are gone from a v2 entry', () => {
  const m = normalizeMeta(v2({ loopSource: true, version: 7, uiPhase: 'made-up' }));
  assert.ok(!Object.hasOwn(m, 'loopSource'), 'loopSource is subsumed by output `when`');
  assert.ok(!Object.hasOwn(m, 'version'), 'the free-form version field is replaced by metaVersion');
  assert.equal(m.uiPhase, null, 'uiPhase is derived from the key map, never authored');
});

test('order is optional in v2 and defaults to 999', () => {
  const m = normalizeMeta(v2({ order: undefined }));
  assert.equal(m.order, 999);
  rejects(v2({ order: 'soon' }), /order must be a number/);
});

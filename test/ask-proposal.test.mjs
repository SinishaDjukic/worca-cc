// P1/T11: server-side validation of propose_run (ask-worca-design.md §9.2) —
// exactly one target, real ids, guardrails default normal / permissive refused,
// syntactic branch checks, error strings matching POST /api/run where one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { createProposalValidator, isSyntacticRef, PROPOSAL_ERRORS } from '../src/core/ask/proposal.mjs';

const dirA = mkdtempSync(join(tmpdir(), 'worca-ask-prop-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'worca-ask-prop-b-'));
const existing = new Set([dirA, dirB, '/p/demo']);
const gitRepos = new Set([dirA, dirB]);
const deps = {
  listProjects: async () => [
    { key: 'demo-00000001', name: 'Demo', path: '/p/demo', exists: true },
    { key: 'gone-00000002', name: 'Gone', path: '/p/gone', exists: false },
  ],
  readWorkspace: async (id) => (id === 'wks-team-0000abcd'
    ? { id, name: 'Team', description: '', projectPaths: [dirB, dirA], projectKeys: ['zeta-00000002', 'alpha-00000001'], exists: [true, true] }
    : id === 'wks-broken-0000abcd'
      ? { id, name: 'Broken', description: '', projectPaths: ['/p/missing'], projectKeys: ['missing-00000003'], exists: [false] }
      : id === 'wks-nogit-0000abcd'
        ? { id, name: 'NoGit', description: '', projectPaths: ['/p/demo'], projectKeys: ['demo-00000001'], exists: [true] }
        : null),
  readWorkflow: async (id) => (id === 'wf_default' ? { id, name: 'Default' } : id === 'wf_review' ? { id, name: 'Review only' } : null),
  // The runnable gate rides the same seam: derive it from the fake reader so the
  // two can never disagree about which ids exist.
  assertRunnableWorkflow: async (id) => {
    const wf = await deps.readWorkflow(id);
    if (!wf) throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' });
    return wf;
  },
  readGuardrailSet: async (id) => (['permissive', 'normal', 'secure', 'custom1'].includes(id) ? { id } : null),
  isGitRepo: (p) => gitRepos.has(p),
  pathExists: (p) => existing.has(p),
};
const { validateProposal } = createProposalValidator(deps);
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.card; };
const errs = (r) => { assert.equal(r.ok, false); return r.errors; };

test('target: exactly one of projectKey / workspaceId', async () => {
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', workspaceId: 'wks-team-0000abcd', brief: 'x' })), [PROPOSAL_ERRORS.bothTargets]);
  assert.deepEqual(errs(await validateProposal({ brief: 'x' })), [PROPOSAL_ERRORS.noTarget]);
  assert.deepEqual(errs(await validateProposal(null)), ['workspaceId or projectKey is required']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'nope-00000009', brief: 'x' })), ['unknown projectKey "nope-00000009"']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'gone-00000002', brief: 'x' })), ['project path is missing: /p/gone']);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'not-a-key', brief: 'x' })), ['workspace not found']);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-ghost-0000abcd', brief: 'x' })), ['workspace not found']);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-broken-0000abcd', brief: 'x' })), ['workspace member path is missing']);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-nogit-0000abcd', brief: 'x' })), ['workspace member is not a git repository: /p/demo']);
});

test('happy project card: every key present, defaults applied, feature branch unique per card', async () => {
  const card = ok(await validateProposal({ projectKey: 'demo-00000001', brief: '  Add a README badge\nsecond line  ' }, { cardId: 'card_3f2a9c01' }));
  assert.deepEqual(Object.keys(card).sort(), ['brief', 'featureBranch', 'guardrailsId', 'members', 'projectDir', 'projectKey', 'projectName',
    'sourceBranch', 'sourceBranchByKey', 'target', 'title', 'workflowId', 'workflowName', 'workspaceId', 'workspaceName']);
  assert.equal(card.target, 'project');
  assert.equal(card.projectKey, 'demo-00000001');
  assert.equal(card.projectName, 'Demo');
  assert.equal(card.projectDir, '/p/demo');
  assert.equal(card.workspaceId, null);
  assert.equal(card.members, null);
  assert.equal(card.workflowId, 'wf_default');
  assert.equal(card.workflowName, 'Default');
  assert.equal(card.guardrailsId, 'normal', 'D3: default Normal');
  assert.equal(card.brief, 'Add a README badge\nsecond line', 'trimmed, inner newlines kept');
  assert.equal(card.title, 'Add a README badge', 'first line of the brief');
  assert.equal(card.sourceBranch, null);
  assert.equal(card.sourceBranchByKey, null);
  assert.match(card.featureBranch, /^worca-cc\/.+-3f2a9c01$/, 'suggestBranchName with the card hex as the id');
  const noId = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'Add a README badge' }));
  assert.match(noId.featureBranch, /^worca-cc\/.+-run$/, 'without a cardId: the -run form (the child copy)');
});

test('happy workspace card: members sorted by key (primary first), per-member overrides kept', async () => {
  const card = ok(await validateProposal({
    workspaceId: 'wks-team-0000abcd', workflowId: 'wf_review', guardrailsId: 'secure', brief: 'Cross-repo rename',
    title: '  "Rename: everything"  ', sourceBranch: 'main', featureBranch: 'Feature/Rename Stuff!!', sourceBranchByKey: { 'zeta-00000002': 'develop', 'alpha-00000001': '  ' },
  }, { cardId: 'card_00000001' }));
  assert.equal(card.target, 'workspace');
  assert.equal(card.workspaceId, 'wks-team-0000abcd');
  assert.equal(card.workspaceName, 'Team');
  assert.deepEqual(card.members, [
    { projectKey: 'alpha-00000001', projectName: basename(dirA), projectDir: dirA },
    { projectKey: 'zeta-00000002', projectName: basename(dirB), projectDir: dirB },
  ]);
  assert.equal(card.projectKey, null);
  assert.equal(card.workflowName, 'Review only');
  assert.equal(card.guardrailsId, 'secure');
  assert.equal(card.title, 'Rename: everything', 'sanitizeTitle strips quotes');
  assert.equal(card.sourceBranch, 'main');
  assert.equal(card.featureBranch, 'feature/rename-stuff', 'sanitizeBranchName');
  assert.deepEqual(card.sourceBranchByKey, { 'zeta-00000002': 'develop' }, 'blank overrides dropped');
});

test('workflow, guardrails, brief, branches: errors accumulate in order', async () => {
  const r = await validateProposal({
    projectKey: 'demo-00000001', workflowId: 'wf_nope', guardrailsId: 'permissive', brief: '', sourceBranch: '-evil', sourceBranchByKey: { x: 'y' },
  });
  assert.deepEqual(errs(r), [
    'unknown workflowId "wf_nope"',
    'guardrailsId "permissive" is not allowed for proposed runs — use "normal" or a stricter set',
    'brief is required',
    'unknown or invalid sourceBranch: -evil',
    'sourceBranchByKey is only valid for a workspace',
  ]);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', guardrailsId: 42 })), ['guardrailsId must be a string']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', guardrailsId: 'ghost' })), ['unknown guardrailsId "ghost"']);
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', guardrailsId: 'custom1' })).guardrailsId, 'custom1');
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', guardrailsId: '' })).guardrailsId, 'normal');
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x'.repeat(8001) })), ['brief exceeds 8000 characters']);
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x'.repeat(8000) })).brief.length, 8000);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-team-0000abcd', brief: 'x', sourceBranchByKey: { 'nope-00000009': 'main', 'alpha-00000001': 'bad..ref' } })),
    ['sourceBranchByKey has an unknown project key: nope-00000009', 'unknown or invalid sourceBranch: bad..ref']);
  assert.equal(ok(await validateProposal({ workspaceId: 'wks-team-0000abcd', brief: 'x', sourceBranchByKey: 'junk' })).sourceBranchByKey, null, 'non-object ignored like the route');
});

test('isSyntacticRef: git ref-format rules, no shell-outs', () => {
  for (const good of ['main', 'feature/x-1', 'release-2.0', 'v1.2.3', 'user/sub/branch', 'a'.repeat(255)]) assert.ok(isSyntacticRef(good), good);
  for (const bad of ['', '-x', 'a b', 'a..b', 'a/', '/a', 'a//b', '.hidden', 'a/.b', 'x.lock', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'a@{1}', 'a.', 'a'.repeat(256), 42, null]) {
    assert.ok(!isSyntacticRef(bad), JSON.stringify(bad));
  }
});

// After the v2 break the graph IS the engine: a v2 template is the normal case,
// so proposing one must produce NO error (only an unknown/archived id refuses).
test('propose_run ACCEPTS a graph template', async () => {
  const { validateProposal: v } = createProposalValidator({
    ...deps,
    readWorkflow: async (id) => (id === 'wf_g' ? { id, name: 'G', version: 2, nodes: [], wires: [] } : null),
    assertRunnableWorkflow: async (id) => (id === 'wf_g'
      ? { id, name: 'G', version: 2, nodes: [], wires: [] }
      : (() => { throw Object.assign(new Error(`unknown workflowId "${id}"`), { code: 'NOT_FOUND' }); })()),
  });
  const r = await v({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_g' });
  assert.equal(r.ok, true, `a graph template is runnable now: ${JSON.stringify(r)}`);
  assert.equal(r.card.workflowId, 'wf_g');
});

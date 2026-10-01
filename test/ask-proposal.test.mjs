// P1/T11: server-side validation of propose_run (ask-worca-design.md §9.2) —
// exactly one target, real ids, guardrails default normal / permissive refused,
// syntactic branch checks, error strings matching POST /api/run where one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { createProposalValidator, isSyntacticRef, PROPOSAL_ERRORS, pickCardAttachments } from '../src/core/ask/proposal.mjs';

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
  readWorkflow: async (id) => (id === 'wf_default' ? { id, name: 'Default' } : id === 'wf_review' ? { id, name: 'Review only' }
    : id === 'wf_memory_defrag' ? { id: 'wf_memory_defrag', name: 'Memory defragment', version: 2, domain: 'shared', nodes: [], wires: [] } : null),
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
  assert.deepEqual(Object.keys(card).sort(), ['attachments', 'brief', 'featureBranch', 'guardrailsId', 'members', 'memoryScope', 'note', 'projectDir', 'projectKey', 'projectName',
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
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x'.repeat(ASK_LIMITS.briefMaxChars + 1) })), [`brief exceeds ${ASK_LIMITS.briefMaxChars} characters`]);
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x'.repeat(ASK_LIMITS.briefMaxChars) })).brief.length, ASK_LIMITS.briefMaxChars);
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

const ROWS = [
  { id: 'att_00000001', threadId: 'ask_00000001', messageId: null, name: 'notes.md', bytes: 12, kind: 'text', mime: null, createdAt: 't' },
  { id: 'att_00000002', threadId: 'ask_00000001', messageId: null, name: 'shot.png', bytes: 3000, kind: 'image', mime: 'image/png', createdAt: 't' },
];

test('pickCardAttachments keeps known ids in the model\'s order, drops unknown/duplicate/non-string', () => {
  assert.deepEqual(pickCardAttachments(['att_00000002', 'att_ffffffff', 'att_00000001', 'att_00000002', 7], ROWS), [
    { id: 'att_00000002', name: 'shot.png', bytes: 3000, kind: 'image' },
    { id: 'att_00000001', name: 'notes.md', bytes: 12, kind: 'text' },
  ]);
  assert.deepEqual(pickCardAttachments(undefined, ROWS), []);
  assert.deepEqual(pickCardAttachments(['att_00000001'], null), []);
});

test('card carries note (flattened, clipped to 200) and attachments; both default empty', async () => {
  const bare = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x' }));
  assert.equal(bare.note, null);
  assert.deepEqual(bare.attachments, []);
  const note = 'why this\u0001shape\n  ' + 'z'.repeat(300);
  const card = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', note, attachmentIds: ['att_00000001', 'nope'] }, { attachments: ROWS }));
  assert.equal(card.note.length, 200);
  assert.ok(card.note.startsWith('why this shape z'), 'control chars and line breaks become one space');
  assert.deepEqual(card.attachments, [{ id: 'att_00000001', name: 'notes.md', bytes: 12, kind: 'text' }]);
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', note: 42 })).note, null, 'a non-string note is ignored');
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', note: '   ' })).note, null, 'whitespace-only → null');
});

test('memoryScope: only with wf_memory_defrag, never on a workspace; the card carries it (null otherwise)', async () => {
  const card = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x' }));
  assert.equal(card.memoryScope, null);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', memoryScope: 'global' })), ['memoryScope is only valid with the Memory defragment workflow (wf_memory_defrag)']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_memory_defrag' })), ['the Memory defragment workflow needs memoryScope ("global" or "project")']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'both' })), ['memoryScope must be "global" or "project"']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 42 })), ['memoryScope must be "global" or "project"']);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-team-0000abcd', brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'global' })), ['a memory defragment run targets one project, not a workspace']);
  // I2-#8: an unknown workflow id is ONE error — the scope check is skipped while `wf` is null,
  // or a typo of the defragment id would also claim "only valid with the Memory defragment workflow".
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_nope', memoryScope: 'global' })), ['unknown workflowId "wf_nope"']);
  const good = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'project' }));
  assert.equal(good.memoryScope, 'project'); assert.equal(good.workflowId, 'wf_memory_defrag');
});

test('the Workspace scan workflow is refused: it starts only from Workspaces (D2)', async () => {
  const { validateProposal: v } = createProposalValidator({
    ...deps,
    assertRunnableWorkflow: async (id) => (id === 'wf_workspace_scan'
      ? { id, name: 'Workspace scan', version: 2, domain: 'shared', nodes: [], wires: [] }
      : deps.assertRunnableWorkflow(id)),
  });
  assert.deepEqual(errs(await v({ workspaceId: 'wks-team-0000abcd', brief: 'x', workflowId: 'wf_workspace_scan' })), [PROPOSAL_ERRORS.scanWorkflow]);
  assert.deepEqual(errs(await v({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_workspace_scan' })), [PROPOSAL_ERRORS.scanWorkflow]);
});

// ── #527: the source branch is resolved against the remote (injected resolveSourceRef) ──
test('#527 sourceBranch: remote-only / behind / stale annotate the card; missing is an error naming the remote', async () => {
  const calls = [];
  const answers = {
    'feat/remote': { ok: true, ref: 'origin/feat/remote', local: false, remoteOnly: true, fetchedAt: null, stale: false },
    behind: { ok: true, ref: 'behind', local: true, remoteOnly: false, behind: 3, ahead: 0 },
    offline: { ok: false, kind: 'stale', fetchError: { kind: 'network', message: 'x' } },
    uptodate: { ok: true, ref: 'uptodate', local: true, remoteOnly: false, behind: 0, ahead: 0 },
    nowhere: { ok: false, kind: 'missing' },
  };
  const v = createProposalValidator({ ...deps,
    resolveSourceRef: async (dir, name, o) => { calls.push({ dir, name, o }); return answers[name]; },
    remoteName: (key) => (key === 'demo-00000001' ? 'upstream' : 'origin') }).validateProposal;
  const remote = ok(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'feat/remote' }));
  assert.deepEqual(calls[0], { dir: '/p/demo', name: 'feat/remote', o: { projectKey: 'demo-00000001' } });
  assert.equal(remote.sourceBranch, 'feat/remote', 'the bare name stays the source (POST /api/run accepts it)');
  assert.deepEqual(remote.sourceRef, { ref: 'origin/feat/remote', remoteOnly: true, behind: 0 });
  assert.deepEqual(ok(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'behind' })).sourceRef, { ref: 'behind', remoteOnly: false, behind: 3 });
  assert.deepEqual(ok(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'offline' })).sourceRef,
    { ref: 'offline', remoteOnly: false, behind: 0, stale: true }, 'offline: never reject what may exist');
  assert.equal('sourceRef' in ok(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'uptodate' })), false);
  assert.deepEqual(errs(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'nowhere' })), [PROPOSAL_ERRORS.missingSource('nowhere', 'upstream')]);
  assert.equal(PROPOSAL_ERRORS.missingSource('nowhere', 'upstream'), 'sourceBranch "nowhere" exists neither locally nor on upstream');
});

test('#527 sourceBranch: never resolved for a failing card, a workspace, or without the reader', async () => {
  let n = 0;
  const v = createProposalValidator({ ...deps, resolveSourceRef: async () => { n += 1; return { ok: false, kind: 'missing' }; } }).validateProposal;
  errs(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'feat', guardrailsId: 'permissive' }));
  ok(await v({ workspaceId: 'wks-team-0000abcd', brief: 'x', sourceBranch: 'feat' }));
  assert.equal(n, 0);
  // The default is null: a fake-dir card is not resolved against git.
  assert.equal('sourceRef' in ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'main' })), false);
});

test('sameAsSource: a card carries it only when true; a non-boolean is an error', async () => {
  const on = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', sameAsSource: true }, { cardId: 'card_3f2a9c01' }));
  assert.equal(on.sameAsSource, true);
  const off = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x' }, { cardId: 'card_3f2a9c01' }));
  assert.equal('sameAsSource' in off, false, 'the pinned key set is unchanged');
  const bad = await validateProposal({ projectKey: 'demo-00000001', brief: 'x', sameAsSource: 'yes' }, { cardId: 'card_3f2a9c01' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.some((e) => /sameAsSource/.test(e)));
});

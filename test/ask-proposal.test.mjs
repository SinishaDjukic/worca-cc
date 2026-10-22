// P1/T11: server-side validation of propose_run (ask-worca-design.md §9.2) —
// exactly one target, real ids, guardrails default normal / permissive refused,
// syntactic branch checks, error strings matching POST /api/run where one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkRows } from './helpers/rows.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { ASK_LIMITS } from '../src/core/ask/limits.mjs';
import { createProposalValidator, isSyntacticRef, PROPOSAL_ERRORS, pickCardAttachments } from '../src/core/ask/proposal.mjs';
import { GRAPH_SHAPE_WORKFLOW, GRAPH_SHAPE_UX_WORKFLOW } from '../src/core/graph/builtin-workflows.mjs';

const dirA = mkdtempSync(join(tmpdir(), 'worca-ask-prop-a-'));
const dirB = mkdtempSync(join(tmpdir(), 'worca-ask-prop-b-'));
const existing = new Set([dirA, dirB, '/p/demo', '/p/notes']);
const folders = new Set(['/p/notes']);
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
        : id === 'wks-mixed-0000abcd'
          ? { id, name: 'Mixed', description: '', projectPaths: [dirA, '/p/notes'], projectKeys: ['alpha-00000001', 'notes-00000004'], exists: [true, true] }
          : null),
  readWorkflow: async (id) => (id === 'wf_default' ? { id, name: 'Default' } : id === 'wf_review' ? { id, name: 'Review only' }
    : id === 'wf_shape' || id === 'wf_shape_ux' ? { id, name: 'Shaper' }
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
  memberWorkMode: (p) => (folders.has(p) ? 'folder' : 'git'),
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

test('happy cards: project (every key, defaults, unique feature branch) and workspace (members sorted, overrides kept)', async () => {
  await checkRows([
    { name: 'happy project card: every key present, defaults applied, feature branch unique per card', run: async () => {
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
    } },
    { name: 'happy workspace card: members sorted by key (primary first), per-member overrides kept', run: async () => {
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
    } },
  ]);
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

test('tags (#718): normalised onto the card when given, no key when absent, refused when invalid', async () => {
  assert.deepEqual(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: ['Client: Acme'] })).tags, ['client:acme']);
  assert.equal(Object.hasOwn(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x' })), 'tags'), false);
  assert.equal(Object.hasOwn(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: [] })), 'tags'), false);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: ['client:'] })), ['tags: "client:" needs a value after the colon']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: 'client:acme' })), ['tags: tags must be a list of strings']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: ['hello world'] })),
    ['tags: "hello world": a tag is key:value, for example client:acme']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', tags: ['client'] })),
    ['tags: "client": a tag is key:value, for example client:acme']);
});

test('isSyntacticRef: git ref-format rules, no shell-outs', () => {
  for (const good of ['main', 'feature/x-1', 'release-2.0', 'v1.2.3', 'user/sub/branch', 'a'.repeat(255)]) assert.ok(isSyntacticRef(good), good);
  for (const bad of ['', '-x', 'a b', 'a..b', 'a/', '/a', 'a//b', '.hidden', 'a/.b', 'x.lock', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', 'a@{1}', 'a.', 'a'.repeat(256), 42, null]) {
    assert.ok(!isSyntacticRef(bad), JSON.stringify(bad));
  }
});

test('workflow-specific rules: a graph template is accepted, memoryScope only with wf_memory_defrag (never a workspace), Workspace scan refused', async () => {
  await checkRows([
    // After the v2 break the graph IS the engine: a v2 template is the normal case,
    // so proposing one must produce NO error (only an unknown/archived id refuses).
    { name: 'propose_run ACCEPTS a graph template', run: async () => {
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
    } },
    { name: 'memoryScope: only with wf_memory_defrag, never on a workspace; the card carries it (null otherwise)', run: async () => {
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
    } },
    { name: 'the Workspace scan workflow is refused: it starts only from Workspaces (D2)', run: async () => {
      const { validateProposal: v } = createProposalValidator({
        ...deps,
        assertRunnableWorkflow: async (id) => (id === 'wf_workspace_scan'
          ? { id, name: 'Workspace scan', version: 2, domain: 'shared', nodes: [], wires: [] }
          : deps.assertRunnableWorkflow(id)),
      });
      assert.deepEqual(errs(await v({ workspaceId: 'wks-team-0000abcd', brief: 'x', workflowId: 'wf_workspace_scan' })), [PROPOSAL_ERRORS.scanWorkflow]);
      assert.deepEqual(errs(await v({ projectKey: 'demo-00000001', brief: 'x', workflowId: 'wf_workspace_scan' })), [PROPOSAL_ERRORS.scanWorkflow]);
    } },
  ]);
});

const ROWS = [
  { id: 'att_00000001', threadId: 'ask_00000001', messageId: null, name: 'notes.md', bytes: 12, kind: 'text', mime: null, createdAt: 't' },
  { id: 'att_00000002', threadId: 'ask_00000001', messageId: null, name: 'shot.png', bytes: 3000, kind: 'image', mime: 'image/png', createdAt: 't' },
];

test('card attachments (known ids in model order, unknown/duplicate dropped) and note (flattened, clipped to 200)', async () => {
  await checkRows([
    { name: 'pickCardAttachments keeps known ids in the model\'s order, drops unknown/duplicate/non-string', run: () => {
      assert.deepEqual(pickCardAttachments(['att_00000002', 'att_ffffffff', 'att_00000001', 'att_00000002', 7], ROWS), [
        { id: 'att_00000002', name: 'shot.png', bytes: 3000, kind: 'image' },
        { id: 'att_00000001', name: 'notes.md', bytes: 12, kind: 'text' },
      ]);
      assert.deepEqual(pickCardAttachments(undefined, ROWS), []);
      assert.deepEqual(pickCardAttachments(['att_00000001'], null), []);
    } },
    { name: 'card carries note (flattened, clipped to 200) and attachments; both default empty', run: async () => {
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
    } },
  ]);
});

// ── #527: the source branch is resolved against the remote (injected resolveSourceRef) ──
test('#527 sourceBranch: remote-only/behind/stale annotate, missing names the remote; never resolved for a failing card, a workspace, or without the reader', async () => {
  await checkRows([
    { name: '#527 sourceBranch: remote-only / behind / stale annotate the card; missing is an error naming the remote', run: async () => {
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
    } },
    { name: '#527 sourceBranch: never resolved for a failing card, a workspace, or without the reader', run: async () => {
      let n = 0;
      const v = createProposalValidator({ ...deps, resolveSourceRef: async () => { n += 1; return { ok: false, kind: 'missing' }; } }).validateProposal;
      errs(await v({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'feat', guardrailsId: 'permissive' }));
      ok(await v({ workspaceId: 'wks-team-0000abcd', brief: 'x', sourceBranch: 'feat' }));
      assert.equal(n, 0);
      // The default is null: a fake-dir card is not resolved against git.
      assert.equal('sourceRef' in ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'main' })), false);
    } },
  ]);
});

// Engines: a card names one only when the proposal did; omitted, /api/run starts the user's default.
test('engine: omitted keeps the card shape, a known engine rides the card, an unknown one is refused', async () => {
  assert.equal('engine' in ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x' })), false);
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', engine: 'Codex ' })).engine, 'codex');
  assert.equal(ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', engine: 'claude' })).engine, 'claude');
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', brief: 'x', engine: 'gemini' })), [PROPOSAL_ERRORS.unknownEngine('gemini')]);
  assert.match(PROPOSAL_ERRORS.unknownEngine('gemini'), /one of claude, codex, copilot, cursor/);
});

test('the same featureBranch and sourceBranch without sameAsSource is an error that names the flag', async () => {
  const r = await validateProposal({ projectKey: 'demo-00000001', brief: 'x', sourceBranch: 'main', featureBranch: 'main' }, { cardId: 'card_3f2a9c01' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /sameAsSource/.test(e)), JSON.stringify(r.errors));
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

// Shape it first (spec D9): `shape` proposes wf_shape (wf_shape_ux with UX); `assess` nudges a plain card.
test('Shape it first: shape / slices / schedule refusal / the gate, and the assess nudge with its estimates', async () => {
  const on = (extra = {}) => createProposalValidator({ ...deps, shapeFirst: () => true, ...extra }).validateProposal;
  const off = createProposalValidator({ ...deps, shapeFirst: () => false }).validateProposal;
  const base = { projectKey: 'demo-00000001', brief: 'x' };
  const large = { size: 'large', openDecisions: [] };
  await checkRows([
    { name: 'gate on: shape → card shape and wf_shape; ux in perspectives → wf_shape_ux', run: async () => {
      const card = ok(await on()({ ...base, shape: {} }));
      assert.equal(card.workflowId, 'wf_shape');
      assert.deepEqual(card.shape, { perspectives: ['product', 'architect', 'qa'] });
      const ux = ok(await on()({ ...base, shape: { perspectives: ['product', 'ux'] } }));
      assert.equal(ux.workflowId, 'wf_shape_ux');
      assert.ok(ux.shape.perspectives.includes('ux'));
    } },
    { name: 'workflowId wf_shape_ux without perspectives keeps the UX variant (no shape, or shape {slices})', run: async () => {
      for (const extra of [{}, { shape: { slices: 'off' } }]) {
        const card = ok(await on()({ ...base, workflowId: 'wf_shape_ux', ...extra }));
        assert.equal(card.workflowId, 'wf_shape_ux', JSON.stringify(extra));
        assert.ok(card.shape.perspectives.includes('ux'), JSON.stringify(extra));
      }
    } },
    { name: 'gate off: workflowId wf_shape is refused (the slice-1 gap)', run: async () => {
      assert.deepEqual(errs(await off({ ...base, workflowId: 'wf_shape' })), ['workflow "wf_shape" is not available on this server']);
    } },
    { name: 'slices: "off" / "auto" ride the card; anything else refused', run: async () => {
      for (const slices of ['off', 'auto']) {
        const card = ok(await on()({ ...base, shape: { slices } }));
        assert.equal(card.shape.slices, slices);
        assert.equal(card.workflowId, 'wf_shape');
      }
      assert.deepEqual(errs(await on()({ ...base, shape: { slices: 'yes' } })), [PROPOSAL_ERRORS.shapeSlices]);
    } },
    { name: 'a shaped proposal carries assess.size on card.shape; without assess or on a bad size there is none', run: async () => {
      const card = ok(await on()({ ...base, shape: {}, assess: large }));
      assert.equal(card.shape.size, 'large');
      assert.equal('size' in ok(await on()({ ...base, shape: {} })).shape, false);
      assert.equal('size' in ok(await on()({ ...base, shape: {}, assess: { size: 'huge', openDecisions: [] } })).shape, false);
      const both = ok(await on()({ ...base, shape: { slices: 'off' }, assess: { size: 'medium', openDecisions: [] } }));
      assert.deepEqual([both.shape.slices, both.shape.size], ['off', 'medium']);
    } },
    { name: 'shape + when is refused: a shaped run waits for the user', run: async () => {
      assert.deepEqual(errs(await on()({ ...base, shape: {}, when: '+90m' })), [PROPOSAL_ERRORS.shapeScheduled]);
    } },
    { name: 'shape + workflowId wf_default is refused', run: async () => {
      assert.deepEqual(errs(await on()({ ...base, shape: {}, workflowId: 'wf_default' })),
        ['a shaped run uses the Shaper workflow (wf_shape), not "wf_default"']);
    } },
    { name: 'gate off: shape refused, assess ignored (no nudge)', run: async () => {
      assert.deepEqual(errs(await off({ ...base, shape: {} })), ['shape is not available on this server']);
      const card = ok(await off({ ...base, assess: large }));
      assert.equal('nudge' in card, false);
    } },
    { name: 'assess large → card nudge with the injected estimates; a throwing estimate → nulls', run: async () => {
      const est = { asIs: { costUsd: 1, minutes: 5, samples: 3 }, shaped: { costUsd: 2, minutes: 9, samples: 3 } };
      const card = ok(await on({ estimate: async () => est })({ ...base, assess: large }));
      assert.equal(card.nudge.reason, 'large');
      assert.deepEqual(card.nudge.estimates, est);
      assert.equal(card.nudge.asIsAuto, false);
      assert.equal('shape' in card, false);
      const thrown = ok(await on({ estimate: async () => { throw new Error('no history'); } })({ ...base, assess: large }));
      assert.deepEqual(thrown.nudge.estimates, { asIs: null, shaped: null });
    } },
    { name: 'assess.perspectives with ux → the estimate is asked for GRAPH_SHAPE_UX_WORKFLOW; otherwise GRAPH_SHAPE_WORKFLOW', run: async () => {
      const seen = [];
      const v = on({ estimate: async (wfs) => { seen.push(wfs); return null; } });
      ok(await v({ ...base, assess: { ...large, perspectives: ['product', 'ux'] } }));
      ok(await v({ ...base, assess: large }));
      assert.equal(seen[0].shaped, GRAPH_SHAPE_UX_WORKFLOW);
      assert.equal(seen[1].shaped, GRAPH_SHAPE_WORKFLOW);
      assert.equal(seen[1].asIs.id, 'wf_default');
    } },
    { name: 'no nudge for a scheduled card, nor for a failing one', run: async () => {
      let n = 0;
      const v = on({ estimate: async () => { n += 1; return null; } });
      assert.equal('nudge' in ok(await v({ ...base, assess: large, when: '+90m' })), false);
      errs(await v({ ...base, assess: large, guardrailsId: 'permissive' }));
      assert.equal(n, 0);
    } },
    { name: 'shape: null is absent: a plain run card, no error', run: async () => {
      const card = ok(await on()({ ...base, shape: null }));
      assert.equal(card.workflowId, 'wf_default');
      assert.equal('shape' in card, false);
    } },
    { name: 'the pinned key set is unchanged without shape / assess (gate on)', run: async () => {
      const card = ok(await on()(base));
      assert.deepEqual(Object.keys(card).sort(), ['attachments', 'brief', 'featureBranch', 'guardrailsId', 'members', 'memoryScope', 'note', 'projectDir', 'projectKey', 'projectName',
        'sourceBranch', 'sourceBranchByKey', 'target', 'title', 'workflowId', 'workflowName', 'workspaceId', 'workspaceName']);
    } },
  ]);
});

test('P3 noProject: a card with no project keeps the pinned key set; its refusals', async () => {
  const card = ok(await validateProposal({ noProject: true, brief: 'A deck on Q3 hiring' }, { cardId: 'card_3f2a9c01' }));
  assert.deepEqual(Object.keys(card).sort(), ['attachments', 'brief', 'featureBranch', 'guardrailsId', 'members', 'memoryScope', 'note', 'projectDir', 'projectKey', 'projectName',
    'sourceBranch', 'sourceBranchByKey', 'target', 'title', 'workflowId', 'workflowName', 'workspaceId', 'workspaceName']);
  assert.equal(card.target, 'none');
  assert.deepEqual([card.projectKey, card.projectDir, card.featureBranch, card.sourceBranch], [null, null, null, null]);
  assert.deepEqual([card.projectName, card.workspaceId, card.workspaceName, card.members, card.sourceBranchByKey], [null, null, null, null, null]);
  assert.equal(card.workflowId, 'wf_default');
  const ignored = ok(await validateProposal({ noProject: true, brief: 'x', sourceBranch: 'main', featureBranch: 'feat/x', sameAsSource: true }));
  assert.deepEqual([ignored.sourceBranch, ignored.featureBranch, 'sameAsSource' in ignored], [null, null, false], 'branch fields are ignored, as POST /api/run does');
  assert.deepEqual(errs(await validateProposal({ noProject: true, projectKey: 'demo-00000001', brief: 'x' })), ['provide one of projectKey, workspaceId or noProject']);
  assert.deepEqual(errs(await validateProposal({ noProject: true, workspaceId: 'wks-team-0000abcd', brief: 'x' })), ['provide one of projectKey, workspaceId or noProject']);
  assert.deepEqual(errs(await validateProposal({ projectKey: 'demo-00000001', workspaceId: 'wks-team-0000abcd', brief: 'x' })), [PROPOSAL_ERRORS.bothTargets], 'key + workspace keeps its text');
  assert.deepEqual(errs(await validateProposal({ noProject: 'yes', brief: 'x' })), ['noProject must be true']);
  assert.deepEqual(errs(await validateProposal({ noProject: false, brief: 'x' })), [PROPOSAL_ERRORS.noTarget], 'false is "not given"');
  for (const extra of [{ when: 'tomorrow 02:00' }, { every: 'day 03:30' }, { after: 'abcd1234' }, { after: 'abcd1234', sourceFromPrevious: true }]) {
    assert.ok(errs(await validateProposal({ noProject: true, brief: 'x', ...extra })).includes('a run without a project cannot be scheduled yet'), JSON.stringify(extra));
  }
  assert.ok(errs(await validateProposal({ noProject: true, brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'project' })).includes('memoryScope needs a project'));
  assert.equal(ok(await validateProposal({ noProject: true, brief: 'x', workflowId: 'wf_memory_defrag', memoryScope: 'global' })).memoryScope, 'global', 'U13: Memory defragment runs on global memory with no project');
  const on = createProposalValidator({ ...deps, shapeFirst: () => true }).validateProposal;
  const plain = ok(await on({ noProject: true, brief: 'x', shape: {} }));
  assert.deepEqual([plain.target, plain.workflowId, plain.shape.slices], ['none', 'wf_shape', 'off'], 'U13: with no project a shaped run is never sliced');
  assert.ok(errs(await on({ noProject: true, brief: 'x', shape: { slices: 'auto' } })).includes('a run without a project cannot be planned in slices yet'));
  const shaped = ok(await on({ noProject: true, brief: 'x', shape: { slices: 'off' } }));
  assert.deepEqual([shaped.target, shaped.workflowId, shaped.shape.slices], ['none', 'wf_shape', 'off']);
  assert.equal(ok(await on({ noProject: true, brief: 'x', assess: { size: 'large', openDecisions: [] } })).nudge, undefined,
    'no Shape-it-first nudge: its shaped run would be sliced');
});

test('workspace target: a Folder member is accepted (not a git repo), named folder on the card; a source branch for it is refused', async () => {
  const card = ok(await validateProposal({ workspaceId: 'wks-mixed-0000abcd', brief: 'x' }));
  assert.deepEqual(card.members.map((m) => [m.projectKey, m.workMode ?? null]), [['alpha-00000001', null], ['notes-00000004', 'folder']]);
  assert.deepEqual(errs(await validateProposal({ workspaceId: 'wks-mixed-0000abcd', brief: 'x', sourceBranchByKey: { 'notes-00000004': 'main' } })),
    ['sourceBranchByKey: notes-00000004 is a Folder project and has no branches']);
});

test('workspace target with git missing: a Git member runs on a copy — its sourceBranchByKey entry is ignored, never called "a Folder project"', async (t) => {
  const { withNoGit } = await import('./helpers/git-off.mjs');
  withNoGit(t);
  const { validateProposal: v } = createProposalValidator({ ...deps, memberWorkMode: () => 'folder' });   // git missing: every member is a copy (U3)
  const card = ok(await v({ workspaceId: 'wks-mixed-0000abcd', brief: 'x', sourceBranchByKey: { 'alpha-00000001': 'main' } }));
  assert.equal(card.sourceBranchByKey, null);
});

test('smart naming on: a derived branch uses the pattern and the card hex, and is marked; a given branch is not', async () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = 'smartRunNaming';
  try {
    const card = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'Add a README badge' }, { cardId: 'card_3f2a9c01' }));
    assert.equal(card.featureBranch, 'feat/add-a-readme-badge');
    assert.equal(card.featureBranchDerived, true);
    const given = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'Add a README badge', featureBranch: 'fix/typed' }, { cardId: 'card_3f2a9c01' }));
    assert.equal(given.featureBranch, 'fix/typed');
    assert.equal('featureBranchDerived' in given, false);
  } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
});

test('smart naming off: the card carries no marker and keeps today\'s name', async () => {
  const prev = process.env.WORCA_FLAGS;
  process.env.WORCA_FLAGS = '-smartRunNaming';
  try {
    const card = ok(await validateProposal({ projectKey: 'demo-00000001', brief: 'Add a README badge' }, { cardId: 'card_3f2a9c01' }));
    assert.match(card.featureBranch, /^worca-cc\/.+-3f2a9c01$/);
    assert.equal('featureBranchDerived' in card, false);
  } finally { if (prev === undefined) delete process.env.WORCA_FLAGS; else process.env.WORCA_FLAGS = prev; }
});

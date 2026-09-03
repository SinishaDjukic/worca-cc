import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { planExport, applyExport } from '../src/core/workflow-export.mjs';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeKeyGraph } from './helpers/export-fixtures.mjs';

useTempHome(after);

const dirs = [];
const tmp = async () => { const d = await mkdtemp(join(tmpdir(), 'wf-exp-cf-')); dirs.push(d); return d; };
after(async () => { await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// REGRESSION GUARD for the critical stamp round-trip fix: if STAMP_RE is not the exact
// inverse of the insert padding, every re-read hash drifts and this reports conflicts, not no-ops.
test('re-export of an unchanged workflow is an all-no-op (guards the stamp round-trip)', async () => {
  const dest = await tmp();
  const a = { workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' };
  await applyExport(a);
  const plan = await planExport(a);
  assert.equal(plan.created.length, 0);
  assert.equal(plan.updated.length, 0);
  assert.equal(plan.conflicts.length, 0, 'a stamp-newline drift would surface every file as a conflict');
  assert.ok(plan.noop.length > 0);
  // Belt-and-suspenders: the re-read stampless hash of an emitted agent equals its stored stamp hash.
  const md = await readFile(join(dest, '.claude/agents/worca-cc-planner.md'), 'utf8');
  const stripped = md.replace(/<!--\s*worca-cc-export:\n[\s\S]*?\n-->\n\n/, '');
  const stampHash = md.match(/contentHash:\s*(sha256:[0-9a-f]+)/)[1];
  assert.equal('sha256:' + createHash('sha256').update(stripped, 'utf8').digest('hex'), stampHash);
});

test('a hand-written (unstamped) target is a conflict, not overwritten by default', async () => {
  const dest = await tmp();
  await mkdir(join(dest, '.claude/skills/default'), { recursive: true });
  await writeFile(join(dest, '.claude/skills/default/SKILL.md'), '---\nname: default\n---\nforeign\n', 'utf8');
  const plan = await planExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest });
  const skillConflict = plan.conflicts.find((c) => c.path.endsWith(join('skills', 'default', 'SKILL.md')));
  assert.ok(skillConflict, 'unstamped SKILL.md must be a conflict');
  assert.match(skillConflict.reason, /unmanaged file/);
});

test('dry-run/Plan writes nothing', async () => {
  const dest = await tmp();
  await planExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest });
  assert.equal(existsSync(join(dest, '.claude')), false);
});

test('same key diverging across two workflows → conflict; per-path namespace yields <slug>-<stem>.md matching SKILL dispatch', async () => {
  const dest = await tmp();
  const wfA = await writeKeyGraph({ name: 'Alpha', keys: [{ key: 'planner', config: { model: 'opus' } }, 'implementer', 'reviewer'] });
  const wfB = await writeKeyGraph({ name: 'Beta', keys: [{ key: 'planner', config: { model: 'sonnet' } }, 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wfA.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });

  const plannerDefault = join(dest, '.claude/agents/worca-cc-planner.md');
  const planB = await planExport({ workflowId: wfB.id, destination: 'project', projectDir: dest });
  const conflict = planB.conflicts.find((c) => c.path === plannerDefault);
  assert.ok(conflict, 'diverging planner must conflict');
  assert.ok(conflict.options.includes('namespace'));

  await applyExport({ workflowId: wfB.id, destination: 'project', projectDir: dest, resolutions: { [plannerDefault]: 'namespace' } });
  const nsPath = join(dest, '.claude/agents/beta-worca-cc-planner.md');
  assert.ok(existsSync(nsPath), 'namespaced agent written');
  const nsMd = await readFile(nsPath, 'utf8');
  assert.match(nsMd, /^name: beta-worca-cc-planner$/m);
  // SKILL.md for B dispatches the namespaced name.
  const skillB = await readFile(join(dest, '.claude/skills/beta/SKILL.md'), 'utf8');
  assert.match(skillB, /Dispatch `beta-worca-cc-planner`/);
  // Original default-path file is untouched (still Alpha's opus content).
  const plannerA = await readFile(plannerDefault, 'utf8');
  assert.match(plannerA, /^model: opus$/m);
});

// REGRESSION GUARD for the blanket-namespace fix.
test('blanket --on-conflict=namespace writes <slug>-<stem>.md for the conflicted key and keeps the original', async () => {
  const dest = await tmp();
  const wfA = await writeKeyGraph({ name: 'Alpha2', keys: [{ key: 'planner', config: { model: 'opus' } }, 'implementer', 'reviewer'] });
  const wfB = await writeKeyGraph({ name: 'Beta2', keys: [{ key: 'planner', config: { model: 'sonnet' } }, 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wfA.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const applied = await applyExport({ workflowId: wfB.id, destination: 'project', projectDir: dest, onConflict: 'namespace' });

  const nsPath = join(dest, '.claude/agents/beta2-worca-cc-planner.md');
  assert.ok(existsSync(nsPath), 'conflicted planner is namespaced');
  assert.ok(applied.written.includes(nsPath));
  const skillB = await readFile(join(dest, '.claude/skills/beta2/SKILL.md'), 'utf8');
  assert.match(skillB, /Dispatch `beta2-worca-cc-planner`/);
  // Clean (non-conflicting) keys are NOT namespaced.
  assert.equal(existsSync(join(dest, '.claude/agents/beta2-worca-cc-implementer.md')), false);
  assert.match(skillB, /Dispatch `worca-cc-implementer`/);
  // Original default-path planner unchanged (Alpha's opus).
  assert.match(await readFile(join(dest, '.claude/agents/worca-cc-planner.md'), 'utf8'), /^model: opus$/m);
  // A second identical namespace export is an all-no-op.
  const plan2 = await planExport({ workflowId: wfB.id, destination: 'project', projectDir: dest });
  // (planExport uses plain stems, so the default planner still shows as a conflict; the namespaced
  //  file itself is a no-op — assert no NEW writes happen on a blanket re-apply.)
  const applied2 = await applyExport({ workflowId: wfB.id, destination: 'project', projectDir: dest, onConflict: 'namespace' });
  assert.equal(applied2.written.length, 0, 'a second identical namespace export writes nothing');
  assert.ok(
    plan2.conflicts.some((c) => c.path.endsWith(join(sep, 'agents', 'worca-cc-planner.md'))),
    'plain-stem plan still flags the default planner (Alpha2 lineage) as a conflict',
  );
});

// REGRESSION GUARD (#1): the core write loop must FAIL CLOSED. An unrecognized per-path
// resolution (e.g. the typo "Overwrite") must never fall through to a silent clobber.
test('an unrecognized per-path resolution is skipped, never overwritten (fail closed)', async () => {
  const dest = await tmp();
  const skillPath = join(dest, '.claude/skills/default/SKILL.md');
  await mkdir(join(dest, '.claude/skills/default'), { recursive: true });
  const foreign = '---\nname: default\n---\nHAND EDITED — DO NOT CLOBBER\n';
  await writeFile(skillPath, foreign, 'utf8');
  const applied = await applyExport({
    workflowId: 'wf_default', destination: 'project', projectDir: dest,
    resolutions: { [skillPath]: 'Overwrite' },   // capital-O typo: not a valid choice
  });
  assert.equal(await readFile(skillPath, 'utf8'), foreign, 'the hand-edited file is untouched');
  assert.ok(applied.skipped.includes(skillPath));
  assert.equal(applied.written.includes(skillPath), false);
});

// REGRESSION GUARD (#2): blanket namespace cannot resolve a non-namespaceable slug collision.
// It must REFUSE before writing, not keep a stale SKILL.md while emitting orphan agents.
test('blanket namespace refuses a slug/skill collision instead of a broken export', async () => {
  const dest = await tmp();
  const wfA = await writeKeyGraph({ name: 'AlphaNS', keys: ['planner', 'implementer', 'reviewer'] });
  const wfB = await writeKeyGraph({ name: 'BetaNS', keys: ['planner', 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wfA.id, destination: 'project', projectDir: dest, slug: 'shared', onConflict: 'overwrite' });
  await assert.rejects(
    applyExport({ workflowId: wfB.id, destination: 'project', projectDir: dest, slug: 'shared', onConflict: 'namespace' }),
    (e) => e.code === 'CONFLICT' && /--slug/.test(e.message),
  );
  // Refusal happens BEFORE any write: SKILL.md is still Alpha's, no orphan namespaced agent.
  assert.match(await readFile(join(dest, '.claude/skills/shared/SKILL.md'), 'utf8'), /AlphaNS/);
  assert.equal(existsSync(join(dest, '.claude/agents/shared-worca-cc-planner.md')), false);
});

// REGRESSION GUARD (#3): per-path namespacing an agent while KEEPING a conflicting SKILL.md is a
// broken export (the kept skill dispatches old plain names, orphaning the renamed agent). Refuse
// before writing anything.
test('per-path namespace + kept SKILL.md conflict is refused (no broken export)', async () => {
  const dest = await tmp();
  const wfA = await writeKeyGraph({ name: 'Alpha3', keys: ['planner', 'implementer', 'reviewer'] });
  const wfB = await writeKeyGraph({ name: 'Beta3', keys: ['planner', 'implementer', 'reviewer'] });
  // Same slug → SKILL.md AND planner both conflict when B is exported over A.
  await applyExport({ workflowId: wfA.id, destination: 'project', projectDir: dest, slug: 'shared', onConflict: 'overwrite' });
  const skillPath = join(dest, '.claude/skills/shared/SKILL.md');
  const plannerPath = join(dest, '.claude/agents/worca-cc-planner.md');
  await assert.rejects(
    applyExport({
      workflowId: wfB.id, destination: 'project', projectDir: dest, slug: 'shared',
      resolutions: { [plannerPath]: 'namespace', [skillPath]: 'keep' },
    }),
    (e) => e.code === 'CONFLICT' && /orphaning the namespaced agents/.test(e.message),
  );
  // Refusal is BEFORE any write: SKILL.md is still Alpha3's; no orphan namespaced agent.
  assert.match(await readFile(skillPath, 'utf8'), /Alpha3/);
  assert.equal(existsSync(join(dest, '.claude/agents/shared-worca-cc-planner.md')), false);
});

// REGRESSION GUARD (#7): a 'cancel' resolution aborts the WHOLE export (nothing written), it is
// not a per-file skip.
test("a 'cancel' resolution aborts the export, writing nothing", async () => {
  const dest = await tmp();
  const skillPath = join(dest, '.claude/skills/default/SKILL.md');
  await mkdir(join(dest, '.claude/skills/default'), { recursive: true });
  await writeFile(skillPath, '---\nname: default\n---\nforeign\n', 'utf8');   // make SKILL.md a conflict
  await assert.rejects(
    applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, resolutions: { [skillPath]: 'cancel' } }),
    (e) => e.code === 'CANCELLED' && /cancelled/.test(e.message),
  );
  // Abort is total: no agents dir was created either.
  assert.equal(existsSync(join(dest, '.claude/agents')), false, 'nothing written on cancel');
});

// REGRESSION GUARD: a per-path 'namespace' resolution on the non-namespaceable SKILL.md (its
// offered options never include 'namespace') must be REFUSED, not silently skipped — otherwise
// applyExport reports success while leaving the conflicting SKILL.md stale on disk.
test("a 'namespace' resolution on the non-namespaceable SKILL.md is refused", async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const skillPath = join(dest, '.claude/skills/default/SKILL.md');
  await writeFile(skillPath, (await readFile(skillPath, 'utf8')) + '\nLOCAL EDIT\n', 'utf8');   // make it a conflict
  await assert.rejects(
    applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, resolutions: { [skillPath]: 'namespace' } }),
    (e) => e.code === 'BAD_REQUEST' && /not valid for/.test(e.message) && /namespaced/.test(e.message),
  );
  // The conflicting SKILL.md is left exactly as the user had it (refusal is before any write).
  assert.match(await readFile(skillPath, 'utf8'), /LOCAL EDIT/);
});

// REGRESSION GUARD (#8): after per-path namespacing a stem, the stale PLAIN file left at the
// default path is reported as an orphan (matching on the emitted filename, not the bare stem).
test('a stale plain agent left after namespacing is reported as an orphan', async () => {
  const dest = await tmp();
  const wf = await writeKeyGraph({ name: 'Orphan8', keys: ['planner', 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'orphan8', onConflict: 'overwrite' });
  const plannerPath = join(dest, '.claude/agents/worca-cc-planner.md');
  // Locally edit the planner so the next export classifies it as a conflict we can resolve.
  await writeFile(plannerPath, (await readFile(plannerPath, 'utf8')) + '\nLOCAL EDIT\n', 'utf8');
  const res = await applyExport({
    workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'orphan8',
    resolutions: { [plannerPath]: 'namespace' },
  });
  assert.ok(res.written.some((p) => p.endsWith('orphan8-worca-cc-planner.md')), 'namespaced agent written');
  assert.ok(res.orphans.some((p) => p.endsWith(join(sep, 'agents', 'worca-cc-planner.md'))), 'stale plain planner reported as orphan');
});

// REGRESSION GUARD (#4): the built-in wf_default (version pinned to 1, updatedAt frozen at
// epoch) must re-export cleanly after a generator change — an UPDATE, not a perpetual CONFLICT.
test('wf_default re-exports cleanly after a generator change (update, not conflict)', async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  // Simulate a PRIOR export by an older generator: same lineage/version/updatedAt, different
  // body, still a valid UNMODIFIED stamp (currentHash === stamp.contentHash).
  const skillPath = join(dest, '.claude/skills/default/SKILL.md');
  const stampless = '---\nname: default\n---\nOLD GENERATOR OUTPUT\n';
  const hash = 'sha256:' + createHash('sha256').update(stampless, 'utf8').digest('hex');
  const faked =
    '---\nname: default\n---\n' +
    '<!-- worca-cc-export:\nkey: skill:default\nworkflow: wf_default\nversion: 1\n' +
    `updatedAt: 1970-01-01T00:00:00.000Z\ncontentHash: ${hash}\n-->\n\n` +
    'OLD GENERATOR OUTPUT\n';
  await writeFile(skillPath, faked, 'utf8');
  const plan = await planExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest });
  assert.ok(plan.updated.includes(skillPath), 'stale-but-managed wf_default SKILL.md updates cleanly');
  assert.equal(plan.conflicts.some((c) => c.path === skillPath), false, 'not a conflict');
});

// REGRESSION GUARD (#5): a workflow name carrying String.replace $-sequences must be inserted
// literally when the stamp is spliced in after the frontmatter.
test('$-sequences in a workflow name are inserted literally (no $-injection)', async () => {
  const dest = await tmp();
  const evil = "Pay $& then $' now";
  const wf = await writeKeyGraph({ name: evil, keys: ['planner', 'implementer', 'reviewer'] });
  const skillPath = join(dest, '.claude/skills/dollar-test/SKILL.md');
  await applyExport({ workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'dollar-test', onConflict: 'overwrite' });
  assert.ok((await readFile(skillPath, 'utf8')).includes(evil), 'name with $&/$\' appears verbatim');
  // and the stamp round-trip still holds around the $ content
  const plan = await planExport({ workflowId: wf.id, destination: 'project', projectDir: dest, slug: 'dollar-test' });
  assert.equal(plan.conflicts.length, 0);
  assert.ok(plan.noop.includes(skillPath));
});

// Version is immutable at the store layer (v2 rows are always version=2), so the
// "auto-update stamped files" path is exercised via the updatedAt secondary tiebreak that
// classify also implements (see DEVIATIONS.md).
test('content change + advanced updatedAt auto-updates stamped files (STORED workflow fixture)', async () => {
  const dest = await tmp();
  const wf = await writeKeyGraph({ name: 'Bumpable', keys: [{ key: 'planner', config: { model: 'opus' } }, 'implementer', 'reviewer'] });
  await applyExport({ workflowId: wf.id, destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  await sleep(10); // guarantee a strictly-greater updatedAt on re-save
  await writeKeyGraph({ id: wf.id, name: 'Bumpable', createdAt: wf.createdAt,
    keys: [{ key: 'planner', config: { model: 'sonnet' } }, 'implementer', 'reviewer'] });
  const plan = await planExport({ workflowId: wf.id, destination: 'project', projectDir: dest });
  assert.ok(plan.updated.some((p) => p.endsWith(join('agents', 'worca-cc-planner.md'))), 'planner md auto-updates');
  assert.equal(plan.conflicts.length, 0);
});

// REGRESSION GUARD: a conflict the caller RESOLVED with 'keep' must NOT be echoed back in the
// returned `conflicts` — otherwise the UI (which treats every returned-but-unwritten conflict as
// "still needs resolving") loops forever on a keep it already honored. The file is left untouched.
test("a 'keep'-resolved conflict is not reported as outstanding (no apply loop)", async () => {
  const dest = await tmp();
  await applyExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest, onConflict: 'overwrite' });
  const plannerPath = join(dest, '.claude/agents/worca-cc-planner.md');
  const edited = (await readFile(plannerPath, 'utf8')) + '\nLOCAL EDIT\n';
  await writeFile(plannerPath, edited, 'utf8');   // make the planner a conflict
  const res = await applyExport({
    workflowId: 'wf_default', destination: 'project', projectDir: dest,
    resolutions: { [plannerPath]: 'keep' },
  });
  assert.equal(res.conflicts.some((c) => c.path === plannerPath), false, 'kept conflict is resolved, not outstanding');
  assert.ok(res.skipped.includes(plannerPath), 'kept file is skipped (not written)');
  assert.equal(res.written.includes(plannerPath), false);
  assert.match(await readFile(plannerPath, 'utf8'), /LOCAL EDIT/, 'kept file left exactly as the user had it');
});

// REGRESSION GUARD: 'cancel' is a whole-export abort, never a per-file choice, so it must NOT be
// offered as a per-conflict option (a per-file radio would misrepresent its semantics). 'keep' and
// 'overwrite' are always offered; 'namespace' only for a namespaceable target.
test("classify never offers 'cancel' as a per-conflict option", async () => {
  const dest = await tmp();
  await mkdir(join(dest, '.claude/skills/default'), { recursive: true });
  await writeFile(join(dest, '.claude/skills/default/SKILL.md'), '---\nname: default\n---\nforeign\n', 'utf8');
  const plan = await planExport({ workflowId: 'wf_default', destination: 'project', projectDir: dest });
  assert.ok(plan.conflicts.length > 0, 'the unstamped SKILL.md is a conflict');
  for (const cf of plan.conflicts) {
    assert.equal(cf.options.includes('cancel'), false, `'cancel' must not be a per-conflict option for ${cf.path}`);
    assert.ok(cf.options.includes('keep') && cf.options.includes('overwrite'), 'keep + overwrite always offered');
  }
});

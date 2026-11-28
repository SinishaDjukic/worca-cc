// test/run-landings.test.mjs — what a finished run hands to worca's stores.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after, 'landings-');
const { landRunArtifacts } = await import('../src/core/run-landings.mjs');

const PROFILE = { version: 1, summary: 's', phase: 'baseline' };
function runDir(files) {
  const d = mkdtempSync(join(tmpdir(), 'run-'));
  for (const [rel, body] of Object.entries(files)) writeFileSync(join(d, rel), typeof body === 'string' ? body : JSON.stringify(body));
  return d;
}
const depsWith = (rows, written) => ({
  listRunArtifacts: async (_id, { kind }) => rows.filter((r) => r.kind === kind),
  writeProjectProfile: (key, p, o) => { written.push({ key, p, o }); return p; },
  landSkills: async () => ({ landed: [], skipped: [] }),
});

test('case 1: the newest profile artifact lands under the run project key', async () => {
  const dir = runDir({ 'a.json': { ...PROFILE, summary: 'old' }, 'b.json': { ...PROFILE, summary: 'new', phase: 'final' } });
  const written = [];
  const rows = [{ kind: 'project-profile', relPath: 'a.json' }, { kind: 'project-profile', relPath: 'b.json' }];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r1', members: [{ projectKey: 'k1', projectName: 'one' }], isWorkspace: false, deps: depsWith(rows, written) });
  assert.equal(written.length, 1);
  assert.equal(written[0].key, 'k1');
  assert.equal(written[0].p.summary, 'new');
  assert.deepEqual(r.landed, ['profile: one']);
});

test('case 2: no artifact, nothing lands', async () => {
  const written = [];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: runDir({}), runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false, deps: depsWith([], written) });
  assert.deepEqual(written, []);
  assert.deepEqual(r, { landed: [], skipped: [] });
});

test('case 3: an unreadable or invalid profile is skipped with a reason, never thrown', async () => {
  const dir = runDir({ 'bad.json': '{not json' });
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false, deps: depsWith([{ kind: 'project-profile', relPath: 'bad.json' }], []) });
  assert.equal(r.landed.length, 0);
  assert.match(r.skipped[0], /^profile: /);
});

test('case 4: a workspace profile lands per known member; an unknown member key is skipped', async () => {
  const dir = runDir({ 'w.json': { members: { api: PROFILE, ghost: PROFILE } } });
  const written = [];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', isWorkspace: true,
    members: [{ projectKey: 'api', projectName: 'api' }], deps: depsWith([{ kind: 'project-profile', relPath: 'w.json' }], written) });
  assert.deepEqual(written.map((w) => w.key), ['api']);
  assert.ok(r.skipped.some((s) => /ghost/.test(s)));
});

test('a relPath that escapes the run dir is refused', async () => {
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: runDir({}), runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false,
    deps: depsWith([{ kind: 'project-profile', relPath: '../../etc/passwd' }], []) });
  assert.match(r.skipped[0], /outside the run/);
});

test('case 5: a run stopped at the plan card lands the profile only', async () => {
  const dir = runDir({ 'p.json': PROFILE });
  const written = [];
  const deps = { ...depsWith([{ kind: 'project-profile', relPath: 'p.json' }], written), landSkills: async () => { throw new Error('landSkills must not run'); } };
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false, deps });
  assert.equal(written.length, 1);
  assert.deepEqual(r.landed, ['profile: n']);
});

test('case 6: workspace skills land per member', async () => {
  const dir = runDir({ 's.json': { members: { api: { skills: [{ name: 'add-route', dir: 'x' }] } } },
    'plan.json': { tasks: [{ id: 'api/add-route', target: 'worca' }] } });
  const calls = [];
  const deps = { ...depsWith([{ kind: 'project-skills', relPath: 's.json' }, { kind: 'readiness-plan', relPath: 'plan.json' }], []), landSkills: async (a) => { calls.push(a); return { landed: ['skill add-route'], skipped: [] }; } };
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', isWorkspace: true, members: [{ projectKey: 'api', projectName: 'api' }], deps });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].projectKey, 'api');
  assert.deepEqual(r.landed, ['skill add-route']);
});

test('fix round: the run id reaches the writer', async () => {
  const dir = runDir({ 'a.json': PROFILE });
  const written = [];
  await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r1', members: [{ projectKey: 'k1', projectName: 'one' }], isWorkspace: false, deps: depsWith([{ kind: 'project-profile', relPath: 'a.json' }], written) });
  assert.equal(written[0].o.runId, 'r1');
});

test('fix round: a workspace artifact with members null is skipped without throwing', async () => {
  const dir = runDir({ 'w.json': { members: null } });
  const written = [];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', isWorkspace: true, members: [{ projectKey: 'api', projectName: 'api' }], deps: depsWith([{ kind: 'project-profile', relPath: 'w.json' }], written) });
  assert.deepEqual(written, []);
  assert.deepEqual(r.landed, []);
});

test('fix round: an oversized artifact is skipped', async () => {
  const dir = runDir({ 'big.json': JSON.stringify({ ...PROFILE, pad: 'x'.repeat(1100 * 1024) }) });
  const written = [];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', isWorkspace: false, members: [{ projectKey: 'k', projectName: 'n' }], deps: depsWith([{ kind: 'project-profile', relPath: 'big.json' }], written) });
  assert.deepEqual(written, []);
  assert.match(r.skipped[0], /larger than 1 MiB/);
});

test('fix round: a symlink to a file outside the run dir is refused', async () => {
  const dir = runDir({});
  const outside = runDir({ 'o.json': PROFILE });
  symlinkSync(join(outside, 'o.json'), join(dir, 'link.json'));
  const written = [];
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', isWorkspace: false, members: [{ projectKey: 'k', projectName: 'n' }], deps: depsWith([{ kind: 'project-profile', relPath: 'link.json' }], written) });
  assert.deepEqual(written, []);
  assert.match(r.skipped[0], /outside the run/);
});

test('only skills the plan card sent to worca land; the rest are skipped with a reason', async () => {
  const dir = runDir({ 's.json': { skills: [{ name: 'add-route', dir: 'a' }, { name: 'sneaky', dir: 'b' }, { name: 'in-repo', dir: 'c' }] },
    'plan.json': { tasks: [{ id: 'add-route', target: 'worca' }, { id: 'in-repo', target: 'repo' }] } });
  const calls = [];
  const deps = { ...depsWith([{ kind: 'project-skills', relPath: 's.json' }, { kind: 'readiness-plan', relPath: 'plan.json' }], []),
    landSkills: async (a) => { calls.push(a); return { landed: a.skills.map((x) => `skill ${x.name}`), skipped: [] }; } };
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false, deps });
  assert.deepEqual(calls[0].skills.map((x) => x.name), ['add-route']);
  assert.ok(r.skipped.some((x) => /sneaky.*not sent to worca on the plan card/.test(x)));
  assert.ok(r.skipped.some((x) => /in-repo.*not sent to worca on the plan card/.test(x)));
});

test('no readable plan card: no skill lands', async () => {
  const dir = runDir({ 's.json': { skills: [{ name: 'add-route', dir: 'a' }] } });
  const deps = { ...depsWith([{ kind: 'project-skills', relPath: 's.json' }], []), landSkills: async () => { throw new Error('landSkills must not run'); } };
  const r = await landRunArtifacts({ pipelineId: 'p', pipelineDir: dir, runId: 'r', members: [{ projectKey: 'k', projectName: 'n' }], isWorkspace: false, deps });
  assert.deepEqual(r.landed, []);
  assert.ok(r.skipped.some((x) => /skills: no plan card/.test(x)));
});

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { useTempHome } from './helpers/temp-home.mjs';
import { runScriptExecution } from '../src/core/graph/script-runner.mjs';
import { normalizeScriptMeta, validateScriptMetaV2 } from '../src/shared/graph/script-meta.mjs';
import { projectKey } from '../src/core/store.mjs';
import { writeProjectSettings } from '../src/core/settings-cascade.mjs';

delete process.env.WORCA_MOCK; delete process.env.ORCH_MOCK;
useTempHome(after);
const scratch = [];
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); scratch.push(d); return d; };
after(() => { for (const d of scratch) rmSync(d, { recursive: true, force: true }); });

const rawMeta = (over = {}) => ({ metaVersion: 2, key: 'probe', runtime: 'node', file: 'prog.mjs', inputs: [], outputs: [], ...over });

test('normalizeScriptMeta keeps readiness only when exactly true, and the validator accepts it', () => {
  assert.equal(normalizeScriptMeta(rawMeta({ readiness: true })).meta.readiness, true);
  for (const v of [undefined, false, 'true', 1, null]) {
    const { meta, errors } = normalizeScriptMeta(rawMeta(v === undefined ? {} : { readiness: v }));
    assert.deepEqual(errors, []);
    assert.equal('readiness' in meta, false);
  }
  assert.deepEqual(validateScriptMetaV2(rawMeta({ readiness: true })).errors, []);
});

function repo(files) {
  const d = tmp('rw-repo-');
  spawnSync('git', ['init', '-q', d]);
  for (const f of files) writeFileSync(join(d, f), '# x\n');
  spawnSync('git', ['-C', d, 'add', '.']);
  return d;
}
function ctxFor(raw, extra = {}) {
  const { meta } = normalizeScriptMeta(raw);
  const pipelineDir = tmp('rw-pipe-');
  const file = join(tmp('rw-prog-'), 'prog.mjs');
  writeFileSync(file, `export default (api) => ({ summary: JSON.stringify(api.readiness && api.readiness.members ? { members: Object.fromEntries(Object.entries(api.readiness.members).map(([k, v]) => [k, { judged: v.judged }])) } : api.readiness ? { judged: api.readiness.judged, n: api.readiness.engines.length } : null) });\n`);
  return {
    node: { id: 'n', kind: 'script', key: 'probe' }, executionId: 'x:n:1', ordinal: 1, cycle: 1, pipelineDir, pipelineId: 'p1',
    projectDir: pipelineDir, runCtx: { pipelineDir, projectDir: pipelineDir }, ports: { inputs: [], outputs: [] }, outputs: {}, verdict: null,
    bindings: {}, trigger: {}, script: { meta, runtime: 'node', file, params: {}, timeoutMs: 20000 }, claudeOpts: {}, ...extra,
  };
}

test('a readiness:true script gets api.readiness through the real path; an ordinary one does not', async () => {
  const dir = repo(['CLAUDE.md']);
  const yes = await runScriptExecution(ctxFor(rawMeta({ readiness: true }), { projectDir: dir, runCtx: { projectDir: dir } }));
  const v = JSON.parse(yes.summary);
  assert.ok(v && v.judged.includes('claude') && v.n === 8);
  const no = await runScriptExecution(ctxFor(rawMeta(), { projectDir: dir, runCtx: { projectDir: dir } }));
  assert.equal(JSON.parse(no.summary), null);
});

test('a workspace run judges each member against its own project settings', async () => {
  const a = repo(['CLAUDE.md']); const b = repo(['CLAUDE.md']);
  const ka = projectKey(a); const kb = projectKey(b);
  writeProjectSettings({ projectDir: b }, { 'readiness.tools': { gemini: 'used' } });
  const res = await runScriptExecution(ctxFor(rawMeta({ readiness: true }), {
    projectDir: a, runCtx: { projectDir: a }, runRoot: tmp('rw-root-'),
    workspace: { projects: [{ projectKey: ka, projectDir: a, worktreeDir: a }, { projectKey: kb, projectDir: b, worktreeDir: b }] },
    repos: [{ projectKey: ka, dir: a }, { projectKey: kb, dir: b }],
  }));
  const m = JSON.parse(res.summary).members;
  assert.equal(m[ka].judged.includes('gemini'), false);
  assert.equal(m[kb].judged.includes('gemini'), true);
});

test('the run\'s commit exclusions (ctx.commitExcludes) reach the readiness view', async () => {
  const dir = tmp('rw-excl-');
  spawnSync('git', ['init', '-q', dir]);
  writeFileSync(join(dir, 'package.json'), '{"name":"x"}\n');
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A']);
  spawnSync('git', ['-C', dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
  writeFileSync(join(dir, 'secrets.pem'), 'x\n');
  const secretsRow = async (extra) => {
    const ctx = ctxFor(rawMeta({ readiness: true }), { projectDir: dir, runCtx: { projectDir: dir }, ...extra });
    writeFileSync(ctx.script.file, 'export default (api) => ({ summary: api.readiness.report.checks.find((r) => r.id === \'secrets.tracked-names\').status });\n');
    return (await runScriptExecution(ctx)).summary;
  };
  assert.equal(await secretsRow({}), 'fail', 'without an exclusion the new file would be committed');
  assert.equal(await secretsRow({ commitExcludes: { [projectKey(dir)]: [':(exclude)secrets.pem'] } }), 'pass');
});

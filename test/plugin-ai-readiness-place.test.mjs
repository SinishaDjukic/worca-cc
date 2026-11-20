// test/plugin-ai-readiness-place.test.mjs — the Place Claude files step copies only allowlisted,
// approved files from the run folder into the checkout's .claude/.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import run, { placeProblem, approvedSet, placeClaudeFiles, mountedPaths, LIMITS } from '../plugins/ai-readiness/scripts/readiness-place.mjs';

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
function tmp(prefix) { const d = mkdtempSync(join(tmpdir(), prefix)); roots.push(d); return d; }
function repo() {
  const d = tmp('air-place-repo-');
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
  return d;
}
function stage(files) {
  const d = tmp('air-place-stage-');
  for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(d, rel)), { recursive: true }); writeFileSync(join(d, rel), body); }
  return d;
}
const SKILL = '---\nname: add-route\ndescription: Use when adding a route\n---\nSteps.\n';
const approved = (...paths) => new Set(paths);

test('case 1: an approved skill and rule are placed under .claude/', () => {
  const r = repo();
  const s = stage({ 'skills/add-route/SKILL.md': SKILL, 'rules/api.md': '---\npaths: src/routes/**\n---\nRules.\n' });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md', '.claude/rules/api.md') });
  assert.deepEqual(out.skipped, []);
  assert.deepEqual(out.placed.map((p) => p.path).sort(), ['.claude/rules/api.md', '.claude/skills/add-route/SKILL.md']);
  assert.equal(readFileSync(join(r, '.claude/skills/add-route/SKILL.md'), 'utf8'), SKILL);
});

test('case 2: placeProblem refuses everything outside skills/ and rules/', () => {
  for (const rel of ['settings.json', 'settings.local.json', 'commands/x.md', 'agents/x.md', 'hooks/x.sh', '../x', 'skills/../settings.json', 'skills/x'])
    assert.ok(placeProblem(rel), `${rel} is refused`);
  assert.equal(placeProblem('skills/add-route/SKILL.md'), null);
  assert.equal(placeProblem('skills/add-route/reference/notes.md'), null);
  assert.equal(placeProblem('rules/api.md'), null);
});

test('case 3: worca-reserved names and bad skill names are refused', () => {
  assert.match(placeProblem('skills/readiness-rubric/SKILL.md'), /reserved/);
  assert.match(placeProblem('rules/worca/x.md'), /reserved/);
  assert.match(placeProblem('skills/Add_Route/SKILL.md'), /name/);
  assert.match(placeProblem('rules/api.txt'), /\.md/);
});

test('case 4: a staged symlink is refused and nothing is written', () => {
  const r = repo();
  const s = stage({});
  mkdirSync(join(s, 'skills/evil'), { recursive: true });
  symlinkSync('/etc/hosts', join(s, 'skills/evil/SKILL.md'));
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/evil/SKILL.md') });
  assert.equal(out.placed.length, 0);
  assert.match(out.skipped[0].reason, /symlink/);
  assert.equal(existsSync(join(r, '.claude/skills/evil')), false);
});

test('case 5: an allowlisted file card B did not approve is skipped', () => {
  const r = repo();
  const s = stage({ 'skills/add-route/SKILL.md': SKILL, 'skills/extra/SKILL.md': SKILL.replace('add-route', 'extra') });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md') });
  assert.deepEqual(out.placed.map((p) => p.path), ['.claude/skills/add-route/SKILL.md']);
  assert.deepEqual(out.skipped, [{ path: '.claude/skills/extra/SKILL.md', reason: 'not approved on the plan card' }]);
});

test('case 6: a path the repository ignores is placed and reported as not committed', () => {
  const r = repo();
  writeFileSync(join(r, '.gitignore'), '.claude/\n');
  const s = stage({ 'skills/add-route/SKILL.md': SKILL });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md') });
  assert.deepEqual(out.placed, [{ path: '.claude/skills/add-route/SKILL.md', ignored: true }]);
});

test('case 7: placing again overwrites the placed copy (a fix cycle)', () => {
  const r = repo();
  const ok = approved('.claude/skills/add-route/SKILL.md');
  placeClaudeFiles({ stageDir: stage({ 'skills/add-route/SKILL.md': SKILL }), repoDir: r, approved: ok });
  placeClaudeFiles({ stageDir: stage({ 'skills/add-route/SKILL.md': SKILL + 'v2\n' }), repoDir: r, approved: ok });
  assert.match(readFileSync(join(r, '.claude/skills/add-route/SKILL.md'), 'utf8'), /v2/);
});

test('extra files in an approved skill folder are placed; limits skip the rest', () => {
  const r = repo();
  const s = stage({ 'skills/add-route/SKILL.md': SKILL, 'skills/add-route/ref.md': 'r', 'skills/add-route/big.md': 'x'.repeat(LIMITS.fileBytes + 1) });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md') });
  assert.ok(out.placed.some((p) => p.path === '.claude/skills/add-route/ref.md'));
  assert.match(out.skipped.find((x) => x.path.endsWith('big.md')).reason, /larger than/);
});

test('a destination folder that is a symlink is refused', () => {
  const r = repo();
  const elsewhere = tmp('air-place-out-');
  symlinkSync(elsewhere, join(r, '.claude'));
  const out = placeClaudeFiles({ stageDir: stage({ 'rules/api.md': 'R' }), repoDir: r, approved: approved('.claude/rules/api.md') });
  assert.equal(out.placed.length, 0);
  assert.match(out.skipped[0].reason, /symlink/);
  assert.equal(existsSync(join(elsewhere, 'rules/api.md')), false);
});

test('no stage folder: nothing placed, nothing skipped', () => {
  assert.deepEqual(placeClaudeFiles({ stageDir: join(tmp('air-place-none-'), 'missing'), repoDir: repo(), approved: approved() }), { placed: [], skipped: [] });
});

test('approvedSet reads string ids and rows, and strips a member prefix', () => {
  const plan = { files: ['.claude/rules/a.md', { id: 'api/.claude/skills/x/SKILL.md' }, { id: 'AGENTS.md' }] };
  assert.deepEqual([...approvedSet(plan)].sort(), ['.claude/rules/a.md']);
  assert.deepEqual([...approvedSet(plan, 'api/')], ['.claude/skills/x/SKILL.md']);
});

test('a kept skills/ folder row approves every file under it; rules/ likewise; settings.json stays refused', () => {
  const ap = approvedSet({ files: [{ id: '.claude/skills/' }, { id: '.claude/rules/' }, { id: '.claude/' }, { id: 'AGENTS.md' }] });
  assert.ok(ap.has('.claude/skills/') && ap.has('.claude/rules/'));
  const r = repo();
  const s = stage({ 'skills/a/SKILL.md': SKILL, 'skills/b/ref.md': 'ref', 'rules/x.md': 'Rule', 'settings.json': '{}' });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: ap });
  assert.deepEqual(out.placed.map((p) => p.path).sort(), ['.claude/rules/x.md', '.claude/skills/a/SKILL.md', '.claude/skills/b/ref.md']);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /only skills\/ and rules\//);
});

test('workspace: a folder row for api approves only api skills', () => {
  const plan = { files: ['api/.claude/skills/', 'web/AGENTS.md'] };
  const api = approvedSet(plan, 'api/');
  const web = approvedSet(plan, 'web/');
  const s = stage({ 'skills/a/SKILL.md': SKILL });
  assert.equal(placeClaudeFiles({ stageDir: s, repoDir: repo(), approved: api }).placed.length, 1);
  const out = placeClaudeFiles({ stageDir: s, repoDir: repo(), approved: web });
  assert.equal(out.placed.length, 0);
  assert.equal(out.skipped.length, 1);
});

function envelope({ plan, ctx }) {
  const pd = tmp('air-place-pd-');
  writeFileSync(join(pd, 'readiness-plan.json'), JSON.stringify(plan));
  const outPath = join(pd, 'readiness-claude-placed.json');
  return { pd, outPath, api: { inputs: { plan: { type: 'json', path: join(pd, 'readiness-plan.json') } }, outputs: { placed: { type: 'json', path: outPath } }, ctx: { ...ctx, pipelineDir: pd }, log: () => {} } };
}

test('default export, single project: stages from <pipeline dir>/readiness-claude into ctx.cwd', async () => {
  const r = repo();
  const { pd, outPath, api } = envelope({ plan: { files: ['.claude/skills/add-route/SKILL.md'] }, ctx: { cwd: r } });
  mkdirSync(join(pd, 'readiness-claude/skills/add-route'), { recursive: true });
  writeFileSync(join(pd, 'readiness-claude/skills/add-route/SKILL.md'), SKILL);
  const res = await run(api);
  assert.match(res.summary, /1 placed/);
  assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')).placed, [{ path: '.claude/skills/add-route/SKILL.md', ignored: false }]);
  assert.ok(existsSync(join(r, '.claude/skills/add-route/SKILL.md')));
});

test('default export, workspace: each member gets only its own files; an unknown member key is skipped', async () => {
  const api1 = repo(); const web = repo();
  const { pd, outPath, api } = envelope({
    plan: { files: ['api/.claude/rules/api.md', 'web/.claude/rules/web.md'] },
    ctx: { cwd: tmp('air-place-root-'), workspace: { members: [{ key: 'api', dir: api1 }, { key: 'web', dir: web }] } },
  });
  for (const [k, f] of [['api', 'rules/api.md'], ['web', 'rules/web.md'], ['ghost', 'rules/g.md']]) {
    mkdirSync(dirname(join(pd, 'readiness-claude', k, f)), { recursive: true });
    writeFileSync(join(pd, 'readiness-claude', k, f), 'R');
  }
  await run(api);
  const out = JSON.parse(readFileSync(outPath, 'utf8'));
  assert.ok(existsSync(join(api1, '.claude/rules/api.md')));
  assert.equal(existsSync(join(api1, '.claude/rules/web.md')), false);
  assert.ok(existsSync(join(web, '.claude/rules/web.md')));
  assert.deepEqual(out.members.ghost, { placed: [], skipped: [{ path: 'ghost/', reason: 'not a member of this run' }] });
});

test('default export without a plan input places nothing and does not throw', async () => {
  const r = repo();
  const pd = tmp('air-place-pd-');
  const res = await run({ inputs: {}, outputs: { placed: { type: 'json', path: join(pd, 'p.json') } }, ctx: { cwd: r, pipelineDir: pd }, log: () => {} });
  assert.match(res.summary, /0 placed/);
});

test('a leaf symlink already in the checkout is refused and its target is untouched', () => {
  const r = repo();
  const outside = tmp('air-place-outside-');
  writeFileSync(join(outside, 'target.md'), 'ORIGINAL');
  mkdirSync(join(r, '.claude/rules'), { recursive: true });
  symlinkSync(join(outside, 'target.md'), join(r, '.claude/rules/a.md'));
  symlinkSync(join(outside, 'missing.md'), join(r, '.claude/rules/b.md')); // dangling
  const out = placeClaudeFiles({ stageDir: stage({ 'rules/a.md': 'NEW', 'rules/b.md': 'NEW' }), repoDir: r, approved: approved('.claude/rules/a.md', '.claude/rules/b.md') });
  assert.equal(out.placed.length, 0);
  assert.equal(out.skipped.length, 2);
  for (const s of out.skipped) assert.match(s.reason, /symlink/);
  assert.equal(readFileSync(join(outside, 'target.md'), 'utf8'), 'ORIGINAL');
  assert.equal(existsSync(join(outside, 'missing.md')), false);
});

test('a staged folder that is itself a symlink is refused without reading it', () => {
  const r = repo();
  const real = stage({ 'skills/add-route/SKILL.md': SKILL });
  const linked = join(tmp('air-place-link-'), 'readiness-claude');
  symlinkSync(real, linked);
  const out = placeClaudeFiles({ stageDir: linked, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md') });
  assert.deepEqual(out.placed, []);
  assert.equal(out.skipped.length, 1);
  assert.equal(out.skipped[0].path, '.claude/');
  assert.match(out.skipped[0].reason, /symlink/);
  assert.equal(existsSync(join(r, '.claude')), false);
});

test('the 64-file limit places 64 rules and skips the 65th', () => {
  const r = repo();
  const files = {};
  const ids = [];
  for (let i = 0; i < LIMITS.files + 1; i++) {
    const rel = `rules/r${String(i).padStart(2, '0')}.md`;
    files[rel] = 'R';
    ids.push(`.claude/${rel}`);
  }
  const out = placeClaudeFiles({ stageDir: stage(files), repoDir: r, approved: new Set(ids) });
  assert.equal(out.placed.length, LIMITS.files);
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /more than 64 files/);
});

test('case 20: a skill under a path worca mounted for this run is refused', () => {
  const r = repo();
  const s = stage({ 'skills/add-route/SKILL.md': SKILL, 'skills/other/SKILL.md': SKILL.replace('add-route', 'other') });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md', '.claude/skills/other/SKILL.md'), injected: ['.claude/skills/add-route'] });
  assert.deepEqual(out.placed.map((p) => p.path), ['.claude/skills/other/SKILL.md']);
  assert.match(out.skipped[0].reason, /worca mounts a skill with that name/);
  assert.equal(existsSync(join(r, '.claude/skills/add-route')), false);
});

test('case 21: mountedPaths reads the scope of one checkout from run.json', () => {
  const d = tmp('air-place-run-');
  writeFileSync(join(d, 'run.json'), JSON.stringify({ injectedPaths: { runRoot: [{ path: '.claude/skills/a/' }], web: [{ path: '.claude/skills/b' }] } }));
  assert.deepEqual(mountedPaths({ runRoot: d }, 'web'), ['.claude/skills/b']);
  assert.deepEqual(mountedPaths({ pipelineDir: d }), ['.claude/skills/b']);
  assert.deepEqual(mountedPaths({ runRoot: d }, 'api'), []);
});

test('case 22: a .claude that is a file is skipped, not thrown on', () => {
  const r = repo();
  writeFileSync(join(r, '.claude'), 'x');
  const s = stage({ 'skills/add-route/SKILL.md': SKILL });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/add-route/SKILL.md') });
  assert.equal(out.placed.length, 0);
  assert.match(out.skipped[0].reason, /not a folder/);
});

test('Place never writes outside .claude/skills and .claude/rules', () => {
  const r = repo();
  const s = stage({
    'skills/add-route/SKILL.md': SKILL, 'rules/claude-notes.md': 'Claude-only notes, always loaded.\n',
    'settings.json': '{}', 'commands/x.md': 'x', 'agents/x.md': 'x', 'hooks/x.sh': 'x', 'CLAUDE.md': '@AGENTS.md\n',
  });
  const out = placeClaudeFiles({ stageDir: s, repoDir: r, approved: approved('.claude/skills/', '.claude/rules/', '.claude/settings.json', '.claude/CLAUDE.md') });
  assert.deepEqual(out.placed.map((p) => p.path).sort(), ['.claude/rules/claude-notes.md', '.claude/skills/add-route/SKILL.md']);
  const written = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: r, encoding: 'utf8' }).stdout.trim().split('\n').map((l) => l.slice(3)).sort();
  assert.deepEqual(written, ['.claude/rules/claude-notes.md', '.claude/skills/add-route/SKILL.md']);
});

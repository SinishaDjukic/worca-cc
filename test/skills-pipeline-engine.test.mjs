// test/skills-pipeline-engine.test.mjs — skills registry design §4.3 on another engine: a Codex, Copilot or
// Cursor run gets its set skills in the checkout's `.agents/skills`, mounted by the run-context assembly with
// every other skill (renamed `<set slug>-<name>` on a clash, recorded in injectedPaths, kept out of commits,
// removed at teardown, mounted again on resume). Mock runs through the real dispatcher; sets built through the
// real store and library APIs under a temp WORCA_HOME. No engine binary is spawned.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { skillFolder, skillSetFixture as fixture, scratchDir as tmp, scratchGitDir as gitDir } from './helpers/skill-sets.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import { readPipeline, readPipelineForResume } from '../src/core/artifacts.mjs';
import { readRunManifest } from '../src/core/run-manifest.mjs';
import { projectKey } from '../src/core/store.mjs';
import { skillLayerText, skillHooksIgnoredText } from '../src/core/skills-registry/texts.mjs';

useTempHome(after);

const AGENTS = join('.agents', 'skills');
const auditOf = async (orch) => (await readPipeline(orch.projectDir, orch.state.id)).auditMarkdown;

/** Runners that record, at spawn time, the plugin dirs a dispatch carries and the set skills in the checkout.
 *  `pause`: the first producer dispatch pauses the run and hangs until aborted (test/mcp-pipeline-run.test.mjs). */
function runners(seen, holder, names, { pause = false } = {}) {
  let hang = pause;
  const record = (ctx) => {
    const wt = holder.orch.workDirs.get(holder.key);
    seen.push({ wt, dirs: ctx.skillPluginDirs, mounted: names.filter((n) => existsSync(join(wt, AGENTS, n, 'SKILL.md'))) });
  };
  return {
    producer: async (ctx) => {
      record(ctx);
      if (hang) {
        hang = false;
        queueMicrotask(() => holder.orch.pause());
        return new Promise((_r, rej) => {
          const onAbort = () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); };
          if (ctx.signal.aborted) onAbort(); else ctx.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      return { status: 'ok', summary: 'ok' };
    },
    verifier: async (ctx) => { record(ctx); return { status: 'ok', issues: [], review: { issues: [] }, summary: '' }; },
  };
}

/** A mock run on `engine` over a fixture project; `names` are the folders to look for in `.agents/skills`. */
function codexRun(dir, names, { engine = 'codex', pause = false, ...opts } = {}) {
  const seen = [];
  const holder = { key: projectKey(dir) };
  holder.orch = createOrchestrator({ projectDir: dir, prompt: 'x', auto: true, claude: { mock: true, engine }, runners: runners(seen, holder, names, { pause }), ...opts });
  return { orch: holder.orch, seen };
}

test('on codex, set skills mount in the checkout\'s .agents/skills before the first spawn, never as --plugin-dir; recorded, kept out of commits, gone at teardown', async () => {
  const { dir, set } = await fixture();
  const { orch, seen } = codexRun(dir, ['deploy-checklist', 'release-notes']);
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.length >= 2);
  for (const r of seen) {
    assert.deepEqual(r.mounted, ['deploy-checklist', 'release-notes'], 'every dispatch finds both in .agents/skills');
    assert.ok(!r.dirs?.length, 'no --plugin-dir on another engine');
  }
  const m = await readRunManifest(orch.getState().pipelineDir);
  const key = projectKey(dir);
  const paths = m.injectedPaths[key].filter((e) => e.kind === 'skill').map((e) => e.path);
  assert.ok(paths.includes(join(AGENTS, 'deploy-checklist')) && paths.includes(join(AGENTS, 'release-notes')), 'the assembly owns them: one record set');
  assert.ok(orch._excludePathspecs(key).includes(`:(exclude)${join(AGENTS, 'deploy-checklist')}`), 'excluded from every commit');
  assert.deepEqual(m.skillMount.names, ['deploy-checklist', 'release-notes']);
  assert.equal(m.skillMount.rel, AGENTS);
  assert.deepEqual(m.skillMount.layer, { blocked: null, text: null });
  assert.deepEqual(m.skillMount.plugins.map((p) => [p.pluginName, p.skills]), [[set.slug, ['deploy-checklist', 'release-notes']]]);
  assert.match(await auditOf(orch), /2 set skills in \.agents\/skills \(deploy-checklist, release-notes; 0 skipped\)\./);
  assert.equal(existsSync(join(seen[0].wt, AGENTS, 'deploy-checklist')), false, 'teardown removes the mount');
});

test('a name the project already uses is renamed <set slug>-<name>, its SKILL.md name rewritten; the record and audit carry the mounted name', async () => {
  const dir = gitDir('skills-clash');
  mkdirSync(join(dir, '.claude', 'skills', 'deploy-checklist'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'skills', 'deploy-checklist', 'SKILL.md'), '---\nname: deploy-checklist\ndescription: the project\'s own\n---\n');
  const { set } = await fixture(['deploy-checklist'], { dir });
  const renamed = `${set.slug}-deploy-checklist`;
  const { orch, seen } = codexRun(dir, ['deploy-checklist', renamed]);
  let body = null;
  orch.on('state', () => {
    const wt = orch.workDirs.get(projectKey(dir));
    const f = wt && join(wt, AGENTS, renamed, 'SKILL.md');
    if (f && existsSync(f)) body ??= readFileSync(f, 'utf8');
  });
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.every((r) => r.mounted.length === 2), 'the project\'s skill keeps its name, the set\'s is renamed');
  assert.match(body, new RegExp(`^name: ${renamed}$`, 'm'));
  const m = await readRunManifest(orch.getState().pipelineDir);
  assert.deepEqual(m.skillMount.names, [renamed]);
  assert.match(await auditOf(orch), new RegExp(`1 set skill in \\.agents/skills \\(${renamed}; 0 skipped\\)`));
});

test('a set skill whose SKILL.md declares hooks still mounts; the run warns once, worded for the engine', async () => {
  const { dir } = await fixture(['deploy-checklist']);
  const { orch, seen } = codexRun(dir, ['deploy-checklist'], { engine: 'cursor' });
  const hooked = skillFolder('deploy-checklist');
  writeFileSync(join(hooked, 'SKILL.md'), '---\nname: deploy-checklist\ndescription: d\nhooks:\n  PreToolUse: []\n---\n');
  // The resolver's row points at a folder whose frontmatter declares hooks (the library import keeps it as is).
  const real = orch._skillRegistry.bind(orch);
  orch._skillRegistry = async (o) => {
    const r = await real(o);
    return { ...r, mounted: r.mounted.map((x) => ({ ...x, dir: hooked })) };
  };
  assert.equal((await orch.run()).status, 'done');
  assert.ok(seen.every((r) => r.mounted.length === 1));
  const line = skillHooksIgnoredText('cursor', ['deploy-checklist']);
  const m = await readRunManifest(orch.getState().pipelineDir);
  assert.equal(m.warnings.filter((w) => w === line).length, 1);
  assert.doesNotMatch(line, /Claude Code|this machine/);
});

test('resume mounts them again before the first spawn, like every other skill layer', async () => {
  const { dir } = await fixture(['deploy-checklist']);
  const { orch, seen: before } = codexRun(dir, ['deploy-checklist'], { pause: true });
  assert.equal((await orch.run()).status, 'paused');
  assert.deepEqual(before[0].mounted, ['deploy-checklist']);
  rmSync(join(before[0].wt, AGENTS), { recursive: true, force: true });   // a mount lost while the run sat paused
  const seen = [];
  const holder = { key: projectKey(dir) };
  holder.orch = createOrchestrator({ projectDir: dir, auto: true, claude: { mock: true, engine: 'codex' }, runners: runners(seen, holder, ['deploy-checklist']),
    resume: readPipelineForResume(orch.state.id) });
  assert.equal((await holder.orch.resume()).status, 'done');
  assert.ok(seen.length && seen.every((r) => r.mounted.length === 1), 'mounted again before the resumed dispatches');
  assert.deepEqual(holder.orch.getState().skillMount.names, ['deploy-checklist']);
});

test('another engine with no .agents/skills mount (a legacy run): an honest reason, never Claude Code or this machine', async () => {
  const orch = createOrchestrator({ projectDir: gitDir('skills-legacy-codex'), claude: { mock: true, engine: 'codex' } });
  orch.pipeline = { dir: tmp('worca-skills-pipe-') };
  orch._skillRegistry = async () => ({
    mounted: [{ id: 'skill:library:alpha', name: 'alpha', qualifiedName: 'billing:alpha', pluginName: 'billing', setId: 'billing', setName: 'Billing', setSlug: 'billing', dir: skillFolder('alpha'), projects: [], description: 'a', plugin: null }],
    plugins: [{ setId: 'billing', setName: 'Billing', pluginName: 'billing', renamedPlugin: false, skills: ['alpha'] }],
    skipped: [], sets: [],
  });
  const layer = await orch._resolveSkills();
  assert.equal(layer.blocked, 'engine-no-skill-mount');
  assert.deepEqual(layer.pluginDirs, []);
  assert.deepEqual(orch.state.skillMount.layer, { blocked: 'engine-no-skill-mount', text: skillLayerText('engine-no-skill-mount', 'codex') });
  assert.doesNotMatch(orch.state.skillMount.layer.text, /Claude Code|this machine/);
});

// test/bundled-openspec-plugin.test.mjs
// The bundled OpenSpec plugin (plugins/openspec): listed in the builtin marketplace, strict-valid at
// API 4, every agent loads under its own prefixed key, every skill passes the catalog's inspector,
// and the three templates import with no skips and validate with no errors or warnings — with the
// human approval gate between validate and apply and the verify loop bounded.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempHome } from './helpers/temp-home.mjs';
import { normalizeManifest, validatePluginDir, builtinAgentMetas } from '../src/core/plugin-manifest.mjs';
import { buildInstallInventory } from '../src/core/plugin-store.mjs';
import { readPluginsLock, writePluginsLock, pluginDir } from '../src/core/plugins-lock.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import { readPluginWorkflows } from '../src/core/plugin-workflows.mjs';
import { registryPortsFn } from '../src/core/graph/registry-ports.mjs';
import { validateGraph } from '../src/shared/graph/validate.mjs';
import { parseFrontmatter } from '../src/core/frontmatter.mjs';
import { inspectSkillDir } from '../src/core/skills-registry/inspect.mjs';

useTempHome(after);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIR = join(ROOT, 'plugins', 'openspec');
const MARKET = JSON.parse(readFileSync(join(ROOT, 'worca-cc-marketplace.json'), 'utf8'));
const readJson = (...p) => JSON.parse(readFileSync(join(DIR, ...p), 'utf8'));
const sidecars = () => readdirSync(join(DIR, 'agents')).filter((f) => f.endsWith('.meta.json')).sort()
  .map((f) => readJson('agents', f));
const template = (stem) => readJson('workflows', `${stem}.json`);
const wire = (tpl, from, to) => tpl.wires.find((w) => `${w.from.node}.${w.from.port}` === from && `${w.to.node}.${w.to.port}` === to);

const AGENTS = ['openspecApproval', 'openspecArchiver', 'openspecImplementer', 'openspecProposer',
  'openspecSpecWriter', 'openspecTaskPlanner', 'openspecValidator', 'openspecVerifier'];
const SKILLS = ['ospec-apply', 'ospec-archive', 'ospec-explore', 'ospec-format', 'ospec-propose', 'ospec-verify', 'ospec-workspace'];

/** Install the bundled dir the way plugin-store does (current/ symlink + lock entry), then load the registry. */
function installedRegistry() {
  mkdirSync(pluginDir('openspec'), { recursive: true });
  symlinkSync(DIR, join(pluginDir('openspec'), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({ ...readPluginsLock(), openspec: {
    repo: 'https://example.com/worca-cc.git', subdir: 'plugins/openspec', pinnedSha: 'a'.repeat(40),
    version: '0.1.0', enabled: true, installedAt: '2026-10-13T00:00:00.000Z',
  } });
  const drops = [];
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null, onDrop: (d) => drops.push(d) });
  return { registry, drops };
}

test('openspec: listed in the builtin marketplace and strict-valid at API 4 with zero problems', () => {
  assert.ok(MARKET.plugins.includes('plugins/openspec'));
  const r = normalizeManifest(readJson('worca-cc-plugin.json'), { dir: DIR });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.manifest.engines.worcaApi, '>=4 <5');
  const v = validatePluginDir(DIR, { strict: true });
  assert.deepEqual(v.problems, [], 'the bundled plugin must validate clean');
});

test('openspec: every agent key is openspec-prefixed, collides with no built-in, and its prompt matches', () => {
  const builtin = new Set(builtinAgentMetas().map((m) => m.key));
  const metas = sidecars();
  assert.deepEqual(metas.map((m) => m.key).sort(), AGENTS);
  for (const m of metas) {
    assert.ok(!builtin.has(m.key), `${m.key} collides with a built-in agent`);
    const fm = parseFrontmatter(readFileSync(join(DIR, 'agents', m.agentFile), 'utf8'));
    assert.equal(fm.name, m.key, `${m.agentFile} frontmatter name`);
    assert.ok(fm.description, `${m.agentFile} has a description`);
    for (const s of m.requiresSkills || []) assert.ok(SKILLS.includes(s), `${m.key} requires unknown skill ${s}`);
  }
  const verifiers = metas.filter((m) => m.runnerType === 'verifier').map((m) => m.key).sort();
  assert.deepEqual(verifiers, ['openspecApproval', 'openspecValidator', 'openspecVerifier']);
});

test('openspec: every skill passes the catalog inspector (name = folder, no shell blocks, no plugin-root refs)', () => {
  assert.deepEqual(readdirSync(join(DIR, 'skills')).sort(), SKILLS);
  for (const name of SKILLS) {
    const r = inspectSkillDir(join(DIR, 'skills', name));
    assert.equal(r.name, name);
    assert.deepEqual(r.problems, [], `${name}: ${r.problems.join('; ')}`);
    assert.equal(r.shellBlocks, 0, `${name} has no inline shell blocks`);
    assert.equal(r.frontmatter.pluginRootRefs, false, `${name} works from a set`);
    assert.ok(r.description.length > 40, `${name} has a real description`);
  }
});

test('openspec: no prompt or skill installs the openspec CLI; every CLI user checks PATH first', () => {
  const files = [
    ...readdirSync(join(DIR, 'agents')).filter((f) => f.endsWith('.md')).map((f) => join(DIR, 'agents', f)),
    ...SKILLS.map((s) => join(DIR, 'skills', s, 'SKILL.md')),
  ];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.doesNotMatch(text, /npm\s+(i|install)\s+(-g|--global)\b(?![^\n]*never)/i, `${f} must not install the CLI`);
    if (/`openspec (validate|archive|new change)/.test(text)) assert.match(text, /command -v openspec|ospec-workspace/, `${f} gates CLI use on PATH`);
  }
});

test('openspec: installed, all 8 agents load (approval keeps its form) and the 3 templates import with no skips', () => {
  const { registry, drops } = installedRegistry();
  assert.deepEqual(drops, []);
  const mine = Object.values(registry).filter((m) => m.origin === 'plugin:openspec').map((m) => m.key).sort();
  assert.deepEqual(mine, AGENTS);
  assert.deepEqual(Object.keys(registry.openspecApproval.ask.forms), ['approve-change']);
  const { ready, skipped } = readPluginWorkflows('openspec', DIR, { registry, quiet: true });
  assert.deepEqual(skipped, []);
  assert.deepEqual(ready.map((r) => [r.id, r.rowName]).sort(), [
    ['wfp_openspec_openspec-apply', 'OpenSpec: Apply existing change'],
    ['wfp_openspec_openspec-full', 'OpenSpec: Full'],
    ['wfp_openspec_openspec-propose', 'OpenSpec: Propose'],
  ]);
  const portsFn = registryPortsFn(registry);
  for (const stem of ['openspec-propose', 'openspec-full', 'openspec-apply']) {
    const { errors, warnings } = validateGraph({ id: `wfp_openspec_${stem}`, ...template(stem) }, portsFn);
    assert.deepEqual(errors, [], `${stem} errors`);
    assert.deepEqual(warnings, [], `${stem} warnings`);
  }
  assert.deepEqual(buildInstallInventory(DIR).workflows, ['openspec-apply', 'openspec-full', 'openspec-propose']);
});

test('openspec: template shapes — clarify first, approval between validate and apply, loops bounded at 3', () => {
  const propose = template('openspec-propose');
  const full = template('openspec-full');
  const apply = template('openspec-apply');
  for (const tpl of [propose, full]) {
    assert.ok(wire(tpl, 'n_task.task', 'n_clarify.task'), `${tpl.name}: clarify runs first`);
    assert.ok(wire(tpl, 'n_clarify.answers', 'n_propose.answers'));
    assert.equal(wire(tpl, 'n_validate.review', 'n_propose.revise').config.maxCycles, 3);
  }
  assert.ok(wire(propose, 'n_validate.pass', 'n_end.result'), 'Propose stops at a validated change');
  assert.ok(!propose.nodes.some((n) => n.key === 'openspecImplementer'), 'Propose never applies');
  assert.ok(wire(full, 'n_validate.pass', 'n_approve.await'), 'approval waits for validation');
  assert.ok(wire(full, 'n_approve.pass', 'n_apply.await'), 'apply waits for approval');
  assert.equal(wire(full, 'n_approve.review', 'n_propose.feedback').config.maxCycles, 3);
  assert.equal(wire(full, 'n_verify.review', 'n_apply.fix').config.maxCycles, 3);
  assert.ok(wire(full, 'n_verify.pass', 'n_archive.await'), 'no gate before archive: verify pass archives');
  assert.ok(wire(full, 'n_archive.archived', 'n_end.result'));
  assert.ok(wire(apply, 'n_task.task', 'n_apply.change'), 'Apply takes the change id from the task');
  assert.equal(wire(apply, 'n_verify.review', 'n_apply.fix').config.maxCycles, 3);
  assert.ok(wire(apply, 'n_archive.archived', 'n_end.result'));
});

// The engine keeps form answers NODE-scoped (orchestrator _primeQuestions) and gives a --yes run no ask
// block at all (phases questionsPromptBlock → ''); the approval prompt must handle both or it re-applies
// a stale "Request changes" on every feedback cycle / behaves undefined when unattended.
// A missing verdict is CLEAN (exec-io readVerdict), so the gate must write a pending blocking verdict before
// it asks, and a form-repair resume (phases formRepairBlock) carries no answer, so it must not read as case A.
test('openspec: the approval prompt never re-applies an earlier cycle\'s answer, fails closed, and auto-approves with no ask block', () => {
  const text = readFileSync(join(DIR, 'agents', 'openspecApproval.md'), 'utf8');
  assert.match(text, /asked in THIS conversation/, 'acts only on an answer it asked for in this session');
  assert.match(text, /EARLIER approval cycles/, 'older form answers never decide the current cycle');
  assert.match(text, /no `## Asking the user` section at all/, 'covers the --yes run with no ask block');
  assert.match(text, /No more question rounds are available/, 'covers exhausted rounds');
  assert.match(text, /missing verdict as approval/, 'states why the gate must fail closed');
  assert.match(text, /FIRST write the pending verdict[\s\S]*"severity": "major", "title": "Approval not collected"/, 'pending blocking verdict before the ask');
  assert.match(text, /## Your form ask was refused[\s\S]*NOT an answer/, 'a form-repair resume is not an answer');
  assert.ok(text.indexOf('**R. Your form ask was refused**') < text.indexOf('**A. You already asked'), 'case R is checked before case A');
  const proposer = readFileSync(join(DIR, 'agents', 'openspecProposer.md'), 'utf8');
  assert.match(proposer, /Approval not collected[\s\S]*Change nothing under `openspec\/`/, 'proposer re-presents an un-asked change unchanged');
  const specWriter = readFileSync(join(DIR, 'agents', 'openspecSpecWriter.md'), 'utf8');
  assert.match(specWriter, /Never regenerate an unchanged spec from scratch/, 'a re-presented change keeps its validated delta specs');
});

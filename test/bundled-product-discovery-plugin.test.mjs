// test/bundled-product-discovery-plugin.test.mjs
// The bundled product discovery plugin (plugins/product-discovery): listed in the builtin marketplace,
// strict-valid at API 4, every agent loads under its own prefixed key with its forms intact, every skill
// passes the catalog's inspector, and the four templates import with no skips and validate with no errors
// or warnings — the facilitator self-loop and every review loop bounded, Full chaining ten workshops.
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
const NAME = 'product-discovery';
const DIR = join(ROOT, 'plugins', NAME);
const MARKET = JSON.parse(readFileSync(join(ROOT, 'worca-cc-marketplace.json'), 'utf8'));
const readJson = (...p) => JSON.parse(readFileSync(join(DIR, ...p), 'utf8'));
const readText = (...p) => readFileSync(join(DIR, ...p), 'utf8');
const sidecars = () => readdirSync(join(DIR, 'agents')).filter((f) => f.endsWith('.meta.json')).sort()
  .map((f) => readJson('agents', f));
const template = (stem) => readJson('workflows', `${stem}.json`);
const wire = (tpl, from, to) => tpl.wires.find((w) => `${w.from.node}.${w.from.port}` === from && `${w.to.node}.${w.to.port}` === to);

const AGENTS = ['discoveryFacilitator', 'discoveryKickoff', 'discoverySignOff', 'discoverySpecAuditor',
  'discoverySpecWriter', 'discoveryWorkshopReview'];
const SKILLS = ['discovery-method', 'discovery-spec-format', 'discovery-status', 'discovery-workshops',
  'discovery-workspace', 'product-discovery'];
const TEMPLATES = ['discovery-full', 'discovery-kickoff', 'discovery-spec', 'discovery-workshop'];

/** Install the bundled dir the way plugin-store does (current/ symlink + lock entry), then load the registry. */
function installedRegistry() {
  mkdirSync(pluginDir(NAME), { recursive: true });
  symlinkSync(DIR, join(pluginDir(NAME), 'current'), process.platform === 'win32' ? 'junction' : 'dir');
  writePluginsLock({ ...readPluginsLock(), [NAME]: {
    repo: 'https://example.com/worca-cc.git', subdir: `plugins/${NAME}`, pinnedSha: 'a'.repeat(40),
    version: '0.1.0', enabled: true, installedAt: '2026-10-13T00:00:00.000Z',
  } });
  const drops = [];
  const registry = loadAgentRegistry(undefined, { userAgentsDir: null, onDrop: (d) => drops.push(d) });
  return { registry, drops };
}

test('product-discovery: listed in the builtin marketplace and strict-valid at API 4 with zero problems', () => {
  assert.ok(MARKET.plugins.includes(`plugins/${NAME}`));
  const r = normalizeManifest(readJson('worca-cc-plugin.json'), { dir: DIR });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal(r.manifest.engines.worcaApi, '>=4 <5');
  const v = validatePluginDir(DIR, { strict: true });
  assert.deepEqual(v.problems, [], 'the bundled plugin must validate clean');
});

test('product-discovery: every agent key is discovery-prefixed, collides with no built-in, and its prompt matches', () => {
  const builtin = new Set(builtinAgentMetas().map((m) => m.key));
  const metas = sidecars();
  assert.deepEqual(metas.map((m) => m.key).sort(), AGENTS);
  for (const m of metas) {
    assert.ok(!builtin.has(m.key), `${m.key} collides with a built-in agent`);
    assert.equal(m.domain, 'product');
    const fm = parseFrontmatter(readText('agents', m.agentFile));
    assert.equal(fm.name, m.key, `${m.agentFile} frontmatter name`);
    assert.ok(fm.description, `${m.agentFile} has a description`);
    for (const s of m.requiresSkills || []) assert.ok(SKILLS.includes(s), `${m.key} requires unknown skill ${s}`);
  }
  const verifiers = metas.filter((m) => m.runnerType === 'verifier').map((m) => m.key).sort();
  assert.deepEqual(verifiers, ['discoveryFacilitator', 'discoverySignOff', 'discoverySpecAuditor', 'discoveryWorkshopReview']);
  // Allocated output paths are not node-scoped: two agents sharing a filename would overwrite each other's file.
  const filenames = metas.flatMap((m) => (m.outputs || []).map((o) => o.filename).filter(Boolean));
  assert.equal(new Set(filenames).size, filenames.length, `output filenames are unique: ${filenames.join(', ')}`);
});

test('product-discovery: every skill passes the catalog inspector (name = folder, no shell blocks, no plugin-root refs)', () => {
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

test('product-discovery: installed, all 6 agents load with their forms and the 4 templates import with no skips', () => {
  const { registry, drops } = installedRegistry();
  assert.deepEqual(drops, []);
  const mine = Object.values(registry).filter((m) => m.origin === `plugin:${NAME}`).map((m) => m.key).sort();
  assert.deepEqual(mine, AGENTS);
  assert.deepEqual(Object.keys(registry.discoveryKickoff.ask.forms).sort(), ['approve-plan', 'product-intake']);
  assert.deepEqual(Object.keys(registry.discoveryFacilitator.ask.forms).sort(), ['interview-choice', 'interview-open']);
  assert.deepEqual(Object.keys(registry.discoveryWorkshopReview.ask.forms), ['close-workshop']);
  assert.deepEqual(Object.keys(registry.discoverySignOff.ask.forms), ['sign-off-spec']);
  const { ready, skipped } = readPluginWorkflows(NAME, DIR, { registry, quiet: true });
  assert.deepEqual(skipped, []);
  assert.deepEqual(ready.map((r) => [r.id, r.rowName]).sort(), [
    [`wfp_${NAME}_discovery-full`, 'Product Discovery: Full'],
    [`wfp_${NAME}_discovery-kickoff`, 'Product Discovery: Kickoff'],
    [`wfp_${NAME}_discovery-spec`, 'Product Discovery: Compile specification'],
    [`wfp_${NAME}_discovery-workshop`, 'Product Discovery: Run workshop'],
  ]);
  const portsFn = registryPortsFn(registry);
  for (const stem of TEMPLATES) {
    const { errors, warnings } = validateGraph({ id: `wfp_${NAME}_${stem}`, ...template(stem) }, portsFn);
    assert.deepEqual(errors, [], `${stem} errors`);
    assert.deepEqual(warnings, [], `${stem} warnings`);
  }
  assert.deepEqual(buildInstallInventory(DIR).workflows, TEMPLATES);
});

test('product-discovery: template shapes — the interview self-loops, the review gates each workshop, the spec is audited then signed off', () => {
  const workshop = template('discovery-workshop');
  assert.ok(wire(workshop, 'n_task.task', 'n_facilitate.brief'));
  assert.equal(wire(workshop, 'n_facilitate.progress', 'n_facilitate.continue').config.maxCycles, 20, 'interview continues on itself');
  assert.ok(wire(workshop, 'n_facilitate.workshop', 'n_review.workshop'), 'a ready workshop goes to review');
  assert.equal(wire(workshop, 'n_review.review', 'n_facilitate.feedback').config.maxCycles, 5);
  assert.ok(wire(workshop, 'n_review.brief', 'n_end.result'), 'only a closed workshop ends the run');

  const spec = template('discovery-spec');
  assert.equal(wire(spec, 'n_audit.review', 'n_write.revise').config.maxCycles, 3);
  assert.ok(wire(spec, 'n_audit.pass', 'n_signoff.spec'), 'sign-off waits for a clean audit');
  assert.equal(wire(spec, 'n_signoff.review', 'n_write.feedback').config.maxCycles, 3);
  assert.ok(wire(spec, 'n_signoff.signed', 'n_end.result'));

  const kickoff = template('discovery-kickoff');
  assert.ok(wire(kickoff, 'n_kickoff.brief', 'n_end.result'), 'Kickoff never starts interviewing');

  const full = template('discovery-full');
  assert.ok(wire(full, 'n_kickoff.brief', 'n_f1.brief'));
  for (let k = 1; k <= 10; k++) {
    assert.equal(wire(full, `n_f${k}.progress`, `n_f${k}.continue`).config.maxCycles, 20);
    assert.ok(wire(full, `n_f${k}.workshop`, `n_r${k}.workshop`));
    assert.equal(wire(full, `n_r${k}.review`, `n_f${k}.feedback`).config.maxCycles, 5);
    if (k < 10) assert.ok(wire(full, `n_r${k}.brief`, `n_f${k + 1}.brief`), `workshop ${k + 1} starts only after ${k} is closed`);
  }
  assert.ok(wire(full, 'n_r10.brief', 'n_write.brief'), 'the spec waits for the last workshop');
  assert.ok(wire(full, 'n_signoff.signed', 'n_end.result'));
});

// The engine keeps form answers NODE-scoped and gives an unattended run no ask block at all; a missing
// verdict is CLEAN. Each human gate must therefore fail closed with a pending blocking verdict, never act
// on an earlier cycle's answer, treat a form repair as no answer, and never confirm anything unattended.
test('product-discovery: the human gates fail closed and never decide for the product owner', () => {
  for (const [file, form, pending] of [
    ['discoveryWorkshopReview.md', 'close-workshop', 'Workshop review not collected'],
    ['discoverySignOff.md', 'sign-off-spec', 'Sign-off not collected'],
  ]) {
    const text = readText('agents', file);
    assert.match(text, /asked in THIS conversation/, `${file}: acts only on an answer it asked for in this session`);
    assert.match(text, /EARLIER (review|sign-off) cycles/, `${file}: older form answers never decide the current cycle`);
    assert.match(text, /no `## Asking the user` section at all/, `${file}: covers the unattended run`);
    assert.match(text, /No more question rounds are available/, `${file}: covers exhausted rounds`);
    assert.match(text, /missing verdict as approval/, `${file}: states why the gate must fail closed`);
    assert.match(text, new RegExp(`FIRST write the pending verdict[\\s\\S]*"severity": "major", "title": "${pending}"`), `${file}: pending blocking verdict before the ask`);
    assert.match(text, /## Your form ask was refused[\s\S]*NOT an answer/, `${file}: a form repair is not an answer`);
    assert.ok(text.indexOf('**R. Your form ask was refused**') < text.indexOf('**A. You already asked'), `${file}: case R before case A`);
    assert.match(text, new RegExp(`"form": "${form}"`));
  }
  assert.match(readText('agents', 'discoverySignOff.md'), /do not sign off on the PO's behalf/);
  assert.match(readText('agents', 'discoveryWorkshopReview.md'), /Change no item's status/, 'an unattended close confirms nothing');
  const facilitator = readText('agents', 'discoveryFacilitator.md');
  assert.match(facilitator, /Workshop review not collected[\s\S]*Ask nothing and change no files/, 'an un-asked review is re-presented unchanged');
  assert.match(facilitator, /never as confirmed/, 'an unattended interview confirms nothing');
  assert.match(facilitator, /last\*\* `interview-choice` or `interview-open` entry/, 'records only this round\'s answer');
  assert.match(readText('agents', 'discoverySpecWriter.md'), /Sign-off not collected[\s\S]*Change nothing/);
});

test('product-discovery: the method keeps the colleague prompt\'s rules — one question at a time, no invented decisions', () => {
  const method = readText('skills', 'discovery-method', 'SKILL.md');
  assert.match(method, /One question at a time/);
  assert.match(method, /Never invent business decisions/);
  assert.match(method, /DEC-###/);
  for (const cls of ['REQ-###', 'ASM-###', 'OQ-###', 'REC-###', 'DEF-###', 'OOS-###']) assert.ok(method.includes(cls), cls);
  const workshops = readText('skills', 'discovery-workshops', 'SKILL.md');
  assert.equal((workshops.match(/^### \d+\. /gm) || []).length, 10, 'ten default workshops');
  assert.equal((workshops.match(/\*\*Complete when:\*\*/g) || []).length, 10, 'each with completion criteria');
});

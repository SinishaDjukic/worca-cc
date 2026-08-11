// test/plugin-manifest.test.mjs — worca-cc-plugin.json parsing/validation (spec §4.1, §6.6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { WORCA_PLUGIN_API } from '../src/core/plugin-api.mjs';
import {
  normalizeManifest, validatePluginDir, apiSatisfies, apiMismatch, declaredApi, PLUGIN_NAME_RE,
} from '../src/core/plugin-manifest.mjs';

const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-manifest-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

let n = 0;
function mkPluginDir(files) {
  const root = join(scratch, `p${n++}`);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const SRC = (over = {}) => ({
  id: 'github', module: './connector/index.mjs',
  inputs: [{ key: 'task', type: 'task-browser' }],
  ...over,
});

test('WORCA_PLUGIN_API is the integer 2', () => {
  assert.equal(WORCA_PLUGIN_API, 2);
});

test('minimal { name } manifest normalizes with full defaults', () => {
  const r = normalizeManifest({ name: 'my-plugin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.manifest, {
    name: 'my-plugin', version: null, description: '', author: '', homepage: '', license: '',
    engines: { worcaApi: null }, setup: { node: false, python: null }, taskSources: [],
  });
});

test('name: kebab-case required', () => {
  for (const bad of ['MyPlugin', 'my_plugin', '-lead', 'trail-', 'a--b', 'has space', '']) {
    const r = normalizeManifest({ name: bad });
    assert.equal(r.ok, false, `"${bad}" must be rejected`);
    assert.match(r.errors.join('\n'), bad ? /kebab-case/ : /"name" is required/);
  }
  assert.equal(PLUGIN_NAME_RE.test('github-source'), true);
});

test('engines.worca-cc-api: tiny range checker (no npm semver dep)', () => {
  assert.equal(apiSatisfies('>=2'), true);
  assert.equal(apiSatisfies('>=2 <3'), true);
  assert.equal(apiSatisfies('2'), true);
  assert.equal(apiSatisfies('=2'), true);
  assert.equal(apiSatisfies('>=3'), false);
  assert.equal(apiSatisfies('<2'), false);
  assert.equal(apiSatisfies('1'), false);
  assert.equal(apiSatisfies('>=1 <2'), false);   // the API-1 range every v1 plugin ships
  assert.equal(apiSatisfies(''), true);          // unset -> unconstrained
  assert.equal(apiSatisfies('^2.0.0'), false);   // unsupported syntax fails CLOSED
  assert.equal(apiSatisfies('>=2.1.3'), true);   // minor/patch tolerated; integer compared
  const ok = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=2 <3' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.engines.worcaApi, '>=2 <3');
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin API 2/);
});

test('apiMismatch names the API the plugin was built for (Plugins-view message input)', () => {
  assert.equal(declaredApi('>=1 <2'), 1);
  assert.equal(declaredApi('1'), 1);
  assert.equal(declaredApi('>=2 <3'), 2);
  assert.equal(declaredApi('^1.0.0'), null, 'an unparseable range satisfies nothing');
  assert.deepEqual(apiMismatch('>=1 <2'), { builtFor: 1, host: 2 });
  assert.deepEqual(apiMismatch('^1.0.0'), { builtFor: null, host: 2 });
  assert.equal(apiMismatch('>=2 <3'), null, 'satisfied -> no mismatch');
  assert.equal(apiMismatch(''), null, 'unconstrained -> no mismatch');
});

test('version optional: absent -> null (pinned SHA becomes the version downstream)', () => {
  assert.equal(normalizeManifest({ name: 'p' }).manifest.version, null);
  assert.equal(normalizeManifest({ name: 'p', version: '0.1.0' }).manifest.version, '0.1.0');
});

test('taskSources normalize with defaults', () => {
  const r = normalizeManifest({
    name: 'github-source',
    taskSources: [SRC({
      configSchema: [{ key: 'token', type: 'text', secret: true, required: true, label: 'GitHub token' }],
      inputs: [
        { key: 'repo', type: 'remote-select', label: 'Repository', optionsFrom: 'listRepos' },
        { key: 'filter', type: 'text', default: 'assignee:@me state:open' },
        { key: 'task', type: 'task-browser', label: 'Issue' },
      ],
    })],
  });
  assert.equal(r.ok, true);
  const s = r.manifest.taskSources[0];
  assert.equal(s.displayName, 'github'); // defaults to id
  assert.deepEqual(s.configSchema[0], {
    key: 'token', type: 'text', label: 'GitHub token',
    secret: true, required: true, default: null, help: null, options: [],
  });
  assert.deepEqual(s.inputs[1], {
    key: 'filter', type: 'text', label: 'filter',
    default: 'assignee:@me state:open', optionsFrom: null, options: [],
  });
  assert.equal(s.inputs[0].optionsFrom, 'listRepos');
});

test('exactly ONE task-browser input per source', () => {
  const none = normalizeManifest({ name: 'p', taskSources: [SRC({ inputs: [{ key: 'x', type: 'text' }] })] });
  assert.equal(none.ok, false);
  assert.match(none.errors[0], /exactly ONE input of type "task-browser" \(found 0\)/);
  const two = normalizeManifest({
    name: 'p',
    taskSources: [SRC({ inputs: [{ key: 'a', type: 'task-browser' }, { key: 'b', type: 'task-browser' }] })],
  });
  assert.equal(two.ok, false);
  assert.match(two.errors[0], /found 2/);
});

test('module path rules: ./ prefix, relative, no ..', () => {
  for (const [mod, re] of [
    ['connector/index.mjs', /must start with "\.\/"/],
    ['./x/../../evil.mjs', /must not contain "\.\."/],
    ['/abs/index.mjs', /relative \.\/ path/],
    ['', /is required/],
  ]) {
    const r = normalizeManifest({ name: 'p', taskSources: [SRC({ module: mod })] });
    assert.equal(r.ok, false, `module "${mod}" must be rejected`);
    assert.match(r.errors.join('\n'), re);
  }
});

test('remote-select requires optionsFrom; select requires options; bad types error', () => {
  const r1 = normalizeManifest({
    name: 'p',
    taskSources: [SRC({ inputs: [{ key: 'r', type: 'remote-select' }, { key: 'task', type: 'task-browser' }] })],
  });
  assert.equal(r1.ok, false);
  assert.match(r1.errors.join('\n'), /remote-select needs "optionsFrom"/);
  const r2 = normalizeManifest({ name: 'p', taskSources: [SRC({ configSchema: [{ key: 'mode', type: 'select' }] })] });
  assert.equal(r2.ok, false);
  assert.match(r2.errors.join('\n'), /select fields need "options"/);
  const r3 = normalizeManifest({
    name: 'p',
    taskSources: [SRC({ inputs: [{ key: 'task', type: 'task-browser' }, { key: 'x', type: 'wat' }] })],
  });
  assert.equal(r3.ok, false);
});

test('unknown fields are ignored + collected as warnings', () => {
  const r = normalizeManifest({ name: 'p', hooks: {}, taskSources: [SRC({ magic: 1 })] });
  assert.equal(r.ok, true);
  assert.equal(r.warnings.length, 2);
  assert.match(r.warnings[0], /unknown field "hooks" ignored/);
  assert.match(r.warnings[1], /unknown field "magic" ignored/);
  assert.equal('hooks' in r.manifest, false);
});

// ── validatePluginDir ──────────────────────────────────────────────────────

/** A meta v2 sidecar: ports, not channels. API 2 holds a plugin agent to the
 *  same schema agent-store enforces on a user agent. */
const META = (over = {}) => JSON.stringify({
  metaVersion: 2, key: 'demoAgent', runnerType: 'producer', order: 90,
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }],
  ...over,
});

/** A v2 graph template referencing `key`. V20/V21 make the task and end nodes
 *  mandatory in a plugin template exactly as in a composed one. */
const GRAPH = (name, key = 'demoAgent') => JSON.stringify({
  name, version: 2, domain: 'general',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_a', kind: 'agent', key, x: 320, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
  ],
});

const VALID_FILES = {
  'worca-cc-plugin.json': JSON.stringify({ name: 'demo-plugin', taskSources: [SRC()] }),
  'connector/index.mjs': 'export default () => ({});\n',
  'agents/demoAgent.meta.json': META(),
  'agents/demoAgent.md': '---\ntools: Read, Bash\n---\nbody\n',
  'skills/demo-skill/SKILL.md': '# skill\n',
  'workflows/demo-flow.json': GRAPH('Demo'),
};

test('validatePluginDir: fully valid dir -> ok, no error problems', () => {
  const v = validatePluginDir(mkPluginDir(VALID_FILES));
  assert.equal(v.ok, true);
  assert.equal(v.manifest.name, 'demo-plugin');
  assert.deepEqual(v.problems.filter((p) => p.level === 'error'), []);
});

test('validatePluginDir: agents md/meta pairing + key checks', () => {
  const dir = mkPluginDir({
    ...VALID_FILES,
    'agents/orphan.md': 'no sidecar\n',                          // warn only
    'agents/mismatch.meta.json': META({ key: 'other' }),         // key != stem + missing .md
    'agents/bad key.meta.json': META({ key: 'bad key' }),        // key regex
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  const msgs = v.problems.map((p) => `${p.level}:${p.message}`).join('\n');
  assert.match(msgs, /warn:.*orphan\.md.*no orphan\.meta\.json/);
  assert.match(msgs, /error:.*mismatch\.meta\.json.*must match the filename stem/);
  assert.match(msgs, /error:.*missing sibling mismatch\.md/);
  assert.match(msgs, /error:.*bad key\.meta\.json.*must be a valid agent key/);
});

test('validatePluginDir: workflow referencing an unshipped agent key = error', () => {
  // The isolation rule is DELIBERATE: a plugin template may name only agents the
  // plugin itself ships — never a builtin or a user agent it cannot keep alive.
  const dir = mkPluginDir({
    ...VALID_FILES,
    'workflows/alien.json': GRAPH('Alien', 'notMine'),
    'workflows/builtin.json': GRAPH('Builtin', 'planner'),
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  const msgs = v.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /alien\.json: references agent key "notMine" which this plugin does not ship/);
  assert.match(msgs, /builtin\.json: references agent key "planner" which this plugin does not ship/);
});

test('validatePluginDir: a v1 "steps" workflow template is rejected under API 2', () => {
  const dir = mkPluginDir({
    ...VALID_FILES,
    'workflows/legacy.json': JSON.stringify({ name: 'Legacy', version: 1, steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] }),
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  assert.match(
    v.problems.map((p) => p.message).join('\n'),
    /legacy\.json: must be a version-2 graph template \(worca-cc-api 2\)/,
  );
});

test('validatePluginDir: a v1 sidecar is a hard error naming the failed rule', () => {
  const dir = mkPluginDir({
    ...VALID_FILES,
    'agents/legacyAgent.meta.json': JSON.stringify({
      key: 'legacyAgent', runnerType: 'producer', consumes: ['userPrompt'], produces: ['code'], order: 90,
    }),
    'agents/legacyAgent.md': '---\ntools: Read\n---\nbody\n',
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  const msgs = v.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /agents\/legacyAgent\.meta\.json: sidecar requires metaVersion 2/);
  assert.match(msgs, /agents\/legacyAgent\.meta\.json: outputs must be an array/);
});

test('validatePluginDir: plugin sidecars get the FULL v2 surface, incl. the reserved await port', () => {
  // Every capability field is open to a plugin — the gate is the schema, not an
  // allow-list — so a verifier with conditional routes and a mockRole validates…
  const rich = validatePluginDir(mkPluginDir({
    ...VALID_FILES,
    'agents/demoAgent.meta.json': META({
      runnerType: 'verifier', verdict: { filename: 'demo-verdict.json' },
      sideEffect: 'code', wantsRequest: true, fanOut: true,
      outputs: [
        { id: 'review', type: 'md', when: 'blocking', filename: 'demo-review-cycle{cycle}.md' },
        { id: 'pass', type: 'void', when: 'clean' },
      ],
    }),
    'workflows/demo-flow.json': JSON.stringify({
      name: 'Demo', version: 2, domain: 'general',
      nodes: [
        { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
        { id: 'n_a', kind: 'agent', key: 'demoAgent', x: 320, y: 200, config: {} },
        { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
        { id: 'w2', from: { node: 'n_a', port: 'review' }, to: { node: 'n_end', port: 'result' } },
      ],
    }),
  }));
  assert.deepEqual(rich.problems.filter((p) => p.level === 'error'), []);
  // …while `await` stays reserved for the engine-synthesized gate on both sides.
  const reserved = validatePluginDir(mkPluginDir({
    ...VALID_FILES,
    'agents/demoAgent.meta.json': META({ inputs: [{ id: 'await', type: 'md' }] }),
  }));
  assert.equal(reserved.ok, false);
  assert.match(
    reserved.problems.map((p) => p.message).join('\n'),
    /agents\/demoAgent\.meta\.json: inputs: port id "await" is reserved/,
  );
});

test('validatePluginDir: skill without SKILL.md, missing module file, strict promotes warnings', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'demo-plugin', extra: true, taskSources: [SRC()] }),
    'skills/empty-skill/notes.txt': 'x',
  });
  const lax = validatePluginDir(dir);
  assert.equal(lax.ok, false);
  const msgs = lax.problems.map((p) => `${p.level}:${p.message}`).join('\n');
  assert.match(msgs, /error:.*module \.\/connector\/index\.mjs not found/);
  assert.match(msgs, /error:.*skills\/empty-skill: missing SKILL\.md/);
  assert.match(msgs, /warn:.*unknown field "extra" ignored/);
  const strict = validatePluginDir(dir, { strict: true });
  assert.match(
    strict.problems.map((p) => `${p.level}:${p.message}`).join('\n'),
    /error:.*unknown field "extra" ignored/,
  );
});

test('validatePluginDir: escaping symlink rejected; internal symlink fine', () => {
  const dir = mkPluginDir(VALID_FILES);
  symlinkSync('../..', join(dir, 'escape'));
  symlinkSync('./connector', join(dir, 'alias'));
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  const msgs = v.problems.map((p) => p.message).join('\n');
  assert.match(msgs, /symlink escapes the plugin dir: escape/);
  assert.doesNotMatch(msgs, /alias/);
});

test('validatePluginDir: missing/corrupt manifest', () => {
  const none = validatePluginDir(mkPluginDir({ 'README.md': 'x' }));
  assert.equal(none.ok, false);
  assert.equal(none.manifest, null);
  const corrupt = validatePluginDir(mkPluginDir({ 'worca-cc-plugin.json': '{nope' }));
  assert.equal(corrupt.ok, false);
  assert.match(corrupt.problems[0].message, /invalid JSON/);
});

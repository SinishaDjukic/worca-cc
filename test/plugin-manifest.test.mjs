// test/plugin-manifest.test.mjs — worca-cc-plugin.json parsing/validation (spec §4.1, §6.6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { WORCA_PLUGIN_API } from '../src/core/plugin-api.mjs';
import {
  normalizeManifest, validatePluginDir, apiSatisfies, PLUGIN_NAME_RE,
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

test('WORCA_PLUGIN_API is the integer 1', () => {
  assert.equal(WORCA_PLUGIN_API, 1);
});

test('minimal { name } manifest normalizes with full defaults', () => {
  const r = normalizeManifest({ name: 'my-plugin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.manifest, {
    name: 'my-plugin', version: null, description: '', author: '', homepage: '', license: '',
    engines: { worcaApi: null }, setup: { node: false, python: null }, taskSources: [],
    models: [], modelSecrets: [],
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
  assert.equal(apiSatisfies('>=1'), true);
  assert.equal(apiSatisfies('>=1 <2'), true);
  assert.equal(apiSatisfies('1'), true);
  assert.equal(apiSatisfies('=1'), true);
  assert.equal(apiSatisfies('>=2'), false);
  assert.equal(apiSatisfies('<1'), false);
  assert.equal(apiSatisfies('2'), false);
  assert.equal(apiSatisfies(''), true);          // unset -> unconstrained
  assert.equal(apiSatisfies('^1.0.0'), false);   // unsupported syntax fails CLOSED
  assert.equal(apiSatisfies('>=1.2.3'), true);   // minor/patch tolerated; integer compared
  const ok = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.engines.worcaApi, '>=1 <2');
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=2' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin API 1/);
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

const VALID_FILES = {
  'worca-cc-plugin.json': JSON.stringify({ name: 'demo-plugin', taskSources: [SRC()] }),
  'connector/index.mjs': 'export default () => ({});\n',
  'agents/demoAgent.meta.json': JSON.stringify({ key: 'demoAgent', order: 90 }),
  'agents/demoAgent.md': '---\ntools: Read, Bash\n---\nbody\n',
  'skills/demo-skill/SKILL.md': '# skill\n',
  'workflows/demo-flow.json': JSON.stringify({ name: 'Demo', steps: [[{ id: 's0', key: 'demoAgent' }]], feedbacks: [] }),
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
    'agents/orphan.md': 'no sidecar\n',                                       // warn only
    'agents/mismatch.meta.json': JSON.stringify({ key: 'other', order: 1 }),  // key != stem + missing .md
    'agents/bad key.meta.json': JSON.stringify({ key: 'bad key', order: 1 }), // key regex
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
  const dir = mkPluginDir({
    ...VALID_FILES,
    'workflows/alien.json': JSON.stringify({ name: 'Alien', steps: [[{ id: 's0', key: 'notMine' }]], feedbacks: [] }),
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  assert.match(
    v.problems.map((p) => p.message).join('\n'),
    /alien\.json: references agent key "notMine" which this plugin does not ship/,
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

// ── models + modelSecrets (design §9.1) ──────────────────────────────────────

const MODEL = (over = {}) => ({
  id: 'discretestack-stable', label: 'DS Stable', efforts: ['medium', 'high'],
  env: { ANTHROPIC_BASE_URL: 'https://api.ds.example', ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' } },
  ...over,
});
const SECRETS = [{ key: 'ds-token', label: 'DS API token' }];

test('models: normalization — defaults, canonical effort order, secret refs kept', () => {
  const r = normalizeManifest({
    name: 'p', modelSecrets: SECRETS,
    models: [MODEL({ efforts: ['high', 'medium', 'high'] }), { id: 'bare' }],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.manifest.modelSecrets, [{ key: 'ds-token', label: 'DS API token' }]);
  const [m, bare] = r.manifest.models;
  assert.deepEqual(m.efforts, ['medium', 'high'], 'EFFORTS order, deduped');
  assert.equal(m.env.ANTHROPIC_BASE_URL, 'https://api.ds.example');
  assert.deepEqual(m.env.ANTHROPIC_AUTH_TOKEN, { secret: 'ds-token' });
  assert.equal(bare.label, 'bare');
  assert.deepEqual(bare.efforts, ['medium', 'high', 'xhigh', 'max'], 'absent efforts -> full set');
  assert.equal(bare.env, undefined, 'no env key when empty');
});

test('models: rejections — reserved env key, dup id, unknown effort, dangling secret, bad value', () => {
  const fail = (models, modelSecrets, re) => {
    const r = normalizeManifest({ name: 'p', models, ...(modelSecrets ? { modelSecrets } : {}) });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), re);
  };
  fail([MODEL({ env: { WORCA_MOCK: '1' } })], SECRETS, /env key "WORCA_MOCK" is reserved/);
  fail([MODEL({ env: { PATH: '/evil' } })], SECRETS, /env key "PATH" is reserved/);
  fail([MODEL({}), MODEL({ label: 'Twin', id: 'Discretestack-Stable' })], SECRETS, /duplicate models id/);
  fail([MODEL({ efforts: ['low'] })], SECRETS, /unknown effort "low"/);
  fail([MODEL()], undefined, /undeclared modelSecrets key "ds-token"/);
  fail([MODEL({ env: { X: '' } })], SECRETS, /must be a non-empty string or \{"secret"/);
  fail([MODEL({ env: { X: { secret: 'a', extra: 1 } } })], SECRETS, /must be a non-empty string or \{"secret"/);
  fail([{ label: 'no id' }], undefined, /"id" is required/);
  fail('nope', undefined, /"models" must be an array/);
});

test('modelSecrets: rejections — bad key, duplicate key, non-array', () => {
  const bad = normalizeManifest({ name: 'p', modelSecrets: [{ key: 'has space' }] });
  assert.equal(bad.ok, false);
  assert.match(bad.errors.join('\n'), /"key" must be an identifier/);
  const dup = normalizeManifest({ name: 'p', modelSecrets: [{ key: 'k' }, { key: 'k' }] });
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join('\n'), /duplicate modelSecrets key "k"/);
  const notArr = normalizeManifest({ name: 'p', modelSecrets: {} });
  assert.equal(notArr.ok, false);
  assert.match(notArr.errors.join('\n'), /"modelSecrets" must be an array/);
});

test('models: unknown fields warn (strict promotes via validatePluginDir)', () => {
  const r = normalizeManifest({
    name: 'p', modelSecrets: [{ key: 'k', magic: 1 }],
    models: [{ id: 'm', pricing: {} }],
  });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join('\n'), /models\[0\]: unknown field "pricing" ignored/);
  assert.match(r.warnings.join('\n'), /modelSecrets\[0\]: unknown field "magic" ignored/);
});

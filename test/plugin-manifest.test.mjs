// test/plugin-manifest.test.mjs — worca-cc-plugin.json parsing/validation (spec §4.1, §6.6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WORCA_PLUGIN_API, WORCA_PLUGIN_APIS } from '../src/core/plugin-api.mjs';
import {
  normalizeManifest, validatePluginDir, apiSatisfies, negotiatedApi, PLUGIN_NAME_RE,
  declaredApi, dataContractIssues, apiMismatch, NOT_META_V2, NOT_GRAPH_V2,
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

test('WORCA_PLUGIN_API is the integer 3; host still speaks APIs 1 and 2', () => {
  assert.equal(WORCA_PLUGIN_API, 3);
  assert.deepEqual(WORCA_PLUGIN_APIS, [1, 2, 3]);
  // Set semantics: a connector-only API-1 plugin must keep negotiating 1.
  assert.equal(negotiatedApi('>=1 <2'), 1);
  assert.equal(negotiatedApi('>=2 <3'), 2);
  assert.equal(negotiatedApi('>=3 <4'), 3);
});

test('declaredApi: the LOWEST integer a range accepts (null when unparseable)', () => {
  assert.equal(declaredApi('>=1 <2'), 1);
  assert.equal(declaredApi('1'), 1);
  assert.equal(declaredApi('>=2 <3'), 2);
  assert.equal(declaredApi('>=3 <4'), 3);
  assert.equal(declaredApi(''), 0, 'an unconstrained range accepts everything, starting at 0');
  assert.equal(declaredApi('not-a-range'), null);
});

test('dataContractIssues names the v1-shaped files, and apiMismatch counts them', () => {
  const dir = mkPluginDir({
    'agents/oldOne.meta.json': JSON.stringify({ key: 'oldOne', consumes: ['plan'], produces: ['review'] }),
    'agents/oldOne.md': '# oldOne\n',
    'agents/newOne.meta.json': JSON.stringify({ metaVersion: 2, key: 'newOne', inputs: [], outputs: [] }),
    'agents/newOne.md': '# newOne\n',
    'workflows/legacy.json': JSON.stringify({ version: 1, steps: [[{ id: 's0', key: 'oldOne' }]] }),
    'workflows/graph.json': JSON.stringify({ version: 2, nodes: [], wires: [] }),
  });
  const issues = dataContractIssues(dir);
  assert.deepEqual(issues.agentsV1, ['oldOne.meta.json']);
  assert.deepEqual(issues.workflowsV1, ['legacy.json']);
  const m = apiMismatch('>=1 <2', issues);
  assert.equal(m.message, 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates \u2014 update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
  assert.match(apiMismatch('', issues).message, /^built for plugin API an older version; /);
  // `message` is part of the payload (one canonical text, stamped by apiMismatch),
  // so the shape pin compares the counts WITHOUT it.
  const { message, ...counts } = m;
  assert.equal(typeof message, 'string');
  assert.deepEqual(counts, { builtFor: 1, host: 3, agents: 1, workflows: 1 });
  assert.equal(apiMismatch('>=3 <4', { agentsV1: [], workflowsV1: [] }), null,
    'an API-3 plugin with clean data has no mismatch');
  assert.equal(apiMismatch('>=1 <2', { agentsV1: [], workflowsV1: [] }), null,
    'a connector-only API-1 plugin is NOT a mismatch \u2014 the bump is data-gated, not range-gated');
});

test('minimal { name } manifest normalizes with full defaults', () => {
  const r = normalizeManifest({ name: 'my-plugin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.manifest, {
    name: 'my-plugin', version: null, description: '', author: '', homepage: '', license: '',
    engines: { worcaApi: null }, setup: { node: false, python: null }, taskSources: [], chatChannels: [],
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

test('engines.worca-cc-api: range checked against the host API SET (no npm semver dep)', () => {
  assert.equal(apiSatisfies('>=1'), true);
  assert.equal(apiSatisfies('>=1 <2'), true);    // old API-1 manifests keep installing on the API-2 host
  assert.equal(apiSatisfies('1'), true);
  assert.equal(apiSatisfies('=1'), true);
  assert.equal(apiSatisfies('>=2'), true);       // satisfied by member 2
  assert.equal(apiSatisfies('>=2 <3'), true);
  assert.equal(apiSatisfies('2'), true);
  assert.equal(apiSatisfies('>=3 <4'), true);    // API-3 plugins install on this host
  assert.equal(apiSatisfies('3'), true);
  assert.equal(apiSatisfies('<1'), false);
  assert.equal(apiSatisfies('>=4'), false);      // beyond the host API set
  assert.equal(apiSatisfies(''), true);          // unset -> unconstrained
  assert.equal(apiSatisfies('^1.0.0'), false);   // unsupported syntax fails CLOSED
  assert.equal(apiSatisfies('>=1.2.3'), true);   // minor/patch tolerated; integer compared
  assert.equal(apiSatisfies('>=2', 1), false);   // back-compat: single-API number arg
  const ok = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.engines.worcaApi, '>=1 <2');
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=4' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin APIs \[1, 2, 3\]/);
});

test('negotiatedApi: highest satisfying host API drives the child apiVersion', () => {
  assert.equal(negotiatedApi('>=1 <2'), 1);      // API-1 connector keeps receiving 1
  assert.equal(negotiatedApi('>=2 <3'), 2);
  assert.equal(negotiatedApi('>=3 <4'), 3);
  assert.equal(negotiatedApi('>=1'), 3);         // open range -> newest
  assert.equal(negotiatedApi(''), 3);            // unconstrained -> newest
  assert.equal(negotiatedApi(null), 3);
  assert.equal(negotiatedApi('>=4'), null);      // unsatisfiable
  assert.equal(negotiatedApi('garbage'), null);  // fail closed
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

const V2_META = (key, over = {}) => JSON.stringify({
  metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
  inputs: [{ id: 'task', type: 'md' }],
  outputs: [{ id: 'notes', type: 'md', filename: 'notes.md' }],
  order: 900, ...over,
});
const V2_GRAPH = (key) => JSON.stringify({
  name: 'Flow', version: 2, domain: 'general',
  nodes: [
    { id: 'n_task', kind: 'task', x: 40, y: 200, config: {} },
    { id: 'n_a', kind: 'agent', key, x: 320, y: 200, config: {} },
    { id: 'n_end', kind: 'end', x: 600, y: 200, config: {} },
  ],
  wires: [
    { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
    { id: 'w2', from: { node: 'n_a', port: 'notes' }, to: { node: 'n_end', port: 'result' } },
  ],
});
const errs = (v) => v.problems.filter((p) => p.level === 'error').map((p) => p.message);
const warns = (v) => v.problems.filter((p) => p.level === 'warn').map((p) => p.message);

// ── validatePluginDir ──────────────────────────────────────────────────────

const VALID_FILES = {
  'worca-cc-plugin.json': JSON.stringify({ name: 'demo-plugin', engines: { 'worca-cc-api': '>=3 <4' }, taskSources: [SRC()] }),
  'connector/index.mjs': 'export default () => ({});\n',
  'agents/demoAgent.meta.json': V2_META('demoAgent', { order: 90 }),
  'agents/demoAgent.md': '---\ntools: Read, Bash\n---\nbody\n',
  'skills/demo-skill/SKILL.md': '# skill\n',
  'workflows/demo-flow.json': V2_GRAPH('demoAgent'),
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
    'workflows/alien.json': V2_GRAPH('notMine'),
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

// ── chatChannels (API 2, design §4.2) ─────────────────────────────────────────

const CH = (over = {}) => ({
  id: 'main', platform: 'telegram', module: './channel/worker.mjs', ...over,
});

test('chatChannels: normalize with defaults (ingress connect, both capabilities)', () => {
  const r = normalizeManifest({
    name: 'telegram-chat',
    engines: { 'worca-cc-api': '>=2 <3' },
    chatChannels: [CH({
      displayName: 'Telegram',
      configSchema: [{ key: 'botToken', secret: true, required: true }],
    })],
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  const c = r.manifest.chatChannels[0];
  assert.deepEqual(c, {
    id: 'main', displayName: 'Telegram', platform: 'telegram',
    module: './channel/worker.mjs', ingress: 'connect',
    capabilities: { inbound: true, outbound: true },
    configSchema: [{
      key: 'botToken', type: 'text', label: 'botToken',
      secret: true, required: true, default: null, help: null, options: [],
    }],
  });
});

test('chatChannels: displayName defaults to id; platform lowercased', () => {
  const r = normalizeManifest({ name: 'p', chatChannels: [CH({ platform: 'Telegram' })] });
  assert.equal(r.ok, true);
  assert.equal(r.manifest.chatChannels[0].displayName, 'main');
  assert.equal(r.manifest.chatChannels[0].platform, 'telegram');
});

test('chatChannels: NO task-browser requirement (that rule is taskSources-only)', () => {
  const r = normalizeManifest({ name: 'p', chatChannels: [CH()] });
  assert.equal(r.ok, true, (r.errors || []).join('; '));
});

test('chatChannels: id/platform/module/ingress validation', () => {
  const bad = (over, re) => {
    const r = normalizeManifest({ name: 'p', chatChannels: [CH(over)] });
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.errors.join('\n'), re);
  };
  bad({ id: 'Bad_Id' }, /"id" must be kebab-case/);
  bad({ platform: '' }, /"platform" must be a non-empty kebab-case hint/);
  bad({ module: 'channel/worker.mjs' }, /"module" must start with "\.\/"/);
  bad({ module: './a/../../etc' }, /must not contain "\.\."/);
  bad({ ingress: 'poll' }, /"ingress" must be connect\|webhook/);
  const wh = normalizeManifest({ name: 'p', chatChannels: [CH({ ingress: 'webhook' })] });
  assert.equal(wh.ok, true);
  assert.equal(wh.manifest.chatChannels[0].ingress, 'webhook');
});

test('chatChannels: capabilities cannot disable both directions', () => {
  const r = normalizeManifest({
    name: 'p',
    chatChannels: [CH({ capabilities: { inbound: false, outbound: false } })],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /cannot disable both inbound and outbound/);
  const inOnly = normalizeManifest({ name: 'p', chatChannels: [CH({ capabilities: { outbound: false } })] });
  assert.equal(inOnly.ok, true);
  assert.deepEqual(inOnly.manifest.chatChannels[0].capabilities, { inbound: true, outbound: false });
});

test('chatChannels: duplicate ids rejected; unknown fields warn (strict errors)', () => {
  const dup = normalizeManifest({ name: 'p', chatChannels: [CH(), CH()] });
  assert.equal(dup.ok, false);
  assert.match(dup.errors.join('\n'), /duplicate chatChannels id "main"/);
  const unk = normalizeManifest({ name: 'p', chatChannels: [CH({ webhookPath: '/x' })] });
  assert.equal(unk.ok, true);
  assert.match(unk.warnings.join('\n'), /unknown field "webhookPath" ignored/);
});

test('chatChannels: configSchema shares the taskSources field semantics', () => {
  const r = normalizeManifest({
    name: 'p',
    chatChannels: [CH({
      configSchema: [
        { key: 'tenantType', type: 'select', options: ['multi-tenant', 'single-tenant'], default: 'multi-tenant' },
        { key: 'bad id!' },
      ],
    })],
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join('\n'), /"key" must be an identifier, got "bad id!"/);
  const sel = normalizeManifest({
    name: 'p',
    chatChannels: [CH({ configSchema: [{ key: 's', type: 'select' }] })],
  });
  assert.equal(sel.ok, false);
  assert.match(sel.errors.join('\n'), /select fields need "options"/);
});

test('validatePluginDir: chatChannels module must exist on disk', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', chatChannels: [CH()] }),
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  assert.match(v.problems.map((p) => p.message).join('\n'), /chatChannels "main": module \.\/channel\/worker\.mjs not found/);
  const ok = validatePluginDir(mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', chatChannels: [CH()] }),
    'channel/worker.mjs': 'export function createChannelWorker() {}',
  }));
  assert.equal(ok.ok, true, JSON.stringify(ok.problems));
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


test('a v2 sidecar + v2 template validate clean through the SHARED gates', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/flow.json': V2_GRAPH('helper'),
  });
  const v = validatePluginDir(dir);
  assert.deepEqual(errs(v), []);
  assert.equal(v.ok, true);
});

test('a broken v2 sidecar reports EVERY failed meta rule, verbatim, per file', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper', { runnerType: 'verifier', outputs: [{ id: 'review', type: 'md', when: 'blocking', filename: 'r.md' }] }),
    'agents/helper.md': '# helper\n',
  });
  const v = validatePluginDir(dir);
  assert.ok(errs(v).includes('agents/helper.meta.json: runnerType "verifier" requires verdict: { filename }'));
  assert.ok(errs(v).includes('agents/helper.meta.json: outputs.review: when "blocking" requires the agent to declare verdict: { filename }'),
    'every failed rule is reported, not just the first');
  assert.equal(v.ok, false);
});

test('v1-shaped data: ERROR when the range admits API 3 or --strict, WARN otherwise', () => {
  const files = {
    'agents/old.meta.json': JSON.stringify({ key: 'old', agentFile: 'old.md', consumes: ['plan'], produces: ['review'], order: 900 }),
    'agents/old.md': '# old\n',
    'workflows/legacy.json': JSON.stringify({ version: 1, steps: [[{ id: 's0', key: 'old' }]], feedbacks: [] }),
  };
  const strictDir = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }) });
  const hard = validatePluginDir(strictDir);
  assert.ok(errs(hard).includes('agents/old.meta.json: not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) \u2014 plugin API 3 no longer reads channel sidecars'));
  assert.ok(errs(hard).includes('workflows/legacy.json: not a version-2 graph template (nodes/wires) \u2014 port the "steps" pipeline'));
  assert.equal(hard.ok, false);

  const legacyDir = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } }) });
  const soft = validatePluginDir(legacyDir);
  assert.deepEqual(errs(soft), [], 'an API-1 plugin still installs \u2014 its connector is unaffected');
  assert.ok(warns(soft).some((m) => m.startsWith('agents/old.meta.json: not a meta v2 sidecar')));
  assert.ok(warns(soft).some((m) => m.startsWith('workflows/legacy.json: not a version-2 graph template')));
  assert.equal(soft.ok, true);
  // --strict is the plugin AUTHOR's gate: it promotes the data-contract warning
  // exactly as it already promotes every manifest warning.
  assert.equal(validatePluginDir(legacyDir, { strict: true }).ok, false);

  const noEngines = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p' }) });
  assert.equal(validatePluginDir(noEngines).ok, false, 'no engines constraint means "current API" -> hard error');

  // An unparseable manifest fails SOFT on data: its declared API is unknowable,
  // and the JSON error is already the only actionable line.
  const brokenManifest = mkPluginDir({ ...files, 'worca-cc-plugin.json': '{ not json' });
  const bm = validatePluginDir(brokenManifest);
  assert.equal(errs(bm).length, 1);
  assert.match(errs(bm)[0], /^worca-cc-plugin\.json: invalid JSON/);
});

test('a v2 template is validated V1-V21 against the PLUGIN\'S OWN ports', () => {
  const noEnd = JSON.parse(V2_GRAPH('helper'));
  noEnd.nodes = noEnd.nodes.filter((n) => n.kind !== 'end');
  noEnd.wires = noEnd.wires.filter((w) => w.to.node !== 'n_end');
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/no-end.json': JSON.stringify(noEnd),
  });
  const v = validatePluginDir(dir);
  assert.ok(errs(v).some((m) => /^workflows\/no-end\.json: V21: /.test(m)), 'the End rule fires with its code');
  assert.equal(v.ok, false);
});

test('a v2 template may reference ONLY the plugin\'s own agent keys', () => {
  const dir = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/foreign.json': V2_GRAPH('planner'),
  });
  // deepEqual, not includes: a foreign key SHORT-CIRCUITS the template (the
  // `continue`), so exactly ONE clear cause is reported. Without the
  // short-circuit the same template also fires V4/V5 for every wire touching
  // the unknown node, and `.includes` would never notice.
  assert.deepEqual(errs(validatePluginDir(dir)), [
    'workflows/foreign.json: references agent key "planner" which this plugin does not ship',
  ]);
});

test('the in-tree mock-source fixture is a valid API-3 plugin (strict)', () => {
  // scripts/smoke-plugin.mjs links this fixture but is NOT part of `npm test`,
  // so without this pin the fixture could silently rot back to the v1 contract
  // and nothing in the suite would notice.
  const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'plugins', 'mock-source');
  const v = validatePluginDir(fixture, { strict: true });
  assert.deepEqual(v.problems, [], 'the shipped fixture must validate clean');
  assert.equal(v.ok, true);
  assert.equal(v.manifest.engines.worcaApi, '>=3 <4');
});

// ── C-1: agentFile is a PATH and must stay inside agents/ ────────────────────

test('validatePluginDir: an agentFile that escapes agents/ is an error (C-1)', () => {
  // scanLayer stamps agentPath = join(<layer>/agents, agentFile) and
  // workflows.loadAgentFile reads THAT file for the system prompt AND its
  // `tools:` frontmatter — so an unchecked agentFile loads any readable host
  // file as an agent prompt with tool grants of its choosing.
  const escaper = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/escaper.meta.json': V2_META('escaper', { agentFile: '../../../../../secret.md' }),
    'agents/escaper.md': '# decoy shown at consent time\n',
  });
  const v = validatePluginDir(escaper);
  assert.equal(v.ok, false);
  assert.deepEqual(errs(v), [
    'agents/escaper.meta.json: "agentFile" must not contain ".."',
  ], 'ONE clear cause: the sidecar is not gated further once its agentFile is unusable');

  const abs = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/abs.meta.json': V2_META('abs', { agentFile: '/etc/passwd' }),
    'agents/abs.md': '# decoy\n',
  });
  assert.deepEqual(errs(validatePluginDir(abs)), [
    'agents/abs.meta.json: "agentFile" must be a relative path inside agents/',
  ]);

  // A traversal rule is NEVER softened by the API-1 data level: a v1 sidecar
  // (which the metaVersion gate would only warn about) is checked first.
  const legacy = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } }),
    'agents/old.meta.json': JSON.stringify({ key: 'old', agentFile: '../../secret.md', order: 900 }),
    'agents/old.md': '# old\n',
  });
  assert.deepEqual(errs(validatePluginDir(legacy)), [
    'agents/old.meta.json: "agentFile" must not contain ".."',
  ]);

  // …and the legitimate half stays legal: a plugin may point agentFile at any
  // .md INSIDE agents/ (every built-in does — planner -> worca-cc-planner.md).
  // The C-1 `swapper` divergence is fixed in the consent inventory, not here.
  const swapper = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/swapper.meta.json': V2_META('swapper', { agentFile: 'real.md' }),
    'agents/swapper.md': '# decoy\n',
    'agents/real.md': '# the prompt actually used at run time\n',
  });
  assert.deepEqual(errs(validatePluginDir(swapper)), []);
});

test('validatePluginDir: a contained agentFile with no file behind it is an error (C-1)', () => {
  // workflows.loadAgentFile used to fall back to the BUILT-IN agents dir when the
  // stamped agentPath was unreadable, so a sidecar naming an absent built-in file
  // ran that built-in's prompt and tool grants while consent showed "none declared".
  const ghost = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/ghost.meta.json': V2_META('ghost', { agentFile: 'worca-cc-manual-web-ui-testing.md' }),
    'agents/ghost.md': '# what the plugin shows\n',
  });
  assert.deepEqual(errs(validatePluginDir(ghost)), [
    'agents/ghost.meta.json: "agentFile" worca-cc-manual-web-ui-testing.md not found in agents/',
  ]);
});

// ── MAJ-12: a gated-out sidecar must not cascade into its template ──────────

const V1_MIXED = (api) => ({
  'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': api } }),
  'agents/helper.meta.json': JSON.stringify({ key: 'helper', agentFile: 'helper.md', consumes: [], produces: [], order: 900 }),
  'agents/helper.md': '# helper\n',
  'workflows/flow.json': V2_GRAPH('helper'),
});

test('a template referencing a GATED-OUT sidecar reports ONE cause at the data level (MAJ-12)', () => {
  // The mid-migration plugin: the template is ported to a v2 graph, the sidecar
  // is still v1. The key is NOT shipped, so it must never reach the graph
  // validator with no ports — that is what fabricated V4/V20/V21.
  const soft = validatePluginDir(mkPluginDir(V1_MIXED('>=1 <2')));
  assert.deepEqual(errs(soft), [], 'an API-1 plugin still installs — its connector is unaffected');
  assert.ok(warns(soft).includes(
    'workflows/flow.json: references agent key "helper" whose sidecar is not a valid meta v2 sidecar'));
  assert.equal(soft.ok, true);

  const hard = validatePluginDir(mkPluginDir(V1_MIXED('>=3 <4')));
  assert.deepEqual(errs(hard), [
    'agents/helper.meta.json: not a meta v2 sidecar (declare "metaVersion": 2 with typed inputs/outputs) — plugin API 3 no longer reads channel sidecars',
    'workflows/flow.json: references agent key "helper" whose sidecar is not a valid meta v2 sidecar',
  ], 'the real cause plus its consequence — no derived V4/V20/V21');
  assert.equal(hard.ok, false);

  // Same short-circuit for a v2 sidecar that FAILS validateMetaV2.
  const broken = validatePluginDir(mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper', { runnerType: 'verifier' }),
    'agents/helper.md': '# helper\n',
    'workflows/flow.json': V2_GRAPH('helper'),
  }));
  assert.deepEqual(errs(broken), [
    'agents/helper.meta.json: runnerType "verifier" requires verdict: { filename }',
    'workflows/flow.json: references agent key "helper" whose sidecar is not a valid meta v2 sidecar',
  ]);

  // …and a sidecar rejected for an escaping agentFile (C-1) is ungated too.
  const escaping = validatePluginDir(mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper', { agentFile: '../../x.md' }),
    'agents/helper.md': '# helper\n',
    'workflows/flow.json': V2_GRAPH('helper'),
  }));
  assert.deepEqual(errs(escaping), [
    'agents/helper.meta.json: "agentFile" must not contain ".."',
    'workflows/flow.json: references agent key "helper" whose sidecar is not a valid meta v2 sidecar',
  ]);

  // A key the plugin does not ship AT ALL keeps its own, different line.
  const alien = validatePluginDir(mkPluginDir({
    ...V1_MIXED('>=3 <4'),
    'workflows/flow.json': V2_GRAPH('notMine'),
  }));
  assert.ok(errs(alien).includes(
    'workflows/flow.json: references agent key "notMine" which this plugin does not ship'));
});

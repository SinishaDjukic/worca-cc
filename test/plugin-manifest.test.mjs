// test/plugin-manifest.test.mjs — worca-cc-plugin.json parsing/validation (spec §4.1, §6.6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeManifest, validatePluginDir, apiSatisfies, negotiatedApi, PLUGIN_NAME_RE,
  declaredApi, dataContractIssues, apiMismatch, NOT_META_V2, NOT_GRAPH_V2,
} from '../src/core/plugin-manifest.mjs';
import { checkRows } from './helpers/rows.mjs';

const WIN_SYMLINK = { skip: process.platform === 'win32' ? 'creating symlinks needs a privilege (Developer Mode / admin) on Windows' : false };

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

test('declaredApi (lowest accepted) vs negotiatedApi (highest satisfying) over the host API set', async () => {
  // [range, declaredApi = the LOWEST integer it accepts, negotiatedApi = the HIGHEST host API it admits]
  const TABLE = [
    ['>=1 <2', 1, 1],           // an API-1 connector keeps receiving 1
    ['1', 1, 1],
    ['>=2 <3', 2, 2],
    ['>=3 <4', 3, 3],           // an API-3 plugin is never promoted to 4
    ['>=4 <5', 4, 4],
    ['>=3 <5', 3, 4],           // the HIGHEST member a range admits drives the child apiVersion
    ['>=1', 1, 5],              // open range -> newest
    ['', 0, 5],                 // unconstrained: accepts everything, starting at 0; negotiates the newest
    [null, 0, 5],
    ['>=6', 6, null],           // beyond the host API set: unsatisfiable
    ['garbage', null, null],    // unparseable: fail closed
    ['not-a-range', null, null],
  ];
  await checkRows([
    { name: 'declaredApi: the LOWEST integer a range accepts (null when unparseable)', run: () => {
      for (const [range, declared] of TABLE) assert.equal(declaredApi(range), declared, `declaredApi(${JSON.stringify(range)})`);
    } },
    { name: 'negotiatedApi: highest satisfying host API drives the child apiVersion', run: () => {
      for (const [range, , negotiated] of TABLE) assert.equal(negotiatedApi(range), negotiated, `negotiatedApi(${JSON.stringify(range)})`);
    } },
  ]);
});

test('dataContractIssues + apiMismatch: v1 agents, templates and scripts are named and counted', async () => {
  const dir = mkPluginDir({
    'agents/oldOne.meta.json': JSON.stringify({ key: 'oldOne', consumes: ['plan'], produces: ['review'] }),
    'agents/oldOne.md': '# oldOne\n',
    'agents/newOne.meta.json': JSON.stringify({ metaVersion: 2, key: 'newOne', inputs: [], outputs: [] }),
    'agents/newOne.md': '# newOne\n',
    'workflows/legacy.json': JSON.stringify({ version: 1, steps: [[{ id: 's0', key: 'oldOne' }]] }),
    'workflows/graph.json': JSON.stringify({ version: 2, nodes: [], wires: [] }),
    'scripts/old.meta.json': JSON.stringify({ key: 'old', runtime: 'node', file: 'old.mjs' }),
    'scripts/old.mjs': '',
  });
  const issues = dataContractIssues(dir);
  await checkRows([
    { name: 'dataContractIssues names the v1-shaped files, and apiMismatch counts them', run: () => {
      assert.deepEqual(issues.agentsV1, ['oldOne.meta.json']);
      assert.deepEqual(issues.workflowsV1, ['legacy.json']);
      const m = apiMismatch('>=1 <2', { ...issues, scriptsV1: [] }); // the agents + templates half
      assert.equal(m.message, 'built for plugin API 1; this version of worca requires plugin API 3 for agents and pipeline templates \u2014 update or reinstall the plugin (1 agent(s), 1 template(s) ignored)');
      assert.match(apiMismatch('', issues).message, /^built for plugin API an older version; /);
      // `message` is part of the payload (one canonical text, stamped by apiMismatch),
      // so the shape pin compares the counts WITHOUT it.
      const { message, ...counts } = m;
      assert.equal(typeof message, 'string');
      assert.deepEqual(counts, { builtFor: 1, host: 5, agents: 1, workflows: 1 });
      assert.equal(apiMismatch('>=3 <4', { agentsV1: [], workflowsV1: [] }), null,
        'an API-3 plugin with clean data has no mismatch');
      assert.equal(apiMismatch('>=1 <2', { agentsV1: [], workflowsV1: [] }), null,
        'a connector-only API-1 plugin is NOT a mismatch \u2014 the bump is data-gated, not range-gated');
    } },
    { name: 'dataContractIssues + apiMismatch count v1 script sidecars beside agents', run: () => {
      assert.deepEqual(issues.scriptsV1, ['old.meta.json']);
      const m = apiMismatch('>=1 <2', { ...issues, agentsV1: [], workflowsV1: [] }); // the scripts half alone
      assert.equal(m.scripts, 1);
      assert.match(m.message, /\(0 agent\(s\), 1 script\(s\), 0 template\(s\) ignored\)/);
      assert.doesNotMatch(apiMismatch('>=1 <2', { agentsV1: ['a'], workflowsV1: [] }).message, /script/, 'no scripts: the message is unchanged');
      assert.match(apiMismatch('>=1 <2', issues).message, /\(1 agent\(s\), 1 script\(s\), 1 template\(s\) ignored\)/,
        'all three v1 kinds in one dir are counted together');
    } },
  ]);
});

test('minimal { name } manifest normalizes with full defaults', () => {
  const r = normalizeManifest({ name: 'my-plugin' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.manifest, {
    name: 'my-plugin', version: null, description: '', author: '', homepage: '', license: '',
    engines: { worcaApi: null }, setup: { node: false, python: null }, taskSources: [], chatChannels: [],
    models: [], modelSecrets: [], mcpServers: Object.create(null),
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
  assert.equal(apiSatisfies('>=4 <5'), true);    // API-4 plugins (ask forms) install
  assert.equal(apiSatisfies('<1'), false);
  assert.equal(apiSatisfies('>=6'), false);      // beyond the host API set
  assert.equal(apiSatisfies(''), true);          // unset -> unconstrained
  assert.equal(apiSatisfies('^1.0.0'), false);   // unsupported syntax fails CLOSED
  assert.equal(apiSatisfies('>=1.2.3'), true);   // minor/patch tolerated; integer compared
  assert.equal(apiSatisfies('>=2', 1), false);   // back-compat: single-API number arg
  const ok = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.engines.worcaApi, '>=1 <2');
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=6' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin APIs \[1, 2, 3, 4, 5\]/);
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

test('taskSources rejections: task-browser count, module path rules (./, no .., relative), field types', async () => {
  const ONE = 'exactly ONE task-browser input per source';
  const MOD = 'module path rules: ./ prefix, relative, no ..';
  const TYPES = 'remote-select requires optionsFrom; select requires options; bad types error';
  // [original test, case, SRC override, error regex (null: rejected, no wording pin), match errors[0] only]
  const TABLE = [
    [ONE, 'no task-browser input', { inputs: [{ key: 'x', type: 'text' }] }, /exactly ONE input of type "task-browser" \(found 0\)/, true],
    [ONE, 'two task-browser inputs', { inputs: [{ key: 'a', type: 'task-browser' }, { key: 'b', type: 'task-browser' }] }, /found 2/, true],
    [MOD, 'module "connector/index.mjs"', { module: 'connector/index.mjs' }, /must start with "\.\/"/],
    [MOD, 'module "./x/../../evil.mjs"', { module: './x/../../evil.mjs' }, /must not contain "\.\."/],
    [MOD, 'module "/abs/index.mjs"', { module: '/abs/index.mjs' }, /relative \.\/ path/],
    [MOD, 'module ""', { module: '' }, /is required/],
    [TYPES, 'remote-select without optionsFrom', { inputs: [{ key: 'r', type: 'remote-select' }, { key: 'task', type: 'task-browser' }] }, /remote-select needs "optionsFrom"/],
    [TYPES, 'select without options', { configSchema: [{ key: 'mode', type: 'select' }] }, /select fields need "options"/],
    [TYPES, 'unknown input type', { inputs: [{ key: 'task', type: 'task-browser' }, { key: 'x', type: 'wat' }] }, null],
  ];
  await checkRows(TABLE.map(([title, label, over, re, first]) => ({ name: `${title}: ${label}`, run: () => {
    const r = normalizeManifest({ name: 'p', taskSources: [SRC(over)] });
    assert.equal(r.ok, false, `${label} must be rejected`);
    if (re) assert.match(first ? r.errors[0] : r.errors.join('\n'), re);
  } })));
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

test('validatePluginDir: clean dirs (full plugin; minimal v2 sidecar + v2 template) -> ok, no error problems', async () => {
  await checkRows([
    { name: 'validatePluginDir: fully valid dir -> ok, no error problems', files: VALID_FILES, pluginName: 'demo-plugin' },
    { name: 'a v2 sidecar + v2 template validate clean through the SHARED gates', pluginName: 'p', files: {
      'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
      'agents/helper.meta.json': V2_META('helper'),
      'agents/helper.md': '# helper\n',
      'workflows/flow.json': V2_GRAPH('helper'),
    } },
  ].map(({ name, files, pluginName }) => ({ name, run: () => {
    const v = validatePluginDir(mkPluginDir(files));
    assert.equal(v.ok, true);
    assert.equal(v.manifest.name, pluginName);
    assert.deepEqual(errs(v), []);
  } })));
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

test('validatePluginDir: escaping symlink rejected; internal symlink fine', WIN_SYMLINK, () => {
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

test('chatChannels: normalization defaults (ingress connect, both capabilities, displayName=id, platform lowercased, no task-browser rule)', async () => {
  await checkRows([
    { name: 'chatChannels: normalize with defaults (ingress connect, both capabilities)', run: () => {
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
    } },
    { name: 'chatChannels: displayName defaults to id; platform lowercased', run: () => {
      const r = normalizeManifest({ name: 'p', chatChannels: [CH({ platform: 'Telegram' })] });
      assert.equal(r.ok, true);
      assert.equal(r.manifest.chatChannels[0].displayName, 'main');
      assert.equal(r.manifest.chatChannels[0].platform, 'telegram');
    } },
    { name: 'chatChannels: NO task-browser requirement (that rule is taskSources-only)', run: () => {
      const r = normalizeManifest({ name: 'p', chatChannels: [CH()] });
      assert.equal(r.ok, true, (r.errors || []).join('; '));
    } },
  ]);
});

test('chatChannels: rejections (id/platform/module/ingress, both capabilities off, duplicate id, configSchema rules) and unknown-field warnings', async () => {
  const bad = (over, re) => {
    const r = normalizeManifest({ name: 'p', chatChannels: [CH(over)] });
    assert.equal(r.ok, false, JSON.stringify(over));
    assert.match(r.errors.join('\n'), re);
  };
  await checkRows([
    { name: 'chatChannels: id/platform/module/ingress validation', run: () => {
      bad({ id: 'Bad_Id' }, /"id" must be kebab-case/);
      bad({ platform: '' }, /"platform" must be a non-empty kebab-case hint/);
      bad({ module: 'channel/worker.mjs' }, /"module" must start with "\.\/"/);
      bad({ module: './a/../../etc' }, /must not contain "\.\."/);
      bad({ ingress: 'poll' }, /"ingress" must be connect\|webhook/);
      const wh = normalizeManifest({ name: 'p', chatChannels: [CH({ ingress: 'webhook' })] });
      assert.equal(wh.ok, true);
      assert.equal(wh.manifest.chatChannels[0].ingress, 'webhook');
    } },
    { name: 'chatChannels: capabilities cannot disable both directions', run: () => {
      const r = normalizeManifest({
        name: 'p',
        chatChannels: [CH({ capabilities: { inbound: false, outbound: false } })],
      });
      assert.equal(r.ok, false);
      assert.match(r.errors[0], /cannot disable both inbound and outbound/);
      const inOnly = normalizeManifest({ name: 'p', chatChannels: [CH({ capabilities: { outbound: false } })] });
      assert.equal(inOnly.ok, true);
      assert.deepEqual(inOnly.manifest.chatChannels[0].capabilities, { inbound: true, outbound: false });
    } },
    { name: 'chatChannels: duplicate ids rejected; unknown fields warn (strict errors)', run: () => {
      const dup = normalizeManifest({ name: 'p', chatChannels: [CH(), CH()] });
      assert.equal(dup.ok, false);
      assert.match(dup.errors.join('\n'), /duplicate chatChannels id "main"/);
      const unk = normalizeManifest({ name: 'p', chatChannels: [CH({ webhookPath: '/x' })] });
      assert.equal(unk.ok, true);
      assert.match(unk.warnings.join('\n'), /unknown field "webhookPath" ignored/);
    } },
    { name: 'chatChannels: configSchema shares the taskSources field semantics', run: () => {
      bad({ configSchema: [
        { key: 'tenantType', type: 'select', options: ['multi-tenant', 'single-tenant'], default: 'multi-tenant' },
        { key: 'bad id!' },
      ] }, /"key" must be an identifier, got "bad id!"/);
      bad({ configSchema: [{ key: 's', type: 'select' }] }, /select fields need "options"/);
    } },
  ]);
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

test('models: normalization (defaults, effort order, secret refs) + reserved env keys (CLAUDE_CODE_*, WORCA_*, MCPSECRET_*/MCPCHILD_* any case) stripped with a warning', async () => {
  await checkRows([
    { name: 'models: normalization — defaults, canonical effort order, secret refs kept', run: () => {
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
    } },
    { name: 'models: reserved env keys are dropped with a warning, not a rejection (back-compat)', run: () => {
      const r = normalizeManifest({
        name: 'p', modelSecrets: SECRETS,
        models: [MODEL({ env: { ...MODEL().env, CLAUDE_CODE_SUBAGENT_MODEL: 'discretestack-stable', WORCA_MOCK: '1' } })],
      });
      assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
      const [m] = r.manifest.models;
      assert.equal(m.env.CLAUDE_CODE_SUBAGENT_MODEL, undefined, 'reserved key stripped');
      assert.equal(m.env.WORCA_MOCK, undefined, 'reserved-prefix key stripped');
      assert.equal(m.env.ANTHROPIC_BASE_URL, 'https://api.ds.example', 'legal keys kept');
      assert.deepEqual(m.env.ANTHROPIC_AUTH_TOKEN, { secret: 'ds-token' }, 'secret refs kept');
      const w = r.warnings.join('\n');
      assert.match(w, /models\[0\] \("discretestack-stable"\): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored/);
      assert.match(w, /env key "WORCA_MOCK" is reserved — ignored/);
    } },
    { name: 'models: MCP registry env names (MCPSECRET_*, MCPCHILD_*, any case) are dropped with a warning', run: () => {
      const r = normalizeManifest({ name: 'p', modelSecrets: SECRETS,
        models: [MODEL({ env: { ...MODEL().env, MCPSECRET_A41C6F76: 'x', McpChild_PATH: '/p' } })] });
      assert.equal(r.ok, true, r.ok ? '' : r.errors.join('\n'));
      assert.deepEqual(Object.keys(r.manifest.models[0].env), ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']);
      assert.match(r.warnings.join('\n'), /env key "MCPSECRET_A41C6F76" is reserved — ignored/);
      assert.match(r.warnings.join('\n'), /env key "McpChild_PATH" is reserved — ignored/);
    } },
  ]);
});
test('models/modelSecrets: rejections and unknown-field warnings', async () => {
  const fail = (models, modelSecrets, re) => {
    const r = normalizeManifest({ name: 'p', models, ...(modelSecrets ? { modelSecrets } : {}) });
    assert.equal(r.ok, false);
    assert.match(r.errors.join('\n'), re);
  };
  await checkRows([
    { name: 'models: rejections — dup id, unknown effort, dangling secret, bad value', run: () => {
      fail([MODEL({}), MODEL({ label: 'Twin', id: 'Discretestack-Stable' })], SECRETS, /duplicate models id/);
      fail([MODEL({ efforts: ['low'] })], SECRETS, /unknown effort "low"/);
      fail([MODEL()], undefined, /undeclared modelSecrets key "ds-token"/);
      fail([MODEL({ env: { X: '' } })], SECRETS, /must be a non-empty string or \{"secret"/);
      fail([MODEL({ env: { X: { secret: 'a', extra: 1 } } })], SECRETS, /must be a non-empty string or \{"secret"/);
      fail([{ label: 'no id' }], undefined, /"id" is required/);
      fail('nope', undefined, /"models" must be an array/);
    } },
    { name: 'modelSecrets: rejections — bad key, duplicate key, non-array', run: () => {
      fail(undefined, [{ key: 'has space' }], /"key" must be an identifier/);
      fail(undefined, [{ key: 'k' }, { key: 'k' }], /duplicate modelSecrets key "k"/);
      fail(undefined, {}, /"modelSecrets" must be an array/);
    } },
    { name: 'models: unknown fields warn (strict promotes via validatePluginDir)', run: () => {
      const r = normalizeManifest({
        name: 'p', modelSecrets: [{ key: 'k', magic: 1 }],
        models: [{ id: 'm', pricing: {} }],
      });
      assert.equal(r.ok, true);
      assert.match(r.warnings.join('\n'), /models\[0\]: unknown field "pricing" ignored/);
      assert.match(r.warnings.join('\n'), /modelSecrets\[0\]: unknown field "magic" ignored/);
    } },
  ]);
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
  // API 4 (ask forms) leaves the data contract at API 3: every range that admits
  // API 3 or better keeps v1-shaped data a hard error.
  for (const range of ['>=4 <5', '>=3 <5']) {
    const dir = mkPluginDir({ ...files, 'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': range } }) });
    assert.ok(errs(validatePluginDir(dir)).some((e) => e.includes('agents/old.meta.json')),
      `range "${range}" must report the v1 sidecar as an ERROR`);
  }

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

test('a v2 template may reference built-ins and the plugin\'s own keys — never a foreign one (#421)', () => {
  // Built-in `planner` is present on every host, so a plugin template may run it
  // (the ports come from the built-in sidecar: task in, plan out).
  const withBuiltin = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/builtin.json': JSON.stringify({
      name: 'Builtin Flow', version: 2, domain: 'general',
      nodes: [
        { id: 'n_task', kind: 'task', x: 0, y: 0, config: {} },
        { id: 'n_a', kind: 'agent', key: 'planner', x: 1, y: 0, config: {} },
        { id: 'n_end', kind: 'end', x: 2, y: 0, config: {} },
      ],
      wires: [
        { id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
        { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } },
      ],
    }),
  });
  assert.deepEqual(errs(validatePluginDir(withBuiltin)), []);

  // A key that is neither built-in nor shipped (a user-layer agent, another
  // plugin's) is refused. deepEqual, not includes: a foreign key SHORT-CIRCUITS
  // the template (the `continue`), so exactly ONE clear cause is reported.
  // Without the short-circuit the same template also fires V4/V5 for every wire
  // touching the unknown node, and `.includes` would never notice.
  const foreign = mkPluginDir({
    'worca-cc-plugin.json': JSON.stringify({ name: 'p', engines: { 'worca-cc-api': '>=3 <4' } }),
    'agents/helper.meta.json': V2_META('helper'),
    'agents/helper.md': '# helper\n',
    'workflows/foreign.json': V2_GRAPH('someUserAgent'),
  });
  assert.deepEqual(errs(validatePluginDir(foreign)), [
    'workflows/foreign.json: references agent key "someUserAgent" which is neither a built-in nor shipped by this plugin',
  ]);

  // The built-in set is injectable, so a caller can pin what "built-in" means.
  assert.deepEqual(errs(validatePluginDir(withBuiltin, { builtinMetas: [] })), [
    'workflows/builtin.json: references agent key "planner" which is neither a built-in nor shipped by this plugin',
  ]);
});

test('the in-tree mock-source fixture is a valid API-3 plugin (strict)', () => {
  // tools/smoke-plugin.mjs links this fixture but is NOT part of `npm test`,
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
    'workflows/flow.json: references agent key "notMine" which is neither a built-in nor shipped by this plugin'));
});

test('models: cost normalized like a catalog entry; malformed cost is an error naming model and rule', async () => {
  await checkRows([
    { name: 'models: `cost` is validated and normalized exactly like a global catalog entry', run: () => {
      const r = normalizeManifest({
        name: 'p',
        models: [
          { id: 'free-one', cost: { free: true } },
          { id: 'rated', cost: { perMtok: { output: '3', input: 0.5 } } },   // numeric strings coerced
          { id: 'free-wins', cost: { free: true, perMtok: { input: 9 } } },
          { id: 'no-override', cost: { free: false } },
          { id: 'plain' },
        ],
      });
      assert.equal(r.ok, true, JSON.stringify(r.errors));
      const byId = Object.fromEntries(r.manifest.models.map((m) => [m.id, m]));
      assert.deepEqual(byId['free-one'].cost, { free: true });
      assert.deepEqual(byId.rated.cost, { perMtok: { output: 3, input: 0.5 } });
      assert.deepEqual(byId['free-wins'].cost, { free: true }, 'free wins over perMtok');
      assert.equal(byId['no-override'].cost, undefined, '{free:false} is no override');
      assert.equal(byId.plain.cost, undefined, 'no cost key when the manifest pins none');
    } },
    { name: 'models: a malformed `cost` is a manifest ERROR, named by model and rule', run: () => {
      const fail = (cost, re) => {
        const r = normalizeManifest({ name: 'p', models: [{ id: 'm', cost }] });
        assert.equal(r.ok, false, `expected failure for ${JSON.stringify(cost)}`);
        assert.ok(r.errors.some((e) => re.test(e)), `${re} not in ${JSON.stringify(r.errors)}`);
      };
      fail('nope', /models\[0\] \("m"\): cost must be an object/);
      fail({ free: 'yes' }, /cost\.free must be a boolean/);
      fail({ perMtok: 5 }, /cost\.perMtok must be an object/);
      fail({ perMtok: { bogus: 1 } }, /unknown cost\.perMtok rate "bogus"/);
      fail({ perMtok: { input: -1 } }, /cost\.perMtok\.input must be a finite number >= 0/);
      fail({ perMtok: {} }, /must define at least one rate/);
    } },
  ]);
});

const SCRIPT_META = (key, over = {}) => JSON.stringify({ key, metaVersion: 2, displayName: key, runtime: 'node', file: `${key}.mjs`,
  inputs: [{ id: 'done', type: 'void', required: false }], outputs: [{ id: 'log', type: 'md', when: 'always', filename: `${key}-cycle{cycle}.md` }], ...over });
const SCRIPT_GRAPH = (key, out = 'log') => JSON.stringify({
  name: 'Script Flow', version: 2, domain: 'general',
  nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_s', kind: 'script', key, x: 1, y: 0, config: {} }, { id: 'n_end', kind: 'end', x: 2, y: 0, config: {} }],
  wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_s', port: 'await' } }, { id: 'w2', from: { node: 'n_s', port: out }, to: { node: 'n_end', port: 'result' } }],
});

test('validatePluginDir: scripts/ — pairing, key = stem, meta v2 rules, file containment, runtime', () => {
  const dir = mkPluginDir({
    ...VALID_FILES,
    'scripts/good.meta.json': SCRIPT_META('good'),
    'scripts/good.mjs': 'export default async () => ({});\n',
    'scripts/mismatch.meta.json': SCRIPT_META('other'),                   // key != stem; other.mjs missing
    'scripts/nofile.meta.json': SCRIPT_META('nofile'),                    // nofile.mjs absent
    'scripts/escape.meta.json': SCRIPT_META('escape', { file: '../escape.mjs' }),
    'scripts/rb.meta.json': SCRIPT_META('rb', { runtime: 'ruby' }),
    'scripts/bad key.meta.json': SCRIPT_META('bad key'),
  });
  const v = validatePluginDir(dir);
  assert.equal(v.ok, false);
  const e = errs(v).join('\n');
  assert.match(e, /scripts\/mismatch\.meta\.json: key "other" must match the filename stem "mismatch"/);
  assert.match(e, /scripts\/nofile\.meta\.json: file "nofile\.mjs" not found in scripts\//);
  assert.match(e, /scripts\/escape\.meta\.json: file must be a plain basename/);
  assert.match(e, /scripts\/rb\.meta\.json: runtime must be one of node, shell, python/);
  assert.match(e, /scripts\/bad key\.meta\.json: "bad key" must be a valid script key/);
  assert.doesNotMatch(e, /scripts\/good\.meta\.json/);
});

test('validatePluginDir: a plugin workflow may reference built-in scripts and its own; a foreign or ungated script key is named as a script', () => {
  const ok = mkPluginDir({ ...VALID_FILES, 'scripts/mine.meta.json': SCRIPT_META('mine'), 'scripts/mine.mjs': 'export default async () => ({});\n',
    'workflows/own.json': SCRIPT_GRAPH('mine'), 'workflows/builtin.json': SCRIPT_GRAPH('gitDiff', 'diff') });
  const v = validatePluginDir(ok);
  assert.deepEqual(errs(v), [], errs(v).join('\n'));
  const foreign = mkPluginDir({ ...VALID_FILES, 'workflows/alien.json': SCRIPT_GRAPH('notMine') });
  assert.match(errs(validatePluginDir(foreign)).join('\n'), /alien\.json: references script key "notMine" which is neither a built-in nor shipped by this plugin/);
  const ungated = mkPluginDir({ ...VALID_FILES, 'scripts/broken.meta.json': SCRIPT_META('broken', { runtime: 'ruby' }), 'workflows/b.json': SCRIPT_GRAPH('broken') });
  assert.match(validatePluginDir(ungated).problems.map((p) => p.message).join('\n'), /b\.json: references script key "broken" whose sidecar is not a valid meta v2 sidecar/);
});

test('models: a Codex model names its engine, takes Codex efforts and refuses routing env', () => {
  const ok = normalizeManifest({ name: 'p', models: [{ id: 'acme-codex', engine: 'codex', efforts: ['high', 'low'] }, { id: 'acme-codex-2', engine: 'codex' }] });
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  const [a, b] = ok.manifest.models;
  assert.equal(a.engine, 'codex');
  assert.deepEqual(a.efforts, ['low', 'high'], 'Codex effort order');
  assert.deepEqual(b.efforts, ['minimal', 'low', 'medium', 'high'], 'absent efforts -> the full Codex set');
  const claude = normalizeManifest({ name: 'p', models: [{ id: 'bare' }] });
  assert.equal('engine' in claude.manifest.models[0], false, 'a Claude model carries no engine key');
  const env = normalizeManifest({ name: 'p', models: [{ id: 'cx', engine: 'codex', env: { ANTHROPIC_BASE_URL: 'https://x' } }] });
  assert.equal(env.ok, false);
  assert.ok(env.errors.some((e) => /"cx".*a codex model takes no env/.test(e)), JSON.stringify(env.errors));
  const up = normalizeManifest({ name: 'p', models: [{ id: 'cx', engine: 'codex', upstream: { provider: 'openai', api: 'openai-responses', model: 'qwen', apiKey: '${P_KEY}' } }] });
  assert.equal(up.ok, true, JSON.stringify(up.errors));
  assert.equal(up.manifest.models[0].upstream.model, 'qwen', 'a Codex model may ship an OpenAI-compatible Responses endpoint');
  const chat = normalizeManifest({ name: 'p', models: [{ id: 'cx', engine: 'codex', upstream: { provider: 'openai', api: 'openai-chat', model: 'qwen' } }] });
  assert.ok(chat.errors.some((e) => /"cx".*Responses API only/.test(e)), JSON.stringify(chat.errors));
  const bad = normalizeManifest({ name: 'p', models: [{ id: 'cx', engine: 'gemini' }] });
  assert.ok(bad.errors.some((e) => /"engine" must be "claude", "codex" or "cursor"/.test(e)), JSON.stringify(bad.errors));
  const cursor = normalizeManifest({ name: 'p', models: [{ id: 'cu', engine: 'cursor' }] });
  assert.equal(cursor.ok, true, JSON.stringify(cursor.errors));
  assert.deepEqual(cursor.manifest.models[0], { id: 'cu', label: 'cu', engine: 'cursor', efforts: [] });
  const cursorEnv = normalizeManifest({ name: 'p', models: [{ id: 'cu', engine: 'cursor', env: { X: '1' } }] });
  assert.ok(cursorEnv.errors.some((e) => /"cu".*a cursor model takes no env/.test(e)), JSON.stringify(cursorEnv.errors));
  const eff = normalizeManifest({ name: 'p', models: [{ id: 'cx', engine: 'codex', efforts: ['max'] }] });
  assert.ok(eff.errors.some((e) => /unknown effort "max" — must be one of minimal \| low \| medium \| high/.test(e)), JSON.stringify(eff.errors));
});

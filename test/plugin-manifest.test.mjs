// test/plugin-manifest.test.mjs — worca-cc-plugin.json parsing/validation (spec §4.1, §6.6).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { WORCA_PLUGIN_API, WORCA_PLUGIN_APIS } from '../src/core/plugin-api.mjs';
import {
  normalizeManifest, validatePluginDir, apiSatisfies, negotiatedApi, PLUGIN_NAME_RE,
} from '../src/core/plugin-manifest.mjs';

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

test('WORCA_PLUGIN_API is the integer 2; host still speaks API 1', () => {
  assert.equal(WORCA_PLUGIN_API, 2);
  assert.deepEqual(WORCA_PLUGIN_APIS, [1, 2]);
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
  assert.equal(apiSatisfies('<1'), false);
  assert.equal(apiSatisfies('>=3'), false);
  assert.equal(apiSatisfies(''), true);          // unset -> unconstrained
  assert.equal(apiSatisfies('^1.0.0'), false);   // unsupported syntax fails CLOSED
  assert.equal(apiSatisfies('>=1.2.3'), true);   // minor/patch tolerated; integer compared
  assert.equal(apiSatisfies('>=2', 1), false);   // back-compat: single-API number arg
  const ok = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=1 <2' } });
  assert.equal(ok.ok, true);
  assert.equal(ok.manifest.engines.worcaApi, '>=1 <2');
  const bad = normalizeManifest({ name: 'p', engines: { 'worca-cc-api': '>=3' } });
  assert.equal(bad.ok, false);
  assert.match(bad.errors[0], /not satisfied by host plugin APIs \[1, 2\]/);
});

test('negotiatedApi: highest satisfying host API drives the child apiVersion', () => {
  assert.equal(negotiatedApi('>=1 <2'), 1);      // API-1 connector keeps receiving 1
  assert.equal(negotiatedApi('>=2 <3'), 2);
  assert.equal(negotiatedApi('>=1'), 2);         // open range -> newest
  assert.equal(negotiatedApi(''), 2);            // unconstrained -> newest
  assert.equal(negotiatedApi(null), 2);
  assert.equal(negotiatedApi('>=3'), null);      // unsatisfiable
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

test('models: `cost` is validated and normalized exactly like a global catalog entry', () => {
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
});

test('models: a malformed `cost` is a manifest ERROR, named by model and rule', () => {
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
});

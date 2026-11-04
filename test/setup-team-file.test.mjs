// test/setup-team-file.test.mjs
// The team setup reader (src/core/setup/team-file.mjs, D12, D16): refusals name the field, non-setup fields drop with
// a warning, the hash only follows the Setup fields, and a shared draft passes the same reader.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';

useTempHome(after);
const home = mkdtempSync(join(tmpdir(), 'worca-team-file-'));
const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, T: process.env.WORCA_TEAM_SETUP };
process.env.HOME = home; process.env.USERPROFILE = home; delete process.env.WORCA_TEAM_SETUP;
after(() => {
  for (const [k, v] of [['HOME', prev.HOME], ['USERPROFILE', prev.USERPROFILE], ['WORCA_TEAM_SETUP', prev.T]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  rmSync(home, { recursive: true, force: true });
});
const { checkTeamSetup, readTeamSetupFile, teamSetupPath, teamSetupHash, teamValues, teamSetupState, buildTeamSetup, TEAM_SETUP_KEYS, SHARE_SETTING_KEYS } = await import('../src/core/setup/team-file.mjs');

const FILE = { schema: 1, title: 'ACME', fields: {
  'models.roles': { kind: 'default', value: { claude: { deep: { model: 'claude-opus-5-5', effort: 'high' } } } },
  'setup.uiLevel': { kind: 'default', value: 'advanced' },
  'cost.pipelineLimitUsd': { kind: 'default', value: 8 },
} };
const write = (obj) => { mkdirSync(join(home, '.worca-cc'), { recursive: true }); writeFileSync(join(home, '.worca-cc', 'team-setup.json'), typeof obj === 'string' ? obj : JSON.stringify(obj)); };

test('the default path is ~/.worca-cc/team-setup.json; WORCA_TEAM_SETUP wins', () => {
  assert.equal(teamSetupPath({ env: {} }).path, join(home, '.worca-cc', 'team-setup.json'));
  assert.deepEqual(teamSetupPath({ env: { WORCA_TEAM_SETUP: '/x/t.json' } }), { path: '/x/t.json', source: 'env' });
  assert.match(teamSetupPath({ env: { WORCA_TEAM_SETUP: 'https://acme.example/t.json' } }).error, /from a file on this machine/);
});

test('AC-5.4: a valid file reads ok with its Setup and cost fields', () => {
  write(FILE);
  const r = readTeamSetupFile({ env: {} });
  assert.equal(r.found, true); assert.equal(r.ok, true); assert.deepEqual(r.warnings, []);
  assert.deepEqual(Object.keys(r.doc.fields).sort(), ['cost.pipelineLimitUsd', 'models.roles', 'setup.uiLevel']);
});

test('no file: found false, never an error', () => {
  rmSync(join(home, '.worca-cc', 'team-setup.json'), { force: true });
  assert.deepEqual(readTeamSetupFile({ env: {} }), { found: false, path: join(home, '.worca-cc', 'team-setup.json'), source: 'home' });
});

test('AC-5.5: a network, provider, key, token or password field is refused with the field named', () => {
  const cases = [
    [{ ...FILE, networkProxy: { upstream: 'http://p:8080' } }, 'networkProxy', /network settings/],
    [{ ...FILE, fields: { ...FILE.fields, 'network.proxy': { kind: 'default', value: 'x' } } }, 'fields.network.proxy', /network settings/],
    [{ ...FILE, providers: { copilot: { accountType: 'business' } } }, 'providers', /model provider settings/],
    [{ ...FILE, fields: { ...FILE.fields, 'setup.smartNaming': { kind: 'default', value: { apiKey: 'x' } } } }, 'fields.setup.smartNaming.value.apiKey', /keys/],
    [{ ...FILE, extra: { githubToken: 'abc' } }, 'extra.githubToken', /tokens/],
    [{ ...FILE, login: { password: 'x' } }, 'login', /network settings/],
    [{ ...FILE, notes: { password: 'x' } }, 'notes.password', /passwords/],
    [{ ...FILE, title: 'sk-ant-abcdefghijklmnop' }, 'title', /keys or tokens/],
    [{ ...FILE, extra: { authorization: 'Basic x' } }, 'extra.authorization', /passwords/],
    [{ ...FILE, extra: { sessionCookie: 'x' } }, 'extra.sessionCookie', /passwords/],
    [{ ...FILE, extra: { privateKey: 'x' } }, 'extra.privateKey', /keys/],
    [{ ...FILE, extra: { clientCert: 'x' } }, 'extra.clientCert', /passwords/],
    [{ ...FILE, extra: { https_proxy: 'x' } }, 'extra.https_proxy', /network settings/],
    [{ ...FILE, extra: { proxyLogin: 'x' } }, 'extra.proxyLogin', /network settings/],
    [{ ...FILE, loginBanner2: 'x' }, 'loginBanner2', /network settings/],   // "login" is a whole word here
  ];
  for (const [doc, field, re] of cases) {
    const r = checkTeamSetup(doc);
    assert.equal(r.ok, false, field); assert.equal(r.field, field); assert.match(r.error, re, field);
    assert.ok(r.error.includes(`“${field}”`), r.error);
  }
});

test('whole-word matching: a key that only contains a forbidden word is not refused', () => {
  for (const k of ['keyboardLayout', 'tokenizer', 'passthrough', 'monkey', 'bloggingTheme']) {
    const r = checkTeamSetup({ ...FILE, [k]: 'x' });
    assert.equal(r.ok, true, k);
    assert.ok(r.warnings.includes(`${k}: a team setup file cannot carry it — dropped`), k);
  }
  // A registry field key is a known name: "setup.networkWait" is not a network setting.
  const nw = checkTeamSetup({ ...FILE, fields: { ...FILE.fields, 'setup.networkWait': { kind: 'default', value: { enabled: true, maxWaitMin: 60 } } } });
  assert.equal(nw.ok, true); assert.deepEqual(nw.doc.fields['setup.networkWait'].value, { enabled: true, maxWaitMin: 60 });
});

test('echoed names are cut at 60 characters, and a secret-looking key name is masked', () => {
  const long = `${'a '.repeat(40)}Token`;   // spaced, so the name is long but not secret-looking (a secret-looking one is masked instead)
  const r = checkTeamSetup({ ...FILE, [long]: 'x' });
  assert.equal(r.ok, false); assert.ok(r.field.length <= 61, r.field); assert.ok(r.field.endsWith('…'));
  const s = checkTeamSetup({ ...FILE, extra: { 'sk-ant-abcdefghijklmnopqrst': { token: 'x' } } });
  assert.equal(s.ok, false); assert.doesNotMatch(s.error, /sk-ant-/);
  assert.match(s.field, /\(a name that looks like a key\)/);
  // A registry warning that quotes an inner key masks a secret-looking one and stays short (security-2-1).
  const w = checkTeamSetup({ ...FILE, fields: { ...FILE.fields, 'setup.sync': { kind: 'default', value: { 'sk-ant-abcdefghijklmnopqrst': true } } } });
  assert.equal(w.ok, true);
  const sw = w.warnings.find((x) => x.startsWith('setup.sync: '));
  assert.ok(sw, w.warnings.join('\n')); assert.doesNotMatch(sw, /sk-ant-/); assert.ok(sw.length <= 201, sw);
});

test('nesting deeper than 16 levels is refused, never a stack overflow', () => {
  let deep = 'x'; for (let i = 0; i < 40; i++) deep = { n: deep };
  const r = checkTeamSetup({ ...FILE, notes: deep });
  assert.equal(r.ok, false); assert.match(r.error, /nested too deeply/);
});

test('a non-setup field drops with a warning; a malformed Setup field drops with a warning', () => {
  const r = checkTeamSetup({ ...FILE, fields: { ...FILE.fields, 'models.allowed': { kind: 'soft', value: ['x'] }, 'setup.runEngine': { kind: 'default', value: 'emacs' } } });
  assert.equal(r.ok, true);
  assert.equal('models.allowed' in r.doc.fields, false); assert.equal('setup.runEngine' in r.doc.fields, false);
  assert.ok(r.warnings.includes('models.allowed: not a team setup field — dropped'), r.warnings.join('\n'));
  assert.ok(r.warnings.some((w) => w.startsWith('setup.runEngine: ')));
});

test('tags drop with a pointer to the team policy (T2)', () => {
  const r = checkTeamSetup({ ...FILE, fields: { ...FILE.fields, 'runs.tagDimensions': { kind: 'soft', value: [] }, 'runs.enforceTags': { kind: 'soft', value: true } } });
  assert.equal(r.ok, true);
  assert.ok(r.warnings.includes("runs.tagDimensions: tags come from the project's team policy, not a team setup file — dropped"));
  assert.ok(r.warnings.includes("runs.enforceTags: tags come from the project's team policy, not a team setup file — dropped"));
});

test('bad JSON, oversize files and non-files are refused in plain words', () => {
  write('{nope'); assert.match(readTeamSetupFile({ env: {} }).error, /not valid JSON/);
  write(JSON.stringify({ ...FILE, notes: 'x'.repeat(70_000) })); assert.match(readTeamSetupFile({ env: {} }).error, /larger than 64 KB/);
  assert.match(readTeamSetupFile({ path: home }).error, /not a file/);
});

test('the hash follows only team setup fields, whatever the key order', () => {
  const a = teamSetupHash(FILE.fields);
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.equal(teamSetupHash({ 'setup.uiLevel': FILE.fields['setup.uiLevel'], 'cost.pipelineLimitUsd': FILE.fields['cost.pipelineLimitUsd'], 'models.roles': FILE.fields['models.roles'] }), a);
  assert.equal(teamSetupHash({ ...FILE.fields, 'models.allowed': { kind: 'soft', value: ['x'] } }), a);
  assert.notEqual(teamSetupHash({ ...FILE.fields, 'setup.uiLevel': { kind: 'default', value: 'expert' } }), a);
});

test('teamValues maps onto the apply body and reports roles no source serves', () => {
  const v = teamValues(FILE.fields, { catalog: [{ id: 'copilot-claude-opus-5-5', custom: 'global', bridged: 'copilot', upstreamModel: 'claude-opus-5.5', harnesses: ['claude'] }], claudeAuth: 'signed-out' });
  assert.deepEqual(v.values, { models: { modelRoles: { claude: { deep: { model: 'copilot-claude-opus-5-5', effort: 'high' } } } }, work: { uiLevel: 'advanced', pipelineCostLimitUsd: 8 } });
  assert.deepEqual(v.keys, ['models.modelRoles.claude.deep', 'work.uiLevel', 'work.pipelineCostLimitUsd']);
  const none = teamValues(FILE.fields, { catalog: [], claudeAuth: 'signed-out' });
  assert.deepEqual(none.unmapped, [{ harness: 'claude', role: 'deep', upstream: 'claude-opus-5-5', line: 'None of your sources offer it.' }]);
  assert.equal(none.values.models, undefined);
});

test('teamSetupState: homes come from the injected list, pass the same check, and hash only Setup fields', () => {
  const policy = (fields) => ({ slug: 'acme/gateway', doc: { schema: 1, fields } });
  const a = teamSetupState({ env: {}, homes: () => [policy({ 'setup.uiLevel': { kind: 'default', value: 'advanced' }, 'models.allowed': { kind: 'soft', value: ['x'] } })] });
  assert.equal(a.homes.length, 1); assert.equal(a.homes[0].home, 'acme/gateway');
  assert.deepEqual(a.homes[0].keys, ['work.uiLevel']);
  const b = teamSetupState({ env: {}, homes: () => [policy({ 'setup.uiLevel': { kind: 'default', value: 'advanced' }, 'models.allowed': { kind: 'soft', value: ['y'] } })] });
  assert.equal(b.homes[0].hash, a.homes[0].hash);                       // a change outside Setup keeps the hash
  const c = teamSetupState({ env: {}, homes: () => [policy({ 'setup.uiLevel': { kind: 'default', value: 'expert' } })] });
  assert.notEqual(c.homes[0].hash, a.homes[0].hash);
  assert.deepEqual(teamSetupState({ env: {}, homes: () => [policy({ 'models.allowed': { kind: 'soft', value: ['x'] } })] }).homes, []);
  const lite = teamSetupState({ env: {}, homesOnly: true, homes: () => [policy({ 'setup.uiLevel': { kind: 'default', value: 'advanced' } })] });
  assert.deepEqual(Object.keys(lite).sort(), ['homes']);
  assert.deepEqual(Object.keys(lite.homes[0]).sort(), ['hash', 'home', 'keys']);
  assert.throws(() => teamSetupState({ env: {} }), /homes/);                 // never a silent default to the DB
});

test('AC-5.6: a shared draft has no network, provider or secret field and names upstream models', () => {
  const settings = { modelRoles: { claude: { deep: { model: 'copilot-claude-opus-5-5', effort: 'high' }, quick: { model: 'my-local-model' } } }, uiLevel: 'simple', pipelineCostLimitUsd: 5,
    smartNaming: { suggestTitle: false, suggestBranch: true, pattern: '{type}/{slug}', types: ['feat'], trigger: 'manual', addRunId: true },
    networkProxy: { enabled: true, upstream: 'http://p:8080' }, providers: { copilot: { githubToken: 'gho_abc' } }, theme: 'dark' };
  const catalog = [{ id: 'claude-opus-5-5', harnesses: ['claude'] }, { id: 'copilot-claude-opus-5-5', custom: 'global', bridged: 'copilot', upstreamModel: 'claude-opus-5.5', harnesses: ['claude'] },
    { id: 'my-local-model', custom: 'global', harnesses: ['claude'] }];
  const { doc, text, warnings } = buildTeamSetup({ settings, catalog });
  assert.equal(checkTeamSetup(JSON.parse(text)).ok, true);
  assert.deepEqual(doc.fields['models.roles'].value, { claude: { deep: { model: 'claude-opus-5-5', effort: 'high' } } });
  assert.deepEqual(warnings, ['models.roles.claude.quick: my-local-model is not a model every machine knows — left out']);
  assert.deepEqual(doc.fields['setup.smartNaming'].value, settings.smartNaming);   // every stored key survives
  assert.ok(Object.keys(doc.fields).every((k) => TEAM_SETUP_KEYS.includes(k)));
  assert.doesNotMatch(text, /networkProxy|providers|githubToken|gho_|p:8080|theme|my-local-model/);
});

test('SHARE_SETTING_KEYS lists only modelRoles and the work fields', () => {
  assert.deepEqual([...SHARE_SETTING_KEYS].sort(), ['autoGeneratePrDescription', 'costLimitResetPeriod', 'hideBuiltinModels', 'modelRoles', 'networkWait',
    'pipelineCostLimitUsd', 'runEngine', 'smartNaming', 'sync', 'totalCostLimitUsd', 'uiLevel']);
});

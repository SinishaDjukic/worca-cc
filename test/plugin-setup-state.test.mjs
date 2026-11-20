// test/plugin-setup-state.test.mjs — "Needs setup" (CONTRACT §1.1 `setup`, S3 G11): which required fields are still empty.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useTempHome } from './helpers/temp-home.mjs';
import { checkRows } from './helpers/rows.mjs';
import { normalizeManifest } from '../src/core/plugin-manifest.mjs';
import { writePluginConfig, createProfile } from '../src/core/plugin-config.mjs';
import { writePluginsLock, readPluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { pluginSetupState, pluginHasSettings } from '../src/core/plugin-setup-state.mjs';
import { listInstalledPlugins } from '../src/core/plugin-store.mjs';

useTempHome(after);
const SRC = (extra) => ({ id: 'src', module: './index.mjs', inputs: [{ key: 'task', type: 'task-browser' }], ...extra });
const man = (raw) => { const r = normalizeManifest({ name: 'p', ...raw }); assert.ok(r.ok, JSON.stringify(r.errors)); return r.manifest; };
const OK = { ok: true, missing: [], noProfiles: [] };

test('pluginSetupState: required fields still empty per task source, profile and chat channel; model secrets unless the broker holds them; keys only', async () => {
  await checkRows([
    { name: 'a required task-source secret is missing until saved; the saved value never shows', run: () => {
      const m = man({ taskSources: [SRC({ configSchema: [{ key: 'token', secret: true, required: true }, { key: 'base' }] })] });
      assert.deepEqual(pluginSetupState('ts-plugin', m, { broker: false }), { ok: false, missing: [{ kind: 'taskSource', id: 'src', keys: ['token'] }], noProfiles: [] });
      writePluginConfig('ts-plugin', m.taskSources[0].configSchema, { token: 'sekret-123' });
      const s = pluginSetupState('ts-plugin', m, { broker: false });
      assert.deepEqual(s, OK);
      assert.ok(!JSON.stringify(s).includes('sekret-123'));
    } },
    { name: 'an {"$env"} value counts only while that variable is set', run: () => {
      const m = man({ taskSources: [SRC({ configSchema: [{ key: 'token', secret: true, required: true }] })] });
      writePluginConfig('env-plugin', m.taskSources[0].configSchema, { token: { $env: 'P1_SETUP_STATE_TOKEN' } });
      delete process.env.P1_SETUP_STATE_TOKEN;
      assert.equal(pluginSetupState('env-plugin', m, { broker: false }).ok, false);
      process.env.P1_SETUP_STATE_TOKEN = 'x';
      try { assert.deepEqual(pluginSetupState('env-plugin', m, { broker: false }), OK); } finally { delete process.env.P1_SETUP_STATE_TOKEN; }
      process.env.P1_SETUP_STATE_TOKEN = '';
      try {
        assert.equal(pluginSetupState('env-plugin', m, { broker: false }).ok, false, 'a variable set to "" is still empty (the chat host\'s rule)');
      } finally { delete process.env.P1_SETUP_STATE_TOKEN; }
    } },
    { name: 'multiProfile: no profile yet is noProfiles; a profile missing a required key is listed with that profile', run: () => {
      const m = man({ taskSources: [SRC({ multiProfile: true, configSchema: [{ key: 'pat', secret: true, required: true }] })] });
      assert.deepEqual(pluginSetupState('mp-plugin', m, { broker: false }), { ok: false, missing: [], noProfiles: ['src'] });
      createProfile('mp-plugin', 'work', 'Work');
      assert.deepEqual(pluginSetupState('mp-plugin', m, { broker: false }).missing, [{ kind: 'taskSource', id: 'src', profile: 'work', keys: ['pat'] }]);
      writePluginConfig('mp-plugin', m.taskSources[0].configSchema, { pat: 'x' }, 'work');
      assert.deepEqual(pluginSetupState('mp-plugin', m, { broker: false }), OK);
    } },
    { name: 'a chat channel lists its empty required keys; a select default counts as set', run: () => {
      const m = man({ chatChannels: [{ id: 'main', platform: 'slack', module: './w.mjs', configSchema: [{ key: 'botToken', secret: true, required: true },
        { key: 'tenantType', type: 'select', required: true, default: 'multi-tenant', options: ['multi-tenant', 'single-tenant'] }] }] });
      assert.deepEqual(pluginSetupState('ch-plugin', m, { broker: false }).missing, [{ kind: 'chatChannel', id: 'main', keys: ['botToken'] }]);
    } },
    { name: 'model secrets are missing until set — never while the credential broker is on', run: () => {
      const m = man({ modelSecrets: [{ key: 'ds-token', label: 'DS token' }], models: [{ id: 'ds', env: { ANTHROPIC_AUTH_TOKEN: { secret: 'ds-token' } } }] });
      assert.deepEqual(pluginSetupState('ms-plugin', m, { broker: false }).missing, [{ kind: 'modelSecrets', id: 'modelSecrets', keys: ['ds-token'] }]);
      assert.deepEqual(pluginSetupState('ms-plugin', m, { broker: true }), OK);
      const saved = process.env.WORCA_BROKER_URL;
      try {
        delete process.env.WORCA_BROKER_URL;
        assert.equal(pluginSetupState('ms-plugin', m).ok, false, 'rows pass no { broker }: the host decides, and this host has no broker');
        process.env.WORCA_BROKER_URL = 'http://127.0.0.1:9';
        assert.deepEqual(pluginSetupState('ms-plugin', m), OK, 'a host with the credential broker on');
      } finally {
        if (saved === undefined) delete process.env.WORCA_BROKER_URL; else process.env.WORCA_BROKER_URL = saved;
      }
    } },
    { name: 'nothing to set up (MCP-only, agents-only) and an optional token both read ok', run: () => {
      assert.deepEqual(pluginSetupState('none-plugin', man({}), { broker: false }), OK);
      assert.deepEqual(pluginSetupState('opt-plugin', man({ taskSources: [SRC({ configSchema: [{ key: 'token', secret: true }] })] }), { broker: false }), OK);
    } },
    { name: 'listInstalledPlugins rows carry the same setup state', run: () => {
      const raw = { name: 'row-setup', version: '0.1.0', taskSources: [SRC({ configSchema: [{ key: 'token', secret: true, required: true }] })] };
      mkdirSync(pluginCurrentDir('row-setup'), { recursive: true });
      writeFileSync(join(pluginCurrentDir('row-setup'), 'worca-cc-plugin.json'), JSON.stringify(raw));
      writePluginsLock({ ...readPluginsLock(), 'row-setup': { repo: null, subdir: '', pinnedSha: null, version: '0.1.0', enabled: true, installedAt: 'x', linked: true } });
      const row = listInstalledPlugins().find((p) => p.name === 'row-setup');
      assert.deepEqual(row.setup, { ok: false, missing: [{ kind: 'taskSource', id: 'src', keys: ['token'] }], noProfiles: [] });
    } },
    { name: 'pluginHasSettings: a source or channel with config fields, or model secrets unless the broker holds them', run: () => {
      assert.equal(pluginHasSettings(man({}), { broker: false }), false, 'nothing to set');
      assert.equal(pluginHasSettings(man({ taskSources: [SRC()] }), { broker: false }), false, 'a source with no fields shows no Settings');
      assert.equal(pluginHasSettings(man({ taskSources: [SRC({ configSchema: [{ key: 'base' }] })] }), { broker: false }), true);
      const chan = man({ chatChannels: [{ id: 'slack', module: './chat.mjs', platform: 'slack', displayName: 'Slack',
        capabilities: { inbound: true, outbound: true }, configSchema: [{ key: 'botToken', secret: true, required: true }] }] });
      assert.equal(pluginHasSettings(chan, { broker: false }), true);
      const secrets = man({ modelSecrets: [{ key: 'API_KEY', label: 'API key' }] });
      assert.equal(pluginHasSettings(secrets, { broker: false }), true);
      assert.equal(pluginHasSettings(secrets, { broker: true }), false, 'the broker holds model keys: only a chip, no fields');
      assert.equal(pluginHasSettings(null), false);
    } },
    { name: 'listInstalledPlugins rows carry hasSettings', run: () => {
      const raw = { name: 'row-has-settings', version: '0.1.0', taskSources: [SRC({ configSchema: [{ key: 'base' }] })] };
      mkdirSync(pluginCurrentDir('row-has-settings'), { recursive: true });
      writeFileSync(join(pluginCurrentDir('row-has-settings'), 'worca-cc-plugin.json'), JSON.stringify(raw));
      const bare = { name: 'row-no-settings', version: '0.1.0' };
      mkdirSync(pluginCurrentDir('row-no-settings'), { recursive: true });
      writeFileSync(join(pluginCurrentDir('row-no-settings'), 'worca-cc-plugin.json'), JSON.stringify(bare));
      const lock = (v) => ({ repo: null, subdir: '', pinnedSha: null, version: v, enabled: true, installedAt: 'x', linked: true });
      writePluginsLock({ ...readPluginsLock(), 'row-has-settings': lock('0.1.0'), 'row-no-settings': lock('0.1.0') });
      const rows = listInstalledPlugins();
      assert.equal(rows.find((p) => p.name === 'row-has-settings').hasSettings, true);
      assert.equal(rows.find((p) => p.name === 'row-no-settings').hasSettings, false);
    } },
  ]);
});

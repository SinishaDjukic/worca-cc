// test/plugin-mcp-lifecycle.test.mjs — plugin install / link / disable / uninstall against
// the MCP store (MCP registry spec §4.4 bases, §4.6 lifecycle). Real express app on an
// ephemeral port (harness = test/api-plugins.test.mjs), a real local git repo, offline.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';
import { useTempHome } from './helpers/temp-home.mjs';
import { writeMcpPlugin } from './helpers/mcp-plugin-fixture.mjs';
import { put, plain, disk, file } from './helpers/mcp-store-fixtures.mjs';
import { linkPlugin, uninstallPlugin } from '../src/core/plugin-store.mjs';
import { readPluginsLock } from '../src/core/plugins-lock.mjs';
import { readMcpStore, withMcpLock } from '../src/core/mcp/store.mjs';
import { reconcileMcpStore } from '../src/core/mcp/catalog.mjs';
import { renderPluginList } from '../ui/public/plugins-view.mjs';

useTempHome(after);
const run = promisify(execFile);
const scratch = mkdtempSync(join(tmpdir(), 'worca-cc-mcp-life-'));
let srv, base, repo, sha;
const JSONH = { 'Content-Type': 'application/json' };
const post = (p, b) => fetch(`${base}${p}`, { method: 'POST', headers: JSONH, body: JSON.stringify(b) });

before(async () => {
  process.env.WORCA_MOCK = '1';
  repo = writeMcpPlugin(join(scratch, 'repo'), { name: 'acme-tools' });
  const git = (...a) => run('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  await run('git', ['init', '-q', '-b', 'main', repo]);
  await git('add', '-A');
  await git('commit', '-qm', 'c1');
  sha = (await git('rev-parse', 'HEAD')).stdout.trim();
  const { app } = await import('../ui/server.mjs');
  srv = http.createServer(app);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(async () => {
  if (srv) await new Promise((r) => srv.close(r));
  delete process.env.WORCA_MOCK;
  rmSync(scratch, { recursive: true, force: true });
});

const member = (server, values = {}) => ({ server, enabled: true, values });
const TEAM_ID = 'team-acme-platform-9333';
const TEST = { at: '2026-09-29T00:00:00Z', ok: true, tools: ['search'], error: null, fingerprint: '0123456789abcdef' };
const secret = (value) => ({ token: { value, updatedAt: '2026-09-29T00:00:00Z' } });

test('install and link persist base names for the plugin\'s servers', async () => {
  const r = await post('/api/plugins/install', { repoUrl: repo, subdir: '', name: 'acme-tools', sha });
  assert.equal(r.status, 200, await r.text());
  await linkPlugin('dev-tools', writeMcpPlugin(join(scratch, 'dev'), { name: 'dev-tools' }));
  assert.deepEqual({ ...(await readMcpStore()).bases }, { 'plugin:acme-tools/jira': 'jira', 'plugin:dev-tools/jira': 'dev-tools-jira' });
});

test('GET /api/plugins names the sets that hold each plugin\'s servers; the Remove button carries them', async () => {
  put('sets', {
    sets: {
      general: { name: 'General', members: [member('plugin:acme-tools/jira')] },
      billing: { name: 'Billing', slug: 'billing', members: [
        member('plugin:acme-tools/jira', { baseUrl: 'https://b.example' }), member('plugin:dev-tools/jira'), member('manual:pg'),
        member('plugin:acme-tools-2/jira')] },
    },
    teams: { 'acme/platform': { id: TEAM_ID, slug: 'team-platfor', name: 'Team · acme/platform',
      members: { 'plugin:acme-tools/jira': { enabled: true, values: {}, seeded: {}, consent: 'h' } } } },
  });
  put('secrets', { sets: {
    billing: { 'plugin:acme-tools/jira': secret('tok-billing-1'), 'plugin:dev-tools/jira': secret('tok-dev-2') },
    [TEAM_ID]: { 'plugin:acme-tools/jira': secret('tok-team-3') },
  } });
  put('tests', { tests: { 'billing|plugin:acme-tools/jira': TEST, [`${TEAM_ID}|plugin:acme-tools/jira`]: TEST,
    'billing|plugin:dev-tools/jira': TEST } });
  const rows = (await (await fetch(`${base}/api/plugins`)).json()).plugins;
  const by = Object.fromEntries(rows.map((p) => [p.name, p]));
  assert.deepEqual(by['acme-tools'].mcpSets, ['Billing', 'General', 'Team · acme/platform']);
  assert.deepEqual(by['dev-tools'].mcpSets, ['Billing']);
  const doc = new JSDOM('<!doctype html><body></body>').window.document;
  const list = renderPluginList(rows, { doc });
  assert.equal(list.querySelector('.pl-remove[data-name="acme-tools"]').dataset.mcpSets, 'Billing, General, Team · acme/platform');
  assert.equal(renderPluginList([{ name: 'x', contributions: {} }], { doc }).querySelector('.pl-remove').dataset.mcpSets, undefined);
  const app = readFileSync(new URL('../ui/public/app.js', import.meta.url), 'utf8');
  const at = app.indexOf("title: 'Uninstall plugin'");
  assert.match(app.slice(at, at + 300), /Its MCP servers leave these sets[^`]*\$\{t\.dataset\.mcpSets\}/, 'the confirm lists them');
});

test('disable, any locked write, re-enable: every membership, value and secret (Team token included) stays', async () => {
  const before = plain(await readMcpStore());
  assert.equal((await post('/api/plugins/acme-tools/enable', { enabled: false })).status, 200);
  await withMcpLock((tx) => tx.write('sets'));   // any write: it sweeps orphans first (§4.5)
  assert.equal((await post('/api/plugins/acme-tools/enable', { enabled: true })).status, 200);
  assert.deepEqual(plain(await readMcpStore()), before);
});

test('applying a plugin update re-tests that plugin\'s memberships', async () => {
  const KEY = 'billing|plugin:acme-tools/jira';   // the membership with its token filled (test 2)
  assert.equal((await readMcpStore()).tests[KEY]?.at, TEST.at);
  const git = (...a) => run('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a]);
  writeFileSync(join(repo, 'CHANGELOG.md'), 'c2\n'); await git('add', '-A'); await git('commit', '-qm', 'c2');
  const { preview } = await (await post('/api/plugins/acme-tools/update', {})).json();
  const r = await post('/api/plugins/acme-tools/update', { confirm: true, sha: preview.candidateSha });
  assert.equal(r.status, 200, await r.text());
  for (const t0 = Date.now(); ;) {
    const t = (await readMcpStore()).tests[KEY];
    if (t && t.at !== TEST.at) break;
    if (Date.now() - t0 > 15000) assert.fail(`no re-test landed: ${JSON.stringify(t)}`);
    await new Promise((res) => setTimeout(res, 25));
  }
});

test('uninstall removes the plugin\'s memberships, Team state, secrets and tests; bases stay reserved', async () => {
  const r = await fetch(`${base}/api/plugins/acme-tools`, { method: 'DELETE' });
  assert.equal(r.status, 200, await r.text());
  const s = await readMcpStore();
  assert.deepEqual(s.sets.general.members, []);
  assert.deepEqual(s.sets.billing.members.map((m) => m.server), ['plugin:dev-tools/jira', 'manual:pg', 'plugin:acme-tools-2/jira'],
    'a plugin whose name extends acme-tools keeps its membership');
  assert.deepEqual(Object.keys(s.teams['acme/platform'].members), []);
  // On disk: readMcpStore() leaves orphans out, so only the files prove the secrets and tests went.
  const secrets = disk('secrets').sets;
  assert.deepEqual(Object.keys(secrets.billing), ['plugin:dev-tools/jira']);
  assert.equal(secrets[TEAM_ID], undefined, 'the Team token is gone, not just hidden');
  assert.deepEqual(Object.keys(disk('tests').tests), ['billing|plugin:dev-tools/jira']);
  assert.equal(s.bases['plugin:acme-tools/jira'], 'jira', 'a later same-named plugin never inherits the base');
});

/** Link a plugin shipping one agent and one v2 workflow template that places it; returns the template id. */
async function linkWorkflowPlugin(name, key) {
  const meta = { metaVersion: 2, key, displayName: key, agentFile: `${key}.md`, runnerType: 'producer',
    inputs: [{ id: 'task', type: 'md' }], outputs: [{ id: 'plan', type: 'md', filename: '{base}.md' }] };
  const tpl = { name: key, version: 2, domain: 'general',
    nodes: [{ id: 'n_task', kind: 'task', x: 0, y: 0, config: {} }, { id: 'n_a', kind: 'agent', key, x: 200, y: 0, config: {} },
      { id: 'n_end', kind: 'end', x: 400, y: 0, config: {} }],
    wires: [{ id: 'w1', from: { node: 'n_task', port: 'task' }, to: { node: 'n_a', port: 'task' } },
      { id: 'w2', from: { node: 'n_a', port: 'plan' }, to: { node: 'n_end', port: 'result' } }] };
  const dir = writeMcpPlugin(join(scratch, name), { name, files: {
    [`agents/${key}.md`]: `# ${key}\n`, [`agents/${key}.meta.json`]: JSON.stringify(meta), [`workflows/${key}.json`]: JSON.stringify(tpl) } });
  return (await linkPlugin(name, dir)).workflows.imported[0];
}

test('an uninstall refused by a reference guard keeps every MCP membership', async () => {
  // The LAST guard (removePluginWorkflows refuses while a project pins an imported template),
  // so the MCP removal is pinned after every guard.
  const wf = await linkWorkflowPlugin('held-tools', 'heldAgent');
  const { setActiveWorkflow } = await import('../src/core/config.mjs');
  await setActiveWorkflow(mkdtempSync(join(scratch, 'proj-')), wf);
  put('sets', { sets: { general: { name: 'General', members: [member('plugin:held-tools/jira')] } } });
  await assert.rejects(() => uninstallPlugin('held-tools'), /still referenced/);
  assert.deepEqual((await readMcpStore()).sets.general.members.map((m) => m.server), ['plugin:held-tools/jira']);
});

// sets.json first: readMcpStore() reads it damaged as EMPTY, so a pre-flight decided from that
// read sees no membership, lets the uninstall through, and the rows come back once the file is fixed.
for (const [name, key] of [['sets', 'dmgSetsAgent'], ['secrets', 'dmgSecretsAgent']]) {
  test(`a damaged mcp/${name}.json refuses the uninstall before the plugin's templates go`, async () => {
    const plugin = `dmg-${name}`;
    const id = `plugin:${plugin}/jira`;
    const wf = await linkWorkflowPlugin(plugin, key);
    const healthy = {
      sets: { sets: { general: { name: 'General', members: [member(id)] } } },
      secrets: { sets: { general: { [id]: secret('tok-dmg-5') } } },
    };
    put('sets', healthy.sets);
    put('secrets', healthy.secrets);
    const damaged = `${readFileSync(file(name), 'utf8').trimEnd().slice(0, -1)}, }`;   // a trailing comma
    writeFileSync(file(name), damaged);
    const { readWorkflow } = await import('../src/core/workflows.mjs');
    await assert.rejects(() => uninstallPlugin(plugin), new RegExp(`mcp/${name}\\.json is damaged`));
    assert.ok(await readWorkflow(wf), 'refused before removePluginWorkflows: the template stays');
    assert.equal(readFileSync(file(name), 'utf8'), damaged, 'the damaged file is left for the user to fix');
    put(name, healthy[name]);   // fixed: the uninstall completes
    await uninstallPlugin(plugin);
    assert.equal(await readWorkflow(wf), null);
    assert.deepEqual(disk('sets').sets?.general?.members ?? [], []);
    assert.equal(disk('secrets').sets.general, undefined, 'no saved token is left for a later same-named plugin');
  });
}

test('a damaged registry file never blocks an uninstall it holds nothing for', async () => {
  // The pre-flight reads sets.json's text: no `plugin:bystander-tools` in it, nothing to write.
  for (const name of ['sets', 'secrets']) {
    put('sets', { sets: { general: { name: 'General', members: [member('manual:pg')] } } });
    put('secrets', { sets: {} });
    await linkPlugin('bystander-tools', writeMcpPlugin(join(scratch, 'bystander'), { name: 'bystander-tools' }));
    const damaged = `${readFileSync(file(name), 'utf8').trimEnd().slice(0, -1)}, }`;   // a trailing comma
    writeFileSync(file(name), damaged);
    await uninstallPlugin('bystander-tools');
    assert.equal(readPluginsLock()['bystander-tools'], undefined, `uninstalled with a damaged mcp/${name}.json`);
    assert.equal(readFileSync(file(name), 'utf8'), damaged, 'and nothing was written');
  }
});

test('an escaped id counts as named, and a sets.json that cannot be read refuses the uninstall', async () => {
  put('sets', { sets: {} });
  put('secrets', { sets: {} });
  await linkPlugin('esc-tools', writeMcpPlugin(join(scratch, 'esc'), { name: 'esc-tools' }));
  const BS = String.fromCharCode(92);   // a JSON escape spells the id without its plain text
  writeFileSync(file('sets'), `{"schema":1,"sets":{"general":{"name":"General","members":[{"server":"plugin:esc${BS}u002dtools/jira","enabled":true,"values":{}}]}},}`);
  await assert.rejects(() => uninstallPlugin('esc-tools'), /mcp\/sets\.json is damaged/);
  if (process.platform !== 'win32') {
    rmSync(file('sets'));
    symlinkSync(join(scratch, 'moved-away', 'sets.json'), file('sets'));   // dangling: the strict load reads it as absent
    await assert.rejects(() => uninstallPlugin('esc-tools'), /mcp\/sets\.json cannot be read \(ENOENT\)/);
  }
  rmSync(file('sets'));
  await uninstallPlugin('esc-tools');
  assert.equal(readPluginsLock()['esc-tools'], undefined);
});

test('a registry that cannot be written never fails a link: it lands, warns, and a reconcile names its servers later', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  writeFileSync(file('secrets'), '{"schema":1,"sets":{},}');   // damaged: every locked write refuses
  await linkPlugin('warn-tools', writeMcpPlugin(join(scratch, 'warn'), { name: 'warn-tools' }));
  assert.ok(readPluginsLock()['warn-tools'], 'the link landed');
  assert.ok(warn.mock.calls.some((c) => /^\[plugin-store\] warn-tools: MCP server names not saved \(MCP registry file mcp\/secrets\.json is damaged/
    .test(String(c.arguments[0]))), 'and said why');
  assert.equal((await readMcpStore()).bases['plugin:warn-tools/jira'], undefined);
  put('secrets', { sets: {} });   // fixed
  await reconcileMcpStore();
  assert.equal((await readMcpStore()).bases['plugin:warn-tools/jira'], 'warn-tools-jira');
  await uninstallPlugin('warn-tools');
});

test('a newer MCP registry never blocks an uninstall, and is never written', async () => {
  await linkPlugin('newer-tools', writeMcpPlugin(join(scratch, 'newer'), { name: 'newer-tools' }));
  const newer = JSON.stringify({ schema: 2, sets: { general: { name: 'General', members: [member('plugin:newer-tools/jira')] } } });
  writeFileSync(file('sets'), newer);
  await uninstallPlugin('newer-tools');
  assert.equal(readFileSync(file('sets'), 'utf8'), newer);
  rmSync(file('sets'));
});

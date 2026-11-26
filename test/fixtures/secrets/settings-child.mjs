// test/fixtures/secrets/settings-child.mjs — a spawned process that saves provider and model keys through the real
// settings setters, for the cross-process, locked-after-vaulting and flag-off tests. It imports only settings.mjs
// statically: the vault and the OS store load only through its flag-gated dynamic imports.
//   save-settings-keys --value V   updateProvider('openai'), addGlobalModel / updateGlobalModel (child-bridged's
//                                  upstream.apiKey, child-env's env.ANTHROPIC_AUTH_TOKEN) and updateOpenRouter, all
//                                  with V; prints nothing secret
//   save-and-delete-store-secrets --value V
//                                  the MCP, plugin and proxy stores' saves and deletes with V (Date pinned), each store
//                                  left with one surviving secret record; loads those stores by dynamic import() in its
//                                  own branch, so the other commands' import sets do not change; prints `saved`
//   seed-plugin-secret --plugin NAME --key KEY --value V
//                                  writePluginConfig(NAME, [{ KEY secret required }], { KEY: V }); prints `saved`
//   seed-literals [--tag T]        file-stored secrets in all four stores (test/helpers/secret-literals.mjs, raw JSON at
//                                  0600, dev's shapes; T marks the values); prints `seeded`
//   migrate                        the CLI's start: the prime, then the migration gate with `deployment` from
//                                  WORCA_TEST_DEPLOYMENT, else the CLI's own detectDeployment expression (flag on only);
//                                  prints the result as one JSON line
//   resolve-all [--tag T]          the CLI's prime, then every seeded slot (secret-literals.mjs) read from its file and,
//                                  when it holds a reference, resolved through the sync reader; prints `{ id: value|null }`
//   save-plain --value V           a new OpenAI key, a new MCP secret (server manual:gh), a new plugin secret (plugin
//                                  vault-c) and a new proxy login, each with V, through the stores' own setters; prints `saved`
//   export [--yes]                 exportSecrets with confirm() answering `--yes`; prints the result as one JSON line
import { addGlobalModel, listGlobalModels, primeSettingsVaultIfEnabled, updateGlobalModel, updateOpenRouter, updateProvider } from '../../../src/core/settings.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf(`--${name}`); return i < 0 ? undefined : rest[i + 1]; };

if (cmd === 'save-settings-keys') {
  const value = opt('value');
  await updateProvider('openai', { apiKey: value });
  const models = {
    'child-bridged': { upstream: { provider: 'openai', api: 'openai-chat', model: 'gpt-child', apiKey: value } },
    'child-env': { env: { ANTHROPIC_AUTH_TOKEN: value, ANTHROPIC_BASE_URL: 'https://gateway.example.test' } },
  };
  for (const [id, model] of Object.entries(models)) {
    if (listGlobalModels().some((m) => m.id === id)) await updateGlobalModel(id, model);
    else await addGlobalModel({ id, ...model });
  }
  await updateOpenRouter({ apiKey: value });
  console.log('saved');
} else if (cmd === 'save-and-delete-store-secrets') {
  const value = opt('value');
  const FIXED = Date.parse('2026-01-02T03:04:05.000Z');
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [FIXED])); }
    static now() { return FIXED; }
  };
  const mcp = await import('../../../src/core/mcp/store.mjs');
  const { validateMcpDefinition } = await import('../../../src/core/mcp/definitions.mjs');
  const pg = validateMcpDefinition({ type: 'stdio', command: 'npx', args: ['-y', 'pg-mcp'], env: { PGPASSWORD: { field: 'password' } },
    fields: [{ key: 'password', secret: true, required: true }], description: '' }, { name: 'pg', source: 'manual' }).def;
  await mcp.addManualServer('pg', pg);
  await mcp.addManualServer('gh', pg);
  await mcp.createSet('Billing');
  for (const set of ['general', 'billing']) await mcp.putMember(set, 'manual:pg', { enabled: true, secrets: { password: value } }, { def: pg });
  await mcp.putMember('general', 'manual:gh', { enabled: true, secrets: { password: value } }, { def: pg });
  await mcp.duplicateSet('billing', 'Billing copy');
  await mcp.deleteSet('billing');
  await mcp.removeServerEverywhere('manual:gh');
  const plugin = await import('../../../src/core/plugin-config.mjs');
  const { purgePluginData } = await import('../../../src/core/plugin-store.mjs');
  const schema = [{ key: 'token', secret: true, required: true }];
  plugin.createProfile('vault-a', 'work', 'Work');
  plugin.createProfile('vault-a', 'client', 'Client');
  await plugin.writePluginConfig('vault-a', schema, { token: value }, 'work');
  await plugin.writePluginConfig('vault-a', schema, { token: value }, 'client');
  await plugin.deleteProfile('vault-a', 'client');
  await plugin.writePluginConfig('vault-b', schema, { token: value });
  await purgePluginData('vault-b');
  const proxy = await import('../../../src/core/proxy-credentials.mjs');
  const newId = () => 'a1b2c3d4e5f60718';
  const first = await proxy.saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: value }, { newId });
  proxy.markLoginRejected(first.id, { upstream: 'proxy.example.test:8080' });
  await proxy.clearProxyLogin();
  await proxy.saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: value }, { newId });
  console.log('saved');
} else if (cmd === 'seed-plugin-secret') {
  const { writePluginConfig } = await import('../../../src/core/plugin-config.mjs');
  const key = opt('key');
  await writePluginConfig(opt('plugin'), [{ key, secret: true, required: true }], { [key]: opt('value') });
  console.log('saved');
} else if (cmd === 'seed-literals') {
  const { seedLiterals } = await import('../../helpers/secret-literals.mjs');
  const { worcaHome } = await import('../../../src/core/projects.mjs');
  seedLiterals({ home: process.env.HOME, worca: worcaHome(), tag: opt('tag') ?? 'a' });
  console.log('seeded');
} else if (cmd === 'migrate') {
  await primeSettingsVaultIfEnabled();
  const { migrateSecretsIfEnabled, secretVaultEnabled } = await import('../../../src/core/secrets/flag.mjs');
  let deployment = process.env.WORCA_TEST_DEPLOYMENT;
  if (!deployment && secretVaultEnabled()) {
    const { detectDeployment } = await import('../../../src/core/deployment.mjs');
    const { isRemoteMode, readRemoteAccessConfig } = await import('../../../src/core/remote-access.mjs');
    deployment = detectDeployment(process.env, { remoteMode: isRemoteMode(readRemoteAccessConfig(process.env)) });
  }
  console.log(JSON.stringify(await migrateSecretsIfEnabled({ deployment, reason: 'cli' })));
} else if (cmd === 'resolve-all') {
  await primeSettingsVaultIfEnabled();
  const { secretSlots, secretFiles } = await import('../../helpers/secret-literals.mjs');
  const { worcaHome } = await import('../../../src/core/projects.mjs');
  const { isVaultRef } = await import('../../../src/core/secrets/refs.mjs');
  const { resolveVaultRefSync } = await import('../../../src/core/secrets/settings-resolver.mjs');
  const { readFileSync } = await import('node:fs');
  const files = secretFiles(process.env.HOME, worcaHome());
  const out = {};
  for (const slot of secretSlots(opt('tag') ?? 'a')) {
    const raw = slot.path.reduce((x, k) => (x == null ? undefined : x[k]), JSON.parse(readFileSync(files[slot.file], 'utf8')));
    if (!isVaultRef(raw)) { out[slot.id] = raw ?? null; continue; }
    const got = resolveVaultRefSync(raw, { store: slot.store, field: slot.field });
    out[slot.id] = got.code ? null : got.value;
  }
  console.log(JSON.stringify(out));
} else if (cmd === 'save-plain') {
  const value = opt('value');
  await primeSettingsVaultIfEnabled();
  await updateProvider('openai', { apiKey: value });
  const mcp = await import('../../../src/core/mcp/store.mjs');
  const { validateMcpDefinition } = await import('../../../src/core/mcp/definitions.mjs');
  const gh = validateMcpDefinition({ type: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], env: { GH_TOKEN: { field: 'password' } },
    fields: [{ key: 'password', secret: true, required: true }], description: '' }, { name: 'gh', source: 'manual' }).def;
  await mcp.addManualServer('gh', gh);
  await mcp.putMember('general', 'manual:gh', { enabled: true, secrets: { password: value } }, { def: gh });
  const plugin = await import('../../../src/core/plugin-config.mjs');
  await plugin.writePluginConfig('vault-c', [{ key: 'token', secret: true, required: true }], { token: value });
  const proxy = await import('../../../src/core/proxy-credentials.mjs');
  await proxy.saveProxyLogin({ domain: 'ACME', user: 'jdoe', password: value }, { newId: () => 'b1b2c3d4e5f60718' });
  console.log('saved');
} else if (cmd === 'export') {
  const { exportSecrets } = await import('../../../src/core/secrets/export.mjs');
  const yes = rest.includes('--yes');
  const r = await exportSecrets({ confirm: async () => yes });
  console.log(JSON.stringify(r));
} else {
  console.error(`settings-child: unknown command ${cmd}`);
  process.exit(2);
}

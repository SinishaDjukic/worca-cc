// test/helpers/marketplace-manage-fixtures.mjs — board 3.3's github-source as an Installed row (P1 §1.1), its detail
// (P1 §1.2), its Doctor checks (S3 §3.5) and its config payload (S3 §1.1), for P6's tests.
export const SHA = `d12b77f${'c'.repeat(33)}`;
export const ROW = { name: 'github-source', version: '0.2.0', pinnedSha: SHA, repo: 'https://github.com/SinishaDjukic/worca-cc',
  subdir: 'plugins/github-source', marketplace: 'wcc', marketplaceName: 'Worca CC Official', enabled: true, linked: false,
  broken: false, contributions: { taskSources: 1, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0 },
  latest: { version: '0.3.0', sha: `9e41a0c${'d'.repeat(33)}`, marketplace: 'wcc', access: [] },
  setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ignored: [] };
export const INVENTORY = { taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: ['token'] }], chatChannels: [],
  mcpServers: [], models: [], modelSecrets: [], agents: [], scripts: [], skills: [], workflows: [], depCount: 0, setupCommands: [] };
export const DETAIL = { plugin: ROW, inventory: INVENTORY, repo: ROW.repo, subdir: ROW.subdir, sha: SHA,
  installedAt: '2026-10-01T00:00:00.000Z', updatedAt: null, webUrl: `https://github.com/SinishaDjukic/worca-cc/tree/${SHA}/plugins/github-source` };
export const CHECKS = [
  ['installed', 'lockfile entry present'], ['current', '…/github-source/d12b77f'], ['manifest', 'plugin "github-source"'],
  ['api', 'requires ">=1 <2", host APIs [1, 2, 3, 4, 5]'], ['module:github', './connector/index.mjs'],
  ['agents-api', 'agents and pipeline templates are plugin API 3'], ['contributions', 'every shipped contribution loaded'],
  ['config:github', 'validateConfig ok'],
].map(([id, detail]) => ({ id, ok: true, detail }));
export const CONFIG = { sources: [{ id: 'github', multiProfile: false, profile: null, profiles: [],
  schema: [
    { key: 'token', type: 'text', label: 'GitHub token', secret: true, required: false, default: null, help: null, options: [] },
    { key: 'closeOnDone', type: 'select', label: 'Close issue on completion', secret: false, required: false, default: 'no',
      help: null, options: [{ value: 'no', label: 'no' }, { value: 'yes', label: 'yes' }] }],
  values: { token: { set: true }, closeOnDone: 'no' } }], channels: [] };

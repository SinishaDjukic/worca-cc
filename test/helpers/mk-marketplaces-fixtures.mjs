// test/helpers/mk-marketplaces-fixtures.mjs — P7 marketplace entries as GET /api/marketplaces answers after P2.
export const NOTE0 = 'plugins/discretestack-models/worca-cc-plugin.json: models[0] ("discretestack-stable"): env key "CLAUDE_CODE_SUBAGENT_MODEL" is reserved — ignored';
export const SKIP = 'worca-cc-marketplace.json: plugins/x/worca-cc-plugin.json not found in repo — skipped';
const inv = (o) => ({ agents: [], scripts: [], taskSources: [], chatChannels: [], models: [], modelSecrets: [], mcpServers: [],
  skills: [], workflows: [], depCount: 0, setupCommands: [], ...o });
export const OFFICIAL = {
  id: 'github.com-SinishaDjukic-worca-cc-1a2b3c4d', name: 'Worca CC Official', url: 'https://github.com/SinishaDjukic/worca-cc',
  ref: 'dev', builtin: true, description: '', addedAt: '2026-01-01T12:00:00Z',
  lastSync: { sha: '735b354c0ffee000000000000000000000000000', at: '2026-10-20T11:57:00Z' }, lastError: null, warnings: [],
  plugins: [
    { name: 'github-source', subdir: 'plugins/github-source', version: '0.3.0', description: 'Pull tasks from GitHub Issues, write results back',
      inventory: inv({ taskSources: [{ id: 'github', displayName: 'GitHub Issues', secrets: ['token'] }] }), installed: true, notes: [] },
    { name: 'atlassian-mcp', subdir: 'plugins/atlassian-mcp', version: '0.2.0', description: 'Atlassian Rovo MCP server',
      inventory: inv({ mcpServers: [{ name: 'atlassian', type: 'http', url: 'https://mcp.atlassian.com/v1/sse' }] }), installed: true, notes: [] },
    { name: 'slack-chat', subdir: 'plugins/slack-chat', version: '0.1.0', description: 'Two-way Slack channel',
      inventory: inv({ chatChannels: [{ id: 'slack', displayName: 'Slack', platform: 'slack', ingress: 'connect', inbound: true, outbound: true, secrets: ['botToken', 'appToken'] }] }),
      installed: false, notes: [] },
  ],
};
export const BD = {
  id: 'github.com-BD-AI-SDLC-worca-marketplace-8d59be17', name: 'BD-AI-SDLC/worca-marketplace', url: 'https://github.com/BD-AI-SDLC/worca-marketplace',
  description: '', addedAt: '2026-09-01T12:00:00Z',
  lastSync: { sha: '16b6363deadbeef000000000000000000000000000', at: '2026-09-03T12:00:00Z' },
  lastError: { message: 'HTTP 403', code: 'UNREACHABLE', at: '2026-10-20T11:59:00Z' },
  warnings: ['last sync 2026-09-03; refresh failed: HTTP 403', NOTE0, SKIP],
  plugins: [
    { name: 'bmf-models', subdir: 'plugins/bmf-models', version: '0.2.0', description: 'BMF Models',
      inventory: inv({ models: [1, 2, 3, 4, 5].map((i) => ({ id: `bmf-${i}`, label: `BMF ${i}`, efforts: [], engine: 'claude', envKeys: [], baseUrl: null })) }),
      installed: false, notes: [] },
    { name: 'discretestack-models', subdir: 'plugins/discretestack-models', version: '0.4.0', description: 'Discretestack models',
      inventory: inv({ models: [{ id: 'discretestack-stable' }, { id: 'discretestack-stable-fast' }] }), installed: true, notes: [NOTE0] },
    { name: 'jira-source', subdir: 'plugins/jira-source', version: '1.0.0', description: 'Pull tasks from Jira',
      inventory: inv({ taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['pat'] }] }), installed: false, notes: [] },
  ],
};
export const LOCAL = { id: 'Users-dp-mkt-0badf00d', name: 'dp/mkt', url: '/Users/dp/mkt', lastSync: null, lastError: null, warnings: [], plugins: [] };
export const GITLAB = { id: 'gitlab.com-a-m-12345678', name: 'a/m', url: 'https://gitlab.com/a/m', needsGit: true, lastSync: null, lastError: null, warnings: [], plugins: [] };
/** An installed row as GET /api/plugins answers after P1. */
export const row = (name, o = {}) => ({ name, version: '1.0.0', pinnedSha: 'a'.repeat(40), repo: null, subdir: '', marketplace: null,
  marketplaceName: null, enabled: true, linked: false, broken: false, apiMismatch: null, ignored: [], scriptRuntimes: {},
  contributions: { agents: 0, scripts: 0, taskSources: 1, chatChannels: 0, models: 0, mcpServers: 0, skills: 0, workflows: 0 },
  pythonMissing: false, mcpSets: [], skillSets: [], description: null, ref: null, latest: null,
  setup: { ok: true, missing: [], noProfiles: [] }, notes: [], ...o });

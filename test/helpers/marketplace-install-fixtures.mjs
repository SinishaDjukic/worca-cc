// test/helpers/marketplace-install-fixtures.mjs — P4: CatalogItems (CONTRACT §3.4) for the install sheet, the config
// payloads (GET /api/plugins/:name/config, S3 §1.1 + P1's `advanced`) they set up with, and a fake page + api.
export const SHA = '735b354' + 'c'.repeat(33);
export const INV = (o = {}) => ({ agents: [], scripts: [], taskSources: [], chatChannels: [], models: [], modelSecrets: [],
  mcpServers: [], skills: [], workflows: [], depCount: null, setupCommands: [], ...o });
const COUNTS = (o = {}) => ({ taskSources: 0, chatChannels: 0, mcpServers: 0, models: 0, agents: 0, scripts: 0, skills: 0, workflows: 0, ...o });
export const OFFICIAL = { id: 'official', name: 'Worca CC Official', stale: false, snapshotAt: '2026-10-20T08:00:00.000Z' };
export function item(name, { inventory = INV(), counts = COUNTS(), iconKind = 'none', version = '0.1.0', description = '',
  marketplace = OFFICIAL, installed = false, repoUrl = 'https://github.com/SinishaDjukic/worca-cc', subdir = `plugins/${name}` } = {}) {
  return { key: `${marketplace.id}/${name}`, name, version, description, marketplace, counts, iconKind, secrets: [], installed,
    row: null, update: null, entry: { name, subdir, description, version, inventory, installed },
    source: { repoUrl, subdir, sha: SHA, webUrl: `${repoUrl}/tree/${SHA}${subdir ? `/${subdir}` : ''}` } };
}
export const SLACK = item('slack-chat', { iconKind: 'chatChannels', counts: COUNTS({ chatChannels: 1 }),
  description: 'Two-way Slack channel via Socket Mode: pipeline notifications + chat commands (/status, /pause, /approve…)',
  inventory: INV({ chatChannels: [{ id: 'main', displayName: 'Slack', platform: 'slack', ingress: 'connect', inbound: true, outbound: true, secrets: ['botToken', 'appToken'] }] }) });
export const ATLASSIAN = item('atlassian-mcp', { iconKind: 'mcpServers', counts: COUNTS({ mcpServers: 1 }),
  inventory: INV({ mcpServers: [{ name: 'atlassian', type: 'http', url: 'https://mcp.atlassian.com/v1/sse' }] }) });
export const AZURE = item('azure-boards-source', { iconKind: 'taskSources', counts: COUNTS({ taskSources: 1 }),
  inventory: INV({ taskSources: [{ id: 'azure', displayName: 'Azure Boards', secrets: ['pat'] }], depCount: 12,
    setupCommands: ['npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev'] }) });
export const F = (key, label, o = {}) => ({ key, type: 'text', label, secret: false, required: false, default: null, help: null, options: [], advanced: false, ...o });
export const SLACK_CONFIG = { sources: [], channels: [{ id: 'main', displayName: 'Slack', platform: 'slack', schema: [
  F('botToken', 'Bot token (xoxb-…)', { secret: true, required: true, help: 'OAuth & Permissions → Bot User OAuth Token.' }),
  F('appToken', 'App-level token (xapp-…)', { secret: true, required: true }),
  F('notifyChatIds', 'Notify channel IDs'), F('allowedChatIds', 'Allowed channel IDs (commands)'),
  F('channelAllowlist', 'Listen filter (optional)', { advanced: true }),
], values: { botToken: { set: false }, appToken: { set: false }, notifyChatIds: null, allowedChatIds: null, channelAllowlist: null } }] };
export const GH_SOURCE = { id: 'github', multiProfile: false, profile: null, profiles: [],
  schema: [F('token', 'GitHub token', { secret: true }), F('closeOnDone', 'Close issue on completion', { type: 'select', default: 'no',
    options: [{ value: 'no', label: 'no' }, { value: 'yes', label: 'yes' }] })],
  values: { token: { set: false }, closeOnDone: 'no' } };
export const AZURE_CONFIG = (profiles = []) => ({ channels: [], sources: [{ id: 'azure', multiProfile: true,
  profile: profiles[0]?.id ?? null, profiles,
  schema: [F('organization', 'Organization', { required: true }), F('pat', 'Personal access token', { secret: true, required: true })],
  values: profiles.length ? { organization: 'acme', pat: { set: true } } : {} }] });
export const EMPTY_CONFIG = { sources: [], channels: [] };
export const MKTS = [{ id: 'official', name: 'Worca CC Official', url: 'https://github.com/SinishaDjukic/worca-cc',
  lastSync: { sha: SHA, at: '2026-10-20T08:00:00.000Z' }, plugins: [], warnings: [] }];
export const ok = (data = { ok: true }) => ({ ok: true, status: 200, data });
/** routes: { 'METHOD /url': (body) => {ok,status,data} | Promise }. Records every call as [method, url, body]. */
export function fakeApi(routes = {}) {
  const calls = [];
  const api = async (method, url, body) => {
    calls.push([method, url, body]);
    const fn = routes[`${method} ${url}`];
    return fn ? fn(body) : { ok: false, status: 404, data: { error: `no route ${method} ${url}` } };
  };
  return { api, calls };
}
export function fakePage({ catalog = [SLACK, ATLASSIAN, AZURE], marketplaces = MKTS } = {}) {
  const calls = [];
  return { calls, state: { tab: 'browse', plugins: [], orphans: [], marketplaces, channelStatus: [], policy: null, catalog,
      filters: { q: '', adds: null, from: null, hideInstalled: false } },
    load: async (o) => { calls.push(['load', o ?? null]); }, setTab: (t) => { calls.push(['setTab', t]); },
    act: (name, ...a) => { calls.push(['act', name, ...a]); }, provide() {}, onChange() {} };
}
export const settle = async (n = 15) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };

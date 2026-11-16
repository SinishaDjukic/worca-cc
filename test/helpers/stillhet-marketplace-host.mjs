// test/helpers/stillhet-marketplace-host.mjs — Stillhet's Marketplace in the live kind (slice 8): dev's GET /api/plugins,
// GET /api/marketplaces and GET /api/plugins/:name/config answers in dev's real shapes (MK_LISTS) for the four states
// (installed, update available, needs set-up, not installed), and a jsdom app host over them that records every request;
// `hold(url)` keeps an answer back until the test releases it.
import { liveHost, LISTS, settle, go, clone, posts, toastText, saidText, closeHosts } from './stillhet-chat-live-host.mjs';
export { settle, go, clone, posts, toastText, saidText, closeHosts };

export const SHA = '1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c', TEAM_SHA = '9a8b7c6d5e4f30219a8b7c6d5e4f30219a8b7c6d', PIN = '0123456789abcdef0123456789abcdef01234567';
const OFFICIAL = 'https://github.com/SinishaDjukic/worca-cc', TEAM = 'https://github.com/team/plugins';
const inv = (o = {}) => ({ agents: [], scripts: [], taskSources: [], chatChannels: [], models: [], modelSecrets: [], mcpServers: [], skills: [], workflows: [], depCount: null, setupCommands: [], ...o });
const counts = (o = {}) => ({ agents: 0, scripts: 0, taskSources: 0, chatChannels: 0, models: 0, mcpServers: 0, skills: 0, workflows: 0, ...o });
const entry = (name, version, inventory, description) => ({ name, subdir: `plugins/${name}`, description, version, notes: [], inventory });
const row = (name, o) => ({ name, version: '0.1.0', pinnedSha: PIN, repo: OFFICIAL, subdir: `plugins/${name}`, marketplace: 'worca-official', enabled: true, linked: false, broken: false, apiMismatch: false,
  scriptRuntimes: {}, ignored: [], hasSettings: true, ref: 'dev', notes: [], latest: null, marketplaceName: 'Worca CC Official', pythonMissing: false, mcpSets: [], skillSets: [], setup: { ok: true, missing: [], noProfiles: [] }, ...o });

const JIRA = inv({ taskSources: [{ id: 'jira', displayName: 'Jira', secrets: ['apiToken'] }] });
const SLACK = inv({ chatChannels: [{ id: 'slack', displayName: 'Slack', platform: 'slack', ingress: 'socket', inbound: true, outbound: true, secrets: ['botToken', 'appToken'] }] });
const SETUP = inv({ taskSources: [{ id: 'seed', displayName: 'Seed tracker', secrets: ['token'] }] });
const READY = inv({ skills: ['tidy'] });
const TOOL = inv({ mcpServers: [{ name: 'team-api', type: 'http', url: 'https://x' }, { name: 'team-docs', type: 'http', url: 'https://y' }] });

// dev's GET answers, by URL
export const MK_LISTS = Object.freeze({
  '/api/marketplaces': { marketplaces: [
    { id: 'worca-official', url: OFFICIAL, name: 'Worca CC Official', description: 'x', addedAt: '2026-11-01T00:00:00.000Z', lastSync: { sha: SHA, at: '2026-11-14T10:00:00.000Z' }, warnings: [], ref: 'dev', builtin: true, lastError: null,
      plugins: [{ ...entry('slack-chat', '0.2.0', SLACK, 'Talk to Worca from Slack.'), installed: false }, { ...entry('jira-source', '0.2.0', JIRA, 'Pull tasks from Jira issues.'), installed: true },
        { ...entry('seed-setup', '0.1.0', SETUP, 'A tracker that needs its token.'), installed: true }, { ...entry('seed-ready', '0.1.0', READY, 'Asks for nothing.'), installed: false }] },
    { id: 'team-plugins', url: TEAM, name: 'team/plugins', description: '', addedAt: '2026-11-02T00:00:00.000Z', lastSync: { sha: TEAM_SHA, at: '2026-11-14T09:00:00.000Z' }, warnings: [], lastError: null,
      plugins: [{ ...entry('team-tool', '1.0.0', TOOL, 'The team API and its docs.'), installed: false }] },
  ] },
  '/api/plugins': { plugins: [
    row('jira-source', { contributions: counts({ taskSources: 1 }), description: 'Pull tasks from Jira issues.', latest: { version: '0.2.0', sha: SHA, marketplace: 'worca-official', access: [] } }),
    row('seed-setup', { contributions: counts({ taskSources: 1 }), description: 'A tracker that needs its token.', setup: { ok: false, missing: [{ kind: 'taskSource', id: 'seed', keys: ['token'] }], noProfiles: [] } }),
  ], orphans: [] },
  '/api/plugins/jira-source/config': { sources: [{ id: 'jira', schema: [{ key: 'apiToken', type: 'text', label: 'Jira API token', secret: true, required: true, advanced: false, default: null, help: null, options: [] }, { key: 'site', type: 'text', label: 'Jira site', secret: false, required: true, advanced: false, default: null, help: null, options: [] }, { key: 'jql', type: 'text', label: 'Filter', secret: false, required: false, advanced: true, default: null, help: null, options: [] }], multiProfile: false, profile: null, profiles: [], values: { apiToken: { set: true }, site: 'acme.atlassian.net' } }], channels: [] },
  '/api/plugins/seed-setup/config': { sources: [{ id: 'seed', schema: [{ key: 'token', type: 'text', label: 'Seed token', secret: true, required: true, advanced: false, default: null, help: null, options: [] }], multiProfile: false, profile: null, profiles: [], values: { token: { set: false } } }], channels: [] },
});
// the update preview dev answers for jira-source (plugin-repo.mjs finishPreview), no new access unless the test says so
export const preview = (access = []) => ({ preview: { pinnedSha: PIN, candidateSha: SHA, pinnedVersion: '0.1.0', candidateVersion: '0.2.0', previewedAt: '2026-11-14T12:00:00.000Z', commits: [{ sha: SHA, subject: 'v0.2.0' }], diffstat: '1 file', diffFull: '', manifestDelta: {}, access } });

/** The live app host with the Marketplace answers; `read`/`write`/`hold` as liveHost's. */
export async function marketplaceHost({ hash = '#marketplace', read = () => null, write = () => [200, { ok: true }], hold = () => null, lists = MK_LISTS, beforeScripts = () => {} } = {}) {
  const h = await liveHost({ hash: '#chat', lists: { ...LISTS, ...clone(lists) }, read, write, hold, beforeScripts: (win) => { win.open = (...a) => { (win.__opened ||= []).push(a); return null; }; beforeScripts(win); } });
  await go(h.w, hash, 200);
  await settle(200);
  return h;
}

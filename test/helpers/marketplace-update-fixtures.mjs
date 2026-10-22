// test/helpers/marketplace-update-fixtures.mjs — the board 3.2 pair (atlassian-mcp: no new access; github-source:
// a new secret + changed setup) as Installed rows (P1 §1.1) and update previews (P1 §1.4), for P6's tests. A row's
// `latest.sha` is its marketplace's lastSync sha (src/core/plugin-latest.mjs), never the preview's candidateSha.
export const EMPTY_DELTA = { newSecrets: [], newTaskSources: [], newAgents: [], setupChanged: false, newModels: [],
  removedModels: [], envChangedModels: [], newModelSecrets: [], newMcpServers: [], removedMcpServers: [],
  changedMcpServers: [], mcpLines: [], newSkills: [], removedSkills: [], changedSkills: [], skillLines: [],
  newChatChannels: [], newChannelSecrets: [] };
export const MCP_ROW = { name: 'atlassian-mcp', version: '0.1.0', pinnedSha: `2441b36${'a'.repeat(33)}`,
  contributions: { mcpServers: 1 }, latest: { version: '0.1.1', sha: `5e1f0c4${'b'.repeat(33)}`, marketplace: 'wcc', access: [] } };
export const SRC_ROW = { name: 'github-source', version: '0.2.0', pinnedSha: `d12b77f${'c'.repeat(33)}`,
  contributions: { taskSources: 1 }, latest: { version: '0.3.0', sha: `5e1f0c4${'d'.repeat(33)}`, marketplace: 'wcc',
    access: [{ kind: 'secret', id: 'github.webhookSecret', red: true }] } };
export const MCP_PREVIEW = { pinnedSha: MCP_ROW.pinnedSha, candidateSha: `735b354${'b'.repeat(33)}`, pinnedVersion: '0.1.0',
  candidateVersion: '0.1.1', previewedAt: '2026-10-20T10:00:00.000Z', access: [],
  commits: [{ sha: 'e'.repeat(40), subject: 'Bump the server' }, { sha: 'f'.repeat(40), subject: 'Pin npx' }],
  diffstat: ' plugins/atlassian-mcp/worca-cc-plugin.json | 2 +-\n 1 file changed, 1 insertion(+), 1 deletion(-)',
  manifestDelta: EMPTY_DELTA };
export const SRC_PREVIEW = { pinnedSha: SRC_ROW.pinnedSha, candidateSha: `9e41a0c${'d'.repeat(33)}`, pinnedVersion: '0.2.0',
  candidateVersion: '0.3.0', previewedAt: '2026-10-20T10:00:30.000Z',
  access: [{ kind: 'setup', id: null, red: false }, { kind: 'secret', id: 'github.webhookSecret', red: true }],
  commits: [
    { sha: `a91f2c3${'0'.repeat(33)}`, subject: 'Add a label filter to the issue query' },
    { sha: `4be07d1${'0'.repeat(33)}`, subject: 'Write the PR link back to the issue' },
    { sha: `c0d5e88${'0'.repeat(33)}`, subject: 'Verify webhook deliveries' },
  ],
  diffstat: ' plugins/github-source/connector/index.mjs | 98 +++++++----\r\n 4 files changed, 86 insertions(+), 12 deletions(-)',
  manifestDelta: { ...EMPTY_DELTA, newSecrets: ['github.webhookSecret'], setupChanged: true } };

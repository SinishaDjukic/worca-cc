// test/plugin-access.test.mjs — the shared "new access" classifier (CONTRACT §1.5): the update preview, the Installed
// rows' `latest` hint and the update review sheet all ask it which changes need a human tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACCESS_KINDS, accessChanges, inventoryAccessChanges, needsReview, githubWebUrl } from '../src/shared/plugin-access.mjs';
import { githubRepoOf } from '../src/core/git-free/github.mjs';

const ch = (kind, id, red = false) => ({ kind, id, red });

test('accessChanges: every addition that asks for new access, in ACCESS_KINDS order; removals are not access', () => {
  assert.deepEqual(ACCESS_KINDS, ['secret', 'channelSecret', 'modelSecret', 'modelEnv', 'setup', 'taskSource', 'chatChannel', 'agent', 'model', 'mcp', 'skill']);
  const delta = { newSecrets: ['gh.token'], newChannelSecrets: ['main.botToken'], newModelSecrets: ['k'], envChangedModels: ['m1'],
    setupChanged: true, newTaskSources: ['gh'], newChatChannels: ['main'], newAgents: ['helper'], newModels: ['m2'],
    newMcpServers: ['a'], changedMcpServers: ['b'], newSkills: ['s1'], changedSkills: ['s2'],
    removedModels: ['old'], removedMcpServers: ['gone'], removedSkills: ['gone'] };
  assert.deepEqual(accessChanges(delta), [
    ch('secret', 'gh.token', true), ch('channelSecret', 'main.botToken', true), ch('modelSecret', 'k', true),
    ch('modelEnv', 'm1', true), ch('setup', null), ch('taskSource', 'gh'), ch('chatChannel', 'main'), ch('agent', 'helper'),
    ch('model', 'm2'), ch('mcp', 'a'), ch('mcp', 'b'), ch('skill', 's1'), ch('skill', 's2'),
  ]);
  assert.deepEqual([accessChanges({}), accessChanges(null), accessChanges({ setupChanged: false })], [[], [], []]);
  assert.deepEqual([needsReview([]), needsReview(undefined), needsReview(accessChanges({ newAgents: ['x'] }))], [false, false, true]);
});

test('inventoryAccessChanges: what a snapshot adds over the installed inventory; a kind an old snapshot lacks adds nothing', () => {
  const installed = {
    taskSources: [{ id: 'gh', displayName: 'GH', secrets: ['token'] }], chatChannels: [], modelSecrets: [],
    models: [{ id: 'M1', envKeys: ['ANTHROPIC_BASE_URL'], baseUrl: 'https://a.example' }], agents: [{ key: 'a1' }],
    mcpServers: [{ name: 'srv', type: 'stdio', command: 'node x' }], skills: ['s1'],
    setupCommands: ['npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev'],
  };
  const snapshot = {
    taskSources: [{ id: 'gh', secrets: ['token', 'webhookSecret'] }, { id: 'jira', secrets: ['pat'] }],
    chatChannels: [{ id: 'main', secrets: ['botToken'] }], modelSecrets: [{ key: 'k', label: 'K' }],
    models: [{ id: 'm1', envKeys: ['ANTHROPIC_BASE_URL'], baseUrl: 'https://b.example' }, { id: 'm2', envKeys: [], baseUrl: null }],
    agents: [{ key: 'a1' }, { key: 'a2' }],
    mcpServers: [{ name: 'srv', type: 'stdio', command: 'node y' }, { name: 'new', type: 'http', url: 'https://m.example' }],
    skills: ['s1', 's2'],
    setupCommands: ['npm ci --prefix <plugin-dir> --ignore-scripts --omit=dev', 'uv sync --project <plugin-dir>'],
  };
  assert.deepEqual(inventoryAccessChanges(installed, snapshot), [
    ch('secret', 'gh.webhookSecret', true), ch('secret', 'jira.pat', true), ch('channelSecret', 'main.botToken', true),
    ch('modelSecret', 'k', true), ch('modelEnv', 'm1', true), ch('setup', null), ch('taskSource', 'jira'),
    ch('chatChannel', 'main'), ch('agent', 'a2'), ch('model', 'm2'), ch('mcp', 'srv'), ch('mcp', 'new'), ch('skill', 's2'),
  ]);
  assert.deepEqual(inventoryAccessChanges({ models: [{ id: 'm', envKeys: ['A', 'B'], baseUrl: null }] }, { models: [{ id: 'm', envKeys: ['B', 'A'], baseUrl: null }] }), [],
    'the env key set, not its order');
  // A snapshot synced by an older worca: no chatChannels / modelSecrets / mcpServers / setupCommands keys.
  const old = { taskSources: [{ id: 'gh', secrets: ['token'] }], models: installed.models, agents: [{ key: 'a1' }], skills: ['s1'] };
  assert.deepEqual([inventoryAccessChanges(installed, old), inventoryAccessChanges(null, null)], [[], []]);
});

test('githubWebUrl: a GitHub repository at a sha, down to the plugin folder; null off GitHub, for a branch name or no repo', () => {
  const sha = 'd12b77f'.padEnd(40, '0');
  assert.equal(githubWebUrl('https://github.com/SinishaDjukic/worca-cc', sha, 'plugins/github-source'),
    `https://github.com/SinishaDjukic/worca-cc/tree/${sha}/plugins/github-source`);
  assert.equal(githubWebUrl('git@github.com:acme/tools.git', sha, ''), `https://github.com/acme/tools/tree/${sha}`);
  assert.equal(githubWebUrl('https://github.com/a/b', sha, '/plugins//my plugin#1/'), `https://github.com/a/b/tree/${sha}/plugins/my%20plugin%231`);
  for (const args of [['https://gitlab.com/a/b', sha, ''], ['https://github.com/a/b', 'main', ''], [null, sha, ''], ['/home/me/plugins', sha, 'x'],
    ['https://github.com/a/b', 'abc12', ''], ['https://github.com/a/b', `${sha}/../x`, '']]) {
    assert.equal(githubWebUrl(...args), null, String(args[0]));
  }
  for (const url of ['https://github.com/a/b', 'https://x@github.com/a/b.git', 'ssh://git@ssh.github.com:443/a/b', 'git://github.com/a/b',
    'https://github.com/a', 'https://github.com/-a/b', 'owner/repo', 'https://github.com/a/..', ' https://github.com/a/b ']) {
    assert.equal(githubWebUrl(url, sha, '') !== null, githubRepoOf(url) !== null, url);
  }
});

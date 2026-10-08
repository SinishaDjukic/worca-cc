// test/ask-mcp-engine.test.mjs — the worca MCP child of a Codex chat (cascading-settings-design.md §4.6).
import { test, after } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { useTempHome } from './helpers/temp-home.mjs';
import { buildMcpConfig, ASK_MCP_SERVER_PATH } from '../src/core/ask/spawn.mjs';
import { createAskToolServer } from '../src/core/ask/mcp-stdio.mjs';
import { defaultWorkflowDeps } from '../src/core/ask/workflow-deps.mjs';
import { addProject } from '../src/core/projects.mjs';
import { gitDir } from './helpers/git-dir.mjs';

useTempHome(after);
// settings.json lives under $HOME/.worca-cc: the classifier slot is a user key, so HOME is a scratch dir too.
const prevHome = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, ALLOW: process.env.WORCA_TEST_ALLOW_HOME_FALLBACK };
const scratchHome = mkdtempSync(join(tmpdir(), 'worca-2b-home-'));
process.env.HOME = scratchHome; process.env.USERPROFILE = scratchHome; process.env.WORCA_TEST_ALLOW_HOME_FALLBACK = '1';
after(() => {
  for (const [k, v] of [['HOME', prevHome.HOME], ['USERPROFILE', prevHome.USERPROFILE], ['WORCA_TEST_ALLOW_HOME_FALLBACK', prevHome.ALLOW]]) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(scratchHome, { recursive: true, force: true });
});
const base = { homeBase: '/h', threadId: 'ask_00000001', serverPath: ASK_MCP_SERVER_PATH, env: {} };

test('buildMcpConfig: a Codex chat marks the child; a Claude config is unchanged', () => {
  const claude = buildMcpConfig(base);
  assert.deepEqual(buildMcpConfig({ ...base, engine: 'claude' }), claude);
  assert.equal('WORCA_ASK_ENGINE' in claude.mcpServers.worca.env, false);
  assert.equal(buildMcpConfig({ ...base, engine: 'codex' }).mcpServers.worca.env.WORCA_ASK_ENGINE, 'codex');
});

async function listNames(env) {
  const out = [];
  const srv = createAskToolServer({ threadId: 'ask_00000001', write: (s) => out.push(s), env });
  await srv.feed(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }));
  await srv.idle();
  return JSON.parse(out[0]).result.tools.map((t) => t.name);
}

test('createAskToolServer: the file tools only in a Codex chat child', async () => {
  assert.equal((await listNames({})).includes('read_file'), false);
  const names = await listNames({ WORCA_ASK_ENGINE: 'codex' });
  for (const n of ['read_file', 'grep', 'glob']) assert.ok(names.includes(n), n);
});

test('propose_workflow task mode: a Codex chat classifies on Codex with Codex models only', async (t) => {
  // Under the mock no throwaway checkout is opened for the repository look (the injected classify never spawns either).
  const prevMock = process.env.WORCA_MOCK; process.env.WORCA_MOCK = '1';
  t.after(() => { if (prevMock === undefined) delete process.env.WORCA_MOCK; else process.env.WORCA_MOCK = prevMock; });
  const dir = gitDir('askwf');
  const p = (await addProject({ name: 'askwf', path: dir })).find((x) => x.name === 'askwf');
  const seen = [];
  const classify = async (input) => { seen.push(input); throw Object.assign(new Error('stop'), { name: 'ClassifierError' }); };
  const deps = defaultWorkflowDeps({ threadId: 'ask_00000001', classify, env: { WORCA_ASK_ENGINE: 'codex' } });
  await deps.workflow.propose({ mode: 'task', task: 'Fix a typo', projectKey: p.key }).catch(() => {});
  assert.equal(seen[0].engine, 'codex');
  assert.ok(seen[0].models.length > 0);
  assert.ok(seen[0].models.every((m) => m.engine === 'codex'));
  const claudeSeen = [];
  const claudeDeps = defaultWorkflowDeps({ threadId: 'ask_00000001', classify: async (i) => { claudeSeen.push(i); throw new Error('stop'); }, env: {} });
  await claudeDeps.workflow.propose({ mode: 'task', task: 'Fix a typo', projectKey: p.key }).catch(() => {});
  assert.equal('engine' in claudeSeen[0], false, 'a Claude chat\'s classifier input is unchanged');
});

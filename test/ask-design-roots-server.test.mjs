// test/ask-design-roots-server.test.mjs — the server half of Design P8 Task 3's chat side (L8.10): startAskTurn hands a
// locked-down Design chat's turn its design roots (work/, then the design's project), and a Claude one none; in relay mode
// (agents under their own users) askAgentRelay hands them to the tools it runs in the server. Apart from
// test/ask-design-roots.test.mjs so the server boot (and its WORCA_HOME) stays away from those unit rows' temp home.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bootDesignChat } from './helpers/design-chat-boot.mjs';

const { call, settled, mod } = await bootDesignChat(after);
const CODEX = { model: 'gpt-5.5', effort: 'low' };
const CLAUDE = { model: 'claude-opus-5-5', effort: 'high' };
const { designWorkDir } = await import('../src/core/design/paths.mjs');
const { addProject, listProjects } = await import('../src/core/projects.mjs');
const projDir = mkdtempSync(join(tmpdir(), 'worca-design-roots-proj-'));
after(() => rmSync(projDir, { recursive: true, force: true }));
const projKey = (await addProject({ name: 'roots-shop', path: projDir })).find((p) => p.name === 'roots-shop').key;
const projPath = (await listProjects()).find((p) => p.key === projKey).path;

/** A fresh design (the first reply fixes a chat's engine), one message, its finished turn. */
async function turnOf(model, extra = {}) {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'Roots', ...extra })).body;
  const r = await call('POST', `/api/ask/threads/${d.threadId}/messages`, { text: 'MOCK_DESIGN_CHAT hi', ...model, design: { designId: d.design.id, pins: [] } });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  await settled(d.threadId);
  const turn = mod._testing.askJobs.get(d.threadId)?.turn;
  assert.ok(turn, 'the finished job is kept for its grace period');
  return { d, turn };
}

test('a Design chat on a Codex model gets its design roots on the turn — work/, then the project; a Claude one none', async () => {
  const bare = await turnOf(CODEX);
  assert.equal(bare.turn.engine, 'codex');
  assert.deepEqual(bare.turn.designRoots, { workDir: designWorkDir(bare.d.design.id) }, 'no project: no projectDir key at all');
  const withProject = await turnOf(CODEX, { projectKey: projKey });
  assert.deepEqual(withProject.turn.designRoots, { workDir: designWorkDir(withProject.d.design.id), projectDir: projPath });
  const claude = await turnOf(CLAUDE, { projectKey: projKey });
  assert.equal(claude.turn.engine, 'claude');
  assert.equal(claude.turn.designRoots, null, 'a Claude chat reads with its own Read, Grep and Glob');
});

test('relay mode: askAgentRelay hands the design roots to the read_file it runs in the server', async () => {
  const d = (await call('POST', '/api/design', { kind: 'web', title: 'Relay' })).body;
  const work = designWorkDir(d.design.id);
  mkdirSync(work, { recursive: true });
  writeFileSync(join(work, 'plan.json'), '{"title":"Relayed plan"}\n');
  const read = async (o) => {
    const relay = mod._testing.askAgentRelay({ threadId: d.threadId, reader: null, engine: 'codex', model: 'gpt-5.5', ...o });
    try {
      const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_file', arguments: { path: join(work, 'plan.json') } } });
      const r = await call('POST', '/api/ask/relay', { line }, { 'x-worca-relay': relay.token });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      return r.body.out.join('\n');
    } finally { relay.dispose(); }
  };
  assert.match(await read({ designRoots: { workDir: work } }), /Relayed plan/);
  assert.match(await read({}), /outside this chat's worktrees, attachments and memory/, 'without the roots work/ is out of reach');
});

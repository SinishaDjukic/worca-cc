import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../app.js';

function startServer(settingsPath) {
  const app = createApp({ settingsPath });
  const server = createServer(app);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const base = `http://127.0.0.1:${port}`;
      resolve({ server, base });
    });
  });
}

function stopServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

const SAMPLE_SETTINGS = {
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo test' }] }] },
  permissions: { allow: ['Read(*)'] },
  worca: {
    stages: { plan: { agent: 'planner', enabled: true }, implement: { agent: 'implementer', enabled: true } },
    agents: { planner: { model: 'opus', max_turns: 100 }, implementer: { model: 'sonnet', max_turns: 300 } },
    loops: { implement_test: 3, pr_changes: 3, restart_planning: 2 },
    milestones: { plan_approval: true, pr_approval: true, deploy_approval: true },
    governance: {
      guards: { block_rm_rf: true, block_env_write: true, block_force_push: true, restrict_git_commit: true },
      test_gate_strikes: 2,
      dispatch: { planner: [], coordinator: ['implementer'] }
    }
  }
};

describe('GET /api/settings', () => {
  let tmpDir, settingsPath, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'settings-test-'));
    settingsPath = join(tmpDir, 'settings.json');
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns worca and permissions from a valid settings file', async () => {
    writeFileSync(settingsPath, JSON.stringify(SAMPLE_SETTINGS));
    ({ server, base } = await startServer(settingsPath));
    const res = await fetch(`${base}/api/settings`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.worca).toEqual(SAMPLE_SETTINGS.worca);
    expect(data.permissions).toEqual(SAMPLE_SETTINGS.permissions);
  });

  it('returns empty worca/permissions when file has no worca/permissions keys', async () => {
    writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
    ({ server, base } = await startServer(settingsPath));
    const res = await fetch(`${base}/api/settings`);
    const data = await res.json();
    expect(data.worca).toEqual({});
    expect(data.permissions).toEqual({});
  });

  it('never includes hooks in the response', async () => {
    writeFileSync(settingsPath, JSON.stringify(SAMPLE_SETTINGS));
    ({ server, base } = await startServer(settingsPath));
    const res = await fetch(`${base}/api/settings`);
    const data = await res.json();
    expect(data.hooks).toBeUndefined();
  });

  it('returns 500 when the settings file does not exist', async () => {
    ({ server, base } = await startServer(join(tmpDir, 'nonexistent.json')));
    const res = await fetch(`${base}/api/settings`);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error.code).toBe('read_error');
  });

  it('returns 500 when the settings file contains invalid JSON', async () => {
    writeFileSync(settingsPath, 'not json{{{');
    ({ server, base } = await startServer(settingsPath));
    const res = await fetch(`${base}/api/settings`);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/settings', () => {
  let tmpDir, settingsPath, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'settings-test-'));
    settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(SAMPLE_SETTINGS, null, 2) + '\n');
    ({ server, base } = await startServer(settingsPath));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function post(body) {
    return fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  it('merges worca.agents correctly -- replaces the agents sub-object', async () => {
    const res = await post({ worca: { agents: { planner: { model: 'haiku', max_turns: 50 } } } });
    expect(res.status).toBe(200);
    const data = await res.json();
    // Agents replaced wholesale — implementer should be gone
    expect(data.worca.agents).toEqual({ planner: { model: 'haiku', max_turns: 50 } });
    // Other worca keys preserved
    expect(data.worca.loops).toEqual(SAMPLE_SETTINGS.worca.loops);
  });

  it('merges worca.loops correctly', async () => {
    const res = await post({ worca: { loops: { implement_test: 5, pr_changes: 1, restart_planning: 1 } } });
    const data = await res.json();
    expect(data.worca.loops).toEqual({ implement_test: 5, pr_changes: 1, restart_planning: 1 });
  });

  it('merges worca.stages correctly', async () => {
    const newStages = { plan: { agent: 'planner', enabled: false } };
    const res = await post({ worca: { stages: newStages } });
    const data = await res.json();
    expect(data.worca.stages).toEqual(newStages);
  });

  it('merges worca.governance correctly', async () => {
    const newGov = { guards: { block_rm_rf: false }, test_gate_strikes: 5, dispatch: { planner: ['implementer'] } };
    const res = await post({ worca: { governance: newGov } });
    const data = await res.json();
    expect(data.worca.governance).toEqual(newGov);
  });

  it('preserves hooks even if the client sends a hooks key', async () => {
    const res = await post({ hooks: { evil: true }, worca: { loops: { implement_test: 1, pr_changes: 1, restart_planning: 1 } } });
    expect(res.status).toBe(200);
    const raw = JSON.parse(readFileSync(settingsPath, 'utf8'));
    expect(raw.hooks).toEqual(SAMPLE_SETTINGS.hooks);
    expect(raw.hooks.evil).toBeUndefined();
  });

  it('preserves unrelated worca sub-keys not mentioned in the request', async () => {
    const res = await post({ worca: { agents: { planner: { model: 'haiku', max_turns: 10 } } } });
    const data = await res.json();
    expect(data.worca.milestones).toEqual(SAMPLE_SETTINGS.worca.milestones);
    expect(data.worca.stages).toEqual(SAMPLE_SETTINGS.worca.stages);
  });

  it('replaces permissions wholesale when provided', async () => {
    const res = await post({ permissions: { allow: ['Bash(npm test)'] } });
    const data = await res.json();
    expect(data.permissions).toEqual({ allow: ['Bash(npm test)'] });
  });

  it('returns the full merged state in the response', async () => {
    const res = await post({ worca: { agents: { tester: { model: 'haiku', max_turns: 20 } } } });
    const data = await res.json();
    expect(data.worca).toBeDefined();
    expect(data.permissions).toBeDefined();
    expect(data.worca.stages).toEqual(SAMPLE_SETTINGS.worca.stages);
  });

  it('merges plan_path_template into worca', async () => {
    const res = await post({ worca: { plan_path_template: 'custom/{title_slug}.md' } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.worca.plan_path_template).toBe('custom/{title_slug}.md');
    // Other worca keys preserved
    expect(data.worca.loops).toEqual(SAMPLE_SETTINGS.worca.loops);
  });

  it('merges worca.defaults correctly', async () => {
    const res = await post({ worca: { defaults: { msize: 3, mloops: 5 } } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.worca.defaults).toEqual({ msize: 3, mloops: 5 });
    // Other worca keys preserved
    expect(data.worca.loops).toEqual(SAMPLE_SETTINGS.worca.loops);
  });

  it('merges worca.pricing correctly', async () => {
    const pricing = {
      models: {
        opus: { input_per_mtok: 20, output_per_mtok: 80, cache_write_per_mtok: 20, cache_read_per_mtok: 2 },
        sonnet: { input_per_mtok: 5, output_per_mtok: 20, cache_write_per_mtok: 5, cache_read_per_mtok: 0.5 },
      },
      currency: 'USD',
      last_updated: '2026-03-17',
    };
    const res = await post({ worca: { pricing } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.worca.pricing).toEqual(pricing);
    // Other worca keys preserved
    expect(data.worca.loops).toEqual(SAMPLE_SETTINGS.worca.loops);
  });

  it('written file is valid JSON with 2-space indent and trailing newline', async () => {
    await post({ worca: { loops: { implement_test: 1, pr_changes: 1, restart_planning: 1 } } });
    const content = readFileSync(settingsPath, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
    // Verify 2-space indent
    const parsed = JSON.parse(content);
    expect(JSON.stringify(parsed, null, 2) + '\n').toBe(content);
  });
});

describe('POST /api/settings - validation rejections', () => {
  let tmpDir, settingsPath, server, base;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'settings-test-'));
    settingsPath = join(tmpDir, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify(SAMPLE_SETTINGS, null, 2) + '\n');
    ({ server, base } = await startServer(settingsPath));
  });

  afterEach(async () => {
    if (server) await stopServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function post(body) {
    return fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  it('rejects unknown agent names', async () => {
    const res = await post({ worca: { agents: { hacker: { model: 'opus', max_turns: 10 } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('hacker'));
  });

  it('rejects invalid model values', async () => {
    const res = await post({ worca: { agents: { planner: { model: 'gpt4' } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('gpt4'));
  });

  it('rejects max_turns outside 1-500 range', async () => {
    const res = await post({ worca: { agents: { planner: { max_turns: 0 } } } });
    expect(res.status).toBe(400);
  });

  it('rejects max_turns when not an integer', async () => {
    const res = await post({ worca: { agents: { planner: { max_turns: 3.5 } } } });
    expect(res.status).toBe(400);
  });

  it('rejects unknown stage names', async () => {
    const res = await post({ worca: { stages: { deploy: { agent: 'guardian', enabled: true } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('deploy'));
  });

  it('rejects enabled when not a boolean', async () => {
    const res = await post({ worca: { stages: { plan: { enabled: 'yes' } } } });
    expect(res.status).toBe(400);
  });

  it('rejects negative loop values', async () => {
    const res = await post({ worca: { loops: { implement_test: -1 } } });
    expect(res.status).toBe(400);
  });

  it('rejects non-boolean milestone values', async () => {
    const res = await post({ worca: { milestones: { plan_approval: 1 } } });
    expect(res.status).toBe(400);
  });

  it('rejects test_gate_strikes outside 1-20', async () => {
    const res = await post({ worca: { governance: { test_gate_strikes: 0 } } });
    expect(res.status).toBe(400);
  });

  it('rejects dispatch arrays containing unknown agent names', async () => {
    const res = await post({ worca: { governance: { dispatch: { planner: ['unknown_agent'] } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('unknown_agent'));
  });

  it('rejects non-string plan_path_template', async () => {
    const res = await post({ worca: { plan_path_template: 42 } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('plan_path_template'));
  });

  it('rejects defaults.msize outside 1-10', async () => {
    const res = await post({ worca: { defaults: { msize: 0 } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('msize'));
  });

  it('rejects non-object defaults', async () => {
    const res = await post({ worca: { defaults: 'bad' } });
    expect(res.status).toBe(400);
  });

  it('rejects empty plan_path_template', async () => {
    const res = await post({ worca: { plan_path_template: '' } });
    expect(res.status).toBe(400);
  });

  it('rejects negative pricing cost values', async () => {
    const res = await post({ worca: { pricing: { models: { opus: { input_per_mtok: -5 } } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('non-negative'));
  });

  it('rejects unknown pricing model names', async () => {
    const res = await post({ worca: { pricing: { models: { gpt4: { input_per_mtok: 1 } } } } });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.details).toContainEqual(expect.stringContaining('Unknown pricing model'));
  });

  it('rejects non-object request bodies', async () => {
    // Send a raw string "null"
    const res = await fetch(`${base}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null'
    });
    expect(res.status).toBe(400);
  });
});

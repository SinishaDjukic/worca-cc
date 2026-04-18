import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createControlHandlers } from './control.js';

const CHAT = 'chat:telegram:12345';
const PROJECT = 'my-project';

function makeChatContext(activeProject = PROJECT) {
  const store = {};
  return {
    get: vi.fn((k) => ({
      active_project: activeProject,
      mute_until: null,
      muted_messages: 0,
      ...store[k],
    })),
    set: vi.fn((k, patch) => {
      store[k] = { active_project: activeProject, ...store[k], ...patch };
    }),
    isMuted: vi.fn(() => false),
    incrementMuted: vi.fn(),
  };
}

function makeRestClient(responses = {}) {
  const sorted = Object.entries(responses).sort(
    (a, b) => a[0].length - b[0].length,
  );
  function match(path) {
    for (const [pattern, data] of sorted) {
      if (path.includes(pattern)) return { status: 200, data };
    }
    return { status: 404, data: null };
  }
  return {
    get: vi.fn(async (path) => match(path)),
    post: vi.fn(async (path) => match(path)),
    delete: vi.fn(async (path) => match(path)),
  };
}

// --- no active project ---

describe('control commands — no active project', () => {
  const commands = ['pause', 'resume', 'stop'];
  let chatCtx;
  let restClient;

  beforeEach(() => {
    chatCtx = makeChatContext(null);
    restClient = makeRestClient();
  });

  for (const cmd of commands) {
    it(`/${cmd} replies with "no active project" when none is set`, async () => {
      const handlers = createControlHandlers({
        chatContext: chatCtx,
        restClient,
      });
      const reply = await handlers[cmd](CHAT, []);
      expect(reply).toMatch(/no active project/i);
      expect(reply).toContain('/use');
    });
  }
});

// --- /pause ---

describe('/pause', () => {
  it('calls POST /api/projects/:id/runs/:runId/pause with explicit run_id', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/pause': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pause(CHAT, ['run-001']);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs/run-001/pause`,
      ),
    );
    expect(reply).toMatch(/paused.*run-001|run-001.*paused/i);
  });

  it('/pause with no run_id resolves unique active run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-002', pipeline_status: 'running' }],
      },
      '/runs/run-002/pause': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pause(CHAT, []);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining('/runs/run-002/pause'),
    );
    expect(reply).toMatch(/paused.*run-002|run-002.*paused/i);
  });

  it('/pause with multiple active runs returns disambiguation list', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          { id: 'run-001', pipeline_status: 'running' },
          { id: 'run-002', pipeline_status: 'running' },
        ],
      },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pause(CHAT, []);
    expect(reply).toMatch(/multiple.*active|disambig|specify/i);
    expect(reply).toContain('run-001');
    expect(reply).toContain('run-002');
    expect(restClient.post).not.toHaveBeenCalled();
  });

  it('/pause with no run_id and no active runs returns no-active-run message', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [],
      },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pause(CHAT, []);
    expect(reply).toMatch(/no active run/i);
  });

  it('/pause returns error message on non-200 response', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({});
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pause(CHAT, ['run-999']);
    expect(reply).toMatch(/failed|error|not found/i);
  });
});

// --- /resume ---

describe('/resume', () => {
  it('calls POST /api/projects/:id/runs/:runId/resume with explicit run_id', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/resume': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.resume(CHAT, ['run-001']);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs/run-001/resume`,
      ),
    );
    expect(reply).toMatch(/resumed.*run-001|run-001.*resumed/i);
  });

  it('/resume with no run_id resolves unique paused run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-003', pipeline_status: 'paused' }],
      },
      '/runs/run-003/resume': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.resume(CHAT, []);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining('/runs/run-003/resume'),
    );
    expect(reply).toMatch(/resumed.*run-003|run-003.*resumed/i);
  });

  it('/resume returns error message on non-200 response', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({});
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.resume(CHAT, ['run-missing']);
    expect(reply).toMatch(/failed|error|not found/i);
  });
});

// --- /stop ---

describe('/stop', () => {
  it('calls POST /api/projects/:id/runs/:runId/stop with explicit run_id', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/stop': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.stop(CHAT, ['run-001']);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs/run-001/stop`,
      ),
    );
    expect(reply).toMatch(/stopped.*run-001|run-001.*stopped/i);
  });

  it('/stop with no run_id resolves unique active run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-004', pipeline_status: 'running' }],
      },
      '/runs/run-004/stop': { ok: true },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.stop(CHAT, []);
    expect(restClient.post).toHaveBeenCalledWith(
      expect.stringContaining('/runs/run-004/stop'),
    );
    expect(reply).toMatch(/stopped.*run-004|run-004.*stopped/i);
  });

  it('/stop with multiple active runs returns disambiguation list', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          { id: 'run-005', pipeline_status: 'running' },
          { id: 'run-006', pipeline_status: 'paused' },
        ],
      },
    });
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.stop(CHAT, []);
    expect(reply).toMatch(/multiple.*active|disambig|specify/i);
    expect(reply).toContain('run-005');
    expect(reply).toContain('run-006');
    expect(restClient.post).not.toHaveBeenCalled();
  });

  it('/stop returns error message on non-200 response', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({});
    const handlers = createControlHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.stop(CHAT, ['run-999']);
    expect(reply).toMatch(/failed|error|not found/i);
  });
});

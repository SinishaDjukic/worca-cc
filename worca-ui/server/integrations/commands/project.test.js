import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProjectHandlers } from './project.js';

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
  // Sort ascending by length so longer (more specific suffix) patterns win over
  // broader prefix patterns that are substrings of a more specific path.
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

// --- requires active project ---

describe('project-scoped commands — no active project', () => {
  const commands = ['status', 'runs', 'last', 'cost', 'pr'];
  let chatCtx;
  let restClient;

  beforeEach(() => {
    chatCtx = makeChatContext(null);
    restClient = makeRestClient();
  });

  for (const cmd of commands) {
    it(`/${cmd} replies with "no active project" when none is set`, async () => {
      const handlers = createProjectHandlers({
        chatContext: chatCtx,
        restClient,
      });
      const reply = await handlers[cmd](CHAT, []);
      expect(reply).toMatch(/no active project/i);
      expect(reply).toContain('/use');
    });
  }
});

// --- /status ---

describe('/status', () => {
  it('calls GET /api/projects/:id/runs/:runId/status with explicit run_id', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/status': {
        ok: true,
        pipeline_status: 'running',
        stage: 'implementer',
        iteration: 2,
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, ['run-001']);
    expect(restClient.get).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs/run-001/status`,
      ),
    );
    expect(reply).toContain('run-001');
    expect(reply).toContain('running');
  });

  it('/status with no run_id resolves the unique active run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-002', status: 'running' }],
      },
      '/runs/run-002/status': {
        ok: true,
        pipeline_status: 'running',
        stage: 'tester',
        iteration: 1,
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, []);
    expect(reply).toContain('run-002');
  });

  it('/status with no run_id and multiple active runs returns disambiguation list', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          { id: 'run-001', status: 'running' },
          { id: 'run-002', status: 'running' },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, []);
    expect(reply).toMatch(/multiple.*active|disambig|specify/i);
    expect(reply).toContain('run-001');
    expect(reply).toContain('run-002');
  });

  it('/status returns not-found message when run does not exist', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({});
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, ['run-missing']);
    expect(reply).toMatch(/not found|404/i);
  });
});

// --- /runs ---

describe('/runs', () => {
  it('calls GET /api/projects/:id/runs', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          { id: 'run-001', status: 'completed' },
          { id: 'run-002', status: 'running' },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.runs(CHAT, []);
    expect(restClient.get).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs`,
      ),
    );
    expect(reply).toContain('run-001');
    expect(reply).toContain('run-002');
  });

  it('/runs [N] limits results', async () => {
    const runs = Array.from({ length: 15 }, (_, i) => ({
      id: `run-${i + 1}`,
      status: 'completed',
    }));
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: { ok: true, runs },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.runs(CHAT, ['3']);
    const mentioned = runs.slice(0, 3).map((r) => r.id);
    const notMentioned = runs.slice(3).map((r) => r.id);
    for (const id of mentioned) expect(reply).toContain(id);
    for (const id of notMentioned) expect(reply).not.toContain(id);
  });

  it('/runs returns message when no runs exist', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.runs(CHAT, []);
    expect(reply).toMatch(/no runs/i);
  });
});

// --- /last ---

describe('/last', () => {
  it('calls GET /api/projects/:id/runs and returns most recent run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          { id: 'run-001', status: 'completed' },
          { id: 'run-002', status: 'failed' },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.last(CHAT, []);
    expect(restClient.get).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/runs`,
      ),
    );
    expect(reply).toContain('run-001');
  });

  it('/last returns message when no runs exist', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.last(CHAT, []);
    expect(reply).toMatch(/no runs/i);
  });
});

// --- /cost ---

describe('/cost', () => {
  it('calls GET /api/projects/:id/costs', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/costs`]: {
        ok: true,
        tokenData: {
          'run-001': {
            implementer: [
              {
                inputTokens: 100,
                outputTokens: 50,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                webSearchRequests: 0,
                cacheEphemeral1hTokens: 0,
                cacheEphemeral5mTokens: 0,
              },
            ],
          },
        },
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, []);
    expect(restClient.get).toHaveBeenCalledWith(
      expect.stringContaining(
        `/api/projects/${encodeURIComponent(PROJECT)}/costs`,
      ),
    );
    expect(reply).toContain('run-001');
  });

  it('/cost with run_id arg filters to that run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/costs`]: {
        ok: true,
        tokenData: {
          'run-001': {
            planner: [
              {
                inputTokens: 200,
                outputTokens: 100,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                webSearchRequests: 0,
                cacheEphemeral1hTokens: 0,
                cacheEphemeral5mTokens: 0,
              },
            ],
          },
          'run-002': {
            planner: [
              {
                inputTokens: 50,
                outputTokens: 20,
                cacheReadInputTokens: 0,
                cacheCreationInputTokens: 0,
                webSearchRequests: 0,
                cacheEphemeral1hTokens: 0,
                cacheEphemeral5mTokens: 0,
              },
            ],
          },
        },
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, ['run-001']);
    expect(reply).toContain('run-001');
    expect(reply).not.toContain('run-002');
  });

  it('/cost returns message when no cost data exists', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/costs`]: {
        ok: true,
        tokenData: {},
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, []);
    expect(reply).toMatch(/no cost data|no data/i);
  });
});

// --- /pr ---

describe('/pr', () => {
  it('calls GET /api/projects/:id/runs/:runId/status and returns pr_url', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/status': {
        ok: true,
        pipeline_status: 'completed',
        pr_url: 'https://github.com/org/repo/pull/42',
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pr(CHAT, ['run-001']);
    expect(reply).toContain('https://github.com/org/repo/pull/42');
  });

  it('/pr returns no-pr message when pr_url is absent', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs/run-001/status': {
        ok: true,
        pipeline_status: 'completed',
        pr_url: null,
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pr(CHAT, ['run-001']);
    expect(reply).toMatch(/no pr|no pull request/i);
  });

  it('/pr with no run_id resolves unique active run and returns pr_url', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-003', status: 'running' }],
      },
      '/runs/run-003/status': {
        ok: true,
        pipeline_status: 'running',
        pr_url: 'https://github.com/org/repo/pull/99',
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.pr(CHAT, []);
    expect(reply).toContain('https://github.com/org/repo/pull/99');
  });
});

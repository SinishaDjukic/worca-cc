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
  const commands = ['status', 'runs', 'last', 'cost', 'pr', 'error'];
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
  it('returns multi-line status block with emoji for explicit run_id', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'running',
            stage: 'implementer',
            started_at: '2026-04-18T10:00:00Z',
            work_request: { title: 'Add auth' },
            stages: {},
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, ['run-001']);
    expect(reply).toContain('run-001');
    expect(reply).toContain('**Status:** running');
    expect(reply).toContain('**Title:** Add auth');
    expect(reply).toContain('**Stage:** implementer');
  });

  it('/status with no run_id resolves the unique active run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-002', pipeline_status: 'running' }],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, []);
    expect(reply).toContain('run-002');
  });

  it('/status with no run_id and multiple active runs returns disambiguation with titles', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'running',
            work_request: { title: 'First' },
          },
          {
            id: 'run-002',
            pipeline_status: 'running',
            work_request: { title: 'Second' },
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, []);
    expect(reply).toContain('Multiple active runs');
    expect(reply).toContain('run-001');
    expect(reply).toContain('run-002');
    expect(reply).toContain('/status <run_id>');
  });

  it('/status with no active run returns helpful message', async () => {
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
    const reply = await handlers.status(CHAT, []);
    expect(reply).toContain('No active run found');
    expect(reply).toContain('/runs');
    expect(reply).toContain('/status <run_id>');
  });

  it('/status returns unknown status when run is not in list', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({ '/runs': { runs: [] } });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.status(CHAT, ['run-missing']);
    expect(reply).toContain('run-missing');
    expect(reply).toContain('unknown');
  });
});

// --- /runs ---

describe('/runs', () => {
  it('returns runs with header, emoji, and status', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'completed',
            work_request: { title: 'First task' },
          },
          { id: 'run-002', pipeline_status: 'running' },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.runs(CHAT, []);
    expect(reply).toContain(`Recent runs (${PROJECT})`);
    expect(reply).toContain('run-001');
    expect(reply).toContain('run-002');
    expect(reply).toContain('**Title:** First task');
    expect(reply).toContain('**Status:** completed');
    expect(reply).toContain('**Status:** running');
  });

  it('/runs [N] limits results', async () => {
    const runs = Array.from({ length: 15 }, (_, i) => ({
      id: `run-${i + 1}`,
      pipeline_status: 'completed',
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

  it('/runs returns message with project name when no runs exist', async () => {
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
    expect(reply).toContain('No runs found');
    expect(reply).toContain(PROJECT);
  });
});

// --- /last ---

describe('/last', () => {
  it('returns full status block for most recent run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'completed',
            work_request: { title: 'My task' },
          },
          { id: 'run-002', pipeline_status: 'failed' },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.last(CHAT, []);
    expect(reply).toContain('run-001');
    expect(reply).toContain('**Status:** completed');
    expect(reply).toContain('**Title:** My task');
  });

  it('/last returns message with project name when no runs exist', async () => {
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
    expect(reply).toContain('No runs found');
    expect(reply).toContain(PROJECT);
  });
});

// --- /cost ---

describe('/cost', () => {
  it('shows cost with header, emoji and run details', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'completed',
            work_request: { title: 'Auth feature' },
            stages: {
              implementer: {
                iterations: [{ cost_usd: 0.42 }],
              },
            },
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, []);
    expect(reply).toContain(`Cost summary (${PROJECT})`);
    expect(reply).toContain('run-001');
    expect(reply).toContain('$0.42');
    expect(reply).toContain('**Title:** Auth feature');
  });

  it('/cost with run_id arg filters to that run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'completed',
            stages: { plan: { iterations: [{ cost_usd: 0.1 }] } },
          },
          {
            id: 'run-002',
            pipeline_status: 'completed',
            stages: { plan: { iterations: [{ cost_usd: 0.05 }] } },
          },
        ],
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

  it('/cost shows Total line when multiple runs', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          {
            id: 'run-001',
            pipeline_status: 'completed',
            stages: { plan: { iterations: [{ cost_usd: 0.1 }] } },
          },
          {
            id: 'run-002',
            pipeline_status: 'completed',
            stages: { plan: { iterations: [{ cost_usd: 0.05 }] } },
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, []);
    expect(reply).toContain('Total: $0.15');
  });

  it('/cost returns message with project name when no runs exist', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({ '/runs': { runs: [] } });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.cost(CHAT, []);
    expect(reply).toContain('No runs found');
    expect(reply).toContain(PROJECT);
  });
});

// --- /pr ---

describe('/pr', () => {
  it('returns link emoji and PR URL', async () => {
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
    expect(reply).toContain('run-001');
    expect(reply).toContain('**PR:**');
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
    expect(reply).toContain('No PR created yet');
    expect(reply).toContain('run-001');
  });

  it('/pr with no run_id resolves unique active run and returns pr_url', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      [`/api/projects/${encodeURIComponent(PROJECT)}/runs`]: {
        ok: true,
        runs: [{ id: 'run-003', pipeline_status: 'running' }],
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

// --- /error ---

describe('/error', () => {
  it('shows error details for a failed run', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          {
            id: 'run-fail',
            pipeline_status: 'failed',
            stop_reason: 'circuit_breaker',
            work_request: { title: 'add auth' },
            stages: {
              implement: {
                iterations: [
                  {
                    number: 1,
                    status: 'error',
                    error: 'SyntaxError: unexpected token',
                  },
                ],
              },
            },
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.error(CHAT, ['run-fail']);
    expect(reply).toContain('run-fail');
    expect(reply).toContain('add auth');
    expect(reply).toContain('circuit_breaker');
    expect(reply).toContain('implement');
    expect(reply).toContain('SyntaxError');
  });

  it('auto-selects most recent failed run when no run_id given', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [
          { id: 'run-ok', pipeline_status: 'completed', stages: {} },
          {
            id: 'run-bad',
            pipeline_status: 'failed',
            stop_reason: 'signal',
            stages: {
              plan: {
                iterations: [{ number: 1, status: 'error', error: 'timeout' }],
              },
            },
          },
        ],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.error(CHAT, []);
    expect(reply).toContain('run-bad');
    expect(reply).toContain('timeout');
  });

  it('returns message when no failed runs exist', async () => {
    const chatCtx = makeChatContext(PROJECT);
    const restClient = makeRestClient({
      '/runs': {
        runs: [{ id: 'run-ok', pipeline_status: 'completed', stages: {} }],
      },
    });
    const handlers = createProjectHandlers({
      chatContext: chatCtx,
      restClient,
    });
    const reply = await handlers.error(CHAT, []);
    expect(reply).toMatch(/no failed run/i);
  });
});

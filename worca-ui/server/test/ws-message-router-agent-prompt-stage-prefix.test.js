/**
 * #347: get-agent-prompt must not leak the raw, unresolved agent template when
 * a stage runs with a runtime agent swap (e.g. plan_review edit mode swaps
 * plan_reviewer -> plan_editor). status.json records the original agent, but the
 * resolved file on disk is named for the executed agent, so the exact-match
 * lookup misses. The handler must fall back to a stage-prefix scan of resolved/
 * before falling through to the raw template — and when it does render the raw
 * template, flag it as such.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMessageRouter } from '../ws-message-router.js';

function makeTmpDir() {
  const d = join(
    tmpdir(),
    `worca-agentprompt-prefix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(d, { recursive: true });
  return d;
}

function mockWatcherSet(worcaDir) {
  return {
    get worcaDir() {
      return worcaDir;
    },
    get settingsPath() {
      return join(worcaDir, 'settings.json');
    },
    get projectRoot() {
      return worcaDir;
    },
    statusWatcher: {
      scheduleRefresh: vi.fn(),
      lastPipelineStatus: new Map(),
      resolveLatestRunDir: vi.fn(() => worcaDir),
      currentActiveRunId: vi.fn(() => null),
    },
    logWatcher: {
      watchLogFile: vi.fn(),
      watchAllLogFiles: vi.fn(),
      sendArchivedLogs: vi.fn(),
      resolveLogsBaseDir: vi.fn(() => worcaDir),
      clearLogWatchers: vi.fn(),
    },
    beadsWatcher: {
      getBeadsDbPath: vi.fn(() => join(worcaDir, 'beads.db')),
    },
    eventWatcher: {
      readEventsFromFile: vi.fn(() => []),
      subscribeEvents: vi.fn(),
      maybeCloseEventWatcher: vi.fn(),
    },
  };
}

function mockClientManager() {
  const subsMap = new Map();
  return {
    ensureSubs(ws) {
      if (!subsMap.has(ws)) subsMap.set(ws, {});
      return subsMap.get(ws);
    },
    getSubs(ws) {
      return subsMap.get(ws) || null;
    },
    setProtocol(ws, protocol, projectId) {
      const s = this.ensureSubs(ws);
      s.protocolVersion = protocol;
      s.projectId = projectId;
    },
  };
}

function makeRouter(projDir) {
  const ws0 = mockWatcherSet(projDir);
  return createMessageRouter({
    watcherSets: new Map([['default', ws0]]),
    getDefaultWs: () => ws0,
    prefsPath: join(projDir, 'prefs.json'),
    webhookInbox: null,
    clientManager: mockClientManager(),
    broadcaster: { broadcast: vi.fn(), broadcastToSubscribers: vi.fn() },
  });
}

async function fetchPrompt(router, runId, stage) {
  const mockWs = { send: vi.fn(), isAlive: true };
  await router.handleMessage(
    mockWs,
    JSON.stringify({
      id: 'req',
      type: 'get-agent-prompt',
      payload: { runId, stage },
    }),
  );
  expect(mockWs.send).toHaveBeenCalled();
  return JSON.parse(mockWs.send.mock.calls[0][0]);
}

describe('get-agent-prompt stage-prefix fallback (#347)', () => {
  let projDir;
  const RUN_ID = 'run-prefix-001';

  beforeEach(() => {
    projDir = makeTmpDir();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(projDir, { recursive: true, force: true });
  });

  it('resolves the executed-agent file when status.json records a different (swapped) agent', async () => {
    const runDir = join(projDir, 'runs', RUN_ID);
    mkdirSync(join(runDir, 'agents', 'resolved'), { recursive: true });

    // status.json records the ORIGINAL agent (plan_reviewer)...
    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: RUN_ID,
        pipeline_status: 'running',
        stages: {
          plan_review: {
            agent: 'plan_reviewer',
            iterations: [{ number: 1, prompt: 'Review the plan' }],
          },
        },
      }),
      'utf8',
    );

    // ...but the resolved file on disk is named for the EXECUTED agent (plan_editor).
    writeFileSync(
      join(runDir, 'agents', 'resolved', 'plan_review-plan_editor-iter-1.md'),
      'RESOLVED EDIT-MODE PROMPT (no raw braces)',
      'utf8',
    );

    const response = await fetchPrompt(
      makeRouter(projDir),
      RUN_ID,
      'plan_review',
    );

    expect(response.ok).toBe(true);
    expect(response.payload.agentInstructions).toBe(
      'RESOLVED EDIT-MODE PROMPT (no raw braces)',
    );
    // The resolved file was found, so this is NOT the raw-template fallback.
    expect(response.payload.agentInstructionsIsRawTemplate).toBe(false);
  });

  it('flags the raw, unresolved template when only the source template exists', async () => {
    const runDir = join(projDir, 'runs', RUN_ID);
    mkdirSync(join(runDir, 'agents'), { recursive: true });

    writeFileSync(
      join(runDir, 'status.json'),
      JSON.stringify({
        run_id: RUN_ID,
        pipeline_status: 'running',
        stages: {
          plan_review: {
            agent: 'plan_reviewer',
            iterations: [{ number: 1, prompt: 'Review the plan' }],
          },
        },
      }),
      'utf8',
    );

    // No resolved/ file — only the unresolved source template with raw syntax.
    writeFileSync(
      join(runDir, 'agents', 'plan_reviewer.md'),
      '# Plan Reviewer\n\n{{block:graphify-orientation}}\n',
      'utf8',
    );

    const response = await fetchPrompt(
      makeRouter(projDir),
      RUN_ID,
      'plan_review',
    );

    expect(response.ok).toBe(true);
    expect(response.payload.agentInstructions).toContain(
      '{{block:graphify-orientation}}',
    );
    expect(response.payload.agentInstructionsIsRawTemplate).toBe(true);
  });
});

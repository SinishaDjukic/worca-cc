/**
 * WebSocket message router — handles all 24 request types.
 * Delegates to other modules for state and side effects.
 *
 * Supports multi-project mode: each handler resolves the target project
 * via resolveProject() before accessing watchers or filesystem paths.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRequest, makeError, makeOk } from '../app/protocol.js';
import {
  dbExists as beadsDbExists,
  countIssuesByRunLabel,
  getIssue,
  listDistinctRunLabels,
  listIssues,
  listIssuesByLabel,
  listUnlinkedIssues,
} from './beads-reader.js';
import {
  listIterationFiles,
  listLogFiles,
  readLastLines,
  resolveIterationLogPath,
  resolveLogPath,
} from './log-tailer.js';
import { readPreferences, writePreferences } from './preferences.js';
import {
  pausePipeline as pmPausePipeline,
  startPipeline as pmStartPipeline,
  stopPipeline as pmStopPipeline,
  reconcileStatus,
} from './process-manager.js';
import { readSettings } from './settings-reader.js';
import { discoverRuns } from './watcher.js';

// Legacy fallback prefixes — only used when status.json lacks a stored prompt
const STAGE_PROMPT_PREFIX = {
  plan: 'Create a detailed implementation plan for the following work request. Write the plan to the designated plan file.\n\nWork request: ',
  coordinate:
    'Decompose the following work request into Beads tasks with dependencies. Do NOT implement anything — only create tasks using `bd create`.\n\nWork request: ',
  implement:
    'Implement the code changes described in the work request. Follow the plan and complete the tasks assigned to you.\n\nWork request: ',
  test: 'Review and test the implementation for the following work request. Run tests and report results. Do NOT modify code.\n\nWork request: ',
  review:
    'Review the code changes for the following work request. Check for correctness, style, and adherence to the plan. Do NOT modify code.\n\nWork request: ',
  pr: 'Create a pull request for the following work request. Summarize the changes and ensure the commit history is clean.\n\nWork request: ',
};

function _buildStagePrompt(stage, rawPrompt) {
  const prefix = STAGE_PROMPT_PREFIX[stage];
  return prefix ? prefix + rawPrompt : rawPrompt;
}

/**
 * @param {{
 *   watcherSets: Map<string, import('./watcher-set.js').WatcherSet>,
 *   defaultWs: import('./watcher-set.js').WatcherSet,
 *   prefsPath: string,
 *   webhookInbox: object,
 *   clientManager: { ensureSubs: Function, getSubs: Function, setProtocol: Function },
 *   broadcaster: { broadcast: Function, broadcastToSubscribers: Function },
 * }} deps
 */
export function createMessageRouter({
  watcherSets,
  getDefaultWs,
  prefsPath,
  webhookInbox,
  clientManager,
  broadcaster,
}) {
  /**
   * Resolve the target project's WatcherSet for a given client + payload.
   * Priority: payload.projectId > subs.projectId > defaultWs
   */
  function resolveProject(ws, payload) {
    const projectId =
      payload?.projectId || clientManager.getSubs(ws)?.projectId || null;
    if (projectId && watcherSets.has(projectId)) {
      const wset = watcherSets.get(projectId);
      return {
        wset,
        worcaDir: wset.worcaDir,
        settingsPath: wset.settingsPath,
        projectRoot: wset.projectRoot,
      };
    }
    const dws = getDefaultWs();
    if (!dws) return null;
    return {
      wset: dws,
      worcaDir: dws.worcaDir,
      settingsPath: dws.settingsPath,
      projectRoot: dws.projectRoot,
    };
  }

  async function handleMessage(ws, data) {
    let json;
    try {
      json = JSON.parse(data.toString());
    } catch {
      ws.send(
        JSON.stringify({
          id: 'unknown',
          ok: false,
          type: 'bad-json',
          error: { code: 'bad_json', message: 'Invalid JSON' },
        }),
      );
      return;
    }

    // hello-ack — protocol handshake response (not a standard request envelope)
    if (json.type === 'hello-ack') {
      const protocol = json.payload?.protocol || 1;
      const projectId = json.payload?.projectId || null;
      clientManager.setProtocol(ws, protocol, projectId);
      // Clear hello timeout if set
      if (ws._helloTimeout) {
        clearTimeout(ws._helloTimeout);
        ws._helloTimeout = null;
      }
      return;
    }

    if (!isRequest(json)) {
      ws.send(
        JSON.stringify({
          id: 'unknown',
          ok: false,
          type: 'bad-request',
          error: { code: 'bad_request', message: 'Invalid request envelope' },
        }),
      );
      return;
    }

    const req = json;

    // list-runs
    if (req.type === 'list-runs') {
      const proj = resolveProject(ws, req.payload);
      const runs = discoverRuns(proj.worcaDir);
      const settings = readSettings(proj.settingsPath);
      ws.send(JSON.stringify(makeOk(req, { runs, settings })));
      return;
    }

    // get-agent-prompt
    if (req.type === 'get-agent-prompt') {
      const { runId, stage } = req.payload || {};
      if (!runId || !stage) {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'bad_request',
              'payload.runId and payload.stage required',
            ),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      const runs = discoverRuns(proj.worcaDir);
      const run = runs.find((r) => r.id === runId);
      if (!run) {
        ws.send(
          JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)),
        );
        return;
      }
      const agentName = run.stages?.[stage]?.agent || stage;

      const iterations = run.stages?.[stage]?.iterations || [];
      const iterationPrompts = iterations.map((iter, idx) => {
        const prompt = iter.prompt || null;
        return { iteration: iter.number ?? idx, prompt };
      });

      const storedPrompt = run.stages?.[stage]?.prompt;
      let fallbackPrompt;
      let promptSource;
      if (storedPrompt) {
        fallbackPrompt = storedPrompt;
        promptSource = 'actual';
      } else {
        const rawPrompt =
          run.work_request?.description || run.work_request?.title || '';
        fallbackPrompt = _buildStagePrompt(stage, rawPrompt);
        promptSource = 'reconstructed';
      }

      const hasIterationPrompts = iterationPrompts.some(
        (ip) => ip.prompt != null,
      );
      if (!hasIterationPrompts) {
        for (const ip of iterationPrompts) {
          ip.prompt = fallbackPrompt;
        }
      }

      let agentInstructions = null;
      const candidates = [
        join(
          proj.worcaDir,
          'runs',
          run.run_id || runId,
          'agents',
          `${agentName}.md`,
        ),
        join(
          proj.worcaDir,
          'results',
          run.run_id || runId,
          'agents',
          `${agentName}.md`,
        ),
      ];
      for (const p of candidates) {
        if (existsSync(p)) {
          try {
            agentInstructions = readFileSync(p, 'utf8');
          } catch {
            /* ignore */
          }
          break;
        }
      }
      ws.send(
        JSON.stringify(
          makeOk(req, {
            agentInstructions,
            userPrompt: fallbackPrompt,
            iterationPrompts,
            promptSource,
            agent: agentName,
          }),
        ),
      );
      return;
    }

    // subscribe-run
    if (req.type === 'subscribe-run') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      if (!proj) {
        ws.send(JSON.stringify(makeError(req, 'no_project', 'No project available')));
        return;
      }
      const s = clientManager.ensureSubs(ws);
      s.runId = runId;
      const runs = discoverRuns(proj.worcaDir);
      const run = runs.find((r) => r.id === runId);
      if (run) {
        if (
          run.pipeline_status !== undefined &&
          proj.wset.statusWatcher?.lastPipelineStatus &&
          !proj.wset.statusWatcher.lastPipelineStatus.has(runId)
        ) {
          proj.wset.statusWatcher.lastPipelineStatus.set(
            runId,
            run.pipeline_status,
          );
        }
        ws.send(JSON.stringify(makeOk(req, run)));
      } else {
        ws.send(
          JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)),
        );
      }
      return;
    }

    // unsubscribe-run
    if (req.type === 'unsubscribe-run') {
      const s = clientManager.ensureSubs(ws);
      s.runId = null;
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // subscribe-log
    if (req.type === 'subscribe-log') {
      const { stage, runId, iteration } = req.payload || {};
      const proj = resolveProject(ws, req.payload);
      const s = clientManager.ensureSubs(ws);
      s.logStage = stage || '*';
      s.logRunId = runId || null;
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));

      if (!proj.wset.logWatcher) return;

      const archivedRunDir = runId
        ? join(proj.worcaDir, 'results', runId)
        : null;
      const archivedLogDir = archivedRunDir
        ? join(archivedRunDir, 'logs')
        : null;
      const isArchived = archivedLogDir && existsSync(archivedLogDir);

      if (isArchived) {
        proj.wset.logWatcher.sendArchivedLogs(
          ws,
          archivedLogDir,
          stage,
          iteration,
        );
      } else {
        const logsBase = proj.wset.logWatcher.resolveLogsBaseDir();
        if (stage) {
          if (iteration != null) {
            const logPath = resolveIterationLogPath(logsBase, stage, iteration);
            const lines = readLastLines(logPath, 200);
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: { stage, iteration, lines },
                }),
              );
            }
          } else {
            const stageDir = resolveLogPath(logsBase, stage);
            if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
              const iters = listIterationFiles(logsBase, stage);
              for (const { iteration: iterNum, path } of iters) {
                const lines = readLastLines(path, 200);
                if (lines.length > 0) {
                  ws.send(
                    JSON.stringify({
                      id: `evt-${Date.now()}-iter${iterNum}`,
                      ok: true,
                      type: 'log-bulk',
                      payload: { stage, iteration: iterNum, lines },
                    }),
                  );
                }
              }
            } else {
              const logPath = join(logsBase, 'logs', `${stage}.log`);
              const lines = readLastLines(logPath, 200);
              if (lines.length > 0) {
                ws.send(
                  JSON.stringify({
                    id: `evt-${Date.now()}`,
                    ok: true,
                    type: 'log-bulk',
                    payload: { stage, lines },
                  }),
                );
              }
            }
          }
          proj.wset.logWatcher.watchLogFile(stage);
        } else {
          const logFiles = listLogFiles(logsBase);
          for (const { stage: s2, iteration: iterNum, path } of logFiles) {
            const lines = readLastLines(path, 200);
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}-${s2}-${iterNum || 0}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: {
                    stage: s2,
                    iteration: iterNum ?? undefined,
                    lines,
                  },
                }),
              );
            }
          }
          proj.wset.logWatcher.watchAllLogFiles();
        }
      }
      return;
    }

    // unsubscribe-log
    if (req.type === 'unsubscribe-log') {
      const s = clientManager.ensureSubs(ws);
      s.logStage = null;
      s.logRunId = null;
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // get-preferences (user-scoped, not project-scoped)
    if (req.type === 'get-preferences') {
      const prefs = readPreferences(prefsPath);
      ws.send(JSON.stringify(makeOk(req, prefs)));
      return;
    }

    // set-preferences (user-scoped, not project-scoped)
    if (req.type === 'set-preferences') {
      const prefs = req.payload || {};
      const current = readPreferences(prefsPath);
      const merged = { ...current, ...prefs };
      writePreferences(merged, prefsPath);
      broadcaster.broadcast('preferences', merged);
      ws.send(JSON.stringify(makeOk(req, merged)));
      return;
    }

    // pause-run
    if (req.type === 'pause-run') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      try {
        const result = pmPausePipeline(proj.worcaDir, runId);
        ws.send(JSON.stringify(makeOk(req, result)));
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, e.code || 'error', e.message)));
      }
      return;
    }

    // stop-run
    if (req.type === 'stop-run') {
      const proj = resolveProject(ws, req.payload);
      if (!proj) {
        ws.send(JSON.stringify(makeError(req, 'no_project', 'No project available')));
        return;
      }
      try {
        const result = pmStopPipeline(proj.worcaDir);
        ws.send(JSON.stringify(makeOk(req, result)));
        let checks = 0;
        const maxChecks = 20;
        const pollInterval = setInterval(() => {
          checks++;
          let alive = false;
          try {
            process.kill(result.pid, 0);
            alive = true;
          } catch {
            /* dead */
          }
          if (!alive || checks >= maxChecks) {
            clearInterval(pollInterval);
            reconcileStatus(proj.worcaDir);
            proj.wset.statusWatcher?.scheduleRefresh();
          }
        }, 500);
        pollInterval.unref?.();
      } catch (e) {
        proj.wset.statusWatcher?.scheduleRefresh();
        ws.send(
          JSON.stringify(makeError(req, e.code || 'not_running', e.message)),
        );
      }
      return;
    }

    // resume-run
    if (req.type === 'resume-run') {
      const { runId } = req.payload || {};
      const proj = resolveProject(ws, req.payload);
      try {
        const result = await pmStartPipeline(proj.worcaDir, {
          resume: true,
          runId,
          projectRoot: proj.projectRoot,
        });
        ws.send(
          JSON.stringify(makeOk(req, { resumed: true, pid: result.pid })),
        );
        // Give the pipeline process time to write its first status update,
        // then force a refresh so the UI picks up the running state.
        setTimeout(() => {
          if (proj.wset.statusWatcher) {
            proj.wset.statusWatcher.scheduleRefresh();
          }
        }, 500);
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, e.code || 'error', e.message)));
      }
      return;
    }

    // list-beads-issues
    if (req.type === 'list-beads-issues') {
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(
          JSON.stringify(
            makeOk(req, { issues: [], dbExists: false, dbPath: null }),
          ),
        );
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(
          JSON.stringify(
            makeOk(req, {
              issues: [],
              dbExists: false,
              dbPath: beadsDbPath,
            }),
          ),
        );
        return;
      }
      const issues = listIssues(beadsDbPath);
      ws.send(
        JSON.stringify(
          makeOk(req, { issues, dbExists: true, dbPath: beadsDbPath }),
        ),
      );
      return;
    }

    // list-beads-unlinked
    if (req.type === 'list-beads-unlinked') {
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], dbExists: false })));
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], dbExists: false })));
        return;
      }
      const issues = listUnlinkedIssues(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { issues, dbExists: true })));
      return;
    }

    // list-beads-refs
    if (req.type === 'list-beads-refs') {
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(JSON.stringify(makeOk(req, { refs: [] })));
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { refs: [] })));
        return;
      }
      const refs = listDistinctRunLabels(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { refs })));
      return;
    }

    // list-beads-counts
    if (req.type === 'list-beads-counts') {
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(JSON.stringify(makeOk(req, { counts: {} })));
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { counts: {} })));
        return;
      }
      const counts = countIssuesByRunLabel(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { counts })));
      return;
    }

    // list-beads-by-run
    if (req.type === 'list-beads-by-run') {
      const { runId } = req.payload || {};
      if (!runId) {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], runId })));
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      if (!beadsDbExists(beadsDbPath)) {
        ws.send(JSON.stringify(makeOk(req, { issues: [], runId })));
        return;
      }
      const issues = listIssuesByLabel(beadsDbPath, `run:${runId}`);
      ws.send(JSON.stringify(makeOk(req, { issues, runId })));
      return;
    }

    // start-beads-issue
    if (req.type === 'start-beads-issue') {
      const { issueId } = req.payload || {};
      if (!Number.isInteger(issueId) || issueId <= 0) {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'bad_request',
              'payload.issueId (positive integer) required',
            ),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.beadsWatcher) {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'not_available',
              'Beads not available in polling mode',
            ),
          ),
        );
        return;
      }
      const beadsDbPath = proj.wset.beadsWatcher.getBeadsDbPath();
      const issue = getIssue(beadsDbPath, issueId);
      if (!issue) {
        ws.send(
          JSON.stringify(
            makeError(req, 'not_found', `Issue ${issueId} not found`),
          ),
        );
        return;
      }
      if (issue.status !== 'open') {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'not_ready',
              `Issue ${issueId} is not open (status: ${issue.status})`,
            ),
          ),
        );
        return;
      }
      if (issue.blocked_by.length > 0) {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'blocked',
              `Issue ${issueId} is blocked by: ${issue.blocked_by.join(', ')}`,
            ),
          ),
        );
        return;
      }
      try {
        const prompt =
          `[Beads #${issue.id}] ${issue.title}\n\n${(issue.body || '').trim()}`.trim();
        const result = await pmStartPipeline(proj.worcaDir, {
          inputType: 'prompt',
          inputValue: prompt,
          msize: 1,
          mloops: 1,
          projectRoot: proj.projectRoot,
        });
        broadcaster.broadcast('run-started', { pid: result.pid });
        ws.send(JSON.stringify(makeOk(req, { pid: result.pid, issueId })));
      } catch (e) {
        ws.send(JSON.stringify(makeError(req, 'start_failed', e.message)));
      }
      return;
    }

    // get-events
    if (req.type === 'get-events') {
      const { runId, since_event_id, event_types, limit } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      if (!proj.wset.eventWatcher) {
        ws.send(JSON.stringify(makeOk(req, { events: [] })));
        return;
      }
      const events = proj.wset.eventWatcher.readEventsFromFile(runId, {
        since_event_id,
        event_types,
        limit,
      });
      ws.send(JSON.stringify(makeOk(req, { events })));
      return;
    }

    // subscribe-events
    if (req.type === 'subscribe-events') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      const s = clientManager.ensureSubs(ws);
      s.eventsRunId = runId;
      if (proj.wset.eventWatcher) {
        proj.wset.eventWatcher.subscribeEvents(runId);
      }
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));
      return;
    }

    // unsubscribe-events
    if (req.type === 'unsubscribe-events') {
      const proj = resolveProject(ws, req.payload);
      const s = clientManager.ensureSubs(ws);
      const prevRunId = s.eventsRunId;
      s.eventsRunId = null;
      if (prevRunId && proj.wset.eventWatcher) {
        proj.wset.eventWatcher.maybeCloseEventWatcher(prevRunId);
      }
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // get-webhook-inbox
    if (req.type === 'get-webhook-inbox') {
      if (!webhookInbox) {
        ws.send(
          JSON.stringify(
            makeOk(req, { events: [], controlAction: 'continue' }),
          ),
        );
        return;
      }
      const subs = clientManager.getSubs(ws);
      const projectId = subs?.projectId || null;
      ws.send(
        JSON.stringify(
          makeOk(req, {
            events: webhookInbox.list(undefined, projectId),
            controlAction: webhookInbox.getControlAction(),
          }),
        ),
      );
      return;
    }

    // set-webhook-control
    if (req.type === 'set-webhook-control') {
      const { action } = req.payload || {};
      if (!webhookInbox || !['continue', 'pause', 'abort'].includes(action)) {
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'bad_request',
              'action must be "continue", "pause", or "abort"',
            ),
          ),
        );
        return;
      }
      webhookInbox.setControlAction(action);
      broadcaster.broadcast('webhook-control-changed', { action });
      ws.send(JSON.stringify(makeOk(req, { action })));
      return;
    }

    // clear-webhook-inbox
    if (req.type === 'clear-webhook-inbox') {
      if (webhookInbox) webhookInbox.clear();
      broadcaster.broadcast('webhook-inbox-cleared', {});
      ws.send(JSON.stringify(makeOk(req, { cleared: true })));
      return;
    }

    // list-pipelines — return parallel pipeline entries for a project
    if (req.type === 'list-pipelines') {
      const proj = resolveProject(ws, req.payload);
      const multiWatcher = proj.wset.getMultiWatcher?.();
      const pipelines = multiWatcher ? multiWatcher.listPipelines() : [];
      ws.send(JSON.stringify(makeOk(req, { pipelines })));
      return;
    }

    // subscribe-pipeline — subscribe to a specific parallel pipeline's events
    if (req.type === 'subscribe-pipeline') {
      const { runId } = req.payload || {};
      if (typeof runId !== 'string') {
        ws.send(
          JSON.stringify(
            makeError(req, 'bad_request', 'payload.runId required'),
          ),
        );
        return;
      }
      const proj = resolveProject(ws, req.payload);
      const multiWatcher = proj.wset.getMultiWatcher?.();
      if (multiWatcher) {
        multiWatcher.promotePipeline(runId);
      }
      const s = clientManager.ensureSubs(ws);
      s.pipelineRunId = runId;
      s.pipelineProjectId = proj.wset.projectId;
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));
      return;
    }

    // unsubscribe-pipeline — clear pipeline subscription and demote watcher
    if (req.type === 'unsubscribe-pipeline') {
      const s = clientManager.ensureSubs(ws);
      const prevRunId = s.pipelineRunId;
      const prevProjectId = s.pipelineProjectId;
      s.pipelineRunId = null;
      s.pipelineProjectId = null;
      if (prevRunId && prevProjectId) {
        const wset = watcherSets.get(prevProjectId) || getDefaultWs();
        const multiWatcher = wset?.getMultiWatcher?.();
        if (multiWatcher) {
          multiWatcher.demotePipeline(prevRunId);
        }
      }
      ws.send(JSON.stringify(makeOk(req, { unsubscribed: true })));
      return;
    }

    // Unknown type
    ws.send(
      JSON.stringify(
        makeError(req, 'unknown_type', `Unknown message type: ${req.type}`),
      ),
    );
  }

  return { handleMessage };
}

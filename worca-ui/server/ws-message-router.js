/**
 * WebSocket message router — handles all 24 request types.
 * Delegates to other modules for state and side effects.
 *
 * Supports multi-project mode: each handler resolves the target project
 * via resolveProject() before accessing watchers or filesystem paths.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isRequest, makeError, makeOk } from '../app/protocol.js';
import {
  dbExists as beadsDbExists,
  getIssue,
  listDistinctRunLabels,
  listIssues,
  listIssuesByLabel,
  listUnlinkedIssues,
} from './beads-reader.js';
import { buildFileAccessModel } from './file-access-aggregator.js';
import {
  listIterationFiles,
  listLogFiles,
  readLastLines,
  resolveIterationLogPath,
  resolveLogPath,
  splitTimestamps,
} from './log-tailer.js';
import { readPreferences, writePreferences } from './preferences.js';
import {
  pausePipeline as pmPausePipeline,
  startPipeline as pmStartPipeline,
  stopPipeline as pmStopPipeline,
  reconcileStatus,
} from './process-manager.js';
import { resolveRunDir } from './run-dir-resolver.js';
import { readSettings } from './settings-reader.js';
import { discoverRunsAsync, findRun } from './watcher.js';
import { resolveBeadsCounts } from './ws-beads-watcher.js';

/**
 * Read a resolved agent prompt by stage prefix (#347).
 *
 * The pipeline writes resolved prompts as `{stage}-{executed_agent}-iter-{N}.md`.
 * When a stage runs with a runtime agent swap (e.g. plan_review edit mode swaps
 * plan_reviewer -> plan_editor), status.json records the original agent but the
 * file on disk is named for the executed one, so an exact `{stage}-{agent}` match
 * misses. Scan the resolved/ dir for any `{stage}-*-iter-{N}.md` and return its
 * content. Returns null when no match (or the dir is absent/unreadable).
 *
 * @param {string} worcaDir
 * @param {string} runId
 * @param {string} stage
 * @param {number} iterNum
 * @returns {string|null}
 */
function _readResolvedByStagePrefix(worcaDir, runId, stage, iterNum) {
  const suffix = `-iter-${iterNum}.md`;
  const prefix = `${stage}-`;
  for (const base of ['runs', 'results']) {
    const dir = join(worcaDir, base, runId, 'agents', 'resolved');
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const match = entries.find(
      (name) => name.startsWith(prefix) && name.endsWith(suffix),
    );
    if (match) {
      try {
        return readFileSync(join(dir, match), 'utf8');
      } catch {
        /* ignore and keep scanning other bases */
      }
    }
  }
  return null;
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

  // When a run-scoped subscribe arrives with a `payload.projectId` that
  // differs from the client's currently-bound subs.projectId, re-bind the
  // WS to that project. Without this, the targeted project's WatcherSet
  // stays in POLLING tier (no logWatcher / no live updates), and the
  // backfill / live stream silently never arrive — symptoms reported by
  // the user as "no logs / no agent prompts" on the run-detail page in
  // global mode. We keep the previous projectId reference so demotion
  // still happens via the normal client-count mechanism.
  function _adoptProjectFromPayload(ws, payload) {
    const requested = payload?.projectId;
    if (!requested || !watcherSets.has(requested)) return;
    const subs = clientManager.getSubs(ws);
    if (subs?.projectId === requested) return;
    clientManager.setProtocol(ws, subs?.protocolVersion ?? 1, requested);
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
      // List/sidebar path: async scan, no events.jsonl enrichment (issue #296).
      const runs = await discoverRunsAsync(proj.worcaDir, { enrich: false });
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
      _adoptProjectFromPayload(ws, req.payload);
      const proj = resolveProject(ws, req.payload);
      const run = findRun(proj.worcaDir, runId);
      if (!run) {
        ws.send(
          JSON.stringify(makeError(req, 'NOT_FOUND', `Run ${runId} not found`)),
        );
        return;
      }
      const agentName = run.stages?.[stage]?.agent || stage;
      const effectiveRunId = run.run_id || runId;
      const effectiveWorcaDir = run.worktree_worca_dir || proj.worcaDir;

      const iterations = run.stages?.[stage]?.iterations || [];
      const iterationPrompts = iterations.map((iter, idx) => {
        const prompt = iter.prompt || null;
        return { iteration: iter.number ?? idx, prompt };
      });

      // User message (-p) — stored in status.json
      const userPrompt = run.stages?.[stage]?.prompt || null;
      const hasIterationPrompts = iterationPrompts.some(
        (ip) => ip.prompt != null,
      );
      if (!hasIterationPrompts && userPrompt) {
        for (const ip of iterationPrompts) {
          ip.prompt = userPrompt;
        }
      }

      // Resolved agent prompt — the full document the agent actually received.
      // Prefer per-iteration resolved files (W-037+), fall back to the
      // unresolved agent template for pre-W-037 runs.
      let resolvedPrompt = null;
      const resolvedIterationPrompts = [];

      // Collect per-iteration resolved files
      // Filename format: {stage}-{agent}-iter-{N}.md (W-037+)
      // Fallback: {agent}-iter-{N}.md (early W-037 runs)
      for (const iter of iterations) {
        const iterNum = iter.number ?? 0;
        const resolvedCandidates = [
          join(
            effectiveWorcaDir,
            'runs',
            effectiveRunId,
            'agents',
            'resolved',
            `${stage}-${agentName}-iter-${iterNum}.md`,
          ),
          join(
            effectiveWorcaDir,
            'results',
            effectiveRunId,
            'agents',
            'resolved',
            `${stage}-${agentName}-iter-${iterNum}.md`,
          ),
          // Fallback for early W-037 runs without stage prefix
          join(
            effectiveWorcaDir,
            'runs',
            effectiveRunId,
            'agents',
            'resolved',
            `${agentName}-iter-${iterNum}.md`,
          ),
          join(
            effectiveWorcaDir,
            'results',
            effectiveRunId,
            'agents',
            'resolved',
            `${agentName}-iter-${iterNum}.md`,
          ),
        ];
        let content = null;
        for (const p of resolvedCandidates) {
          if (existsSync(p)) {
            try {
              content = readFileSync(p, 'utf8');
            } catch {
              /* ignore */
            }
            break;
          }
        }
        // Stage-prefix fallback (#347): when a stage runs with a runtime agent
        // swap (e.g. plan_review edit mode swaps plan_reviewer -> plan_editor),
        // status.json records the original agent but the resolved file on disk
        // is named for the executed agent. The exact-match candidates above all
        // miss, so scan resolved/ for any {stage}-*-iter-{N}.md and use it
        // before falling through to the raw, unresolved template.
        if (content == null) {
          content = _readResolvedByStagePrefix(
            effectiveWorcaDir,
            effectiveRunId,
            stage,
            iterNum,
          );
        }
        resolvedIterationPrompts.push({ iteration: iterNum, prompt: content });
        if (!resolvedPrompt && content) resolvedPrompt = content;
      }

      // Fall back to unresolved agent template (pre-W-037 runs). This renders
      // the raw template — literal {{block:...}} / {{#if ...}} / {{placeholder}}
      // syntax survives — so flag it (#347) and let the UI label it as such
      // rather than letting it pass for the actual delivered system prompt.
      let agentInstructionsIsRawTemplate = false;
      if (!resolvedPrompt) {
        const templateCandidates = [
          join(
            effectiveWorcaDir,
            'runs',
            effectiveRunId,
            'agents',
            `${agentName}.md`,
          ),
          join(
            effectiveWorcaDir,
            'results',
            effectiveRunId,
            'agents',
            `${agentName}.md`,
          ),
        ];
        for (const p of templateCandidates) {
          if (existsSync(p)) {
            try {
              resolvedPrompt = readFileSync(p, 'utf8');
              agentInstructionsIsRawTemplate = true;
            } catch {
              /* ignore */
            }
            break;
          }
        }
      }

      ws.send(
        JSON.stringify(
          makeOk(req, {
            agentInstructions: resolvedPrompt,
            agentInstructionsIsRawTemplate,
            userPrompt,
            iterationPrompts,
            resolvedIterationPrompts,
            promptSource: userPrompt ? 'actual' : 'none',
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
      _adoptProjectFromPayload(ws, req.payload);
      const proj = resolveProject(ws, req.payload);
      if (!proj) {
        ws.send(
          JSON.stringify(makeError(req, 'no_project', 'No project available')),
        );
        return;
      }
      const s = clientManager.ensureSubs(ws);
      s.runId = runId;
      const run = findRun(proj.worcaDir, runId);
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
      _adoptProjectFromPayload(ws, req.payload);
      const proj = resolveProject(ws, req.payload);
      const s = clientManager.ensureSubs(ws);
      s.logStage = stage || '*';
      s.logRunId = runId || null;
      ws.send(JSON.stringify(makeOk(req, { subscribed: true })));

      if (!proj.wset.logWatcher) return;

      // Resolve runId → on-disk run dir. Handles local active (runs/<id>),
      // archived (results/<id>), and worktree overlay (pipelines.d/<id>.json
      // → worktree_path/.worca/runs/<id>). Falls back to the project's
      // latest-active-run base when no runId is given.
      let logsBase;
      let watchOptions;
      if (runId) {
        const runDir = resolveRunDir(proj.worcaDir, runId);
        if (runDir) {
          logsBase = runDir;
          // Tail only when the run is still alive (pipeline.pid present);
          // archived dirs get backfill but no live watcher.
          watchOptions = existsSync(join(runDir, 'pipeline.pid'))
            ? { runDir, runId }
            : null;
        } else {
          // Run not found anywhere; nothing to send or watch.
          return;
        }
      } else {
        logsBase = proj.wset.logWatcher.resolveLogsBaseDir();
        watchOptions = {};
      }

      if (stage) {
        if (iteration != null) {
          const logPath = resolveIterationLogPath(logsBase, stage, iteration);
          const { lines, timestamps, streams } = splitTimestamps(
            readLastLines(logPath, 200),
          );
          if (lines.length > 0) {
            ws.send(
              JSON.stringify({
                id: `evt-${Date.now()}`,
                ok: true,
                type: 'log-bulk',
                payload: { stage, iteration, lines, timestamps, streams },
              }),
            );
          }
        } else {
          const stageDir = resolveLogPath(logsBase, stage);
          if (existsSync(stageDir) && statSync(stageDir).isDirectory()) {
            const iters = listIterationFiles(logsBase, stage);
            for (const { iteration: iterNum, path } of iters) {
              const { lines, timestamps, streams } = splitTimestamps(
                readLastLines(path, 200),
              );
              if (lines.length > 0) {
                ws.send(
                  JSON.stringify({
                    id: `evt-${Date.now()}-iter${iterNum}`,
                    ok: true,
                    type: 'log-bulk',
                    payload: {
                      stage,
                      iteration: iterNum,
                      lines,
                      timestamps,
                      streams,
                    },
                  }),
                );
              }
            }
          } else {
            const logPath = join(logsBase, 'logs', `${stage}.log`);
            const { lines, timestamps, streams } = splitTimestamps(
              readLastLines(logPath, 200),
            );
            if (lines.length > 0) {
              ws.send(
                JSON.stringify({
                  id: `evt-${Date.now()}`,
                  ok: true,
                  type: 'log-bulk',
                  payload: { stage, lines, timestamps, streams },
                }),
              );
            }
          }
        }
        if (watchOptions) {
          proj.wset.logWatcher.watchLogFile(stage, watchOptions);
        }
      } else {
        const logFiles = listLogFiles(logsBase);
        for (const { stage: s2, iteration: iterNum, path } of logFiles) {
          const { lines, timestamps, streams } = splitTimestamps(
            readLastLines(path, 200),
          );
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
                  timestamps,
                  streams,
                },
              }),
            );
          }
        }
        if (watchOptions) {
          proj.wset.logWatcher.watchAllLogFiles(watchOptions);
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
        ws.send(
          JSON.stringify(makeError(req, 'no_project', 'No project available')),
        );
        return;
      }
      try {
        const { runId } = req.payload || {};
        const result = pmStopPipeline(proj.worcaDir, runId);
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
            reconcileStatus(proj.worcaDir, proj.settingsPath);
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
      const issues = await listIssues(beadsDbPath);
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
      const issues = await listUnlinkedIssues(beadsDbPath);
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
      const refs = await listDistinctRunLabels(beadsDbPath);
      ws.send(JSON.stringify(makeOk(req, { refs })));
      return;
    }

    // list-beads-counts — tier-independent: resolveBeadsCounts falls back to
    // an on-demand DB read when no beadsWatcher exists (TIER_POLLING), so
    // chat/REST callers with no browser open still get counts.
    if (req.type === 'list-beads-counts') {
      const proj = resolveProject(ws, req.payload);
      const counts = await resolveBeadsCounts(proj.wset);
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
      _adoptProjectFromPayload(ws, req.payload);
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
      try {
        const issues = await listIssuesByLabel(beadsDbPath, `run:${runId}`);
        console.log(
          '[list-beads-by-run] runId=%s count=%d statuses=%o',
          runId,
          issues.length,
          issues.map((i) => i.status),
        );
        ws.send(JSON.stringify(makeOk(req, { issues, runId })));
      } catch (err) {
        // Don't return empty issues on failure — the UI would treat that as
        // "all beads deleted" and tear down the open <sl-details> panel. Let
        // the client keep its last-known-good state until the next poll.
        console.warn(
          `[list-beads-by-run] runId=${runId} failed: ${err?.message || err}`,
        );
        ws.send(
          JSON.stringify(
            makeError(
              req,
              'beads_unavailable',
              `bd query failed: ${err?.message || err}`,
            ),
          ),
        );
      }
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

    // get-file-access
    if (req.type === 'get-file-access') {
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
      const runDir = resolveRunDir(proj.worcaDir, runId);
      const eventsPath = runDir ? join(runDir, 'events.jsonl') : null;
      const model = buildFileAccessModel(eventsPath, runDir);
      ws.send(JSON.stringify(makeOk(req, { runId, ...model })));
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

    // Unknown type
    ws.send(
      JSON.stringify(
        makeError(req, 'unknown_type', `Unknown message type: ${req.type}`),
      ),
    );
  }

  return { handleMessage };
}

// ui/server.mjs
// Express static server + REST API + WebSocket bridge that drives the
// deterministic orchestrator core. Only non-builtin deps: express + ws.
//
// Run:  node ui/server.mjs   (or `npm start`)
// Env:  PORT (default 4317), WORCA_MOCK (forwarded to runs when ?mock or body.mock)

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { preflightNode } from '../src/core/preflight-node.mjs';
import { createOrchestrator } from '../src/core/orchestrator.mjs';
import {
  listPipelines, readPipeline, listAllPipelines, readPipelineByKey,
  enrichPipelinesPr, reconcileStaleRunning, readPipelineForResume, persistPrState,
  readRunLogText, readRunArtifactText, countPipelines, runRootSweepLookups, legacySweepLookups, slugify,
  listArtifacts,
} from '../src/core/artifacts.mjs';
import { DIFF_PATCH_FILE } from '../src/core/results.mjs';
import { listProjects, addProject, removeProject, normalizeProjectPath, countProjects, worcaHome } from '../src/core/projects.mjs';
import {
  getWorcaRoot, setWorcaRoot, setProjectsRoot, defaultRoot,
  rawProjectsRoot, defaultProjectsRoot, runRootMode,
  pipelineCostLimitUsd, totalCostLimitUsd, costLimitResetPeriod,
  setPipelineCostLimitUsd, setTotalCostLimitUsd, setCostLimitResetPeriod, assertCostLimitInputs,
  chatPrefs, setChatPrefs,
} from '../src/core/settings.mjs';
import { budgetStatus, readCostCapOverride, setCostCapOverride } from '../src/core/cost-budget.mjs';
import { getStats } from '../src/core/stats.mjs';
import { pickFolderNative } from '../src/core/folder-dialog.mjs';
import { listFolders } from '../src/core/fs-browse.mjs';
import {
  readConfig, setStep, addCustomModel, removeCustomModel, listModels,
  PREDEFINED_MODELS, agentSteps, EFFORTS,
  readRunConfig, setNodeModel, setFeedbackCycles, setActiveWorkflow, resetWorkflowConfig,
  globalModelRefs, removeGlobalModelAndRefs, promoteCustomModel, costUnreliableModelIds,
} from '../src/core/config.mjs';
import { listGlobalModels, addGlobalModel, updateGlobalModel } from '../src/core/settings.mjs';
import { modelEnvRef } from '../src/core/model-env.mjs';
import { listPluginModels, modelSecretsSchema, pluginModelSecretStatus } from '../src/core/plugin-models.mjs';
import { validateGuardrails } from '../src/core/guardrails.mjs';
import {
  listBuiltinGuardrailSets, listGuardrailSets, readGuardrailSet,
  writeGuardrailSet, deleteGuardrailSet, isBuiltinGuardrailSetId,
} from '../src/core/guardrail-store.mjs';
import {
  DEFAULT_WORKFLOW, listWorkflows, readWorkflow, writeWorkflow, deleteWorkflow,
  setWorkflowNodeDefaults, workflowNodeDefaults,
} from '../src/core/workflows.mjs';
import { validateWorkflow } from '../src/core/workflow-validator.mjs';
import { loadAgentRegistry } from '../src/core/agent-registry.mjs';
import {
  listLocalBranches, currentBranch, isValidSourceRef, sweepRunRoots, sweepLegacyWorktreesAll,
} from '../src/core/worktree.mjs';
import { hasGh, pushBranch, createPr, prMergeable } from '../src/core/git-info.mjs';
import { archivePipeline, discardRetainedWorktrees } from '../src/core/pipeline-delete.mjs';
import {
  listWorkspaces, readWorkspace, createWorkspace,
  updateWorkspace, deleteWorkspace, isGitRepo, WORKSPACE_KEY_RE, countWorkspaces,
} from '../src/core/workspaces.mjs';
import { listWorkspacePipelines, readWorkspacePipeline } from '../src/core/artifacts.mjs';
import { generateOverview } from '../src/core/overview-agent.mjs';
import { projectKey } from '../src/core/store.mjs';
import { createWorkspaceScan } from '../src/core/workspace-scan.mjs';
import { createAgentGen } from '../src/core/agent-gen.mjs';
import { listAgents, readAgent, createAgent, updateAgent, deleteAgent, AGENT_KEY_RE } from '../src/core/agent-store.mjs';
import { CHANNEL_IDS } from '../src/core/channels.mjs';
import {
  listInstalledPlugins, installPlugin, updatePlugin, uninstallPlugin,
  setPluginEnabled, doctorPlugin,
  listOrphanPluginData, purgePluginData,
} from '../src/core/plugin-store.mjs';
import { fetchCandidate } from '../src/core/plugin-repo.mjs';
import {
  addMarketplace, listMarketplaces, syncMarketplace, refreshAllMarketplaces,
  removeMarketplace, readMarketplaces, seedBuiltinMarketplace,
} from '../src/core/marketplaces.mjs';
import { redactedConfig, writePluginConfig, readPluginConfig } from '../src/core/plugin-config.mjs';
import { createChannelHost } from '../src/core/chat/channel-host.mjs';
import { createCommandRouter } from '../src/core/chat/command-router.mjs';
import { createChatContext } from '../src/core/chat/chat-context.mjs';
import { createNotifier } from '../src/core/chat/notifier.mjs';
import { TokenBucket } from '../src/core/chat/rate-limiter.mjs';
import { renderTest } from '../src/core/chat/renderers.mjs';
import { readPluginsLock, pluginCurrentDir } from '../src/core/plugins-lock.mjs';
import { normalizeManifest, PLUGIN_NAME_RE as MANIFEST_PLUGIN_NAME_RE } from '../src/core/plugin-manifest.mjs';
import { listTaskSources, retryWriteback } from '../src/core/sources.mjs';
import { callSource, PluginOpError } from '../src/core/plugin-shim.mjs';

// ── node:sqlite runtime guard + warning filter ──────────────────────────────────
// Drop ONLY the one-time ExperimentalWarning emitted by node:sqlite (the module is
// stable enough for our use but still flagged experimental). Everything else (deprec-
// ations, etc.) is re-printed unchanged. Belt-and-suspenders with the npm scripts'
// --disable-warning=ExperimentalWarning (the primary suppressor): this filter is the
// direct-bin fallback. We removeAllListeners('warning') FIRST so Node's default
// printer no longer fires (a bare listener would NOT suppress the warning and would
// double-print every OTHER warning), then attach our single filtering listener.
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w && w.name === 'ExperimentalWarning' && /SQLite/i.test(w.message)) return;
  process.stderr.write(`${w?.stack || w?.message || w}\n`);
});
// Fail fast on an unsupported Node / missing node:sqlite BEFORE any DB is opened.
preflightNode();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const AGENTS_DIR = path.join(PROJECT_ROOT, 'agents');
const SKILLS_DIR = path.join(PROJECT_ROOT, 'skills');
const PORT = Number(process.env.PORT) || 4317;
// Bind to loopback by default (S1). Power users who knowingly want LAN exposure
// can set WORCA_HOST=0.0.0.0, but the localhost-only Host/Origin guard still
// applies unless they also front it with auth.
const HOST = process.env.WORCA_HOST || '127.0.0.1';

// ---------------------------------------------------------------------------
// Run registry. Each entry holds the live orchestrator + a ring buffer of the
// events emitted so far so that a WebSocket which connects late can replay.
// ---------------------------------------------------------------------------
/**
 * @type {Map<string, {
 *   id: string,                 // runs-Map key = randomUUID()
 *   pipelineId?: string,        // short id from src/core/artifacts.mjs#shortId, set after createPipeline
 *   orch: import('events').EventEmitter,
 *   projectDir: string,
 *   title: string,
 *   status: string,
 *   startedAt: string,
 *   events: any[],
 *   pendingQuestion: any
 * }>}
 */
const runs = new Map();

// Ids of runs genuinely live in THIS process (non-terminal entries in the runs Map).
// Passed to reconcileStaleRunning so a same-process run is never relabeled. Both the
// short pipelineId (matches pipelines.id) and the runs-Map UUID id are pushed; the UUID
// simply never matches a pipelines.id, so including it is harmless.
function liveRunIds() {
  const ids = [];
  for (const r of runs.values()) {
    const s = String(r.status || '').toLowerCase();
    if (s === 'running' || s === 'starting' || s === 'created' || s === 'pausing') {
      if (r.pipelineId) ids.push(r.pipelineId);
      if (r.id) ids.push(r.id);
    }
  }
  return ids;
}

// `stepgraphify` (§7.3) was emitted by the orchestrator and handled by the client
// but missing here, so the graphify badge only appeared after a reload (via the
// persisted column) and never live. It rides the same pass-through as `stepskills`.
const EVENT_NAMES = ['phase', 'log', 'question', 'artifact', 'state', 'done', 'error', 'subagent', 'stepskills', 'stepgraphify', 'title'];
// The scan-* WS family (Workspaces M5, §5.4). A NEW family in the SAME runs Map;
// the 7-event run plumbing above is untouched. createWorkspaceScan emits many
// scan-progress then exactly one terminal scan-done OR scan-error.
const SCAN_EVENT_NAMES = ['scan-progress', 'scan-done', 'scan-error'];
// The agentgen-* WS family (Agent Platform, Phase 2). Same pattern as scan-*:
// a NEW family in the SAME runs Map. createAgentGen emits many agentgen-progress
// then exactly one terminal agentgen-done OR agentgen-error.
const AGENTGEN_EVENT_NAMES = ['agentgen-progress', 'agentgen-done', 'agentgen-error'];
const MAX_BUFFER = 5000;

// ---------------------------------------------------------------------------
// WebSocket plumbing
// ---------------------------------------------------------------------------
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

/** All currently connected sockets. */
const sockets = new Set();

wss.on('connection', (ws, req) => {
  // S1: WS upgrades bypass the express middleware chain, so re-apply the
  // loopback guard here (same DNS-rebinding protection as the HTTP routes).
  if (!isLocalRequest(req)) {
    try { ws.close(1008, 'forbidden'); } catch { /* already closing */ }
    return;
  }
  sockets.add(ws);
  // Optional ?runId=... (or ?scanId=.../?genId=...) -> replay that entry's buffered
  // events so a reconnecting client immediately sees the full state. Scan + agentgen
  // entries live in the SAME runs Map keyed by scanId/genId, so a single id lookup
  // serves all families.
  let requestedRunId = null;
  let requestedScanId = null;
  let requestedGenId = null;
  try {
    const u = new URL(req.url, 'http://localhost');
    requestedRunId = u.searchParams.get('runId');
    requestedScanId = u.searchParams.get('scanId');
    requestedGenId = u.searchParams.get('genId');
  } catch {
    requestedRunId = null;
    requestedScanId = null;
    requestedGenId = null;
  }
  const id = requestedRunId || requestedScanId || requestedGenId;

  send(ws, { type: 'hello', runs: summarizeRuns() });

  if (id && runs.has(id)) {
    replayEntry(ws, runs.get(id));
  }

  ws.on('close', () => sockets.delete(ws));
  ws.on('error', () => sockets.delete(ws));
  ws.on('message', (data) => {
    // Clients may ask to (re)subscribe / replay an entry's history. A scan's
    // {type:'subscribe', scanId} and an agent generation's {type:'subscribe',
    // genId} are accepted identically to a run's runId.
    let msg = null;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    const subId = msg && msg.type === 'subscribe' ? (msg.runId || msg.scanId || msg.genId) : null;
    if (subId && runs.has(subId)) {
      replayEntry(ws, runs.get(subId));
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* ignore individual socket failures */
    }
  }
}

// After replaying an entry's buffered events, push a CURRENT state snapshot so a
// late-joining socket always has the latest stepper + subAgents even if the run's
// initial 'state' frame was evicted from the ring buffer (MAX_BUFFER = 5000). For a
// RUN this re-seeds the stepper, and is idempotent with any replayed 'state' frame
// (onState merges). SCAN entries DO expose getState() but have no `.state` property,
// so the `orch.state &&` guard below skips them on purpose: a scan has no stepper to
// seed, and its scanId/phase/... state is already delivered via scan-* events.
// getState() returns a clone with an `id` key (not `runId`) and no `type` key, so the
// explicit { runId, type } below are not clobbered by the spread.
function sendStateSnapshot(ws, entry) {
  const orch = entry && entry.orch;
  if (orch && orch.state && typeof orch.getState === 'function') {
    send(ws, { runId: entry.id, type: 'state', ...orch.getState() });
  }
}

// Replay a run/scan/gen entry's buffered events to a (re)connecting socket, then
// push a current state snapshot. A buffered `question` event lingers in the ring
// buffer forever, but is replayed ONLY while it is still the active pending
// question (entry.pendingQuestion, the single source of truth that also seeds
// hello). Once answered — or superseded by a newer question — replaying it would
// resurrect a clarify/gate card on refresh: a zombie that paints a false "paused"
// state over an already-running pipeline and routes its answer to a no-longer-
// pending id ("answer() ignored"). So a question whose id no longer matches the
// active pending question is skipped on replay; every other event passes through.
function replayEntry(ws, entry) {
  const pendingId = (entry.pendingQuestion && entry.pendingQuestion.id) || null;
  for (const ev of entry.events) {
    if (ev.type === 'question' && ev.id !== pendingId) continue;
    send(ws, ev);
  }
  sendStateSnapshot(ws, entry);
}

/** Broadcast an already-tagged event object to every open socket. */
function broadcast(obj) {
  const text = JSON.stringify(obj);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      try {
        ws.send(text);
      } catch {
        /* ignore */
      }
    }
  }
}

// Fire-and-forget "this entity set changed — refetch your counts" signal. Bare +
// unbuffered + global, exactly like the history-pr broadcast: every connected tab
// (including the one that triggered the mutation) gets it and re-reads /api/counts.
// Because the client always SETS counts to an absolute value (never +1/-1), a tab
// receiving its own echo is idempotent. A tab disconnected at mutation time recovers
// on its next view switch / reload (the agreed product behavior).
function emitChanged(type, action) {
  broadcast({ type, action: action || null });
}

// Append a tagged event to an entry's ring buffer (runId LAST so the runs-Map key
// always wins over any id the orchestrator stamped). Shared by the live wire
// (record) and out-of-band resolutions (resolvePending) so both honor MAX_BUFFER.
function bufferEvent(entry, event) {
  const tagged = { ...event, runId: entry.id };
  entry.events.push(tagged);
  if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
  return tagged;
}

// Clear an entry's active pending question and tell EVERY connected client to drop
// its clarify/gate card — not just the tab that answered. A second tab's post-answer
// `phase` event is gated on its own _answering flag, so without this broadcast it
// keeps showing a stale card (and a false "paused" stepper) until the run ends.
// Buffered (so a later reconnect replays the resolution) AND broadcast live. The
// single chokepoint for clearing entry.pendingQuestion: answer, stop, pause, done,
// error all route here. Idempotent + id-aware: a no-op when nothing is pending, or
// when `id` is given and does not match the active question (a stale/dup ack).
function resolvePending(entry, { id = null, reason = 'resolved' } = {}) {
  const pq = entry && entry.pendingQuestion;
  if (!pq || (id && pq.id !== id)) return false;
  entry.pendingQuestion = null;
  broadcast(bufferEvent(entry, { type: 'question-resolved', id: pq.id, reason }));
  return true;
}

function summarizeRuns() {
  return [...runs.values()].map((r) => ({
    runId: r.id,
    stepper: r.orch?.state?.stepper ?? null,
    pipelineId: r.pipelineId || null,
    projectDir: r.projectDir,
    title: r.title,
    status: r.status,
    // Why the run is paused, or null — ANY orchestrator pause code rides here
    // (e.g. 'usage_limit'), not just the cost pair. Carried in hello so a
    // reload/reconnect restores the cost banner (the client gates that render on
    // 'cost_pipeline'/'cost_total') instead of showing a plain "Paused" card
    // until the next event.
    pauseReason: r.pauseReason || null,
    startedAt: r.startedAt,
    pendingQuestion: r.pendingQuestion || null,
    // kind discriminator so the client routes runs vs scans vs agent generations
    // vs workspace runs without guessing; scanId/genId/workspaceId are the
    // matching attribution fields.
    kind: r.kind || 'run',
    scanId: r.scanId || null,
    genId: r.genId || null,
    workspaceId: r.workspaceId || null,
    projectNames: r.projectNames || null,
  }));
}

// Birth announcement for a freshly-registered run: broadcasts the metadata that
// otherwise only travels in a hello snapshot (projectDir, kind, workspace
// attribution, member names), so tabs that did NOT start the run render its
// child row/card correctly without a reload. Not buffered: late joiners get the
// same fields from summarizeRuns().
function announceRun(entry) {
  broadcast({
    type: 'run-created',
    runId: entry.id,
    title: entry.title,
    projectDir: entry.projectDir,
    kind: entry.kind || 'run',
    workspaceId: entry.workspaceId || null,
    projectNames: entry.projectNames || null,
    status: entry.status,
    startedAt: entry.startedAt,
  });
}

// ---------------------------------------------------------------------------
// Wire a core orchestrator's events onto the WebSocket, tagged with runId.
// ---------------------------------------------------------------------------
function subscribe(orch, name, handler) {
  // Support a Node EventEmitter (`.on`), an `.addListener` alias, or an
  // EventTarget-style (`.addEventListener`) "EventEmitter-like" object.
  if (typeof orch.on === 'function') {
    orch.on(name, handler);
  } else if (typeof orch.addListener === 'function') {
    orch.addListener(name, handler);
  } else if (typeof orch.addEventListener === 'function') {
    orch.addEventListener(name, (ev) => handler(ev && ev.detail !== undefined ? ev.detail : ev));
  }
}

function wireRun(entry) {
  const { id, orch } = entry;

  // Chat notifications ride the same per-run subscription (design §4.5): every
  // creation site that wires a run gets chat fan-out for free. Scans/agent-gens
  // use their own wire* helpers and are deliberately not notified.
  if ((entry.kind || 'run') === 'run' || entry.kind === 'workspace-run') {
    try { chatNotifier.attach(orch, { runId: id, entry }); }
    catch (err) { console.error(`[worca-ui] chat notifier attach failed: ${err && err.message ? err.message : err}`); }
  }

  const record = (event) => {
    // bufferEvent tags runId LAST so the runs-Map key always wins. The
    // orchestrator's `subagent` delta historically carried its own runId
    // (state.id = pipeline SHORT id, NOT this UUID); tagging the UUID last stops
    // the client spawning a phantom run.
    const tagged = bufferEvent(entry, event);
    broadcast(tagged);
    return tagged;
  };

  for (const name of EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };

      if (name === 'question') {
        entry.pendingQuestion = event;
      }
      if (name === 'done') {
        entry.status = (payload && payload.status) || 'done';
        // Remember the pause reason for summarizeRuns (hello). Reset on every
        // done so a later reasonless finish cannot leave a stale cost banner.
        entry.pauseReason = (payload && payload.reason) || null;
        resolvePending(entry, { reason: entry.status });
        if (payload?.reason === 'cost_pipeline' || payload?.reason === 'cost_total') {
          emitChanged('budget-changed');
        }
      }
      if (name === 'error') {
        entry.status = 'error';
        resolvePending(entry, { reason: 'error' });
      }
      if (name === 'phase') {
        entry.status = 'running';
      }
      if (name === 'state' && payload && typeof payload === 'object') {
        // Mirror status from the snapshot when present. (Pending questions are
        // cleared explicitly on answer/done/error, not from state snapshots.)
        if (payload.status) entry.status = payload.status;
        // Capture the on-disk pipeline short id the orchestrator stamps onto
        // state.id after createPipeline. Guard so null in pre-createPipeline
        // snapshots cannot overwrite a previously-captured value.
        if (typeof payload.id === 'string' && payload.id) entry.pipelineId = payload.id;
      }
      if (name === 'title' && payload && typeof payload.title === 'string') {
        // Keep the in-memory run fresh so a late-joining client's hello
        // (summarizeRuns reads entry.title) sees the settled title.
        entry.title = payload.title;
      }

      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Wire a WorkspaceScan's events onto the WebSocket, tagged with scanId. A NEW
// family in the SAME runs Map — the 7-event run plumbing (wireRun) is untouched.
// Maps scan-progress->running, scan-done->done, scan-error->error so the hello
// snapshot + DELETE-while-live guard see a live scan as "running" and a finished
// one as terminal. createWorkspaceScan emits many scan-progress then exactly one
// terminal scan-done OR scan-error (§5.4).
// ---------------------------------------------------------------------------
function wireScan(entry) {
  const { scanId, orch } = entry;

  const record = (event) => {
    // scanId LAST so the runs-Map key always wins (the engine already tags its
    // payload with the same id; this is a defensive override against any drift).
    const tagged = { ...event, scanId };
    entry.events.push(tagged);
    if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
    broadcast(tagged);
    return tagged;
  };

  for (const name of SCAN_EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };
      if (name === 'scan-progress') entry.status = 'running';
      else if (name === 'scan-done') entry.status = 'done';
      else if (name === 'scan-error') entry.status = 'error';
      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Wire an AgentGen's events onto the WebSocket, tagged with genId. The
// agentgen-* family: same runs Map, same ring-buffer/replay plumbing as
// wireScan; the 7-event run plumbing (wireRun) is untouched. createAgentGen
// emits many agentgen-progress then exactly one terminal agentgen-done OR
// agentgen-error (run() never throws).
// ---------------------------------------------------------------------------
function wireAgentGen(entry) {
  const { genId, orch } = entry;

  const record = (event) => {
    // genId LAST so the runs-Map key always wins (the engine already tags its
    // payload with the same id; this is a defensive override against drift).
    const tagged = { ...event, genId };
    entry.events.push(tagged);
    if (entry.events.length > MAX_BUFFER) entry.events.splice(0, entry.events.length - MAX_BUFFER);
    broadcast(tagged);
    return tagged;
  };

  for (const name of AGENTGEN_EVENT_NAMES) {
    subscribe(orch, name, (payload) => {
      const event = { type: name, ...(payload && typeof payload === 'object' ? payload : { value: payload }) };
      if (name === 'agentgen-progress') entry.status = 'running';
      else if (name === 'agentgen-done') entry.status = 'done';
      else if (name === 'agentgen-error') entry.status = 'error';
      record(event);
    });
  }
}

// ---------------------------------------------------------------------------
// Teams ingress (chat-connectivity-design.md §4.7) — the ONE deliberate,
// auditable exemption from the loopback guard below: Bot Framework can only
// deliver inbound Teams activities to a public HTTPS endpoint (via a
// user-supplied tunnel), so this route is mounted BEFORE express.json and
// BEFORE the guard. Hardening: capability-URL token (per-channel ingressToken
// secret, timingSafeEqual, uniform 404 on ANY mismatch), 256 KB raw body cap,
// 60 req/min bucket, worker-down 503, 10 s forward timeout 504. The worker
// validates the Bot Framework JWT (issuer/audience/exp/serviceUrl) — bodies
// and Authorization headers are NEVER logged host-side. Everything outside
// /api/ingress stays loopback-guarded even through the tunnel.
// ---------------------------------------------------------------------------
const ingressBucket = new TokenBucket(60);
const INGRESS_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

app.post('/api/ingress/teams/:plugin/:channelId/:token',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    const notFound = () => res.status(404).json({ error: 'not found' });
    if (!ingressBucket.tryConsume()) return res.status(429).json({ error: 'rate limited' });
    const { plugin, channelId, token } = req.params;
    if (!INGRESS_ID_RE.test(plugin) || !INGRESS_ID_RE.test(channelId) || typeof token !== 'string' || !token) {
      return notFound();
    }
    let entry;
    try {
      entry = channelHost.list().find((e) => e.plugin === plugin && e.channelId === channelId && e.ingress === 'webhook');
    } catch { entry = null; }
    if (!entry) return notFound();
    let expected = '';
    try { expected = String(readPluginConfig(plugin, entry.configSchema).ingressToken || ''); }
    catch { return notFound(); }
    const got = Buffer.from(token);
    const want = Buffer.from(expected);
    if (!expected || got.length !== want.length || !timingSafeEqual(got, want)) return notFound();

    try {
      const out = await channelHost.handleWebhook({
        plugin,
        channelId,
        method: req.method,
        path: req.path,
        headers: req.headers,
        bodyB64: Buffer.isBuffer(req.body) ? req.body.toString('base64') : '',
        timeoutMs: 10000,
      });
      res.status(out.statusCode || 200);
      for (const [k, v] of Object.entries(out.headers || {})) res.set(k, v);
      if (out.bodyB64) return res.send(Buffer.from(out.bodyB64, 'base64'));
      return res.end();
    } catch (err) {
      if (err?.kind === 'timeout') return res.status(504).json({ error: 'worker timeout' });
      return res.status(503).json({ error: 'channel worker unavailable' });
    }
  });

// ---------------------------------------------------------------------------
// Express middleware + static
// ---------------------------------------------------------------------------
app.use(express.json({ limit: '8mb' }));

// S1: worca-cc's UI/API has no auth and runs agents with permissionMode
// 'acceptEdits' — it is a single-user *localhost* tool. The server binds to
// loopback (see HOST below); this guard is the DNS-rebinding belt to that
// suspenders: reject any request whose Host (or browser Origin) is not a
// loopback name, so a malicious page resolving a name to 127.0.0.1 still can't
// drive the API. Override WORCA_HOST only if you understand the exposure.
app.use((req, res, next) => {
  if (!isLocalRequest(req)) {
    return res.status(403).json({ error: 'forbidden: worca-cc is a localhost-only tool' });
  }
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Hostname (no port) from a Host header value or full Origin URL, or null. */
function hostnameOf(value) {
  if (!value) return null;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return null;
  }
}
/** True when both Host and (if present) Origin are loopback. */
function isLocalRequest(req) {
  const host = hostnameOf(req.headers.host);
  if (!host || !LOCAL_HOSTNAMES.has(host)) return false;
  const origin = req.headers.origin;
  if (origin) {
    const oh = hostnameOf(origin);
    if (!oh || !LOCAL_HOSTNAMES.has(oh)) return false;
  }
  return true;
}

function badRequest(res, message) {
  res.status(400).json({ error: message });
}

// A workspace id/key is "wks-<nameSlug>-<sha1[:8]>". WORKSPACE_KEY_RE is imported
// from src/core/workspaces.mjs (one source of truth) and validated against any
// :id/workspaceId before a disk touch: a value failing it can never contain "/"
// or ".." so workspaceStorePath(id) cannot escape the namespace, and a stale
// bookmark reads as "not found" (404), not "bad request".

// Map a workspaces.mjs err.code to an HTTP status. BAD_REQUEST->400,
// DUPLICATE_NAME/DUPLICATE_SET->409, NOT_FOUND->404 (mirrors the thin-delegator
// pattern of /api/projects + /api/workflows). Anything else is a 500 caller bug.
function workspaceErrorStatus(code) {
  if (code === 'DUPLICATE_NAME' || code === 'DUPLICATE_SET') return 409;
  if (code === 'RETAINED_WORKTREE') return 409;   // retained uncommitted work blocks deletion
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  return 500;
}

// Single source of truth for path normalization lives in the core registry.
function resolveProjectDir(input) {
  return normalizeProjectPath(input);
}

// ── Per-project source branches (workspace runs) ──────────────────────────────
// A workspace run may carry a { [projectKey]: sourceBranch } override map. Each
// member's source is its override (when non-blank) else the shared run default;
// the feature branch is always shared (the orchestrator suffixes it per project).
export function buildWorkspaceMembers(projects, branch, sourceByKey = {}) {
  const byKey = sourceByKey && typeof sourceByKey === 'object' ? sourceByKey : {};
  return projects.map((p) => {
    const override = byKey[p.projectKey];
    const source = typeof override === 'string' && override.trim() ? override.trim() : branch.source;
    return { ...p, branch: { source, feature: branch.feature } };
  });
}

// Mirror the shared-source option-injection guard (D2) for every override entry.
// Returns the first leading-dash value found, or null when all entries are safe.
export function firstInjectionSource(sourceByKey = {}) {
  if (!sourceByKey || typeof sourceByKey !== 'object') return null;
  for (const v of Object.values(sourceByKey)) {
    if (typeof v === 'string' && v.trim().startsWith('-')) return v.trim();
  }
  return null;
}

// ── /api/run task-source dispatch (plugins §7.3) ────────────────────────────
// SHAPE-checks body.source only. Resolution (fetching the task, building the
// prompt text, stamping source_type/source_ref) happens inside the orchestrator
// via resolveTaskInput (src/core/sources.mjs) so the task is fetched exactly
// once — the server must never resolve it too.
// Returns null when absent, else { ok:true, source } | { ok:false, error }.
function normalizeRunSource(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'source must be an object' };
  const type = raw.type;
  if (type === 'prompt') {
    if (!(typeof raw.prompt === 'string' && raw.prompt.trim())) {
      return { ok: false, error: 'source.prompt is required for type "prompt"' };
    }
    return { ok: true, source: { type: 'prompt', prompt: raw.prompt } };
  }
  if (type === 'markdown') {
    const promptText = typeof raw.promptText === 'string' && raw.promptText.trim() ? raw.promptText : undefined;
    const promptFile = typeof raw.promptFile === 'string' && raw.promptFile.trim() ? raw.promptFile : undefined;
    if (!promptText && !promptFile) {
      return { ok: false, error: 'source.promptText or source.promptFile is required for type "markdown"' };
    }
    return { ok: true, source: { type: 'markdown', promptText, promptFile } };
  }
  if (type === 'plugin') {
    for (const k of ['plugin', 'sourceId', 'taskId']) {
      if (!(typeof raw[k] === 'string' && raw[k].trim())) {
        return { ok: false, error: `source.${k} is required for type "plugin"` };
      }
    }
    return {
      ok: true,
      source: {
        type: 'plugin',
        plugin: raw.plugin.trim(),
        sourceId: raw.sourceId.trim(),
        taskId: raw.taskId.trim(),
        inputs: raw.inputs && typeof raw.inputs === 'object' && !Array.isArray(raw.inputs) ? raw.inputs : undefined,
      },
    };
  }
  return { ok: false, error: `unknown source.type "${type}"` };
}

// Fallback run title when the client sends none. The legacy path is unchanged
// (first 80 chars of the prompt — effectivePrompt is guaranteed set there); a
// plugin source starts as "<plugin>: <taskId>" until the orchestrator resolves
// the task and settles the real title via the title event.
function fallbackRunTitle(effectivePrompt, source) {
  if (effectivePrompt) return effectivePrompt.slice(0, 80);
  if (source && source.type === 'plugin') return `${source.plugin}: ${source.taskId}`;
  const text = (source && (source.prompt || source.promptText || source.promptFile)) || 'task';
  return String(text).slice(0, 80);
}

// ---------------------------------------------------------------------------
// POST /api/run  -> start a new orchestration run
// body (single-project): { projectDir, prompt?, promptMarkdown?, title?, mock? }
// body (workspace):      { workspaceId, prompt?, ... } — mutually exclusive with
//                        projectDir (§2.6). Single-project behavior is byte-identical.
// ---------------------------------------------------------------------------
app.post('/api/run', async (req, res) => {
  try {
    const body = req.body || {};

    // Mutual exclusion: exactly one of workspaceId / projectDir (§2.6).
    const hasWorkspace = typeof body.workspaceId === 'string' && body.workspaceId.trim();
    const hasProjectDir = typeof body.projectDir === 'string' && body.projectDir.trim();
    if (hasWorkspace && hasProjectDir) {
      return badRequest(res, 'provide workspaceId OR projectDir, not both');
    }
    if (!hasWorkspace && !hasProjectDir) {
      return badRequest(res, 'workspaceId or projectDir is required');
    }

    // ── Shared resolution (factored BEFORE the target branch, §2.6) ──────────
    // NEW (plugins §7.3): body.source is the task-source descriptor; shape-check
    // only and pass through — the orchestrator resolves it exactly once. Absent
    // -> the legacy branch below runs byte-identical.
    const sourceCheck = normalizeRunSource(body.source);
    if (sourceCheck && !sourceCheck.ok) return badRequest(res, sourceCheck.error);
    const source = sourceCheck ? sourceCheck.source : null;

    // prompt OR promptMarkdown. promptMarkdown is treated as the prompt text.
    const prompt = typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt : undefined;
    const promptMarkdown =
      typeof body.promptMarkdown === 'string' && body.promptMarkdown.trim() ? body.promptMarkdown : undefined;
    const effectivePrompt = prompt || promptMarkdown;
    if (source && effectivePrompt) return badRequest(res, 'provide source OR prompt/promptMarkdown, not both');
    if (!source && !effectivePrompt) return badRequest(res, 'prompt or promptMarkdown is required');

    // UI Markdown runs carry provenance (spec §10): absent an explicit
    // body.source, a promptMarkdown-only body maps to the markdown source type.
    // prompt.md bytes and every legacy guard/message stay identical; only the
    // new source_type column differs ('markdown' instead of the default).
    const effectiveSource = source
      || (promptMarkdown && !prompt ? { type: 'markdown', promptText: promptMarkdown } : null);

    const mock = !!body.mock || isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK);

    // Optional workflowId selects a saved (or built-in default) topology. The
    // orchestrator resolves topology + per-project run-config into an executable
    // plan at run start; here we only normalize + reject an unknown id up front
    // so the client gets a clean 400 instead of a mid-run error event.
    const workflowId =
      typeof body.workflowId === 'string' && body.workflowId.trim() ? body.workflowId.trim() : 'wf_default';
    if (!(await readWorkflow(workflowId))) return badRequest(res, `unknown workflowId "${workflowId}"`);

    // Optional guardrailsId selects the named guardrail set that IS this run's
    // policy (applied uniformly to every member — guardrails are per-run only).
    // Absent/blank/null normalizes to 'permissive' — the empty policy,
    // byte-identical legacy spawn — so pre-picker API/CLI callers keep today's
    // behavior. A NON-STRING value is a caller bug and 400s (normalizing it
    // away would silently drop the requested policy). Unknown ids 400 up
    // front, like workflowId.
    if (body.guardrailsId != null && typeof body.guardrailsId !== 'string') {
      return badRequest(res, 'guardrailsId must be a string');
    }
    const guardrailsId =
      typeof body.guardrailsId === 'string' && body.guardrailsId.trim() ? body.guardrailsId.trim() : 'permissive';
    if (!(await readGuardrailSet(guardrailsId))) {
      return badRequest(res, `unknown guardrailsId "${guardrailsId}"`);
    }

    // Budget gate: no new pipelines while the total window is spent (F6).
    const budget = budgetStatus();
    if (budget.blocked) {
      return res.status(403).json({ error: 'total cost limit reached', budget });
    }

    const runId = randomUUID();
    const title = (typeof body.title === 'string' && body.title.trim()) || fallbackRunTitle(effectivePrompt, source);

    // Materialize any uploaded extra files to a temp dir; the orchestrator's
    // createPipeline copies them into <pipeline>/extras/.
    const extras = await writeExtras(runId, body.extras);

    const branch = {
      source: typeof body.sourceBranch === 'string' && body.sourceBranch.trim()
        ? body.sourceBranch.trim() : null,
      feature: typeof body.featureBranch === 'string' && body.featureBranch.trim()
        ? body.featureBranch.trim() : null,
    };

    let orch, entry;

    if (hasWorkspace) {
      // ── Workspace target (§2.6) ────────────────────────────────────────────
      const workspaceId = body.workspaceId.trim();
      // A stale bookmark / crafted id reads as "not found", not "bad request".
      if (!WORKSPACE_KEY_RE.test(workspaceId)) {
        return res.status(404).json({ error: 'workspace not found' });
      }
      const ws = await readWorkspace(workspaceId);
      if (!ws) return res.status(404).json({ error: 'workspace not found' });

      // Resolve member detail. Each member must be an existing git repo (D3:
      // per-project worktrees + checkpoints). A vanished member is a hard 400 —
      // skip-missing is NOT allowed; a workspace run is defined over its full set.
      // A member that exists but is no longer a git repo (its .git removed since
      // creation, where createWorkspace enforced isGitRepo) is rejected the same
      // way, so the client gets a clean 400 instead of a mid-run worktree error.
      const projects = [];
      for (const dir of ws.projectPaths) {
        if (!fs.existsSync(dir)) {
          return badRequest(res, 'workspace member path is missing');
        }
        if (!isGitRepo(dir)) {
          return badRequest(res, `workspace member is not a git repository: ${dir}`);
        }
        projects.push({ projectDir: dir, projectKey: projectKey(dir), projectName: path.basename(dir) });
      }
      // Sort by projectKey (the canonical member order used everywhere);
      // projects[0] is the primary (lowest projectKey).
      projects.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));

      // D2: sourceBranch/featureBranch are per-project DEFAULTS; do NOT
      // pre-validate against any one repo (the orchestrator resolves each
      // project's default via resolveDefaultBranch). This is the single
      // intentional divergence from the single-project isValidSourceRef guard.
      // Still reject option-injection (a leading dash) on sourceBranch.
      if (branch.source && branch.source.startsWith('-')) {
        return badRequest(res, `unknown or invalid sourceBranch: ${branch.source}`);
      }
      // Per-project source overrides { [projectKey]: branch }. Same injection guard.
      const sourceByKey =
        body.sourceBranchByKey && typeof body.sourceBranchByKey === 'object' && !Array.isArray(body.sourceBranchByKey)
          ? body.sourceBranchByKey
          : {};
      const badOverride = firstInjectionSource(sourceByKey);
      if (badOverride) {
        return badRequest(res, `unknown or invalid sourceBranch: ${badOverride}`);
      }

      orch = createOrchestrator({
        workspace: {
          id: ws.id,
          key: ws.id, // ws.id === workspaceKey(ws); routes artifacts to its store
          name: ws.name,
          description: ws.description,
          projects: buildWorkspaceMembers(projects, branch, sourceByKey),
        },
        prompt: effectivePrompt,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        title,
        extras,
        agentsDir: AGENTS_DIR,
        workflowId,
        guardrailsId,
        branch,
        claude: { permissionMode: 'acceptEdits', mock },
      });

      entry = {
        id: runId,
        orch,
        projectDir: projects[0].projectDir, // primary, for back-compat readers
        workspaceId: ws.id,
        kind: 'workspace-run',
        projectNames: projects.map((p) => p.projectName),
        title,
        status: 'starting',
        startedAt: new Date().toISOString(),
        events: [],
        pendingQuestion: null,
      };
    } else {
      // ── Single-project target (UNCHANGED) ──────────────────────────────────
      const projectDir = resolveProjectDir(body.projectDir);
      if (!projectDir) return badRequest(res, 'projectDir is required');

      if (!fs.existsSync(projectDir)) {
        try {
          await fsp.mkdir(projectDir, { recursive: true });
        } catch (err) {
          return badRequest(res, `cannot create projectDir: ${err.message}`);
        }
      }

      // M1: never hand an unvalidated sourceBranch to `git worktree add`. Reject a
      // leading-dash (option injection) or unknown ref here so the client gets a
      // clean 400 instead of a mid-run error event. featureBranch is sanitized
      // downstream by sanitizeBranchName, so it needs no ref check.
      if (branch.source && !(await isValidSourceRef(projectDir, branch.source))) {
        return badRequest(res, `unknown or invalid sourceBranch: ${branch.source}`);
      }

      orch = createOrchestrator({
        projectDir,
        prompt: effectivePrompt,
        ...(effectiveSource ? { source: effectiveSource } : {}),
        title,
        extras,
        agentsDir: AGENTS_DIR,
        workflowId,
        guardrailsId,
        branch,
        claude: { permissionMode: 'acceptEdits', mock },
      });

      entry = {
        id: runId,
        orch,
        projectDir,
        kind: 'run',
        title,
        status: 'starting',
        startedAt: new Date().toISOString(),
        events: [],
        pendingQuestion: null,
      };
    }

    runs.set(runId, entry);
    wireRun(entry);
    announceRun(entry);

    // Fire-and-forget; all progress is surfaced through events.
    Promise.resolve()
      .then(() => orch.run())
      .catch((err) => {
        const event = { runId, type: 'error', message: err && err.message ? err.message : String(err) };
        entry.status = 'error';
        entry.events.push(event);
        broadcast(event);
      });

    res.json({ runId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Chat connectivity (chat-connectivity-design.md): persistent channel workers
// + inbound command router. Workers are dumb transports; every command
// resolves here against the runs Map / DB through chatActions.
// ---------------------------------------------------------------------------
// Lazy: worcaHome() must not resolve at import time (tests import the app
// before their temp WORCA_HOME hook runs); the file loads on first chat use.
let _chatContext = null;
const chatCtx = () => (_chatContext ??= createChatContext());
const chatContext = {
  get: (k) => chatCtx().get(k),
  set: (k, patch) => chatCtx().set(k, patch),
  isMuted: (k) => chatCtx().isMuted(k),
  incrementMuted: (k) => chatCtx().incrementMuted(k),
};

const chatActions = {
  listRuns: () => summarizeRuns(),
  runState: (runId) => { try { return runs.get(runId)?.orch?.getState() ?? null; } catch { return null; } },
  pendingQuestion: (runId) => runs.get(runId)?.pendingQuestion ?? null,
  answer: (runId, id, payload) => answerRun(runId, id, payload),
  stop: (runId) => stopRun(runId),
  pause: (runId) => pauseRun(runId),
  // The long chain of budget/worktree/double-resume guards lives in resumeRun();
  // call it in-process. (It used to be reached by POSTing to 127.0.0.1:PORT — a
  // loopback self-fetch that breaks under WORCA_HOST and can hit another instance.)
  resume: async (pipelineId) => {
    try { return await resumeRun(pipelineId); }
    catch (err) { return { ok: false, error: err?.body?.error || err?.message || String(err) }; }
  },
  // Chat reads only DB fields (id/title/status/cost/activeMs/pauseReason), so bound the
  // rows in SQL and skip git enrichment — /status no longer spawns 2 git procs per pipeline.
  history: async ({ limit = 50 } = {}) => (await listAllPipelines({ limit, lite: true })) || [],
  listProjects: async () => (await listProjects()).map((p) => ({ name: p.name || path.basename(p.path || ''), path: p.path })),
};

const chatRouter = createCommandRouter({
  actions: chatActions,
  chatContext,
  logger: (level, msg) => console.error(`[worca-ui] chat ${level}: ${msg}`),
});

// Same-chat commands must run strictly in order: a batched ['/use beta','/runs']
// from one getUpdates poll otherwise interleaves (stale reads, replies out of
// order). One promise chain per chatKey; depth-capped (there is NO host-side
// inbound bound — a Telegram poll can hand over 100 updates at once, and the
// allowlist is only applied inside the router, after enqueue); the catch is
// mandatory — nobody awaits this chain, so a rejected tail is an unhandled
// rejection that kills the process under Node's default flag.
const CHAT_QUEUE_MAX = 50;          // per chat; a flood past this is dropped, not buffered
const chatQueues = new Map();       // key -> { tail, depth }
function enqueueChatWork(key, fn) {
  const q = chatQueues.get(key) || { tail: Promise.resolve(), depth: 0 };
  if (q.depth >= CHAT_QUEUE_MAX) {
    console.error(`[worca-ui] chat queue for ${key} is full (${CHAT_QUEUE_MAX}) — dropping inbound work`);
    return q.tail;
  }
  q.depth += 1;
  // prev.then(fn, fn): run even after a prior failure (fn takes no arguments,
  // so the previous error is discarded — do not give fn a parameter).
  const tail = q.tail.then(fn, fn).catch((err) => {
    console.error(`[worca-ui] chat work failed: ${err && err.message ? err.message : err}`);
  }).finally(() => {
    q.depth -= 1;
    if (chatQueues.get(key) === q && q.depth === 0) chatQueues.delete(key);
  });
  q.tail = tail;
  chatQueues.set(key, q);
  return tail;
}

async function handleChatInbound({ plugin, channelId, platform, msg }) {
  const entry = channelHost.list().find((e) => e.plugin === plugin && e.channelId === channelId);
  if (!entry) return;
  let replyMsg;
  try {
    replyMsg = await chatRouter.handleIncoming({
      plugin, channelId, platform,
      channelConfig: readPluginConfig(plugin, entry.configSchema),
      msg,
    });
  } catch (err) {
    console.error(`[worca-ui] chat inbound failed: ${err && err.message ? err.message : err}`);
    return;
  }
  if (!replyMsg) return;
  try {
    await channelHost.sendMessage({ plugin, channelId, chatId: msg.chatId, message: replyMsg });
  } catch (err) {
    console.error(`[worca-ui] chat reply delivery failed: ${err && err.message ? err.message : err}`);
  }
}

const channelHost = createChannelHost({
  logger: (level, msg) => console.error(`[worca-ui] ${msg}`),
  onInbound: (ev) => { enqueueChatWork(`${ev.platform}:${ev.msg.chatId}`, () => handleChatInbound(ev)); },
  onStatus: (ev) => { try { broadcast({ type: 'channel-status', ...ev }); } catch { /* pre-listen */ } },
});

const chatNotifier = createNotifier({
  channelHost,
  getPrefs: chatPrefs,
  chatContext,
  logger: (level, msg) => console.error(`[worca-ui] chat ${level}: ${msg}`),
});

/** Best-effort worker restart after any plugin mutation (enable/disable,
 *  config save, install, update, uninstall). Never blocks the route. */
function reloadChatWorkers(name) {
  channelHost.reloadPlugin(name).catch((err) => {
    console.error(`[worca-ui] chat worker reload failed for ${name}: ${err && err.message ? err.message : err}`);
  });
}

// ---------------------------------------------------------------------------
// Run control actions — ONE implementation shared by the HTTP routes and the
// chat command router (chat-connectivity-design.md §4.6), so answering a gate
// from Discord clears the question card in every browser tab exactly like the
// UI button does (resolvePending is part of the action, not the route).
// ---------------------------------------------------------------------------
function answerRun(runId, id, payload) {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  entry.orch.answer(id, payload);
  resolvePending(entry, { id, reason: 'answered' });
}
function stopRun(runId) {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  entry.orch.stop();
  entry.status = 'stopped';
  resolvePending(entry, { reason: 'stopped' });
}
function pauseRun(runId) {
  const entry = runs.get(runId);
  if (!entry) throw new Error('unknown runId');
  const ok = typeof entry.orch?.pause === 'function' && entry.orch.pause();
  if (!ok) throw Object.assign(new Error('cannot pause in the current state'), { code: 'CANNOT_PAUSE' });
  entry.status = 'pausing';
  resolvePending(entry, { reason: 'paused' });
}

// ---------------------------------------------------------------------------
// POST /api/answer  -> resolve a pending question for a run
// body: { runId, id, payload }
// ---------------------------------------------------------------------------
app.post('/api/answer', (req, res) => {
  const { runId, id, payload } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  if (!id) return badRequest(res, 'question id is required');
  try {
    answerRun(runId, id, payload);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/stop  -> abort a run
// body: { runId }
// ---------------------------------------------------------------------------
app.post('/api/stop', (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  try {
    stopRun(runId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pause { runId } — gracefully pause a LIVE run. The orchestrator kills
// in-flight node children, persists a resume point, and lands on status 'paused'
// (announced via the normal state/done events; wireRun mirrors entry.status).
// ---------------------------------------------------------------------------
app.post('/api/pause', (req, res) => {
  const { runId } = req.body || {};
  if (!runId || !runs.has(runId)) return badRequest(res, 'unknown runId');
  try {
    pauseRun(runId);
    res.json({ ok: true });
  } catch (err) {
    if (err?.code === 'CANNOT_PAUSE') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// resumeRun(pipelineId, opts) — the resume guard chain + rehydration, callable
// in-process. Chat used to reuse it by POSTing http://127.0.0.1:PORT/api/resume
// over loopback, which breaks under WORCA_HOST (the server may not be bound on
// 127.0.0.1 at all) and, worse, can land on a DIFFERENT worca instance that
// happens to own the port. Both callers now share this one function; the route
// is a thin mapper from ResumeError -> (status, body).
// ---------------------------------------------------------------------------
class ResumeError extends Error {
  constructor(status, body) {
    super(body.error || 'resume failed');
    this.status = status;
    this.body = body;
  }
}

async function resumeRun(pipelineId, { ignoreCostCap = false, mock = false } = {}) {
  if (!pipelineId || typeof pipelineId !== 'string') throw new ResumeError(400, { error: 'pipelineId is required' });
  const saved = readPipelineForResume(pipelineId);
  if (!saved) throw new ResumeError(404, { error: 'pipeline not found' });
  if (saved.row.status !== 'paused' && saved.row.status !== 'interrupted') throw new ResumeError(400, { error: `pipeline is "${saved.row.status}", not resumable` });
  if (!saved.resumePoint) throw new ResumeError(400, { error: 'pipeline has no resume point' });

  if (saved.row.archived_at) {
    throw new ResumeError(409, { error: 'pipeline is archived' });
  }
  const budget = budgetStatus();
  if (budget.blocked) {
    throw new ResumeError(403, { error: 'total cost limit reached', budget });
  }
  // Override persists only once the (never-bypassable) total gate passes —
  // a total-refused request must not leave cost_cap_override armed.
  if (ignoreCostCap === true) {
    setCostCapOverride(pipelineId);            // persistent per-pipeline override (F7)
  }
  const pipeCap = budget.pipelineLimitUsd;
  const spentSoFar = Number(saved.row.total_cost_usd || 0);
  if (pipeCap != null && spentSoFar >= pipeCap && !readCostCapOverride(pipelineId)) {
    throw new ResumeError(403, {
      error: 'pipeline cost limit reached', budget, needsOverride: true,
    });
  }

  // Double-resume guard: any live entry already driving this pipeline id.
  for (const e of runs.values()) {
    if (e.pipelineId === pipelineId && !['done', 'stopped', 'error', 'paused', 'interrupted'].includes(String(e.status || ''))) {
      throw new ResumeError(400, { error: 'pipeline is already live' });
    }
  }

  // Worktree(s) must still exist (single-project; workspace members are checked
  // inside orchestrator.resume(), which fails fast with the same message).
  const branch = saved.row.branch ? JSON.parse(saved.row.branch) : null;
  if (branch?.worktreeDir && !fs.existsSync(branch.worktreeDir)) {
    throw new ResumeError(400, { error: `worktree missing: ${branch.worktreeDir}` });
  }

  // Resolve projectDir: workspace runs carry dirs in workspace_meta; single-project
  // runs map project_key back through the registry.
  let projectDir = null;
  let workspace;
  if (saved.row.target === 'workspace' && saved.row.workspace_meta) {
    const meta = JSON.parse(saved.row.workspace_meta);
    const projects = (meta.projects || []).map((p) => ({ ...p }));
    if (!projects.length) throw new ResumeError(400, { error: 'workspace metadata incomplete' });
    projectDir = projects[0].projectDir;
    workspace = {
      id: meta.workspaceId, key: saved.row.workspace_key, name: meta.workspaceName,
      description: meta.workspaceDescription || '', projects,
    };
  } else {
    for (const p of await listProjects()) {
      if (projectKey(p.path) === saved.row.project_key) { projectDir = p.path; break; }
    }
    if (!projectDir) throw new ResumeError(400, { error: 'project for this pipeline is not onboarded on this machine' });
  }

  const effMock = mock || isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK);
  const runId = randomUUID();
  const orch = createOrchestrator({
    projectDir,
    ...(workspace ? { workspace } : {}),
    agentsDir: AGENTS_DIR,
    claude: { permissionMode: 'acceptEdits', mock: effMock },
    resume: saved,
  });
  const entry = {
    id: runId,
    orch,
    projectDir,
    ...(workspace
      ? {
          workspaceId: workspace.id,
          kind: 'workspace-run',
          projectNames: workspace.projects.map((p) => p.projectName || path.basename(p.projectDir || '')),
        }
      : { kind: 'run' }),
    title: saved.row.title,
    status: 'starting',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
    pipelineId,
  };
  runs.set(runId, entry);
  wireRun(entry);
  announceRun(entry);

  // Evict the superseded paused/interrupted lineage for this pipeline. The old
  // entry is inert (paused), but summarizeRuns() broadcasts EVERY Map entry on
  // each hello — leaving it resurfaces the now-resumed (and possibly already
  // completed) pipeline as a phantom 'Paused' card in Running on reload/reconnect.
  for (const [id, e] of runs) {
    if (id !== runId && e.pipelineId === pipelineId &&
        (e.status === 'paused' || e.status === 'interrupted')) {
      runs.delete(id);
    }
  }

  // Fire-and-forget; all progress is surfaced through events (same idiom as /api/run).
  Promise.resolve()
    .then(() => orch.resume())
    .catch((err) => {
      const event = { runId, type: 'error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return { ok: true, runId, pipelineId };
}

// ---------------------------------------------------------------------------
// POST /api/resume { pipelineId } — rehydrate a paused pipeline from the DB (works
// across server restarts) and continue it as a NEW live run entry with the SAME
// pipeline id / history row.
// ---------------------------------------------------------------------------
app.post('/api/resume', async (req, res) => {
  try {
    const out = await resumeRun(req.body?.pipelineId, {
      ignoreCostCap: req.body?.ignoreCostCap === true,
      mock: !!(req.body && req.body.mock),
    });
    res.json(out);
  } catch (err) {
    if (err instanceof ResumeError) return res.status(err.status).json(err.body);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs?projectDir  -> history of saved pipelines
// GET /api/runs?workspaceId  -> workspace-store pipelines + live workspace runs
// ---------------------------------------------------------------------------
app.get('/api/runs', async (req, res) => {
  // Workspace arm: when workspaceId is present (and projectDir absent), list the
  // workspace store's pipelines + live workspace runs (§2.7). A bad/unknown id
  // reads as not-found (404), matching the run-target + detail routes.
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  if (workspaceId && !resolveProjectDir(req.query.projectDir)) {
    if (!WORKSPACE_KEY_RE.test(workspaceId)) return res.status(404).json({ error: 'workspace not found' });
    try {
      const ws = await readWorkspace(workspaceId);
      if (!ws) return res.status(404).json({ error: 'workspace not found' });
      const primaryDir = ws.projectPaths[0] || null;
      const pipelines = (await listWorkspacePipelines(ws.id, primaryDir, { withPr: true })) || [];
      const live = [...runs.values()]
        .filter((r) => r.workspaceId === ws.id)
        .map((r) => ({ id: r.pipelineId || r.id, runId: r.id, title: r.title, status: r.status, live: true }));
      return res.json({ pipelines, live, ghAvailable: await hasGh() });
    } catch (err) {
      return res.status(500).json({ error: err && err.message ? err.message : String(err) });
    }
  }

  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const pipelines = (await Promise.resolve(listPipelines(projectDir, { withPr: true }))) || [];
    // Also expose any live (in-memory) runs for this project that may not yet
    // be on disk, so the UI history reflects an active run too.
    const live = [...runs.values()]
      .filter((r) => r.projectDir === projectDir)
      .map((r) => ({
        // Surface the on-disk pipeline id as `id` once createPipeline has run, so
        // renderHistory's dedup-by-id merges this entry with its disk twin. The
        // UUID stays on `runId` because WS / answer / stop route by runs-Map key.
        id: r.pipelineId || r.id,
        runId: r.id,
        title: r.title,
        status: r.status,
        live: true,
      }));
    res.json({ pipelines, live, ghAvailable: await hasGh() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id?projectDir  -> saved pipeline markdown + state
// ---------------------------------------------------------------------------
app.get('/api/runs/:id', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const id = req.params.id;
  try {
    const data = await Promise.resolve(readPipeline(projectDir, id));
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Shared query-scope resolver for the retained-work routes (recovery-patch GET +
// discard POST). Returns null after writing the error response itself. The older
// DELETE /api/runs/:id route keeps its inline copy DELIBERATELY (it shadows the
// imported projectKey(), derives no store key, and maps RETAINED_WORKTREE).
function resolveRunScope(req, res) {
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  const projectKey_ = typeof req.query.projectKey === 'string' ? req.query.projectKey.trim() : '';
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (workspaceId && !WORKSPACE_KEY_RE.test(workspaceId)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (projectKey_ && !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(projectKey_)) {
    res.status(404).json({ error: 'pipeline not found' });
    return null;
  }
  if (!workspaceId && !projectKey_ && !projectDir) {
    badRequest(res, 'workspaceId, projectKey or projectDir is required');
    return null;
  }
  const key = workspaceId ? `workspaces/${workspaceId}` : (projectKey_ || projectKey(projectDir));
  return { workspaceId, projectKey: projectKey_, projectDir, key };
}

// Download the durable done-path diff as an alternate recovery route for a
// retained worktree. The filename is fixed; callers cannot supply a path.
app.get('/api/runs/:id/recovery-patch', async (req, res) => {
  const id = req.params.id;
  const scope = resolveRunScope(req, res);
  if (!scope) return;
  const key = scope.key; // the body's readRunArtifactText(key, …) calls stay unchanged
  try {
    // Prefer a retained-work snapshot (any member's, incl. workspace-suffixed
    // names) over the done-path diff. Resolved through the artifacts INDEX, which
    // only gains a row on a SUCCESSFUL snapshot — a truncated or missing file can
    // never shadow the diff-patch fallback.
    const arts = await listArtifacts(id).catch(() => []);
    const retainedRel = arts.find((a) => a && a.kind === 'retained-work-patch')?.relPath || null;
    let filename = null;
    let patch = retainedRel == null ? null : await readRunArtifactText(key, id, retainedRel);
    if (patch != null && patch.length) {
      filename = `retained-work-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    } else {
      patch = await readRunArtifactText(key, id, DIFF_PATCH_FILE);
      filename = `diff-patch-${String(id).replace(/[^a-zA-Z0-9._-]/g, '-')}.patch`;
    }
    if (patch == null) return res.status(404).json({ error: 'recovery patch not found' });
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.type('text/x-diff').send(patch);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/runs/:id/overview  -> Layer-2 on-demand overview agent.
// Accepts ?key=<storeKey> (preferred; history detail uses it) or ?projectDir=...
// ?force=1 bypasses the cached overview.json. 200 { overview } | 404 | 500.
// ---------------------------------------------------------------------------
app.post('/api/runs/:id/overview', async (req, res) => {
  const id = req.params.id;
  let key = typeof req.query.key === 'string' ? req.query.key : null;
  if (!key) {
    const projectDir = resolveProjectDir(req.query.projectDir);
    if (!projectDir) return badRequest(res, 'key or projectDir is required');
    key = projectKey(projectDir);
  }
  const force = req.query.force === '1' || req.query.force === 'true';
  try {
    const overview = await generateOverview(key, id, { force });
    res.json({ overview });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    const code = msg === 'pipeline not found' ? 404 : 500;
    res.status(code).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history  -> machine-wide history across every onboarded project
// ---------------------------------------------------------------------------
app.get('/api/history', async (_req, res) => {
  try {
    // Self-heal records left 'running' by a dead process before listing, so History
    // never shows a phantom Running run and its Delete button appears (see
    // pipeline-delete ACTIVE / app.js isDeletableEntry — both allow 'interrupted').
    try { reconcileStaleRunning({ liveIds: liveRunIds() }); } catch { /* best-effort */ }
    // Phase 1: PR-light skeleton (no `gh pr list`). Live PR state is pushed
    // separately over the WS by POST /api/history/pr -> enrichPipelinesPr.
    res.json({ pipelines: (await listAllPipelines()) || [], ghAvailable: await hasGh() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Lightweight sidebar-count snapshot. Three cheap COUNT(*) queries — deliberately NOT
// the full list endpoints, so a navigation/refresh never pulls the (potentially large)
// machine-wide history just to update a badge. Running is derived client-side from the
// in-memory runs map (live via WS), so it is not included here. Synchronous: the three
// helpers are sync getDb().prepare(...).get() calls.
app.get('/api/counts', (_req, res) => {
  try {
    res.json({
      pipelines: countPipelines(),
      projects: countProjects(),
      workspaces: countWorkspaces(),
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats?range=today|week|month|all  -> the Statistics view payload (§6.9).
// Pure DB reads; an unknown range is the caller's fault, so getStats' RangeError
// maps to 400 while anything else keeps bubbling to the error handler.
app.get('/api/stats', (req, res) => {
  try {
    const range = typeof req.query.range === 'string' && req.query.range ? req.query.range : 'month';
    res.json(getStats({ range }));
  } catch (err) {
    if (err instanceof RangeError) return badRequest(res, err.message);
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /api/history/pr  -> enrich the skeleton with live PR state, pushed back
// over the WS as batched `history-pr` events (reuses broadcast(), the same
// fire-to-every-socket primitive wireRun/wireScan use). The body's `token`
// echoes the client's load token so it can drop stale batches after a newer
// Refresh. Responds 200 immediately; results arrive asynchronously.
// ---------------------------------------------------------------------------
app.post('/api/history/pr', async (req, res) => {
  const token = Number(req.body && req.body.token) || 0;
  res.json({ ok: true }); // results arrive over WS
  try {
    await enrichPipelinesPr((items, done) =>
      broadcast({ type: 'history-pr', token, done, items }));
  } catch {
    broadcast({ type: 'history-pr', token, done: true, items: [] }); // always terminate the spinner
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id  -> saved pipeline markdown + state, by store key
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const data = await readPipelineByKey(req.params.key, req.params.id);
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id/log  -> the run's persisted live-log NDJSON (text)
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id/log', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunLogText(req.params.key, req.params.id);
    if (text == null) return res.status(404).json({ error: 'no log' });
    res.type('application/x-ndjson').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/history/:key/:id/diff -> the run's persisted diff-patch.patch, inline
// (text/x-diff). Exists only for runs that reached done (results are built on
// the done path only); everything else 404s and the UI shows its empty state.
// Key validation mirrors the /log route (:1529); the artifact read follows the
// recovery-patch route's readRunArtifactText pattern (:1408) — the log routes
// themselves use the specialized readRunLogText. The relPath is the CONSTANT
// DIFF_PATCH_FILE: readRunArtifactText does not guard traversal, so no route may
// ever pass user input there.
// ---------------------------------------------------------------------------
app.get('/api/history/:key/:id/diff', async (req, res) => {
  if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(req.params.key)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(req.params.key, req.params.id, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/runs/:id?projectKey=...  (or ?projectDir=...)
// ARCHIVE a FINISHED pipeline: reclaims everything on disk — its store folder,
// its shared plan/review markdown, its artifacts index rows, and its local
// branch + worktree — then soft-deletes the row (`archived_at`) instead of
// dropping it, so its cost and outcome stay in Statistics forever. The row
// disappears from History and every list/count read. The remote branch is never
// touched. Refused (409) while the run is live in this process.
// ---------------------------------------------------------------------------
app.delete('/api/runs/:id', async (req, res) => {
  const id = req.params.id;
  const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId.trim() : '';
  const projectKey = typeof req.query.projectKey === 'string' ? req.query.projectKey.trim() : '';
  const projectDir = resolveProjectDir(req.query.projectDir);
  // A workspace pipeline routes to store/workspaces/<key>/; its id reads as
  // not-found when malformed (no path-traversal surface).
  if (workspaceId && !WORKSPACE_KEY_RE.test(workspaceId)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  if (projectKey && !/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(projectKey)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  if (!workspaceId && !projectKey && !projectDir) {
    return badRequest(res, 'workspaceId, projectKey or projectDir is required');
  }

  // Never tear down a pipeline that is still live in this server process.
  const liveActive = [...runs.values()].some((r) =>
    (r.pipelineId === id || r.id === id) &&
    ['running', 'starting', 'created', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (liveActive) return res.status(409).json({ error: 'cannot delete a running pipeline' });

  try {
    const report = await archivePipeline({
      workspaceKey: workspaceId || null,
      key: workspaceId ? null : (projectKey || null),
      projectDir: (workspaceId || projectKey) ? null : projectDir,
      id,
    });
    if (!report) return res.status(404).json({ error: 'pipeline not found' });
    emitChanged('pipelines-changed', 'deleted');
    res.json({ ok: true, ...report });
  } catch (e) {
    if (e && e.code === 'RUNNING') return res.status(409).json({ error: e.message });
    if (e && e.code === 'RETAINED_WORKTREE') return res.status(409).json({ error: e.message });
    if (e && e.code === 'BAD_REQUEST') return badRequest(res, e.message);
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Reclaim only worktrees retained after a teardown commit failure. Unlike
// Archive, this keeps the pipeline in History and saves recovery patches first.
app.post('/api/runs/:id/discard-worktree', async (req, res) => {
  const id = req.params.id;
  const scope = resolveRunScope(req, res);
  if (!scope) return;
  const liveActive = [...runs.values()].some((r) =>
    (r.pipelineId === id || r.id === id) &&
    ['running', 'starting', 'created', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (liveActive) return res.status(409).json({ error: 'cannot discard a running pipeline worktree' });

  try {
    const report = await discardRetainedWorktrees({
      workspaceKey: scope.workspaceId || null,
      key: scope.workspaceId ? null : (scope.projectKey || null),
      projectDir: (scope.workspaceId || scope.projectKey) ? null : scope.projectDir,
      id,
    });
    if (!report) return res.status(404).json({ error: 'pipeline not found' });
    emitChanged('pipelines-changed', 'updated');
    res.json({ ok: true, ...report });
  } catch (e) {
    if (e && e.code === 'RUNNING') return res.status(409).json({ error: e.message });
    if (e && e.code === 'SNAPSHOT_FAILED') return res.status(409).json({ error: e.message });
    if (e && e.code === 'BAD_REQUEST') return badRequest(res, e.message);
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/pr  -> push the pipeline's feature branch (if needed) and open a PR
// against its source branch via the GitHub CLI. Mergeability is read back only
// here (never during list rendering). body: { id, projectDir? , projectKey? }
// ---------------------------------------------------------------------------
app.post('/api/pr', async (req, res) => {
  const body = req.body || {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return badRequest(res, 'id is required');
  if (!(await hasGh())) {
    return res.status(409).json({ error: 'GitHub CLI (gh) is not available' });
  }

  // Resolve the pipeline state (by store key, else by project dir).
  let state = null;
  try {
    if (typeof body.projectKey === 'string' && body.projectKey.trim()) {
      if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(body.projectKey)) {
        return res.status(404).json({ error: 'pipeline not found' });
      }
      const data = await readPipelineByKey(body.projectKey, id);
      state = data && data.state;
    } else {
      const projectDir = resolveProjectDir(body.projectDir);
      if (!projectDir) return badRequest(res, 'projectDir or projectKey is required');
      const data = await readPipeline(projectDir, id);
      state = data && data.state;
    }
  } catch (err) {
    return res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
  if (!state) return res.status(404).json({ error: 'pipeline not found' });

  const repoDir = state.projectDir;
  const feature = state.branch && state.branch.feature;
  const source = state.branch && state.branch.source;
  if (!repoDir || !feature || !source) {
    return badRequest(res, 'pipeline has no branch info to open a PR');
  }

  // Push (idempotent) -> create PR -> read mergeability. All args are passed as
  // an argv array (no shell), so branch/source names cannot inject.
  const pushed = await pushBranch(repoDir, feature);
  if (!pushed.ok) return res.status(500).json({ error: `git push failed: ${pushed.stderr}` });

  const pr = await createPr({ projectDir: repoDir, base: source, head: feature, title: state.title || feature });
  if (!pr.ok) return res.status(500).json({ error: `gh pr create failed: ${pr.error}` });

  // Persist the PR facts we just learned, so History/stats survive a gh outage.
  const parsePrNumber = (u) => Number((/\/pull\/(\d+)/.exec(u) || [])[1]) || null;
  const pipelineIdForPr = state?.id || id;   // prefer the canonical state id
  if (pipelineIdForPr) {
    persistPrState(pipelineIdForPr, { url: pr.url, number: parsePrNumber(pr.url), state: 'OPEN' });
  }

  const mergeable = await prMergeable({ projectDir: repoDir, head: feature });
  res.json({ ok: true, url: pr.url, mergeable, existed: !!pr.existed });
});

// ---------------------------------------------------------------------------
// POST /api/pr/mergeable -> re-read mergeability for a pipeline's PR head so the
// History UI can refresh the "merge: checking…" pill after GitHub finishes its
// async computation. Read-only + best-effort: no push, no create — just
// `gh pr view`. Missing `id` is the ONLY hard error (400, like /api/pr); every
// other failure (gh missing, unresolvable pipeline, bad key, thrown error)
// resolves to UNKNOWN (200) so the client simply hides the pill.
// body: { id, projectKey? , projectDir? }
// ---------------------------------------------------------------------------
app.post('/api/pr/mergeable', async (req, res) => {
  const body = req.body || {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!id) return badRequest(res, 'id is required');
  if (!(await hasGh())) return res.json({ ok: true, mergeable: 'UNKNOWN' });

  try {
    // Resolve the pipeline state (by store key, else by project dir) — mirrors /api/pr.
    let state = null;
    if (typeof body.projectKey === 'string' && body.projectKey.trim()) {
      if (!/^[a-z0-9][a-z0-9-]*-[0-9a-f]{8}$/.test(body.projectKey)) {
        return res.json({ ok: true, mergeable: 'UNKNOWN' });
      }
      const data = await readPipelineByKey(body.projectKey, id);
      state = data && data.state;
    } else {
      const projectDir = resolveProjectDir(body.projectDir);
      if (!projectDir) return badRequest(res, 'projectDir or projectKey is required');
      const data = await readPipeline(projectDir, id);
      state = data && data.state;
    }

    const repoDir = state && state.projectDir;
    const feature = state && state.branch && state.branch.feature;
    if (!repoDir || !feature) return res.json({ ok: true, mergeable: 'UNKNOWN' });

    const mergeable = await prMergeable({ projectDir: repoDir, head: feature });
    res.json({ ok: true, mergeable });
  } catch {
    res.json({ ok: true, mergeable: 'UNKNOWN' });   // best-effort: never error the refresh
  }
});

// ---------------------------------------------------------------------------
// POST /api/install  -> copy agents + skill into <projectDir>/.claude
// body: { projectDir }
// ---------------------------------------------------------------------------
app.post('/api/install', async (req, res) => {
  const projectDir = resolveProjectDir((req.body || {}).projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const result = await installAgents(projectDir);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Project registry: GET list / POST add / DELETE remove. Thin delegation to
// src/core/projects.mjs (which owns validation + persistence).
// ---------------------------------------------------------------------------
app.get('/api/branches', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const [branches, current] = await Promise.all([
      listLocalBranches(projectDir),
      currentBranch(projectDir),
    ]);
    res.json({ branches, current });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/projects', async (_req, res) => {
  try {
    res.json({ projects: await listProjects() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/projects', async (req, res) => {
  const body = req.body || {};
  try {
    const projects = await addProject({ name: body.name, path: body.path });
    emitChanged('projects-changed', 'created');
    res.json({ projects });
  } catch (err) {
    // addProject only throws on validation (empty/duplicate/not-a-directory), so
    // a thrown error here is a client error -> 400. (A rare write-time I/O error
    // would also surface as 400; acceptable for this single-user local tool.)
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

app.delete('/api/projects', async (req, res) => {
  const name = typeof req.query.name === 'string' ? req.query.name : '';
  if (!name.trim()) return badRequest(res, 'name is required');
  try {
    const projects = await removeProject(name);
    emitChanged('projects-changed', 'deleted');
    res.json({ projects });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Filesystem browsing for the add-project folder selector. Hybrid picker:
// POST /api/fs/pick-folder opens the native OS dialog (the server runs on the
// user's machine); when it reports `unsupported` the UI falls back to an
// in-app modal fed by GET /api/fs/dirs. Localhost-only like every route here
// (global isLocalRequest middleware).
app.post('/api/fs/pick-folder', async (_req, res) => {
  try {
    res.json(await pickFolderNative());
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/fs/dirs', async (req, res) => {
  try {
    res.json(await listFolders(typeof req.query.path === 'string' ? req.query.path : ''));
  } catch (err) {
    if (err && err.code === 'BAD_REQUEST') return badRequest(res, err.message);
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Workspace registry: a named set of 2+ onboarded git repos with one editable
// interconnection description. Thin delegation to src/core/workspaces.mjs (which
// owns validation + persistence); the route maps err.code -> HTTP exactly like
// /api/projects + /api/workflows. The :id is the workspaceKey, validated against
// WORKSPACE_KEY_RE before any disk touch (a stale/crafted id reads as 404).
// ---------------------------------------------------------------------------
app.get('/api/workspaces', async (_req, res) => {
  try {
    res.json({ workspaces: await listWorkspaces() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  try {
    const workspace = await readWorkspace(id);
    if (!workspace) return res.status(404).json({ error: 'workspace not found' });
    res.json({ workspace });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/workspaces', async (req, res) => {
  const body = req.body || {};
  // Normalize member paths through the same single source of truth as /api/run;
  // createWorkspace re-normalizes + de-dupes by canonical root, but a fast <2
  // reject here matches the spec's defense-in-depth (§2.3).
  const projectPaths = Array.isArray(body.projectPaths)
    ? body.projectPaths.map((p) => resolveProjectDir(p)).filter(Boolean)
    : [];
  if (projectPaths.length < 2) return badRequest(res, 'a workspace needs at least 2 member projects');
  try {
    const workspace = await createWorkspace({ name: body.name, projectPaths, description: body.description });
    emitChanged('workspaces-changed', 'created');
    res.status(201).json({ workspace });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.patch('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  const body = req.body || {};
  // Immutability (defense-in-depth, §2.3): the project set never changes via PATCH.
  if ('projectPaths' in body || 'projectKeys' in body) {
    return badRequest(res, 'a workspace project set is immutable; PATCH accepts only name/description');
  }
  // Pass through only the editable fields.
  const patch = {};
  if (typeof body.name === 'string') patch.name = body.name;
  if (typeof body.description === 'string') patch.description = body.description;
  try {
    const workspace = await updateWorkspace(id, patch);
    res.json({ workspace });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.delete('/api/workspaces/:id', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  // 409 while a live workspace run OR live scan for this workspace exists. The
  // module-level deleteWorkspace has no runs map, so this guard lives here (§2.3).
  const live = [...runs.values()].some((r) =>
    r.workspaceId === id &&
    ['running', 'starting', 'created', 'scanning', 'pausing'].includes(String(r.status || '').toLowerCase()));
  if (live) return res.status(409).json({ error: 'cannot delete a workspace with a live run or scan' });
  try {
    const report = await deleteWorkspace(id);
    emitChanged('workspaces-changed', 'deleted');
    res.json({ ok: true, warnings: (report && report.warnings) || [] });
  } catch (err) {
    const status = workspaceErrorStatus(err && err.code);
    return res.status(status).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Scan endpoints (the wizard's backend, §2.4 / §5.4). Both fire-and-forget:
// mint scanId, register a kind:'scan' entry in the SAME runs Map, wire its
// scan-* events, start createWorkspaceScan(...).run() detached, return {scanId}.
// The scan NEVER persists workspaces.json — persistence is the wizard's explicit
// follow-up CRUD call (POST create / PATCH re-scan).
// ---------------------------------------------------------------------------

/**
 * Shared launcher for both scan routes (DRY, §2.4). Mints scanId, registers the
 * entry, wires events, starts the engine detached with a .catch backstop that
 * converts an unexpected throw into a broadcast scan-error (status 'error') so
 * the process never crashes on a fire-and-forget scan.
 * @param {{projectPaths:string[], name?:string, workspaceId?:string}} args
 * @returns {string} scanId
 */
function startScan({ projectPaths, name, workspaceId }) {
  const orch = createWorkspaceScan({
    projectPaths,
    name,
    agentsDir: AGENTS_DIR,
    claude: { permissionMode: 'acceptEdits', mock: isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK) },
  });
  // The engine mints its own scanId (scan_<uuid>) and tags every emitted event
  // with it; use THAT as the runs-Map key + the returned id so the entry, its
  // buffered events, and WS reconnect/replay (?scanId=) all agree on one id.
  const scanId = orch.getState().scanId;
  const entry = {
    id: scanId,
    scanId,
    orch,
    kind: 'scan',
    projectDir: (Array.isArray(projectPaths) && projectPaths[0]) || null,
    workspaceId: workspaceId || null,
    title: name || 'workspace scan',
    status: 'scanning',
    startedAt: new Date().toISOString(),
    events: [],
    pendingQuestion: null,
  };
  runs.set(scanId, entry);
  wireScan(entry);

  Promise.resolve()
    .then(() => orch.run())
    .catch((err) => {
      // run() should never throw (it emits scan-error), but a defensive backstop
      // mirrors POST /api/run: surface an unexpected throw as a tagged scan-error.
      const event = { scanId, type: 'scan-error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return scanId;
}

// POST /api/workspaces/scan (pre-persist, Step 2->3). Takes projectPaths directly:
// validate >=2 paths + fs.existsSync each + reject non-git-repos (400); the deep
// git work happens inside the engine.
app.post('/api/workspaces/scan', async (req, res) => {
  try {
    const body = req.body || {};
    const projectPaths = Array.isArray(body.projectPaths)
      ? body.projectPaths.map((p) => resolveProjectDir(p)).filter(Boolean)
      : [];
    if (projectPaths.length < 2) return badRequest(res, 'a workspace scan needs at least 2 member projects');
    for (const dir of projectPaths) {
      if (!fs.existsSync(dir)) return badRequest(res, `member path is missing: ${dir}`);
      if (!isGitRepo(dir)) return badRequest(res, `member is not a git repository: ${dir}`);
    }
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined;
    const scanId = startScan({ projectPaths, name });
    res.json({ scanId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/workspaces/:id/scan (re-scan). Reads the workspace (404 if absent),
// scans ws.projectPaths, tags the entry with workspaceId. 409 if a live run for
// that workspace already exists (avoid graphify-build contention).
app.post('/api/workspaces/:id/scan', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'workspace not found' });
  try {
    const ws = await readWorkspace(id);
    if (!ws) return res.status(404).json({ error: 'workspace not found' });
    const liveRun = [...runs.values()].some((r) =>
      r.workspaceId === id && r.kind === 'workspace-run' &&
      ['running', 'starting', 'created'].includes(String(r.status || '').toLowerCase()));
    if (liveRun) return res.status(409).json({ error: 'a live run exists for this workspace' });
    const scanId = startScan({ projectPaths: ws.projectPaths, name: ws.name, workspaceId: ws.id });
    res.json({ scanId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/scan/stop  body:{scanId} -> entry.orch.stop() (aborts in-flight
// investigators + best-effort scan-worktree/branch cleanup in the engine's
// finally, D4); marks the entry 'stopped'. Idempotent: an unknown/finished scan
// still returns ok.
app.post('/api/scan/stop', (req, res) => {
  const scanId = req.body && typeof req.body.scanId === 'string' ? req.body.scanId : '';
  const entry = scanId ? runs.get(scanId) : null;
  if (entry && entry.kind === 'scan' && entry.orch && typeof entry.orch.stop === 'function') {
    try { entry.orch.stop(); } catch { /* best-effort */ }
    entry.status = 'stopped';
  }
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// GET /api/workspaces/:id/runs/:runId  -> persisted state + markdown for a
// finished workspace run. The /api/history/:key/:id key regex forbids a slash,
// so a workspace run (store key "workspaces/<key>") needs this dedicated route.
// readWorkspacePipeline joins ONLY workspaceStorePath(validatedKey) -> no
// path-traversal surface; do NOT widen the history :key regex (§2.7).
// ---------------------------------------------------------------------------
app.get('/api/workspaces/:id/runs/:runId', async (req, res) => {
  const id = req.params.id;
  if (!WORKSPACE_KEY_RE.test(id)) return res.status(404).json({ error: 'pipeline not found' });
  try {
    const data = await readWorkspacePipeline(id, req.params.runId);
    if (!data) return res.status(404).json({ error: 'pipeline not found' });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workspaces/:id/runs/:runId/log', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunLogText(`workspaces/${req.params.id}`, req.params.runId);
    if (text == null) return res.status(404).json({ error: 'no log' });
    res.type('application/x-ndjson').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workspaces/:id/runs/:runId/diff', async (req, res) => {
  if (!WORKSPACE_KEY_RE.test(req.params.id)) {
    return res.status(404).json({ error: 'pipeline not found' });
  }
  try {
    const text = await readRunArtifactText(`workspaces/${req.params.id}`, req.params.runId, DIFF_PATCH_FILE);
    if (text == null) return res.status(404).json({ error: 'no diff' });
    res.type('text/x-diff').send(text);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings  -> { root, projectsRoot, projectsRootDefault, default }
//   root                : the configured Worca CC data-root base, '' when unset
//                         (the `default` field is what applies then).
//   projectsRoot        : the RAW persisted projectsRoot (§5.1), '' when unset —
//                         the same raw contract as `root`, NOT the effective
//                         value. Two reasons this is not getProjectsRoot():
//                         (a) an effective value is never '', so "unset" would be
//                         indistinguishable from "explicitly set" and the UI's
//                         "leave blank" affordance would be unreachable;
//                         (b) WORCA_PROJECTS_ROOT would be echoed as if stored,
//                         and the next Save would promote that env override into
//                         settings.json. Runs still resolve via getProjectsRoot().
//   projectsRootDefault : what applies when projectsRoot is blank — the env tier
//                         when exported, else defaultRoot(). The UI placeholder.
//                         Additive; `default` keeps its `root` meaning.
// POST /api/settings -> set either key and return the resulting full state.
//   Only keys PRESENT in the body are written, so a projectsRoot-only POST can
//   never reset `root` (and vice versa). An explicitly empty value still resets
//   that one key. A body with neither key keeps today's contract: it resets root.
//   The other settings keys (runRootMode, the two context caps, skillMount) are
//   settings-file-only in this change and deliberately not exposed here.
// Validation lives in src/core/settings.mjs; this is thin delegation mirroring
// /api/projects.
// ---------------------------------------------------------------------------
const settingsState = () => ({
  root: getWorcaRoot(), projectsRoot: rawProjectsRoot(),
  projectsRootDefault: defaultProjectsRoot(), default: defaultRoot(),
  pipelineCostLimitUsd: pipelineCostLimitUsd(),
  totalCostLimitUsd: totalCostLimitUsd(),
  costLimitResetPeriod: costLimitResetPeriod(),
});

app.get('/api/settings', (_req, res) => {
  res.json({ ...settingsState(), chat: chatPrefs() });
});

app.get('/api/budget', (_req, res) => {
  res.json(budgetStatus());
});

app.post('/api/settings', async (req, res) => {
  const body = req.body || {};
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
  const hasBudgetKey = has('pipelineCostLimitUsd') || has('totalCostLimitUsd') || has('costLimitResetPeriod');
  // Normalize the budget keys first, then validate them as a SET before ANY write.
  // Each setter persists on its own, so a two-key POST whose second key is invalid
  // used to answer 400 with the first key already on disk, no budget-changed
  // emitted, and a client (which early-returns on !res.ok) still painting its
  // pre-save values over a half-applied settings file.
  const budget = {};
  if (has('pipelineCostLimitUsd')) budget.pipelineCostLimitUsd = body.pipelineCostLimitUsd ?? '';
  if (has('totalCostLimitUsd')) budget.totalCostLimitUsd = body.totalCostLimitUsd ?? '';
  if (has('costLimitResetPeriod')) {
    budget.costLimitResetPeriod = typeof body.costLimitResetPeriod === 'string' ? body.costLimitResetPeriod : '';
  }
  try {
    assertCostLimitInputs(budget);
    if (has('chat')) await setChatPrefs(body.chat);
    if (has('projectsRoot')) {
      await setProjectsRoot(typeof body.projectsRoot === 'string' ? body.projectsRoot : '');
    }
    if (has('pipelineCostLimitUsd')) await setPipelineCostLimitUsd(budget.pipelineCostLimitUsd);
    if (has('totalCostLimitUsd')) await setTotalCostLimitUsd(budget.totalCostLimitUsd);
    if (has('costLimitResetPeriod')) await setCostLimitResetPeriod(budget.costLimitResetPeriod);
    // Legacy contract: a POST that names no known key clears root. Budget keys
    // must not trip it — a budget-only save would otherwise wipe the root.
    if (has('root') || !(has('projectsRoot') || hasBudgetKey || has('chat'))) {
      await setWorcaRoot(typeof body.root === 'string' ? body.root : '');
    }
    if (hasBudgetKey) emitChanged('budget-changed');
    res.json({ ...settingsState(), chat: chatPrefs() });
  } catch (err) {
    // The setters throw only on an unusable path -> client error (400).
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// Per-project model/effort config + custom-model registry. Validation lives in
// src/core/config.mjs; these routes are thin delegation (mirror /api/projects).
// ---------------------------------------------------------------------------
app.get('/api/config', async (req, res) => {
  const raw = req.query.projectDir;
  // No project selected yet (e.g. a fresh clone): still return the catalog so
  // the picker is never empty. The project-less catalog is predefined ⊕ GLOBAL
  // entries (the global catalog is project-independent by design §4.2); only
  // legacy per-project custom models need a projectDir.
  if (raw == null || raw === '') {
    return res.json({
      config: { steps: {}, customModels: [] },
      models: await listModels(''), steps: agentSteps(), efforts: EFFORTS,
    });
  }
  const projectDir = resolveProjectDir(raw);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    // readRunConfig returns the full per-project config: legacy steps/customModels
    // PLUS the run-config workflows{} (node model/effort, feedback cycles) and
    // activeWorkflowId. It is a superset of readConfig, so the client keeps using
    // config.steps unchanged while gaining config.workflows / config.activeWorkflowId.
    // NOTE: readRunConfig forwards unknown extra keys verbatim — a project
    // configured under the REMOVED per-project guardrails model may still show
    // its raw legacy blob under config.guardrails. It is inert: nothing
    // interprets it (guardrails are selected per run via /api/guardrails).
    const [config, models] = await Promise.all([
      readRunConfig(projectDir), listModels(projectDir),
    ]);
    res.json({
      config, models, steps: agentSteps(), efforts: EFFORTS,
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/config', async (req, res) => {
  const body = req.body || {};
  const projectDir = resolveProjectDir(body.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    await setStep(projectDir, body.step, {
      model: body.model, effort: body.effort, fanOut: body.fanOut, askQuestions: body.askQuestions,
    });
    // Respond with the FULL run-config (mirrors PATCH): setStep's return value is
    // the legacy {steps, customModels} view only, and clients assign the response
    // to their whole config state — echoing the narrow view dropped workflows/
    // activeWorkflowId and made saved node models paint as unconfigured.
    const config = await readRunConfig(projectDir);
    res.json({ config });
  } catch (err) {
    // setStep throws only on validation (unknown step/model/effort) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/config -> write run-config: per-node model/effort, per-feedback
// cycle counts, and the active workflow id. Keyed by workflowId + node/feedback
// instance ids (see RunConfig in the design). Legacy per-role `steps` are
// written via POST /api/config and are left untouched here. setNodeModel now
// validates model/effort against the effective catalog exactly like setStep
// (configurable-models-design.md §4.5) -> 400; setFeedbackCycles still COERCES
// maxCycles to >= 1 (it never throws).
// body: { projectDir, workflowId, nodes?:{[id]:{model,effort}}, feedbacks?:{[id]:{maxCycles}}, activeWorkflowId? }
// ---------------------------------------------------------------------------
app.patch('/api/config', async (req, res) => {
  const body = req.body || {};
  const projectDir = resolveProjectDir(body.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : '';
  try {
    if (body.nodes && typeof body.nodes === 'object') {
      if (!workflowId) return badRequest(res, 'workflowId is required to set node config');
      for (const [nodeId, sel] of Object.entries(body.nodes)) {
        await setNodeModel(projectDir, workflowId, nodeId, {
          model: sel && sel.model, effort: sel && sel.effort,
          fanOut: sel && sel.fanOut, askQuestions: sel && sel.askQuestions,
        });
      }
    }
    if (body.feedbacks && typeof body.feedbacks === 'object') {
      if (!workflowId) return badRequest(res, 'workflowId is required to set feedback config');
      for (const [fbId, sel] of Object.entries(body.feedbacks)) {
        await setFeedbackCycles(projectDir, workflowId, fbId, sel && sel.maxCycles);
      }
    }
    if (typeof body.activeWorkflowId === 'string' && body.activeWorkflowId.trim()) {
      await setActiveWorkflow(projectDir, body.activeWorkflowId.trim());
    }
    const config = await readRunConfig(projectDir);
    res.json({ config });
  } catch (err) {
    // The config.mjs setters throw only on validation (unknown model/effort,
    // maxCycles < 1) -> client error, mirroring POST /api/config.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/config/workflow -> "Reset to defaults" for one workflow in one
// project (newpipeline-ux-design.md §4.5). Drops every per-node/per-feedback
// override (and, for wf_default, the legacy per-role steps) so the accordion
// falls back to the workflow's defaults + the agent registry. Idempotent:
// resetting an already-clean project is a no-op 200.
// query: ?projectDir=&workflowId=
// ---------------------------------------------------------------------------
app.delete('/api/config/workflow', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const workflowId = typeof req.query.workflowId === 'string' ? req.query.workflowId.trim() : '';
  if (!workflowId) return badRequest(res, 'workflowId is required');
  try {
    await resetWorkflowConfig(projectDir, workflowId);
    res.json({ config: await readRunConfig(projectDir) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/config/models (the per-project ADD) is deliberately GONE: new
// models are added to the GLOBAL catalog via POST /api/models (design §4.9 —
// the add flow moves entirely to the global Models view). DELETE stays so
// legacy per-project entries can still be cleaned up.
app.delete('/api/config/models', async (req, res) => {
  const projectDir = resolveProjectDir(req.query.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  const id = typeof req.query.id === 'string' ? req.query.id : '';
  if (!id.trim()) return badRequest(res, 'id is required');
  try {
    const config = await removeCustomModel(projectDir, id);
    res.json({ config, models: await listModels(projectDir) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Global model catalog (configurable-models-design.md §4.10). Project-less by
// design — the catalog lives in ~/.worca-cc/settings.json (settings.mjs) and
// applies to every project. Env VALUES are secrets-adjacent: responses carry
// them MASKED (write-only editing; a whole-value ${VAR} ref is config, not a
// secret, and passes through readable), and a PATCH that echoes a masked value
// back means "keep" and is dropped from the write.
// ---------------------------------------------------------------------------

const maskEnvValue = (v) =>
  (modelEnvRef(v) ? v : (v.length > 8 ? `••••••${v.slice(-4)}` : '••••••'));
const maskedGlobalModel = (m) => (m.env
  ? { ...m, env: Object.fromEntries(Object.entries(m.env).map(([k, v]) => [k, maskEnvValue(v)])) }
  : m);
const isMaskedEcho = (v) => typeof v === 'string' && v.startsWith('••');
const maskedGlobalModels = () => {
  const flagged = costUnreliableModelIds(); // §4.6 observed flag, merged for the editor's badge
  return listGlobalModels().map((m) => ({
    ...maskedGlobalModel(m),
    ...(flagged.has(m.id.toLowerCase()) ? { costUnreliable: true } : {}),
  }));
};

/** Read-only plugin model entries (design §9.7): literals masked with the
 *  standard masker, ${VAR} refs readable, {secret} placeholders surfaced as
 *  display markers with their set-ness. */
const pluginModelsPayload = () => {
  const flagged = costUnreliableModelIds();
  const statusByPlugin = new Map();
  return listPluginModels().map((m) => {
    if (!statusByPlugin.has(m.plugin)) statusByPlugin.set(m.plugin, pluginModelSecretStatus(m.plugin));
    const status = statusByPlugin.get(m.plugin);
    return {
      id: m.id, label: m.label, efforts: m.efforts, plugin: m.plugin,
      env: Object.fromEntries(Object.entries(m.env ?? {}).map(([k, v]) => [
        k, typeof v === 'string' ? maskEnvValue(v) : `(secret: ${v.secret})`,
      ])),
      secrets: status.filter((s) => m.secrets.includes(s.key)),
      ...(flagged.has(m.id.toLowerCase()) ? { costUnreliable: true } : {}),
    };
  });
};

app.get('/api/models', (req, res) => {
  res.json({ models: maskedGlobalModels(), plugin: pluginModelsPayload(), predefined: PREDEFINED_MODELS, efforts: EFFORTS });
});

app.post('/api/models', async (req, res) => {
  const b = req.body || {};
  try {
    const model = await addGlobalModel({ id: b.id, label: b.label, efforts: b.efforts, env: b.env });
    res.json({ model: maskedGlobalModel(model), models: maskedGlobalModels() });
  } catch (err) {
    // addGlobalModel throws only on validation (empty/dup id, unknown effort,
    // reserved env key, non-string env value) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Promote a legacy per-project custom model to the global catalog (§4.9).
// Refs survive by construction — see promoteCustomModel. Registered before the
// :id routes only for readability; POST /api/models/promote shares no method
// with them, so there is no capture conflict.
app.post('/api/models/promote', async (req, res) => {
  const b = req.body || {};
  const projectDir = resolveProjectDir(b.projectDir);
  if (!projectDir) return badRequest(res, 'projectDir is required');
  try {
    const config = await promoteCustomModel(projectDir, b.id);
    res.json({ config, models: maskedGlobalModels() });
  } catch (err) {
    // Throws only on validation (unknown project model) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Export selected global models as a plugin scaffold (design §9.5). Body:
// { name, description?, version?, dest, models: [{ id, env: {KEY: mode} }] }
// with mode 'include' (stored value verbatim — literal or ${VAR} ref text),
// 'secret' (strip the value; declare a modelSecrets placeholder the importer
// fills at install), or 'omit'. Reads RAW env values server-side — same trust
// boundary as GET /api/models/:id/env-value (the user's own settings.json,
// deliberate action). Distribution is git-only: the scaffold folder is what
// gets pushed; no zip.
app.post('/api/models/export-plugin', async (req, res) => {
  const b = req.body || {};
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!MANIFEST_PLUGIN_NAME_RE.test(name) || name.length > 64) {
    return badRequest(res, 'name must be kebab-case (e.g. "discretestack-models")');
  }
  const picks = Array.isArray(b.models) ? b.models : [];
  if (!picks.length) return badRequest(res, 'models must be a non-empty array');
  const destRaw = typeof b.dest === 'string' ? b.dest.trim() : '';
  if (!destRaw) return badRequest(res, 'dest is required');
  const home = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const dest = path.resolve(destRaw.startsWith('~') ? path.join(home, destRaw.slice(1)) : destRaw);
  try {
    if (fs.existsSync(dest)) {
      if (!fs.statSync(dest).isDirectory()) return badRequest(res, 'dest exists and is not a directory');
      if (fs.readdirSync(dest).length) return badRequest(res, 'dest folder is not empty');
    }
  } catch (err) {
    return badRequest(res, `dest is not usable: ${err.message}`);
  }

  const globals = listGlobalModels();
  const secretKeyFor = (envKey) => envKey.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const models = [];
  const modelSecrets = new Map(); // secret key -> { key, label }
  for (const pick of picks) {
    const id = pick && typeof pick.id === 'string' ? pick.id.trim() : '';
    const entry = globals.find((m) => m.id.toLowerCase() === id.toLowerCase());
    if (!entry) return badRequest(res, `unknown global model id ${JSON.stringify(id)}`);
    const modes = pick.env && typeof pick.env === 'object' && !Array.isArray(pick.env) ? pick.env : {};
    const env = {};
    for (const [k, mode] of Object.entries(modes)) {
      if (!entry.env || !(k in entry.env)) return badRequest(res, `model ${JSON.stringify(entry.id)} has no env key ${JSON.stringify(k)}`);
      if (mode === 'omit') continue;
      if (mode === 'include') { env[k] = entry.env[k]; continue; }
      if (mode === 'secret') {
        const skey = secretKeyFor(k);
        if (!skey) return badRequest(res, `cannot derive a secret key from ${JSON.stringify(k)}`);
        if (!modelSecrets.has(skey)) modelSecrets.set(skey, { key: skey, label: k });
        env[k] = { secret: skey };
        continue;
      }
      return badRequest(res, `env mode for ${JSON.stringify(k)} must be include | secret | omit`);
    }
    models.push({
      id: entry.id,
      ...(entry.label !== entry.id ? { label: entry.label } : {}),
      ...(entry.efforts.length && entry.efforts.length !== EFFORTS.length ? { efforts: entry.efforts } : {}),
      ...(Object.keys(env).length ? { env } : {}),
    });
  }

  const manifest = {
    name,
    ...(typeof b.version === 'string' && b.version.trim() ? { version: b.version.trim() } : { version: '0.1.0' }),
    ...(typeof b.description === 'string' && b.description.trim() ? { description: b.description.trim() } : {}),
    models,
    ...(modelSecrets.size ? { modelSecrets: [...modelSecrets.values()] } : {}),
  };
  // Belt: the scaffold must install anywhere this host would — validate before writing.
  const norm = normalizeManifest(manifest);
  if (!norm.ok) return badRequest(res, `generated manifest is invalid: ${norm.errors.join('; ')}`);

  const readme = [
    `# ${name}`,
    '',
    manifest.description || 'Worca CC model plugin.',
    '',
    '## Models',
    '',
    ...models.map((m) => `- \`${m.id}\`${m.label ? ` — ${m.label}` : ''}`),
    ...(modelSecrets.size ? [
      '',
      '## Secrets requested at install',
      '',
      ...[...modelSecrets.values()].map((s) => `- \`${s.key}\` (${s.label})`),
      '',
      'Teammates set these under the plugin\'s **Model secrets** after installing;',
      'values live in their local `data/secrets.json` (0600) and never in this repo.',
    ] : []),
    '',
    '## Publish',
    '',
    '```sh',
    `cd ${dest}`,
    'git init -b main && git add -A && git commit -m "model plugin"',
    'git remote add origin <your-team-repo-url> && git push -u origin main',
    '```',
    '',
    '## Install (teammates)',
    '',
    'Worca CC → Plugins → Add repo → paste the repo URL → Install.',
    'Model secrets are prompted in the plugin\'s configuration panel.',
    '',
  ].join('\n');

  try {
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'worca-cc-plugin.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(dest, 'README.md'), readme, 'utf8');
  } catch (err) {
    return res.status(500).json({ error: `could not write the scaffold: ${err.message}` });
  }
  res.json({
    ok: true, dir: dest, files: ['worca-cc-plugin.json', 'README.md'],
    modelSecrets: [...modelSecrets.values()],
  });
});

app.patch('/api/models/:id', async (req, res) => {
  const b = req.body || {};
  // Write-only env: strip masked echoes (unchanged values a client sent back)
  // so they read as "keep", never as a literal '••…' secret. env: null still
  // means "clear the whole map" and passes through untouched.
  let env = b.env;
  if (env && typeof env === 'object' && !Array.isArray(env)) {
    env = Object.fromEntries(Object.entries(env).filter(([, v]) => !isMaskedEcho(v)));
  }
  try {
    const model = await updateGlobalModel(req.params.id, { label: b.label, efforts: b.efforts, env });
    res.json({ model: maskedGlobalModel(model), models: maskedGlobalModels() });
  } catch (err) {
    // updateGlobalModel throws only on validation (unknown id, unknown effort,
    // reserved env key) -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// Preview what deleting a global entry would clear (feeds the confirmation
// dialog; design §4.5). Unknown ids just report empty refs — preview never 400s.
app.get('/api/models/:id/refs', (req, res) => {
  res.json(globalModelRefs(req.params.id));
});

// Reveal raw env value(s) for the editor's copy button and Show-values toggle.
// The default GET surface stays masked (accidental exposure in screenshots/
// devtools); this is a deliberate read of what the user already owns on disk
// in ~/.worca-cc/settings.json — same trust boundary, explicit action.
// ?key=K -> { key, value }; no key -> { env } (the whole raw map).
app.get('/api/models/:id/env-value', (req, res) => {
  const entry = listGlobalModels().find((m) => m.id.toLowerCase() === String(req.params.id).toLowerCase());
  if (!entry) return badRequest(res, `unknown model id ${JSON.stringify(req.params.id)}`);
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (!key) return res.json({ env: { ...(entry.env || {}) } });
  if (!entry.env || !(key in entry.env)) return badRequest(res, `model has no env key ${JSON.stringify(key)}`);
  res.json({ key, value: entry.env[key] });
});

app.delete('/api/models/:id', async (req, res) => {
  try {
    const result = await removeGlobalModelAndRefs(req.params.id);
    res.json({ ...result, models: maskedGlobalModels() });
  } catch (err) {
    // Throws only on an unknown id -> client error.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// ---------------------------------------------------------------------------
// Workflow templates (global store at ~/.worca-cc/workflows). Topology only;
// model/effort/cycles live in per-project run-config. CRUD mirrors the
// /api/projects + /api/config delegation pattern: thin handlers, validation and
// atomic persistence owned by src/core/workflows.mjs + workflow-validator.mjs.
// ---------------------------------------------------------------------------
// Validate one node-defaults block against the project-less catalog. Returns an
// error message, or '' when the block is acceptable. Mirrors setStep's rules so a
// workflow default can never name something a per-project override could not.
function nodeDefaultsError(raw, models, where) {
  if (raw == null) return '';
  if (typeof raw !== 'object' || Array.isArray(raw)) return `defaults for ${where} must be an object`;
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const effort = typeof raw.effort === 'string' ? raw.effort.trim() : '';
  const entry = model ? models.find((m) => m.id === model) : null;
  if (model && !entry) return `unknown model "${model}"`;
  if (!effort) return '';
  if (!EFFORTS.includes(effort)) return `unknown effort "${effort}"`;
  if (!entry) return 'select a model before choosing an effort';
  if (!entry.efforts.includes(effort)) return `model "${model}" does not support effort "${effort}"`;
  return '';
}

app.get('/api/workflows', async (_req, res) => {
  try {
    // The built-in default is never persisted to the user store; callers
    // prepend it (CONTRACT: GET -> { workflows: [DEFAULT_WORKFLOW, ...listWorkflows()] }).
    res.json({ workflows: [DEFAULT_WORKFLOW, ...(await listWorkflows())] }); // CONV-1: await
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/workflows/:id', async (req, res) => {
  try {
    const tpl = await readWorkflow(req.params.id); // CONV-1: await; returns DEFAULT_WORKFLOW for "wf_default"
    if (!tpl) return res.status(404).json({ error: 'workflow not found' });
    res.json(tpl);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/workflows', async (req, res) => {
  const body = req.body || {};
  // Build the candidate template from the editor payload (topology only).
  const tpl = {
    name: typeof body.name === 'string' ? body.name.trim() : '',
    domain: typeof body.domain === 'string' ? body.domain : undefined, // writeWorkflow normDomain → 'general' if absent/blank/malformed
    steps: Array.isArray(body.steps) ? body.steps : [],
    feedbacks: Array.isArray(body.feedbacks) ? body.feedbacks : [],
  };
  if (!tpl.name) return badRequest(res, 'name is required');
  try {
    // Per-node defaults ride along in steps (§4.4); hold them to the same catalog
    // rules as PATCH .../defaults so an imported template cannot smuggle in a
    // model id that no per-project override would be allowed to name.
    const models = await listModels('');
    for (const group of tpl.steps) {
      for (const node of Array.isArray(group) ? group : []) {
        if (!node || typeof node !== 'object' || node.defaults === undefined) continue;
        const err = nodeDefaultsError(node.defaults, models, `node "${node.id}"`);
        if (err) return badRequest(res, err);
      }
    }
    const registry = loadAgentRegistry(AGENTS_DIR);
    const { ok, errors, warnings } = validateWorkflow(tpl, registry);
    if (!ok) return res.status(400).json({ error: 'invalid workflow', errors, warnings });
    // writeWorkflow stamps id/createdAt/updatedAt and writes atomically (temp+rename).
    const workflow = await writeWorkflow(tpl); // CONV-1: await
    res.status(201).json({ workflow, warnings });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/workflows/:id/defaults -> set the template's per-node defaults
// (newpipeline-ux-design.md §4.4). body: { defaults: { [nodeId]: {model?, effort?,
// fanOut?, askQuestions?} | null } }; null (or an empty block) clears a node, an
// absent node keeps what it has. Model/effort validate against the PROJECT-LESS
// catalog (predefined ⊕ global ⊕ plugin) — defaults are global, so a legacy
// per-project custom model is deliberately not a valid default.
// ---------------------------------------------------------------------------
app.patch('/api/workflows/:id/defaults', async (req, res) => {
  const body = req.body || {};
  const map = body.defaults;
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return badRequest(res, 'defaults must be an object keyed by node id');
  }
  try {
    const models = await listModels('');
    for (const [nodeId, raw] of Object.entries(map)) {
      const err = nodeDefaultsError(raw, models, `node "${nodeId}"`);
      if (err) return badRequest(res, err);
    }
    const workflow = await setWorkflowNodeDefaults(req.params.id, map);
    res.json({ workflow, defaults: workflowNodeDefaults(workflow) });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    // "workflow not found" is a 404; the frozen-default refusal and any shape
    // complaint are caller errors — nothing here is a server fault.
    if (/not found/i.test(message)) return res.status(404).json({ error: message });
    return badRequest(res, message);
  }
});

app.delete('/api/workflows/:id', async (req, res) => {
  const id = req.params.id;
  // The built-in default is not in the user store and must never be deleted.
  if (id === 'wf_default') return badRequest(res, 'the default workflow cannot be deleted');
  try {
    const removed = await deleteWorkflow(id); // CONV-1: await
    if (!removed) return res.status(404).json({ error: 'workflow not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Guardrail sets (global store, table guardrail_sets). The built-ins
// Permissive / Normal / Strict are VIRTUAL (GUARDRAIL_PRESETS) — the server
// prepends them, they are never persisted (CONTRACT mirrors /api/workflows:
// GET -> { guardrails: [...listBuiltinGuardrailSets(), ...listGuardrailSets()] }).
// Thin handlers: persistence in guardrail-store.mjs, 400s from validateGuardrails.
// DELETE maps the store's ReferencedError -> 409 { error, references }
// (structural match — the sendPluginError pattern; references are paused runs
// whose resume_point pins the set).
// ---------------------------------------------------------------------------
function sendGuardrailError(res, err) {
  const message = err && err.message ? err.message : String(err);
  if (err && (err.name === 'ReferencedError' || err.code === 'REFERENCED')) {
    return res.status(409).json({ error: message, references: err.references || [] });
  }
  res.status(500).json({ error: message });
}

app.get('/api/guardrails', async (_req, res) => {
  try {
    const sets = await listGuardrailSets(); // CONV-1: await
    res.json({ guardrails: [...listBuiltinGuardrailSets(), ...sets] });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.get('/api/guardrails/:id', async (req, res) => {
  try {
    const set = await readGuardrailSet(req.params.id); // CONV-1: await; built-ins resolve virtually
    if (!set) return res.status(404).json({ error: 'guardrail set not found' });
    res.json(set);
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/guardrails', async (req, res) => {
  const body = req.body || {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return badRequest(res, 'name is required');
  if (name.length > 200) return badRequest(res, 'name too long (max 200 characters)');
  const v = validateGuardrails(body.settings ?? {});
  if (!v.ok) return res.status(400).json({ error: 'invalid guardrails', errors: v.errors });
  try {
    // POST is CREATE, not upsert: a minted id colliding with an existing set must
    // never silently REPLACE it (the existing set may be the policy other runs
    // select). Renames/edits go through PUT.
    const mintedId = `gr_${slugify(name)}`;
    if (await readGuardrailSet(mintedId)) {
      return res.status(409).json({ error: 'a guardrail set with this name already exists' });
    }
    const set = await writeGuardrailSet({ name, settings: body.settings || {} }); // CONV-1: await
    if (!set) return badRequest(res, 'invalid guardrail set id'); // defensive: minted gr_ ids never hit this
    res.status(201).json({ guardrails: set });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.put('/api/guardrails/:id', async (req, res) => {
  const id = req.params.id;
  if (isBuiltinGuardrailSetId(id)) return badRequest(res, 'built-in guardrail sets cannot be edited');
  const body = req.body || {};
  try {
    const existing = await readGuardrailSet(id);
    if (!existing) return res.status(404).json({ error: 'guardrail set not found' });
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : existing.name;
    if (name.length > 200) return badRequest(res, 'name too long (max 200 characters)');
    // `== null` on purpose: validateGuardrails(null) is early-ok (guardrails.mjs:132-134),
    // so a strict `=== undefined` check would let {settings: null} silently wipe a
    // selected set to the empty policy. null/absent both mean "keep stored".
    const settings = body.settings == null ? existing.settings : body.settings;
    const v = validateGuardrails(settings);
    if (!v.ok) return res.status(400).json({ error: 'invalid guardrails', errors: v.errors });
    const set = await writeGuardrailSet({ id, name, settings, createdAt: existing.createdAt }); // CONV-1: await
    if (!set) return badRequest(res, 'invalid guardrail set id');
    res.json({ guardrails: set });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.delete('/api/guardrails/:id', async (req, res) => {
  const id = req.params.id;
  // Built-ins are not in the user store and must never be deleted.
  if (isBuiltinGuardrailSetId(id)) return badRequest(res, 'built-in guardrail sets cannot be deleted');
  try {
    const removed = await deleteGuardrailSet(id); // CONV-1: await; throws ReferencedError while pinned
    if (!removed) return res.status(404).json({ error: 'guardrail set not found' });
    res.json({ ok: true });
  } catch (err) {
    sendGuardrailError(res, err);
  }
});

// ---------------------------------------------------------------------------
// /api/agents* -> agent registry + user-agent CRUD, delegated to
// src/core/agent-store.mjs (layered builtin + ~/.worca-cc/agents user pairs).
// GET returns palette render order (.order ascending) with origin stamped; the
// client builds draggable pills (colored dot + displayName + icon) from this.
// ---------------------------------------------------------------------------
// Channel vocabulary for the UI editor/wizard: built-in CHANNEL_IDS first, then
// every CUSTOM id any registry agent references (produces/consumes/
// optionalConsumes/channelDefs[].id), appended sorted + deduped. Channels are an
// open vocabulary — a closed list would silently strip custom ids on edit.
function collectChannelIds(agents) {
  const customs = new Set();
  for (const a of Array.isArray(agents) ? agents : []) {
    if (!a) continue;
    const ids = [
      ...(Array.isArray(a.produces) ? a.produces : []),
      ...(Array.isArray(a.consumes) ? a.consumes : []),
      ...(Array.isArray(a.optionalConsumes) ? a.optionalConsumes : []),
      ...(Array.isArray(a.channelDefs) ? a.channelDefs.map((d) => d && d.id) : []),
    ];
    for (const id of ids) {
      if (typeof id === 'string' && id && !CHANNEL_IDS.includes(id)) customs.add(id);
    }
  }
  return [...CHANNEL_IDS, ...[...customs].sort()];
}

app.get('/api/agents', async (req, res) => {
  try {
    const all = await listAgents(); // merged builtin+user, origin stamped, .order ascending
    // §6.6: workspace-only agents stay out of the Composer palette by default;
    // the Agents management view passes ?all=1 to see them too.
    const agents = isTruthy(req.query.all) ? all : all.filter((m) => m.scope !== 'workspace-only');
    res.json({ agents, channels: collectChannelIds(all) });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// Map agent-store err.code -> HTTP (mirrors workspaceErrorStatus).
function agentErrorStatus(code) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  if (code === 'PLUGIN') return 400;
  if (code === 'BUILTIN' || code === 'DUPLICATE' || code === 'REFERENCED') return 409;
  return 500;
}

/**
 * Fire-and-forget agent generation (mirrors startScan). Mints genId, registers
 * a kind:'agentgen' entry in the SAME runs Map, wires its agentgen-* events,
 * starts createAgentGen(...).run() detached with a .catch backstop, returns
 * genId. The draft is NEVER saved — persistence is the wizard's explicit
 * follow-up POST /api/agents.
 * @returns {string} genId
 */
function startAgentGen(input) {
  const orch = createAgentGen({
    ...input,
    // Same open vocabulary as GET /api/agents (callers pass the registry union);
    // built-ins-only fallback keeps direct/_testing callers working.
    channels: Array.isArray(input.channels) && input.channels.length ? input.channels : CHANNEL_IDS,
    claude: { permissionMode: 'acceptEdits', mock: isTruthy(process.env.WORCA_MOCK ?? process.env.ORCH_MOCK) },
  });
  // The engine mints its own genId (agen_<uuid>) and tags every emitted event
  // with it; use THAT as the runs-Map key + the returned id so the entry, its
  // buffered events, and WS reconnect/replay (?genId=) all agree on one id.
  const genId = orch.getState().genId;
  const entry = {
    id: genId, genId, orch, kind: 'agentgen', projectDir: null,
    title: `agent: ${input.name}`, status: 'running',
    startedAt: new Date().toISOString(), events: [], pendingQuestion: null,
  };
  runs.set(genId, entry);
  wireAgentGen(entry);

  Promise.resolve()
    .then(() => orch.run())
    .catch((err) => {
      // run() should never throw (it emits agentgen-error), but a defensive
      // backstop mirrors startScan: surface an unexpected throw as a tagged
      // agentgen-error.
      const event = { genId, type: 'agentgen-error', message: err && err.message ? err.message : String(err) };
      entry.status = 'error';
      entry.events.push(event);
      broadcast(event);
    });

  return genId;
}

// POST /api/agents/generate. Registered BEFORE GET /api/agents/:key so the
// literal segment is never swallowed by the :key param. Mode A (purpose given):
// the LLM drafts both the .md body and the meta JSON. Mode B (userMarkdown
// given): the body is the user's verbatim; the LLM infers ONLY the meta.
app.post('/api/agents/generate', async (req, res) => {
  try {
    const body = req.body || {};
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return badRequest(res, 'name is required');
    const userMarkdown = typeof body.userMarkdown === 'string' && body.userMarkdown.trim() ? body.userMarkdown : '';
    if (!userMarkdown && !(typeof body.purpose === 'string' && body.purpose.trim())) {
      return badRequest(res, 'purpose is required (or paste your own markdown)');
    }
    // Resolve neighbor keys to full agent metas (produces/consumes feed the
    // prompt's neighbor block); unknown keys are silently dropped.
    const allAgents = await listAgents();
    const byKey = Object.fromEntries(allAgents.map((m) => [m.key, m]));
    const pick = (keys) => (Array.isArray(keys) ? keys : []).map((k) => byKey[k]).filter(Boolean);
    const genId = startAgentGen({
      name, purpose: String(body.purpose || ''), details: String(body.details || ''),
      expectedBefore: pick(body.expectedBefore), expectedAfter: pick(body.expectedAfter),
      userMarkdown, channels: collectChannelIds(allAgents),
    });
    res.json({ genId });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/agents/generate/stop  body:{genId} -> entry.orch.stop() (aborts the
// in-flight runClaude; the engine's finally reaps its scratch dir); marks the
// entry 'stopped'. Idempotent: an unknown/finished generation still returns ok
// (mirrors POST /api/scan/stop).
app.post('/api/agents/generate/stop', (req, res) => {
  const genId = req.body && typeof req.body.genId === 'string' ? req.body.genId : '';
  const entry = genId ? runs.get(genId) : null;
  if (entry && entry.kind === 'agentgen' && entry.orch && typeof entry.orch.stop === 'function') {
    try { entry.orch.stop(); } catch { /* best-effort */ }
    entry.status = 'stopped';
  }
  res.json({ ok: true });
});

app.get('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  try {
    const data = await readAgent(key);
    if (!data) return res.status(404).json({ error: 'agent not found' });
    res.json(data); // { meta (incl. origin), markdown }
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/agents', async (req, res) => {
  const body = req.body || {};
  try {
    const created = await createAgent({ meta: body.meta, markdown: body.markdown });
    res.status(201).json(created);
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.put('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  const body = req.body || {};
  try {
    res.json(await updateAgent(key, { meta: body.meta, markdown: body.markdown }));
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.delete('/api/agents/:key', async (req, res) => {
  const key = req.params.key;
  if (!AGENT_KEY_RE.test(key)) return res.status(404).json({ error: 'agent not found' });
  try {
    res.json(await deleteAgent(key));
  } catch (err) {
    res.status(agentErrorStatus(err && err.code)).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// /api/plugins* -> plugin lifecycle, delegated to src/core/plugin-store.mjs /
// plugin-repo.mjs / plugin-config.mjs (spec §6). Thin wrappers: all policy
// (SHA pinning, symlink swap, uninstall guard, secret routing) lives in core.
// ---------------------------------------------------------------------------
// :name guard for every /api/plugins/:name route. Manifest names are kebab-case
// (normalizeManifest, plugin-manifest.mjs), so a value failing this regex can
// never contain '/' or '..' — pluginDir(name)/pluginCurrentDir(name) cannot
// escape the namespace — and it reads as "not found" (mirrors the AGENT_KEY_RE
// guard on /api/agents/:key). Existence = lockfile membership.
const PLUGIN_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
function requirePlugin(req, res) {
  const name = req.params.name;
  if (!PLUGIN_NAME_RE.test(name) || !readPluginsLock()[name]) {
    res.status(404).json({ error: 'plugin not found' });
    return null;
  }
  return name;
}

// :id guard for every /api/marketplaces/:id route. Real ids come from repoSlug
// (`<readable [A-Za-z0-9._-]>-<8 hex>`), so this regex admits every legitimate
// id and nothing path-like. The null-prototype map from readMarketplaces already
// blocks `__proto__`/`constructor` lookups in add/sync/remove; Object.hasOwn
// here is belt-and-suspenders.
const MARKETPLACE_ID_RE = /^[A-Za-z0-9._-]{1,100}$/;
function requireMarketplace(req, res) {
  const id = req.params.id;
  if (!MARKETPLACE_ID_RE.test(id) || !Object.hasOwn(readMarketplaces().marketplaces, id)) {
    res.status(404).json({ error: 'marketplace not found' });
    return null;
  }
  return id;
}

// Map plugin-core err.code -> HTTP (mirrors agentErrorStatus). The uninstall
// guard's ReferencedError (plugin-workflows.mjs) is matched structurally so its
// payload (the referencing list) reaches the client; everything uncoded is a
// 500 with the verbatim message (spec §11: surface command output unchanged).
function pluginErrorStatus(code) {
  if (code === 'NOT_FOUND') return 404;
  if (code === 'BAD_REQUEST') return 400;
  if (code === 'REFERENCED') return 409;
  if (code === 'EXISTS') return 409;
  return 500;
}
function sendPluginError(res, err) {
  const message = err && err.message ? err.message : String(err);
  if (err && (err.name === 'ReferencedError' || err.code === 'REFERENCED')) {
    return res.status(409).json({ error: message, references: err.references || [] });
  }
  res.status(pluginErrorStatus(err && err.code)).json({ error: message });
}

// Load the installed manifest through the current/ symlink. null = broken
// install (missing/unparseable) — routes answer 409 "run doctor", not a crash.
function readInstalledManifest(name) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(pluginCurrentDir(name), 'worca-cc-plugin.json'), 'utf8'));
    const norm = normalizeManifest(raw, { dir: pluginCurrentDir(name) });
    return norm.ok ? norm.manifest : null;
  } catch {
    return null;
  }
}

app.get('/api/plugins', (req, res) => {
  try {
    const mkts = readMarketplaces().marketplaces;
    res.json({
      plugins: listInstalledPlugins().map((p) => ({
        ...p,
        marketplaceName: p.marketplace && mkts[p.marketplace] ? mkts[p.marketplace].name : null,
      })),
      orphans: listOrphanPluginData(),
    });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// Marketplaces (spec §4.7): the persisted repo registry behind the Plugins
// view's Available/Marketplaces sections. Snapshots are cached in
// marketplaces.json, so GET is zero-network; refresh routes do the git work.

// Merge lock membership onto each snapshot plugin. MUST wrap every response that
// returns marketplace snapshots — refresh routes return raw entries whose plugins
// have no `installed` key, and renderAvailableList would re-offer Install on them.
function withInstalled(list) {
  const lock = readPluginsLock();
  return (list || []).map((m) => ({
    ...m, plugins: (m.plugins || []).map((p) => ({ ...p, installed: !!lock[p.name] })),
  }));
}

app.get('/api/marketplaces', (req, res) => {
  try {
    res.json({ marketplaces: withInstalled(listMarketplaces()) });
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces', async (req, res) => {
  const url = req.body && typeof req.body.url === 'string' ? req.body.url.trim() : '';
  if (!url) return badRequest(res, 'url is required');
  try {
    res.json({ ok: true, marketplace: withInstalled([await addMarketplace(url)])[0] });
  } catch (err) { sendPluginError(res, err); }
});

// refresh-all (a distinct path from :id/refresh, so registration order is irrelevant).
app.post('/api/marketplaces/refresh', async (req, res) => {
  try {
    res.json({ ok: true, marketplaces: withInstalled(await refreshAllMarketplaces()) });
  } catch (err) { sendPluginError(res, err); }
});

app.post('/api/marketplaces/:id/refresh', async (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json({ ok: true, marketplace: withInstalled([await syncMarketplace(id)])[0] });
  } catch (err) { sendPluginError(res, err); }
});

app.delete('/api/marketplaces/:id', (req, res) => {
  const id = requireMarketplace(req, res);
  if (!id) return;
  try {
    res.json(removeMarketplace(id));
  } catch (err) { sendPluginError(res, err); }
});

// POST /api/plugins/install { repoUrl, subdir, name, sha } — the consent point
// (§6.1). installPlugin does export -> setup -> doctor -> atomic swap -> lock,
// with cleanup on failure; the returned inventory is echoed as the UI receipt.
app.post('/api/plugins/install', async (req, res) => {
  const body = req.body || {};
  for (const k of ['repoUrl', 'name', 'sha']) {
    if (!(typeof body[k] === 'string' && body[k].trim())) return badRequest(res, `${k} is required`);
  }
  const subdir = typeof body.subdir === 'string' ? body.subdir : '';
  // A4: layer-3 option-injection guard on the install body. (?!-) rejects
  // dash-leading segments too, matching parseMarketplaceManifest exactly — no
  // defense layer may be laxer than the others.
  if (subdir && !/^(?!-)[A-Za-z0-9._-]+(\/(?!-)[A-Za-z0-9._-]+)*$/.test(subdir)) {
    return badRequest(res, 'invalid subdir');
  }
  const marketplace = typeof body.marketplace === 'string' && MARKETPLACE_ID_RE.test(body.marketplace)
    ? body.marketplace : undefined;
  try {
    const out = await installPlugin({
      repoUrl: body.repoUrl.trim(), subdir, name: body.name.trim(), sha: body.sha.trim(), marketplace,
    });
    reloadChatWorkers(body.name.trim());
    res.json(out); // { ok: true, inventory }
  } catch (err) {
    sendPluginError(res, err);
  }
});

// POST /api/plugins/:name/update — two-phase (§6.2): without { confirm: true }
// it ONLY previews (commit log + diffstat between pinned and candidate; nothing
// changes on disk); with it, updatePlugin performs export/setup/doctor/swap/lock.
app.post('/api/plugins/:name/update', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  try {
    if (!(req.body && req.body.confirm === true)) {
      return res.json({ preview: await fetchCandidate(name) });
    }
    const updated = await updatePlugin(name);
    reloadChatWorkers(name);
    res.json(updated);
  } catch (err) {
    sendPluginError(res, err);
  }
});

app.post('/api/plugins/:name/enable', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  if (!req.body || typeof req.body.enabled !== 'boolean') {
    return badRequest(res, 'enabled must be a boolean');
  }
  try {
    setPluginEnabled(name, req.body.enabled);
    reloadChatWorkers(name);
    res.json({ ok: true, enabled: req.body.enabled });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// DELETE /api/plugins/:name — uninstall; purge (body { purge: true } or
// ?purge=1) also removes data/ (config + secrets + state). The referenced-guard
// 409 carries the referencing list so the UI can show what blocks removal.
app.delete('/api/plugins/:name', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const purge = isTruthy(req.query.purge) || !!(req.body && req.body.purge === true);
  try {
    await uninstallPlugin(name, { purge });
    reloadChatWorkers(name);
    res.json({ ok: true, purged: purge });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// DELETE /api/plugins/:name/data — purge an ORPHAN's leftover data/ (config +
// secrets + state). requirePlugin is unusable here: orphans are by definition
// NOT in the lock. 409 while installed (purge flows through uninstall), 404
// when there is nothing to purge.
app.delete('/api/plugins/:name/data', (req, res) => {
  const name = req.params.name;
  if (!PLUGIN_NAME_RE.test(name)) return res.status(404).json({ error: 'plugin not found' });
  try {
    res.json(purgePluginData(name));
  } catch (err) {
    if (err && err.code === 'INSTALLED') return res.status(409).json({ error: err.message });
    if (err && /nothing to purge/.test(err.message || '')) return res.status(404).json({ error: err.message });
    sendPluginError(res, err);
  }
});

app.post('/api/plugins/:name/doctor', async (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  try {
    res.json(await doctorPlugin(name)); // { ok, checks: [{ id, ok, detail }] }
  } catch (err) {
    sendPluginError(res, err);
  }
});

// GET /api/plugins/:name/config -> per-source schema + redacted values. Secrets
// NEVER travel to the browser: redactedConfig replaces a stored secret with
// { set: true } (§7.6).
app.get('/api/plugins/:name/config', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  try {
    const sources = (manifest.taskSources || []).map((s) => ({
      id: s.id,
      schema: s.configSchema,
      values: redactedConfig(name, s.configSchema),
    }));
    const channels = (manifest.chatChannels || []).map((c) => ({
      id: c.id,
      displayName: c.displayName,
      platform: c.platform,
      schema: c.configSchema,
      values: redactedConfig(name, c.configSchema),
    }));
    // Model secrets (design §9.7): same redaction contract — { set: true|false }
    // markers only, never values.
    const msSchema = modelSecretsSchema(name);
    res.json({
      sources,
      channels,
      ...(msSchema.length ? { models: { schema: msSchema, values: redactedConfig(name, msSchema) } } : {}),
    });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// PUT /api/plugins/:name/config { sourceId | channelId, values } ->
// writePluginConfig routes secret:true keys to data/secrets.json (0600,
// atomic). Request values are NEVER logged and NEVER echoed back (the response
// is a bare receipt). A channelId save also hot-restarts the channel worker.
app.put('/api/plugins/:name/config', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const body = req.body || {};
  if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
    return badRequest(res, 'values must be an object');
  }
  const manifest = readInstalledManifest(name);
  if (!manifest) return res.status(409).json({ error: 'plugin manifest unreadable — run doctor' });
  // { target: 'modelSecrets', values } writes the plugin-level model secrets
  // (design §9.7) — same write-only semantics, routed by the synthesized schema.
  if (body.target === 'modelSecrets') {
    const schema = modelSecretsSchema(name);
    if (!schema.length) return badRequest(res, 'plugin declares no modelSecrets');
    try {
      writePluginConfig(name, schema, body.values);
      return res.json({ ok: true });
    } catch (err) {
      return sendPluginError(res, err);
    }
  }
  let schema;
  if (typeof body.channelId === 'string' && body.channelId) {
    const channel = (manifest.chatChannels || []).find((c) => c.id === body.channelId);
    if (!channel) return badRequest(res, 'channelId does not match a chat channel of this plugin');
    schema = channel.configSchema;
  } else {
    const sources = manifest.taskSources || [];
    const sourceId = typeof body.sourceId === 'string' && body.sourceId
      ? body.sourceId
      : (sources.length === 1 ? sources[0].id : '');
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return badRequest(res, 'sourceId does not match a task source of this plugin');
    schema = source.configSchema;
  }
  try {
    writePluginConfig(name, schema, body.values);
    reloadChatWorkers(name);
    res.json({ ok: true });
  } catch (err) {
    sendPluginError(res, err);
  }
});

// GET /api/plugins/:name/model-env?id=<modelId> — the RAW manifest env of one
// plugin model, for the Models view "Edit a copy" prefill (design §9.6).
// Literals and ${VAR} ref text return verbatim (they came from a shared repo,
// not this user's secrets); {secret} placeholders are NEVER resolved — their
// env keys are listed in `secretKeys` so the editor renders empty rows.
app.get('/api/plugins/:name/model-env', (req, res) => {
  const name = requirePlugin(req, res);
  if (!name) return;
  const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
  const model = listPluginModels().find((m) => m.plugin === name && m.id.toLowerCase() === id.toLowerCase());
  if (!model) return badRequest(res, `plugin "${name}" provides no model ${JSON.stringify(id)}`);
  const env = {};
  const secretKeys = [];
  for (const [k, v] of Object.entries(model.env ?? {})) {
    if (typeof v === 'string') env[k] = v;
    else secretKeys.push(k);
  }
  res.json({ id: model.id, label: model.label, efforts: model.efforts, env, secretKeys });
});

// ---------------------------------------------------------------------------
// /api/sources* -> task-source discovery + browser-driven connector calls.
// ---------------------------------------------------------------------------
app.get('/api/sources', (req, res) => {
  try {
    res.json({ sources: listTaskSources() }); // builtins + enabled plugin sources
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/sources/call { plugin, sourceId, op, args } — the New Pipeline
// pane's data channel (task-browser search, remote-select options, Test
// connection). op is ALLOWLISTED: the three interface ops + the ops this
// source's manifest names in inputs[].optionsFrom. Anything else (reportResult,
// arbitrary strings) is a 400 — the browser must not drive unadvertised
// connector code paths.
// Error convention: HTTP status = caller correctness (400/404, route style);
// connector outcomes ride the 200 envelope { ok:false, error:{kind,message} }
// because an expired token is a RESULT the pane renders inline (kind-keyed
// message + retry) — matching the contract's { ok, result } shape.
app.post('/api/sources/call', async (req, res) => {
  const body = req.body || {};
  for (const k of ['plugin', 'sourceId', 'op']) {
    if (!(typeof body[k] === 'string' && body[k].trim())) return badRequest(res, `${k} is required`);
  }
  const { plugin, sourceId, op } = body;
  const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
  if (!PLUGIN_NAME_RE.test(plugin) || !readPluginsLock()[plugin]) {
    return res.status(404).json({ error: 'plugin not found' });
  }
  const manifest = readInstalledManifest(plugin);
  const source = manifest && (manifest.taskSources || []).find((s) => s.id === sourceId);
  if (!source) return res.status(404).json({ error: 'task source not found' });
  const allowed = new Set(['listTasks', 'getTask', 'validateConfig']);
  for (const input of source.inputs || []) {
    if (input && typeof input.optionsFrom === 'string' && input.optionsFrom) allowed.add(input.optionsFrom);
  }
  if (!allowed.has(op)) return badRequest(res, `op "${op}" is not allowed for this source`);
  try {
    const result = await callSource({ plugin, sourceId, op, args });
    res.json({ ok: true, result });
  } catch (err) {
    if (err instanceof PluginOpError) {
      return res.json({ ok: false, error: { kind: err.kind, message: err.message } });
    }
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// POST /api/pipelines/:id/report-result — manual write-back retry (§7.5). The
// automatic write-back never blocks 'done'; this is the results-view retry
// button. readPipelineForResume is a pure read-by-id (artifacts.mjs) -> clean
// 404 before delegating to retryWriteback (sources.mjs, Task 13), which itself
// never throws for connector failures.
app.post('/api/pipelines/:id/report-result', async (req, res) => {
  try {
    if (!readPipelineForResume(req.params.id)) {
      return res.status(404).json({ error: 'pipeline not found' });
    }
    res.json(await retryWriteback(req.params.id)); // { ok:true, skipped?:true } | { ok:false, error: string }
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

// ---------------------------------------------------------------------------
// Install logic (mirrors scripts/install.mjs): copy agents/*.md and
// skills/worca/** into <projectDir>/.claude/...
// ---------------------------------------------------------------------------
async function installAgents(projectDir) {
  const claudeDir = path.join(projectDir, '.claude');
  const agentsTarget = path.join(claudeDir, 'agents');
  const skillTarget = path.join(claudeDir, 'skills', 'worca');
  await fsp.mkdir(agentsTarget, { recursive: true });
  await fsp.mkdir(skillTarget, { recursive: true });

  const copied = [];

  // Copy agents/*.md
  if (fs.existsSync(AGENTS_DIR)) {
    const entries = await fsp.readdir(AGENTS_DIR);
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const from = path.join(AGENTS_DIR, name);
      const to = path.join(agentsTarget, name);
      await fsp.copyFile(from, to);
      copied.push(path.relative(projectDir, to));
    }
  }

  // Copy skills/worca/** recursively
  const skillSrc = path.join(SKILLS_DIR, 'worca');
  if (fs.existsSync(skillSrc)) {
    await copyDir(skillSrc, skillTarget, projectDir, copied);
    // Personalize the copied SKILL.md so /worca targets this repo's path.
    await rewriteSkillRepoPath(skillTarget, PROJECT_ROOT);
  }

  return {
    ok: true,
    target: claudeDir,
    copied,
    hint: 'Open Claude Code in this folder and run: /worca <prompt>',
  };
}

/**
 * Rewrite the `<WORCA_REPO>` placeholder in an installed SKILL.md to this repo's
 * absolute path. Best-effort; never throws.
 */
async function rewriteSkillRepoPath(skillTarget, repoRoot) {
  const skillMd = path.join(skillTarget, 'SKILL.md');
  try {
    const original = await fsp.readFile(skillMd, 'utf8');
    const rewritten = original.split('<WORCA_REPO>').join(repoRoot);
    if (rewritten !== original) await fsp.writeFile(skillMd, rewritten, 'utf8');
  } catch {
    /* no SKILL.md or unreadable — skip */
  }
}

async function copyDir(srcDir, destDir, baseForRel, copiedOut) {
  await fsp.mkdir(destDir, { recursive: true });
  const entries = await fsp.readdir(srcDir, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(srcDir, ent.name);
    const to = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      await copyDir(from, to, baseForRel, copiedOut);
    } else if (ent.isFile()) {
      await fsp.copyFile(from, to);
      copiedOut.push(path.relative(baseForRel, to));
    }
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
/**
 * Decode uploaded extra files ([{ name, dataBase64 }]) to a per-run temp dir and
 * return absolute paths. Filenames are reduced to their basename to prevent
 * path traversal. Returns [] when nothing usable was provided.
 * @param {string} runId
 * @param {Array<{name?:string, dataBase64?:string}>} list
 * @returns {Promise<string[]>}
 */
async function writeExtras(runId, list) {
  if (!Array.isArray(list) || list.length === 0) return [];
  const dir = path.join(os.tmpdir(), `orchestrator-extras-${runId}`);
  await fsp.mkdir(dir, { recursive: true });
  const out = [];
  let i = 0;
  for (const item of list) {
    i += 1;
    if (!item || typeof item !== 'object') continue;
    const data = typeof item.dataBase64 === 'string' ? item.dataBase64 : '';
    if (!data) continue;
    // Sanitize to a bare filename; fall back to a generated name.
    let name = path.basename(String(item.name || '').trim());
    if (!name || name === '.' || name === '..') name = `extra-${i}`;
    const dest = path.join(dir, name);
    try {
      await fsp.writeFile(dest, Buffer.from(data, 'base64'));
      out.push(dest);
    } catch {
      /* skip a file we cannot decode/write */
    }
  }
  return out;
}

function isTruthy(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}

// ---------------------------------------------------------------------------
// /api/chat* -> channel worker status + test delivery (design §4.8). Prefs ride
// GET/POST /api/settings; per-plugin channel CONFIG rides /api/plugins/:name/config.
// ---------------------------------------------------------------------------
app.get('/api/chat/status', (_req, res) => {
  try {
    res.json({ channels: channelHost.status() });
  } catch (err) {
    res.status(500).json({ error: err && err.message ? err.message : String(err) });
  }
});

app.post('/api/chat/test', async (req, res) => {
  const { plugin, channelId } = req.body || {};
  if (!plugin || !channelId) return badRequest(res, 'plugin and channelId are required');
  try {
    res.json(await chatNotifier.sendTest(plugin, channelId, renderTest()));
  } catch (err) {
    // Connector-outcome convention: caller correctness -> HTTP status; delivery
    // outcomes ride a 200 envelope elsewhere, but a missing channel/config is
    // the caller's mistake here.
    return badRequest(res, err && err.message ? err.message : String(err));
  }
});

// SPA fallback: any unmatched GET that is not an /api or /ws path serves
// index.html. Implemented as middleware (not a route pattern) so it does not
// depend on path-to-regexp wildcard syntax, which differs between Express 4
// and Express 5.
app.use((req, res, next) => {
  if (req.method !== 'GET') return next();
  if (req.path.startsWith('/api/') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) next();
  });
});

/**
 * Boot maintenance, in the PINNED order (§8.12):
 *   1. reconcileStaleRunning — stamps every stale `running` row -> `interrupted`,
 *   2. sweepRunRoots        — reclaims <worcaHome>/runs/* of finished/crashed runs,
 *   3. sweepLegacyWorktrees — over every REGISTERED project, prunes the
 *      <projectDir>/.worca-cc/worktrees/* the flip to detached run roots left behind.
 *
 * The order is load-bearing, not cosmetic: `interrupted` is a KEEP status for BOTH
 * sweeps, so reconciling first is what stops the very boot that made a crashed run
 * resumable from deleting the checkout it would resume. Reversed, a stale `running`
 * row is still `running` — also KEEP — and the sweeps are merely no-ops: safe but
 * useless.
 *
 * Both sweeps' DB lookups (`runRootSweepLookups` / `legacySweepLookups`, artifacts.mjs)
 * THROW on a DB failure rather than reporting "no row", and each sweep turns that into
 * a SKIPPED candidate in `failed`. An unopenable sqlite file can therefore never be
 * read as "every run was deleted, reclaim them all".
 *
 * Exported (and returning its dispositions) so the order and the legacy sweep's
 * registry fan-out are testable without spawning a server. Fire-and-forget at boot:
 * everything up to the first `await` — including the reconcile — still runs before
 * `server.listen`, exactly as it did when this was an inline block.
 *
 * @param {{log?: (scope:'run-root'|'legacy', level:string, msg:string) => void}} [args]
 *        optional sink for the per-candidate lines both sweeps emit; omitted, each
 *        sweep keeps its own console default.
 */
export async function bootMaintenance({ log } = {}) {
  const summary = { reconciled: 0, runRoots: null, legacy: null };
  const sink = (scope) => (typeof log === 'function' ? (level, msg) => log(scope, level, msg) : undefined);

  // Runs left 'running' by a previous process that died before writing a terminal
  // status (crash/kill/restart). At boot this process owns no live runs.
  try {
    const { reconciled } = reconcileStaleRunning({ liveIds: [] });
    summary.reconciled = reconciled;
    if (reconciled) console.log(`[worca-ui] reconciled ${reconciled} stale running record(s) -> interrupted`);
  } catch (err) {
    console.error(`[worca-ui] stale-run reconcile failed: ${err && err.message ? err.message : err}`);
  }

  try {
    const r = await sweepRunRoots({
      worcaHome: worcaHome(), ...runRootSweepLookups(), log: sink('run-root'),
    });
    summary.runRoots = r;
    if (r.removed.length || r.quarantined.length) {
      console.log(`[worca-ui] run-root sweep: kept ${r.keep.length}, removed ${r.removed.length}, quarantined ${r.quarantined.length}`);
    }
    if (r.failed.length) {
      console.error(`[worca-ui] run-root sweep: ${r.failed.length} run root(s) SKIPPED — run-root lookup failed; nothing was removed`);
      for (const w of r.warnings) console.error(`[worca-ui]   ${w}`);
    }
  } catch (err) {
    console.error(`[worca-ui] run-root sweep failed: ${err && err.message ? err.message : err}`);
  }

  // The one-time legacy sweep (§6 Phase 7). A TOTAL no-op while the effective mode is
  // `legacy` — under legacy those paths hold every live and every paused run, so
  // sweeping them would make the documented §10 rollback self-destroying. The mode is
  // read ONCE, here, so the legacy default costs not even a DB read.
  try {
    const mode = runRootMode();
    if (mode !== 'detached') {
      summary.legacy = { skipped: true, projects: 0, keep: [], removed: [], quarantined: [], failed: [], warnings: [] };
    } else {
      const projects = await listProjects();
      const r = await sweepLegacyWorktreesAll(projects.map((p) => p.path), {
        mode, ...legacySweepLookups(), log: sink('legacy'),
      });
      summary.legacy = r;
      if (r.removed.length || r.quarantined.length) {
        console.log(`[worca-ui] legacy worktree sweep: kept ${r.keep.length}, removed ${r.removed.length}, quarantined ${r.quarantined.length} across ${r.projects} project(s)`);
      }
      if (r.failed.length) {
        console.error(`[worca-ui] legacy worktree sweep: ${r.failed.length} worktree(s) SKIPPED — pipelines-row lookup failed; nothing was removed`);
      }
      for (const w of r.warnings) console.warn(`[worca-ui]   ${w}`);
    }
  } catch (err) {
    console.error(`[worca-ui] legacy worktree sweep failed: ${err && err.message ? err.message : err} — nothing was removed`);
  }
  return summary;
}

// Only bind a port when run directly (`node ui/server.mjs`). When imported by a
// test, skip listening so the test can mount `app` on its own ephemeral port.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  try {
    seedBuiltinMarketplace();
  } catch (err) {
    console.error(`[worca-ui] builtin marketplace seed skipped: ${err && err.message ? err.message : err}`);
  }

  bootMaintenance().catch((err) => {
    console.error(`[worca-ui] boot maintenance failed: ${err && err.message ? err.message : err}`);
  });

  server.on('error', (err) => {
    console.error(`[worca-ui] server error: ${err && err.message ? err.message : err}`);
  });

  server.listen(PORT, HOST, () => {
    const shown = HOST === '127.0.0.1' || HOST === '::1' ? 'localhost' : HOST;
    const url = `http://${shown}:${PORT}`;
    console.log(`[worca-ui] listening on ${url} (bound to ${HOST})`);
    console.log(`[worca-ui] WebSocket on ws://${shown}:${PORT}/ws`);
    try { channelHost.start(); } catch (err) {
      console.error(`[worca-ui] chat channel host failed to start: ${err && err.message ? err.message : err}`);
    }
  });

  // Channel workers must die with the server (design §9: persistent-process
  // hygiene). Graceful shutdown frame -> 5s grace -> SIGKILL, then exit.
  let shuttingDown = false;
  const shutdownChat = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    channelHost.stop().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
  };
  process.on('SIGINT', () => shutdownChat('SIGINT'));
  process.on('SIGTERM', () => shutdownChat('SIGTERM'));
}

export { app, server, runs };
export const _testing = { wireRun, wireScan, summarizeRuns, startScan, wireAgentGen, startAgentGen, chatActions, chatRouter, channelHost, handleChatInbound, enqueueChatWork, chatNotifier, resumeRun };

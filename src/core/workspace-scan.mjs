// src/core/workspace-scan.mjs
//
// The wizard's scan engine (Workspaces Milestone 5, §3). A WorkspaceScan is an
// EventEmitter the server wires onto the WS bus exactly like wireRun wires an
// Orchestrator. It (re)builds per-project graphify graphs in throwaway worktrees
// (D4), fans out one read-only investigator per member through the existing
// `workspaceScanner` agent (driven via runWorkspaceScan in phases.mjs — NOT
// reimplemented here), and synthesizes the editable §5.8 interconnection
// description. Progress streams over the `scan-*` event family:
//
//   scan-progress   { scanId, phase, projectsTotal, projectsDone, message }   (many)
//   scan-done       { scanId, description, projects:[{projectKey,projectName}], graphify:{used} }
//   scan-error      { scanId, message }
//
// Phases progress STRICTLY graph -> investigate -> synthesize. run() NEVER throws
// (it emits scan-error instead), mirroring Orchestrator.run()'s try/catch/finally
// discipline. The scan is read-only: every scan worktree AND its branch are
// force-removed in finally (D4) — this DIFFERS from a run teardown, which keeps
// the branch (the scan branch existed only to isolate the graphify update write).

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { basename } from 'node:path';
import { mkdir, rm, readFile } from 'node:fs/promises';

import { worcaHome } from './projects.mjs';
import { projectKey, canonicalProjectRoot } from './store.mjs';
import { slugify, today } from './artifacts.mjs';
import { detectToolsPerProject, runGraphifyUpdate } from './preflight.mjs';
import {
  createWorktree, removeWorktree, resolveDefaultBranch, sanitizeBranchName,
} from './worktree.mjs';
import { runWorkspaceScan } from './phases.mjs';
import { fanoutCap, mapWithCap } from './fanout.mjs';

// The scanning agent's name in the prompt-role/registry sense (drives the .md body
// it loads; the MOCK_ROLE marker differs — workspace-scan — and is set inside
// runWorkspaceScan, C3). The off-pipeline scanner body is NOT loaded by the
// orchestrator (it is the dispatcher's job), so the engine loads it itself.
const SCANNER_AGENT_FILE = 'worca-cc-workspace-scanner.md';

/**
 * @param {object} opts
 * @param {string[]} opts.projectPaths           absolute member paths (>=2 after dedupe)
 * @param {string}   [opts.name]                 workspace name (heading + scan-branch slug)
 * @param {string}   [opts.agentsDir]            agents/*.md dir (server passes AGENTS_DIR)
 * @param {object}   [opts.claude]               { bin?, model?, permissionMode?, mock? }
 * @param {boolean}  [opts.mock]                 force mock (skips graphify builds); defaults to claude.mock
 * @param {number}   [opts.graphBuildTimeoutMs]  per-project graphify cap (WORCA_GRAPH_TIMEOUT_MS|120000)
 * @param {number}   [opts.fanoutCap]            graph-phase concurrency (default fanoutCap())
 * @returns {WorkspaceScan}
 */
export function createWorkspaceScan(opts = {}) {
  return new WorkspaceScan(opts);
}

class WorkspaceScan extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.opts = opts || {};
    this.name = (typeof this.opts.name === 'string' && this.opts.name.trim()) || 'Workspace';
    this.agentsDir = this.opts.agentsDir || null;
    this.claude = this.opts.claude || {};
    // Mock skips graphify builds (no worktrees, no spawns). claude.mock drives the
    // scanning AGENT; opts.mock can independently force the graph phase off too.
    this.mock = this.opts.mock !== undefined ? !!this.opts.mock : !!this.claude.mock;
    this.graphBuildTimeoutMs = Number(this.opts.graphBuildTimeoutMs)
      || Number(process.env.WORCA_GRAPH_TIMEOUT_MS) || 120000;
    this.cap = Number(this.opts.fanoutCap) > 0 ? Number(this.opts.fanoutCap) : fanoutCap();

    // Resolve + sort members by projectKey ascending (the canonical order used
    // everywhere); de-dupe by canonical root so two paths into the same repo
    // collapse. Each entry carries its absolute dir + key + display name.
    const raw = Array.isArray(this.opts.projectPaths) ? this.opts.projectPaths : [];
    const seen = new Set();
    const members = [];
    for (const dir of raw) {
      if (typeof dir !== 'string' || !dir) continue;
      let root;
      try { root = canonicalProjectRoot(dir); } catch { root = dir; }
      if (seen.has(root)) continue;
      seen.add(root);
      members.push({ projectDir: dir, projectKey: projectKey(dir), projectName: basename(dir) });
    }
    members.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0));
    this.projects = members;

    // Ephemeral id + scratch dir (pre-persist, no workspaceKey yet, §3.6).
    this.scanId = `scan_${randomUUID()}`;
    this.shortId = this.scanId.slice(5, 13); // the 8 hex after "scan_"
    this.scratchDir = join(worcaHome(), 'tmp', 'scan', this.shortId);
    this.outPath = join(this.scratchDir, 'workspace-description.md');

    this.abort = new AbortController();
    this.warnings = [];

    // Live progress state.
    this.phase = 'graph';
    this.projectsTotal = members.length;
    this.projectsDone = 0;
    this.message = 'preparing scan…';
    this.status = 'created';
    this._terminal = false; // guards exactly-one terminal event
  }

  // ── public surface ──────────────────────────────────────────────────────────

  getState() {
    return {
      scanId: this.scanId,
      phase: this.phase,
      projectsTotal: this.projectsTotal,
      projectsDone: this.projectsDone,
      message: this.message,
      status: this.status,
      scratchDir: this.scratchDir,
    };
  }

  /**
   * Abort an in-flight scan. Aborts the signal (which unblocks the scanning agent's
   * runClaude) and flips status to 'stopped'; the run() finally block does the
   * best-effort worktree/branch cleanup and emits the terminal scan-error{stopped}.
   */
  stop() {
    if (this.status === 'done' || this.status === 'stopped' || this.status === 'error') return;
    this.status = 'stopped';
    try { this.abort.abort(); } catch { /* ignore */ }
  }

  /**
   * graph -> investigate -> synthesize. Resolves { status, description, projects,
   * graphify:{used}, warnings }; NEVER throws (emits scan-error instead). The whole
   * body is wrapped try/catch (scan-error) / finally (D4 cleanup), mirroring the
   * orchestrator.
   */
  async run() {
    const cleanup = []; // { projectDir, worktreeDir, branch } per created scan worktree
    let graphifyUsed = false;
    try {
      this.status = 'running';
      this._checkAbort();

      if (!this.projects.length) {
        throw new Error('a workspace scan needs at least 2 member projects');
      }

      // ── PHASE 1: graph (parallel, cap, CLI-only, D4 throwaway worktree) ───────
      this._setPhase('graph', `detecting tooling across ${this.projectsTotal} project(s)…`);
      graphifyUsed = await this._graphPhase(cleanup);
      this._checkAbort();

      // ── PHASE 2: investigate (scan-fanout) ───────────────────────────────────
      this._setPhase('investigate', `investigating relations across ${this.projectsTotal} project(s)…`);
      await mkdir(this.scratchDir, { recursive: true });
      const { description: raw } = await this._runScanningAgent();
      this._checkAbort();

      // ── PHASE 3: synthesize ──────────────────────────────────────────────────
      this._setPhase('synthesize', 'synthesizing the interconnection description…');
      const description = String(raw || '').trim();          // full text, no cap (was this._capDescription(raw))
      if (!description) throw new Error('the scan produced an empty description');

      this.status = 'done';
      const payload = {
        description,
        projects: this.projects.map((p) => ({ projectKey: p.projectKey, projectName: p.projectName })),
        graphify: { used: graphifyUsed },
      };
      this._emitTerminal('scan-done', payload);
      return { status: 'done', warnings: this.warnings, ...payload };
    } catch (err) {
      if (isAbort(err) || this.status === 'stopped') {
        this.status = 'stopped';
        this._emitTerminal('scan-error', { message: 'stopped' });
        return { status: 'stopped', warnings: this.warnings };
      }
      this.status = 'error';
      const message = (err && err.message) || String(err);
      this._emitTerminal('scan-error', { message });
      return { status: 'error', message, warnings: this.warnings };
    } finally {
      // D4: force-remove every scan worktree AND DELETE its branch (read-only scan;
      // the branch only isolated the graphify write). Best-effort; record warnings.
      for (const c of cleanup) {
        try {
          const r = await removeWorktree({
            projectDir: c.projectDir, worktreeDir: c.worktreeDir, branch: c.branch, force: true,
          });
          if (r && r.ok === false) {
            this.warnings.push(`scan worktree cleanup incomplete for ${c.branch}`);
          }
        } catch (e) {
          this.warnings.push(`scan worktree cleanup failed for ${c.branch}: ${(e && e.message) || e}`);
        }
      }
      // Remove the ephemeral scratch dir (the description is already in memory).
      await rm(this.scratchDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // ── phases ────────────────────────────────────────────────────────────────────

  /**
   * Build a fresh graphify graph per CLI member in a throwaway worktree (D4). On
   * success set p.scanDir/p.graphify (the scanning agent's task prompt reads these
   * to point each investigator at its fresh graphify-out/). On failure/timeout or
   * a non-cli member, DEGRADE to source-reading (emit a progress note, never abort).
   * Returns whether ANY member produced a graph (graphify.used).
   * @returns {Promise<boolean>}
   */
  async _graphPhase(cleanup) {
    // Mock mode skips graphify builds entirely (no worktrees, used=false, §3 note 3).
    if (this.mock) {
      this._progress(`mock mode — investigators will source-read ${this.projectsTotal} project(s)`);
      return false;
    }

    const tools = await detectToolsPerProject(this.projects.map((p) => p.projectDir));
    const wsSlug = slugify(this.name);
    const date = today();
    let used = false;

    // Per-project build with the same bounded-concurrency primitive the orchestrator
    // uses for its own per-project IO (fanout.mjs, capped at fanoutCap). Each member
    // is a DISTINCT repo, so concurrent worktree writes never contend; `used` is only
    // ever flipped to true, so the shared OR across callbacks is benign. An abort
    // rethrows out of mapWithCap (Promise.all semantics) and is caught in run().
    await mapWithCap(this.projects, this.cap, async (p) => {
      this._checkAbort();
      const info = tools.get(p.projectDir) || {};
      if (info.kind !== 'cli') {
        this._progress(`${p.projectName}: no graphify CLI — source-reading`);
        return;
      }
      this._progress(`building graph for ${p.projectName}…`);
      try {
        const source = await resolveDefaultBranch(p.projectDir);
        const branch = sanitizeBranchName(`worca-cc/ws-scan-${wsSlug}-${date}-${this.shortId}`);
        const pipelineId = `ws-scan-${this.shortId}`;
        const wt = await createWorktree({
          projectDir: p.projectDir, pipelineId, sourceBranch: source, featureBranch: branch,
          signal: this.abort.signal,
        });
        // Track for cleanup BEFORE the (possibly failing) graph build so a
        // mid-build abort still tears the worktree + branch down (D4).
        cleanup.push({ projectDir: p.projectDir, worktreeDir: wt.worktreeDir, branch: wt.branch });
        const res = await runGraphifyUpdate({
          dir: wt.worktreeDir, cwd: wt.worktreeDir, timeoutMs: this.graphBuildTimeoutMs,
        });
        if (res && res.ok) {
          p.scanDir = wt.worktreeDir;
          p.graphify = true;
          used = true;
          this._progress(`graph built for ${p.projectName}`);
        } else {
          this._progress(`${p.projectName}: graph build failed — source-reading`);
        }
      } catch (e) {
        if (isAbort(e)) throw e;
        // createWorktree threw (e.g. branch already checked out elsewhere) or a
        // git error — degrade this member, keep the others (§3.8).
        this._progress(`${p.projectName}: graph unavailable — source-reading`);
      }
    });
    return used;
  }

  /**
   * Phase 2: ONE scanning agent that fans out <=cap read-only investigators. We do
   * NOT reimplement the scanning-agent invocation — we drive runWorkspaceScan
   * (phases.mjs), which grants Task/Agent (effectiveAllowedTools(..., fanOut)) via
   * ctx.fanOut, names every member + its graph, carries the §5.8 template + MOCK
   * markers, and writes the description to outPath. ctx.onEvent drives the changing
   * scan-progress.message and bumps projectsDone.
   * @returns {Promise<{description:string}>}
   */
  async _runScanningAgent() {
    const agentBody = await this._loadScannerBody();
    const ctx = {
      // The scanner runs from the primary member's dir; investigators get each
      // member's absolute path from the task prompt runWorkspaceScan builds.
      projectDir: this.projects[0]?.projectDir,
      pipelineDir: this.scratchDir,
      projects: this.projects.map((p) => ({
        projectKey: p.projectKey,
        projectName: p.projectName,
        projectDir: p.projectDir,
        scanDir: p.scanDir,            // the graph worktree when a build succeeded
        graphify: !!p.graphify,
      })),
      workspaceName: this.name,
      // The scanner IS the source of the description, so it gets NO injected
      // workspace block (runWorkspaceScan passes undefined as the 4th arg).
      toolInstruction: '',
      agentPrompts: { workspaceScanner: agentBody },
      // ctxFanOut(ctx) -> ctx.fanOut (no node) -> grants Task/Agent so the agent
      // can dispatch investigators (scan-fanout).
      fanOut: true,
      claudeOpts: {
        permissionMode: this.claude.permissionMode || 'acceptEdits',
        model: this.claude.model,
        bin: this.claude.bin,
        mock: this.claude.mock,
      },
      signal: this.abort.signal,
      onEvent: (e) => this._onAgentEvent(e),
    };
    const { description } = await runWorkspaceScan(ctx, { outPath: this.outPath, name: this.name });
    // Authoritative read-back (runWorkspaceScan already reads the file; re-read is
    // cheap and keeps the engine the single owner of the delivered string).
    let text = description;
    try { text = await readFile(this.outPath, 'utf8'); } catch { /* keep returned text */ }
    return { description: text };
  }

  // ── agent-event -> changing live status ─────────────────────────────────────

  /**
   * Turn the scanning agent's events into the CHANGING scan-progress.message and
   * bump projectsDone. The reliable cross-mode signal is the agent's own
   * `INVESTIGATING <key> relations to <other>` / `SYNTHESIZING …` log lines (the
   * mock emits them; the real agent is prompted to). We also opportunistically
   * surface a Task tool_use description (the orchestrator's sub-agent-label idea)
   * for richer real-mode text.
   */
  _onAgentEvent(e) {
    if (!e || typeof e !== 'object') return;
    const text = typeof e.text === 'string' ? e.text : '';
    const inv = text.match(/INVESTIGATING\s+(\S+)\s+relations to\s+(\S+)/i);
    if (inv) {
      const fromName = this._nameForKey(inv[1]) || inv[1];
      const toName = this._nameForKey(inv[2]) || inv[2];
      this.projectsDone = Math.min(this.projectsTotal, this.projectsDone + 1);
      this._progress(`investigating ${fromName} relations to ${toName}…`);
      return;
    }
    if (/SYNTHESIZING/i.test(text)) {
      this._progress('merging investigator reports…');
      return;
    }
    // Opportunistic: a dispatched Task's description (real mode), via the same
    // stream-json shape registerSubAgents reads.
    const desc = taskDescription(e.raw);
    if (desc) this._progress(desc);
  }

  _nameForKey(key) {
    const m = this.projects.find((p) => p.projectKey === key);
    return m ? m.projectName : null;
  }

  // ── emit helpers ────────────────────────────────────────────────────────────

  _setPhase(phase, message) {
    this.phase = phase;
    this._progress(message);
  }

  /** Emit a fresh scan-progress with the current (changing) message. */
  _progress(message) {
    if (this._terminal) return;
    if (message) this.message = message;
    this.emit('scan-progress', {
      scanId: this.scanId,
      phase: this.phase,
      projectsTotal: this.projectsTotal,
      projectsDone: this.projectsDone,
      message: this.message,
    });
  }

  /** Emit exactly ONE terminal event (scan-done | scan-error). */
  _emitTerminal(type, payload) {
    if (this._terminal) return;
    this._terminal = true;
    this.emit(type, { scanId: this.scanId, ...payload });
  }

  // ── small utilities ───────────────────────────────────────────────────────────

  async _loadScannerBody() {
    if (!this.agentsDir) return '';
    try {
      return await readFile(join(this.agentsDir, SCANNER_AGENT_FILE), 'utf8');
    } catch {
      return ''; // body missing -> empty; runWorkspaceScan falls back gracefully
    }
  }

  _checkAbort() {
    if (this.abort.signal.aborted || this.status === 'stopped') {
      const err = new Error('stopped');
      err.name = 'AbortError';
      throw err;
    }
  }
}

function isAbort(err) {
  return err && (err.name === 'AbortError' || /aborted|stopped/i.test(err.message || ''));
}

/** A dispatched Task/Agent tool_use description from a stream-json event, or ''. */
function taskDescription(raw) {
  const content = raw?.message?.content;
  if (!Array.isArray(content)) return '';
  for (const c of content) {
    if (c?.type === 'tool_use' && (c.name === 'Task' || c.name === 'Agent')) {
      const d = c.input?.description || c.input?.prompt;
      if (d) return String(d).slice(0, 80);
    }
  }
  return '';
}

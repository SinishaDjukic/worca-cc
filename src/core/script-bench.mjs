// src/core/script-bench.mjs
// The script test bench (workbench spec §4). ONE rule holds it together: the
// bench never has its own idea of how a script runs. It builds a SYNTHETIC
// execution context and calls the very `runScriptExecution` a pipeline run
// calls, so "passes in the bench" and "works in a run" cannot drift.
//
// Everything a run would put in a pipeline dir lands under
// <worcaHome()>/bench/<benchId>/ instead (W11): `pipeline/` for outputs, the
// verdict and the envelope, `in/` for the hand-filled inputs, `cwd/` for the
// scratch folder. Results OUTLIVE the run so the output tabs can read them;
// one live folder per script key, and anything older than 24 h is swept at
// server start. No DB row, no History entry, no ledger, no cost (W15).
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { mkdir, writeFile, readdir, rm, stat, open } from 'node:fs/promises';
import { worcaHome, listProjects } from './projects.mjs';
import { loadScriptRegistry } from './script-registry.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import {
  readScript, sourceFileFor, userScriptsDir, stripNullKeys, programText, SCRIPT_KEY_RE, assertKeyAllowed,
} from './script-store.mjs';
import { runScriptExecution } from './graph/script-runner.mjs';
import { allocateOutputs, allocateVerdict } from './graph/executor.mjs';
import {
  effectiveScriptParams, paramValueError, validateScriptMetaV2, normalizeScriptMeta,
  resolvePlatformValue, scriptNodeCtx, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS,
} from '../shared/graph/script-meta.mjs';
import { casePortSet, evaluateExpect, MAX_CASE_INPUT_BYTES } from '../shared/graph/script-cases.mjs';
import { firedOutputs } from '../shared/graph/ports.mjs';
import { hasBlocking } from '../shared/graph/verdict.mjs';

/** W14: the bench's OWN cap — bench runs are not run executions and must never
 *  starve, or be starved by, the scheduler's pools. */
export const BENCH_MAX_PARALLEL = 2;
export const BENCH_INLINE_BYTES = 262144;
export const BENCH_SWEEP_MS = 24 * 60 * 60 * 1000;
const TAIL_LINES = 20;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const benchError = (message, code) => Object.assign(new Error(message), { code });

// Live bench bookkeeping for THIS process (W14 + W11). A bench is not durable:
// a restart forgets them, and the 24 h sweep reclaims whatever they left.
const activeIds = new Set();
const activeByKey = new Map();
const dirByKey = new Map();

/** `<worcaHome()>/bench` — colon-free names (the Windows filename rule). */
export function benchRoot(home = worcaHome()) {
  return join(home, 'bench');
}

/**
 * Remove bench folders older than `maxAgeMs`. Called once at server start.
 * Never throws: a missing root is an empty sweep, and a folder a just-killed
 * child still holds on Windows is simply left for the next boot.
 * @returns {Promise<string[]>} the folder names removed
 */
export async function sweepBenchDirs(root, { maxAgeMs = BENCH_SWEEP_MS, now = Date.now() } = {}) {
  const removed = [];
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return removed; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = join(root, e.name);
    let mtimeMs;
    try { mtimeMs = (await stat(dir)).mtimeMs; } catch { continue; }
    if (now - mtimeMs < maxAgeMs) continue;
    try {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
      removed.push(e.name);
    } catch { /* still held (Windows): the next boot gets it */ }
  }
  return removed;
}

/**
 * Write the hand-filled inputs and return the bindings a run would have built.
 * A port that is not listed — and a void port whose box is unchecked — is
 * UNBOUND and absent from the envelope, exactly as in a run (W2).
 * @param {string} inDir @param {{inputs: Array}} ports @param {object} inputs
 * @returns {Promise<Record<string, {seq:number, type:string, path?:string}>>}
 */
export async function writeBenchInputs(inDir, ports, inputs) {
  const given = isObject(inputs) ? inputs : {};
  const declared = new Map((ports?.inputs || [])
    .filter((p) => p && !p.synthetic && p.id !== 'await').map((p) => [p.id, p]));
  for (const id of Object.keys(given)) {
    if (!declared.has(id)) throw benchError(`bench input "${id}" is not a declared input port`, 'BAD_REQUEST');
  }
  await mkdir(inDir, { recursive: true });
  const bindings = {};
  let seq = 0;
  for (const port of declared.values()) {
    const spec = given[port.id];
    if (!isObject(spec)) continue;
    if (port.type === 'void') {
      if (spec.fired !== true) continue;
      seq += 1;
      bindings[port.id] = { seq, type: 'void' };
      continue;
    }
    if (typeof spec.text !== 'string') throw benchError(`bench input "${port.id}" must be { text }`, 'BAD_REQUEST');
    if (Buffer.byteLength(spec.text, 'utf8') > MAX_CASE_INPUT_BYTES) {
      throw benchError(`bench input "${port.id}" is over ${MAX_CASE_INPUT_BYTES} bytes`, 'BAD_REQUEST');
    }
    if (port.type === 'json') {
      try { JSON.parse(spec.text); } catch { throw benchError(`bench input "${port.id}" is not valid JSON`, 'BAD_REQUEST'); }
    }
    const path = join(inDir, `${port.id}.${port.type === 'json' ? 'json' : 'md'}`);
    await writeFile(path, spec.text, 'utf8');
    seq += 1;
    bindings[port.id] = { seq, type: port.type, path };
  }
  return bindings;
}

/**
 * The synthetic execution context (spec §4.1). Pure apart from the dirs it is
 * given: ONE cycle, ordinal 1, the run's own allocator against the bench's
 * `pipeline/`, and `bench: true` so the envelope and the shell env carry W12.
 */
export function buildBenchCtx({ id, meta, resolved, ports, bindings, dirs, cwd, checkpointRef = null, signal = null, onEvent = () => {} }) {
  const node = { id: 'bench', kind: 'script', key: meta.key };
  const runCtx = { pipelineDir: dirs.pipeline, projectDir: cwd, baseName: 'bench' };
  // W1: outputs, verdict and envelope live in the BENCH's folder, never in a
  // project's plans/reviews store — so every port is allocated as store:'run'.
  const benchPorts = {
    inputs: ports.inputs || [],
    outputs: (ports.outputs || []).filter(Boolean).map((p) => ({ ...p, store: 'run' })),
    verdict: ports.verdict || null,
  };
  const executionId = 'x:bench:1';
  // §4.1 step 2: the run-time facts come from the ONE builder resolveGraph and the
  // resume path use (scriptNodeCtx), fed a synthetic node and the entry's two
  // registry stamps — so a fresh run, a resumed run and a bench cannot drift.
  // Only `mock` is overridden below (W13).
  const sn = scriptNodeCtx(
    { id: node.id, key: meta.key, config: { params: resolved.params, timeoutMs: resolved.timeoutMs } },
    { ...meta, scriptPath: resolved.file, commandResolved: resolved.command },
  );
  return {
    node,
    executionId,
    ordinal: 1,
    cycle: 1,
    pipelineDir: dirs.pipeline,
    pipelineId: `bench-${String(id).slice(-8)}`,
    projectDir: cwd,
    runCtx,
    runRoot: null,
    workspace: undefined,
    repos: null,
    checkpointRef,
    ports: benchPorts,
    outputs: allocateOutputs({ node, ports: benchPorts, executionId, ordinal: 1, runCtx }),
    verdict: allocateVerdict({ node, ports: benchPorts, ordinal: 1, runCtx }),
    bindings,
    trigger: { wireIds: [], freshPorts: Object.keys(bindings) },   // every bound input is fresh
    script: {
      meta,
      runtime: sn.runtime,
      file: sn.file,
      command: sn.command,
      params: sn.params,
      timeoutMs: sn.timeoutMs,
      mock: null,                                                  // W13
    },
    claudeOpts: { mock: false },                                   // W13: always run the program
    bench: true,                                                   // W12
    signal,
    onEvent,
  };
}

/** The HEAD of a project checkout, or null when it is not a git repo. */
function headRef(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim() || null;
  } catch { return null; }
}

/** V22's sentences with the bench's node id, so a bad param fails exactly as a run would. */
function paramErrors(meta, values) {
  const declared = Array.isArray(meta.params) ? meta.params : [];
  const byId = new Map(declared.map((d) => [d.id, d]));
  const errors = [];
  for (const [id, value] of Object.entries(values)) {
    const d = byId.get(id);
    if (!d) {
      errors.push(`script node 'bench' sets unknown param '${id}' — script "${meta.key}" declares `
        + `${declared.length ? declared.map((x) => x.id).join(', ') : 'no params'}`);
      continue;
    }
    const bad = paramValueError(d, value);
    if (bad) errors.push(`script node 'bench' param '${id}': ${bad}`);
  }
  for (const d of declared) {
    if (d.required && values[d.id] === undefined) errors.push(`script node 'bench' is missing required param '${d.id}'`);
  }
  return errors;
}

/** One case's folder set. A single run uses the bench folder itself (spec §4.1);
 *  Run all gives each case `case-<id>/` so its outputs survive the next case. */
function dirsFor(benchDir, caseId) {
  const base = caseId ? join(benchDir, `case-${caseId}`) : benchDir;
  return { base, pipeline: join(base, 'pipeline'), in: join(base, 'in'), cwd: join(base, 'cwd') };
}

/** Read every declared output back, capped inline (the rest via the output route). */
async function readOutputs(ports, allocated) {
  const out = {};
  for (const port of ports.outputs || []) {
    if (!port) continue;
    if (port.type === 'void') { out[port.id] = { type: 'void' }; continue; }
    const path = allocated[port.id]?.path || null;
    let text = '';
    let bytes = 0;
    let truncated = false;
    if (path) {
      // Only the inline head is read. readFile() would pull the WHOLE file into
      // memory to keep 256 KiB of it — a script that writes a 600 MB log spiked
      // the host by half a gigabyte, and past 2 GiB readFile throws
      // ERR_FS_FILE_TOO_LARGE, which reported the output as empty (bytes: 0).
      try {
        const fh = await open(path, 'r');
        try {
          bytes = (await fh.stat()).size;
          truncated = bytes > BENCH_INLINE_BYTES;
          const want = Math.min(bytes, BENCH_INLINE_BYTES);
          const buf = Buffer.alloc(want);
          let got = 0;
          while (got < want) {
            const { bytesRead } = await fh.read(buf, got, want - got, got);
            if (!bytesRead) break;
            got += bytesRead;
          }
          // Stream mode holds back a code point the byte cap cut in half instead of
          // decoding it as U+FFFD — the head must never show a character the file
          // does not contain. ONLY when the bytes were cut, though (C35): on a
          // COMPLETE output that same hold silently drops the last character of a
          // file that is not valid UTF-8, and `ignoreBOM` keeps the output's own
          // bytes, which the streamed route serves too.
          text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf.subarray(0, got), { stream: truncated });
        } finally { await fh.close(); }
      } catch { /* the port did not fire, or nothing wrote it */ }
    }
    out[port.id] = { type: port.type, path, bytes, text, truncated };
  }
  return out;
}

class Bench extends EventEmitter {
  constructor(request, deps = {}) {
    super();
    this.id = `bench_${randomUUID()}`;
    this.request = isObject(request) ? request : {};
    this.deps = deps;
    this.key = typeof this.request.key === 'string' ? this.request.key.trim() : '';
    this.runner = typeof deps.runner === 'function' ? deps.runner : runScriptExecution;
    this.platform = deps.platform || process.platform;
    this.status = 'created';
    this.abort = new AbortController();
    this.benchDir = null;
  }

  getState() { return { benchId: this.id, key: this.key, status: this.status }; }

  /** Abort the child (the runner's tree kill) and skip the remaining cases. */
  stop() {
    if (this.status === 'done' || this.status === 'error' || this.status === 'stopped') return;
    this.status = 'stopped';
    try { this.abort.abort(); } catch { /* already aborted */ }
  }

  _emit(type, payload) { this.emit(type, { benchId: this.id, ...payload }); }

  /** NEVER throws: exactly one terminal scriptbench-done or scriptbench-error. */
  async run() {
    if (this.status === 'stopped') {
      // stop() landed before run() (a CLI Ctrl-C, a chat-tool timeout holding the
      // bench through deps.onBench): still exactly one terminal event, or
      // runBenchOnce would never settle.
      this._emit('scriptbench-error', { message: 'bench stopped before it started', code: 'STOPPED' });
      return;
    }
    if (this.status !== 'created') return;                 // a second run() is a no-op
    let held = false;
    try {
      if (!SCRIPT_KEY_RE.test(this.key)) throw benchError(`script not found: ${this.key}`, 'NOT_FOUND');
      // Per-key BEFORE global: re-running the script you are looking at is the
      // common refusal, and "already running" names the fix; the global cap is
      // the one the OTHER tab hits.
      if (activeByKey.has(this.key)) throw benchError(`script "${this.key}" is already running in the bench`, 'BUSY');
      if (activeIds.size >= BENCH_MAX_PARALLEL) {
        throw benchError(`at most ${BENCH_MAX_PARALLEL} bench runs at once — wait for one to finish`, 'BUSY');
      }
      activeIds.add(this.id);
      activeByKey.set(this.key, this.id);
      held = true;
      this.status = 'running';
      const plan = await this._plan();          // resolve first: a refusal leaves no folder behind
      await this._makeDir();
      const result = this.request.all === true ? await this._runAll(plan) : await this._runOne(plan, plan.kase, null);
      if (this.status !== 'stopped') this.status = 'done';
      this._emit('scriptbench-done', { result });
    } catch (e) {
      this.status = 'error';
      this._emit('scriptbench-error', { message: e?.message || String(e), code: e?.code || null });
    } finally {
      if (held) { activeIds.delete(this.id); activeByKey.delete(this.key); }
    }
  }

  /** W11: one live folder per script key — the previous one is reclaimed here. */
  async _makeDir() {
    const dir = join(benchRoot(this.deps.home || worcaHome()), this.id);
    const prev = dirByKey.get(this.key);
    if (prev && prev !== dir) await rm(prev, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    dirByKey.set(this.key, dir);
    await mkdir(dir, { recursive: true });
    this.benchDir = dir;
  }

  /** Resolve the script (registry entry or draft) and the case, once per bench. */
  async _plan() {
    const registry = isObject(this.deps.registry)
      ? this.deps.registry
      : loadScriptRegistry({ agentKeys: this.deps.agentKeys ?? Object.keys(loadAgentRegistry()) });
    // A registry is a plain object: `constructor`/`toString`/`valueOf`/`hasOwnProperty`
    // pass SCRIPT_KEY_RE and would answer with a Function the bench then benches.
    const entry = Object.hasOwn(registry, this.key) ? registry[this.key] : null;
    const draftReq = isObject(this.request.draft) ? this.request.draft : null;
    let meta = entry;
    if (draftReq) {
      // W10: a draft is the editor's unsaved meta + source. Only the user layer
      // is writable, so a draft of a built-in or a plugin script is refused.
      const origin = String(entry?.origin || 'user');
      if (entry && origin !== 'user') {
        const why = origin.startsWith('plugin:') ? `it belongs to plugin "${origin.slice('plugin:'.length)}"` : 'it is a built-in script';
        throw benchError(`cannot bench a draft of "${this.key}" — ${why}; duplicate it first`, 'BAD_REQUEST');
      }
      // A key the store would refuse on Save must not bench green either: the
      // reserved route segments in any case AND the Windows device stems (C29),
      // read from the store's own gate so the two lists cannot drift apart.
      assertKeyAllowed(this.key);
      // C23: one file holds `Lint` and `lint` on macOS and Windows, so the store
      // refuses a key that differs from an existing one only in case (assertKeyFree).
      const twin = entry ? null : Object.keys(registry).find((k) => k.toLowerCase() === this.key.toLowerCase());
      if (twin) {
        throw benchError(`a script "${twin}" already exists — script keys differ only in case, and one file holds both `
          + 'on macOS and Windows', 'BAD_REQUEST');
      }
      if (!entry && (this.deps.agentKeys ?? Object.keys(loadAgentRegistry())).includes(this.key)) {
        throw benchError(`"${this.key}" is an agent key — scripts and agents share one namespace, so pick another key`, 'BAD_REQUEST');
      }
      // applyFileRules: a win32 program needs its POSIX twin. Without this the draft
      // wrote an EMPTY `.sh` on POSIX, ran it, ignored the sidecar's `command` and
      // reported `clean` — a green bench for a script the Save refuses.
      if (typeof draftReq.sourceWin32 === 'string' && draftReq.sourceWin32.trim()
        && !(typeof draftReq.source === 'string' && draftReq.source.trim())) {
        throw benchError('sourceWin32 needs a shell file — add the default source too', 'BAD_REQUEST');
      }
      // The draft comes off the Overview form, which sends `null` for a cleared key.
      const raw = stripNullKeys({ ...(isObject(draftReq.meta) ? draftReq.meta : {}), key: this.key });
      for (const f of ['origin', 'scriptPath', 'scriptsDir', 'commandResolved', 'frontmatter']) delete raw[f];
      // The store owns `file` on every write path; a draft is no exception.
      const hasSource = typeof draftReq.source === 'string' && draftReq.source.trim() !== '';
      raw.file = hasSource ? sourceFileFor(this.key, raw.runtime) : null;
      const issues = validateScriptMetaV2(raw).errors;
      if (issues.length) throw benchError(issues.join('; '), 'BAD_REQUEST');
      meta = normalizeScriptMeta(raw, { warn: () => {} }).meta;
    } else if (!entry) {
      throw benchError(`script not found: ${this.key}`, 'NOT_FOUND');
    }
    let kase = null;
    const caseId = typeof this.request.caseId === 'string' ? this.request.caseId : '';
    if (caseId || this.request.all === true) {
      const stored = await readScript(this.key);
      const cases = stored ? [...stored.cases, ...stored.userCases] : [];
      if (caseId) {
        kase = cases.find((c) => c.id === caseId) || null;
        if (!kase) throw benchError(`case "${caseId}" not found for script "${this.key}"`, 'NOT_FOUND');
      }
      this.cases = cases;
    }
    return { meta, entry, draft: !!draftReq, draftReq, kase };
  }

  /** Everything one execution needs: params, ports, inputs, cwd, the draft file. */
  async _prepare(plan, kase, caseId) {
    const { meta } = plan;
    const dirs = dirsFor(this.benchDir, caseId);
    await mkdir(dirs.pipeline, { recursive: true });
    // §4.2: a case supplies everything; the loose request fields are ignored.
    const src = kase || this.request;
    const params = effectiveScriptParams(meta, { params: isObject(src.params) ? src.params : {} });
    const errors = paramErrors(meta, params);
    if (errors.length) throw benchError(errors.join('; '), 'BAD_REQUEST');
    const set = casePortSet(meta, { ports: src.ports ?? null });
    if (set.errors) throw benchError(set.errors.join('; '), 'BAD_REQUEST');
    const ports = { inputs: set.inputs, outputs: set.outputs, verdict: set.verdict };
    const bindings = await writeBenchInputs(dirs.in, ports, isObject(src.inputs) ? src.inputs : {});
    const { cwd, checkpointRef } = await this._cwd(isObject(src.cwd) ? src.cwd : { kind: 'scratch' }, dirs);
    const timeoutMs = Number.isInteger(src.timeoutMs) && src.timeoutMs >= MIN_TIMEOUT_MS
      ? Math.min(src.timeoutMs, MAX_TIMEOUT_MS)
      : (Number.isInteger(meta.timeoutMs) ? meta.timeoutMs : DEFAULT_TIMEOUT_MS);
    // The LAST write. _runOne's finally removes the file once a spec exists; a
    // throw between here and the return would leak it, hence the catch below (W10).
    const draftPath = await this._writeDraft(plan, meta);
    try {
      return this._spec(plan, kase, caseId, { meta, ports, bindings, dirs, cwd, checkpointRef, params, timeoutMs, draftPath });
    } catch (e) {
      if (draftPath) await rm(draftPath, { force: true, maxRetries: 3 }).catch(() => {});
      throw e;
    }
  }

  /** The synthetic ctx for one prepared execution (split out so _prepare can guard the draft file). */
  _spec(plan, kase, caseId, { meta, ports, bindings, dirs, cwd, checkpointRef, params, timeoutMs, draftPath }) {
    const file = draftPath ?? (plan.draft ? null : plan.entry.scriptPath ?? null);
    // The registry stamps the host-platform command; a draft's own map is
    // resolved here with the SAME reader (a per-platform command is the
    // sidecar's business, so the bench must not ship the raw map to the runner).
    const command = plan.draft
      ? resolvePlatformValue(meta.command, this.platform)
      : (plan.entry.commandResolved ?? null);
    const ctx = buildBenchCtx({
      id: this.id, meta, resolved: { file, command, params, timeoutMs }, ports, bindings, dirs, cwd, checkpointRef,
      signal: this.abort.signal,
      onEvent: (e) => { if (e && e.type === 'text') this._line(caseId, e.text); },
    });
    return { meta, ports, ctx, dirs, draftPath, draft: plan.draft, expect: kase ? kase.expect : null };
  }

  /** `.bench-<id8>-<basename>` beside the real file, so relative imports still resolve. */
  async _writeDraft(plan, meta) {
    if (!plan.draft) return null;
    const source = typeof plan.draftReq.source === 'string' ? plan.draftReq.source : '';
    const win = typeof plan.draftReq.sourceWin32 === 'string' ? plan.draftReq.sourceWin32 : '';
    if (!source.trim() && !win.trim()) return null;              // an inline shell command has no file
    const useWin = this.platform === 'win32' && meta.runtime === 'shell' && win.trim() !== '';
    const basename = sourceFileFor(this.key, meta.runtime, { win32: useWin });
    if (!basename) return null;
    const dir = userScriptsDir();
    if (!dir) throw benchError('cannot resolve the user scripts directory (WORCA_HOME unset?)', 'BAD_REQUEST');
    await mkdir(dir, { recursive: true });
    const path = join(dir, `.bench-${this.id.slice(-8)}-${basename}`);
    await writeFile(path, programText(meta.runtime, useWin ? win : source, { win32: useWin }), 'utf8');
    return path;
  }

  /** W1: a scratch folder, or a REGISTERED project's real checkout. */
  async _cwd(cwd, dirs) {
    if (cwd.kind === 'project') {
      const list = await (typeof this.deps.projects === 'function' ? this.deps.projects : listProjects)();
      const found = (list || []).find((p) => p && p.key === cwd.projectKey);
      if (typeof cwd.projectKey !== 'string' || !cwd.projectKey) throw benchError('cwd: a project folder needs a projectKey', 'BAD_REQUEST');
      if (!found) throw benchError(`project "${cwd.projectKey}" is not registered`, 'BAD_REQUEST');
      if (!found.exists) throw benchError(`project path does not exist or is not a directory: ${found.path}`, 'BAD_REQUEST');
      return { cwd: found.path, checkpointRef: headRef(found.path) };
    }
    await mkdir(dirs.cwd, { recursive: true });
    return { cwd: dirs.cwd, checkpointRef: null };
  }

  _line(caseId, text) {
    this.tail = this.tail || [];
    this.tail.push(text);
    if (this.tail.length > TAIL_LINES) this.tail.shift();
    this._emit('scriptbench-line', { caseId: caseId || null, stream: 'out', text });
  }

  async _runOne(plan, kase, caseId) {
    this.tail = [];
    const spec = await this._prepare(plan, kase, caseId);
    const started = Date.now();
    try {
      const res = await this.runner(spec.ctx);
      const verdict = res.verdict || null;
      return await this._result(spec, {
        status: hasBlocking(verdict) ? 'blocking' : 'clean',
        exitCode: res.exitCode ?? null,
        runtime: res.runtime || spec.meta.runtime,
        durationMs: res.durationMs ?? (Date.now() - started),
        summary: res.summary || '',
        warnings: res.warnings || [],
        fired: firedOutputs(spec.ports.outputs || [], verdict).map((p) => p.id),
        verdict,
        envelopePath: res.envelopePath || null,
        error: null,
      });
    } catch (e) {
      // An EXECUTION failure is a RESULT — the bench exists to show it. Only the
      // runner's own two non-failure throws are re-read: an abort is a stop, and
      // the timeout sentence (P1a §6.3) is the timeout.
      const message = e?.message || String(e);
      const stopped = this.abort.signal.aborted || e?.name === 'AbortError';
      const status = stopped ? 'stopped' : /^script ".*" timed out after /.test(message) ? 'timeout' : 'error';
      return await this._result(spec, {
        status,
        exitCode: null,
        runtime: spec.meta.runtime,
        durationMs: Date.now() - started,
        summary: '',
        warnings: [],
        fired: [],
        verdict: null,
        envelopePath: null,
        error: { message, tail: [...(this.tail || [])] },
      });
    } finally {
      if (spec.draftPath) await rm(spec.draftPath, { force: true, maxRetries: 3 }).catch(() => {});
    }
  }

  async _result(spec, partial) {
    const result = {
      ...partial,
      outputs: await readOutputs(spec.ports, spec.ctx.outputs),
      expect: null,
      draft: spec.draft,
      benchDir: spec.dirs.base,
    };
    result.expect = evaluateExpect(spec.expect, result);
    return result;
  }

  /** The result of a case whose preparation threw (Run all only): an `error`
   *  result with the refusal as its message, checked against the expectation
   *  like any other so an `expect.verdict: 'error'` case can still pass. */
  _unpreparedResult(plan, kase, e) {
    const result = {
      status: 'error', exitCode: null, runtime: plan.meta.runtime, durationMs: 0, summary: '', warnings: [],
      fired: [], verdict: null, envelopePath: null,
      error: { message: e?.message || String(e), tail: [] },
      outputs: {}, expect: null, draft: plan.draft, benchDir: dirsFor(this.benchDir, kase.id).base,
    };
    result.expect = evaluateExpect(kase.expect, result);
    return result;
  }

  /** §4.3: every saved case, sequentially, under one benchId; stop skips the rest. */
  async _runAll(plan) {
    const cases = this.cases || [];
    if (!cases.length) throw benchError(`script "${this.key}" has no saved cases`, 'BAD_REQUEST');
    const out = [];
    let passed = 0;
    let failed = 0;
    let unchecked = 0;
    for (const kase of cases) {
      if (this.abort.signal.aborted) break;
      let result;
      try {
        result = await this._runOne(plan, kase, kase.id);
      } catch (e) {
        // A case that cannot even be PREPARED (a param the sidecar no longer
        // declares, a project that was unregistered) is that case's failure,
        // never the batch's: the other cases still run.
        result = this._unpreparedResult(plan, kase, e);
      }
      out.push({ caseId: kase.id, result });
      if (!result.expect) unchecked += 1;
      else if (result.expect.pass) passed += 1;
      else failed += 1;
    }
    return { cases: out, passed, failed, unchecked };
  }
}

/**
 * One bench run. The server wires it onto the WS bus the way wireAgentGen wires
 * an AgentGen; `run()` never throws and emits exactly one terminal event.
 * @param {object} request { key, caseId?, all?, draft?, params?, ports?, inputs?, cwd?, timeoutMs? }
 * @param {object} [deps] { home?, runner?, registry?, agentKeys?, projects?, platform?, onLine?, onBench? }
 */
export function createBench(request, deps = {}) { return new Bench(request, deps); }

/** The same engine without a socket: the CLI (P3) and the chat tool (P4) use this.
 *  `deps.onLine({ benchId, caseId, stream, text })` receives every streamed line
 *  (the CLI prints them to stderr, the chat tool keeps the tail); `deps.onBench(bench)`
 *  hands the caller the live bench so it can `stop()` it (Ctrl-C, a tool timeout). */
export function runBenchOnce(request, deps = {}) {
  const bench = createBench(request, deps);
  if (typeof deps.onLine === 'function') bench.on('scriptbench-line', deps.onLine);
  if (typeof deps.onBench === 'function') deps.onBench(bench);
  return new Promise((resolve, reject) => {
    bench.once('scriptbench-done', (e) => resolve(e.result));
    bench.once('scriptbench-error', (e) => reject(Object.assign(new Error(e.message), { code: e.code || null })));
    bench.run();
  });
}

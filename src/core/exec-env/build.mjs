// src/core/exec-env/build.mjs
// Builds of a project's sandbox environment (plans/e2b-execution-design.md §18). They run ONLY in the worca server
// process: it alone holds the backend keys (agents, scripts and actions never get them — host-credentials.mjs strips
// each backend's secretEnv). ui/server.mjs marks itself at load; `worca exec-env build` asks it over HTTP.
// A build runs in the background; only a success replaces the project's build record.
import { randomBytes } from 'node:crypto';
import { getExecBackend } from './registry.mjs';
import { readProjectExecEnv } from '../config.mjs';
import { recordProjectBuild } from './project-env.mjs';

let serverProcess = false;
export function markServerProcess(on = true) { serverProcess = !!on; }
export const isServerProcess = () => serverProcess;

export class ExecEnvBuildError extends Error {
  constructor(message, code, status) { super(message); this.name = 'ExecEnvBuildError'; this.code = code; this.status = status; }
}

const JOBS = new Map();   // jobId -> job
const MAX_LOG = 2000;
const TAIL = 20;
const KEEP_MS = 3600_000;

export function publicBuildJob(j) {
  if (!j) return null;
  const { id, projectKey, backend, name, specHash, state, startedAt, endedAt, error, record } = j;
  return { id, projectKey, backend, name, specHash, state, startedAt, endedAt, error, record, tail: j.log.slice(-TAIL) };
}
export const buildJob = (id) => JOBS.get(id) || null;
/** Log lines from absolute index `since` (the log keeps its last MAX_LOG lines). */
export function buildJobLog(id, since = 0) {
  const j = JOBS.get(id); if (!j) return null;
  const from = Math.max(0, Number(since) - j.logBase);
  return { lines: j.log.slice(from), next: j.logBase + j.log.length, job: publicBuildJob(j) };
}
/** The newest job of a project on a backend (running first), for the project page. */
export function latestBuildJob(projectKey, backendName) {
  let best = null;
  for (const j of JOBS.values()) {
    if (j.projectKey !== projectKey || j.backend !== backendName) continue;
    if (!best || j.state === 'running' || (best.state !== 'running' && j.startedAt > best.startedAt)) best = j;
  }
  return best;
}

/** Start a build of `projectKey`'s stored spec on `backendName`; returns the job at once. `onState(job)` fires at
 *  start and end. Throws ExecEnvBuildError (403 outside the server process, 400 unsupported, 409 not configured /
 *  no spec / running). */
export function startEnvironmentBuild({ projectKey, backend: backendName, mock = false, env = process.env, onState = () => {} }) {
  if (!serverProcess) {
    throw new ExecEnvBuildError('Environment builds run only in the worca server process, which holds the backend keys. Use the project page, or `worca exec-env build` while the server runs.', 'EXEC_ENV_BUILD_REFUSED', 403);
  }
  const backend = getExecBackend(backendName);
  if (!backend.capabilities.buildEnvironment) throw new ExecEnvBuildError(`${backend.label} cannot build project environments`, 'EXEC_ENV_BUILD_UNSUPPORTED', 400);
  if (!mock && !backend.configured(env)) throw new ExecEnvBuildError(`${backend.title} is not configured on this server (its keys or SDK are missing; see docs/e2b.md)`, 'EXEC_ENV_NOT_CONFIGURED', 409);
  const { spec } = readProjectExecEnv(projectKey);
  if (!spec) throw new ExecEnvBuildError(`This project has no environment spec yet. Set one first: worca exec-env spec --project ${projectKey} --set <file.json>`, 'EXEC_ENV_NO_SPEC', 409);
  const running = latestBuildJob(projectKey, backend.name);
  if (running?.state === 'running') throw new ExecEnvBuildError(`A ${backend.label} build of this project is already running (${running.id})`, 'EXEC_ENV_BUILD_RUNNING', 409);

  const job = { id: `envb_${randomBytes(4).toString('hex')}`, projectKey, backend: backend.name, name: backend.environmentName(projectKey),
    specHash: spec.hash, state: 'running', startedAt: new Date().toISOString(), endedAt: null, error: null, record: null, log: [], logBase: 0 };
  const line = (text) => {
    for (const l of String(text).split('\n')) { if (l.trim()) job.log.push(l); }
    if (job.log.length > MAX_LOG) { const drop = job.log.length - MAX_LOG; job.log.splice(0, drop); job.logBase += drop; }
  };
  JOBS.set(job.id, job);
  job.done = (async () => {
    try {
      line(`building ${backend.environmentNoun} ${job.name} from spec ${spec.hash}`);
      const client = await backend.open({ mock, env });
      const result = await client.buildEnvironment(spec, { name: job.name, onLog: line });
      job.record = recordProjectBuild(projectKey, backend.name, { ...result, server: backend.serverIdentity?.(env) ?? null });
      job.state = 'done';
      line(`built ${result.name}${result.buildId ? ` (build ${result.buildId})` : ''}`);
    } catch (err) {
      job.state = 'error'; job.error = err?.message || String(err);
      line(`build failed: ${job.error}; the previous ${backend.environmentNoun} stays in use`);
    } finally {
      job.endedAt = new Date().toISOString();
      try { onState(job); } catch { /* a listener never breaks the job */ }
      setTimeout(() => JOBS.delete(job.id), KEEP_MS).unref?.();
    }
  })();
  onState(job);
  return job;
}

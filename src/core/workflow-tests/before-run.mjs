// src/core/workflow-tests/before-run.mjs — workflow tests 3b (D75): "The command passes" run once on the start commit, before
// the workflow changed anything (SWE-bench's FAIL_TO_PASS / PASS_TO_PASS). It runs in its own short-lived clone of Worca's copy
// of the project (never a checkout registered in the copy: the copy reset, P40, only knows tries), the example's setup first,
// under the try's outward guard (D56). The result is kept for a week per project, start commit, setup and command, and dropped
// when the copy is made again (its stamp). Nothing here touches the person's repository.
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeRoot, cloneForBefore, copyStamp, removeTree } from './project-copy.mjs';
import { runShellStep, tryShellEnv, SETUP_TIMEOUT_MS } from './shell-step.mjs';
import { createTestOutputParser } from './test-output.mjs';
import { commandSummary } from '../../shared/workflow-tests/checks.mjs';
import { processAlive } from '../ui-instance.mjs';

export const BEFORE_VERSION = 1;
export const BEFORE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const BEFORE_STALE_MS = 30 * 60_000;
export const HEARTBEAT_MS = 30_000;
const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;
const RUN_RE = /^run-[0-9a-f]{12}$/;
const cacheDir = (key) => join(beforeRoot(), 'cache', key);
const firstLine = (e) => String(e && e.message ? e.message : e || '').trim().split(/\r?\n/)[0].slice(0, 300);

/** What one before run is for: the example's project, start commit and setup, and the command check. */
export const beforeSpecOf = (example, check, startCommit = example.project.startCommit) => ({
  key: example.project.key, startCommit, setupCmd: example.project.setupCmd || null, cmd: check.cmd, timeoutMin: check.timeoutMin,
});
export function beforeHash(spec) {
  return createHash('sha256').update(JSON.stringify([BEFORE_VERSION, spec.key, spec.startCommit, spec.setupCmd || null, spec.cmd, spec.timeoutMin]))
    .digest('hex').slice(0, 32);
}

/** The kept result for `spec`, or null: none, another version, another copy stamp, older than a week, or unreadable. */
export async function readBefore(spec, { now = Date.now(), stamp = null } = {}) {
  if (!KEY_RE.test(String(spec.key || ''))) return null;
  try {
    const rec = JSON.parse(await readFile(join(cacheDir(spec.key), `${beforeHash(spec)}.json`), 'utf8'));
    const s = stamp ?? await copyStamp(spec.key);
    if (!rec || rec.v !== BEFORE_VERSION || rec.stamp !== s || !(now - Date.parse(rec.at) < BEFORE_MAX_AGE_MS)) return null;
    return { ...rec, ran: true, cached: true };
  } catch { return null; }
}

async function keep(spec, rec) {
  const dir = cacheDir(spec.key);
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${beforeHash(spec)}.json`);
  const tmp = `${file}.${process.pid}-${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, `${JSON.stringify(rec)}\n`, 'utf8');
  await rename(tmp, file);
}

// One run per spec in this server, shared by every caller of it (the tries of a test start together, D36). The run has its
// own stop: it is stopped only when every caller waiting on it has stopped; a caller that stops alone is answered 'stopped'
// at once while the run goes on for the others. Each caller's onPhase gets the phases, a late one first the current phase.
const inflight = new Map();   // key → { ac, waiting, phase, subs, p }
const STOPPED = Object.freeze({ ran: false, reason: 'stopped' });
/**
 * The command on the start commit: the kept result, else a fresh run (one at a time per spec in this server). Never throws
 * and never rejects: an error is `{ ran: false, reason: 'error', text }`.
 * @param {{key: string, startCommit: string, setupCmd: string|null, cmd: string, timeoutMin: number}} spec
 * @param {{signal?: AbortSignal|null, onPhase?: (p: 'copy'|'setup'|'command') => void, run?: Function, clone?: Function}} [o]
 *   `run` and `clone` (tests) are the first caller's.
 */
export function beforeRun(spec, o = {}) {
  try {
    const { signal = null, onPhase = null } = o;
    if (signal && signal.aborted) return Promise.resolve({ ...STOPPED });
    const k = `${spec.key}/${beforeHash(spec)}`;
    let job = inflight.get(k);
    if (!job) {
      const j = { ac: new AbortController(), waiting: 0, phase: null, subs: new Set() };
      const phase = (ph) => {
        j.phase = ph;
        for (const f of j.subs) { try { f(ph); } catch { /* a caller's progress never stops the run */ } }
      };
      j.p = (async () => (await readBefore(spec)) || runFresh(spec, { ...o, signal: j.ac.signal, onPhase: phase }))()
        .catch((e) => ({ ran: false, reason: 'error', text: firstLine(e) }))
        .finally(() => { if (inflight.get(k) === j) inflight.delete(k); });
      inflight.set(k, j);
      job = j;
    }
    return waitOn(k, job, signal, onPhase);
  } catch (e) {
    return Promise.resolve({ ran: false, reason: 'error', text: firstLine(e) });
  }
}

function waitOn(k, job, signal, onPhase) {
  job.waiting += 1;
  if (onPhase) {
    job.subs.add(onPhase);
    if (job.phase) { try { onPhase(job.phase); } catch { /* as above */ } }
  }
  return new Promise((resolve) => {
    let done = false;
    const leave = () => { if (onPhase) job.subs.delete(onPhase); if (signal) signal.removeEventListener('abort', stop); };
    const stop = () => {
      if (done) return;
      done = true;
      leave();
      job.waiting -= 1;
      if (job.waiting === 0) {
        // Nobody waits for it any more: stop it, and let a later caller start a new one.
        if (inflight.get(k) === job) inflight.delete(k);
        job.ac.abort();
      }
      resolve({ ...STOPPED });
    };
    if (signal) signal.addEventListener('abort', stop, { once: true });
    job.p.then((r) => {
      if (done) return;
      done = true;
      leave();
      resolve(r);
    });
  });
}

async function runFresh(spec, { signal = null, onPhase = () => {}, run = runShellStep, clone = cloneForBefore } = {}) {
  if (!KEY_RE.test(String(spec.key || ''))) return { ran: false, reason: 'error', text: 'the project key is not valid' };
  const stopped = () => !!(signal && signal.aborted);
  const stamp = await copyStamp(spec.key);
  await mkdir(beforeRoot(), { recursive: true });
  const name = `run-${randomBytes(6).toString('hex')}`;
  const dir = join(beforeRoot(), name);
  const owner = join(beforeRoot(), `${name}.owner.json`);
  const beat = () => writeFile(owner, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), 'utf8').catch(() => {});
  await beat();
  const timer = setInterval(() => { void beat(); }, HEARTBEAT_MS);
  if (timer.unref) timer.unref();
  try {
    if (stopped()) return { ran: false, reason: 'stopped' };
    onPhase('copy');
    await clone({ key: spec.key, startCommit: spec.startCommit, dir });
    if (stopped()) return { ran: false, reason: 'stopped' };
    if (spec.setupCmd) {
      onPhase('setup');
      // The setup's env (3a D56): the person's own command, before any change: it keeps the package-registry tokens.
      const s = await run({ command: spec.setupCmd, cwd: dir, env: tryShellEnv({ keepRegistryAuth: true }), timeoutMs: SETUP_TIMEOUT_MS, signal });
      if (stopped()) return { ran: false, reason: 'stopped' };
      if (!s.ok) return { ran: false, reason: 'setup' };
    }
    onPhase('command');
    const reader = createTestOutputParser();
    // The full guard env (a try's check gets the same): no forge, CI, publish or registry token. What the guard stops goes
    // to the scratch log: a before run is not the workflow's, so it is not "Would have sent".
    const r = await run({ command: spec.cmd, cwd: dir, env: tryShellEnv(), timeoutMs: spec.timeoutMin * 60_000, signal, onLine: (line) => reader.line(line) });
    if (stopped()) return { ran: false, reason: 'stopped' };
    const rec = { v: BEFORE_VERSION, key: spec.key, startCommit: spec.startCommit, setupCmd: spec.setupCmd || null, cmd: spec.cmd, timeoutMin: spec.timeoutMin,
      stamp, at: new Date().toISOString(), ok: !!r.ok, exitCode: r.exitCode ?? null, timedOut: !!r.timedOut, ms: r.ms ?? null,
      summary: commandSummary(r.tail), tail: r.tail || '', tests: reader.result() };
    if (!rec.timedOut) await keep(spec, rec).catch(() => {});   // a run its time limit stopped says nothing worth keeping
    return { ...rec, ran: true, cached: false };
  } catch (e) {
    return { ran: false, reason: 'error', text: firstLine(e) };
  } finally {
    clearInterval(timer);
    if (existsSync(dir)) {
      const why = await removeTree(dir);
      if (why) console.warn(`workflow tests: could not remove the before run's copy ${dir}: ${why}`);
    }
    await rm(owner, { force: true }).catch(() => {});
  }
}

/**
 * D75, at boot: a before run's clone whose owner is gone (its process ended, or no heartbeat for 30 minutes) is removed, and
 * so is an owner file with no clone; a live owner's clone stays (a second UI may share the Worca home). Kept results older
 * than a week go too. Never throws.
 */
export async function sweepBeforeRuns({ log = () => {}, now = Date.now(), alive = processAlive } = {}) {
  const out = { runs: 0, kept: 0 };
  const root = beforeRoot();
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return out; }
  for (const e of entries.filter((x) => x.isDirectory() && RUN_RE.test(x.name))) {
    const owner = join(root, `${e.name}.owner.json`);
    let o = null;
    try { o = JSON.parse(await readFile(owner, 'utf8')); } catch { o = null; }
    const fresh = !!o && Number.isFinite(Date.parse(o.at)) && now - Date.parse(o.at) < BEFORE_STALE_MS;
    let live = false;
    if (fresh && Number.isInteger(o.pid)) { try { live = !!alive(o.pid); } catch { live = false; } }
    if (live) continue;
    const why = await removeTree(join(root, e.name));
    if (why) { log('warn', `workflow tests: could not remove the leftover before run ${e.name}: ${why}`); continue; }
    await rm(owner, { force: true }).catch(() => {});
    out.runs += 1;
  }
  for (const e of entries.filter((x) => x.isFile() && /^run-[0-9a-f]{12}\.owner\.json$/.test(x.name))) {
    if (!existsSync(join(root, e.name.replace(/\.owner\.json$/, '')))) await rm(join(root, e.name), { force: true }).catch(() => {});
  }
  let keys = [];
  try { keys = (await readdir(join(root, 'cache'), { withFileTypes: true })).filter((x) => x.isDirectory()).map((x) => x.name); } catch { keys = []; }
  for (const k of keys) {
    let files = [];
    try { files = (await readdir(join(root, 'cache', k))).filter((f) => f.endsWith('.json')); } catch { files = []; }
    for (const f of files) {
      const p = join(root, 'cache', k, f);
      try { if (now - (await stat(p)).mtimeMs >= BEFORE_MAX_AGE_MS) { await rm(p, { force: true }); out.kept += 1; } } catch { /* the next one */ }
    }
  }
  if (out.runs || out.kept) log('info', `workflow tests: removed ${out.runs} leftover before run(s) and ${out.kept} old kept result(s)`);
  return out;
}

// src/core/plugin-script-cases.mjs
// `worca plugin validate <dir> --run-cases` (spec §8.1): run every case a plugin
// dir SHIPS through the one bench the app and the CLI use, against the dir's own
// scripts and a scratch cwd. Deliberately NOT inside plugin-manifest.mjs:
// validatePluginDir is the cheap synchronous gate every install path calls, and
// it must never spawn a child process.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadScriptRegistry } from './script-registry.mjs';
import { runBenchOnce } from './script-bench.mjs';
import { normalizeCases, evaluateExpect } from '../shared/graph/script-cases.mjs';

/** One case through the bench: the dir's registry, a scratch cwd, always. */
async function runOneCase(key, kase, registry, deps) {
  const request = {
    key,
    params: kase.params || {},
    inputs: kase.inputs || {},
    cwd: { kind: 'scratch' },
    ...(kase.ports ? { ports: kase.ports } : {}),
    ...(kase.timeoutMs ? { timeoutMs: kase.timeoutMs } : {}),
  };
  const benchDeps = { registry, agentKeys: [] };
  // The caller's hooks, per case: the live bench (so a signal can stop the child
  // tree) and the streamed lines, tagged with the script the case belongs to.
  if (typeof deps.onBench === 'function') benchDeps.onBench = deps.onBench;
  if (typeof deps.onLine === 'function') {
    benchDeps.onLine = (ev) => deps.onLine({ key, caseId: kase.id, stream: ev && ev.stream, text: ev && ev.text });
  }
  if (deps.runner) benchDeps.runner = deps.runner;
  if (deps.home) benchDeps.home = deps.home;
  if (deps.platform) benchDeps.platform = deps.platform;
  try {
    return await runBenchOnce(request, benchDeps);
  } catch (e) {
    // A transport-level refusal (a bad request, the bench cap) IS this case's
    // result: --run-cases reports per case and never throws at the caller.
    return {
      status: 'error', exitCode: null, runtime: null, durationMs: 0, summary: '', warnings: [],
      fired: [], outputs: {}, verdict: null, envelopePath: null,
      error: { message: e && e.message ? e.message : String(e), tail: [] },
      expect: null, draft: false,
    };
  }
}

/**
 * Run every shipped case of every script under `<absDir>/scripts`.
 * @param {string} absDir the plugin folder
 * @param {{runner?: Function, home?: string, platform?: string,
 *   onBench?: (bench: object) => void,
 *   onLine?: (ev: {key: string, caseId: string, stream: string, text: string}) => void,
 *   stopRequested?: () => boolean}} [deps]
 *   onBench receives each case's live bench (call `stop()` on it); stopRequested is
 *   asked before every case. A STOPPED case fails and ends the batch: `stopped` is
 *   true and the cases not reached are absent from the rows.
 * @returns {Promise<{scripts: Array<{key: string, runtime: string, cases: Array<{
 *   caseId: string, name: string, status: string, checked: boolean, pass: boolean,
 *   diffs: string[], durationMs: number}>}>, passed: number, failed: number,
 *   unchecked: number, stopped: boolean, problems: string[]}>}
 */
export async function runPluginScriptCases(absDir, deps = {}) {
  const dir = join(absDir, 'scripts');
  const out = { scripts: [], passed: 0, failed: 0, unchecked: 0, stopped: false, problems: [] };
  const stopRequested = typeof deps.stopRequested === 'function' ? deps.stopRequested : () => false;
  if (!existsSync(dir)) return out;
  // The plugin dir IS the registry for this run: its scripts load as the only
  // layer. agentKeys is empty on purpose — D16 drops a script whose key a HOST
  // agent holds, which says nothing about a folder that is only being linted.
  const registry = loadScriptRegistry({
    scriptsDir: dir, userScriptsDir: null, includePlugins: false, agentKeys: [],
  });
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.meta.json')).sort()) {
    const key = f.slice(0, -'.meta.json'.length);
    const meta = registry[key];
    if (!meta) continue;                                  // validatePluginDir already named it
    const casesFile = join(dir, `${key}.tests.json`);
    if (!existsSync(casesFile)) continue;
    let raw = null;
    try { raw = JSON.parse(readFileSync(casesFile, 'utf8')); }
    catch (e) { out.problems.push(`scripts/${key}.tests.json: invalid JSON (${e.message})`); continue; }
    const { cases, errors } = normalizeCases(raw, meta, { shipped: true });
    for (const e of errors) out.problems.push(`scripts/${key}.tests.json: ${e}`);
    if (!cases.length) continue;
    const row = { key, runtime: meta.runtime, cases: [] };
    for (const kase of cases) {
      if (stopRequested()) { out.stopped = true; break; }
      const result = await runOneCase(key, kase, registry, deps);
      const ev = evaluateExpect(kase.expect, result);
      const checked = !!ev;
      // `stopped` verified nothing either: it fails, and it ends the batch below.
      const broke = result.status === 'error' || result.status === 'timeout' || result.status === 'stopped';
      // An UNCHECKED case that could not run is still a failure: a shipped
      // script that throws is broken whether or not it declared an expectation.
      // A STOPPED case never passes, checked or not: an expectation that names no
      // verdict (`{ fired: [] }`) is SATISFIED by a run that was cut short.
      const stopped = result.status === 'stopped';
      const pass = !stopped && (checked ? ev.pass : !broke);
      // WHY it broke rides along either way: "expected clean, got error" alone sends
      // the author to the bench to learn that python is missing on the CI host.
      const why = broke ? [result.error ? result.error.message : result.status] : [];
      const diffs = checked ? [...ev.diffs, ...(ev.pass && !stopped ? [] : why)] : why;
      if (!pass) out.failed += 1;
      else if (checked) out.passed += 1;
      else out.unchecked += 1;
      row.cases.push({
        caseId: kase.id, name: kase.name, status: result.status,
        checked, pass, diffs, durationMs: result.durationMs || 0,
      });
      if (result.status === 'stopped') { out.stopped = true; break; }
    }
    if (row.cases.length) out.scripts.push(row);
    if (out.stopped) break;
  }
  return out;
}

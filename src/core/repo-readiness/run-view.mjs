// src/core/repo-readiness/run-view.mjs
// The chip's own view of a run's checkout, for plugin scripts (`api.readiness`): which instruction files each
// engine reads, the size limits, the engines judged for the project, and the report. Computed in the parent so a
// plugin and the chip never disagree. Never touches the readiness cache (that one is for the project folder).
import { evaluateReadiness } from './evaluate.mjs';
import { usageInputs } from './cache.mjs';
import { usedEngines } from './used.mjs';
import { buildReport } from './report.mjs';
import { DECLARED_ENGINES, engineSources } from './engines.mjs';
import { engineLabel } from '../../shared/engine-switch.mjs';
import { DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, DEFAULT_CONTEXT_MAX_BYTES_TOTAL } from '../settings.mjs';
import { MEMORY_RULES_REL } from '../memory-sync.mjs';
import { existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readWorkspace, readWorkspaceMap } from '../workspaces.mjs';
import { workspaceStorePath } from '../store.mjs';
import { effectiveEdges } from '../../shared/workspace-map/overrides.mjs';
import { NIGHT_ACTOR } from '../night/config.mjs';
import { AUTO_ACTOR } from '../identity.mjs';
import { NETWORK_ACTOR } from '../network-wait.mjs';

// The evaluation's bound: staging the run's work in a temporary index takes longer than the chip's interactive 8 s,
// and a `readiness: true` script allows 60 s in all (readinessGate.meta.json).
export const RUN_VIEW_TIMEOUT_MS = 30_000;
// What a run commits without when the caller names no exclusion set (a bench or CLI execution): the memory mount and
// the readiness-rubric skill mounts, as a setup run's teardown leaves them out (run-harness `_excludePathspecs`).
export const DEFAULT_RUN_EXCLUDES = Object.freeze([MEMORY_RULES_REL, '.claude/skills/readiness-rubric', '.agents/skills/readiness-rubric']);

function staticFields() {
  const engines = [...DECLARED_ENGINES];
  return {
    engines,
    labels: Object.fromEntries(engines.map((e) => [e, engineLabel(e)])),
    sources: Object.fromEntries(engines.map((e) => {
      const { files, globs, firstNonEmpty } = engineSources(e);
      return [e, { files: [...files], globs: [...globs], firstNonEmpty: firstNonEmpty === true }];
    })),
    limits: { perFile: DEFAULT_CONTEXT_MAX_BYTES_PER_FILE, total: DEFAULT_CONTEXT_MAX_BYTES_TOTAL },
  };
}

/**
 * @param {{dir:string, projectKey:string, projectDir?:string, runEngine?:string, folder?:boolean, ignore?:string[],
 *   exclude?:string[], timeoutMs?:number}} a
 *   `dir` the run's checkout, judged as the run's teardown will commit it: `exclude` the paths that commit leaves out
 *   (run-harness `_excludePathspecs`, default DEFAULT_RUN_EXCLUDES). `projectKey`/`projectDir` the registered project
 *   (history and settings, so `judged` matches the chip).
 * @returns {Promise<object>} the view; a workspace run's caller wraps members as `{ members: { [projectKey]: view } }`.
 *   A partial collection (a timeout, a git failure) sets `error`: a gate must not pass on facts it does not have.
 */
export async function readinessForRun({ dir, projectKey, projectDir, runEngine = 'claude', folder = false, ignore = [],
  exclude = DEFAULT_RUN_EXCLUDES, timeoutMs = RUN_VIEW_TIMEOUT_MS } = {}) {
  const fixed = staticFields();
  try {
    const base = await evaluateReadiness({ dir, projectKey, ignore, folder, timeoutMs, committed: folder ? null : { exclude } });
    const usage = usageInputs({ projectKey, projectDir: projectDir || dir, runEngine });
    const used = usedEngines({ engines: Object.keys(base.engines || {}), files: base.files || {}, ...usage });
    const report = buildReport(base, used);
    const judged = Object.entries(used).filter(([, u]) => u.used).map(([name]) => name);
    if (base.partial) return { ...fixed, judged, report, error: 'the chip\'s facts could not be collected (git timed out or failed)' };
    return { ...fixed, judged, report };
  } catch (err) {
    return { ...fixed, judged: [runEngine], report: null, error: String(err?.message || err) };
  }
}

// The edge states a review leaves standing (overrides.mjs LIVE_STATES, as the description renders them): a rejected
// edge, a confirmed one the last scan no longer finds and a stale review are not relations.
// The run's copy of the merged graph (not run-harness's `workspace-graph.json`, which a partial re-scan freezes).
const RUN_GRAPH_FILE = 'readiness-workspace-graph.json';
const STANDING = new Set(['auto', 'confirmed', 'manual']);
const oneLine = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/**
 * A workspace run's reviewed map for the readiness view (`workspaceMap`, beside `members`): the stored map's edges
 * with the user's overrides applied as the Map tab shows them (effectiveEdges, the helper of
 * `GET /api/workspaces/:id/map`), the workspace description and the merged graph file a scan copied into the
 * workspace store. Read in the parent: a plugin script imports no store.
 * `graphPath` points at a copy of that graph in the run's pipeline directory, made once (copy-if-absent): a Re-scan
 * that lands while a readiness run is paused replaces the store's graph, not the one this run reads.
 * @param {string|null|undefined} id the run's workspace id (the workspace channel's `workspaceId`)
 * @param {{pipelineDir?:string|null}} [opts] the run's pipeline directory; without one the store's graph is named as is
 * @returns {Promise<{edges:Array<{from:string,to:string,kind:string,how:string,confidence:string}>, description:string,
 *   graphPath:string|null}|null>} null when the workspace is unknown or has no map
 */
export async function workspaceMapForRun(id, { pipelineDir } = {}) {
  if (!id || typeof id !== 'string') return null;
  const stored = await readWorkspaceMap(id);
  if (!stored || !stored.map) return null;
  const edges = effectiveEdges(stored.map, stored.overrides)
    .filter((e) => STANDING.has(e.state))
    .map((e) => {
      const display = oneLine(e.display) || e.kind;
      const detail = oneLine(e.detail);
      return { from: e.from, to: e.to, kind: e.kind, how: detail ? `${display} (${detail})` : display,
        confidence: e.state === 'manual' ? 'manual' : (typeof e.confidence === 'string' && e.confidence ? e.confidence : 'inferred') };
    });
  const graph = join(workspaceStorePath(id), 'workspace-graph.json');   // workspace-scan-run.mjs WORKSPACE_GRAPH_FILE
  const ws = await readWorkspace(id);
  let graphPath = existsSync(graph) ? graph : null;
  if (graphPath && pipelineDir) {
    const copy = join(pipelineDir, RUN_GRAPH_FILE);
    if (!existsSync(copy)) {
      const ok = await mkdir(pipelineDir, { recursive: true }).then(() => copyFile(graph, copy)).then(() => true, () => false);
      graphPath = ok ? copy : null;   // a failed copy names nothing: the run must not read a graph a Re-scan can replace
    } else graphPath = copy;
  }
  return { edges, description: typeof ws?.description === 'string' ? ws.description : '', graphPath };
}

/** The ai-readiness Map card's form (card A, plugins/ai-readiness/agents/readinessMap.meta.json). */
export const CARD_A_FORM = 'readiness-confirm';

/**
 * Who answered card A on this run, from its stored step rows (artifacts.mjs `readStepQuestions`, whose top-level
 * `answeredBy` is the raw actor the harness recorded): `'away'` for Away mode, `'user'` only for an explicit person
 * (the UI, chat and the terminal all record one), `null` otherwise — no answer (an unattended run, or the card is
 * still open), the --yes auto-answer (AUTO_ACTOR), worca itself, or a row with no actor (fail closed). The latest
 * answer wins. The probe runs the commands Map took from worca memory only on `'user'`: nobody else saw them.
 * @param {Array<{ask?:{form?:string}, formAnswer?:object|null, answeredBy?:string}>} rows
 * @returns {{by: 'user'|'away'|null}}
 */
export function cardAOf(rows) {
  let by = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.ask?.form !== CARD_A_FORM || !r.formAnswer) continue;
    const actor = typeof r.answeredBy === 'string' ? r.answeredBy.trim() : '';
    if (actor === NIGHT_ACTOR || r.formAnswer.answeredBy === 'away') by = 'away';
    else if (!actor || actor === AUTO_ACTOR || actor === NETWORK_ACTOR) by = null;
    else by = 'user';
  }
  return { by };
}

// src/core/sources.mjs
// The task-source seam (spec §7.3): every way a pipeline acquires its task —
// inline prompt, markdown file/text, or a plugin task-source connector — resolves
// through ONE path yielding { promptText, promptFile, sourceMeta }.
// Feature-off bar: with zero plugins installed, 'prompt'/'markdown' resolution is
// byte-identical to the old inline prompt||promptFile branching in createPipeline.

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { callSource } from './plugin-shim.mjs';
import { readPluginsLock, pluginCurrentDir } from './plugins-lock.mjs';
import { listProfiles } from './plugin-config.mjs';
import { normalizeManifest } from './plugin-manifest.mjs';
import { getDb } from './db.mjs';
import { runDirForRow, readStoreMeta } from './artifacts.mjs';
import { RESULTS_FILE } from './results.mjs';
import { hasGh, findPrForBranch } from './git-info.mjs';

/** Same resolve-against-projectDir semantics as artifacts.mjs#resolveAgainst. */
function resolveAgainst(base, p) {
  return isAbsolute(p) ? p : resolve(base, p);
}

/** Profile roster for a plugin; never throws — the pane must render even when a
 *  plugin's data dir is unreadable (it degrades to "no profiles yet"). */
function safeProfiles(name) {
  try { return listProfiles(name); } catch { return []; }
}

/**
 * Every selectable task source: the two built-ins plus one entry per task source
 * of every ENABLED installed plugin (lexicographic plugin order, manifest order
 * within a plugin). Broken/missing manifests are skipped — the pane must render.
 * @returns {Array<{type:string, displayName:string, plugin?:string, sourceId?:string, inputs?:Array}>}
 */
export function listTaskSources() {
  const sources = [
    { type: 'prompt', displayName: 'Prompt' },
    { type: 'markdown', displayName: 'Markdown' },
  ];
  let lock = {};
  try { lock = readPluginsLock(); } catch { lock = {}; }
  for (const name of Object.keys(lock).sort()) {
    if (lock[name]?.enabled === false) continue;
    let manifest = null;
    try {
      const dir = pluginCurrentDir(name);
      const norm = normalizeManifest(JSON.parse(readFileSync(join(dir, 'worca-cc-plugin.json'), 'utf8')), { dir });
      manifest = norm.ok ? norm.manifest : null;
    } catch { manifest = null; }
    if (!manifest) continue;
    for (const ts of manifest.taskSources || []) {
      sources.push({
        type: 'plugin',
        plugin: name,
        sourceId: ts.id,
        displayName: ts.displayName || `${name}/${ts.id}`,
        inputs: ts.inputs || [],
        // A multi-profile source cannot be used until the pane knows WHICH
        // configuration to run against, so the roster ships with the listing —
        // the New Pipeline pane resolves the project's binding against it
        // without a second round trip.
        multiProfile: ts.multiProfile === true,
        profiles: ts.multiProfile === true ? safeProfiles(name) : [],
      });
    }
  }
  return sources;
}

/** `# title\n\nbody` + a fenced json meta block when the provider bag is non-empty. */
function taskPromptText(task) {
  let text = `# ${task.title || task.id}\n\n${task.body || ''}`;
  if (task.meta && typeof task.meta === 'object' && Object.keys(task.meta).length > 0) {
    text += `\n\n\`\`\`json meta\n${JSON.stringify(task.meta, null, 2)}\n\`\`\``;
  }
  return text;
}

/**
 * Resolve a source descriptor to the pipeline's task input.
 *   { type:'prompt', prompt } | { type:'markdown', promptText?, promptFile? }
 * | { type:'plugin', plugin, sourceId, taskId, inputs?, profile? }
 * @returns {Promise<{promptText:string, promptFile:string|null,
 *   sourceMeta:{plugin,sourceId,taskId,profile,url,title}|null}>}
 */
export async function resolveTaskInput(source, { projectDir } = {}) {
  const src = source && typeof source === 'object' ? source : { type: 'prompt', prompt: '' };
  const type = src.type || 'prompt';

  if (type === 'prompt') {
    return { promptText: typeof src.prompt === 'string' ? src.prompt : '', promptFile: null, sourceMeta: null };
  }

  if (type === 'markdown') {
    if (src.promptFile) {
      let promptText = '';
      try {
        promptText = await readFile(resolveAgainst(projectDir, src.promptFile), 'utf8');
      } catch {
        promptText = ''; // exactly the legacy createPipeline catch{} degradation
      }
      return { promptText, promptFile: src.promptFile, sourceMeta: null };
    }
    return { promptText: typeof src.promptText === 'string' ? src.promptText : '', promptFile: null, sourceMeta: null };
  }

  if (type === 'plugin') {
    const task = await callSource({
      plugin: src.plugin, sourceId: src.sourceId, op: 'getTask',
      args: { id: src.taskId }, profile: src.profile,
    });
    if (!task) {
      throw new Error(`task-source ${src.plugin}/${src.sourceId}: task "${src.taskId}" not found`);
    }
    return {
      promptText: taskPromptText(task),
      promptFile: null,
      sourceMeta: {
        plugin: src.plugin,
        sourceId: src.sourceId,
        taskId: src.taskId,
        // Pinned on the ROW, not re-derived at write-back time: the project's
        // binding may have moved to another tracker by then, and a result must
        // always be reported to the instance the task actually came from.
        profile: src.profile || null,
        // The source-panel inputs at fetch time, pinned for the same reason:
        // a per-RUN choice (e.g. jira-source's "Write result back") must gate
        // this run's report with what the user picked when they started it.
        inputs: src.inputs && typeof src.inputs === 'object' ? src.inputs : null,
        url: task.url ?? null,
        title: task.title ?? null,
      },
    };
  }

  throw new Error(`unknown task source type "${type}"`);
}

// ── result write-back (spec §7.5) ──────────────────────────────────────────────

/** Map a pipeline row status onto the connector reportResult vocabulary (§7.1). */
function statusToResult(status) {
  if (status === 'done') return 'completed';
  if (status === 'error' || status === 'stopped') return 'failed';
  return 'needs-human'; // paused | interrupted | anything non-terminal (manual retry path)
}

/** Markdown summary assembled from the persisted results view (results.mjs#assembleResults shape). */
function buildResultSummary(row, bundle) {
  const lines = [`### Worca CC run \`${row.id}\` — ${row.status}`];
  if (row.title) lines.push('', `**${row.title}**`);
  const s = bundle?.results?.summary; // { filesNew, filesChanged, filesDeleted, linesAdded, linesRemoved, blockingIssues, nitpicks }
  if (s) {
    lines.push('', `- Diffstat: ${s.filesChanged ?? 0} changed, ${s.filesNew ?? 0} new, ${s.filesDeleted ?? 0} deleted, +${s.linesAdded ?? 0} / -${s.linesRemoved ?? 0}`);
    lines.push(`- Review: ${s.blockingIssues ?? 0} blocking, ${s.nitpicks ?? 0} nitpicks`);
  }
  if (bundle?.branch) lines.push(`- Branch: \`${bundle.branch}\``); // local branches have no URL — named here, linked below only as a PR
  const checks = Array.isArray(bundle?.results?.keyThingsToCheck) ? bundle.results.keyThingsToCheck : [];
  if (checks.length) {
    lines.push('', 'Key things to check:');
    for (const c of checks.slice(0, 5)) lines.push(`- [${c.severity}] ${c.title}${c.file ? ` (\`${c.file}\`)` : ''}`);
  }
  return lines.join('\n');
}

/** Tracker-comment links: the PR when the bundle knows one. */
function buildResultLinks(bundle) {
  const links = [];
  if (bundle?.prUrl) links.push({ title: 'Pull request', url: bundle.prUrl });
  return links;
}

/**
 * Report a finished pipeline back to its plugin task source. NEVER throws and
 * NEVER blocks completion semantics: every failure collapses to { ok:false,
 * error } for the caller to log/surface. Silent skip ({ ok:true, skipped:true })
 * for prompt/markdown rows and refs that cannot be parsed.
 * @param {object} pipelineRow  raw pipelines row (source_type/source_ref/status/title)
 * @param {{results:object|null, branch:string|null, prUrl:string|null}} resultsBundle
 * @returns {Promise<{ok:true, skipped?:true} | {ok:false, error:string}>}
 */
export async function reportResultForPipeline(pipelineRow, resultsBundle) {
  try {
    if ((pipelineRow?.source_type || 'prompt') !== 'plugin') return { ok: true, skipped: true };
    let ref = null;
    try { ref = pipelineRow.source_ref ? JSON.parse(pipelineRow.source_ref) : null; } catch { ref = null; }
    if (!ref?.plugin || !ref?.sourceId || !ref?.taskId) return { ok: true, skipped: true };

    // Capability probe. capabilities() is optional in the connector contract
    // (§7.1: "defaults: writeBack true"): a connector without the op makes the
    // child answer { ok:false, error:{ kind:'plugin', message: 'connector does
    // not implement op "capabilities"' } } -> callSource throws
    // PluginOpError('plugin') -> we default to writeBack:true.
    // The run's pinned source-panel inputs travel to BOTH ops so a connector
    // can make write-back a per-run choice (jira-source's writeBack input):
    // capabilities({inputs}) answers for THIS run.
    // Transport errors (auth/network/timeout/protocol/rate-limit) mean the
    // connector could not answer, and what happens next depends on whether an
    // answer could have mattered: a per-run opt-out can only ride the pinned
    // inputs, so a run that pinned NONE fails OPEN (default writeBack:true —
    // a transient rate-limit on the probe must not silently drop the ticket
    // comment when the report itself would have succeeded), while a run WITH
    // pinned inputs fails CLOSED (the opt-out may be in them and we could not
    // hear it; writing would violate it) — the caller surfaces the error and
    // the results-view retry re-probes.
    const inputs = ref.inputs && typeof ref.inputs === 'object' ? ref.inputs : {};
    let writeBack = true;
    try {
      const caps = await callSource({
        plugin: ref.plugin, sourceId: ref.sourceId, op: 'capabilities', args: { inputs }, profile: ref.profile,
      });
      if (caps && caps.writeBack === false) writeBack = false;
    } catch (err) {
      if ((err?.kind || 'plugin') !== 'plugin' && Object.keys(inputs).length) {
        return { ok: false, error: `write-back capability probe failed: ${err?.message || String(err)}` };
      }
      writeBack = true;
    }
    if (!writeBack) return { ok: true, skipped: true };

    await callSource({
      plugin: ref.plugin,
      sourceId: ref.sourceId,
      // The profile recorded when the task was fetched — see resolveTaskInput.
      profile: ref.profile,
      op: 'reportResult',
      args: {
        id: ref.taskId,
        status: statusToResult(pipelineRow.status),
        summary: buildResultSummary(pipelineRow, resultsBundle),
        links: buildResultLinks(resultsBundle),
        inputs,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

/**
 * Load everything write-back needs for one pipeline and report it. Used by the
 * orchestrator's terminal hook AND (Task 15) the results-view "Report result"
 * retry endpoint. Skips BEFORE any bundle work for prompt/markdown rows, so
 * feature-off runs never touch git/gh/results here. NEVER throws.
 * @param {string} pipelineId
 */
export async function retryWriteback(pipelineId) {
  try {
    const row = getDb().prepare('SELECT * FROM pipelines WHERE id = ?').get(pipelineId);
    if (!row) return { ok: false, error: `unknown pipeline "${pipelineId}"` };
    if ((row.source_type || 'prompt') !== 'plugin') return { ok: true, skipped: true };

    const dir = await runDirForRow(row);
    let results = null;
    try { results = JSON.parse(await readFile(join(dir, RESULTS_FILE), 'utf8')); } catch { results = null; }
    let branch = null;
    try { branch = row.branch ? (JSON.parse(row.branch)?.feature ?? null) : null; } catch { branch = null; }
    // PR link, best-effort (same hasGh-gated pattern as artifacts.mjs#rowToHistoryEntry).
    let prUrl = null;
    if (branch) {
      try {
        const meta = readStoreMeta(row.project_key);
        if (meta?.path && (await hasGh())) {
          prUrl = (await findPrForBranch({ projectDir: meta.path, head: branch }))?.url || null;
        }
      } catch { prUrl = null; }
    }
    return await reportResultForPipeline(row, { results, branch, prUrl });
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}

// src/core/onboarding.mjs
// The Getting-started checklist's DERIVED state (docs/getting-started.md).
// Every tick is computed from product state — the store, the settings file, the
// PATH — and never written by the client: finishing a step ticks it on its own,
// Restart / Show again are trivially safe, and an established install meets a
// checklist that already knows what it has done. The only stored flags are the
// two in settings.mjs#onboardingPrefs (hidden, welcomeSeen).
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { getDb } from './db.mjs';
import { countProjects } from './projects.mjs';
import { countWorkspaces } from './workspaces.mjs';
import { countThreads } from './ask/store.mjs';
import { listScopes } from './metrics/read.mjs';
import { listPolicyScopes } from './policy/sync.mjs';
import { explainUnspawnableClaude, probeClaudeAuth, resolveClaudeBin } from './preflight.mjs';
import { onboardingPrefs } from './settings.mjs';

/** Step ids in shelf order. The UI (ui/public/getting-started.mjs) carries the
 *  copy and artwork for each; this list is the contract between the two. */
export const ONBOARDING_STEPS = Object.freeze([
  'claude', 'project', 'run', 'ask', 'realRun', 'workflows', 'workspace', 'teamMetrics', 'teamPolicy',
]);

/** The configured Claude binary — the same precedence claude-runner.mjs spawns with. */
export function configuredClaudeBin() {
  return process.env.WORCA_CLAUDE_BIN || process.env.ORCH_CLAUDE_BIN || 'claude';
}

const hasSep = (s) => s.includes('/') || s.includes('\\');

/** First PATH hit for `name` (with `exts` tried in order), or null. Pure: PATH and
 *  the existence probe are injected. */
function findOnPath(name, pathEnv, exists, exts, sep) {
  for (const dir of String(pathEnv || '').split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (exists(p)) return p;
    }
  }
  return null;
}

/**
 * Is the Claude Code CLI spawnable on this host? Never executes anything — a
 * handful of stat()s, like resolveClaudeBin. On Windows the npm `.cmd` shim
 * case is delegated to preflight's probe so the hint matches the run-time error.
 * @param {string} [bin]
 * @param {{platform?:string, pathEnv?:string, exists?:(p:string)=>boolean}} [opts]
 * @returns {{ready:boolean, bin:string, hint:string|null}}
 */
export function claudeReady(bin = configuredClaudeBin(), opts = {}) {
  const platform = opts.platform ?? process.platform;
  const pathEnv = opts.pathEnv ?? (process.env.PATH ?? '');
  const exists = opts.exists ?? existsSync;
  const name = String(bin || 'claude').trim() || 'claude';
  if (platform === 'win32') {
    const hint = explainUnspawnableClaude(name, { platform, pathEnv, exists });
    if (hint) return { ready: false, bin: name, hint };
    const r = resolveClaudeBin(name, { platform, pathEnv, exists });
    if (r.source !== 'as-is') return { ready: true, bin: r.bin, hint: null };
    if (hasSep(name) || isAbsolute(name)) return { ready: exists(name), bin: name, hint: null };
    const hit = findOnPath(name, pathEnv, exists, ['.exe', ''], ';');
    return { ready: !!hit, bin: hit || name, hint: null };
  }
  if (hasSep(name)) return { ready: exists(name), bin: name, hint: null };
  const hit = findOnPath(name, pathEnv, exists, [''], ':');
  return { ready: !!hit, bin: hit || name, hint: null };
}

/**
 * The nine ticks plus the two stored flags, in one call. The Claude step needs
 * the CLI found AND not signed out (`auth` is preflight's probeClaudeAuth state;
 * 'unknown' — mock, an older CLI — never un-ticks it). `recheck` skips the
 * probe's remembered answer (the Connect dialog's Check again).
 * @param {{recheck?:boolean}} [opts]
 * @returns {Promise<{steps:Record<string,boolean>, done:number, total:number,
 *   claude:{bin:string, hint:string|null, auth:'signed-in'|'signed-out'|'unknown'|null},
 *   hidden:boolean, welcomeSeen:boolean}>}
 */
export async function onboardingStatus({ recheck = false } = {}) {
  const db = getDb();
  const count = (sql) => { const row = db.prepare(sql).get(); return row ? Number(row.n) : 0; };
  const claude = claudeReady();
  const auth = claude.ready ? (await probeClaudeAuth({ bin: configuredClaudeBin(), force: recheck })).state : null;
  let teamMetrics = false;
  // Cached status only (no discovery): this is read at boot and after every change
  // broadcast, and the Team metrics page owns the expensive refresh.
  try { teamMetrics = !!(await listScopes()).anyEnabled; } catch { /* offline / no git: not enabled */ }
  // Same for the policy: a project or workspace that RESOLVES a policy (its own home or one it
  // follows) from the cached branch reads — never a discovery.
  let teamPolicy = false;
  try { teamPolicy = !!(await listPolicyScopes()).anyEnabled; } catch { /* offline / no git: not enabled */ }
  const steps = {
    claude: claude.ready && auth !== 'signed-out',
    project: countProjects() > 0,
    run: count("SELECT COUNT(*) AS n FROM pipelines WHERE status = 'done'") > 0,
    realRun: count('SELECT COUNT(*) AS n FROM pipelines WHERE total_cost_usd > 0') > 0,
    ask: countThreads() > 0,
    // The New pipeline picker persists a choice per project (PATCH /api/config
    // activeWorkflowId) the moment one is picked — Auto included: knowing the
    // picker exists is the step, not which workflow won.
    workflows: count("SELECT COUNT(*) AS n FROM project_config WHERE active_workflow_id IS NOT NULL AND TRIM(active_workflow_id) != ''") > 0,
    workspace: countWorkspaces() > 0,
    teamMetrics,
    teamPolicy,
  };
  const done = ONBOARDING_STEPS.filter((id) => steps[id]).length;
  return { steps, done, total: ONBOARDING_STEPS.length, claude: { bin: claude.bin, hint: claude.hint, auth }, ...onboardingPrefs() };
}

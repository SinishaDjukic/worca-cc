// src/core/ask/clone-proposal.mjs
// The ONE validator behind mcp__worca__propose_clone_project, and the event/notice text of the
// clone card (docs/deploy-railway.md "First project"). Pure: the projects root, the registered
// projects and the GitHub description are injected (clone-deps.mjs binds the real ones), so the
// MCP child validates for the model's self-correction and the parent turn re-validates
// authoritatively and mints the card — the model-proposal.mjs split. Nothing here clones:
// applying the card starts ui/server.mjs's clone job, behind the user's click.
import { planClone, CloneError } from '../clone-project.mjs';

const str = (v) => (typeof v === 'string' ? v.trim() : '');
// eslint-disable-next-line no-control-regex
const BREAKS_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const clip = (v, n) => String(v ?? '').replace(BREAKS_RE, ' ').slice(0, n);

/** How the clone authenticates, in words for the card. `mode` = githubMode() (deployment.mjs). */
export function githubLabel(mode, { host = 'github.com', appId = null } = {}) {
  if (host !== 'github.com') return `none (${host} is not GitHub): public repositories only`;
  if (mode === 'app') return `GitHub App${appId ? ` ${appId}` : ''} (a read-only token for this clone)`;
  if (mode === 'split') return 'the read token (WORCA_GH_READ_TOKEN)';
  if (mode === 'single') return 'the deployment token (GH_TOKEN)';
  return 'none: public repositories only';
}

/**
 * @param {object} r
 * @param {() => string} r.projectsRoot         the effective projects folder
 * @param {() => Promise<Array>} r.listProjects registered projects ({name, path})
 * @param {object} [r.env]                      for WORCA_CLONE_ALLOW
 * @param {(host:string) => string|null} [r.github]  the card's GitHub line (null in the MCP child)
 * @param {(p:string) => boolean} [r.exists]
 */
export function createCloneValidator(r) {
  /** @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>} */
  return async function validateCloneProposal(input) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    let plan;
    try {
      plan = planClone({ url: inp.url, branch: str(inp.branch) || null, name: str(inp.name) || null },
        { projectsRoot: r.projectsRoot(), env: r.env || process.env, ...(r.exists ? { exists: r.exists } : {}) });
    } catch (err) {
      return { ok: false, errors: [err instanceof CloneError ? err.message : String(err && err.message ? err.message : err)] };
    }
    const projects = await r.listProjects();
    if ((projects || []).some((p) => p && typeof p.name === 'string' && p.name.toLowerCase() === plan.name.toLowerCase())) {
      return { ok: false, errors: [`a project named "${plan.name}" already exists — pass another name`] };
    }
    const note = clip(str(inp.note), 200);
    const github = typeof r.github === 'function' ? r.github(plan.host) : null;
    return { ok: true, card: {
      type: 'clone', kind: 'clone',
      summary: `Clone ${plan.owner}/${plan.repo} as project ${plan.name}`,
      url: plan.url, branch: plan.branch, name: plan.name, dir: plan.dir,
      ...(github ? { github } : {}),
      ...(note ? { note } : {}),
      change: { url: plan.url, branch: plan.branch, name: plan.name },
    } };
  };
}

const eventText = (s, n) => clip(s, n).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');

/** `[worca event] …` — the synthetic turn's prompt after the user acted on a clone card, or its clone ended. */
export function cloneEventPrompt({ cardId, state, card = {}, result = null }) {
  const summary = eventText(card.summary, 200);
  if (state === 'declined') return `[worca event] clone card ${cardId} declined; "${summary}"`;
  if (state === 'failed') {
    return `[worca event] clone card ${cardId} failed${result?.code ? ` (${eventText(result.code, 40)})` : ''}: ${eventText(result?.error || 'unknown error', 300)}; "${summary}"`;
  }
  const where = result?.project ? `; project ${eventText(result.project.name, 100)} at ${eventText(result.project.path, 300)}` : '';
  return `[worca event] clone card ${cardId} applied: cloned and registered${where}; "${summary}"`;
}

/** The user-row notice above the event turn. */
export function cloneNoticeText({ state, card = {}, result = null }) {
  const s = clip(card.summary, 160);
  if (state === 'declined') return `Declined — ${s}`;
  if (state === 'failed') return `Could not clone — ${s}: ${clip(result?.error || 'unknown error', 200)}`;
  return `Cloned — ${s}${result?.project?.path ? ` · ${clip(result.project.path, 200)}` : ''}`;
}

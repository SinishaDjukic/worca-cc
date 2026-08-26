// validateProposal — the ONE validator behind mcp__worca__propose_run
// (ask-worca-design.md §9.2). The MCP child runs it so the model can self-correct;
// the server re-runs it on the intercepted card (authoritative). Error strings
// mirror POST /api/run wherever a counterpart exists. Readers injected.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listProjects as realListProjects } from '../projects.mjs';
import { readWorkspace as realReadWorkspace, isGitRepo as realIsGitRepo, WORKSPACE_KEY_RE } from '../workspaces.mjs';
import { readWorkflow as realReadWorkflow } from '../workflows.mjs';
import { readGuardrailSet as realReadGuardrailSet } from '../guardrail-store.mjs';
import { sanitizeBranchName, suggestBranchName } from '../worktree.mjs';
import { sanitizeTitle } from '../title.mjs';
import { ASK_LIMITS } from './limits.mjs';

export const PROPOSAL_ERRORS = Object.freeze({
  bothTargets: 'provide workspaceId OR projectKey, not both',
  noTarget: 'workspaceId or projectKey is required',
  unknownProject: (key) => `unknown projectKey "${key}"`,
  projectPathMissing: (path) => `project path is missing: ${path}`,
  workspaceNotFound: 'workspace not found',
  memberPathMissing: 'workspace member path is missing',
  memberNotGit: (dir) => `workspace member is not a git repository: ${dir}`,
  unknownWorkflow: (id) => `unknown workflowId "${id}"`,
  guardrailsType: 'guardrailsId must be a string',
  unknownGuardrails: (id) => `unknown guardrailsId "${id}"`,
  permissive: 'guardrailsId "permissive" is not allowed for proposed runs — use "normal" or a stricter set',
  briefRequired: 'brief is required',
  briefTooLong: `brief exceeds ${ASK_LIMITS.briefMaxChars} characters`,
  badSource: (v) => `unknown or invalid sourceBranch: ${v}`,
  byKeyUnknown: (k) => `sourceBranchByKey has an unknown project key: ${k}`,
  byKeyProjectOnly: 'sourceBranchByKey is only valid for a workspace',
});

const CARD_HEX_RE = /^card_([0-9a-f]{8})$/;
// Characters git refuses inside a ref name: ASCII control chars, space, DEL and ~ ^ : ? * [ \
const REF_BAD_CHARS = /[\x00-\x20\x7f~^:?*[\\]/;

/**
 * Pure git ref-format check (the rules of `git check-ref-format`), no shell-out.
 * The REAL "does this ref exist" check stays in POST /api/run (isValidSourceRef).
 */
export function isSyntacticRef(s) {
  if (typeof s !== 'string' || !s || s.length > 255) return false;
  if (s.startsWith('-')) return false;                        // would parse as a git option
  if (REF_BAD_CHARS.test(s)) return false;
  if (s.includes('..') || s.includes('@{') || s.includes('//')) return false;
  if (s.endsWith('/') || s.endsWith('.') || s.endsWith('.lock')) return false;
  return s.split('/').every((c) => c !== '' && !c.startsWith('.') && !c.endsWith('.lock'));
}

/**
 * @param {{listProjects?:Function, readWorkspace?:Function, readWorkflow?:Function, readGuardrailSet?:Function, isGitRepo?:Function, pathExists?:Function}} [deps]
 */
export function createProposalValidator({
  listProjects = realListProjects,
  readWorkspace = realReadWorkspace,
  readWorkflow = realReadWorkflow,
  readGuardrailSet = realReadGuardrailSet,
  isGitRepo = realIsGitRepo,
  pathExists = existsSync,
} = {}) {
  /**
   * @param {object} input  the propose_run tool input
   * @param {{cardId?:string|null}} [opts]  the server passes the minted card id (feature-branch uniqueness)
   * @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>}
   */
  async function validateProposal(input, { cardId = null } = {}) {
    const inp = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const errors = [];
    const fail = () => ({ ok: false, errors });
    const str = (v) => (typeof v === 'string' ? v.trim() : '');

    // ── target: exactly one ────────────────────────────────────────────────
    const projectKeyIn = str(inp.projectKey);
    const workspaceIdIn = str(inp.workspaceId);
    if (projectKeyIn && workspaceIdIn) { errors.push(PROPOSAL_ERRORS.bothTargets); return fail(); }
    if (!projectKeyIn && !workspaceIdIn) { errors.push(PROPOSAL_ERRORS.noTarget); return fail(); }
    let target;
    if (projectKeyIn) {
      const p = (await listProjects()).find((x) => x.key === projectKeyIn);
      if (!p) { errors.push(PROPOSAL_ERRORS.unknownProject(projectKeyIn)); return fail(); }
      if (!pathExists(p.path)) { errors.push(PROPOSAL_ERRORS.projectPathMissing(p.path)); return fail(); }
      target = { target: 'project', projectKey: p.key, projectName: p.name, projectDir: p.path,
        workspaceId: null, workspaceName: null, members: null };
    } else {
      if (!WORKSPACE_KEY_RE.test(workspaceIdIn)) { errors.push(PROPOSAL_ERRORS.workspaceNotFound); return fail(); }
      const ws = await readWorkspace(workspaceIdIn);
      if (!ws) { errors.push(PROPOSAL_ERRORS.workspaceNotFound); return fail(); }
      const members = [];
      const paths = Array.isArray(ws.projectPaths) ? ws.projectPaths : [];
      const keys = Array.isArray(ws.projectKeys) ? ws.projectKeys : [];
      for (let i = 0; i < paths.length; i++) {
        const dir = paths[i];
        if (!pathExists(dir)) { errors.push(PROPOSAL_ERRORS.memberPathMissing); return fail(); }
        if (!isGitRepo(dir)) { errors.push(PROPOSAL_ERRORS.memberNotGit(dir)); return fail(); }
        members.push({ projectKey: keys[i], projectDir: dir, projectName: basename(dir) });
      }
      members.sort((a, b) => (a.projectKey < b.projectKey ? -1 : a.projectKey > b.projectKey ? 1 : 0)); // primary first (ui/server.mjs:897)
      target = { target: 'workspace', projectKey: null, projectName: null, projectDir: null,
        workspaceId: ws.id, workspaceName: ws.name, members };
    }

    // ── workflow ───────────────────────────────────────────────────────────
    const workflowId = str(inp.workflowId) || 'wf_default';
    const wf = await readWorkflow(workflowId);
    if (!wf) errors.push(PROPOSAL_ERRORS.unknownWorkflow(workflowId));

    // ── guardrails: default normal, permissive refused (D3) ────────────────
    let guardrailsId = 'normal';
    if (inp.guardrailsId !== undefined && inp.guardrailsId !== null && inp.guardrailsId !== '') {
      if (typeof inp.guardrailsId !== 'string') { errors.push(PROPOSAL_ERRORS.guardrailsType); guardrailsId = null; }
      else guardrailsId = inp.guardrailsId.trim() || 'normal';
    }
    if (guardrailsId === 'permissive') errors.push(PROPOSAL_ERRORS.permissive);
    else if (guardrailsId && !(await readGuardrailSet(guardrailsId))) errors.push(PROPOSAL_ERRORS.unknownGuardrails(guardrailsId));

    // ── brief ──────────────────────────────────────────────────────────────
    const brief = String(inp.brief ?? '').trim();
    if (!brief) errors.push(PROPOSAL_ERRORS.briefRequired);
    else if (brief.length > ASK_LIMITS.briefMaxChars) errors.push(PROPOSAL_ERRORS.briefTooLong);

    // ── branches (syntactic only) ──────────────────────────────────────────
    let sourceBranch = null;
    const sourceIn = inp.sourceBranch === undefined || inp.sourceBranch === null ? '' : String(inp.sourceBranch).trim();
    if (sourceIn) {
      if (isSyntacticRef(sourceIn)) sourceBranch = sourceIn;
      else errors.push(PROPOSAL_ERRORS.badSource(sourceIn));
    }
    let sourceBranchByKey = null;
    if (inp.sourceBranchByKey !== undefined && inp.sourceBranchByKey !== null) {
      const raw = inp.sourceBranchByKey;
      if (target.target !== 'workspace') errors.push(PROPOSAL_ERRORS.byKeyProjectOnly);
      else if (typeof raw === 'object' && !Array.isArray(raw)) {       // non-objects ignored, like the route
        const memberKeys = new Set(target.members.map((m) => m.projectKey));
        const out = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!memberKeys.has(k)) { errors.push(PROPOSAL_ERRORS.byKeyUnknown(k)); continue; }
          const val = typeof v === 'string' ? v.trim() : '';
          if (!val) continue;
          if (!isSyntacticRef(val)) { errors.push(PROPOSAL_ERRORS.badSource(val)); continue; }
          out[k] = val;
        }
        sourceBranchByKey = Object.keys(out).length ? out : null;
      }
    }

    // ── title + feature branch ─────────────────────────────────────────────
    const title = sanitizeTitle(typeof inp.title === 'string' ? inp.title : '')
      || sanitizeTitle(brief.split(/\r?\n/)[0].slice(0, 80))
      || 'Proposed run';
    let featureBranch = typeof inp.featureBranch === 'string' ? sanitizeBranchName(inp.featureBranch) : '';
    if (!featureBranch) {
      const m = typeof cardId === 'string' ? CARD_HEX_RE.exec(cardId) : null;
      featureBranch = suggestBranchName({ prompt: brief, title, pipelineId: m ? m[1] : '' });
    }

    if (errors.length) return fail();
    return {
      ok: true,
      card: { ...target, workflowId: wf.id, workflowName: wf.name, guardrailsId, brief, title, sourceBranch, featureBranch, sourceBranchByKey },
    };
  }
  return { validateProposal };
}

/** Bound to the real readers — the server's authoritative re-validation and the MCP child both use it. */
export const validateProposal = createProposalValidator().validateProposal;

// validateProposal — the ONE validator behind mcp__worca__propose_run
// (ask-worca-design.md §9.2). The MCP child runs it so the model can self-correct;
// the server re-runs it on the intercepted card (authoritative). Error strings
// mirror POST /api/run wherever a counterpart exists. Readers injected.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { listProjects as realListProjects } from '../projects.mjs';
import { readWorkspace as realReadWorkspace, isGitRepo as realIsGitRepo, WORKSPACE_KEY_RE } from '../workspaces.mjs';
import { readWorkflow as realReadWorkflow, assertRunnableWorkflow as realAssertRunnableWorkflow } from '../workflows.mjs';
import { readGuardrailSet as realReadGuardrailSet } from '../guardrail-store.mjs';
import { validateMemoryScope } from '../memory-sync.mjs';
import { sanitizeBranchName, suggestBranchName } from '../worktree.mjs';
import { sanitizeTitle } from '../title.mjs';
import { ASK_LIMITS } from './limits.mjs';
import { resolveScheduleSpec } from './schedule-spec.mjs';

export const PROPOSAL_ERRORS = Object.freeze({
  bothTargets: 'provide workspaceId OR projectKey, not both',
  noTarget: 'workspaceId or projectKey is required',
  unknownProject: (key) => `unknown projectKey "${key}"`,
  projectPathMissing: (path) => `project path is missing: ${path}`,
  workspaceNotFound: 'workspace not found',
  memberPathMissing: 'workspace member path is missing',
  memberNotGit: (dir) => `workspace member is not a git repository: ${dir}`,
  unknownWorkflow: (id) => `unknown workflowId "${id}"`,
  memoryScopeType: 'memoryScope must be "global" or "project"',
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

// The run card's attachment pills. `ids` is the model's attachmentIds, `rows` the
// thread's attachment ledger (store.listAttachments — 8 keys; only four ride on
// the card). Unknown ids are dropped silently (the user may have deleted one
// since — like commentIds), duplicates collapse, the model's order is kept.
export function pickCardAttachments(ids, rows) {
  if (!Array.isArray(ids) || !Array.isArray(rows)) return [];
  const byId = new Map(rows.filter((r) => r && typeof r.id === 'string').map((r) => [r.id, r]));
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (typeof id !== 'string' || seen.has(id)) continue;
    const r = byId.get(id);
    if (!r) continue;
    seen.add(id);
    out.push({ id: r.id, name: String(r.name ?? ''), bytes: Number.isFinite(r.bytes) ? r.bytes : 0, kind: r.kind ?? 'text' });
  }
  return out;
}

// One line on the card (spec §6.1): C0/DEL/C1 + the Unicode line separators
// become spaces (NOT stripped — a note broken by a control char must still read
// as two words), runs of whitespace collapse, then the cap. Written with
// escapes — never a raw byte.
const NOTE_BREAK_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
function cleanNote(v) {
  if (typeof v !== 'string') return null;
  const s = v.replace(NOTE_BREAK_RE, ' ').replace(/\s+/g, ' ').trim().slice(0, ASK_LIMITS.proposalNoteMaxChars);
  return s || null;
}

/**
 * @param {{listProjects?:Function, readWorkspace?:Function, readWorkflow?:Function, assertRunnableWorkflow?:Function, readGuardrailSet?:Function, isGitRepo?:Function, pathExists?:Function}} [deps]
 */
export function createProposalValidator({
  listProjects = realListProjects,
  readWorkspace = realReadWorkspace,
  readWorkflow = realReadWorkflow,
  // The ONE runnable gate, injectable like every other reader on this seam.
  assertRunnableWorkflow = realAssertRunnableWorkflow,
  readGuardrailSet = realReadGuardrailSet,
  isGitRepo = realIsGitRepo,
  pathExists = existsSync,
} = {}) {
  /**
   * @param {object} input  the propose_run tool input
   * @param {{cardId?:string|null, timeZone?:string|null, nowMs?:number, scheduleDefaults?:object}} [opts]  the server passes the
   *   minted card id (feature-branch uniqueness); timeZone is the user's (the schedule fields are read in it)
   * @returns {Promise<{ok:true, card:object}|{ok:false, errors:string[]}>}
   */
  async function validateProposal(input, { cardId = null, attachments = [], timeZone = null, nowMs = Date.now(), scheduleDefaults = {} } = {}) {
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
    let wf = null;
    try { wf = await assertRunnableWorkflow(workflowId); }
    catch (err) { errors.push(err && err.message ? err.message : PROPOSAL_ERRORS.unknownWorkflow(workflowId)); }

    // ── memoryScope (agent memory §7.3): the same gate as POST /api/run ──────
    let memoryScope = null;
    let scopeTypeBad = false;
    if (inp.memoryScope !== undefined && inp.memoryScope !== null && inp.memoryScope !== '') {
      if (typeof inp.memoryScope !== 'string') { errors.push(PROPOSAL_ERRORS.memoryScopeType); scopeTypeBad = true; }
      else memoryScope = inp.memoryScope.trim() || null;
    }
    // Only when the workflow resolved (I2-#8): an unknown id has already pushed its own error and
    // `wf` is null, so checking here would add a second, misleading one for a typo of the defrag id.
    if (!scopeTypeBad && wf) {
      const reason = validateMemoryScope({ workflowId: wf.id, memoryScope, isWorkspace: target.target === 'workspace' });
      if (reason) errors.push(reason);
    }

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

    // ── schedule (docs/scheduled-runs.md "Ask Worca"): when | every, read in the user's zone ──
    const spec = resolveScheduleSpec(inp, { nowMs, timeZone, defaults: scheduleDefaults });
    if (!spec.ok) errors.push(...spec.errors);

    if (errors.length) return fail();
    return {
      ok: true,
      card: { ...target, workflowId: wf.id, workflowName: wf.name, guardrailsId, memoryScope, brief, title, sourceBranch, featureBranch, sourceBranchByKey,
        note: cleanNote(inp.note), attachments: pickCardAttachments(inp.attachmentIds, attachments),
        // Only a scheduled proposal carries the key: a plain run card keeps its shape byte for byte.
        ...(spec.schedule ? { schedule: spec.schedule } : {}) },
    };
  }
  return { validateProposal };
}

/** Bound to the real readers — the server's authoritative re-validation and the MCP child both use it. */
export const validateProposal = createProposalValidator().validateProposal;

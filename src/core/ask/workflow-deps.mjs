// src/core/ask/workflow-deps.mjs
// The propose_workflow dependency bundle (auto-workflow-design.md §8.1-8.2, plan P3 PD1/PD8): the ONE module that
// runs the Auto pipeline outside a run — fingerprint → classifier → assembler → matcher → buildProposal. Two callers:
//   • the MCP child: tools.mjs propose_workflow → deps.workflow.propose(): classifies / normalizes, assembles, matches,
//     and RETURNS the normalized shape (the parent cannot see the child's memory — the shape travels in the tool result);
//   • the parent: turn.mjs _onWorkflowResult and the cards route → revalidateWorkflowProposal(): re-assembles that shape,
//     re-matches and builds the card payload (buildProposal) — deterministic, so Save re-derives the same template.
// Reads only (the workflows row is written by the cards route; test/ask-workflow-deps.test.mjs scans this file).
// Names no agent key (D23). tools.mjs may not import anything, hence every reader/spawner lives here.
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { loadAgentRegistry } from '../agent-registry.mjs';
import { listProjects, worcaHome } from '../projects.mjs';
import { listModels, resolveRunConfig } from '../config.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { assembleShape, ShapeError, cleanText, normalizeShape } from '../../shared/graph/assemble.mjs';
import { fingerprintProject } from '../auto/fingerprint.mjs';
import { classifyTask, checkShapeModels, ClassifierError } from '../auto/classify.mjs';
import { autoCandidates, findEquivalentWorkflow } from '../auto/match.mjs';
import { buildProposal, remapTunables } from '../auto/proposal.mjs';
import { resolveAutoModel } from '../auto/model.mjs';
import { ASK_LIMITS } from './limits.mjs';

const TUNABLE_KEYS = ['model', 'effort', 'fanOut', 'askQuestions'];
const flat = (v, max) => cleanText(v, max);

/** {key, name, path} for a project key, or null. */
export async function projectByKey(key) {
  if (typeof key !== 'string' || !key) return null;
  const rows = await listProjects();
  const p = rows.find((x) => x && x.key === key);
  return p ? { key: p.key, name: p.name || '', path: p.path } : null;
}

/** The CLI's proposal vocabulary (src/cli/render.mjs formatWorkflowProposal) as ONE line for the model. */
export function proposalSummary(proposal) {
  const nodes = proposal?.manifest?.graph?.nodes || [];
  const wires = proposal?.manifest?.graph?.wires || [];
  const labelOf = (id) => nodes.find((n) => n.id === id)?.label || id;
  const stages = (proposal?.order || []).map((id) => {
    const n = proposal.nodes?.[id] || {};
    const tune = [n.model, n.effort].filter(Boolean).join(' · ');
    return `${n.label || id}${tune ? ` (${tune})` : ''}${n.fanOut ? ' ⤴' : ''}`;
  });
  const loops = wires.filter((w) => w.loop && Number.isInteger(w.maxCycles)).map((w) => `${labelOf(w.from.node)} → ${labelOf(w.to.node)} (max ${w.maxCycles} cycles)`);
  return `stages: ${stages.join(' → ')}${loops.length ? `; loops: ${loops.join(', ')}` : ''}`;
}

/** Bake accepted tunables into a template's agent node config — a NEW row only (a matched row is never touched).
 *  '' clears a key (sanitizeProposalAnswer's "model '' clears model AND effort"). */
export function applyTunables(template, tunables = {}) {
  return {
    ...template,
    nodes: (template.nodes || []).map((n) => {
      const t = tunables && tunables[n.id];
      if (!t || n.kind !== 'agent') return n;
      const config = { ...(n.config || {}) };
      for (const k of TUNABLE_KEYS) {
        if (t[k] === undefined) continue;
        if (t[k] === '') delete config[k]; else config[k] = t[k];
      }
      return { ...n, config };
    }),
  };
}

/** Drop model/effort a hand-authored shape names that the catalog does not carry (PD19). Reads a NORMALIZED shape. Returns warnings. */
function dropUnknownModels(shape, models) {
  const issues = checkShapeModels(shape, models);
  if (!issues.length) return [];
  const warnings = [];
  const units = (s) => (Array.isArray(s.parallel) ? s.parallel : [s]);
  for (const st of shape.stages.flatMap(units)) {
    const hit = issues.filter((i) => i.stageId === st.id);
    if (!hit.length) continue;
    const t = st.tunables || st;
    delete t.model; delete t.effort;
    warnings.push(`stage ${st.id}: ${hit.map((i) => i.message.replace(/^stage "[^"]*": /, '')).join('; ')} — dropped`);
  }
  return warnings;
}

/**
 * The deterministic half (spec §8.2): assemble (validateGraph inside), match, buildProposal. Pure w.r.t. the workflows table.
 * Also resolves the target project (v4): the parent needs its NAME for the card and the context header, and the MCP
 * child's result may not carry it (the mock never does).
 * @param {{shape:object, projectKey?:string|null, warnings?:Array, costUsd?:number, fingerprint?:string, models?:Array|null, registry?:object|null}} o
 * @returns {Promise<{proposal:object, template:object, match:{id,name}|null, tunables:object, shape:object, summary:string, project:{key,name,path}|null}>}
 * @throws {ShapeError} on an unassemblable shape
 */
export async function revalidateWorkflowProposal({ shape, projectKey = null, warnings = [], costUsd = 0, fingerprint = '', models = null, registry = null }) {
  const reg = registry || loadAgentRegistry();
  const catalog = models || await listModels('');
  const built = assembleShape(shape, { registry: reg, humanInLoop: true });
  const match = findEquivalentWorkflow(built.template, await autoCandidates());
  const project = await projectByKey(projectKey);          // null for no key / an unknown key — never throws
  let template = built.template;
  let tunables = built.tunables;
  let ignoredProjectOverrides = false;
  if (match) {
    tunables = remapTunables(tunables, match.nodeMap);
    template = match.candidate;
    if (project) {
      try {
        const rc = await resolveRunConfig(project.path, match.candidate.id);
        ignoredProjectOverrides = Object.keys(rc?.nodes || {}).length > 0 || Object.keys(rc?.wires || {}).length > 0;
      } catch { ignoredProjectOverrides = false; }
    }
  }
  const proposal = buildProposal({
    round: 1, shape: built.shape, template,
    match: match ? { id: match.candidate.id, name: match.candidate.name } : null,
    tunables, registry: reg, models: catalog,
    warnings: [...(warnings || []), ...built.warnings], costUsd, fingerprint, ignoredProjectOverrides,
  });
  return { proposal, template, match: proposal.match, tunables, shape: built.shape, summary: proposalSummary(proposal), project };
}

/** `[worca event] …` — the synthetic turn's prompt (spec §8.4). Names are cleaned: they land in a prompt line. v7: the name sits
 *  inside double quotes that the mock's event regex (and the model) key on, so `"` becomes `'`, and a `[worca context]` /
 *  `[/worca context]` tag typed into a name is neutralised (prompt.mjs:47-49 does that only for header lines). */
const eventName = (name) => flat(name, 60).replace(/"/g, "'").replace(/\[(\/?)worca context\]/gi, '($1worca context)');
export function workflowEventPrompt({ cardId, state, workflowId = null, name = '', thenRun = false, projectKey = '' }) {
  const p = flat(projectKey, 120);
  if (state === 'declined') return `[worca event] workflow card ${cardId} declined; project=${p}`;
  return `[worca event] workflow card ${cardId} saved as ${flat(workflowId, 120)} "${eventName(name)}"; thenRun=${thenRun ? 'true' : 'false'}; project=${p}`;
}

/** The user-row notice (mockup §C copy). */
export function workflowNoticeText({ state, name = '', matched = false, thenRun = false }) {
  const n = flat(name, 60);
  if (state === 'declined') return `Workflow "${n}" declined`;
  const head = matched ? `Using your saved workflow "${n}"` : `Workflow "${n}" saved`;
  return thenRun ? `${head} · Auto will propose a run next` : head;
}

/**
 * @param {{threadId?:string|null, signal?:AbortSignal|null, classify?:Function}} [o]
 *   threadId  unused today (the bundle is thread-agnostic); keeps the *-deps.mjs signature uniform
 *   signal    the MCP child's lifetime signal (mcp-stdio main() aborts it when stdin closes = the chat turn ended/was stopped) —
 *             the classifier honours it, so a Stop in the chat no longer leaves a nested claude running for up to 4 × 90 s (v7)
 *   classify  test seam for the classifier (defaults to classifyTask); tests inject a thrower / a recorder, never a spawn
 */
export function defaultWorkflowDeps({ threadId = null, signal = null, classify = classifyTask } = {}) {   // eslint-disable-line no-unused-vars
  const bundleSignal = signal;
  return {
    workflow: {
      /**
       * The child-side half. Task mode = the orchestrator's _autoRound (classify, ONE retry on a ShapeError with the issues as
       * feedback); shape mode = normalize + drop unknown models. Both then run revalidateWorkflowProposal.
       * Resolves {ok:true,…} — or, in task mode, {ok:false, error, costUsd, mode, projectKey, projectName} when the classifier
       * failed (timeout / two unusable replies / a shape the assembler still rejects after the retry): the money it spent is
       * REAL and rides `costUsd` so the parent books it (PD2, v7 — v6 rethrew and lost the spend). Input errors (unknown
       * project, an unassemblable hand-authored shape: nothing was spent) still THROW and reach the model as tool-error text.
       * @param {{mode:'task'|'shape', task?:string, shape?:object, name?:string, projectKey:string, note?:string, thenRun?:boolean, signal?:AbortSignal}} o
       */
      async propose({ mode, task = '', shape = null, name = '', projectKey, note = '', thenRun = false, signal = null }) {
        const project = await projectByKey(projectKey);
        if (!project) throw new Error(`unknown projectKey "${flat(projectKey, 120)}" — call list_projects`);
        const registry = loadAgentRegistry();
        const models = await listModels('');
        const fingerprint = await fingerprintProject(project.path);
        const warnings = [];
        let picked;
        let costUsd = 0;
        let r;
        if (mode === 'task') {
          const cwd = join(worcaHome(), 'tmp', 'ask');           // the ask scratch dir — never the user's checkout (spec §4.5)
          await mkdir(cwd, { recursive: true });
          const input = {
            taskText: String(task).slice(0, ASK_LIMITS.workflowTaskMaxChars), extras: [], fingerprint, models, registry, domain: 'coding',
            humanInLoop: true, feedback: [], priorShape: null, model: resolveAutoModel(models), cwd, mock: mockEnabled({}), signal: signal || bundleSignal,
          };
          // Every failure AFTER money may have been spent resolves {ok:false, costUsd} (v7): ClassifierError carries what its
          // failed attempts cost (classify.mjs:18-29); a ShapeError after the retry means two billed classifier calls.
          const spent = (err) => ({
            ok: false, mode, projectKey: project.key, projectName: flat(project.name, 120),
            error: flat(err && err.message ? err.message : String(err), 300), costUsd: Math.round((costUsd + (Number(err && err.costUsd) || 0)) * 1e6) / 1e6,
          });
          let classified;
          try { classified = await classify(input); }
          catch (err) { if (err instanceof ClassifierError) return spent(err); throw err; }
          costUsd += Number(classified.costUsd) || 0;
          warnings.push(...(classified.warnings || []));
          picked = name ? { ...classified.shape, name } : classified.shape;
          try {
            r = await revalidateWorkflowProposal({ shape: picked, projectKey: project.key, warnings, costUsd, fingerprint, models, registry });
          } catch (err) {
            if (!(err instanceof ShapeError)) throw err;
            let again;
            try {
              again = await classify({ ...input, priorShape: classified.shape,
                feedback: [`The previous shape could not be assembled: ${err.issues.map((i) => i.message).join('; ')}. Fix it and reply with the full shape.`] });
            } catch (e2) { if (e2 instanceof ClassifierError) return spent(e2); throw e2; }
            costUsd += Number(again.costUsd) || 0;
            warnings.push(...(again.warnings || []));
            picked = name ? { ...again.shape, name } : again.shape;
            try {
              r = await revalidateWorkflowProposal({ shape: picked, projectKey: project.key, warnings, costUsd, fingerprint, models, registry });
            } catch (e3) { if (e3 instanceof ShapeError) return spent(e3); throw e3; }
          }
        } else {
          picked = normalizeShape(name ? { ...shape, name } : shape);   // throws ShapeError with EVERY issue — the model fixes them in one go
          warnings.push(...dropUnknownModels(picked, models));
          r = await revalidateWorkflowProposal({ shape: picked, projectKey: project.key, warnings, costUsd, fingerprint, models, registry });
        }
        return {
          ok: true, mode, projectKey: project.key, projectName: flat(project.name, 120),
          name: r.proposal.name, match: r.match, warnings: r.proposal.warnings, summary: r.summary,
          shape: r.shape, costUsd: r.proposal.costUsd, fingerprint, note: flat(note, ASK_LIMITS.workflowNoteMaxChars), thenRun: thenRun === true,
        };
      },
      revalidate: revalidateWorkflowProposal,
    },
  };
}

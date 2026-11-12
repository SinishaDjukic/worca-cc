// src/core/design/spawn-options.mjs
// How a Design agent is spawned (SPEC C-3): the runClaude options for one lead or builder process, its model and
// effort, and its deny rules (the builder caps are limits.mjs's, P8). Design has no spending limit of its own (M13): `maxBudgetUsd` is
// whatever the caller computed from worca's limits, or null. P8: the design's engine, by its `DESIGN_ENGINES` row. Off
// the hook row there is no write guard, extra folder, budget flag, tool list or partial stream (C-3, L8.26): the cwd
// holds the writes and git stays off; a builder reads its `.ctx` copies. A Design agent has what a workflow agent
// has, the shell included, plus the web: it reads the picked project, copies its pictures, and the lead starts the
// product to shoot its screens. Nothing is denied but the build's own rules (the read denies, a project's guardrails).
// Import cycle (spawn-options → engines → build → spawn-options): imports are read inside functions only, and
// read-bundle.mjs is never imported here (it would pull the assembler into the cycle).

import { join } from 'node:path';
import { ASK_DENY_RULES } from '../ask/deny-rules.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { resolveModelEnv } from '../config.mjs';
import { defaultGuardrailSetId, readGuardrailSet } from '../guardrail-store.mjs';
import { designModelsSetting } from '../settings.mjs';
import { guardrailsToPermissionRules } from '../guardrails.mjs';
import { withRole } from '../model-roles.mjs';
import { designEngineRow } from './engines.mjs';
import { builderWriteDirs, designRoot, designWorkDir, leadWriteDirs, sectionDir } from './paths.mjs';
import { builderSystemPrompt, leadSystemPrompt } from './prompts.mjs';

/** Lead and builder tools: files, the shell and the web (docs/design.md "What the agents can use"). No MCP, skills
 *  or Agent. */
export const DESIGN_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']);
/** `maxTurns` per `<role>:<stage>` (C-3). A rework or a retry of a section runs as its section's stage: `builder:first`,
 *  or `builder:change` in a change round. The plan stage leaves the lead room to look through the project, copy its
 *  pictures, and start the product and shoot its screens. */
export const DESIGN_MAX_TURNS = Object.freeze({ 'lead:plan': 80, 'builder:first': 25, 'lead:integrate': 40, 'lead:change': 20, 'builder:change': 15 });

const DEFAULT_EFFORT = Object.freeze({ lead: 'high', builder: 'medium' });

/** The mock role a process plays: the lead's integrate pass is its own role. */
function mockRole(role, stage) {
  if (role === 'builder') return 'design-builder';
  return stage === 'integrate' ? 'design-integrate' : 'design-lead';
}

/**
 * The runClaude options for one Design process; `ctx.kind` is the design's kind (default `web`), `ctx.row` the
 * engine's `DESIGN_ENGINES` row (default `designEngineRow(ctx.engine)`), `ctx.bridgedInfo` a bridged model's
 * `bridgedModelInfo`, whose `excludeTools` become `disallowedTools`, `ctx.pictures` (a lead only) whether its round can
 * have pictures made: it changes the lead's system prompt and nothing else (no env, no setting). Throws for an engine
 * Design refuses, for an unknown role and stage, for a bad design or section id, and (through `resolveModelEnv`,
 * `errorClass:'auth'`) for a bridged model whose provider is not ready.
 */
export function designSpawnOptions(ctx) {
  const { role, stage, engine = 'claude', kind, agentId, buildId, designId, sectionId, projectDir, prompt, model, effort,
    resumeSessionId, maxBudgetUsd, denyRules, signal, onEvent, mock } = ctx;
  const row = ctx.row ?? designEngineRow(engine);
  if (row.gate === 'refused') throw new Error(`design: engine ${engine} does not run Design`);
  const maxTurns = DESIGN_MAX_TURNS[`${role}:${stage}`];
  if (!maxTurns) throw new Error(`design: no agent runs as ${role}:${stage}`);
  const builder = role === 'builder';
  const hooked = row.confine === 'hook';
  const work = designWorkDir(designId);
  const cwd = builder ? sectionDir(designId, sectionId) : work;
  // The design's kind (`web` when absent) picks the system prompt: a deck or a video swaps P2's bands for its own block.
  // A builder off the hook row reads its `.ctx` copies (L8.7), staged by the build before each process. A lead whose
  // round can have pictures made (`ctx.pictures`) reads the Made pictures rules last; a builder never does.
  const system = builder
    ? builderSystemPrompt({ kind, readRoot: hooked ? undefined : join(cwd, '.ctx') })
    : leadSystemPrompt({ kind, pictures: Boolean(ctx.pictures) });
  const tools = [...DESIGN_TOOLS];
  const excluded = ctx.bridgedInfo?.excludeTools;
  return {
    engine,
    cwd,
    prompt,
    // parseMarkers keeps the first MOCK_ROLE it sees, so the marker leads and no later line can override it.
    systemPrompt: mockEnabled({ mock }) ? `MOCK_ROLE: ${mockRole(role, stage)}\n${system}` : system,
    model,
    effort,
    modelEnv: resolveModelEnv(model, { tag: agentId }),
    permissionMode: 'acceptEdits',
    ...(hooked ? { tools: [...tools] } : {}),
    allowedTools: [...tools],
    ...(Array.isArray(excluded) && excluded.length ? { disallowedTools: [...excluded] } : {}),
    strictMcpConfig: true,
    settingSources: ['project'],
    disableSlashCommands: true,
    // C1: no CLAUDE.md under the design library loads as instructions, whoever put it there (the write guard refuses
    // agents one; a kit or an attachment could still carry it). Absolute globs with forward slashes, as the CLI matches.
    extraSettings: { autoMemoryEnabled: false, claudeMdExcludes: [`${designRoot().replaceAll('\\', '/')}/**`] },
    maxTurns,
    // Claude only: its partial stream, its budget flag, its write hook and extra folders. Off the hook row the cwd
    // holds the writes, and git never runs in the design's folders (Gemini and Cursor would, L8.26).
    ...(hooked ? {
      includePartialMessages: true,
      maxBudgetUsd: maxBudgetUsd ?? null,
      writeGuard: { allowedDirs: builder ? builderWriteDirs(designId, sectionId) : leadWriteDirs(designId) },
    } : { noGit: true }),
    permissionRules: { deny: [...new Set(denyRules || [])] },
    envScrub: true,
    envAllowlist: [],
    ...(hooked ? { addDirs: projectDir ? [work, projectDir] : [work] } : {}),
    asAgent: true,
    spawnKind: 'phase',
    runId: buildId,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    signal,
    onEvent,
    ...(mock ? { mock: true } : {}),
  };
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A stored `{model, effort?}` pick with a model, else null. */
const pickOf = (v) => (isObj(v) && typeof v.model === 'string' && v.model.trim()
  ? { model: v.model.trim(), effort: typeof v.effort === 'string' && v.effort ? v.effort : null } : null);

/**
 * Who picks the model of a lead (the main agent) or a builder (a section's agent), first match wins: the design's own
 * pick (`design.models.lead|builder`, its composer's pills), the Models page's Design pick for the engine
 * (`designModels`), the model role (`designLead` → Deep thinking, `designBuilder` → Everyday coding), else the engine's
 * default model. An unset effort is `high` for a lead and `medium` for a builder.
 * @param {'lead'|'builder'} role
 * @param {{ engine?: string, design?: { models?: object|null }|null, settings?: () => object }} [opts]
 * @returns {{ model: string|null, effort: string, source: 'design'|'setting'|'role'|'default' }}
 */
export function designModelPick(role, { engine = 'claude', design = null, settings = designModelsSetting } = {}) {
  const lead = role === 'lead';
  const key = lead ? 'lead' : 'builder';
  const effortOf = (p) => p.effort || DEFAULT_EFFORT[key];
  const own = pickOf(design?.models?.[key]);
  if (own) return { model: own.model, effort: effortOf(own), source: 'design' };
  let stored = null;
  try { stored = pickOf(settings()?.[engine]?.[key]); } catch { stored = null; }
  if (stored) return { model: stored.model, effort: effortOf(stored), source: 'setting' };
  const role0 = withRole(null, engine, lead ? 'designLead' : 'designBuilder');
  if (role0?.model) return { model: role0.model, effort: role0.effort || DEFAULT_EFFORT[key], source: 'role' };
  return { model: null, effort: DEFAULT_EFFORT[key], source: 'default' };
}

/**
 * The model and effort a lead or a builder of `design` runs on (designModelPick without its source). Unset everywhere
 * gives `model: null`, the CLI default.
 */
export function resolveDesignModel(role, { engine = 'claude', design = null } = {}) {
  const { model, effort } = designModelPick(role, { engine, design });
  return { model, effort };
}

/**
 * Deny rules for a Design process: Ask's read denies always (never its tool denies: agents must write), plus the
 * default guardrail set's rules when a project is given (L2.16). Permissive has no rules. No rule appears twice.
 */
export async function designDenyRules({ projectDir } = {}) {
  const rules = ASK_DENY_RULES.filter((r) => r.startsWith('Read('));
  if (projectDir) {
    const set = await readGuardrailSet(defaultGuardrailSetId());
    rules.push(...(guardrailsToPermissionRules(set?.settings)?.deny ?? []));
  }
  return [...new Set(rules)];
}

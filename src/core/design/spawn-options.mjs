// src/core/design/spawn-options.mjs
// How a Design agent is spawned (SPEC C-3): the runClaude options for one lead or builder process, its model and
// effort, its deny rules and the builder cap (M6). Claude only in P2; P8 adds the other engines. Design has no
// spending limit of its own (M13): `maxBudgetUsd` is whatever the caller computed from worca's limits, or null.

import { ASK_DENY_RULES } from '../ask/deny-rules.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { resolveModelEnv } from '../config.mjs';
import { defaultGuardrailSetId, readGuardrailSet } from '../guardrail-store.mjs';
import { guardrailsToPermissionRules } from '../guardrails.mjs';
import { withRole } from '../model-roles.mjs';
import { builderWriteDirs, designRoot, designWorkDir, leadWriteDirs, sectionDir } from './paths.mjs';
import { builderSystemPrompt, leadSystemPrompt } from './prompts.mjs';

/** Builder and lead tools: no Bash, web, MCP, skills or Agent. */
export const DESIGN_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
/** `maxTurns` per `<role>:<stage>` (C-3). A rework or a retry of a section runs as its section's stage: `builder:first`,
 *  or `builder:change` in a change round. */
export const DESIGN_MAX_TURNS = Object.freeze({ 'lead:plan': 40, 'builder:first': 25, 'lead:integrate': 15, 'lead:change': 20, 'builder:change': 15 });

const DEFAULT_EFFORT = Object.freeze({ lead: 'high', builder: 'medium' });
const MAX_BUILDERS_CAP = 24;

/** The mock role a process plays: the lead's integrate pass is its own role. */
function mockRole(role, stage) {
  if (role === 'builder') return 'design-builder';
  return stage === 'integrate' ? 'design-integrate' : 'design-lead';
}

/**
 * The runClaude options for one Design process. Throws for an engine other than claude, for an unknown
 * role and stage, for a bad design or section id, and (through `resolveModelEnv`, `errorClass:'auth'`) for a
 * bridged model whose provider is not ready.
 */
export function designSpawnOptions(ctx) {
  const { role, stage, engine = 'claude', agentId, buildId, designId, sectionId, projectDir, prompt, model, effort,
    resumeSessionId, maxBudgetUsd, denyRules, signal, onEvent, mock } = ctx;
  if (engine !== 'claude') throw new Error(`design: engine ${engine} is not supported yet`);
  const maxTurns = DESIGN_MAX_TURNS[`${role}:${stage}`];
  if (!maxTurns) throw new Error(`design: no agent runs as ${role}:${stage}`);
  const builder = role === 'builder';
  const work = designWorkDir(designId);
  const system = builder ? builderSystemPrompt() : leadSystemPrompt();
  return {
    engine: 'claude',
    cwd: builder ? sectionDir(designId, sectionId) : work,
    prompt,
    // parseMarkers keeps the first MOCK_ROLE it sees, so the marker leads and no later line can override it.
    systemPrompt: mockEnabled({ mock }) ? `MOCK_ROLE: ${mockRole(role, stage)}\n${system}` : system,
    model,
    effort,
    modelEnv: resolveModelEnv(model, { tag: agentId }),
    permissionMode: 'acceptEdits',
    tools: [...DESIGN_TOOLS],
    allowedTools: [...DESIGN_TOOLS],
    strictMcpConfig: true,
    settingSources: ['project'],
    disableSlashCommands: true,
    // C1: no CLAUDE.md under the design library loads as instructions, whoever put it there (the write guard refuses
    // agents one; a kit or an attachment could still carry it). Absolute globs with forward slashes, as the CLI matches.
    extraSettings: { autoMemoryEnabled: false, claudeMdExcludes: [`${designRoot().replaceAll('\\', '/')}/**`] },
    includePartialMessages: true,
    maxTurns,
    maxBudgetUsd: maxBudgetUsd ?? null,
    writeGuard: { allowedDirs: builder ? builderWriteDirs(designId, sectionId) : leadWriteDirs(designId) },
    permissionRules: { deny: [...(denyRules || [])] },
    envScrub: true,
    envAllowlist: [],
    addDirs: !builder && projectDir ? [work, projectDir] : [work],
    asAgent: true,
    spawnKind: 'phase',
    runId: buildId,
    ...(resumeSessionId ? { resumeSessionId } : {}),
    signal,
    onEvent,
    ...(mock ? { mock: true } : {}),
  };
}

/**
 * The model role's pick for a lead (`designLead`, deep) or a builder (`designBuilder`, everyday). An unset role
 * gives `model: null`, the CLI default; an unset effort gives the role default, `high` for a lead, `medium` for a builder.
 */
export function resolveDesignModel(role, { engine = 'claude' } = {}) {
  const lead = role === 'lead';
  const pick = withRole({ model: null, effort: null }, engine, lead ? 'designLead' : 'designBuilder');
  return { model: pick?.model || null, effort: pick?.effort || DEFAULT_EFFORT[lead ? 'lead' : 'builder'] };
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

/** Builders running at once (M6, L2.12): `WORCA_DESIGN_MAX_BUILDERS` when a whole number from 1 to 24, else by Build fast. */
export function designMaxBuilders({ fast, hosted, env = process.env } = {}) {
  const raw = env?.WORCA_DESIGN_MAX_BUILDERS;
  if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) {
    const n = Number(raw);
    if (n >= 1 && n <= MAX_BUILDERS_CAP) return n;
  }
  if (!fast) return 3;
  return hosted ? 6 : 12;
}

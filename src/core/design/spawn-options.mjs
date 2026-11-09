// src/core/design/spawn-options.mjs
// How a Design agent is spawned (SPEC C-3): the runClaude options for one lead or builder process, its model and
// effort, and its deny rules (the builder caps are limits.mjs's, P8). Design has no spending limit of its own (M13): `maxBudgetUsd` is
// whatever the caller computed from worca's limits, or null. P8: the design's engine, by its `DESIGN_ENGINES` row. Off
// the hook row there is no write guard, extra folder, budget flag, tool list or partial stream (C-3, L8.26): the cwd
// holds the writes, git stays off, and the shell and web tools are denied (L8.27); a builder reads its `.ctx` copies.
// Import cycle (spawn-options → engines → build → spawn-options): imports are read inside functions only, and
// read-bundle.mjs is never imported here (it would pull the assembler into the cycle).

import { join } from 'node:path';
import { ASK_DENY_RULES } from '../ask/deny-rules.mjs';
import { mockEnabled } from '../claude-runner.mjs';
import { resolveModelEnv } from '../config.mjs';
import { defaultGuardrailSetId, readGuardrailSet } from '../guardrail-store.mjs';
import { guardrailsToPermissionRules } from '../guardrails.mjs';
import { withRole } from '../model-roles.mjs';
import { designEngineRow } from './engines.mjs';
import { builderWriteDirs, designRoot, designWorkDir, leadWriteDirs, sectionDir } from './paths.mjs';
import { builderSystemPrompt, leadSystemPrompt } from './prompts.mjs';

/** Builder and lead tools: no Bash, web, MCP, skills or Agent. */
export const DESIGN_TOOLS = Object.freeze(['Read', 'Write', 'Edit', 'Glob', 'Grep']);
/** What a process off the hook row denies by rule, since its tool list cannot be held (SPEC L13, L8.27). */
export const DESIGN_OFF_RULES = Object.freeze(['Bash', 'WebSearch', 'WebFetch']);
/** Codex reads files through its shell, so it keeps it and denies web search only (L8.27). */
const CODEX_OFF_RULES = Object.freeze(['WebSearch']);
/** `maxTurns` per `<role>:<stage>` (C-3). A rework or a retry of a section runs as its section's stage: `builder:first`,
 *  or `builder:change` in a change round. */
export const DESIGN_MAX_TURNS = Object.freeze({ 'lead:plan': 40, 'builder:first': 25, 'lead:integrate': 15, 'lead:change': 20, 'builder:change': 15 });

const DEFAULT_EFFORT = Object.freeze({ lead: 'high', builder: 'medium' });

/** The mock role a process plays: the lead's integrate pass is its own role. */
function mockRole(role, stage) {
  if (role === 'builder') return 'design-builder';
  return stage === 'integrate' ? 'design-integrate' : 'design-lead';
}

/**
 * The runClaude options for one Design process; `ctx.kind` is the design's kind (default `web`), `ctx.row` the
 * engine's `DESIGN_ENGINES` row (default `designEngineRow(ctx.engine)`), `ctx.bridgedInfo` a bridged model's
 * `bridgedModelInfo`, whose `excludeTools` become `disallowedTools`. Throws for an engine Design refuses, for an
 * unknown role and stage, for a bad design or section id, and (through `resolveModelEnv`, `errorClass:'auth'`) for a
 * bridged model whose provider is not ready.
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
  // A builder off the hook row reads its `.ctx` copies (L8.7), staged by the build before each process.
  const system = builder ? builderSystemPrompt({ kind, readRoot: hooked ? undefined : join(cwd, '.ctx') }) : leadSystemPrompt({ kind });
  const off = hooked ? [] : (engine === 'codex' ? CODEX_OFF_RULES : DESIGN_OFF_RULES);
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
    ...(hooked ? { tools: [...DESIGN_TOOLS] } : {}),
    allowedTools: [...DESIGN_TOOLS],
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
    permissionRules: { deny: [...new Set([...(denyRules || []), ...off])] },
    envScrub: true,
    envAllowlist: [],
    ...(hooked ? { addDirs: !builder && projectDir ? [work, projectDir] : [work] } : {}),
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

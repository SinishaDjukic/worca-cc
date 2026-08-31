// src/core/phases.mjs
//
// Per-phase agent runners. Each runner:
//   - loads the matching agents/*.md body (passed in via ctx.agentPrompts) and uses it
//     as the *appended* system prompt, *prepended* with the preflight toolInstruction,
//   - builds a per-role task prompt that ALSO carries the MOCK markers the offline mock
//     runner parses (MOCK_ROLE / MOCK_OUT / MOCK_JSON / MOCK_CYCLE / MOCK_IN / MOCK_BASE),
//     so a full pipeline can run with WORCA_MOCK=1 without spawning claude,
//   - sets allowedTools appropriate for the role,
//   - calls runClaude, then reads the produced artifact back through protocol and returns
//     the contracted shape.
//
// If an agent .md body is missing/empty, each runner falls back to a sensible inline role
// prompt so the system prompt is never empty. Interface is locked by docs/ARCHITECTURE.md §3.5.

import { runClaude } from './claude-runner.mjs';
import { resolveModelEnv } from './config.mjs';
import { SUBAGENT_AUTO, SUBAGENT_INHERIT, SUBAGENT_MODELS, effectiveSubagentModel } from './model-env.mjs';
import { readClarify, readReview } from './protocol.mjs';
import { writeClarify, readClarifyRow } from './artifacts.mjs';
import { join } from 'node:path';

// ── allowedTools per role ──────────────────────────────────────────────────────
// `Skill` lets agents invoke project (.claude/skills) and personal (~/.claude/skills)
// skills via the Skill tool; without it, headless `claude -p` denies skill calls.
export const READ_WRITE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill'];
// Implementer additionally gets MultiEdit for larger, multi-hunk edits.
export const IMPLEMENTER_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob', 'Skill'];

/**
 * Effective `--allowedTools` for a node: the role's baseline file/exec tools UNION
 * the agent's frontmatter-declared tools (e.g. the Playwright MCP `browser_*` tools).
 *
 * Frontmatter only ADDS to the baseline — an agent that omits Write still keeps it
 * (so it can write its artifact JSON), and declaring MCP tools in the `.md` is all a
 * future agent needs to have them granted to its headless `claude -p` run. The list
 * is de-duplicated with the base entries kept first (stable, readable argv order).
 *
 * `declared` is `ctx.node?.tools`, already parsed from frontmatter by resolveWorkflow
 * (workflows.mjs parseFrontmatterTools). It is undefined for the clarify pre-step
 * (which runs off _phaseCtx and has no node), so callers pass it straight through and
 * get the base list back unchanged.
 *
 * @param {string[]} base       the role's default allow-list (READ_WRITE_TOOLS / IMPLEMENTER_TOOLS)
 * @param {string[]|undefined} declared  node.tools from frontmatter, may be undefined
 * @returns {string[]} de-duplicated union, base entries first
 */
export function effectiveAllowedTools(base, declared, fanOut = false) {
  const out = Array.isArray(base) ? [...base] : [];
  const seen = new Set(out);
  const add = (t) => {
    const name = String(t || '').trim();
    if (name && !seen.has(name)) { seen.add(name); out.push(name); }
  };
  for (const t of Array.isArray(declared) ? declared : []) add(t);
  // Fan-out: unlock the sub-agent tool so this agent can spawn its own sub-agents.
  // Grant BOTH names defensively: the installed `claude` CLI's sub-agent tool is
  // named `Task`; an allowed-but-nonexistent name is harmless. (Do NOT rely on the
  // orchestrator's `toolTarget` log-formatter as proof either name is honored.)
  if (fanOut) { add('Task'); add('Agent'); }
  return out;
}

/**
 * Whether this run may fan out (spawn Task/Agent sub-agents). For a DISPATCHED
 * node the decision is the node's own `fanOut` (resolved by resolveWorkflow from
 * config > role > sidecar). The clarify pre-step has NO node (it runs off
 * _phaseCtx), so it carries a context-level `fanOut` instead. A present node wins
 * so a node that opted out is never overridden. Pure + exported for testing.
 */
export function ctxFanOut(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  return !!(ctx.node ? ctx.node.fanOut : ctx.fanOut);
}

/**
 * Whether this run's EFFECTIVE model routes to a custom endpoint (an
 * ANTHROPIC_BASE_URL-overriding catalog/plugin entry). Stamped at dispatch
 * time — orchestrator._execCtx on ctx.node, workspace-scan on the node-less
 * ctx — from modelHasBaseUrlRouting(effective model), so this stays pure.
 * A present node wins, mirroring ctxFanOut. Pure + exported for testing.
 */
export function ctxEndpointRouted(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  return !!(ctx.node ? ctx.node.endpointRouted : ctx.endpointRouted);
}

/**
 * The sub-agent model policy in force for this run: one of SUBAGENT_MODEL_VALUES.
 * Read from the NODE only — nothing else carries the setting (the v1 clarify
 * pre-step ctx fallback is gone with its caller). An unset or off-vocabulary
 * value resolves to the auto default: agents choose their children's models BY
 * DEFAULT, and 'inherit' is the stored opt-out.
 *
 * GATED ON FAN-OUT: a node that cannot spawn children has no children to place,
 * so a stale setting on a node whose fan-out was turned off resolves to
 * 'inherit' and emits no prompt block — every non-fan-out prompt keeps today's
 * bytes. Pure + exported for testing.
 */
export function ctxSubagentModel(ctx) {
  if (!ctxFanOut(ctx)) return SUBAGENT_INHERIT;
  return effectiveSubagentModel(ctx && ctx.node ? ctx.node.subagentModel : undefined);
}

/**
 * The prompt wire of the sub-agent model policy — the ONLY wire. The CLI
 * resolves a child's model as Task-call `model` > the agent definition's own
 * `model:` frontmatter > env default > parent, so an omitted parameter lands
 * wherever the chosen agent definition says: both modes therefore instruct an
 * EXPLICIT `model` on every call, attributed to the operator (the Task tool's
 * own schema tells the model to set `model` only when a user asked for it, so
 * an unattributed hint would correctly be ignored).
 *
 * 'inherit' — and any value that escaped validation — contributes NOTHING, so
 * that prompt keeps the pre-feature bytes. The auto rubric keys on WHO CHECKS
 * THE OUTPUT rather than on apparent difficulty (the agent is sizing a sub-task
 * before anything has been read, and that estimate runs optimistic), and its
 * tiers describe READ-ONLY investigation — the enclosing fan-out block forbids
 * writing children. Pure + exported for testing.
 */
export function subagentModelDirective(subagentModel) {
  if (subagentModel === SUBAGENT_AUTO) {
    return (
      '### Sub-agent model — YOUR call, per spawn\n\n' +
      'The operator has asked you to choose each sub-agent\'s model deliberately: pass `model` on ' +
      'EVERY Task/Agent call — this instruction is that request (the tool\'s usual "only when ' +
      'explicitly asked" caveat is satisfied here). Never omit the parameter: an agent definition ' +
      'may pin its own default, so an omitted `model` lands wherever that definition says, not ' +
      'where you intend. Legal values: `sonnet`, `opus`, `fable`.\n\n' +
      'Choose on WHO CHECKS THE OUTPUT, never on how small or cheap the sub-task looks:\n' +
      '- `sonnet`: mechanical, bounded investigation whose findings the report itself lets you ' +
      'verify — grep-and-summarize a known pattern, enumerate usages or call sites, extract or ' +
      'reformat existing content, confirm what a file plainly states.\n' +
      '- `opus`: investigation needing real codebase judgment you will build on — trace why ' +
      'something fails, map how a subsystem hangs together, weigh where a change belongs.\n' +
      '- `fable`: analysis whose VERDICT the run depends on and nothing downstream re-checks — a ' +
      'severity call, a design or plan judgement, an accept/reject recommendation.\n\n' +
      'When unsure between two tiers, take the lower one only if you will verify the result ' +
      'yourself.\n\n'
    );
  }
  if (!SUBAGENT_MODELS.includes(subagentModel)) return '';
  return (
    `### Sub-agent model — \`${subagentModel}\`\n\n` +
    `The operator pinned this node's sub-agents to \`${subagentModel}\`: pass ` +
    `\`model: "${subagentModel}"\` on EVERY Task/Agent call — this instruction is that request ` +
    '(the tool\'s usual "only when explicitly asked" caveat is satisfied here). Never omit the ' +
    'parameter: an agent definition may pin its own default, and an omitted `model` would land ' +
    'there instead of on the pin. Do not pick any other value; split the work so it suits that ' +
    'tier.\n\n'
  );
}

/**
 * The sub-agent block for an endpoint-routed node — it REPLACES
 * subagentModelDirective for every stored value (auto, a pin, inherit): the
 * CLI's Task `model` parameter takes only the alias enum, every alias expands
 * to an Anthropic id the custom endpoint does not serve, and the omitted
 * parameter inherits the parent's wire model ONLY through an agent definition
 * that pins no `model:` frontmatter. So the one working policy is: no `model`
 * parameter, unpinned agent types. Pure + exported for testing.
 */
export function sameEndpointSubagentDirective() {
  return (
    '### Sub-agent model — same endpoint as this node (locked)\n\n' +
    'This node runs on an operator-configured custom endpoint that serves ONLY this node\'s own ' +
    'model. Alias models (`sonnet`, `opus`, `fable`, `haiku`) are NOT served there:\n' +
    '- NEVER pass a `model` parameter on any Task/Agent call. An omitted `model` lets the child ' +
    'run where you run — the only model this endpoint serves. Any alias you pass would fail the ' +
    'child at spawn.\n' +
    '- Spawn ONLY `subagent_type` values whose definition pins no `model:` frontmatter: ' +
    '`"general-purpose"` is always safe. AVOID `"Explore"` and any project/personal agent whose ' +
    'definition file sets `model:` — such a child would request the pinned model from this ' +
    'endpoint and die. When unsure what an agent pins, use `"general-purpose"` with a ' +
    'task-specific prompt.\n\n'
  );
}

// ── run-root mode gates for the §5.8 prompt variants ───────────────────────────
// EVERY Phase-4 prompt variant is gated on `runRootMode === 'detached'`; the
// workspace-specific ones are ADDITIONALLY gated on `isWorkspace` (§6 Phase 4).
// Inside phases.mjs the detached signal is `ctx.runRoot`: orchestrator._nodeCtx sets
// it to a path ONLY on a detached run and to null under legacy. Reading the CTX
// rather than re-reading WORCA_RUN_ROOT here is deliberate — the orchestrator
// consults the mode once per pipeline and a RESUMED run rides its RECORDED mode
// (§8.14), so an env flip mid-run can never make a prompt lie about the layout.

/** True on a detached run (single OR workspace). Pure; tolerates any ctx. */
function isDetachedRun(ctx) {
  return !!(ctx && ctx.runRoot);
}

/** The workspace channel's member list, or [] when this is not a workspace run. */
function wsMembers(ctx) {
  return ctx && ctx.workspace && Array.isArray(ctx.workspace.projects) ? ctx.workspace.projects : [];
}

/**
 * True only for a DETACHED WORKSPACE node: cwd is the run root and the members live
 * at `repos/<projectKey>` inside it. This is the gate for every workspace-specific
 * prompt variant (run-root task header, relative render, `git -C repos/<key>`
 * directives, §8.21's `omitProjectAgents`). Legacy workspace runs and every
 * single-project run are false, so their prompts keep today's bytes.
 */
function isDetachedWorkspace(ctx) {
  return isDetachedRun(ctx) && wsMembers(ctx).length > 0;
}

/** Render-only relative checkout path for a member (§5.8: never persisted anywhere). */
function relRepo(p) {
  return p && p.projectKey ? `repos/${p.projectKey}` : null;
}

/**
 * Fan-out-gated prompt block: when a run may fan out, tell the agent to actually
 * parallelize multi-area codebase research instead of exploring serially. Empty
 * string when off, so non-fan-out task prompts are unchanged. Pure + exported.
 *
 * `omitProjectAgents` (§8.21, passed by callers on DETACHED WORKSPACE runs only)
 * drops the project half of the `subagent_type` sentence: with cwd = `<runRoot>`
 * there is no project `.claude/agents` to discover, so promising it would make a
 * named `subagent_type` fail to resolve at Task time. `~/.claude/agents` stays
 * promised — it is inherited env and remains true. Single mode (both run-root modes)
 * and legacy workspace runs keep today's byte-identical sentence.
 */
export function fanOutDirective(fanOut, { omitProjectAgents = false, subagentModel = '', endpointRouted = false } = {}) {
  if (!fanOut) return '';
  // Endpoint-routed: the usual "prefer a purpose-built agent" steering would
  // walk the agent straight into frontmatter-pinned definitions whose model the
  // custom endpoint cannot serve — swap the sentence AND the model block.
  const subagentSentence = endpointRouted
    ? 'Use `subagent_type: "general-purpose"` for EVERY spawn unless you have verified (by reading ' +
      'its definition file) that a purpose-built agent pins no `model:` in its frontmatter — this ' +
      'node runs on a custom endpoint that serves only its own model (details in the sub-agent ' +
      'model block below).' +
      // A detached-workspace run keeps its run-root caveat: the routed steer
      // sends the agent checking definition files, and a run-root cwd cannot
      // discover member projects' agents by name in the first place.
      (omitProjectAgents
        ? ' This run starts at the worca-cc run root, so no member project\'s own agents are ' +
          'discoverable by name.'
        : '')
    : omitProjectAgents
      ? 'Pick the BEST-FIT `subagent_type`: your personal agents (`~/.claude/agents`) are available by ' +
        'name — prefer a purpose-built one when it fits the sub-task, else fall back to ' +
        '`"general-purpose"` (or `"Explore"` for pure code search). This run starts at the worca-cc run ' +
        'root, so no member project\'s own agents are discoverable by name.'
      : 'Pick the BEST-FIT `subagent_type`: this project\'s own agents (`.claude/agents`) and your personal ' +
        'agents (`~/.claude/agents`) are available by name — prefer a purpose-built one when it fits the ' +
        'sub-task, else fall back to `"general-purpose"` (or `"Explore"` for pure code search).';
  return (
    '## Fan-out ENABLED — parallelize your research\n\n' +
    'The Task/Agent tool is in your tool list this run. For any non-trivial task that spans more ' +
    'than one file or area, DISPATCH parallel read-only research sub-agents NOW — one per distinct ' +
    'area (e.g. UI vs. server vs. store vs. tests) — explore them concurrently, then synthesize their ' +
    'reports yourself. Do NOT investigate every area serially with Read/Grep when the work splits ' +
    'into independent areas.\n\n' +
    subagentSentence + '\n\n' +
    'Skills are available too: this project\'s and your personal skills (`.claude/skills`, ' +
    '`~/.claude/skills`) can be invoked via the Skill tool — by you AND by the sub-agents you spawn — ' +
    'use any that fit (e.g. design, framework-pattern, knowledge-graph) instead of guessing conventions.\n\n' +
    'Sub-agents are strictly READ-ONLY investigators: YOU write every artifact. Skip fan-out only for a ' +
    'trivial, single-file change.\n\n' +
    (endpointRouted ? sameEndpointSubagentDirective() : subagentModelDirective(subagentModel))
  );
}

/**
 * The `## Workspace Context` preamble injected into EVERY agent on a workspace run,
 * after the toolInstruction and before the role body. Pure + exported. Returns ''
 * when there is no workspace (or no description), so single-project system prompts
 * are byte-identical. The frozen description is injected VERBATIM — no length cap
 * (its size is bounded by the workspace-scanner prompt). Accepts either the bus
 * channel shape (`workspaceDescription`, see orchestrator.mjs#_workspaceChannel) or
 * a plain `description` field.
 * @param {{workspaceDescription?:string, description?:string, projects?:Array<{projectName?:string}>}|null|undefined} ws
 * @returns {string}
 */
export function workspaceContextBlock(ws) {
  const desc = String((ws && (ws.workspaceDescription ?? ws.description)) || '').trim();
  if (!desc) return '';
  const names = (ws.projects || []).map((p) => p.projectName).filter(Boolean).join(', ');
  return `## Workspace Context\n\n${desc}\n\nMember projects: ${names}.\n`;
}

/**
 * The strategy-specific fan-out directive for a workspace node. Pure + exported.
 * Each block tells the agent to spawn one read-only/owning sub-agent per unit
 * (project / plan task / touched project), merge deterministically by sorted
 * projectKey/taskId, and — the binding anti-explosion rule (§5.6) — NEVER let a
 * sub-agent re-fan-out. Returns '' when there is no workspace or the strategy is
 * unknown, so non-workspace task prompts are unchanged.
 * `relative` (§5.8, set by callers on DETACHED WORKSPACE runs only) swaps the
 * "cwd into the named worktree" routing for in-place `git -C repos/<key> …` work:
 * every member checkout is INSIDE the shared cwd (`<runRoot>`), so a sub-agent must
 * not chdir anywhere. Merge order and the anti-recursion clause are identical in
 * both variants, and the legacy text is byte-identical to today.
 * `endpointRouted` (the same dispatch stamp `fanOutDirective` reads) swaps the
 * explore arm's `Explore` steering for a `general-purpose` investigator, so a
 * routed node is never ordered into a model-pinned agent one paragraph after
 * the same-endpoint block forbade it; legacy/default bytes are unchanged.
 * @param {'explore'|'task'|'review'} strategy
 * @param {{projects?:Array<{projectName?:string,projectKey?:string}>}|null|undefined} ws
 * @param {{relative?:boolean, endpointRouted?:boolean}} [opts]
 * @returns {string}
 */
export function workspaceFanOutDirective(strategy, ws, { relative = false, endpointRouted = false } = {}) {
  if (!ws) return '';
  const ANTI_RECURSION =
    'Sub-agents are strictly single-level: a sub-agent MUST NOT re-fan-out ' +
    '(it must never spawn its own Task/Agent sub-agents). YOU synthesize every ' +
    'merged artifact yourself.\n\n';
  if (strategy === 'explore') {
    return (
      '## Workspace fan-out — explore across member projects\n\n' +
      // Endpoint-routed: `Explore` pins a model the custom endpoint cannot serve —
      // the same swap the generic fan-out block makes (sameEndpointSubagentDirective).
      (endpointRouted
        ? 'Dispatch ONE read-only `general-purpose` investigator per member project (cap 8) to survey '
        : 'Dispatch ONE read-only Explore sub-agent per member project (cap 8) to survey ') +
      (relative
        ? 'its checkout at `./repos/<projectKey>` inside the shared cwd (modules, public ' +
          'API, deps) — read files there directly and use `git -C repos/<projectKey> …` ' +
          'for history — and return a brief. '
        : 'its worktree (modules, public API, deps) and return a brief. ') +
      'Then write the ' +
      'SINGLE unified plan yourself, with findings under per-project headings and ' +
      'every plan TASK tagged `Projects: <projectKey>[, ...]` for the project(s) it ' +
      'touches. Merge the briefs in sorted `projectKey` order (never completion ' +
      'order). ' + ANTI_RECURSION
    );
  }
  if (strategy === 'task') {
    return (
      '## Workspace fan-out — one sub-agent per plan task\n\n' +
      'Read the plan\'s `## Tasks`; dispatch ONE implementer sub-agent per task ' +
      '(cap 8, `subagent_type:"general-purpose"`), each editing ONLY the worktree(s) ' +
      (relative
        ? 'of the project(s) named in that task\'s `Projects:` tag — operate in ' +
          '`./repos/<projectKey>` (edit files there and run git as ' +
          '`git -C repos/<projectKey> …`; NEVER chdir out of the run root). '
        : 'of the project(s) named in that task\'s `Projects:` tag (cwd into the named ' +
          'worktree). ') +
      'Do NOT edit any project not named by a task. Schedule two tasks ' +
      'that touch the SAME project sequentially (no overlapping ownership in a wave). ' +
      'Merge results in plan-task (`taskId`) order. ' + ANTI_RECURSION
    );
  }
  if (strategy === 'review') {
    return (
      '## Workspace fan-out — one reviewer per touched project\n\n' +
      'Dispatch ONE reviewer sub-agent per TOUCHED member project (cap 8) — skip a ' +
      'project whose diff against its checkpoint is empty. Each sub-agent reviews its ' +
      (relative
        ? 'project\'s diff with `git -C repos/<projectKey> diff <checkpointRef>` (the ' +
          'refs are listed in `## Workspace projects` above) against the plan and ' +
          'reports issues. '
        : 'project\'s `checkpointRef...feature` diff against the plan and reports issues. ') +
      'Then YOU synthesize ONE review markdown + ONE verdict JSON: the UNION of every ' +
      'critical/major issue (never collapse or drop one), sorted by `projectKey` then ' +
      'severity, each issue location prefixed with `"<projectKey>: "`. ' + ANTI_RECURSION
    );
  }
  return '';
}


/**
 * Build the full appended system prompt: toolInstruction first (if any), then — on
 * a workspace run — the `## Workspace Context` block, then the agent body (or a
 * sensible inline fallback when the body is missing/empty). The optional 4th
 * `workspace` arg is the read-only workspace metadata; absent it,
 * workspaceContextBlock returns '' and the prompt is byte-identical to today's
 * single-project prompt. Exported for testing.
 */
export function buildSystemPrompt(toolInstruction, agentBody, role, workspace) {
  const parts = [];
  const tool = (toolInstruction || '').trim();
  if (tool) parts.push(tool);
  const ws = workspaceContextBlock(workspace); // '' when not a workspace run
  if (ws) parts.push(ws);
  const body = (agentBody || '').trim();
  // The agent's .md body IS the contract (spec §1: the engine is generic). The v1
  // per-role FALLBACK_PROMPTS table died with the v1 engine; a missing body now
  // yields a body-less system prompt rather than a hard-coded role script.
  parts.push(body || '');
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Resolve the agent .md body for a runner: the node's own resolved `agentPrompt`
 * (stamped by resolveWorkflow from its meta.agentFile — built-in OR user layer)
 * wins; the orchestrator's bulk-loaded ctx.agentPrompts[key] is the fallback (the
 * clarify pre-step and direct-unit ctxs have no node); FALLBACK_PROMPTS[role]
 * backstops inside buildSystemPrompt. Single resolution path for EVERY runner —
 * this is what fixes the decomposer's empty system prompt (agentPrompts never
 * carried a `decomposer` key and FALLBACK_PROMPTS has no `decomposer` role).
 * Exported for testing.
 */
export function resolveAgentBody(ctx, key) {
  const nodeBody = typeof ctx?.node?.agentPrompt === 'string' ? ctx.node.agentPrompt.trim() : '';
  if (nodeBody) return ctx.node.agentPrompt;
  return ctx?.agentPrompts?.[key];
}

/** Render the MOCK marker block appended to every task prompt. */
export function mockMarkers(fields) {
  const lines = [];
  for (const [key, val] of Object.entries(fields)) {
    if (val === undefined || val === null || val === '') continue;
    lines.push(`${key}: ${val}`);
  }
  return lines.join('\n');
}

/** Prepended to the task prompt when a node re-attaches to an interrupted session. */
export const RESUME_HEADER =
  '## Resumed session\n\n' +
  'You were interrupted mid-task and this session has been resumed. First verify the\n' +
  'state of your previous work (files/artifacts you already wrote), then continue the\n' +
  'ORIGINAL task below to completion. Do not redo work that is already done.\n\n';

/**
 * Ask-then-resume prompt block for a questions-enabled node (spec 2026-07-11).
 * Appended by runOpts, so EVERY producer/verifier runner inherits it with no
 * per-runner edits. ctx fields (set by the orchestrator per attempt):
 *   questionsEnabled  gate (node.askQuestions minus clarifier/decomposed/auto)
 *   questionsFile     absolute path for THIS round's questions JSON; null when
 *                     rounds are exhausted (closing note instead of directive)
 *   questionsAnswered [{id,question,choice}] already answered for this node
 * MOCK_ASK is emitted only on the first round (no prior answers) so the offline
 * mock asks exactly once, then performs its normal role side effects on resume.
 * Pure + exported for testing; returns '' when disabled (prompts byte-identical).
 */
export function questionsPromptBlock(ctx) {
  if (!ctx || !ctx.questionsEnabled) return '';
  const prior = Array.isArray(ctx.questionsAnswered) ? ctx.questionsAnswered : [];
  const answered = prior.length
    ? '## Already answered — DO NOT ask these again\n\n' + renderAnswers(prior) + '\n'
    : '';
  if (!ctx.questionsFile) {
    return (
      '\n\n' + answered +
      '## Asking the user\n\n' +
      'No more question rounds are available this run — proceed with reasonable assumptions.\n'
    );
  }
  const mock = prior.length ? '' : mockMarkers({ MOCK_ASK: ctx.questionsFile }) + '\n';
  return (
    '\n\n' + answered +
    '## Asking the user (enabled)\n\n' +
    'If a decision materially shapes the outcome and you cannot resolve it from the task, ' +
    'the inputs, or the codebase — including anything material you are about to silently ' +
    'assume:\n' +
    '1. Write {"questions":[{"id","question","options":[2-4 strings],"allowFreeText":true}]} ' +
    `(max 8 questions) to: ${ctx.questionsFile}\n` +
    '2. STOP immediately — do no further work. You will be resumed with the answers.\n' +
    'Assume freely on minor choices; on material ones, ask instead of assuming. Never pad, ' +
    'and never re-ask an answered question.\n\n' +
    mock
  );
}

/**
 * §8.10 mock write targets: every member's ABSOLUTE worktree dir on a DETACHED
 * WORKSPACE run, `[]` otherwise. The offline mock implementer writes `src/` +
 * `test/` into each entry instead of into its cwd, which under detached is the run
 * root — a directory that is no repo, so member checkouts would stay clean, nothing
 * would be committed, and the concatenated patch would be empty.
 *
 * The `ctx.runRoot` gate is LOAD-BEARING, not decoration: `ctx.runRoot` is non-null
 * only on detached runs, and without the gate a LEGACY workspace mock run would
 * start writing into every member worktree instead of only its cwd (the primary's
 * worktree) — a behavior change on the exact path §10's rollback contract promises
 * is byte-identical. Paths stay absolute on purpose (§5.8 keeps the bus channel
 * absolute for exactly this kind of consumer). Pure + exported for testing.
 */
export function workspaceWriteTargetsFor(ctx) {
  if (!ctx || !ctx.runRoot) return [];
  return (ctx.workspace?.projects || []).map((p) => p.worktreeDir).filter(Boolean);
}

/** Map the orchestrator's claudeOpts into runClaude options shared by every role. */
export function runOpts(ctx, { role, prompt, systemPrompt, allowedTools }) {
  const c = ctx.claudeOpts || {};
  return {
    cwd: ctx.projectDir,
    systemPrompt,
    prompt: (ctx.resumeSessionId ? RESUME_HEADER + prompt : prompt) + questionsPromptBlock(ctx),
    resumeSessionId: ctx.resumeSessionId,
    // Grant the role's baseline tools PLUS whatever the agent declared in its
    // frontmatter (e.g. the Playwright MCP browser_* tools). ctx.node is present
    // for every dispatched node (orchestrator._nodeCtx); the clarify pre-step has
    // no node, so this falls back to the base list. Fixes "Browser permission not
    // granted" for the Manual Web UI Testing agent and makes future MCP agents work.
    allowedTools: effectiveAllowedTools(allowedTools, ctx.node?.tools, ctxFanOut(ctx)),
    // §5.5/§5.3 detached-run context: the generated merged MCP config and one
    // `mcp__<server>` grant per merged server. Both are undefined/[] on legacy runs,
    // so the argv is byte-identical there. The grants are unioned inside the runner
    // rather than here, which keeps effectiveAllowedTools' frontmatter semantics
    // intact (a grant is not a declared tool).
    mcpConfigPath: ctx.mcpConfigPath,
    mcpServerGrants: ctx.mcpServerGrants,
    // §8.10: offline-mock write targets. [] on legacy runs and on every single-project
    // run, where the mock keeps writing at its cwd exactly as today. Ignored entirely
    // by the real runner (it is never a spawn flag).
    workspaceWriteTargets: workspaceWriteTargetsFor(ctx),
    permissionMode: c.permissionMode || 'acceptEdits',
    model: c.model,
    effort: c.effort,          // per-role effort from the orchestrator
    // Per-model routing env (design §4.4), resolved HERE — the one funnel every
    // dispatched node/role passes through — so _phaseCtx/_nodeCtx and the
    // workspace-scan path all inherit it without per-caller edits. undefined
    // when the model carries no env (or no model is set), keeping the spawn
    // env byte-identical. The sub-agent model policy deliberately does NOT
    // touch this env: its only wire is the prompt block (subagentModelDirective),
    // and CLAUDE_CODE_SUBAGENT_MODEL is a reserved model-env key.
    modelEnv: resolveModelEnv(c.model),
    // Guardrails: worca policy + lifted repo deny rules as {deny,...} rules ->
    // ONE --settings payload; envScrub/envAllowlist -> spawn env. All undefined
    // when the project has no guardrails, so the argv and env stay byte-identical
    // (the runner treats undefined as "absent").
    permissionRules: c.permissionRules,
    envScrub: c.envScrub,
    envAllowlist: c.envAllowlist,
    bin: c.bin,
    mock: c.mock,
    signal: ctx.signal,
    onEvent: (e) => {
      if (typeof ctx.onEvent === 'function') ctx.onEvent({ ...e, role });
    },
  };
}

export const _runOptsForTests = runOpts;

/** A compact task header reused across roles. Exported for testing. */
export function taskHeader(ctx, title) {
  // Who gets the raw request + attachments? The ENTRY node (step 0) always, PLUS any
  // userPrompt consumer (so the planner keeps the user's attachments even though Clarify
  // is now the entry). Refiner/reviewer/planReviewer get the request text by policy but
  // work off upstream artifacts, not attachments.
  const key = ctx.node?.key;
  const isEntry = !!ctx.isEntry;
  const consumesPrompt = !ctx.inputs || ('userPrompt' in ctx.inputs);
  const wantsPrompt = isEntry || consumesPrompt || key === 'refiner' || key === 'reviewer' || key === 'planReviewer';
  const requestBlock = wantsPrompt
    ? `## Original request\n\n${(ctx.taskPrompt || '').trim() || '(no prompt text)'}\n`
    : `## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to read are named below.\n`;
  const attachBlock = (isEntry || consumesPrompt) ? renderAttachmentsBlock(ctx.extras) : '';
  const detached = isDetachedRun(ctx);
  const wsRun = isDetachedWorkspace(ctx);
  // §5.8: workspace mode names the RUN ROOT as cwd and the members as ./repos/<key>;
  // single mode (in BOTH run-root modes) keeps today's line byte-identical, because
  // its cwd really is that project's own checkout.
  const locationLine = wsRun
    ? `Run root (your cwd): ${ctx.runRoot}\n` +
      `Member projects: ${wsMembers(ctx)
        .map((p) => `./${relRepo(p) || p.worktreeDir} (${p.projectName || p.projectKey})`)
        .join(', ')}\n` +
      `You are in no single project: the cwd is a worca-cc run root that belongs to no member, ` +
      `and ALL code work happens inside the listed member worktrees.\n`
    : `Project directory (your cwd): ${ctx.projectDir}\n`;
  // Skills hint. The detached sentence is truthful ONLY under detached, where
  // project + root skills are COPIED into `<cwd>/.claude/skills` for the run (§5.7);
  // legacy delivers neither (skills.mjs copies bundle/plugin entries only), so the
  // legacy sentence stays exactly as today.
  const skillsHint = detached
    ? `Project and root skills are mounted at .claude/skills for this run (in addition to your ` +
      `personal ~/.claude/skills) and are available via the Skill tool — invoke any that fit ` +
      `(e.g. design, framework-pattern, or knowledge-graph skills) rather than guessing ` +
      `conventions.\n\n`
    : `Project and personal skills (.claude/skills in this project and ~/.claude/skills) are ` +
      `available via the Skill tool — invoke any that fit (e.g. design, framework-pattern, or ` +
      `knowledge-graph skills) rather than guessing conventions.\n\n`;
  return (
    `# Task: ${title}\n\n` +
    locationLine +
    `Pipeline directory (shared artifacts): ${ctx.pipelineDir}\n\n` +
    skillsHint +
    workspaceProjectsBlock(ctx.workspace, { relative: wsRun }) +
    requestBlock +
    attachBlock
  );
}

/**
 * On a workspace run, a `## Workspace projects` block listing each member's
 * checkout and checkpoint ref (its diff base), so the driving agent knows where to
 * work and what to diff against. Returns '' when there is no workspace, so
 * single-project task headers are byte-identical.
 *
 * `relative` (detached workspace runs only, §5.8) renders each checkout as
 * `repos/<projectKey>` — a RENDER-TIME token: the bus channel and
 * `state.branches[*].worktreeDir` stay ABSOLUTE (resume rehydrates member worktrees
 * from them, so a relative path there would hard-fail every workspace resume). It
 * also adds each member's graph location, because the scalar graph instruction is
 * meaningless at a non-repo cwd. Legacy keeps today's absolute render + cwd-into
 * wording.
 * @param {{projects?:Array<{projectKey?,projectName?,worktreeDir?,checkpointRef?,graphInstruction?}>}|null|undefined} ws
 * @param {{relative?:boolean}} [opts]
 */
function workspaceProjectsBlock(ws, { relative = false } = {}) {
  const projects = ws && Array.isArray(ws.projects) ? ws.projects : [];
  if (projects.length === 0) return '';
  const lines = projects.map((p) => {
    const rel = relRepo(p);
    // The `(pending)` tolerance is kept: before worktrees exist there is no dir, and
    // a member with no projectKey cannot be relativized either.
    const where = (relative && rel) || p.worktreeDir || '(pending)';
    const graph = relative && rel && String(p.graphInstruction || '').trim()
      ? `, graph \`${rel}/graphify-out/\`` : '';
    return `- **${p.projectName || p.projectKey}** (\`${p.projectKey}\`): worktree \`${where}\`` +
      `, diff base \`${p.checkpointRef || '(none)'}\`${graph}`;
  });
  const intro = relative
    ? `This run spans the member projects below, each checked out INSIDE your cwd. Work in ` +
      `a member in place — edit \`repos/<key>/…\` and run git as \`git -C repos/<key> …\` ` +
      `(never chdir out of the run root) — and diff it against that project's checkpoint:`
    : `This run spans the member projects below. A fan-out sub-agent cwds into the ` +
      `named worktree and diffs against that project's checkpoint:`;
  return (
    `## Workspace projects\n\n` +
    intro + `\n\n` +
    lines.join('\n') +
    `\n\n`
  );
}

/**
 * Per-member diff hints for a DETACHED WORKSPACE node, '' otherwise (single mode in
 * both run-root modes, and legacy workspace runs, keep today's cwd-scoped wording).
 * At a run-root cwd there is no working tree to `git diff` and the scalar
 * `ctx.checkpointRef` is meaningless, so every consumer that used to say "via `git
 * diff` in your cwd" renders these lines instead (§5.8). Pure + exported.
 */
export function workspaceDiffInstruction(ctx) {
  if (!isDetachedWorkspace(ctx)) return '';
  return wsMembers(ctx)
    .map((p) => `- **${p.projectName || p.projectKey}**: \`git -C ${relRepo(p)} diff ` +
      `${p.checkpointRef || 'HEAD'}\``)
    .join('\n');
}

/**
 * Build the clarify task prompt. When the user has already answered questions in
 * an earlier round, those are injected so the planner never re-asks them.
 * Exported for testing. Pure (no IO).
 * @param {import('./phases.mjs').PhaseContext} ctx
 * @param {{ round?: number, priorAnswers?: Array<{id,question,choice}> }} [opts]
 */
export function buildClarifyPrompt(ctx, opts = {}) {
  const round = Number(opts.round) > 0 ? Number(opts.round) : 1;
  const priorAnswers = Array.isArray(opts.priorAnswers) ? opts.priorAnswers : [];
  const outPath = joinPipeline(ctx.pipelineDir, 'clarify.json');
  const role = 'clarify';
  const answered =
    priorAnswers.length > 0
      ? '## Already answered — DO NOT ask these again\n\n' +
        'The user already answered the questions below in an earlier round. Do NOT re-ask, ' +
        'rephrase, or split them. Ask ONLY genuinely new questions that are still material and ' +
        'not implied by these answers. If nothing material remains open, write ' +
        '{ "questions": [] } to the path below.\n\n' +
        renderAnswers(priorAnswers) +
        '\n'
      : '';
  return (
    taskHeader(ctx, 'Clarify before planning') +
    '\n## What to do\n\n' +
    'Identify the decisions you cannot safely resolve from the task text or the real ' +
    'codebase — including things a downstream agent (planner/implementer) would otherwise ' +
    'silently assume. For each, produce one conceptual question with 2 to 4 options and a ' +
    'free-text fallback. Ask only what materially changes the plan (up to 8 questions); never ' +
    'pad, and never split one decision. For low-impact details, pick a sensible default rather ' +
    'than asking. If you have no material open questions, write { "questions": [] } to that ' +
    'same path.\n\n' +
    fanOutDirective(ctxFanOut(ctx), { omitProjectAgents: isDetachedWorkspace(ctx), subagentModel: ctxSubagentModel(ctx), endpointRouted: ctxEndpointRouted(ctx) }) +
    `Write the clarify JSON to: ${outPath}\n\n` +
    answered +
    mockMarkers({
      MOCK_ROLE: role,
      MOCK_OUT: outPath,
      MOCK_CYCLE: round,
      MOCK_PRIOR: priorAnswers.length,
    })
  );
}

/**
 * The shared-working-tree warning for a decomposed task that runs alongside phase
 * siblings. Parallel implementers share ONE tree with no locking, so the block
 * pins down the only safe behaviors: own files only, scoped tests, no tree-wide
 * git ops. Empty string when there are no siblings (solo task in its phase).
 * @param {Array<{id:string,title?:string,file?:string}>|undefined} siblings
 */
export function siblingsBlock(siblings) {
  if (!Array.isArray(siblings) || !siblings.length) return '';
  const lines = siblings
    .map((s) => `- ${s.id}${s.title ? ` "${s.title}"` : ''}${s.file ? ` (${s.file})` : ''}`)
    .join('\n');
  return (
    `\n## Parallel siblings — shared working tree\n\n` +
    `${siblings.length} other implementer(s) are editing THIS SAME working tree right now, each on its own task:\n` +
    `${lines}\n\n` +
    `Hard rules:\n` +
    `1. Edit ONLY the files your TASK file lists. If you need another file, DO NOT touch it — record a deviation and stop that step.\n` +
    `2. Run tests SCOPED to your slice (the TASK file's verify command or your own test files). Do NOT run the full suite — siblings' in-progress red tests make it nondeterministic. Full-suite verification happens after the phase.\n` +
    `3. A failure in a file you do not own is a sibling's work in progress. Ignore it. Never edit or "fix" a sibling's file.\n` +
    `4. No tree-wide git operations: no stash, no checkout --, no reset, no clean, no add, no commit.\n`
  );
}

/**
 * Build the implementer task body. Pure (exported for tests). When `taskPath` is
 * present (a decomposed run), the self-contained task file is authoritative and the
 * plan is reference/context only — the implementer no longer reads the whole plan;
 * `siblings` (the OTHER tasks of the same phase) appends the shared-tree rules.
 * Absent a taskPath, behavior is byte-identical to today (plan is authoritative)
 * and siblings are ignored, as they are in fix mode (the fix pass is always solo).
 * @param {{ mode:'implement'|'fix', planPath:string, reviewPath?:string, taskPath?:string, siblings?:Array<{id:string,title?:string,file?:string}> }} o
 */
export function implementerBody({ mode = 'implement', planPath, reviewPath, taskPath, siblings } = {}) {
  if (mode === 'fix') {
    // VERBATIM from the original phases.mjs fix-mode body.
    return (
      `Address EVERY critical and major issue in the review below, then re-run the tests. ` +
      `Follow the plan; deviate only if something does not work at all.\n\n` +
      `Plan: ${planPath}\n` +
      `Review to fix: ${reviewPath}\n`
    );
  }
  if (taskPath) {
    return (
      `Implement the task below using TDD (red-green-refactor). The TASK file is a ` +
      `self-contained vertical slice and is AUTHORITATIVE — do exactly what it says and ` +
      `nothing outside its scope. The plan is reference/context only; you do NOT need to ` +
      `read the whole plan.\n\n` +
      `TASK (authoritative, self-contained): ${taskPath}\n` +
      `Plan (reference only): ${planPath}\n` +
      siblingsBlock(siblings)
    );
  }
  // VERBATIM from the original phases.mjs implement-mode body.
  return (
    `Implement the plan using TDD (red-green-refactor). Follow it with NO deviation; ` +
    `deviate slightly only if a step does not work at all.\n\n` +
    `Plan: ${planPath}\n`
  );
}

/**
 * The reviewer's diff instruction — extracted VERBATIM from runReviewer so the v2
 * executor's `as: 'worktree'` renderer resolves to the same bytes. Prefer diffing
 * against the recorded checkpoint commit: new files are made visible via the
 * orchestrator's intent-to-add staging after each implement pass, so
 * `git diff <ref>` and `git status` both show greenfield work. Pure + exported.
 * @param {{checkpointRef?:string}} [ctx]
 * @returns {string}
 */
export function diffInstruction(ctx) {
  const ref = String(ctx?.checkpointRef || '').trim();
  return ref
    ? `Inspect the diff with \`git diff ${ref}\` (the orchestrator's pre-implementation ` +
      `checkpoint) and \`git status\` in your cwd. New/untracked files are intent-to-added, ` +
      `so they DO appear in that diff; use \`git status\` to cross-check.`
    : 'Inspect the diff with `git diff` and `git status` in your cwd. If `git diff` looks ' +
      'empty, the changes may be newly-created files — confirm with `git status` and ' +
      '`git diff HEAD`.';
}

/**
 * Workspace Scan — off-pipeline producer (NOT a workflow node, NOT routed through
 * runners.mjs). The wizard's scan engine (M5: workspace-scan.mjs) calls this
 * directly to investigate cross-project relations and write the editable
 * interconnection description. It IS the scanner, so it gets NO `## Workspace
 * Context` block injected (4th buildSystemPrompt arg is undefined). The task prompt
 * names every member + its graph path, carries the scan fan-out directive and the
 * §5.8 description template, and emits an `INVESTIGATING <key> relations to <other>`
 * line per investigation so the server's scan-event mapper turns those into the
 * CHANGING live status (structured `phase` is owned by the engine, not the agent).
 * Writes ONE markdown string to `pipelineDir/workspace-description.md` (or
 * opts.outPath) and returns it. Mockable via MOCK_ROLE 'workspace-scan'.
 * @param {import('./phases.mjs').PhaseContext} ctx  ctx.projects = sorted members
 * @param {{ outPath?: string, name?: string }} [opts]
 * @returns {Promise<{ description: string, outPath: string }>}
 */
export async function runWorkspaceScan(ctx, opts = {}) {
  const role = 'workspace-scanner'; // prompt-role string (FALLBACK lookup only); MOCK_ROLE differs (C3)
  const projects = Array.isArray(ctx.projects) ? ctx.projects : [];
  const name = opts.name || ctx.workspaceName || 'Workspace';
  const outPath = opts.outPath || joinPipeline(ctx.pipelineDir, 'workspace-description.md');
  // The scanner IS the source of the workspace description, so it does NOT receive
  // an injected workspace block (4th arg undefined). The body is the contract (C10).
  const systemPrompt = buildSystemPrompt(ctx.toolInstruction, resolveAgentBody(ctx, 'workspaceScanner'), role, undefined);

  const memberLines = projects.map((p) =>
    `- **${p.projectName || p.projectKey}** (\`${p.projectKey}\`): investigate \`${p.scanDir || p.projectDir}\`` +
    `${p.graphify ? ' (graphify-out/ available)' : ''}`,
  ).join('\n');

  const prompt =
    `# Task: Scan workspace interconnections — ${name}\n\n` +
    `Pipeline directory (shared artifacts): ${ctx.pipelineDir}\n\n` +
    `## Member projects to investigate\n\n${memberLines || '(no members)'}\n\n` +
    '## What to do\n\n' +
    'Discover how these projects interconnect (REST APIs, shared DB/migrations, build deps, ' +
    'message/queue, shared libs) and write ONE editable interconnection description.\n\n' +
    // scan-fanout: one read-only investigator per project (cap 8). NO omitProjectAgents:
    // the scanner is OFF-pipeline (it runs before any run root exists, with cwd inside a
    // member's real dir), so its project `.claude/agents` really are discoverable (§8.21
    // covers run-root cwds only).
    fanOutDirective(true, { endpointRouted: ctxEndpointRouted(ctx) }) +
    'Dispatch ONE read-only investigator per member project (cap 8); merge their reports in sorted ' +
    '`projectKey` order and synthesize the single description yourself. Investigators MUST NOT ' +
    're-fan-out.\n\n' +
    'Announce each investigation with a line `INVESTIGATING <projectKey> relations to <otherKey>` ' +
    'and the merge with `SYNTHESIZING workspace description`.\n\n' +
    '## Description template (write EXACTLY these sections)\n\n' +
    '```\n' +
    `# Workspace: ${name}\n` +
    '## Overview\n<2-4 sentences: the project set + dominant integration theme>\n' +
    '## Projects\n- <projectName>: <one-line role>\n' +
    '## Interconnections\n- <A> -> <B>: <REST API | shared DB / migration | build dep | message/queue | shared lib>; <detail>\n' +
    '## Change-coordination notes\n- <coordination note>\n' +
    '## Suggested change order\n<topological hint, else "no strict ordering">\n' +
    '```\n\n' +
    `Write the interconnection description markdown to: ${outPath}\n\n` +
    mockMarkers({
      MOCK_ROLE: 'workspace-scan', // C3: scanner MOCK marker is workspace-scan (NOT the prompt-role)
      MOCK_OUT: outPath,
      MOCK_BASE: name,
    });

  const { text } = await runClaude(
    runOpts(ctx, { role, prompt, systemPrompt, allowedTools: READ_WRITE_TOOLS }),
  );

  // The written file is the authoritative description; read it back so callers
  // (the M5 scan engine) get the produced text. Dynamic import keeps the static
  // import surface focused (mirrors the orchestrator's dynamic protocol import).
  let description = '';
  try {
    const { readFile } = await import('node:fs/promises');
    description = await readFile(outPath, 'utf8');
  } catch {
    description = (text || '').trim();
  }
  return { description, outPath };
}

// ── generic runners (metadata-declared agents, zero bespoke core code) ──────────

/**
 * Pure: render the generic `## Inputs` / `## Outputs` blocks from the node's
 * typed channel handles (allocate()/bindInputs() output). userPrompt is skipped
 * (the task header already carries the request); the worktree channel renders an
 * inspect hint instead of a path. Exported for testing.
 */
export function genericIoBlock(inputs = {}, outputs = {}) {
  const inLines = [];
  for (const [c, h] of Object.entries(inputs || {})) {
    if (!h || c === 'userPrompt') continue;
    const p = h.path || h.mdPath
      || (h.kind === 'worktree' ? '(the working tree — inspect with `git diff` / `git status` in your cwd)' : null)
      // Detached workspace runs: cwd is the run root, so there is no single working
      // tree to inspect and the scalar checkpoint ref is meaningless — name every
      // member checkout WITH ITS OWN diff base (§5.8). The `runroot` kind is emitted
      // only when (detached && isWorkspace) (orchestrator._ioBus), so this branch is
      // mode-gated at the source.
      || (h.kind === 'runroot'
        ? `(the member checkouts under your cwd — inspect each with \`git -C repos/<key> diff <base>\`: ${
            (h.repos || [])
              .map((r) => `${r.relDir || `repos/${r.projectKey}`} (diff base ${r.checkpointRef || 'HEAD'})`)
              .join(', ') || 'no members'})`
        : null);
    if (p) inLines.push(`- ${c}: ${p}`);
  }
  const outLines = [];
  for (const [c, h] of Object.entries(outputs || {})) {
    if (!h) continue;
    if (h.kind === 'review') {
      if (h.mdPath) outLines.push(`- Write the ${c} markdown (human-readable review) to: ${h.mdPath}`);
      if (h.jsonPath) outLines.push(`- Write the ${c} JSON (machine-readable verdict) to: ${h.jsonPath}`);
    } else if (h.path) {
      outLines.push(`- Write ${c} to: ${h.path}`);
    }
  }
  return (
    '## Inputs\n\n' +
    (inLines.length ? inLines.join('\n') : '- (none — work from the request above)') +
    '\n\n## Outputs\n\n' +
    (outLines.length ? outLines.join('\n') : '- (none — report your findings as your final message)') +
    '\n\n'
  );
}

// ── small local helpers ────────────────────────────────────────────────────────

/** Join a file name onto the pipeline dir without importing node:path's full surface. */
function joinPipeline(pipelineDir, name) {
  // Native separator: this builds a real filesystem path (writeFile targets and
  // paths compared with join()-built values elsewhere). A hardcoded '/' produced
  // a mixed-separator path on Windows; on POSIX join() is byte-identical to the
  // old '/' form, so no non-Windows behaviour changes.
  return join(String(pipelineDir || '').replace(/[\\/]+$/, ''), name);
}

/** Render the answered clarifications as a markdown Q&A list for the plan prompt. */
export function renderAnswers(answers) {
  if (!Array.isArray(answers) || answers.length === 0) {
    return '_No clarifying questions were asked._\n';
  }
  return (
    answers
      .map((a) => `- **Q:** ${String(a.question || '').trim()} — **A:** ${String(a.choice || '').trim()}`)
      .join('\n') + '\n'
  );
}

/**
 * Render the `## Attached files` block listing each attachment by path + name.
 * Single source of truth shared by renderPromptArtifact (the seeded file body) and
 * phases.mjs taskHeader (the entry agent's inline header) so the two cannot drift.
 * Returns '' when there are no attachments.
 * @param {Array<{name:string,path:string}>} [extras]
 */
export function renderAttachmentsBlock(extras = []) {
  if (!Array.isArray(extras) || extras.length === 0) return '';
  return (
    `\n## Attached files\n\nThe user attached these files; read any that are relevant:\n\n` +
    extras.map((e) => `- \`${e.path}\` (${e.name})`).join('\n') +
    '\n'
  );
}

/**
 * Render the markdown a seeded artifact channel holds: the user's request stands in
 * for the missing upstream artifact, with any attached files listed by path.
 * @param {string} promptText
 * @param {Array<{name:string,path:string}>} [extras]
 */
export function renderPromptArtifact(promptText, extras = []) {
  const body = (promptText || '').trim() || '(no prompt text)';
  return (
    `# Task (from the user prompt)\n\n` +
    `No upstream agent produced this artifact, so the user's request below stands in for it.\n\n` +
    `## Original request\n\n${body}\n` +
    renderAttachmentsBlock(extras)
  );
}

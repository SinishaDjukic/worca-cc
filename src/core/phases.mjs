// src/core/phases.mjs
//
// The PROMPT LIBRARY of the pipeline. The per-role runners this file used to hold
// died with the v1 dispatcher: the graph engine has ONE generic agent executor
// (graph/executor.mjs) that assembles its prompts from these pieces plus the
// node's declared ports. What lives here is everything that is genuinely shared
// and genuinely prompt-shaped:
//
//   - taskHeader / workspace blocks / fan-out directives / questionsPromptBlock,
//   - buildSystemPrompt + resolveAgentBody (the agent .md body is the contract;
//     an empty body falls back to ONE generic last-resort line),
//   - mockMarkers + RESUME_HEADER + runOpts (the runClaude adapter),
//   - renderAttachmentsBlock / renderPromptArtifact, the task-document renderers
//     the Task card and the entry agents share,
//   - runWorkspaceScan, the ONE off-pipeline agent runner (it is not a workflow
//     node: the workspace wizard calls it directly, before any run exists).

import { runClaude } from './claude-runner.mjs';

// ── allowedTools per role ──────────────────────────────────────────────────────
// `Skill` lets agents invoke project (.claude/skills) and personal (~/.claude/skills)
// skills via the Skill tool; without it, headless `claude -p` denies skill calls.
const READ_WRITE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill'];

/**
 * Effective `--allowedTools` for a node: the role's baseline file/exec tools UNION
 * the agent's frontmatter-declared tools (e.g. the Playwright MCP `browser_*` tools).
 *
 * Frontmatter only ADDS to the baseline — an agent that omits Write still keeps it
 * (so it can write its artifact JSON), and declaring MCP tools in the `.md` is all a
 * future agent needs to have them granted to its headless `claude -p` run. The list
 * is de-duplicated with the base entries kept first (stable, readable argv order).
 *
 * `declared` is `ctx.node?.tools`, already parsed from frontmatter by resolveGraph
 * (workflows.mjs parseFrontmatterTools). It is undefined for the clarify pre-step
 * (which runs off _phaseCtx and has no node), so callers pass it straight through and
 * get the base list back unchanged.
 *
 * @param {string[]} base       the role's default allow-list (read/write or code tools)
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
 * node the decision is the node's own `fanOut` (resolved by resolveGraph from
 * config > role > sidecar). The clarify pre-step has NO node (it runs off
 * _phaseCtx), so it carries a context-level `fanOut` instead. A present node wins
 * so a node that opted out is never overridden. Pure + exported for testing.
 */
export function ctxFanOut(ctx) {
  if (!ctx || typeof ctx !== 'object') return false;
  return !!(ctx.node ? ctx.node.fanOut : ctx.fanOut);
}

// ── run-root mode gates for the §5.8 prompt variants ───────────────────────────
// EVERY Phase-4 prompt variant is gated on `runRootMode === 'detached'`; the
// workspace-specific ones are ADDITIONALLY gated on `isWorkspace` (§6 Phase 4).
// Inside phases.mjs the detached signal is `ctx.runRoot`: orchestrator._execCtx sets
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
export function fanOutDirective(fanOut, { omitProjectAgents = false } = {}) {
  if (!fanOut) return '';
  const subagentSentence = omitProjectAgents
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
    'trivial, single-file change.\n\n'
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
 * @param {'explore'|'task'|'review'} strategy
 * @param {{projects?:Array<{projectName?:string,projectKey?:string}>}|null|undefined} ws
 * @param {{relative?:boolean}} [opts]
 * @returns {string}
 */
export function workspaceFanOutDirective(strategy, ws, { relative = false } = {}) {
  if (!ws) return '';
  const ANTI_RECURSION =
    'Sub-agents are strictly single-level: a sub-agent MUST NOT re-fan-out ' +
    '(it must never spawn its own Task/Agent sub-agents). YOU synthesize every ' +
    'merged artifact yourself.\n\n';
  if (strategy === 'explore') {
    return (
      '## Workspace fan-out — explore across member projects\n\n' +
      'Dispatch ONE read-only Explore sub-agent per member project (cap 8) to survey ' +
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
 * The ONE generic last-resort system prompt, used only when an agent's .md body is
 * missing or empty. There is deliberately no role table any more: a v2 sidecar with
 * a missing/empty agentFile body is already skipped at registry load, so the only
 * thing left to say is who the agent is and what it is wired to.
 */
function lastResortPrompt(role, meta) {
  const name = meta?.displayName || role || 'pipeline';
  const desc = String(meta?.description || '').trim();
  const read = (meta?.inputs || []).map((p) => p?.id).filter(Boolean);
  const write = (meta?.outputs || []).map((p) => p?.id).filter(Boolean);
  const ports = [
    read.length ? `It reads: ${read.join(', ')}.` : '',
    write.length ? `It writes: ${write.join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return [`You are the "${name}" agent.`, desc, ports].filter(Boolean).join(' ');
}

/**
 * Build the full appended system prompt: toolInstruction first (if any), then — on
 * a workspace run — the `## Workspace Context` block, then the agent body (or the
 * one generic last-resort line when the body is missing/empty). The optional 4th
 * `workspace` arg is the read-only workspace metadata; absent it,
 * workspaceContextBlock returns '' and the prompt is byte-identical to today's
 * single-project prompt. The optional 5th `meta` is the agent's registry entry,
 * read ONLY by the last-resort line. Exported for testing.
 */
export function buildSystemPrompt(toolInstruction, agentBody, role, workspace, meta) {
  const parts = [];
  const tool = (toolInstruction || '').trim();
  if (tool) parts.push(tool);
  const ws = workspaceContextBlock(workspace); // '' when not a workspace run
  if (ws) parts.push(ws);
  const body = (agentBody || '').trim();
  parts.push(body || lastResortPrompt(role, meta));
  return parts.filter(Boolean).join('\n\n');
}

/**
 * Resolve the agent .md body for a runner: the node's own resolved `agentPrompt`
 * (stamped by resolveGraph from its meta.agentFile — built-in OR user layer)
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

/** Render the MOCK marker block appended to every task prompt. Exported so the
 *  graph executor assembles the same marker block instead of forking one. */
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
    'If a decision genuinely blocks correct work and cannot be resolved from the task, the ' +
    'inputs, or the codebase:\n' +
    '1. Write {"questions":[{"id","question","options":[2-4 strings],"allowFreeText":true}]} ' +
    `(max 8 questions) to: ${ctx.questionsFile}\n` +
    '2. STOP immediately — do no further work. You will be resumed with the answers.\n' +
    'Prefer reasonable assumptions for minor choices; never pad, and never re-ask an ' +
    'answered question.\n\n' +
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

/** Map the orchestrator's claudeOpts into runClaude options shared by every role.
 *  Exported so the graph executor reuses this exact mapping (RESUME_HEADER prefix
 *  and questionsPromptBlock suffix included) rather than forking it. */
export function runOpts(ctx, { role, prompt, systemPrompt, allowedTools }) {
  const c = ctx.claudeOpts || {};
  return {
    cwd: ctx.projectDir,
    systemPrompt,
    prompt: (ctx.resumeSessionId ? RESUME_HEADER + prompt : prompt) + questionsPromptBlock(ctx),
    resumeSessionId: ctx.resumeSessionId,
    // Grant the role's baseline tools PLUS whatever the agent declared in its
    // frontmatter (e.g. the Playwright MCP browser_* tools). ctx.node is present
    // for every execution (orchestrator._execCtx); a clarifier node has
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

/** Back-compat alias for the tests that imported runOpts before it was a proper
 *  named export. Same function object — never let the two drift. */
export const _runOptsForTests = runOpts;

/** A compact task header reused across roles. Exported for testing. */
export function taskHeader(ctx, title) {
  // Who gets the raw request + attachments? `isEntry` alone — no agent key is named
  // here. The engine decides it upstream (buildAgentPrompt): a node bound to the Task
  // card's token, or one whose meta declares `wantsRequest`, which is how the by-policy
  // roles keep the request text without the v1 key list.
  const isEntry = !!ctx.isEntry;
  const requestBlock = isEntry
    ? `## Original request\n\n${(ctx.taskPrompt || '').trim() || '(no prompt text)'}\n`
    : `## Upstream input\n\nYour input is the output of the preceding step(s); the file paths to read are named below.\n`;
  const attachBlock = isEntry ? renderAttachmentsBlock(ctx.extras) : '';
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
 * Workspace Scan — off-pipeline producer (NOT a workflow node, NOT routed through
 * a workflow node). The wizard's scan engine (M5: workspace-scan.mjs) calls this
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
    fanOutDirective(true) +
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

// ── small local helpers ────────────────────────────────────────────────────────

/** Join a file name onto the pipeline dir without importing node:path's full surface. */
function joinPipeline(pipelineDir, name) {
  const base = String(pipelineDir || '').replace(/\/+$/, '');
  return `${base}/${name}`;
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
 * Single source of truth shared by renderPromptArtifact (the task document body)
 * and taskHeader (the entry agent's inline header) so the two cannot drift.
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
 * Render the task document: the user's request stands in for the upstream artifact
 * a mid-stream consumer would otherwise read, with any attached files listed by
 * path. The Task card publishes exactly this, and the orchestrator pre-renders it
 * once per run.
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

// src/core/graph/executor.mjs
//
// The generic execution layer of the node-graph engine: output allocation from
// filename templates, the "## Ports (this run)" prompt block, prompt assembly,
// the clarifier gate, and the five flow-node executors.
//
// GENERICITY CHARTER (hard rule for this module): there is NO agent-key branch
// anywhere. Executor selection is `node.kind` + `meta.runnerType`; renderer
// selection is the port's `as`; mode selection is port FRESHNESS; the offline
// MOCK role comes from the generic resolution chain below. Everything that used
// to be a bespoke per-role runner is now data on the sidecar.
//
// The prompt machinery deliberately REUSES phases.mjs (taskHeader, runOpts,
// buildSystemPrompt, mockMarkers, the fan-out directives) rather than forking
// it, so the v2 prompts keep today's load-bearing bytes.

import { join, dirname } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

import {
  runClaude, MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER,
} from '../claude-runner.mjs';
import { planPath, reviewPath, writeStepQuestions, writeClarify } from '../artifacts.mjs';
import { readReview, normalizeClarify } from '../protocol.mjs';
import { renderPromptArtifact } from '../channels.mjs';
import {
  taskHeader, buildSystemPrompt, resolveAgentBody, mockMarkers, runOpts,
  fanOutDirective, ctxFanOut, workspaceFanOutDirective,
} from '../phases.mjs';

/** The reserved synthesized gate input. It is a scheduler-only binding: it never
 *  reaches `bindings`, is never listed in the Ports block, selects no mode, and
 *  carries no renderer. Mirrors fixtures.mjs AWAIT_PORT's id. */
const AWAIT_ID = 'await';

/** The clarifier gate's ask kind — the same token the mock writer role uses, so
 *  it is referenced through the imported constant rather than written as a bare
 *  agent-key-shaped literal (this module hardcodes no agent key anywhere). */
const CLARIFY_ASK_KIND = MOCK_ROLE_CLARIFY;

// Baseline allow-lists, mirroring phases.mjs. A node that declares
// `sideEffect: 'code'` writes source, so it additionally gets MultiEdit.
const READ_WRITE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'Skill'];
const CODE_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'Bash', 'Grep', 'Glob', 'Skill'];

/** The verdict-contract reminder every node with a declared verdict carries. */
const VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';

// ── allocation ────────────────────────────────────────────────────────────────

/**
 * Resolve one filename template into `{ path, store }`.
 *
 * Tokens: `{cycle}` -> the execution ordinal, `{base}` -> the run base name,
 * `{vsuffix}` -> the run-global plan-version suffix ('' for version 1, '-vN'
 * after). `{vsuffix}` CONSUMES one tick of `runCtx.planVersion()`, and only when
 * the template actually carries it — a template without it must never burn a
 * version.
 *
 * `store: 'project'` routes into the external store through artifacts.mjs's own
 * helpers (never a re-implemented join): a `plan` artifact through planPath with
 * the resolved version, anything else through reviewPath with the review kind
 * read off the template (`{base}-<kind>.md`).
 */
function resolveTemplate(port, { ordinal, runCtx, prefix }) {
  const tpl = String(port.filename);
  const store = port.store || 'run';
  let version = null;
  const nextVersion = () => {
    if (version === null) {
      version = typeof runCtx.planVersion === 'function' ? Number(runCtx.planVersion()) || 1 : 1;
    }
    return version;
  };
  const name = tpl
    .replace(/\{cycle\}/g, String(ordinal))
    .replace(/\{base\}/g, String(runCtx.baseName || ''))
    .replace(/\{vsuffix\}/g, () => (nextVersion() > 1 ? `-v${nextVersion()}` : ''));

  if (store !== 'project') return { path: join(runCtx.pipelineDir, prefix + name), store };

  if ((port.artifactKind || port.id) === 'plan') {
    const v = tpl.includes('{vsuffix}') ? nextVersion() : 1;
    return {
      path: planPath(runCtx.projectDir, runCtx.baseName, v, runCtx.datePrefix, runCtx.workspaceKey),
      store,
    };
  }
  const m = /^\{base\}-(.+)\.md$/.exec(tpl);
  const kind = m ? m[1] : (port.artifactKind || port.id);
  return {
    path: reviewPath(runCtx.projectDir, runCtx.baseName, runCtx.datePrefix, kind, runCtx.workspaceKey),
    store,
  };
}

/**
 * DUPLICATE-KEY RULE (generic): when two or more agent nodes in the resolved
 * graph share one agent key, every `store: 'run'` output and the verdict of
 * those nodes is prefixed `<nodeId>-`. Deterministic and resolve-time — the
 * caller sets `runCtx.duplicateKey` for the affected nodes — so single-instance
 * graphs (every builtin and seed template) allocate byte-identically to today.
 * Without it two instances of one verifier would clobber each other's
 * `*-review-cycleN.json`.
 */
function dupPrefix(node, runCtx) {
  return runCtx && runCtx.duplicateKey ? `${node.id}-` : '';
}

/** The combine card's own allocation: one md artifact per emission. */
function combinePath(node, ordinal, runCtx) {
  return join(runCtx.pipelineDir, `combine-${node.id}-c${ordinal}.md`);
}

/**
 * Allocate this execution's output paths, keyed by port id.
 *
 * Ports with no `filename` (every void port) allocate nothing — they carry a
 * token but no artifact. Outputs whose templates are IDENTICAL resolve to ONE
 * `{path, store}` object (the refiner's `plan`/`revise` pair is the live case):
 * each distinct template is evaluated exactly ONCE per execution, so a refine
 * cycle consumes one plan version, not two.
 *
 * @param {{node:object, ports:object, executionId?:string, ordinal?:number, runCtx:object}} o
 * @returns {Record<string, {path:string, store:string}>}
 */
export function allocateOutputs({ node, ports, executionId, ordinal = 1, runCtx = {} }) {
  const out = {};
  if (node?.kind === 'combine') {
    out.out = { path: combinePath(node, ordinal, runCtx), store: 'run' };
    return out;
  }
  const prefix = dupPrefix(node, runCtx);
  const byTemplate = new Map();
  for (const port of ports?.outputs || []) {
    if (!port || !port.filename) continue;
    const cacheKey = JSON.stringify([port.store || 'run', port.filename]);
    if (!byTemplate.has(cacheKey)) {
      byTemplate.set(cacheKey, resolveTemplate(port, { ordinal, runCtx, prefix }));
    }
    out[port.id] = byTemplate.get(cacheKey);
  }
  return out;
}

/**
 * The node-level verdict allocation (a verdict is NOT a port). Always lands in
 * the pipeline dir, and carries the duplicate-key prefix for the same reason the
 * run-store outputs do.
 * @returns {{path:string}|null}
 */
export function allocateVerdict({ node, ports, ordinal = 1, runCtx = {} }) {
  const filename = ports?.verdict?.filename;
  if (!filename) return null;
  const { path } = resolveTemplate(
    { id: 'verdict', filename, store: 'run' },
    { ordinal, runCtx, prefix: dupPrefix(node, runCtx) },
  );
  return { path };
}

// ── the Ports block ───────────────────────────────────────────────────────────

/**
 * Per-port input renderers, selected by the port's `as` (default `file`) —
 * NEVER inferred from the port id or the agent key. These are the generalized
 * form of v1's bespoke prompt arms.
 */
const INPUT_RENDERERS = {
  file: (t) => t.path || null,
  answers: (t) => (t.path ? `${t.path} (the clarifying questions and the answers already given)` : null),
  'fix-review': (t) => (t.path
    ? `${t.path} (the review to address — fix EVERY critical and major issue)`
    : null),
  worktree: () => '(the working tree — inspect with `git diff` / `git status` in your cwd)',
};

/**
 * The generated "## Ports (this run)" block: every BOUND input bound to an
 * absolute path (through its `as` renderer) and every declared output bound to
 * its allocated path.
 *
 * Conditional outputs are listed on EVERY execution (parity D7): `when` gates
 * token ROUTING only, so a passing verifier still writes its review markdown and
 * its verdict exactly as today. The synthesized `await` input is never listed —
 * the scheduler consumes it for freshness bookkeeping and never binds it, and
 * the guard here holds even if a caller passed one anyway.
 */
export function portIoBlock({ node, ports, bindings = {}, outputs = {}, verdict = null }) {
  const inLines = [];
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID) continue;
    const token = bindings[port.id];
    if (!token) continue;
    const render = INPUT_RENDERERS[port.as || 'file'] || INPUT_RENDERERS.file;
    const target = render(token);
    if (!target) continue;
    inLines.push(`- **${port.id}** (${token.type || port.type}) -> ${target}`);
  }
  const outLines = [];
  for (const port of ports?.outputs || []) {
    const path = outputs[port?.id]?.path;
    if (path) outLines.push(`- Write **${port.id}** to: ${path}`);
  }
  if (verdict?.path) {
    outLines.push(`- Write the **verdict** JSON (machine-readable) to: ${verdict.path}`);
  }
  return (
    '## Ports (this run)\n\n' +
    '### Inputs\n\n' +
    (inLines.length ? inLines.join('\n') : '- (none — work from the request above)') +
    '\n\n### Outputs\n\n' +
    (outLines.length ? outLines.join('\n') : '- (none — report your findings as your final message)') +
    '\n\n'
  );
}

// ── A3: mode selection is port FRESHNESS ──────────────────────────────────────

/**
 * Amendment A3 (parity-mandatory): an input's `directive` renders — and its mode
 * applies — ONLY when that port is FRESH for this execution. A latched loop-input
 * token never selects a mode, which is the token-model equivalent of v1's
 * publish-clears-review; without it a later fresh upstream re-fire would bind a
 * stale review and wrongly enter its mode. First executions list every bound
 * port as fresh, so they behave exactly as before.
 *
 * The synthesized `await` port never participates: it may appear in
 * `freshPorts` (a pure gate re-fire) with no effect at all.
 *
 * @returns {{mode: string|null, directives: Array<{id:string, directive:string, token:object}>}}
 */
export function selectMode({ ports, bindings = {}, freshPorts }) {
  const fresh = new Set(Array.isArray(freshPorts) ? freshPorts : Object.keys(bindings));
  const directives = [];
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID || !port.directive) continue;
    if (!fresh.has(port.id) || !bindings[port.id]) continue;
    directives.push({ id: port.id, directive: String(port.directive), token: bindings[port.id] });
  }
  return { mode: directives.length ? directives[0].id : null, directives };
}

/** Render the selected mode's arm(s): the announcement plus each directive and
 *  the path it points at. Empty string when no fresh port carries a directive. */
function modeBlock({ mode, directives }) {
  if (!directives.length) return '';
  return (
    `Mode: ${mode}\n\n` +
    directives
      .map((d) => d.directive.trim() + '\n\n' + (d.token?.path ? `${d.id}: ${d.token.path}\n\n` : ''))
      .join('')
  );
}

// ── graph-derived facts the prompt and the mock chain need ────────────────────

/**
 * The input ports of `nodeId` that are fed by a `kind: 'task'` node. This is what
 * replaces v1's hardcoded agent-key test for "who gets the raw request and the
 * attachments": binding the task document IS the entry relationship.
 * @returns {Set<string>}
 */
export function taskSourcedPorts(template, nodeId) {
  const kinds = new Map((template?.nodes || []).map((n) => [n.id, n.kind]));
  const out = new Set();
  for (const w of template?.wires || []) {
    if (w?.to?.node === nodeId && kinds.get(w?.from?.node) === 'task') out.add(w.to.port);
  }
  return out;
}

/**
 * This node's output port that is wired into an `expands` input, if any — the
 * graph-derived fact that makes a node "the thing that decomposes" without ever
 * naming a key. Returns the port id, or null.
 */
export function expandsOutputPort(template, portsFn, nodeId) {
  const byId = new Map((template?.nodes || []).map((n) => [n.id, n]));
  for (const w of template?.wires || []) {
    if (w?.from?.node !== nodeId) continue;
    const target = byId.get(w?.to?.node);
    if (!target) continue;
    const input = (portsFn(target)?.inputs || []).find((i) => i.id === w.to.port);
    if (input?.expands) return w.from.port;
  }
  return null;
}

// ── the generic MOCK_ROLE resolution chain ────────────────────────────────────

/**
 * Resolve the offline mock writer role, generically:
 *   1. a validated `meta.mockRole` (the builtins pin today's writer table);
 *   2. else a clarifier runner;
 *   3. else a node whose output feeds an `expands` input (graph-derived);
 *   4. else a node with a declared verdict;
 *   5. else the generic producer.
 * The chain can only ever yield a role the mock writer actually handles, which
 * is what lets an all-custom graph complete offline.
 */
export function resolveMockRole({ meta, expandsPort = null }) {
  const declared = meta?.mockRole;
  if (declared && MOCK_WRITER_ROLES.has(declared)) return declared;
  if (meta?.runnerType === 'clarifier') return MOCK_ROLE_CLARIFY;
  if (expandsPort) return MOCK_ROLE_DECOMPOSER;
  if (meta?.verdict) return 'generic-verifier';
  return 'generic-producer';
}

// ── prompt assembly ───────────────────────────────────────────────────────────

/** True on a detached WORKSPACE run: cwd is the run root and the members live at
 *  `repos/<projectKey>` inside it (phases.mjs keeps its own private copy of this
 *  gate; both read the same ctx fields). */
function detachedWorkspace(ctx) {
  return !!(ctx?.runRoot) && (ctx?.workspace?.projects || []).length > 0;
}

/** The role-free base instruction, keyed by runnerType — never by an agent key. */
function baseInstruction(runnerType) {
  if (runnerType === 'verifier') {
    return 'You are a verifier. Inspect the inputs below exactly as your role instructions describe, ' +
      'then write a human-readable review markdown AND a machine-readable review JSON.';
  }
  if (runnerType === 'clarifier') {
    return 'You are a clarifier. Identify the decisions that cannot be safely resolved from the task ' +
      'text or the real codebase — including things a downstream agent would otherwise silently ' +
      'assume. For each, write one conceptual question with 2 to 4 options and a free-text fallback ' +
      '(up to 8; never pad, never split one decision) as ' +
      '{ "questions": [ { "id", "question", "options": [ ... ], "allowFreeText": true } ] } to the ' +
      'output path below. If nothing material is open, write { "questions": [] } to that same path.';
  }
  return 'You are a pipeline agent. Read every input below, do your job exactly as your role ' +
    'instructions describe, and write EVERY declared output to its exact path.';
}

/** The answers port of a clarifier: its FIRST json output (meta validation
 *  guarantees a clarifier declares at least one). */
function answersPortOf(ports) {
  return (ports?.outputs || []).find((p) => p?.type === 'json') || null;
}

/** The MOCK marker set for this execution, per the resolution chain. */
function markersFor({ role, ordinal, runCtx, outputs, verdict, bindings, ports, meta, expandsPort, priorCount }) {
  const markers = { MOCK_ROLE: role, MOCK_CYCLE: ordinal, MOCK_BASE: runCtx.baseName };
  if (role === MOCK_ROLE_CLARIFY) {
    markers.MOCK_OUT = outputs[answersPortOf(ports)?.id]?.path;
    markers.MOCK_PRIOR = priorCount;
  } else if (role === MOCK_ROLE_DECOMPOSER) {
    markers.MOCK_OUT = outputs[expandsPort]?.path;
    markers.MOCK_TASKS_DIR = join(runCtx.pipelineDir, 'tasks');
  } else {
    markers.MOCK_OUT = Object.values(outputs).find((o) => o && o.path)?.path;
  }
  if (verdict?.path) markers.MOCK_JSON = verdict.path;
  const primaryIn = (ports?.inputs || [])
    .filter((p) => p && p.id !== AWAIT_ID)
    .map((p) => bindings[p.id]?.path)
    .find(Boolean);
  if (primaryIn) markers.MOCK_IN = primaryIn;
  if (meta?.workspaceStrategy) markers.MOCK_STRATEGY = meta.workspaceStrategy;
  return markers;
}

/**
 * Assemble the v2 task prompt: taskHeader + the base instruction + `promptHints`
 * + the fresh-port mode arm + the fan-out directives + the Ports block + the
 * verdict contract + the MOCK markers. Pure (no IO, no spawn), so prompt
 * behavior is assertable on its own.
 */
export function buildAgentPrompt(ctx) {
  const { node, bindings = {}, trigger = {}, ordinal = 1, runCtx = {} } = ctx;
  const ports = ctx.ports || {};
  const meta = ctx.meta || ports;
  const outputs = ctx.outputs || {};
  const verdict = ctx.verdict || null;

  // Who gets the raw request and the attachments: binding a task node's token,
  // or declaring `wantsRequest`. taskHeader reads those two decisions off
  // `isEntry` / `inputs` / `extras`, so drive it through them.
  const fromTask = ctx.taskSourcedPorts instanceof Set
    ? ctx.taskSourcedPorts
    : taskSourcedPorts(ctx.template || {}, node?.id);
  const taskBound = Object.keys(bindings).some((id) => fromTask.has(id));
  const headerCtx = {
    ...ctx,
    isEntry: taskBound || meta.wantsRequest === true,
    inputs: {},                                   // the graph binds ports, not v1 channels
    extras: taskBound ? (ctx.extras || []) : [],
  };

  const relative = detachedWorkspace(ctx);
  const hints = String(meta.promptHints || '').trim();
  const title = meta.displayName || node?.key || node?.id || 'agent';

  return (
    taskHeader(headerCtx, title) +
    '\n## What to do\n\n' +
    baseInstruction(meta.runnerType) + '\n\n' +
    (hints ? hints + '\n\n' : '') +
    modeBlock(selectMode({ ports, bindings, freshPorts: trigger.freshPorts })) +
    fanOutDirective(ctxFanOut(ctx), { omitProjectAgents: relative }) +
    workspaceFanOutDirective(meta.workspaceStrategy, ctx.workspace, { relative }) +
    portIoBlock({ node, ports, bindings, outputs, verdict }) +
    (verdict?.path ? VERDICT_CONTRACT : '') +
    mockMarkers(markersFor({
      role: ctx.mockRole || resolveMockRole({ meta, expandsPort: ctx.expandsPort }),
      ordinal, runCtx, outputs, verdict, bindings, ports, meta,
      expandsPort: ctx.expandsPort,
      priorCount: (ctx.priorAnswers || []).length,
    }))
  );
}

// ── the agent executor ────────────────────────────────────────────────────────

/**
 * Prepare an agent execution: allocate whatever the caller did not, resolve the
 * mock role, and assemble both prompts. Shared by the agent and clarifier
 * executors so the two can never drift.
 */
function prepare(ctx) {
  const { node, ordinal = 1, runCtx = {} } = ctx;
  const ports = ctx.ports || {};
  const meta = ctx.meta || ports;
  const outputs = ctx.outputs
    || allocateOutputs({ node, ports, executionId: ctx.executionId, ordinal, runCtx });
  const verdict = ctx.verdict !== undefined
    ? ctx.verdict
    : allocateVerdict({ node, ports, ordinal, runCtx });
  const expandsPort = ctx.expandsPort !== undefined
    ? ctx.expandsPort
    : (ctx.template && ctx.portsFn ? expandsOutputPort(ctx.template, ctx.portsFn, node.id) : null);
  const mockRole = resolveMockRole({ meta, expandsPort });

  const role = node?.key || node?.kind || 'agent';
  const body = resolveAgentBody(ctx, node?.key);
  if (!String(body || '').trim()) {
    console.warn(`[executor] node "${node?.id}": no agent .md body resolved — running with an empty system prompt`);
  }
  const systemPrompt = buildSystemPrompt(ctx.toolInstruction, body, role, ctx.workspace);
  const prompt = buildAgentPrompt({ ...ctx, ports, meta, outputs, verdict, expandsPort, mockRole });
  const allowedTools = meta.sideEffect === 'code' ? CODE_TOOLS : READ_WRITE_TOOLS;
  return { ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools };
}

/** The output map the scheduler publishes from: an entry per declared port, with
 *  a path where one was allocated and an empty payload for void ports. */
function publishable(ports, outputs) {
  const out = {};
  for (const port of ports?.outputs || []) {
    if (!port) continue;
    out[port.id] = outputs[port.id]?.path ? { path: outputs[port.id].path } : {};
  }
  return out;
}

/**
 * The ONE generic agent executor — the generalization of v1's runGenericProducer
 * and runGenericVerifier, and of the nine bespoke runners they replace. Selected
 * for `kind: 'agent'` with any `runnerType` other than clarifier.
 * @returns {Promise<{summary:string, outputs:object, verdict:object|null, prompt:string}>}
 */
export async function runAgentExecution(ctx) {
  const { ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools } = prepare(ctx);
  const { text } = await runClaude(runOpts(ctx, { role, prompt, systemPrompt, allowedTools }));
  const review = verdict?.path ? await readVerdict(verdict.path) : null;
  return {
    summary: (text || '').trim() || `${meta.displayName || ctx.node?.key || 'Agent'} completed.`,
    outputs: publishable(ports, outputs),
    verdict: review,
    prompt,
  };
}

// ── the clarifier executor ────────────────────────────────────────────────────

/**
 * Normalize an ask payload into enriched answers. Accepts `{answers:[{id,choice}]}`
 * or a bare array; any question the user left out falls back to its first option,
 * so downstream consumers never see a gap. Each answer carries its question text
 * so the row and the History UI render the full Q&A without a join.
 */
function normalizeAnswers(payload, questions) {
  const arr = Array.isArray(payload?.answers) ? payload.answers : Array.isArray(payload) ? payload : [];
  const byId = new Map();
  for (const a of arr) if (a && a.id != null) byId.set(String(a.id), String(a.choice ?? ''));
  return (questions || []).map((q) => ({
    id: q.id,
    question: q.question || '',
    choice: byId.has(q.id) ? byId.get(q.id) : (q.options && q.options.find((o) => o && o.trim())) || '',
  }));
}

async function readJsonMaybe(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return null;                                  // missing or malformed — tolerated
  }
}

/**
 * The clarifier executor — selected by `meta.runnerType === 'clarifier'`, NEVER
 * by an agent key, so any number of clarifier nodes per graph is legal.
 *
 * Contract: spawn the agent, which writes its questions JSON to the FIRST json
 * output port's allocated path (malformed or empty is tolerated: no gate, empty
 * answers); if there are questions, gate the human through
 * `ask({ id: 'clarify-<nodeId>-<ordinal>', ... })` — nodeId-scoped, because v1's
 * cycle-scoped id would collide across several clarifiers; then REWRITE that
 * file to `{questions, answers}` as one idempotent full-file write and publish
 * the (now self-contained) token. The snapshot lands only after the publish, so
 * a mid-gate resume re-runs the gate from the questions half.
 */
export async function runClarifierExecution(ctx) {
  const { node, ordinal = 1 } = ctx;
  const { ports, meta, outputs, role, systemPrompt, prompt, allowedTools } = prepare(ctx);
  const answersPort = answersPortOf(ports);
  const answersPath = outputs[answersPort?.id]?.path;

  await runClaude(runOpts(ctx, { role, prompt, systemPrompt, allowedTools }));

  const { questions } = normalizeClarify(await readJsonMaybe(answersPath));
  let answers = [];
  if (questions.length) {
    if (ctx.pipelineId) {
      await writeStepQuestions(ctx.pipelineId, ctx.executionId, ordinal, {
        agentKey: node?.key, nodeId: node?.id, questions: { questions },
      });
      await writeClarify(ctx.pipelineId, { questions: { questions } });
    }
    const payload = await ctx.ask({
      id: `${CLARIFY_ASK_KIND}-${node.id}-${ordinal}`,
      kind: CLARIFY_ASK_KIND,
      nodeId: node.id,
      agent: meta.displayName || node.key,
      questions,
    });
    answers = normalizeAnswers(payload, questions);
    if (ctx.pipelineId) {
      await writeStepQuestions(ctx.pipelineId, ctx.executionId, ordinal, {
        agentKey: node?.key, nodeId: node?.id, answers: { answers },
      });
      await writeClarify(ctx.pipelineId, { answers: { answers } });
    }
  }

  await mkdir(dirname(answersPath), { recursive: true }).catch(() => {});
  await writeFile(answersPath, JSON.stringify({ questions, answers }, null, 2) + '\n', 'utf8');
  return { outputs: publishable(ports, outputs), questions, answers, prompt };
}

// ── flow executors (pure engine: instant, $0, no process spawn) ───────────────

/** The AND card — the pure synchronizer. Payloads are discarded on purpose: its
 *  `out` is a static void token, which is what makes it reusable sequencing. */
export function runAndExecution({ node }) {                             // eslint-disable-line no-unused-vars
  return { outputs: { out: {} } };
}

/**
 * The OR card — the payload-forwarding valve. INFORMATIONAL in the scheduler
 * path: the scheduler owns any-fresh triggering, freshest selection, the
 * same-drain single emission AND the re-emitted payload (it emits from the token
 * IT bound); this return is an echo, mirroring runEndExecution's `result`.
 * `bindings` therefore holds EXACTLY ONE entry — the freshest input the
 * scheduler already picked — which this simply forwards; it never compares seqs
 * and never iterates the other inputs.
 */
export function runOrExecution({ node, bindings = {} }) {               // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0];
  if (!token) return { outputs: { out: {} } };
  return { outputs: { out: { type: token.type, path: token.path ?? null, value: token.value ?? null } } };
}

/**
 * The End card — the sink. Records the bound result token and emits NO outputs.
 * INFORMATIONAL: the scheduler derives the snapshot's `ended.result` from the
 * token it bound, never from this return.
 */
export function runEndExecution({ node, bindings = {} }) {              // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0] || null;
  return {
    result: {
      type: token?.type ?? 'void',
      path: token?.path ?? null,
      value: token?.value ?? null,
    },
  };
}

/** Write a file, creating its directory. Synchronous on purpose — see below. */
function writeOut(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/**
 * The Task card — the source. Fires once at run start and emits the rendered
 * task document: the run title, the user's prompt markdown, and the attached
 * files section (exactly what renderPromptArtifact produces today).
 *
 * Amendment A2 (parity-mandatory for the mid-stream entry template): with
 * `config.planStoreSeed`, the document ALSO lands in the plans store at version
 * 1, the emitted token IS that plans-store path, and the run's plan-version
 * counter is consumed at 1 — so the next plan-store write allocates `-v2`.
 *
 * Synchronous, like every flow executor: this runs once, at t0, on a document
 * that is already in hand.
 */
export function runTaskExecution({ node, taskArtifact, runCtx = {} }) {
  const given = taskArtifact?.path || null;
  let text = typeof taskArtifact?.text === 'string' ? taskArtifact.text : null;
  if (text === null && given) {
    try { text = readFileSync(given, 'utf8'); } catch { text = null; }
  }
  if (text === null) {
    text = renderPromptArtifact(taskArtifact?.promptText, taskArtifact?.extras || []);
  }

  if (node?.config?.planStoreSeed !== true) {
    let target = given;
    if (!target) {
      target = join(runCtx.pipelineDir, 'task.md');
      writeOut(target, text);
    }
    return { outputs: { task: { path: target } } };
  }

  const version = typeof runCtx.planVersion === 'function' ? Number(runCtx.planVersion()) || 1 : 1;
  const seeded = planPath(runCtx.projectDir, runCtx.baseName, version, runCtx.datePrefix, runCtx.workspaceKey);
  writeOut(seeded, text);
  return { outputs: { task: { path: seeded } } };
}

/**
 * The Combine card — the payload-bearing md AND-join. Concatenates its bound
 * inputs in PORT order under `## From <node name>` headings and writes one md
 * artifact. `names` maps port id -> the source node's display name; absent one,
 * the token's own provenance (then the port id) stands in.
 */
export async function runCombineExecution({ node, bindings = {}, allocatedPath, names = {}, ordinal = 1, runCtx = {} }) {
  const path = allocatedPath || combinePath(node, ordinal, runCtx);
  const parts = [];
  for (const portId of Object.keys(bindings).sort(comparePortIds)) {
    const token = bindings[portId];
    if (!token) continue;
    const name = names[portId] || token.meta?.sourceName || token.sourceNodeId || portId;
    let body = typeof token.value === 'string' ? token.value : '';
    if (!body && token.path) {
      try { body = await readFile(token.path, 'utf8'); } catch { body = ''; }
    }
    parts.push(`## From ${name}\n\n${body.trim()}\n`);
  }
  await mkdir(dirname(path), { recursive: true }).catch(() => {});
  await writeFile(path, parts.join('\n'), 'utf8');
  return { outputs: { out: { path } } };
}

/** Order `in1..inN` numerically so the concatenation follows port order, not
 *  lexical order (`in10` must not sort before `in2`). */
function comparePortIds(a, b) {
  const na = /^in(\d+)$/.exec(a);
  const nb = /^in(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  return a < b ? -1 : a > b ? 1 : 0;
}

// ── verdicts ──────────────────────────────────────────────────────────────────

/**
 * Read a node's verdict JSON back through the protocol normalizer. Never throws:
 * a missing or malformed file reads as "no issues", which is what makes an
 * unwritten verdict a clean pass rather than a run failure.
 */
export function readVerdict(verdictPath) {
  if (!verdictPath) return Promise.resolve({ issues: [], summary: '' });
  return readReview(verdictPath);
}

// src/core/graph/executor.mjs
//
// The generic execution layer of the node-graph engine: output allocation from
// filename templates, the "## Ports (this run)" prompt block, prompt assembly, the
// clarifier gate, and the five flow-node executors.
//
// GENERICITY CHARTER (hard rule for this module): there is NO agent-key branch
// anywhere. Executor selection is `node.kind` + `meta.runnerType`; renderer selection
// is the port's `as`; mode selection is port FRESHNESS; the offline MOCK role comes
// from the generic resolution chain below; the decomposition contract renders for
// any node whose output is wired into an `expands` input. Everything that used to be
// a bespoke per-role runner is now data on the sidecar.
//
// The prompt machinery deliberately REUSES phases.mjs (taskHeader, runOpts,
// buildSystemPrompt, mockMarkers, siblingsBlock, diffInstruction, the fan-out
// directives) rather than forking it, so the v2 prompts keep today's load-bearing
// bytes. `test/graph-prompt-parity.test.mjs` is the contract.
//
// ── THE DECOMPOSITION CONTRACT ───────────────────────────────────────────────
// One document, no owner: ANY producer may emit it on a json output port, and ANY
// node with an `expands` input may consume it. Neither side is named anywhere in the
// engine — the relationship IS the wire (`expandsOutputPort`).
//
//   { "phases": [ { "ordinal": <int>,
//                   "tasks": [ { "id": <string>, "title": <string?>,
//                                "file": <pipelineDir-relative markdown path> } ] } ] }
//
// The parse is TOLERANT: a missing file, invalid JSON, a non-array `phases`, a phase
// without a usable ordinal or without runnable tasks, and a task missing `id` or
// `file` are all DROPPED rather than thrown on. `phases.length === 0` means "there is
// nothing to fan out": the consumer then runs ONE ordinary execution with its expands
// input left UNBOUND. The composite DRIVER is scheduler.mjs; this module owns the
// document — including the prompt block that tells a producer where to write the
// task files and what the manifest looks like.
import { join, dirname, relative, basename } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

import {
  runClaude, MOCK_WRITER_ROLES, MOCK_ROLE_CLARIFY, MOCK_ROLE_DECOMPOSER,
} from '../claude-runner.mjs';
import { planPath, reviewPath, writeStepQuestions, writeClarify } from '../artifacts.mjs';
import { readReview, normalizeClarify, normalizeReview, safeParseJson } from '../protocol.mjs';
import {
  taskHeader, buildSystemPrompt, resolveAgentBody, mockMarkers, runOpts,
  fanOutDirective, ctxFanOut, ctxSubagentModel, ctxEndpointRouted, workspaceFanOutDirective, workspaceDiffInstruction,
  renderAnswers, siblingsBlock, diffInstruction, READ_WRITE_TOOLS, IMPLEMENTER_TOOLS,
} from '../phases.mjs';
import { SUBAGENT_MODELS } from '../model-env.mjs';
import { AWAIT_PORT } from '../../shared/graph/constants.mjs';

/** The reserved synthesized gate input. Scheduler-only: it never reaches `bindings`,
 *  is never listed in the Ports block, selects no mode, and carries no renderer. */
const AWAIT_ID = AWAIT_PORT.id;

/** The clarifier gate's ask kind — the same token the mock writer role uses, so it is
 *  referenced through the imported constant rather than a bare agent-key literal. */
const CLARIFY_ASK_KIND = MOCK_ROLE_CLARIFY;

/** The verdict-contract reminder every node with a declared verdict carries
 *  (phases.mjs:879-881, verbatim). */
export const VERDICT_CONTRACT =
  'The review JSON shape is { "issues": [ { "severity", "title", "detail", "location" } ], ' +
  '"summary" }. Use severities critical|major|minor|suggestion; only critical/major block the ' +
  'pipeline.\n\n';

// ── allocation ────────────────────────────────────────────────────────────────

/**
 * Resolve one filename template into `{ path, store }`. Tokens: `{cycle}` -> the
 * execution ordinal, `{base}` -> the run base name, `{vsuffix}` -> the run-global
 * plan-version suffix ('' for version 1, '-vN' after). `{vsuffix}` CONSUMES one tick
 * of `runCtx.planVersion()`, and only when the template actually carries it.
 * The duplicate-key/slice `prefix` applies to EVERY store: the plans/reviews store is
 * one file per base name (v1 parity), so without it two cards on one agent key —
 * trivial to place in the composer — resolve to ONE persisted path and the later
 * writer clobbers the earlier. The prefix is EMPTY for a single card, so every
 * single-card graph keeps its v1 path byte-for-byte.
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

  // The prefix rides the discriminating half of each store's name so the -vN
  // linkage still hangs off the node's OWN plan family: plans get it on the base
  // (`<date>-<prefix><base>[-vN].md`), reviews on the kind (`<date>-<base>-<prefix><kind>.md`).
  if ((port.artifactKind || port.id) === 'plan') {
    const v = tpl.includes('{vsuffix}') ? nextVersion() : 1;
    return {
      path: planPath(runCtx.projectDir, prefix + String(runCtx.baseName || ''), v, runCtx.datePrefix, runCtx.workspaceKey),
      store,
    };
  }
  const m = /^\{base\}-(.+)\.md$/.exec(tpl);
  const kind = m ? m[1] : (port.artifactKind || port.id);
  return {
    path: reviewPath(runCtx.projectDir, runCtx.baseName, runCtx.datePrefix, prefix + kind, runCtx.workspaceKey),
    store,
  };
}

/**
 * DUPLICATE-KEY RULE (generic): when two or more agent nodes share one agent key,
 * every `store:'run'` output and the verdict of those nodes is prefixed `<nodeId>-`.
 * `runCtx.slice` extends the same rule to a COMPOSITE fan-out: every sub-execution of
 * one composite shares its parent's ordinal, so without a per-task prefix the parallel
 * slices would resolve to one filename and clobber each other.
 */
function dupPrefix(node, runCtx) {
  const dup = runCtx && runCtx.duplicateKey ? `${node.id}-` : '';
  const slice = runCtx && runCtx.slice ? `${runCtx.slice}-` : '';
  return dup + slice;
}

/** The combine card's own allocation: one md artifact per emission. */
function combinePath(node, ordinal, runCtx) {
  return join(runCtx.pipelineDir, `combine-${node.id}-c${ordinal}.md`);
}

/** Where a decomposition's task files live: `<pipelineDir>/tasks` — v1's
 *  `join(dirname(decompositionPath), 'tasks')` for a run-store manifest. ONE helper
 *  feeds both the prompt block and the mock's `MOCK_TASKS_DIR`. */
function tasksDirOf(runCtx) {
  return join(String(runCtx?.pipelineDir || ''), 'tasks');
}

/**
 * Allocate this execution's output paths, keyed by port id. Outputs whose templates
 * are IDENTICAL resolve to ONE `{path, store}` object (the refiner's `plan`/`revise`
 * pair is the live case): each distinct template is evaluated exactly ONCE per
 * execution, so a refine cycle consumes one plan version, not two.
 * @returns {Record<string, {path:string, store:string}>}
 */
export function allocateOutputs({ node, ports, executionId, ordinal = 1, runCtx = {} }) {  // eslint-disable-line no-unused-vars
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

/** The node-level verdict allocation (a verdict is NOT a port). Always lands in the
 *  pipeline dir, and carries the duplicate-key prefix for the same reason. */
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

/** True on a detached WORKSPACE run: cwd is the run root and the members live at
 *  `repos/<projectKey>` inside it (the same test phases.mjs#isDetachedWorkspace makes). */
function detachedWorkspace(ctx) {
  return !!(ctx?.runRoot) && (ctx?.workspace?.projects || []).length > 0;
}

/**
 * The `{diffInstruction}` prompt-hint token: HOW to inspect the implemented changes,
 * as a FRAGMENT that sits inside the hint's own sentence — v1's checklist
 * `changesInstruction` (phases.mjs:1076-1084). Single project: the v1 parenthetical
 * bytes; detached workspace: the v1 run-root sentence + the per-member
 * `git -C repos/<key> diff <ref>` lines. This is NOT the reviewer's diff sentence —
 * that one is a full sentence and belongs to the `as:'worktree'` renderer
 * (`diffInstruction`); the two are different v1 byte sets and never share a helper.
 * Pure + exported (the parity suite pins both arms).
 */
export function changesInstruction(ctx) {
  const perMember = detachedWorkspace(ctx) ? workspaceDiffInstruction(ctx) : '';
  return perMember
    ? 'in EVERY member checkout — your cwd is the worca-cc run root, not a repository, so ' +
      'inspect each member on its own:\n\n' + perMember + '\n\n'
    : 'via `git diff` in your cwd';
}

/**
 * Per-port input renderers, selected by the port's `as` (default `file`) — NEVER
 * inferred from the port id or the agent key. These are the generalized form of v1's
 * bespoke prompt arms. `worktree` renders the v1 reviewer bytes: the checkpoint-ref
 * diff sentence, or the per-member `git -C repos/<key> diff <ref>` lines on a
 * detached workspace.
 */
const INPUT_RENDERERS = {
  file: (t) => t.path || null,
  answers: (t) => (t.path ? `${t.path} (the clarifying questions and the answers already given)` : null),
  'fix-review': (t) => (t.path
    ? `${t.path} (the review to address — fix EVERY critical and major issue)`
    : null),
  worktree: (t, ctx) => (detachedWorkspace(ctx) ? workspaceDiffInstruction(ctx) : diffInstruction(ctx)),
};

/**
 * The generated "## Ports (this run)" block: every BOUND input bound through its `as`
 * renderer, and every declared output bound to its allocated path. Conditional
 * outputs are listed on EVERY execution (`when` gates token ROUTING only, so a
 * passing verifier still writes its review markdown and its verdict exactly as
 * today). Outputs sharing ONE allocated path render ONE line. The synthesized
 * `await` input is never listed.
 */
export function portIoBlock({ node, ports, bindings = {}, outputs = {}, verdict = null, ctx = {} }) {  // eslint-disable-line no-unused-vars
  const inLines = [];
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID) continue;
    const token = bindings[port.id];
    if (!token) continue;
    const render = INPUT_RENDERERS[port.as || 'file'] || INPUT_RENDERERS.file;
    const target = render(token, ctx);
    if (!target) continue;
    inLines.push(`- **${port.id}** (${token.type || port.type}) -> ${target}`);
  }
  const outLines = [];
  const byPath = new Map();                       // path -> [portId, …] in declared order
  for (const port of ports?.outputs || []) {
    const path = outputs[port?.id]?.path;
    if (!path) continue;
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(port.id);
  }
  for (const [path, ids] of byPath) {
    const also = ids.slice(1).map((id) => `**${id}**`).join(', ');
    outLines.push(`- Write **${ids[0]}**${also ? ` (also ${also})` : ''} to: ${path}`);
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
 * applies — ONLY when that port is FRESH for this execution, and only the FIRST such
 * port in DECLARED order wins. A latched loop-input token never selects a mode, which
 * is the token-model equivalent of v1's publish-clears-review. First executions list
 * every bound port as fresh. The synthesized `await` port never participates.
 * @returns {{mode: string|null, directives: Array<{id:string, directive:string, token:object}>}}
 */
export function selectMode({ ports, bindings = {}, freshPorts }) {
  const fresh = new Set(Array.isArray(freshPorts) ? freshPorts : Object.keys(bindings));
  for (const port of ports?.inputs || []) {
    if (!port || port.id === AWAIT_ID || !port.directive) continue;
    if (!fresh.has(port.id) || !bindings[port.id]) continue;
    return { mode: port.id, directives: [{ id: port.id, directive: String(port.directive), token: bindings[port.id] }] };
  }
  return { mode: null, directives: [] };
}

/** Render the selected mode's arm: the announcement, the directive, and the path it
 *  points at. Empty string when no fresh port carries a directive. */
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
 * The input ports of `nodeId` fed by a `kind:'task'` node — what replaces v1's
 * hardcoded agent-key test for "who gets the raw request and the attachments":
 * binding the task document IS the entry relationship.
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

/** This node's output port that is wired into an `expands` input, if any — the
 *  graph-derived fact that makes a node "the thing that decomposes" without ever
 *  naming a key. Returns the port id, or null. */
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

// ── the decomposition document ────────────────────────────────────────────────

/**
 * Normalize a decomposition document into the engine's canonical shape. PURE and
 * TOTAL: every input — including null, a bare array, a number — resolves to
 * `{ phases: [...] }`, dropping whatever cannot be run rather than throwing. Phases
 * come back ordinal-sorted.
 */
export function normalizeDecomposition(raw) {
  const phases = [];
  for (const ph of Array.isArray(raw?.phases) ? raw.phases : []) {
    const ordinal = Number(ph?.ordinal);
    if (!Number.isFinite(ordinal)) continue;
    const tasks = (Array.isArray(ph?.tasks) ? ph.tasks : [])
      .filter((t) => t && t.id && t.file)
      .map((t) => ({ id: String(t.id), title: t.title == null ? null : String(t.title), file: String(t.file) }));
    if (!tasks.length) continue;                  // a phase with nothing to run is not a phase
    phases.push({ ordinal, tasks });
  }
  phases.sort((a, b) => a.ordinal - b.ordinal);
  return { phases };
}

/** Read a decomposition document off disk through the tolerant parse. Never throws
 *  and never rejects. */
export async function readDecomposition(path) {
  if (!path) return { phases: [] };
  try {
    return normalizeDecomposition(JSON.parse(await readFile(path, 'utf8')));
  } catch {
    return { phases: [] };
  }
}

// ── the generic MOCK_ROLE resolution chain ────────────────────────────────────

/**
 * Resolve the offline mock writer role, generically:
 *   1. a validated `meta.mockRole` (the builtins pin today's writer table);
 *   2. else a clarifier runner;
 *   3. else a node whose output feeds an `expands` input (graph-derived);
 *   4. else a node with a declared verdict;
 *   5. else the generic producer.
 * The chain can only ever yield a role the mock writer actually handles, which is what
 * lets an all-custom graph complete offline.
 */
export function resolveMockRole({ meta, expandsPort = null }) {
  const declared = meta?.mockRole;
  if (declared && MOCK_WRITER_ROLES.has(declared)) return declared;
  if (meta?.runnerType === 'clarifier') return MOCK_ROLE_CLARIFY;
  if (expandsPort) return MOCK_ROLE_DECOMPOSER;
  if (meta?.verdict) return 'generic-verifier';
  return 'generic-producer';
}

// ── verdicts ──────────────────────────────────────────────────────────────────

/** The text every unparseable verdict file fails with. */
const BAD_VERDICT_TAIL = 'expected { "issues": [ \u2026 ] }';

/**
 * Read a node's verdict JSON back through the protocol normalizer.
 *
 * Two degenerate cases, deliberately split (they are NOT the same failure):
 *  - the file was NEVER WRITTEN -> `{issues: [], summary: '', missing: true}`: a clean
 *    pass, v1 parity, because an agent that declares a verdict and writes none must not
 *    fail a run. `missing` is the flag the caller turns into a warning (and the reason
 *    the reviews table skips the row) instead of a phantom zero-issue review.
 *  - the file EXISTS but does not parse, or carries no `issues` array -> THROW. The
 *    verifier wrote garbage, and on every shipped seed the clean side is wired straight
 *    to End, so "no issues" there is indistinguishable from an approval. Fail-fast owns
 *    the rest.
 *
 * `readReview` is untouched for its other callers (it is v1 code with its own tolerant
 * contract); the existsSync + parse-failure branch lives here.
 */
export async function readVerdict(verdictPath) {
  if (!verdictPath) return { issues: [], summary: '' };
  if (!existsSync(verdictPath)) return { issues: [], summary: '', missing: true };
  let text;
  try {
    text = await readFile(verdictPath, 'utf8');
  } catch (err) {
    throw Object.assign(new Error(`verdict file unreadable: ${verdictPath} — ${err?.message || err}`),
      { code: 'BAD_VERDICT' });
  }
  const data = safeParseJson(text);
  if (!data || typeof data !== 'object' || !Array.isArray(data.issues)) {
    throw Object.assign(new Error(`verdict file is not a review JSON: ${verdictPath} — ${BAD_VERDICT_TAIL}`),
      { code: 'BAD_VERDICT' });
  }
  return normalizeReview(data);
}

/** The warning line a missing verdict raises, relative to the pipeline dir so the
 *  run log stays readable. */
function missingVerdictWarning(ctx, verdictPath) {
  const rel = ctx?.pipelineDir ? relative(ctx.pipelineDir, verdictPath) : basename(verdictPath);
  return `verdict file missing: ${ctx?.nodeId || ctx?.node?.id || '?'} ${rel} — treated as clean`;
}

// ── prompt assembly ───────────────────────────────────────────────────────────

/** The role-free base instruction, keyed by runnerType — never by an agent key. The
 *  producer/verifier sentences are v1's generic runners (phases.mjs:1207-1209 /
 *  :1245-1246); the clarifier sentence is v1's buildClarifyPrompt (:581-587) minus
 *  its parenthetical aside that named two builtin agents a generic graph need not have. */
function baseInstruction(runnerType) {
  if (runnerType === 'verifier') {
    return 'You are a verifier. Inspect the inputs below exactly as your role instructions describe, ' +
      'then write a human-readable review markdown AND a machine-readable review JSON.';
  }
  if (runnerType === 'clarifier') {
    return 'Identify the decisions you cannot safely resolve from the task text or the real ' +
      'codebase — including things a downstream agent would otherwise silently assume. For ' +
      'each, produce one conceptual question with 2 to 4 options and a free-text fallback. Ask ' +
      'only what materially changes the plan (up to 8 questions); never pad, and never split one ' +
      'decision. For low-impact details, pick a sensible default rather than asking. If you have ' +
      'no material open questions, write { "questions": [] } to that same path.';
  }
  return 'You are a pipeline agent. Read every input below, do your job exactly as your role ' +
    'instructions describe, and write EVERY declared output to its exact path.';
}

/** The answers port of a clarifier: its FIRST json output (meta validation guarantees
 *  a clarifier declares at least one). */
function answersPortOf(ports) {
  return (ports?.outputs || []).find((p) => p?.type === 'json') || null;
}

/** The three prompt-hint tokens. `{diffInstruction}` is the changes-inspection
 *  fragment (`changesInstruction`), so a hint reads "…the implemented changes (via
 *  `git diff` in your cwd)…" exactly as v1's checklist did. */
function substituteHints(raw, ctx) {
  const hints = String(raw || '').trim();
  if (!hints) return '';
  return hints
    .replace(/\{pipelineDir\}/g, String(ctx.runCtx?.pipelineDir || ctx.pipelineDir || ''))
    .replace(/\{cycle\}/g, String(ctx.ordinal ?? ctx.cycle ?? 1))
    .replace(/\{diffInstruction\}/g, () => changesInstruction(ctx));
}

/**
 * The decomposition contract, rendered for ANY node whose output is wired into an
 * `expands` input (graph-derived — no key is named): where the task files go and what
 * the manifest looks like. v1's decomposer lines (phases.mjs:727-731), byte-faithful;
 * the manifest path itself is the Ports block's output line.
 */
function decompositionContractBlock(expandsPort, runCtx) {
  if (!expandsPort) return '';
  return (
    `Write each task file under: ${tasksDirOf(runCtx)}/ (name them p<phase>-t<n>-<kebab-title>.md)\n` +
    'The manifest shape is { "phases": [ { "ordinal", "tasks": [ { "id", "title", "file" } ] } ] }. ' +
    'Use id "p<ordinal>t<n>" and a pipeline-dir-relative "file" path.\n\n'
  );
}

/** The MOCK marker set for this execution, per the resolution chain. Only markers
 *  `runMock` reads are emitted (MOCK_ROLE, MOCK_CYCLE, MOCK_BASE, MOCK_OUT, MOCK_JSON,
 *  MOCK_IN, MOCK_PRIOR, MOCK_TASKS_DIR). */
function markersFor({ role, ordinal, runCtx, outputs, verdict, bindings, ports, expandsPort, priorCount }) {
  const markers = { MOCK_ROLE: role, MOCK_CYCLE: ordinal, MOCK_BASE: runCtx.baseName };
  if (role === MOCK_ROLE_CLARIFY) {
    markers.MOCK_OUT = outputs[answersPortOf(ports)?.id]?.path;
    markers.MOCK_PRIOR = priorCount;
  } else if (role === MOCK_ROLE_DECOMPOSER) {
    markers.MOCK_OUT = outputs[expandsPort]?.path;
    markers.MOCK_TASKS_DIR = tasksDirOf(runCtx);
  } else {
    markers.MOCK_OUT = Object.values(outputs).find((o) => o && o.path)?.path;
  }
  if (verdict?.path) markers.MOCK_JSON = verdict.path;
  const primaryIn = (ports?.inputs || [])
    .filter((p) => p && p.id !== AWAIT_ID)
    .map((p) => bindings[p.id]?.path)
    .find(Boolean);
  if (primaryIn) markers.MOCK_IN = primaryIn;
  return markers;
}

/**
 * Assemble the v2 task prompt. PURE (no IO, no spawn), so prompt behavior is
 * assertable on its own — `test/graph-prompt-parity.test.mjs` drives this directly
 * with the REAL sidecars.
 */
export function buildAgentPrompt(ctx) {
  const { node, bindings = {}, trigger = {}, ordinal = 1, runCtx = {} } = ctx;
  const ports = ctx.ports || {};
  const meta = ctx.meta || ports;
  const outputs = ctx.outputs || {};
  const verdict = ctx.verdict || null;
  const expandsPort = ctx.expandsPort ?? null;

  // Who gets the raw request and the attachments: binding a task node's token, or
  // declaring `wantsRequest`. taskHeader reads those decisions off `isEntry` /
  // `inputs` / `extras`, so drive it through them.
  const fromTask = ctx.taskSourcedPorts instanceof Set
    ? ctx.taskSourcedPorts
    : taskSourcedPorts(ctx.template || {}, node?.id);
  const taskBound = Object.keys(bindings).some((id) => fromTask.has(id));
  const headerCtx = {
    ...ctx,
    isEntry: taskBound || meta.wantsRequest === true,
    inputs: {},                                   // the graph binds ports, not v1 channels
    extras: taskBound ? (ctx.extras || []) : [],  // wantsRequest gets the request, never the attachments
  };

  const relative = detachedWorkspace(ctx);
  const routed = ctxEndpointRouted(ctx);
  const hints = substituteHints(meta.promptHints, ctx);
  const title = meta.displayName || node?.key || node?.id || 'agent';
  const siblings = ctx.slice ? siblingsBlock(ctx.slice.siblings) : '';
  const answersBlock = (ports.inputs || []).some((p) => p?.as === 'answers')
    ? '## Clarifications already answered\n\n' + renderAnswers(ctx.priorAnswers || []) + '\n'
    : '';

  return (
    taskHeader(headerCtx, title) +
    '\n## What to do\n\n' +
    baseInstruction(meta.runnerType) + '\n\n' +
    (hints ? hints + '\n\n' : '') +
    modeBlock(selectMode({ ports, bindings, freshPorts: trigger.freshPorts })) +
    fanOutDirective(ctxFanOut(ctx), { omitProjectAgents: relative, subagentModel: ctxSubagentModel(ctx), endpointRouted: routed }) +
    workspaceFanOutDirective(meta.workspaceStrategy, ctx.workspace, { relative, endpointRouted: routed }) +
    (siblings ? siblings + '\n' : '') +
    portIoBlock({ node, ports, bindings, outputs, verdict, ctx }) +
    decompositionContractBlock(expandsPort, runCtx) +
    answersBlock +
    (verdict?.path ? VERDICT_CONTRACT : '') +
    mockMarkers(markersFor({
      role: ctx.mockRole || resolveMockRole({ meta, expandsPort }),
      ordinal, runCtx, outputs, verdict, bindings, ports,
      expandsPort,
      priorCount: (ctx.priorAnswers || []).length,
    }))
  );
}

// ── the agent executor ────────────────────────────────────────────────────────

async function readJsonMaybe(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; }
}

/** The answers already given, read off the bound `as:'answers'` port. */
async function readPriorAnswers(ports, bindings = {}) {
  const port = (ports?.inputs || []).find((p) => p?.as === 'answers');
  const path = port ? bindings[port.id]?.path : null;
  if (!path) return [];
  const json = await readJsonMaybe(path);
  return Array.isArray(json?.answers) ? json.answers : [];
}

/**
 * Prepare an agent execution: allocate whatever the caller did not, resolve the mock
 * role and the prior answers, and assemble both prompts. Shared by the agent and
 * clarifier executors so the two can never drift.
 */
async function prepare(ctx) {
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
  const priorAnswers = Array.isArray(ctx.priorAnswers)
    ? ctx.priorAnswers
    : await readPriorAnswers(ports, ctx.bindings);

  const role = node?.key || node?.kind || 'agent';
  const body = resolveAgentBody(ctx, node?.key);
  if (!String(body || '').trim()) {
    console.warn(`[executor] node "${node?.id}": no agent .md body resolved — running with an empty system prompt`);
  }
  const systemPrompt = buildSystemPrompt(ctx.toolInstruction, body, role, ctx.workspace);
  const full = { ...ctx, ports, meta, outputs, verdict, expandsPort, mockRole, priorAnswers };
  const prompt = buildAgentPrompt(full);
  const allowedTools = meta.sideEffect === 'code' ? IMPLEMENTER_TOOLS : READ_WRITE_TOOLS;
  // D3: an EXPLICIT alias pin on an endpoint-routed node is a stored promise the
  // run cannot keep — degrade it (the prompt already carries the same-endpoint
  // block) and say so on the result, which the scheduler folds into
  // state.warnings + the run log. auto/inherit promised no alias: silent.
  const storedPin = ctxSubagentModel(ctx);
  const pinIgnoredWarning = ctxFanOut(ctx) && ctxEndpointRouted(ctx) && SUBAGENT_MODELS.includes(storedPin)
    ? `sub-agent model pin "${storedPin}" ignored: ${node?.key || node?.id || 'agent'} runs on an ` +
      `endpoint-routed model (${JSON.stringify(ctx.claudeOpts?.model ?? '')}) — children run without an explicit model`
    : null;
  return { full, ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools, pinIgnoredWarning };
}

/**
 * Spawn through `runOpts` and capture the session id off the `session` event —
 * `runClaude` resolves `{ text, exitCode }` only. The wrapper forwards every event to
 * the caller's `onEvent` unchanged (runOpts already stamps `role` on it).
 */
async function spawnAgent(full, { role, prompt, systemPrompt, allowedTools }) {
  const opts = runOpts(full, { role, prompt, systemPrompt, allowedTools });
  let sessionId = null;
  const inner = opts.onEvent;
  opts.onEvent = (e) => {
    if (e?.type === 'session' && e.sessionId) sessionId = String(e.sessionId);
    if (typeof inner === 'function') inner(e);
  };
  const { text } = await runClaude(opts);
  return { text, sessionId };
}

/** The output map the scheduler publishes from: an entry per declared port, with a
 *  path where one was allocated and an empty payload for void ports. Exported for
 *  P4's composite `finish` arm. */
export function publishable(ports, outputs) {
  const out = {};
  for (const port of ports?.outputs || []) {
    if (!port) continue;
    out[port.id] = outputs[port.id]?.path ? { path: outputs[port.id].path } : {};
  }
  return out;
}

/**
 * The ONE generic agent executor — the generalization of v1's runGenericProducer and
 * runGenericVerifier and of the nine bespoke runners they replace. Selected for
 * `kind:'agent'` with any `runnerType` other than clarifier.
 */
export async function runAgentExecution(ctx) {
  const { full, ports, meta, outputs, verdict, role, systemPrompt, prompt, allowedTools, pinIgnoredWarning } = await prepare(ctx);
  const { text, sessionId } = await spawnAgent(full, { role, prompt, systemPrompt, allowedTools });
  const review = verdict?.path ? await readVerdict(verdict.path) : null;
  return {
    summary: (text || '').trim() || `${meta.displayName || ctx.node?.key || 'Agent'} completed.`,
    outputs: publishable(ports, outputs),
    verdict: review,
    // Non-fatal problems the scheduler folds into state.warnings + the run log.
    warnings: [
      ...(review?.missing ? [missingVerdictWarning(ctx, verdict.path)] : []),
      ...(pinIgnoredWarning ? [pinIgnoredWarning] : []),
    ],
    sessionId,
    prompt,
  };
}

// ── the clarifier executor ────────────────────────────────────────────────────

/**
 * Normalize an ask payload into enriched answers. Accepts `{answers:[{id,choice}]}` or
 * a bare array; any question the user left out falls back to its first option, so
 * downstream consumers never see a gap. Each answer carries its question text so the
 * row and the History UI render the full Q&A without a join.
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

/**
 * The clarifier executor — selected by `meta.runnerType === 'clarifier'`, NEVER by an
 * agent key, so any number of clarifier nodes per graph is legal. Spawn → read the
 * questions JSON off the FIRST json output port (malformed or empty is tolerated: no
 * gate, empty answers) → gate the human on `clarify-<nodeId>-<ordinal>` → REWRITE that
 * file as `{questions, answers}` in one idempotent full-file write → publish the (now
 * self-contained) token. The snapshot lands only after the publish, so a mid-gate
 * resume re-runs the gate from the questions half.
 */
export async function runClarifierExecution(ctx) {
  const { node, ordinal = 1 } = ctx;
  const { full, ports, meta, outputs, role, systemPrompt, prompt, allowedTools, pinIgnoredWarning } = await prepare(ctx);
  const answersPort = answersPortOf(ports);
  const answersPath = outputs[answersPort?.id]?.path;
  if (!answersPath) throw new Error(`clarifier node "${node?.id}": no json output port to write the questions to`);

  const { sessionId } = await spawnAgent(full, { role, prompt, systemPrompt, allowedTools });

  const { questions } = normalizeClarify(await readJsonMaybe(answersPath));
  // Non-interactive default (v1 `_ask` auto): no gate ⇒ every question takes its first
  // option (normalizeAnswers' fallback). The scheduler's onAsk never sees clarify asks.
  const ask = typeof ctx.ask === 'function' ? ctx.ask : async () => ({ answers: [] });
  let answers = [];
  if (questions.length) {
    if (ctx.pipelineId) {
      await writeStepQuestions(ctx.pipelineId, ctx.executionId, ordinal, {
        agentKey: node?.key, nodeId: node?.id, questions: { questions },
      });
      await writeClarify(ctx.pipelineId, { questions: { questions } });
    }
    const payload = await ask({
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
  return { outputs: publishable(ports, outputs), questions, answers, sessionId, prompt,
    warnings: pinIgnoredWarning ? [pinIgnoredWarning] : [] };
}

// ── flow executors (pure engine: instant, $0, no process spawn) ───────────────

/** Write a file, creating its directory. Synchronous on purpose: the flow cards run
 *  inline in the scheduler's walk. */
function writeOut(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, 'utf8');
}

/**
 * The Task card — the source. Fires once at run start and emits the rendered task
 * document (run title + the user's prompt markdown + the attached-files section). The
 * ADAPTER renders it: `ctx.taskArtifact` is `{ path }` (already on disk — the normal
 * case) or `{ text }`. Without either the execution THROWS (fail-fast: a run whose
 * source card has nothing to emit is a wiring bug, never a silent empty token).
 *
 * A2 (parity-mandatory for the mid-stream entry template): with
 * `config.planStoreSeed`, the document ALSO lands in the plans store at version 1, the
 * emitted token IS that plans-store path, and the run's plan-version counter is
 * consumed at 1 — so the next plan-store write allocates `-v2`.
 */
export function runTaskExecution({ node, taskArtifact, runCtx = {} }) {
  const given = taskArtifact?.path || null;
  let text = typeof taskArtifact?.text === 'string' ? taskArtifact.text : null;
  if (text === null && given) {
    try { text = readFileSync(given, 'utf8'); } catch { text = null; }
  }
  const missing = () => new Error(
    `task node "${node?.id}": no task artifact — the adapter must supply ctx.taskArtifact { path } or { text }`,
  );

  if (node?.config?.planStoreSeed !== true) {
    if (given) return { outputs: { task: { path: given } } };
    if (text === null) throw missing();
    const target = join(runCtx.pipelineDir, 'task.md');
    writeOut(target, text);
    return { outputs: { task: { path: target } } };
  }

  if (text === null) throw missing();
  const version = typeof runCtx.planVersion === 'function' ? Number(runCtx.planVersion()) || 1 : 1;
  const seeded = planPath(runCtx.projectDir, runCtx.baseName, version, runCtx.datePrefix, runCtx.workspaceKey);
  writeOut(seeded, text);
  return { outputs: { task: { path: seeded } } };
}

/** The AND card — the pure synchronizer. Payloads are discarded on purpose: its `out`
 *  is a static void token, which is what makes it reusable sequencing. */
export function runAndExecution({ node }) {                             // eslint-disable-line no-unused-vars
  return { outputs: { out: {} } };
}

/**
 * The OR card — the payload-forwarding valve. INFORMATIONAL in the scheduler path: the
 * scheduler owns any-fresh triggering, freshest selection, the same-drain single
 * emission AND the re-emitted payload (incl. `meta`/`forced`). `bindings` therefore
 * holds EXACTLY ONE entry — the freshest input the scheduler already picked — which
 * this simply forwards.
 */
export function runOrExecution({ node, bindings = {} }) {               // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0];
  if (!token) return { outputs: { out: {} } };
  return { outputs: { out: { type: token.type, path: token.path ?? null, value: token.value ?? null } } };
}

/** The End card — the sink. Records the bound result token and emits NO outputs.
 *  INFORMATIONAL: the scheduler derives `ended.result` from the token it bound. */
export function runEndExecution({ node, bindings = {} }) {              // eslint-disable-line no-unused-vars
  const token = Object.values(bindings)[0] || null;
  return {
    result: { type: token?.type ?? 'void', path: token?.path ?? null, value: token?.value ?? null },
  };
}

/** Order `in1..inN` numerically so the concatenation follows port order, not lexical
 *  order (`in10` must not sort before `in2`). */
function comparePortIds(a, b) {
  const na = /^in(\d+)$/.exec(a);
  const nb = /^in(\d+)$/.exec(b);
  if (na && nb) return Number(na[1]) - Number(nb[1]);
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The Combine card — the payload-bearing md AND-join. Concatenates its bound inputs in
 * PORT order under `## From <node name>` headings and writes one md artifact. `names`
 * maps port id -> the source node's display name (the dispatcher derives it from the
 * template; P4 may pass registry display names); absent one, the port id stands in.
 */
export async function runCombineExecution({ node, bindings = {}, allocatedPath, names = {}, ordinal = 1, runCtx = {} }) {
  const path = allocatedPath || combinePath(node, ordinal, runCtx);
  const parts = [];
  for (const portId of Object.keys(bindings).sort(comparePortIds)) {
    const token = bindings[portId];
    if (!token) continue;
    const name = names[portId] || token.meta?.sourceName || portId;
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

/** Port id -> the display name of the node wired into it (Combine's headings). v2
 *  template nodes carry no `label`; the key (or the node id for a flow card) stands
 *  in unless the caller passes `ctx.names` from the registry's displayName. */
function combineNames(template, nodeId) {
  const byId = new Map((template?.nodes || []).map((n) => [n.id, n]));
  const out = {};
  for (const w of template?.wires || []) {
    if (w?.to?.node !== nodeId) continue;
    const src = byId.get(w.from.node);
    out[w.to.port] = src?.label || src?.key || w.from.node;
  }
  return out;
}

// ── the ONE entry point ───────────────────────────────────────────────────────

/**
 * Select and run this execution. Selection is `node.kind` → flow executor, then
 * `kind:'agent'` → `meta.runnerType` — NEVER an agent key. `opts.runners[runnerType]`
 * is the injected seam (v1's `orchestrator.mjs:306` test hook) and wins when present.
 * @param {object} ctx  the execution context (see the ctx contract in Task 8)
 * @param {{runners?:Record<string,Function>}} [opts]
 */
export function runExecution(ctx, opts = {}) {
  const node = ctx?.node || {};
  switch (node.kind) {
    case 'task': return runTaskExecution(ctx);
    case 'and': return runAndExecution(ctx);
    case 'or': return runOrExecution(ctx);
    case 'end': return runEndExecution(ctx);
    case 'combine':
      return runCombineExecution({ ...ctx, names: ctx.names || combineNames(ctx.template, node.id) });
    case 'agent': break;
    default:
      throw new Error(`node "${node.id}": unknown kind "${node.kind}"`);
  }
  const runnerType = ctx.meta?.runnerType || 'producer';
  const injected = (opts.runners || ctx.runners || {})[runnerType];
  if (typeof injected === 'function') return injected(ctx);
  return runnerType === 'clarifier' ? runClarifierExecution(ctx) : runAgentExecution(ctx);
}

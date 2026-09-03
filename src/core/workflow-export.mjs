// src/core/workflow-export.mjs
// Thin core for "Export to Claude Code": turn a saved Composer workflow into a
// self-contained, runnable Claude Code skill tree under <dest>/.claude/. The
// generator is deterministic; only the generated skill's runtime is interpretive
// ("faithful simulation, not determinism"). See the v4 plan for the full design.
//
// Public surface:
//   planExport(opts)     -> resolve + classify; writes NOTHING (== dry-run)
//   applyExport(opts)    -> resolve + classify + apply resolutions + write
//   exportWorkflow(opts) -> dispatcher: dryRun -> planExport else applyExport
// opts = { workflowId, destination:'global'|'project', projectDir?, slug?,
//          includeAgents=true, dryRun?, onConflict?, resolutions?, repoRoot? }

import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, cp, readdir, rename } from 'node:fs/promises';
import { join, resolve, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkflow, resolveGraph } from './workflows.mjs';
import { exportGraphJson, workflowFileSlug, summarizeUnknownAgents } from './workflow-share.mjs';
import { validatePluginDir, PLUGIN_NAME_RE } from './plugin-manifest.mjs';
import { registryPortsFn } from './graph/registry-ports.mjs';
import { validateGraph, formatIssue } from '../shared/graph/validate.mjs';
import { EFFORTS as EFFORT_LIST } from './model-env.mjs';
import { loadAgentRegistry } from './agent-registry.mjs';
import { slugify } from './artifacts.mjs';
import { isValidSkillName, collectRequiredSkills, resolveSkill, pluginSkillDirs } from './skills.mjs';
import { normalizeProjectPath } from './projects.mjs';
import { defaultRoot } from './settings.mjs';
import { buildGraphManifest } from '../shared/graph/manifest.mjs';
import { portsOf, findPort } from '../shared/graph/ports.mjs';

// ── v1-compat shim (Node-graph v2 rebase) ────────────────────────────────────
// The v2 refactor deleted src/core/channels.mjs (named-channel bus) and stopped
// exporting FRONTMATTER_RE from workflows.mjs. These helpers are consumed ONLY by
// this exporter to keep an exported skill's artifact paths byte-identical to what
// Worca writes at runtime; v2 runtime derives the same basenames from agent
// sidecar port templates, so the values below still match. Inlined here (rather
// than resurrecting channels.mjs) since the exporter is the sole consumer.

/** Canonical leading-`---` YAML frontmatter matcher (was workflows.mjs FRONTMATTER_RE).
 *  Group 1 is the inner YAML; the whole match (m[0]) is the fence block incl. its
 *  trailing newline when present. */
const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\n?/;

/**
 * The review-JSON basename for a producing role key (e.g. 'reviewer' -> 'impl-review').
 * A custom key gets its own `<key>-review` (diverted to `<key>-agent-review` if that
 * would collide with a built-in basename). The full file is `${base}-cycle${N}.json`.
 */
function reviewJsonBasename(key) {
  const k = key || 'reviewer';
  const BESPOKE_BASE = {
    reviewer: 'impl-review',
    refiner: 'refine-review',
    manualWebUiTesting: 'webui-review',
    planReviewer: 'plan-review',
    workspaceReviewer: 'ws-review',
  };
  let base = BESPOKE_BASE[k] || `${k}-review`;
  if (!BESPOKE_BASE[k] && Object.values(BESPOKE_BASE).includes(base)) base = `${k}-agent-review`;
  return base;
}

/** Basenames for the fixed single-file channels (still what v2 writes into the run dir). */
const CHANNEL_FILE_BASENAMES = {
  checklist: 'manual-tests-checklist.md',
  decomposition: 'decomposition.json',
  clarify: 'clarify.json',
};

/** Basename for an open-vocabulary (custom) channel. A channelDef overrides kind
 *  (md|json) and filename; absent a def the channel defaults to `<id>.md`. */
function customChannelBasename(channel, { cycle = 1, channelDefs } = {}) {
  const def = (channelDefs && channelDefs[channel]) || null;
  const ext = def?.kind === 'json' ? 'json' : 'md';
  const stem = String(def?.filename || `${channel}.${ext}`).replace(/\.(md|json)$/i, '');
  return Number(cycle) > 1 ? `${stem}-cycle${cycle}.${ext}` : `${stem}.${ext}`;
}

/** v2 shim for the removed agent-registry collectChannelDefs(): v2 has no v1 channel
 *  defs (custom channels are ports now), so there is no legacy def map to collect. The
 *  v2 plan-walk port (see buildExportSet) will source custom-channel filenames from
 *  port templates instead. */
function collectChannelDefs() { return {}; }

// Inlined from ui/public/composer-core.mjs (DOM-free) to keep core free of a ui import.
// The browser module cannot import from src/core (no build step) and core avoids a ui import,
// so this is a deliberate copy — kept byte-equivalent to composer-core's distinctAgents and
// guarded against drift by test/workflow-export-generate.test.mjs. Exported for that guard.
export function distinctAgents(steps) {
  const seen = [];
  for (const col of steps) for (const node of col) if (!seen.includes(node.key)) seen.push(node.key);
  return seen;
}

/** Coded error so surfaces can map to HTTP/exit codes. */
function err(message, code) { return Object.assign(new Error(message), { code }); }
// codes: BAD_REQUEST | NOT_FOUND | UNSUPPORTED | MISSING_SKILL | CONFLICT | CANCELLED

/**
 * Emit a YAML single-quoted flow scalar for a frontmatter value. A single-quoted
 * scalar treats every character literally except `'` (escaped by doubling), so a
 * description containing `: `, ` #`, or `"` can never break the `---` fence — the
 * class of bug an unquoted `description: ${raw}` interpolation invites. Newlines are
 * pre-collapsed by callers so the value stays on one line.
 */
function yamlScalar(s) { return `'${String(s == null ? '' : s).replace(/'/g, "''")}'`; }

/**
 * Durable write: write to a temp sibling, then atomically rename over the target so a
 * crash or concurrent read never observes a half-written file. A partial write would
 * corrupt the content-hash stamp and make the NEXT export mis-classify the file as
 * "locally modified" (a spurious conflict). Mirrors settings.mjs's persist pattern.
 */
async function writeFileAtomic(path, text) {
  const tmp = `${path}.${randomBytes(4).toString('hex')}.tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, path);
}

/** Blanket conflict policies accepted by applyExport's `onConflict` (CLI + API share these). */
export const ON_CONFLICT_MODES = ['skip', 'overwrite', 'namespace'];
/** Per-path resolution choices accepted in `resolutions` (see classify's `options`). */
export const RESOLUTION_CHOICES = ['keep', 'overwrite', 'namespace', 'cancel'];

// ── Step 1: destination + slug resolution & path-safety ──────────────────────

const STRIPPED_TOOLS = new Set([
  'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Workflow',
  'ScheduleWakeup', 'TaskOutput', 'WaitForMcpServers', 'EndConversation',
]);
// Advisory efforts an exported node may carry — model-env's canonical list ('low' is
// intentionally absent there: Worca couples it to the model). Env-bound nodes are
// identified by the registry's scope (below), never a hardcoded key list.
const EFFORTS = new Set(EFFORT_LIST);

/** Resolve the destination ROOT (`.claude` is written beneath it). */
function resolveDest({ destination, projectDir }) {
  if (destination === 'global') return resolve(defaultRoot());
  if (destination === 'project') {
    const p = normalizeProjectPath(projectDir);
    if (!p) throw err('projectDir is required for a project export', 'BAD_REQUEST');
    return p;
  }
  throw err(`destination must be 'global' or 'project' (got ${JSON.stringify(destination)})`, 'BAD_REQUEST');
}

/** Every write path MUST resolve inside dest/.claude — belt-and-suspenders over slug validation. */
function safeJoin(dest, ...parts) {
  const full = resolve(dest, '.claude', ...parts);
  const root = resolve(dest, '.claude') + sep;         // containment is against dest/.claude, per the doc
  if (!full.startsWith(root)) throw err(`refusing to write outside destination: ${full}`, 'BAD_REQUEST');
  return full;
}

function assertName(name, what) {
  if (!isValidSkillName(name)) throw err(`invalid ${what} "${name}" (allowed: letters, digits, . _ - ; not . or ..)`, 'BAD_REQUEST');
  return name;
}

// ── Step 1: metadata stamp + content hash ────────────────────────────────────

// FRONTMATTER_RE is defined above (v1-compat shim). Group 1 is the inner YAML; the
// whole match (m[0]) is the fence block incl. its trailing newline.
// The trailing `\n\n` is part of the stamp region so the strip is the EXACT inverse of the insert.
const STAMP_RE = /<!--\s*worca-cc-export:\n([\s\S]*?)\n-->\n\n/;   // the inert block + its blank line

function sha256(text) { return 'sha256:' + createHash('sha256').update(text, 'utf8').digest('hex'); }

/** stamp: { key, workflow, version, updatedAt, contentHash } -> comment block string */
function stampBlock(s) {
  return `<!-- worca-cc-export:\nkey: ${s.key}\nworkflow: ${s.workflow}\nversion: ${s.version}\n` +
    `updatedAt: ${s.updatedAt || ''}\ncontentHash: ${s.contentHash}\n-->`;
}
function parseStampBlock(text) {
  const m = text.match(STAMP_RE);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':'); if (i < 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** Produce final .md bytes: hash the stampless body, then insert the stamp after frontmatter. */
function stampMarkdown(body, ident) {                 // body has NO stamp yet
  const contentHash = sha256(body);
  const block = stampBlock({ ...ident, contentHash }) + '\n\n';   // the '\n\n' is owned by STAMP_RE
  const fm = body.match(FRONTMATTER_RE);
  // Function replacer (NOT a string) so `$`-sequences in the frontmatter — e.g. a workflow
  // name/description containing `$'`, `$&`, `$1` — are inserted literally instead of being
  // interpreted by String.prototype.replace. fm[0] is the whole fence block.
  const withStamp = fm ? body.replace(FRONTMATTER_RE, () => fm[0] + block) : block + body;
  return { text: withStamp, contentHash };
}
/** Read an existing .md: recover its stamp + the hash of its current stampless body. */
function readMarkdownStamp(text) {
  const stripped = text.replace(STAMP_RE, '');        // removes block AND the '\n\n' it added → exact inverse
  return { stamp: parseStampBlock(text), currentHash: sha256(stripped) };
}

/** workflow.json: stamp lives in `_worca`; hash covers the semantic payload only. */
function stampJson(payload, ident) {                  // payload = {name,domain,steps,feedbacks}
  const contentHash = sha256(JSON.stringify(payload));
  const obj = { ...payload, _worca: { ...ident, contentHash } };
  return { text: JSON.stringify(obj, null, 2) + '\n', contentHash };
}
function readJsonStamp(text) {
  let obj; try { obj = JSON.parse(text); } catch { return { stamp: null, currentHash: null }; }
  const { _worca, ...payload } = obj || {};
  return { stamp: _worca || null, currentHash: sha256(JSON.stringify(payload)) };
}

// ── Step 1: classification ───────────────────────────────────────────────────

/**
 * Compare an intended file (incoming) against what is on disk (existing).
 * Returns { action:'create'|'noop'|'update'|'conflict', reason?, options? }.
 * version is the primary tiebreak, updatedAt secondary, contentHash the idempotency key.
 */
function classify(existing, incoming, { namespaceable }) {
  if (!existing.exists) return { action: 'create' };
  if (incoming.contentHash === existing.currentHash) return { action: 'noop' }; // idempotent
  // Per-conflict options are derived from RESOLUTION_CHOICES (the single source the CLI and
  // server validate against), never re-listed inline — so a new choice can't silently diverge
  // from what applyExport accepts. 'cancel' is intentionally NOT offered per-conflict: it aborts
  // the WHOLE export (see applyExport), which a per-file radio misrepresents as a per-file skip;
  // a whole-export cancel is the modal's Cancel button. 'namespace' is offered only when the
  // target can actually be renamed.
  const CONFLICT = (reason) => ({
    action: 'conflict', reason,
    options: RESOLUTION_CHOICES.filter((c) => c !== 'cancel' && (namespaceable || c !== 'namespace')),
  });
  if (!existing.stamp) return CONFLICT('unmanaged file (no worca-cc-export metadata)');
  if (existing.currentHash !== existing.stamp.contentHash) return CONFLICT('locally modified since last export');
  if (existing.stamp.workflow !== incoming.workflow) return CONFLICT('different workflow lineage, content differs');
  // Same lineage, and the on-disk file is byte-for-byte our last export (verified just
  // above), so nothing the user authored is at risk. Order by version, then updatedAt.
  const vi = Number(incoming.version) || 0, ve = Number(existing.stamp.version) || 0;
  if (vi < ve) return CONFLICT('the exported copy is a newer version');
  if (vi > ve) return { action: 'update' };
  const ui = incoming.updatedAt || '', ue = existing.stamp.updatedAt || '';
  if (ui && ue && ui < ue) return CONFLICT('the exported copy has a newer updatedAt');
  // Equal identity (incl. frozen constants like wf_default: version 1, epoch updatedAt) but
  // differing content ⇒ only the GENERATOR changed. Regenerate cleanly instead of forcing a
  // CONFLICT on every legitimate refresh.
  return { action: 'update' };
}

async function inspect(path, kind) {                  // kind: 'md' | 'json'
  if (!existsSync(path)) return { exists: false, stamp: null, currentHash: null };
  const text = await readFile(path, 'utf8');
  const r = kind === 'json' ? readJsonStamp(text) : readMarkdownStamp(text);
  return { exists: true, ...r };
}

// ── Step 2: capability layer ─────────────────────────────────────────────────

function applyCapabilityLayer(node) {
  const consoleTools = new Set((Array.isArray(node.tools) ? node.tools : [])
    .filter((t) => !STRIPPED_TOOLS.has(t)));            // drop hard-stripped (incl. AskUserQuestion)
  // Fan-out (A). The registry already resolves this per node (e.g. decomposer.meta.json
  // sets fanOut:true), so trust node.fanOut rather than re-hardcoding keys here.
  const fanOut = !!node.fanOut;
  if (fanOut) { consoleTools.add('Agent'); consoleTools.add('Task'); }
  // Effort (A) — advisory prose, and ONLY when a model is present (Worca couples them).
  const effort = node.model && node.effort && EFFORTS.has(node.effort) ? node.effort : null;
  return {
    ...node,
    consoleTools: [...consoleTools],
    fanOut,
    effort,                                             // may be null
    model: node.model || null,                          // omit from frontmatter when null
    askQuestions: !!node.askQuestions,                  // (B) hoisted to the SKILL body
  };
}

// ── Step 2: v2 ports/wires → console filenames ───────────────────────────────
// The exported skill keeps its own simplified `$RUN_DIR`-relative filenames (the
// "faithful simulation, not determinism" contract). v2 gives us the authoritative
// wiring via typed ports + wires; we translate each port to the SAME console name a
// v1 export used, so the exported-skill layout is unchanged. Producer/consumer paths
// are derived from the wires (no more `connectsTo` review-source guessing).

/** The artifact kind a port names — explicit `artifactKind`, else the `{base}-<kind>.md`
 *  capture (impl-review/plan-review/ws-review), else the port id (mirrors executor.mjs). */
function portArtifactKind(port) {
  if (port?.artifactKind) return port.artifactKind;
  const m = /^\{base\}-(.+)\.md$/.exec(port?.filename || '');
  return m ? m[1] : (port?.id || '');
}

/**
 * Console `$RUN_DIR`-relative filename an OUTPUT port writes, or:
 *   undefined → a pure control signal (void port; nothing on disk),
 *   null      → the working tree (a code side-effect, no artifact file).
 * A `when:'blocking'` output is a loop GATE — the runner reads the producer's verdict
 * JSON (`<reviewJsonBasename(key)>-cycleN.json`), exactly as a real run writes it.
 */
function outputConsoleFile(nodeKey, port, cycle = 1, channelDefs) {
  if (!port || port.type === 'void') return undefined;   // done/pass: control-flow only
  if (port.when === 'blocking') return `${reviewJsonBasename(nodeKey)}-cycle${cycle}.json`;
  switch (portArtifactKind(port)) {
    case 'clarify':       return CHANNEL_FILE_BASENAMES.clarify;          // clarify.json
    case 'plan':          return cycle > 1 ? `plan-cycle${cycle}.md` : 'plan.md';
    case 'decomposition': return CHANNEL_FILE_BASENAMES.decomposition;
    case 'checklist':     return CHANNEL_FILE_BASENAMES.checklist;
    default:
      // Open vocabulary (custom agent output). Prefer the port's own filename; else the
      // shared basename builder — so an exported custom path matches what a run mints.
      return port.filename
        ? String(port.filename).replace(/\{base\}-?|\{vsuffix\}/g, '').replace(/\{cycle\}/g, String(cycle))
        : customChannelBasename(portArtifactKind(port), { cycle, channelDefs });
  }
}

/**
 * The console file a consumer reads for a given INPUT port, tracing its inbound wire
 * back to the producing OUTPUT port. Returns undefined (skip: unwired optional / signal),
 * null (the working tree), or a `$RUN_DIR`-relative filename.
 */
function consumedConsoleFile(graph, node, inPort, cycle, channelDefs) {
  if (!inPort || inPort.synthetic) return undefined;     // the synthetic `await` port
  if (inPort.type === 'void' || inPort.as === 'worktree') return null;   // the working tree / a signal
  // The runner hoists AskUserQuestion: a clarify `answers` consumer reads the ANSWERS file.
  if (inPort.id === 'answers' || inPort.as === 'answers') return 'clarify-answers.json';
  const wire = (graph.template.wires || []).find((w) => w?.to?.node === node.id && w?.to?.port === inPort.id);
  if (!wire) return undefined;                           // unwired optional input
  return producerFileFor(graph, wire.from.node, wire.from.port, cycle, channelDefs, new Set());
}

/** Console file the producer at (srcNodeId, srcPortId) writes. Follows flow cards
 *  (task→prompt.md; and/or/combine→their first resolvable inbound) up to the source agent. */
function producerFileFor(graph, srcNodeId, srcPortId, cycle, channelDefs, seen) {
  if (seen.has(srcNodeId)) return undefined;             // cycle guard (loop wires)
  seen.add(srcNodeId);
  const tnode = (graph.template.nodes || []).find((n) => n.id === srcNodeId);
  if (!tnode) return undefined;
  if (tnode.kind === 'task') return 'prompt.md';         // the user prompt
  if (tnode.kind === 'end') return undefined;
  if (tnode.kind === 'agent') {
    const key = graph.nodes[srcNodeId]?.key || tnode.key;
    return outputConsoleFile(key, findPort(portsOf(graph.ports, tnode), srcPortId, 'out'), cycle, channelDefs);
  }
  // and/or/combine: a pass-through merge — resolve to the first inbound producer file.
  for (const w of (graph.template.wires || []).filter((x) => x?.to?.node === srcNodeId)) {
    const f = producerFileFor(graph, w.from.node, w.from.port, cycle, channelDefs, seen);
    if (f !== undefined) return f;
  }
  return undefined;
}

/** Derive an agent node's input/output console files as ordered, de-duped lists (each
 *  entry is a `$RUN_DIR`-relative filename, or null for "the working tree"). Named
 *  `reads`/`writes` — the v1 `consumes`/`produces` vocabulary is retired and banned. */
function deriveNodeIo(graph, tnode, nodeKey, { cycle = 1, channelDefs } = {}) {
  const ports = portsOf(graph.ports, tnode);
  const uniq = (arr) => {
    const seen = new Set(); const out = [];
    for (const f of arr) { const k = f === null ? '\0worktree' : f; if (!seen.has(k)) { seen.add(k); out.push(f); } }
    return out;
  };
  const reads = uniq(ports.inputs
    .map((p) => consumedConsoleFile(graph, tnode, p, cycle, channelDefs))
    .filter((f) => f !== undefined));
  let writes = uniq(ports.outputs
    .map((p) => outputConsoleFile(nodeKey, p, cycle, channelDefs))
    .filter((f) => f !== undefined));
  // A code side-effect node (implementer) has only a void `done` output but writes the
  // working tree — preserve the v1 rendering rather than showing "(none)".
  if (!writes.length && graph.nodes[tnode.id]?.meta?.sideEffect === 'code') writes = [null];
  return { reads, writes };
}

// ── Step 2: buildExportSet (shared deterministic core) ───────────────────────

async function buildExportSet({ workflowId, destination, projectDir, slug, includeAgents = true, repoRoot }) {
  const tpl = await readWorkflow(workflowId);
  if (!tpl) throw err(`workflow not found: ${workflowId}`, 'NOT_FOUND');

  const dest = resolveDest({ destination, projectDir });
  const finalSlug = assertName(slug || slugify(tpl.name).slice(0, 48) || 'workflow', 'slug');

  const registry = loadAgentRegistry();
  const channelDefs = collectChannelDefs(registry);     // custom channel kind/filename map (mirrors allocate())
  // Global export = defaults-only (projectDir null, enabled by the §4.2 guard); project export bakes config.

  // ── Resolve the v2 node/wire graph, then rebuild the v1-shaped { steps, feedbacks }
  //    plan the generator below reads. buildGraphManifest gives the topological rank
  //    LEVELS (its `{kind:'agents'}` cells) and the feedback loops; each cell is joined
  //    with resolveGraph's full node (tools/fanOut/askQuestions/model/effort/meta) and
  //    its consumes/produces (derived from ports + wires, §2). Flow cards (task/end/
  //    and/or/combine) are NOT dispatched — only agent nodes become steps.
  const graph = await resolveGraph(destination === 'project' ? projectDir : null, workflowId, registry);
  const manifest = buildGraphManifest(graph.template, graph.agentsByKey,
    { overlays: { nodes: graph.nodes, wires: graph.wires } });
  const tnodeById = new Map((graph.template.nodes || []).map((n) => [n.id, n]));
  const enrich = (cell) => {
    const rn = graph.nodes[cell.id] || {};
    const io = deriveNodeIo(graph, tnodeById.get(cell.id), rn.key, { channelDefs });
    return {
      nodeId: cell.id, key: rn.key, uiPhase: cell.uiPhase,
      tools: Array.isArray(rn.tools) ? rn.tools : [],
      model: rn.model || null, effort: rn.effort || null,
      fanOut: !!rn.fanOut, askQuestions: !!rn.askQuestions,
      reads: io.reads, writes: io.writes,
    };
  };
  const steps = manifest.steps
    .filter((c) => c.kind === 'agents')
    .map((c) => c.nodes.filter((cell) => cell.key).map(enrich))   // agent cells only (key !== null)
    .filter((group) => group.length);                             // drop levels that were all flow cards
  const resolved = { id: tpl.id, name: tpl.name, steps, feedbacks: manifest.feedbacks };

  const warnings = [];

  // ── Refuse environment-bound nodes (specific message: which node, why) ──
  for (const group of resolved.steps) {
    for (const node of group) {
      if (registry[node.key]?.scope === 'workspace-only') {
        throw err(
          `node "${node.key}" (${node.nodeId}) requires a Worca multi-repo workspace ` +
          `(member checkouts + per-member diffs) and cannot run as a single-repo console skill.`,
          'UNSUPPORTED',
        );
      }
      const declared = Array.isArray(node.tools) ? node.tools : [];
      const stripped = declared.filter((t) => STRIPPED_TOOLS.has(t) && t !== 'AskUserQuestion');
      if (stripped.length) warnings.push(`node "${node.key}": dropped subagent-incompatible tool(s): ${stripped.join(', ')}`);
    }
  }

  // ── Per-node capability layer (deterministic; produces console tools + body clauses) ──
  const nodes = resolved.steps.map((group) => group.map((node) => applyCapabilityLayer(node)));

  // ── Feedback loops: resolve each `from`/`to` instance-id to node keys -> gate basename ──
  const nodeById = new Map();
  for (const g of resolved.steps) for (const n of g) nodeById.set(n.nodeId, n);
  const loops = resolved.feedbacks.map((fb) => {
    const fromNode = nodeById.get(fb.from);
    const toNode = nodeById.get(fb.to);
    if (!fromNode) warnings.push(`feedback ${fb.id}: unknown 'from' node ${fb.from}; defaulting gate to impl-review`);
    if (!toNode) warnings.push(`feedback ${fb.id}: unknown 'to' node ${fb.to}; the loop's fix target defaults to 'reviewer'`);
    const fromKey = fromNode ? fromNode.key : 'reviewer';
    return {
      ...fb, fromKey, toKey: toNode ? toNode.key : null,
      gateBasename: reviewJsonBasename(fromKey), selfLoop: fb.from === fb.to,
    };
  });

  // ── Select distinct agents ──
  const keys = distinctAgents(resolved.steps);          // ordered unique node.key
  const agents = keys.map((key) => {
    const meta = registry[key] || {};
    const stem = assertName(String(meta.agentFile || `${key}.md`).replace(/\.md$/, ''), 'agent name');
    return { key, meta, stem };
  });

  // ── Resolve skill deps (resolve-and-fill; loud fail on unresolvable) ──
  const depSkills = includeAgents ? resolveDepSkills(registry, graph.agentKeys, dest, destination, projectDir, repoRoot) : [];

  // The SKILL.md always dispatches the pipeline's agents by subagent_type. With includeAgents
  // off, none of those .md files are written — the skill only runs if the agents already exist at
  // the destination. Warn loudly so a caller who exports agent-less by mistake isn't left with a
  // skill that fails at its first dispatch, with no signal until run time.
  if (!includeAgents && agents.length) {
    warnings.push(
      `agents NOT exported (includeAgents=false): the skill dispatches ${agents.map((a) => a.stem).join(', ')} — ` +
      `those agents must already exist under the destination's .claude/agents or the skill will fail at dispatch.`,
    );
  }

  // ── Stamp lineage identity shared by every emitted file ──
  const ident = { workflow: tpl.id, version: tpl.version || 1, updatedAt: tpl.updatedAt || '' };

  return { tpl, template: graph.template, dest, slug: finalSlug, resolved, nodes, loops, agents, depSkills, ident, warnings, includeAgents, agentSrcCache: new Map() };
}

// ── Step 3: SKILL.md generation ──────────────────────────────────────────────

/** Map a feedback instance id (e.g. 's2_0') to its node key using the resolved topology. */
function instanceKey(resolved, instanceId) {
  for (const g of resolved.steps) for (const n of g) if (n.nodeId === instanceId) return n.key;
  return 'reviewer';
}

function makeSkillMd(set, nameFor) {
  const { tpl, slug, resolved, nodes, loops } = set;
  const desc = (
    `Run the "${tpl.name}" workflow (exported from Worca Composer) end-to-end in this repo: ` +
    `${resolved.steps.map((g) => g.map((n) => n.uiPhase).join('+')).join(' → ')}. ` +
    `Clarify asks you real questions; feedback loops iterate on critical/major issues.`
  ).replace(/\n+/g, ' ');   // collapse any newline (e.g. from tpl.name) so the quoted scalar stays one line

  const L = [];
  // description is YAML-quoted: tpl.name may contain ':', '#', or quotes that would otherwise
  // break the frontmatter fence. slug is already validated to [A-Za-z0-9._-], so it needs none.
  L.push('---', `name: ${slug}`, `description: ${yamlScalar(desc)}`, '---', '');
  L.push(`# ${tpl.name} — exported pipeline`, '');
  L.push('Run this pipeline yourself (you are the runner). Recommended: launch Claude Code with',
         '`--permission-mode acceptEdits` so subagent edits do not block on prompts.', '');

  // Invariants — hardening so a step/loop is never dropped.
  L.push('## Invariants (never violate)', '',
    '1. Run every step below in the given order. Never skip, merge, or reorder a step.',
    '2. Nodes under the same step are dispatched IN PARALLEL — one message, multiple Task calls.',
    '3. One node = one subagent (`subagent_type`). Never combine two nodes into one dispatch.',
    '4. A loop gate is blocking ONLY for severity `critical` or `major`; any other/unknown severity is non-blocking.',
    '5. The current cycle for a gate is the highest N present on disk (`ls`); start at 1.',
    '6. Never exceed a loop\'s max cycles. At the cap with blocking issues open, STOP and ask the user.',
    '7. Pass each subagent the EXACT absolute paths given here; artifacts flow only through those files.',
    '8. Do all work on the run branch created in Setup; never switch back to or edit the user\'s original branch.',
    '9. Never `git add`, `git commit`, or `git push`. The run leaves working-tree edits and `$RUN_DIR` artifacts on disk, uncommitted, for the user to review.', '');

  // Runtime setup: isolate on a branch, keep every change uncommitted.
  L.push('## Setup', '',
    'Isolate this run on its own git branch and keep every change **uncommitted** — this',
    'pipeline writes files (working-tree edits + `$RUN_DIR` artifacts) but never runs `git add`,',
    '`git commit`, or `git push`. You review and commit yourself afterward.', '',
    '```bash',
    '# 1. Branch: reuse the branch the user named for this run, else cut a fresh one.',
    '#    Set BRANCH to the user-specified branch; leave it empty to auto-create.',
    '#    (Skips cleanly when the destination is not a git repository.)',
    'BRANCH=""',
    'if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '  [ -n "$BRANCH" ] || BRANCH="worca/' + slug + '-$(date +%Y%m%d-%H%M%S)"',
    '  git switch "$BRANCH" 2>/dev/null || git switch -c "$BRANCH"',
    '  # keep run artifacts local-only (never staged/committed) via the repo-local exclude file',
    '  grep -qxF "ai-artifacts/" .git/info/exclude 2>/dev/null || echo "ai-artifacts/" >> .git/info/exclude',
    'fi',
    '',
    '# 2. Run-local artifacts: saved on disk, never committed.',
    'RUN_DIR="ai-artifacts/pipelines/$(date +%Y-%m-%d)-' + slug + '"',
    'mkdir -p "$RUN_DIR"',
    '```',
    'All `$RUN_DIR/...` paths below are absolute once `$RUN_DIR` is resolved. Write the user prompt to `$RUN_DIR/prompt.md` first.', '');

  // Steps.
  resolved.steps.forEach((group, i) => {
    const flat = nodes[i];
    L.push(`## Step ${i + 1}${flat.length > 1 ? ' (dispatch all nodes in parallel)' : ''}`, '');
    flat.forEach((n) => {
      const dispatch = nameFor(n.key);
      // n.reads / n.writes are pre-derived console files (a `$RUN_DIR`-relative name,
      // or null for "the working tree"), computed from v2 ports+wires in deriveNodeIo.
      const render = (f) => (f ? `\`$RUN_DIR/${f}\`` : 'the working tree');
      const readsLine = (n.reads || []).map(render).join(', ') || '(the user prompt)';
      const writesLine = (n.writes || []).map(render).join(', ') || '(none)';
      L.push(`### Dispatch \`${dispatch}\``);
      L.push(`- Consumes: ${readsLine}`);
      L.push(`- Produces: ${writesLine} (review/plan filenames shown at cycle 1; use the current cycle N at runtime)`);
      if (n.model) L.push(`- Model: dispatch with \`model: ${n.model}\`.`);
      if (n.effort) L.push(`- Effort: instruct the subagent to work at **${n.effort}** effort.`);
      if (n.fanOut) L.push('- Fan-out: this subagent MAY dispatch parallel READ-ONLY research subagents (it has `Agent`). Skip for trivial single-file work.');
      if (n.askQuestions) {
        L.push('- Ask-user (hoisted): this subagent CANNOT ask you directly. It writes its questions as JSON',
          `  to \`$RUN_DIR/${CHANNEL_FILE_BASENAMES.clarify}\` in AskUserQuestion's schema`,
          '  `{"questions":[{"question","header","options","multiSelect"}]}`. After it returns, **YOU** call',
          '  `AskUserQuestion` with those questions, then write the answers to `$RUN_DIR/clarify-answers.json`',
          '  and pass that path into every later node that consumes `clarify`.');
      }
      L.push('');
    });
  });

  // Feedback loops.
  loops.forEach((fb) => {
    const gate = `$RUN_DIR/${fb.gateBasename}-cycle<N>.json`;
    const fromName = nameFor(fb.fromKey);                 // the DISPATCH name, not the raw node key
    const target = fb.selfLoop ? 'itself' : nameFor(instanceKey(resolved, fb.to));
    L.push(`## Feedback loop: ${fromName} → ${fb.selfLoop ? 'itself' : target} (max ${fb.maxCycles} cycles)`, '',
      `1. After \`${fromName}\` writes \`${gate}\`, read that file (highest N on disk).`,
      '2. Parse `{issues:[{severity,...}],summary}`. It is **blocking** if any issue severity (lower-cased) is `critical` or `major`.',
      fb.selfLoop
        ? `3. If blocking and N < ${fb.maxCycles}: re-dispatch \`${fromName}\` at cycle N+1 (it writes a fresh gate + updated artifact). Repeat.`
        : `3. If blocking and N < ${fb.maxCycles}: dispatch \`${target}\` in FIX mode with the review path, then re-dispatch \`${fromName}\` at cycle N+1. Repeat.`,
      '4. If NOT blocking: the loop is satisfied; continue.',
      `5. If N reaches ${fb.maxCycles} with blocking issues still open: STOP, show the open critical/major issues, and ask the user whether to continue or accept.`, '');
  });

  return L.join('\n');
}

// ── Step 4: agent .md emission ───────────────────────────────────────────────

async function readAgentSource(meta, cache) {
  const path = meta.agentPath;                          // absolute; computed by the registry for every origin
  if (!path || !existsSync(path)) throw err(`agent source not found for "${meta.key}"`, 'NOT_FOUND');
  // Optional per-export cache: a blanket --on-conflict=namespace classifies agents TWICE
  // (a plain-stem discovery pass + the final pass). The raw source is identical across both,
  // so cache it to avoid reading every agent file from disk a second time.
  if (cache && cache.has(path)) return cache.get(path);
  const src = await readFile(path, 'utf8');
  if (cache) cache.set(path, src);
  return src;
}
function bodyAfterFrontmatter(src) {
  const m = src.match(FRONTMATTER_RE);
  return m ? src.slice(m[0].length) : src;
}

async function makeAgentMd(agent, node, finalName, srcCache) {
  const src = await readAgentSource(agent.meta, srcCache);
  let body = bodyAfterFrontmatter(src)
    .replace(/^MOCK_[A-Z_]+:.*$/gm, '')                 // drop stray mock markers
    .trimStart();

  // `tools:` frontmatter. An empty (or omitted) list makes a Claude Code subagent INHERIT
  // ALL TOOLS. That's acceptable for an agent that declared none (it never had a restricted
  // set) — we omit the line so it inherits cleanly. But if the agent DECLARED tools and every
  // one was stripped as subagent-incompatible, emitting an empty list would silently broaden a
  // restricted node to all tools — refuse instead. AskUserQuestion is compatible-via-hoist
  // (buildExportSet treats it as compatible, NOT a dropped incompatible tool), so — exactly
  // like an ask-only node (declares only AskUserQuestion) — a node that ALSO declares it may
  // inherit all tools even when its other declared tools were all stripped. Refuse only when
  // the node declared real tools, every one was stripped, AND it has no ask-hoist to fall back
  // on; otherwise `[AskUserQuestion, Workflow]` would abort while `[AskUserQuestion]` succeeds.
  const declared = Array.isArray(node.tools) ? node.tools : [];
  const hasAskHoist = declared.includes('AskUserQuestion');
  const declaredCount = declared.filter((t) => t !== 'AskUserQuestion').length;
  if (!node.consoleTools.length && declaredCount && !hasAskHoist) {
    throw err(`node "${node.key}" declared only subagent-incompatible tool(s) (all stripped); ` +
      `an empty "tools:" list would make the exported agent inherit ALL tools. ` +
      `Give it at least one console-compatible tool.`, 'BAD_REQUEST');
  }
  // YAML-quote the description: agent.meta.description is user-authored (via createAgent) and may
  // contain ':', '#', or quotes that would otherwise break the frontmatter fence.
  const agentDesc = (agent.meta.description || node.uiPhase + ' node exported from Worca').replace(/\n+/g, ' ');
  const fm = ['---', `name: ${finalName}`, `description: ${yamlScalar(agentDesc)}`];
  if (node.consoleTools.length) fm.push(`tools: ${node.consoleTools.join(', ')}`);   // omit → inherit (declared none)
  if (node.model) fm.push(`model: ${node.model}`);       // omit entirely when unset
  fm.push('---');

  const preamble = [
    '', '## Console adaptation (read first)',
    'You run as a dispatched Claude Code subagent — there is NO Worca orchestrator, SQLite store, or run channel.',
    'Ignore any text below that names a Worca orchestrator, database, MOCK markers, or specific minted filenames.',
    '**The absolute file paths in your dispatch prompt are authoritative** — read your inputs from and write your',
    'outputs to exactly those paths, and nothing else.',
  ];
  if (node.fanOut) {
    preamble.push('', 'You MAY dispatch parallel READ-ONLY research subagents (you have the `Agent` tool) to investigate',
      'multiple areas at once; synthesize their findings yourself. Skip this for trivial single-file work.');
  }
  if (node.askQuestions) {
    preamble.push('', 'You CANNOT ask the user directly (no `AskUserQuestion`). When you need a decision, write your',
      'questions as JSON to the clarify path in your dispatch prompt, shaped',
      '`{"questions":[{"question","header","options","multiSelect"}]}`; the runner asks and returns the answers.');
  }
  if (node.effort) preamble.push('', `Work at **${node.effort}** effort.`);

  return `${fm.join('\n')}\n${preamble.join('\n')}\n\n${body}`.trimEnd() + '\n';
}

// ── Step 5: workflow.json snapshot ───────────────────────────────────────────

function makeWorkflowJson(set) {
  const { tpl, template, slug, ident } = set;
  // v2 lineage snapshot: the node/wire graph (was v1 steps/feedbacks). `template` is
  // resolveGraph's resolved clone (agent keys post workspace-substitution); fall back
  // to the stored tpl fields defensively.
  const payload = {
    name: tpl.name, domain: tpl.domain || 'general', version: 2,
    nodes: template?.nodes ?? tpl.nodes ?? [], wires: template?.wires ?? tpl.wires ?? [],
  };
  return stampJson(payload, {                            // key marks skill lineage; carry version/updatedAt from ident
    key: `skill:${slug}`, workflow: ident.workflow, version: ident.version, updatedAt: ident.updatedAt,
  });
}

// ── Step 6: skill-dependency resolution — resolve-and-fill ───────────────────

/**
 * Resolve-and-fill for the skills the given agents require. Exported for the
 * plugin exporter (#421), which passes `layout:'plugin'` (the "already at the
 * destination" probe becomes `<dest>/skills/<name>/SKILL.md`) and
 * `skipSources:['bundle']` (a Worca-shipped skill is present on every host, so
 * it is reported as skipped rather than copied — the agent analogue is "built-ins
 * are never bundled"). Default options reproduce the Claude Code export exactly.
 * @returns {Array<{skill, requiredBy, resolvedFrom, srcDir, fill:boolean, skipped?:true}>}
 */
export function resolveDepSkills(registry, agentKeys, dest, destination, projectDir, repoRootOverride, opts = {}) {
  const layout = opts.layout === 'plugin' ? 'plugin' : 'claude';
  const skipSources = new Set(Array.isArray(opts.skipSources) ? opts.skipSources : []);
  const required = collectRequiredSkills(registry, agentKeys);   // [{skill, requiredBy, origin?}]
  // fileURLToPath (not URL.pathname) — correct on Windows and for paths with spaces.
  const repoRoot = repoRootOverride || resolve(fileURLToPath(new URL('../../', import.meta.url)));
  const ctx = {
    repoRoot,
    projectDir: destination === 'project' ? projectDir : dest,
    homeDir: defaultRoot(),
    // Mirror the orchestrator's skillCtx (orchestrator.mjs) so a plugin-imported
    // workflow that RUNS also EXPORTS: without pluginDirs/origin, resolveSkill's chain
    // never probes the owning plugin and a plugin-bundled dep throws MISSING_SKILL.
    pluginDirs: pluginSkillDirs(),
  };
  const out = [];
  const missing = [];
  for (const r of required) {
    if (!isValidSkillName(r.skill)) { missing.push({ ...r, searched: [] }); continue; }
    // resolve-and-fill idempotency: if the skill is ALREADY at the destination
    // (dest/.claude/skills/<name>), leave it untouched. This must be checked directly
    // rather than via resolveSkill.source, because resolveSkill's chain probes the
    // source-repo `bundle` (repoRoot/skills) BEFORE the destination scopes — a bundle
    // hit is a SOURCE to copy from, not proof the dep is present at the destination.
    const destSkillMd = layout === 'plugin'
      ? join(dest, 'skills', r.skill, 'SKILL.md')
      : join(dest, '.claude', 'skills', r.skill, 'SKILL.md');
    if (existsSync(destSkillMd)) {
      out.push({ ...r, resolvedFrom: 'destination', srcDir: dirname(destSkillMd), fill: false });
      continue;
    }
    // Not at the destination → locate a source (bundle/global/plugin/owner) to fill from.
    const hit = resolveSkill(r.skill, { ...ctx, origin: r.origin ?? null }); // {source, path, searched}
    if (hit.source && skipSources.has(hit.source)) {
      out.push({ ...r, resolvedFrom: hit.source, srcDir: hit.path, fill: false, skipped: true });
      continue;
    }
    if (hit.source) { out.push({ ...r, resolvedFrom: hit.source, srcDir: hit.path, fill: true }); continue; }
    missing.push({ ...r, searched: hit.searched });
  }
  if (missing.length) {                                   // mirror validateSkills posture (list searched paths)
    const lines = missing.map((m) =>
      `  - skill "${m.skill}" (required by ${m.requiredBy.join(', ')}) not found. Searched:\n` +
      (m.searched || []).map((p) => `      ${p}`).join('\n'));
    throw err(`Export failed: ${missing.length} required skill(s) unavailable:\n${lines.join('\n')}`, 'MISSING_SKILL');
  }
  return out;                                             // only entries with fill:true get written (via cp of srcDir)
}

// ── Step 7: Plan & Apply ─────────────────────────────────────────────────────

/**
 * Dispatch-name resolver. `nsKeys` is the EXPLICIT set of agent keys to namespace;
 * a namespaced key maps to `<slug>-<stem>`, everything else to its plain `<stem>`.
 */
function makeNameResolver(set, nsKeys = new Set()) {
  const stemByKey = new Map(set.agents.map((a) => [a.key, a.stem]));
  return (key) => {
    const stem = stemByKey.get(key) || key;
    return nsKeys.has(key) ? `${set.slug}-${stem}` : stem;
  };
}

/**
 * Which agent keys must be namespaced: any whose DEFAULT agent path carries an explicit
 * `namespace` resolution, plus — when a blanket `--on-conflict=namespace` is in effect —
 * every agent whose default-path target is currently a `conflict` (discovered by a plain-stem
 * first pass in applyExport). Non-conflicting agents are never namespaced.
 */
function namespacedKeys(set, resolutions, blanket, conflictedAgentKeys = new Set()) {
  const ns = new Set();
  for (const a of set.agents) {
    const defPath = safeJoin(set.dest, 'agents', `${a.stem}.md`);
    if (resolutions[defPath] === 'namespace') ns.add(a.key);
  }
  if (blanket === 'namespace') for (const k of conflictedAgentKeys) ns.add(k);
  return ns;
}

/**
 * Classify every intended file. `agentsOnly` skips the SKILL.md/workflow.json/dep-skill work
 * and emits ONLY the agent targets — used by applyExport's blanket-namespace discovery pass,
 * which only needs to know which AGENT default-paths conflict (regenerating the full skill body
 * + workflow.json + deps a second time is pure waste). SKILL.md is FIRST when included so
 * callers can locate it as targets[0].
 */
async function classifyTargets(set, nameFor, { agentsOnly = false } = {}) {
  const targets = [];
  if (!agentsOnly) {
    // SKILL.md (slug collision is a non-namespaceable conflict → guidance: choose a different --slug)
    {
      const body = makeSkillMd(set, nameFor);
      const { text, contentHash } = stampMarkdown(body, { ...set.ident, key: `skill:${set.slug}` });
      const path = safeJoin(set.dest, 'skills', set.slug, 'SKILL.md');
      const action = classify(await inspect(path, 'md'), { contentHash, ...set.ident, workflow: set.ident.workflow }, { namespaceable: false });
      targets.push({ path, text, kind: 'md', role: 'skill', ...action });
    }
    // workflow.json
    {
      const { text, contentHash } = makeWorkflowJson(set);
      const path = safeJoin(set.dest, 'skills', set.slug, 'workflow.json');
      const action = classify(await inspect(path, 'json'), { contentHash, ...set.ident }, { namespaceable: false });
      targets.push({ path, text, kind: 'json', ...action });
    }
  }
  // agents (namespaceable)
  if (set.includeAgents) {
    // map key -> its resolved node for capability flags
    const nodeByKey = new Map();
    for (const g of set.nodes) for (const n of g) if (!nodeByKey.has(n.key)) nodeByKey.set(n.key, n);
    for (const a of set.agents) {
      const finalName = nameFor(a.key);
      const body = await makeAgentMd(a, nodeByKey.get(a.key), finalName, set.agentSrcCache);
      const { text, contentHash } = stampMarkdown(body, { ...set.ident, key: a.stem });
      const path = safeJoin(set.dest, 'agents', `${finalName}.md`);
      const action = classify(await inspect(path, 'md'), { contentHash, ...set.ident, key: a.stem }, { namespaceable: true });
      targets.push({ path, text, kind: 'md', agentKey: a.key, ...action });   // agentKey → blanket-namespace discovery
    }
    // dep skills (fill:true only) — not needed by the agentsOnly discovery pass
    if (!agentsOnly) for (const d of set.depSkills.filter((x) => x.fill)) {
      targets.push({ path: safeJoin(set.dest, 'skills', d.skill, 'SKILL.md'), copyFrom: join(d.srcDir, 'SKILL.md'),
        kind: 'md', action: 'create', dep: d });
    }
  }
  return targets;
}

export async function planExport(opts) {
  const set = await buildExportSet(opts);
  const targets = await classifyTargets(set, makeNameResolver(set));   // plain stems → conflicts at default paths
  const bucket = { created: [], noop: [], updated: [], conflicts: [], warnings: set.warnings };
  for (const t of targets) {
    if (t.action === 'create') bucket.created.push(t.path);
    else if (t.action === 'noop') bucket.noop.push(t.path);
    else if (t.action === 'update') bucket.updated.push(t.path);
    else bucket.conflicts.push({ path: t.path, reason: t.reason, options: t.options });
  }
  bucket.orphans = await findOrphans(set, makeNameResolver(set));   // reported, never auto-deleted (v1)
  return bucket;
}

export async function applyExport(opts) {
  const set = await buildExportSet(opts);
  const resolutions = opts.resolutions || {};            // { [defaultPath]: 'keep'|'overwrite'|'namespace'|'cancel' }
  const blanket = opts.onConflict || 'skip';             // CLI default 'skip' + report

  // 'cancel' aborts the WHOLE export — it is a user's "stop, don't touch anything", not a
  // per-file skip. Refuse before classifying or writing anything, naming the cancelled path(s).
  const cancelled = Object.keys(resolutions).filter((p) => resolutions[p] === 'cancel');
  if (cancelled.length) {
    throw err(`export cancelled at ${cancelled.length} conflict(s); nothing was written:\n` +
      cancelled.map((p) => `  - ${p}`).join('\n'), 'CANCELLED');
  }

  // A blanket --on-conflict=namespace needs a plain-stem FIRST pass to discover which agent
  // targets conflict, so it namespaces EXACTLY those. No other policy uses it, so skip the
  // extra classify for skip/overwrite. `agentsOnly` keeps the pass cheap — it needs agent
  // conflicts only, not a full SKILL.md/workflow.json/dep regeneration.
  let conflictedAgentKeys = new Set();
  if (blanket === 'namespace') {
    const firstPass = await classifyTargets(set, makeNameResolver(set), { agentsOnly: true });
    conflictedAgentKeys = new Set(
      firstPass.filter((t) => t.agentKey && t.action === 'conflict').map((t) => t.agentKey),
    );
  }

  // Decide per-agent final dispatch name (namespacing) so SKILL.md dispatches the final name
  // and the agent `name:` matches — byte-identical on both sides.
  const nsKeys = namespacedKeys(set, resolutions, blanket, conflictedAgentKeys);
  const nameFor = makeNameResolver(set, nsKeys);

  const targets = await classifyTargets(set, nameFor);

  // Reject a KNOWN choice applied to a target that never OFFERED it — e.g. 'namespace' on the
  // non-namespaceable SKILL.md/workflow.json (classify returns options WITHOUT 'namespace' for
  // those). Left unchecked, decisionFor would fall to writes()=false and SILENTLY skip the file:
  // applyExport would report success while leaving a stale, non-runnable export on disk. (The
  // server validates only against the global choice list, so this per-target check is the real
  // gate.) We gate on RESOLUTION_CHOICES so an UNKNOWN value (e.g. the typo "Overwrite") still
  // falls through to the fail-closed skip below, not a hard error. A namespaced agent's default
  // path is renamed out of `targets`, so its 'namespace' resolution is never seen here.
  for (const t of targets) {
    const choice = resolutions[t.path];
    if (choice && RESOLUTION_CHOICES.includes(choice) && t.action === 'conflict' &&
        Array.isArray(t.options) && !t.options.includes(choice)) {
      throw err(`resolution '${choice}' is not valid for ${t.path} (offered: ${t.options.join(', ')}); ` +
        `a non-namespaceable file cannot be namespaced — choose 'overwrite', or a different --slug.`, 'BAD_REQUEST');
    }
  }

  // Final per-target decision, computed ONCE (reused by the consistency guard AND the write
  // loop). A conflict resolves to its per-path choice, else the blanket policy; anything not in
  // {create,update,overwrite} leaves the file as-is (fail closed — an unrecognized resolution
  // like the typo "Overwrite" must never clobber a user's file).
  const decisionFor = (t) => t.action === 'conflict'
    ? (resolutions[t.path] || (blanket === 'overwrite' ? 'overwrite' : 'keep'))
    : t.action;
  const writes = (d) => d === 'create' || d === 'update' || d === 'overwrite';

  // Under blanket namespace, a conflict that renaming did NOT turn into a fresh 'create'
  // (SKILL.md / workflow.json are non-namespaceable; a slug collision) cannot be resolved by
  // namespacing. Refuse BEFORE writing anything — otherwise we would keep a stale SKILL.md
  // that dispatches old plain names while emitting orphan <slug>-<stem> agents (a non-runnable
  // export). A different --slug (or an explicit per-path resolution) is the fix.
  if (blanket === 'namespace') {
    const unresolved = targets.filter((t) => t.action === 'conflict' && !resolutions[t.path]);
    if (unresolved.length) {
      throw err(`--on-conflict=namespace cannot resolve ${unresolved.length} conflict(s) by renaming ` +
        `(a slug/skill collision is not fixable by namespacing agents). Choose a different --slug, or ` +
        `resolve per-path:\n` + unresolved.map((t) => `  - ${t.path} (${t.reason})`).join('\n'), 'CONFLICT');
    }
  }

  // Namespace/SKILL consistency (applies to per-path resolutions too, not just blanket
  // namespace). SKILL.md is regenerated to dispatch the <slug>-<stem> names of every namespaced
  // agent. If SKILL.md itself is a conflict the user is NOT (re)writing (e.g. resolved 'keep',
  // or skipped), the on-disk skill would keep dispatching the OLD plain names while we emit the
  // renamed agents — an orphaned agent + a non-runnable skill. Refuse before any write.
  if (nsKeys.size) {
    const skillTarget = targets.find((t) => t.role === 'skill');
    if (skillTarget) {
      const d = decisionFor(skillTarget);
      if (d !== 'noop' && !writes(d)) {                  // noop = on-disk already == our namespaced SKILL.md
        throw err(`refusing a broken export: ${nsKeys.size} agent(s) would be namespaced (dispatched as ` +
          `<slug>-<stem>), but SKILL.md (${skillTarget.path}) would be ${d === 'keep' ? 'kept' : 'skipped'} — ` +
          `the on-disk skill would still dispatch the old plain names, orphaning the namespaced agents. ` +
          `Resolve the SKILL.md conflict with 'overwrite', or choose a different --slug.`, 'CONFLICT');
      }
    }
  }

  const written = [], skipped = [];
  for (const t of targets) {
    // A namespaced agent already appears here as a fresh 'create' at the `<slug>-<stem>` path;
    // its original default-path file is simply NOT in `targets` (nameFor renamed it) → left as-is.
    const decision = decisionFor(t);
    if (!writes(decision)) { skipped.push(t.path); continue; }
    await mkdir(dirname(t.path), { recursive: true });
    // dep skill: copy the whole source dir, but NEVER clobber a file the user already has there
    // (a dep is only filled when its SKILL.md is absent, yet the dir may hold unrelated user
    // files — force:false + errorOnExist:false leaves those untouched).
    if (t.copyFrom) await cp(dirname(t.copyFrom), dirname(t.path), { recursive: true, force: false, errorOnExist: false });
    else await writeFileAtomic(t.path, t.text);
    written.push(t.path);
  }
  // Classification buckets from the SAME targets used for writing, so a caller (e.g. the CLI)
  // can show the plan AND apply from a single pass instead of running the whole resolve+classify
  // pipeline twice.
  const plan = { created: [], updated: [], noop: [], conflicts: [] };
  for (const t of targets) {
    if (t.action === 'create') plan.created.push(t.path);
    else if (t.action === 'update') plan.updated.push(t.path);
    else if (t.action === 'noop') plan.noop.push(t.path);
    else if (t.action === 'conflict') {
      // Only report a conflict back as OUTSTANDING if the caller did not resolve it. A conflict
      // resolved per-path (keep/overwrite/namespace) or by a blanket overwrite is done — echoing
      // it would make a UI that treats every returned conflict as "still needs resolving" loop
      // forever on a 'keep' that was honored by leaving the file untouched. Genuinely unresolved
      // conflicts (blanket skip default, an invalid choice that fell to fail-closed skip, or a
      // TOCTOU conflict that appeared after Plan) still surface so the caller can act.
      const choice = resolutions[t.path];
      const resolved = choice === 'keep' || choice === 'overwrite' || choice === 'namespace' || blanket === 'overwrite';
      if (!resolved) plan.conflicts.push({ path: t.path, reason: t.reason, options: t.options });
    }
  }
  // findOrphans with the REAL (namespacing-aware) resolver so a stale plain file left behind
  // when a stem was namespaced is reported (see findOrphans).
  return { ...plan, written, skipped, warnings: set.warnings, orphans: await findOrphans(set, nameFor) };
}

/** Dispatcher: a dry run classifies (writes nothing); anything else applies. Conflict
 *  handling defaults to blanket 'skip' inside applyExport when onConflict/resolutions are
 *  absent — a plain apply must NOT silently degrade to a no-op plan. */
export function exportWorkflow(opts) {
  return opts && opts.dryRun ? planExport(opts) : applyExport(opts);
}

/**
 * Scan <dest>/.claude/agents/*.md for files this workflow emitted before (stamp.workflow ===
 * tpl.id) that it no longer emits. `nameFor` is the SAME dispatch-name resolver used to write
 * this run, so orphans are judged by the FILENAME actually emitted for each stem — not the bare
 * stem. That catches two cases with one rule:
 *   - a node removed from the workflow (its stem has no current file at all), and
 *   - a stale PLAIN file left behind after its stem was namespaced (the stem is still current,
 *     but under a `<slug>-<stem>.md` filename now, so the old `<stem>.md` is orphaned).
 * A namespaced sibling is NOT falsely reported: its filename equals nameFor's output for its
 * stem. (Note: planExport passes the plain resolver — it cannot know per-path namespacing
 * intent — so a pre-existing namespaced file may surface as an orphan in a dry-run plan; orphans
 * are informational and never auto-deleted, so this is a report-only over-list, not a hazard.)
 */
async function findOrphans(set, nameFor) {
  const dir = safeJoin(set.dest, 'agents');
  if (!existsSync(dir)) return [];
  // stem -> the filename this run emits for it (namespacing-aware).
  const currentFileByStem = new Map(set.agents.map((a) => [a.stem, `${nameFor(a.key)}.md`]));
  const orphans = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith('.md')) continue;
    const { stamp } = readMarkdownStamp(await readFile(join(dir, name), 'utf8'));
    if (!stamp || stamp.workflow !== set.ident.workflow) continue;   // not ours (or unstamped)
    const current = currentFileByStem.get(stamp.key);
    if (!current || current !== name) {
      orphans.push(join(dir, name));               // this workflow emitted it before; no longer referenced
    }
  }
  return orphans;
}

// ── Export to plugin (#421) ──────────────────────────────────────────────────
// "Share this workflow with another Worca user", the durable way: a plugin
// folder the recipient `worca plugin link`s (or publishes) and updates with
// `worca plugin reimport`. Bundles the workflow (unstamped v2 graph), every USER
// agent it references (built-ins are on every host; another plugin's agent is
// refused — bundling it would create two owners) and every non-bundle skill
// those agents require. Deterministic: a re-export of an unchanged workflow with
// --keep-version is an all-no-op.

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** Patch-bump a plain x.y.z; anything else yields null (caller warns). */
function bumpPatch(version) {
  const m = SEMVER_RE.exec(String(version || ''));
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : null;
}

async function readTextOrNull(path) {
  try { return await readFile(path, 'utf8'); } catch { return null; }
}

/**
 * Plan (dryRun) or write a plugin folder for one saved v2 workflow.
 * @param {{workflowId:string, targetDir:string, pluginName?:string, keepVersion?:boolean,
 *          dryRun?:boolean, repoRoot?:string}} opts
 * @returns {Promise<{dir, name, slug, version, created:string[], updated:string[], noop:string[],
 *   skipped:Array<{path:string, reason:string}>, conflicts:[], warnings:string[], orphans:[],
 *   written:string[], validation:{ok:boolean, problems:Array}|null}>}
 * Error codes: BAD_REQUEST | NOT_FOUND | UNSUPPORTED | INVALID_GRAPH | CONFLICT | MISSING_SKILL
 */
export async function exportWorkflowPlugin({ workflowId, targetDir, pluginName, keepVersion = false, dryRun = false, repoRoot } = {}) {
  if (!workflowId || typeof workflowId !== 'string') throw err('workflowId is required', 'BAD_REQUEST');
  if (!targetDir || typeof targetDir !== 'string' || !targetDir.trim()) throw err('a target plugin folder is required', 'BAD_REQUEST');
  const dir = resolve(targetDir);
  const tpl = await readWorkflow(workflowId);
  if (!tpl) throw err(`workflow not found: ${workflowId}`, 'NOT_FOUND');
  const payload = await exportGraphJson(workflowId);            // UNSUPPORTED for a v1 row
  const slug = workflowFileSlug(tpl.id);
  const warnings = [];

  // ── Manifest identity: an explicit --name must match an existing manifest; absent
  //    a --name, an existing manifest's name is adopted, else the folder's basename.
  const manifestPath = join(dir, 'worca-cc-plugin.json');
  let existing = null;
  const existingText = await readTextOrNull(manifestPath);
  if (existingText !== null) {
    try { existing = JSON.parse(existingText); } catch (e) { throw err(`${manifestPath}: invalid JSON (${e.message})`, 'BAD_REQUEST'); }
    if (!existing || typeof existing !== 'object' || Array.isArray(existing)) throw err(`${manifestPath}: not a JSON object`, 'BAD_REQUEST');
  }
  const askedName = typeof pluginName === 'string' && pluginName.trim() ? pluginName.trim() : '';
  const name = askedName || (existing && typeof existing.name === 'string' && existing.name.trim()) || basename(dir);
  if (!PLUGIN_NAME_RE.test(name) || name.length > 64) {
    throw err(`plugin name must be kebab-case — lowercase letters, digits and hyphens (got "${name}")`, 'BAD_REQUEST');
  }
  if (existing && askedName && existing.name !== askedName) {
    throw err(`${dir} is plugin "${existing.name}" — pass --name ${existing.name} to update it, or choose another folder`, 'CONFLICT');
  }

  // ── The stored graph must be runnable HERE before it is shared: a stranded
  //    key (deleted agent) would only surface at the recipient's link.
  const registry = loadAgentRegistry();
  const { errors } = validateGraph({ ...payload, id: tpl.id }, registryPortsFn(registry));
  if (errors.length) {
    const summary = summarizeUnknownAgents(errors);
    throw Object.assign(
      err(`workflow ${tpl.id} cannot be exported: ${summary || errors.map(formatIssue).join('; ')}`, 'INVALID_GRAPH'),
      { errors, summary });
  }

  // ── Agents: user-owned are bundled, built-ins never, another plugin's refused.
  const agentNodes = payload.nodes.filter((n) => n && n.kind === 'agent' && n.key);
  const keys = distinctAgents([agentNodes]);
  const userAgents = [];
  const foreign = [];
  const builtins = [];
  for (const key of keys) {
    const meta = registry[key];
    if (!meta) continue;                                          // validateGraph refused above
    const origin = String(meta.origin || '');
    if (origin === 'builtin') builtins.push(key);
    else if (origin.startsWith('plugin:')) foreign.push({ key, plugin: origin.slice('plugin:'.length) });
    else userAgents.push({ key, meta });
  }
  if (foreign.length) {
    const list = foreign.map((f) => `"${f.key}" (owned by plugin "${f.plugin}")`).join(', ');
    throw err(`cannot bundle ${list} — a shared workflow bundles only your own agents; ` +
      'the recipient installs that plugin alongside, or you duplicate the agent under your own name', 'UNSUPPORTED');
  }
  if (builtins.length) warnings.push(`built-in agent(s) not bundled (present on every Worca host): ${builtins.join(', ')}`);

  // ── Skills the bundled agents require: filled from global/project/other-plugin
  //    sources; a Worca-shipped (bundle) skill is skipped, like a built-in agent.
  const depSkills = resolveDepSkills(registry, userAgents.map((a) => a.key), dir, 'plugin', null, repoRoot,
    { layout: 'plugin', skipSources: ['bundle'] });

  // ── Intended files ──
  const targets = [];                                             // {path, text?, copyFrom?}
  const skipped = [];
  const noop = [];
  targets.push({ path: join(dir, 'workflows', `${slug}.json`), text: JSON.stringify(payload, null, 2) + '\n' });
  for (const { key, meta } of userAgents) {
    const mdPath = meta.agentPath || null;
    if (!mdPath || !existsSync(mdPath)) throw err(`agent source not found for "${key}"`, 'NOT_FOUND');
    const sidecarPath = join(dirname(mdPath), `${key}.meta.json`);
    if (!existsSync(sidecarPath)) throw err(`agent sidecar not found for "${key}" (${sidecarPath})`, 'NOT_FOUND');
    // Byte-identical copies: the plugin ships exactly what the exporter runs.
    targets.push({ path: join(dir, 'agents', `${key}.md`), text: await readFile(mdPath, 'utf8') });
    targets.push({ path: join(dir, 'agents', `${key}.meta.json`), text: await readFile(sidecarPath, 'utf8') });
  }
  for (const s of depSkills) {
    const skillMd = join(dir, 'skills', s.skill, 'SKILL.md');
    if (s.skipped) skipped.push({ path: skillMd, reason: `skill "${s.skill}" ships with Worca (${s.resolvedFrom}) — not bundled` });
    else if (!s.fill) noop.push(skillMd);                          // already in the folder: never touched
    else targets.push({ path: skillMd, copyFrom: join(s.srcDir, 'SKILL.md') });
  }

  // ── Classify everything but the manifest (its version bump depends on this).
  const created = [];
  const updated = [];
  for (const t of targets) {
    if (t.copyFrom) { t.action = 'create'; created.push(t.path); continue; }   // fill:true == absent
    const cur = await readTextOrNull(t.path);
    if (cur === null) { t.action = 'create'; created.push(t.path); }
    else if (cur === t.text) { t.action = 'noop'; noop.push(t.path); }
    else { t.action = 'update'; updated.push(t.path); }
  }

  // ── Manifest: adopt what is there, record the export, bump the patch version
  //    when this export changes a file (unless keepVersion).
  const changed = created.length + updated.length > 0;
  const manifest = existing ? { ...existing } : {
    name, version: '0.1.0',
    description: `Workflows shared from Worca — ${tpl.name}`,
    engines: { 'worca-cc-api': '>=3 <4' },
  };
  if (!manifest.name) manifest.name = name;
  let version = typeof manifest.version === 'string' ? manifest.version : '';
  if (existing && changed && !keepVersion) {
    const next = bumpPatch(version);
    if (next) version = next;
    else warnings.push(`manifest version "${version}" is not plain x.y.z — left unchanged (bump it yourself before publishing)`);
  }
  if (version) manifest.version = version;
  const prevWorca = existing && existing.worca && typeof existing.worca === 'object' && !Array.isArray(existing.worca) ? existing.worca : {};
  const prevExports = prevWorca.exports && typeof prevWorca.exports === 'object' && !Array.isArray(prevWorca.exports) ? prevWorca.exports : {};
  manifest.worca = {
    ...prevWorca,
    exports: { ...prevExports, [slug]: { workflowId: tpl.id, name: tpl.name, updatedAt: tpl.updatedAt || null } },
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const manifestTarget = { path: manifestPath, text: manifestText };
  if (existingText === null) { manifestTarget.action = 'create'; created.push(manifestPath); }
  else if (existingText === manifestText) { manifestTarget.action = 'noop'; noop.push(manifestPath); }
  else { manifestTarget.action = 'update'; updated.push(manifestPath); }
  targets.push(manifestTarget);

  const plan = {
    dir, name, slug, version: manifest.version || null,
    created, updated, noop, skipped, conflicts: [], warnings, orphans: [], written: [], validation: null,
  };
  if (dryRun) return plan;

  // ── Apply ──
  for (const t of targets) {
    if (t.action === 'noop') continue;
    await mkdir(dirname(t.path), { recursive: true });
    // dep skill: copy the whole source dir; SKILL.md is absent by construction (fill:true), but
    // the dir may hold unrelated user files — force:false leaves those untouched.
    if (t.copyFrom) await cp(dirname(t.copyFrom), dirname(t.path), { recursive: true, force: false, errorOnExist: false });
    else await writeFileAtomic(t.path, t.text);
    plan.written.push(t.path);
  }
  // The folder must lint clean — the recipient's `worca plugin link` runs this same gate.
  const v = validatePluginDir(dir);
  plan.validation = { ok: v.ok, problems: v.problems };
  for (const p of v.problems) warnings.push(`plugin validation ${p.level}: ${p.message}`);
  return plan;
}
